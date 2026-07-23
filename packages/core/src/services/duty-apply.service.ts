// ============================================================================
// Vault — Duty Apply Service (Phase 5: closed enrichment loop)
// Parses structured JSON output from completed enrich/organize duty tasks
// and applies validated, conservative improvements back to the source
// memory. Destructive operations (merges, deletes, file relocation) are
// NEVER auto-applied — they stay recommendations on the task result.
// ============================================================================

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { tasks } from '../database/schema.js';
import { logActivity } from './log.service.js';
import { updateMemory } from './retrieve.service.js';
import { getMemoryItemSnapshot } from './agent-duties.service.js';
import { getTask } from './task.service.js';
import { now } from '../utils/datetime.js';
import type { MemoryItem, VaultTask } from '../types/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

export const APPLYABLE_DUTY_TYPES = new Set(['post_save_enrich', 'post_save_organize']);

// Conservative caps: metadata is additive (union with existing), and the
// combined result must stay recall-friendly, not exhaustive.
const MAX_TOTAL_TAGS = 12;
const MAX_TOTAL_KEYWORDS = 10;

const MIN_APPLIED_SUMMARY_CHARS = 40;
const MAX_APPLIED_SUMMARY_CHARS = 600;
const MAX_METADATA_VALUE_CHARS = 48;

const DutySuggestionSchema = z.object({
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  next_steps: z.array(z.string()).optional(),
}).passthrough();

export interface DutyApplyResult {
  taskUid: string;
  targetMemoryUid: string | null;
  applied: boolean;
  appliedFields: string[];
  reason?: string;
}

/**
 * Apply the structured result of a completed enrich/organize duty task to
 * its source memory. Safe to call for any task — non-duty tasks and
 * unusable results return `applied: false` with a reason instead of
 * throwing, and the outcome is always recorded on the task metadata so the
 * result view can show whether suggestions were applied.
 */
export function applyDutyTaskResult(
  db: DB,
  vaultRoot: string,
  logsPath: string,
  taskUid: string,
): DutyApplyResult {
  const task = getTask(db, taskUid);
  if (!task) {
    return { taskUid, targetMemoryUid: null, applied: false, appliedFields: [], reason: 'task_not_found' };
  }

  const dutyType = typeof task.context?.dutyType === 'string' ? task.context.dutyType : null;
  if (!dutyType || !APPLYABLE_DUTY_TYPES.has(dutyType)) {
    return finish(db, logsPath, task, { applied: false, appliedFields: [], reason: 'not_a_duty_task' }, false);
  }
  if (task.status !== 'completed' || !task.resultText?.trim()) {
    return finish(db, logsPath, task, { applied: false, appliedFields: [], reason: 'no_completed_result' });
  }
  if (!task.targetMemoryUid) {
    return finish(db, logsPath, task, { applied: false, appliedFields: [], reason: 'no_target_memory' });
  }

  const item = getMemoryItemSnapshot(db, task.targetMemoryUid);
  if (!item || item.status === 'archived' || item.status === 'pending_delete') {
    return finish(db, logsPath, task, { applied: false, appliedFields: [], reason: 'target_memory_unavailable' });
  }

  const suggestion = parseDutySuggestion(task.resultText);
  if (!suggestion) {
    return finish(db, logsPath, task, { applied: false, appliedFields: [], reason: 'unparseable_result' });
  }

  const updates: Partial<MemoryItem> = {};
  const appliedFields: string[] = [];
  const audit: Record<string, unknown> = {};

  const mergedTags = mergeMetadataValues(item.tags, suggestion.tags, MAX_TOTAL_TAGS);
  if (mergedTags) {
    updates.tags = mergedTags.merged;
    appliedFields.push('tags');
    audit.addedTags = mergedTags.added;
  }

  const mergedKeywords = mergeMetadataValues(item.keywords, suggestion.keywords, MAX_TOTAL_KEYWORDS);
  if (mergedKeywords) {
    updates.keywords = mergedKeywords.merged;
    appliedFields.push('keywords');
    audit.addedKeywords = mergedKeywords.added;
  }

  // Summary replacement is enrich-only: the enrich duty fires precisely
  // because the current summary is too thin, and the organize duty's job is
  // metadata, not prose.
  if (dutyType === 'post_save_enrich') {
    const improvedSummary = pickImprovedSummary(item.summary, suggestion.summary);
    if (improvedSummary) {
      updates.summary = improvedSummary;
      appliedFields.push('summary');
      audit.previousSummary = item.summary;
    }

    // Model-generated next steps are informational suggestions only. They must
    // never become durable commitments or successor-loop candidates implicitly.
  }

  if (appliedFields.length === 0) {
    return finish(db, logsPath, task, { applied: false, appliedFields: [], reason: 'no_applicable_changes' });
  }

  const updated = updateMemory(db, vaultRoot, logsPath, item.itemUid, updates);
  if (!updated) {
    return finish(db, logsPath, task, { applied: false, appliedFields: [], reason: 'update_failed' });
  }

  logActivity(db, logsPath, {
    sourceClient: 'system',
    project: item.project,
    actionType: 'enrich',
    targetItemId: item.itemUid,
    status: 'success',
    message: `Applied ${dutyType} suggestions to ${item.title}: ${appliedFields.join(', ')}`,
    metadata: {
      dutyType,
      taskUid: task.taskUid,
      appliedFields,
      ...audit,
    },
  });

  return finish(db, logsPath, task, { applied: true, appliedFields });
}

