// ============================================================================
// Vault Core — Public API
// ============================================================================

export { Vault } from './vault.js';

// Types
export type {
  MemoryItem,
  SaveMemoryInput,
  SaveMemoryResult,
  FindMemoryQuery,
  RecallQuery,
  MemoryPack,
  MemoryItemDetail,
  RankedCandidate,
  Project,
  Tag,
  MemoryLink,
  ActivityLogEntry,
  VaultSettings,
  VaultTask,
  CreateTaskInput,
  FindTaskQuery,
  TaskQueueStats,
  DuplicateMatch,
  DuplicateDetectionResult,
  AgentDutyScheduleTask,
  AgentDutyScheduleResult,
  MergeMemoryItemsResult,
  AgentDutyMaintenanceResult,
  StaleArchivalOptions,
  ProjectBriefing,
  ProjectRelationship,
  AddProjectRelationshipInput,
  ProjectProposal,
  ProjectProposalPayload,
  CreateProjectProposalInput,
  DecideProjectProposalInput,
  DecideProjectProposalResult,
  FindProjectProposalsQuery,
  MergeProjectResult,
  ProjectReviewOptions,
  ProjectReviewResult,
  ProjectReviewSkipReason,
  ModelRouteConfig,
  ModelRoutingTable,
  OpenLoop,
  OpenLoopBucket,
  ResolveLoopInput,
  ListOpenLoopsInput,
  OpenLoopListItem,
  ListOpenLoopsResult,
  CountOpenLoopsInput,
  CountOpenLoopsResult,
  ResolveLoopBatchItemInput,
  ResolveLoopBatchInput,
  ResolveLoopBatchFailure,
  ResolveLoopBatchFailureReason,
  ResolveLoopBatchResult,
} from './types/index.js';

// Controlled values
export {
  MEMORY_TYPES,
  ROUTINE_TYPES,
  STATUS_VALUES,
  PRIORITY_VALUES,
  SOURCE_APPS,
  LINK_TYPES,
  PROJECT_LINK_TYPES,
  PROPOSAL_TYPES,
  PROPOSAL_STATUSES,
  ACTION_TYPES,
  MEMORY_TYPE_PRIORITY,
  PRIORITY_BOOST,
  TASK_TYPES,
  TASK_STATUSES,
  TASK_PRIORITIES,
  OUTCOME_VALUES,
} from './rules/controlled-values.js';

export {
  GRAPHIFY_BUILD_MODES,
  GRAPHIFY_FRESHNESS_STATES,
  GRAPHIFY_INSTALL_PROFILES,
  GRAPHIFY_RUNTIME_MODES,
  GraphifyBuildModeSchema,
  GraphifyFreshnessStateSchema,
  GraphifyInstallProfileSchema,
  GraphifyRuntimeModeSchema,
} from './rules/graphify.js';

export {
  VAULT_COLLAB_RUNTIME_MODES,
  VaultCollabRuntimeModeSchema,
} from './rules/vault-collab.js';

export type {
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
} from './rules/controlled-values.js';

export type {
  GraphifyBuildMode,
  GraphifyFreshnessState,
  GraphifyInstallProfile,
  GraphifyRuntimeMode,
} from './rules/graphify.js';

export type {
  VaultCollabRuntimeMode,
} from './rules/vault-collab.js';

