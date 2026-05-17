// ============================================================================
// Vault — TypeScript Types
// All interfaces and type definitions for the memory system.
// ============================================================================

import type {
  MemoryType,
  RoutineType,
  StatusValue,
  PriorityValue,
  SourceApp,
  LinkType,
  ProjectLinkType,
  ProposalType,
  ProposalStatus,
  ActionType,
  TaskType,
  TaskStatus,
  TaskPriority,
  OutcomeValue,
} from '../rules/controlled-values.js';

// ---------------------------------------------------------------------------
// Memory Item
// ---------------------------------------------------------------------------
export interface MemoryItem {
  id: number;
  itemUid: string;
  title: string;
  project: string;
  sourceApp: SourceApp;
  sourceSessionId: string | null;
  memoryType: MemoryType;
  subject: string;
  summary: string;
  content: string | null;
  keywords: string[];
  tags: string[];
  routineType: RoutineType | null;
  status: StatusValue;
  priority: PriorityValue;
  promoted: boolean;
  nextSteps: string[];
  relatedItemIds: string[];
  relatedFiles: string[];
  vaultPath: string | null;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  accessCount: number;
  /**
   * If set and in the future, the item is suppressed from the open-loops
   * panel until the timestamp passes. ISO 8601 string. Filter-only — does
   * not affect recall ranking.
   */
  snoozedUntil: string | null;
  /**
   * Resolution outcome set by vault_resolve_loop when closing an open loop.
   * Null until the item transitions to status='resolved' via the resolve
   * tool. Only meaningful when paired with that status.
   */
  outcome: OutcomeValue | null;
}

// ---------------------------------------------------------------------------
// Save Input
// ---------------------------------------------------------------------------
export interface SaveMemoryInput {
  title: string;
  project: string;
  memoryType: MemoryType;
  subject: string;
  summary: string;
  content?: string;
  keywords?: string[];
  tags?: string[];
  routineType?: RoutineType;
  status?: StatusValue;
  priority?: PriorityValue;
  sourceApp?: SourceApp;
  sourceSessionId?: string;
  nextSteps?: string[];
  relatedItemIds?: string[];
  relatedFiles?: string[];
}

