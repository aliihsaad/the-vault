// ============================================================================
// Vault — Retrieve Service
// Find, filter, recall, and get memory items.
// ============================================================================

import { eq, and, like, desc, gte, lte, sql } from 'drizzle-orm';
import { existsSync, unlinkSync } from 'node:fs';
import { memoryItems } from '../database/schema.js';
import { FindMemoryQuerySchema, RecallQuerySchema } from '../rules/validation.js';
import { rankCandidates } from './ranking.service.js';
import {
  readMemoryFile,
  archiveFile,
  normalizeOrderedValues,
  normalizeRelatedFiles,
  normalizeTagLikeValues,
  rehomeMemoryFile,
  writeMemoryFile,
} from './file.service.js';
import { logActivity } from './log.service.js';
import { isEnrichmentAvailable, reRankWithLLM, generateContextSummary } from './enrichment.service.js';
import { expandRecallWithRelated, surfaceProactiveContext } from './agent-duties.service.js';
import { now } from '../utils/datetime.js';
import type {
  MemoryItem,
  MemoryItemDetail,
  RecallMatch,
  MemoryPack,
  FindMemoryQuery,
  RecallQuery,
} from '../types/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

function persistMemoryFile(item: MemoryItem): void {
  if (!item.vaultPath) {
    return;
  }

  writeMemoryFile(item.vaultPath, item);
}

function toRecallReasons(signals: Record<string, number>): string[] {
  const reasonMap: Array<[key: string, label: string]> = [
    ['projectMatch', 'same project'],
    ['titleExact', 'exact title match'],
    ['titlePartial', 'partial title match'],
    ['subjectExact', 'exact subject match'],
    ['subjectPartial', 'partial subject match'],
    ['keywordOverlap', 'keyword overlap'],
    ['tagOverlap', 'tag overlap'],
    ['promoted', 'promoted memory'],
    ['promotedDecision', 'promoted decision'],
    ['canonicalPromoted', 'canonical memory'],
    ['typePriority', 'high-value memory type'],
    ['priorityBoost', 'priority boost'],
    ['recency7d', 'recent within 7 days'],
    ['recency30d', 'recent within 30 days'],
    ['highAccess', 'frequently accessed'],
    ['relatedToTopMatch', 'related to top match'],
    ['proactiveContext', 'proactive context'],
    ['queryTextTitle', 'query matched title'],
    ['queryTextSubject', 'query matched subject'],
    ['queryTextSummary', 'query matched summary'],
    ['queryTextTag', 'query matched tags'],
    ['queryTextKeyword', 'query matched keywords'],
    ['queryTextWordTitle', 'query words matched title'],
    ['queryTextWordSubject', 'query words matched subject'],
    ['queryTextWordSummary', 'query words matched summary'],
  ];

  return reasonMap
    .filter(([key]) => (signals[key] || 0) > 0)
    .sort((left, right) => (signals[right[0]] || 0) - (signals[left[0]] || 0))
    .slice(0, 4)
    .map(([, label]) => label);
}

function toRecallMatch(score: number, signals: Record<string, number>, item: MemoryItem): RecallMatch {
  return {
    item,
    score,
    signals,
    reasons: toRecallReasons(signals),
  };
}

// ---------------------------------------------------------------------------
// Row-to-MemoryItem mapper
// ---------------------------------------------------------------------------
function mapRow(row: typeof memoryItems.$inferSelect): MemoryItem {
  return {
    id: row.id,
    itemUid: row.itemUid,
    title: row.title,
    project: row.project,
    sourceApp: row.sourceApp as MemoryItem['sourceApp'],
    sourceSessionId: row.sourceSessionId,
    memoryType: row.memoryType as MemoryItem['memoryType'],
    subject: row.subject,
    summary: row.summary,
    content: row.content,
    keywords: JSON.parse(row.keywordsJson || '[]'),
    tags: JSON.parse(row.tagsJson || '[]'),
    routineType: row.routineType as MemoryItem['routineType'],
    status: row.status as MemoryItem['status'],
    priority: row.priority as MemoryItem['priority'],
    promoted: row.promoted,
    nextSteps: JSON.parse(row.nextStepsJson || '[]'),
    relatedItemIds: JSON.parse(row.relatedItemIdsJson || '[]'),
    relatedFiles: JSON.parse(row.relatedFilesJson || '[]'),
    vaultPath: row.vaultPath,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastAccessedAt: row.lastAccessedAt,
    accessCount: row.accessCount,
  };
}

