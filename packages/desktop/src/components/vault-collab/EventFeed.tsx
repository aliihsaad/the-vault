import { RadioTower } from 'lucide-react';

import type { VaultCollabEventFeedModel } from '../../vault-collab-view-model.js';

interface EventFeedProps {
  feed: VaultCollabEventFeedModel;
  selectedPrefix: string;
  onPrefixChange: (prefix: string) => void;
}

export function EventFeed({ feed, selectedPrefix, onPrefixChange }: EventFeedProps) {
  return (
    <section className="vault-collab-zone vault-collab-event-feed-zone" aria-label="Event feed">
      <div className="vault-collab-zone-header">
        <div>
          <strong>Events</strong>
          <span>{feed.visibleEvents.length} shown</span>
        </div>
        <RadioTower size={18} />
      </div>

      <div className="vault-collab-prefix-filter" role="tablist" aria-label="Event type prefix">
        {feed.prefixes.map((prefix) => (
          <button
            key={prefix}
            type="button"
            className={`vault-collab-prefix-button ${selectedPrefix === prefix ? 'vault-collab-prefix-button-active' : ''}`}
            onClick={() => onPrefixChange(prefix)}
          >
            {prefix}
          </button>
        ))}
      </div>

      {feed.visibleEvents.length === 0 ? (
        <div className="empty-state">No matching events.</div>
      ) : (
        <div className="vault-collab-zone-scroll vault-collab-event-feed-list">
          {feed.visibleEvents.map((event) => (
            <div key={event.id} className="vault-collab-event-row">
              <span className="vault-collab-row-title">
                <strong>{event.type}</strong>
                <span>{event.timeLabel}</span>
              </span>
              <p>{event.summary}</p>
              <span className="text-mono">{event.sessionLabel}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
