// ============================================================================
// Vault — Database Connection
// Creates/opens the SQLite database and initializes Drizzle ORM.
// ============================================================================

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Shared database type used across all services. */
export type VaultDB = BetterSQLite3Database<typeof schema>;

let dbInstance: VaultDB | null = null;
let sqliteInstance: Database.Database | null = null;

/**
 * Get or create the database connection.
 * The database file is stored at {vaultRoot}/registry/vault.db
 */
export function getDatabase(dbPath: string): VaultDB {
  if (dbInstance) return dbInstance;

  // Ensure the directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Create SQLite connection with performance pragmas
  const nativeBinding = process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING?.trim();
  sqliteInstance = nativeBinding
    ? new Database(dbPath, { nativeBinding })
    : new Database(dbPath);
  sqliteInstance.pragma('journal_mode = WAL');
  sqliteInstance.pragma('synchronous = normal');
  sqliteInstance.pragma('foreign_keys = ON');
  sqliteInstance.pragma('busy_timeout = 5000');

  // Initialize Drizzle
  dbInstance = drizzle(sqliteInstance, { schema });

  return dbInstance;
}

/**
 * Get the raw SQLite instance for direct operations.
 */
export function getRawDatabase(): Database.Database | null {
  return sqliteInstance;
}

/**
 * Run schema creation directly using raw SQL.
 * This ensures all tables exist on first run.
 */
