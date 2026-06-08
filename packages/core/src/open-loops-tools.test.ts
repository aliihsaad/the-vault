import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Vault } from './index.js';
import { activityLogs, memoryItems } from './database/schema.js';
import type {
  CountOpenLoopsInput,
  CountOpenLoopsResult,
  ListOpenLoopsInput,
  ListOpenLoopsResult,
  ResolveLoopBatchInput,
  ResolveLoopBatchResult,
  SaveMemoryInput,
  SaveMemoryResult,
} from './types/index.js';

type OpenLoopToolVault = Vault & {
  listOpenLoops(input?: ListOpenLoopsInput): ListOpenLoopsResult;
  countOpenLoops(input?: CountOpenLoopsInput): CountOpenLoopsResult;
  resolveLoopBatch(input: ResolveLoopBatchInput): ResolveLoopBatchResult;
};

describe('open loop tools', () => {
  let vaultRoot: string;
  let vault: OpenLoopToolVault;
  let extractedNativeBindingDir: string | null = null;
  const previousNativeBinding = process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING;

  beforeAll(async () => {
    const cachedPrebuild = await findCachedBetterSqlitePrebuild();
    if (!cachedPrebuild) {
      return;
    }

    extractedNativeBindingDir = await mkdtemp(join(tmpdir(), 'vault-open-loops-sqlite-native-'));
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
    vaultRoot = await mkdtemp(join(tmpdir(), 'vault-open-loops-test-'));
    vault = new Vault(vaultRoot) as OpenLoopToolVault;
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

  it('lists explicit open loops exhaustively across pages while recall remains capped', async () => {
    const saved: SaveMemoryResult[] = [];
    for (let index = 0; index < 7; index += 1) {
      const item = saveMemory({
        title: `Paged loop ${index}`,
        project: 'PaginationProject',
        nextSteps: [`Do item ${index}`],
      });
      setMemoryTimes(item.item.itemUid, `2026-01-0${index + 1}T00:00:00.000Z`);
      saved.push(item);
    }

    const recall = await vault.recallContext({ project: 'PaginationProject', queryText: 'paged loops' });
    expect(recall.openLoops).toHaveLength(5);

    const firstPage = vault.listOpenLoops({ project: 'PaginationProject', limit: 3, offset: 0 });
    expect(firstPage.total).toBe(7);
    expect(firstPage.limit).toBe(3);
    expect(firstPage.offset).toBe(0);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.items.map((item) => item.itemUid)).toEqual(
      saved.slice(0, 3).map((item) => item.item.itemUid),
    );

    const finalPage = vault.listOpenLoops({ project: 'PaginationProject', limit: 3, offset: 6 });
    expect(finalPage.total).toBe(7);
    expect(finalPage.hasMore).toBe(false);
    expect(finalPage.items.map((item) => item.itemUid)).toEqual([saved[6].item.itemUid]);
  });

  it('filters list results by project, priority, and all requested tags in oldest-first order', () => {
    const first = saveMemory({
      title: 'First matching loop',
      project: 'FilterProject',
      priority: 'high',
      tags: ['backend', 'loop'],
      nextSteps: ['First matching step'],
    });
    const second = saveMemory({
      title: 'Second matching loop',
      project: 'FilterProject',
      priority: 'high',
      tags: ['backend', 'loop', 'extra'],
      nextSteps: ['Second matching step'],
    });
    saveMemory({
      title: 'Wrong tag loop',
      project: 'FilterProject',
      priority: 'high',
      tags: ['backend'],
      nextSteps: ['Wrong tag step'],
    });
    saveMemory({
      title: 'Wrong priority loop',
      project: 'FilterProject',
      priority: 'normal',
      tags: ['backend', 'loop'],
      nextSteps: ['Wrong priority step'],
    });
    saveMemory({
      title: 'Wrong project loop',
      project: 'OtherProject',
      priority: 'high',
      tags: ['backend', 'loop'],
      nextSteps: ['Wrong project step'],
    });
    setMemoryTimes(first.item.itemUid, '2026-01-01T00:00:00.000Z');
    setMemoryTimes(second.item.itemUid, '2026-01-02T00:00:00.000Z');

    const result = vault.listOpenLoops({
      project: 'FilterProject',
      priority: 'high',
      tags: ['Backend', 'Loop'],
      limit: 10,
    });

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.itemUid)).toEqual([
      first.item.itemUid,
      second.item.itemUid,
    ]);
  });

  it('uses status active plus parsed non-empty next_steps_json as the explicit open-loop predicate', () => {
    const active = saveMemory({
      title: 'Active explicit loop',
      project: 'PredicateProject',
      nextSteps: ['Ship the explicit loop'],
    });
    const legacy = saveMemory({
      title: 'Legacy plain text loop',
      project: 'PredicateProject',
      nextSteps: ['Will be overwritten'],
    });
    setRawNextSteps(legacy.item.itemUid, 'legacy plain text step');

    const resolved = saveMemory({
      title: 'Resolved loop with retained next steps',
      project: 'PredicateProject',
      nextSteps: ['Historical step remains'],
    });
    expect(vault.resolveLoop({
      itemUid: resolved.item.itemUid,
      outcome: 'fixed',
      resolutionNote: 'Done in the setup.',
    })?.status).toBe('resolved');

    const archived = saveMemory({
      title: 'Archived loop',
      project: 'PredicateProject',
      nextSteps: ['Archived step'],
    });
    vault.archiveMemory(archived.item.itemUid);

    const pendingDelete = saveMemory({
      title: 'Pending delete loop',
      project: 'PredicateProject',
      nextSteps: ['Pending delete step'],
    });
    vault.archiveMemory(pendingDelete.item.itemUid);
    vault.markMemoryPendingDelete(pendingDelete.item.itemUid);

    saveMemory({
      title: 'Empty next steps loop',
      project: 'PredicateProject',
      nextSteps: [],
    });
    const blank = saveMemory({
      title: 'Blank raw next steps loop',
      project: 'PredicateProject',
      nextSteps: ['Will be blanked'],
    });
    setRawNextSteps(blank.item.itemUid, '   ');
    saveMemory({
      title: 'Debugging without explicit next steps',
      project: 'PredicateProject',
      routineType: 'debugging',
      nextSteps: [],
    });

    const result = vault.listOpenLoops({ project: 'PredicateProject', limit: 20 });

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.itemUid)).toEqual([
      active.item.itemUid,
      legacy.item.itemUid,
    ]);
    expect(result.items[1].nextSteps).toEqual(['legacy plain text step']);
  });

  it('counts active explicit open loops and ignores resolved rows with retained next_steps_json', () => {
    saveMemory({
      title: 'Counted loop one',
      project: 'CountProject',
      nextSteps: ['Count me'],
    });
    saveMemory({
      title: 'Counted loop two',
      project: 'CountProject',
      nextSteps: ['Count me too'],
    });
    const resolved = saveMemory({
      title: 'Resolved retained next steps',
      project: 'CountProject',
      nextSteps: ['Still in storage'],
    });
    vault.resolveLoop({
      itemUid: resolved.item.itemUid,
      outcome: 'obsolete',
      resolutionNote: 'No longer needed.',
    });

    expect(vault.countOpenLoops({ project: 'CountProject' })).toEqual(expect.objectContaining({
      total: 2,
    }));
  });

  it('groups count results by project using the same predicate as list', () => {
    saveMemory({ title: 'Alpha loop one', project: 'Alpha', nextSteps: ['A1'] });
    saveMemory({ title: 'Alpha loop two', project: 'Alpha', nextSteps: ['A2'] });
    saveMemory({ title: 'Beta loop', project: 'Beta', nextSteps: ['B1'] });
    saveMemory({ title: 'Beta empty loop', project: 'Beta', nextSteps: [] });
    const resolved = saveMemory({ title: 'Gamma resolved loop', project: 'Gamma', nextSteps: ['G1'] });
    vault.resolveLoop({ itemUid: resolved.item.itemUid, outcome: 'duplicate' });

    const result = vault.countOpenLoops({ byProject: true });

    expect(result.total).toBe(3);
    expect(result.byProject).toEqual({
      Alpha: 2,
      Beta: 1,
    });
  });

  it('keeps count filters consistent with list results and decreases after resolution', () => {
    const first = saveMemory({
      title: 'Filtered count one',
      project: 'CountFilterProject',
      priority: 'critical',
      tags: ['cleanup', 'batch'],
      nextSteps: ['Resolve one'],
    });
    saveMemory({
      title: 'Filtered count two',
      project: 'CountFilterProject',
      priority: 'critical',
      tags: ['cleanup', 'batch'],
      nextSteps: ['Resolve two'],
    });
    saveMemory({
      title: 'Filtered count wrong tag',
      project: 'CountFilterProject',
      priority: 'critical',
      tags: ['cleanup'],
      nextSteps: ['Do not count'],
    });

    const filters = {
      project: 'CountFilterProject',
      priority: 'critical' as const,
      tags: ['cleanup', 'batch'],
    };
    expect(vault.countOpenLoops(filters).total).toBe(vault.listOpenLoops({ ...filters, limit: 1000 }).total);

    vault.resolveLoop({ itemUid: first.item.itemUid, outcome: 'fixed' });

    expect(vault.countOpenLoops(filters).total).toBe(1);
  });

  it('resolves multiple open loops through the existing resolve path', () => {
    const first = saveMemory({
      title: 'Batch happy path one',
      project: 'BatchProject',
      nextSteps: ['Resolve first'],
    });
    const second = saveMemory({
      title: 'Batch happy path two',
      project: 'BatchProject',
      nextSteps: ['Resolve second'],
    });

    const result = vault.resolveLoopBatch({
      items: [
        {
          itemUid: first.item.itemUid,
          outcome: 'fixed',
          resolutionNote: 'First loop completed.',
        },
        {
          itemUid: second.item.itemUid,
          outcome: 'obsolete',
          resolutionNote: 'Second loop is obsolete.',
        },
      ],
    });

    expect(result.requested).toBe(2);
    expect(result.resolved).toEqual([first.item.itemUid, second.item.itemUid]);
    expect(result.failed).toEqual([]);
    expect(vault.getMemoryDetail(first.item.itemUid)?.status).toBe('resolved');
    expect(vault.getMemoryDetail(second.item.itemUid)?.outcome).toBe('obsolete');
    expect(vault.getMemoryDetail(first.item.itemUid)?.content).toContain('First loop completed.');
    expect(getResolveLoopLogCount(first.item.itemUid)).toBe(1);
    expect(getResolveLoopLogCount(second.item.itemUid)).toBe(1);
    expect(vault.listOpenLoops({ project: 'BatchProject' }).total).toBe(0);
    expect(vault.countOpenLoops({ project: 'BatchProject' }).total).toBe(0);
  });

  it('allows partial success when one batch item is missing', () => {
    const valid = saveMemory({
      title: 'Batch partial valid loop',
      project: 'BatchPartialProject',
      nextSteps: ['Resolve valid item'],
    });

    const result = vault.resolveLoopBatch({
      items: [
        {
          itemUid: valid.item.itemUid,
          outcome: 'fixed',
        },
        {
          itemUid: 'vm_missing_open_loop',
          outcome: 'wont_fix',
          resolutionNote: 'Missing from storage.',
        },
      ],
    });

    expect(result.resolved).toEqual([valid.item.itemUid]);
    expect(result.failed).toEqual([{
      itemUid: 'vm_missing_open_loop',
      reason: 'not_found',
      message: 'Memory item not found.',
    }]);
    expect(vault.getMemoryDetail(valid.item.itemUid)?.status).toBe('resolved');
  });

  it('rejects duplicate batch entries and found rows that are not open loops', () => {
    const valid = saveMemory({
      title: 'Batch duplicate valid loop',
      project: 'BatchGuardProject',
      nextSteps: ['Resolve once'],
    });
    const noSteps = saveMemory({
      title: 'Batch no steps loop',
      project: 'BatchGuardProject',
      nextSteps: [],
    });

    const result = vault.resolveLoopBatch({
      items: [
        {
          itemUid: valid.item.itemUid,
          outcome: 'fixed',
        },
        {
          itemUid: valid.item.itemUid,
          outcome: 'duplicate',
          resolutionNote: 'Duplicate request entry.',
        },
        {
          itemUid: noSteps.item.itemUid,
          outcome: 'wont_fix',
          resolutionNote: 'No explicit next steps.',
        },
      ],
    });

    expect(result.resolved).toEqual([valid.item.itemUid]);
    expect(result.failed).toEqual([
      {
        itemUid: valid.item.itemUid,
        reason: 'duplicate_item_uid',
        message: 'Duplicate item_uid in batch request.',
      },
      {
        itemUid: noSteps.item.itemUid,
        reason: 'not_open_loop',
        message: 'Memory item is not an active explicit open loop.',
      },
    ]);
    expect(vault.getMemoryDetail(noSteps.item.itemUid)?.status).toBe('active');
  });

  function saveMemory(overrides: Partial<SaveMemoryInput>): SaveMemoryResult {
    return vault.saveMemory({
      title: overrides.title ?? 'Open loop',
      project: overrides.project ?? 'OpenLoops',
      memoryType: overrides.memoryType ?? 'plan',
      subject: overrides.subject ?? overrides.title ?? 'open loop subject',
      summary: overrides.summary ?? `${overrides.title ?? 'Open loop'} summary`,
      content: overrides.content,
      keywords: overrides.keywords,
      tags: overrides.tags,
      routineType: overrides.routineType,
      status: overrides.status,
      priority: overrides.priority,
      sourceApp: overrides.sourceApp ?? 'codex',
      sourceSessionId: overrides.sourceSessionId,
      nextSteps: overrides.nextSteps,
      relatedItemIds: overrides.relatedItemIds,
      relatedFiles: overrides.relatedFiles,
    });
  }

  function setMemoryTimes(itemUid: string, timestamp: string): void {
    const db = getDb();
    db.update(memoryItems)
      .set({
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(memoryItems.itemUid, itemUid))
      .run();
  }

  function setRawNextSteps(itemUid: string, nextStepsJson: string): void {
    const db = getDb();
    db.update(memoryItems)
      .set({ nextStepsJson })
      .where(eq(memoryItems.itemUid, itemUid))
      .run();
  }

  function getResolveLoopLogCount(itemUid: string): number {
    const db = getDb();
    return db
      .select()
      .from(activityLogs)
      .where(and(
        eq(activityLogs.targetItemId, itemUid),
        eq(activityLogs.actionType, 'resolve_loop'),
      ))
      .all()
      .length;
  }

  function getDb(): any {
    return (vault as unknown as { db: any }).db;
  }
});

describe('open loop MCP tools registration', () => {
  const source = readFileSync(join(__dirname, '../../mcp-server/src/index.ts'), 'utf8');

  it('registers the exhaustive open-loop tools and recall warning note', () => {
    expect(source).toContain("'vault_list_open_loops'");
    expect(source).toContain("'vault_count_open_loops'");
    expect(source).toContain("'vault_resolve_loop_batch'");
    expect(source).toContain('open_loops_note');
  });

  it('uses snake_case MCP inputs and maps them to camelCase core calls', () => {
    expect(source).toContain('created_from');
    expect(source).toContain('created_to');
    expect(source).toContain('by_project');
    expect(source).toContain('item_uid');
    expect(source).toContain('resolution_note');
    expect(source).toContain('createdFrom');
    expect(source).toContain('createdTo');
    expect(source).toContain('byProject');
    expect(source).toContain('itemUid');
    expect(source).toContain('resolutionNote');
  });

  it('emits snake_case fields in open-loop tool outputs', () => {
    expect(source).toContain('has_more');
    expect(source).toContain('generated_at');
    expect(source).toContain('memory_type');
    expect(source).toContain('next_steps');
    expect(source).toContain('last_accessed_at');
    expect(source).toContain('by_project');
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
