/**
 * Spark voice host (S3 + realtime). Main-process glue that owns the live voice
 * session and bridges its event stream to the renderer.
 *
 * Two pipelines:
 *  - realtime (preferred when FreeLLMAPI / a Realtime-role provider is configured):
 *    a Gemini-Live WebSocket where the server does VAD/STT/LLM/TTS. The renderer
 *    streams raw 16kHz PCM up; 24kHz PCM comes back for playback.
 *  - classic: STT→LLM(+tools)→TTS over HTTP with renderer MediaRecorder utterances.
 *
 * It takes no Electron imports: window-sending side effects (event push, audio
 * play/stop, PCM play) and the socket factory are injected, so the heavy logic
 * stays unit-testable and lives in the tested core runtime.
 */

import WebSocket from 'ws';
import {
  buildSparkHostTools,
  buildSparkVoiceReadiness,
  createSparkRealtimeRuntimeSession,
  createSparkVoiceRuntimeSession,
  type SparkFetch,
  type SparkProviderCredentialStore,
  type SparkRealtimeSession,
  type SparkRealtimeSocket,
  type SparkVoiceEvent,
  type SparkVoiceReadiness,
  type SparkVoiceSession,
  type SparkVoiceStatus,
} from '@the-vault/core';

export interface SparkVoiceHostDeps {
  credentials: SparkProviderCredentialStore;
  /** Node global fetch, adapted to the SparkFetch shape (used for HTTP + realtime mint). */
  fetchImpl: SparkFetch;
  /** Open a realtime WebSocket to the minted connect URL. */
  createRealtimeSocket: (url: string) => SparkRealtimeSocket;
  /** Push a voice event to the renderer (win.webContents.send). */
  sendEvent: (event: SparkVoiceEvent) => void;
  /** Hand synthesized (classic) audio bytes to the renderer for playback. */
  playAudio: (audio: Uint8Array, mimeType: string) => void;
  /** Hand a base64 PCM chunk (realtime) to the renderer for streamed playback. */
  playPcm: (base64Pcm: string, mimeType: string) => void;
  /** Tell the renderer to stop any current playback (barge-in / stop). */
  stopAudio: () => void;
  /** Read-only Vault recall used both as fenced context and the recall tool. */
  recall: (query: string) => Promise<string | null>;
}

export interface SparkVoiceUtteranceInput {
  data: Uint8Array;
  mimeType: string;
}

export interface SparkVoiceHost {
  getReadiness: () => SparkVoiceReadiness;
  start: () => SparkVoiceReadiness;
  stop: () => void;
  sendText: (text: string) => Promise<void>;
  /** Classic pipeline: a complete recorded utterance (webm/opus) for STT. */
  pushAudioUtterance: (audio: SparkVoiceUtteranceInput) => Promise<void>;
  /** Realtime pipeline: a streamed base64 PCM chunk (16kHz mono). */
  pushPcmChunk: (base64Pcm: string) => void;
  pushAudioLevel: (level: number, ts?: number) => void;
  notifyPlaybackEnded: () => void;
  getStatus: () => SparkVoiceStatus;
  isActive: () => boolean;
}

export function createSparkVoiceHost(deps: SparkVoiceHostDeps): SparkVoiceHost {
  let classic: SparkVoiceSession | null = null;
  let realtime: SparkRealtimeSession | null = null;

  function getReadiness(): SparkVoiceReadiness {
    return buildSparkVoiceReadiness(deps.credentials);
  }

  function start(): SparkVoiceReadiness {
    const readiness = getReadiness();
    if (!readiness.ready) {
      deps.sendEvent({
        kind: 'error',
        message: `Voice runtime not ready — configure a provider for: ${readiness.missing.join(', ') || 'a Realtime or STT/LLM/TTS provider'}.`,
        ts: Date.now(),
      });
      return readiness;
    }

    if (readiness.mode === 'realtime') {
      realtime = createSparkRealtimeRuntimeSession({
        credentials: deps.credentials,
        fetchImpl: deps.fetchImpl,
        createSocket: deps.createRealtimeSocket,
        emit: deps.sendEvent,
        playAudio: (base64, mimeType) => deps.playPcm(base64, mimeType),
        dispatchTool: async (name, args) => {
          // Only the read-only recall tool is exposed to realtime for now.
          if (name === 'recall_memory') {
            try {
              const query = typeof args === 'string' ? (JSON.parse(args)?.query ?? '') : '';
              const value = await deps.recall(String(query));
              return { ok: true, value: value ?? 'No relevant memories.' };
            } catch (error) {
              return { ok: false, error: error instanceof Error ? error.message : 'Recall failed.' };
            }
          }
          return { ok: false, error: `Unknown tool: ${name}` };
        },
      });
      void realtime.start();
      return readiness;
    }

    classic = createSparkVoiceRuntimeSession({
      credentials: deps.credentials,
      fetchImpl: deps.fetchImpl,
      audioOutput: {
        play: (audio, mimeType) => deps.playAudio(new Uint8Array(audio), mimeType),
        stop: () => deps.stopAudio(),
      },
      emit: deps.sendEvent,
      recallContext: deps.recall,
      tools: buildSparkHostTools({ recallMemory: deps.recall }),
    });
    classic.start();
    return readiness;
  }

  function stop(): void {
    classic?.stop();
    classic = null;
    realtime?.stop();
    realtime = null;
  }

  return {
    getReadiness,
    start,
    stop,
    async sendText(text) {
      await classic?.sendText(text);
    },
    async pushAudioUtterance(audio) {
      await classic?.pushAudioUtterance({ data: audio.data, mimeType: audio.mimeType });
    },
    pushPcmChunk(base64Pcm) {
      realtime?.sendAudioChunk(base64Pcm);
    },
    pushAudioLevel(level, ts) {
      classic?.pushAudioLevel(level, ts);
    },
    notifyPlaybackEnded() {
      classic?.notifyPlaybackEnded();
    },
    getStatus: () => realtime?.getStatus() ?? classic?.getStatus() ?? 'idle',
    isActive: () => realtime !== null || classic !== null,
  };
}

/** Adapt Node's global `fetch` to the injectable `SparkFetch` contract. */
export function createNodeSparkFetch(): SparkFetch {
  return async (url, init) => {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body as BodyInit | undefined,
      signal: init.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text: () => response.text(),
      json: () => response.json(),
      arrayBuffer: () => response.arrayBuffer(),
      body: response.body,
    };
  };
}

/**
 * Adapt the Node `ws` WebSocket to the core `SparkRealtimeSocket` contract.
 * Electron's main process (Node 20) has no global WebSocket, so we use `ws`.
 */
export function createNodeRealtimeSocket(url: string): SparkRealtimeSocket {
  const ws = new WebSocket(url);
  const socket: SparkRealtimeSocket = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: (data: string) => ws.send(data),
    close: () => ws.close(),
  };
  ws.on('open', () => socket.onopen?.());
  // `ws` delivers text frames as a Buffer; the core summarizer stringifies it.
  ws.on('message', (data: unknown) => socket.onmessage?.(data));
  ws.on('error', (err) => socket.onerror?.(err));
  ws.on('close', () => socket.onclose?.());
  return socket;
}
