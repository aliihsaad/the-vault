import { useEffect } from 'react';
import { FileText, MessageSquareText, Send, Tag, X } from 'lucide-react';

import type {
  VaultCollabConversationEntry,
  VaultCollabSelectedHandoff,
} from '../../vault-collab-view-model.js';

interface HandoffDetailModalProps {
  handoff: VaultCollabSelectedHandoff | null;
  conversation: VaultCollabConversationEntry[];
  discussionDraft: string;
  discussionDisabled: boolean;
  onClose: () => void;
  onDiscussionDraftChange: (value: string) => void;
  onDiscussionSubmit: () => void;
}

export function HandoffDetailModal({
  handoff,
  conversation,
  discussionDraft,
  discussionDisabled,
  onClose,
  onDiscussionDraftChange,
  onDiscussionSubmit,
}: HandoffDetailModalProps) {
  useEffect(() => {
    if (!handoff) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handoff, onClose]);

  if (!handoff) {
    return null;
  }

  const titleId = `vault-collab-handoff-modal-title-${handoff.uid}`;

  return (
    <div className="vault-collab-handoff-modal-backdrop" onClick={onClose}>
      <section
        className="vault-collab-handoff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="vault-collab-handoff-modal-header">
          <div>
            <span>Handoff</span>
            <strong className="text-mono">{handoff.shortUid}</strong>
          </div>
          <div className="vault-collab-handoff-modal-actions">
            <span className={`badge ${handoff.badgeClass}`}>{handoff.statusLabel}</span>
            <button
              type="button"
              className="header-button icon-only-button vault-collab-handoff-modal-close"
              onClick={onClose}
              title="Close handoff detail"
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="vault-collab-handoff-modal-body">
          <div className="vault-collab-handoff-modal-summary">
            <strong id={titleId} className="vault-collab-handoff-modal-title">{handoff.prompt}</strong>
            {handoff.attentionQuestion ? (
              <p className="vault-collab-handoff-modal-note">{handoff.attentionQuestion}</p>
            ) : null}
            {handoff.progressNote ? (
              <p className="vault-collab-handoff-modal-note">{handoff.progressNote}</p>
            ) : null}

            <div className="vault-collab-handoff-modal-meta-grid">
              {handoff.meta.map((item) => (
                <span key={item.label}>
                  <span>{item.label}</span>
                  <strong className={item.mono ? 'text-mono' : undefined}>{item.value}</strong>
                </span>
              ))}
            </div>

            {handoff.labels.length > 0 ? (
              <div className="vault-collab-handoff-modal-section">
                <div className="detail-section-title">
                  <Tag size={15} />
                  <span>Labels</span>
                </div>
                <div className="chip-row">
                  {handoff.labels.map((label) => (
                    <span key={label} className="chip chip-muted">{label}</span>
                  ))}
                </div>
              </div>
            ) : null}

            {handoff.relatedFiles.length > 0 ? (
              <div className="vault-collab-handoff-modal-section">
                <div className="detail-section-title">
                  <FileText size={15} />
                  <span>Files</span>
                </div>
                <div className="vault-collab-handoff-modal-path-list">
                  {handoff.relatedFiles.map((filePath) => (
                    <span key={filePath} className="detail-path text-mono">{filePath}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="vault-collab-handoff-modal-thread">
            <div className="detail-section-title">
              <MessageSquareText size={15} />
              <span>Thread</span>
            </div>
            <div className="vault-collab-handoff-modal-thread-composer">
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
              <div className="vault-collab-handoff-modal-thread-empty">No conversation yet.</div>
            ) : (
              <div className="vault-collab-handoff-modal-thread-events">
                {conversation.slice(0, 8).map((entry) => (
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
      </section>
    </div>
  );
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}...` : value;
}
