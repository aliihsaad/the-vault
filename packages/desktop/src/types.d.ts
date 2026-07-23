/// <reference types="vite/client" />

import type {
  AddLoopEvidenceInput,
  ClassifyProjectInput,
  ConvertProjectTypeInput,
  CountDedicatedOpenLoopsInput,
  CountDedicatedOpenLoopsResult,
  CreateOpenLoopInput,
  CreateOpenLoopResult,
  CreateProjectInput,
  DecideLoopSnoozeInput,
  DedicatedOpenLoop,
  EvaluateProjectGateInput,
  GraphifyArtifactDiscoveryResult,
  GraphifyArtifactReportReadResult,
  GraphifyBuildMode,
  GraphifyBuildRecord,
  GraphifyHtmlArtifactResult,
  GraphifyInstallPlan,
  GraphifyProjectBuildResult,
  GraphifyProjectState,
  GraphifyProjectStatus,
  GraphifyRuntimeConfig,
  GraphifyRuntimeStatus,
  GraphifyUpdateCheck,
  LegacyLoopCandidateReport,
  ListDedicatedOpenLoopsInput,
  ListDedicatedOpenLoopsResult,
  OpenLoopMutationResult,
  OpenLoopShadowTelemetry,
  ProjectClassificationResult,
  ProjectGateResult,
  RecoverOpenLoopInput,
  RequestLoopSnoozeInput,
  RequestLoopSnoozeResult,
  ResolveOpenLoopInput,
  ResolveOpenLoopResult,
  SnoozeDecisionResult,
  SaveGraphifyRuntimeConfigInput,
  SaveVaultCollabRuntimeConfigInput,
  VaultCollabActionResult,
  VaultCollabAgentRequestInput,
  VaultCollabDashboardActionInput,
  VaultCollabDashboardOptions,
  VaultCollabDashboardSnapshot,
  VaultCollabEventTypeSnapshot,
  VaultCollabHandoffActionSet,
  VaultCollabInstallPlan,
  VaultCollabLaunchApprovalResult,
  VaultCollabLaunchCommand,
  VaultCollabPolicyPackActionInput,
  VaultCollabPolicyPackSnapshot,
  VaultCollabRuntimeConfig,
  VaultCollabRuntimeStatus,
} from '@the-vault/core';
import type {
  GraphifyArtifactUrlRequest,
  GraphifyArtifactUrlResponse,
} from './graphify-artifact-url.js';

