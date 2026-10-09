// ============================================================================
// Vault — Enrichment Service Tests
// Post-save enrichment must never rewrite the author's summary.
// ============================================================================

import { afterEach, describe, expect, it } from 'vitest';
import { enrichAfterSave, setEnrichmentClient } from './enrichment.service.js';
import type { CompletionParams, EnrichmentClient } from './openrouter-client.js';
import type { MemoryItem } from '../types/index.js';

const ORIGINAL_SUMMARY =
  'On this PC, the GitHub CLI (`gh`) is logged in with `git_protocol: https`, so push with '
  + '**inline** `-c credential.helper=` overrides instead of editing global git config.';

function makeItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 1,
    itemUid: 'vm_test_enrich',
    title: 'Pushing to GitHub from the Windows Bash tool',
    project: 'Vault',
    sourceApp: 'claude',
    sourceSessionId: null,
    memoryType: 'decision',
    subject: 'Non-interactive git push over HTTPS',
    summary: ORIGINAL_SUMMARY,
    content: null,
    keywords: ['git', 'push'],
    tags: ['git-workflow'],
    routineType: null,
    status: 'active',
    priority: 'normal',
    promoted: false,
    nextSteps: [],
    relatedItemIds: [],
    relatedFiles: [],
    vaultPath: null,
    createdAt: '2026-10-09T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
    lastAccessedAt: null,
    accessCount: 0,
    snoozedUntil: null,
    outcome: null,
    ...overrides,
  } as MemoryItem;
}

// Mimics a model that hits max_tokens mid-sentence on free-text prompts.
function truncatingClient(prompts: CompletionParams[]): EnrichmentClient {
  return {
    isAvailable: () => true,
    complete: async (params) => {
      prompts.push(params);
      if (params.systemPrompt.includes('JSON array of strings')) {
        return { text: '["github", "git"]', model: 'mock', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } };
      }
      return {
        text: 'On this PC, the GitHub CLI (`gh`) is logged in with `git_protocol',
        model: 'mock',
        finishReason: 'length',
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    },
  } as EnrichmentClient;
}

describe('enrichAfterSave', () => {
  afterEach(() => {
    setEnrichmentClient(null);
  });

  it('never replaces the stored summary, even when the model returns different text', async () => {
    const prompts: CompletionParams[] = [];
    setEnrichmentClient(truncatingClient(prompts));

    const updates: Array<Partial<MemoryItem>> = [];
    await enrichAfterSave(makeItem(), (_uid, update) => {
      updates.push(update);
      return null;
    });

    for (const update of updates) {
      expect(update).not.toHaveProperty('summary');
    }
    // No prompt should ask the model to rewrite the summary.
    expect(prompts.some((p) => /polish|rewrite|improve/i.test(p.systemPrompt))).toBe(false);
  });

  it('still merges AI-suggested tags additively', async () => {
    setEnrichmentClient(truncatingClient([]));

    const updates: Array<Partial<MemoryItem>> = [];
    await enrichAfterSave(makeItem(), (_uid, update) => {
      updates.push(update);
      return null;
    });

    const merged = updates.find((update) => update.tags)?.tags;
    expect(merged).toEqual(expect.arrayContaining(['git-workflow', 'github', 'git']));
  });
});
