// ============================================================================
// Vault — Retrieve Service Tests
// Recall candidate scoping, project resolution, and ranking accuracy.
// ============================================================================

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, initializeSchema, resetConnection, type VaultDB } from '../database/connection.js';
import { memoryItems, projects } from '../database/schema.js';
import { recallContext, findMemory, getLatest } from './retrieve.service.js';
import { setEnrichmentClient } from './enrichment.service.js';
import type { EnrichmentClient } from './openrouter-client.js';
import { now } from '../utils/datetime.js';

let db: VaultDB;
let workDir: string;
let logsPath: string;
let uidCounter = 0;

interface SeedOverrides {
  project?: string;
  title?: string;
  subject?: string;
  summary?: string;
  memoryType?: string;
  status?: string;
  priority?: string;
  promoted?: boolean;
  keywords?: string[];
  tags?: string[];
  createdAt?: string;
}

function seedItem(overrides: SeedOverrides = {}): string {
  const itemUid = `vm_test_${++uidCounter}`;
  const timestamp = overrides.createdAt ?? now();
  db.insert(memoryItems)
    .values({
      itemUid,
      title: overrides.title ?? `Item ${uidCounter}`,
      project: overrides.project ?? 'Vault Collab',
      sourceApp: 'manual',
      memoryType: overrides.memoryType ?? 'summary',
      subject: overrides.subject ?? `Subject ${uidCounter}`,
      summary: overrides.summary ?? `Summary ${uidCounter}`,
      keywordsJson: JSON.stringify(overrides.keywords ?? []),
      tagsJson: JSON.stringify(overrides.tags ?? []),
      status: overrides.status ?? 'active',
      priority: overrides.priority ?? 'normal',
      promoted: overrides.promoted ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return itemUid;
}

function seedProject(name: string): void {
  db.insert(projects)
    .values({ name, createdAt: now(), updatedAt: now() })
    .onConflictDoNothing()
    .run();
}

beforeEach(() => {
  resetConnection();
  workDir = mkdtempSync(join(tmpdir(), 'vault-retrieve-test-'));
  logsPath = join(workDir, 'logs');
  db = getDatabase(join(workDir, 'vault.db'));
  initializeSchema(join(workDir, 'vault.db'));
  seedProject('Vault Collab');
  seedProject('Hermes Brain');
});

afterEach(() => {
  resetConnection();
  rmSync(workDir, { recursive: true, force: true });
});

describe('recallContext candidate scoping', () => {
  it('excludes promoted items from other projects when a project is given', async () => {
    seedItem({ project: 'Vault Collab', title: 'Local note' });
    seedItem({ project: 'Vault Collab', title: 'Local promoted', promoted: true, priority: 'canonical' });
    seedItem({ project: 'Hermes Brain', title: 'Foreign promoted', promoted: true, priority: 'canonical', memoryType: 'decision' });

    const pack = await recallContext(db, logsPath, { project: 'Vault Collab' });

    expect(pack.totalCandidates).toBe(2);
    expect(pack.topMatches.every((m) => m.item.project === 'Vault Collab')).toBe(true);
  });

  it('returns zero candidates for a project that does not exist', async () => {
    seedItem({ project: 'Vault Collab' });
    seedItem({ project: 'Hermes Brain', promoted: true });

    const pack = await recallContext(db, logsPath, { project: 'zzz-does-not-exist' });

    expect(pack.totalCandidates).toBe(0);
    expect(pack.topMatches).toHaveLength(0);
  });

  it('still surfaces archived items within the project when they are promoted', async () => {
    seedItem({ project: 'Vault Collab', title: 'Archived promoted', status: 'archived', promoted: true });
    seedItem({ project: 'Vault Collab', title: 'Archived plain', status: 'archived' });
    seedItem({ project: 'Vault Collab', title: 'Active plain' });

    const pack = await recallContext(db, logsPath, { project: 'Vault Collab' });

    const titles = pack.topMatches.map((m) => m.item.title);
    expect(pack.totalCandidates).toBe(2);
    expect(titles).toContain('Archived promoted');
    expect(titles).not.toContain('Archived plain');
  });

  it('still includes an explicitly requested memory UID from outside the project', async () => {
    seedItem({ project: 'Vault Collab' });
    const foreignUid = seedItem({ project: 'Hermes Brain', title: 'Foreign but requested' });

    const pack = await recallContext(db, logsPath, {
      project: 'Vault Collab',
      queryText: `please load ${foreignUid}`,
    });

    expect(pack.topMatches[0]?.item.itemUid).toBe(foreignUid);
  });
});

describe('recallContext project resolution', () => {
  it('resolves a slug-form project to the canonical name', async () => {
    seedItem({ project: 'Vault Collab', title: 'Reachable via slug' });

    const pack = await recallContext(db, logsPath, { project: 'vault-collab' });

    expect(pack.totalCandidates).toBe(1);
    expect(pack.topMatches[0]?.item.title).toBe('Reachable via slug');
  });

  it('resolves casing variants to the canonical name', async () => {
    seedItem({ project: 'Vault Collab', title: 'Reachable via casing' });

    const pack = await recallContext(db, logsPath, { project: 'VAULT COLLAB' });

    expect(pack.totalCandidates).toBe(1);
  });
});

describe('recallContext ranking accuracy', () => {
  it('ranks an exact-subject match above irrelevant promoted canonical items', async () => {
    for (let i = 0; i < 8; i++) {
      seedItem({
        project: 'Vault Collab',
        title: `Canonical filler ${i}`,
        subject: `Unrelated topic ${i}`,
        memoryType: 'decision',
        promoted: true,
        priority: 'canonical',
      });
    }
    const relevantUid = seedItem({
      project: 'Vault Collab',
      title: 'Registration lockout fix',
      subject: 'Project registration auto-create and stalled launch sweep',
      summary: 'Fixed registration and stalled launch sweep.',
      keywords: ['registration', 'sweep'],
    });

    const pack = await recallContext(db, logsPath, {
      project: 'Vault Collab',
      subject: 'Project registration auto-create and stalled launch sweep',
      limit: 5,
    });

    expect(pack.topMatches[0]?.item.itemUid).toBe(relevantUid);
  });

  it('keeps static promoted-first ordering when the query has no relevance inputs', async () => {
    seedItem({ project: 'Vault Collab', title: 'Plain note' });
    const promotedUid = seedItem({
      project: 'Vault Collab',
      title: 'Canonical decision',
      memoryType: 'decision',
      promoted: true,
      priority: 'canonical',
    });

    const pack = await recallContext(db, logsPath, { project: 'Vault Collab' });

    expect(pack.topMatches[0]?.item.itemUid).toBe(promotedUid);
  });
});

describe('recallContext cross-project matches', () => {
  it('surfaces strong matches from other projects separately, leaving project results unchanged', async () => {
    seedItem({ project: 'Vault Collab', title: 'Local deploy note', summary: 'Deploys run from CI.' });
    const foreignUid = seedItem({
      project: 'Hermes Brain',
      title: 'GitHub two-account rule',
      summary: 'Run gh auth switch before pushing to the work org.',
    });

    const pack = await recallContext(db, logsPath, { project: 'Vault Collab', queryText: 'gh auth switch' });

    expect(pack.topMatches.every((match) => match.item.project === 'Vault Collab')).toBe(true);
    expect(pack.crossProject?.map((match) => match.item.itemUid)).toEqual([foreignUid]);
  });

  it('ignores weak foreign matches and archived items', async () => {
    seedItem({ project: 'Hermes Brain', title: 'Switch theme', summary: 'Toggle the dark theme.' });
    // Real-data noise: query words appear only inside other words ("OAuth", "authority").
    seedItem({
      project: 'Hermes Brain',
      title: 'Developer API OAuth fix and authority switch',
      subject: 'OAuth authority',
      summary: 'Fixed the OAuth callback; authority checks switch to the new gate.',
    });
    seedItem({
      project: 'Hermes Brain',
      title: 'Old GitHub two-account rule',
      summary: 'Run gh auth switch before pushing.',
      status: 'archived',
    });

    const pack = await recallContext(db, logsPath, { project: 'Vault Collab', queryText: 'gh auth switch' });

    expect(pack.crossProject).toEqual([]);
  });

  it('adds no cross-project section for unscoped or query-less recall', async () => {
    seedItem({ project: 'Hermes Brain', title: 'GitHub two-account rule', summary: 'Run gh auth switch first.' });

    const unscoped = await recallContext(db, logsPath, { queryText: 'gh auth switch' });
    const queryless = await recallContext(db, logsPath, { project: 'Vault Collab' });

    expect(unscoped.crossProject).toEqual([]);
    expect(queryless.crossProject).toEqual([]);
  });
});

describe('recallContext context summary grounding', () => {
  function mockClient(summaryReply: { text: string; finishReason?: string }, prompts: string[] = []): EnrichmentClient {
    return {
      isAvailable: () => true,
      complete: async (params) => {
        if (params.systemPrompt.includes('Rate the relevance')) {
          return { text: '[]', model: 'mock', usage: { promptTokens: 0, completionTokens: 0 } };
        }
        prompts.push(`${params.systemPrompt}\n${params.userPrompt}`);
        return { ...summaryReply, model: 'mock', usage: { promptTokens: 0, completionTokens: 0 } };
      },
    } as EnrichmentClient;
  }

  afterEach(() => {
    setEnrichmentClient(null);
  });

  it('skips the summary when no memory is a strong match', async () => {
    const prompts: string[] = [];
    setEnrichmentClient(mockClient({ text: 'Use gh auth login to switch accounts.' }, prompts));
    seedItem({ title: 'Unrelated deploy note', summary: 'Deploys run from CI.' });

    const pack = await recallContext(db, logsPath, { project: 'Vault Collab', queryText: 'gh auth switch' });

    expect(pack.contextSummary).toBeUndefined();
    expect(prompts).toHaveLength(0);
  });

  it('grounds the summary in strong matches only and tells the model not to add knowledge', async () => {
    const prompts: string[] = [];
    setEnrichmentClient(mockClient({ text: 'Run gh auth switch before pushing to the work org.' }, prompts));
    seedItem({
      title: 'GitHub two-account rule',
      subject: 'gh auth switch',
      summary: 'Run gh auth switch before pushing to the work org.',
      keywords: ['gh auth switch'],
    });

    const pack = await recallContext(db, logsPath, { project: 'Vault Collab', subject: 'gh auth switch' });

    expect(pack.contextSummary).toBe('Run gh auth switch before pushing to the work org.');
    expect(prompts[0]).toContain('ONLY');
    expect(prompts[0]).toContain('GitHub two-account rule');
  });

  it('drops a summary the model marks as unsupported or that was cut off', async () => {
    seedItem({
      title: 'GitHub two-account rule',
      subject: 'gh auth switch',
      summary: 'Run gh auth switch before pushing to the work org.',
      keywords: ['gh auth switch'],
    });

    setEnrichmentClient(mockClient({ text: 'NONE' }));
    const none = await recallContext(db, logsPath, { project: 'Vault Collab', subject: 'gh auth switch' });
    expect(none.contextSummary).toBeUndefined();

    setEnrichmentClient(mockClient({ text: 'Run gh auth switch before', finishReason: 'length' }));
    const cut = await recallContext(db, logsPath, { project: 'Vault Collab', subject: 'gh auth switch' });
    expect(cut.contextSummary).toBeUndefined();
  });
});

describe('findMemory and getLatest project resolution', () => {
  it('findMemory resolves slug-form project names', () => {
    seedItem({ project: 'Vault Collab', title: 'Findable' });

    const results = findMemory(db, { project: 'vault-collab' });

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Findable');
  });

  it('findMemory keywords match any keyword, not all of them', () => {
    seedItem({ title: 'Account switching', keywords: ['gh account'] });
    seedItem({ title: 'Unrelated', keywords: ['supabase'] });

    const results = findMemory(db, { keywords: ['gh auth switch', 'gh account', 'github account'] });

    expect(results.map((item) => item.title)).toEqual(['Account switching']);
  });

  it('findMemory keywords also search title, subject, summary and content text', () => {
    seedItem({
      project: 'Hermes Brain',
      title: 'GitHub two-account rule',
      summary: 'Run gh auth switch before pushing to the work org.',
    });
    seedItem({ title: 'Unrelated', summary: 'Nothing about GitHub accounts here.' });

    const results = findMemory(db, { keywords: ['GH AUTH SWITCH'] });

    expect(results.map((item) => item.title)).toEqual(['GitHub two-account rule']);
  });

  it('getLatest resolves slug-form project names', () => {
    seedItem({ project: 'Vault Collab', title: 'Latest one' });

    const results = getLatest(db, 'vault-collab', 5);

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Latest one');
  });
});
