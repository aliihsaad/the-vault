import type {
  GraphifyBuildMode,
  GraphifyFreshnessState,
  GraphifyInstallProfile,
  GraphifyRuntimeMode,
} from '../rules/graphify.js';
import type {
  MemoryPack,
  RecallQuery,
} from './index.js';

export interface GraphifyArtifactPaths {
  graphJson: string | null;
  graphHtml: string | null;
  graphReport: string | null;
  graphSvg: string | null;
}

export interface GraphifyGraphStats {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
}

export interface GraphifyProjectState {
  project: string;
  enabled: boolean;
  sourceRoot: string | null;
  freshness: GraphifyFreshnessState;
  buildMode: GraphifyBuildMode;
  latestBuildId: string | null;
  artifactPaths: GraphifyArtifactPaths;
  graphPath: string | null;
  htmlPath: string | null;
  reportPath: string | null;
  svgPath: string | null;
  graphStats: GraphifyGraphStats | null;
  detectedGraphifyVersion: string | null;
  lastBuildStartedAt: string | null;
  lastBuildCompletedAt: string | null;
  failureCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GraphifyProjectUiState = 'sourceRootRequired' | 'disabled' | 'ready';

export type GraphifyBuildBlockedReason = 'sourceRootRequired' | 'disabled';

export interface GraphifySourceRootCandidate {
  source: 'project_workspace_registry';
  path: string;
  trusted: boolean;
  message: string;
}

export interface GraphifyProjectStatus {
  project: string;
  enabled: boolean;
  sourceRoot: string | null;
  sourceRootCandidate: GraphifySourceRootCandidate | null;
  freshness: GraphifyFreshnessState;
  buildMode: GraphifyBuildMode;
  buildEligible: boolean;
  buildBlockedReason: GraphifyBuildBlockedReason | null;
  uiState: GraphifyProjectUiState;
  message: string;
  state: GraphifyProjectState | null;
}

export interface UpsertGraphifyProjectStateInput {
  project: string;
  enabled: boolean;
  sourceRoot: string | null;
  freshness: GraphifyFreshnessState;
  buildMode: GraphifyBuildMode;
  latestBuildId?: string | null;
  artifactPaths?: Partial<GraphifyArtifactPaths> | null;
  graphStats?: GraphifyGraphStats | null;
  detectedGraphifyVersion?: string | null;
  lastBuildStartedAt?: string | null;
  lastBuildCompletedAt?: string | null;
  failureCount?: number;
  lastError?: string | null;
}

export interface GraphifyBuildRecord {
  buildId: string;
  project: string;
  status: GraphifyFreshnessState;
  buildMode: GraphifyBuildMode;
  startedAt: string | null;
  completedAt: string | null;
  artifactPaths: GraphifyArtifactPaths | null;
  graphStats: GraphifyGraphStats | null;
  detectedGraphifyVersion: string | null;
  logPath: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordGraphifyBuildInput {
  buildId: string;
  project: string;
  status: GraphifyFreshnessState;
  buildMode: GraphifyBuildMode;
  startedAt?: string | null;
  completedAt?: string | null;
  artifactPaths?: Partial<GraphifyArtifactPaths> | null;
  graphStats?: GraphifyGraphStats | null;
  detectedGraphifyVersion?: string | null;
  logPath?: string | null;
  errorMessage?: string | null;
}

export interface GraphifyDebounceConfig {
  autoBuildDelayMs: number;
  maxCoalesceDelayMs: number;
}

export interface GraphifySemanticConfig {
  enabled: boolean;
  provider: string | null;
  allowExternalProviders: boolean;
}

export interface GraphifySemanticModeStatus {
  enabled: boolean;
  provider: string | null;
  providerConfigured: boolean;
  allowExternalProviders: boolean;
  externalProvider: boolean;
  buildAllowed: boolean;
  warnings: string[];
  message: string;
}

export interface GraphifyRuntimeConfig {
  runtimeMode: GraphifyRuntimeMode;
  managedRuntimePath: string;
  customExecutablePath: string | null;
  localSourceCheckoutPath: string | null;
  installProfile: GraphifyInstallProfile;
  installExtras: string[];
  debounce: GraphifyDebounceConfig;
  semantic: GraphifySemanticConfig;
}

export interface SaveGraphifyRuntimeConfigInput {
  runtimeMode?: GraphifyRuntimeMode;
  managedRuntimePath?: string;
  customExecutablePath?: string | null;
  localSourceCheckoutPath?: string | null;
  installProfile?: GraphifyInstallProfile;
  installExtras?: string[];
  debounce?: Partial<GraphifyDebounceConfig>;
  semantic?: Partial<GraphifySemanticConfig>;
}

export interface GraphifyMemoryExportOpenLoopState {
  isOpen: boolean;
  nextSteps: string[];
  snoozedUntil: string | null;
}

export interface GraphifyMemoryExportEntry {
  uid: string;
  title: string;
  project: string;
  memoryType: string;
  subject: string;
  summary: string;
  tags: string[];
  keywords: string[];
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  relatedFiles: string[];
  relatedItemIds: string[];
  openLoop: GraphifyMemoryExportOpenLoopState;
  contentExcerpt: string | null;
}

export interface ExportGraphifyCorpusInput {
  project: string;
  buildMode?: GraphifyBuildMode;
  includeMemories?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  contentExcerptMaxChars?: number;
}

export interface GraphifySourceManifest {
  schemaVersion: 1;
  project: string;
  projectSlug: string;
  sourceRoot: string;
  buildMode: GraphifyBuildMode;
  runtimeMode: GraphifyRuntimeMode;
  graphifyVersion: string | null;
  includePatterns: string[];
  excludePatterns: string[];
  source: {
    root: string;
    fileCount: number;
    hash: string;
  };
  memoryExport: {
    included: boolean;
    rootPath: string;
    ndjsonPath: string;
    itemCount: number;
    hash: string;
  };
  latestArtifacts: GraphifyArtifactPaths;
  managedArtifactPaths: GraphifyArtifactPaths;
  inputHashes: {
    source: string;
    memoryExport: string;
    corpus: string;
  };
}

export interface GraphifyCorpusExportResult {
  project: string;
  projectSlug: string;
  sourceRoot: string;
  corpusRoot: string;
  manifestPath: string;
  memoryExportRoot: string;
  memoryExportNdjsonPath: string;
  memoryFiles: Record<string, string>;
  memoryCount: number;
  sourceHash: string;
  memoryExportHash: string;
  inputHash: string;
  manifestHash: string;
}

export interface GraphifyArtifactDiscoveryResult {
  available: boolean;
  artifactRoot: string;
  artifactPaths: GraphifyArtifactPaths;
  graphStats: GraphifyGraphStats | null;
  missingRequired: string[];
  errorMessage: string | null;
}

export type GraphifyArtifactReadStatus = 'available' | 'missing' | 'tooLarge' | 'invalid';

export interface GraphifyArtifactReadAvailable<T> {
  status: 'available';
  path: string;
  bytes: number;
  maxBytes: number;
  data: T;
}

export interface GraphifyArtifactTextReadAvailable {
  status: 'available';
  path: string;
  bytes: number;
  maxBytes: number;
  text: string;
}

export interface GraphifyArtifactReadFallback {
  status: Exclude<GraphifyArtifactReadStatus, 'available'>;
  path: string;
  bytes: number | null;
  maxBytes: number;
  message: string;
}

export type GraphifyArtifactJsonReadResult =
  | GraphifyArtifactReadAvailable<unknown>
  | GraphifyArtifactReadFallback;

export type GraphifyArtifactReportReadResult =
  | GraphifyArtifactTextReadAvailable
  | GraphifyArtifactReadFallback;

export interface GraphifyHtmlArtifactAvailable {
  status: 'available';
  path: string;
}

export interface GraphifyHtmlArtifactMissing {
  status: 'missing';
  path: string;
  fallback: {
    graphJson: string | null;
    graphReport: string | null;
  };
  message: string;
}

export type GraphifyHtmlArtifactResult =
  | GraphifyHtmlArtifactAvailable
  | GraphifyHtmlArtifactMissing;

export type GraphifyGraphContextStatus =
  | 'available'
  | 'disabled'
  | 'sourceRootRequired'
  | 'missing'
  | 'failed'
  | 'tooLarge'
  | 'invalid'
  | 'nodeNotFound'
  | 'pathNotFound';

export type GraphifyGraphFallbackReason = Exclude<GraphifyGraphContextStatus, 'available'>;

export interface GraphifyGraphNodeContext {
  id: string;
  label: string;
  type: string | null;
  path: string | null;
  summary: string | null;
  data: Record<string, unknown>;
}

export interface GraphifyGraphEdgeContext {
  id: string;
  source: string;
  target: string;
  label: string | null;
  type: string | null;
  data: Record<string, unknown>;
}

export interface GraphifyGraphContextBase {
  status: GraphifyGraphContextStatus;
  project: string;
  freshness: GraphifyFreshnessState;
  fallbackReason: GraphifyGraphFallbackReason | null;
  warnings: string[];
}

export interface GraphifyGraphQueryInput {
  query: string;
  maxNodes?: number;
  maxEdges?: number;
  maxBytes?: number;
}

export interface GraphifyGraphQueryResult extends GraphifyGraphContextBase {
  answer: string | null;
  nodes: GraphifyGraphNodeContext[];
  edges: GraphifyGraphEdgeContext[];
  suggestedFileReads: string[];
  truncated: boolean;
}

export interface GraphifyGraphNodeInput {
  node: string;
  maxNeighbors?: number;
  maxBytes?: number;
}

export interface GraphifyGraphNodeResult extends GraphifyGraphContextBase {
  node: GraphifyGraphNodeContext | null;
  neighbors: GraphifyGraphNodeContext[];
  edges: GraphifyGraphEdgeContext[];
}

export interface GraphifyGraphNeighborsInput {
  nodeId: string;
  depth?: number;
  maxNodes?: number;
  maxEdges?: number;
  maxBytes?: number;
}

export interface GraphifyGraphNeighborsResult extends GraphifyGraphContextBase {
  root: GraphifyGraphNodeContext | null;
  nodes: GraphifyGraphNodeContext[];
  edges: GraphifyGraphEdgeContext[];
  truncated: boolean;
}

export interface GraphifyGraphShortestPathInput {
  from: string;
  to: string;
  maxDepth?: number;
  maxBytes?: number;
}

export interface GraphifyGraphShortestPathResult extends GraphifyGraphContextBase {
  found: boolean;
  path: GraphifyGraphNodeContext[];
  edges: GraphifyGraphEdgeContext[];
}

export interface GraphifyImpactFileContext {
  path: string;
  nodeId: string;
  label: string;
  reason: string;
}

export interface GraphifyGraphImpactInput {
  query: string;
  maxFiles?: number;
  maxNodes?: number;
  maxBytes?: number;
  maxReportBytes?: number;
}

export interface GraphifyGraphImpactResult extends GraphifyGraphContextBase {
  likelyFiles: GraphifyImpactFileContext[];
  tests: GraphifyImpactFileContext[];
  centralNodes: GraphifyGraphNodeContext[];
  relatedNodes: GraphifyGraphNodeContext[];
  reportSnippets: GraphifyReportSnippet[];
  caveats: string[];
  truncated: boolean;
}

export interface GraphifyRecallContextInput extends RecallQuery {
  project: string;
  maxTokens?: number;
  maxFiles?: number;
  maxGraphNodes?: number;
  maxGraphEdges?: number;
  maxReportBytes?: number;
  maxGraphBytes?: number;
  broadSearchFileBaseline?: number;
}

export interface GraphifyReportSnippet {
  source: 'GRAPH_REPORT.md';
  heading: string | null;
  text: string;
  truncated: boolean;
}

export type GraphifyScheduledFullRebuildReason =
  | 'disabled'
  | 'sourceRootRequired'
  | 'alreadyQueued'
  | 'alreadyBuilding'
  | 'missing'
  | 'due'
  | 'notDue';

export interface PlanGraphifyScheduledFullRebuildInput {
  now?: string;
  intervalHours?: number;
}

export interface GraphifyScheduledFullRebuildPlan {
  shouldQueue: boolean;
  project: string;
  buildMode: 'full' | null;
  reason: GraphifyScheduledFullRebuildReason;
  nextEligibleAt: string | null;
  warnings: string[];
}

export interface GraphifyShortestPathContext {
  from: string;
  to: string;
  found: boolean;
  path: GraphifyGraphNodeContext[];
  edges: GraphifyGraphEdgeContext[];
  warnings: string[];
}

export interface GraphifyRecallGraphContext {
  used: boolean;
  status: GraphifyGraphContextStatus;
  project: string;
  freshness: GraphifyFreshnessState;
  fallbackReason: GraphifyGraphFallbackReason | null;
  warnings: string[];
  freshnessWarnings: string[];
  query: GraphifyGraphQueryResult | null;
  impact: GraphifyGraphImpactResult | null;
  likelyRelevantFiles: GraphifyImpactFileContext[];
  tests: GraphifyImpactFileContext[];
  centralNodes: GraphifyGraphNodeContext[];
  communities: GraphifyGraphNodeContext[];
  shortestPaths: GraphifyShortestPathContext[];
  reportSnippets: GraphifyReportSnippet[];
  suggestedNextFileReads: string[];
}

export interface GraphifyRecallBudget {
  maxTokens: number;
  estimatedTokens: number;
  truncated: boolean;
  maxFiles: number;
  maxGraphNodes: number;
  maxGraphEdges: number;
  maxReportBytes: number;
}

export interface GraphifyRecallTelemetry {
  version: 1;
  graphUsed: boolean;
  graphQueriesPerRecall: number;
  graphFreshness: GraphifyFreshnessState;
  graphFallbackReason: GraphifyGraphFallbackReason | null;
  broadSearchFileBaseline: number;
  graphCandidateFileCount: number;
  suggestedFileReadCount: number;
  filesAvoidedEstimate: number;
  contextPackTokenEstimate: number;
  estimatedBroadSearchTokens: number;
  estimatedTokensSaved: number;
  estimationMethod: 'graph-guided-file-baseline-v1';
}

export interface GraphifyRecallContextResult {
  recall: MemoryPack;
  graph: GraphifyRecallGraphContext;
  suggestedNextFileReads: string[];
  warnings: string[];
  budget: GraphifyRecallBudget;
  telemetry: GraphifyRecallTelemetry;
}

export type {
  GraphifyBuildMode,
  GraphifyFreshnessState,
  GraphifyInstallProfile,
  GraphifyRuntimeMode,
};
