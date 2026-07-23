// ============================================================================
// Vault — Retrieve Service
// Find, filter, recall, and get memory items.
// ============================================================================

import { eq, and, like, desc, asc, gte, lte, sql, or, inArray, notInArray } from 'drizzle-orm';
import { existsSync, unlinkSync } from 'node:fs';
import { memoryItems } from '../database/schema.js';
import {
  CountOpenLoopsInputSchema,
  FindMemoryQuerySchema,
  ListOpenLoopsInputSchema,
  RecallQuerySchema,
  ResolveLoopBatchInputSchema,
  ResolveLoopInputSchema,
} from '../rules/validation.js';
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
import { getProject, resolveCanonicalProjectName } from './project.service.js';
import { isEnrichmentAvailable, reRankWithLLM, generateContextSummary } from './enrichment.service.js';
import { expandRecallWithRelated, surfaceProactiveContext } from './agent-duties.service.js';
import { now } from '../utils/datetime.js';
import { extractMemoryUidTokens } from '../utils/memory-uid.js';
import type {
  MemoryItem,
  MemoryItemDetail,
  RecallMatch,
  MemoryPack,
  FindMemoryQuery,
  RecallQuery,
  OpenLoop,
  OpenLoopBucket,
  ResolveLoopInput,
  ListOpenLoopsInput,
  ListOpenLoopsResult,
  OpenLoopListItem,
  CountOpenLoopsInput,
  CountOpenLoopsResult,
  ResolveLoopBatchResult,
  ResolveLoopBatchInput,
} from '../types/index.js';
import {
  OPEN_LOOP_PRIORITY_WEIGHT,
  OPEN_LOOP_ROUTINE_WEIGHT,
  OPEN_LOOP_RECENT_REFERENCE_BOOST,
  OPEN_LOOP_RECENT_REFERENCE_DAYS,
  OPEN_LOOP_BUCKET_HIGH_THRESHOLD,
  OPEN_LOOP_BUCKET_MEDIUM_THRESHOLD,
} from '../rules/controlled-values.js';
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
    ['memoryUidExact', 'exact memory UID match'],
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
    snoozedUntil: row.snoozedUntil,
    outcome: row.outcome as MemoryItem['outcome'],
  };
}

