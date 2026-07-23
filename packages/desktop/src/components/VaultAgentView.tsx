import { useEffect, useMemo, useState } from 'react';
import { Activity, Bot, Clock3, Play, RefreshCw, Save, SendHorizonal, Sparkles, Square, Workflow } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { getAiProviderDisplayName, resolveAiProviderSettings } from '@the-vault/core';
import { DayGroupedList } from './DayGroupedList.js';

const VAULT_AGENT_ROUTING_PRESETS: Array<{
  id: 'cost_saver' | 'balanced' | 'high_reasoning';
  label: string;
  description: string;
  table: ModelRoutingTable;
}> = [
  {
    id: 'cost_saver',
    label: 'Cost saver',
    description: 'Cheap defaults for most delegated work, with premium models kept to a minimum.',
    table: {
      defaultModelId: 'google/gemini-2.5-flash',
      routes: [
        { taskType: 'general', modelId: 'google/gemini-2.5-flash' },
        { taskType: 'coding', modelId: 'openai/gpt-5.4-mini' },
        { taskType: 'research', modelId: 'google/gemini-2.5-flash' },
        { taskType: 'analysis', modelId: 'google/gemini-2.5-flash', fallbackModelId: 'openai/o3' },
        { taskType: 'summarize', modelId: 'openai/gpt-4o-mini' },
        { taskType: 'organize', modelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'enrich', modelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'image', modelId: 'google/gemini-2.5-flash-image', fallbackModelId: 'openai/gpt-5-image' },
      ],
    },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Stronger models for important work while keeping lightweight tasks inexpensive.',
    table: {
      defaultModelId: 'anthropic/claude-sonnet-4',
      routes: [
        { taskType: 'general', modelId: 'anthropic/claude-sonnet-4' },
        { taskType: 'coding', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'openai/codex-mini' },
        { taskType: 'research', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'openai/o3' },
        { taskType: 'analysis', modelId: 'anthropic/claude-opus-4.1', fallbackModelId: 'openai/o3' },
        { taskType: 'summarize', modelId: 'anthropic/claude-haiku-3.5', fallbackModelId: 'openai/gpt-4o-mini' },
        { taskType: 'organize', modelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'enrich', modelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'image', modelId: 'google/gemini-2.5-flash-image', fallbackModelId: 'openai/gpt-5-image' },
      ],
    },
  },
  {
    id: 'high_reasoning',
    label: 'High reasoning',
    description: 'Premium reasoning-first posture for higher quality delegated work.',
    table: {
      defaultModelId: 'anthropic/claude-sonnet-4',
      routes: [
        { taskType: 'general', modelId: 'anthropic/claude-sonnet-4' },
        { taskType: 'coding', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'openai/gpt-5.4' },
        { taskType: 'research', modelId: 'anthropic/claude-opus-4.1', fallbackModelId: 'openai/o3' },
        { taskType: 'analysis', modelId: 'anthropic/claude-opus-4.1', fallbackModelId: 'openai/o3' },
        { taskType: 'summarize', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'organize', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'enrich', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'image', modelId: 'openai/gpt-5-image', fallbackModelId: 'google/gemini-2.5-flash-image' },
      ],
    },
  },
];

type AgentRuntimeTab = 'queue' | 'tasks' | 'runtime' | 'events';

const AGENT_RUNTIME_TABS: Array<{
  id: AgentRuntimeTab;
  label: string;
  meta: string;
}> = [
  { id: 'queue', label: 'Queue', meta: 'compose + run' },
  { id: 'tasks', label: 'Tasks', meta: 'inspect work' },
  { id: 'runtime', label: 'Runtime', meta: 'settings' },
  { id: 'events', label: 'Events', meta: 'executor feed' },
];

