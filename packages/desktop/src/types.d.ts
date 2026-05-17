/// <reference types="vite/client" />

declare global {
  interface VaultResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
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
    name: string;
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
  }

  interface VaultSettings {
    vault_root: string;
    enrichment_model: string;
    enrichment_enabled: boolean;
    vault_agent_backend?: VaultAgentBackend;
    recall_max_results: number;
    recall_compact_limit?: number;
    recall_top_match_limit?: number;
    recall_detail_expansion_limit?: number;
    recall_related_limit?: number;
    recall_proactive_limit?: number;
    auto_log: boolean;
    model_routing_table?: Partial<ModelRoutingTable> | null;
    local_adapter_config?: LocalAdapterConfig;
    local_adapter_last_test?: LocalAdapterTestResult | null;
    local_adapter_runtime_state?: LocalAdapterRuntimeState;
    local_adapter_task_sessions?: LocalAdapterTaskSessions;
    local_adapter_active_task_key?: string;
    project_workspace_registry?: Record<string, ProjectWorkspaceConfig>;
    local_workbench_recent_runs?: LocalWorkbenchRecentRun[];
    [key: string]: unknown;
  }

  type VaultAgentBackend = 'api' | 'local';

  type LocalAdapterType = 'claude_local' | 'codex_local';

  interface LocalAdapterConfig {
    enabled: boolean;
    type: LocalAdapterType | '';
    cwd: string;
    command: string;
    model: string;
    effort: string;
    chrome: boolean;
    maxTurns: number | null;
    env?: Record<string, string>;
  }

  interface LocalAdapterDefinitionSummary {
    type: LocalAdapterType;
    label: string;
    description: string;
    defaultCommand: string;
  }

  interface LocalAdapterModelSummary {
    id: string;
    name: string;
    source: 'builtin' | 'fetched';
  }

  interface LocalAdapterCheck {
    code: string;
    status: 'pass' | 'warn' | 'fail';
    level: 'info' | 'warn' | 'error';
    message: string;
    detail?: string;
    hint?: string;
  }

  interface LocalAdapterTestResult {
    adapterType: LocalAdapterType;
    recognized: boolean;
    canProceed: boolean;
    authMode: string | null;
    command: string;
    resolvedCommand: string | null;
    cwd: string;
    manualCommand: string;
    checks: LocalAdapterCheck[];
    models: LocalAdapterModelSummary[];
    configFingerprint: string;
    testedAt: string;
    probe: {
      skipped: boolean;
      exitCode: number | null;
      timedOut: boolean;
      summary: string;
      stdout: string;
      stderr: string;
    };
  }

  interface LocalAdapterExecutionInput {
    prompt: string;
    memoryContext?: string;
    taskKey?: string;
  }

  interface LocalAdapterExecutionResult {
    adapterType: LocalAdapterType;
    command: string;
    resolvedCommand: string;
    cwd: string;
    model: string | null;
    effort: string | null;
    durationMs: number;
    exitCode: number | null;
    output: string;
    stdout: string;
    stderr: string;
    sessionId: string | null;
    sessionParams: Record<string, unknown> | null;
    sessionDisplayId: string | null;
    metadata: {
      provider: string;
      biller: string;
      reusedSession: boolean;
      rotatedSession: boolean;
      resumeAttempted: boolean;
      resumeFailed: boolean;
      promptBundleVersion: string | null;
      sessionScope: 'none' | 'adapter' | 'task';
      taskKey: string | null;
      tokenCounts: LocalAdapterTokenCounts | null;
      cost: null;
    };
  }

  interface LocalAdapterTokenCounts {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  }

  interface LocalAdapterRuntimeSession {
    adapterType: LocalAdapterType;
    sessionId: string;
    sessionParams: Record<string, unknown> | null;
    sessionDisplayId: string | null;
    cwd: string;
    model: string | null;
    promptBundleVersion: string | null;
    updatedAt: string;
  }

  type LocalAdapterRuntimeState = Partial<Record<LocalAdapterType, LocalAdapterRuntimeSession | null>>;
  type LocalAdapterTaskSessions = Partial<Record<LocalAdapterType, Record<string, LocalAdapterRuntimeSession>>>;

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

  interface PrepareLocalWorkbenchRunInput {
    project: string;
    title: string;
    prompt: string;
    adapterType: LocalAdapterType;
    model?: string;
    effort?: string;
  }

  interface PreparedLocalWorkbenchRun {
    runId: string;
    project: string;
    title: string;
    prompt: string;
    workspace: ProjectWorkspaceConfig;
    contextPack: ProjectContextPack;
    contextPackPath: string;
    launch: {
      adapterType: LocalAdapterType;
      command: string;
      args: string[];
      workspacePath: string;
      contextPackPath: string;
      displayCommand: string;
    };
    createdAt: string;
  }

  interface LocalWorkbenchRecentRun {
    runId: string;
    project: string;
    title: string;
    adapterType: LocalAdapterType;
    workspacePath: string;
    contextPackPath: string;
    createdAt: string;
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

  interface VaultApiAgentExecutionResult {
    provider: 'openrouter';
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
    };
  }

  interface VaultAPI {
    status: () => Promise<VaultStatus>;
    getProjectsMomentum: () => Promise<VaultResponse<VaultProjectMomentum[]>>;
    getOpenLoops: (project?: string) => Promise<VaultResponse<VaultOpenLoop[]>>;
    createProject: (name: string, description?: string) => Promise<VaultResponse<VaultProject>>;
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
    prepareLocalWorkbenchRun: (input: PrepareLocalWorkbenchRunInput) => Promise<VaultResponse<PreparedLocalWorkbenchRun>>;
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
    getModelRoutingTable: () => Promise<VaultResponse<ModelRoutingTable>>;
    setModelRoutingTable: (overrides: Partial<ModelRoutingTable>) => Promise<VaultResponse<ModelRoutingTable>>;
    getOpenRouterModels: (apiKey: string) => Promise<VaultResponse<OpenRouterModelSummary[]>>;
    testOpenRouterApiKey: (apiKey: string) => Promise<VaultResponse<OpenRouterKeyTestResult>>;
    executeVaultApiAgent: (input: LocalAdapterExecutionInput) => Promise<VaultResponse<VaultApiAgentExecutionResult>>;
    readSkillFile: (relativePath: string) => Promise<VaultResponse<VaultSkillFile>>;
    getVaultStructure: () => Promise<VaultResponse<VaultStructureSnapshot>>;
    readVaultFilePreview: (relativePath: string) => Promise<VaultResponse<VaultFilePreview>>;
    getSupportedLocalAdapters: () => Promise<VaultResponse<LocalAdapterDefinitionSummary[]>>;
    getLocalAdapterModels: (config: LocalAdapterConfig) => Promise<VaultResponse<LocalAdapterModelSummary[]>>;
    detectLocalAdapterModel: (config: LocalAdapterConfig) => Promise<VaultResponse<string | null>>;
    testLocalAdapterEnvironment: (config: LocalAdapterConfig) => Promise<VaultResponse<LocalAdapterTestResult>>;
    executeEnabledLocalAdapter: (input: LocalAdapterExecutionInput) => Promise<VaultResponse<LocalAdapterExecutionResult>>;
    clearLocalAdapterSession: (adapterType: LocalAdapterType) => Promise<VaultResponse<LocalAdapterRuntimeState>>;
    clearLocalAdapterTaskSession: (adapterType: LocalAdapterType, taskKey: string) => Promise<VaultResponse<LocalAdapterTaskSessions>>;
    checkConnectionStatus: () => Promise<VaultResponse<ConnectionStatus>>;
    connectClaudeDesktop: () => Promise<VaultResponse<ConnectResult>>;
    connectClaudeCode: () => Promise<VaultResponse<ConnectResult>>;
    connectCodex: () => Promise<VaultResponse<ConnectResult>>;
    installSkillFile: (target: string) => Promise<VaultResponse<ConnectResult>>;
    refreshEnrichment: () => Promise<VaultResponse<{ enrichmentActive: boolean }>>;
    disconnectClaudeDesktop: () => Promise<VaultResponse<ConnectResult>>;
    disconnectClaudeCode: () => Promise<VaultResponse<ConnectResult>>;
    disconnectCodex: () => Promise<VaultResponse<ConnectResult>>;
    uninstallSkillFile: (target: string) => Promise<VaultResponse<ConnectResult>>;
    onTaskEvent: (callback: (event: VaultTaskEvent) => void) => () => void;
  }

  interface Window {
    vaultAPI: VaultAPI;
  }
}

export {};