// ---------------------------------------------------------------------------
// findMemory — Structured filter/search
// ---------------------------------------------------------------------------
export function findMemory(db: DB, query: FindMemoryQuery): MemoryItem[] {
  const validated = FindMemoryQuerySchema.parse(query);
  const conditions = [];

  if (validated.project) {
    conditions.push(eq(memoryItems.project, resolveCanonicalProjectName(db, validated.project)));
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
  const requestedItemUids = extractMemoryUidTokens(
    validated.queryText,
    validated.subject,
    validated.keywords,
    validated.tags,
  );

  // Step 1: Get broad candidate set. Resolve the project through the registry
  // so slug/casing variants ("vault-collab", "VAULT COLLAB") reach the
  // canonical stored name instead of silently matching nothing.
  const projectName = validated.project
    ? resolveCanonicalProjectName(db, validated.project)
    : undefined;
  const conditions = [];
  if (projectName) {
    conditions.push(requestedItemUids.length > 0
      ? or(eq(memoryItems.project, projectName), inArray(memoryItems.itemUid, requestedItemUids))
      : eq(memoryItems.project, projectName));
  }
  // Exclude terminal lifecycle states by default. Stale items still surface
  // (they're a soft warning, not removal); promoted items always surface even
  // when archived — but only within the project scope above. Composed with
  // drizzle or() so the OR is parenthesized and can never escape the project
  // filter (a raw sql fragment here previously leaked every promoted item
  // from every project into every recall).
  const recallableState = or(
    notInArray(memoryItems.status, ['archived', 'pending_delete']),
    eq(memoryItems.promoted, true),
  );
  conditions.push(requestedItemUids.length > 0
    ? or(recallableState, inArray(memoryItems.itemUid, requestedItemUids))
    : recallableState);

  const candidates =
    conditions.length > 0
      ? db
          .select()
          .from(memoryItems)
          .where(and(...conditions))
          .all()
      : db.select().from(memoryItems).all();

  const items = candidates.map(mapRow);

  // Step 2: Rank candidates (against the resolved project name so the
  // same-project signal fires consistently for slug/casing queries)
  const ranked = rankCandidates(items, { ...validated, project: projectName });

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
    openLoops: [],
  };

  const expandedPack = expandRecallWithRelated(db, pack, topMatches);
  let proactive: MemoryItem[] = [];
  if (projectName) {
    const sessionKeywords = [
      ...(validated.keywords || []),
      ...(validated.tags || []),
      ...(validated.queryText ? validated.queryText.split(/\s+/) : []),
    ].filter((value) => value && value.length > 2);

    proactive = surfaceProactiveContext(db, projectName, sessionKeywords, 5)
      .filter((item) => !expandedPack.topMatches.some((match) => match.item.itemUid === item.itemUid));
  }

  expandedPack.proactive = proactive;
  expandedPack.topScore = expandedPack.topMatches.length > 0 ? expandedPack.topMatches[0].score : 0;

  // Step 5a: Surface open loops scoped to the recall query so skills can
  // close-the-loop on every recall. See plan vm_-wkwx67j33XDx2aE Step 3.
  // Cap to avoid swamping recall responses; skills only need the most
  // urgent few. expandRecallWithRelated may have widened the result set
  // beyond the original limit, so the cap is independent.
  const OPEN_LOOPS_RECALL_CAP = 5;
  expandedPack.openLoops = getOpenLoops(db, projectName).slice(0, OPEN_LOOPS_RECALL_CAP);

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
    conditions.push(eq(memoryItems.project, resolveCanonicalProjectName(db, project)));
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

  if (updates.nextSteps !== undefined) {
    const normalizedNextSteps = normalizeOrderedValues(updates.nextSteps);
    const project = getProject(db, row.project);
    if (project?.projectType === 'brain_context' && normalizedNextSteps.length > 0) {
      throw new Error('Brain contexts cannot store non-empty next_steps; route executable work to a Work Project');
    }
  }

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
  if (updates.snoozedUntil !== undefined)
    setValues.snoozedUntil = updates.snoozedUntil ?? null;
  if (updates.outcome !== undefined)
    setValues.outcome = updates.outcome ?? null;

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

// ---------------------------------------------------------------------------
// getOpenLoops — Surface unfinished work using derived priority buckets
//
// Plan vm_-wkwx67j33XDx2aE + addendum vm_aoMAWT1zG56tt9M0. Pure query-side
// scoring (no stored bucket). Sources: active memories with non-empty
// next_steps, plus active debugging items (which signal unfinished work
// even without explicit next steps). Snoozed and terminal-status items
// are excluded.
// ---------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseNextStepsForOpenLoop(raw: string | null): string[] {
  const value = raw?.trim();
  if (!value || value === '[]') return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((step): step is string => typeof step === 'string')
        .map((step) => step.trim())
        .filter(Boolean);
    }
    if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim()];
    return [];
  } catch {
    return [value].filter(Boolean);
  }
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getExplicitOpenLoopRows(
  db: DB,
  filters: {
    project?: string;
    priority?: string;
    createdFrom?: string;
    createdTo?: string;
  },
): Array<typeof memoryItems.$inferSelect> {
  const conditions = [
    eq(memoryItems.status, 'active'),
    sql`${memoryItems.nextStepsJson} IS NOT NULL`,
    sql`TRIM(${memoryItems.nextStepsJson}) NOT IN ('', '[]')`,
  ];

  if (filters.project) {
    conditions.push(eq(memoryItems.project, filters.project));
  }
  if (filters.priority) {
    conditions.push(eq(memoryItems.priority, filters.priority));
  }
  if (filters.createdFrom) {
    conditions.push(gte(memoryItems.createdAt, filters.createdFrom));
  }
  if (filters.createdTo) {
    conditions.push(lte(memoryItems.createdAt, filters.createdTo));
  }

  return db
    .select()
    .from(memoryItems)
    .where(and(...conditions))
    .orderBy(asc(memoryItems.updatedAt), asc(memoryItems.id))
    .all();
}

