import { describe, expect, it, vi } from 'vitest';

import {
  createSparkRealtimeSession,
  type SparkRealtimeSocket,
} from './services/spark-voice/spark-realtime-session.js';
import type { SparkFetch } from './services/spark-voice/spark-voice-transports.js';
import type { SparkVoiceEvent } from './types/spark-voice.js';

function fakeFetch(connectUrl = 'wss://vps/realtime/abc'): SparkFetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ connect_url: connectUrl }),
    json: async () => ({ connect_url: connectUrl }),
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
}

function fakeSocket(): SparkRealtimeSocket & { sent: string[]; closed: boolean } {
  return {
    sent: [],
    closed: false,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data: string) {
      this.sent.push(data);
    },
    close() {
      this.closed = true;
    },
  };
}

describe('createSparkRealtimeSession', () => {
  it('mints a session with the bearer key then sends setup when the socket opens', async () => {
    const events: SparkVoiceEvent[] = [];
    const fetchImpl = fakeFetch();
    const socket = fakeSocket();
    const session = createSparkRealtimeSession({
      fetchImpl,
      createSocket: () => socket,
      baseUrl: 'https://vps/v1',
      apiKey: 'sk-secret',
      model: 'auto',
      voice: 'alloy',
      emit: (e) => events.push(e),
      playAudio: () => undefined,
    });

    await session.start();

    // Mint hit the realtime endpoint with the bearer key.
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe('https://vps/v1/realtime/sessions');
    expect(init.headers.Authorization).toBe('Bearer sk-secret');

    // Socket open triggers the setup message.
    socket.onopen?.();
    expect(socket.sent.some((m) => m.includes('"setup"'))).toBe(true);
  });

  it('streams mic PCM as realtimeInput media chunks once open', async () => {
    const socket = fakeSocket();
    const session = createSparkRealtimeSession({
      fetchImpl: fakeFetch(),
      createSocket: () => socket,
      baseUrl: 'https://vps/v1',
      apiKey: 'k',
      emit: () => undefined,
      playAudio: () => undefined,
    });
    await session.start();
    socket.onopen?.();
    socket.sent.length = 0;

    session.sendAudioChunk('UENN');
    expect(JSON.parse(socket.sent[0])).toEqual({
      realtimeInput: { mediaChunks: [{ data: 'UENN', mimeType: 'audio/pcm;rate=16000' }] },
    });
  });

  it('maps server messages to transcript, scrubbed response text, audio playback, and listening status', async () => {
    const events: SparkVoiceEvent[] = [];
    const played: Array<{ data: string; mimeType: string }> = [];
    const socket = fakeSocket();
    const session = createSparkRealtimeSession({
      fetchImpl: fakeFetch(),
      createSocket: () => socket,
      baseUrl: 'https://vps/v1',
      apiKey: 'k',
      emit: (e) => events.push(e),
      playAudio: (data, mimeType) => played.push({ data, mimeType }),
    });
    await session.start();
    socket.onopen?.();

    socket.onmessage?.(JSON.stringify({ setupComplete: {} }));
    socket.onmessage?.(JSON.stringify({ serverContent: { inputTranscription: { text: 'hello spark' } } }));
    socket.onmessage?.(JSON.stringify({
      serverContent: {
        modelTurn: {
          parts: [
            { text: 'hi there sk-livesecret0123456789' },
            { inlineData: { data: 'QUJD', mimeType: 'audio/pcm;rate=24000' } },
          ],
        },
      },
    }));
    socket.onmessage?.(JSON.stringify({ serverContent: { turnComplete: true } }));

    const userTurn = events.find((e) => e.kind === 'finalTranscript');
    expect(userTurn).toMatchObject({ entry: { role: 'user', text: 'hello spark' } });

    const sparkTurns = events.filter((e) => e.kind === 'responseText');
    const finalSpark = sparkTurns.find((e) => e.kind === 'responseText' && e.entry.final);
    expect(finalSpark && finalSpark.kind === 'responseText' && finalSpark.entry.role).toBe('spark');
    // Token-like secret scrubbed out of spoken/displayed text.
    expect(finalSpark && finalSpark.kind === 'responseText' && finalSpark.entry.text).not.toContain('sk-livesecret');

    expect(played).toEqual([{ data: 'QUJD', mimeType: 'audio/pcm;rate=24000' }]);
    expect(events.some((e) => e.kind === 'status' && e.status === 'listening')).toBe(true);
  });

  it('dispatches tool calls and sends a tool response back over the socket', async () => {
    const socket = fakeSocket();
    const dispatchTool = vi.fn(async () => ({ ok: true, value: { hits: 1 } }));
    const session = createSparkRealtimeSession({
      fetchImpl: fakeFetch(),
      createSocket: () => socket,
      baseUrl: 'https://vps/v1',
      apiKey: 'k',
      dispatchTool,
      emit: () => undefined,
      playAudio: () => undefined,
    });
    await session.start();
    socket.onopen?.();
    socket.sent.length = 0;

    socket.onmessage?.(JSON.stringify({
      toolCall: { functionCalls: [{ id: 'c1', name: 'recall_memory', args: { q: 'plan' } }] },
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatchTool).toHaveBeenCalledWith('recall_memory', '{"q":"plan"}');
    const toolResponse = socket.sent.map((m) => JSON.parse(m)).find((m) => m.toolResponse);
    expect(toolResponse.toolResponse.functionResponses[0]).toMatchObject({ id: 'c1', name: 'recall_memory' });
  });

  it('stops cleanly, closing the socket and going idle', async () => {
    const events: SparkVoiceEvent[] = [];
    const socket = fakeSocket();
    const session = createSparkRealtimeSession({
      fetchImpl: fakeFetch(),
      createSocket: () => socket,
      baseUrl: 'https://vps/v1',
      apiKey: 'k',
      emit: (e) => events.push(e),
      playAudio: () => undefined,
    });
    await session.start();
    socket.onopen?.();
    session.stop();

    expect(socket.closed).toBe(true);
    expect(session.getStatus()).toBe('idle');
  });
});