export function initializeSchema(dbPath: string): void {
  const db = getDatabase(dbPath);
  const raw = getRawDatabase();
  if (!raw) throw new Error('Database not initialized');

  const preMigrationState = captureOpenLoopsPreMigrationState(raw, dbPath);
  createOpenLoopsPreMigrationBackup(raw, dbPath);

  // Create tables using raw SQL for reliability
  raw.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_uid TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      project TEXT NOT NULL,
      source_app TEXT NOT NULL DEFAULT 'manual',
      source_session_id TEXT,
      memory_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      routine_type TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      priority TEXT NOT NULL DEFAULT 'normal',
      promoted INTEGER NOT NULL DEFAULT 0,
      next_steps_json TEXT NOT NULL DEFAULT '[]',
      related_item_ids_json TEXT NOT NULL DEFAULT '[]',
      related_files_json TEXT NOT NULL DEFAULT '[]',
      vault_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_memory_items_project ON memory_items(project);
    CREATE INDEX IF NOT EXISTS idx_memory_items_memory_type ON memory_items(memory_type);
    CREATE INDEX IF NOT EXISTS idx_memory_items_subject ON memory_items(subject);
    CREATE INDEX IF NOT EXISTS idx_memory_items_status ON memory_items(status);
    CREATE INDEX IF NOT EXISTS idx_memory_items_priority ON memory_items(priority);
    CREATE INDEX IF NOT EXISTS idx_memory_items_promoted ON memory_items(promoted);
    CREATE INDEX IF NOT EXISTS idx_memory_items_created_at ON memory_items(created_at);
    CREATE INDEX IF NOT EXISTS idx_memory_items_updated_at ON memory_items(updated_at);

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      project_uid TEXT,
      project_type TEXT,
      lifecycle_state TEXT,
      authorization_policy_id TEXT,
      evidence_policy_id TEXT,
      classification_version INTEGER NOT NULL DEFAULT 0,
      classified_by_actor_uid TEXT,
      classified_at TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      canonical_root TEXT,
      repository_url TEXT,
      default_branch TEXT,
      owner_actor_uid TEXT,
      owner_role TEXT,
      memory_purpose TEXT,
      type_config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_project TEXT NOT NULL,
      target_project TEXT NOT NULL,
      link_type TEXT NOT NULL,
      note TEXT,
      confidence INTEGER,
      created_by TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_project_relationships_source ON project_relationships(source_project);
    CREATE INDEX IF NOT EXISTS idx_project_relationships_target ON project_relationships(target_project);
    CREATE INDEX IF NOT EXISTS idx_project_relationships_link_type ON project_relationships(link_type);

    CREATE TABLE IF NOT EXISTS project_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_uid TEXT UNIQUE NOT NULL,
      project TEXT NOT NULL,
      proposal_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      rationale TEXT,
      confidence INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      source_task_uid TEXT,
      evidence_item_uids_json TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL DEFAULT 'agent',
      decided_by TEXT,
      decided_at TEXT,
      decision_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_project_proposals_project ON project_proposals(project);
    CREATE INDEX IF NOT EXISTS idx_project_proposals_status ON project_proposals(status);
    CREATE INDEX IF NOT EXISTS idx_project_proposals_proposal_type ON project_proposals(proposal_type);
    CREATE INDEX IF NOT EXISTS idx_project_proposals_created_at ON project_proposals(created_at);

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      normalized_name TEXT NOT NULL,
      category TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_item_id TEXT NOT NULL,
      target_item_id TEXT NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'related',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      source_client TEXT NOT NULL,
      project TEXT,
      action_type TEXT NOT NULL,
      target_item_id TEXT,
      status TEXT NOT NULL DEFAULT 'success',
      latency_ms INTEGER,
      ai_used INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_action_type ON activity_logs(action_type);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_project ON activity_logs(project);

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
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
      idempotency_key TEXT UNIQUE,
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
    CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_uid ON tasks(parent_task_uid);

    CREATE TABLE IF NOT EXISTS graphify_project_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT UNIQUE NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      source_root TEXT,
      freshness TEXT NOT NULL DEFAULT 'missing',
      build_mode TEXT NOT NULL DEFAULT 'fast',
      latest_build_id TEXT,
      graph_json_path TEXT,
      graph_html_path TEXT,
      graph_report_path TEXT,
      graph_svg_path TEXT,
      node_count INTEGER,
      edge_count INTEGER,
      community_count INTEGER,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      detected_graphify_version TEXT,
      last_build_started_at TEXT,
      last_build_completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_graphify_project_state_project ON graphify_project_state(project);
    CREATE INDEX IF NOT EXISTS idx_graphify_project_state_freshness ON graphify_project_state(freshness);
    CREATE INDEX IF NOT EXISTS idx_graphify_project_state_enabled ON graphify_project_state(enabled);
    CREATE INDEX IF NOT EXISTS idx_graphify_project_state_latest_build_id ON graphify_project_state(latest_build_id);

    CREATE TABLE IF NOT EXISTS graphify_builds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      build_id TEXT UNIQUE NOT NULL,
      project TEXT NOT NULL,
      status TEXT NOT NULL,
      build_mode TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      artifact_json TEXT,
      graph_stats_json TEXT,
      detected_graphify_version TEXT,
      log_path TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_graphify_builds_project ON graphify_builds(project);
    CREATE INDEX IF NOT EXISTS idx_graphify_builds_status ON graphify_builds(status);
    CREATE INDEX IF NOT EXISTS idx_graphify_builds_started_at ON graphify_builds(started_at);
  `);

  // Idempotent additive migrations for columns introduced after the initial
  // bootstrap. SQLite has no IF NOT EXISTS for ADD COLUMN, so we probe via
  // PRAGMA and only run when missing. Existing databases pick up the column
  // on next start; new databases match the CREATE TABLE definition.
  applyAdditiveMigrations(raw);
  createOpenLoopsSchema(raw);
  recordOpenLoopsMigration(raw, preMigrationState);
}

function applyAdditiveMigrations(raw: Database.Database): void {
  const ensureColumn = (
    table: string,
    column: string,
    columnDef: string,
    indexSql?: string,
  ): void => {
    const existing = raw
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!existing.some((row) => row.name === column)) {
      raw.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef};`);
    }
    if (indexSql) {
      raw.exec(indexSql);
    }
  };

  ensureColumn(
    'memory_items',
    'snoozed_until',
    'snoozed_until TEXT',
    'CREATE INDEX IF NOT EXISTS idx_memory_items_snoozed_until ON memory_items(snoozed_until);',
  );

  ensureColumn(
    'memory_items',
    'outcome',
    'outcome TEXT',
    'CREATE INDEX IF NOT EXISTS idx_memory_items_outcome ON memory_items(outcome);',
  );

  ensureColumn('projects', 'project_uid', 'project_uid TEXT');
  ensureColumn('projects', 'project_type', 'project_type TEXT');
  ensureColumn('projects', 'lifecycle_state', 'lifecycle_state TEXT');
  ensureColumn('projects', 'authorization_policy_id', 'authorization_policy_id TEXT');
  ensureColumn('projects', 'evidence_policy_id', 'evidence_policy_id TEXT');
  ensureColumn('projects', 'classification_version', 'classification_version INTEGER NOT NULL DEFAULT 0');
  ensureColumn('projects', 'classified_by_actor_uid', 'classified_by_actor_uid TEXT');
  ensureColumn('projects', 'classified_at', 'classified_at TEXT');
  ensureColumn('projects', 'version', 'version INTEGER NOT NULL DEFAULT 0');
  ensureColumn('projects', 'canonical_root', 'canonical_root TEXT');
  ensureColumn('projects', 'repository_url', 'repository_url TEXT');
  ensureColumn('projects', 'default_branch', 'default_branch TEXT');
  ensureColumn('projects', 'owner_actor_uid', 'owner_actor_uid TEXT');
  ensureColumn('projects', 'owner_role', 'owner_role TEXT');
  ensureColumn('projects', 'memory_purpose', 'memory_purpose TEXT');
  ensureColumn('projects', 'type_config_json', "type_config_json TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(
    'tasks',
    'idempotency_key',
    'idempotency_key TEXT',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency_key ON tasks(idempotency_key);',
  );

  raw.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_project_uid ON projects(project_uid);
    CREATE INDEX IF NOT EXISTS idx_projects_project_type ON projects(project_type);
    CREATE INDEX IF NOT EXISTS idx_projects_lifecycle_state ON projects(lifecycle_state);
    CREATE INDEX IF NOT EXISTS idx_projects_authorization_policy ON projects(authorization_policy_id);
  `);
}

function createOpenLoopsSchema(raw: Database.Database): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS authorization_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_uid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('owner', 'role', 'quorum', 'external')),
      owner_actor_uid TEXT,
      allowed_roles_json TEXT NOT NULL DEFAULT '[]',
      quorum INTEGER NOT NULL DEFAULT 1 CHECK (quorum > 0),
      external_provider TEXT,
      actions_json TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_authorization_policies_mode ON authorization_policies(mode);
    CREATE INDEX IF NOT EXISTS idx_authorization_policies_enabled ON authorization_policies(enabled);

    CREATE TABLE IF NOT EXISTS evidence_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_uid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      requirements_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS open_loops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loop_uid TEXT UNIQUE NOT NULL,
      project_uid TEXT NOT NULL REFERENCES projects(project_uid),
      title TEXT NOT NULL,
      commitment TEXT NOT NULL,
      deferred_reason TEXT NOT NULL,
      owner_kind TEXT NOT NULL,
      owner_reference TEXT NOT NULL,
      immediate_next_action TEXT NOT NULL,
      trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('deadline', 'review_date', 'dependency', 'checkpoint')),
      trigger_value TEXT NOT NULL,
      current_evidence_summary TEXT NOT NULL,
      closure_criteria TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'verification_needed', 'awaiting_approval', 'awaiting_user', 'externally_blocked', 'snoozed', 'resolved')),
      terminal_outcome TEXT CHECK (terminal_outcome IS NULL OR terminal_outcome IN ('fixed', 'obsolete', 'duplicate', 'wont_fix')),
      priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'critical')),
      blocking_scope TEXT NOT NULL DEFAULT 'project' CHECK (blocking_scope = 'project'),
      dedupe_key TEXT NOT NULL,
      source_memory_uid TEXT,
      source_task_uid TEXT,
      source_session_uid TEXT,
      source_handoff_uid TEXT,
      external_reference TEXT,
      source_context_json TEXT NOT NULL,
      creating_actor_uid TEXT NOT NULL,
      creating_actor_kind TEXT NOT NULL,
      resume_state TEXT,
      snoozed_until TEXT,
      dependency_trigger TEXT,
      resolution_note TEXT,
      resolved_at TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((state = 'resolved' AND terminal_outcome IS NOT NULL) OR (state <> 'resolved' AND terminal_outcome IS NULL)),
      CHECK (state = 'snoozed' OR (snoozed_until IS NULL AND dependency_trigger IS NULL))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_open_loops_active_dedupe
      ON open_loops(project_uid, dedupe_key) WHERE state <> 'resolved';
    CREATE INDEX IF NOT EXISTS idx_open_loops_project_state ON open_loops(project_uid, state);
    CREATE INDEX IF NOT EXISTS idx_open_loops_snooze_expiry ON open_loops(snoozed_until);
    CREATE INDEX IF NOT EXISTS idx_open_loops_owner ON open_loops(owner_kind, owner_reference);
    CREATE INDEX IF NOT EXISTS idx_open_loops_priority ON open_loops(priority);
    CREATE INDEX IF NOT EXISTS idx_open_loops_trigger ON open_loops(trigger_kind, trigger_value);

    CREATE TABLE IF NOT EXISTS loop_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_uid TEXT UNIQUE NOT NULL,
      loop_uid TEXT NOT NULL REFERENCES open_loops(loop_uid),
      idempotency_key TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      actor_uid TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      authorization_policy_uid TEXT,
      authorization_policy_version INTEGER,
      previous_state TEXT,
      next_state TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      evidence_references_json TEXT NOT NULL DEFAULT '[]',
      result_json TEXT NOT NULL,
      correlation_uid TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_loop_events_loop ON loop_events(loop_uid, created_at);
    CREATE INDEX IF NOT EXISTS idx_loop_events_type ON loop_events(event_type);
  `);

  createOpenLoopsGovernanceSchema(raw);
  createOpenLoopsTriggers(raw);
}

