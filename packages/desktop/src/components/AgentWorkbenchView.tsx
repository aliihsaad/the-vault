import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
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
};

export function AgentWorkbenchView({ projects, adapterConfig }: Props) {
  const [workspaces, setWorkspaces] = useState<ProjectWorkspaceConfig[]>([]);
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
      setMessage('Local run prepared.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to prepare local run.');
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

    const resultAdapter = preparedRun.launch.adapterType;
    const response = await window.vaultAPI.saveMemory({
      project: preparedRun.project,
      title: `${preparedRun.title} - local ${resultAdapter === 'codex_local' ? 'Codex' : 'Claude'} result`,
      memoryType: 'session',
      subject: preparedRun.title,
      summary: resultSummary.trim(),
      content: [
        `Local workbench run: ${preparedRun.runId}`,
        `Adapter: ${resultAdapter}`,
        `Workspace: ${preparedRun.workspace.workspacePath}`,
        `Context pack: ${preparedRun.contextPackPath}`,
        `Launch: ${preparedRun.launch.displayCommand}`,
        '',
        resultSummary.trim(),
      ].join('\n'),
      sourceApp: 'manual',
      keywords: ['local-workbench', resultAdapter, preparedRun.project, preparedRun.runId],
      relatedFiles: [preparedRun.workspace.workspacePath, preparedRun.contextPackPath],
    });

    if (!response.success || !response.data) {
      setMessage(response.error || 'Failed to save result memory.');
      return;
    }

    setMessage(`Saved result memory ${response.data.item.itemUid}.`);
    setResultSummary('');
  }

  const messageLooksBad = message.toLowerCase().includes('failed') || message.toLowerCase().includes('required');

  return (
    <div className="agent-workbench-grid">
      <section className="panel agent-workbench-panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Project workspace</div>
            <div className="panel-subtitle">A trusted absolute repo path tells Codex or Claude where to work.</div>
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
            <div className="panel-subtitle">Prepare one context pack and one command for the selected local client.</div>
          </div>
          <Terminal size={18} />
        </div>

        <label className="field-row">
          <span className="field-label">Task title</span>
          <input
            className="text-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Plan the local client workbench"
          />
        </label>

        <label className="field-row">
          <span className="field-label">Request</span>
          <textarea
            className="text-area-input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={6}
            placeholder="Describe the task for Codex or Claude..."
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
          <span>{busy ? 'Preparing...' : 'Prepare local run'}</span>
        </button>
      </section>

      <section className="panel agent-workbench-panel agent-workbench-wide">
        <div className="panel-header">
          <div>
            <div className="panel-title">Prepared context</div>
            <div className="panel-subtitle">Review what Vault will give the local client before launching it.</div>
          </div>
          {preparedRun ? <CheckCircle2 size={18} /> : <Database size={18} />}
        </div>

        {preparedRun ? (
          <>
            <div className="detail-grid">
              <span><span className="detail-label">Run</span><strong>{preparedRun.runId}</strong></span>
              <span><span className="detail-label">Workspace</span><strong>{preparedRun.workspace.workspacePath}</strong></span>
              <span><span className="detail-label">Context file</span><strong>{preparedRun.contextPackPath}</strong></span>
            </div>
            <pre className="agent-workbench-preview">{preparedRun.contextPack.markdown || 'No Vault context matched this request.'}</pre>
            <div className="inline-actions">
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
          <div className="empty-state">Prepare a local run to preview the context pack and command.</div>
        )}
      </section>

      <section className="panel agent-workbench-panel agent-workbench-wide">
        <div className="panel-header">
          <div>
            <div className="panel-title">Capture result</div>
            <div className="panel-subtitle">Paste the local client outcome back into Vault when the terminal run finishes.</div>
          </div>
          <Save size={18} />
        </div>
        <textarea
          className="text-area-input"
          value={resultSummary}
          onChange={(event) => setResultSummary(event.target.value)}
          rows={5}
          placeholder="Paste the completed local-agent result or handoff summary..."
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
