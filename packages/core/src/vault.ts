// ============================================================================
// Vault — Main Vault Class
// The primary entry point that ties all services together.
// ============================================================================

import { getDatabase, initializeSchema, closeDatabase, resetConnection, type VaultDB } from './database/connection.js';
import {
  initializeVaultRoot,
  getDatabasePath,
  getLogsPath,
  DEFAULT_VAULT_ROOT,
} from './config/vault-root.js';
import {
  seedDefaultSettings,
  getSetting,
  setSetting,
  getAllSettings,
} from './config/settings.js';
import { saveMemory } from './services/save.service.js';
import {
  findMemory,
  recallContext,
  getLatest,
  getMemoryDetail,
  updateMemory,
  promoteMemory,
  archiveMemory,
  markMemoryStale,
  markMemoryPendingDelete,
  confirmMemoryDelete,
  getOpenLoops,
  resolveLoop,
} from './services/retrieve.service.js';
import { getRecentLogs, logActivity } from './services/log.service.js';
import {
  createTask as createTaskService,
  findTasks as findTasksService,
  getTask as getTaskService,
  claimNextTask as claimNextTaskService,
  completeTask as completeTaskService,
  failTask as failTaskService,
  cancelTask as cancelTaskService,
  retryTask as retryTaskService,
  getTaskQueueStats as getTaskQueueStatsService,
} from './services/task.service.js';
import {
  schedulePostSaveDuties as schedulePostSaveDutiesService,
  executeDuplicateDetection as executeDuplicateDetectionService,
  mergeMemoryItems as mergeMemoryItemsService,
  executeStaleArchival as executeStaleArchivalService,
  executeAutoPromotion as executeAutoPromotionService,
  executeProjectReview as executeProjectReviewService,
  getMemoryItemSnapshot,
  buildProjectBriefing as buildProjectBriefingService,
  requestClusterSummary as requestClusterSummaryService,
} from './services/agent-duties.service.js';
import {
  listProjects,
  createProject,
  getProject,
  getProjectsMomentum,
  updateProjectDescription,
  listProjectRelationships,
  addProjectRelationship,
  removeProjectRelationship,
  mergeProject,
} from './services/project.service.js';
import {
  createProjectProposal,
  listProjectProposals,
  getProjectProposal,
  decideProjectProposal,
} from './services/proposal.service.js';
import {
  setEnrichmentClient as setGlobalEnrichmentClient,
  isEnrichmentAvailable as checkEnrichmentAvailable,
} from './services/enrichment.service.js';
import { generateVaultPath, slugify } from './rules/naming.js';
import {
  DEFAULT_MODEL_ROUTING,
  resolveModelRoute,
  mergeRoutingTable,
} from './rules/model-routing.js';
import type { EnrichmentClient } from './services/openrouter-client.js';
import type { TaskType } from './rules/controlled-values.js';
import type {
  SaveMemoryInput,
  SaveMemoryResult,
  FindMemoryQuery,
  RecallQuery,
  MemoryItem,
  MemoryItemDetail,
  MemoryPack,
  OpenLoop,
  Project,
  ProjectMomentum,
  ActivityLogEntry,
  CreateTaskInput,
  FindTaskQuery,
  VaultTask,
  TaskQueueStats,
  AgentDutyScheduleResult,
  DuplicateDetectionResult,
  MergeMemoryItemsResult,
  AgentDutyMaintenanceResult,
  StaleArchivalOptions,
  ProjectBriefing,
  ProjectRelationship,
  AddProjectRelationshipInput,
  ProjectProposal,
  CreateProjectProposalInput,
  DecideProjectProposalInput,
  DecideProjectProposalResult,
  FindProjectProposalsQuery,
  MergeProjectResult,
  ProjectReviewOptions,
  ProjectReviewResult,
  ModelRoutingTable,
  ModelRouteConfig,
  ResolveLoopInput,
} from './types/index.js';

export class Vault {
  private db!: VaultDB;
  private vaultRoot: string;
  private dbPath: string;
  private logsPath: string;
  private initialized = false;

  constructor(rootPath?: string) {
    this.vaultRoot = rootPath || DEFAULT_VAULT_ROOT;
    this.dbPath = getDatabasePath(this.vaultRoot);
    this.logsPath = getLogsPath(this.vaultRoot);
  }

