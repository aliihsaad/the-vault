import { Eye, Route, Users } from 'lucide-react';

import type {
  VaultCollabRosterAgent,
  VaultCollabRoleGroup,
  VaultCollabSelectedRoleProfile,
} from '../../vault-collab-view-model.js';
import { getVaultCollabAgentsTabCount } from '../../vault-collab-view-model.js';
import claudeIconUrl from '../../../../../assets/claude-color.svg';
import codexIconUrl from '../../../../../assets/codex-color.svg';
import { RoleProfileModal } from './RoleProfileModal.js';
import { SessionHudCard } from './SessionHudCard.js';

interface RosterProps {
  groups: VaultCollabRoleGroup[];
  selectedRoleProfile: VaultCollabSelectedRoleProfile | null;
  selectedRoleProfileId: string | null;
  showInactiveSessions: boolean;
  onSelectRoleProfile: (roleProfileId: string) => void;
  onCloseRoleProfile: () => void;
  onShowInactiveSessionsChange: (showInactiveSessions: boolean) => void;
  onSelectHandoff: (handoffUid: string) => void;
}

export function Roster({
  groups,
  selectedRoleProfile,
  selectedRoleProfileId,
  showInactiveSessions,
  onSelectRoleProfile,
  onCloseRoleProfile,
  onShowInactiveSessionsChange,
  onSelectHandoff,
}: RosterProps) {
  const count = getVaultCollabAgentsTabCount(groups);
  const selectedOfficeAgents = selectedRoleProfile
    ? groups.find((group) => group.roleProfileId === selectedRoleProfile.roleProfileId)?.agents ?? []
    : [];

  return (
    <section className="vault-collab-zone vault-collab-roster-zone" aria-label="Agent offices">
      <div className="vault-collab-zone-header">
        <div>
          <strong>Agents</strong>
          <span>{count} live / {groups.length} offices</span>
        </div>
        <div className="vault-collab-zone-header-actions">
          <label className="vault-collab-show-inactive-toggle">
            <input
              type="checkbox"
              checked={showInactiveSessions}
              onChange={(event) => onShowInactiveSessionsChange(event.currentTarget.checked)}
            />
            <span>Show inactive</span>
          </label>
          <Users size={18} />
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">No live agents.</div>
      ) : (
        <div className="vault-collab-office-layout">
          <div className="vault-collab-office-lanes">
            {groups.map((group, index) => (
              <button
                key={group.key}
                type="button"
                className={`vault-collab-office-lane vault-collab-office-lane-${index % 13} ${selectedRoleProfileId && selectedRoleProfileId === group.roleProfileId ? 'vault-collab-office-lane-active' : ''}`}
                onClick={() => group.roleProfileId ? onSelectRoleProfile(group.roleProfileId) : undefined}
              >
                <span className="vault-collab-office-lane-head">
                  <strong>{group.roleDisplayName}</strong>
                  <span>{group.agents.length} / {group.handoffs.length}</span>
                </span>
                <span className="vault-collab-office-lane-meta">
                  {group.mutationLabel ? <span>{group.mutationLabel}</span> : <span>{group.role}</span>}
                  {group.isWatchdog ? (
                    <span className="vault-collab-watchdog-pill">
                      <Eye size={13} />
                      Watchdog
                    </span>
                  ) : null}
                </span>
                {group.agents.length > 0 ? (
                  <span className="vault-collab-office-agent-stack">
                    {group.agents.slice(0, 3).map((agent) => (
                      <span key={agent.sessionUid} className="vault-collab-office-agent-pill">
                        <AgentClientIcon agent={agent} />
                        {agent.displayName}
                      </span>
                    ))}
                    {group.agents.length > 3 ? <span className="vault-collab-office-agent-pill">+{group.agents.length - 3}</span> : null}
                  </span>
                ) : (
                  <span className="vault-collab-office-empty">No live agent</span>
                )}
              </button>
            ))}
          </div>

          <div className="vault-collab-roster-groups">
            {groups.filter((group) => group.agents.length > 0).map((group) => (
              <div key={group.key} className="vault-collab-roster-group">
                <div className="vault-collab-group-label">
                  <span>{group.roleDisplayName}</span>
                  <span>{group.agents.length}</span>
                </div>
                {group.agents.map((agent) => (
                  <SessionHudCard
                    key={agent.sessionUid}
                    agent={agent}
                    onSelectHandoff={onSelectHandoff}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="vault-collab-office-routing">
            <div className="detail-section-title">
              <Route size={15} />
              <span>Routed handoffs</span>
            </div>
            {groups.some((group) => group.handoffs.length > 0) ? (
              <div className="vault-collab-office-handoff-list">
                {groups.flatMap((group) => group.handoffs.map((handoff) => (
                  <span key={`${group.key}:${handoff.uid}`} className="vault-collab-office-handoff-pill">
                    <strong>{group.roleDisplayName}</strong>
                    <span>{handoff.title}</span>
                  </span>
                )))}
              </div>
            ) : (
              <div className="empty-state">No role-routed handoffs.</div>
            )}
          </div>

          <RoleProfileModal
            roleProfile={selectedRoleProfile}
            agents={selectedOfficeAgents}
            onClose={onCloseRoleProfile}
          />
        </div>
      )}
    </section>
  );
}

function AgentClientIcon({ agent }: { agent: VaultCollabRosterAgent }) {
  const iconUrl = getAgentIconUrl(agent);
  if (iconUrl) {
    return (
      <img
        className="vault-collab-agent-client-icon"
        src={iconUrl}
        alt=""
        aria-hidden="true"
      />
    );
  }

  return <span className="vault-collab-agent-client-fallback">{agent.displayName.slice(0, 2)}</span>;
}

function getAgentIconUrl(agent: VaultCollabRosterAgent): string | null {
  if (agent.clientType === 'codex') {
    return codexIconUrl;
  }

  if (agent.clientType === 'claude-code' || agent.clientType === 'claude-desktop') {
    return claudeIconUrl;
  }

  return null;
}
