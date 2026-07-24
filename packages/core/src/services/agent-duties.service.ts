import { and, eq } from 'drizzle-orm';
import {
  memoryItems,
  memoryLinks,
  projects,
  projectRelationships,
  tasks,
} from '../database/schema.js';
import { getSetting, setSetting, getPrimaryProviderId } from '../config/settings.js';
import { slugify } from '../rules/naming.js';
import {
  detectDuplicates,
  getEnrichmentClient,
  isEnrichmentAvailable,
} from './enrichment.service.js';
import { logActivity } from './log.service.js';
import { createProjectProposal } from './proposal.service.js';
import {
  archiveMemory,
  markMemoryPendingDelete,
  markMemoryStale,
  promoteMemory,
  updateMemory,
} from './retrieve.service.js';
import { createTask, getRoutingTable as getProviderRoutingTable } from './task.service.js';
import { now } from '../utils/datetime.js';
import type {
  AgentDutyMaintenanceResult,
  AgentDutyScheduleResult,
  DuplicateDetectionResult,
  DuplicateMatch,
  MemoryItem,
  MemoryPack,
  MergeMemoryItemsResult,
  ProjectBriefing,
  ProjectProposal,
  ProjectReviewOptions,
  ProjectReviewResult,
  RecallMatch,
  StaleArchivalOptions,
  VaultTask,
} from '../types/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

const SUMMARY_ENRICH_THRESHOLD = 100;
const DUPLICATE_MERGE_THRESHOLD = 0.72;
const DUTY_TASK_ACTIVE_STATUSES = new Set(['pending', 'running']);
const NON_ARCHIVABLE_MEMORY_TYPES = new Set(['decision', 'plan', 'handoff']);

// Items recalled at least this many times (with score >= RECALL_BUMP_THRESHOLD)
// are considered actively useful and stay protected from staleness even when
// untouched past the cutoff. Below this count, age wins.
const STALE_LOW_USAGE_THRESHOLD = 3;
const MAX_RELATED_EXPANSION = 5;
const PRIORITY_RANK: Record<MemoryItem['priority'], number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
  canonical: 4,
};

export async function schedulePostSaveDuties(
  db: DB,
  logsPath: string,
  item: MemoryItem,
  options: { vaultRoot?: string } = {},
): Promise<AgentDutyScheduleResult> {
  if (shouldSkipPostSaveDuties(item)) {
    return {
      sourceItemUid: item.itemUid,
      createdTasks: [],
      duplicateDetection: {
        sourceItemUid: item.itemUid,
        matches: [],
        linkedItemUids: [],
      },
    };
  }

  const duplicateDetection = await executeDuplicateDetection(db, logsPath, item.itemUid);
  const createdTasks: AgentDutyScheduleResult['createdTasks'] = [];

  const organizeReasons = [
    ...collectMetadataGaps(item),
    ...duplicateDetection.matches.map((match) =>
      match.suggestedAction === 'merge'
        ? `Potential duplicate to review for merge: ${match.title} (${match.similarity})`
        : `Related memory to link and cross-reference: ${match.title} (${match.similarity})`,
    ),
  ];

  if (organizeReasons.length > 0) {
    const organizeTask = createDutyTaskIfMissing(db, logsPath, item, 'organize', {
      title: `Organize ${item.title}`,
      prompt: buildOrganizePrompt(item, organizeReasons, duplicateDetection.matches),
      context: {
        dutyType: 'post_save_organize',
        // Duty results are applied to the source memory (or kept as task
        // recommendations) — persisting them as standalone memories would
        // flood the project with agent-activity noise.
        skipResultMemory: true,
        source_item_uid: item.itemUid,
        duty_reasons: organizeReasons,
        duplicate_matches: duplicateDetection.matches,
        current_metadata: {
          tags: item.tags,
          keywords: item.keywords,
          relatedItemIds: item.relatedItemIds,
          relatedFiles: item.relatedFiles,
        },
      },
    });

    if (organizeTask) {
      createdTasks.push({
        taskUid: organizeTask.taskUid,
        taskType: organizeTask.taskType,
        reason: duplicateDetection.matches.length > 0 ? 'duplicate_review' : 'metadata_organize',
      });
    }
  }

  if (item.summary.trim().length < SUMMARY_ENRICH_THRESHOLD) {
    const enrichTask = createDutyTaskIfMissing(db, logsPath, item, 'enrich', {
      title: `Enrich ${item.title}`,
      prompt: buildEnrichPrompt(item),
      context: {
        dutyType: 'post_save_enrich',
        skipResultMemory: true,
        source_item_uid: item.itemUid,
        summary_length: item.summary.trim().length,
        current_summary: item.summary,
      },
    });

    if (enrichTask) {
      createdTasks.push({
        taskUid: enrichTask.taskUid,
        taskType: enrichTask.taskType,
        reason: 'quality_check',
      });
    }
  }

  if (createdTasks.length > 0) {
    logActivity(db, logsPath, {
      sourceClient: 'system',
      project: item.project,
      actionType: 'task_create',
      targetItemId: item.itemUid,
      status: 'success',
      message: `Scheduled ${createdTasks.length} post-save duty task(s) for ${item.title}`,
      metadata: {
        sourceItemUid: item.itemUid,
        tasks: createdTasks,
      },
    });
  }

  // Project-level review (Layer 2 step 3). Gated by settings + cooldown
  // inside executeProjectReview, so it's safe to call on every save —
  // the duty short-circuits when disabled or recently run.
  void executeProjectReview(db, options.vaultRoot ?? '', logsPath, item.project, {})
    .catch(() => {
      // Silent — project review must never block save scheduling
    });

  return {
    sourceItemUid: item.itemUid,
    createdTasks,
    duplicateDetection,
  };
}