  /**
   * Initialize Vault: create directories, open database, run migrations, seed settings.
   * Must be called before any other method.
   */
  initialize(): void {
    if (this.initialized) return;

    // 1. Create directory structure
    initializeVaultRoot(this.vaultRoot);

    // 2. Open database and create schema
    initializeSchema(this.dbPath);
    this.db = getDatabase(this.dbPath);

    // 3. Seed default settings
    seedDefaultSettings(this.db);

    this.initialized = true;
  }

  /**
   * Close the Vault and release resources.
   */
  close(): void {
    closeDatabase();
    this.initialized = false;
  }

  /**
   * Reset the connection (for testing).
   */
  reset(): void {
    resetConnection();
    this.initialized = false;
  }

  // =========================================================================
  // Memory Operations
  // =========================================================================

  /**
   * Save a structured memory item.
   */
  saveMemory(input: SaveMemoryInput): SaveMemoryResult {
    this.ensureInitialized();
    return saveMemory(this.db, this.vaultRoot, this.logsPath, input);
  }

  /**
   * Search/filter memory items.
   */
  findMemory(query: FindMemoryQuery): MemoryItem[] {
    this.ensureInitialized();
    return findMemory(this.db, query);
  }

  /**
   * Smart recall with ranking — returns a memory pack.
   * Now async to support AI re-ranking and context summary.
   */
  async recallContext(query: RecallQuery): Promise<MemoryPack> {
    this.ensureInitialized();
    return recallContext(this.db, this.logsPath, query);
  }

  /**
   * Get the N most recent memory items.
   */
  getLatest(project?: string, limit?: number, options?: RetrievalActivityOptions): MemoryItem[] {
    this.ensureInitialized();
    const startTime = Date.now();
    const results = getLatest(this.db, project, limit);
    if (options?.logActivity) {
      logActivity(this.db, this.logsPath, {
        sourceClient: options.sourceClient ?? 'system',
        project,
        actionType: 'recall',
        status: 'success',
        latencyMs: Date.now() - startTime,
        message: project
          ? `Retrieved ${results.length} latest memory item(s) for ${project}`
          : `Retrieved ${results.length} latest memory item(s)`,
        metadata: {
          recallKind: 'latest',
          requestedLimit: limit ?? 10,
          resultCount: results.length,
          itemUids: results.map((item) => item.itemUid),
        },
      });
    }
    return results;
  }

  /**
   * Get full detail for a memory item (with file content).
   */
  getMemoryDetail(itemUid: string, options?: RetrievalActivityOptions): MemoryItemDetail | null {
    this.ensureInitialized();
    const startTime = Date.now();
    const detail = getMemoryDetail(this.db, itemUid);
    if (detail && options?.logActivity) {
      logActivity(this.db, this.logsPath, {
        sourceClient: options.sourceClient ?? 'system',
        project: detail.project,
        actionType: 'recall',
        targetItemId: detail.itemUid,
        status: 'success',
        latencyMs: Date.now() - startTime,
        message: `Retrieved memory detail: ${detail.title}`,
        metadata: {
          recallKind: 'detail',
          itemUid: detail.itemUid,
          memoryType: detail.memoryType,
        },
      });
    }
    return detail;
  }

  /**
   * Update metadata of a memory item.
   */
  updateMemory(itemUid: string, updates: Partial<MemoryItem>): MemoryItem | null {
    this.ensureInitialized();
    return updateMemory(this.db, this.vaultRoot, this.logsPath, itemUid, updates);
  }

  /**
   * Promote a memory item to long-term memory.
   */
  promoteMemory(itemUid: string): MemoryItem | null {
    this.ensureInitialized();
    return promoteMemory(this.db, this.logsPath, itemUid);
  }

  /**
   * Archive a memory item.
   */
  archiveMemory(itemUid: string): MemoryItem | null {
    this.ensureInitialized();
    return archiveMemory(this.db, this.vaultRoot, this.logsPath, itemUid);
  }

  /**
   * Mark a memory item as 'stale' (soft warning, still recallable). Returns
   * null if the item is missing or promoted.
   */
  markMemoryStale(itemUid: string): MemoryItem | null {
    this.ensureInitialized();
    return markMemoryStale(this.db, this.logsPath, itemUid);
  }

  /**
   * Mark a memory item as 'pending_delete'. The agent flags candidates here;
   * actual deletion requires confirmMemoryDelete (user action).
   */
  markMemoryPendingDelete(itemUid: string): MemoryItem | null {
    this.ensureInitialized();
    return markMemoryPendingDelete(this.db, this.logsPath, itemUid);
  }

