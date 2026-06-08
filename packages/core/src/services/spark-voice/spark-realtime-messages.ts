/**
 * Spark realtime protocol (S5+). FreeLLMAPI exposes a Gemini-Live-style realtime
 * WebSocket: the client mints a session, opens the socket, sends a `setup`
 * message, then streams raw 16kHz PCM as `realtimeInput.mediaChunks`. The server
 * streams back `serverContent` (model text + 24kHz PCM `inlineData`), input/
 * output transcriptions, `toolCall`s, and `turnComplete`/`setupComplete` flags.
 *
 * These builders + the server-message summarizer are pure and self-contained so
 * the realtime client can be unit-tested with a fake socket — no network. Ported
 * from the proven whispry realtime client.
 */

export interface SparkRealtimeToolDefinition {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface SparkRealtimeToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface SparkRealtimeToolResponse {
  id: string;
  name: string;
  result: string;
}

export interface SparkRealtimeAudioChunk {
  data: string;
  mimeType: string;
}

export interface SparkRealtimeServerSummary {
  text: string;
  inputTranscription?: string;
  outputTranscription?: string;
  audioChunks: SparkRealtimeAudioChunk[];
  toolCalls: SparkRealtimeToolCall[];
  interrupted: boolean;
  turnComplete: boolean;
  setupComplete: boolean;
}

export interface SparkRealtimeSetupOptions {
  model: string;
  responseModalities?: string[];
  temperature?: number;
  instructions?: string;
  voice?: string;
  inputAudioTranscription?: boolean;
  outputAudioTranscription?: boolean;
  tools?: SparkRealtimeToolDefinition[];
}

type JsonRecord = Record<string, unknown>;

const DEFAULT_OUTPUT_AUDIO_MIME_TYPE = 'audio/pcm;rate=24000';

export function createSparkRealtimeSetupMessage(options: SparkRealtimeSetupOptions): JsonRecord {
  const responseModalities =
    options.responseModalities && options.responseModalities.length > 0
      ? options.responseModalities
      : ['AUDIO'];
  const generationConfig: JsonRecord = { responseModalities };

  if (typeof options.temperature === 'number') {
    generationConfig.temperature = options.temperature;
  }

  const voice = cleanString(options.voice);
  if (voice && modalitiesIncludeAudio(responseModalities)) {
    generationConfig.speechConfig = {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
    };
  }

  const setup: JsonRecord = {
    model: normalizeRealtimeModel(options.model),
    generationConfig,
  };

  const instructions = cleanString(options.instructions);
  if (instructions) {
    setup.systemInstruction = { parts: [{ text: instructions }] };
  }
  if (options.inputAudioTranscription) {
    setup.inputAudioTranscription = {};
  }
  if (options.outputAudioTranscription) {
    setup.outputAudioTranscription = {};
  }

  const functionDeclarations = toolFunctionDeclarations(options.tools);
  if (functionDeclarations.length > 0) {
    setup.tools = [{ functionDeclarations }];
  }

  return { setup };
}

export function createSparkRealtimeAudioInputMessage(data: string, sampleRate = 16000): JsonRecord {
  return {
    realtimeInput: {
      mediaChunks: [{ data, mimeType: `audio/pcm;rate=${sampleRate}` }],
    },
  };
}

export function createSparkRealtimeAudioStreamEndMessage(): JsonRecord {
  return { realtimeInput: { audioStreamEnd: true } };
}

export function createSparkRealtimeToolResponseMessage(
  responses: SparkRealtimeToolResponse[],
): JsonRecord {
  return {
    toolResponse: {
      functionResponses: responses.map((response) => ({
        id: response.id,
        name: response.name,
        response: { result: response.result },
      })),
    },
  };
}

export function summarizeSparkRealtimeServerMessage(message: unknown): SparkRealtimeServerSummary {
  const root = asRecord(message);
  const serverContent = getRecord(root, 'serverContent', 'server_content');
  const content = serverContent ?? root;
  const parts = collectParts(root, content);

  const textParts = parts.map(partText).filter((text) => text.length > 0);
  if (textParts.length === 0) {
    const directText = firstCleanString(getValue(content, 'text', 'text'), getValue(root, 'text', 'text'));
    if (directText) {
      textParts.push(directText);
    }
  }

  const inputTranscription = firstCleanString(
    transcriptText(getValue(content, 'inputTranscription', 'input_transcription')),
    transcriptText(getValue(root, 'inputTranscription', 'input_transcription')),
    transcriptText(getValue(content, 'inputAudioTranscription', 'input_audio_transcription')),
  );
  const outputTranscription = firstCleanString(
    transcriptText(getValue(content, 'outputTranscription', 'output_transcription')),
    transcriptText(getValue(root, 'outputTranscription', 'output_transcription')),
    transcriptText(getValue(content, 'outputAudioTranscription', 'output_audio_transcription')),
  );

  return {
    text: textParts.join(''),
    inputTranscription: inputTranscription || undefined,
    outputTranscription: outputTranscription || undefined,
    audioChunks: parts.flatMap(partAudioChunks),
    toolCalls: collectToolCalls(root, content, parts),
    interrupted: booleanValue(
      getValue(content, 'interrupted', 'interrupted'),
      getValue(root, 'interrupted', 'interrupted'),
    ),
    turnComplete: booleanValue(
      getValue(content, 'turnComplete', 'turn_complete'),
      getValue(root, 'turnComplete', 'turn_complete'),
    ),
    setupComplete: presenceFlag(
      getValue(root, 'setupComplete', 'setup_complete'),
      getValue(content, 'setupComplete', 'setup_complete'),
    ),
  };
}

function normalizeRealtimeModel(model: string): string {
  const cleaned = cleanString(model) || 'auto';
  return cleaned.startsWith('models/') ? cleaned : `models/${cleaned}`;
}

function modalitiesIncludeAudio(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === 'string' && item.toUpperCase() === 'AUDIO');
}

