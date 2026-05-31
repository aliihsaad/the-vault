import { Activity, CheckCircle2, Link2, MessageSquareText, Tag } from 'lucide-react';

import type { VaultCollabSelectedHandoff } from '../../vault-collab-view-model.js';

interface HandoffDetailProps {
  handoff: VaultCollabSelectedHandoff | null;
}

export function HandoffDetail({ handoff }: HandoffDetailProps) {
  if (!handoff) {
    return (
      <section className="vault-collab-zone vault-collab-detail-zone" aria-label="Handoff detail">
        <div className="vault-collab-zone-header">
          <div>
            <strong>Handoff</strong>
            <span>No selection</span>
          </div>
          <Activity size={18} />
        </div>
        <div className="empty-state">Select a handoff.</div>
      </section>
    );
  }

  return (
    <section className="vault-collab-zone vault-collab-detail-zone" aria-label="Handoff detail">
      <div className="vault-collab-zone-header">
        <div>
          <strong>Handoff</strong>
          <span className="text-mono">{handoff.shortUid}</span>
        </div>
        <span className={`badge ${handoff.badgeClass}`}>{handoff.statusLabel}</span>
      </div>

      <div className="vault-collab-inspector-stack">
        <div className="vault-collab-inspector-headline">
          <h3>{handoff.prompt}</h3>
        </div>

        {handoff.attentionQuestion ? (
          <div className="vault-collab-permission-note">
            <div className="detail-section-title">
              <Activity size={15} />
              <span>Waiting</span>
            </div>
            <p>{handoff.attentionQuestion}</p>
          </div>
        ) : handoff.progressNote ? (
          <div className="vault-collab-progress-note">
            <div className="detail-section-title">
              <CheckCircle2 size={15} />
              <span>Progress</span>
            </div>
            <p>{handoff.progressNote}</p>
          </div>
        ) : null}

        <div className="vault-collab-detail-grid">
          {handoff.meta.map((item) => (
            <span key={item.label}>
              <span>{item.label}</span>
              <strong className={item.mono ? 'text-mono' : undefined}>{item.value}</strong>
            </span>
          ))}
        </div>

        {handoff.labels.length > 0 ? (
          <div className="vault-collab-detail-section">
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

        <div className="vault-collab-detail-section">
          <div className="detail-section-title">
            <MessageSquareText size={15} />
            <span>Threads</span>
          </div>
          {handoff.discussionThreads.length === 0 ? (
            <div className="empty-state">No linked threads.</div>
          ) : (
            <div className="vault-collab-discussion-list">
              {handoff.discussionThreads.map((thread) => (
                <div key={thread.uid} className="vault-collab-discussion-row">
                  <div className="vault-collab-row-title">
                    <strong>{thread.title}</strong>
                    <span className={`badge ${thread.badgeClass}`}>{thread.status}</span>
                  </div>
                  <p>{thread.summary}</p>
                  <span className="text-mono">{thread.shortUid}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {handoff.relatedFiles.length > 0 ? (
          <div className="vault-collab-detail-section">
            <div className="detail-section-title">
              <Link2 size={15} />
              <span>Files</span>
            </div>
            <div className="vault-collab-path-list">
              {handoff.relatedFiles.map((filePath) => (
                <span key={filePath} className="detail-path text-mono">{filePath}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