  /**
   * Permanently delete a memory item. Refuses unless the item is in
   * 'pending_delete' or 'archived'. Removes the DB row and Markdown file.
   */
  confirmMemoryDelete(itemUid: string): boolean {
    this.ensureInitialized();
    return confirmMemoryDelete(this.db, this.vaultRoot, this.logsPath, itemUid);
  }

  /**
   * Surface unfinished work as an "open loops" list with derived priority
   * buckets. Pure read; uses the deterministic scoring formula in
   * retrieve.service.ts (no stored bucket). Excludes snoozed items.
   */
  getOpenLoops(project?: string): OpenLoop[] {
    this.ensureInitialized();
    return getOpenLoops(this.db, project);
  }

  /**
   * Close an open loop with an outcome. Atomic — sets status='resolved',
   * stores the outcome enum, optionally appends a resolution note, and
   * logs a `resolve_loop` activity row so close-rate is observable.
   * See plan vm_-wkwx67j33XDx2aE Step 3.
   */
  resolveLoop(input: ResolveLoopInput): MemoryItem | null {
    this.ensureInitialized();
    return resolveLoop(this.db, this.logsPath, input);
  }

  /**
   * Get a suggested save path for a memory item.
   */
  suggestSavePath(project: string, memoryType: string, title: string): string {
    this.ensureInitialized();
    return generateVaultPath(this.vaultRoot, project, memoryType, title);
  }

  // =========================================================================
  // Settings
  // =========================================================================

  getSetting(key: string): unknown {
    this.ensureInitialized();
    return getSetting(this.db, key);
  }

  setSetting(key: string, value: unknown): void {
    this.ensureInitialized();
    setSetting(this.db, key, value);
  }

  getAllSettings(): Record<string, unknown> {
    this.ensureInitialized();
    return getAllSettings(this.db);
  }

  // =========================================================================
  // Projects
  // =========================================================================

  listProjects(): Project[] {
    this.ensureInitialized();
    return listProjects(this.db);
  }

  /**
   * Per-project activity momentum (last 7d vs prior 7d memory counts plus
   * last activity timestamp). Read-only; powers the Overview Project radar.
   */
  getProjectsMomentum(): ProjectMomentum[] {
    this.ensureInitialized();
    return getProjectsMomentum(this.db);
  }

  createProject(name: string, description?: string): Project {
    this.ensureInitialized();
    return createProject(this.db, this.vaultRoot, name, description);
  }

  getProject(name: string): Project | null {
    this.ensureInitialized();
    return getProject(this.db, name);
  }

  /**
   * Update a project's description. Slug-matched.
   */
  updateProjectDescription(name: string, description: string | null): Project | null {
    this.ensureInitialized();
    return updateProjectDescription(this.db, name, description);
  }

  /**
   * List relationships involving the given project (source or target).
   */
  listProjectRelationships(name: string): ProjectRelationship[] {
    this.ensureInitialized();
    return listProjectRelationships(this.db, name);
  }

  /**
   * Add a relationship between two projects (slug-resolved on both sides).
   * Idempotent on (source, target, link_type).
   */
  addProjectRelationship(input: AddProjectRelationshipInput): ProjectRelationship {
    this.ensureInitialized();
    return addProjectRelationship(this.db, input);
  }

  /**
   * Remove a project relationship by id. Returns true if a row was deleted.
   */
  removeProjectRelationship(id: number): boolean {
    this.ensureInitialized();
    return removeProjectRelationship(this.db, id);
  }

  /**
   * Merge `sourceName` into `targetName`. Rewrites memory_items.project,
   * relocates files on disk, rewires project_relationships, rewrites task and
   * proposal project references, and deletes the source project row. Slug-
   * matched on both sides so casing variants collapse.
   */
  mergeProject(
    sourceName: string,
    targetName: string,
    options?: { relocateFiles?: boolean; decidedBy?: string },
  ): MergeProjectResult {
    this.ensureInitialized();
    return mergeProject(
      this.db,
      this.vaultRoot,
      this.logsPath,
      sourceName,
      targetName,
      options,
    );
  }

  // =========================================================================
  // Project Proposals (review surface for project_review duty)
  // =========================================================================

