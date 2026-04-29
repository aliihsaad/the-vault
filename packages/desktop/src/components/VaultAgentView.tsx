import { useEffect, useMemo, useState } from 'react';
import { Activity, Bot, Clock3, Play, RefreshCw, Save, SendHorizonal, Sparkles, Square, Workflow } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
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

type VaultAgentSection = 'runtime' | 'queue' | 'activity';

export function VaultAgentView() {
  const [taskProjects, setTaskProjects] = useState<string[]>([]);
  const [settings, setSettings] = useState<VaultSettings | null>(null);
  const [routingTable, setRoutingTable] = useState<ModelRoutingTable | null>(null);
  const [logs, setLogs] = useState<VaultLogEntry[]>([]);
  const [tasks, setTasks] = useState<VaultTask[]>([]);
  const [executorStatus, setExecutorStatus] = useState<VaultTaskExecutorStatus | null>(null);
  const [taskEvents, setTaskEvents] = useState<VaultTaskEvent[]>([]);
  const [selectedTaskMemory, setSelectedTaskMemory] = useState<VaultMemoryDetail | null>(null);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
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
  const [draftBackend, setDraftBackend] = useState<VaultAgentBackend>('api');
  const [draftEnrichmentEnabled, setDraftEnrichmentEnabled] = useState(false);
  const [draftRecallMax, setDraftRecallMax] = useState(10);
  const [draftAutoLog, setDraftAutoLog] = useState(true);
  const [draftWorkThread, setDraftWorkThread] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskType, setTaskType] = useState<VaultTaskType>('research');
  const [taskProject, setTaskProject] = useState('Vault');
  const [taskProjectMode, setTaskProjectMode] = useState<'existing' | 'new'>('existing');
  const [taskPriority, setTaskPriority] = useState<VaultTaskPriority>('normal');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [taskMaxRetries, setTaskMaxRetries] = useState(1);
  const [activeSection, setActiveSection] = useState<VaultAgentSection>('runtime');

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
      const [statusResponse, settingsResponse, logsResponse, secretResponse, enrichmentResponse, routingResponse] = await Promise.all([
        window.vaultAPI.status(),
        window.vaultAPI.getAllSettings(),
        window.vaultAPI.getRecentLogs(40),
        window.vaultAPI.getSecretSetting('openrouter_api_key'),
        window.vaultAPI.refreshEnrichment(),
        window.vaultAPI.getModelRoutingTable(),
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

      if (!secretResponse.success) {
        throw new Error(secretResponse.error || 'Failed to inspect the OpenRouter API key state');
      }

      if (!routingResponse.success || !routingResponse.data) {
        throw new Error(routingResponse.error || 'Failed to inspect task model routing');
      }

      const nextSettings = settingsResponse.data;
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
      setDraftBackend((nextSettings.vault_agent_backend as VaultAgentBackend | undefined) || 'api');
      setDraftEnrichmentEnabled(Boolean(nextSettings.enrichment_enabled));
      setDraftRecallMax(Number(nextSettings.recall_max_results) || 10);
      setDraftAutoLog(Boolean(nextSettings.auto_log));
      setDraftWorkThread(typeof nextSettings.local_adapter_active_task_key === 'string' ? nextSettings.local_adapter_active_task_key : '');
      setLogs(nextLogs);
      setTaskProjectMode(nextProjects.includes(taskProject) ? 'existing' : 'new');

      if (nextLogs.length === 0) {
        setSelectedLogId(null);
      } else if (!selectedLogId || !nextLogs.some((log) => getLogKey(log) === selectedLogId)) {
        setSelectedLogId(getLogKey(nextLogs[0]));
      }
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
        ['vault_agent_backend', draftBackend],
        ['enrichment_enabled', draftEnrichmentEnabled],
        ['auto_log', draftAutoLog],
        ['recall_max_results', Math.max(1, Number(draftRecallMax) || 10)],
        ['local_adapter_active_task_key', draftWorkThread.trim()],
      ];

      for (const [key, value] of updates) {
        const response = await window.vaultAPI.setSetting(key, value);
        if (!response.success) {
          throw new Error(response.error || `Failed to save ${key}`);
        }
      }

      const enrichmentResponse = await window.vaultAPI.refreshEnrichment();
      if (!enrichmentResponse.success) {
        throw new Error(enrichmentResponse.error || 'Failed to refresh the OpenRouter runtime');
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

      setActiveSection('queue');
      setMessage(`Task queued: ${response.data.title}`);
      setTaskTitle('');
      setTaskPrompt('');
      setSelectedTaskUid(response.data.taskUid);
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

      setActiveSection('queue');
      setExecutorStatus(response.data);
      setMessage('Task executor started.');
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

      setActiveSection('queue');
      setExecutorStatus(response.data);
      setMessage('Task executor stopped.');
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

      setActiveSection('queue');
      setMessage(`Task cancelled: ${response.data.title}`);
      setSelectedTaskUid(response.data.taskUid);
      await loadTaskData(true);
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : 'Failed to cancel the task');
    } finally {
      setExecutorSaving(false);
    }
  }

  const adapterConfig = settings?.local_adapter_config as LocalAdapterConfig | undefined;
  const lastTest = settings?.local_adapter_last_test as LocalAdapterTestResult | null | undefined;
  const runtimeState = settings?.local_adapter_runtime_state as LocalAdapterRuntimeState | undefined;
  const taskSessions = settings?.local_adapter_task_sessions as LocalAdapterTaskSessions | undefined;
  const activeAdapterType = adapterConfig?.type || '';
  const localReady = Boolean(adapterConfig?.enabled && adapterConfig.type && lastTest?.canProceed);
  const fallbackSession = activeAdapterType ? runtimeState?.[activeAdapterType as LocalAdapterType] || null : null;
  const activeWorkThread = typeof settings?.local_adapter_active_task_key === 'string' ? settings.local_adapter_active_task_key : '';
  const activeThreadSession = activeAdapterType && activeWorkThread
    ? taskSessions?.[activeAdapterType as LocalAdapterType]?.[activeWorkThread] || null
    : null;
  const knownThreads = activeAdapterType ? Object.entries(taskSessions?.[activeAdapterType as LocalAdapterType] || {}) : [];
  const recentErrors = logs.filter((log) => log.actionType === 'error').length;
  const recentRecalls = logs.filter((log) => log.actionType === 'recall').length;
  const recentSaves = logs.filter((log) => log.actionType === 'save').length;
  const recentEnrichment = logs.filter((log) => log.actionType === 'enrich').length;
  const pendingTasks = executorStatus?.queue.pending ?? 0;
  const runningTasks = executorStatus?.queue.running ?? 0;
  const completedTasks = executorStatus?.queue.completed ?? 0;
  const failedTasks = executorStatus?.queue.failed ?? 0;
  const selectedLog = useMemo(
    () => logs.find((log) => getLogKey(log) === selectedLogId) || logs[0] || null,
    [logs, selectedLogId],
  );
  const selectedTask = useMemo(
    () => tasks.find((task) => task.taskUid === selectedTaskUid) || tasks[0] || null,
    [tasks, selectedTaskUid],
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

  const backendLabel = draftBackend === 'api' ? 'OpenRouter API' : 'Local CLI';
  const activeModelLabel = draftBackend === 'api'
    ? settings?.enrichment_model || 'No API model selected'
    : adapterConfig?.model || 'CLI default';
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
    <div className="logs-layout">
      <section className="section-intro">
        <div className="section-intro-copy">
          <span className="section-intro-eyebrow">Vault Agent</span>
          <div className="section-intro-title">Control the runtime and inspect queued work without losing the thread</div>
          <p className="section-intro-text">The queue, executor events, and Vault activity are grouped by day so active work stays visible while older runs stop flooding the page.</p>
        </div>
        <div className="section-intro-meta">
          <span className="section-intro-chip">runtime controls</span>
          <span className="section-intro-chip">grouped task queue</span>
          <span className="section-intro-chip">executor events</span>
        </div>
      </section>

      <div className="stats-strip">
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
          <strong className="stat-value hero-card-value-compact">
            {enrichmentActive ? 'Live' : apiKeyConfigured ? 'Configured' : 'Missing key'}
          </strong>
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
          <strong className="stat-value hero-card-value-compact">
            {executorStatus?.running ? 'Running' : taskLoading ? 'Loading' : 'Stopped'}
          </strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Pending tasks</span>
          <strong className="stat-value">{pendingTasks}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Running tasks</span>
          <strong className="stat-value">{runningTasks}</strong>
        </div>
      </div>

      <div className="page-mode-strip">
        <button
          type="button"
          className={`page-mode-button ${activeSection === 'runtime' ? 'page-mode-button-active' : ''}`}
          onClick={() => setActiveSection('runtime')}
        >
          <div className="page-mode-heading">
            <span className="page-mode-label">Runtime</span>
            <span className="page-mode-meta">{backendLabel}</span>
          </div>
          <span className="page-mode-description">Backend choice, quick controls, routing posture, and local runtime readiness.</span>
        </button>

        <button
          type="button"
          className={`page-mode-button ${activeSection === 'queue' ? 'page-mode-button-active' : ''}`}
          onClick={() => setActiveSection('queue')}
        >
          <div className="page-mode-heading">
            <span className="page-mode-label">Queue</span>
            <span className="page-mode-meta">{pendingTasks + runningTasks} active</span>
          </div>
          <span className="page-mode-description">Task submission, executor lifecycle, queued work, and live executor events.</span>
        </button>

        <button
          type="button"
          className={`page-mode-button ${activeSection === 'activity' ? 'page-mode-button-active' : ''}`}
          onClick={() => setActiveSection('activity')}
        >
          <div className="page-mode-heading">
            <span className="page-mode-label">Vault activity</span>
            <span className="page-mode-meta">{logs.length} recent events</span>
          </div>
          <span className="page-mode-description">Operational trail for recalls, saves, enrich, updates, archive, promotion, and errors.</span>
        </button>
      </div>

      {activeSection === 'runtime' ? (
        <div className="settings-grid">
          <section className="panel settings-section">
          <div className="panel-header">
            <div>
              <div className="panel-title">Vault agent controls</div>
              <div className="panel-subtitle">Choose whether natural Vault chat should use the OpenRouter API or a tested local CLI backend. Direct Vault operations still use /recall and /save.</div>
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
            <label className="field-row">
              <span className="field-label">Vault agent backend</span>
              <select
                className="text-input"
                value={draftBackend}
                onChange={(event) => setDraftBackend(event.target.value as VaultAgentBackend)}
              >
                <option value="api">OpenRouter API</option>
                <option value="local">Local CLI</option>
              </select>
              <span className="field-help">This controls plain-text chat in the Recall console. `/recall` and `/save` stay direct Vault operations either way.</span>
            </label>

            <label className="toggle-row">
              <div>
                <span className="field-label">Enable OpenRouter Vault runtime</span>
                <span className="field-help">Turns the built-in API-backed Vault operator on or off. This uses the saved OpenRouter key and enrichment model.</span>
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
                <span className="field-help">Keep the agent trail on by default so recalls, enrichments, saves, and failures stay inspectable from this page.</span>
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

            {draftBackend === 'local' ? (
              <label className="field-row">
                <span className="field-label">Local work thread key</span>
                <input
                  className="text-input"
                  value={draftWorkThread}
                  onChange={(event) => setDraftWorkThread(event.target.value)}
                  placeholder="issue-123 / auth-bug / onboarding-flow"
                />
                <span className="field-help">Only applies when the Vault agent backend is set to Local CLI. It keeps one native CLI conversation separate from another work thread.</span>
              </label>
            ) : null}
          </div>
        </section>

        <section className="panel settings-section">
          <div className="panel-header">
            <div>
              <div className="panel-title">Backend runtime</div>
              <div className="panel-subtitle">Runtime detail for whichever backend is currently selected as the Vault agent.</div>
            </div>
            <Bot size={18} className="panel-icon" />
          </div>

          {draftBackend === 'api' ? (
            <div className="detail-stack">
              <div className="detail-grid">
                <div className="detail-block">
                  <span className="detail-label">Provider</span>
                  <strong>OpenRouter</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">API key</span>
                  <strong>{apiKeyConfigured ? 'configured' : 'missing'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Selected model</span>
                  <strong>{settings?.enrichment_model || 'none selected'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Runtime state</span>
                  <strong>{enrichmentActive ? 'active' : draftEnrichmentEnabled ? 'configured but inactive' : 'disabled'}</strong>
                </div>
              </div>

              <div className="note-card">
                <p>This is the built-in Vault operator responsible for API-backed summarization, reranking, and now plain-text chat when the backend is set to OpenRouter API.</p>
                <p>Model selection and API key testing still live in Settings, but this page now controls whether the Vault operator should prefer API or Local CLI for natural chat.</p>
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
          ) : !adapterConfig?.enabled || !adapterConfig.type ? (
            <div className="note-card">
              <p>No local backend is enabled right now.</p>
              <p>Enable Claude Code or Codex in Settings first if you want the Vault agent to use a local CLI instead of OpenRouter.</p>
            </div>
          ) : (
            <div className="detail-stack">
              <div className="detail-grid">
                <div className="detail-block">
                  <span className="detail-label">Adapter</span>
                  <strong>{getAdapterLabel(adapterConfig.type)}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Model</span>
                  <strong>{adapterConfig.model || 'CLI default'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Environment test</span>
                  <strong>{lastTest?.canProceed ? 'ready to run' : lastTest ? 'needs review' : 'not tested'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Auth mode</span>
                  <strong>{lastTest?.authMode || 'unknown'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Resolved command</span>
                  <strong className="text-mono">{lastTest?.resolvedCommand || adapterConfig.command || 'default command'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Workspace</span>
                  <strong className="text-mono">{adapterConfig.cwd || 'current workspace'}</strong>
                </div>
              </div>

              {lastTest?.probe.summary ? (
                <div className="note-card">
                  <div className="detail-section-title">
                    <Sparkles size={16} />
                    <span>Latest probe summary</span>
                  </div>
                  <p>{lastTest.probe.summary}</p>
                </div>
              ) : null}

              <div className="detail-grid">
                <div className="detail-block">
                  <span className="detail-label">Fallback session</span>
                  <strong>{fallbackSession?.sessionDisplayId || fallbackSession?.sessionId || 'none stored'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Active thread session</span>
                  <strong>{activeThreadSession?.sessionDisplayId || activeThreadSession?.sessionId || 'none stored'}</strong>
                </div>
              </div>

              {knownThreads.length > 0 ? (
                <div className="detail-section">
                  <div className="detail-section-title">
                    <Clock3 size={16} />
                    <span>Known work threads</span>
                  </div>
                  <DayGroupedList
                    items={knownThreads
                      .sort((left, right) => right[1].updatedAt.localeCompare(left[1].updatedAt))
                      .slice(0, 6)}
                    getDate={(entry) => entry[1].updatedAt}
                    getKey={(entry) => `${entry[0]}-${entry[1].sessionId}`}
                    emptyMessage="No thread-scoped local sessions are stored yet."
                    renderItem={([taskKey, session]) => (
                      <div className="adapter-check adapter-check-pass">
                        <div className="adapter-check-head">
                          <span className="badge">thread</span>
                          <strong>{taskKey}</strong>
                        </div>
                        <p>{session.sessionDisplayId || session.sessionId}</p>
                        <p>{session.cwd}</p>
                        <p>Updated: {new Date(session.updatedAt).toLocaleString()}</p>
                      </div>
                    )}
                  />
                </div>
              ) : (
                <div className="note-card">
                  <p>No thread-scoped local sessions are stored yet.</p>
                </div>
              )}

              {!localReady ? (
                <div className="note-card">
                  <p>The local backend is selected, but the saved environment test has not passed yet.</p>
                  <p>Run `Test now` in Settings before expecting the Recall console to route plain text through the local CLI.</p>
                </div>
              ) : null}
            </div>
          )}
        </section>
        </div>
      ) : null}

      {activeSection === 'queue' ? (
        <div className="section-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Delegated task executor</div>
              <div className="panel-subtitle">Queue work for the Vault Agent, start or stop the background executor, and inspect the current processing state.</div>
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
            <div className="detail-stack">
              <div className="detail-grid">
                <div className="detail-block">
                  <span className="detail-label">Runner state</span>
                  <strong>{executorStatus?.running ? 'running' : 'stopped'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Active task</span>
                  <strong className="text-mono">{executorStatus?.activeTaskUid || 'none'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Last poll tick</span>
                  <strong>{formatTimestamp(executorStatus?.lastTickAt)}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Last completion</span>
                  <strong>{formatTimestamp(executorStatus?.lastCompletedAt)}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Processed</span>
                  <strong>{executorStatus?.processedCount ?? 0}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Executor failures</span>
                  <strong>{executorStatus?.failedCount ?? 0}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Completed queue</span>
                  <strong>{completedTasks}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Failed queue</span>
                  <strong>{failedTasks}</strong>
                </div>
              </div>

              {executorStatus?.lastError ? (
                <div className="note-card">
                  <p>Last executor error: {executorStatus.lastError}</p>
                </div>
              ) : null}

              <div className="detail-section">
                <div className="detail-section-title">
                  <Workflow size={16} />
                  <span>Queue a delegated task</span>
                </div>

                <div className="field-grid">
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
                    <span className="field-help">
                      {taskProjectMode === 'new'
                        ? 'A new Vault project will be created before the task is queued.'
                        : 'Choose one of the current Vault projects or switch to a new project.'}
                    </span>
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

                  <label className="field-row">
                    <span className="field-label">Prompt</span>
                    <textarea
                      className="text-area-input"
                      value={taskPrompt}
                      onChange={(event) => setTaskPrompt(event.target.value)}
                      placeholder="Describe the work clearly so the Vault Agent can execute it without blocking your main flow."
                    />
                    <span className="field-help">This uses the routed OpenRouter model for the selected task type once the executor is running.</span>
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

        <aside className="detail-panel panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Queue overview</div>
              <div className="panel-subtitle">Recent tasks, selected task details, and the live event feed coming back from the desktop executor.</div>
            </div>
            <Clock3 size={18} className="panel-icon" />
          </div>

          <div className="detail-stack">
            <div className="chip-row">
              <span className="chip">pending {pendingTasks}</span>
              <span className="chip">running {runningTasks}</span>
              <span className="chip">completed {completedTasks}</span>
              <span className="chip">failed {failedTasks}</span>
            </div>

            {executorStatus?.queue.byType && Object.keys(executorStatus.queue.byType).length > 0 ? (
              <div className="chip-row">
                {Object.entries(executorStatus.queue.byType).map(([type, count]) => (
                  <span key={type} className="chip chip-muted">
                    {type} {count}
                  </span>
                ))}
              </div>
            ) : null}

            {tasks.length === 0 ? (
              <div className="empty-state">No delegated tasks have been queued yet.</div>
            ) : (
              <DayGroupedList
                items={tasks}
                getDate={(task) => task.updatedAt}
                getKey={(task) => task.taskUid}
                emptyMessage="No delegated tasks have been queued yet."
                renderItem={(task) => (
                  <button
                    type="button"
                    className={`log-entry log-entry-button ${selectedTask?.taskUid === task.taskUid ? 'log-entry-active' : ''}`}
                    onClick={() => setSelectedTaskUid(task.taskUid)}
                  >
                    <div className={`badge ${getTaskBadgeClass(task.status)}`}>{task.status}</div>
                    <div className="log-entry-main">
                      <div className="log-entry-message">{task.title}</div>
                      <div className="log-entry-meta">
                        <span>{task.project || 'global'}</span>
                        <span>{task.taskType}</span>
                        <span>{task.priority}</span>
                        <span>{task.retryCount}/{task.maxRetries} retries</span>
                      </div>
                    </div>
                    <div className="log-entry-time">
                      <Clock3 size={14} />
                      <span>{formatRelativeTimestamp(task.updatedAt)}</span>
                    </div>
                  </button>
                )}
              />
            )}

            {selectedTask ? (
              <div className="detail-stack">
                <div className="detail-headline">
                  <span className={`badge ${getTaskBadgeClass(selectedTask.status)}`}>{selectedTask.status}</span>
                  <h3>{selectedTask.title}</h3>
                  <p>{selectedTask.taskUid}</p>
                </div>

                <div className="detail-grid">
                  <div className="detail-block">
                    <span className="detail-label">Task type</span>
                    <strong>{selectedTask.taskType}</strong>
                  </div>
                  <div className="detail-block">
                    <span className="detail-label">Priority</span>
                    <strong>{selectedTask.priority}</strong>
                  </div>
                  <div className="detail-block">
                    <span className="detail-label">Routed model</span>
                    <strong className="text-mono">{selectedTask.routedModel || 'unresolved'}</strong>
                  </div>
                  <div className="detail-block">
                    <span className="detail-label">Project</span>
                    <strong>{selectedTask.project || 'global'}</strong>
                  </div>
                  <div className="detail-block">
                    <span className="detail-label">Created</span>
                    <strong>{formatTimestamp(selectedTask.createdAt)}</strong>
                  </div>
                  <div className="detail-block">
                    <span className="detail-label">Completed</span>
                    <strong>{formatTimestamp(selectedTask.completedAt)}</strong>
                  </div>
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
            ) : null}

            <div className="detail-section">
              <div className="detail-section-title">
                <Activity size={16} />
                <span>Live executor events</span>
              </div>

              {taskEvents.length === 0 ? (
                <p>No task events have been received in this session yet.</p>
              ) : (
                <DayGroupedList
                  items={taskEvents}
                  getDate={(event) => event.timestamp}
                  getKey={(event) => `${event.timestamp}-${event.taskUid}-${event.type}`}
                  emptyMessage="No task events have been received in this session yet."
                  renderItem={(event) => (
                    <div className={`adapter-check ${getEventCardClass(event.type)}`}>
                      <div className="adapter-check-head">
                        <span className={`badge ${getTaskBadgeClassFromEvent(event.type)}`}>{event.type}</span>
                        <strong>{event.task?.title || event.taskUid}</strong>
                      </div>
                      <p>{event.message}</p>
                      <p>{formatTimestamp(event.timestamp)}</p>
                    </div>
                  )}
                />
              )}
            </div>
          </div>
        </aside>
        </div>
      ) : null}

      {activeSection === 'activity' ? (
        <div className="section-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Recent Vault activity</div>
              <div className="panel-subtitle">The Vault-owned operational trail across recall, enrich, save, update, archive, promotion, and error events.</div>
            </div>
            <div className="chip-row">
              <span className="chip">saves {recentSaves}</span>
              <span className="chip">recalls {recentRecalls}</span>
              <span className="chip">enrich {recentEnrichment}</span>
            </div>
          </div>

          {loading ? (
            <div className="empty-state">Loading agent activity...</div>
          ) : logs.length === 0 ? (
            <div className="empty-state">No recent activity has been recorded yet.</div>
          ) : (
            <DayGroupedList
              items={logs}
              getDate={(log) => log.timestamp}
              getKey={getLogKey}
              emptyMessage="No recent activity has been recorded yet."
              renderItem={(log) => {
                const key = getLogKey(log);
                return (
                  <button
                    type="button"
                    className={`log-entry log-entry-button ${selectedLog && getLogKey(selectedLog) === key ? 'log-entry-active' : ''}`}
                    onClick={() => setSelectedLogId(key)}
                  >
                    <div className={`badge badge-${log.actionType}`}>{log.actionType}</div>
                    <div className="log-entry-main">
                      <div className="log-entry-message">{log.message || 'No message recorded'}</div>
                      <div className="log-entry-meta">
                        <span>{log.project || 'global'}</span>
                        <span>{log.sourceClient}</span>
                        {typeof log.latencyMs === 'number' ? <span>{log.latencyMs}ms</span> : null}
                        {log.targetItemId ? <span>{log.targetItemId}</span> : null}
                      </div>
                    </div>
                    <div className="log-entry-time">
                      <Clock3 size={14} />
                      <span>{log.timestamp ? formatDistanceToNow(new Date(log.timestamp)) : 'unknown time'} ago</span>
                    </div>
                  </button>
                );
              }}
            />
          )}
        </section>

        <aside className="detail-panel panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Activity detail</div>
              <div className="panel-subtitle">Inspect the current selected event and its stored metadata.</div>
            </div>
            <Activity size={18} className="panel-icon" />
          </div>

          {!selectedLog ? (
            <div className="empty-state">Select an activity event to inspect it.</div>
          ) : (
            <div className="detail-stack">
              <div className="detail-headline">
                <span className={`badge badge-${selectedLog.actionType}`}>{selectedLog.actionType}</span>
                <h3>{selectedLog.message || 'No message recorded'}</h3>
                <p>Source client: {selectedLog.sourceClient}</p>
              </div>

              <div className="detail-grid">
                <div className="detail-block">
                  <span className="detail-label">Timestamp</span>
                  <strong>{selectedLog.timestamp ? new Date(selectedLog.timestamp).toLocaleString() : 'unknown'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Project</span>
                  <strong>{selectedLog.project || 'global'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Status</span>
                  <strong>{selectedLog.status || 'unknown'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Latency</span>
                  <strong>{typeof selectedLog.latencyMs === 'number' ? `${selectedLog.latencyMs}ms` : 'n/a'}</strong>
                </div>
              </div>

              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 ? (
                <div className="detail-section">
                  <div className="detail-section-title">
                    <Sparkles size={16} />
                    <span>Stored metadata</span>
                  </div>
                  <pre className="snippet-block">{JSON.stringify(selectedLog.metadata, null, 2)}</pre>
                </div>
              ) : (
                <div className="note-card">
                  <p>No metadata was stored for this event.</p>
                </div>
              )}
            </div>
          )}
        </aside>
        </div>
      ) : null}
    </div>
  );
}

function getAdapterLabel(type: LocalAdapterType): string {
  switch (type) {
    case 'claude_local':
      return 'Claude Code';
    case 'codex_local':
      return 'Codex CLI';
    default:
      return type;
  }
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

function getLogKey(log: VaultLogEntry): string {
  return `${log.id ?? 'none'}-${log.timestamp ?? 'none'}-${log.actionType}`;
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
