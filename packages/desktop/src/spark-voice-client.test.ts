import { describe, expect, it, vi } from 'vitest';

import { createSparkVoiceClient, type SparkAudioPlayer } from './spark/spark-voice-client.js';
import type { SparkVoiceEvent } from '@the-vault/core';

/** A fake SparkVoiceAPI that lets the test push events + audio commands. */
function fakeApi() {
  let voiceCb: ((e: SparkVoiceEvent) => void) | null = null;
  let playCb: ((p: { audio: Uint8Array; mimeType: string }) => void) | null = null;
  let stopCb: (() => void) | null = null;
  const notifyPlaybackEnded = vi.fn();
  const api: Window['sparkVoiceApi'] = {
    getReadiness: vi.fn(async () => ({ success: true, data: { ready: true, roles: [], missing: [] } })),
    start: vi.fn(async () => ({ success: true, data: { ready: true, roles: [], missing: [] } })),
    stop: vi.fn(async () => ({ success: true, data: { status: 'idle' } })),
    sendText: vi.fn(async () => ({ success: true, data: { status: 'thinking' } })),
    sendAudioUtterance: vi.fn(async () => ({ success: true, data: { status: 'thinking' } })),
    sendAudioLevel: vi.fn(),
    notifyPlaybackEnded,
    onVoiceEvent: (cb: (e: SparkVoiceEvent) => void) => {
      voiceCb = cb;
      return () => { voiceCb = null; };
    },
    onPlayAudio: (cb: (p: { audio: Uint8Array; mimeType: string }) => void) => {
      playCb = cb;
      return () => { playCb = null; };
    },
    onStopAudio: (cb: () => void) => {
      stopCb = cb;
      return () => { stopCb = null; };
    },
  } as unknown as Window['sparkVoiceApi'];
  return {
    api,
    notifyPlaybackEnded,
    emit: (e: SparkVoiceEvent) => voiceCb?.(e),
    emitPlay: (p: { audio: Uint8Array; mimeType: string }) => playCb?.(p),
    emitStop: () => stopCb?.(),
  };
}

function fakePlayer(): SparkAudioPlayer & { play: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } {
  return { play: vi.fn(), stop: vi.fn() } as never;
}

describe('createSparkVoiceClient', () => {
  it('folds the voice event stream into the SparkSessionFrame contract', () => {
    const harness = fakeApi();
    const client = createSparkVoiceClient({ api: harness.api });
    const frames: number[] = [];
    client.subscribe((frame) => frames.push(frame.transcript.length));

    harness.emit({ kind: 'finalTranscript', entry: { id: 'u1', role: 'user', text: 'hi', final: true, ts: 1 } });
    harness.emit({ kind: 'responseText', entry: { id: 's1', role: 'spark', text: 'Hello', final: true, ts: 2 } });
    harness.emit({ kind: 'toolCall', entry: { id: 't1', name: 'recall_memory', status: 'done', ts: 3 } });
    harness.emit({ kind: 'audioLevel', level: 0.5, ts: 4 });

    const frame = client.getFrame();
    expect(frame.transcript.map((t) => t.role)).toEqual(['user', 'spark']);
    expect(frame.toolCalls[0]).toMatchObject({ name: 'recall_memory', status: 'done' });
    expect(frame.audioLevel).toBe(0.5);
    expect(frames.at(-1)).toBe(2);
  });

  it('plays host audio and reports playback completion back to the host', () => {
    const harness = fakeApi();
    const player = fakePlayer();
    createSparkVoiceClient({ api: harness.api, player });

    const audio = new Uint8Array([1, 2, 3]);
    harness.emitPlay({ audio, mimeType: 'audio/mpeg' });
    expect(player.play).toHaveBeenCalledWith(audio, 'audio/mpeg', expect.any(Function));

    // Invoke the onEnded callback the client passed in.
    (player.play.mock.calls[0][2] as () => void)();
    expect(harness.notifyPlaybackEnded).toHaveBeenCalled();
  });

  it('tracks playback state and exposes a renderer stop control', () => {
    const harness = fakeApi();
    const player = fakePlayer();
    const client = createSparkVoiceClient({ api: harness.api, player });
    const states: boolean[] = [];
    client.subscribePlayback((state) => states.push(state.playing));

    harness.emitPlay({ audio: new Uint8Array([1]), mimeType: 'audio/mpeg' });
    expect(client.getPlaybackState()).toMatchObject({ playing: true, mimeType: 'audio/mpeg' });

    client.stopPlayback();
    expect(player.stop).toHaveBeenCalled();
    expect(client.getPlaybackState()).toEqual({ playing: false, mimeType: null });
    expect(states).toEqual([true, false]);
  });

  it('stops playback on a host stop-audio command (barge-in)', () => {
    const harness = fakeApi();
    const player = fakePlayer();
    createSparkVoiceClient({ api: harness.api, player });
    harness.emitStop();
    expect(player.stop).toHaveBeenCalled();
  });

  it('forwards control calls to the api and detaches listeners on dispose', async () => {
    const harness = fakeApi();
    const client = createSparkVoiceClient({ api: harness.api });
    await client.start();
    await client.sendText('hello');
    await client.stop();
    expect(harness.api.start).toHaveBeenCalled();
    expect(harness.api.sendText).toHaveBeenCalledWith('hello');
    expect(harness.api.stop).toHaveBeenCalled();

    let received = 0;
    client.subscribe(() => { received += 1; });
    client.dispose();
    harness.emit({ kind: 'audioLevel', level: 1, ts: 1 });
    expect(received).toBe(0); // disposed — no more deliveries
  });
});
