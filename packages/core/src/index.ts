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
} from './rules/controlled-values.js';

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
} from './rules/controlled-values.js';

// Validation schemas (useful for MCP server)
export {
  SaveMemoryInputSchema,
  FindMemoryQuerySchema,
  RecallQuerySchema,
  UpdateMemoryInputSchema,
  CreateTaskInputSchema,
  FindTaskQuerySchema,
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