function toolFunctionDeclarations(tools: SparkRealtimeToolDefinition[] | undefined): JsonRecord[] {
  if (!tools || tools.length === 0) {
    return [];
  }
  return tools
    .map((tool) => {
      const name = cleanString(tool.name);
      if (!name) {
        return null;
      }
      const declaration: JsonRecord = { name };
      const description = cleanString(tool.description);
      if (description) {
        declaration.description = description;
      }
      // Gemini-Live validates functionDeclarations against an OpenAPI subset and
      // rejects the whole setup (HTTP 400) if any schema is malformed — e.g. a
      // property with no `type`, or unsupported keywords like additionalProperties
      // / $schema carried in from a brain skill. Sanitize every schema so one bad
      // tool can't sink the session.
      const params = sanitizeGeminiSchema(tool.parameters);
      declaration.parameters = params.type === 'object' ? params : { type: 'object', properties: {} };
      return declaration;
    })
    .filter((declaration): declaration is JsonRecord => Boolean(declaration));
}

/**
 * Coerce an arbitrary JSON-schema-ish object into the OpenAPI subset Gemini-Live
 * accepts in functionDeclarations: every node gets a concrete `type`, only known
 * keywords survive, and object/array children recurse. Defaults a typeless node
 * to `string` (or `object`/`array` when it has properties/items).
 */
function sanitizeGeminiSchema(value: unknown): JsonRecord {
  const src = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const hasProps = Boolean(src.properties && typeof src.properties === 'object');
  const hasItems = src.items !== undefined;
  const type = typeof src.type === 'string' && src.type
    ? src.type
    : hasProps
      ? 'object'
      : hasItems
        ? 'array'
        : 'string';

  const out: JsonRecord = { type };
  if (typeof src.description === 'string' && src.description) {
    out.description = src.description;
  }
  if (Array.isArray(src.enum) && src.enum.length > 0) {
    out.enum = src.enum;
  }
  if (typeof src.format === 'string') {
    out.format = src.format;
  }

  if (type === 'object') {
    const props = hasProps ? (src.properties as Record<string, unknown>) : {};
    const cleanProps: JsonRecord = {};
    for (const [key, child] of Object.entries(props)) {
      cleanProps[key] = sanitizeGeminiSchema(child);
    }
    out.properties = cleanProps;
    if (Array.isArray(src.required)) {
      const required = src.required.filter((entry) => typeof entry === 'string' && entry in cleanProps);
      if (required.length > 0) {
        out.required = required;
      }
    }
  } else if (type === 'array') {
    out.items = sanitizeGeminiSchema(src.items);
  }

  return out;
}

function collectParts(root: JsonRecord | null, content: JsonRecord | null): unknown[] {
  const parts: unknown[] = [];
  appendRecordParts(parts, content);
  appendRecordParts(parts, getRecord(content, 'modelTurn', 'model_turn'));
  appendRecordParts(parts, getRecord(root, 'modelTurn', 'model_turn'));
  appendCandidateParts(parts, root);
  appendCandidateParts(parts, content);
  return parts;
}

function appendRecordParts(target: unknown[], record: JsonRecord | null): void {
  const parts = getArray(record, 'parts', 'parts');
  if (parts) {
    target.push(...parts);
  }
}

function appendCandidateParts(target: unknown[], record: JsonRecord | null): void {
  const candidates = getArray(record, 'candidates', 'candidates');
  if (!candidates) {
    return;
  }
  for (const candidate of candidates) {
    const candidateRecord = asRecord(candidate);
    appendRecordParts(target, candidateRecord);
    appendRecordParts(target, getRecord(candidateRecord, 'content', 'content'));
  }
}