export type {
  GraphifyArtifactDiscoveryResult,
  GraphifyArtifactPaths,
  GraphifyArtifactJsonReadResult,
  GraphifyArtifactReadAvailable,
  GraphifyArtifactReadFallback,
  GraphifyArtifactReadStatus,
  GraphifyArtifactReportReadResult,
  GraphifyArtifactTextReadAvailable,
  GraphifyBuildRecord,
  GraphifyBuildBlockedReason,
  GraphifyCorpusExportResult,
  GraphifyDebounceConfig,
  GraphifyGraphContextBase,
  GraphifyGraphContextStatus,
  GraphifyGraphEdgeContext,
  GraphifyGraphFallbackReason,
  GraphifyGraphImpactInput,
  GraphifyGraphImpactResult,
  GraphifyGraphNeighborsInput,
  GraphifyGraphNeighborsResult,
  GraphifyGraphNodeContext,
  GraphifyGraphNodeInput,
  GraphifyGraphNodeResult,
  GraphifyGraphQueryInput,
  GraphifyGraphQueryResult,
  GraphifyGraphShortestPathInput,
  GraphifyGraphShortestPathResult,
  GraphifyGraphStats,
  GraphifyHtmlArtifactAvailable,
  GraphifyHtmlArtifactMissing,
  GraphifyHtmlArtifactResult,
  GraphifyImpactFileContext,
  GraphifyMemoryExportEntry,
  GraphifyMemoryExportOpenLoopState,
  GraphifyProjectStatus,
  GraphifyProjectState,
  GraphifyProjectUiState,
  GraphifyRecallBudget,
  GraphifyRecallContextInput,
  GraphifyRecallContextResult,
  GraphifyRecallGraphContext,
  GraphifyRecallTelemetry,
  GraphifyReportSnippet,
  GraphifyRuntimeConfig,
  GraphifyScheduledFullRebuildPlan,
  GraphifyScheduledFullRebuildReason,
  GraphifySemanticConfig,
  GraphifySemanticModeStatus,
  GraphifyShortestPathContext,
  GraphifySourceRootCandidate,
  GraphifySourceManifest,
  ExportGraphifyCorpusInput,
  PlanGraphifyScheduledFullRebuildInput,
  RecordGraphifyBuildInput,
  SaveGraphifyRuntimeConfigInput,
  UpsertGraphifyProjectStateInput,
} from './types/graphify.js';

export type {
  SaveVaultCollabRuntimeConfigInput,
  VaultCollabAgentRequestInput,
  VaultCollabAgentRequestProvider,
  VaultCollabClientType,
  VaultCollabDashboardCounts,
  VaultCollabDashboardOptions,
  VaultCollabDashboardSnapshot,
  VaultCollabDashboardActionInput,
  VaultCollabDashboardActor,
  VaultCollabDeliveryAttemptSnapshot,
  VaultCollabDeliveryAttemptStatus,
  VaultCollabEventTypeSnapshot,
  VaultCollabEventSnapshot,
  VaultCollabHandoffPriority,
  VaultCollabHandoffActionAffordance,
  VaultCollabHandoffActionKind,
  VaultCollabHandoffActionSet,
  VaultCollabHandoffSnapshot,
  VaultCollabHandoffStatus,
  VaultCollabJsonRecord,
  VaultCollabLaunchCommand,
  VaultCollabLaunchRequestSnapshot,
  VaultCollabLaunchRequestStatus,
  VaultCollabPolicyPackActionInput,
  VaultCollabPolicyPackSnapshot,
  VaultCollabRoleProfileAliasSnapshot,
  VaultCollabRoleProfileSkillsSnapshot,
  VaultCollabRoleProfileSnapshot,
  VaultCollabRuntimeConfig,
  VaultCollabSessionAdapterType,
  VaultCollabSessionConnectionState,
  VaultCollabSessionSnapshot,
  VaultCollabSessionSnapshotV1,
  VaultCollabSessionStatus,
  VaultCollabSnapshotRiskLevel,
  VaultCollabSnapshotState,
  VaultCollabActionInvocation,
  VaultCollabActionResult,
} from './types/vault-collab.js';

export {
  getGraphifyExtensionPaths,
  getGraphifyProjectPaths,
} from './services/graphify-paths.service.js';

export {
  getVaultCollabExtensionPaths,
} from './services/vault-collab-paths.service.js';

export type {
  GraphifyExtensionPaths,
  GraphifyProjectPaths,
} from './services/graphify-paths.service.js';

export type {
  VaultCollabExtensionPaths,
} from './services/vault-collab-paths.service.js';

export {
  getDefaultGraphifyRuntimeConfig,
  getGraphifyRuntimeConfig,
  resetGraphifyRuntimeConfig,
  saveGraphifyRuntimeConfig,
} from './services/graphify-config.service.js';

