import { describe, expect, it, vi } from 'vitest';

import type { SparkActiveProviderForRole, SparkProviderRole } from './types/spark-provider.js';
import {
  buildLlmRequest,
  buildRealtimeSessionRequest,
  buildSparkAuthHeaders,
  buildSttRequest,
  buildTtsRequest,
  ChatStreamAccumulator,
  createSparkLlmAdapter,
  createSparkSttAdapter,
  createSparkTtsAdapter,
  materializeRequestBody,
  OpenAiSseDecoder,
  parseSttResponse,
  SparkTransportError,
  type SparkFetch,
  type SparkFetchResponse,
} from './services/spark-voice/spark-voice-transports.js';

function active(partial: Partial<SparkActiveProviderForRole> = {}): SparkActiveProviderForRole {
  return {
    role: 'LLM' as SparkProviderRole,
    providerId: 'freellmapi',
    baseUrl: 'https://vps.example.com/v1',
    model: 'gpt-4o-mini',
    voiceId: null,
    authStyle: 'bearer',
    getKey: () => 'sk-test-key-1234567890',
    ...partial,
  };
}

function streamingResponse(chunks: string[]): SparkFetchResponse {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
      }
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    body,
    text: async () => chunks.join(''),
    json: async () => JSON.parse(chunks.join('')),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function jsonResponse(payload: unknown): SparkFetchResponse {
  return {
    ok: true,
    status: 200,
    body: null,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe('buildSparkAuthHeaders', () => {
  it('uses Bearer for bearer providers', () => {
    expect(buildSparkAuthHeaders(active())).toEqual({ Authorization: 'Bearer sk-test-key-1234567890' });
  });

  it('uses vendor-specific headers for apikey providers', () => {
    expect(buildSparkAuthHeaders(active({ providerId: 'deepgram', authStyle: 'apikey', role: 'STT' })))
      .toEqual({ Authorization: 'Token sk-test-key-1234567890' });
    expect(buildSparkAuthHeaders(active({ providerId: 'elevenlabs', authStyle: 'apikey', role: 'TTS' })))
      .toEqual({ 'xi-api-key': 'sk-test-key-1234567890' });
    expect(buildSparkAuthHeaders(active({ providerId: 'gemini', authStyle: 'apikey' })))
      .toEqual({ 'x-goog-api-key': 'sk-test-key-1234567890' });
  });

  it('emits no auth header for no-auth providers', () => {
    expect(buildSparkAuthHeaders(active({ providerId: 'ollama', authStyle: 'none' }))).toEqual({});
  });

  it('throws a clear error when a credential is required but missing', () => {
    expect(() => buildSparkAuthHeaders(active({ getKey: () => '' }))).toThrow(SparkTransportError);
  });
});

describe('STT request building + parsing', () => {
  it('builds a multipart transcription request for OpenAI-compatible providers', () => {
    const req = buildSttRequest(active({ role: 'STT', model: 'whisper-1' }), {
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/webm',
    });
    expect(req.url).toBe('https://vps.example.com/v1/audio/transcriptions');
    expect(req.headers.Authorization).toContain('Bearer');
    expect(req.body?.kind).toBe('multipart');
    if (req.body?.kind === 'multipart') {
      expect(req.body.fields.model).toBe('whisper-1');
      expect(req.body.file.mimeType).toBe('audio/webm');
    }
  });

  it('builds a raw Deepgram listen request with a Token header', () => {
    const req = buildSttRequest(
      active({ providerId: 'deepgram', authStyle: 'apikey', role: 'STT', baseUrl: 'https://api.deepgram.com', model: 'nova-2' }),
      { data: new Uint8Array([9]), mimeType: 'audio/wav' },
    );
    expect(req.url).toContain('https://api.deepgram.com/v1/listen?model=nova-2');
    expect(req.headers.Authorization).toBe('Token sk-test-key-1234567890');
    expect(req.body?.kind).toBe('raw');
  });

  it('throws for unsupported STT providers (no hidden fallback)', () => {
    expect(() =>
      buildSttRequest(active({ providerId: 'claude', authStyle: 'apikey', role: 'STT' }), {
        data: new Uint8Array(),
        mimeType: 'audio/webm',
      }),
    ).toThrow(/not supported/);
  });

  it('parses OpenAI and Deepgram transcript shapes', () => {
    expect(parseSttResponse('freellmapi', { text: 'hello world' })).toEqual({ text: 'hello world' });
    expect(
      parseSttResponse('deepgram', {
        results: { channels: [{ alternatives: [{ transcript: 'deep transcript' }] }] },
      }),
    ).toEqual({ text: 'deep transcript' });
  });

  it('transcribe() executes via injected fetch and reports durationMs', async () => {
    const fetchImpl = vi.fn<SparkFetch>(async () => jsonResponse({ text: 'transcribed' }));
    let clock = 1000;
    const adapter = createSparkSttAdapter(active({ role: 'STT' }), fetchImpl, () => (clock += 5));
    const result = await adapter.transcribe({ data: new Uint8Array([1]), mimeType: 'audio/webm' });
    expect(result.text).toBe('transcribed');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('LLM request building + SSE streaming', () => {
  it('builds an OpenAI-compatible streaming chat request with tools', () => {
    const req = buildLlmRequest(active(), {
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'recall', parameters: {} } }],
    });
    expect(req.url).toBe('https://vps.example.com/v1/chat/completions');
    expect(req.body?.kind).toBe('json');
    if (req.body?.kind === 'json') {
      const json = req.body.json as Record<string, unknown>;
      expect(json.stream).toBe(true);
      expect(json.tool_choice).toBe('auto');
      expect(Array.isArray(json.tools)).toBe(true);
    }
  });

  it('throws for non-OpenAI-compatible LLM providers', () => {
    expect(() => buildLlmRequest(active({ providerId: 'claude' }), { messages: [] })).toThrow(
      /native adapter/,
    );
  });

  it('decodes SSE data lines across chunk boundaries', () => {
    const decoder = new OpenAiSseDecoder();
    const a = decoder.push('data: {"a":1}\n\ndata: {"b":');
    expect(a).toEqual(['{"a":1}']);
    const b = decoder.push('2}\n\ndata: [DONE]\n\n');
    expect(b).toEqual(['{"b":2}', '[DONE]']);
  });

  it('accumulates streamed text and index-split tool-call arguments', () => {
    const acc = new ChatStreamAccumulator();
    acc.pushPayload(JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }));
    acc.pushPayload(JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }));
    acc.pushPayload(
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'recall' } }] } }],
      }),
    );
    acc.pushPayload(
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] } }] }),
    );
    acc.pushPayload(
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] } }] }),
    );
    acc.pushPayload('[DONE]');
    const result = acc.result();
    expect(result.text).toBe('Hello');
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'recall', arguments: '{"q":"hi"}' }]);
  });

  it('streamChat() streams text deltas and returns the assembled result', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hi "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"there"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchImpl = vi.fn<SparkFetch>(async () => streamingResponse(chunks));
    const adapter = createSparkLlmAdapter(active(), fetchImpl);
    const deltas: string[] = [];
    const result = await adapter.streamChat(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onTextDelta: (d) => deltas.push(d) },
    );
    expect(deltas).toEqual(['Hi ', 'there']);
    expect(result.text).toBe('Hi there');
    expect(result.toolCalls).toEqual([]);
  });
});

