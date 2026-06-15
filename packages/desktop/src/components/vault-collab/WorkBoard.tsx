import { type CSSProperties, useState } from 'react';
import { Clock3, Inbox } from 'lucide-react';

import type {
  VaultCollabConversationEntry,
  VaultCollabSelectedHandoff,
  VaultCollabWorkColumn,
} from '../../vault-collab-view-model.js';
import { HandoffDetailModal } from './HandoffDetailModal.js';

interface WorkBoardProps {
  columns: VaultCollabWorkColumn[];
  selectedHandoffUid: string | null;
  selectedHandoff: VaultCollabSelectedHandoff | null;
  conversation: VaultCollabConversationEntry[];
  discussionDraft: string;
  discussionDisabled: boolean;
  onSelectHandoff: (handoffUid: string) => void;
  onCloseHandoff: () => void;
  onDiscussionDraftChange: (value: string) => void;
  onDiscussionSubmit: () => void;
}

const RESOLVED_CARD_COLLAPSED_LIMIT = 3;

export function WorkBoard({
  columns,
  selectedHandoffUid,
  selectedHandoff,
  conversation,
  discussionDraft,
  discussionDisabled,
  onSelectHandoff,
  onCloseHandoff,
  onDiscussionDraftChange,
  onDiscussionSubmit,
}: WorkBoardProps) {
  const [showAllResolved, setShowAllResolved] = useState(false);
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
        {columns.map((column) => {
          const canCollapseResolved = column.state === 'resolved'
            && column.cards.length > RESOLVED_CARD_COLLAPSED_LIMIT;
          const visibleCards = canCollapseResolved && !showAllResolved
            ? column.cards.slice(0, RESOLVED_CARD_COLLAPSED_LIMIT)
            : column.cards;
          const hiddenResolvedCount = column.cards.length - visibleCards.length;

          return (
            <div key={column.state} className="vault-collab-work-column">
              <div className="vault-collab-group-label">
                <span>{column.label}</span>
                <span>{column.cards.length}</span>
              </div>
              {column.cards.length === 0 ? (
                <div className="vault-collab-work-empty">Empty</div>
              ) : (
                <>
                  {visibleCards.map((card) => (
                    <button
                      key={card.uid}
                      type="button"
                      className={`vault-collab-work-card ${selectedHandoffUid === card.uid ? 'vault-collab-work-card-active' : ''}`}
                      style={getProjectAccentStyle(card)}
                      onClick={() => onSelectHandoff(card.uid)}
                    >
                      <span className={`queue-status-rail ${card.railClass}`} />
                      <span className="vault-collab-work-card-main">
                        <span className="vault-collab-row-title">
                          <strong>{card.title}</strong>
                          <span className="vault-collab-work-card-badges">
                            <span
                              className="vault-collab-project-pill"
                              title={`Source project: ${card.sourceProjectLabel}`}
                            >
                              <span className="vault-collab-project-pill-dot" aria-hidden="true" />
                              <span>{card.sourceProjectLabel}</span>
                            </span>
                            <span className={`badge ${card.badgeClass}`}>{card.statusLabel}</span>
                          </span>
                        </span>
                        <span className="vault-collab-work-card-preview">{card.promptPreview}</span>
                        {card.visibleLabels.length > 0 ? (
                          <span className="chip-row vault-collab-work-card-labels">
                            {card.visibleLabels.map((label) => (
                              <span key={`${card.uid}:${label}`} className="chip chip-muted">{label}</span>
                            ))}
                            {card.extraLabel ? <span className="chip chip-muted">{card.extraLabel}</span> : null}
                          </span>
                        ) : null}
                        <span className="vault-collab-row-meta">
                          <span className="text-mono">{card.queueLabel}</span>
                          {card.routeHintLabel ? <span>{card.routeHintLabel}</span> : null}
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
                  {canCollapseResolved ? (
                    <button
                      type="button"
                      className="vault-collab-work-show-more"
                      onClick={() => setShowAllResolved((current) => !current)}
                    >
                      {showAllResolved ? 'Show fewer' : `Show more (${hiddenResolvedCount})`}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>

      <HandoffDetailModal
        handoff={selectedHandoff}
        conversation={conversation}
        discussionDraft={discussionDraft}
        discussionDisabled={discussionDisabled}
        onClose={onCloseHandoff}
        onDiscussionDraftChange={onDiscussionDraftChange}
        onDiscussionSubmit={onDiscussionSubmit}
      />
    </section>
  );
}

function getProjectAccentStyle(card: VaultCollabWorkColumn['cards'][number]): CSSProperties {
  return {
    '--vault-collab-project-accent': card.projectAccentColor,
    '--vault-collab-project-accent-soft': card.projectAccentSoftColor,
  } as CSSProperties;
}
