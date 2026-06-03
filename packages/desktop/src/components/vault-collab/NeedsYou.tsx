import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Rocket, UserPlus, X } from 'lucide-react';

import type {
  VaultCollabLaunchRequestRow,
  VaultCollabNeedsYouItem,
} from '../../vault-collab-view-model.js';

interface NeedsYouProps {
  items: VaultCollabNeedsYouItem[];
  launchRequests: VaultCollabLaunchRequestRow[];
  actionBusy: string | null;
  projectOptions: RequestAgentProjectOption[];
  roleOptions: RequestAgentRoleOption[];
  defaultProject: string;
  defaultWorkspacePath: string;
  onRequestAgent: (input: RequestAgentInput) => void;
  onLaunchAction: (action: string, launchRequestUid: string) => void;
  onHandoffAction: (action: string, handoffUid: string) => void;
  onCopyLaunchCommand: (launchRequestUid: string, command: string) => void;
}

interface RequestAgentProjectOption {
  project: string;
  workspacePath: string;
}

interface RequestAgentRoleOption {
  role: string;
  label: string;
}

interface RequestAgentInput {
  role: string;
  provider: 'codex' | 'claude-code';
  project: string;
  workspacePath: string;
  instructions: string;
}

const REQUEST_AGENT_PROVIDERS: Array<{ provider: RequestAgentInput['provider']; label: string }> = [
  { provider: 'codex', label: 'codex' },
  { provider: 'claude-code', label: 'claude-code' },
];

