/**
 * Per-role transport adapters (S3a). Each adapter resolves its provider from the
 * S2 credential store (`SparkActiveProviderForRole`) and talks to the real
 * vendor endpoint. The design keeps three concerns separate and individually
 * testable:
 *
 *  1. pure REQUEST BUILDERS  — produce a provider-correct `SparkHttpRequest`
 *     descriptor (url + headers + typed body) with no I/O;
 *  2. pure RESPONSE PARSERS  — turn a raw vendor payload into a normalized result;
 *  3. thin EXECUTORS         — take an injected `fetch` (and the descriptor) and
 *     perform the call, so unit tests use a fake transport with no network.
 *
 * Supported in S3 classic pipeline: STT (OpenAI-compatible /audio/transcriptions
 * + Deepgram prerecorded), LLM (OpenAI-compatible streaming /chat/completions
 * with tool calls), TTS (OpenAI-compatible /audio/speech + ElevenLabs). There is
 * NO hidden fallback: an unsupported provider/role throws a clear error.
 */

import type { SparkActiveProviderForRole } from '../../types/spark-provider.js';

// ---------------------------------------------------------------------------
// Request descriptor + body materialization
// ---------------------------------------------------------------------------

export type SparkRequestBody =
  | { kind: 'json'; json: unknown }
  | { kind: 'raw'; data: Uint8Array; contentType: string }
  | {
      kind: 'multipart';
      fields: Record<string, string>;
      file: { data: Uint8Array; mimeType: string; fileName: string };
    };

export interface SparkHttpRequest {
  url: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body: SparkRequestBody | null;
}

/** A minimal fetch shape so callers can inject Node's global fetch or a fake. */
export type SparkFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  },
) => Promise<SparkFetchResponse>;

export interface SparkFetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array> | null;
}

/**
 * Turn the typed body descriptor into a concrete fetch `body` + any extra
 * headers (e.g. JSON content-type). Multipart deliberately leaves content-type
 * unset so the runtime adds the correct boundary.
 */
export function materializeRequestBody(body: SparkRequestBody | null): {
  body: unknown;
  headers: Record<string, string>;
} {
  if (!body) {
    return { body: undefined, headers: {} };
  }
  switch (body.kind) {
    case 'json':
      return {
        body: JSON.stringify(body.json),
        headers: { 'Content-Type': 'application/json' },
      };
    case 'raw':
      return { body: body.data, headers: { 'Content-Type': body.contentType } };
    case 'multipart': {
      const form = new FormData();
      for (const [key, value] of Object.entries(body.fields)) {
        form.set(key, value);
      }
      const blob = new Blob([body.file.data], { type: body.file.mimeType });
      form.set('file', blob, body.file.fileName);
      return { body: form, headers: {} };
    }
  }
}

// ---------------------------------------------------------------------------
// Auth headers (per provider auth style)
// ---------------------------------------------------------------------------

/** Build the vendor-correct auth headers for a resolved provider. */
export function buildSparkAuthHeaders(active: SparkActiveProviderForRole): Record<string, string> {
  if (active.authStyle === 'none') {
    return {};
  }
  const key = active.getKey();
  if (!key) {
    throw new SparkTransportError(
      `Provider ${active.providerId} (${active.role}) has no configured credential.`,
      'missing_credential',
    );
  }
  if (active.authStyle === 'bearer') {
    return { Authorization: `Bearer ${key}` };
  }
  // apikey — vendor-specific header.
  switch (active.providerId) {
    case 'deepgram':
      return { Authorization: `Token ${key}` };
    case 'elevenlabs':
      return { 'xi-api-key': key };
    case 'gemini':
      return { 'x-goog-api-key': key };
    case 'claude':
      return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    default:
      return { Authorization: `Bearer ${key}` };
  }
}

export type SparkTransportErrorReason =
  | 'missing_credential'
  | 'missing_base_url'
  | 'unsupported_provider'
  | 'http_error'
  | 'empty_response';

export class SparkTransportError extends Error {
  readonly reason: SparkTransportErrorReason;
  readonly status?: number;
  constructor(message: string, reason: SparkTransportErrorReason, status?: number) {
    super(message);
    this.name = 'SparkTransportError';
    this.reason = reason;
    this.status = status;
  }
}