export async function executeDuplicateDetection(
  db: DB,
  logsPath: string,
  sourceItemUid: string,
): Promise<DuplicateDetectionResult> {
  const source = getMemoryItemByUid(db, sourceItemUid);
  if (!source) {
    return {
      sourceItemUid,
      matches: [],
      linkedItemUids: [],
    };
  }

  const candidates = db
    .select()
    .from(memoryItems)
    .all()
    .map(mapMemoryRow)
    .filter((item) =>
      item.itemUid !== sourceItemUid
      && item.project === source.project
      && item.status !== 'archived',
    );

  if (!source.summary.trim() || candidates.length === 0) {
    return {
      sourceItemUid,
      matches: [],
      linkedItemUids: [],
    };
  }

  const duplicates = await detectDuplicates(
    source.summary,
    candidates.map((candidate) => ({
      itemUid: candidate.itemUid,
      summary: candidate.summary,
    })),
  );

  const candidateMap = new Map(candidates.map((candidate) => [candidate.itemUid, candidate]));
  const sourceRelated = new Set(source.relatedItemIds);
  const linkedItemUids: string[] = [];
  const matches: DuplicateMatch[] = [];

  for (const duplicate of duplicates) {
    const candidate = candidateMap.get(duplicate.itemUid);
    if (!candidate) {
      continue;
    }

    const suggestedAction = duplicate.similarity >= DUPLICATE_MERGE_THRESHOLD ? 'merge' : 'link';
    matches.push({
      itemUid: candidate.itemUid,
      title: candidate.title,
      similarity: Number(duplicate.similarity.toFixed(3)),
      suggestedAction,
    });

    if (!sourceRelated.has(candidate.itemUid)) {
      sourceRelated.add(candidate.itemUid);
      linkedItemUids.push(candidate.itemUid);
    }

    const candidateRelated = new Set(candidate.relatedItemIds);
    if (!candidateRelated.has(source.itemUid)) {
      candidateRelated.add(source.itemUid);
      updateMemory(db, getVaultRootFromPath(source.vaultPath), logsPath, candidate.itemUid, {
        relatedItemIds: Array.from(candidateRelated),
      });
    }

    ensureMemoryLink(db, source.itemUid, candidate.itemUid, 'related');
  }

  if (linkedItemUids.length > 0) {
    updateMemory(db, getVaultRootFromPath(source.vaultPath), logsPath, source.itemUid, {
      relatedItemIds: Array.from(sourceRelated),
    });

    logActivity(db, logsPath, {
      sourceClient: 'system',
      project: source.project,
      actionType: 'enrich',
      targetItemId: source.itemUid,
      status: 'success',
      message: `Detected ${matches.length} duplicate candidate(s) for ${source.title}`,
      metadata: {
        matches,
      },
    });
  }

  return {
    sourceItemUid,
    matches,
    linkedItemUids,
  };
}

export function mergeMemoryItems(
  db: DB,
  vaultRoot: string,
  logsPath: string,
  keepUid: string,
  mergeUid: string,
): MergeMemoryItemsResult | null {
  if (keepUid === mergeUid) {
    return null;
  }

  const keepItem = getMemoryItemByUid(db, keepUid);
  const mergeItem = getMemoryItemByUid(db, mergeUid);
  if (!keepItem || !mergeItem) {
    return null;
  }

  const mergedContent = mergeDistinctContent(keepItem, mergeItem);
  const mergedSummary = mergeSummary(keepItem.summary, mergeItem.summary);
  const mergedPriority = pickHigherPriority(keepItem.priority, mergeItem.priority);
  const mergedPromoted = keepItem.promoted || mergeItem.promoted;
  const mergedStatus = mergedPromoted ? 'promoted' : keepItem.status;

  const updatedKeep = updateMemory(db, vaultRoot, logsPath, keepUid, {
    summary: mergedSummary,
    content: mergedContent,
    keywords: Array.from(new Set([...keepItem.keywords, ...mergeItem.keywords])),
    tags: Array.from(new Set([...keepItem.tags, ...mergeItem.tags])),
    nextSteps: Array.from(new Set([...keepItem.nextSteps, ...mergeItem.nextSteps])),
    relatedFiles: Array.from(new Set([...keepItem.relatedFiles, ...mergeItem.relatedFiles])),
    relatedItemIds: Array.from(new Set([
      ...keepItem.relatedItemIds,
      ...mergeItem.relatedItemIds,
    ])).filter((itemUid) => itemUid !== keepUid && itemUid !== mergeUid),
    priority: mergedPriority,
    promoted: mergedPromoted,
    status: mergedStatus,
  });

  if (!updatedKeep) {
    return null;
  }

  const updatedReferenceItemUids = replaceMergedReferences(db, vaultRoot, logsPath, keepUid, mergeUid);
  ensureMemoryLink(db, keepUid, mergeUid, 'supersedes');
  const archivedItem = archiveMemory(db, vaultRoot, logsPath, mergeUid);

  logActivity(db, logsPath, {
    sourceClient: 'system',
    project: keepItem.project,
    actionType: 'update',
    targetItemId: keepUid,
    status: 'success',
    message: `Merged memory ${mergeUid} into ${keepUid}`,
    metadata: {
      keepUid,
      mergeUid,
      updatedReferenceItemUids,
    },
  });

  return {
    keptItem: updatedKeep,
    archivedItem,
    updatedReferenceItemUids,
  };
}

