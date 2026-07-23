// ============================================================================
// Vault — Settings Manager
// Reads/writes settings from the settings table in SQLite.
// ============================================================================

import { eq } from 'drizzle-orm';
import { settings } from '../database/schema.js';
import { DEFAULT_VAULT_ROOT } from './vault-root.js';
import { now } from '../utils/datetime.js';
import type { AiProviderId } from '../services/openrouter-client.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

// Pure provider-role resolution lives in provider-resolution.ts so the desktop
// renderer can import it without pulling in SQLite/node-only modules. Re-export
// everything here so existing '@the-vault/core' imports keep working.
import { resolveAiProviderSettings } from './provider-resolution.js';
export {
  getAiProviderDisplayName,
  getEnrichmentModelKey,
  getRoutingTableKey,
  resolveAiProviderSettings,
} from './provider-resolution.js';
export type {
  EnrichmentModelSettingKey,
  ResolvedAiProviderSettings,
} from './provider-resolution.js';

/**
 * Default settings seeded on first initialization.
 */
const DEFAULT_SETTINGS: Record<string, unknown> = {
  vault_root: DEFAULT_VAULT_ROOT,
  // AI provider roles: one primary provider plus an optional fallback that
  // is tried when the primary fails. 'ai_provider' is the legacy single-
  // provider switch, still read for migration.
  ai_provider_primary: 'openrouter',
  ai_provider_fallback: 'none',
  ai_provider: 'openrouter',
  openrouter_api_key: '',
  llm_hub_api_key: '',
  llm_hub_base_url: '',
  // Per-provider model selections. 'enrichment_model' and
  // 'model_routing_table' are the OpenRouter (legacy) slots; LLM-Hub keeps
  // its own so switching roles never loses a provider's chosen models.
  enrichment_model: '',
  enrichment_model_llm_hub: '',
  model_routing_table_llm_hub: null,
  enrichment_enabled: false,
  recall_max_results: 10,
  recall_compact_limit: 6,
  recall_top_match_limit: 4,
  recall_detail_expansion_limit: 2,
  recall_related_limit: 2,
  recall_proactive_limit: 2,
  auto_log: true,
  model_routing_table: null,
  project_workspace_registry: {},
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

// ---------------------------------------------------------------------------
// AI provider role resolution (primary / fallback)
// ---------------------------------------------------------------------------

/**
 * Which provider is primary. Falls back to the legacy single-provider
 * 'ai_provider' setting so pre-role configurations keep working.
 */
export function getPrimaryProviderId(db: DB): AiProviderId {
  return resolveAiProviderSettings({
    ai_provider_primary: getSetting(db, 'ai_provider_primary'),
    ai_provider: getSetting(db, 'ai_provider'),
  }).primaryProvider;
}

/**
 * Which provider (if any) is the fallback. Returns null for 'none' or when
 * the fallback would duplicate the primary.
 */
export function getFallbackProviderId(db: DB): AiProviderId | null {
  return resolveAiProviderSettings({
    ai_provider_primary: getSetting(db, 'ai_provider_primary'),
    ai_provider_fallback: getSetting(db, 'ai_provider_fallback'),
    ai_provider: getSetting(db, 'ai_provider'),
  }).fallbackProvider;
}
