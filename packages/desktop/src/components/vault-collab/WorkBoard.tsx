import { Clock3, Inbox } from 'lucide-react';

import type { VaultCollabWorkColumn } from '../../vault-collab-view-model.js';

interface WorkBoardProps {
  columns: VaultCollabWorkColumn[];
  selectedHandoffUid: string | null;
  onSelectHandoff: (handoffUid: string) => void;
}

export function WorkBoard({ columns, selectedHandoffUid, onSelectHandoff }: WorkBoardProps) {
  const count = columns.reduce((total, column) => total + column.cards.length, 0);

  return (
    <section className="vault-collab-zone vault-collab-work-zone" aria-label="Work by state">
      <div className="vault-collab-zone-header">
        <div>
          <strong>Work</strong>
          <span>{count} handoffs</span>
        </div>
        <Inbox size={18} />
      </div>

      <div className="vault-collab-work-columns">
        {columns.map((column) => (
          <div key={column.state} className="vault-collab-work-column">
            <div className="vault-collab-group-label">
              <span>{column.label}</span>
              <span>{column.cards.length}</span>
            </div>
            {column.cards.length === 0 ? (
              <div className="vault-collab-work-empty">Empty</div>
            ) : column.cards.map((card) => (
              <button
                key={card.uid}
                type="button"
                className={`vault-collab-work-card ${selectedHandoffUid === card.uid ? 'vault-collab-work-card-active' : ''}`}
                onClick={() => onSelectHandoff(card.uid)}
              >
                <span className={`queue-status-rail ${card.railClass}`} />
                <span className="vault-collab-work-card-main">
                  <span className="vault-collab-row-title">
                    <strong>{card.prompt}</strong>
                    <span className={`badge ${card.badgeClass}`}>{card.statusLabel}</span>
                  </span>
                  <span className="vault-collab-row-meta">
                    <span className="text-mono">{card.queueLabel}</span>
                    <span>{card.priorityLabel}</span>
                    {card.threadLabel ? <span>{card.threadLabel}</span> : null}
                  </span>
                  <span className="vault-collab-age">
                    <Clock3 size={13} />
                    {card.ageLabel}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