// ---------------------------------------------------------------------------
// findMemory — Structured filter/search
// ---------------------------------------------------------------------------
export function findMemory(db: DB, query: FindMemoryQuery): MemoryItem[] {
  const validated = FindMemoryQuerySchema.parse(query);
  const conditions = [];

  if (validated.project) {
    conditions.push(eq(memoryItems.project, validated.project));
  }
  if (validated.memoryType) {
    conditions.push(eq(memoryItems.memoryType, validated.memoryType));
  }
  if (validated.subject) {
    conditions.push(like(memoryItems.subject, `%${validated.subject}%`));
  }
  if (validated.status) {
    conditions.push(eq(memoryItems.status, validated.status));
  }
  if (validated.priority) {
    conditions.push(eq(memoryItems.priority, validated.priority));
  }
  if (validated.promoted !== undefined) {
    conditions.push(eq(memoryItems.promoted, validated.promoted));
  }
  if (validated.sourceApp) {
    conditions.push(eq(memoryItems.sourceApp, validated.sourceApp));
  }
  if (validated.dateFrom) {
    conditions.push(gte(memoryItems.createdAt, validated.dateFrom));
  }
  if (validated.dateTo) {
    conditions.push(lte(memoryItems.createdAt, validated.dateTo));
  }

  // Keyword filter: match any keyword in JSON array
  if (validated.keywords && validated.keywords.length > 0) {
    for (const kw of validated.keywords) {
      conditions.push(like(memoryItems.keywordsJson, `%${kw.toLowerCase()}%`));
    }
  }

  // Tag filter: match any tag in JSON array
  if (validated.tags && validated.tags.length > 0) {
    for (const tag of validated.tags) {
      conditions.push(like(memoryItems.tagsJson, `%${tag.toLowerCase()}%`));
    }
  }

  const rows =
    conditions.length > 0
      ? db
          .select()
          .from(memoryItems)
          .where(and(...conditions))
          .orderBy(desc(memoryItems.createdAt))
          .limit(validated.limit || 20)
          .offset(validated.offset || 0)
          .all()
      : db
          .select()
          .from(memoryItems)
          .orderBy(desc(memoryItems.createdAt))
          .limit(validated.limit || 20)
          .offset(validated.offset || 0)
          .all();

  return rows.map(mapRow);
}

// Score floor at which a topMatches hit counts toward an item's accessCount.
// Tuned so weak keyword overlaps don't reintroduce "any access = immortal".
// See decision vm_ycp9qL_0Vui9Fh9X.
const RECALL_BUMP_THRESHOLD = 20;

