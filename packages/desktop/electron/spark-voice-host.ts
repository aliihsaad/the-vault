/**
 * Spark voice host (S3) — main-process glue that owns the live `VoiceSession`
 * lifecycle and bridges its event stream to the renderer.
 *
 * It deliberately takes no Electron imports: the window-sending side effects
 * (event push, audio play/stop) are injected, so this module stays unit-testable
 * and the heavy logic lives in the tested core voice runtime. The Electron
 * `main.ts` wires the real `win.webContents.send`, the global `fetch`, the S2
 * credential store, and Vault recall into these injection points.
 */

import {
  buildSparkHostTools,
  buildSparkVoiceReadiness,
  createSparkVoiceRuntimeSession,
  type SparkFetch,
  type SparkProviderCredentialStore,
  type SparkVoiceEvent,
  type SparkVoiceReadiness,
  type SparkVoiceSession,
  type SparkVoiceStatus,
} from '@the-vault/core';

export interface SparkVoiceHostDeps {
  credentials: SparkProviderCredentialStore;
  /** Node global fetch, adapted to the SparkFetch shape. */
  fetchImpl: SparkFetch;
  /** Push a voice event to the renderer (win.webContents.send). */
  sendEvent: (event: SparkVoiceEvent) => void;
  /** Hand synthesized audio to the renderer for playback. */
  playAudio: (audio: Uint8Array, mimeType: string) => void;
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
  pushAudioUtterance: (audio: SparkVoiceUtteranceInput) => Promise<void>;
  pushAudioLevel: (level: number, ts?: number) => void;
  notifyPlaybackEnded: () => void;
  getStatus: () => SparkVoiceStatus;
  isActive: () => boolean;
}

export function createSparkVoiceHost(deps: SparkVoiceHostDeps): SparkVoiceHost {
  let session: SparkVoiceSession | null = null;

  function getReadiness(): SparkVoiceReadiness {
    return buildSparkVoiceReadiness(deps.credentials);
  }

  function start(): SparkVoiceReadiness {
    const readiness = getReadiness();
    if (!readiness.ready) {
      deps.sendEvent({
        kind: 'error',
        message: `Voice runtime not ready — configure a provider for: ${readiness.missing.join(', ')}.`,
        ts: Date.now(),
      });
      return readiness;
    }
    session = createSparkVoiceRuntimeSession({
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
    session.start();
    return readiness;
  }

  function stop(): void {
    session?.stop();
    session = null;
  }

  return {
    getReadiness,
    start,
    stop,
    async sendText(text) {
      await session?.sendText(text);
    },
    async pushAudioUtterance(audio) {
      await session?.pushAudioUtterance({ data: audio.data, mimeType: audio.mimeType });
    },
    pushAudioLevel(level, ts) {
      session?.pushAudioLevel(level, ts);
    },
    notifyPlaybackEnded() {
      session?.notifyPlaybackEnded();
    },
    getStatus: () => session?.getStatus() ?? 'idle',
    isActive: () => session !== null,
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
