import { Clock3, Inbox, MessageSquareText, Send } from 'lucide-react';

import type {
  VaultCollabConversationEntry,
  VaultCollabSelectedHandoff,
  VaultCollabWorkColumn,
} from '../../vault-collab-view-model.js';

interface WorkBoardProps {
  columns: VaultCollabWorkColumn[];
  selectedHandoffUid: string | null;
  selectedHandoff: VaultCollabSelectedHandoff | null;
  conversation: VaultCollabConversationEntry[];
  discussionDraft: string;
  discussionDisabled: boolean;
  onSelectHandoff: (handoffUid: string) => void;
  onDiscussionDraftChange: (value: string) => void;
  onDiscussionSubmit: () => void;
}

export function WorkBoard({
  columns,
  selectedHandoffUid,
  selectedHandoff,
  conversation,
  discussionDraft,
  discussionDisabled,
  onSelectHandoff,
  onDiscussionDraftChange,
  onDiscussionSubmit,
}: WorkBoardProps) {
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
                    <strong>{card.title}</strong>
                    <span className={`badge ${card.badgeClass}`}>{card.statusLabel}</span>
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
          </div>
        ))}
      </div>

      <section className="vault-collab-selected-handoff" aria-label="Selected handoff">
        <div className="vault-collab-selected-handoff-header">
          <div>
            <span>Selected handoff</span>
            <strong>{selectedHandoff?.shortUid ?? 'none selected'}</strong>
          </div>
          {selectedHandoff ? (
            <span className={`badge ${selectedHandoff.badgeClass}`}>{selectedHandoff.statusLabel}</span>
          ) : null}
        </div>

        {selectedHandoff ? (
          <div className="vault-collab-selected-handoff-body">
            <div className="vault-collab-selected-handoff-summary">
              <strong className="vault-collab-selected-handoff-title">{selectedHandoff.prompt}</strong>
              {selectedHandoff.attentionQuestion ? (
                <p className="vault-collab-selected-handoff-note">{selectedHandoff.attentionQuestion}</p>
              ) : null}
              {selectedHandoff.progressNote ? (
                <p className="vault-collab-selected-handoff-note">{selectedHandoff.progressNote}</p>
              ) : null}
              <div className="vault-collab-selected-meta-grid">
                {selectedHandoff.meta.slice(0, 6).map((item) => (
                  <span key={item.label}>
                    <span>{item.label}</span>
                    <strong className={item.mono ? 'text-mono' : undefined}>{item.value}</strong>
                  </span>
                ))}
              </div>
            </div>

            <div className="vault-collab-selected-thread">
              <div className="detail-section-title">
                <MessageSquareText size={15} />
                <span>Thread</span>
              </div>
              <div className="vault-collab-selected-thread-composer">
                <textarea
                  value={discussionDraft}
                  onChange={(event) => onDiscussionDraftChange(event.target.value)}
                  placeholder="Write a thread message"
                  rows={2}
                />
                <button
                  type="button"
                  className="primary-button"
                  disabled={discussionDisabled || discussionDraft.trim().length === 0}
                  onClick={onDiscussionSubmit}
                >
                  <Send size={14} />
                  <span>Send</span>
                </button>
              </div>
              {conversation.length === 0 ? (
                <div className="vault-collab-selected-thread-empty">No conversation yet.</div>
              ) : (
                <div className="vault-collab-selected-thread-events">
                  {conversation.slice(0, 5).map((entry) => (
                    <div key={entry.id} className="vault-collab-event-row">
                      <span className={`badge ${entry.kind === 'message' ? 'badge-plan' : 'badge-recall'}`}>
                        {entry.kind}
                      </span>
                      <p>{entry.body}</p>
                      {entry.author ? <span className="text-mono">{shortId(entry.author)}</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="vault-collab-selected-empty">Select a handoff to inspect details and thread activity.</div>
        )}
      </section>
    </section>
  );
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}...` : value;
}
