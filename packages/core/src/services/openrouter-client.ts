// ============================================================================
// Vault — AI Provider Clients
// Provides the EnrichmentClient interface, a generic OpenAI-compatible
// client (configurable base URL — used for LLM-Hub and similar providers),
// and the OpenRouterClient specialization with its fixed base URL.
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompletionParams {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  /** Timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface ImageGenerationParams {
  prompt: string;
  modalities?: string[];
  aspectRatio?: string;
  imageSize?: string;
  timeoutMs?: number;
}

export interface GeneratedImage {
  dataUrl: string;
  mimeType: string;
}

export interface ImageGenerationResult {
  text: string;
  model: string;
  images: GeneratedImage[];
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface EnrichmentClient {
  complete(params: CompletionParams): Promise<CompletionResult>;
  isAvailable(): boolean;
}

export class EnrichmentError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EnrichmentError';
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible Client (configurable base URL)
// ---------------------------------------------------------------------------

export interface ProviderModelSummary {
  id: string;
  name: string;
  contextLength: number | null;
  promptPrice: string | null;
  completionPrice: string | null;
}

export interface OpenAICompatibleClientOptions {
  /** OpenAI-compatible API root, e.g. "http://localhost:3000/v1". */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Human-readable provider name used in error messages. */
  providerLabel?: string;
  extraHeaders?: Record<string, string>;
}

/**
 * Normalize a user-supplied base URL to the API root: trims whitespace and
 * trailing slashes, and strips accidental endpoint suffixes so both
 * "http://host/v1" and "http://host/v1/chat/completions" work.
 */
export function normalizeProviderBaseUrl(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '');
}

export class OpenAICompatibleClient implements EnrichmentClient {
  protected readonly baseUrl: string;
  protected readonly apiKey: string;
  protected readonly model: string;
  protected readonly providerLabel: string;
  protected readonly extraHeaders: Record<string, string>;

  constructor(options: OpenAICompatibleClientOptions) {
    this.baseUrl = normalizeProviderBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.providerLabel = options.providerLabel ?? 'AI provider';
    this.extraHeaders = options.extraHeaders ?? {};
  }