function createOpenLoopsGovernanceSchema(raw: Database.Database): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_uid TEXT UNIQUE NOT NULL,
      action TEXT NOT NULL,
      target_uid TEXT NOT NULL,
      policy_uid TEXT NOT NULL REFERENCES authorization_policies(policy_uid),
      policy_version INTEGER NOT NULL,
      requester_actor_uid TEXT NOT NULL,
      requester_actor_kind TEXT NOT NULL,
      scope_json TEXT NOT NULL DEFAULT '{}',
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
      expires_at TEXT,
      trigger_json TEXT,
      idempotency_key TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_approval_requests_target ON approval_requests(target_uid, action);
    CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);

    CREATE TABLE IF NOT EXISTS approval_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      approval_uid TEXT UNIQUE NOT NULL,
      request_uid TEXT NOT NULL REFERENCES approval_requests(request_uid),
      action TEXT NOT NULL,
      target_uid TEXT NOT NULL,
      policy_uid TEXT NOT NULL REFERENCES authorization_policies(policy_uid),
      policy_version INTEGER NOT NULL,
      actor_uid TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_roles_json TEXT NOT NULL DEFAULT '[]',
      decision TEXT NOT NULL CHECK (decision IN ('approved', 'denied')),
      scope_json TEXT NOT NULL DEFAULT '{}',
      reason TEXT NOT NULL,
      external_decision_id TEXT,
      external_provider TEXT,
      event_uid TEXT,
      idempotency_key TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(request_uid, actor_uid)
    );

    CREATE INDEX IF NOT EXISTS idx_approval_records_target ON approval_records(target_uid, action);

    CREATE TABLE IF NOT EXISTS project_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_uid TEXT UNIQUE NOT NULL,
      project_uid TEXT NOT NULL REFERENCES projects(project_uid),
      idempotency_key TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      actor_uid TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      authorization_policy_uid TEXT NOT NULL,
      authorization_policy_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_project_events_project ON project_events(project_uid, created_at);
    CREATE INDEX IF NOT EXISTS idx_project_events_type ON project_events(event_type);

    CREATE TABLE IF NOT EXISTS gate_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_uid TEXT UNIQUE NOT NULL,
      project_uid TEXT NOT NULL REFERENCES projects(project_uid),
      related_loop_uid TEXT,
      idempotency_key TEXT UNIQUE NOT NULL,
      work_intent TEXT NOT NULL,
      actor_uid TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
      reason_code TEXT NOT NULL,
      blocker_uids_json TEXT NOT NULL DEFAULT '[]',
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_gate_events_project ON gate_events(project_uid, created_at);
    CREATE INDEX IF NOT EXISTS idx_gate_events_decision ON gate_events(decision);

    CREATE TABLE IF NOT EXISTS migration_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_uid TEXT UNIQUE NOT NULL,
      phase TEXT NOT NULL,
      version INTEGER NOT NULL,
      pre_state_json TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  // Additive upgrade: a v0.6.2 database already has approval_records without the
  // external_provider column (the CREATE TABLE IF NOT EXISTS above is a no-op on
  // it). Add the column so external decisions can be bound to a provider. The
  // table is guaranteed to exist here, so this is safe and idempotent.
  const approvalColumns = raw
    .prepare('PRAGMA table_info(approval_records)')
    .all() as Array<{ name: string }>;
  if (!approvalColumns.some((column) => column.name === 'external_provider')) {
    raw.exec('ALTER TABLE approval_records ADD COLUMN external_provider TEXT;');
  }
}