declare global {
  interface GraphifyRuntimeUpdateResult {
    updated: boolean;
    previousVersion: string | null;
    installedVersion: string | null;
    latestVersion: string | null;
    commands: string[];
    logTail: string;
    logPath: string;
    rebuildsQueued: string[];
  }

  interface VaultResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    reasonCode?: string;
    details?: Record<string, unknown>;
  }

  type VaultMemoryType =
    | 'session'
    | 'summary'
    | 'decision'
    | 'plan'
    | 'artifact'
    | 'handoff'
    | 'reference';

  type VaultStatusValue = 'active' | 'resolved' | 'draft' | 'stale' | 'archived' | 'pending_delete' | 'promoted';
  type VaultPriorityValue = 'low' | 'normal' | 'high' | 'critical' | 'canonical';
  type VaultSourceApp = 'claude' | 'codex' | 'openclaw' | 'manual' | 'other';
  type VaultOpenLoopShadowTelemetry = OpenLoopShadowTelemetry;
  type VaultActionType =
    | 'save'
    | 'recall'
    | 'update'
    | 'archive'
    | 'enrich'
    | 'promote'
    | 'error'
    | 'delete'
    | 'task_create'
    | 'task_complete'
    | 'task_fail';
  type VaultTaskType = 'coding' | 'image' | 'analysis' | 'summarize' | 'organize' | 'research' | 'enrich' | 'general';
  type VaultTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  type VaultTaskPriority = 'low' | 'normal' | 'high' | 'urgent';

  interface ModelRouteConfig {
    taskType: VaultTaskType;
    modelId: string;
    fallbackModelId?: string;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
  }

  interface ModelRoutingTable {
    routes: ModelRouteConfig[];
    defaultModelId: string;
  }

  interface VaultProject {
    id: number;
    projectUid?: string | null;
    name: string;
    slug: string;
    projectType?: 'work_project' | 'brain_context' | 'unclassified';
    lifecycleState?: 'shadow' | 'active' | 'archived';
    description: string | null;
    createdAt: string;
    updatedAt: string;
    memoryCount?: number;
  }

  type VaultProjectMomentumDirection = 'up' | 'down' | 'flat' | 'inactive';

  interface VaultProjectMomentum {
    name: string;
    last7dCount: number;
    prior7dCount: number;
    delta: number;
    direction: VaultProjectMomentumDirection;
    lastActivityAt: string | null;
  }

  type VaultOpenLoopBucket = 'high' | 'medium' | 'low';
  type VaultRoutineType =
    | 'debugging'
    | 'planning'
    | 'implementation'
    | 'review'
    | 'testing'
    | 'brainstorming'
    | 'refactor'
    | 'deployment';

  interface VaultOpenLoop {
    itemUid: string;
    title: string;
    project: string;
    memoryType: VaultMemoryType;
    subject: string;
    summary: string;
    priority: VaultPriorityValue;
    routineType: VaultRoutineType | null;
    tags: string[];
    nextSteps: string[];
    lastUpdated: string;
    lastAccessedAt: string | null;
    daysOpen: number;
    score: number;
    bucket: VaultOpenLoopBucket;
    recentlyReferenced: boolean;
  }

  interface VaultMemory {
    id: number;
    itemUid: string;
    title: string;
    project: string;
    sourceApp: VaultSourceApp;
    sourceSessionId: string | null;
    memoryType: VaultMemoryType;
    subject: string;
    summary: string;
    content: string | null;
    keywords: string[];
    tags: string[];
    routineType: string | null;
    status: VaultStatusValue;
    priority: VaultPriorityValue;
    promoted: boolean;
    nextSteps: string[];
    relatedItemIds: string[];
    relatedFiles: string[];
    vaultPath: string | null;
    createdAt: string;
    updatedAt: string;
    lastAccessedAt: string | null;
    accessCount: number;
    snoozedUntil: string | null;
    outcome: VaultOutcomeValue | null;
  }

  type VaultOutcomeValue = 'fixed' | 'wont_fix' | 'obsolete' | 'duplicate';

  interface VaultResolveLoopInput {
    itemUid: string;
    outcome: VaultOutcomeValue;
    resolutionNote?: string;
  }

  interface VaultMemoryDetail extends VaultMemory {
    fileContent: string | null;
  }

  type VaultProposalType = 'description' | 'relationship' | 'merge';
  type VaultProposalStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';
  type VaultProjectLinkType = 'predecessor_of' | 'related_to' | 'merged_into' | 'fork_of';

  type VaultProposalPayload =
    | { type: 'description'; description: string }
    | {
        type: 'relationship';
        sourceProject: string;
        targetProject: string;
        linkType: VaultProjectLinkType;
        note?: string;
      }
    | {
        type: 'merge';
        sourceProject: string;
        targetProject: string;
        relocateFiles: boolean;
      };

  interface VaultProjectProposal {
    id: number;
    proposalUid: string;
    project: string;
    proposalType: VaultProposalType;
    payload: VaultProposalPayload;
    rationale: string | null;
    confidence: number | null;
    status: VaultProposalStatus;
    sourceTaskUid: string | null;
    evidenceItemUids: string[];
    createdBy: string;
    decidedBy: string | null;
    decidedAt: string | null;
    decisionNote: string | null;
    createdAt: string;
    updatedAt: string;
  }

  interface VaultDecideProposalResult {
    proposal: VaultProjectProposal;
    applied: boolean;
    error?: string;
  }

  type VaultProjectReviewSkipReason =
    | 'disabled'
    | 'cooldown'
    | 'project_not_found'
    | 'below_item_threshold';

  interface VaultProjectReviewResult {
    project: string;
    skipped: boolean;
    skipReason?: VaultProjectReviewSkipReason;
    proposalsCreated: VaultProjectProposal[];
    candidatesEvaluated: number;
    reviewedAt: string;
  }

  interface VaultRecallPack {
    summaries: VaultMemory[];
    decisions: VaultMemory[];
    plans: VaultMemory[];
    other: VaultMemory[];
    related: VaultMemory[];
    proactive: VaultMemory[];
    topMatches: VaultRecallMatch[];
    totalCandidates: number;
    topScore: number;
    contextSummary?: string;
    openLoops: VaultOpenLoop[];
  }

  interface VaultRecallMatch {
    item: VaultMemory;
    score: number;
    reasons: string[];
    signals: Record<string, number>;
  }

  interface VaultRecallMemoryContext {
    memoryContext: string;
    totalCandidates: number;
    topMatches: number;
    expandedDetails: number;
  }

  interface VaultLogEntry {
    id?: number;
    timestamp?: string;
    sourceClient: string;
    project?: string;
    actionType: VaultActionType;
    targetItemId?: string;
    status?: string;
    latencyMs?: number;
    aiUsed?: boolean;
    message?: string;
    metadata?: Record<string, unknown>;
  }

  interface VaultTask {
    id: number;
    taskUid: string;
    title: string;
    taskType: VaultTaskType;
    status: VaultTaskStatus;
    priority: VaultTaskPriority;
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

  interface VaultTaskQueueStats {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    byType: Record<string, number>;
  }

  interface VaultTaskExecutorStatus {
    running: boolean;
    pollIntervalMs: number;
    activeTaskUid: string | null;
    lastTickAt: string | null;
    lastCompletedAt: string | null;
    lastError: string | null;
    processedCount: number;
    failedCount: number;
    queue: VaultTaskQueueStats;
  }

  type VaultTaskEventType =
    | 'task-created'
    | 'task-started'
    | 'task-completed'
    | 'task-failed'
    | 'task-retried'
    | 'task-cancelled';

  interface VaultTaskEvent {
    type: VaultTaskEventType;
    taskUid: string;
    task: VaultTask | null;
    timestamp: string;
    message: string;
    metadata?: Record<string, unknown>;
  }

  interface VaultStatus {
    initialized: boolean;
    root: string;
    workspaceRoot?: string;
    projects: VaultProject[];
    appVersion?: string;
    directorySize?: {
      bytes: number;
      files: number;
      directories: number;
      displaySize: string;
    } | null;
  }

  type AiProviderId = 'openrouter' | 'llm-hub';

  interface VaultSettings {
    vault_root: string;
    ai_provider?: AiProviderId;
    ai_provider_primary?: AiProviderId;
    ai_provider_fallback?: AiProviderId | 'none';
    llm_hub_base_url?: string;
    enrichment_model: string;
    enrichment_model_llm_hub?: string;
    enrichment_enabled: boolean;
    recall_max_results: number;
    recall_compact_limit?: number;
    recall_top_match_limit?: number;
    recall_detail_expansion_limit?: number;
    recall_related_limit?: number;
    recall_proactive_limit?: number;
    auto_log: boolean;
    model_routing_table?: Partial<ModelRoutingTable> | null;
    project_workspace_registry?: Record<string, ProjectWorkspaceConfig>;
    [key: string]: unknown;
  }

  interface VaultApiAgentExecutionInput {
    prompt: string;
    memoryContext?: string;
  }

  interface ProjectWorkspaceConfig {
    project: string;
    workspacePath: string;
    trusted: boolean;
    gitRootDetected: boolean;
    lastValidatedAt: string;
    notes: string | null;
  }

  interface SetProjectWorkspaceInput {
    project: string;
    workspacePath: string;
    trusted?: boolean;
    notes?: string | null;
  }

  interface WorkspaceValidationResult {
    ok: boolean;
    workspacePath: string;
    exists: boolean;
    isDirectory: boolean;
    gitRootDetected: boolean;
    message: string;
  }

  interface ProjectContextPackInput {
    project: string;
    title?: string;
    prompt?: string;
    maxRecall?: number;
    maxLatest?: number;
    maxLogs?: number;
  }

  interface ProjectContextPackSection {
    kind: 'description' | 'recall' | 'latest' | 'activity';
    title: string;
    content: string;
  }

  interface ProjectContextPack {
    project: string;
    queryText: string;
    markdown: string;
    sections: ProjectContextPackSection[];
    generatedAt: string;
  }

  interface OpenRouterModelSummary {
    id: string;
    name: string;
    contextLength: number | null;
    promptPrice: string | null;
    completionPrice: string | null;
  }

  interface OpenRouterKeyTestResult {
    label: string;
    limitRemaining: number | null;
    usage: number | null;
    isFreeTier: boolean;
  }

  interface LlmHubConnectionTestResult {
    label: string;
    modelCount: number;
  }

  interface VaultApiAgentExecutionResult {
    provider: string;
    model: string;
    durationMs: number;
    output: string;
    usage: {
      promptTokens: number;
      completionTokens: number;
    };
  }

  interface VaultSaveResult {
    success: boolean;
    item: VaultMemory;
    vaultPath: string;
    message: string;
  }

  interface VaultMemoryComposerDraft {
    project: string;
    title: string;
    memoryType: VaultMemoryType;
    subject: string;
    summary: string;
    content: string;
    status: VaultStatusValue;
    priority: VaultPriorityValue;
    routineType: string;
    tagsText: string;
    keywordsText: string;
    nextStepsText: string;
    relatedItemIdsText: string;
    relatedFilesText: string;
  }

  interface VaultSimilarMemoryMatch {
    itemUid: string;
    title: string;
    project: string;
    memoryType: VaultMemoryType;
    subject: string;
    summary: string;
    similarity: number;
  }

  interface VaultSkillFile {
    path: string;
    filename: string;
    content: string;
  }

  interface VaultStructureNode {
    name: string;
    relativePath: string;
    nodeType: 'directory' | 'file';
    fileKind?: 'memory' | 'database' | 'log' | 'image' | 'other';
    size?: number | null;
    modifiedAt?: string | null;
    children?: VaultStructureNode[];
  }

  interface VaultStructureSnapshot {
    root: string;
    totalDirectories: number;
    totalFiles: number;
    memoryFiles: number;
    logFiles: number;
    nodes: VaultStructureNode[];
  }

  interface VaultFilePreview {
    root: string;
    relativePath: string;
    absolutePath: string;
    size: number;
    modifiedAt: string;
    content: string;
    truncated: boolean;
    mediaType: string | null;
    imageDataUrl: string | null;
    isBinary: boolean;
  }

  interface VaultCollabSourcePathDetection {
    detected: boolean;
    path: string | null;
    reason: string;
  }

  interface VaultCollabManagedTerminalStatus {
    sessionUid: string;
    launchRequestUid: string;
    workspacePath: string;
    startedAt: string;
    paused: boolean;
    lastOutputAt: string;
    lastAttentionEventId: number;
  }

  type ConnectStepStatus = 'pending' | 'running' | 'success' | 'fail' | 'skipped';

  interface ConnectStep {
    id: string;
    label: string;
    status: ConnectStepStatus;
    detail?: string;
  }

  interface ConnectResult {
    success: boolean;
    steps: ConnectStep[];
    backupPath?: string;
  }

  interface ConnectionStatus {
    claudeDesktop: { configured: boolean; configPath: string };
    claudeCode: { configured: boolean; configPath: string };
    codex: { configured: boolean; configPath: string };
    mcpRuntime: {
      mode: 'packaged' | 'development';
      command: string;
      args: string[];
      displayPath: string;
    };
    skill: {
      claudeInstalled: boolean;
      claudeMdPath: string;
      claudeSkillPath: string;
      codexInstalled: boolean;
      codexAgentsPath: string;
      collab: {
        claudeInstalled: boolean;
        claudeSkillPath: string;
        codexInstalled: boolean;
        codexAgentsPath: string;
      };
    };
    vaultCollab: {
      claudeDesktop: { configured: boolean; configPath: string };
      claudeCode: { configured: boolean; configPath: string };
      codex: { configured: boolean; configPath: string };
      mcpRuntime: {
        mode: 'packaged' | 'development';
        command: string;
        args: string[];
        displayPath: string;
      };
      command: {
        claudeInstalled: boolean;
        claudeCommandPath: string;
        codexSlashCommandSupported: boolean;
        codexLegacyCommandPresent: boolean;
        codexLegacyCommandPath: string;
      };
    };
  }

  interface VaultAPI {
    status: () => Promise<VaultStatus>;
    getProjectsMomentum: () => Promise<VaultResponse<VaultProjectMomentum[]>>;
    getOpenLoops: (project?: string) => Promise<VaultResponse<VaultOpenLoop[]>>;
    createProject: (input: CreateProjectInput) => Promise<VaultResponse<VaultProject>>;
    createOpenLoop: (input: CreateOpenLoopInput) => Promise<VaultResponse<CreateOpenLoopResult>>;
    getDedicatedOpenLoop: (loopUid: string) => Promise<VaultResponse<DedicatedOpenLoop | null>>;
    listDedicatedOpenLoops: (input?: ListDedicatedOpenLoopsInput) => Promise<VaultResponse<ListDedicatedOpenLoopsResult>>;
    countDedicatedOpenLoops: (input?: CountDedicatedOpenLoopsInput) => Promise<VaultResponse<CountDedicatedOpenLoopsResult>>;
    addLoopEvidence: (input: AddLoopEvidenceInput) => Promise<VaultResponse<OpenLoopMutationResult>>;
    evaluateProjectGate: (input: EvaluateProjectGateInput) => Promise<VaultResponse<ProjectGateResult>>;
    requestLoopSnooze: (input: RequestLoopSnoozeInput) => Promise<VaultResponse<RequestLoopSnoozeResult>>;
    decideLoopSnooze: (input: DecideLoopSnoozeInput) => Promise<VaultResponse<SnoozeDecisionResult>>;
    resolveOpenLoop: (input: ResolveOpenLoopInput) => Promise<VaultResponse<ResolveOpenLoopResult>>;
    recoverOpenLoop: (input: RecoverOpenLoopInput) => Promise<VaultResponse<OpenLoopMutationResult>>;
    classifyProject: (input: ClassifyProjectInput) => Promise<VaultResponse<ProjectClassificationResult>>;
    convertProjectType: (input: ConvertProjectTypeInput) => Promise<VaultResponse<ProjectClassificationResult>>;
    inventoryLegacyLoopCandidates: (project?: string) => Promise<VaultResponse<LegacyLoopCandidateReport>>;
    getOpenLoopShadowTelemetry: (project?: string) => Promise<VaultResponse<OpenLoopShadowTelemetry>>;
    saveMemory: (input: any) => Promise<VaultResponse<VaultSaveResult>>;
    findMemory: (query: any) => Promise<VaultResponse<VaultMemory[]>>;
    recallContext: (query: any) => Promise<VaultResponse<VaultRecallPack>>;
    buildRecallMemoryContext: (input: {
      queryText: string;
      limit?: number;
      topMatchLimit?: number;
      detailExpansionLimit?: number;
      relatedLimit?: number;
      proactiveLimit?: number;
    }) => Promise<VaultResponse<VaultRecallMemoryContext>>;
    listProjectWorkspaces: () => Promise<VaultResponse<ProjectWorkspaceConfig[]>>;
    getProjectWorkspace: (project: string) => Promise<VaultResponse<ProjectWorkspaceConfig | null>>;
    setProjectWorkspace: (input: SetProjectWorkspaceInput) => Promise<VaultResponse<ProjectWorkspaceConfig>>;
    removeProjectWorkspace: (project: string) => Promise<VaultResponse<ProjectWorkspaceConfig[]>>;
    validateWorkspacePath: (workspacePath: string) => Promise<VaultResponse<WorkspaceValidationResult>>;
    buildProjectContextPack: (input: ProjectContextPackInput) => Promise<VaultResponse<ProjectContextPack>>;
    getLatest: (project?: string, limit?: number) => Promise<VaultResponse<VaultMemory[]>>;
    getMemoryDetail: (uid: string) => Promise<VaultResponse<VaultMemoryDetail | null>>;
    suggestSavePath: (project: string, memoryType: VaultMemoryType, title: string) => Promise<VaultResponse<string>>;
    detectSimilarMemories: (input: {
      project?: string;
      title?: string;
      subject?: string;
      summary?: string;
      limit?: number;
    }) => Promise<VaultResponse<VaultSimilarMemoryMatch[]>>;
    updateMemory: (uid: string, updates: Partial<VaultMemory>) => Promise<VaultResponse<VaultMemory | null>>;
    promoteMemory: (uid: string) => Promise<VaultResponse<VaultMemory | null>>;
    archiveMemory: (uid: string) => Promise<VaultResponse<VaultMemory | null>>;
    resolveLoop: (input: VaultResolveLoopInput) => Promise<VaultResponse<VaultMemory | null>>;
    listProjectProposals: (query?: {
      project?: string;
      status?: VaultProposalStatus;
      proposalType?: VaultProposalType;
      limit?: number;
    }) => Promise<VaultResponse<VaultProjectProposal[]>>;
    executeProjectReview: (
      projectName: string,
      options?: { force?: boolean; dryRun?: boolean },
    ) => Promise<VaultResponse<VaultProjectReviewResult>>;
    decideProjectProposal: (input: {
      proposalUid: string;
      decision: 'accept' | 'reject';
      decidedBy?: string;
      decisionNote?: string;
    }) => Promise<VaultResponse<VaultDecideProposalResult>>;
    mergeProject: (
      sourceName: string,
      targetName: string,
      options?: { relocateFiles?: boolean; decidedBy?: string },
    ) => Promise<VaultResponse<unknown>>;
    addProjectRelationship: (input: {
      sourceProject: string;
      targetProject: string;
      linkType: string;
      note?: string;
      confidence?: number;
      createdBy?: string;
    }) => Promise<VaultResponse<unknown>>;
    confirmMemoryDelete: (uid: string) => Promise<VaultResponse<boolean>>;
    createTask: (input: {
      title: string;
      taskType: VaultTaskType;
      prompt: string;
      priority?: VaultTaskPriority;
      project?: string;
      context?: Record<string, unknown>;
      maxRetries?: number;
      parentTaskUid?: string;
      sourceMemoryUid?: string;
      targetMemoryUid?: string;
      createdBy?: string;
    }) => Promise<VaultResponse<VaultTask>>;
    findTasks: (query?: {
      status?: VaultTaskStatus;
      taskType?: VaultTaskType;
      priority?: VaultTaskPriority;
      project?: string;
      createdBy?: string;
      limit?: number;
      offset?: number;
    }) => Promise<VaultResponse<VaultTask[]>>;
    getTask: (taskUid: string) => Promise<VaultResponse<VaultTask | null>>;
    cancelTask: (taskUid: string) => Promise<VaultResponse<VaultTask | null>>;
    getTaskQueueStats: () => Promise<VaultResponse<VaultTaskQueueStats>>;
    getTaskExecutorStatus: () => Promise<VaultResponse<VaultTaskExecutorStatus>>;
    startTaskExecutor: () => Promise<VaultResponse<VaultTaskExecutorStatus>>;
    stopTaskExecutor: () => Promise<VaultResponse<VaultTaskExecutorStatus>>;
    getRecentLogs: (
      limit?: number,
      filters?: {
        actionType?: string;
        project?: string;
        sourceClient?: string;
        dateFrom?: string;
        dateTo?: string;
      },
    ) => Promise<VaultResponse<VaultLogEntry[]>>;
    getAllSettings: () => Promise<VaultResponse<VaultSettings>>;
    setSetting: (key: string, value: unknown) => Promise<VaultResponse<boolean>>;
    getSecretSetting: (key: string) => Promise<VaultResponse<string>>;
    setSecretSetting: (key: string, value: string) => Promise<VaultResponse<boolean>>;
    getModelRoutingTable: (provider?: AiProviderId) => Promise<VaultResponse<ModelRoutingTable>>;
    setModelRoutingTable: (overrides: Partial<ModelRoutingTable>, provider?: AiProviderId) => Promise<VaultResponse<ModelRoutingTable>>;
    getOpenRouterModels: (apiKey: string) => Promise<VaultResponse<OpenRouterModelSummary[]>>;
    testOpenRouterApiKey: (apiKey: string) => Promise<VaultResponse<OpenRouterKeyTestResult>>;
    getLlmHubModels: (baseUrl: string, apiKey: string) => Promise<VaultResponse<OpenRouterModelSummary[]>>;
    testLlmHubConnection: (baseUrl: string, apiKey: string) => Promise<VaultResponse<LlmHubConnectionTestResult>>;
    executeVaultApiAgent: (input: VaultApiAgentExecutionInput) => Promise<VaultResponse<VaultApiAgentExecutionResult>>;
    getGraphifyRuntimeConfig: () => Promise<VaultResponse<GraphifyRuntimeConfig>>;
    saveGraphifyRuntimeConfig: (input: SaveGraphifyRuntimeConfigInput) => Promise<VaultResponse<GraphifyRuntimeConfig>>;
    detectGraphifyRuntime: () => Promise<VaultResponse<GraphifyRuntimeStatus>>;
    planGraphifyInstall: (input: {
      runtimeMode: GraphifyRuntimeConfig['runtimeMode'];
      availableTools: {
        python: boolean;
        uv: boolean;
        pipx: boolean;
      };
      extras?: string[];
      localSourcePath?: string | null;
    }) => Promise<VaultResponse<GraphifyInstallPlan>>;
    checkGraphifyUpdate: () => Promise<VaultResponse<GraphifyUpdateCheck>>;
    updateGraphifyRuntime: () => Promise<VaultResponse<GraphifyRuntimeUpdateResult>>;
    getGraphifyProjectStatus: (project: string) => Promise<VaultResponse<GraphifyProjectStatus>>;
    setGraphifyProjectSourceRoot: (project: string, sourceRoot: string) => Promise<VaultResponse<GraphifyProjectState>>;
    chooseGraphifyProjectSourceRoot: (project: string) => Promise<VaultResponse<GraphifyProjectState | null>>;
    setGraphifyProjectEnabled: (project: string, enabled: boolean) => Promise<VaultResponse<GraphifyProjectState>>;
    getGraphifyBuildHistory: (project: string, limit?: number) => Promise<VaultResponse<GraphifyBuildRecord[]>>;
    getGraphifyArtifacts: (project: string) => Promise<VaultResponse<GraphifyArtifactDiscoveryResult>>;
    getGraphifyHtmlArtifact: (project: string) => Promise<VaultResponse<GraphifyHtmlArtifactResult>>;
    readGraphifyArtifactReport: (project: string, options?: { maxBytes?: number }) => Promise<VaultResponse<GraphifyArtifactReportReadResult>>;
    getGraphifyArtifactUrl: (input: GraphifyArtifactUrlRequest) => Promise<VaultResponse<GraphifyArtifactUrlResponse>>;
    buildGraphifyProjectGraph: (input: { project: string; buildMode?: GraphifyBuildMode }) => Promise<VaultResponse<GraphifyProjectBuildResult>>;
    openGraphifyArtifactFolder: (project: string) => Promise<VaultResponse<string>>;
    exportGraphifyArtifacts: (project: string) => Promise<VaultResponse<{ targetRoot: string; copied: string[] } | null>>;
    getVaultCollabRuntimeConfig: () => Promise<VaultResponse<VaultCollabRuntimeConfig>>;
    saveVaultCollabRuntimeConfig: (input: SaveVaultCollabRuntimeConfigInput) => Promise<VaultResponse<VaultCollabRuntimeConfig>>;
    resetVaultCollabRuntimeConfig: () => Promise<VaultResponse<VaultCollabRuntimeConfig>>;
    detectVaultCollabRuntime: () => Promise<VaultResponse<VaultCollabRuntimeStatus>>;
    planVaultCollabInstall: () => Promise<VaultResponse<VaultCollabInstallPlan>>;
    getVaultCollabDashboardSnapshot: (options?: VaultCollabDashboardOptions) => Promise<VaultResponse<VaultCollabDashboardSnapshot>>;
    getVaultCollabHandoffActions: (handoffUid: string) => Promise<VaultResponse<VaultCollabHandoffActionSet | null>>;
    performVaultCollabDashboardAction: (input: VaultCollabDashboardActionInput) => Promise<VaultResponse<VaultCollabActionResult>>;
    requestVaultCollabAgent: (input: VaultCollabAgentRequestInput) => Promise<VaultResponse<VaultCollabActionResult>>;
    listVaultCollabEventTypes: () => Promise<VaultResponse<VaultCollabEventTypeSnapshot[]>>;
    activateVaultCollabPolicyPack: (input: VaultCollabPolicyPackActionInput) => Promise<VaultResponse<VaultCollabPolicyPackSnapshot>>;
    deactivateVaultCollabPolicyPack: (input: VaultCollabPolicyPackActionInput) => Promise<VaultResponse<VaultCollabPolicyPackSnapshot>>;
    approveVaultCollabLaunchRequest: (launchRequestUid: string) => Promise<VaultResponse<VaultCollabLaunchApprovalResult>>;
    startVaultCollabLaunchRequest: (launchRequestUid: string) => Promise<VaultResponse<{
      launchRequestUid: string;
      launchedSessionUid: string | null;
      command: string;
      args: string[];
      display: string;
      launchCommand: VaultCollabLaunchCommand;
      externalTerminalLaunched: boolean;
      externalTerminalScriptPath: string | null;
      externalTerminalShellPath: string | null;
      statusDetail: string;
    }>>;
    getVaultCollabManagedTerminals: () => Promise<VaultResponse<VaultCollabManagedTerminalStatus[]>>;
    controlVaultCollabManagedTerminal: (input: {
      sessionUid: string;
      action: 'pause' | 'resume' | 'stop';
    }) => Promise<VaultResponse<VaultCollabManagedTerminalStatus | null>>;
    detectVaultCollabSourcePath: () => Promise<VaultResponse<VaultCollabSourcePathDetection>>;
    useDetectedVaultCollabSourcePath: () => Promise<VaultResponse<VaultCollabRuntimeConfig>>;
    chooseVaultCollabSourcePath: () => Promise<VaultResponse<VaultCollabRuntimeConfig | null>>;
    readSkillFile: (relativePath: string) => Promise<VaultResponse<VaultSkillFile>>;
    getVaultStructure: () => Promise<VaultResponse<VaultStructureSnapshot>>;
    readVaultFilePreview: (relativePath: string) => Promise<VaultResponse<VaultFilePreview>>;
    checkConnectionStatus: () => Promise<VaultResponse<ConnectionStatus>>;
    connectClaudeDesktop: () => Promise<VaultResponse<ConnectResult>>;
    connectClaudeCode: () => Promise<VaultResponse<ConnectResult>>;
    connectCodex: () => Promise<VaultResponse<ConnectResult>>;
    connectVaultCollabClients: () => Promise<VaultResponse<ConnectResult>>;
    installSkillFile: (target: string) => Promise<VaultResponse<ConnectResult>>;
    refreshEnrichment: () => Promise<VaultResponse<{ enrichmentActive: boolean }>>;
    disconnectClaudeDesktop: () => Promise<VaultResponse<ConnectResult>>;
    disconnectClaudeCode: () => Promise<VaultResponse<ConnectResult>>;
    disconnectCodex: () => Promise<VaultResponse<ConnectResult>>;
    disconnectVaultCollabClients: () => Promise<VaultResponse<ConnectResult>>;
    uninstallSkillFile: (target: string) => Promise<VaultResponse<ConnectResult>>;
    onTaskEvent: (callback: (event: VaultTaskEvent) => void) => () => void;
  }

  interface Window {
    vaultAPI: VaultAPI;
  }
}

export {};