export {
  getDefaultVaultCollabRuntimeConfig,
  getVaultCollabRuntimeConfig,
  resetVaultCollabRuntimeConfig,
  saveVaultCollabRuntimeConfig,
} from './services/vault-collab-config.service.js';

export {
  getGraphifyBuildHistory,
  getGraphifyProjectStatus,
  getGraphifyProjectState,
  recordGraphifyBuild,
  setGraphifyProjectEnabled,
  setGraphifyProjectSourceRoot,
  upsertGraphifyProjectState,
} from './services/graphify-project.service.js';

export {
  detectGraphifyRuntime,
  planGraphifyInstall,
  resolveGraphifyCommandForRuntimeConfig,
} from './services/graphify-runtime.service.js';

export {
  VAULT_COLLAB_REPOSITORY_URL,
  detectVaultCollabRuntime,
  planVaultCollabInstall,
  resolveVaultCollabCliPath,
  resolveVaultCollabMcpServerPath,
} from './services/vault-collab-runtime.service.js';

export {
  getVaultCollabDashboardSnapshot,
} from './services/vault-collab-dashboard.service.js';

export {
  approveVaultCollabLaunchRequest,
  buildVaultCollabLaunchCommand,
  buildVaultCollabDashboardSessionInvocation,
  buildVaultCollabActionInvocation,
  buildVaultCollabHandoffActionsInvocation,
  executeVaultCollabAction,
  executeVaultCollabDashboardSessionRegistration,
  executeVaultCollabHandoffActions,
  redactVaultCollabActionInvocation,
} from './services/vault-collab-actions.service.js';

export type {
  VaultCollabActionRunner,
  VaultCollabActionRunnerResult,
  VaultCollabDashboardSessionInput,
  VaultCollabDashboardSessionRegistrationResult,
  VaultCollabLaunchApprovalResult,
} from './services/vault-collab-actions.service.js';

export type {
  VaultCollabDetectedPath,
  VaultCollabInstallPlan,
  VaultCollabPackageInfo,
  VaultCollabRuntimeStatus,
} from './services/vault-collab-runtime.service.js';

export {
  exportGraphifyProjectCorpus,
} from './services/graphify-corpus.service.js';

export {
  buildGraphifyProjectGraph,
} from './services/graphify-build.service.js';

export type {
  BuildGraphifyProjectGraphInput,
  GraphifyBuildProcessOptions,
  GraphifyBuildProcessResult,
  GraphifyBuildProcessRunner,
  GraphifyProjectBuildResult,
} from './services/graphify-build.service.js';

export {
  GraphifyBuildQueue,
  markGraphifyProjectStale,
  markGraphifyProjectStaleForMemoryChange,
  shouldMarkGraphifyStaleForMemoryChange,
} from './services/graphify-build-queue.service.js';

export type {
  GraphifyBuildQueueClock,
  GraphifyBuildQueueOptions,
  GraphifyBuildQueueProjectRuntimeState,
  GraphifyBuildQueueProjectStore,
  GraphifyBuildQueueReason,
  GraphifyBuildQueueStaleResult,
  GraphifyBuildQueueTimers,
  GraphifyBuildQueueTrigger,
  GraphifyBuildQueueTriggerResult,
  GraphifyBuildQueueTriggerStatus,
  GraphifyQueuedBuildExecutor,
  GraphifyQueuedBuildRequest,
} from './services/graphify-build-queue.service.js';

export {
  discoverGraphifyArtifacts,
  getGraphifyHtmlArtifact,
  readGraphifyArtifactJson,
  readGraphifyArtifactReport,
  readGraphStatsFromGraphJson,
  resolveGraphifyArtifactPath,
} from './services/graphify-artifact.service.js';

export type {
  GraphifyArtifactReadOptions,
} from './services/graphify-artifact.service.js';

export {
  explainGraphifyImpact,
  getGraphifyNeighborsContext,
  getGraphifyNodeContext,
  getGraphifyShortestPathContext,
  queryGraphifyProjectGraph,
} from './services/graphify-query.service.js';

