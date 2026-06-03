import { Activity, Eye, Route, Users } from 'lucide-react';

import type {
  VaultCollabRosterAgent,
  VaultCollabRoleGroup,
  VaultCollabSelectedRoleProfile,
} from '../../vault-collab-view-model.js';
import claudeIconUrl from '../../../../../assets/claude-color.svg';
import codexIconUrl from '../../../../../assets/codex-color.svg';

interface RosterProps {
  groups: VaultCollabRoleGroup[];
  selectedRoleProfile: VaultCollabSelectedRoleProfile | null;
  selectedRoleProfileId: string | null;
  onSelectRoleProfile: (roleProfileId: string) => void;
}

export function Roster({
  groups,
  selectedRoleProfile,
  selectedRoleProfileId,
  onSelectRoleProfile,
}: RosterProps) {
  const count = groups.reduce((total, group) => total + group.agents.length, 0);

  return (
    <section className="vault-collab-zone vault-collab-roster-zone" aria-label="Agent offices">
      <div className="vault-collab-zone-header">
        <div>
          <strong>Agents</strong>
          <span>{count} live / {groups.length} offices</span>
        </div>
        <Users size={18} />
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
                className={`vault-collab-office-lane vault-collab-office-lane-${index % 13} ${selectedRoleProfileId === group.roleProfileId ? 'vault-collab-office-lane-active' : ''}`}
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

          <div className="vault-collab-role-profile-panel">
            {selectedRoleProfile ? (
              <>
                <div className="vault-collab-role-profile-head">
                  <div>
                    <strong>{selectedRoleProfile.displayName}</strong>
                    <span>{selectedRoleProfile.mutationLabel}</span>
                  </div>
                  {selectedRoleProfile.isWatchdog ? (
                    <span className="vault-collab-watchdog-pill">
                      <Eye size={13} />
                      Watchdog
                    </span>
                  ) : (
                    <Activity size={16} />
                  )}
                </div>
                <p>{selectedRoleProfile.purpose}</p>
                <ChipBlock title="Capabilities" chips={selectedRoleProfile.capabilities} />
                <ChipBlock title="Triggers" chips={selectedRoleProfile.triggerLabels} />
                <ChipBlock title="Next roles" chips={selectedRoleProfile.suggestedNextRoleLabels} />
                <ChipBlock title="Primary ECC skills" chips={selectedRoleProfile.primarySkillNames} />
                <ChipBlock title="Secondary ECC skills" chips={selectedRoleProfile.secondarySkillNames} muted />
              </>
            ) : (
              <div className="empty-state">No role profile selected.</div>
            )}
          </div>

          <div className="vault-collab-roster-groups">
            {groups.filter((group) => group.agents.length > 0).map((group) => (
              <div key={group.key} className="vault-collab-roster-group">
                <div className="vault-collab-group-label">
                  <span>{group.roleDisplayName}</span>
                  <span>{group.agents.length}</span>
                </div>
                {group.agents.map((agent) => (
                  <div key={agent.sessionUid} className="vault-collab-agent-row">
                    <span className="vault-collab-client-dot">
                      <AgentClientIcon agent={agent} />
                    </span>
                    <div className="vault-collab-roster-main">
                      <div className="vault-collab-row-title">
                        <strong>{agent.displayName}</strong>
                        <span className={`badge ${agent.status === 'working' ? 'badge-task-running' : agent.status === 'blocked' ? 'badge-task-fail' : 'badge-task-pending'}`}>
                          {agent.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="vault-collab-row-meta">
                        <span>{agent.roleLabel}</span>
                        {agent.currentHandoffUid ? <span className="text-mono">{shortId(agent.currentHandoffUid)}</span> : <span>unassigned</span>}
                        <span className="vault-collab-connection-pill vault-collab-connection-fresh">{agent.freshness}</span>
                      </div>
                    </div>
                  </div>
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
  return value.length > 14 ? `${value.slice(0, 14)}...` : value;
}
