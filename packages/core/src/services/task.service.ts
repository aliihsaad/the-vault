// ============================================================================
// Vault — Task Service
// CRUD and queue operations for the task delegation system.
// ============================================================================

import { eq, and, desc } from 'drizzle-orm';
import { memoryItems, tasks } from '../database/schema.js';
import { getRawDatabase } from '../database/connection.js';
import { logActivity } from './log.service.js';
import { saveMemory } from './save.service.js';
import { generateItemUid } from '../utils/uid.js';
import { now } from '../utils/datetime.js';
import { CreateTaskInputSchema, FindTaskQuerySchema } from '../rules/validation.js';
import { evaluateProjectGate, evaluateProjectGateSnapshot } from './project-gate.service.js';
import { getProject } from './project.service.js';
import { OpenLoopServiceError } from './open-loop-errors.js';
import { resolveModelRoute, mergeRoutingTable, DEFAULT_MODEL_ROUTING } from '../rules/model-routing.js';
import { getSetting, getPrimaryProviderId, getRoutingTableKey } from '../config/settings.js';
import type { AiProviderId } from './openrouter-client.js';
import type { VaultTask, CreateTaskInput, FindTaskQuery, SaveMemoryResult, TaskQueueStats, ModelRoutingTable } from '../types/index.js';
import type { MemoryType, RoutineType, TaskType } from '../rules/controlled-values.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

// ---------------------------------------------------------------------------
// Create Task
// ---------------------------------------------------------------------------

/**
 * Create a new task in the queue with status 'pending'.
 */
export interface CreateTaskAdmissionOptions {
  allowMemoryMaintenance?: boolean;
}

export function createTask(
  db: DB,
  logsPath: string,
  input: CreateTaskInput,
  options: CreateTaskAdmissionOptions = {},
): VaultTask {
  const startMs = Date.now();
  const validated = CreateTaskInputSchema.parse(input);
  if (!validated.project) {
    throw new OpenLoopServiceError('TASK_PROJECT_REQUIRED', 'New tasks require an explicit project.');
  }
  if (validated.workIntent === 'memory_maintenance' && !options.allowMemoryMaintenance) {
    throw new OpenLoopServiceError(
      'TASK_INTENT_FORBIDDEN',
      'memory_maintenance is reserved for trusted internal duty writers.',
    );
  }

  const taskUid = generateItemUid().replace('vm_', 'vt_');
  const timestamp = now();
  const raw = getRawDatabase();
  if (!raw) throw new Error('Database not initialized');
  const admit = raw.transaction(() => {
    const transactionalDb = db;
    const project = getProject(transactionalDb, validated.project!);
    if (!project) {
      throw new OpenLoopServiceError('TASK_PROJECT_NOT_FOUND', `Task project not found: ${validated.project}`);
    }
    assertMemoryProject(transactionalDb, validated.sourceMemoryUid, project.name, 'source');
    assertMemoryProject(transactionalDb, validated.targetMemoryUid, project.name, 'target');

    const actor = validated.actor || {
      actorUid: validated.createdBy,
      actorKind: 'service' as const,
      roles: [],
    };
    const lifecycle = {
      workIntent: validated.workIntent,
      relatedLoopUid: validated.relatedLoopUid || null,
      actor,
      authorizationRequestUid: validated.authorizationRequestUid || null,
    };
    const publicContext = stripTaskLifecycle(validated.context);
    const context = { ...publicContext, $vaultLifecycle: lifecycle };

    if (validated.idempotencyKey) {
      const existing = transactionalDb.select().from(tasks)
        .where(eq(tasks.idempotencyKey, validated.idempotencyKey)).get();
      if (existing) {
        assertTaskReplay(existing, validated, project.name, publicContext);
        return { task: mapTaskRow(existing), created: false };
      }
    }

    if (project.projectType === 'brain_context' && validated.workIntent !== 'memory_maintenance') {
      throw new OpenLoopServiceError(
        'BRAIN_LOOP_OPERATION_DENIED',
        'BRAIN_LOOP_OPERATION_DENIED: Brain contexts accept only explicit memory maintenance tasks.',
        { project: project.name, workIntent: validated.workIntent },
      );
    }
    if (project.projectUid && project.lifecycleState === 'gate_active') {
      const gate = evaluateProjectGate(transactionalDb, {
        projectUid: project.projectUid,
        workIntent: validated.workIntent,
        relatedLoopUid: validated.relatedLoopUid,
        actor,
        authorizationRequestUid: validated.authorizationRequestUid,
        idempotencyKey: validated.idempotencyKey || `task:${taskUid}`,
      });
      if (!gate.allowed) {
        throw new OpenLoopServiceError(
          'TASK_ADMISSION_DENIED',
          `Task admission denied: ${gate.reasonCode}`,
          { project: project.name, reasonCode: gate.reasonCode, blockerUids: gate.blockerUids },
        );
      }
    }

    const routingTable = getRoutingTable(transactionalDb, getPrimaryProviderId(transactionalDb));
    const route = resolveModelRoute(routingTable, validated.taskType);
    transactionalDb.insert(tasks).values({
      taskUid,
      title: validated.title,
      taskType: validated.taskType,
      status: 'pending',
      priority: validated.priority,
      project: project.name,
      prompt: validated.prompt,
      contextJson: JSON.stringify(context),
      routedModel: route.modelId,
      resultText: null,
      resultMetadataJson: null,
      errorMessage: null,
      retryCount: 0,
      maxRetries: validated.maxRetries,
      parentTaskUid: validated.parentTaskUid || null,
      sourceMemoryUid: validated.sourceMemoryUid || null,
      targetMemoryUid: validated.targetMemoryUid || null,
      idempotencyKey: validated.idempotencyKey || null,
      createdBy: validated.createdBy,
      createdAt: timestamp,
      startedAt: null,
      completedAt: null,
      updatedAt: timestamp,
    }).run();

    const inserted = getTask(transactionalDb, taskUid);
    if (!inserted) throw new Error('Failed to retrieve created task');
    return { task: inserted, created: true };
  });
  const result = admit.immediate();

  if (result.created) {
    logActivity(db, logsPath, {
      sourceClient: validated.createdBy,
      project: result.task.project || undefined,
      actionType: 'task_create',
      targetItemId: result.task.taskUid,
      status: 'success',
      latencyMs: Date.now() - startMs,
      message: `Created task: ${validated.title}`,
    });
  }
  return result.task;
}