function finish(
  db: DB,
  logsPath: string,
  task: VaultTask,
  outcome: { applied: boolean; appliedFields: string[]; reason?: string },
  recordOnTask: boolean = true,
): DutyApplyResult {
  if (recordOnTask) {
    const nextMetadata = {
      ...(task.resultMetadata || {}),
      dutyApplied: outcome.applied,
      dutyAppliedFields: outcome.appliedFields,
      ...(outcome.reason ? { dutyApplyReason: outcome.reason } : {}),
    };

    db.update(tasks)
      .set({
        resultMetadataJson: JSON.stringify(nextMetadata),
        updatedAt: now(),
      })
      .where(eq(tasks.taskUid, task.taskUid))
      .run();
  }

  void logsPath;
  return {
    taskUid: task.taskUid,
    targetMemoryUid: task.targetMemoryUid,
    ...outcome,
  };
}

/**
 * Extract the suggestion JSON from a model result that may be wrapped in
 * executor annotations, prose, or markdown fences.
 */
export function parseDutySuggestion(resultText: string): z.infer<typeof DutySuggestionSchema> | null {
  const start = resultText.indexOf('{');
  const end = resultText.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(resultText.slice(start, end + 1));
    const validated = DutySuggestionSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

function mergeMetadataValues(
  existing: string[],
  suggested: string[] | undefined,
  maxTotal: number,
): { merged: string[]; added: string[] } | null {
  if (!suggested || suggested.length === 0) {
    return null;
  }

  const existingSet = new Set(existing.map((value) => value.toLowerCase()));
  const added: string[] = [];

  for (const raw of suggested) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim().toLowerCase();
    if (value.length < 2 || value.length > MAX_METADATA_VALUE_CHARS) continue;
    if (existingSet.has(value)) continue;
    if (existing.length + added.length >= maxTotal) break;
    existingSet.add(value);
    added.push(value);
  }

  if (added.length === 0) {
    return null;
  }

  return { merged: [...existing, ...added], added };
}

function pickImprovedSummary(current: string, suggested: string | undefined): string | null {
  const next = suggested?.trim();
  if (!next) return null;
  if (next.length < MIN_APPLIED_SUMMARY_CHARS || next.length > MAX_APPLIED_SUMMARY_CHARS) return null;
  if (next === current.trim()) return null;
  // The enrich duty targets thin summaries; a suggestion that is shorter
  // than what we already have is not an improvement worth auto-applying.
  if (next.length <= current.trim().length) return null;
  return next;
}