function toOpenLoopListItem(row: typeof memoryItems.$inferSelect): OpenLoopListItem | null {
  const nextSteps = parseNextStepsForOpenLoop(row.nextStepsJson);
  if (nextSteps.length === 0) {
    return null;
  }

  return {
    itemUid: row.itemUid,
    title: row.title,
    project: row.project,
    memoryType: row.memoryType as OpenLoopListItem['memoryType'],
    subject: row.subject,
    priority: row.priority as OpenLoopListItem['priority'],
    tags: parseStringArray(row.tagsJson),
    nextSteps,
    lastAccessedAt: row.lastAccessedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function hasAllTags(item: OpenLoopListItem, requestedTags: string[]): boolean {
  if (requestedTags.length === 0) {
    return true;
  }

  const itemTags = new Set(item.tags.map((tag) => tag.toLowerCase()));
  return requestedTags.every((tag) => itemTags.has(tag.toLowerCase()));
}

function getExplicitOpenLoopItems(
  db: DB,
  filters: {
    project?: string;
    tags?: string[];
    priority?: string;
    createdFrom?: string;
    createdTo?: string;
  },
): OpenLoopListItem[] {
  const requestedTags = filters.tags ?? [];
  return getExplicitOpenLoopRows(db, filters)
    .map(toOpenLoopListItem)
    .filter((item): item is OpenLoopListItem => Boolean(item))
    .filter((item) => hasAllTags(item, requestedTags));
}

export function listOpenLoops(
  db: DB,
  input: ListOpenLoopsInput = {},
): ListOpenLoopsResult {
  const validated = ListOpenLoopsInputSchema.parse(input);
  const items = getExplicitOpenLoopItems(db, validated);
  const page = items.slice(validated.offset, validated.offset + validated.limit);

  return {
    source: 'legacy_memory_items',
    total: items.length,
    limit: validated.limit,
    offset: validated.offset,
    hasMore: validated.offset + validated.limit < items.length,
    generatedAt: now(),
    items: page,
  };
}

export function countOpenLoops(
  db: DB,
  input: CountOpenLoopsInput = {},
): CountOpenLoopsResult {
  const validated = CountOpenLoopsInputSchema.parse(input);
  const items = getExplicitOpenLoopItems(db, validated);
  const result: CountOpenLoopsResult = {
    source: 'legacy_memory_items',
    total: items.length,
    generatedAt: now(),
  };

  if (validated.byProject) {
    result.byProject = {};
    const projects = [...new Set(items.map((item) => item.project))]
      .sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
    for (const project of projects) {
      result.byProject[project] = items.filter((item) => item.project === project).length;
    }
  }

  return result;
}

function bucketForScore(score: number): OpenLoopBucket {
  if (score >= OPEN_LOOP_BUCKET_HIGH_THRESHOLD) return 'high';
  if (score >= OPEN_LOOP_BUCKET_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

export function getOpenLoops(db: DB, project?: string): OpenLoop[] {
  const nowDate = new Date();
  const nowIso = nowDate.toISOString();

  const conditions = [
    eq(memoryItems.status, 'active'),
    sql`(${memoryItems.snoozedUntil} IS NULL OR ${memoryItems.snoozedUntil} <= ${nowIso})`,
  ];
  if (project) {
    conditions.push(eq(memoryItems.project, project));
  }

  const rows = db
    .select()
    .from(memoryItems)
    .where(and(...conditions))
    .all();

  const loops: OpenLoop[] = [];

  for (const row of rows) {
    const item = mapRow(row);
    const hasNextSteps = item.nextSteps.length > 0;
    const isStaleDebugging = item.routineType === 'debugging';
    if (!hasNextSteps && !isStaleDebugging) continue;

    const updatedMs = new Date(item.updatedAt).getTime();
    const daysOpen = Math.max(0, Math.floor((nowDate.getTime() - updatedMs) / DAY_MS));

    const lastAccess = item.lastAccessedAt ? new Date(item.lastAccessedAt).getTime() : null;
    const recentlyReferenced =
      lastAccess !== null &&
      (nowDate.getTime() - lastAccess) <= OPEN_LOOP_RECENT_REFERENCE_DAYS * DAY_MS;

    const priorityWeight = OPEN_LOOP_PRIORITY_WEIGHT[item.priority] ?? 5;
    const routineWeight = item.routineType
      ? (OPEN_LOOP_ROUTINE_WEIGHT[item.routineType] ?? 0)
      : 0;
    const recencyBoost = recentlyReferenced ? OPEN_LOOP_RECENT_REFERENCE_BOOST : 0;

    const score = priorityWeight + daysOpen * 2 + recencyBoost + routineWeight;

    loops.push({
      itemUid: item.itemUid,
      title: item.title,
      project: item.project,
      memoryType: item.memoryType,
      subject: item.subject,
      summary: item.summary,
      priority: item.priority,
      routineType: item.routineType,
      tags: item.tags,
      nextSteps: item.nextSteps,
      lastUpdated: item.updatedAt,
      lastAccessedAt: item.lastAccessedAt,
      daysOpen,
      score,
      bucket: bucketForScore(score),
      recentlyReferenced,
    });
  }

  const bucketOrder: Record<OpenLoopBucket, number> = { high: 0, medium: 1, low: 2 };
  loops.sort((left, right) => {
    const bucketDiff = bucketOrder[left.bucket] - bucketOrder[right.bucket];
    if (bucketDiff !== 0) return bucketDiff;
    if (right.score !== left.score) return right.score - left.score;
    return right.daysOpen - left.daysOpen;
  });

  return loops;
}

// ---------------------------------------------------------------------------
// resolveLoop — Close an open loop with an outcome.
//
// Atomic single-call close: sets status='resolved', stores the outcome enum
// value, optionally appends a resolution note to content, and logs a
// dedicated `resolve_loop` activity row so adoption (close-rate) is
// queryable from activity_logs. See plan vm_-wkwx67j33XDx2aE Step 3.
// ---------------------------------------------------------------------------
export function resolveLoop(
  db: DB,
  logsPath: string,
  input: ResolveLoopInput,
): MemoryItem | null {
  const validated = ResolveLoopInputSchema.parse(input);

  const row = db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.itemUid, validated.itemUid))
    .get();
  if (!row) return null;

  const timestamp = now();
  const note = validated.resolutionNote?.trim();
  const nextContent = note
    ? appendResolutionNote(row.content, note, validated.outcome, timestamp)
    : row.content;

  db.update(memoryItems)
    .set({
      status: 'resolved',
      outcome: validated.outcome,
      content: nextContent,
      updatedAt: timestamp,
    })
    .where(eq(memoryItems.itemUid, validated.itemUid))
    .run();

  logActivity(db, logsPath, {
    sourceClient: 'system',
    project: row.project,
    actionType: 'resolve_loop',
    targetItemId: validated.itemUid,
    status: 'success',
    message: `Resolved loop (${validated.outcome}): ${row.title}`,
    metadata: {
      outcome: validated.outcome,
      hasNote: Boolean(note),
    },
  });

  const updated = db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.itemUid, validated.itemUid))
    .get();
  if (!updated) return null;

  const updatedItem = mapRow(updated);
  persistMemoryFile(updatedItem);
  return updatedItem;
}

