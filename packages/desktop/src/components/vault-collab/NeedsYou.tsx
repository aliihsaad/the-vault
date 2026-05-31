import { useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Rocket, UserPlus } from 'lucide-react';

import type {
  VaultCollabLaunchRequestRow,
  VaultCollabNeedsYouItem,
} from '../../vault-collab-view-model.js';

interface NeedsYouProps {
  items: VaultCollabNeedsYouItem[];
  launchRequests: VaultCollabLaunchRequestRow[];
  actionBusy: string | null;
  onRequestAgent: (input: RequestAgentInput) => void;
  onLaunchAction: (action: string, launchRequestUid: string) => void;
  onHandoffAction: (action: string, handoffUid: string) => void;
  onCopyLaunchCommand: (launchRequestUid: string, command: string) => void;
}

interface RequestAgentInput {
  role: string;
  provider: 'codex' | 'claude-code';
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
            onClick={() => setRequestFormOpen((current) => !current)}
            title={requestFormOpen ? 'Hide request form' : 'Request agent'}
          >
            <UserPlus size={14} />
            <span>Request agent</span>
          </button>
          {items.length === 0 ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        </div>
      </div>

      <div className="vault-collab-needs-list">
        {requestFormOpen ? (
          <RequestAgentForm
            disabled={actionBusy === 'agent-request'}
            onCancel={() => setRequestFormOpen(false)}
            onRequestAgent={onRequestAgent}
          />
        ) : null}
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
    </section>
  );
}

function RequestAgentForm({
  disabled,
  onCancel,
  onRequestAgent,
}: {
  disabled: boolean;
  onCancel: () => void;
  onRequestAgent: (input: RequestAgentInput) => void;
}) {
  const [role, setRole] = useState('implementation-worker');
  const [provider, setProvider] = useState<RequestAgentInput['provider']>('codex');
  const [agentInstructions, setAgentInstructions] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedRole = role.trim();
    const trimmedInstructions = agentInstructions.trim();
    if (!trimmedRole || !trimmedInstructions) {
      return;
    }

    onRequestAgent({
      role: trimmedRole,
      provider,
      instructions: trimmedInstructions,
    });
  }

  return (
    <form className="vault-collab-need-row vault-collab-request-agent-form" onSubmit={submit}>
      <span className="vault-collab-need-icon">
        <UserPlus size={15} />
      </span>
      <div className="vault-collab-need-main">
        <div className="vault-collab-row-title">
          <strong>Request agent</strong>
          <span>{provider}</span>
        </div>
        <label className="field-row">
          <span className="field-label">Role</span>
          <input
            className="text-input"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          />
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
            disabled={disabled || !role.trim() || !agentInstructions.trim()}
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
      </div>
    </form>
  );
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}...` : value;
}
