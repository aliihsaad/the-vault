import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAICompatibleClient,
  OpenRouterClient,
  createProviderClient,
  normalizeProviderBaseUrl,
} from './services/openrouter-client.js';

describe('AI provider clients', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes user-supplied base URLs to the API root', () => {
    expect(normalizeProviderBaseUrl('http://localhost:3000/v1')).toBe('http://localhost:3000/v1');
    expect(normalizeProviderBaseUrl('http://localhost:3000/v1/')).toBe('http://localhost:3000/v1');
    expect(normalizeProviderBaseUrl('  http://localhost:3000/v1//  ')).toBe('http://localhost:3000/v1');
    expect(normalizeProviderBaseUrl('http://hub.local/v1/chat/completions')).toBe('http://hub.local/v1');
    expect(normalizeProviderBaseUrl('http://hub.local/v1/models')).toBe('http://hub.local/v1');
  });

  it('sends completions to the configured base URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'hello from the hub' } }],
      model: 'hub/test-model',
      usage: { prompt_tokens: 5, completion_tokens: 7 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleClient({
      baseUrl: 'http://localhost:3000/v1/',
      apiKey: 'hub-key',
      model: 'hub/test-model',
      providerLabel: 'LLM-Hub',
    });

    const result = await client.complete({
      systemPrompt: 'system',
      userPrompt: 'user',
      timeoutMs: 5000,
    });

    expect(result.text).toBe('hello from the hub');
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer hub-key');
  });

  it('lists models from the OpenAI-compatible /models endpoint', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      data: [
        { id: 'zeta/model', name: 'Zeta' },
        { id: 'alpha/model', context_length: 32000, pricing: { prompt: '0', completion: '0' } },
        { name: 'missing-id-should-be-dropped' },
      ],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleClient({
      baseUrl: 'http://localhost:3000/v1',
      apiKey: 'hub-key',
      model: '',
      providerLabel: 'LLM-Hub',
    });

    const models = await client.listModels();

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/v1/models');
    expect(models).toEqual([
      { id: 'alpha/model', name: 'alpha/model', contextLength: 32000, promptPrice: '0', completionPrice: '0' },
      { id: 'zeta/model', name: 'Zeta', contextLength: null, promptPrice: null, completionPrice: null },
    ]);
  });

  it('surfaces provider-labelled errors on failed requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));

    const client = new OpenAICompatibleClient({
      baseUrl: 'http://localhost:3000/v1',
      apiKey: 'bad-key',
      model: 'hub/test-model',
      providerLabel: 'LLM-Hub',
    });

    await expect(client.complete({ systemPrompt: 's', userPrompt: 'u' }))
      .rejects.toThrow(/LLM-Hub API error \(401\)/);
  });

  it('createProviderClient routes llm-hub to the configured base URL and openrouter to its fixed one', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const hubClient = createProviderClient(
      { provider: 'llm-hub', apiKey: 'k', baseUrl: 'http://hub.local/v1' },
      'hub/model',
    );
    await hubClient.complete({ systemPrompt: 's', userPrompt: 'u' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://hub.local/v1/chat/completions');

    const openRouterClient = createProviderClient({ provider: 'openrouter', apiKey: 'k' }, 'or/model');
    expect(openRouterClient).toBeInstanceOf(OpenRouterClient);
    await openRouterClient.complete({ systemPrompt: 's', userPrompt: 'u' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('llm-hub client reports unavailable without a base URL', () => {
    const client = createProviderClient({ provider: 'llm-hub', apiKey: 'k' }, 'hub/model');
    expect(client.isAvailable()).toBe(false);
  });
});
