import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Clipboard,
  Database,
  FolderGit2,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Terminal,
  XCircle,
} from 'lucide-react';

type Props = {
  projects: string[];
  adapterConfig?: LocalAdapterConfig;
  onRunsChanged?: () => void;
};

export function AgentWorkbenchView({ projects, adapterConfig, onRunsChanged }: Props) {
  const [workspaces, setWorkspaces] = useState<ProjectWorkspaceConfig[]>([]);
  const [recentRuns, setRecentRuns] = useState<LocalWorkbenchRecentRun[]>([]);
  const [project, setProject] = useState(projects[0] || '');
  const [workspacePath, setWorkspacePath] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [adapterType, setAdapterType] = useState<LocalAdapterType>(adapterConfig?.type || 'codex_local');
  const [model, setModel] = useState(adapterConfig?.model || '');
  const [effort, setEffort] = useState(adapterConfig?.effort || '');
  const [preparedRun, setPreparedRun] = useState<PreparedLocalWorkbenchRun | null>(null);
  const [resultSummary, setResultSummary] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.project === project) || null,
    [project, workspaces],
  );

  useEffect(() => {
    void refreshWorkspaces();
    void refreshLocalRuns();
  }, []);

  useEffect(() => {
    if (!project && projects[0]) {
      setProject(projects[0]);
    }
  }, [project, projects]);

  useEffect(() => {
    if (currentWorkspace) {
      setWorkspacePath(currentWorkspace.workspacePath);
      setTrusted(currentWorkspace.trusted);
      setNotes(currentWorkspace.notes || '');
    } else {
      setWorkspacePath('');
      setTrusted(false);
      setNotes('');
    }
  }, [currentWorkspace]);

  async function refreshWorkspaces() {
    const response = await window.vaultAPI.listProjectWorkspaces();
    if (!response.success || !response.data) {
      setMessage(response.error || 'Failed to load workspaces.');
      return;
    }
    setWorkspaces(response.data);
  }

  async function refreshLocalRuns() {
    const response = await window.vaultAPI.listLocalWorkbenchRuns();
    if (!response.success || !response.data) {
      setMessage(response.error || 'Failed to load local agent runs.');
      return;
    }
    setRecentRuns(response.data);
  }

  async function saveWorkspace() {
    if (!project.trim() || !workspacePath.trim()) {
      setMessage('Choose a project and an absolute workspace path.');
      return;
    }

    setBusy(true);
    try {
      const response = await window.vaultAPI.setProjectWorkspace({
        project,
        workspacePath,
        trusted,
        notes,
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to save workspace.');
      }
      setMessage(`Workspace saved for ${response.data.project}.`);
      await refreshWorkspaces();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save workspace.');
    } finally {
      setBusy(false);
    }
  }

  async function prepareRun() {
    if (!project.trim() || !title.trim() || !prompt.trim()) {
      setMessage('Choose a project, title the task, and write the local-agent request.');
      return;
    }

    setBusy(true);
    try {
      const response = await window.vaultAPI.prepareLocalWorkbenchRun({
        project,
        title,
        prompt,
        adapterType,
        model,
        effort,
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to prepare local run.');
      }
      setPreparedRun(response.data);
      setMessage('Local agent run prepared.');
      await refreshLocalRuns();
      onRunsChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to prepare local agent run.');
    } finally {
      setBusy(false);
    }
  }

  async function launchPreparedRun() {
    if (!preparedRun) {
      setMessage('Prepare a local agent run before launching a terminal.');
      return;
    }

    setBusy(true);
    try {
      const response = await window.vaultAPI.launchLocalWorkbenchRun({ runId: preparedRun.runId });
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to launch local agent terminal.');
      }

      setMessage(`Started ${getAdapterLabel(response.data.adapterType)} in an external terminal.`);
      await refreshLocalRuns();
      onRunsChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to launch local agent terminal.');
    } finally {
      setBusy(false);
    }
  }

  async function copyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(successMessage);
    } catch {
      setMessage('Clipboard copy failed.');
    }
  }

  async function saveResultMemory() {
    if (!preparedRun || !resultSummary.trim()) {
      setMessage('Prepare a run and paste the result summary first.');
      return;
    }

    const response = await window.vaultAPI.saveLocalWorkbenchRunResult({
      runId: preparedRun.runId,
      summary: resultSummary.trim(),
    });

    if (!response.success || !response.data) {
      setMessage(response.error || 'Failed to save result memory.');
      return;
    }

    setMessage(`Saved result memory ${response.data.memory.item.itemUid}.`);
    setResultSummary('');
    await refreshLocalRuns();
    onRunsChanged?.();
  }

  const messageLooksBad = message.toLowerCase().includes('failed') || message.toLowerCase().includes('required');
  const currentRunState = preparedRun
    ? recentRuns.find((run) => run.runId === preparedRun.runId) || null
    : null;

  return (
    <div className="agent-workbench-grid">
      <section className="panel agent-workbench-panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Project workspace</div>
            <div className="panel-subtitle">A trusted absolute repo path tells Codex or Claude where the terminal should start.</div>
          </div>
          <FolderGit2 size={18} />
        </div>

        <label className="field-row">
          <span className="field-label">Project</span>
          <select className="text-input" value={project} onChange={(event) => setProject(event.target.value)}>
            {projects.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>

        <label className="field-row">
          <span className="field-label">Repository path</span>
          <input
            className="text-input"
            value={workspacePath}
            onChange={(event) => setWorkspacePath(event.target.value)}
            placeholder="C:\\Users\\Mini\\Desktop\\Projects\\the-vault"
          />
        </label>

        <label className="toggle-row">
          <span>
            <span className="field-label">Trusted workspace</span>
            <span className="field-help">Required before Vault prepares a launch command.</span>
          </span>
          <input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} />
        </label>

        <label className="field-row">
          <span className="field-label">Notes</span>
          <input
            className="text-input"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Main repo, release branch, or worktree purpose"
          />
        </label>

        <div className="inline-actions">
          <button type="button" className="header-button" onClick={() => void refreshWorkspaces()} disabled={busy}>
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
          <button type="button" className="primary-button" onClick={() => void saveWorkspace()} disabled={busy}>
            <ShieldCheck size={14} />
            <span>Save workspace</span>
          </button>
        </div>
      </section>

      <section className="panel agent-workbench-panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Local run setup</div>
            <div className="panel-subtitle">Prepare Vault context, then start the selected local client in its own terminal.</div>
          </div>
          <Terminal size={18} />
        </div>

        <label className="field-row">
          <span className="field-label">Task title</span>
          <input
            className="text-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Tighten the local agent workflow"
          />
        </label>

        <label className="field-row">
          <span className="field-label">Request</span>
          <textarea
            className="text-area-input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={6}
            placeholder="Describe the task for Codex or Claude. Vault will prepend the project context pack."
          />
        </label>

        <div className="agent-workbench-form-grid">
          <label className="field-row">
            <span className="field-label">Client</span>
            <select className="text-input" value={adapterType} onChange={(event) => setAdapterType(event.target.value as LocalAdapterType)}>
              <option value="codex_local">Codex CLI</option>
              <option value="claude_local">Claude Code</option>
            </select>
          </label>
          <label className="field-row">
            <span className="field-label">Model</span>
            <input
              className="text-input"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={adapterType === 'codex_local' ? 'gpt-5.2' : 'claude-sonnet-4-5'}
            />
          </label>
        </div>

        {adapterType === 'codex_local' ? (
          <label className="field-row">
            <span className="field-label">Reasoning effort</span>
            <input className="text-input" value={effort} onChange={(event) => setEffort(event.target.value)} placeholder="medium" />
          </label>
        ) : null}

        <button type="button" className="primary-button" onClick={() => void prepareRun()} disabled={busy}>
          <Play size={14} />
          <span>{busy ? 'Preparing...' : 'Prepare agent run'}</span>
        </button>
      </section>

      <section className="panel agent-workbench-panel agent-workbench-wide">
        <div className="panel-header">
          <div>
            <div className="panel-title">Prepared context</div>
            <div className="panel-subtitle">Review what Vault will give the local client, then start the terminal run.</div>
          </div>
          {preparedRun ? <CheckCircle2 size={18} /> : <Database size={18} />}
        </div>

        {preparedRun ? (
          <>
            <div className="detail-grid">
              <span><span className="detail-label">Run</span><strong>{preparedRun.runId}</strong></span>
              <span><span className="detail-label">Workspace</span><strong>{preparedRun.workspace.workspacePath}</strong></span>
              <span><span className="detail-label">Context file</span><strong>{preparedRun.contextPackPath}</strong></span>
              <span><span className="detail-label">Status</span><strong>{currentRunState?.status || 'prepared'}</strong></span>
            </div>
            <pre className="agent-workbench-preview">{preparedRun.contextPack.markdown || 'No Vault context matched this request.'}</pre>
            <div className="inline-actions">
              <button type="button" className="primary-button" onClick={() => void launchPreparedRun()} disabled={busy}>
                <Play size={14} />
                <span>{busy ? 'Starting...' : `Start ${getAdapterLabel(preparedRun.launch.adapterType)}`}</span>
              </button>
              <button type="button" className="header-button" onClick={() => void copyText(preparedRun.contextPack.markdown || 'No Vault context matched this request.', 'Context copied.')}>
                <Clipboard size={14} />
                <span>Copy context</span>
              </button>
              <button type="button" className="header-button" onClick={() => void copyText(preparedRun.launch.displayCommand, 'Launch command copied.')}>
                <Terminal size={14} />
                <span>Copy command</span>
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">Prepare a local agent run to preview the context pack and start command.</div>
        )}
      </section>

      <section className="panel agent-workbench-panel agent-workbench-wide">
        <div className="panel-header">
          <div>
            <div className="panel-title">Local agent runs</div>
            <div className="panel-subtitle">Prepared, launched, and completed Codex or Claude terminal runs.</div>
          </div>
          <Clock3 size={18} />
        </div>

        {recentRuns.length === 0 ? (
          <div className="empty-state">No local agent runs have been prepared yet.</div>
        ) : (
          <div className="local-agent-run-list">
            {recentRuns.map((run) => (
              <div key={run.runId} className="local-agent-run-row">
                <span className={`queue-status-rail ${getRunStatusRailClass(run.status)}`} />
                <div className="local-agent-run-main">
                  <div className="queue-task-title-row">
                    <span className="queue-task-title">{run.title}</span>
                    <span className={`badge ${getRunBadgeClass(run.status)}`}>{run.status || 'prepared'}</span>
                  </div>
                  <div className="queue-task-meta">
                    <span>{run.project}</span>
                    <span>{getAdapterLabel(run.adapterType)}</span>
                    <span>{formatRunTime(run.updatedAt || run.createdAt)}</span>
                    {run.resultMemoryUid ? <span>{run.resultMemoryUid}</span> : null}
                  </div>
                </div>
                <button type="button" className="header-button" onClick={() => void copyText(run.displayCommand || '', 'Launch command copied.')} disabled={!run.displayCommand}>
                  <Clipboard size={14} />
                  <span>Command</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel agent-workbench-panel agent-workbench-wide">
        <div className="panel-header">
          <div>
            <div className="panel-title">Capture result</div>
            <div className="panel-subtitle">Paste the terminal outcome back into Vault when the local agent run finishes.</div>
          </div>
          <Save size={18} />
        </div>
        <textarea
          className="text-area-input"
          value={resultSummary}
          onChange={(event) => setResultSummary(event.target.value)}
          rows={5}
          placeholder="Paste the completed local agent result or handoff summary..."
        />
        <div className="inline-actions">
          <button type="button" className="primary-button" onClick={() => void saveResultMemory()} disabled={!preparedRun || !resultSummary.trim()}>
            <Save size={14} />
            <span>Save result memory</span>
          </button>
        </div>
        {message ? (
          <div className={`agent-workbench-status ${messageLooksBad ? 'agent-workbench-status-error' : 'agent-workbench-status-ok'}`}>
            {messageLooksBad ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
            <span>{message}</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function getAdapterLabel(type: LocalAdapterType): string {
  return type === 'claude_local' ? 'Claude Code' : 'Codex CLI';
}

function getRunBadgeClass(status: LocalWorkbenchRunStatus | undefined): string {
  switch (status) {
    case 'completed':
      return 'badge-task-complete';
    case 'launched':
      return 'badge-task-running';
    case 'prepared':
    default:
      return 'badge-task-pending';
  }
}

function getRunStatusRailClass(status: LocalWorkbenchRunStatus | undefined): string {
  switch (status) {
    case 'completed':
      return 'queue-status-rail-completed';
    case 'launched':
      return 'queue-status-rail-running';
    case 'prepared':
    default:
      return 'queue-status-rail-pending';
  }
}

function formatRunTime(value: string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }

  return new Date(value).toLocaleString();
}
