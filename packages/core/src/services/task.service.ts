// ============================================================================
// Vault — Task Service
// CRUD and queue operations for the task delegation system.
// ============================================================================

import { eq, and, desc } from 'drizzle-orm';
import { tasks } from '../database/schema.js';
import { getRawDatabase } from '../database/connection.js';
import { logActivity } from './log.service.js';
import { saveMemory } from './save.service.js';
import { generateItemUid } from '../utils/uid.js';
import { now } from '../utils/datetime.js';
import { CreateTaskInputSchema, FindTaskQuerySchema } from '../rules/validation.js';
import { resolveModelRoute, mergeRoutingTable, DEFAULT_MODEL_ROUTING } from '../rules/model-routing.js';
import { getSetting } from '../config/settings.js';
import type { VaultTask, CreateTaskInput, FindTaskQuery, SaveMemoryResult, TaskQueueStats, ModelRoutingTable } from '../types/index.js';
import type { MemoryType, TaskType } from '../rules/controlled-values.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

// ---------------------------------------------------------------------------
// Create Task
// ---------------------------------------------------------------------------

/**
 * Create a new task in the queue with status 'pending'.
 */
export function createTask(
  db: DB,
  logsPath: string,
  input: CreateTaskInput,
): VaultTask {
  const startMs = Date.now();

  // Validate input
  const validated = CreateTaskInputSchema.parse(input);

  // Generate UID
  const taskUid = generateItemUid().replace('vm_', 'vt_');
  const timestamp = now();

  // Resolve model route
  const routingTable = getRoutingTable(db);
  const route = resolveModelRoute(routingTable, validated.taskType);

  // Insert into DB
  db.insert(tasks)
    .values({
      taskUid,
      title: validated.title,
      taskType: validated.taskType,
      status: 'pending',
      priority: validated.priority,
      project: validated.project || null,
      prompt: validated.prompt,
      contextJson: JSON.stringify(validated.context),
      routedModel: route.modelId,
      resultText: null,
      resultMetadataJson: null,
      errorMessage: null,
      retryCount: 0,
      maxRetries: validated.maxRetries,
      parentTaskUid: validated.parentTaskUid || null,
      sourceMemoryUid: validated.sourceMemoryUid || null,
      targetMemoryUid: validated.targetMemoryUid || null,
      createdBy: validated.createdBy,
      createdAt: timestamp,
      startedAt: null,
      completedAt: null,
      updatedAt: timestamp,
    })
    .run();

  // Fetch the inserted task
  const task = getTask(db, taskUid);
  if (!task) throw new Error('Failed to retrieve created task');

  // Log the creation
  logActivity(db, logsPath, {
    sourceClient: validated.createdBy,
    project: validated.project,
    actionType: 'task_create',
    targetItemId: taskUid,
    status: 'success',
    latencyMs: Date.now() - startMs,
    message: `Created task: ${validated.title}`,
  });

  return task;
}

// ---------------------------------------------------------------------------
// Find Tasks
// ---------------------------------------------------------------------------

/**
 * Query tasks with optional filters.
 */
export function findTasks(
  db: DB,
  query: FindTaskQuery,
): VaultTask[] {
  const validated = FindTaskQuerySchema.parse(query);

  const conditions = [];
  if (validated.status) conditions.push(eq(tasks.status, validated.status));
  if (validated.taskType) conditions.push(eq(tasks.taskType, validated.taskType));
  if (validated.priority) conditions.push(eq(tasks.priority, validated.priority));
  if (validated.project) conditions.push(eq(tasks.project, validated.project));
  if (validated.createdBy) conditions.push(eq(tasks.createdBy, validated.createdBy));

  const rows = conditions.length > 0
    ? db.select().from(tasks)
        .where(and(...conditions))
        .orderBy(desc(tasks.createdAt))
        .limit(validated.limit)
        .offset(validated.offset)
        .all()
    : db.select().from(tasks)
        .orderBy(desc(tasks.createdAt))
        .limit(validated.limit)
        .offset(validated.offset)
        .all();

  return rows.map(mapTaskRow);
}

// ---------------------------------------------------------------------------
// Get Task
// ---------------------------------------------------------------------------

/**
 * Get a single task by its UID.
 */
export function getTask(
  db: DB,
  taskUid: string,
): VaultTask | null {
  const row = db.select().from(tasks)
    .where(eq(tasks.taskUid, taskUid))
    .get();

  return row ? mapTaskRow(row) : null;
}

// ---------------------------------------------------------------------------
// Claim Next Task
// ---------------------------------------------------------------------------