/**
 * Tiered staleness pipeline:
 *   active → stale (idle ≥ activeToStaleDays, lightly used)
 *   stale → archived (no rescue ≥ staleToArchivedDays, still lightly used)
 *   archived → pending_delete (no rescue ≥ archivedToPendingDeleteDays)
 *
 * Each transition advances at most one stage per item per run; the next
 * stage requires a fresh updatedAt window to elapse, giving the user real
 * wall-clock time to intervene. pending_delete is terminal-for-the-agent —
 * actual deletion requires explicit user confirmation.
 *
 * Backward compat: if a number is passed instead of an options object, it
 * is interpreted as activeToStaleDays; the later cutoffs scale from it
 * (×2 and ×4) so existing call sites keep their semantics.
 */
export function executeStaleArchival(
  db: DB,
  vaultRoot: string,
  logsPath: string,
  optionsOrDays?: StaleArchivalOptions | number,
): AgentDutyMaintenanceResult {
  const opts = normalizeStaleOptions(optionsOrDays);
  const dayMs = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const activeCutoff = nowMs - opts.activeToStaleDays * dayMs;
  const staleCutoff = nowMs - opts.staleToArchivedDays * dayMs;
  const archivedCutoff = nowMs - opts.archivedToPendingDeleteDays * dayMs;

  const archivedItemUids: string[] = [];
  const staledItemUids: string[] = [];
  const pendingDeleteItemUids: string[] = [];

  const items = db.select().from(memoryItems).all().map(mapMemoryRow);
  for (const item of items) {
    if (item.promoted) continue;
    if (NON_ARCHIVABLE_MEMORY_TYPES.has(item.memoryType)) continue;

    if (item.status === 'active' && isStaleCandidate(item, activeCutoff)) {
      if (markMemoryStale(db, logsPath, item.itemUid)) {
        staledItemUids.push(item.itemUid);
      }
      continue;
    }

    if (item.status === 'stale' && hasRestedSince(item, staleCutoff) && isLightlyUsed(item)) {
      if (archiveMemory(db, vaultRoot, logsPath, item.itemUid)) {
        archivedItemUids.push(item.itemUid);
      }
      continue;
    }

    if (
      item.status === 'archived'
      && hasRestedSince(item, archivedCutoff)
      && isLightlyUsed(item)
    ) {
      if (markMemoryPendingDelete(db, logsPath, item.itemUid)) {
        pendingDeleteItemUids.push(item.itemUid);
      }
    }
  }

  const summaryCounts = {
    staled: staledItemUids.length,
    archived: archivedItemUids.length,
    pendingDelete: pendingDeleteItemUids.length,
  };
  if (summaryCounts.staled + summaryCounts.archived + summaryCounts.pendingDelete > 0) {
    logActivity(db, logsPath, {
      sourceClient: 'system',
      actionType: 'archive',
      status: 'success',
      message:
        `Lifecycle pass: staled=${summaryCounts.staled}, archived=${summaryCounts.archived}, ` +
        `pending_delete=${summaryCounts.pendingDelete}`,
      metadata: {
        ...opts,
        staledItemUids,
        archivedItemUids,
        pendingDeleteItemUids,
      },
    });
  }

  return {
    archivedItemUids,
    promotedItemUids: [],
    staledItemUids,
    pendingDeleteItemUids,
  };
}

function normalizeStaleOptions(
  optionsOrDays: StaleArchivalOptions | number | undefined,
): Required<StaleArchivalOptions> {
  if (typeof optionsOrDays === 'number') {
    const base = optionsOrDays;
    return {
      activeToStaleDays: base,
      staleToArchivedDays: base * 2,
      archivedToPendingDeleteDays: base * 4,
    };
  }
  return {
    activeToStaleDays: optionsOrDays?.activeToStaleDays ?? 30,
    staleToArchivedDays: optionsOrDays?.staleToArchivedDays ?? 30,
    archivedToPendingDeleteDays: optionsOrDays?.archivedToPendingDeleteDays ?? 60,
  };
}

function isStaleCandidate(item: MemoryItem, cutoffTime: number): boolean {
  const last = Date.parse(item.lastAccessedAt || item.updatedAt || item.createdAt);
  if (Number.isNaN(last) || last > cutoffTime) return false;
  return isLightlyUsed(item);
}

function hasRestedSince(item: MemoryItem, cutoffTime: number): boolean {
  // updatedAt is the canonical "last status change" stamp — bumped on every
  // mark/archive/recall edit. If it has stayed quiet past the cutoff, the
  // item has earned its next transition.
  const last = Date.parse(item.lastAccessedAt || item.updatedAt || item.createdAt);
  return !Number.isNaN(last) && last <= cutoffTime;
}

function isLightlyUsed(item: MemoryItem): boolean {
  return item.accessCount < STALE_LOW_USAGE_THRESHOLD;
}

export function executeAutoPromotion(
  db: DB,
  logsPath: string,
): AgentDutyMaintenanceResult {
  const items = db.select().from(memoryItems).all().map(mapMemoryRow);
  const links = db.select().from(memoryLinks).all();
  const promotedItemUids: string[] = [];

  for (const item of items) {
    if (item.promoted || item.status === 'archived') {
      continue;
    }

    const referenceCount = countReferencesToItem(item.itemUid, items, links);
    if (item.accessCount < 10 && referenceCount < 3) {
      continue;
    }

    const promoted = promoteMemory(db, logsPath, item.itemUid);
    if (promoted) {
      promotedItemUids.push(item.itemUid);
    }
  }

  if (promotedItemUids.length > 0) {
    logActivity(db, logsPath, {
      sourceClient: 'system',
      actionType: 'promote',
      status: 'success',
      message: `Auto-promoted ${promotedItemUids.length} memory item(s)`,
      metadata: {
        promotedItemUids,
      },
    });
  }

  return {
    archivedItemUids: [],
    promotedItemUids,
  };
}

