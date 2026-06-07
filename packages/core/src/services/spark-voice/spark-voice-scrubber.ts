/**
 * Output scrubber (v5 SurfaceAdapter contract, vm_0vFbOo9l8sfyWsJi §3).
 *
 * Every fragment of assistant text MUST pass through `scrubSparkOutput` before
 * it is shown, spoken, or sent to TTS. It strips fenced context/memory/tool
 * evidence blocks and redacts token-like strings (owner/session tokens, bearer
 * keys, `sk-...` keys) so internal data can never leak into the visible/audible
 * channel. This is pure and synchronous so it can run inline on every streamed
 * delta with no latency cost.
 */

/** Fenced-evidence tags Spark uses internally. Anything between them is data. */
const FENCE_TAG_PATTERN =
  /<spark-(?:memory|context|tool|graph)-evidence\b[^>]*>[\s\S]*?<\/spark-(?:memory|context|tool|graph)-evidence>/gi;

/** A dangling open fence (stream cut mid-block) — drop from the open tag on. */
const DANGLING_FENCE_PATTERN = /<spark-(?:memory|context|tool|graph)-evidence\b[\s\S]*$/i;

/** Token-like secrets we never want spoken or displayed. */
const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g, // OpenAI-style keys
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, // bearer headers
  /\bxi-[A-Za-z0-9_-]{12,}\b/g, // ElevenLabs-style keys
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT-ish triplets
];

const REDACTION = '[redacted]';

export interface SparkScrubResult {
  /** The safe, user-visible text after fencing + token redaction. */
  text: string;
  /** True when anything was removed/redacted (drives `scrubbed: true` events). */
  scrubbed: boolean;
}

/**
 * Strip fenced internal evidence and redact token-like strings from a fragment.
 * Returns the cleaned text plus whether any change occurred.
 */
export function scrubSparkOutput(input: string): SparkScrubResult {
  if (typeof input !== 'string' || input.length === 0) {
    return { text: '', scrubbed: false };
  }

  let text = input;

  // 1. Remove complete fenced evidence blocks.
  text = text.replace(FENCE_TAG_PATTERN, '');
  // 2. Remove a dangling/unterminated fence (mid-stream truncation).
  text = text.replace(DANGLING_FENCE_PATTERN, '');
  // 3. Redact token-like secrets.
  for (const pattern of TOKEN_PATTERNS) {
    text = text.replace(pattern, REDACTION);
  }

  // Collapse whitespace the removals may have left behind, but preserve a single
  // leading/trailing space semantics for streamed deltas (trim only the edges).
  const cleaned = text.replace(/[ \t]{2,}/g, ' ');

  return { text: cleaned, scrubbed: cleaned !== input };
}

/**
 * Wrap recalled memory (or any retrieved evidence) in a data fence so the model
 * treats it as reference, never as instructions (v4 ContextComposer fencing).
 */
export function fenceSparkEvidence(
  kind: 'memory' | 'context' | 'tool' | 'graph',
  body: string,
): string {
  return `<spark-${kind}-evidence fence="data">\n${body}\n</spark-${kind}-evidence>`;
}
