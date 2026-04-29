// ============================================================================
// Vault — Enrichment Service
// AI-powered enrichment via OpenRouter. All functions return fallback values
// on failure — enrichment never blocks save or recall.
// ============================================================================

import type { EnrichmentClient } from './openrouter-client.js';
import type { MemoryItem, RecallMatch } from '../types/index.js';

// ---------------------------------------------------------------------------
// Client injection (dependency injection at module level)
// ---------------------------------------------------------------------------

let client: EnrichmentClient | null = null;

export function setEnrichmentClient(c: EnrichmentClient | null): void {
  client = c;
}

export function getEnrichmentClient(): EnrichmentClient | null {
  return client;
}

export function isEnrichmentAvailable(): boolean {
  return client !== null && client.isAvailable();
}

// ---------------------------------------------------------------------------
// Save-time enrichment functions
// ---------------------------------------------------------------------------

/**
 * Clean and improve a summary text using AI.
 * Returns original text on failure.
 */
export async function cleanSummary(text: string): Promise<string> {
  if (!isEnrichmentAvailable() || !text || text.length < 50) {
    return text;
  }

  try {
    const result = await client!.complete({
      systemPrompt: 'You are a technical editor. Polish the following summary for clarity and searchability. Preserve all technical details and meaning. Output ONLY the improved text, nothing else.',
      userPrompt: text,
      maxTokens: 500,
      temperature: 0.2,
      timeoutMs: 5000,
    });
    return result.text || text;
  } catch {
    return text;
  }
}

/**
 * Suggest tags for a memory item using AI.
 * Returns empty array on failure.
 */