function requireBaseUrl(active: SparkActiveProviderForRole): string {
  if (!active.baseUrl) {
    throw new SparkTransportError(
      `Provider ${active.providerId} (${active.role}) has no base URL configured.`,
      'missing_base_url',
    );
  }
  return active.baseUrl.replace(/\/$/, '');
}

const OPENAI_COMPATIBLE = new Set(['freellmapi', 'openai', 'openrouter', 'ollama']);

// ===========================================================================
// STT
// ===========================================================================

export interface SparkSttAudio {
  data: Uint8Array;
  mimeType: string;
  fileName?: string;
}

export interface SparkSttResult {
  text: string;
  durationMs?: number;
}

/** Build the STT HTTP request for the active provider. */
export function buildSttRequest(
  active: SparkActiveProviderForRole,
  audio: SparkSttAudio,
): SparkHttpRequest {
  const baseUrl = requireBaseUrl(active);
  const headers = buildSparkAuthHeaders(active);

  if (active.providerId === 'deepgram') {
    const model = active.model ?? 'nova-3';
    return {
      url: `${baseUrl}/v1/listen?model=${encodeURIComponent(model)}&smart_format=true`,
      method: 'POST',
      headers,
      body: { kind: 'raw', data: audio.data, contentType: audio.mimeType },
    };
  }

  if (active.providerId === 'freellmapi' || active.providerId === 'openai') {
    return {
      url: `${baseUrl}/audio/transcriptions`,
      method: 'POST',
      headers,
      body: {
        kind: 'multipart',
        fields: { model: active.model ?? 'whisper-1' },
        file: {
          data: audio.data,
          mimeType: audio.mimeType,
          fileName: audio.fileName ?? 'audio.webm',
        },
      },
    };
  }

  throw new SparkTransportError(
    `STT provider ${active.providerId} is not supported in the S3 classic pipeline.`,
    'unsupported_provider',
  );
}

/** Parse a vendor STT response into normalized text. */
export function parseSttResponse(providerId: string, payload: unknown): SparkSttResult {
  if (providerId === 'deepgram') {
    const alt = (payload as DeepgramResponse)?.results?.channels?.[0]?.alternatives?.[0];
    return { text: alt?.transcript ?? '' };
  }
  // OpenAI-compatible: { text }
  const text = (payload as { text?: unknown })?.text;
  return { text: typeof text === 'string' ? text : '' };
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
  };
}

// ===========================================================================
// LLM (OpenAI-compatible streaming chat completions with tool calls)
// ===========================================================================

export interface SparkChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: SparkChatToolCall[];
}

export interface SparkChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface SparkToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface BuildLlmRequestInput {
  messages: SparkChatMessage[];
  tools?: SparkToolDefinition[];
  stream?: boolean;
}

/** Build the streaming chat-completion request for the active LLM provider. */
export function buildLlmRequest(
  active: SparkActiveProviderForRole,
  input: BuildLlmRequestInput,
): SparkHttpRequest {
  if (!OPENAI_COMPATIBLE.has(active.providerId)) {
    throw new SparkTransportError(
      `LLM provider ${active.providerId} needs its native adapter (not in the S3 classic OpenAI-compatible pipeline).`,
      'unsupported_provider',
    );
  }
  const baseUrl = requireBaseUrl(active);
  const headers = buildSparkAuthHeaders(active);
  const json: Record<string, unknown> = {
    model: active.model ?? 'gpt-4o-mini',
    messages: input.messages,
    stream: input.stream ?? true,
  };
  if (input.tools && input.tools.length > 0) {
    json.tools = input.tools;
    json.tool_choice = 'auto';
  }
  return { url: `${baseUrl}/chat/completions`, method: 'POST', headers, body: { kind: 'json', json } };
}

/**
 * Incremental Server-Sent-Events line decoder. Feed it raw response-body string
 * chunks; it returns the completed `data:` payloads (JSON strings or the literal
 * `[DONE]`), buffering partial lines across chunk boundaries.
 */
