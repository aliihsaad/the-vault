import { useEffect } from 'react';
import { Activity, Eye, X } from 'lucide-react';

import type { VaultCollabRosterAgent, VaultCollabSelectedRoleProfile } from '../../vault-collab-view-model.js';
import { SessionAdapterChip, SyncIndicator } from './SessionHudCard.js';

interface RoleProfileModalProps {
  roleProfile: VaultCollabSelectedRoleProfile | null;
  agents?: VaultCollabRosterAgent[];
  onClose: () => void;
}

export function RoleProfileModal({ roleProfile, agents = [], onClose }: RoleProfileModalProps) {
  useEffect(() => {
    if (!roleProfile) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [roleProfile, onClose]);

  if (!roleProfile) {
    return null;
  }

  const titleId = `vault-collab-role-profile-modal-title-${roleProfile.roleProfileId}`;

  return (
    <div className="vault-collab-role-profile-modal-backdrop" onClick={onClose}>
      <section
        className="vault-collab-role-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="vault-collab-role-profile-modal-header">
          <div>
            <span>Office</span>
            <strong id={titleId}>{roleProfile.displayName}</strong>
          </div>
          <div className="vault-collab-role-profile-modal-actions">
            {roleProfile.isWatchdog ? (
              <span className="vault-collab-watchdog-pill">
                <Eye size={13} />
                Watchdog
              </span>
            ) : (
              <Activity size={16} />
            )}
            <button
              type="button"
              className="header-button icon-only-button vault-collab-role-profile-modal-close"
              onClick={onClose}
              title="Close office detail"
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="vault-collab-role-profile-modal-body">
          <p>{roleProfile.purpose}</p>
          <ChipBlock title="Capabilities" chips={roleProfile.capabilities} />
          <ChipBlock title="Triggers" chips={roleProfile.triggerLabels} />
          <ChipBlock title="Next roles" chips={roleProfile.suggestedNextRoleLabels} />
          <ChipBlock title="Primary ECC skills" chips={roleProfile.primarySkillNames} />
          <ChipBlock title="Secondary ECC skills" chips={roleProfile.secondarySkillNames} muted />
          <ConnectedAgents agents={agents} />
        </div>
      </section>
    </div>
  );
}

function ConnectedAgents({ agents }: { agents: VaultCollabRosterAgent[] }) {
  return (
    <div className="vault-collab-office-modal-agents">
      <span>Connected agents</span>
      {agents.length === 0 ? (
        <div className="empty-state">No connected agents.</div>
      ) : (
        <div className="vault-collab-office-modal-agent-list">
          {agents.map((agent) => (
            <div key={agent.sessionUid} className="vault-collab-office-modal-agent">
              <div className="vault-collab-office-modal-agent-head">
                <strong>{agent.displayName}</strong>
                {agent.hud.hasSnapshot ? (
                  <SessionAdapterChip adapter={agent.hud.adapter} />
                ) : (
                  <span className="badge badge-task-pending">{agent.clientType}</span>
                )}
              </div>
              <div className="vault-collab-office-modal-agent-meta">
                <span>{agent.roleLabel}</span>
                <span>{agent.status.replace(/_/g, ' ')}</span>
                {agent.currentHandoffUid ? (
                  <span className="text-mono">{shortId(agent.currentHandoffUid)}</span>
                ) : (
                  <span>unassigned</span>
                )}
                <span className={`vault-collab-connection-pill ${agent.freshness === 'fresh' ? 'vault-collab-connection-fresh' : 'vault-collab-connection-stale'}`}>
                  {agent.freshness}
                </span>
              </div>
              {agent.hud.hasSnapshot ? (
                <div className="vault-collab-office-modal-agent-hud">
                  <span>{agent.hud.context.providerLabel}</span>
                  <span>{agent.hud.context.modelLabel}</span>
                  <span>{agent.hud.progress.taskLabel}</span>
                  <SyncIndicator sync={agent.hud.sync} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChipBlock({ title, chips, muted = false }: { title: string; chips: string[]; muted?: boolean }) {
  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="vault-collab-role-chip-block">
      <span>{title}</span>
      <div className="chip-row">
        {chips.map((chip) => (
          <span key={`${title}:${chip}`} className={`chip ${muted ? 'chip-muted' : ''}`}>{chip}</span>
        ))}
      </div>
    </div>
  );
}

function shortId(value: string): string {
  return value.length > 13 ? `${value.slice(0, 10)}...` : value;
}
