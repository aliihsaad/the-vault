import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import { Vault } from './index.js';
import { memoryItems } from './database/schema.js';

describe('task delegation system', () => {
  let vaultRoot: string;
  let vault: Vault;
  let extractedNativeBindingDir: string | null = null;
  const previousNativeBinding = process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING;

  beforeAll(async () => {
    const cachedPrebuild = await findCachedBetterSqlitePrebuild();
    if (!cachedPrebuild) {
      return;
    }

    extractedNativeBindingDir = await mkdtemp(join(tmpdir(), 'vault-sqlite-native-'));
    execFileSync('tar', ['-xf', cachedPrebuild, '-C', extractedNativeBindingDir]);
    process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING = join(
      extractedNativeBindingDir,
      'build',
      'Release',
      'better_sqlite3.node',
    );
  });

  beforeEach(async () => {
    vaultRoot = await mkdtemp(join(tmpdir(), 'vault-task-test-'));
    vault = new Vault(vaultRoot);
    vault.initialize();
  });

  afterEach(async () => {
    vault.close();
    await rm(vaultRoot, { recursive: true, force: true });
  });

  afterAll(async () => {
    if (previousNativeBinding === undefined) {
      delete process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING;
    } else {
      process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING = previousNativeBinding;
    }

    if (extractedNativeBindingDir) {
      try {
        await rm(extractedNativeBindingDir, { recursive: true, force: true });
      } catch {
        // Windows keeps native .node files locked for the lifetime of the process.
      }
    }
  });

  it('creates tasks with routed models and persists their metadata', () => {
    vault.setModelRoutingTable({
      routes: [
        {
          taskType: 'research',
          modelId: 'openai/o3-mini',
          fallbackModelId: 'anthropic/claude-haiku-3.5',
          maxTokens: 2048,
          temperature: 0.15,
          timeoutMs: 45000,
        },
      ],
    });

    const task = vault.createTask({
      title: 'Compare package choices',
      taskType: 'research',
      prompt: 'Compare SQLite wrappers for a local-first app.',
      project: 'Vault',
      priority: 'high',
      context: {
        packageNames: ['better-sqlite3', 'sqlite3'],
      },
      maxRetries: 4,
      createdBy: 'codex',
    });

    expect(task.taskUid).toMatch(/^vt_/);
    expect(task.status).toBe('pending');
    expect(task.priority).toBe('high');
    expect(task.project).toBe('Vault');
    expect(task.createdBy).toBe('codex');
    expect(task.context).toEqual({
      packageNames: ['better-sqlite3', 'sqlite3'],
    });
    expect(task.routedModel).toBe('openai/o3-mini');
    expect(task.maxRetries).toBe(4);

    const persisted = vault.getTask(task.taskUid);
    expect(persisted).not.toBeNull();
    expect(persisted?.routedModel).toBe('openai/o3-mini');
    expect(persisted?.context).toEqual({
      packageNames: ['better-sqlite3', 'sqlite3'],
    });
  });

  it('claims queued tasks by priority and updates queue stats across lifecycle transitions', () => {
    const lowTask = vault.createTask({
      title: 'Low priority cleanup',
      taskType: 'general',
      prompt: 'Clean up old notes later.',
      priority: 'low',
      project: 'Vault',
      createdBy: 'desktop',
    });
    const urgentTask = vault.createTask({
      title: 'Urgent analysis',
      taskType: 'analysis',
      prompt: 'Analyze a failing sync edge case immediately.',
      priority: 'urgent',
      project: 'Vault',
      createdBy: 'desktop',
    });
    const normalTask = vault.createTask({
      title: 'Research adapter options',
      taskType: 'research',
      prompt: 'Research local adapter resume patterns.',
      priority: 'normal',
      project: 'Vault',
      createdBy: 'desktop',
    });

    const initialStats = vault.getTaskQueueStats();
    expect(initialStats.pending).toBe(3);
    expect(initialStats.running).toBe(0);
    expect(initialStats.byType).toEqual({
      analysis: 1,
      general: 1,
      research: 1,
    });

    const claimedFirst = vault.claimNextTask();
    expect(claimedFirst?.taskUid).toBe(urgentTask.taskUid);
    expect(claimedFirst?.status).toBe('running');
    expect(claimedFirst?.startedAt).not.toBeNull();

    const afterFirstClaim = vault.getTaskQueueStats();
    expect(afterFirstClaim.pending).toBe(2);
    expect(afterFirstClaim.running).toBe(1);
    expect(afterFirstClaim.byType).toEqual({
      analysis: 1,
      general: 1,
      research: 1,
    });

    const completed = vault.completeTask(urgentTask.taskUid, 'Root cause isolated.', {
      confidence: 'high',
    });
    expect(completed?.status).toBe('completed');
    expect(completed?.resultText).toBe('Root cause isolated.');
    expect(completed?.resultMetadata).toEqual(
      expect.objectContaining({
        confidence: 'high',
        savedMemoryUid: expect.any(String),
        savedMemoryType: 'summary',
        savedMemoryPath: expect.any(String),
      }),
    );
    expect(completed?.completedAt).not.toBeNull();
    expect(completed?.targetMemoryUid).toBe(completed?.resultMetadata?.savedMemoryUid);

    const claimedSecond = vault.claimNextTask();
    expect(claimedSecond?.taskUid).toBe(normalTask.taskUid);
    expect(claimedSecond?.status).toBe('running');

    const failed = vault.failTask(normalTask.taskUid, 'Temporary upstream issue');
    expect(failed?.status).toBe('failed');
    expect(failed?.errorMessage).toBe('Temporary upstream issue');

    const cancelled = vault.cancelTask(lowTask.taskUid);
    expect(cancelled?.status).toBe('cancelled');

    const finalStats = vault.getTaskQueueStats();
    expect(finalStats.pending).toBe(0);
    expect(finalStats.running).toBe(0);
    expect(finalStats.completed).toBe(1);
    expect(finalStats.failed).toBe(1);
    expect(finalStats.cancelled).toBe(1);
    expect(finalStats.byType).toEqual({});
  });

  it('persists completed task results as reusable memory and links the saved memory UID back to the task', () => {
    const task = vault.createTask({
      title: 'Summarize migration notes',
      taskType: 'summarize',
      prompt: 'Summarize the latest migration notes into a concise briefing.',
      project: 'Vault',
      priority: 'high',
      context: {
        item_uids: ['vm_source123'],
        related_files: ['packages/core/src/services/task.service.ts'],
      },
      createdBy: 'codex',
    });

    const completed = vault.completeTask(task.taskUid, 'The migration is stable and the next step is backfilling the remaining indexes.', {
      model: 'anthropic/claude-haiku-3.5',
    });

    expect(completed).not.toBeNull();
    expect(completed?.targetMemoryUid).toMatch(/^vm_/);
    expect(completed?.resultMetadata).toEqual(
      expect.objectContaining({
        model: 'anthropic/claude-haiku-3.5',
        savedMemoryUid: completed?.targetMemoryUid,
        savedMemoryType: 'summary',
      }),
    );

    const detail = vault.getMemoryDetail(completed!.targetMemoryUid!);
    expect(detail).not.toBeNull();
    expect(detail?.memoryType).toBe('summary');
    expect(detail?.project).toBe('Vault');
    expect(detail?.title).toBe('Summarize migration notes');
    expect(detail?.subject).toBe('Delegated summarize result');
    expect(detail?.summary).toContain('The migration is stable');
    expect(detail?.relatedItemIds).toContain('vm_source123');
    expect(detail?.relatedFiles).toContain('packages/core/src/services/task.service.ts');
    expect(detail?.content).toContain('Task UID:');
    expect(detail?.content).toContain('Result:');
  });

  it('retries failed tasks until max retries is reached', () => {
    const task = vault.createTask({
      title: 'Draft implementation outline',
      taskType: 'coding',
      prompt: 'Draft an implementation outline for task persistence.',
      maxRetries: 1,
      createdBy: 'codex',
    });

    const runningTask = vault.claimNextTask('coding');
    expect(runningTask?.taskUid).toBe(task.taskUid);
    expect(runningTask?.status).toBe('running');

    const failedOnce = vault.failTask(task.taskUid, 'Transient model timeout');
    expect(failedOnce?.status).toBe('failed');
    expect(failedOnce?.errorMessage).toBe('Transient model timeout');

    const retried = vault.retryTask(task.taskUid);
    expect(retried?.status).toBe('pending');
    expect(retried?.retryCount).toBe(1);
    expect(retried?.startedAt).toBeNull();
    expect(retried?.errorMessage).toBeNull();

    const runningAgain = vault.claimNextTask('coding');
    expect(runningAgain?.taskUid).toBe(task.taskUid);

    const failedTwice = vault.failTask(task.taskUid, 'Permanent schema mismatch');
    expect(failedTwice?.status).toBe('failed');

    const exhausted = vault.retryTask(task.taskUid);
    expect(exhausted).toBeNull();

    const persisted = vault.getTask(task.taskUid);
    expect(persisted?.status).toBe('failed');
    expect(persisted?.retryCount).toBe(1);
    expect(persisted?.errorMessage).toBe('Permanent schema mismatch');
  });

  it('schedules post-save organize and enrich duties and links duplicate memories', async () => {
    const first = vault.saveMemory({
      title: 'Sync edge-case investigation',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'sync conflict investigation',
      summary: 'Documented the local-first sync race around duplicate writes and replay timing.',
      keywords: ['sync', 'conflict'],
      tags: ['sync', 'investigation'],
      relatedFiles: ['packages/core/src/services/save.service.ts'],
      sourceApp: 'codex',
    });

    const second = vault.saveMemory({
      title: 'Sync race follow-up',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'sync conflict investigation',
      summary: 'Sync race around duplicate writes.',
      tags: ['sync'],
      keywords: ['sync'],
      sourceApp: 'codex',
    });

    await flushAsyncWork();

    const dutyTasks = vault.findTasks({
      project: 'Vault',
      createdBy: 'system',
      status: 'pending',
      limit: 20,
    });
    const secondDutyTasks = dutyTasks.filter((task) => task.sourceMemoryUid === second.item.itemUid);

    expect(secondDutyTasks.map((task) => task.taskType).sort()).toEqual(['enrich', 'organize']);

    const duplicateScan = await vault.executeDuplicateDetection(second.item.itemUid);
    expect(duplicateScan.matches.length).toBeGreaterThan(0);
    expect(duplicateScan.matches[0]?.itemUid).toBe(first.item.itemUid);

    const secondDetail = vault.getMemoryDetail(second.item.itemUid);
    const firstDetail = vault.getMemoryDetail(first.item.itemUid);
    expect(secondDetail?.relatedItemIds).toContain(first.item.itemUid);
    expect(firstDetail?.relatedItemIds).toContain(second.item.itemUid);
  });

  it('merges memories into the kept item and rewrites references away from the archived item', () => {
    const keep = vault.saveMemory({
      title: 'Canonical sync guidance',
      project: 'Vault',
      memoryType: 'decision',
      subject: 'sync architecture guidance',
      summary: 'Use optimistic writes with deterministic conflict replay.',
      content: 'Primary guidance for conflict replay.',
      tags: ['sync', 'architecture'],
      keywords: ['sync', 'conflict'],
      sourceApp: 'codex',
    });

    const merge = vault.saveMemory({
      title: 'Older sync guidance',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'sync architecture guidance',
      summary: 'Use optimistic writes and reconcile duplicate operations during replay.',
      content: 'Older field notes for the same guidance.',
      tags: ['sync'],
      keywords: ['replay'],
      sourceApp: 'codex',
    });

    const referencing = vault.saveMemory({
      title: 'Sync implementation note',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'sync implementation note',
      summary: 'Implementation note tied to the older guidance.',
      relatedItemIds: [merge.item.itemUid],
      sourceApp: 'codex',
    });

    const result = vault.mergeMemoryItems(keep.item.itemUid, merge.item.itemUid);
    expect(result).not.toBeNull();
    expect(result?.archivedItem?.status).toBe('archived');
    expect(result?.updatedReferenceItemUids).toContain(referencing.item.itemUid);

    const keptDetail = vault.getMemoryDetail(keep.item.itemUid);
    const referencingDetail = vault.getMemoryDetail(referencing.item.itemUid);
    const mergedDetail = vault.getMemoryDetail(merge.item.itemUid);

    expect(keptDetail?.content).toContain('Older sync guidance');
    expect(referencingDetail?.relatedItemIds).toContain(keep.item.itemUid);
    expect(referencingDetail?.relatedItemIds).not.toContain(merge.item.itemUid);
    expect(mergedDetail?.status).toBe('archived');
  });

  it('archives stale low-signal items and auto-promotes heavily used or referenced memories', () => {
    const stale = vault.saveMemory({
      title: 'Temporary migration scratchpad',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'temporary migration note',
      summary: 'Short-lived scratchpad for migration sequencing.',
      sourceApp: 'codex',
    });

    const accessPromote = vault.saveMemory({
      title: 'Frequently reused debugging playbook',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'debugging playbook',
      summary: 'Checklist for debugging local memory regressions.',
      sourceApp: 'codex',
    });

    const referencePromote = vault.saveMemory({
      title: 'Important adapter reference',
      project: 'Vault',
      memoryType: 'reference',
      subject: 'adapter reference',
      summary: 'Reference note used by several implementation memories.',
      sourceApp: 'codex',
    });

    vault.saveMemory({
      title: 'Reference consumer one',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'consumer one',
      summary: 'Uses the adapter reference.',
      relatedItemIds: [referencePromote.item.itemUid],
      sourceApp: 'codex',
    });
    vault.saveMemory({
      title: 'Reference consumer two',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'consumer two',
      summary: 'Also uses the adapter reference.',
      relatedItemIds: [referencePromote.item.itemUid],
      sourceApp: 'codex',
    });
    vault.saveMemory({
      title: 'Reference consumer three',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'consumer three',
      summary: 'Another note using the adapter reference.',
      relatedItemIds: [referencePromote.item.itemUid],
      sourceApp: 'codex',
    });

    const db = (vault as unknown as { db: any }).db;
    db.update(memoryItems)
      .set({
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      })
      .where(eq(memoryItems.itemUid, stale.item.itemUid))
      .run();
    db.update(memoryItems)
      .set({
        accessCount: 10,
      })
      .where(eq(memoryItems.itemUid, accessPromote.item.itemUid))
      .run();

    // Tiered lifecycle: active → stale → archived. Pass 1 transitions active
    // → stale because the item is past activeToStaleDays and lightly used.
    const pass1 = vault.executeStaleArchival(30);
    expect(pass1.staledItemUids).toContain(stale.item.itemUid);
    expect(vault.getMemoryDetail(stale.item.itemUid)?.status).toBe('stale');

    // Rewind access timestamps past staleToArchivedDays so pass 2 can archive it.
    // getMemoryDetail above intentionally refreshes lastAccessedAt.
    db.update(memoryItems)
      .set({
        updatedAt: '2025-01-02T00:00:00.000Z',
        lastAccessedAt: '2025-01-02T00:00:00.000Z',
      })
      .where(eq(memoryItems.itemUid, stale.item.itemUid))
      .run();
    const pass2 = vault.executeStaleArchival(30);
    expect(pass2.archivedItemUids).toContain(stale.item.itemUid);
    expect(vault.getMemoryDetail(stale.item.itemUid)?.status).toBe('archived');

    const promotion = vault.executeAutoPromotion();
    expect(promotion.promotedItemUids).toContain(accessPromote.item.itemUid);
    expect(promotion.promotedItemUids).toContain(referencePromote.item.itemUid);

    const accessPromoteDetail = vault.getMemoryDetail(accessPromote.item.itemUid);
    const referencePromoteDetail = vault.getMemoryDetail(referencePromote.item.itemUid);
    expect(accessPromoteDetail?.status).toBe('promoted');
    expect(referencePromoteDetail?.status).toBe('promoted');
  });

  it('expands recall with related memories and proactive same-project context', async () => {
    const anchor = vault.saveMemory({
      title: 'Sync race diagnosis',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'sync race condition',
      summary: 'Detailed diagnosis of the sync race around duplicate writes and replay timing.',
      relatedItemIds: [],
      tags: ['sync', 'diagnosis'],
      keywords: ['sync', 'race'],
      sourceApp: 'codex',
    });

    const related = vault.saveMemory({
      title: 'Operator checklist note',
      project: 'Vault',
      memoryType: 'reference',
      subject: 'operator follow-up checklist',
      summary: 'Reference note linked from the anchor memory for follow-up review steps.',
      tags: ['checklist'],
      keywords: ['operator'],
      sourceApp: 'codex',
    });

    vault.updateMemory(anchor.item.itemUid, {
      relatedItemIds: [related.item.itemUid],
    });

    const promotedDecision = vault.saveMemory({
      title: 'Canonical sync decision',
      project: 'Vault',
      memoryType: 'decision',
      subject: 'sync strategy',
      summary: 'Canonical decision for deterministic sync conflict handling.',
      tags: ['sync', 'decision'],
      keywords: ['sync', 'conflict'],
      sourceApp: 'codex',
    });
    vault.promoteMemory(promotedDecision.item.itemUid);

    vault.saveMemory({
      title: 'Active sync plan',
      project: 'Vault',
      memoryType: 'plan',
      subject: 'sync improvements plan',
      summary: 'Active plan for sync hardening and replay validation.',
      status: 'active',
      tags: ['sync', 'plan'],
      keywords: ['sync', 'replay'],
      sourceApp: 'codex',
    });

    const pack = await vault.recallContext({
      project: 'Vault',
      subject: 'sync race condition',
      queryText: 'duplicate writes replay timing',
      limit: 3,
    });

    expect(pack.topMatches.some((match) => match.item.itemUid === anchor.item.itemUid)).toBe(true);
    expect(pack.related.map((item) => item.itemUid)).toContain(related.item.itemUid);
    expect(pack.topMatches.some((match) =>
      match.item.itemUid === related.item.itemUid && match.reasons.includes('related to Sync race diagnosis'),
    )).toBe(true);
    expect(
      pack.proactive.some((item) => item.itemUid === promotedDecision.item.itemUid)
      || pack.topMatches.some((match) => match.item.itemUid === promotedDecision.item.itemUid),
    ).toBe(true);
  });

  it('builds project briefings and creates summarize tasks for memory clusters', () => {
    const first = vault.saveMemory({
      title: 'Project kickoff handoff',
      project: 'Vault',
      memoryType: 'handoff',
      subject: 'kickoff handoff',
      summary: 'Latest handoff for the Vault project.',
      sourceApp: 'codex',
    });
    const second = vault.saveMemory({
      title: 'Design summary',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'design summary',
      summary: 'Summary of current design constraints.',
      sourceApp: 'codex',
    });
    const decision = vault.saveMemory({
      title: 'Important routing decision',
      project: 'Vault',
      memoryType: 'decision',
      subject: 'routing decision',
      summary: 'Important decision about task routing defaults.',
      tags: ['routing'],
      keywords: ['models'],
      sourceApp: 'codex',
    });
    vault.promoteMemory(decision.item.itemUid);

    const briefing = vault.getProjectBriefing('Vault', ['routing'], 5);
    expect(briefing.project).toBe('Vault');
    expect(briefing.promotedDecisions.map((item) => item.itemUid)).toContain(decision.item.itemUid);
    expect(briefing.recentHandoffs.map((item) => item.itemUid)).toContain(first.item.itemUid);
    expect(briefing.recentSummaries.map((item) => item.itemUid)).toContain(second.item.itemUid);

    const task = vault.requestClusterSummary(
      [first.item.itemUid, second.item.itemUid],
      'Focus on the current project state',
      'Vault',
    );
    expect(task).not.toBeNull();
    expect(task?.taskType).toBe('summarize');
    expect(task?.project).toBe('Vault');
    expect(task?.prompt).toContain('Focus: Focus on the current project state');
    expect(task?.context).toEqual(expect.objectContaining({
      item_uids: [first.item.itemUid, second.item.itemUid],
      cluster_summary: true,
    }));
  });
});

async function findCachedBetterSqlitePrebuild(): Promise<string | null> {
  const expectedSuffix = `better-sqlite3-v12.9.0-node-v${process.versions.modules}-${process.platform}-${process.arch}.tar.gz`;
  const cacheDirs = [
    join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm-cache', '_prebuilds'),
    join(homedir(), '.npm', '_prebuilds'),
  ];

  for (const cacheDir of cacheDirs) {
    if (!existsSync(cacheDir)) {
      continue;
    }

    const entries = await readdir(cacheDir);
    const match = entries.find((entry) => entry.endsWith(expectedSuffix));
    if (match) {
      return join(cacheDir, match);
    }
  }

  return null;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
