// ============================================================================
// Vault — Database Connection
// Creates/opens the SQLite database and initializes Drizzle ORM.
// ============================================================================

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
  `);
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
