// ============================================================================
// Vault — Log Service
// Activity logging to both the database and JSON-lines log files.
// ============================================================================

import { desc, eq, and, gte, lte } from 'drizzle-orm';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { activityLogs } from '../database/schema.js';
import { now } from '../utils/datetime.js';
import type { ActivityLogEntry } from '../types/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

/**
 * Log an activity to the database and optionally to a log file.
 */
export function logActivity(
  db: DB,
  logsPath: string,
  entry: ActivityLogEntry,
): void {
  const timestamp = entry.timestamp || now();

  // Insert into DB
  db.insert(activityLogs)
    .values({
      timestamp,
      sourceClient: entry.sourceClient,
      project: entry.project || null,
      actionType: entry.actionType,
      targetItemId: entry.targetItemId || null,
      status: entry.status || 'success',
      latencyMs: entry.latencyMs || null,
      aiUsed: entry.aiUsed || false,
      message: entry.message || null,
      metadataJson: entry.metadata ? JSON.stringify(entry.metadata) : null,
    })
    .run();

  // Also write to JSON-lines log file
  writeLogLine(logsPath, {
    ...entry,
    timestamp,
  });
}

/**
 * Get recent activity log entries.
 */
export function getRecentLogs(
  db: DB,
  limit: number = 50,
  filters?: {
    actionType?: string;
    project?: string;
    sourceClient?: string;
    dateFrom?: string;
    dateTo?: string;
  },
): ActivityLogEntry[] {
  let query = db.select().from(activityLogs);

  // Build conditions array
  const conditions = [];
  if (filters?.actionType) {
    conditions.push(eq(activityLogs.actionType, filters.actionType));
  }
  if (filters?.project) {
    conditions.push(eq(activityLogs.project, filters.project));
  }
  if (filters?.sourceClient) {
    conditions.push(eq(activityLogs.sourceClient, filters.sourceClient));
  }
  if (filters?.dateFrom) {
    conditions.push(gte(activityLogs.timestamp, filters.dateFrom));
  }
  if (filters?.dateTo) {
    conditions.push(lte(activityLogs.timestamp, filters.dateTo));
  }

  const rows =
    conditions.length > 0
      ? db
          .select()
          .from(activityLogs)
          .where(and(...conditions))
          .orderBy(desc(activityLogs.timestamp))
          .limit(limit)
          .all()
      : db
          .select()
          .from(activityLogs)
          .orderBy(desc(activityLogs.timestamp))
          .limit(limit)
          .all();

  return rows.map(mapLogRow);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function writeLogLine(logsPath: string, entry: ActivityLogEntry): void {
  if (!existsSync(logsPath)) {
    mkdirSync(logsPath, { recursive: true });
  }

  // Daily log file: vault-YYYY-MM-DD.jsonl
  const date = new Date().toISOString().split('T')[0];
  const logFile = join(logsPath, `vault-${date}.jsonl`);

  const line = JSON.stringify(entry) + '\n';
  appendFileSync(logFile, line, 'utf-8');
}

function mapLogRow(row: typeof activityLogs.$inferSelect): ActivityLogEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    sourceClient: row.sourceClient,
    project: row.project || undefined,
    actionType: row.actionType as ActivityLogEntry['actionType'],
    targetItemId: row.targetItemId || undefined,
    status: row.status,
    latencyMs: row.latencyMs || undefined,
    aiUsed: row.aiUsed,
    message: row.message || undefined,
    metadata: row.metadataJson ? JSON.parse(row.metadataJson) : undefined,
  };
}