export {
  assertGraphifySemanticBuildAllowed,
  getGraphifySemanticModeStatus,
  planGraphifyScheduledFullRebuild,
} from './services/graphify-quality.service.js';

export {
  buildRecallWithGraphContext,
} from './services/graphify-recall.service.js';

export type {
  RecallWithGraphContextSource,
} from './services/graphify-recall.service.js';

export {
  buildGraphifyRecallTelemetry,
  toGraphifyTelemetryLogMetadata,
} from './services/graphify-telemetry.service.js';

export type {
  BuildGraphifyRecallTelemetryInput,
} from './services/graphify-telemetry.service.js';

export {
  DEFAULT_GRAPHIFY_INSTRUCTION_BODY,
  GRAPHIFY_INSTRUCTION_END_MARKER,
  GRAPHIFY_INSTRUCTION_START_MARKER,
  applyGraphifyInstructionSync,
  buildGraphifyInstructionSection,
  buildGraphifyInstructionSyncPreview,
  previewGraphifyInstructionSync,
  removeGraphifyInstructionSection,
  upsertGraphifyInstructionSection,
} from './services/graphify-instruction-sync.service.js';

export type {
  BuildGraphifyInstructionSyncPreviewInput,
  GraphifyInstructionSyncInput,
  GraphifyInstructionSyncOperation,
  GraphifyInstructionSyncPreview,
  GraphifyInstructionTarget,
} from './services/graphify-instruction-sync.service.js';

export type {
  DetectGraphifyRuntimeInput,
  GraphifyAvailableTools,
  GraphifyCommandResult,
  GraphifyCommandRunner,
  GraphifyDetectedCli,
  GraphifyDetectedTool,
  GraphifyInstallCommandPreview,
  GraphifyInstallPlan,
  GraphifyInstaller,
  GraphifyRuntimeStatus,
  PlanGraphifyInstallInput,
} from './services/graphify-runtime.service.js';

// Validation schemas (useful for MCP server)
export {
  MEMORY_CONTENT_MAX_CHARS,
  SaveMemoryInputSchema,
  FindMemoryQuerySchema,
  RecallQuerySchema,
  UpdateMemoryInputSchema,
  CreateTaskInputSchema,
  FindTaskQuerySchema,
  ResolveLoopInputSchema,
} from './rules/validation.js';

// Model routing
export {
  DEFAULT_MODEL_ROUTING,
  resolveModelRoute,
  mergeRoutingTable,
} from './rules/model-routing.js';

// Naming helpers
export { slugify } from './rules/naming.js';

// Config
export { DEFAULT_VAULT_ROOT } from './config/vault-root.js';

// Enrichment
export { detectDuplicates } from './services/enrichment.service.js';
export {
  OpenRouterClient,
  OpenAICompatibleClient,
  EnrichmentError,
  createProviderClient,
  normalizeProviderBaseUrl,
} from './services/openrouter-client.js';
export type {
  AiProviderId,
  AiProviderConfig,
  OpenAICompatibleClientOptions,
  ProviderModelSummary,
} from './services/openrouter-client.js';
export { TaskExecutor } from './services/task-executor.js';
export type {
  TaskExecutorEvent,
  TaskExecutorEventType,
  TaskExecutorOptions,
  TaskExecutorStatus,
} from './services/task-executor.js';
export type { StaleTaskRecoveryResult } from './services/task.service.js';
export { applyDutyTaskResult, parseDutySuggestion } from './services/duty-apply.service.js';
export type { DutyApplyResult } from './services/duty-apply.service.js';
export type {
  EnrichmentClient,
  CompletionParams,
  CompletionResult,
  ImageGenerationParams,
  GeneratedImage,
  ImageGenerationResult,
} from './services/openrouter-client.js';

// Portable crypto (shared secret access between desktop + MCP server)
export { portableEncrypt, portableDecrypt } from './utils/portable-crypto.js';
export type { PortableEncryptedValue } from './utils/portable-crypto.js';
