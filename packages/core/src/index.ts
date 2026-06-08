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
  SPARK_BRAIN_ARTIFACT_NAMES,
  SPARK_EXTENSION_ACTION_TYPES,
} from './types/spark-extension.js';

export type {
  SparkApprovalRiskLevel,
  SparkApprovalSummary,
  SparkApproveSuggestionAction,
  SparkApproveSkillAction,
  SparkBrainArtifactFreshness,
  SparkBrainArtifactFreshnessSummary,
  SparkBrainArtifactName,
  SparkBrainArtifactSummary,
  SparkCapabilityPackRow,
  SparkCapabilityPackStatusSummary,
  SparkConfigureProviderAction,
  SparkEvolutionSuggestionConfidenceLevel,
  SparkEvolutionSuggestionRow,
  SparkEvolutionSuggestionType,
  SparkExtensionAction,
  SparkExtensionActionResult,
  SparkExtensionActionResultReason,
  SparkExtensionActionType,
  SparkExtensionCounts,
  SparkExtensionInstallState,
  SparkExtensionSnapshot,
  SparkExtensionSource,
  SparkExtensionStatus,
  SparkInstallPackAction,
  SparkPendingApprovalRow,
  SparkProviderCredentialState,
  SparkProviderHealthSnapshot,
  SparkProviderHealthState,
  SparkProviderHealthSummary,
  SparkProviderMode,
  SparkProviderModeHealth,
  SparkRejectSuggestionAction,
  SparkSkillCatalogItem,
  SparkSkillHealthState,
  SparkSkillRow,
  SparkSkillSource,
  SparkSkillStatusSummary,
  SparkRejectSkillAction,
  SparkToggleExtensionAction,
  SparkToggleSkillAction,
  SparkUninstallPackAction,
  SparkViewArtifactAction,
} from './types/spark-extension.js';

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
  getDefaultSparkExtensionSnapshot,
  getSparkBrainExtensionPaths,
  planSparkBrainInstall,
  sanitizeSparkExtensionSnapshot,
  SPARK_BRAIN_EXTENSION_FOLDER,
  SPARK_BRAIN_PACKAGE_PATH,
  SPARK_BRAIN_REPOSITORY_URL,
  SparkExtensionSettingsService,
} from './services/spark-extension-settings.service.js';

export type {
  SparkBrainExtensionPaths,
  SparkBrainInstallPlan,
  SparkExtensionSettingsAdapter,
  SparkExtensionSettingsServiceOptions,
} from './services/spark-extension-settings.service.js';

export { createVaultBrainStore } from './services/spark-brain-vault-store.js';

export type {
  SparkBrainHostFindQuery,
  SparkBrainHostMemoryItem,
  SparkBrainHostSaveInput,
  VaultBrainStoreHost,
  VaultBrainStoreOptions,
} from './services/spark-brain-vault-store.js';

export {
  SPARK_PROVIDER_ROLES,
} from './types/spark-provider.js';

export type {
  SparkActiveProviderForRole,
  SparkProviderAuthStyle,
  SparkProviderCatalogEntry,
  SparkProviderCredentialStateView,
  SparkProviderRole,
  SparkRoleAssignments,
} from './types/spark-provider.js';

export {
  SPARK_DEFAULT_PROVIDER_ID,
  getDefaultRoleAssignments,
  getProvidersForRole,
  getSparkProviderById,
  getSparkProviderCatalog,
  isRoleSupportedByProvider,
} from './services/spark-provider-catalog.js';

export {
  buildSparkProviderHealthSummary,
  createSparkProviderCredentialStore,
} from './services/spark-provider-credentials.js';

export type {
  BuildSparkProviderHealthSummaryInput,
  SparkProviderCredentialStore,
  SparkProviderCredentialStoreDeps,
} from './services/spark-provider-credentials.js';

export { createSparkBrainSettingsAdapter } from './services/spark-brain-adapter.js';

export type {
  SparkBrainModuleLike,
  SparkBrainRuntimeLike,
  SparkBrainResultLike,
  SparkBrainInstalledSkillLike,
  SparkBrainSettingsAdapterOptions,
} from './services/spark-brain-adapter.js';

export type {
  BrainVaultStore,
  BrainVaultArtifact,
  BrainVaultProject,
  SparkBrainStoreRecord,
} from './types/spark-brain-host.js';

export {
  clampSparkAudioLevel,
  createEmptySparkSessionFrame,
} from './types/spark-session-frame.js';

export type {
  SparkCanvasItem,
  SparkSessionFrame,
  SparkToolCallEntry,
  SparkToolCallStatus,
  SparkTranscriptEntry,
  SparkTranscriptRole,
} from './types/spark-session-frame.js';

// ---------------------------------------------------------------------------
// Spark voice runtime (S3) — event model, frame reducer, scrubber, VAD,
// transport adapters, policy-routed tool dispatcher, and host orchestrator.
// ---------------------------------------------------------------------------