  /**
   * Create a project proposal. Idempotent per dedupe rules — see proposal.service.ts.
   */
  createProjectProposal(input: CreateProjectProposalInput): ProjectProposal {
    this.ensureInitialized();
    return createProjectProposal(this.db, this.logsPath, input);
  }

  /**
   * List project proposals matching the query (defaults: status=pending, newest first).
   */
  listProjectProposals(query?: FindProjectProposalsQuery): ProjectProposal[] {
    this.ensureInitialized();
    return listProjectProposals(this.db, query ?? {});
  }

  /**
   * Get a single proposal by UID.
   */
  getProjectProposal(proposalUid: string): ProjectProposal | null {
    this.ensureInitialized();
    return getProjectProposal(this.db, proposalUid);
  }

  /**
   * Decide a proposal (accept/reject). On accept, runs the apply path; on
   * apply failure, the proposal is reverted to pending.
   */
  decideProjectProposal(input: DecideProjectProposalInput): DecideProjectProposalResult {
    this.ensureInitialized();
    return decideProjectProposal(this.db, this.vaultRoot, this.logsPath, input);
  }

  // =========================================================================
  // Logs
  // =========================================================================

  getRecentLogs(limit?: number, filters?: Record<string, string>): ActivityLogEntry[] {
    this.ensureInitialized();
    return getRecentLogs(this.db, limit, filters);
  }

  // =========================================================================
  // Tasks
  // =========================================================================

  /**
   * Create a new task in the queue.
   */
  createTask(input: CreateTaskInput): VaultTask {
    this.ensureInitialized();
    return createTaskService(this.db, this.logsPath, input);
  }

  /**
   * Search/filter tasks.
   */
  findTasks(query: FindTaskQuery): VaultTask[] {
    this.ensureInitialized();
    return findTasksService(this.db, query);
  }

  /**
   * Get a single task by UID.
   */
  getTask(taskUid: string): VaultTask | null {
    this.ensureInitialized();
    return getTaskService(this.db, taskUid);
  }

  /**
   * Atomically claim the next pending task for execution.
   */
  claimNextTask(taskType?: TaskType): VaultTask | null {
    this.ensureInitialized();
    return claimNextTaskService(this.db, taskType);
  }

  /**
   * Mark a task as completed with its result.
   */
  completeTask(taskUid: string, resultText: string, resultMetadata?: Record<string, unknown>): VaultTask | null {
    this.ensureInitialized();
    return completeTaskService(this.db, this.vaultRoot, this.logsPath, taskUid, resultText, resultMetadata);
  }

  /**
   * Mark a task as failed.
   */
  failTask(taskUid: string, errorMessage: string): VaultTask | null {
    this.ensureInitialized();
    return failTaskService(this.db, this.logsPath, taskUid, errorMessage);
  }

  /**
   * Cancel a pending or running task.
   */
  cancelTask(taskUid: string): VaultTask | null {
    this.ensureInitialized();
    return cancelTaskService(this.db, this.logsPath, taskUid);
  }

  /**
   * Reset a failed/running task back to pending for retry.
   */
  retryTask(taskUid: string): VaultTask | null {
    this.ensureInitialized();
    return retryTaskService(this.db, taskUid);
  }

  /**
   * Get task queue statistics.
   */
  getTaskQueueStats(): TaskQueueStats {
    this.ensureInitialized();
    return getTaskQueueStatsService(this.db);
  }

  // =========================================================================
  // Agent Duties
  // =========================================================================

  async schedulePostSaveDuties(itemUid: string): Promise<AgentDutyScheduleResult | null> {
    this.ensureInitialized();
    const item = getMemoryItemSnapshot(this.db, itemUid);
    if (!item) {
      return null;
    }

    return schedulePostSaveDutiesService(this.db, this.logsPath, item, {
      vaultRoot: this.vaultRoot,
    });
  }

  /**
   * Run the project_review duty for a single project: inspects items and
   * proposes description / merge candidates via createProjectProposal.
   * Settings-gated and per-project cooldown — pass `force: true` to bypass.
   */
  async executeProjectReview(
    projectName: string,
    options?: ProjectReviewOptions,
  ): Promise<ProjectReviewResult> {
    this.ensureInitialized();
    return executeProjectReviewService(
      this.db,
      this.vaultRoot,
      this.logsPath,
      projectName,
      options,
    );
  }