// ---------------------------------------------------------------------------
// recallContext — Smart recall with ranking
// ---------------------------------------------------------------------------
export async function recallContext(
  db: DB,
  logsPath: string,
  query: RecallQuery,
): Promise<MemoryPack> {
  const startTime = Date.now();
  const validated = RecallQuerySchema.parse(query);

  // Step 1: Get broad candidate set
  const conditions = [];
  if (validated.project) {
    conditions.push(eq(memoryItems.project, validated.project));
  }
  // Exclude terminal lifecycle states by default. Stale items still surface
  // (they're a soft warning, not removal); promoted items always surface.
  conditions.push(
    sql`${memoryItems.status} NOT IN ('archived', 'pending_delete') OR ${memoryItems.promoted} = 1`,
  );

  const candidates =
    conditions.length > 0
      ? db
          .select()
          .from(memoryItems)
          .where(and(...conditions))
          .all()
      : db.select().from(memoryItems).all();

  const items = candidates.map(mapRow);

  // Step 2: Rank candidates
  const ranked = rankCandidates(items, validated);

  // Step 3: Take top N
  const limit = validated.limit || 10;
  const topCandidates = ranked.slice(0, limit);

  // Step 4: Build initial matches
  let topMatches = topCandidates.map(({ item, score, signals }) =>
    toRecallMatch(score, signals, item),
  );

  // Step 4b: AI re-ranking (if enrichment is available and we have 3-15 candidates)
  if (isEnrichmentAvailable()) {
    try {
      topMatches = await reRankWithLLM(validated, topMatches);
    } catch {
      // Silent fallback — keep deterministic ranking
    }
  }

  // Step 5: Build memory pack
  const pack: MemoryPack = {
    summaries: [],
    decisions: [],
    plans: [],
    other: [],
    related: [],
    proactive: [],
    topMatches,
    totalCandidates: candidates.length,
    topScore: topMatches.length > 0 ? topMatches[0].score : 0,
  };

  const expandedPack = expandRecallWithRelated(db, pack, topMatches);
  let proactive: MemoryItem[] = [];
  if (validated.project) {
    const sessionKeywords = [
      ...(validated.keywords || []),
      ...(validated.tags || []),
      ...(validated.queryText ? validated.queryText.split(/\s+/) : []),
    ].filter((value) => value && value.length > 2);

    proactive = surfaceProactiveContext(db, validated.project, sessionKeywords, 5)
      .filter((item) => !expandedPack.topMatches.some((match) => match.item.itemUid === item.itemUid));
  }

  expandedPack.proactive = proactive;
  expandedPack.topScore = expandedPack.topMatches.length > 0 ? expandedPack.topMatches[0].score : 0;

  for (const match of expandedPack.topMatches) {
    const { item } = match;
    switch (item.memoryType) {
      case 'summary':
      case 'session':
        expandedPack.summaries.push(item);
        break;
      case 'decision':
        expandedPack.decisions.push(item);
        break;
      case 'plan':
        expandedPack.plans.push(item);
        break;
      default:
        expandedPack.other.push(item);
    }
  }

  // Step 5b: AI context summary
  if (isEnrichmentAvailable()) {
    try {
      const allItems = expandedPack.topMatches.map((m) => m.item);
      expandedPack.contextSummary = await generateContextSummary(validated, allItems) ?? undefined;
    } catch {
      // Silent fallback
    }
  }

  // Step 5c: Bump accessCount + lastAccessedAt for genuinely-relevant matches.
  // Decision vm_ycp9qL_0Vui9Fh9X: only score >= 20 counts as a real recall hit.
  // Below that, ranking signals are dominated by noise (single keyword overlap).
  const recallTimestamp = now();
  for (const match of expandedPack.topMatches) {
    if (match.score < RECALL_BUMP_THRESHOLD) continue;
    db.update(memoryItems)
      .set({
        lastAccessedAt: recallTimestamp,
        accessCount: sql`${memoryItems.accessCount} + 1`,
      })
      .where(eq(memoryItems.itemUid, match.item.itemUid))
      .run();
  }

  // Step 6: Log the recall
  const latencyMs = Date.now() - startTime;
  logActivity(db, logsPath, {
    sourceClient: 'system',
    project: validated.project,
    actionType: 'recall',
    status: 'success',
    latencyMs,
    aiUsed: isEnrichmentAvailable(),
    message: `Recalled ${expandedPack.topMatches.length} items from ${candidates.length} candidates`,
    metadata: {
      query: validated,
      totalCandidates: candidates.length,
      topScore: expandedPack.topScore,
      resultCount: expandedPack.topMatches.length,
      enriched: isEnrichmentAvailable(),
      relatedCount: expandedPack.related.length,
      proactiveCount: expandedPack.proactive.length,
      topMatches: expandedPack.topMatches.map((match) => ({
        itemUid: match.item.itemUid,
        score: match.score,
        reasons: match.reasons,
      })),
    },
  });

  return expandedPack;
}

// ---------------------------------------------------------------------------
// getLatest — Most recent N items
// ---------------------------------------------------------------------------
export function getLatest(
  db: DB,
  project?: string,
  limit: number = 10,
): MemoryItem[] {
  const conditions = [];
  if (project) {
    conditions.push(eq(memoryItems.project, project));
  }

  const rows =
    conditions.length > 0
      ? db
          .select()
          .from(memoryItems)
          .where(and(...conditions))
          .orderBy(desc(memoryItems.createdAt))
          .limit(limit)
          .all()
      : db
          .select()
          .from(memoryItems)
          .orderBy(desc(memoryItems.createdAt))
          .limit(limit)
          .all();

  return rows.map(mapRow);
}

// ---------------------------------------------------------------------------
// getMemoryDetail — Full item with file content, updates access stats
// ---------------------------------------------------------------------------
export function getMemoryDetail(
  db: DB,
  itemUid: string,
): MemoryItemDetail | null {
  const row = db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.itemUid, itemUid))
    .get();

  if (!row) return null;

  const item = mapRow(row);

  // Read file content if vault path exists
  let fileContent: string | null = null;
  if (item.vaultPath) {
    const parsed = readMemoryFile(item.vaultPath);
    if (parsed) {
      fileContent = parsed.content;
    }
  }

  // Update access stats
  db.update(memoryItems)
    .set({
      lastAccessedAt: now(),
      accessCount: row.accessCount + 1,
    })
    .where(eq(memoryItems.itemUid, itemUid))
    .run();

  return {
    ...item,
    accessCount: row.accessCount + 1,
    lastAccessedAt: now(),
    fileContent,
  };
}

