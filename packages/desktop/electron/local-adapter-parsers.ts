import type { LocalAdapterType } from './local-adapters.js';

export type LocalAdapterTokenCounts = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type ParsedLocalAdapterExecution = {
  sessionId: string | null;
  sessionParams: Record<string, unknown> | null;
  sessionDisplayId: string | null;
  output: string;
  summary: string;
  tokenCounts: LocalAdapterTokenCounts | null;
  errorMessage: string | null;
};

export function parseLocalAdapterExecution(
  adapterType: LocalAdapterType,
  stdout: string,
  stderr: string,
  fallbackSessionId: string | null,
  fallbackSessionParams: Record<string, unknown> | null,
): ParsedLocalAdapterExecution {
  if (adapterType === 'codex_local') {
    return parseCodexJsonl(stdout, stderr, fallbackSessionParams);
  }

  return parseClaudeExecution(stdout, stderr, fallbackSessionId, fallbackSessionParams);
}

export function isUnknownSessionError(adapterType: LocalAdapterType, stdout: string, stderr: string): boolean {
  return adapterType === 'codex_local'
    ? isCodexUnknownSessionError(stdout, stderr)
    : isClaudeUnknownSessionError(stdout, stderr);
}

export function parseCodexJsonl(
  stdout: string,
  stderr: string,
  fallbackSessionParams: Record<string, unknown> | null,
): ParsedLocalAdapterExecution {
  let sessionId: string | null = readNonEmptyString(fallbackSessionParams?.sessionId);
  let finalMessage: string | null = null;
  let errorMessage: string | null = null;
  const tokenCounts: LocalAdapterTokenCounts = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };
  let sawTokenCounts = false;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const event = parseJson(line);
    if (!event) {
      continue;
    }

    const type = readNonEmptyString(event.type) || '';
    if (type === 'thread.started') {
      sessionId = readNonEmptyString(event.thread_id) || sessionId;
      continue;
    }

    if (type === 'error') {
      const message = readNonEmptyString(event.message);
      if (message) {
        errorMessage = message;
      }
      continue;
    }

    if (type === 'item.completed') {
      const item = asObject(event.item);
      if ((readNonEmptyString(item.type) || '') === 'agent_message') {
        const text = readNonEmptyString(item.text);
        if (text) {
          finalMessage = text;
        }
      }
      continue;
    }

    if (type === 'turn.completed') {
      const usage = asObject(event.usage);
      tokenCounts.inputTokens = asNumber(usage.input_tokens, tokenCounts.inputTokens);
      tokenCounts.cachedInputTokens = asNumber(usage.cached_input_tokens, tokenCounts.cachedInputTokens);
      tokenCounts.outputTokens = asNumber(usage.output_tokens, tokenCounts.outputTokens);
      sawTokenCounts = true;
      continue;
    }

    if (type === 'turn.failed') {
      const error = asObject(event.error);
      const message = readNonEmptyString(error.message);
      if (message) {
        errorMessage = message;
      }
    }
  }

  const summary = finalMessage?.trim() || '';
  const cleanedFallback = stripAnsi([stdout, stderr].filter(Boolean).join('\n')).trim();

  return {
    sessionId,
    sessionParams: sessionId ? { ...(fallbackSessionParams || {}), sessionId } : fallbackSessionParams || null,
    sessionDisplayId: sessionId,
    output: summary || cleanedFallback || 'The local adapter completed without returning a printable response.',
    summary,
    tokenCounts: sawTokenCounts ? tokenCounts : null,
    errorMessage,
  };
}

export function parseClaudeExecution(
  stdout: string,
  stderr: string,
  fallbackSessionId: string | null,
  fallbackSessionParams: Record<string, unknown> | null,
): ParsedLocalAdapterExecution {
  const output = stripAnsi(stdout).trim() || stripAnsi([stdout, stderr].filter(Boolean).join('\n')).trim();

  return {
    sessionId: fallbackSessionId,
    sessionParams: fallbackSessionParams,
    sessionDisplayId: fallbackSessionId,
    output: output || 'The local adapter completed without returning a printable response.',
    summary: output,
    tokenCounts: null,
    errorMessage: null,
  };
}

export function isCodexUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = normalizeErrorHaystack(stdout, stderr);
  return /unknown (session|thread)|session .* not found|thread .* not found|conversation .* not found|missing rollout path for thread|state db missing rollout path|no rollout found for thread id/i.test(
    haystack,
  );
}

export function isClaudeUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = normalizeErrorHaystack(stdout, stderr);
  return /no conversation found with session id|unknown session|session .* not found/i.test(haystack);
}

function normalizeErrorHaystack(stdout: string, stderr: string): string {
  return `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return asObject(parsed);
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}
