import { ShieldCheck } from 'lucide-react';

import type {
  VaultCollabPolicyPackRow,
  VaultCollabPolicyPanelModel,
} from '../../vault-collab-view-model.js';

interface PolicyPanelProps {
  panel: VaultCollabPolicyPanelModel;
  busyUid: string | null;
  onTogglePack: (pack: VaultCollabPolicyPackRow) => void;
}

export function PolicyPanel({ panel, busyUid, onTogglePack }: PolicyPanelProps) {
  return (
    <section className="vault-collab-zone vault-collab-policy-zone" aria-label="Policy packs">
      <div className="vault-collab-zone-header">
        <div>
          <strong>Policy</strong>
          <span>{panel.packs.length} packs</span>
        </div>
        <ShieldCheck size={18} />
      </div>

      <div className="vault-collab-zone-scroll vault-collab-policy-list">
        {panel.packs.length === 0 ? (
          <div className="empty-state">No policy packs.</div>
        ) : panel.packs.map((pack) => (
          <div key={pack.uid} className="vault-collab-policy-row">
            <div>
              <span className="vault-collab-row-title">
                <strong>{pack.name}</strong>
                {pack.builtInBadge ? <span className="badge badge-recall">{pack.builtInBadge}</span> : null}
              </span>
              <span className={`vault-collab-policy-state ${pack.active ? 'vault-collab-policy-state-active' : ''}`}>
                {pack.active ? 'active' : 'inactive'}
              </span>
            </div>
            <button
              type="button"
              className="header-button"
              disabled={busyUid === pack.uid}
              onClick={() => onTogglePack(pack)}
            >
              {busyUid === pack.uid ? 'Working' : pack.toggleAction === 'activate' ? 'Activate' : 'Disable'}
            </button>
          </div>
        ))}

        {panel.recentEvents.length > 0 ? (
          <div className="vault-collab-policy-events">
            {panel.recentEvents.slice(0, 3).map((event) => (
              <span key={event.id}>
                <strong>{event.type}</strong>
                <span>{event.summary}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
