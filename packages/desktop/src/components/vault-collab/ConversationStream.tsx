import { MessageSquareText, Send } from 'lucide-react';

import type { VaultCollabConversationEntry } from '../../vault-collab-view-model.js';

interface ConversationStreamProps {
  entries: VaultCollabConversationEntry[];
  draft: string;
  disabled: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}

export function ConversationStream({
  entries,
  draft,
  disabled,
  onDraftChange,
  onSubmit,
}: ConversationStreamProps) {
  return (
    <section className="vault-collab-zone vault-collab-conversation-zone" aria-label="Conversation">
      <div className="vault-collab-zone-header">
        <div>
          <strong>Conversation</strong>
          <span>{entries.length} entries</span>
        </div>
        <MessageSquareText size={18} />
      </div>

      <div className="vault-collab-discussion-composer">
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="Write a thread message"
          rows={3}
        />
        <button
          type="button"
          className="primary-button"
          disabled={disabled || draft.trim().length === 0}
          onClick={onSubmit}
        >
          <Send size={14} />
          <span>Send</span>
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">No conversation yet.</div>
      ) : (
        <div className="vault-collab-event-list">
          {entries.map((entry) => (
            <div key={entry.id} className="vault-collab-event-row">
              <span className={`badge ${entry.kind === 'message' ? 'badge-plan' : 'badge-recall'}`}>
                {entry.kind}
              </span>
              <strong>{formatEntryTime(entry.at)}</strong>
              <p>{entry.body}</p>
              {entry.author ? <span className="text-mono">{shortId(entry.author)}</span> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatEntryTime(value: string): string {
  return new Date(value).toLocaleString();
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}...` : value;
}