describe('TTS request building + execution', () => {
  it('builds an OpenAI-compatible speech request', () => {
    const req = buildTtsRequest(active({ role: 'TTS', voiceId: 'alloy' }), 'hello');
    expect(req.url).toBe('https://vps.example.com/v1/audio/speech');
    if (req.body?.kind === 'json') {
      const json = req.body.json as Record<string, unknown>;
      expect(json.input).toBe('hello');
      expect(json.voice).toBe('alloy');
    }
  });

  it('builds an ElevenLabs request with the voice id in the path + xi-api-key header', () => {
    const req = buildTtsRequest(
      active({ providerId: 'elevenlabs', authStyle: 'apikey', role: 'TTS', baseUrl: 'https://api.elevenlabs.io', voiceId: 'voice123' }),
      'speak this',
    );
    expect(req.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice123');
    expect(req.headers['xi-api-key']).toBe('sk-test-key-1234567890');
  });

  it('synthesize() returns audio bytes and rejects empty audio', async () => {
    const audio = new TextEncoder().encode('FAKEMP3').buffer;
    const okFetch = vi.fn<SparkFetch>(async () => ({
      ok: true,
      status: 200,
      body: null,
      text: async () => '',
      json: async () => ({}),
      arrayBuffer: async () => audio,
    }));
    const adapter = createSparkTtsAdapter(active({ role: 'TTS' }), okFetch);
    const result = await adapter.synthesize('hello');
    expect(result.audio.byteLength).toBeGreaterThan(0);
    expect(result.mimeType).toContain('audio/');

    const emptyFetch = vi.fn<SparkFetch>(async () => ({
      ok: true,
      status: 200,
      body: null,
      text: async () => '',
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    await expect(createSparkTtsAdapter(active({ role: 'TTS' }), emptyFetch).synthesize('x')).rejects.toThrow(
      /empty audio/,
    );
  });
});

describe('error + realtime + body materialization', () => {
  it('surfaces HTTP errors with status', async () => {
    const fetchImpl = vi.fn<SparkFetch>(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      body: null,
      text: async () => 'bad key',
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    await expect(
      createSparkSttAdapter(active({ role: 'STT' }), fetchImpl).transcribe({
        data: new Uint8Array([1]),
        mimeType: 'audio/webm',
      }),
    ).rejects.toMatchObject({ reason: 'http_error', status: 401 });
  });

  it('builds an OpenAI-compatible realtime session mint request', () => {
    const req = buildRealtimeSessionRequest(active({ role: 'Realtime' }));
    expect(req.url).toBe('https://vps.example.com/v1/realtime/sessions');
  });

  it('materializes json and multipart bodies', () => {
    const json = materializeRequestBody({ kind: 'json', json: { a: 1 } });
    expect(json.headers['Content-Type']).toBe('application/json');
    expect(json.body).toBe('{"a":1}');

    const multipart = materializeRequestBody({
      kind: 'multipart',
      fields: { model: 'whisper-1' },
      file: { data: new Uint8Array([1]), mimeType: 'audio/webm', fileName: 'a.webm' },
    });
    expect(multipart.body).toBeInstanceOf(FormData);
  });
});