export class OpenAiSseDecoder {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const payloads: string[] = [];
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.startsWith('data:')) {
        payloads.push(line.slice(5).trim());
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
    return payloads;
  }
}

export interface SparkChatCompletionResult {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}

/**
 * Stateful accumulator for OpenAI-compatible streaming deltas. `pushPayload`
 * returns the incremental text delta (if any) so the caller can stream it to the
 * UI; `result()` returns the assembled text + tool calls.
 */
export class ChatStreamAccumulator {
  private text = '';
  private readonly toolCallsByIndex = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  pushPayload(payload: string): { textDelta?: string } {
    if (payload === '[DONE]' || payload.length === 0) {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return {};
    }
    const delta = (parsed as ChatStreamChunk)?.choices?.[0]?.delta;
    if (!delta) {
      return {};
    }
    let textDelta: string | undefined;
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      this.text += delta.content;
      textDelta = delta.content;
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const index = typeof tc.index === 'number' ? tc.index : 0;
        const existing =
          this.toolCallsByIndex.get(index) ?? { id: '', name: '', arguments: '' };
        if (tc.id) {
          existing.id = tc.id;
        }
        if (tc.function?.name) {
          existing.name += tc.function.name;
        }
        if (tc.function?.arguments) {
          existing.arguments += tc.function.arguments;
        }
        this.toolCallsByIndex.set(index, existing);
      }
    }
    return { textDelta };
  }

  result(): SparkChatCompletionResult {
    const toolCalls = [...this.toolCallsByIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, tc]) => tc)
      .filter((tc) => tc.name.length > 0);
    return { text: this.text, toolCalls };
  }
}

interface ChatStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

// ===========================================================================
// TTS
// ===========================================================================

export interface SparkTtsResult {
  audio: ArrayBuffer;
  mimeType: string;
  durationMs?: number;
}