// ---------------------------------------------------------------------------
// Save Result
// ---------------------------------------------------------------------------
export interface SaveMemoryResult {
  success: boolean;
  item: MemoryItem;
  vaultPath: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Find / Filter Query
// ---------------------------------------------------------------------------
export interface FindMemoryQuery {
  project?: string;
  memoryType?: MemoryType;
  subject?: string;
  keywords?: string[];
  tags?: string[];
  status?: StatusValue;
  priority?: PriorityValue;
  promoted?: boolean;
  sourceApp?: SourceApp;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Recall Query (smart recall)
// ---------------------------------------------------------------------------
export interface RecallQuery {
  project?: string;
  subject?: string;
  keywords?: string[];
  tags?: string[];
  queryText?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Recall Match
// ---------------------------------------------------------------------------
export interface RecallMatch {
  item: MemoryItem;
  score: number;
  reasons: string[];
  signals: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Memory Pack (recall result)
// ---------------------------------------------------------------------------
export interface MemoryPack {
  summaries: MemoryItem[];
  decisions: MemoryItem[];
  plans: MemoryItem[];
  other: MemoryItem[];
  related: MemoryItem[];
  proactive: MemoryItem[];
  topMatches: RecallMatch[];
  totalCandidates: number;
  topScore: number;
  contextSummary?: string;
  /**
   * Active open loops scoped to the recall query. Skills must surface these
   * before answering and prompt the user to resolve, snooze, or acknowledge
   * each. Sorted high → low by bucket then score. See plan
   * vm_-wkwx67j33XDx2aE Step 3.
   */
  openLoops: OpenLoop[];
}

// ---------------------------------------------------------------------------
// Resolve Loop input (vault_resolve_loop)
// ---------------------------------------------------------------------------
export interface ResolveLoopInput {
  itemUid: string;
  outcome: OutcomeValue;
  resolutionNote?: string;
}

// ---------------------------------------------------------------------------
// Memory Item Detail (includes file content)
// ---------------------------------------------------------------------------
export interface MemoryItemDetail extends MemoryItem {
  fileContent: string | null;
}

// ---------------------------------------------------------------------------
// Ranked Candidate
// ---------------------------------------------------------------------------
export interface RankedCandidate {
  item: MemoryItem;
  score: number;
  signals: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------
export interface Project {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  memoryCount?: number;
  relationships?: ProjectRelationship[];
}

/**
 * Per-project activity delta used by the Overview "Project radar" panel.
 * Counts are over `memory_items.created_at` for the trailing 7 days vs the
 * preceding 7 days. `direction` is 'inactive' when no memory has been
 * created in the last 14 days, otherwise the sign of the delta.
 */
export type ProjectMomentumDirection = 'up' | 'down' | 'flat' | 'inactive';

export interface ProjectMomentum {
  name: string;
  last7dCount: number;
  prior7dCount: number;
  delta: number;
  direction: ProjectMomentumDirection;
  lastActivityAt: string | null;
}

// ---------------------------------------------------------------------------
// Project Workspace Registry
// ---------------------------------------------------------------------------
export interface ProjectWorkspaceConfig {
  project: string;
  workspacePath: string;
  trusted: boolean;
  gitRootDetected: boolean;
  lastValidatedAt: string;
  notes: string | null;
}

export type ProjectWorkspaceRegistry = Record<string, ProjectWorkspaceConfig>;

export interface SetProjectWorkspaceInput {
  project: string;
  workspacePath: string;
  trusted?: boolean;
  notes?: string | null;
}

export interface WorkspaceValidationResult {
  ok: boolean;
  workspacePath: string;
  exists: boolean;
  isDirectory: boolean;
  gitRootDetected: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Project Context Pack
// ---------------------------------------------------------------------------
export type ProjectContextPackSectionKind = 'description' | 'recall' | 'latest' | 'activity';

export interface ProjectContextPackSection {
  kind: ProjectContextPackSectionKind;
  title: string;
  content: string;
}

export interface ProjectContextPackInput {
  project: string;
  title?: string;
  prompt?: string;
  maxRecall?: number;
  maxLatest?: number;
  maxLogs?: number;
}

export interface ProjectContextPack {
  project: string;
  queryText: string;
  markdown: string;
  sections: ProjectContextPackSection[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Local Workbench Launch
// ---------------------------------------------------------------------------
export type LocalWorkbenchAdapterType = 'claude_local' | 'codex_local';

export interface LocalWorkbenchLaunchInput {
  adapterType: LocalWorkbenchAdapterType;
  workspacePath: string;
  contextPackPath: string;
  model?: string;
  effort?: string;
  prompt: string;
}

export interface LocalWorkbenchLaunchSpec {
  adapterType: LocalWorkbenchAdapterType;
  command: string;
  args: string[];
  workspacePath: string;
  contextPackPath: string;
  displayCommand: string;
}

/**
 * Open-loops panel surfacing — derived bucket from the deterministic
 * scoring formula in retrieve.service.ts (priority + days_open*2 +
 * recency boost + routine weight). High-value rows are unfinished work
 * the user has implicitly committed to (memories with non-empty
 * next_steps or active debugging items).
 */
export type OpenLoopBucket = 'high' | 'medium' | 'low';

export interface OpenLoop {
  itemUid: string;
  title: string;
  project: string;
  memoryType: MemoryType;
  subject: string;
  summary: string;
  priority: PriorityValue;
  routineType: RoutineType | null;
  tags: string[];
  nextSteps: string[];
  lastUpdated: string;
  lastAccessedAt: string | null;
  daysOpen: number;
  score: number;
  bucket: OpenLoopBucket;
  recentlyReferenced: boolean;
}

// ---------------------------------------------------------------------------
// Project Relationship
// ---------------------------------------------------------------------------
export interface ProjectRelationship {
  id: number;
  sourceProject: string;
  targetProject: string;
  linkType: ProjectLinkType;
  note: string | null;
  confidence: number | null;
  createdBy: string;
  createdAt: string;
}

export interface AddProjectRelationshipInput {
  sourceProject: string;
  targetProject: string;
  linkType: ProjectLinkType;
  note?: string;
  confidence?: number;
  createdBy?: string;
}

// ---------------------------------------------------------------------------
// Project Proposal (review surface for project_review duty)
// ---------------------------------------------------------------------------
export type ProjectProposalPayload =
  | { type: 'description'; description: string }
  | {
      type: 'relationship';
      sourceProject: string;
      targetProject: string;
      linkType: ProjectLinkType;
      note?: string;
    }
  | {
      type: 'merge';
      sourceProject: string;
      targetProject: string;
      relocateFiles: boolean;
    };

export interface ProjectProposal {
  id: number;
  proposalUid: string;
  project: string;
  proposalType: ProposalType;
  payload: ProjectProposalPayload;
  rationale: string | null;
  confidence: number | null;
  status: ProposalStatus;
  sourceTaskUid: string | null;
  evidenceItemUids: string[];
  createdBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectProposalInput {
  project: string;
  payload: ProjectProposalPayload;
  rationale?: string;
  confidence?: number;
  sourceTaskUid?: string;
  evidenceItemUids?: string[];
  createdBy?: string;
}

export interface DecideProjectProposalInput {
  proposalUid: string;
  decision: 'accept' | 'reject';
  decidedBy?: string;
  decisionNote?: string;
}

export interface FindProjectProposalsQuery {
  project?: string;
  status?: ProposalStatus;
  proposalType?: ProposalType;
  limit?: number;
}

export interface DecideProjectProposalResult {
  proposal: ProjectProposal;
  applied: boolean; // true if accepted and the apply path ran successfully
  error?: string;
}

// ---------------------------------------------------------------------------
// Project Merge Result
// ---------------------------------------------------------------------------
export interface MergeProjectResult {
  sourceProject: string;
  targetProject: string;
  movedItemUids: string[];
  filesRelocated: number;
  filesMissing: number;
  rewrittenRelationshipIds: number[];
  removedRelationshipIds: number[];
  rewrittenTaskUids: string[];
  rewrittenProposalUids: string[];
  sourceProjectDeleted: boolean;
}

// ---------------------------------------------------------------------------
// Project Review (project_review duty)
// ---------------------------------------------------------------------------
export type ProjectReviewSkipReason =
  | 'disabled'
  | 'cooldown'
  | 'project_not_found'
  | 'below_item_threshold';

export interface ProjectReviewOptions {
  /** Bypass the cooldown and threshold gates. */
  force?: boolean;
  /** Don't persist proposals; just compute what would be proposed. */
  dryRun?: boolean;
}

export interface ProjectReviewResult {
  project: string;
  skipped: boolean;
  skipReason?: ProjectReviewSkipReason;
  proposalsCreated: ProjectProposal[];
  candidatesEvaluated: number;
  reviewedAt: string;
}

// ---------------------------------------------------------------------------
// Tag
// ---------------------------------------------------------------------------
export interface Tag {
  id: number;
  name: string;
  normalizedName: string;
  category: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Memory Link
// ---------------------------------------------------------------------------
export interface MemoryLink {
  id: number;
  sourceItemId: string;
  targetItemId: string;
  linkType: LinkType;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Activity Log Entry
// ---------------------------------------------------------------------------
export interface ActivityLogEntry {
  id?: number;
  timestamp?: string;
  sourceClient: string;
  project?: string;
  actionType: ActionType;
  targetItemId?: string;
  status?: string;
  latencyMs?: number;
  aiUsed?: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Vault Task
// ---------------------------------------------------------------------------
export interface VaultTask {
  id: number;
  taskUid: string;
  title: string;
  taskType: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  project: string | null;
  prompt: string;
  context: Record<string, unknown>;
  routedModel: string | null;
  resultText: string | null;
  resultMetadata: Record<string, unknown> | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  parentTaskUid: string | null;
  sourceMemoryUid: string | null;
  targetMemoryUid: string | null;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Create Task Input
// ---------------------------------------------------------------------------
export interface CreateTaskInput {
  title: string;
  taskType: TaskType;
  prompt: string;
  priority?: TaskPriority;
  project?: string;
  context?: Record<string, unknown>;
  maxRetries?: number;
  parentTaskUid?: string;
  sourceMemoryUid?: string;
  targetMemoryUid?: string;
  createdBy?: string;
}

// ---------------------------------------------------------------------------
// Find Task Query
// ---------------------------------------------------------------------------
export interface FindTaskQuery {
  status?: TaskStatus;
  taskType?: TaskType;
  priority?: TaskPriority;
  project?: string;
  createdBy?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Task Queue Stats
// ---------------------------------------------------------------------------
export interface TaskQueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  byType: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Agent Duties
// ---------------------------------------------------------------------------
export interface DuplicateMatch {
  itemUid: string;
  title: string;
  similarity: number;
  suggestedAction: 'merge' | 'link';
}

export interface DuplicateDetectionResult {
  sourceItemUid: string;
  matches: DuplicateMatch[];
  linkedItemUids: string[];
}

export interface AgentDutyScheduleTask {
  taskUid: string;
  taskType: TaskType;
  reason: 'quality_check' | 'metadata_organize' | 'duplicate_review';
}

export interface AgentDutyScheduleResult {
  sourceItemUid: string;
  createdTasks: AgentDutyScheduleTask[];
  duplicateDetection: DuplicateDetectionResult;
}

export interface MergeMemoryItemsResult {
  keptItem: MemoryItem;
  archivedItem: MemoryItem | null;
  updatedReferenceItemUids: string[];
}

export interface AgentDutyMaintenanceResult {
  archivedItemUids: string[];
  promotedItemUids: string[];
  /** Items just transitioned active → stale by this run. */
  staledItemUids?: string[];
  /** Items just transitioned archived → pending_delete by this run. */
  pendingDeleteItemUids?: string[];
}

export interface StaleArchivalOptions {
  /**
   * Days an active item must be idle (no recall ≥ score 20, no edit) before
   * being marked 'stale'. Default 30.
   */
  activeToStaleDays?: number;
  /**
   * Days a stale item must remain untouched (since being marked stale)
   * before being archived. Default 30.
   */
  staleToArchivedDays?: number;
  /**
   * Days an archived item must remain untouched before being flagged
   * 'pending_delete' for user review. Default 60.
   */
  archivedToPendingDeleteDays?: number;
}

export interface ProjectBriefing {
  project: string;
  promotedDecisions: MemoryItem[];
  activePlans: MemoryItem[];
  recentSummaries: MemoryItem[];
  recentHandoffs: MemoryItem[];
  promotedItems: MemoryItem[];
  proactiveContext: MemoryItem[];
}

// ---------------------------------------------------------------------------
// Model Route Configuration
// ---------------------------------------------------------------------------
export interface ModelRouteConfig {
  taskType: TaskType;
  modelId: string;
  fallbackModelId?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface ModelRoutingTable {
  routes: ModelRouteConfig[];
  defaultModelId: string;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export interface VaultSettings {
  vault_root: string;
  openrouter_api_key: string;
  enrichment_model: string;
  enrichment_enabled: boolean;
  vault_agent_backend?: 'api' | 'local';
  recall_max_results: number;
  recall_compact_limit?: number;
  recall_top_match_limit?: number;
  recall_detail_expansion_limit?: number;
  recall_related_limit?: number;
  recall_proactive_limit?: number;
  auto_log: boolean;
  model_routing_table?: Partial<ModelRoutingTable> | null;
  [key: string]: unknown;
}
