import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { Vault } from './vault.js';
import { getRawDatabase } from './database/connection.js';

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
});