export function expandRecallWithRelated(
  db: DB,
  pack: MemoryPack,
  topMatches: RecallMatch[],
): MemoryPack {
  const expandedMatches = [...topMatches];
  const relatedItems: MemoryItem[] = [];
  const seen = new Set(topMatches.map((match) => match.item.itemUid));
  let added = 0;

  for (const anchor of topMatches) {
    if (added >= MAX_RELATED_EXPANSION) {
      break;
    }

    for (const relatedUid of anchor.item.relatedItemIds) {
      if (added >= MAX_RELATED_EXPANSION || seen.has(relatedUid)) {
        continue;
      }

      const relatedItem = getMemoryItemByUid(db, relatedUid);
      if (!relatedItem || relatedItem.status === 'archived') {
        continue;
      }

      seen.add(relatedUid);
      relatedItems.push(relatedItem);
      expandedMatches.push({
        item: relatedItem,
        score: Number(Math.max(anchor.score * 0.55, 1).toFixed(2)),
        signals: {
          relatedToTopMatch: 18,
          inheritedAnchorScore: Number(Math.max(anchor.score * 0.1, 1).toFixed(2)),
        },
        reasons: [`related to ${anchor.item.title}`],
      });
      added += 1;
    }
  }

  return {
    ...pack,
    related: relatedItems,
    // Preserve the ranking service's order for the original matches — it
    // encodes relevance tiers, not just raw score, so a global re-sort here
    // would bury on-topic matches under high-static-score expansions.
    topMatches: [
      ...topMatches,
      ...expandedMatches
        .slice(topMatches.length)
        .sort((left, right) => right.score - left.score),
    ],
  };
}

export function surfaceProactiveContext(
  db: DB,
  project: string,
  sessionKeywords: string[] = [],
  limit: number = 5,
): MemoryItem[] {
  const items = db
    .select()
    .from(memoryItems)
    .all()
    .map(mapMemoryRow)
    .filter((item) => item.project === project && item.status !== 'archived');

  const unique = new Map<string, MemoryItem>();

  const addItems = (candidates: MemoryItem[]) => {
    for (const item of candidates) {
      if (unique.size >= limit) {
        return;
      }
      if (!unique.has(item.itemUid)) {
        unique.set(item.itemUid, item);
      }
    }
  };

  addItems(
    items
      .filter((item) => item.promoted && item.memoryType === 'decision')
      .sort(sortNewestFirst)
      .slice(0, limit),
  );

  addItems(
    items
      .filter((item) => item.memoryType === 'plan' && item.status === 'active')
      .sort(sortNewestFirst)
      .slice(0, limit),
  );

  addItems(
    items
      .filter((item) => item.memoryType === 'handoff')
      .sort(sortNewestFirst)
      .slice(0, Math.min(2, limit)),
  );

  if (sessionKeywords.length > 0) {
    const loweredKeywords = sessionKeywords.map((keyword) => keyword.toLowerCase());
    addItems(
      items
        .filter((item) =>
          item.tags.some((tag) => loweredKeywords.some((keyword) => tag.includes(keyword)))
          || item.keywords.some((keyword) => loweredKeywords.some((needle) => keyword.includes(needle)))
          || loweredKeywords.some((keyword) =>
            item.subject.toLowerCase().includes(keyword)
            || item.title.toLowerCase().includes(keyword),
          ),
        )
        .sort((left, right) => {
          const leftBoost = Number(left.promoted) + left.accessCount;
          const rightBoost = Number(right.promoted) + right.accessCount;
          return rightBoost - leftBoost || sortNewestFirst(left, right);
        })
        .slice(0, limit),
    );
  }

  return Array.from(unique.values()).slice(0, limit);
}

export function buildProjectBriefing(
  db: DB,
  project: string,
  sessionKeywords: string[] = [],
  limit: number = 5,
): ProjectBriefing {
  const items = db
    .select()
    .from(memoryItems)
    .all()
    .map(mapMemoryRow)
    .filter((item) => item.project === project && item.status !== 'archived');

  return {
    project,
    promotedDecisions: items
      .filter((item) => item.memoryType === 'decision' && item.promoted)
      .sort(sortNewestFirst)
      .slice(0, limit),
    activePlans: items
      .filter((item) => item.memoryType === 'plan' && item.status === 'active')
      .sort(sortNewestFirst)
      .slice(0, limit),
    recentSummaries: items
      .filter((item) => item.memoryType === 'summary' || item.memoryType === 'session')
      .sort(sortNewestFirst)
      .slice(0, limit),
    recentHandoffs: items
      .filter((item) => item.memoryType === 'handoff')
      .sort(sortNewestFirst)
      .slice(0, Math.min(3, limit)),
    promotedItems: items
      .filter((item) => item.promoted)
      .sort(sortNewestFirst)
      .slice(0, limit),
    proactiveContext: surfaceProactiveContext(db, project, sessionKeywords, limit),
  };
}

export function requestClusterSummary(
  db: DB,
  logsPath: string,
  itemUids: string[],
  queryContext?: string,
  project?: string,
): VaultTask | null {
  const items = Array.from(new Set(itemUids))
    .map((itemUid) => getMemoryItemByUid(db, itemUid))
    .filter((item): item is MemoryItem => Boolean(item));

  if (items.length === 0) {
    return null;
  }

  const effectiveProject = project || items[0].project;
  const itemSummaries = items
    .map((item) => `- [${item.memoryType}] ${item.title}: ${item.summary}`)
    .join('\n');
  const focusLine = queryContext ? `\nFocus: ${queryContext}` : '';

  return createTask(db, logsPath, {
    title: `Summarize ${items.length} memory items`,
    taskType: 'summarize',
    prompt: `Summarize these memory items into a concise, coherent briefing (2-5 sentences):${focusLine}\n\n${itemSummaries}`,
    project: effectiveProject,
    context: {
      item_uids: items.map((item) => item.itemUid),
      query_context: queryContext,
      cluster_summary: true,
    },
    createdBy: 'system',
  });
}

