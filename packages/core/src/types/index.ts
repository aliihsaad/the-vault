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
  ProjectType,
  ProjectLifecycleState,
  AuthorizationPolicyMode,
  AuthorizationAction,
  ActorKind,
  LoopState,
  LoopOutcome,
  LoopPriority,
  LoopBlockingScope,
  LoopTriggerKind,
  LoopEventType,
  WorkIntent,
  EvidenceKind,
  ApprovalDecision,
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
// Exhaustive Open Loop tools
// ---------------------------------------------------------------------------
export interface ListOpenLoopsInput {
  project?: string;
  tags?: string[];
  priority?: PriorityValue;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  offset?: number;
}

export interface OpenLoopListItem {
  itemUid: string;
  title: string;
  project: string;
  memoryType: MemoryType;
  subject: string;
  priority: PriorityValue;
  tags: string[];
  nextSteps: string[];
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListOpenLoopsResult {
  source: 'legacy_memory_items';
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  generatedAt: string;
  items: OpenLoopListItem[];
}

export interface CountOpenLoopsInput {
  project?: string;
  tags?: string[];
  priority?: PriorityValue;
  createdFrom?: string;
  createdTo?: string;
  byProject?: boolean;
}

export interface CountOpenLoopsResult {
  source: 'legacy_memory_items';
  total: number;
  byProject?: Record<string, number>;
  generatedAt: string;
}

export interface ResolveLoopBatchItemInput {
  itemUid: string;
  outcome: OutcomeValue;
  resolutionNote?: string;
}

export interface ResolveLoopBatchInput {
  items: ResolveLoopBatchItemInput[];
}

export type ResolveLoopBatchFailureReason =
  | 'not_found'
  | 'not_open_loop'
  | 'duplicate_item_uid'
  | 'validation_error'
  | 'internal_error';

export interface ResolveLoopBatchFailure {
  itemUid: string;
  reason: ResolveLoopBatchFailureReason;
  message: string;
}

export interface ResolveLoopBatchResult {
  requested: number;
  resolved: string[];
  failed: ResolveLoopBatchFailure[];
  generatedAt: string;
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
  slug: string;
  description: string | null;
  projectUid: string | null;
  projectType: ProjectType;
  lifecycleState: ProjectLifecycleState | null;
  authorizationPolicyId: string | null;
  evidencePolicyId: string | null;
  classificationVersion: number;
  classifiedByActorUid: string | null;
  classifiedAt: string | null;
  version: number;
  canonicalRoot: string | null;
  repositoryUrl: string | null;
  defaultBranch: string | null;
  ownerActorUid: string | null;
  ownerRole: string | null;
  memoryPurpose: string | null;
  typeConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  memoryCount?: number;
  relationships?: ProjectRelationship[];
}

export interface ActorContext {
  actorUid: string;
  actorKind: ActorKind;
  roles: string[];
  externalProvider?: string;
  externalDecisionId?: string;
  externalApproved?: boolean;
}

export interface AuthorizationPolicy {
  policyUid: string;
  name: string;
  mode: AuthorizationPolicyMode;
  ownerActorUid: string | null;
  allowedRoles: string[];
  quorum: number;
  externalProvider: string | null;
  actions: AuthorizationAction[];
  version: number;
  enabled: boolean;
}

export interface EvidencePolicyRequirements {
  minimumReferences: number;
  fixedKinds: EvidenceKind[];
  duplicateKinds: EvidenceKind[];
  retirementKinds: EvidenceKind[];
}

export interface EvidencePolicy {
  policyUid: string;
  name: string;
  requirements: EvidencePolicyRequirements;
  version: number;
  enabled: boolean;
}

export interface OpenLoopInstallationDefaults {
  actor: ActorContext;
  authorizationPolicyUid: string;
  evidencePolicyUid: string;
}

export interface CreateProjectInput {
  name: string;
  projectType: Exclude<ProjectType, 'unclassified'>;
  description?: string;
  canonicalRoot?: string;
  repositoryUrl?: string;
  defaultBranch?: string;
  ownerActorUid?: string;
  ownerRole?: string;
  memoryPurpose?: string;
  authorizationPolicyId?: string;
  evidencePolicyId?: string;
  typeConfig?: Record<string, unknown>;
}

export interface ProjectClassificationConfig {
  description?: string;
  canonicalRoot?: string;
  repositoryUrl?: string;
  defaultBranch?: string;
  ownerActorUid?: string;
  ownerRole?: string;
  memoryPurpose?: string;
  authorizationPolicyId?: string;
  evidencePolicyId?: string;
  typeConfig?: Record<string, unknown>;
}

export interface ClassifyProjectInput {
  project: string;
  targetType: Exclude<ProjectType, 'unclassified'>;
  config: ProjectClassificationConfig;
  actor: ActorContext;
  expectedVersion: number;
  idempotencyKey: string;
  authorizationRequestUid?: string;
  dryRun?: boolean;
}

export interface ConvertProjectTypeInput extends ClassifyProjectInput {
  reason: string;
}

export interface TransitionProjectLifecycleInput {
  project: string;
  nextState: Exclude<ProjectLifecycleState, 'unclassified'>;
  reason: string;
  evidence?: AddLoopEvidenceReferenceInput[];
  actor: ActorContext;
  expectedVersion: number;
  idempotencyKey: string;
  authorizationRequestUid?: string;
}

export interface ProjectLifecycleTransitionResult {
  eventUid: string;
  project: Project;
  previousState: ProjectLifecycleState;
  nextState: ProjectLifecycleState;
  reason: string;
  idempotentReplay: boolean;
}

export interface ProjectClassificationReport {
  project: Project;
  requestedType: Exclude<ProjectType, 'unclassified'>;
  dryRun: boolean;
  allowed: boolean;
  reasonCodes: string[];
  legacyCandidateCount: number;
  dedicatedNonterminalLoopCount: number;
  dedicatedLoopCount: number;
  resultingLifecycleState: ProjectLifecycleState;
}

export interface ProjectClassificationResult extends ProjectClassificationReport {
  project: Project;
  idempotentReplay: boolean;
  eventUid: string | null;
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
// Open-Loops v2 dedicated lifecycle
// ---------------------------------------------------------------------------
export interface LoopEvidenceReference {
  evidenceUid: string;
  kind: EvidenceKind;
  reference: string;
  description: string;
  immutableHash: string | null;
  addedByActorUid: string;
  addedByActorKind: ActorKind;
  addedAt: string;
}

export interface AddLoopEvidenceReferenceInput {
  kind: EvidenceKind;
  reference: string;
  description: string;
  immutableHash?: string;
}

export interface DedicatedOpenLoop {
  id: number;
  loopUid: string;
  projectUid: string;
  projectName: string;
  title: string;
  commitment: string;
  deferredReason: string;
  ownerKind: ActorKind;
  ownerReference: string;
  immediateNextAction: string;
  triggerKind: LoopTriggerKind;
  triggerValue: string;
  currentEvidenceSummary: string;
  closureCriteria: string;
  evidence: LoopEvidenceReference[];
  state: LoopState;
  terminalOutcome: LoopOutcome | null;
  priority: LoopPriority;
  blockingScope: LoopBlockingScope;
  dedupeKey: string;
  sourceMemoryUid: string | null;
  sourceTaskUid: string | null;
  sourceSessionUid: string | null;
  sourceHandoffUid: string | null;
  externalReference: string | null;
  sourceContext: Record<string, unknown>;
  creatingActorUid: string;
  creatingActorKind: ActorKind;
  resumeState: Exclude<LoopState, 'snoozed' | 'resolved'> | null;
  snoozedUntil: string | null;
  dependencyTrigger: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOpenLoopInput {
  projectUid: string;
  title: string;
  commitment: string;
  deferredReason: string;
  ownerKind: ActorKind;
  ownerReference: string;
  immediateNextAction: string;
  triggerKind: LoopTriggerKind;
  triggerValue: string;
  currentEvidenceSummary: string;
  closureCriteria: string;
  priority: LoopPriority;
  blockingScope?: LoopBlockingScope;
  dedupeKey: string;
  sourceMemoryUid?: string;
  sourceTaskUid?: string;
  sourceSessionUid?: string;
  sourceHandoffUid?: string;
  externalReference?: string;
  sourceContext: Record<string, unknown>;
  creatingActor: ActorContext;
  idempotencyKey: string;
  authorizationRequestUid?: string;
  correlationUid?: string;
}

export interface CreateOpenLoopResult {
  loop: DedicatedOpenLoop;
  eventUid: string;
  idempotentReplay: boolean;
}

export interface OpenLoopMutationResult {
  loop: DedicatedOpenLoop;
  eventUid: string;
  idempotentReplay: boolean;
}

export interface ListDedicatedOpenLoopsInput {
  projectUid?: string;
  states?: LoopState[];
  includeResolved?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListDedicatedOpenLoopsResult {
  source: 'dedicated_open_loops';
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  generatedAt: string;
  items: DedicatedOpenLoop[];
}

export interface CountDedicatedOpenLoopsInput {
  projectUid?: string;
  states?: LoopState[];
  includeResolved?: boolean;
  byProject?: boolean;
}

export interface CountDedicatedOpenLoopsResult {
  source: 'dedicated_open_loops';
  total: number;
  byProject?: Record<string, number>;
  generatedAt: string;
}

export interface TransitionOpenLoopInput {
  loopUid: string;
  nextState: Exclude<LoopState, 'snoozed' | 'resolved'>;
  reason: string;
  actor: ActorContext;
  expectedVersion: number;
  idempotencyKey: string;
  correlationUid?: string;
}

export interface AddLoopEvidenceInput {
  loopUid: string;
  evidence: AddLoopEvidenceReferenceInput[];
  currentEvidenceSummary: string;
  actor: ActorContext;
  expectedVersion: number;
  idempotencyKey: string;
  transitionToVerification?: boolean;
  correlationUid?: string;
}

export interface ResolveOpenLoopInput {
  loopUid: string;
  outcome: LoopOutcome;
  resolutionNote: string;
  verifier: ActorContext;
  expectedVersion: number;
  idempotencyKey: string;
  duplicateOfLoopUid?: string;
  correlationUid?: string;
}

export interface ResolveOpenLoopResult {
  loop: DedicatedOpenLoop;
  gate: ProjectGateResult;
  eventUid: string;
  idempotentReplay: boolean;
}

export interface RecoverOpenLoopInput {
  loopUid: string;
  reason: string;
  actor: ActorContext;
  expectedVersion: number;
  idempotencyKey: string;
  authorizationRequestUid?: string;
  recoveryState?: Exclude<LoopState, 'snoozed' | 'resolved'>;
  correlationUid?: string;
}

export interface RequestLoopSnoozeInput {
  loopUid: string;
  reason: string;
  snoozedUntil?: string;
  dependencyTrigger?: string;
  requester: ActorContext;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface DecideLoopSnoozeInput {
  requestUid: string;
  loopUid: string;
  decision: ApprovalDecision;
  reason: string;
  approver: ActorContext;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface RequestLoopSnoozeResult {
  request: ApprovalRequest;
  loop: DedicatedOpenLoop;
  eventUid: string;
  idempotentReplay: boolean;
}

export interface ApprovalRequest {
  requestUid: string;
  action: AuthorizationAction;
  targetUid: string;
  policyUid: string;
  policyVersion: number;
  requesterActorUid: string;
  requesterActorKind: ActorKind;
  scope: Record<string, unknown>;
  reason: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  expiresAt: string | null;
  trigger: Record<string, unknown> | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface ApprovalRecord {
  approvalUid: string;
  requestUid: string;
  action: AuthorizationAction;
  targetUid: string;
  policyUid: string;
  policyVersion: number;
  actorUid: string;
  actorKind: ActorKind;
  actorRoles: string[];
  decision: ApprovalDecision;
  scope: Record<string, unknown>;
  reason: string;
  externalDecisionId: string | null;
  externalProvider: string | null;
  eventUid: string | null;
  createdAt: string;
}

export interface SnoozeDecisionResult {
  request: ApprovalRequest;
  approval: ApprovalRecord | null;
  loop: DedicatedOpenLoop;
  policySatisfied: boolean;
  idempotentReplay: boolean;
}

export type ProjectGateReasonCode =
  | 'NO_BLOCKERS'
  | 'SAME_PROJECT_BLOCKED'
  | 'RELATED_LOOP_REQUIRED'
  | 'RELATED_LOOP_NOT_BLOCKING'
  | 'RELATED_LOOP_ALLOWED'
  | 'MEMORY_MAINTENANCE_ALLOWED'
  | 'BRAIN_MEMORY_ALLOWED'
  | 'BRAIN_LOOP_OPERATION_DENIED'
  | 'URGENT_SAFETY_AUTHORIZED'
  | 'URGENT_SAFETY_UNAUTHORIZED'
  | 'PROJECT_UNCLASSIFIED'
  | 'PROJECT_NOT_FOUND';

export interface EvaluateProjectGateInput {
  projectUid: string;
  workIntent: WorkIntent;
  relatedLoopUid?: string;
  actor: ActorContext;
  idempotencyKey: string;
  authorizationRequestUid?: string;
}

export interface ProjectGateResult {
  allowed: boolean;
  projectUid: string;
  projectType: ProjectType;
  policyVersion: number;
  blockerUids: string[];
  reasonCode: ProjectGateReasonCode;
  allowedIntents: WorkIntent[];
  evaluatedAt: string;
  idempotentReplay: boolean;
}

export interface LegacyLoopCandidate {
  itemUid: string;
  project: string;
  status: StatusValue;
  routineType: RoutineType | null;
  nextSteps: string[];
  snoozedUntil: string | null;
  outcome: OutcomeValue | null;
  reasons: Array<'non_empty_next_steps' | 'snoozed' | 'active_debugging' | 'resolved'>;
}

export interface LegacyLoopCandidateReport {
  generatedAt: string;
  total: number;
  byReason: Record<string, number>;
  candidates: LegacyLoopCandidate[];
  dedicatedLoopsCreated: 0;
}

export interface OpenLoopShadowTelemetry {
  generatedAt: string;
  projectUid: string | null;
  projectName: string | null;
  projectType: ProjectType | null;
  lifecycleState: ProjectLifecycleState | null;
  legacySource: 'legacy_memory_items';
  dedicatedSource: 'dedicated_open_loops';
  legacyCount: number;
  dedicatedCount: number;
  divergence: number;
  brainInvariantSatisfied: boolean;
  gateEnforced: false;
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
  movedLoopUids: string[];
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
export interface TaskProviderAttemptError {
  provider: 'openrouter' | 'llm-hub';
  models: string[];
  error: string;
  timestamp: string;
}

export interface TaskResultMetadata extends Record<string, unknown> {
  primaryProviderError?: TaskProviderAttemptError;
  /**
   * Unsuccessful provider attempts that preceded the provider which
   * ultimately completed the task.
   */
  providerAttempts?: TaskProviderAttemptError[];
}

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
  resultMetadata: TaskResultMetadata | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  parentTaskUid: string | null;
  sourceMemoryUid: string | null;
  targetMemoryUid: string | null;
  workIntent?: WorkIntent;
  relatedLoopUid?: string | null;
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
  /** Canonical project scope. Required: task admission is governed per project. */
  project: string;
  context?: Record<string, unknown>;
  maxRetries?: number;
  parentTaskUid?: string;
  sourceMemoryUid?: string;
  targetMemoryUid?: string;
  workIntent?: WorkIntent;
  relatedLoopUid?: string;
  actor?: ActorContext;
  authorizationRequestUid?: string;
  /** Durable task-creation idempotency key; exact replays return the original row. */
  idempotencyKey?: string;
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