/**
 * Consolidate duplicate active system duties before the unique active-duty
 * index is created. v0.6.2's duty writer did check-then-insert without a
 * uniqueness constraint, so a legacy database can hold several pending/running
 * duties that share (source_memory_uid, task_type, dutyType). Creating
 * idx_tasks_active_duty_unique over such rows would abort initialization.
 *
 * Policy: keep the oldest active duty per group (by created_at, then id) and
 * mark every later duplicate `cancelled` with an explicit, auditable migration
 * reason and timestamps. Rows are preserved, never deleted. Running this again
 * after consolidation is a no-op, so repeated initialization stays idempotent.
 */
function migrateDuplicateActiveDuties(raw: Database.Database): void {
  const now = new Date().toISOString();
  raw.prepare(`
    UPDATE tasks
    SET status = 'cancelled',
        error_message = 'Superseded during v0.6.3 upgrade: duplicate active duty consolidated to the oldest row for the active-duty uniqueness migration.',
        completed_at = COALESCE(completed_at, @now),
        updated_at = @now
    WHERE id IN (
      SELECT dup.id FROM tasks dup
      WHERE dup.status IN ('pending', 'running')
        AND dup.source_memory_uid IS NOT NULL
        AND dup.created_by = 'system'
        AND json_extract(dup.context_json, '$.dutyType') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM tasks older
          WHERE older.source_memory_uid = dup.source_memory_uid
            AND older.task_type = dup.task_type
            AND json_extract(older.context_json, '$.dutyType') = json_extract(dup.context_json, '$.dutyType')
            AND older.status IN ('pending', 'running')
            AND older.source_memory_uid IS NOT NULL
            AND older.created_by = 'system'
            AND json_extract(older.context_json, '$.dutyType') IS NOT NULL
            AND (
              older.created_at < dup.created_at
              OR (older.created_at = dup.created_at AND older.id < dup.id)
            )
        )
    );
  `).run({ now });
}