  isAvailable(): boolean {
    return !!(this.baseUrl && this.apiKey && this.model);
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    if (!this.isAvailable()) {
      throw new EnrichmentError(`${this.providerLabel} client not configured — missing base URL, API key, or model.`);
    }

    const timeoutMs = params.timeoutMs ?? 5000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: params.userPrompt },
          ],
          max_tokens: params.maxTokens ?? 300,
          temperature: params.temperature ?? 0.3,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new EnrichmentError(`${this.providerLabel} API error (${response.status}): ${errorText}`);
      }

      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const text = payload.choices?.[0]?.message?.content?.trim() ?? '';
      if (!text) {
        throw new EnrichmentError(`${this.providerLabel} returned an empty response.`);
      }

      return {
        text,
        model: payload.model ?? this.model,
        usage: {
          promptTokens: payload.usage?.prompt_tokens ?? 0,
          completionTokens: payload.usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof EnrichmentError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new EnrichmentError(`${this.providerLabel} request timed out after ${timeoutMs}ms.`);
      }
      throw new EnrichmentError(`${this.providerLabel} request failed.`, error);
    } finally {
      clearTimeout(timer);
    }
  }

  async generateImage(params: ImageGenerationParams): Promise<ImageGenerationResult> {
    if (!this.isAvailable()) {
      throw new EnrichmentError(`${this.providerLabel} client not configured — missing base URL, API key, or model.`);
    }

    const prompt = params.prompt.trim();
    if (!prompt) {
      throw new EnrichmentError(`${this.providerLabel} image prompt is required.`);
    }

    const timeoutMs = params.timeoutMs ?? 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const imageConfig: Record<string, string> = {};

    if (params.aspectRatio?.trim()) {
      imageConfig.aspect_ratio = params.aspectRatio.trim();
    }

    if (params.imageSize?.trim()) {
      imageConfig.image_size = params.imageSize.trim();
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'user', content: prompt },
          ],
          modalities: params.modalities?.length ? params.modalities : ['image', 'text'],
          stream: false,
          ...(Object.keys(imageConfig).length > 0 ? { image_config: imageConfig } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new EnrichmentError(`${this.providerLabel} API error (${response.status}): ${errorText}`);
      }

      const payload = await response.json() as {
        choices?: Array<{
          message?: {
            content?: string;
            images?: Array<{
              image_url?: { url?: string };
              imageUrl?: { url?: string };
            }>;
          };
        }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const message = payload.choices?.[0]?.message;
      const images = (message?.images || [])
        .map((image) => image.image_url?.url || image.imageUrl?.url || '')
        .filter((value): value is string => Boolean(value))
        .map((dataUrl) => ({
          dataUrl,
          mimeType: extractMimeTypeFromDataUrl(dataUrl),
        }));

      if (images.length === 0) {
        throw new EnrichmentError(`${this.providerLabel} returned no generated images.`);
      }

      return {
        text: message?.content?.trim() || `Generated ${images.length} image${images.length === 1 ? '' : 's'}.`,
        model: payload.model ?? this.model,
        images,
        usage: {
          promptTokens: payload.usage?.prompt_tokens ?? 0,
          completionTokens: payload.usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof EnrichmentError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new EnrichmentError(`${this.providerLabel} request timed out after ${timeoutMs}ms.`);
      }
      throw new EnrichmentError(`${this.providerLabel} image generation request failed.`, error);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * List available models via the OpenAI-compatible GET /models endpoint.
   * Requires only baseUrl + apiKey (model selection may not have happened yet).
   */
  async listModels(timeoutMs: number = 15000): Promise<ProviderModelSummary[]> {
    if (!this.baseUrl || !this.apiKey) {
      throw new EnrichmentError(`${this.providerLabel} client not configured — missing base URL or API key.`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json',
          ...this.extraHeaders,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new EnrichmentError(`${this.providerLabel} API error (${response.status}): ${errorText}`);
      }

      const payload = await response.json() as {
        data?: Array<{
          id?: string;
          name?: string;
          context_length?: number;
          pricing?: { prompt?: string; completion?: string };
        }>;
      };

      return (payload.data || [])
        .filter((model): model is { id: string } & typeof model => typeof model.id === 'string' && model.id.length > 0)
        .map((model) => ({
          id: model.id,
          name: model.name || model.id,
          contextLength: model.context_length ?? null,
          promptPrice: model.pricing?.prompt ?? null,
          completionPrice: model.pricing?.completion ?? null,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      if (error instanceof EnrichmentError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new EnrichmentError(`${this.providerLabel} model list request timed out after ${timeoutMs}ms.`);
      }
      throw new EnrichmentError(`${this.providerLabel} model list request failed.`, error);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// OpenRouter Client (fixed base URL specialization)
// ---------------------------------------------------------------------------

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export class OpenRouterClient extends OpenAICompatibleClient {
  constructor(apiKey: string, model: string) {
    super({
      baseUrl: OPENROUTER_BASE_URL,
      apiKey,
      model,
      providerLabel: 'OpenRouter',
      extraHeaders: {
        'HTTP-Referer': 'https://vault-memory.local',
        'X-Title': 'Vault Memory',
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Provider configuration + client factory
// ---------------------------------------------------------------------------

export type AiProviderId = 'openrouter' | 'llm-hub';

export const AI_PROVIDER_IDS: AiProviderId[] = ['openrouter', 'llm-hub'];

export interface AiProviderConfig {
  provider: AiProviderId;
  apiKey: string;
  /** Required for providers without a fixed base URL (LLM-Hub). */
  baseUrl?: string;
}

/**
 * The ordered provider setup: one primary provider and an optional fallback
 * that is tried when the primary fails or is not configured.
 */
export interface AiProviderChain {
  primary: AiProviderConfig;
  fallback: AiProviderConfig | null;
}

/** True when a provider config has everything it needs to make requests. */
export function isProviderConfigUsable(config: AiProviderConfig | null | undefined): config is AiProviderConfig {
  if (!config || !config.apiKey.trim()) return false;
  if (config.provider === 'llm-hub' && !config.baseUrl?.trim()) return false;
  return true;
}

/**
 * Create the right client for a provider config. OpenRouter keeps its fixed
 * base URL; LLM-Hub (and any OpenAI-compatible hub) uses the configured one.
 */
export function createProviderClient(config: AiProviderConfig, model: string): OpenAICompatibleClient {
  if (config.provider === 'llm-hub') {
    return new OpenAICompatibleClient({
      baseUrl: config.baseUrl ?? '',
      apiKey: config.apiKey,
      model,
      providerLabel: 'LLM-Hub',
    });
  }

  return new OpenRouterClient(config.apiKey, model);
}

/**
 * Enrichment client that tries the primary provider first and fails over to
 * the fallback provider (each with its own model) when the primary is
 * unavailable or errors.
 */
export class FailoverEnrichmentClient implements EnrichmentClient {
  constructor(
    private readonly primary: EnrichmentClient,
    private readonly fallback: EnrichmentClient | null = null,
  ) {}

  isAvailable(): boolean {
    return this.primary.isAvailable() || Boolean(this.fallback?.isAvailable());
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    if (this.primary.isAvailable()) {
      try {
        return await this.primary.complete(params);
      } catch (error) {
        if (!this.fallback?.isAvailable()) {
          throw error;
        }
      }
    }

    if (this.fallback?.isAvailable()) {
      return this.fallback.complete(params);
    }

    throw new EnrichmentError('No configured AI provider is available for enrichment.');
  }
}

function extractMimeTypeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;]+);base64,/i.exec(dataUrl);
  return match?.[1] || 'image/png';
}
