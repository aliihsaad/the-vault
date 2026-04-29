// ============================================================================
// Vault — OpenRouter Enrichment Client
// Provides the EnrichmentClient interface and OpenRouterClient implementation.
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
// OpenRouter Client
// ---------------------------------------------------------------------------

const OPENROUTER_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterClient implements EnrichmentClient {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  isAvailable(): boolean {
    return !!(this.apiKey && this.model);
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    if (!this.isAvailable()) {
      throw new EnrichmentError('OpenRouter client not configured — missing API key or model.');
    }

    const timeoutMs = params.timeoutMs ?? 5000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(OPENROUTER_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://vault-memory.local',
          'X-Title': 'Vault Memory',
        },
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
        throw new EnrichmentError(`OpenRouter API error (${response.status}): ${errorText}`);
      }

      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const text = payload.choices?.[0]?.message?.content?.trim() ?? '';
      if (!text) {
        throw new EnrichmentError('OpenRouter returned an empty response.');
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
        throw new EnrichmentError(`OpenRouter request timed out after ${timeoutMs}ms.`);
      }
      throw new EnrichmentError('OpenRouter request failed.', error);
    } finally {
      clearTimeout(timer);
    }
  }

  async generateImage(params: ImageGenerationParams): Promise<ImageGenerationResult> {
    if (!this.isAvailable()) {
      throw new EnrichmentError('OpenRouter client not configured — missing API key or model.');
    }

    const prompt = params.prompt.trim();
    if (!prompt) {
      throw new EnrichmentError('OpenRouter image prompt is required.');
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
      const response = await fetch(OPENROUTER_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://vault-memory.local',
          'X-Title': 'Vault Memory',
        },
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
        throw new EnrichmentError(`OpenRouter API error (${response.status}): ${errorText}`);
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
        throw new EnrichmentError('OpenRouter returned no generated images.');
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
        throw new EnrichmentError(`OpenRouter request timed out after ${timeoutMs}ms.`);
      }
      throw new EnrichmentError('OpenRouter image generation request failed.', error);
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractMimeTypeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;]+);base64,/i.exec(dataUrl);
  return match?.[1] || 'image/png';
}