export function getMemoryItemSnapshot(
  db: DB,
  itemUid: string,
): MemoryItem | null {
  return getMemoryItemByUid(db, itemUid);
}

function shouldSkipPostSaveDuties(item: MemoryItem): boolean {
  return item.memoryType === 'artifact'
    || item.status === 'archived'
    || item.tags.includes('task-result');
}

function collectMetadataGaps(item: MemoryItem): string[] {
  const reasons: string[] = [];

  if (item.tags.length < 2) {
    reasons.push('Tags are sparse and should be tightened for later recall.');
  }
  if (item.keywords.length < 2) {
    reasons.push('Keywords are sparse and should be expanded for searchability.');
  }
  if (item.relatedFiles.length === 0) {
    reasons.push('Related files are missing, so code context is harder to recover later.');
  }

  return reasons;
}

function buildOrganizePrompt(
  item: MemoryItem,
  reasons: string[],
  duplicates: DuplicateMatch[],
): string {
  const duplicateBlock = duplicates.length > 0
    ? `Potential duplicates:\n${duplicates.map((match) =>
      `- ${match.title} (${match.itemUid}) similarity=${match.similarity} suggested_action=${match.suggestedAction}`,
    ).join('\n')}`
    : 'Potential duplicates: none detected.';

  return [
    'Review this saved memory and suggest metadata improvements.',
    'Vault validates your suggestions and applies safe ones (tags and keywords are merged additively);',
    'duplicate actions are recommendations only and require a human decision.',
    '',
    `Memory title: ${item.title}`,
    `Subject: ${item.subject}`,
    `Project: ${item.project}`,
    `Summary: ${item.summary}`,
    `Current tags: ${item.tags.join(', ') || '(none)'}`,
    `Current keywords: ${item.keywords.join(', ') || '(none)'}`,
    '',
    'Why this task was scheduled:',
    ...reasons.map((reason) => `- ${reason}`),
    '',
    duplicateBlock,
    '',
    'Return ONLY a JSON object (no markdown fences, no prose) with this exact shape:',
    '{',
    '  "tags": ["2-6 short topical tags, lowercase"],',
    '  "keywords": ["3-8 search-friendly terms, lowercase"],',
    '  "duplicate_actions": [{"item_uid": "vm_...", "action": "merge" or "link", "rationale": "one sentence"}],',
    '  "notes": "one-sentence curation rationale"',
    '}',
    'Only suggest tags/keywords that describe the actual topic. Omit duplicate_actions if there are no duplicates.',
  ].join('\n');
}

function buildEnrichPrompt(item: MemoryItem): string {
  return [
    'Improve this saved memory without changing its technical meaning.',
    'Vault validates your suggestions and applies safe ones: the summary replaces the current one',
    'only if it is genuinely more informative; tags and keywords are merged additively;',
    'next steps are only used if the memory has none yet.',
    '',
    `Title: ${item.title}`,
    `Subject: ${item.subject}`,
    `Current summary (${item.summary.trim().length} chars): ${item.summary}`,
    item.content ? `Content excerpt: ${item.content.slice(0, 600)}` : '',
    `Current tags: ${item.tags.join(', ') || '(none)'}`,
    `Current keywords: ${item.keywords.join(', ') || '(none)'}`,
    '',
    'Return ONLY a JSON object (no markdown fences, no prose) with this exact shape:',
    '{',
    '  "summary": "improved 1-3 sentence summary, 40-400 chars, concrete and reusable",',
    '  "tags": ["2-6 short topical tags, lowercase"],',
    '  "keywords": ["3-8 search-friendly terms, lowercase"],',
    '  "next_steps": ["only if clearly implied by the memory, else empty array"]',
    '}',
  ].filter(Boolean).join('\n');
}

function createDutyTaskIfMissing(
  db: DB,
  logsPath: string,
  item: MemoryItem,
  taskType: 'organize' | 'enrich',
  input: {
    title: string;
    prompt: string;
    context: Record<string, unknown>;
  },
): VaultTask | null {
  const existing = findActiveDutyTask(db, item.itemUid, taskType);
  if (existing) return null;

  return createTask(db, logsPath, {
    title: input.title,
    taskType,
    prompt: input.prompt,
    priority: taskType === 'organize' ? 'high' : 'normal',
    project: item.project,
    context: input.context,
    maxRetries: 1,
    sourceMemoryUid: item.itemUid,
    targetMemoryUid: item.itemUid,
    workIntent: 'memory_maintenance',
    idempotencyKey: `duty:${item.itemUid}:${taskType}:${item.updatedAt}`,
    createdBy: 'system',
  }, { allowMemoryMaintenance: true });
}

function findActiveDutyTask(
  db: DB,
  sourceMemoryUid: string,
  taskType: 'organize' | 'enrich',
): VaultTask | null {
  const rows = db
    .select()
    .from(tasks)
    .where(and(
      eq(tasks.sourceMemoryUid, sourceMemoryUid),
      eq(tasks.taskType, taskType),
    ))
    .all()
    .map(mapTaskRow)
    .filter((task) => DUTY_TASK_ACTIVE_STATUSES.has(task.status));

  return rows[0] ?? null;
}

function ensureMemoryLink(
  db: DB,
  sourceItemUid: string,
  targetItemUid: string,
  linkType: 'related' | 'supersedes',
): void {
  const existing = db
    .select()
    .from(memoryLinks)
    .where(and(
      eq(memoryLinks.sourceItemId, sourceItemUid),
      eq(memoryLinks.targetItemId, targetItemUid),
      eq(memoryLinks.linkType, linkType),
    ))
    .get();

  if (existing) {
    return;
  }

  db.insert(memoryLinks)
    .values({
      sourceItemId: sourceItemUid,
      targetItemId: targetItemUid,
      linkType,
      createdAt: now(),
    })
    .run();
}