function partText(part: unknown): string {
  if (typeof part === 'string') {
    return part;
  }
  // Preserve exact spacing — streamed text deltas concatenate verbatim, so a
  // trailing space inside a part is significant and must not be trimmed away.
  const value = getValue(asRecord(part), 'text', 'text');
  return typeof value === 'string' ? value : '';
}

function partAudioChunks(part: unknown): SparkRealtimeAudioChunk[] {
  const inlineData = getRecord(asRecord(part), 'inlineData', 'inline_data');
  const data = firstCleanString(getValue(inlineData, 'data', 'data'));
  if (!data) {
    return [];
  }
  return [
    {
      data,
      mimeType: firstCleanString(getValue(inlineData, 'mimeType', 'mime_type')) || DEFAULT_OUTPUT_AUDIO_MIME_TYPE,
    },
  ];
}

function collectToolCalls(
  root: JsonRecord | null,
  content: JsonRecord | null,
  parts: unknown[],
): SparkRealtimeToolCall[] {
  const calls: SparkRealtimeToolCall[] = [];
  appendToolCallContainer(calls, root);
  appendToolCallContainer(calls, content);
  appendToolCallContainer(calls, getRecord(root, 'toolCall', 'tool_call'));
  appendToolCallContainer(calls, getRecord(content, 'toolCall', 'tool_call'));
  for (const part of parts) {
    const functionCall = getRecord(asRecord(part), 'functionCall', 'function_call');
    if (functionCall) {
      appendFunctionCall(calls, functionCall);
    }
  }
  return dedupeToolCalls(calls);
}

function appendToolCallContainer(target: SparkRealtimeToolCall[], container: JsonRecord | null): void {
  if (!container) {
    return;
  }
  const functionCalls = getArray(container, 'functionCalls', 'function_calls');
  if (functionCalls) {
    for (const call of functionCalls) {
      appendFunctionCall(target, asRecord(call));
    }
  }
  const functionCall = getRecord(container, 'functionCall', 'function_call');
  if (functionCall) {
    appendFunctionCall(target, functionCall);
  }
}

function appendFunctionCall(target: SparkRealtimeToolCall[], functionCall: JsonRecord | null): void {
  if (!functionCall) {
    return;
  }
  const name = firstCleanString(getValue(functionCall, 'name', 'name'));
  if (!name) {
    return;
  }
  const id =
    firstCleanString(getValue(functionCall, 'id', 'id'), getValue(functionCall, 'callId', 'call_id')) ||
    `rt_call_${target.length + 1}`;
  target.push({
    id,
    function: { name, arguments: normalizeFunctionCallArgs(getValue(functionCall, 'args', 'args')) },
  });
}

function normalizeFunctionCallArgs(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '{}';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function dedupeToolCalls(calls: SparkRealtimeToolCall[]): SparkRealtimeToolCall[] {
  const seen = new Set<string>();
  const deduped: SparkRealtimeToolCall[] = [];
  for (const call of calls) {
    const key = `${call.id}:${call.function.name}:${call.function.arguments}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(call);
  }
  return deduped;
}

function transcriptText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map(transcriptText).filter(Boolean).join(' ').trim();
  }
  const record = asRecord(value);
  if (!record) {
    return '';
  }
  const direct = firstCleanString(getValue(record, 'text', 'text'), getValue(record, 'transcript', 'transcript'));
  if (direct) {
    return direct;
  }
  const parts = getArray(record, 'parts', 'parts');
  if (!parts) {
    return '';
  }
  return parts.map(partText).filter(Boolean).join('').trim();
}

function booleanValue(...values: unknown[]): boolean {
  return values.some((value) => value === true || value === 'true' || value === 1);
}

function presenceFlag(...values: unknown[]): boolean {
  return values.some((value) => value !== undefined && value !== null && value !== false);
}

function firstCleanString(...values: unknown[]): string {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) {
      return cleaned;
    }
  }
  return '';
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getRecord(record: JsonRecord | null, camel: string, snake: string): JsonRecord | null {
  return asRecord(getValue(record, camel, snake));
}

function getArray(record: JsonRecord | null, camel: string, snake: string): unknown[] | null {
  const value = getValue(record, camel, snake);
  return Array.isArray(value) ? value : null;
}

function getValue(record: JsonRecord | null, camel: string, snake: string): unknown {
  if (!record) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(record, camel)) {
    return record[camel];
  }
  if (Object.prototype.hasOwnProperty.call(record, snake)) {
    return record[snake];
  }
  return undefined;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}