export type {
  SparkVoiceEvent,
  SparkVoiceSessionCallbacks,
  SparkVoiceStatus,
} from './types/spark-voice.js';

export {
  applySparkVoiceEvent,
  reduceSparkVoiceEvents,
} from './services/spark-voice/spark-voice-frame.js';

export {
  fenceSparkEvidence,
  scrubSparkOutput,
} from './services/spark-voice/spark-voice-scrubber.js';

export type { SparkScrubResult } from './services/spark-voice/spark-voice-scrubber.js';

export {
  computePcm16Level,
  computeRmsLevel,
  createSparkVad,
} from './services/spark-voice/spark-voice-vad.js';

export type {
  SparkVad,
  SparkVadOptions,
  SparkVadSample,
  SparkVadSignal,
} from './services/spark-voice/spark-voice-vad.js';

export {
  buildLlmRequest,
  buildRealtimeSessionRequest,
  buildSparkAuthHeaders,
  buildSttRequest,
  buildTtsRequest,
  ChatStreamAccumulator,
  createSparkLlmAdapter,
  createSparkSttAdapter,
  createSparkTtsAdapter,
  materializeRequestBody,
  OpenAiSseDecoder,
  parseSttResponse,
  SparkTransportError,
  ttsMimeType,
} from './services/spark-voice/spark-voice-transports.js';

export type {
  BuildLlmRequestInput,
  SparkChatCompletionResult,
  SparkChatMessage,
  SparkChatToolCall,
  SparkFetch,
  SparkFetchResponse,
  SparkHttpRequest,
  SparkLlmAdapter,
  SparkLlmResult,
  SparkLlmStreamHandlers,
  SparkRequestBody,
  SparkSttAdapter,
  SparkSttAudio,
  SparkSttResult,
  SparkToolDefinition,
  SparkTransportErrorReason,
  SparkTtsAdapter,
  SparkTtsResult,
} from './services/spark-voice/spark-voice-transports.js';

export {
  buildSparkHostTools,
  buildVoiceToolsFromSkillRows,
  createSparkToolDispatcher,
  sanitizeToolName,
} from './services/spark-voice/spark-voice-tools.js';

export type {
  SparkCanvasToolItem,
  SparkHostToolDeps,
  SparkSkillExecutor,
  SparkToolActionResult,
  SparkToolDispatcher,
  SparkToolDispatchContext,
  SparkToolExecutionPolicy,
  SparkToolHandler,
  SparkToolParallelism,
  SparkToolRisk,
  SparkVoiceTool,
} from './services/spark-voice/spark-voice-tools.js';

export {
  formatSparkRecall,
  pickDominantProject,
} from './services/spark-voice/spark-recall-format.js';

export type {
  SparkRecallGraphView,
  SparkRecallItemView,
  SparkRecallPackView,
} from './services/spark-voice/spark-recall-format.js';

export {
  createSparkVoiceSession,
} from './services/spark-voice/spark-voice-session.js';

export type {
  SparkAudioOutput,
  SparkVoiceSession,
  SparkVoiceSessionDeps,
} from './services/spark-voice/spark-voice-session.js';

export {
  buildSparkVoiceReadiness,
  createSparkVoiceRuntimeSession,
  createSparkRealtimeRuntimeSession,
  isSparkRealtimeConfigured,
} from './services/spark-voice/spark-voice-runtime.js';

export type {
  SparkVoiceCredentialSource,
  SparkVoiceReadiness,
  SparkVoiceMode,
  SparkVoiceRoleReadiness,
  SparkVoiceRuntimeOptions,
  SparkRealtimeRuntimeOptions,
} from './services/spark-voice/spark-voice-runtime.js';

export {
  createSparkRealtimeSetupMessage,
  createSparkRealtimeAudioInputMessage,
  createSparkRealtimeAudioStreamEndMessage,
  createSparkRealtimeToolResponseMessage,
  summarizeSparkRealtimeServerMessage,
} from './services/spark-voice/spark-realtime-messages.js';

export type {
  SparkRealtimeToolDefinition,
  SparkRealtimeToolCall,
  SparkRealtimeToolResponse,
  SparkRealtimeAudioChunk,
  SparkRealtimeServerSummary,
  SparkRealtimeSetupOptions,
} from './services/spark-voice/spark-realtime-messages.js';

export {
  createSparkRealtimeSession,
} from './services/spark-voice/spark-realtime-session.js';

export type {
  SparkRealtimeSession,
  SparkRealtimeSessionDeps,
  SparkRealtimeSocket,
  SparkRealtimeToolResult,
} from './services/spark-voice/spark-realtime-session.js';

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
export { OpenRouterClient, EnrichmentError } from './services/openrouter-client.js';
export { TaskExecutor } from './services/task-executor.js';
export type {
  TaskExecutorEvent,
  TaskExecutorEventType,
  TaskExecutorOptions,
  TaskExecutorStatus,
} from './services/task-executor.js';
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
