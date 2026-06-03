import { useEffect } from 'react';
import { Activity, Eye, X } from 'lucide-react';

import type { VaultCollabSelectedRoleProfile } from '../../vault-collab-view-model.js';

interface RoleProfileModalProps {
  roleProfile: VaultCollabSelectedRoleProfile | null;
  onClose: () => void;
}

export function RoleProfileModal({ roleProfile, onClose }: RoleProfileModalProps) {
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
        </div>
      </section>
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