function replaceMergedReferences(
  db: DB,
  vaultRoot: string,
  logsPath: string,
  keepUid: string,
  mergeUid: string,
): string[] {
  const updatedReferenceItemUids: string[] = [];
  const items = db.select().from(memoryItems).all().map(mapMemoryRow);

  for (const item of items) {
    if (item.itemUid === keepUid || item.itemUid === mergeUid) {
      continue;
    }

    if (!item.relatedItemIds.includes(mergeUid)) {
      continue;
    }

    const nextRelated = item.relatedItemIds.map((relatedUid) =>
      relatedUid === mergeUid ? keepUid : relatedUid,
    );

    updateMemory(db, vaultRoot, logsPath, item.itemUid, {
      relatedItemIds: Array.from(new Set(nextRelated)).filter((uid) => uid !== item.itemUid),
    });
    updatedReferenceItemUids.push(item.itemUid);
  }

  return updatedReferenceItemUids;
}

function mergeDistinctContent(keepItem: MemoryItem, mergeItem: MemoryItem): string | undefined {
  const baseSections = [keepItem.content?.trim()].filter(Boolean) as string[];
  const mergeSummaryBlock = `Merged summary from ${mergeItem.title} (${mergeItem.itemUid}):\n${mergeItem.summary.trim()}`;
  const mergeContentBlock = mergeItem.content?.trim()
    ? `Merged content from ${mergeItem.title} (${mergeItem.itemUid}):\n${mergeItem.content.trim()}`
    : '';

  if (!baseSections.some((section) => section.includes(mergeSummaryBlock))) {
    baseSections.push(mergeSummaryBlock);
  }
  if (mergeContentBlock && !baseSections.some((section) => section.includes(mergeContentBlock))) {
    baseSections.push(mergeContentBlock);
  }

  return baseSections.length > 0 ? baseSections.join('\n\n') : undefined;
}

function mergeSummary(left: string, right: string): string {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();

  if (!normalizedLeft) {
    return normalizedRight;
  }
  if (!normalizedRight || normalizedLeft === normalizedRight) {
    return normalizedLeft;
  }
  if (normalizedLeft.includes(normalizedRight)) {
    return normalizedLeft;
  }
  if (normalizedRight.includes(normalizedLeft)) {
    return normalizedRight;
  }

  const merged = `${normalizedLeft}\n\nMerged note: ${normalizedRight}`;
  return merged.length <= 5000 ? merged : merged.slice(0, 4997).trimEnd() + '...';
}

function pickHigherPriority(
  left: MemoryItem['priority'],
  right: MemoryItem['priority'],
): MemoryItem['priority'] {
  return PRIORITY_RANK[left] >= PRIORITY_RANK[right] ? left : right;
}

function countReferencesToItem(
  itemUid: string,
  items: MemoryItem[],
  links: Array<typeof memoryLinks.$inferSelect>,
): number {
  const sources = new Set<string>();

  for (const item of items) {
    if (item.itemUid === itemUid) {
      continue;
    }
    if (item.relatedItemIds.includes(itemUid)) {
      sources.add(item.itemUid);
    }
  }

  for (const link of links) {
    if (link.targetItemId === itemUid && link.sourceItemId !== itemUid) {
      sources.add(link.sourceItemId);
    }
  }

  return sources.size;
}

function getMemoryItemByUid(db: DB, itemUid: string): MemoryItem | null {
  const row = db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.itemUid, itemUid))
    .get();

  return row ? mapMemoryRow(row) : null;
}

function getVaultRootFromPath(vaultPath: string | null): string {
  if (!vaultPath) {
    return '';
  }

  const normalizedPath = vaultPath.replace(/\\/g, '/');
  const marker = '/projects/';
  const markerIndex = normalizedPath.indexOf(marker);
  return markerIndex >= 0 ? normalizedPath.slice(0, markerIndex) : '';
}