export async function suggestTags(text: string, existingTags: string[] = []): Promise<string[]> {
  if (!isEnrichmentAvailable() || !text || text.length < 50) {
    return [];
  }

  try {
    const result = await client!.complete({
      systemPrompt: 'Suggest 3-6 lowercase classification tags for the following memory item. Return ONLY a JSON array of strings, e.g. ["tag1", "tag2"]. Do not include tags that are already listed.',
      userPrompt: `Existing tags: ${JSON.stringify(existingTags)}\n\nContent:\n${text}`,
      maxTokens: 100,
      temperature: 0.3,
      timeoutMs: 5000,
    });

    const parsed = JSON.parse(result.text);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.toLowerCase().trim())
        .filter((t) => t.length > 0 && !existingTags.includes(t));
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Classify the memory type of a text using AI.
 * Returns null on failure (caller's type stands).
 */
export async function classifyMemoryType(
  text: string,
  callerType: string,
): Promise<string | null> {
  if (!isEnrichmentAvailable() || !text || text.length < 50) {
    return null;
  }

  try {
    const result = await client!.complete({
      systemPrompt: `You classify memory items. Valid types: session, summary, decision, plan, artifact, handoff, reference. The caller classified this as "${callerType}". If that seems correct, output "${callerType}". If a different type fits better, output that single type word. Output ONLY the type word, nothing else.`,
      userPrompt: text,
      maxTokens: 20,
      temperature: 0.1,
      timeoutMs: 5000,
    });

    const normalized = result.text.toLowerCase().trim();
    const validTypes = ['session', 'summary', 'decision', 'plan', 'artifact', 'handoff', 'reference'];
    return validTypes.includes(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

/**
 * Suggest whether a memory item should be promoted to long-term.
 * Returns false on failure.
 */
export async function suggestPromotion(
  title: string,
  summary: string,
  memoryType: string,
): Promise<boolean> {
  if (!isEnrichmentAvailable() || !summary || summary.length < 50) {
    return false;
  }

  try {
    const result = await client!.complete({
      systemPrompt: 'You evaluate memory items for long-term importance. Items worth promoting: architecture decisions, canonical conventions, important project knowledge, critical bug findings. Items NOT worth promoting: routine sessions, trivial fixes, work-in-progress notes. Answer ONLY "yes" or "no".',
      userPrompt: `Type: ${memoryType}\nTitle: ${title}\nSummary: ${summary}`,
      maxTokens: 10,
      temperature: 0.1,
      timeoutMs: 5000,
    });

    return result.text.toLowerCase().trim() === 'yes';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Recall-time enrichment functions
// ---------------------------------------------------------------------------

/**
 * Re-rank recall candidates using LLM scoring.
 * Returns candidates with blended scores (60% deterministic, 40% LLM).
 * Returns original candidates on failure.
 */
export async function reRankWithLLM(
  query: { project?: string; subject?: string; queryText?: string; keywords?: string[] },
  candidates: RecallMatch[],
): Promise<RecallMatch[]> {
  if (!isEnrichmentAvailable() || candidates.length < 3 || candidates.length > 15) {
    return candidates;
  }

  const queryDescription = [
    query.queryText,
    query.subject,
    query.keywords?.join(', '),
  ].filter(Boolean).join(' | ');

  if (!queryDescription) {
    return candidates;
  }

  try {
    const candidateList = candidates.map((c, i) => ({
      idx: i,
      title: c.item.title,
      subject: c.item.subject,
      summary: c.item.summary.slice(0, 200),
      type: c.item.memoryType,
    }));

    const result = await client!.complete({
      systemPrompt: 'Rate the relevance of each memory item to the query. Return ONLY a JSON array of objects: [{"idx": 0, "score": 85}, ...]. Score 0-100 where 100 is perfect match. Consider semantic relevance, not just keyword overlap.',
      userPrompt: `Query: ${queryDescription}\n\nCandidates:\n${JSON.stringify(candidateList, null, 1)}`,
      maxTokens: 300,
      temperature: 0.1,
      timeoutMs: 3000,
    });

    const scores = JSON.parse(result.text) as Array<{ idx: number; score: number }>;
    if (!Array.isArray(scores)) {
      return candidates;
    }

    const scoreMap = new Map<number, number>();
    for (const entry of scores) {
      if (typeof entry.idx === 'number' && typeof entry.score === 'number') {
        scoreMap.set(entry.idx, Math.max(0, Math.min(100, entry.score)));
      }
    }

    // Blend: 60% deterministic + 40% LLM (normalized to same scale)
    const maxDeterministic = Math.max(...candidates.map((c) => c.score), 1);

    return candidates
      .map((c, i) => {
        const llmScore = scoreMap.get(i);
        if (llmScore === undefined) {
          return c;
        }

        const normalizedDeterministic = (c.score / maxDeterministic) * 100;
        const blended = (normalizedDeterministic * 0.6) + (llmScore * 0.4);

        return {
          ...c,
          score: blended,
        };
      })
      .sort((a, b) => b.score - a.score);
  } catch {
    return candidates;
  }
}

/**
 * Generate a 2-3 sentence executive summary of recalled context.
 * Returns null on failure.
 */
export async function generateContextSummary(
  query: { project?: string; subject?: string; queryText?: string },
  topItems: MemoryItem[],
): Promise<string | null> {
  if (!isEnrichmentAvailable() || topItems.length === 0) {
    return null;
  }

  const queryDescription = [query.queryText, query.subject].filter(Boolean).join(' — ');
  const itemSummaries = topItems
    .slice(0, 5)
    .map((item) => `[${item.memoryType}] ${item.title}: ${item.summary.slice(0, 150)}`)
    .join('\n');

  try {
    const result = await client!.complete({
      systemPrompt: 'Summarize the recalled memory context in 2-3 concise sentences. Focus on what is most relevant to the query. This summary helps an AI assistant quickly understand prior context.',
      userPrompt: `Query: ${queryDescription || 'general recall'}\n\nRecalled items:\n${itemSummaries}`,
      maxTokens: 200,
      temperature: 0.3,
      timeoutMs: 3000,
    });

    return result.text || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator: post-save enrichment
// ---------------------------------------------------------------------------

export interface EnrichmentUpdateFn {
  (itemUid: string, updates: Partial<MemoryItem>): MemoryItem | null;
}

/**
 * Run all save-time enrichment steps for a memory item.
 * Fire-and-forget — errors are silently caught.
 */
export async function enrichAfterSave(
  item: MemoryItem,
  updateFn: EnrichmentUpdateFn,
): Promise<void> {
  if (!isEnrichmentAvailable()) {
    return;
  }

  try {
    const fullText = [item.title, item.subject, item.summary, item.content].filter(Boolean).join('\n');
    const updates: Partial<MemoryItem> = {};

    // Run enrichments in parallel
    const [cleanedSummary, aiTags, aiType, shouldPromote] = await Promise.all([
      cleanSummary(item.summary),
      suggestTags(fullText, item.tags),
      classifyMemoryType(fullText, item.memoryType),
      suggestPromotion(item.title, item.summary, item.memoryType),
    ]);

    // Apply cleaned summary if different
    if (cleanedSummary && cleanedSummary !== item.summary) {
      updates.summary = cleanedSummary;
    }

    // Merge AI-suggested tags with existing
    if (aiTags.length > 0) {
      const mergedTags = [...new Set([...item.tags, ...aiTags])];
      updates.tags = mergedTags;
    }

    // Flag type mismatch (log it but don't auto-change — too risky)
    if (aiType && aiType !== item.memoryType) {
      // We could store this as metadata, but for now we just skip
      // to avoid silently changing user-chosen types
    }

    // Auto-promote if AI suggests it and item isn't already promoted
    if (shouldPromote && !item.promoted) {
      updates.promoted = true;
      updates.status = 'promoted' as MemoryItem['status'];
    }

    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      updateFn(item.itemUid, updates);
    }
  } catch {
    // Silent failure — enrichment should never break the save pipeline
  }
}

// ---------------------------------------------------------------------------
// Duplicate detection (unchanged — deterministic, no AI needed)
// ---------------------------------------------------------------------------

export async function detectDuplicates(
  summary: string,
  candidates: { itemUid: string; summary: string }[],
): Promise<{ itemUid: string; similarity: number }[]> {
  const normalizedSummary = normalizeText(summary);
  if (!normalizedSummary) {
    return [];
  }

  return candidates
    .map((candidate) => ({
      itemUid: candidate.itemUid,
      similarity: calculateSimilarity(normalizedSummary, normalizeText(candidate.summary)),
    }))
    .filter((candidate) => candidate.similarity >= 0.35)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 8);
}

// ---------------------------------------------------------------------------
// Text similarity helpers (unchanged)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'how', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this',
  'to', 'was', 'with',
]);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return text
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function buildBigrams(tokens: string[]): string[] {
  const bigrams: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    bigrams.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return bigrams;
}

function jaccardScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;

  for (const value of leftSet) {
    if (rightSet.has(value)) {
      overlap += 1;
    }
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return union > 0 ? overlap / union : 0;
}

function calculateSimilarity(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  const tokenScore = jaccardScore(leftTokens, rightTokens);
  const bigramScore = jaccardScore(buildBigrams(leftTokens), buildBigrams(rightTokens));
  const containmentScore =
    left.includes(right) || right.includes(left)
      ? Math.min(left.length, right.length) / Math.max(left.length, right.length)
      : 0;
  const sharedTokenCount = leftTokens.filter((token) => rightTokens.includes(token)).length;

  let score = (tokenScore * 0.55) + (bigramScore * 0.25) + (containmentScore * 0.2);

  if (sharedTokenCount >= 4) {
    score += 0.08;
  } else if (sharedTokenCount <= 1) {
    score *= 0.7;
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}
