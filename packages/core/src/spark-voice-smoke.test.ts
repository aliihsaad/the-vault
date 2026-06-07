import { describe, expect, it } from 'vitest';

import { createSparkLlmAdapter, type SparkFetch } from './services/spark-voice/spark-voice-transports.js';
import type { SparkActiveProviderForRole } from './types/spark-provider.js';

/**
 * Guarded integration smoke against a live FreeLLMAPI-compatible VPS.
 *
 * Skipped unless BOTH env vars are set, so CI and offline runs never hit the
 * network:
 *   SPARK_SMOKE_FREELLMAPI_BASE_URL  e.g. https://your-vps/v1
 *   SPARK_SMOKE_FREELLMAPI_KEY       bearer key
 * Optional: SPARK_SMOKE_FREELLMAPI_MODEL (defaults to gpt-4o-mini).
 */
const baseUrl = process.env.SPARK_SMOKE_FREELLMAPI_BASE_URL;
const key = process.env.SPARK_SMOKE_FREELLMAPI_KEY;
const model = process.env.SPARK_SMOKE_FREELLMAPI_MODEL ?? 'gpt-4o-mini';
const configured = Boolean(baseUrl && key);

const nodeFetch: SparkFetch = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body as RequestInit['body'],
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

describe.skipIf(!configured)('FreeLLMAPI live smoke (guarded)', () => {
  it('streams a chat completion from the configured VPS', async () => {
    const active: SparkActiveProviderForRole = {
      role: 'LLM',
      providerId: 'freellmapi',
      baseUrl: baseUrl!,
      model,
      voiceId: null,
      authStyle: 'bearer',
      getKey: () => key!,
    };
    const adapter = createSparkLlmAdapter(active, nodeFetch);
    const deltas: string[] = [];
    const result = await adapter.streamChat(
      { messages: [{ role: 'user', content: 'Reply with exactly: pong' }] },
      { onTextDelta: (d) => deltas.push(d) },
    );
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  }, 30000);
});

describe('FreeLLMAPI smoke guard', () => {
  it('documents how to enable the live smoke', () => {
    // Always-on assertion so the suite is never empty; the real call is gated above.
    expect(typeof configured).toBe('boolean');
  });
});
