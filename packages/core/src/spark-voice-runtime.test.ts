import { describe, expect, it, vi } from 'vitest';

import { createSparkProviderCredentialStore } from './services/spark-provider-credentials.js';
import {
  buildSparkVoiceReadiness,
  createSparkVoiceRuntimeSession,
} from './services/spark-voice/spark-voice-runtime.js';
import type { SparkFetch, SparkFetchResponse } from './services/spark-voice/spark-voice-transports.js';
import type { SparkVoiceEvent } from './types/spark-voice.js';

function makeStore() {
  const secrets = new Map<string, string>();
  const settings = new Map<string, unknown>();
  return createSparkProviderCredentialStore({
    getSecret: (k) => secrets.get(k) ?? '',
    setSecret: (k, v) => void secrets.set(k, v),
    getSetting: (k) => settings.get(k),
    setSetting: (k, v) => void settings.set(k, v),
    now: () => '2026-06-07T00:00:00.000Z',
  });
}

function streamingResponse(chunks: string[]): SparkFetchResponse {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    }),
    text: async () => chunks.join(''),
    json: async () => JSON.parse(chunks.join('')),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe('buildSparkVoiceReadiness', () => {
  it('reports not-ready until STT, LLM, and TTS providers are configured', () => {
    const store = makeStore();
    const before = buildSparkVoiceReadiness(store);
    expect(before.ready).toBe(false);
    expect(before.missing.sort()).toEqual(['LLM', 'STT', 'TTS']);

    // FreeLLMAPI is the default for every role — configuring it satisfies all.
    store.setProviderCredential('freellmapi', 'sk-vps-key-1234567890', 'https://vps.example.com/v1');
    const after = buildSparkVoiceReadiness(store);
    expect(after.ready).toBe(true);
    expect(after.missing).toEqual([]);
    expect(after.roles.every((r) => r.providerId === 'freellmapi' && r.configured)).toBe(true);
  });

  it('reports the specific missing role for a split assignment', () => {
    const store = makeStore();
    store.setProviderCredential('deepgram', 'dg-key-1234567890');
    store.setRoleAssignment('STT', 'deepgram');
    // LLM + TTS still default to unconfigured freellmapi.
    const readiness = buildSparkVoiceReadiness(store);
    expect(readiness.roles.find((r) => r.role === 'STT')).toMatchObject({
      providerId: 'deepgram',
      configured: true,
    });
    expect(readiness.missing.sort()).toEqual(['LLM', 'TTS']);
  });
});

describe('createSparkVoiceRuntimeSession', () => {
  it('resolves per-role providers from the credential store and runs a text turn', async () => {
    const store = makeStore();
    store.setProviderCredential('freellmapi', 'sk-vps-key-1234567890', 'https://vps.example.com/v1');

    const seenUrls: string[] = [];
    const fetchImpl = vi.fn<SparkFetch>(async (url) => {
      seenUrls.push(url);
      if (url.includes('/chat/completions')) {
        return streamingResponse([
          'data: {"choices":[{"delta":{"content":"Hello!"}}]}\n\n',
          'data: [DONE]\n\n',
        ]);
      }
      // TTS audio
      return {
        ok: true,
        status: 200,
        body: null,
        text: async () => '',
        json: async () => ({}),
        arrayBuffer: async () => new TextEncoder().encode('AUDIO').buffer,
      };
    });

    const events: SparkVoiceEvent[] = [];
    const play = vi.fn();
    const session = createSparkVoiceRuntimeSession({
      credentials: store,
      fetchImpl,
      audioOutput: { play, stop: vi.fn() },
      emit: (e) => events.push(e),
    });

    session.start();
    await session.sendText('hi');

    // LLM hit the FreeLLMAPI base URL resolved from the store.
    expect(seenUrls.some((u) => u === 'https://vps.example.com/v1/chat/completions')).toBe(true);
    // TTS produced audio that was played.
    expect(play).toHaveBeenCalledOnce();
    const final = events.find((e) => e.kind === 'responseText' && e.entry.final);
    expect(final).toMatchObject({ entry: { role: 'spark', text: 'Hello!' } });
  });
});