// ---------------------------------------------------------------------------
// updateMemory — Partial update of a memory item
// ---------------------------------------------------------------------------
export function updateMemory(
  db: DB,
  vaultRoot: string,
  logsPath: string,
  itemUid: string,
  updates: Partial<MemoryItem>,
): MemoryItem | null {
  const row = db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.itemUid, itemUid))
    .get();

  if (!row) return null;

  const setValues: Record<string, unknown> = {
    updatedAt: now(),
  };

  const nextTitle = updates.title !== undefined ? updates.title.trim() : row.title;

  if (updates.title !== undefined) setValues.title = nextTitle;
  if (updates.subject !== undefined) setValues.subject = updates.subject.trim();
  if (updates.summary !== undefined) setValues.summary = updates.summary.trim();
  if (updates.content !== undefined) setValues.content = updates.content?.trim() || null;
  if (updates.status !== undefined) setValues.status = updates.status;
  if (updates.priority !== undefined) setValues.priority = updates.priority;
  if (updates.routineType !== undefined)
    setValues.routineType = updates.routineType?.trim() || null;
  if (updates.promoted !== undefined) setValues.promoted = updates.promoted;
  if (updates.keywords !== undefined)
    setValues.keywordsJson = JSON.stringify(normalizeTagLikeValues(updates.keywords));
  if (updates.tags !== undefined)
    setValues.tagsJson = JSON.stringify(normalizeTagLikeValues(updates.tags));
  if (updates.nextSteps !== undefined)
    setValues.nextStepsJson = JSON.stringify(normalizeOrderedValues(updates.nextSteps));
  if (updates.relatedItemIds !== undefined)
    setValues.relatedItemIdsJson = JSON.stringify(normalizeOrderedValues(updates.relatedItemIds));
  if (updates.relatedFiles !== undefined)
    setValues.relatedFilesJson = JSON.stringify(normalizeRelatedFiles(updates.relatedFiles));

  if (updates.title !== undefined && nextTitle !== row.title && row.vaultPath) {
    const nextVaultPath = rehomeMemoryFile(vaultRoot, {
      vaultPath: row.vaultPath,
      project: row.project,
      memoryType: row.memoryType as MemoryItem['memoryType'],
      title: nextTitle,
      createdAt: row.createdAt,
    });

    if (nextVaultPath) {
      setValues.vaultPath = nextVaultPath;
    }
  }

  db.update(memoryItems)
    .set(setValues)
    .where(eq(memoryItems.itemUid, itemUid))
    .run();

  // Log the update
  logActivity(db, logsPath, {
    sourceClient: 'system',
    actionType: 'update',
    targetItemId: itemUid,
    status: 'success',
    message: `Updated: ${Object.keys(setValues).join(', ')}`,
  });

  // Return updated item
  const updated = db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.itemUid, itemUid))
    .get();
  if (!updated) return null;

  const updatedItem = mapRow(updated);
  persistMemoryFile(updatedItem);
  return updatedItem;
}

// ---------------------------------------------------------------------------
// promoteMemory — Promote an item to long-term memory
// ---------------------------------------------------------------------------
export function promoteMemory(
  db: DB,
  logsPath: string,
  itemUid: string,
): MemoryItem | null {
  const row = db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.itemUid, itemUid))
    .get();

  if (!row) return null;

  db.update(memoryItems)
    .set({
      promoted: true,
      status: 'promoted',
      updatedAt: now(),
    })
    .where(eq(memoryItems.itemUid, itemUid))
    .run();

  logActivity(db, logsPath, {
    sourceClient: 'system',
    actionType: 'promote',
    targetItemId: itemUid,
    project: row.project,
    status: 'success',
    message: `Promoted: ${row.title}`,
  });

  const updated = db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.itemUid, itemUid))
    .get();
  if (!updated) return null;

  const updatedItem = mapRow(updated);
  persistMemoryFile(updatedItem);
  return updatedItem;
}