export function resolveLoopBatch(
  db: DB,
  logsPath: string,
  input: ResolveLoopBatchInput,
): ResolveLoopBatchResult & { resolvedItems: MemoryItem[] } {
  const validated = ResolveLoopBatchInputSchema.parse(input);
  const seen = new Set<string>();
  const resolved: string[] = [];
  const resolvedItems: MemoryItem[] = [];
  const failed: ResolveLoopBatchResult['failed'] = [];

  for (const item of validated.items) {
    if (seen.has(item.itemUid)) {
      failed.push({
        itemUid: item.itemUid,
        reason: 'duplicate_item_uid',
        message: 'Duplicate item_uid in batch request.',
      });
      continue;
    }
    seen.add(item.itemUid);

    const row = db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.itemUid, item.itemUid))
      .get();

    if (!row) {
      failed.push({
        itemUid: item.itemUid,
        reason: 'not_found',
        message: 'Memory item not found.',
      });
      continue;
    }

    if (row.status !== 'active' || parseNextStepsForOpenLoop(row.nextStepsJson).length === 0) {
      failed.push({
        itemUid: item.itemUid,
        reason: 'not_open_loop',
        message: 'Memory item is not an active explicit open loop.',
      });
      continue;
    }

    try {
      const updated = resolveLoop(db, logsPath, {
        itemUid: item.itemUid,
        outcome: item.outcome,
        resolutionNote: item.resolutionNote,
      });

      if (!updated) {
        failed.push({
          itemUid: item.itemUid,
          reason: 'internal_error',
          message: 'Memory item could not be resolved after preflight.',
        });
        continue;
      }

      resolved.push(item.itemUid);
      resolvedItems.push(updated);
    } catch (error) {
      failed.push({
        itemUid: item.itemUid,
        reason: 'internal_error',
        message: error instanceof Error ? error.message : 'Unexpected error while resolving loop.',
      });
    }
  }

  return {
    requested: validated.items.length,
    resolved,
    failed,
    generatedAt: now(),
    resolvedItems,
  };
}

function appendResolutionNote(
  current: string | null,
  note: string,
  outcome: string,
  timestamp: string,
): string {
  const header = `## Resolution (${outcome}) — ${timestamp}`;
  const block = `${header}\n\n${note}`;
  if (!current || current.trim().length === 0) return block;
  return `${current.trimEnd()}\n\n${block}`;
}