function assertMemoryProject(
  db: DB,
  itemUid: string | undefined,
  expectedProject: string,
  relation: 'source' | 'target',
): void {
  if (!itemUid) return;
  const row = db.select({ project: memoryItems.project }).from(memoryItems)
    .where(eq(memoryItems.itemUid, itemUid)).get();
  if (!row) {
    throw new OpenLoopServiceError(
      relation === 'source' ? 'TASK_SOURCE_MEMORY_NOT_FOUND' : 'TASK_TARGET_MEMORY_NOT_FOUND',
      `Task ${relation} memory not found: ${itemUid}`,
    );
  }
  if (row.project !== expectedProject) {
    throw new OpenLoopServiceError(
      'TASK_PROJECT_MISMATCH',
      `Task project ${expectedProject} does not match ${relation} memory project ${row.project}.`,
      { itemUid, expectedProject, actualProject: row.project },
    );
  }
}

function stripTaskLifecycle(context: Record<string, unknown>): Record<string, unknown> {
  const { $vaultLifecycle: _ignored, ...publicContext } = context;
  return publicContext;
}

function assertTaskReplay(
  row: typeof tasks.$inferSelect,
  input: ReturnType<typeof CreateTaskInputSchema.parse>,
  canonicalProject: string,
  publicContext: Record<string, unknown>,
): void {
  const existing = mapTaskRow(row);
  const existingSemantics = {
    title: existing.title,
    taskType: existing.taskType,
    prompt: existing.prompt,
    priority: existing.priority,
    project: existing.project,
    context: existing.context,
    maxRetries: existing.maxRetries,
    parentTaskUid: existing.parentTaskUid,
    sourceMemoryUid: existing.sourceMemoryUid,
    targetMemoryUid: existing.targetMemoryUid,
    workIntent: existing.workIntent,
    relatedLoopUid: existing.relatedLoopUid,
    createdBy: existing.createdBy,
  };
  const requestedSemantics = {
    title: input.title,
    taskType: input.taskType,
    prompt: input.prompt,
    priority: input.priority,
    project: canonicalProject,
    context: publicContext,
    maxRetries: input.maxRetries,
    parentTaskUid: input.parentTaskUid || null,
    sourceMemoryUid: input.sourceMemoryUid || null,
    targetMemoryUid: input.targetMemoryUid || null,
    workIntent: input.workIntent,
    relatedLoopUid: input.relatedLoopUid || null,
    createdBy: input.createdBy,
  };
  if (stableJson(existingSemantics) !== stableJson(requestedSemantics)) {
    throw new OpenLoopServiceError(
      'IDEMPOTENCY_CONFLICT',
      'Task idempotency key was already used for a different task mutation.',
      { idempotencyKey: input.idempotencyKey },
    );
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
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

  const claim = raw.transaction(() => {
    while (true) {
      const typeFilter = taskType ? 'AND task_type = ?' : '';
      const candidate = raw.prepare(`
        SELECT * FROM tasks
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
      `).get(...(taskType ? [taskType] : [])) as Record<string, unknown> | undefined;
      if (!candidate) return null;

      const task = mapRawRow(candidate);
      const lifecycle = decodeTaskContext(candidate.context_json as string | null);
      const project = task.project ? getProject(db, task.project) : null;
      if (!task.project || !project) {
        const timestamp = now();
        raw.prepare(`
          UPDATE tasks
          SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ?
          WHERE task_uid = ? AND status = 'pending'
        `).run('Claim-time gate admission denied: task project is missing', timestamp, timestamp, task.taskUid);
        continue;
      }
      if (project.projectUid && (project.projectType === 'brain_context' || project.lifecycleState === 'gate_active')) {
        const gate = evaluateProjectGateSnapshot(db, {
          projectUid: project.projectUid,
          workIntent: task.workIntent || 'normal_work',
          relatedLoopUid: task.relatedLoopUid || undefined,
          actor: lifecycle.actor || {
            actorUid: task.createdBy,
            actorKind: 'service',
            roles: [],
          },
          authorizationRequestUid: lifecycle.authorizationRequestUid || undefined,
          idempotencyKey: `claim:${task.taskUid}`,
        });
        if (!gate.allowed) {
          const timestamp = now();
          raw.prepare(`
            UPDATE tasks
            SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ?
            WHERE task_uid = ? AND status = 'pending'
          `).run(`Claim-time gate admission denied: ${gate.reasonCode}`, timestamp, timestamp, task.taskUid);
          continue;
        }
      }

      const timestamp = now();
      const claimed = raw.prepare(`
        UPDATE tasks
        SET status = 'running', started_at = ?, updated_at = ?
        WHERE task_uid = ? AND status = 'pending'
        RETURNING *
      `).get(timestamp, timestamp, task.taskUid) as Record<string, unknown> | undefined;
      if (claimed) return mapRawRow(claimed);
    }
  });

  return claim.immediate();
}

// ---------------------------------------------------------------------------
// Stale Running Task Recovery
// ---------------------------------------------------------------------------

/** How long a task may sit in 'running' before it is considered abandoned.
 * Must exceed the worst-case execution time (image tasks: 2 models × 2
 * modality variants × 120s ≈ 8 min) so a live executor in another process
 * is never preempted. */
const STALE_RUNNING_AFTER_MS = 15 * 60 * 1000;
/** Abandoned tasks older than this are failed instead of requeued, so a
 * crash from weeks ago does not silently trigger surprise executions. */
const STALE_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface StaleTaskRecoveryResult {
  requeuedTaskUids: string[];
  failedTaskUids: string[];
}

/**
 * Recover tasks orphaned in 'running' status (executor process died mid-
 * execution). Recently abandoned tasks with retries left are requeued as
 * 'pending'; anything else is failed with an explicit error message.
 */
export function recoverStaleRunningTasks(
  db: DB,
  logsPath: string,
  options?: { staleAfterMs?: number; retryWindowMs?: number },
): StaleTaskRecoveryResult {
  const staleAfterMs = options?.staleAfterMs ?? STALE_RUNNING_AFTER_MS;
  const retryWindowMs = options?.retryWindowMs ?? STALE_RETRY_WINDOW_MS;
  const nowMs = Date.now();
  const result: StaleTaskRecoveryResult = { requeuedTaskUids: [], failedTaskUids: [] };

  const runningRows = db.select().from(tasks)
    .where(eq(tasks.status, 'running'))
    .all();

  for (const row of runningRows) {
    const claimedAtMs = Date.parse(row.startedAt || row.updatedAt || row.createdAt);
    const abandonedForMs = Number.isFinite(claimedAtMs) ? nowMs - claimedAtMs : Number.POSITIVE_INFINITY;
    if (abandonedForMs < staleAfterMs) {
      continue;
    }

    const timestamp = now();
    const canRetry = row.retryCount < row.maxRetries && abandonedForMs < retryWindowMs;

    if (canRetry) {
      db.update(tasks)
        .set({
          status: 'pending',
          retryCount: row.retryCount + 1,
          startedAt: null,
          errorMessage: null,
          updatedAt: timestamp,
        })
        .where(eq(tasks.taskUid, row.taskUid))
        .run();
      result.requeuedTaskUids.push(row.taskUid);
    } else {
      db.update(tasks)
        .set({
          status: 'failed',
          errorMessage: 'Task was abandoned in running status (executor interrupted) and could not be requeued.',
          completedAt: timestamp,
          updatedAt: timestamp,
        })
        .where(eq(tasks.taskUid, row.taskUid))
        .run();
      result.failedTaskUids.push(row.taskUid);
    }

    logActivity(db, logsPath, {
      sourceClient: 'system',
      project: row.project || undefined,
      actionType: canRetry ? 'update' : 'task_fail',
      targetItemId: row.taskUid,
      status: canRetry ? 'success' : 'error',
      message: canRetry
        ? `Requeued stale running task: ${row.title}`
        : `Failed stale running task: ${row.title}`,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Complete Task
// ---------------------------------------------------------------------------

/**
 * Mark a task as completed with its result.
 * Only pending/running tasks can complete — a task cancelled mid-flight
 * must not be clobbered back to 'completed' when its LLM call returns.
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
  if (existing.status !== 'pending' && existing.status !== 'running') return null;

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
 * Only pending/running tasks can fail — cancelled/completed states are final.
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
  if (existing.status !== 'pending' && existing.status !== 'running') return null;

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
  // Only interrupted or failed executions may be retried — never resurrect
  // a cancelled or completed task back into the queue.
  if (existing.status !== 'running' && existing.status !== 'failed') return null;
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
 * Get the effective routing table for a provider: defaults merged with that
 * provider's user overrides from settings.
 */
export function getRoutingTable(db: DB, provider: AiProviderId = 'openrouter'): ModelRoutingTable {
  const userOverrides = getSetting(db, getRoutingTableKey(provider)) as Partial<ModelRoutingTable> | undefined;
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
  if (task.context?.skipResultMemory === true) {
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
      subject: getTaskResultSubject(task),
      summary: buildTaskResultSummary(stripExecutorAnnotations(trimmedResult)),
      content: buildTaskResultContent(task, trimmedResult, resultMetadata),
      sourceApp: 'other',
      routineType: getTaskResultRoutineType(task),
      status: 'active',
      priority: task.priority === 'urgent' ? 'high' : 'normal',
      keywords: normalizeTaskKeywords(task),
      tags: buildTaskResultTags(task),
      relatedItemIds,
      relatedFiles,
    });
  } catch {
    return null;
  }
}

/**
 * Subject drives the strongest recall signals (SUBJECT_EXACT / query-text
 * subject matching), so it must be the task's actual topic — never a
 * generic boilerplate string shared by every task result.
 */
function getTaskResultSubject(task: VaultTask): string {
  const contextSubject = task.context?.subject;
  if (typeof contextSubject === 'string' && contextSubject.trim()) {
    return contextSubject.trim();
  }
  return task.title;
}

/** Executor boundary annotations are metadata for the task result view; they
 * must never leak into the 280-char memory summary used for recall matching. */
function stripExecutorAnnotations(resultText: string): string {
  return resultText.replace(/^\s*Executor note:[^\n]*\n+/i, '').trim() || resultText;
}

const TASK_ROUTINE_TYPE_MAP: Partial<Record<TaskType, RoutineType>> = {
  coding: 'implementation',
  analysis: 'review',
  research: 'planning',
  summarize: 'review',
  organize: 'refactor',
  enrich: 'refactor',
};

function getTaskResultRoutineType(task: VaultTask): RoutineType {
  return TASK_ROUTINE_TYPE_MAP[task.taskType] ?? 'implementation';
}

function buildTaskResultTags(task: VaultTask): string[] {
  const contextTags = extractStringArray(task.context?.tags).slice(0, 5);
  return Array.from(new Set(['task-result', 'delegated', task.taskType, ...contextTags]));
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

/** Common words that carry no recall signal — keyword slots are scarce (8)
 * and keyword overlap is scored per hit, so filler words dilute recall. */
const KEYWORD_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'these', 'those',
  'into', 'onto', 'over', 'under', 'about', 'after', 'before', 'between',
  'then', 'than', 'when', 'what', 'which', 'while', 'where', 'their',
  'have', 'has', 'had', 'was', 'were', 'will', 'been', 'being', 'are',
  'not', 'you', 'your', 'all', 'any', 'can', 'could', 'should', 'would',
  'out', 'new', 'use', 'using', 'used', 'also', 'each', 'per', 'via',
  'please', 'make', 'give', 'take', 'get', 'set', 'run', 'its', 'our',
]);

function extractMeaningfulWords(text: string, limit: number): string[] {
  return Array.from(new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((word) => word.length > 2 && !KEYWORD_STOPWORDS.has(word)),
  )).slice(0, limit);
}

function normalizeTaskKeywords(task: VaultTask): string[] {
  const contextKeywords = extractStringArray(task.context?.keywords)
    .map((keyword) => keyword.toLowerCase())
    .slice(0, 5);
  const titleWords = extractMeaningfulWords(task.title, 5);
  const promptWords = extractMeaningfulWords(task.prompt, 4);

  return Array.from(
    new Set([
      task.taskType,
      'task-result',
      ...contextKeywords,
      ...titleWords,
      ...promptWords,
    ]),
  ).slice(0, 8);
}

// ---------------------------------------------------------------------------
// Row Mappers
// ---------------------------------------------------------------------------

function decodeTaskContext(contextJson: string | null): {
  context: Record<string, unknown>;
  workIntent: VaultTask['workIntent'];
  relatedLoopUid: string | null;
  actor?: CreateTaskInput['actor'];
  authorizationRequestUid: string | null;
} {
  const stored = contextJson ? JSON.parse(contextJson) as Record<string, unknown> : {};
  const { $vaultLifecycle: rawLifecycle = {}, ...context } = stored;
  const lifecycle = rawLifecycle && typeof rawLifecycle === 'object'
    ? rawLifecycle as Record<string, unknown>
    : {};
  return {
    context,
    workIntent: (lifecycle.workIntent as VaultTask['workIntent']) || 'normal_work',
    relatedLoopUid: typeof lifecycle.relatedLoopUid === 'string' ? lifecycle.relatedLoopUid : null,
    actor: lifecycle.actor && typeof lifecycle.actor === 'object'
      ? lifecycle.actor as CreateTaskInput['actor']
      : undefined,
    authorizationRequestUid: typeof lifecycle.authorizationRequestUid === 'string'
      ? lifecycle.authorizationRequestUid
      : null,
  };
}

function mapTaskRow(row: typeof tasks.$inferSelect): VaultTask {
  const lifecycle = decodeTaskContext(row.contextJson);
  return {
    id: row.id,
    taskUid: row.taskUid,
    title: row.title,
    taskType: row.taskType as VaultTask['taskType'],
    status: row.status as VaultTask['status'],
    priority: row.priority as VaultTask['priority'],
    project: row.project,
    prompt: row.prompt,
    context: lifecycle.context,
    routedModel: row.routedModel,
    resultText: row.resultText,
    resultMetadata: row.resultMetadataJson ? JSON.parse(row.resultMetadataJson) : null,
    errorMessage: row.errorMessage,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    parentTaskUid: row.parentTaskUid,
    sourceMemoryUid: row.sourceMemoryUid,
    targetMemoryUid: row.targetMemoryUid,
    workIntent: lifecycle.workIntent,
    relatedLoopUid: lifecycle.relatedLoopUid,
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
  const lifecycle = decodeTaskContext((row.context_json as string) || null);
  return {
    id: row.id as number,
    taskUid: row.task_uid as string,
    title: row.title as string,
    taskType: row.task_type as VaultTask['taskType'],
    status: row.status as VaultTask['status'],
    priority: row.priority as VaultTask['priority'],
    project: (row.project as string) || null,
    prompt: row.prompt as string,
    context: lifecycle.context,
    routedModel: (row.routed_model as string) || null,
    resultText: (row.result_text as string) || null,
    resultMetadata: row.result_metadata_json ? JSON.parse(row.result_metadata_json as string) : null,
    errorMessage: (row.error_message as string) || null,
    retryCount: row.retry_count as number,
    maxRetries: row.max_retries as number,
    parentTaskUid: (row.parent_task_uid as string) || null,
    sourceMemoryUid: (row.source_memory_uid as string) || null,
    targetMemoryUid: (row.target_memory_uid as string) || null,
    workIntent: lifecycle.workIntent,
    relatedLoopUid: lifecycle.relatedLoopUid,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string) || null,
    completedAt: (row.completed_at as string) || null,
    updatedAt: row.updated_at as string,
  };
}