function createOpenLoopsTriggers(raw: Database.Database): void {
  // Deduplicate legacy active duties before the unique index below is created.
  migrateDuplicateActiveDuties(raw);
  raw.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_open_loops_work_project_insert
    BEFORE INSERT ON open_loops
    WHEN COALESCE((SELECT project_type FROM projects WHERE project_uid = NEW.project_uid), 'invalid') <> 'work_project'
    BEGIN
      SELECT RAISE(ABORT, 'OPEN_LOOPS_BRAIN_OR_UNCLASSIFIED_PROJECT');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_open_loops_work_project_update
    BEFORE UPDATE OF project_uid ON open_loops
    WHEN COALESCE((SELECT project_type FROM projects WHERE project_uid = NEW.project_uid), 'invalid') <> 'work_project'
    BEGIN
      SELECT RAISE(ABORT, 'OPEN_LOOPS_BRAIN_OR_UNCLASSIFIED_PROJECT');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_projects_brain_zero_loops
    BEFORE UPDATE OF project_type ON projects
    WHEN NEW.project_type = 'brain_context'
      AND EXISTS (
        SELECT 1 FROM open_loops
        WHERE project_uid = NEW.project_uid AND state <> 'resolved'
      )
    BEGIN
      SELECT RAISE(ABORT, 'BRAIN_CONTEXT_HAS_OPEN_LOOPS');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_projects_brain_zero_loop_rows
    BEFORE UPDATE OF project_type ON projects
    WHEN NEW.project_type = 'brain_context'
      AND EXISTS (SELECT 1 FROM open_loops WHERE project_uid = NEW.project_uid)
    BEGIN
      SELECT RAISE(ABORT, 'BRAIN_CONTEXT_HAS_LOOP_HISTORY');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_memory_items_brain_next_steps_insert
    BEFORE INSERT ON memory_items
    WHEN EXISTS (
      SELECT 1 FROM projects WHERE name = NEW.project AND project_type = 'brain_context'
    ) AND trim(COALESCE(NEW.next_steps_json, '[]')) NOT IN ('', '[]', 'null')
    BEGIN
      SELECT RAISE(ABORT, 'BRAIN_CONTEXT_NEXT_STEPS_FORBIDDEN');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_memory_items_brain_next_steps_update
    BEFORE UPDATE OF project, next_steps_json ON memory_items
    WHEN EXISTS (
      SELECT 1 FROM projects WHERE name = NEW.project AND project_type = 'brain_context'
    ) AND trim(COALESCE(NEW.next_steps_json, '[]')) NOT IN ('', '[]', 'null')
    BEGIN
      SELECT RAISE(ABORT, 'BRAIN_CONTEXT_NEXT_STEPS_FORBIDDEN');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_tasks_brain_work_insert
    BEFORE INSERT ON tasks
    WHEN EXISTS (
      SELECT 1 FROM projects WHERE name = NEW.project AND project_type = 'brain_context'
    ) AND COALESCE(json_extract(NEW.context_json, '$."$vaultLifecycle".workIntent'), 'normal_work') <> 'memory_maintenance'
    BEGIN
      SELECT RAISE(ABORT, 'BRAIN_CONTEXT_EXECUTABLE_TASK_FORBIDDEN');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_tasks_brain_work_update
    BEFORE UPDATE OF project, context_json, status ON tasks
    WHEN NEW.status IN ('pending', 'running')
      AND EXISTS (
        SELECT 1 FROM projects WHERE name = NEW.project AND project_type = 'brain_context'
      )
      AND COALESCE(json_extract(NEW.context_json, '$."$vaultLifecycle".workIntent'), 'normal_work') <> 'memory_maintenance'
    BEGIN
      SELECT RAISE(ABORT, 'BRAIN_CONTEXT_EXECUTABLE_TASK_FORBIDDEN');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_projects_brain_zero_next_steps
    BEFORE UPDATE OF project_type ON projects
    WHEN NEW.project_type = 'brain_context'
      AND EXISTS (
        SELECT 1 FROM memory_items
        WHERE project = NEW.name
          AND trim(COALESCE(next_steps_json, '[]')) NOT IN ('', '[]', 'null')
      )
    BEGIN
      SELECT RAISE(ABORT, 'BRAIN_CONTEXT_NEXT_STEPS_FORBIDDEN');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_projects_brain_zero_executable_tasks
    BEFORE UPDATE OF project_type ON projects
    WHEN NEW.project_type = 'brain_context'
      AND EXISTS (
        SELECT 1 FROM tasks
        WHERE project = NEW.name
          AND status IN ('pending', 'running')
          AND COALESCE(json_extract(context_json, '$."$vaultLifecycle".workIntent'), 'normal_work') <> 'memory_maintenance'
      )
    BEGIN
      SELECT RAISE(ABORT, 'BRAIN_CONTEXT_HAS_EXECUTABLE_TASKS');
    END;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_active_duty_unique
      ON tasks(source_memory_uid, task_type, json_extract(context_json, '$.dutyType'))
      WHERE status IN ('pending', 'running')
        AND source_memory_uid IS NOT NULL
        AND created_by = 'system'
        AND json_extract(context_json, '$.dutyType') IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS trg_loop_events_append_only_update
    BEFORE UPDATE ON loop_events
    BEGIN
      SELECT RAISE(ABORT, 'LOOP_EVENTS_APPEND_ONLY');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_loop_events_append_only_delete
    BEFORE DELETE ON loop_events
    BEGIN
      SELECT RAISE(ABORT, 'LOOP_EVENTS_APPEND_ONLY');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_approval_records_append_only_update
    BEFORE UPDATE ON approval_records
    BEGIN
      SELECT RAISE(ABORT, 'APPROVAL_RECORDS_APPEND_ONLY');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_approval_records_append_only_delete
    BEFORE DELETE ON approval_records
    BEGIN
      SELECT RAISE(ABORT, 'APPROVAL_RECORDS_APPEND_ONLY');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_project_events_append_only_update
    BEFORE UPDATE ON project_events
    BEGIN
      SELECT RAISE(ABORT, 'PROJECT_EVENTS_APPEND_ONLY');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_project_events_append_only_delete
    BEFORE DELETE ON project_events
    BEGIN
      SELECT RAISE(ABORT, 'PROJECT_EVENTS_APPEND_ONLY');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_gate_events_append_only_update
    BEFORE UPDATE ON gate_events
    BEGIN
      SELECT RAISE(ABORT, 'GATE_EVENTS_APPEND_ONLY');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_gate_events_append_only_delete
    BEFORE DELETE ON gate_events
    BEGIN
      SELECT RAISE(ABORT, 'GATE_EVENTS_APPEND_ONLY');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_migration_ledger_append_only_update
    BEFORE UPDATE ON migration_ledger
    BEGIN
      SELECT RAISE(ABORT, 'MIGRATION_LEDGER_APPEND_ONLY');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_migration_ledger_append_only_delete
    BEFORE DELETE ON migration_ledger
    BEGIN
      SELECT RAISE(ABORT, 'MIGRATION_LEDGER_APPEND_ONLY');
    END;
  `);
}

interface OpenLoopsPreMigrationState {
  projects: number;
  memoryItems: number;
  legacyExplicitOpenLoops: number;
  projectRowsHash: string;
  memoryRowsHash: string;
  memoryFileCount: number;
  memoryFilesHash: string;
  backupPath: string | null;
  memoryFilesBackupPath: string | null;
}

function captureOpenLoopsPreMigrationState(
  raw: Database.Database,
  dbPath: string,
): OpenLoopsPreMigrationState {
  const hasProjects = hasSqliteTable(raw, 'projects');
  const hasMemoryItems = hasSqliteTable(raw, 'memory_items');
  const projectRows = hasProjects
    ? raw.prepare('SELECT id, name, description, created_at, updated_at FROM projects ORDER BY id').all()
    : [];
  const memoryRows = hasMemoryItems
    ? raw.prepare(`
        SELECT id, item_uid, project, status, next_steps_json, updated_at
        FROM memory_items ORDER BY id
      `).all()
    : [];
  const vaultRoot = dirname(dirname(dbPath));
  const files = collectMemoryFiles(vaultRoot);

  return {
    projects: projectRows.length,
    memoryItems: memoryRows.length,
    legacyExplicitOpenLoops: hasMemoryItems
      ? Number((raw.prepare(`
          SELECT COUNT(*) AS count
          FROM memory_items
          WHERE status = 'active' AND next_steps_json <> '[]'
        `).get() as { count: number }).count)
      : 0,
    projectRowsHash: hashJson(projectRows),
    memoryRowsHash: hashJson(memoryRows),
    memoryFileCount: files.length,
    memoryFilesHash: hashMemoryFiles(files),
    backupPath: shouldRunOpenLoopsProjectMigration(raw)
      ? `${dbPath}.open-loops-v2.pre-migration.bak`
      : null,
    memoryFilesBackupPath: shouldRunOpenLoopsProjectMigration(raw)
      ? join(vaultRoot, 'migration-backups', 'open-loops-v2-phase-a-files')
      : null,
  };
}

function createOpenLoopsPreMigrationBackup(raw: Database.Database, dbPath: string): void {
  if (!shouldRunOpenLoopsProjectMigration(raw)) {
    return;
  }

  const backupPath = `${dbPath}.open-loops-v2.pre-migration.bak`;
  if (!existsSync(backupPath)) {
    raw.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}';`);
  }

  const vaultRoot = dirname(dirname(dbPath));
  const filesBackupRoot = resolve(vaultRoot, 'migration-backups', 'open-loops-v2-phase-a-files');
  for (const sourcePath of collectMemoryFiles(vaultRoot)) {
    const relativePath = relative(vaultRoot, sourcePath);
    const targetPath = resolve(filesBackupRoot, relativePath);
    if (targetPath !== filesBackupRoot && !targetPath.startsWith(`${filesBackupRoot}${sep}`)) {
      throw new Error(`Refusing unsafe migration backup path: ${targetPath}`);
    }
    if (!existsSync(targetPath)) {
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
    }
  }
}

