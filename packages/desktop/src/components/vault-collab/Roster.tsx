import { Users } from 'lucide-react';

import type { VaultCollabRoleGroup } from '../../vault-collab-view-model.js';

interface RosterProps {
  groups: VaultCollabRoleGroup[];
}

export function Roster({ groups }: RosterProps) {
  const count = groups.reduce((total, group) => total + group.agents.length, 0);

  return (
    <section className="vault-collab-zone vault-collab-roster-zone" aria-label="Agents by role">
      <div className="vault-collab-zone-header">
        <div>
          <strong>Agents</strong>
          <span>{count} live / {groups.length} roles</span>
        </div>
        <Users size={18} />
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">No live agents.</div>
      ) : (
        <div className="vault-collab-roster-groups">
          {groups.map((group) => (
            <div key={group.role} className="vault-collab-roster-group">
              <div className="vault-collab-group-label">
                <span>{group.role}</span>
                <span>{group.agents.length}</span>
              </div>
              {group.agents.map((agent) => (
                <div key={agent.sessionUid} className="vault-collab-agent-row">
                  <span className="vault-collab-client-dot">{agent.displayName.slice(0, 2)}</span>
                  <div className="vault-collab-roster-main">
                    <div className="vault-collab-row-title">
                      <strong>{agent.displayName}</strong>
                      <span className={`badge ${agent.status === 'working' ? 'badge-task-running' : agent.status === 'blocked' ? 'badge-task-fail' : 'badge-task-pending'}`}>
                        {agent.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="vault-collab-row-meta">
                      {agent.currentHandoffUid ? <span className="text-mono">{shortId(agent.currentHandoffUid)}</span> : <span>unassigned</span>}
                      <span className="vault-collab-connection-pill vault-collab-connection-fresh">{agent.freshness}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}...` : value;
}
