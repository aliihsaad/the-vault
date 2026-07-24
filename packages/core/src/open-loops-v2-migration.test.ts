import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { Vault } from './vault.js';
import { getRawDatabase } from './database/connection.js';

/** A v0.6.2 `tasks` table: identical to the current bootstrap minus the
 *  v0.6.3 `idempotency_key` column and its indexes. */
const LEGACY_V062_TASKS_DDL = `
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_uid TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority TEXT NOT NULL DEFAULT 'normal',
    project TEXT,
    prompt TEXT NOT NULL,
    context_json TEXT NOT NULL DEFAULT '{}',
    routed_model TEXT,
    result_text TEXT,
    result_metadata_json TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 2,
    parent_task_uid TEXT,
    source_memory_uid TEXT,
    target_memory_uid TEXT,
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );
`;

function openLegacyDatabase(dbPath: string): Database.Database {
  const nativeBinding = process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING?.trim();
  return nativeBinding ? new Database(dbPath, { nativeBinding }) : new Database(dbPath);
}

describe.sequential('Open-Loops v2 Phase A migration and safeguards', () => {
  let root: string | null = null;
  let vault: Vault | null = null;

  afterEach(() => {
    vault?.reset();
    vault = null;
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = null;
    }
  });

  it('adds project columns and lifecycle tables idempotently without rewriting legacy projects', () => {
    root = mkdtempSync(join(tmpdir(), 'vault-open-loops-migration-'));
    const registry = join(root, 'registry');
    const dbPath = join(registry, 'vault.db');
    mkdirSync(registry, { recursive: true });
    const legacyMemoryPath = join(root, 'projects', 'legacy-project', 'memories', 'legacy.md');
    mkdirSync(join(root, 'projects', 'legacy-project', 'memories'), { recursive: true });
    writeFileSync(legacyMemoryPath, '# Legacy evidence\n\nPreserve this file.\n');
    const nativeBinding = process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING?.trim();
    const bootstrap = nativeBinding
      ? new Database(dbPath, { nativeBinding })
      : new Database(dbPath);
    bootstrap.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO projects (name, description, created_at, updated_at)
      VALUES ('Legacy Project', 'Keep me unchanged', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    `);
    bootstrap.close();

    vault = new Vault(root);
    vault.initialize();

    const legacy = vault.getProject('Legacy Project');
    expect(legacy).toMatchObject({
      name: 'Legacy Project',
      description: 'Keep me unchanged',
      projectUid: null,
      projectType: 'unclassified',
      lifecycleState: null,
      version: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const raw = getRawDatabase()!;
    const tableNames = (raw.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all() as Array<{ name: string }>).map((row) => row.name);
    expect(tableNames).toEqual(expect.arrayContaining([
      'authorization_policies',
      'evidence_policies',
      'open_loops',
      'loop_events',
      'approval_requests',
      'approval_records',
      'project_events',
      'gate_events',
      'migration_ledger',
    ]));
    expect(raw.prepare('SELECT COUNT(*) AS count FROM migration_ledger').get()).toEqual({ count: 1 });
    expect(existsSync(`${dbPath}.open-loops-v2.pre-migration.bak`)).toBe(true);
    const memoryBackupPath = join(root, 'migration-backups', 'open-loops-v2-phase-a-files', 'projects', 'legacy-project', 'memories', 'legacy.md');
    expect(readFileSync(memoryBackupPath, 'utf8')).toBe('# Legacy evidence\n\nPreserve this file.\n');

    vault.reset();
    vault = new Vault(root);
    vault.initialize();
    expect(getRawDatabase()!.prepare('SELECT COUNT(*) AS count FROM migration_ledger').get()).toEqual({ count: 1 });
  });

  it('seeds stable neutral installation-owner and evidence defaults', () => {
    root = mkdtempSync(join(tmpdir(), 'vault-open-loops-defaults-'));
    vault = new Vault(root);
    vault.initialize();

    const first = vault.getOpenLoopInstallationDefaults();
    const second = vault.getOpenLoopInstallationDefaults();
    expect(first).toEqual(second);
    expect(first.actor.actorUid).toMatch(/^actor_/);
    expect(first.actor).toMatchObject({ actorKind: 'installation', roles: ['owner'] });

    const raw = getRawDatabase()!;
    expect(raw.prepare('SELECT mode, owner_actor_uid FROM authorization_policies WHERE policy_uid = ?')
      .get(first.authorizationPolicyUid)).toEqual({
      mode: 'owner',
      owner_actor_uid: first.actor.actorUid,
    });
    expect(raw.prepare('SELECT COUNT(*) AS count FROM evidence_policies WHERE policy_uid = ?')
      .get(first.evidencePolicyUid)).toEqual({ count: 1 });
  });

  it('rejects project creation without an explicit type and leaves no partial row', () => {
    root = mkdtempSync(join(tmpdir(), 'vault-open-loops-project-type-'));
    vault = new Vault(root);
    vault.initialize();

    expect(() => vault!.createProject({ name: 'Missing type' } as never)).toThrow();
    expect(vault.listProjects()).toEqual([]);
  });

  it('enforces the Brain next_steps invariant before writing a memory', () => {
    root = mkdtempSync(join(tmpdir(), 'vault-open-loops-brain-'));
    vault = new Vault(root);
    vault.initialize();
    const brain = vault.createProject({
      name: 'Research Brain',
      projectType: 'brain_context',
      memoryPurpose: 'Keep durable research context.',
    });

    expect(() => vault!.saveMemory({
      title: 'Research note',
      project: brain.name,
      memoryType: 'reference',
      subject: 'Research',
      summary: 'A durable note.',
      nextSteps: ['Turn this into a task'],
    })).toThrow(/Brain contexts cannot store non-empty next_steps/);
    expect(vault.findMemory({ project: brain.name })).toEqual([]);
  });

  it('blocks a dedicated loop row from referencing a Brain project at the SQLite boundary', () => {
    root = mkdtempSync(join(tmpdir(), 'vault-open-loops-brain-trigger-'));
    vault = new Vault(root);
    vault.initialize();
    const brain = vault.createProject({
      name: 'Decision Brain',
      projectType: 'brain_context',
      memoryPurpose: 'Keep decisions.',
    });
    const raw = getRawDatabase()!;

    expect(() => raw.prepare(`
      INSERT INTO open_loops (
        loop_uid, project_uid, title, commitment, deferred_reason,
        owner_kind, owner_reference, immediate_next_action,
        trigger_kind, trigger_value, current_evidence_summary,
        closure_criteria, priority, dedupe_key, source_context_json,
        creating_actor_uid, creating_actor_kind, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vl_forbidden', brain.projectUid, 'Forbidden', 'Do work', 'Deferred',
      'user', 'owner', 'Start', 'checkpoint', 'next review', 'No evidence',
      'Verified result', 'normal', 'forbidden', '{"kind":"test"}',
      'actor_test', 'user', new Date().toISOString(), new Date().toISOString(),
    )).toThrow(/OPEN_LOOPS_BRAIN_OR_UNCLASSIFIED_PROJECT/);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM open_loops').get()).toEqual({ count: 0 });
    expect(raw.prepare('SELECT COUNT(*) AS count FROM loop_events').get()).toEqual({ count: 0 });
  });

  it('upgrades a v0.6.2 tasks table lacking idempotency_key and preserves data across repeated init', () => {
    root = mkdtempSync(join(tmpdir(), 'vault-v062-idempotency-'));
    const registry = join(root, 'registry');
    const dbPath = join(registry, 'vault.db');
    mkdirSync(registry, { recursive: true });
    const bootstrap = openLegacyDatabase(dbPath);
    bootstrap.exec(LEGACY_V062_TASKS_DDL);
    bootstrap.prepare(`
      INSERT INTO tasks (task_uid, title, task_type, status, priority, project, prompt, created_at, updated_at)
      VALUES (?, ?, 'analysis', 'completed', 'normal', 'Legacy Project', 'Preserve me', ?, ?)
    `).run('vt_legacy_keep', 'Legacy task', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    bootstrap.close();

    vault = new Vault(root);
    expect(() => vault!.initialize()).not.toThrow();

    const raw = getRawDatabase()!;
    const columns = (raw.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toContain('idempotency_key');
    const indexes = raw.prepare('PRAGMA index_list(tasks)').all() as Array<{ name: string; unique: number }>;
    expect(indexes.some((i) => i.name === 'idx_tasks_idempotency_key' && i.unique === 1)).toBe(true);
    expect(raw.prepare('SELECT title FROM tasks WHERE task_uid = ?').get('vt_legacy_keep')).toEqual({ title: 'Legacy task' });

    // Second initialization on the upgraded database must remain idempotent.
    vault.reset();
    vault = new Vault(root);
    expect(() => vault!.initialize()).not.toThrow();
    expect(getRawDatabase()!.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 1 });
  });

  it('consolidates duplicate active duties from a v0.6.2 database before enforcing the unique index', () => {
    root = mkdtempSync(join(tmpdir(), 'vault-v062-dup-duty-'));
    const registry = join(root, 'registry');
    const dbPath = join(registry, 'vault.db');
    mkdirSync(registry, { recursive: true });
    const bootstrap = openLegacyDatabase(dbPath);
    bootstrap.exec(LEGACY_V062_TASKS_DDL);
    const insert = bootstrap.prepare(`
      INSERT INTO tasks (task_uid, title, task_type, status, priority, project, prompt, context_json, source_memory_uid, created_by, created_at, updated_at)
      VALUES (@uid, @title, 'summarize', 'pending', 'normal', 'Legacy Project', 'duty', @ctx, 'vm_source', 'system', @created, @created)
    `);
    const summarizeDuty = JSON.stringify({ dutyType: 'summarize' });
    insert.run({ uid: 'vt_dup_oldest', title: 'oldest duty', ctx: summarizeDuty, created: '2026-01-01T00:00:00.000Z' });
    insert.run({ uid: 'vt_dup_mid', title: 'middle duty', ctx: summarizeDuty, created: '2026-01-02T00:00:00.000Z' });
    insert.run({ uid: 'vt_dup_new', title: 'newest duty', ctx: summarizeDuty, created: '2026-01-03T00:00:00.000Z' });
    // Control: same memory/type but a different dutyType, so it is not a duplicate.
    insert.run({ uid: 'vt_control', title: 'organize duty', ctx: JSON.stringify({ dutyType: 'organize' }), created: '2026-01-02T00:00:00.000Z' });
    bootstrap.close();

    vault = new Vault(root);
    expect(() => vault!.initialize()).not.toThrow();

    const raw = getRawDatabase()!;
    const rowOf = (uid: string) => raw.prepare('SELECT status, error_message, completed_at FROM tasks WHERE task_uid = ?')
      .get(uid) as { status: string; error_message: string | null; completed_at: string | null };
    expect(rowOf('vt_dup_oldest').status).toBe('pending');
    expect(rowOf('vt_dup_mid')).toMatchObject({ status: 'cancelled', error_message: expect.stringMatching(/duplicate active duty/i) });
    expect(rowOf('vt_dup_mid').completed_at).not.toBeNull();
    expect(rowOf('vt_dup_new').status).toBe('cancelled');
    expect(rowOf('vt_control').status).toBe('pending');
    const indexes = raw.prepare('PRAGMA index_list(tasks)').all() as Array<{ name: string }>;
    expect(indexes.some((i) => i.name === 'idx_tasks_active_duty_unique')).toBe(true);

    // Repeated initialization must not cancel anything further.
    vault.reset();
    vault = new Vault(root);
    expect(() => vault!.initialize()).not.toThrow();
    expect(getRawDatabase()!.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = 'cancelled'").get())
      .toEqual({ count: 2 });
  });
});