function recordOpenLoopsMigration(
  raw: Database.Database,
  preState: OpenLoopsPreMigrationState,
): void {
  raw.prepare(`
    INSERT OR IGNORE INTO migration_ledger (
      migration_uid, phase, version, pre_state_json, applied_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    'open_loops_v2_phase_a_v1',
    'A',
    1,
    JSON.stringify(preState),
    new Date().toISOString(),
  );
}

function shouldRunOpenLoopsProjectMigration(raw: Database.Database): boolean {
  return hasSqliteTable(raw, 'projects') && !hasSqliteColumn(raw, 'projects', 'project_type');
}

function hasSqliteTable(raw: Database.Database, table: string): boolean {
  return Boolean(raw.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function hasSqliteColumn(raw: Database.Database, table: string, column: string): boolean {
  const rows = raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function collectMemoryFiles(vaultRoot: string): string[] {
  const files: string[] = [];
  for (const folder of ['projects', 'shared']) {
    const root = `${vaultRoot}/${folder}`;
    if (!existsSync(root)) {
      continue;
    }
    walkMemoryFiles(root, files);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function walkMemoryFiles(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory)) {
    const path = `${directory}/${entry}`;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walkMemoryFiles(path, files);
    } else if (entry.toLowerCase().endsWith('.md')) {
      files.push(path);
    }
  }
}

function hashMemoryFiles(files: string[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
    dbInstance = null;
  }
}

/**
 * Reset the module-level singletons (used for testing).
 */
export function resetConnection(): void {
  closeDatabase();
}