function sortNewestFirst(left: MemoryItem, right: MemoryItem): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function mapMemoryRow(row: typeof memoryItems.$inferSelect): MemoryItem {
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

// ===========================================================================
// Project Review duty (Layer 2 step 3)
// Inspects a single project and proposes:
//   - description (when missing, AI-drafted if enrichment is available)
//   - merge candidates (deterministic — slug containment + tiny size)
// Each proposal goes through createProjectProposal so dedupe rules apply.
// Settings-gated via agent.project_maintenance.enabled with per-project
// cooldown and minimum-item threshold.
// ===========================================================================

const PROJECT_REVIEW_LAST_KEY = 'agent.project_maintenance.last_review_per_project';
const PROJECT_REVIEW_DESCRIPTION_MIN_ITEMS = 3;
const PROJECT_REVIEW_AI_TIMEOUT_MS = 12000;
const PROJECT_REVIEW_AI_MAX_TOKENS = 200;
const PROJECT_REVIEW_RECENT_ITEMS_FOR_PROMPT = 6;
const PROJECT_REVIEW_TOP_TAGS_FOR_PROMPT = 6;
// Auto-generated bookkeeping tags that describe how a memory was created,
// not what the project is about — useless as description evidence.
const PROJECT_REVIEW_NOISE_TAGS = new Set(['task-result', 'delegated']);

export async function executeProjectReview(
  db: DB,
  vaultRoot: string,
  logsPath: string,
  projectName: string,
  options: ProjectReviewOptions = {},
): Promise<ProjectReviewResult> {
  const reviewedAt = now();
  const force = options.force === true;
  const dryRun = options.dryRun === true;

  const enabled = getBooleanSetting(db, 'agent.project_maintenance.enabled', false);
  if (!enabled && !force) {
    return emptyReviewResult(projectName, 'disabled', reviewedAt);
  }

  const projectRow = db
    .select()
    .from(projects)
    .all()
    .find((row) => slugify(row.name) === slugify(projectName));
  if (!projectRow) {
    return emptyReviewResult(projectName, 'project_not_found', reviewedAt);
  }

  const canonicalName = projectRow.name;
  const projectSlug = slugify(canonicalName);

  // Cooldown gate
  const cooldownDays = getNumberSetting(db, 'agent.project_maintenance.cooldown_days', 7);
  const lastReviewed = getLastReviewedMap(db);
  const lastTs = lastReviewed[projectSlug];
  if (!force && lastTs && cooldownDays > 0) {
    const lastTime = Date.parse(lastTs);
    if (!Number.isNaN(lastTime)) {
      const cutoff = Date.now() - cooldownDays * 24 * 60 * 60 * 1000;
      if (lastTime > cutoff) {
        return emptyReviewResult(canonicalName, 'cooldown', reviewedAt);
      }
    }
  }

  // Item threshold gate
  const minItems = getNumberSetting(db, 'agent.project_maintenance.min_items_for_review', 3);
  const projectItems = db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.project, canonicalName))
    .all()
    .map(mapMemoryRow);
  const activeItems = projectItems.filter((item) => item.status !== 'archived');
  if (!force && activeItems.length < minItems) {
    return emptyReviewResult(canonicalName, 'below_item_threshold', reviewedAt);
  }

  const proposalsCreated: ProjectProposal[] = [];
  let candidatesEvaluated = 0;

  // ---- Description proposal ----
  if (!projectRow.description?.trim() && activeItems.length >= PROJECT_REVIEW_DESCRIPTION_MIN_ITEMS) {
    candidatesEvaluated += 1;
    const description = await draftProjectDescription(canonicalName, activeItems);
    if (description && !dryRun) {
      const created = createProjectProposal(db, logsPath, {
        project: canonicalName,
        payload: { type: 'description', description },
        rationale: `Project has no description. Drafted from ${activeItems.length} active item(s).`,
        confidence: 65,
        evidenceItemUids: activeItems
          .slice(0, PROJECT_REVIEW_RECENT_ITEMS_FOR_PROMPT)
          .map((item) => item.itemUid),
        createdBy: 'agent',
      });
      proposalsCreated.push(created);
    }
  }

  // ---- Merge candidates ----
  const mergeMaxItems = getNumberSetting(db, 'agent.project_maintenance.merge_candidate_max_items', 2);
  const mergeCandidates = findMergeCandidates(db, projectRow.id, canonicalName, projectSlug, mergeMaxItems);
  for (const candidate of mergeCandidates) {
    candidatesEvaluated += 1;
    if (dryRun) continue;
    const created = createProjectProposal(db, logsPath, {
      project: candidate.targetProject,
      payload: {
        type: 'merge',
        sourceProject: candidate.sourceProject,
        targetProject: candidate.targetProject,
        relocateFiles: true,
      },
      rationale: candidate.rationale,
      confidence: candidate.confidence,
      createdBy: 'agent',
    });
    proposalsCreated.push(created);
  }

  // Persist cooldown stamp
  lastReviewed[projectSlug] = reviewedAt;
  setSetting(db, PROJECT_REVIEW_LAST_KEY, lastReviewed);

  if (proposalsCreated.length > 0) {
    logActivity(db, logsPath, {
      timestamp: reviewedAt,
      sourceClient: 'system',
      project: canonicalName,
      actionType: 'enrich',
      status: 'success',
      aiUsed: isEnrichmentAvailable(),
      message: `Project review created ${proposalsCreated.length} proposal(s) for ${canonicalName}`,
      metadata: {
        dutyType: 'project_review',
        candidatesEvaluated,
        proposalUids: proposalsCreated.map((p) => p.proposalUid),
      },
    });
  }

  void vaultRoot;
  return {
    project: canonicalName,
    skipped: false,
    proposalsCreated,
    candidatesEvaluated,
    reviewedAt,
  };
}

interface MergeCandidate {
  sourceProject: string;
  targetProject: string;
  rationale: string;
  confidence: number;
}

/**
 * Find other projects whose slug contains or is contained by the target's slug,
 * where one side has ≤ maxItems active memory items and there is no existing
 * relationship between the pair (any direction, any link type). The smaller
 * project becomes the merge source; the larger becomes the target.
 */
function findMergeCandidates(
  db: DB,
  projectId: number,
  canonicalName: string,
  projectSlug: string,
  maxItems: number,
): MergeCandidate[] {
  const others = db
    .select()
    .from(projects)
    .all()
    .filter((row) => row.id !== projectId);
  if (others.length === 0) return [];

  const allRels = db.select().from(projectRelationships).all();
  const candidates: MergeCandidate[] = [];

  for (const other of others) {
    const otherSlug = slugify(other.name);
    if (otherSlug === projectSlug) continue;
    if (!isSlugNearDuplicate(projectSlug, otherSlug)) continue;

    const linked = allRels.some(
      (rel) =>
        (rel.sourceProject === canonicalName && rel.targetProject === other.name)
        || (rel.sourceProject === other.name && rel.targetProject === canonicalName),
    );
    if (linked) continue;

    const projectItemCount = countActiveItems(db, canonicalName);
    const otherItemCount = countActiveItems(db, other.name);

    let source: string;
    let target: string;
    if (otherItemCount <= maxItems && otherItemCount <= projectItemCount) {
      source = other.name;
      target = canonicalName;
    } else if (projectItemCount <= maxItems && projectItemCount < otherItemCount) {
      source = canonicalName;
      target = other.name;
    } else {
      continue;
    }

    candidates.push({
      sourceProject: source,
      targetProject: target,
      rationale: `Project slugs near-collide ("${projectSlug}" vs "${otherSlug}") and "${source}" is ≤ ${maxItems} item(s) — likely a naming variant.`,
      confidence: 70,
    });
  }

  return candidates;
}