export function VaultAgentView() {
  const [taskProjects, setTaskProjects] = useState<string[]>([]);
  const [settings, setSettings] = useState<VaultSettings | null>(null);
  const [routingTable, setRoutingTable] = useState<ModelRoutingTable | null>(null);
  const [logs, setLogs] = useState<VaultLogEntry[]>([]);
  const [tasks, setTasks] = useState<VaultTask[]>([]);
  const [executorStatus, setExecutorStatus] = useState<VaultTaskExecutorStatus | null>(null);
  const [taskEvents, setTaskEvents] = useState<VaultTaskEvent[]>([]);
  const [selectedTaskMemory, setSelectedTaskMemory] = useState<VaultMemoryDetail | null>(null);
  const [selectedTaskUid, setSelectedTaskUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskLoading, setTaskLoading] = useState(true);
  const [taskMemoryLoading, setTaskMemoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [executorSaving, setExecutorSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskMemoryError, setTaskMemoryError] = useState<string | null>(null);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [enrichmentActive, setEnrichmentActive] = useState(false);
  const [draftEnrichmentEnabled, setDraftEnrichmentEnabled] = useState(false);
  const [draftRecallMax, setDraftRecallMax] = useState(10);
  const [draftAutoLog, setDraftAutoLog] = useState(true);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskType, setTaskType] = useState<VaultTaskType>('research');
  const [taskProject, setTaskProject] = useState('Vault');
  const [taskProjectMode, setTaskProjectMode] = useState<'existing' | 'new'>('existing');
  const [taskPriority, setTaskPriority] = useState<VaultTaskPriority>('normal');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [taskMaxRetries, setTaskMaxRetries] = useState(1);
  const [activeAgentTab, setActiveAgentTab] = useState<AgentRuntimeTab>('queue');

  useEffect(() => {
    void loadAgentData();
    void loadTaskData();

    const unsubscribe = window.vaultAPI.onTaskEvent((payload) => {
      const event = payload as VaultTaskEvent;
      setTaskEvents((current) => [event, ...current].slice(0, 12));
      setMessage(event.message);
      void loadTaskData(true);
    });

    return unsubscribe;
  }, []);

  async function loadAgentData() {
    setLoading(true);
    setError(null);

    try {
      const [
        statusResponse,
        settingsResponse,
        logsResponse,
        openRouterSecretResponse,
        llmHubSecretResponse,
        enrichmentResponse,
        openRouterRoutingResponse,
        llmHubRoutingResponse,
      ] = await Promise.all([
        window.vaultAPI.status(),
        window.vaultAPI.getAllSettings(),
        window.vaultAPI.getRecentLogs(40),
        window.vaultAPI.getSecretSetting('openrouter_api_key'),
        window.vaultAPI.getSecretSetting('llm_hub_api_key'),
        window.vaultAPI.refreshEnrichment(),
        window.vaultAPI.getModelRoutingTable('openrouter'),
        window.vaultAPI.getModelRoutingTable('llm-hub'),
      ]);

      if (!statusResponse.initialized) {
        throw new Error('Vault is not initialized.');
      }

      if (!settingsResponse.success || !settingsResponse.data) {
        throw new Error(settingsResponse.error || 'Failed to load agent settings');
      }

      if (!logsResponse.success) {
        throw new Error(logsResponse.error || 'Failed to load recent agent activity');
      }

      const nextSettings = settingsResponse.data;
      const providerSettings = resolveAiProviderSettings(nextSettings);
      const secretResponse = providerSettings.primaryProvider === 'llm-hub'
        ? llmHubSecretResponse
        : openRouterSecretResponse;
      const routingResponse = providerSettings.primaryProvider === 'llm-hub'
        ? llmHubRoutingResponse
        : openRouterRoutingResponse;

      if (!secretResponse.success) {
        throw new Error(secretResponse.error || 'Failed to inspect the primary provider API key state');
      }

      if (!routingResponse.success || !routingResponse.data) {
        throw new Error(routingResponse.error || 'Failed to inspect task model routing');
      }

      const nextLogs = logsResponse.data || [];
      const nextProjects = (statusResponse.projects || [])
        .map((project) => project.name)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));

      setSettings(nextSettings);
      setRoutingTable(routingResponse.data);
      setTaskProjects(nextProjects);
      setApiKeyConfigured(Boolean(secretResponse.data?.trim()));
      setEnrichmentActive(Boolean(enrichmentResponse.success && enrichmentResponse.data?.enrichmentActive));
      setDraftEnrichmentEnabled(Boolean(nextSettings.enrichment_enabled));
      setDraftRecallMax(Number(nextSettings.recall_max_results) || 10);
      setDraftAutoLog(Boolean(nextSettings.auto_log));
      setLogs(nextLogs);
      setTaskProjectMode(nextProjects.includes(taskProject) ? 'existing' : 'new');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the Vault agent view');
    } finally {
      setLoading(false);
    }
  }

  async function saveQuickControls() {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const updates: Array<[string, unknown]> = [
        ['enrichment_enabled', draftEnrichmentEnabled],
        ['auto_log', draftAutoLog],
        ['recall_max_results', Math.max(1, Number(draftRecallMax) || 10)],
      ];

      for (const [key, value] of updates) {
        const response = await window.vaultAPI.setSetting(key, value);
        if (!response.success) {
          throw new Error(response.error || `Failed to save ${key}`);
        }
      }

      const enrichmentResponse = await window.vaultAPI.refreshEnrichment();
      if (!enrichmentResponse.success) {
        throw new Error(enrichmentResponse.error || 'Failed to refresh the Vault AI runtime');
      }

      setMessage('Vault agent controls saved.');
      await loadAgentData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Vault agent controls');
    } finally {
      setSaving(false);
    }
  }

  async function loadTaskData(silent = false) {
    if (!silent) {
      setTaskLoading(true);
    }

    setTaskError(null);

    try {
      const [executorResponse, tasksResponse] = await Promise.all([
        window.vaultAPI.getTaskExecutorStatus(),
        window.vaultAPI.findTasks({ limit: 12 }),
      ]);

      if (!executorResponse.success || !executorResponse.data) {
        throw new Error(executorResponse.error || 'Failed to load the task executor status');
      }

      if (!tasksResponse.success) {
        throw new Error(tasksResponse.error || 'Failed to load the task queue');
      }

      const nextTasks = tasksResponse.data || [];
      setExecutorStatus(executorResponse.data);
      setTasks(nextTasks);

      if (nextTasks.length === 0) {
        setSelectedTaskUid(null);
      } else if (!selectedTaskUid || !nextTasks.some((task) => task.taskUid === selectedTaskUid)) {
        setSelectedTaskUid(nextTasks[0].taskUid);
      }
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : 'Failed to load task executor data');
    } finally {
      if (!silent) {
        setTaskLoading(false);
      }
    }
  }

  async function submitTask() {
    const normalizedTitle = taskTitle.trim();
    const normalizedPrompt = taskPrompt.trim();
    const normalizedProject = taskProject.trim();

    if (!normalizedTitle || !normalizedPrompt) {
      setTaskError('Task title and prompt are required.');
      return;
    }

    if (!normalizedProject) {
      setTaskError('Choose an existing project or enter a new project name.');
      return;
    }

    setTaskSubmitting(true);
    setTaskError(null);
    setMessage(null);

    try {
      if (taskProjectMode === 'new' && !taskProjects.includes(normalizedProject)) {
        const projectResponse = await window.vaultAPI.createProject(normalizedProject);
        if (!projectResponse.success || !projectResponse.data) {
          throw new Error(projectResponse.error || 'Failed to create the new project');
        }

        setTaskProjects((current) => [...new Set([...current, projectResponse.data!.name])].sort((left, right) => left.localeCompare(right)));
        setTaskProjectMode('existing');
      }

      const response = await window.vaultAPI.createTask({
        title: normalizedTitle,
        taskType,
        prompt: normalizedPrompt,
        priority: taskPriority,
        project: normalizedProject || undefined,
        maxRetries: Math.max(0, Number(taskMaxRetries) || 0),
        createdBy: 'desktop',
      });

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to create the delegated task');
      }

      setMessage(`Task queued: ${response.data.title}`);
      setTaskTitle('');
      setTaskPrompt('');
      setSelectedTaskUid(response.data.taskUid);
      setActiveAgentTab('tasks');
      await loadTaskData(true);
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : 'Failed to create the delegated task');
    } finally {
      setTaskSubmitting(false);
    }
  }

  async function startExecutor() {
    setExecutorSaving(true);
    setTaskError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.startTaskExecutor();
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to start the task executor');
      }

      setExecutorStatus(response.data);
      setMessage('Task executor started.');
      setActiveAgentTab('queue');
      await loadTaskData(true);
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : 'Failed to start the task executor');
    } finally {
      setExecutorSaving(false);
    }
  }

  async function stopExecutor() {
    setExecutorSaving(true);
    setTaskError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.stopTaskExecutor();
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to stop the task executor');
      }

      setExecutorStatus(response.data);
      setMessage('Task executor stopped.');
      setActiveAgentTab('queue');
      await loadTaskData(true);
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : 'Failed to stop the task executor');
    } finally {
      setExecutorSaving(false);
    }
  }

  async function cancelTask(taskUid: string) {
    setExecutorSaving(true);
    setTaskError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.cancelTask(taskUid);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to cancel the task');
      }

      setMessage(`Task cancelled: ${response.data.title}`);
      setSelectedTaskUid(response.data.taskUid);
      setActiveAgentTab('tasks');
      await loadTaskData(true);
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : 'Failed to cancel the task');
    } finally {
      setExecutorSaving(false);
    }
  }

  const recentErrors = logs.filter((log) => log.actionType === 'error').length;
  const recentEnrichment = logs.filter((log) => log.actionType === 'enrich').length;
  const pendingTasks = executorStatus?.queue.pending ?? 0;
  const runningTasks = executorStatus?.queue.running ?? 0;
  const completedTasks = executorStatus?.queue.completed ?? 0;
  const failedTasks = executorStatus?.queue.failed ?? 0;
  const selectedTask = useMemo(
    () => tasks.find((task) => task.taskUid === selectedTaskUid) || tasks[0] || null,
    [tasks, selectedTaskUid],
  );
  const activeTask = useMemo(
    () => tasks.find((task) => task.taskUid === executorStatus?.activeTaskUid)
      || tasks.find((task) => task.status === 'running')
      || null,
    [executorStatus?.activeTaskUid, tasks],
  );
  const queueTypeBreakdown = useMemo(
    () => executorStatus?.queue.byType
      ? Object.entries(executorStatus.queue.byType)
        .filter(([, count]) => count > 0)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      : [],
    [executorStatus?.queue.byType],
  );
  const selectedTaskSavedMemoryUid = useMemo(
    () => getSavedTaskMemoryUid(selectedTask),
    [selectedTask],
  );
  const selectedTaskSavedMemoryType = useMemo(
    () => getTaskResultMetadataString(selectedTask, 'savedMemoryType') || selectedTaskMemory?.memoryType || null,
    [selectedTask, selectedTaskMemory],
  );
  const selectedTaskSavedMemoryPath = useMemo(
    () => getTaskResultMetadataString(selectedTask, 'savedMemoryPath') || selectedTaskMemory?.vaultPath || null,
    [selectedTask, selectedTaskMemory],
  );
  const selectedTaskPreviewImage = useMemo(
    () => getTaskPreviewImage(selectedTask),
    [selectedTask],
  );
  const selectedTaskAssetPaths = useMemo(
    () => getTaskAssetPaths(selectedTask),
    [selectedTask],
  );
  const taskProjectOptions = useMemo(
    () => [...taskProjects].sort((left, right) => left.localeCompare(right)),
    [taskProjects],
  );
  const selectedTaskProjectOption = taskProjectMode === 'new'
    ? '__new__'
    : taskProjectOptions.includes(taskProject)
      ? taskProject
      : '__new__';

  const providerSettings = resolveAiProviderSettings(settings ?? {});
  const selectedTaskFailoverSummary = formatProviderFailover(selectedTask?.resultMetadata);
  const backendLabel = providerSettings.backendLabel;
  const activeModelLabel = providerSettings.primaryEnrichmentModel || 'No primary model selected';
  const activeRoutingPreset = useMemo(
    () => routingTable ? VAULT_AGENT_ROUTING_PRESETS.find((preset) => routingTablesEqual(routingTable, preset.table)) || null : null,
    [routingTable],
  );
  const routingPreview = useMemo(() => {
    if (!routingTable) {
      return [];
    }

    return ['coding', 'research', 'analysis', 'image']
      .map((taskType) => {
        const route = routingTable.routes.find((entry) => entry.taskType === taskType);
        if (!route) {
          return null;
        }

        return {
          taskType,
          modelId: route.modelId,
          fallbackModelId: route.fallbackModelId || null,
        };
      })
      .filter((entry): entry is { taskType: string; modelId: string; fallbackModelId: string | null } => Boolean(entry));
  }, [routingTable]);
  const runtimeStateLabel = enrichmentActive ? 'Live' : apiKeyConfigured ? 'Configured' : 'Missing key';
  const executorStateLabel = executorStatus?.running ? 'Running' : taskLoading ? 'Loading' : 'Stopped';
  const activeQueueCount = pendingTasks + runningTasks;
  const failureSignalCount = (executorStatus?.failedCount ?? 0) + failedTasks + recentErrors;

  useEffect(() => {
    if (!selectedTaskSavedMemoryUid) {
      setSelectedTaskMemory(null);
      setTaskMemoryError(null);
      setTaskMemoryLoading(false);
      return;
    }

    const memoryUid = selectedTaskSavedMemoryUid;
    let active = true;

    async function loadSelectedTaskMemory() {
      setTaskMemoryLoading(true);
      setTaskMemoryError(null);
      setSelectedTaskMemory(null);

      try {
        const response = await window.vaultAPI.getMemoryDetail(memoryUid);
        if (!active) {
          return;
        }

        if (!response.success) {
          throw new Error(response.error || 'Failed to load the saved Vault memory');
        }

        if (!response.data) {
          setTaskMemoryError('This task points to a saved memory UID, but the memory item is not available anymore.');
          return;
        }

        setSelectedTaskMemory(response.data);
      } catch (err) {
        if (active) {
          setTaskMemoryError(err instanceof Error ? err.message : 'Failed to load the saved Vault memory');
        }
      } finally {
        if (active) {
          setTaskMemoryLoading(false);
        }
      }
    }

    void loadSelectedTaskMemory();

    return () => {
      active = false;
    };
  }, [selectedTaskSavedMemoryUid]);

  return (
    <div className="agent-runtime-dashboard">
      <section className="section-intro agent-runtime-hero">
        <div className="section-intro-copy">
          <span className="section-intro-eyebrow">Agent Runtime</span>
          <div className="section-intro-title">Run the built-in Vault runtime and delegated task queue from one focused cockpit</div>
          <p className="section-intro-text">This page is for the built-in provider-backed Vault runtime and background task executor. Codex and Claude stay external clients through MCP; full recall and save activity stays in Activity.</p>
        </div>
        <div className="section-intro-meta">
          <span className="section-intro-chip">{runtimeStateLabel}</span>
          <span className="section-intro-chip">{executorStateLabel} executor</span>
          <span className="section-intro-chip">{activeQueueCount} active tasks</span>
        </div>
      </section>

      <div className="agent-runtime-kpi-grid" aria-label="Agent runtime status">
        <div className="stat-chip">
          <span className="stat-label">Agent backend</span>
          <strong className="stat-value hero-card-value-compact">{backendLabel}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Active model</span>
          <strong className="stat-value hero-card-value-compact">{activeModelLabel}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">API runtime</span>
          <strong className="stat-value hero-card-value-compact">{runtimeStateLabel}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Recent enrich</span>
          <strong className="stat-value">{recentEnrichment}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Recent errors</span>
          <strong className="stat-value">{recentErrors}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Task executor</span>
          <strong className="stat-value hero-card-value-compact">{executorStateLabel}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Pending tasks</span>
          <strong className="stat-value">{pendingTasks}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Failure signals</span>
          <strong className="stat-value">{failureSignalCount}</strong>
        </div>
      </div>

      <div className="agent-runtime-tabs" role="tablist" aria-label="Agent page sections">
        {AGENT_RUNTIME_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeAgentTab === tab.id}
            className={`agent-runtime-tab ${activeAgentTab === tab.id ? 'agent-runtime-tab-active' : ''}`}
            onClick={() => setActiveAgentTab(tab.id)}
          >
            <span>{tab.label}</span>
            <small>{tab.meta}</small>
          </button>
        ))}
      </div>

      <div className="agent-runtime-tab-body">
        {activeAgentTab === 'queue' ? (
          <section className="panel agent-runtime-tab-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Delegated task executor</div>
                <div className="panel-subtitle">Queue work, start or stop the executor, and watch current queue pressure without opening task detail.</div>
              </div>
              <div className="inline-actions">
                <button type="button" className="header-button" onClick={() => void loadTaskData()} disabled={taskLoading}>
                  <RefreshCw size={16} />
                  <span>{taskLoading ? 'Refreshing...' : 'Refresh queue'}</span>
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void startExecutor()}
                  disabled={executorSaving || executorStatus?.running}
                >
                  <Play size={16} />
                  <span>{executorSaving && !executorStatus?.running ? 'Starting...' : 'Start executor'}</span>
                </button>
                <button
                  type="button"
                  className="header-button"
                  onClick={() => void stopExecutor()}
                  disabled={executorSaving || !executorStatus?.running}
                >
                  <Square size={16} />
                  <span>{executorSaving && executorStatus?.running ? 'Stopping...' : 'Stop executor'}</span>
                </button>
              </div>
            </div>

            {taskError ? <span className="error-text">{taskError}</span> : null}

            {taskLoading && !executorStatus ? (
              <div className="empty-state">Loading task executor state...</div>
            ) : (
              <div className="agent-tab-stack">
                <div className="agent-queue-status-layout">
                  <div className="queue-health-grid" aria-label="Queue status summary">
                    <div className="queue-health-card queue-health-card-pending">
                      <span className="queue-health-label">Pending</span>
                      <strong>{pendingTasks}</strong>
                    </div>
                    <div className="queue-health-card queue-health-card-running">
                      <span className="queue-health-label">Running</span>
                      <strong>{runningTasks}</strong>
                    </div>
                    <div className="queue-health-card queue-health-card-completed">
                      <span className="queue-health-label">Completed</span>
                      <strong>{completedTasks}</strong>
                    </div>
                    <div className="queue-health-card queue-health-card-failed">
                      <span className="queue-health-label">Failed</span>
                      <strong>{failedTasks}</strong>
                    </div>
                  </div>

                  <div className={`queue-now-card ${executorStatus?.running ? 'queue-now-card-running' : ''}`}>
                    <div>
                      <span className="queue-section-kicker">Executor</span>
                      <strong>{executorStatus?.running ? 'Running' : 'Stopped'}</strong>
                    </div>
                    <div className="queue-now-meta">
                      <span>Active task</span>
                      <span className="text-mono">{activeTask?.taskUid || executorStatus?.activeTaskUid || 'none'}</span>
                    </div>
                    {activeTask ? (
                      <p>{activeTask.title}</p>
                    ) : (
                      <p>No task is currently being processed.</p>
                    )}
                  </div>
                </div>

                <div className="detail-grid agent-runtime-detail-grid">
                  <div className="detail-block">
                    <span className="detail-label">Runner state</span>
                    <strong>{executorStatus?.running ? 'running' : 'stopped'}</strong>
                  </div>
                  <div className="detail-block">
                    <span className="detail-label">Last poll tick</span>
                    <strong>{formatTimestamp(executorStatus?.lastTickAt)}</strong>
                  </div>
                  <div className="detail-block">
                    <span className="detail-label">Processed</span>
                    <strong>{executorStatus?.processedCount ?? 0}</strong>
                  </div>
                  <div className="detail-block">
                    <span className="detail-label">Executor failures</span>
                    <strong>{executorStatus?.failedCount ?? 0}</strong>
                  </div>
                </div>

                {queueTypeBreakdown.length > 0 ? (
                  <div className="queue-type-strip" aria-label="Queued tasks by type">
                    {queueTypeBreakdown.map(([type, count]) => (
                      <span key={type} className="chip chip-muted">
                        {type} {count}
                      </span>
                    ))}
                  </div>
                ) : null}

                {executorStatus?.lastError ? (
                  <div className="note-card">
                    <p>Last executor error: {executorStatus.lastError}</p>
                  </div>
                ) : null}

                <div className="detail-section agent-composer-panel">
                  <div className="detail-section-title">
                    <Workflow size={16} />
                    <span>Queue composer</span>
                  </div>

                  <div className="field-grid agent-composer-grid">
                    <label className="field-row">
                      <span className="field-label">Task title</span>
                      <input
                        className="text-input"
                        value={taskTitle}
                        onChange={(event) => setTaskTitle(event.target.value)}
                        placeholder="Summarize migration notes / compare packages / draft implementation plan"
                      />
                    </label>

                    <label className="field-row">
                      <span className="field-label">Task type</span>
                      <select
                        className="text-input"
                        value={taskType}
                        onChange={(event) => setTaskType(event.target.value as VaultTaskType)}
                      >
                        <option value="research">Research</option>
                        <option value="analysis">Analysis</option>
                        <option value="coding">Coding</option>
                        <option value="summarize">Summarize</option>
                        <option value="organize">Organize</option>
                        <option value="enrich">Enrich</option>
                        <option value="general">General</option>
                        <option value="image">Image</option>
                      </select>
                    </label>

                    <label className="field-row">
                      <span className="field-label">Project</span>
                      <select
                        className="text-input"
                        value={selectedTaskProjectOption}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          if (nextValue === '__new__') {
                            setTaskProjectMode('new');
                            if (taskProjectOptions.length === 0 && !taskProject.trim()) {
                              setTaskProject('Vault');
                            }
                            return;
                          }

                          setTaskProjectMode('existing');
                          setTaskProject(nextValue);
                        }}
                      >
                        {taskProjectOptions.length === 0 ? (
                          <option value="__new__">No projects yet</option>
                        ) : (
                          taskProjectOptions.map((project) => (
                            <option key={project} value={project}>
                              {project}
                            </option>
                          ))
                        )}
                        <option value="__new__">+ New project</option>
                      </select>
                      {taskProjectMode === 'new' ? (
                        <input
                          className="text-input"
                          value={taskProject}
                          onChange={(event) => setTaskProject(event.target.value)}
                          placeholder="New project name"
                        />
                      ) : null}
                    </label>

                    <label className="field-row">
                      <span className="field-label">Priority</span>
                      <select
                        className="text-input"
                        value={taskPriority}
                        onChange={(event) => setTaskPriority(event.target.value as VaultTaskPriority)}
                      >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </label>

                    <label className="field-row">
                      <span className="field-label">Max retries</span>
                      <input
                        className="text-input"
                        type="number"
                        min={0}
                        max={5}
                        value={taskMaxRetries}
                        onChange={(event) => setTaskMaxRetries(Number(event.target.value) || 0)}
                      />
                    </label>

                    <label className="field-row agent-composer-prompt">
                      <span className="field-label">Prompt</span>
                      <textarea
                        className="text-area-input"
                        value={taskPrompt}
                        onChange={(event) => setTaskPrompt(event.target.value)}
                        placeholder="Describe the work clearly so the Vault Agent can execute it without blocking your main flow."
                      />
                      <span className="field-help">This uses the primary provider's routed model for the selected task type once the executor is running.</span>
                    </label>
                  </div>

                  <div className="save-actions">
                    <button type="button" className="primary-button" onClick={() => void submitTask()} disabled={taskSubmitting}>
                      <SendHorizonal size={16} />
                      <span>{taskSubmitting ? 'Queueing...' : 'Queue task'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {activeAgentTab === 'tasks' ? (
          <section className="agent-tab-split">
            <div className="panel agent-runtime-tab-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Recent tasks</div>
                  <div className="panel-subtitle">Select delegated work to inspect prompt, output, linked memory, assets, and cancellation state.</div>
                </div>
                <button type="button" className="header-button" onClick={() => void loadTaskData()} disabled={taskLoading}>
                  <RefreshCw size={16} />
                  <span>{taskLoading ? 'Refreshing...' : 'Refresh'}</span>
                </button>
              </div>

              {taskError ? <span className="error-text">{taskError}</span> : null}

              {tasks.length === 0 ? (
                <div className="empty-state">No delegated tasks have been queued yet.</div>
              ) : (
                <DayGroupedList
                  items={tasks}
                  getDate={(task) => task.updatedAt}
                  getKey={(task) => task.taskUid}
                  emptyMessage="No delegated tasks have been queued yet."
                  defaultOpenCount={2}
                  renderItem={(task) => (
                    <button
                      type="button"
                      className={`queue-task-row ${selectedTask?.taskUid === task.taskUid ? 'queue-task-row-active' : ''}`}
                      onClick={() => setSelectedTaskUid(task.taskUid)}
                    >
                      <span className={`queue-status-rail ${getTaskStatusRailClass(task.status)}`} />
                      <span className="queue-task-main">
                        <span className="queue-task-title-row">
                          <span className="queue-task-title">{task.title}</span>
                          <span className={`badge ${getTaskBadgeClass(task.status)}`}>{task.status}</span>
                        </span>
                        <span className="queue-task-meta">
                          <span>{task.project || 'global'}</span>
                          <span>{task.taskType}</span>
                          <span>{task.priority}</span>
                          <span>{task.retryCount}/{task.maxRetries} retries</span>
                        </span>
                      </span>
                      <span className="queue-task-age">
                        <Clock3 size={13} />
                        <span>{formatRelativeTimestamp(task.updatedAt)}</span>
                      </span>
                    </button>
                  )}
                />
              )}
            </div>

            <aside className="panel agent-runtime-tab-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Task detail</div>
                  <div className="panel-subtitle">Selected task prompt, result, saved Vault memory, generated assets, and action state.</div>
                </div>
                {selectedTask ? <span className={`badge ${getTaskBadgeClass(selectedTask.status)}`}>{selectedTask.status}</span> : null}
              </div>

              {!selectedTask ? (
                <div className="empty-state">Select a task to inspect it.</div>
              ) : (
                <div className="detail-stack agent-task-detail-stack">
                  <div className="queue-selected-headline">
                    <h3>{selectedTask.title}</h3>
                    <p className="text-mono">{selectedTask.taskUid}</p>
                  </div>

                  <div className="queue-selected-meta-grid">
                    <span>
                      <span>Priority</span>
                      <strong>{selectedTask.priority}</strong>
                    </span>
                    <span>
                      <span>Project</span>
                      <strong>{selectedTask.project || 'global'}</strong>
                    </span>
                    <span>
                      <span>Created</span>
                      <strong>{formatTimestamp(selectedTask.createdAt)}</strong>
                    </span>
                    <span>
                      <span>Completed</span>
                      <strong>{formatTimestamp(selectedTask.completedAt)}</strong>
                    </span>
                    <span className="queue-selected-meta-wide">
                      <span>Routed model</span>
                      <strong className="text-mono">{selectedTask.routedModel || 'unresolved'}</strong>
                    </span>
                  </div>

                  <div className="detail-section">
                    <div className="detail-section-title">
                      <Sparkles size={16} />
                      <span>Task prompt</span>
                    </div>
                    <pre className="snippet-block">{selectedTask.prompt}</pre>
                  </div>

                  {selectedTask.resultText ? (
                    <div className="detail-section">
                      <div className="detail-section-title">
                        <Sparkles size={16} />
                        <span>Result</span>
                      </div>
                      <pre className="snippet-block">{selectedTask.resultText}</pre>
                    </div>
                  ) : null}

                  {selectedTaskFailoverSummary ? (
                    <div className="note-card">
                      <p>{selectedTaskFailoverSummary}</p>
                    </div>
                  ) : null}

                  {selectedTaskPreviewImage ? (
                    <div className="detail-section">
                      <div className="detail-section-title">
                        <Sparkles size={16} />
                        <span>Generated image</span>
                      </div>
                      <img
                        className="task-image-preview"
                        src={selectedTaskPreviewImage}
                        alt={selectedTask.title}
                      />
                    </div>
                  ) : null}

                  {selectedTaskAssetPaths.length > 0 ? (
                    <div className="detail-section">
                      <div className="detail-section-title">
                        <Save size={16} />
                        <span>Generated asset files</span>
                      </div>
                      <div className="detail-stack">
                        {selectedTaskAssetPaths.map((assetPath) => (
                          <div key={assetPath} className="detail-path text-mono">{assetPath}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedTaskSavedMemoryUid ? (
                    <div className="detail-section">
                      <div className="detail-section-title">
                        <Save size={16} />
                        <span>Saved to Vault</span>
                      </div>

                      {taskMemoryLoading ? (
                        <p>Loading linked memory...</p>
                      ) : taskMemoryError ? (
                        <div className="note-card">
                          <p>{taskMemoryError}</p>
                        </div>
                      ) : selectedTaskMemory ? (
                        <div className="detail-stack">
                          <div className="detail-grid">
                            <div className="detail-block">
                              <span className="detail-label">Memory title</span>
                              <strong>{selectedTaskMemory.title}</strong>
                            </div>
                            <div className="detail-block">
                              <span className="detail-label">Memory type</span>
                              <strong>{selectedTaskSavedMemoryType || selectedTaskMemory.memoryType}</strong>
                            </div>
                            <div className="detail-block">
                              <span className="detail-label">Memory UID</span>
                              <strong className="text-mono">{selectedTaskSavedMemoryUid}</strong>
                            </div>
                            <div className="detail-block">
                              <span className="detail-label">Project</span>
                              <strong>{selectedTaskMemory.project}</strong>
                            </div>
                          </div>

                          <div className="note-card">
                            <p>{selectedTaskMemory.summary}</p>
                          </div>

                          {selectedTaskSavedMemoryPath ? (
                            <div className="detail-block">
                              <span className="detail-label">Vault path</span>
                              <div className="detail-path text-mono">{selectedTaskSavedMemoryPath}</div>
                            </div>
                          ) : null}

                          {selectedTaskMemory.fileContent || selectedTaskMemory.content ? (
                            <pre className="snippet-block">{selectedTaskMemory.fileContent || selectedTaskMemory.content}</pre>
                          ) : null}
                        </div>
                      ) : (
                        <p>No saved memory is available for this task yet.</p>
                      )}
                    </div>
                  ) : null}

                  {selectedTask.errorMessage ? (
                    <div className="note-card">
                      <p>Task error: {selectedTask.errorMessage}</p>
                    </div>
                  ) : null}

                  {(selectedTask.status === 'pending' || selectedTask.status === 'running') ? (
                    <div className="save-actions">
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => void cancelTask(selectedTask.taskUid)}
                        disabled={executorSaving}
                      >
                        <Square size={16} />
                        <span>{executorSaving ? 'Cancelling...' : 'Cancel task'}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </aside>
          </section>
        ) : null}

        {activeAgentTab === 'runtime' ? (
          <section className="agent-tab-split">
            <div className="panel agent-runtime-tab-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Runtime controls</div>
                  <div className="panel-subtitle">Tune the built-in API-backed Vault operator and default recall limits.</div>
                </div>
                <div className="inline-actions">
                  <button type="button" className="header-button" onClick={() => void loadAgentData()} disabled={loading}>
                    <RefreshCw size={16} />
                    <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
                  </button>
                  <button type="button" className="primary-button" onClick={() => void saveQuickControls()} disabled={saving}>
                    <Save size={16} />
                    <span>{saving ? 'Saving...' : 'Save controls'}</span>
                  </button>
                </div>
              </div>

              {message ? <span className="success-text">{message}</span> : null}
              {error ? <span className="error-text">{error}</span> : null}

              <div className="field-grid">
                <label className="toggle-row">
                  <div>
                    <span className="field-label">Enable Vault AI runtime</span>
                    <span className="field-help">Turns the built-in API-backed Vault operator on or off.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={draftEnrichmentEnabled}
                    onChange={(event) => setDraftEnrichmentEnabled(event.target.checked)}
                  />
                </label>

                <label className="toggle-row">
                  <div>
                    <span className="field-label">Automatic activity logging</span>
                    <span className="field-help">Keep recalls, enrichments, saves, and failures inspectable from Activity.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={draftAutoLog}
                    onChange={(event) => setDraftAutoLog(event.target.checked)}
                  />
                </label>

                <label className="field-row">
                  <span className="field-label">Default recall cap</span>
                  <input
                    className="text-input"
                    type="number"
                    min={1}
                    max={50}
                    value={draftRecallMax}
                    onChange={(event) => setDraftRecallMax(Number(event.target.value) || 1)}
                  />
                  <span className="field-help">Used when a client does not explicitly ask for a different number of recall results.</span>
                </label>
              </div>
            </div>

            <aside className="panel agent-runtime-tab-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Backend runtime</div>
                  <div className="panel-subtitle">Runtime detail for the API-backed Vault operator and delegated task routing.</div>
                </div>
                <Bot size={18} className="panel-icon" />
              </div>

              <div className="detail-stack agent-task-detail-stack">
                <div className="detail-grid">
                  <div className="detail-block">
                    <span className="detail-label">Primary provider</span>
                    <strong>{providerSettings.primaryProviderLabel}</strong>
                  </div>
                  <div className="detail-block">
                    <span className="detail-label">Fallback provider</span>
                    <strong>{providerSettings.fallbackProviderLabel || 'none'}</strong>
                  </div>
                  <div className="detail-block">
                    <span className="detail-label">Primary API key</span>
                    <strong>{apiKeyConfigured ? 'configured' : 'missing'}</strong>
                  </div>
                  <div className="detail-block">
                    <span className="detail-label">Selected model</span>
                    <strong>{activeModelLabel}</strong>
                  </div>
                  <div className="detail-block">
                    <span className="detail-label">Runtime state</span>
                    <strong>{enrichmentActive ? 'active' : draftEnrichmentEnabled ? 'configured but inactive' : 'disabled'}</strong>
                  </div>
                </div>

                <div className="note-card">
                  <p>This is the built-in Vault operator for API-backed summarization, reranking, delegated tasks, and plain-text responses when the desktop app needs model output.</p>
                  <p>Codex, Claude Desktop, Claude Code, and other clients should connect through MCP so they remain the model and conversation surface.</p>
                </div>

                {routingTable ? (
                  <div className="note-card">
                    <div className="detail-section-title">
                      <Workflow size={16} />
                      <span>Delegated task routing posture</span>
                    </div>
                    <p>
                      {activeRoutingPreset
                        ? `${activeRoutingPreset.label}: ${activeRoutingPreset.description}`
                        : 'Custom task routing is active.'}
                    </p>
                    <div className="chip-row">
                      <span className="chip">default {routingTable.defaultModelId}</span>
                      {routingPreview.map((route) => (
                        <span key={route.taskType} className="chip chip-muted">
                          {route.taskType} {route.modelId}
                        </span>
                      ))}
                    </div>
                    {routingPreview.some((route) => route.fallbackModelId) ? (
                      <p>
                        Fallbacks:
                        {' '}
                        {routingPreview
                          .filter((route) => route.fallbackModelId)
                          .map((route) => `${route.taskType} -> ${route.fallbackModelId}`)
                          .join(' | ')}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </aside>
          </section>
        ) : null}

        {activeAgentTab === 'events' ? (
          <section className="panel agent-runtime-tab-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Executor events</div>
                <div className="panel-subtitle">Live task events received by this desktop session.</div>
              </div>
              <Activity size={18} className="panel-icon" />
            </div>

            {taskEvents.length === 0 ? (
              <div className="empty-state">No task events have been received in this session yet.</div>
            ) : (
              <DayGroupedList
                items={taskEvents}
                getDate={(event) => event.timestamp}
                getKey={(event) => `${event.timestamp}-${event.taskUid}-${event.type}`}
                emptyMessage="No task events have been received in this session yet."
                renderItem={(event) => {
                  const failoverSummary = formatProviderFailover(event.metadata);

                  return (
                    <div className={`adapter-check ${getEventCardClass(event.type)}`}>
                      <div className="adapter-check-head">
                        <span className={`badge ${getTaskBadgeClassFromEvent(event.type)}`}>{event.type}</span>
                        <strong>{event.task?.title || event.taskUid}</strong>
                      </div>
                      <p>{event.message}</p>
                      {failoverSummary ? <p>{failoverSummary}</p> : null}
                      <p>{formatTimestamp(event.timestamp)}</p>
                    </div>
                  );
                }}
              />
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function getSavedTaskMemoryUid(task: VaultTask | null): string | null {
  return getTaskResultMetadataString(task, 'savedMemoryUid') || task?.targetMemoryUid || null;
}

function getTaskPreviewImage(task: VaultTask | null): string | null {
  const primaryImage = getTaskResultMetadataString(task, 'primaryImageDataUrl');
  if (primaryImage) {
    return primaryImage;
  }

  const images = task?.resultMetadata?.images;
  if (!Array.isArray(images)) {
    return null;
  }

  for (const image of images) {
    if (!image || typeof image !== 'object') {
      continue;
    }

    const dataUrl = (image as Record<string, unknown>).dataUrl;
    if (typeof dataUrl === 'string' && dataUrl.trim()) {
      return dataUrl.trim();
    }
  }

  return null;
}

function getTaskAssetPaths(task: VaultTask | null): string[] {
  const assetPaths = task?.resultMetadata?.assetPaths;
  if (Array.isArray(assetPaths)) {
    return assetPaths
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  const primaryAssetPath = getTaskResultMetadataString(task, 'primaryAssetPath');
  return primaryAssetPath ? [primaryAssetPath] : [];
}

function getTaskResultMetadataString(task: VaultTask | null, key: string): string | null {
  const value = task?.resultMetadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatProviderFailover(metadata: Record<string, unknown> | null | undefined): string | null {
  const rawError = metadata?.primaryProviderError;
  if (!rawError || typeof rawError !== 'object') {
    return null;
  }

  const providerError = rawError as Record<string, unknown>;
  const provider = providerError.provider;
  const error = providerError.error;
  if ((provider !== 'openrouter' && provider !== 'llm-hub') || typeof error !== 'string' || !error.trim()) {
    return null;
  }

  const models = Array.isArray(providerError.models)
    ? providerError.models
      .filter((model): model is string => typeof model === 'string')
      .map((model) => model.trim())
      .filter(Boolean)
    : [];
  const completedProvider = metadata?.provider;
  const completedWith = completedProvider === 'openrouter' || completedProvider === 'llm-hub'
    ? ` The task completed with ${getAiProviderDisplayName(completedProvider)}.`
    : '';
  const modelDetail = models.length > 0 ? ` using ${models.join(', ')}` : '';

  return `Provider failover: ${getAiProviderDisplayName(provider)} failed${modelDetail}: ${error.trim()}${completedWith}`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }

  return new Date(value).toLocaleString();
}

function formatRelativeTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'unknown time';
  }

  return `${formatDistanceToNow(new Date(value))} ago`;
}

function routingTablesEqual(left: ModelRoutingTable, right: ModelRoutingTable): boolean {
  return JSON.stringify(normalizeRoutingTable(left)) === JSON.stringify(normalizeRoutingTable(right));
}

function normalizeRoutingTable(table: ModelRoutingTable): ModelRoutingTable {
  return {
    defaultModelId: table.defaultModelId,
    routes: [...table.routes]
      .map((route) => ({
        ...route,
        fallbackModelId: route.fallbackModelId || undefined,
      }))
      .sort((leftRoute, rightRoute) => leftRoute.taskType.localeCompare(rightRoute.taskType)),
  };
}

function getTaskBadgeClass(status: VaultTaskStatus): string {
  switch (status) {
    case 'completed':
      return 'badge-task-complete';
    case 'failed':
      return 'badge-task-fail';
    case 'running':
      return 'badge-task-running';
    case 'cancelled':
      return 'badge-task-cancelled';
    case 'pending':
    default:
      return 'badge-task-pending';
  }
}

function getTaskStatusRailClass(status: VaultTaskStatus): string {
  switch (status) {
    case 'completed':
      return 'queue-status-rail-completed';
    case 'failed':
      return 'queue-status-rail-failed';
    case 'running':
      return 'queue-status-rail-running';
    case 'cancelled':
      return 'queue-status-rail-cancelled';
    case 'pending':
    default:
      return 'queue-status-rail-pending';
  }
}

function getTaskBadgeClassFromEvent(type: VaultTaskEventType): string {
  switch (type) {
    case 'task-completed':
      return 'badge-task-complete';
    case 'task-failed':
      return 'badge-task-fail';
    case 'task-retried':
    case 'task-started':
      return 'badge-task-running';
    case 'task-cancelled':
      return 'badge-task-cancelled';
    case 'task-created':
    default:
      return 'badge-task-pending';
  }
}

function getEventCardClass(type: VaultTaskEventType): string {
  switch (type) {
    case 'task-completed':
      return 'adapter-check-pass';
    case 'task-failed':
      return 'adapter-check-fail';
    case 'task-started':
    case 'task-retried':
      return 'adapter-check-warn';
    case 'task-created':
    case 'task-cancelled':
    default:
      return '';
  }
}