/**
 * Atomically claim the next pending task.
 * Sets status to 'running' and startedAt to now.
 * Uses raw SQL for atomic UPDATE...WHERE...LIMIT 1 with RETURNING.
 */
export function claimNextTask(
  db: DB,
  taskType?: TaskType,
): VaultTask | null {
  const raw = getRawDatabase();
  if (!raw) throw new Error('Database not initialized');

  const timestamp = now();

  // Build the claim query with priority ordering
  const typeFilter = taskType
    ? `AND task_type = '${taskType}'`
    : '';

  const result = raw.prepare(`
    UPDATE tasks
    SET status = 'running',
        started_at = ?,
        updated_at = ?
    WHERE id = (
      SELECT id FROM tasks
      WHERE status = 'pending' ${typeFilter}
      ORDER BY
        CASE priority
          WHEN 'urgent' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 3
        END,
        created_at ASC
      LIMIT 1
    )
    RETURNING *
  `).get(timestamp, timestamp) as Record<string, unknown> | undefined;

  if (!result) return null;

  return mapRawRow(result);
}

// ---------------------------------------------------------------------------
// Complete Task
// ---------------------------------------------------------------------------

/**
 * Mark a task as completed with its result.
 */
export function completeTask(
  db: DB,
  vaultRoot: string,
  logsPath: string,
  taskUid: string,
  resultText: string,
  resultMetadata?: Record<string, unknown>,
): VaultTask | null {
  const startMs = Date.now();
  const timestamp = now();

  const existing = getTask(db, taskUid);
  if (!existing) return null;

  db.update(tasks)
    .set({
      status: 'completed',
      resultText,
      resultMetadataJson: resultMetadata ? JSON.stringify(resultMetadata) : null,
      completedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(tasks.taskUid, taskUid))
    .run();

  const persistedResult = persistTaskResultMemory(
    db,
    vaultRoot,
    logsPath,
    existing,
    resultText,
    resultMetadata,
  );

  let finalResultMetadata = resultMetadata ?? null;
  if (persistedResult?.item.itemUid) {
    finalResultMetadata = {
      ...(resultMetadata || {}),
      savedMemoryUid: persistedResult.item.itemUid,
      savedMemoryType: persistedResult.item.memoryType,
      savedMemoryPath: persistedResult.vaultPath,
    };

    db.update(tasks)
      .set({
        targetMemoryUid: existing.targetMemoryUid || persistedResult.item.itemUid,
        resultMetadataJson: JSON.stringify(finalResultMetadata),
        updatedAt: now(),
      })
      .where(eq(tasks.taskUid, taskUid))
      .run();
  }

  logActivity(db, logsPath, {
    sourceClient: 'system',
    project: existing.project || undefined,
    actionType: 'task_complete',
    targetItemId: taskUid,
    status: 'success',
    latencyMs: Date.now() - startMs,
    message: `Completed task: ${existing.title}`,
    metadata: persistedResult?.item.itemUid
      ? {
          savedMemoryUid: persistedResult.item.itemUid,
          savedMemoryType: persistedResult.item.memoryType,
        }
      : undefined,
  });

  return getTask(db, taskUid);
}

// ---------------------------------------------------------------------------
// Fail Task
// ---------------------------------------------------------------------------

/**
 * Mark a task as failed with an error message.
 */
export function failTask(
  db: DB,
  logsPath: string,
  taskUid: string,
  errorMessage: string,
): VaultTask | null {
  const startMs = Date.now();
  const timestamp = now();

  const existing = getTask(db, taskUid);
  if (!existing) return null;

  db.update(tasks)
    .set({
      status: 'failed',
      errorMessage,
      completedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(tasks.taskUid, taskUid))
    .run();

  logActivity(db, logsPath, {
    sourceClient: 'system',
    project: existing.project || undefined,
    actionType: 'task_fail',
    targetItemId: taskUid,
    status: 'error',
    latencyMs: Date.now() - startMs,
    message: `Failed task: ${existing.title} — ${errorMessage}`,
  });

  return getTask(db, taskUid);
}

// ---------------------------------------------------------------------------
// Cancel Task
// ---------------------------------------------------------------------------

/**
 * Cancel a pending or running task.
 */
export function cancelTask(
  db: DB,
  logsPath: string,
  taskUid: string,
): VaultTask | null {
  const timestamp = now();

  const existing = getTask(db, taskUid);
  if (!existing) return null;
  if (existing.status !== 'pending' && existing.status !== 'running') return null;

  db.update(tasks)
    .set({
      status: 'cancelled',
      updatedAt: timestamp,
    })
    .where(eq(tasks.taskUid, taskUid))
    .run();

  logActivity(db, logsPath, {
    sourceClient: 'system',
    project: existing.project || undefined,
    actionType: 'update',
    targetItemId: taskUid,
    status: 'success',
    message: `Cancelled task: ${existing.title}`,
  });

  return getTask(db, taskUid);
}

// ---------------------------------------------------------------------------
// Retry Task (reset to pending for re-execution)
// ---------------------------------------------------------------------------

/**
 * Reset a running/failed task back to pending with incremented retry count.
 * Returns null if max retries exceeded.
 */
export function retryTask(
  db: DB,
  taskUid: string,
): VaultTask | null {
  const existing = getTask(db, taskUid);
  if (!existing) return null;
  if (existing.retryCount >= existing.maxRetries) return null;

  const timestamp = now();

  db.update(tasks)
    .set({
      status: 'pending',
      retryCount: existing.retryCount + 1,
      startedAt: null,
      errorMessage: null,
      updatedAt: timestamp,
    })
    .where(eq(tasks.taskUid, taskUid))
    .run();

  return getTask(db, taskUid);
}

// ---------------------------------------------------------------------------
// Queue Stats
// ---------------------------------------------------------------------------

/**
 * Get task queue statistics.
 */
export function getTaskQueueStats(db: DB): TaskQueueStats {
  const raw = getRawDatabase();
  if (!raw) throw new Error('Database not initialized');

  // Count by status
  const statusCounts = raw.prepare(`
    SELECT status, COUNT(*) as count FROM tasks GROUP BY status
  `).all() as Array<{ status: string; count: number }>;

  const stats: TaskQueueStats = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    byType: {},
  };

  for (const row of statusCounts) {
    switch (row.status) {
      case 'pending':
        stats.pending = row.count;
        break;
      case 'running':
        stats.running = row.count;
        break;
      case 'completed':
        stats.completed = row.count;
        break;
      case 'failed':
        stats.failed = row.count;
        break;
      case 'cancelled':
        stats.cancelled = row.count;
        break;
      default:
        break;
    }
  }

  // Count by type
  const typeCounts = raw.prepare(`
    SELECT task_type, COUNT(*) as count FROM tasks WHERE status IN ('pending', 'running') GROUP BY task_type
  `).all() as Array<{ task_type: string; count: number }>;

  for (const row of typeCounts) {
    stats.byType[row.task_type] = row.count;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Routing Table Access
// ---------------------------------------------------------------------------

/**
 * Get the effective routing table: defaults merged with user overrides from settings.
 */
function getRoutingTable(db: DB): ModelRoutingTable {
  const userOverrides = getSetting(db, 'model_routing_table') as Partial<ModelRoutingTable> | undefined;
  return mergeRoutingTable(DEFAULT_MODEL_ROUTING, userOverrides || null);
}

function persistTaskResultMemory(
  db: DB,
  vaultRoot: string,
  logsPath: string,
  task: VaultTask,
  resultText: string,
  resultMetadata?: Record<string, unknown>,
): SaveMemoryResult | null {
  const trimmedResult = resultText.trim();
  if (!task.project || !trimmedResult) {
    return null;
  }

  const memoryType = getTaskResultMemoryType(task);
  const relatedItemIds = extractTaskRelatedItemIds(task);
  const relatedFiles = extractTaskRelatedFiles(task, resultMetadata);

  try {
    return saveMemory(db, vaultRoot, logsPath, {
      title: getTaskResultMemoryTitle(task, memoryType),
      project: task.project,
      memoryType,
      subject: `Delegated ${task.taskType} result`,
      summary: buildTaskResultSummary(trimmedResult),
      content: buildTaskResultContent(task, trimmedResult, resultMetadata),
      sourceApp: 'other',
      routineType: 'implementation',
      status: 'active',
      priority: task.priority === 'urgent' ? 'high' : 'normal',
      keywords: normalizeTaskKeywords(task),
      tags: ['task-result', 'delegated', task.taskType],
      relatedItemIds,
      relatedFiles,
    });
  } catch {
    return null;
  }
}

function getTaskResultMemoryType(task: VaultTask): MemoryType {
  return task.taskType === 'coding' || task.taskType === 'image'
    ? 'artifact'
    : 'summary';
}

function getTaskResultMemoryTitle(task: VaultTask, memoryType: MemoryType): string {
  return memoryType === 'artifact'
    ? `${task.title} artifact`
    : task.title;
}

function buildTaskResultSummary(resultText: string): string {
  const collapsed = resultText.replace(/\s+/g, ' ').trim();
  return collapsed.length > 280
    ? `${collapsed.slice(0, 277).trimEnd()}...`
    : collapsed;
}

function buildTaskResultContent(
  task: VaultTask,
  resultText: string,
  resultMetadata?: Record<string, unknown>,
): string {
  const sections = [
    `Task UID: ${task.taskUid}`,
    `Task type: ${task.taskType}`,
    task.project ? `Project: ${task.project}` : '',
    task.routedModel ? `Routed model: ${task.routedModel}` : '',
    '',
    'Prompt:',
    task.prompt,
    '',
    'Result:',
    resultText,
  ];

  if (resultMetadata && Object.keys(resultMetadata).length > 0) {
    sections.push('', 'Result metadata:', JSON.stringify(sanitizeTaskResultMetadataForContent(resultMetadata), null, 2));
  }

  return sections.filter(Boolean).join('\n');
}

function extractTaskRelatedItemIds(task: VaultTask): string[] {
  const related = [
    task.sourceMemoryUid,
    task.targetMemoryUid,
    ...extractStringArray(task.context.item_uids),
    ...extractStringArray(task.context.related_item_uids),
  ];

  return Array.from(new Set(related.filter((value): value is string => Boolean(value))));
}

function extractTaskRelatedFiles(task: VaultTask, resultMetadata?: Record<string, unknown>): string[] {
  const related = [
    ...extractStringArray(task.context.related_files),
    ...extractStringArray(task.context.file_paths),
    ...extractStringArray(task.context.files),
    ...extractStringArray(resultMetadata?.assetPaths),
    ...extractStringArray(resultMetadata?.savedAssetPaths),
    ...extractStringArray(resultMetadata?.file_paths),
    ...extractAssetPathsFromMetadata(resultMetadata),
  ];

  return Array.from(new Set(related.filter((value): value is string => Boolean(value))));
}

function extractAssetPathsFromMetadata(resultMetadata?: Record<string, unknown>): string[] {
  if (!resultMetadata) {
    return [];
  }

  const primaryAssetPath = typeof resultMetadata.primaryAssetPath === 'string'
    ? resultMetadata.primaryAssetPath.trim()
    : '';
  const imageAssetPaths = Array.isArray(resultMetadata.images)
    ? resultMetadata.images
        .flatMap((image) => {
          if (!image || typeof image !== 'object') {
            return [];
          }

          const assetPath = (image as Record<string, unknown>).assetPath;
          return typeof assetPath === 'string' && assetPath.trim() ? [assetPath.trim()] : [];
        })
    : [];

  return [
    primaryAssetPath,
    ...imageAssetPaths,
  ].filter(Boolean);
}

function sanitizeTaskResultMetadataForContent(resultMetadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(resultMetadata)) {
    if (key === 'primaryImageDataUrl' && typeof value === 'string') {
      sanitized[key] = '[omitted data URL preview]';
      continue;
    }

    if (key === 'images' && Array.isArray(value)) {
      sanitized[key] = value.map((image) => {
        if (!image || typeof image !== 'object') {
          return image;
        }

        const nextImage = { ...(image as Record<string, unknown>) };
        if (typeof nextImage.dataUrl === 'string') {
          nextImage.dataUrl = '[omitted data URL preview]';
        }
        return nextImage;
      });
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

function extractStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function normalizeTaskKeywords(task: VaultTask): string[] {
  const titleWords = task.title
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length > 2)
    .slice(0, 5);

  return Array.from(
    new Set([
      task.taskType,
      'task-result',
      ...titleWords,
    ]),
  ).slice(0, 8);
}

// ---------------------------------------------------------------------------
// Row Mappers
// ---------------------------------------------------------------------------

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

/**
 * Map a raw SQL RETURNING result to VaultTask.
 */
function mapRawRow(row: Record<string, unknown>): VaultTask {
  return {
    id: row.id as number,
    taskUid: row.task_uid as string,
    title: row.title as string,
    taskType: row.task_type as VaultTask['taskType'],
    status: row.status as VaultTask['status'],
    priority: row.priority as VaultTask['priority'],
    project: (row.project as string) || null,
    prompt: row.prompt as string,
    context: row.context_json ? JSON.parse(row.context_json as string) : {},
    routedModel: (row.routed_model as string) || null,
    resultText: (row.result_text as string) || null,
    resultMetadata: row.result_metadata_json ? JSON.parse(row.result_metadata_json as string) : null,
    errorMessage: (row.error_message as string) || null,
    retryCount: row.retry_count as number,
    maxRetries: row.max_retries as number,
    parentTaskUid: (row.parent_task_uid as string) || null,
    sourceMemoryUid: (row.source_memory_uid as string) || null,
    targetMemoryUid: (row.target_memory_uid as string) || null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string) || null,
    completedAt: (row.completed_at as string) || null,
    updatedAt: row.updated_at as string,
  };
}
