/**
 * Renderer voice client (S3 → S4 seam). Subscribes to the host's
 * `spark:voice:*` event stream, folds it into the `SparkSessionFrame` prop
 * contract with the shared core reducer, and drives playback of synthesized
 * audio. S4 consumes this directly to render the live session frame.
 *
 * The `SparkVoiceAPI` and the audio player are injected so the whole client is
 * unit-testable in node with fakes — no Electron, no Web Audio.
 */

import type {
  SparkSessionFrame,
  SparkVoiceEvent,
} from '@the-vault/core';
import {
  applySparkVoiceEvent,
  createEmptySparkSessionFrame,
} from './spark-session-frame-renderer.js';
import { createBrowserSparkPcmPlayer, type SparkPcmPlayer } from './spark-pcm-player.js';

/** Plays synthesized audio bytes; calls `onEnded` when playback finishes. */
export interface SparkAudioPlayer {
  play: (audio: Uint8Array, mimeType: string, onEnded: () => void) => void;
  stop: () => void;
}

export interface SparkVoicePlaybackState {
  playing: boolean;
  mimeType: string | null;
}

export interface SparkVoiceClientDeps {
  api: Window['sparkVoiceApi'];
  player?: SparkAudioPlayer;
  /** Streamed PCM player for the realtime pipeline (24kHz chunks). */
  pcmPlayer?: SparkPcmPlayer;
}

export type SparkVoiceFrameListener = (frame: SparkSessionFrame, lastEvent: SparkVoiceEvent) => void;
export type SparkVoicePlaybackListener = (state: SparkVoicePlaybackState) => void;

export interface SparkVoiceClient {
  start: () => ReturnType<Window['sparkVoiceApi']['start']>;
  stop: () => ReturnType<Window['sparkVoiceApi']['stop']>;
  sendText: (text: string) => ReturnType<Window['sparkVoiceApi']['sendText']>;
  getReadiness: () => ReturnType<Window['sparkVoiceApi']['getReadiness']>;
  subscribe: (listener: SparkVoiceFrameListener) => () => void;
  subscribePlayback: (listener: SparkVoicePlaybackListener) => () => void;
  getFrame: () => SparkSessionFrame;
  getPlaybackState: () => SparkVoicePlaybackState;
  stopPlayback: () => void;
  dispose: () => void;
}

export function createSparkVoiceClient(deps: SparkVoiceClientDeps): SparkVoiceClient {
  const { api } = deps;
  const player = deps.player;
  const pcmPlayer = deps.pcmPlayer ?? createBrowserSparkPcmPlayer();
  let frame = createEmptySparkSessionFrame();
  let playbackState: SparkVoicePlaybackState = { playing: false, mimeType: null };
  const listeners = new Set<SparkVoiceFrameListener>();
  const playbackListeners = new Set<SparkVoicePlaybackListener>();

  const unsubscribers: Array<() => void> = [];

  function setPlaybackState(next: SparkVoicePlaybackState): void {
    playbackState = next;
    for (const listener of playbackListeners) {
      listener(playbackState);
    }
  }

  function stopPlayback(): void {
    player?.stop();
    pcmPlayer?.stop();
    setPlaybackState({ playing: false, mimeType: null });
  }

  unsubscribers.push(
    api.onVoiceEvent((event) => {
      frame = applySparkVoiceEvent(frame, event);
      for (const listener of listeners) {
        listener(frame, event);
      }
    }),
  );

  unsubscribers.push(
    api.onPlayAudio(({ audio, mimeType }) => {
      setPlaybackState({ playing: true, mimeType });
      player?.play(audio, mimeType, () => {
        setPlaybackState({ playing: false, mimeType: null });
        api.notifyPlaybackEnded();
      });
    }),
  );

  const offPlayPcm = api.onPlayPcm?.(({ data, mimeType }) => {
    setPlaybackState({ playing: true, mimeType });
    pcmPlayer.play(data, mimeType);
  });
  if (offPlayPcm) {
    unsubscribers.push(offPlayPcm);
  }

  unsubscribers.push(
    api.onStopAudio(() => {
      stopPlayback();
    }),
  );

  return {
    start: () => api.start(),
    stop: () => {
      stopPlayback();
      return api.stop();
    },
    sendText: (text) => api.sendText(text),
    getReadiness: () => api.getReadiness(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribePlayback(listener) {
      playbackListeners.add(listener);
      return () => playbackListeners.delete(listener);
    },
    getFrame: () => frame,
    getPlaybackState: () => playbackState,
    stopPlayback,
    dispose() {
      for (const off of unsubscribers) {
        off();
      }
      listeners.clear();
      playbackListeners.clear();
      player?.stop();
      pcmPlayer.stop();
      playbackState = { playing: false, mimeType: null };
    },
  };
}

/**
 * Browser audio player backed by an <audio> element + Blob URL. Not unit-tested
 * (needs a DOM); the client logic that drives it is covered with a fake player.
 */
export function createBrowserAudioPlayer(): SparkAudioPlayer {
  let current: HTMLAudioElement | null = null;
  let currentUrl: string | null = null;

  function cleanup(): void {
    if (current) {
      current.pause();
      current.src = '';
      current = null;
    }
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
  }

  return {
    play(audio, mimeType, onEnded) {
      cleanup();
      const blob = new Blob([audio as BlobPart], { type: mimeType });
      currentUrl = URL.createObjectURL(blob);
      const element = new Audio(currentUrl);
      current = element;
      element.addEventListener('ended', () => {
        cleanup();
        onEnded();
      });
      void element.play().catch(() => {
        /* autoplay/permission errors surface via the session error channel */
      });
    },
    stop() {
      cleanup();
    },
  };
}