export function NeedsYou({
  items,
  launchRequests,
  actionBusy,
  projectOptions,
  roleOptions,
  defaultProject,
  defaultWorkspacePath,
  onRequestAgent,
  onLaunchAction,
  onHandoffAction,
  onCopyLaunchCommand,
}: NeedsYouProps) {
  const [requestFormOpen, setRequestFormOpen] = useState(false);

  return (
    <section className="vault-collab-needs-you" aria-label="Needs You">
      <div className="vault-collab-zone-header">
        <div>
          <strong>Needs You</strong>
          <span>{items.length === 0 ? 'All clear' : `${items.length} waiting`}</span>
        </div>
        <div className="vault-collab-zone-actions">
          <button
            type="button"
            className="header-button"
            disabled={actionBusy === 'agent-request'}
            onClick={() => setRequestFormOpen(true)}
            title="Request agent"
          >
            <UserPlus size={14} />
            <span>Request agent</span>
          </button>
          {items.length === 0 ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        </div>
      </div>

      <div className="vault-collab-needs-list">
        {items.length === 0 ? (
          <div className="empty-state">All clear.</div>
        ) : items.map((item) => {
            const launchRequest = item.kind === 'launch_approval'
              ? launchRequests.find((request) => request.uid === item.id) ?? null
              : null;

            return (
              <div key={`${item.kind}:${item.id}`} className="vault-collab-need-row">
                <span className="vault-collab-need-icon">
                  {item.kind === 'launch_approval' ? <Rocket size={15} /> : <AlertTriangle size={15} />}
                </span>
                <div className="vault-collab-need-main">
                  <div className="vault-collab-row-title">
                    <strong>{item.title}</strong>
                    <span className="text-mono">{shortId(item.id)}</span>
                  </div>
                  {item.subtitle ? <p>{item.subtitle}</p> : null}
                  {launchRequest?.approvedLaunchCommand ? (
                    <div className="vault-collab-approved-command">
                      <span className="vault-collab-command-preview text-mono">{launchRequest.approvedLaunchCommand}</span>
                      <button
                        type="button"
                        className="header-button"
                        onClick={() => onCopyLaunchCommand(launchRequest.uid, launchRequest.approvedLaunchCommand!)}
                        title="Copy launch command"
                      >
                        <Copy size={14} />
                        <span>Copy</span>
                      </button>
                    </div>
                  ) : null}
                  {item.actions.length > 0 ? (
                    <div className="inline-actions vault-collab-action-row">
                      {item.actions.map((action) => (
                        <button
                          key={action.action}
                          type="button"
                          className={action.tone === 'danger' ? 'danger-button' : action.tone === 'primary' ? 'primary-button' : 'header-button'}
                          disabled={action.disabled || actionBusy === `${item.id}:${action.action}`}
                          title={action.reason ?? action.label}
                          onClick={() => {
                            if (item.kind === 'launch_approval') {
                              onLaunchAction(action.action, item.id);
                            } else {
                              onHandoffAction(action.action, item.id);
                            }
                          }}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
      </div>

      {requestFormOpen ? (
        <RequestAgentModal
          disabled={actionBusy === 'agent-request'}
          projectOptions={projectOptions}
          roleOptions={roleOptions}
          defaultProject={defaultProject}
          defaultWorkspacePath={defaultWorkspacePath}
          onCancel={() => setRequestFormOpen(false)}
          onRequestAgent={onRequestAgent}
        />
      ) : null}
    </section>
  );
}

function RequestAgentModal({
  disabled,
  projectOptions,
  roleOptions,
  defaultProject,
  defaultWorkspacePath,
  onCancel,
  onRequestAgent,
}: {
  disabled: boolean;
  projectOptions: RequestAgentProjectOption[];
  roleOptions: RequestAgentRoleOption[];
  defaultProject: string;
  defaultWorkspacePath: string;
  onCancel: () => void;
  onRequestAgent: (input: RequestAgentInput) => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="vault-collab-request-agent-modal-backdrop" onClick={onCancel}>
      <section
        className="vault-collab-request-agent-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-collab-request-agent-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="vault-collab-request-agent-modal-header">
          <div>
            <span>Runtime</span>
            <strong id="vault-collab-request-agent-modal-title">Request agent</strong>
          </div>
          <button
            type="button"
            className="header-button icon-only-button vault-collab-request-agent-modal-close"
            onClick={onCancel}
            title="Close request agent"
          >
            <X size={15} />
          </button>
        </header>
        <RequestAgentForm
          disabled={disabled}
          projectOptions={projectOptions}
          roleOptions={roleOptions}
          defaultProject={defaultProject}
          defaultWorkspacePath={defaultWorkspacePath}
          onCancel={onCancel}
          onRequestAgent={onRequestAgent}
        />
      </section>
    </div>
  );
}

function RequestAgentForm({
  disabled,
  projectOptions,
  roleOptions,
  defaultProject,
  defaultWorkspacePath,
  onCancel,
  onRequestAgent,
}: {
  disabled: boolean;
  projectOptions: RequestAgentProjectOption[];
  roleOptions: RequestAgentRoleOption[];
  defaultProject: string;
  defaultWorkspacePath: string;
  onCancel: () => void;
  onRequestAgent: (input: RequestAgentInput) => void;
}) {
  const defaultRole = getDefaultRole(roleOptions);
  const [project, setProject] = useState(defaultProject);
  const [workspacePath, setWorkspacePath] = useState(defaultWorkspacePath);
  const [role, setRole] = useState(defaultRole);
  const [provider, setProvider] = useState<RequestAgentInput['provider']>('codex');
  const [agentInstructions, setAgentInstructions] = useState('');
  const projectSelectOptions = project.trim()
    && !projectOptions.some((option) => option.project === project)
    ? [{ project, workspacePath }, ...projectOptions]
    : projectOptions;

  useEffect(() => {
    setProject((current) => current.trim() ? current : defaultProject);
  }, [defaultProject]);

  useEffect(() => {
    setWorkspacePath((current) => current.trim() ? current : defaultWorkspacePath);
  }, [defaultWorkspacePath]);

  useEffect(() => {
    setRole((current) => roleOptions.some((option) => option.role === current) ? current : defaultRole);
  }, [defaultRole, roleOptions]);

  function updateProject(nextProject: string) {
    setProject(nextProject);
    const matchingOption = projectOptions.find((option) => option.project === nextProject);
    if (matchingOption) {
      setWorkspacePath(matchingOption.workspacePath);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedProject = project.trim();
    const trimmedWorkspacePath = workspacePath.trim();
    const trimmedRole = role.trim();
    const trimmedInstructions = agentInstructions.trim();
    if (!trimmedProject || !trimmedWorkspacePath || !trimmedRole || !trimmedInstructions) {
      return;
    }

    onRequestAgent({
      role: trimmedRole,
      provider,
      project: trimmedProject,
      workspacePath: trimmedWorkspacePath,
      instructions: trimmedInstructions,
    });
  }

  return (
    <form className="vault-collab-request-agent-form" onSubmit={submit}>
      <div className="vault-collab-request-agent-provider">
        <UserPlus size={15} />
        <span>{provider}</span>
      </div>
      <label className="field-row">
        <span className="field-label">Project</span>
        <select
          className="text-input"
          value={project}
          onChange={(event) => updateProject(event.target.value)}
        >
          <option value="" disabled>Choose project</option>
          {projectSelectOptions.map((option) => (
            <option key={option.project} value={option.project}>{option.project}</option>
          ))}
        </select>
      </label>
      <label className="field-row">
        <span className="field-label">Workspace</span>
        <input
          className="text-input"
          value={workspacePath}
          onChange={(event) => setWorkspacePath(event.target.value)}
          placeholder="Absolute workspace path"
        />
      </label>
      <label className="field-row">
        <span className="field-label">Role</span>
        <select
          className="text-input"
          value={role}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="" disabled>Choose office</option>
          {roleOptions.map((option) => (
            <option key={option.role} value={option.role}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="field-row">
        <span className="field-label">Provider</span>
        <select
          className="text-input"
          value={provider}
          onChange={(event) => setProvider(event.target.value as RequestAgentInput['provider'])}
        >
          {REQUEST_AGENT_PROVIDERS.map((option) => (
            <option key={option.provider} value={option.provider}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="field-row">
        <span className="field-label">Instructions</span>
        <textarea
          className="text-area-input"
          value={agentInstructions}
          onChange={(event) => setAgentInstructions(event.target.value)}
          rows={3}
        />
      </label>
      <div className="inline-actions vault-collab-action-row">
        <button
          type="submit"
          className="primary-button"
          disabled={disabled || !project.trim() || !workspacePath.trim() || !role.trim() || !agentInstructions.trim()}
        >
          Request agent
        </button>
        <button
          type="button"
          className="header-button"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}...` : value;
}

function getDefaultRole(roleOptions: RequestAgentRoleOption[]): string {
  return roleOptions.find((option) => option.role === 'implementer')?.role
    ?? roleOptions[0]?.role
    ?? '';
}
