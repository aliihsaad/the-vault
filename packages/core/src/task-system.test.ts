import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import { Vault } from './index.js';
import { memoryItems, tasks } from './database/schema.js';

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
    execFileSync('tar', ['-xf', basename(cachedPrebuild), '-C', extractedNativeBindingDir.replace(/\\/g, '/')], {
      cwd: dirname(cachedPrebuild),
    });
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
    vault.createProject({
      name: 'Vault',
      projectType: 'work_project',
      description: 'Task-system fixture project.',
      canonicalRoot: vaultRoot,
    });
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
    expect(detail?.subject).toBe('Summarize migration notes');
    expect(detail?.summary).toContain('The migration is stable');
    expect(detail?.relatedItemIds).toContain('vm_source123');
    expect(detail?.relatedFiles).toContain('packages/core/src/services/task.service.ts');
    expect(detail?.content).toContain('Task UID:');
    expect(detail?.content).toContain('Result:');
  });

  it('requeues stale running tasks with retries left and fails ancient or exhausted ones', () => {
    const db = (vault as unknown as { db: any }).db;
    const backdate = (taskUid: string, startedAt: string) => {
      db.update(tasks)
        .set({ startedAt, updatedAt: startedAt })
        .where(eq(tasks.taskUid, taskUid))
        .run();
    };

    const requeueable = vault.createTask({
      title: 'Recently interrupted organize run',
      taskType: 'organize',
      prompt: 'Organize the latest session notes.',
      project: 'Vault',
      maxRetries: 2,
      createdBy: 'desktop',
    });
    const exhausted = vault.createTask({
      title: 'Interrupted run with no retries left',
      taskType: 'analysis',
      prompt: 'Analyze sync throughput.',
      project: 'Vault',
      maxRetries: 0,
      createdBy: 'desktop',
    });
    const ancient = vault.createTask({
      title: 'Task abandoned weeks ago',
      taskType: 'summarize',
      prompt: 'Summarize old migration notes.',
      project: 'Vault',
      maxRetries: 2,
      createdBy: 'desktop',
    });
    const fresh = vault.createTask({
      title: 'Task claimed moments ago',
      taskType: 'general',
      prompt: 'Currently executing.',
      project: 'Vault',
      createdBy: 'desktop',
    });

    // Claim everything so all four are 'running', then backdate the claims.
    for (let i = 0; i < 4; i += 1) vault.claimNextTask();
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    backdate(requeueable.taskUid, thirtyMinutesAgo);
    backdate(exhausted.taskUid, thirtyMinutesAgo);
    backdate(ancient.taskUid, thirtyDaysAgo);

    const recovery = vault.recoverStaleRunningTasks();
    expect(recovery.requeuedTaskUids).toEqual([requeueable.taskUid]);
    expect(recovery.failedTaskUids.sort()).toEqual([exhausted.taskUid, ancient.taskUid].sort());

    const requeued = vault.getTask(requeueable.taskUid);
    expect(requeued?.status).toBe('pending');
    expect(requeued?.retryCount).toBe(1);
    expect(requeued?.startedAt).toBeNull();

    expect(vault.getTask(exhausted.taskUid)?.status).toBe('failed');
    expect(vault.getTask(ancient.taskUid)?.status).toBe('failed');
    expect(vault.getTask(ancient.taskUid)?.errorMessage).toContain('abandoned');

    // The freshly claimed task is left alone — it may still be executing.
    expect(vault.getTask(fresh.taskUid)?.status).toBe('running');

    const stats = vault.getTaskQueueStats();
    expect(stats.running).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.failed).toBe(2);
  });

  it('never lets a completed or failed transition clobber a cancelled task', () => {
    const task = vault.createTask({
      title: 'Cancelled mid-flight organize run',
      taskType: 'organize',
      prompt: 'Organize the session log.',
      project: 'Vault',
      maxRetries: 2,
      createdBy: 'desktop',
    });

    const claimed = vault.claimNextTask();
    expect(claimed?.taskUid).toBe(task.taskUid);

    const cancelled = vault.cancelTask(task.taskUid);
    expect(cancelled?.status).toBe('cancelled');

    // Simulates the executor's in-flight LLM call returning after the cancel.
    expect(vault.completeTask(task.taskUid, 'Result arriving too late.')).toBeNull();
    expect(vault.failTask(task.taskUid, 'Late failure.')).toBeNull();
    expect(vault.retryTask(task.taskUid)).toBeNull();

    const persisted = vault.getTask(task.taskUid);
    expect(persisted?.status).toBe('cancelled');
    expect(persisted?.resultText).toBeNull();
  });

  it('persists recall-friendly task result memories: topical subject, clean summary, filtered keywords, context tags', () => {
    const task = vault.createTask({
      title: 'Merge the duplicate sync memories',
      taskType: 'organize',
      prompt: 'Review the duplicate sync investigation notes and recommend a merge target.',
      project: 'Vault',
      context: {
        tags: ['sync', 'deduplication'],
        keywords: ['duplicate-detection'],
      },
      createdBy: 'codex',
    });

    const noteResult = [
      'Executor note: No Vault mutations, file edits, or external actions were applied by this text task executor. Treat any requested merge/update/delete/archive/promote/save operation below as analysis or a recommendation unless separate tool metadata confirms it was applied.',
      '',
      'Recommend merging vm_b into vm_a because both cover the sync race.',
    ].join('\n');

    const completed = vault.completeTask(task.taskUid, noteResult);
    expect(completed?.targetMemoryUid).toMatch(/^vm_/);

    const detail = vault.getMemoryDetail(completed!.targetMemoryUid!);
    expect(detail?.subject).toBe('Merge the duplicate sync memories');
    // The executor boundary note must not consume the recall summary.
    expect(detail?.summary).not.toContain('Executor note');
    expect(detail?.summary).toContain('Recommend merging vm_b into vm_a');
    // The full content keeps the honest record, including the note.
    expect(detail?.content).toContain('Executor note');
    expect(detail?.tags).toEqual(expect.arrayContaining(['task-result', 'delegated', 'organize', 'sync', 'deduplication']));
    expect(detail?.keywords).toEqual(expect.arrayContaining(['organize', 'duplicate-detection', 'merge', 'duplicate', 'sync']));
    expect(detail?.keywords).not.toContain('the');
    expect(detail?.routineType).toBe('refactor');
  });

  it('skips result memory persistence when the task opts out via skipResultMemory', () => {
    const task = vault.createTask({
      title: 'Ephemeral scratch analysis',
      taskType: 'analysis',
      prompt: 'One-off throwaway analysis.',
      project: 'Vault',
      context: { skipResultMemory: true },
      createdBy: 'codex',
    });

    const completed = vault.completeTask(task.taskUid, 'Throwaway result.');
    expect(completed?.status).toBe('completed');
    expect(completed?.targetMemoryUid).toBeNull();
    expect(completed?.resultMetadata?.savedMemoryUid).toBeUndefined();
  });

  it('retries failed tasks until max retries is reached', () => {
    const task = vault.createTask({
      title: 'Draft implementation outline',
      taskType: 'coding',
      prompt: 'Draft an implementation outline for task persistence.',
      project: 'Vault',
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

  it('routes saves to the project inferred from absolute related file paths', () => {
    vault.createProject({ name: 'the-vault', projectType: 'work_project', description: 'Vault test project', canonicalRoot: vaultRoot });
    vault.createProject({ name: 'Social-Media-Manager-AI-Tool', projectType: 'work_project', description: 'Social test project', canonicalRoot: vaultRoot });

    const result = vault.saveMemory({
      title: 'Rewrote The Vault README',
      project: 'Social-Media-Manager-AI-Tool',
      memoryType: 'session',
      subject: 'The Vault README documentation overhaul',
      summary: 'Updated The Vault README with feature and setup guidance.',
      relatedFiles: ['C:/Users/Mini/Desktop/Projects/the-vault/README.md'],
      sourceApp: 'codex',
    });

    expect(result.item.project).toBe('the-vault');
    expect(result.vaultPath.replace(/\\/g, '/')).toContain('/projects/the-vault/sessions/');
  });

  it('keeps the requested project when related file paths do not identify one project', () => {
    vault.createProject({ name: 'the-vault', projectType: 'work_project', description: 'Vault test project', canonicalRoot: vaultRoot });
    vault.createProject({ name: 'Social-Media-Manager-AI-Tool', projectType: 'work_project', description: 'Social test project', canonicalRoot: vaultRoot });

    const result = vault.saveMemory({
      title: 'Cross-project integration note',
      project: 'Social-Media-Manager-AI-Tool',
      memoryType: 'session',
      subject: 'integration note',
      summary: 'Saved a note that references files from more than one project.',
      relatedFiles: [
        'C:/Users/Mini/Desktop/Projects/the-vault/README.md',
        'C:/Users/Mini/Desktop/Projects/social-media-manager-ai-tool/README.md',
      ],
      sourceApp: 'codex',
    });

    expect(result.item.project).toBe('Social-Media-Manager-AI-Tool');
    expect(result.vaultPath.replace(/\\/g, '/')).toContain('/projects/social-media-manager-ai-tool/sessions/');
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

  it('treats an explicit memory UID as a high-confidence recall signal', async () => {
    const target = vault.saveMemory({
      title: 'UID-targeted implementation handoff',
      project: 'Vault',
      memoryType: 'handoff',
      subject: 'quiet implementation detail',
      summary: 'This memory has intentionally generic copy so only its UID should identify it.',
      sourceApp: 'codex',
    });

    const distractor = vault.saveMemory({
      title: 'Promoted unrelated architecture decision',
      project: 'Vault',
      memoryType: 'decision',
      subject: 'unrelated promoted decision',
      summary: 'This promoted memory should not outrank an exact UID lookup.',
      priority: 'critical',
      sourceApp: 'codex',
    });
    vault.promoteMemory(distractor.item.itemUid);

    const pack = await vault.recallContext({
      queryText: `please recall ${target.item.itemUid}`,
      limit: 1,
    });

    expect(pack.topMatches[0]?.item.itemUid).toBe(target.item.itemUid);
    expect(pack.topMatches[0]?.reasons).toContain('exact memory UID match');
  });

  it('logs agent retrieval tools as recall activity only when explicitly requested', () => {
    const saved = vault.saveMemory({
      title: 'Agent recall telemetry note',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'agent recall telemetry',
      summary: 'Verifies MCP read tools show up as recall activity without desktop self-noise.',
      tags: ['telemetry'],
      keywords: ['recall', 'activity'],
      sourceApp: 'codex',
    });

    vault.getLatest('Vault', 5);
    vault.getMemoryDetail(saved.item.itemUid);
    vault.getProjectBriefing('Vault', ['telemetry'], 5);
    expect(vault.getRecentLogs(20, { actionType: 'recall' })).toHaveLength(0);

    vault.getLatest('Vault', 5, { logActivity: true, sourceClient: 'mcp' });
    vault.getMemoryDetail(saved.item.itemUid, { logActivity: true, sourceClient: 'mcp' });
    vault.getProjectBriefing('Vault', ['telemetry'], 5, { logActivity: true, sourceClient: 'mcp' });

    const recallLogs = vault.getRecentLogs(10, { actionType: 'recall' });
    expect(recallLogs).toHaveLength(3);
    expect(recallLogs.map((log) => log.sourceClient)).toEqual(['mcp', 'mcp', 'mcp']);
    expect(recallLogs.map((log) => log.project)).toEqual(['Vault', 'Vault', 'Vault']);
    expect(recallLogs.map((log) => log.metadata?.recallKind).sort()).toEqual([
      'detail',
      'latest',
      'project_briefing',
    ]);
  });

  it('applies enrich duty JSON suggestions back to the source memory with validation', async () => {
    const saved = vault.saveMemory({
      title: 'Sync retry backoff fix',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'sync retry backoff',
      summary: 'Fixed the retry backoff.',
      tags: ['sync'],
      keywords: ['retry'],
      sourceApp: 'codex',
    });
    await flushAsyncWork();

    const enrichTask = vault.findTasks({ project: 'Vault', taskType: 'enrich', limit: 10 })
      .find((task) => task.sourceMemoryUid === saved.item.itemUid);
    expect(enrichTask).toBeDefined();
    expect(enrichTask?.context.skipResultMemory).toBe(true);
    expect(enrichTask?.prompt).toContain('Return ONLY a JSON object');

    // Simulates the executor result: annotation note followed by model JSON.
    const resultText = [
      'Executor note: No Vault mutations, file edits, or external actions were applied by this text task executor.',
      '',
      JSON.stringify({
        summary: 'Fixed the sync retry backoff so failed pushes retry with exponential delay instead of hammering the server in a tight loop.',
        tags: ['sync', 'backoff', 'bugfix'],
        keywords: ['retry', 'exponential-backoff', 'sync'],
        next_steps: ['Verify retry timing under packet loss'],
      }),
    ].join('\n');
    const completed = vault.completeTask(enrichTask!.taskUid, resultText);
    // skipResultMemory: duty output must not become a standalone memory.
    expect(completed?.targetMemoryUid).toBe(saved.item.itemUid);
    expect(completed?.resultMetadata?.savedMemoryUid).toBeUndefined();

    const applyResult = vault.applyDutyTaskResult(enrichTask!.taskUid);
    expect(applyResult.applied).toBe(true);
    expect(applyResult.appliedFields.sort()).toEqual(['keywords', 'summary', 'tags']);

    const detail = vault.getMemoryDetail(saved.item.itemUid);
    expect(detail?.summary).toContain('exponential delay');
    expect(detail?.tags).toEqual(expect.arrayContaining(['sync', 'backoff', 'bugfix']));
    expect(detail?.keywords).toEqual(expect.arrayContaining(['retry', 'exponential-backoff']));
    expect(detail?.nextSteps).toEqual([]);

    const taskAfter = vault.getTask(enrichTask!.taskUid);
    expect(taskAfter?.resultMetadata?.dutyApplied).toBe(true);
  });

  it('applies organize duty metadata additively but never prose or merges', async () => {
    const saved = vault.saveMemory({
      title: 'Adapter wiring session',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'adapter wiring for local resume',
      summary: 'Wired the local adapter resume flow end to end with checkpoint validation and rollback safety checks.',
      sourceApp: 'codex',
    });
    await flushAsyncWork();

    const organizeTask = vault.findTasks({ project: 'Vault', taskType: 'organize', limit: 10 })
      .find((task) => task.sourceMemoryUid === saved.item.itemUid);
    expect(organizeTask).toBeDefined();

    const originalSummary = vault.getMemoryDetail(saved.item.itemUid)!.summary;
    vault.completeTask(organizeTask!.taskUid, JSON.stringify({
      summary: 'A totally different summary the organize duty must not be allowed to apply over the original.',
      tags: ['adapter', 'resume'],
      keywords: ['checkpoint', 'rollback'],
      duplicate_actions: [{ item_uid: 'vm_fake', action: 'merge', rationale: 'should never auto-run' }],
    }));

    const applyResult = vault.applyDutyTaskResult(organizeTask!.taskUid);
    expect(applyResult.applied).toBe(true);
    expect(applyResult.appliedFields.sort()).toEqual(['keywords', 'tags']);

    const detail = vault.getMemoryDetail(saved.item.itemUid);
    expect(detail?.summary).toBe(originalSummary);
    expect(detail?.tags).toEqual(expect.arrayContaining(['adapter', 'resume']));
    expect(detail?.keywords).toEqual(expect.arrayContaining(['checkpoint', 'rollback']));
    expect(detail?.status).not.toBe('archived');
  });

  it('rejects unusable duty results without touching the memory', async () => {
    const saved = vault.saveMemory({
      title: 'Short note',
      project: 'Vault',
      memoryType: 'summary',
      subject: 'short note',
      summary: 'Tiny.',
      tags: ['note'],
      sourceApp: 'codex',
    });
    await flushAsyncWork();

    const enrichTask = vault.findTasks({ project: 'Vault', taskType: 'enrich', limit: 10 })
      .find((task) => task.sourceMemoryUid === saved.item.itemUid);
    vault.completeTask(enrichTask!.taskUid, 'The model rambled and returned no JSON at all.');

    const applyResult = vault.applyDutyTaskResult(enrichTask!.taskUid);
    expect(applyResult.applied).toBe(false);
    expect(applyResult.reason).toBe('unparseable_result');

    const detail = vault.getMemoryDetail(saved.item.itemUid);
    expect(detail?.summary).toBe('Tiny.');
    expect(detail?.tags).toEqual(['note']);

    const taskAfter = vault.getTask(enrichTask!.taskUid);
    expect(taskAfter?.resultMetadata?.dutyApplied).toBe(false);
    expect(taskAfter?.resultMetadata?.dutyApplyReason).toBe('unparseable_result');
  });

  it('refuses to apply duty results to non-duty tasks', () => {
    const task = vault.createTask({
      title: 'Regular user task',
      taskType: 'enrich',
      prompt: 'A user-created enrich task with no duty context.',
      project: 'Vault',
      createdBy: 'codex',
    });
    vault.completeTask(task.taskUid, JSON.stringify({ tags: ['should-not-apply'] }));

    const applyResult = vault.applyDutyTaskResult(task.taskUid);
    expect(applyResult.applied).toBe(false);
    expect(applyResult.reason).toBe('not_a_duty_task');
  });

  it('skips description proposals entirely when no enrichment client is available', async () => {
    vault.setEnrichmentClient(null);

    for (let i = 0; i < 3; i += 1) {
      vault.saveMemory({
        title: `Setup note ${i}`,
        project: 'DescriptionlessProject',
        memoryType: 'summary',
        subject: `setup topic ${i}`,
        summary: `Setup summary number ${i} for the description review test.`,
        sourceApp: 'codex',
      });
    }

    const review = await vault.executeProjectReview('DescriptionlessProject', { force: true });
    // No AI available → no proposal at all, never item-count boilerplate.
    expect(review.proposalsCreated.filter((p) => p.proposalType === 'description')).toHaveLength(0);
  });

  it('drafts project descriptions from high-signal items and excludes task-result noise', async () => {
    const prompts: string[] = [];
    vault.setEnrichmentClient({
      isAvailable: () => true,
      complete: async (params) => {
        prompts.push(params.userPrompt);
        return {
          text: 'ReviewedProject is a local-first sync engine with deterministic conflict replay.',
          model: 'mock-model',
          usage: { promptTokens: 0, completionTokens: 0 },
        };
      },
    });

    try {
      const decision = vault.saveMemory({
        title: 'Adopt deterministic conflict replay',
        project: 'ReviewedProject',
        memoryType: 'decision',
        subject: 'conflict replay strategy',
        summary: 'Sync conflicts resolve through deterministic replay of operations.',
        tags: ['sync', 'architecture'],
        sourceApp: 'codex',
      });
      vault.promoteMemory(decision.item.itemUid);

      vault.saveMemory({
        title: 'Sync hardening plan',
        project: 'ReviewedProject',
        memoryType: 'plan',
        subject: 'sync hardening',
        summary: 'Plan for hardening the sync layer against replay races.',
        tags: ['sync', 'plan'],
        sourceApp: 'codex',
      });

      vault.saveMemory({
        title: 'Delegated organize output',
        project: 'ReviewedProject',
        memoryType: 'summary',
        subject: 'delegated organize output',
        summary: 'Noise from a delegated agent task that says nothing about the project.',
        tags: ['task-result', 'delegated'],
        sourceApp: 'other',
      });

      const review = await vault.executeProjectReview('ReviewedProject', { force: true });
      const descriptionProposal = review.proposalsCreated.find((p) => p.proposalType === 'description');
      expect(descriptionProposal).toBeDefined();
      expect(JSON.stringify(descriptionProposal?.payload)).toContain('deterministic conflict replay');

      const prompt = prompts.at(-1) ?? '';
      expect(prompt).toContain('Adopt deterministic conflict replay');
      expect(prompt).toContain('Sync hardening plan');
      expect(prompt).not.toContain('Delegated organize output');
      expect(prompt).toContain('Repeated project terms: sync');
    } finally {
      vault.setEnrichmentClient(null);
    }
  });

  it('retries cropped description drafts and stores only complete validated text', async () => {
    const prompts: string[] = [];
    let attempts = 0;
    vault.setEnrichmentClient({
      isAvailable: () => true,
      complete: async (params) => {
        if (!params.systemPrompt.includes('validated project metadata')) {
          return {
            text: '{}',
            model: 'mock-model',
            usage: { promptTokens: 0, completionTokens: 0 },
          };
        }
        prompts.push(params.userPrompt);
        attempts += 1;
        if (attempts === 1) {
          return {
            text: 'This project is a personal',
            model: 'mock-model',
            finishReason: 'length',
            usage: { promptTokens: 0, completionTokens: 0 },
          };
        }
        return {
          text: '{"description":"DescriptionRetry is a local-first portfolio platform for publishing animated case studies and maintaining its project catalog."}',
          model: 'mock-model',
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0 },
        };
      },
    });

    try {
      const identityMarker = 'WHOLE_PROJECT_IDENTITY_MARKER';
      const longSummary = `${'Stable portfolio architecture and publishing workflow. '.repeat(5)}${identityMarker} The platform maintains case studies, navigation, and project metadata.`;
      vault.saveMemory({
        title: 'Portfolio platform identity',
        project: 'DescriptionRetry',
        memoryType: 'decision',
        subject: 'stable portfolio purpose',
        summary: longSummary,
        tags: ['portfolio', 'publishing'],
        sourceApp: 'codex',
      });
      vault.saveMemory({
        title: 'Case study catalog',
        project: 'DescriptionRetry',
        memoryType: 'reference',
        subject: 'case study publishing catalog',
        summary: 'The platform publishes animated case studies from a maintained project catalog.',
        tags: ['portfolio', 'publishing'],
        sourceApp: 'codex',
      });
      vault.saveMemory({
        title: 'Local content workflow',
        project: 'DescriptionRetry',
        memoryType: 'plan',
        subject: 'local-first content workflow',
        summary: 'Project content is maintained locally before it is published to the portfolio.',
        tags: ['portfolio', 'content'],
        sourceApp: 'codex',
      });

      const review = await vault.executeProjectReview('DescriptionRetry', { force: true });
      const proposal = review.proposalsCreated.find((candidate) => candidate.proposalType === 'description');

      expect(attempts).toBe(2);
      expect(proposal?.payload).toEqual({
        type: 'description',
        description: 'DescriptionRetry is a local-first portfolio platform for publishing animated case studies and maintaining its project catalog.',
      });
      expect(proposal?.evidenceItemUids.length).toBeGreaterThanOrEqual(2);
      expect(proposal?.confidence).toBe(70);
      expect(prompts[0]).toContain(identityMarker);
      expect(prompts[1]).toContain('provider hit its token limit');
    } finally {
      vault.setEnrichmentClient(null);
    }
  });

  it('rejects prompt echoes and incomplete description fragments instead of filing proposals', async () => {
    let attempts = 0;
    vault.setEnrichmentClient({
      isAvailable: () => true,
      complete: async (params) => {
        if (!params.systemPrompt.includes('validated project metadata')) {
          return {
            text: '{}',
            model: 'mock-model',
            usage: { promptTokens: 0, completionTokens: 0 },
          };
        }
        attempts += 1;
        return attempts === 1
          ? {
              text: 'We need to output one or two sentences max 360 characters based on the key items.',
              model: 'mock-model',
              usage: { promptTokens: 0, completionTokens: 0 },
            }
          : {
              text: 'DescriptionInvalid is a dashboard for',
              model: 'mock-model',
              usage: { promptTokens: 0, completionTokens: 0 },
            };
      },
    });

    try {
      for (let index = 0; index < 3; index += 1) {
        vault.saveMemory({
          title: `Dashboard architecture ${index}`,
          project: 'DescriptionInvalid',
          memoryType: index === 0 ? 'decision' : 'summary',
          subject: `dashboard architecture concern ${index}`,
          summary: `Stable dashboard evidence number ${index} for the invalid description test.`,
          tags: ['dashboard', 'architecture'],
          sourceApp: 'codex',
        });
      }

      const review = await vault.executeProjectReview('DescriptionInvalid', { force: true });

      expect(attempts).toBe(2);
      expect(review.proposalsCreated.filter((proposal) => proposal.proposalType === 'description')).toHaveLength(0);
    } finally {
      vault.setEnrichmentClient(null);
    }
  });

  it('rejects fluent descriptions that are not grounded in the project evidence', async () => {
    let attempts = 0;
    vault.setEnrichmentClient({
      isAvailable: () => true,
      complete: async (params) => {
        if (!params.systemPrompt.includes('validated project metadata')) {
          return {
            text: '{}',
            model: 'mock-model',
            usage: { promptTokens: 0, completionTokens: 0 },
          };
        }
        attempts += 1;
        return {
          text: 'GroundingCheck is a blockchain trading platform for cryptocurrency portfolio analytics.',
          model: 'mock-model',
          usage: { promptTokens: 0, completionTokens: 0 },
        };
      },
    });

    try {
      for (let index = 0; index < 3; index += 1) {
        vault.saveMemory({
          title: `Restaurant menu workflow ${index}`,
          project: 'GroundingCheck',
          memoryType: index === 0 ? 'decision' : 'summary',
          subject: `restaurant ordering concern ${index}`,
          summary: `Voice waiter routes table orders and menu selections to the kitchen queue, evidence ${index}.`,
          tags: ['restaurant', 'menu', 'ordering'],
          sourceApp: 'codex',
        });
      }

      const review = await vault.executeProjectReview('GroundingCheck', { force: true });

      expect(attempts).toBe(2);
      expect(review.proposalsCreated.filter((proposal) => proposal.proposalType === 'description')).toHaveLength(0);
    } finally {
      vault.setEnrichmentClient(null);
    }
  });

  it('detects established duplicate projects with unrelated names from project-wide evidence', async () => {
    vault.setEnrichmentClient(null);
    vault.createProject({
      name: 'Talabie AI Waiter',
      projectType: 'work_project',
      description: 'Voice-driven restaurant ordering and menu management with Supabase.',
      canonicalRoot: join(vaultRoot, 'talabie-waiter'),
    });
    vault.createProject({
      name: 'Dining Concierge Console',
      projectType: 'work_project',
      description: 'Restaurant voice assistant for menu selection, table orders, and kitchen tickets.',
      canonicalRoot: join(vaultRoot, 'dining-console'),
    });

    const sharedFiles = ['src/order-router.ts', 'src/menu-service.ts'];
    const saveRestaurantMemory = (
      project: string,
      index: number,
      title: string,
      summary: string,
    ) => vault.saveMemory({
      title,
      project,
      memoryType: index === 0 ? 'decision' : 'summary',
      subject: title,
      summary,
      tags: ['restaurant', 'menu', 'ordering', 'supabase'],
      keywords: ['restaurant', 'menu', 'ordering', 'waiter'],
      relatedFiles: sharedFiles,
      sourceApp: 'codex',
    });

    saveRestaurantMemory('Talabie AI Waiter', 0, 'Table order routing', 'Routes restaurant table orders through the AI waiter.');
    saveRestaurantMemory('Talabie AI Waiter', 1, 'Menu availability sync', 'Synchronizes menu availability and prices with Supabase.');
    saveRestaurantMemory('Talabie AI Waiter', 2, 'Kitchen ticket flow', 'Sends confirmed dining orders to the kitchen queue.');
    saveRestaurantMemory('Talabie AI Waiter', 3, 'Voice waiter intent', 'Maps guest speech to menu items and restaurant actions.');

    saveRestaurantMemory('Dining Concierge Console', 0, 'Guest order pipeline', 'Routes voice menu selections into restaurant table orders.');
    saveRestaurantMemory('Dining Concierge Console', 1, 'Supabase menu catalog', 'Keeps menu prices and availability synchronized in Supabase.');
    saveRestaurantMemory('Dining Concierge Console', 2, 'Kitchen queue delivery', 'Delivers confirmed waiter orders to the kitchen ticket queue.');
    saveRestaurantMemory('Dining Concierge Console', 3, 'Dining intent parser', 'Maps guest speech into menu item and restaurant commands.');
    saveRestaurantMemory('Dining Concierge Console', 4, 'Table session state', 'Tracks active dining table sessions for the voice waiter.');

    const review = await vault.executeProjectReview('Talabie AI Waiter', { force: true });
    const proposal = review.proposalsCreated.find((candidate) => candidate.proposalType === 'merge');

    expect(proposal?.payload).toEqual({
      type: 'merge',
      sourceProject: 'Talabie AI Waiter',
      targetProject: 'Dining Concierge Console',
      relocateFiles: true,
    });
    expect(proposal?.confidence).toBeGreaterThanOrEqual(80);
    expect(proposal?.rationale).toMatch(/memory-topic overlap|shared file evidence/);
    expect(proposal?.evidenceItemUids).toHaveLength(4);
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
