// ============================================================================
// Vault — Settings Manager
// Reads/writes settings from the settings table in SQLite.
// ============================================================================

import { eq } from 'drizzle-orm';
import { settings } from '../database/schema.js';
import { DEFAULT_VAULT_ROOT } from './vault-root.js';
import { now } from '../utils/datetime.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

/**
 * Default settings seeded on first initialization.
 */
const DEFAULT_SETTINGS: Record<string, unknown> = {
  vault_root: DEFAULT_VAULT_ROOT,
  openrouter_api_key: '',
  enrichment_model: '',
  enrichment_enabled: false,
  vault_agent_backend: 'api',
  recall_max_results: 10,
  recall_compact_limit: 6,
  recall_top_match_limit: 4,
  recall_detail_expansion_limit: 2,
  recall_related_limit: 2,
  recall_proactive_limit: 2,
  auto_log: true,
  model_routing_table: null,
  local_adapter_config: {
    enabled: false,
    type: '',
    cwd: '',
    command: '',
    model: '',
    effort: '',
    chrome: false,
    maxTurns: null,
  },
  local_adapter_last_test: null,
  local_adapter_runtime_state: {},
  local_adapter_task_sessions: {},
  local_adapter_active_task_key: '',
  project_workspace_registry: {},
  local_workbench_recent_runs: [],
  // Project maintenance duty (Layer 2 step 3)
  'agent.project_maintenance.enabled': false,
  'agent.project_maintenance.cooldown_days': 7,
  'agent.project_maintenance.min_items_for_review': 3,
  'agent.project_maintenance.merge_candidate_max_items': 2,
  'agent.project_maintenance.last_review_per_project': {} as Record<string, string>,
  // Lifecycle pipeline (Layer 3 steps 3+4) — active → stale → archived → pending_delete
  'agent.stale_archival.enabled': false,
  'agent.stale_archival.active_to_stale_days': 30,
  'agent.stale_archival.stale_to_archived_days': 30,
  'agent.stale_archival.archived_to_pending_delete_days': 60,
};

/**
 * Seed default settings into the database if they don't exist.
 */
export function seedDefaultSettings(db: DB): void {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .get();

    if (!existing) {
      db.insert(settings)
        .values({
          key,
          valueJson: JSON.stringify(value),
          updatedAt: now(),
        })
        .run();
    }
  }
}

/**
 * Get a setting value by key.
 */
export function getSetting(db: DB, key: string): unknown {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get();

  if (!row) return undefined;
  return JSON.parse(row.valueJson);
}

/**
 * Set a setting value by key.
 */
export function setSetting(db: DB, key: string, value: unknown): void {
  const existing = db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get();

  if (existing) {
    db.update(settings)
      .set({
        valueJson: JSON.stringify(value),
        updatedAt: now(),
      })
      .where(eq(settings.key, key))
      .run();
  } else {
    db.insert(settings)
      .values({
        key,
        valueJson: JSON.stringify(value),
        updatedAt: now(),
      })
      .run();
  }
}

/**
 * Get all settings as a key-value map.
 */
export function getAllSettings(db: DB): Record<string, unknown> {
  const rows = db.select().from(settings).all();
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    result[row.key] = JSON.parse(row.valueJson);
  }
  return result;
}