// ---------------------------------------------------------------------------
// archiveMemory — Archive an item
// ---------------------------------------------------------------------------
export function archiveMemory(
  db: DB,
  vaultRoot: string,
  logsPath: string,
  itemUid: string,
): MemoryItem | null {
  const row = db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.itemUid, itemUid))
    .get();

  if (!row) return null;

  // Archive the file
  if (row.vaultPath) {
    const newPath = archiveFile(vaultRoot, row.vaultPath);
    if (newPath) {
      db.update(memoryItems)
        .set({ vaultPath: newPath })
        .where(eq(memoryItems.itemUid, itemUid))
        .run();
    }
  }

  db.update(memoryItems)
    .set({
      status: 'archived',
      updatedAt: now(),
    })
    .where(eq(memoryItems.itemUid, itemUid))
    .run();

  logActivity(db, logsPath, {
    sourceClient: 'system',
    actionType: 'archive',
    targetItemId: itemUid,
    project: row.project,
    status: 'success',
    message: `Archived: ${row.title}`,
  });

  const updated = db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.itemUid, itemUid))
    .get();
  if (!updated) return null;

  const updatedItem = mapRow(updated);
  persistMemoryFile(updatedItem);
  return updatedItem;
}

// ---------------------------------------------------------------------------
// Lifecycle transitions: active → stale → archived → pending_delete → deleted
// ---------------------------------------------------------------------------

/**
 * Flag a memory as 'stale' — soft warning that it has been idle and lightly
 * used. Stays recallable (de-prioritized) so the user has a chance to reach
 * back for it. Promoted items are never marked stale.
 */
export function markMemoryStale(
  db: DB,
  logsPath: string,
  itemUid: string,
): MemoryItem | null {
  const row = db.select().from(memoryItems).where(eq(memoryItems.itemUid, itemUid)).get();
  if (!row || row.promoted) return null;

  db.update(memoryItems)
    .set({ status: 'stale', updatedAt: now() })
    .where(eq(memoryItems.itemUid, itemUid))
    .run();

  logActivity(db, logsPath, {
    sourceClient: 'system',
    actionType: 'update',
    targetItemId: itemUid,
    project: row.project,
    status: 'success',
    message: `Marked stale: ${row.title}`,
    metadata: { lifecycleStage: 'stale' },
  });

  const updated = db.select().from(memoryItems).where(eq(memoryItems.itemUid, itemUid)).get();
  return updated ? mapRow(updated) : null;
}

/**
 * Flag an archived memory as 'pending_delete'. The agent never auto-deletes;
 * it just queues the candidate. Final removal requires confirmMemoryDelete
 * (driven by user action via the dashboard or an explicit MCP tool).
 */
export function markMemoryPendingDelete(
  db: DB,
  logsPath: string,
  itemUid: string,
): MemoryItem | null {
  const row = db.select().from(memoryItems).where(eq(memoryItems.itemUid, itemUid)).get();
  if (!row || row.promoted) return null;

  db.update(memoryItems)
    .set({ status: 'pending_delete', updatedAt: now() })
    .where(eq(memoryItems.itemUid, itemUid))
    .run();

  logActivity(db, logsPath, {
    sourceClient: 'system',
    actionType: 'update',
    targetItemId: itemUid,
    project: row.project,
    status: 'success',
    message: `Pending delete: ${row.title}`,
    metadata: { lifecycleStage: 'pending_delete' },
  });

  const updated = db.select().from(memoryItems).where(eq(memoryItems.itemUid, itemUid)).get();
  return updated ? mapRow(updated) : null;
}

/**
 * Permanently delete a pending_delete (or archived) memory. Removes the DB
 * row and the Markdown file. Refuses unless the item is in pending_delete or
 * archived — so an active or stale item can never be lost by a stray call.
 */
export function confirmMemoryDelete(
  db: DB,
  vaultRoot: string,
  logsPath: string,
  itemUid: string,
): boolean {
  const row = db.select().from(memoryItems).where(eq(memoryItems.itemUid, itemUid)).get();
  if (!row) return false;
  if (row.promoted) return false;
  if (row.status !== 'pending_delete' && row.status !== 'archived') return false;

  if (row.vaultPath) {
    try {
      if (existsSync(row.vaultPath)) unlinkSync(row.vaultPath);
    } catch {
      // Filesystem failure must not block DB deletion: the row is source of
      // truth and the file may have been moved or removed externally.
    }
  }

  db.delete(memoryItems).where(eq(memoryItems.itemUid, itemUid)).run();

  logActivity(db, logsPath, {
    sourceClient: 'system',
    actionType: 'delete',
    targetItemId: itemUid,
    project: row.project,
    status: 'success',
    message: `Deleted: ${row.title}`,
    metadata: { lifecycleStage: 'deleted', vaultRoot },
  });

  return true;
}