function countActiveItems(db: DB, projectName: string): number {
  return db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.project, projectName))
    .all()
    .filter((row) => row.status !== 'archived').length;
}

function isSlugNearDuplicate(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return false;
  if (left.startsWith(right) || right.startsWith(left)) return true;
  if (left.includes(right) || right.includes(left)) return true;
  // Levenshtein distance ≤ 2 catches single-char typos like whisphr/whisphry
  return levenshtein(left, right) <= 2;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const prev: number[] = new Array(b.length + 1);
  const curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

async function draftProjectDescription(
  projectName: string,
  items: MemoryItem[],
): Promise<string | null> {
  // Description proposals are only worth surfacing when an AI draft is
  // possible. The old deterministic fallback produced item-count boilerplate
  // ("Active project with N memory items...") that is a statistic, not a
  // description — skipping here lets a later review retry once enrichment
  // is configured instead of filing a junk proposal now.
  if (!isEnrichmentAvailable()) return null;

  const client = getEnrichmentClient();
  if (!client) return null;

  const evidence = selectDescriptionEvidence(items);
  if (evidence.length === 0) return null;

  const itemsBlock = evidence
    .map((item) => `- [${item.memoryType}] ${item.title}: ${item.summary.slice(0, 160)}`)
    .join('\n');
  const topTags = collectTopProjectTags(items);
  const tagsLine = topTags.length > 0 ? `\nCommon tags: ${topTags.join(', ')}` : '';

  try {
    const result = await client.complete({
      systemPrompt:
        'You write short factual project descriptions for an engineering memory system. '
        + 'Output ONE OR TWO sentences (max 240 chars total). State what the project is and what it does. '
        + 'No marketing language, no opinions, no quotes. Output ONLY the description text.',
      userPrompt: `Project: ${projectName}\nItem count: ${items.length}${tagsLine}\n\nKey items:\n${itemsBlock}`,
      maxTokens: PROJECT_REVIEW_AI_MAX_TOKENS,
      temperature: 0.2,
      timeoutMs: PROJECT_REVIEW_AI_TIMEOUT_MS,
    });
    const text = result.text?.trim();
    if (!text) return null;
    return text.length > 280 ? text.slice(0, 277).trimEnd() + '...' : text;
  } catch {
    return null;
  }
}

/**
 * Pick the items that best describe what the project IS: promoted items,
 * decisions, plans, and references first, then recent summaries/sessions.
 * Delegated task-result noise and artifacts describe agent activity, not
 * the project, and are excluded unless nothing else exists.
 */
function selectDescriptionEvidence(items: MemoryItem[]): MemoryItem[] {
  const informative = [...items]
    .filter((item) =>
      item.memoryType !== 'artifact'
      && !item.tags.some((tag) => PROJECT_REVIEW_NOISE_TAGS.has(tag)),
    )
    .sort(sortNewestFirst);
  const pool = informative.length > 0 ? informative : [...items].sort(sortNewestFirst);

  const isHighSignal = (item: MemoryItem) =>
    item.promoted
    || item.memoryType === 'decision'
    || item.memoryType === 'plan'
    || item.memoryType === 'reference';

  const selected: MemoryItem[] = [];
  const seen = new Set<string>();
  for (const item of [...pool.filter(isHighSignal), ...pool]) {
    if (seen.has(item.itemUid)) continue;
    seen.add(item.itemUid);
    selected.push(item);
    if (selected.length >= PROJECT_REVIEW_RECENT_ITEMS_FOR_PROMPT) break;
  }

  return selected;
}

function collectTopProjectTags(items: MemoryItem[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) {
      if (PROJECT_REVIEW_NOISE_TAGS.has(tag)) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1])
    .slice(0, PROJECT_REVIEW_TOP_TAGS_FOR_PROMPT)
    .map(([tag]) => tag);
}

function emptyReviewResult(
  projectName: string,
  skipReason: ProjectReviewResult['skipReason'],
  reviewedAt: string,
): ProjectReviewResult {
  return {
    project: projectName,
    skipped: true,
    skipReason,
    proposalsCreated: [],
    candidatesEvaluated: 0,
    reviewedAt,
  };
}

function getLastReviewedMap(db: DB): Record<string, string> {
  const raw = getSetting(db, PROJECT_REVIEW_LAST_KEY);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  }
  return {};
}

function getBooleanSetting(db: DB, key: string, fallback: boolean): boolean {
  const value = getSetting(db, key);
  return typeof value === 'boolean' ? value : fallback;
}

function getNumberSetting(db: DB, key: string, fallback: number): number {
  const value = getSetting(db, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function mapTaskRow(row: typeof tasks.$inferSelect): VaultTask {
  return {
    id: row.id,
    taskUid: row.taskUid,
    title: row.title,
    taskType: row.taskType as VaultTask['taskType'],
    status: row.status as VaultTask['status'],
    priority: row.priority as VaultTask['priority'],
    project: row.project,
    prompt: row.prompt,
    context: row.contextJson ? JSON.parse(row.contextJson) : {},
    routedModel: row.routedModel,
    resultText: row.resultText,
    resultMetadata: row.resultMetadataJson ? JSON.parse(row.resultMetadataJson) : null,
    errorMessage: row.errorMessage,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    parentTaskUid: row.parentTaskUid,
    sourceMemoryUid: row.sourceMemoryUid,
    targetMemoryUid: row.targetMemoryUid,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}
