import { useEffect, useMemo, useState } from 'react';
import { Activity, Clock3, Filter, Search, Sparkles } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { DayGroupedList } from './DayGroupedList.js';

const ACTION_FILTERS: Array<'all' | VaultActionType> = [
  'all',
  'save',
  'recall',
  'update',
  'archive',
  'promote',
  'error',
];

type RecallLogMatch = {
  itemUid: string;
  score: number;
  reasons: string[];
};

export function ActivityLogsView({ onPrefillMemoryDraft }: { onPrefillMemoryDraft?: (draft: Partial<VaultMemoryComposerDraft>) => void }) {
  const [logs, setLogs] = useState<VaultLogEntry[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | VaultActionType>('all');

  useEffect(() => {
    void fetchLogs();
  }, []);

  async function fetchLogs() {
    setLoading(true);
    setError(null);

    try {
      const response = await window.vaultAPI.getRecentLogs(120);
      if (!response.success) {
        throw new Error(response.error || 'Failed to load activity logs');
      }

      const nextLogs = response.data || [];
      setLogs(nextLogs);

      if (nextLogs.length === 0) {
        setSelectedLogId(null);
        return;
      }

      const currentKey = selectedLogId;
      if (currentKey && nextLogs.some((log) => getLogKey(log) === currentKey)) {
        return;
      }

      setSelectedLogId(getLogKey(nextLogs[0]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity logs');
    } finally {
      setLoading(false);
    }
  }

  const filteredLogs = logs.filter((log) => {
    const haystack = [
      log.message,
      log.project,
      log.sourceClient,
      log.targetItemId,
      log.actionType,
      ...extractMetadataSearchTerms(log.metadata),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const matchesSearch = !search.trim() || haystack.includes(search.trim().toLowerCase());
    const matchesAction = actionFilter === 'all' || log.actionType === actionFilter;

    return matchesSearch && matchesAction;
  });

  const selectedLog = useMemo(
    () => filteredLogs.find((log) => getLogKey(log) === selectedLogId) || filteredLogs[0] || null,
    [filteredLogs, selectedLogId],
  );

  const errorCount = logs.filter((log) => log.actionType === 'error').length;
  const saveCount = logs.filter((log) => log.actionType === 'save').length;
  const recallLogs = logs.filter((log) => log.actionType === 'recall');
  const recallCount = recallLogs.length;
  const averageRecallTopScore = recallLogs.length > 0
    ? recallLogs.reduce((sum, log) => sum + extractTopScore(log.metadata), 0) / recallLogs.length
    : 0;

  return (
    <div className="logs-layout">
      <section className="section-intro">
        <div className="section-intro-copy">
          <span className="section-intro-eyebrow">Operations</span>
          <div className="section-intro-title">Review the system trail without losing the signal</div>
          <p className="section-intro-text">Activity is now grouped by day so recent work stays visible while older operational noise stays folded away until you need it.</p>
        </div>
        <div className="section-intro-meta">
          <span className="section-intro-chip">searchable events</span>
          <span className="section-intro-chip">daily grouping</span>
          <span className="section-intro-chip">detail side panel</span>
        </div>
      </section>

      <div className="stats-strip">
        <div className="stat-chip">
          <span className="stat-label">Total events</span>
          <strong className="stat-value">{logs.length}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Saved</span>
          <strong className="stat-value">{saveCount}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Recalled</span>
          <strong className="stat-value">{recallCount}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Avg recall top score</span>
          <strong className="stat-value">{recallCount > 0 ? averageRecallTopScore.toFixed(1) : '0.0'}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Errors</span>
          <strong className="stat-value">{errorCount}</strong>
        </div>
      </div>

      <div className="section-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Operational activity</div>
              <div className="panel-subtitle">Trace saves, recalls, promotions, and updates with enough detail to inspect why they happened.</div>
            </div>
            <button type="button" className="header-button" onClick={() => void fetchLogs()}>
              Refresh
            </button>
          </div>

          <div className="toolbar-row">
            <label className="search-field">
              <Search size={16} />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by message, project, client, memory UID, or recall reason"
              />
            </label>

            <label className="select-field">
              <Filter size={16} />
              <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value as 'all' | VaultActionType)}>
                {ACTION_FILTERS.map((action) => (
                  <option key={action} value={action}>
                    {action === 'all' ? 'All actions' : action}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {loading ? (
            <div className="empty-state">Loading activity logs...</div>
          ) : error ? (
            <div className="empty-state empty-state-error">{error}</div>
          ) : filteredLogs.length === 0 ? (
            <div className="empty-state">No log entries match the current filters.</div>
          ) : (
            <DayGroupedList
              items={filteredLogs}
              getDate={(log) => log.timestamp}
              getKey={getLogKey}
              emptyMessage="No log entries match the current filters."
              renderItem={(log) => {
                const logKey = getLogKey(log);
                const recallMatches = extractRecallMatches(log.metadata);
                const topScore = extractTopScore(log.metadata);

                return (
                  <button
                    type="button"
                    className={`log-entry log-entry-button ${selectedLog && getLogKey(selectedLog) === logKey ? 'log-entry-active' : ''}`}
                    onClick={() => setSelectedLogId(logKey)}
                  >
                    <div className={`badge badge-${log.actionType}`}>{log.actionType}</div>

                    <div className="log-entry-main">
                      <div className="log-entry-message">{log.message || 'No message recorded'}</div>
                      <div className="log-entry-meta">
                        <span>{log.project || 'global'}</span>
                        <span>{log.sourceClient}</span>
                        {log.targetItemId ? <span>{log.targetItemId}</span> : null}
                        {typeof log.latencyMs === 'number' ? <span>{log.latencyMs}ms</span> : null}
                        {log.actionType === 'recall' ? <span>{recallMatches.length} ranked match{recallMatches.length === 1 ? '' : 'es'}</span> : null}
                        {log.actionType === 'recall' && topScore > 0 ? <span>top score {topScore.toFixed(1)}</span> : null}
                      </div>
                    </div>

                    <div className="log-entry-time">
                      <Clock3 size={14} />
                      <span>{log.timestamp ? formatDistanceToNow(new Date(log.timestamp)) : 'unknown time'} ago</span>
                    </div>
                  </button>
                );
              }}
            />
          )}
        </section>

        <aside className="detail-panel panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Event detail</div>
              <div className="panel-subtitle">Inspect stored metadata, recall ranking signals, and the context behind a specific event.</div>
            </div>
            <Activity size={18} className="panel-icon" />
          </div>

          {!selectedLog ? (
            <div className="empty-state">Select an event to inspect it.</div>
          ) : (
            <LogDetail log={selectedLog} onPrefillMemoryDraft={onPrefillMemoryDraft} />
          )}
        </aside>
      </div>
    </div>
  );
}

function LogDetail({
  log,
  onPrefillMemoryDraft,
}: {
  log: VaultLogEntry;
  onPrefillMemoryDraft?: (draft: Partial<VaultMemoryComposerDraft>) => void;
}) {
  const metadataEntries = Object.entries(log.metadata || {});
  const recallMatches = extractRecallMatches(log.metadata);
  const topScore = extractTopScore(log.metadata);
  const resultCount = extractResultCount(log.metadata);

  return (
    <div className="detail-stack">
      <div className="detail-headline">
        <span className={`badge badge-${log.actionType}`}>{log.actionType}</span>
        <h3>{log.message || 'No message recorded'}</h3>
        <p>
          {log.actionType === 'recall'
            ? 'This event includes the ranked recall matches that were returned at query time.'
            : 'This event shows the stored operational metadata captured when the action completed.'}
        </p>
      </div>

      <div className="detail-grid">
        <div className="detail-block">
          <span className="detail-label">Timestamp</span>
          <strong>{log.timestamp ? new Date(log.timestamp).toLocaleString() : 'unknown'}</strong>
        </div>
        <div className="detail-block">
          <span className="detail-label">Client</span>
          <strong>{log.sourceClient}</strong>
        </div>
        <div className="detail-block">
          <span className="detail-label">Project</span>
          <strong>{log.project || 'global'}</strong>
        </div>
        <div className="detail-block">
          <span className="detail-label">Status</span>
          <strong>{log.status || 'unknown'}</strong>
        </div>
        <div className="detail-block">
          <span className="detail-label">Latency</span>
          <strong>{typeof log.latencyMs === 'number' ? `${log.latencyMs}ms` : 'n/a'}</strong>
        </div>
        <div className="detail-block">
          <span className="detail-label">Target item</span>
          <strong className="text-mono">{log.targetItemId || 'n/a'}</strong>
        </div>
      </div>

      {onPrefillMemoryDraft ? (
        <div className="inline-actions">
          <button
            type="button"
            className="header-button"
            onClick={() => onPrefillMemoryDraft(buildLogPrefillDraft(log, recallMatches, topScore, resultCount))}
          >
            <Sparkles size={16} />
            <span>Prefill memory draft</span>
          </button>
        </div>
      ) : null}

      {log.actionType === 'recall' ? (
        <div className="detail-section">
          <div className="detail-section-title">
            <Sparkles size={16} />
            <span>Recall result insight</span>
          </div>
          <div className="detail-grid">
            <div className="detail-block">
              <span className="detail-label">Returned matches</span>
              <strong>{resultCount}</strong>
            </div>
            <div className="detail-block">
              <span className="detail-label">Top score</span>
              <strong>{topScore > 0 ? topScore.toFixed(1) : '0.0'}</strong>
            </div>
          </div>

          {recallMatches.length > 0 ? (
            <div className="adapter-check-list">
              {recallMatches.map((match) => (
                <div key={`${match.itemUid}-${match.score}`} className="adapter-check adapter-check-pass">
                  <div className="adapter-check-head">
                    <span className="badge">match</span>
                    <strong className="text-mono">{match.itemUid}</strong>
                  </div>
                  <p>Score: {match.score.toFixed(1)}</p>
                  <p>{match.reasons.length > 0 ? `Why: ${match.reasons.join(', ')}` : 'No explicit reasons stored.'}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="note-card">
              <p>No ranked match detail was stored for this recall event.</p>
            </div>
          )}
        </div>
      ) : null}

      {metadataEntries.length > 0 ? (
        <div className="detail-section">
          <div className="detail-section-title">
            <Activity size={16} />
            <span>Raw metadata</span>
          </div>
          <pre className="snippet-block">{JSON.stringify(log.metadata, null, 2)}</pre>
        </div>
      ) : (
        <div className="note-card">
          <p>No metadata was stored for this event.</p>
        </div>
      )}
    </div>
  );
}

function getLogKey(log: VaultLogEntry): string {
  return `${log.id ?? 'none'}-${log.timestamp ?? 'none'}-${log.actionType}`;
}

function extractTopScore(metadata: Record<string, unknown> | undefined): number {
  const value = metadata?.topScore;
  return typeof value === 'number' ? value : 0;
}

function extractResultCount(metadata: Record<string, unknown> | undefined): number {
  const value = metadata?.resultCount;
  return typeof value === 'number' ? value : 0;
}

function extractRecallMatches(metadata: Record<string, unknown> | undefined): RecallLogMatch[] {
  const raw = metadata?.topMatches;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    if (typeof record.itemUid !== 'string' || typeof record.score !== 'number') {
      return [];
    }

    return [{
      itemUid: record.itemUid,
      score: record.score,
      reasons: Array.isArray(record.reasons) ? record.reasons.filter((reason): reason is string => typeof reason === 'string') : [],
    }];
  });
}

function extractMetadataSearchTerms(metadata: Record<string, unknown> | undefined): string[] {
  const recallMatches = extractRecallMatches(metadata);
  const reasons = recallMatches.flatMap((match) => match.reasons);
  const itemUids = recallMatches.map((match) => match.itemUid);
  return [...reasons, ...itemUids];
}

function buildLogPrefillDraft(
  log: VaultLogEntry,
  recallMatches: RecallLogMatch[],
  topScore: number,
  resultCount: number,
): Partial<VaultMemoryComposerDraft> {
  const titleBase = log.project ? `${log.actionType} event for ${log.project}` : `${log.actionType} event`;
  const content = log.actionType === 'recall'
    ? [
        `Recall event captured from ${log.sourceClient}.`,
        `Message: ${log.message || 'No message recorded.'}`,
        '',
        `Returned matches: ${resultCount}`,
        `Top score: ${topScore.toFixed(1)}`,
        '',
        'Ranked matches:',
        ...recallMatches.map((match) => `- ${match.itemUid} (${match.score.toFixed(1)}) :: ${match.reasons.join(', ') || 'no reasons stored'}`),
      ].join('\n')
    : [
        `${log.actionType} event captured from ${log.sourceClient}.`,
        `Message: ${log.message || 'No message recorded.'}`,
        '',
        'Raw metadata:',
        JSON.stringify(log.metadata || {}, null, 2),
      ].join('\n');

  return {
    project: log.project || '',
    title: titleBase.slice(0, 120),
    memoryType: log.actionType === 'recall' ? 'summary' : 'session',
    subject: log.project || `${log.actionType} activity`,
    summary: log.actionType === 'recall'
      ? `Operational recall event from ${log.sourceClient} returned ${resultCount} matches with top score ${topScore.toFixed(1)}.`
      : `Operational ${log.actionType} event recorded from ${log.sourceClient}.`,
    content,
    status: 'active',
    priority: log.actionType === 'error' ? 'high' : 'normal',
    routineType: 'review',
    tagsText: `${log.actionType}, activity`,
    keywordsText: [log.actionType, log.project, log.sourceClient].filter(Boolean).join(', '),
    nextStepsText: log.actionType === 'recall'
      ? 'Review whether one of the returned matches should be promoted, updated, or linked to a better subject.'
      : '',
    relatedFilesText: '',
  };
}
