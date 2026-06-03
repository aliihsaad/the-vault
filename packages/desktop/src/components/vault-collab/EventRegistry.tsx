import { BookOpenText } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { VaultCollabEventRegistryModel } from '../../vault-collab-view-model.js';

interface EventRegistryProps {
  registry: VaultCollabEventRegistryModel;
}

export function EventRegistry({ registry }: EventRegistryProps) {
  const [filter, setFilter] = useState('');
  const visibleRows = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) {
      return registry.rows;
    }

    return registry.rows.filter((row) => (
      row.canonicalName.toLowerCase().includes(query)
      || row.namespace.toLowerCase().includes(query)
      || row.summary.toLowerCase().includes(query)
    ));
  }, [filter, registry.rows]);

  return (
    <section className="vault-collab-zone vault-collab-event-registry-zone" aria-label="Event registry">
      <div className="vault-collab-zone-header">
        <div>
          <strong>Registry</strong>
          <span>{registry.totalCount} event types</span>
        </div>
        <BookOpenText size={18} />
      </div>

      <div className="vault-collab-registry-filter">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter events"
          aria-label="Filter event registry"
        />
      </div>

      {visibleRows.length === 0 ? (
        <div className="empty-state">No event types.</div>
      ) : (
        <div className="vault-collab-zone-scroll vault-collab-registry-list">
          {visibleRows.map((row) => (
            <details key={row.canonicalName} className="vault-collab-registry-row">
              <summary>
                <span>
                  <strong>{row.canonicalName}</strong>
                  <small>{row.namespace}</small>
                </span>
                <span>{row.tokenSafeLabel}</span>
              </summary>
              <p>{row.summary}</p>
              <div className="vault-collab-registry-meta">
                <span>{row.attentionLabel}</span>
                <span>{row.payloadKeys.length > 0 ? row.payloadKeys.join(', ') : 'no payload'}</span>
                {row.legacyAliasLabel ? <span>{row.legacyAliasLabel}</span> : null}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