  async executeDuplicateDetection(itemUid: string): Promise<DuplicateDetectionResult> {
    this.ensureInitialized();
    return executeDuplicateDetectionService(this.db, this.logsPath, itemUid);
  }

  mergeMemoryItems(keepUid: string, mergeUid: string): MergeMemoryItemsResult | null {
    this.ensureInitialized();
    return mergeMemoryItemsService(this.db, this.vaultRoot, this.logsPath, keepUid, mergeUid);
  }

  executeStaleArchival(
    optionsOrDays?: StaleArchivalOptions | number,
  ): AgentDutyMaintenanceResult {
    this.ensureInitialized();
    return executeStaleArchivalService(this.db, this.vaultRoot, this.logsPath, optionsOrDays);
  }

  executeAutoPromotion(): AgentDutyMaintenanceResult {
    this.ensureInitialized();
    return executeAutoPromotionService(this.db, this.logsPath);
  }

  getProjectBriefing(
    project: string,
    keywords?: string[],
    limit?: number,
    options?: RetrievalActivityOptions,
  ): ProjectBriefing {
    this.ensureInitialized();
    const startTime = Date.now();
    const briefing = buildProjectBriefingService(this.db, project, keywords, limit);
    if (options?.logActivity) {
      const itemUids = [
        ...briefing.promotedDecisions,
        ...briefing.activePlans,
        ...briefing.recentSummaries,
        ...briefing.recentHandoffs,
        ...briefing.promotedItems,
        ...briefing.proactiveContext,
      ].map((item) => item.itemUid);

      logActivity(this.db, this.logsPath, {
        sourceClient: options.sourceClient ?? 'system',
        project: briefing.project,
        actionType: 'recall',
        status: 'success',
        latencyMs: Date.now() - startTime,
        message: `Retrieved project briefing for ${briefing.project}`,
        metadata: {
          recallKind: 'project_briefing',
          keywords: keywords ?? [],
          requestedLimit: limit ?? 5,
          resultCount: new Set(itemUids).size,
          promotedDecisionCount: briefing.promotedDecisions.length,
          activePlanCount: briefing.activePlans.length,
          recentSummaryCount: briefing.recentSummaries.length,
          recentHandoffCount: briefing.recentHandoffs.length,
          promotedItemCount: briefing.promotedItems.length,
          proactiveContextCount: briefing.proactiveContext.length,
          itemUids: Array.from(new Set(itemUids)),
        },
      });
    }
    return briefing;
  }

  requestClusterSummary(itemUids: string[], queryContext?: string, project?: string): VaultTask | null {
    this.ensureInitialized();
    return requestClusterSummaryService(this.db, this.logsPath, itemUids, queryContext, project);
  }

  // =========================================================================
  // Model Routing
  // =========================================================================

  /**
   * Get the effective model routing table (defaults merged with user overrides).
   */
  getModelRoutingTable(): ModelRoutingTable {
    this.ensureInitialized();
    const userOverrides = this.getSetting('model_routing_table') as Partial<ModelRoutingTable> | undefined;
    return mergeRoutingTable(DEFAULT_MODEL_ROUTING, userOverrides || null);
  }

  /**
   * Save user overrides for the model routing table.
   */
  setModelRoutingTable(overrides: Partial<ModelRoutingTable>): void {
    this.ensureInitialized();
    this.setSetting('model_routing_table', overrides);
  }

  /**
   * Resolve which model would be used for a given task type.
   */
  resolveModelForTask(taskType: TaskType): ModelRouteConfig {
    this.ensureInitialized();
    return resolveModelRoute(this.getModelRoutingTable(), taskType);
  }

  // =========================================================================
  // Info
  // =========================================================================

  getVaultRoot(): string {
    return this.vaultRoot;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // =========================================================================
  // Enrichment
  // =========================================================================

  /**
   * Inject an enrichment client for AI-powered enrichment.
   * Call after initialize(). Pass null to disable.
   */
  setEnrichmentClient(client: EnrichmentClient | null): void {
    setGlobalEnrichmentClient(client);
  }

  /**
   * Check if AI enrichment is currently available.
   */
  isEnrichmentAvailable(): boolean {
    return checkEnrichmentAvailable();
  }

  // =========================================================================
  // Internal
  // =========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'Vault not initialized. Call vault.initialize() first.',
      );
    }
  }
}

interface RetrievalActivityOptions {
  logActivity?: boolean;
  sourceClient?: string;
}