/** Build the TTS HTTP request for the active provider. */
export function buildTtsRequest(
  active: SparkActiveProviderForRole,
  text: string,
): SparkHttpRequest {
  const baseUrl = requireBaseUrl(active);
  const headers = buildSparkAuthHeaders(active);

  if (active.providerId === 'elevenlabs') {
    const voiceId = active.voiceId ?? 'EXAVITQu4vr4xnSDxMaL';
    return {
      url: `${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      method: 'POST',
      headers: { ...headers, Accept: 'audio/mpeg' },
      body: { kind: 'json', json: { text, model_id: active.model ?? 'eleven_turbo_v2' } },
    };
  }

  if (active.providerId === 'freellmapi' || active.providerId === 'openai') {
    return {
      url: `${baseUrl}/audio/speech`,
      method: 'POST',
      headers,
      body: {
        kind: 'json',
        json: {
          model: active.model ?? 'tts-1',
          input: text,
          voice: active.voiceId ?? 'alloy',
          response_format: 'mp3',
        },
      },
    };
  }

  throw new SparkTransportError(
    `TTS provider ${active.providerId} is not supported in the S3 classic pipeline.`,
    'unsupported_provider',
  );
}

/** Default mime type for a provider's synthesized audio. */
export function ttsMimeType(providerId: string): string {
  return providerId === 'elevenlabs' ? 'audio/mpeg' : 'audio/mpeg';
}

// ===========================================================================
// Realtime (session mint — classic-first, realtime path is secondary)
// ===========================================================================

/** Build a realtime session-mint request (OpenAI-compatible /realtime/sessions). */
export function buildRealtimeSessionRequest(
  active: SparkActiveProviderForRole,
): SparkHttpRequest {
  if (active.providerId === 'freellmapi' || active.providerId === 'openai') {
    const baseUrl = requireBaseUrl(active);
    return {
      url: `${baseUrl}/realtime/sessions`,
      method: 'POST',
      headers: buildSparkAuthHeaders(active),
      body: { kind: 'json', json: { model: active.model ?? 'gpt-4o-realtime-preview' } },
    };
  }
  throw new SparkTransportError(
    `Realtime provider ${active.providerId} is not supported via the OpenAI-compatible session mint (Gemini Live uses a WebSocket path).`,
    'unsupported_provider',
  );
}

// ===========================================================================
// Executors — bind a descriptor + injected fetch into a real call
// ===========================================================================

async function executeRequest(
  req: SparkHttpRequest,
  fetchImpl: SparkFetch,
  signal?: AbortSignal,
): Promise<SparkFetchResponse> {
  const { body, headers: bodyHeaders } = materializeRequestBody(req.body);
  const response = await fetchImpl(req.url, {
    method: req.method,
    headers: { ...req.headers, ...bodyHeaders },
    body,
    signal,
  });
  if (!response.ok) {
    const detail = await safeText(response);
    throw new SparkTransportError(
      `${req.method} ${redactUrl(req.url)} failed: ${response.status} ${response.statusText ?? ''} ${detail}`.trim(),
      'http_error',
      response.status,
    );
  }
  return response;
}

async function safeText(response: SparkFetchResponse): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 200);
  } catch {
    return '';
  }
}

/** Strip query strings (may carry tokens for some vendors) before logging a URL. */
function redactUrl(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : `${url.slice(0, q)}?…`;
}

export interface SparkSttAdapter {
  transcribe: (audio: SparkSttAudio, signal?: AbortSignal) => Promise<SparkSttResult>;
}

export function createSparkSttAdapter(
  active: SparkActiveProviderForRole,
  fetchImpl: SparkFetch,
  now: () => number = () => Date.now(),
): SparkSttAdapter {
  return {
    async transcribe(audio, signal) {
      const started = now();
      const req = buildSttRequest(active, audio);
      const response = await executeRequest(req, fetchImpl, signal);
      const payload = await response.json();
      const result = parseSttResponse(active.providerId, payload);
      return { ...result, durationMs: now() - started };
    },
  };
}

export interface SparkLlmStreamHandlers {
  onTextDelta?: (delta: string) => void;
}

export interface SparkLlmResult extends SparkChatCompletionResult {
  durationMs: number;
}

export interface SparkLlmAdapter {
  streamChat: (
    input: BuildLlmRequestInput,
    handlers?: SparkLlmStreamHandlers,
    signal?: AbortSignal,
  ) => Promise<SparkLlmResult>;
}

export function createSparkLlmAdapter(
  active: SparkActiveProviderForRole,
  fetchImpl: SparkFetch,
  now: () => number = () => Date.now(),
): SparkLlmAdapter {
  return {
    async streamChat(input, handlers, signal) {
      const started = now();
      const req = buildLlmRequest(active, { ...input, stream: true });
      const response = await executeRequest(req, fetchImpl, signal);
      const decoder = new OpenAiSseDecoder();
      const accumulator = new ChatStreamAccumulator();

      const consumePayloads = (payloads: string[]): void => {
        for (const payload of payloads) {
          const { textDelta } = accumulator.pushPayload(payload);
          if (textDelta && handlers?.onTextDelta) {
            handlers.onTextDelta(textDelta);
          }
        }
      };

      if (response.body) {
        const reader = response.body.getReader();
        const textDecoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          consumePayloads(decoder.push(textDecoder.decode(value, { stream: true })));
        }
      } else {
        // Non-streaming transports (or fakes) expose the whole body as text.
        consumePayloads(decoder.push(await response.text()));
      }

      return { ...accumulator.result(), durationMs: now() - started };
    },
  };
}

export interface SparkTtsAdapter {
  synthesize: (text: string, signal?: AbortSignal) => Promise<SparkTtsResult>;
}

export function createSparkTtsAdapter(
  active: SparkActiveProviderForRole,
  fetchImpl: SparkFetch,
  now: () => number = () => Date.now(),
): SparkTtsAdapter {
  return {
    async synthesize(text, signal) {
      const started = now();
      const req = buildTtsRequest(active, text);
      const response = await executeRequest(req, fetchImpl, signal);
      const audio = await response.arrayBuffer();
      if (!audio || audio.byteLength === 0) {
        throw new SparkTransportError('TTS provider returned empty audio.', 'empty_response');
      }
      return { audio, mimeType: ttsMimeType(active.providerId), durationMs: now() - started };
    },
  };
}
