import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  BarChart3,
  Clock3,
  Coins,
  FolderKanban,
  Sparkles,
  TrendingDown,
  Waypoints,
  Inbox,
  Trash2,
} from 'lucide-react';
import { DayGroupedList } from './DayGroupedList.js';

const ESTIMATED_FULL_CANDIDATE_TOKENS = 120;
const ESTIMATED_COMPACT_MATCH_TOKENS = 28;
const ESTIMATED_DETAIL_EXPANSION_TOKENS = 90;
const TREND_DAYS = 7;

const DEFAULT_RECALL_PACKING = {
  topMatchLimit: 4,
  detailExpansionLimit: 2,
};

type RecallDayMetric = {
  key: string;
  label: string;
  recallCount: number;
  candidates: number;
  returned: number;
  tokensSaved: number;
};

interface DashboardViewProps {
  vaultStatus: VaultStatus | null;
  onOpenReview?: (tab: 'proposals' | 'pending-deletes') => void;
}

export function DashboardView({ vaultStatus, onOpenReview }: DashboardViewProps) {
  const [logs, setLogs] = useState<VaultLogEntry[]>([]);
  const [latest, setLatest] = useState<VaultMemory[]>([]);
  const [settings, setSettings] = useState<VaultSettings | null>(null);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);
  const [pendingDeleteCount, setPendingDeleteCount] = useState(0);

  useEffect(() => {
    void hydrateOverview();
  }, []);

  async function hydrateOverview() {
    try {
      const [latestResponse, logsResponse, settingsResponse, proposalsResponse, pendingDeleteResponse] = await Promise.all([
        window.vaultAPI.getLatest(undefined, 8),
        window.vaultAPI.getRecentLogs(240),
        window.vaultAPI.getAllSettings(),
        window.vaultAPI.listProjectProposals({ status: 'pending' }),
        window.vaultAPI.findMemory({ status: 'pending_delete', limit: 200 }),
      ]);

      if (latestResponse.success) {
        setLatest(latestResponse.data || []);
      }

      if (logsResponse.success) {
        setLogs(logsResponse.data || []);
      }

      if (settingsResponse.success) {
        setSettings(settingsResponse.data || null);
      }

      if (proposalsResponse.success && Array.isArray(proposalsResponse.data)) {
        setPendingProposalCount(proposalsResponse.data.length);
      }

      if (pendingDeleteResponse.success && Array.isArray(pendingDeleteResponse.data)) {
        setPendingDeleteCount(pendingDeleteResponse.data.length);
      }
    } catch {
      setLatest([]);
      setLogs([]);
      setSettings(null);
      setPendingProposalCount(0);
      setPendingDeleteCount(0);
    }
  }

  const projectCount = vaultStatus?.projects.length || 0;
  const memoryCount =
    vaultStatus?.projects.reduce((count: number, project: VaultProject) => count + (project.memoryCount || 0), 0) || 0;
  const topProjects = [...(vaultStatus?.projects || [])]
    .sort((left, right) => (right.memoryCount || 0) - (left.memoryCount || 0))
    .slice(0, 5);
  const recallPacking = getRecallPackingSettings(settings);

  const recallLogs = useMemo(
    () => logs.filter((log) => log.actionType === 'recall'),
    [logs],
  );
  const recallLogsToday = useMemo(
    () => recallLogs.filter((log) => isSameLocalDay(log.timestamp, new Date())),
    [recallLogs],
  );
  const todayCandidates = recallLogsToday.reduce((sum, log) => sum + extractTotalCandidates(log), 0);
  const todayReturned = recallLogsToday.reduce((sum, log) => sum + extractResultCount(log), 0);
  const todayTokensSaved = estimateTokensSaved(todayCandidates, todayReturned, recallPacking);
  const todayReductionRatio = todayCandidates > 0 ? 1 - (todayReturned / todayCandidates) : 0;
  const averageReturnedRatio = todayCandidates > 0 ? todayReturned / todayCandidates : 0;
  const recallTrend = useMemo(
    () => buildRecallTrend(recallLogs, TREND_DAYS, recallPacking),
    [recallLogs, recallPacking],
  );
  const trendMaxTokensSaved = Math.max(...recallTrend.map((day) => day.tokensSaved), 1);
  const trendMaxRecalls = Math.max(...recallTrend.map((day) => day.recallCount), 1);

  return (
    <div className="dashboard-stack">
      <section className="section-intro">
        <div className="section-intro-copy">
          <span className="section-intro-eyebrow">Overview</span>
          <div className="section-intro-title">See what changed, what matters, and what to open next</div>
          <p className="section-intro-text">The overview now emphasizes recent movement and grouped history instead of making every feed compete equally for attention.</p>
        </div>
        <div className="section-intro-meta">
          <span className="section-intro-chip">project pulse</span>
          <span className="section-intro-chip">recall efficiency</span>
          <span className="section-intro-chip">daily activity groups</span>
        </div>
      </section>

      <section className="hero-grid hero-grid-wide">
        <article className="hero-card">
          <span className="hero-card-label">Projects tracked</span>
          <strong className="hero-card-value">{projectCount}</strong>
          <span className="hero-card-note">Structured workspaces connected to the vault.</span>
        </article>

        <article className="hero-card">
          <span className="hero-card-label">Memory footprint</span>
          <strong className="hero-card-value">{memoryCount}</strong>
          <span className="hero-card-note">Stored summaries, decisions, plans, and artifacts.</span>
        </article>

        <article className="hero-card">
          <span className="hero-card-label">Latest capture</span>
          <strong className="hero-card-value hero-card-value-compact">
            {latest[0]?.createdAt ? formatDistanceToNow(new Date(latest[0].createdAt)) : 'No data'}
          </strong>
          <span className="hero-card-note">How recently the vault saw new memory activity.</span>
        </article>

        <article className="hero-card hero-card-accent">
          <span className="hero-card-label">Tokens saved today</span>
          <strong className="hero-card-value">{formatCompactNumber(todayTokensSaved)}</strong>
          <span className="hero-card-note">
            Estimated from recall candidate pruning before full context expansion.
          </span>
        </article>

        <article className="hero-card">
          <span className="hero-card-label">Recalls today</span>
          <strong className="hero-card-value">{recallLogsToday.length}</strong>
          <span className="hero-card-note">
            {todayCandidates > 0
              ? `Returned ${todayReturned} items from ${todayCandidates} candidates.`
              : 'No recall activity recorded today yet.'}
          </span>
        </article>

        <article className="hero-card">
          <span className="hero-card-label">Candidate reduction</span>
          <strong className="hero-card-value hero-card-value-compact">
            {todayCandidates > 0 ? `${Math.round(todayReductionRatio * 100)}%` : '0%'}
          </strong>
          <span className="hero-card-note">
            {todayCandidates > 0
              ? `${Math.round(averageReturnedRatio * 100)}% of candidates were surfaced.`
              : 'Based on logged recall result counts and candidate counts.'}
          </span>
        </article>

        {renderReviewTile({
          icon: <Inbox size={14} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />,
          label: 'Project proposals',
          value: pendingProposalCount,
          accentWhenNonZero: true,
          activeNote: 'Pending agent suggestions awaiting human review (description / relationship / merge).',
          idleNote: 'No agent proposals are waiting for a decision.',
          onClick: onOpenReview ? () => onOpenReview('proposals') : undefined,
        })}

        {renderReviewTile({
          icon: <Trash2 size={14} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />,
          label: 'Pending deletes',
          value: pendingDeleteCount,
          accentWhenNonZero: true,
          activeNote: 'Items demoted by the lifecycle pipeline. Review before confirming permanent removal.',
          idleNote: 'Lifecycle pipeline has nothing queued for human delete review.',
          onClick: onOpenReview ? () => onOpenReview('pending-deletes') : undefined,
        })}
      </section>

      <section className="section-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Recall efficiency</div>
              <div className="panel-subtitle">Seven-day view of recall volume, pruning, and estimated token savings.</div>
            </div>
            <BarChart3 size={18} className="panel-icon" />
          </div>

          {recallTrend.every((day) => day.recallCount === 0) ? (
            <div className="empty-state">No recall telemetry has been logged yet.</div>
          ) : (
            <div className="recall-analytics">
              <div className="recall-trend-chart">
                {recallTrend.map((day) => (
                  <article key={day.key} className="recall-trend-day">
                    <div className="recall-trend-bars">
                      <div
                        className="recall-trend-bar recall-trend-bar-tokens"
                        style={{ height: `${Math.max((day.tokensSaved / trendMaxTokensSaved) * 100, day.tokensSaved > 0 ? 12 : 0)}%` }}
                        title={`${day.label}: ${formatCompactNumber(day.tokensSaved)} estimated tokens saved`}
                      />
                      <div
                        className="recall-trend-bar recall-trend-bar-recalls"
                        style={{ height: `${Math.max((day.recallCount / trendMaxRecalls) * 100, day.recallCount > 0 ? 12 : 0)}%` }}
                        title={`${day.label}: ${day.recallCount} recall${day.recallCount === 1 ? '' : 's'}`}
                      />
                    </div>
                    <div className="recall-trend-label">{day.label}</div>
                  </article>
                ))}
              </div>

              <div className="recall-analytics-grid">
                <div className="detail-block">
                  <span className="detail-label">Candidate funnel today</span>
                  <strong>{todayReturned} / {todayCandidates || 0}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Pruned candidates</span>
                  <strong>{Math.max(todayCandidates - todayReturned, 0)}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">7-day recalls</span>
                  <strong>{recallTrend.reduce((sum, day) => sum + day.recallCount, 0)}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">7-day tokens saved</span>
                  <strong>{formatCompactNumber(recallTrend.reduce((sum, day) => sum + day.tokensSaved, 0))}</strong>
                </div>
              </div>

              <div className="note-card recall-analytics-note">
                <Coins size={16} />
                <p>
                  Estimate formula now assumes compact two-stage recall:
                  <code>{` full_candidates * ${ESTIMATED_FULL_CANDIDATE_TOKENS} - (min(returned, ${recallPacking.topMatchLimit}) * ${ESTIMATED_COMPACT_MATCH_TOKENS} + min(min(returned, ${recallPacking.topMatchLimit}), ${recallPacking.detailExpansionLimit}) * ${ESTIMATED_DETAIL_EXPANSION_TOKENS}) `}</code>.
                  It remains an estimate, but it now tracks the actual prompt-packing strategy used by the agent flow more closely.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Project radar</div>
              <div className="panel-subtitle">Workspaces with the heaviest context footprint.</div>
            </div>
            <FolderKanban size={18} className="panel-icon" />
          </div>

          {topProjects.length === 0 ? (
            <div className="empty-state">No projects detected in the vault.</div>
          ) : (
            <div className="project-list">
              {topProjects.map((project) => (
                <article key={project.name} className="project-row">
                  <div>
                    <div className="project-row-title">{project.name}</div>
                    <div className="project-row-description">
                      {project.description || 'No description stored for this project.'}
                    </div>
                  </div>
                  <strong className="project-row-count">{project.memoryCount || 0}</strong>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Recent captures</div>
              <div className="panel-subtitle">Fresh material entering the vault right now.</div>
            </div>
            <Sparkles size={18} className="panel-icon" />
          </div>

          {latest.length === 0 ? (
            <div className="empty-state">No memories have been captured yet.</div>
          ) : (
            <DayGroupedList
              items={latest}
              getDate={(memory) => memory.createdAt}
              getKey={(memory) => memory.itemUid}
              emptyMessage="No memories have been captured yet."
              renderItem={(memory) => (
                <article className="memory-row">
                  <div className="memory-row-main">
                    <div className="memory-row-title">{memory.title}</div>
                    <div className="memory-row-summary">{memory.summary}</div>
                  </div>
                  <div className="memory-meta">
                    <span className={`badge badge-${memory.memoryType}`}>{memory.memoryType}</span>
                    <span>{memory.project}</span>
                    <span>{formatDistanceToNow(new Date(memory.createdAt))} ago</span>
                  </div>
                </article>
              )}
            />
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Recall funnel snapshot</div>
              <div className="panel-subtitle">How much candidate space the vault trims before sending useful context forward.</div>
            </div>
            <TrendingDown size={18} className="panel-icon" />
          </div>

          <div className="recall-funnel">
            <div className="recall-funnel-row">
              <span className="recall-funnel-label">Candidates seen today</span>
              <strong className="recall-funnel-value">{todayCandidates}</strong>
            </div>
            <div className="recall-funnel-track">
              <div className="recall-funnel-fill recall-funnel-fill-candidates" style={{ width: '100%' }} />
            </div>

            <div className="recall-funnel-row">
              <span className="recall-funnel-label">Returned to the client</span>
              <strong className="recall-funnel-value">{todayReturned}</strong>
            </div>
            <div className="recall-funnel-track">
              <div
                className="recall-funnel-fill recall-funnel-fill-returned"
                style={{ width: `${todayCandidates > 0 ? Math.max((todayReturned / todayCandidates) * 100, todayReturned > 0 ? 8 : 0) : 0}%` }}
              />
            </div>

            <div className="recall-funnel-row">
              <span className="recall-funnel-label">Estimated context avoided</span>
              <strong className="recall-funnel-value">{formatCompactNumber(todayTokensSaved)} tokens</strong>
            </div>
            <div className="recall-funnel-track">
              <div
                className="recall-funnel-fill recall-funnel-fill-saved"
                style={{ width: `${todayCandidates > 0 ? Math.max(todayReductionRatio * 100, todayTokensSaved > 0 ? 12 : 0) : 0}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Activity feed</div>
            <div className="panel-subtitle">Recent operational events from the memory system.</div>
          </div>
          <Waypoints size={18} className="panel-icon" />
        </div>

        {logs.length === 0 ? (
          <div className="empty-state">No recent activity logged yet.</div>
        ) : (
          <DayGroupedList
            items={logs.slice(0, 12)}
            getDate={(log) => log.timestamp}
            getKey={(log) => `${log.id ?? log.timestamp}-${log.actionType}`}
            emptyMessage="No recent activity logged yet."
            renderItem={(log) => (
              <article className="log-entry">
                <div className={`badge badge-${log.actionType}`}>{log.actionType}</div>

                <div className="log-entry-main">
                  <div className="log-entry-message">{log.message || 'No message recorded'}</div>
                  <div className="log-entry-meta">
                    <span>{log.project || 'global'}</span>
                    <span>{log.sourceClient}</span>
                    {typeof log.latencyMs === 'number' ? <span>{log.latencyMs}ms</span> : null}
                    {log.actionType === 'recall' ? (
                      <span>
                        {extractResultCount(log)} / {extractTotalCandidates(log)} returned
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="log-entry-time">
                  <Clock3 size={14} />
                  <span>{log.timestamp ? formatDistanceToNow(new Date(log.timestamp)) : 'unknown time'} ago</span>
                </div>
              </article>
            )}
          />
        )}
      </section>
    </div>
  );
}

function renderReviewTile(opts: {
  icon: ReactNode;
  label: string;
  value: number;
  accentWhenNonZero: boolean;
  activeNote: string;
  idleNote: string;
  onClick?: () => void;
}) {
  const { icon, label, value, accentWhenNonZero, activeNote, idleNote, onClick } = opts;
  const accentClass = accentWhenNonZero && value > 0 ? 'hero-card-accent' : '';
  const note = value > 0 ? activeNote : idleNote;

  if (onClick) {
    return (
      <button
        type="button"
        className={`hero-card hero-card-clickable ${accentClass}`}
        onClick={onClick}
      >
        <span className="hero-card-label">{icon}{label}</span>
        <strong className="hero-card-value">{value}</strong>
        <span className="hero-card-note">{note}</span>
      </button>
    );
  }

  return (
    <article className={`hero-card ${accentClass}`}>
      <span className="hero-card-label">{icon}{label}</span>
      <strong className="hero-card-value">{value}</strong>
      <span className="hero-card-note">{note}</span>
    </article>
  );
}

function extractTotalCandidates(log: VaultLogEntry): number {
  const value = log.metadata?.totalCandidates;
  if (typeof value === 'number') {
    return value;
  }

  const parsed = parseRecallMessageCounts(log.message);
  return parsed?.totalCandidates ?? 0;
}

function extractResultCount(log: VaultLogEntry): number {
  const value = log.metadata?.resultCount;
  if (typeof value === 'number') {
    return value;
  }

  const parsed = parseRecallMessageCounts(log.message);
  return parsed?.returned ?? 0;
}

function parseRecallMessageCounts(message: string | undefined): { returned: number; totalCandidates: number } | null {
  if (!message) {
    return null;
  }

  const match = message.match(/Recalled\s+(\d+)\s+items?\s+from\s+(\d+)\s+candidates?/i);
  if (!match) {
    return null;
  }

  return {
    returned: Number(match[1]) || 0,
    totalCandidates: Number(match[2]) || 0,
  };
}

function estimateTokensSaved(
  totalCandidates: number,
  returned: number,
  recallPacking: { topMatchLimit: number; detailExpansionLimit: number },
): number {
  const baseline = totalCandidates * ESTIMATED_FULL_CANDIDATE_TOKENS;
  const compactMatches = Math.min(returned, recallPacking.topMatchLimit);
  const compactCost = compactMatches * ESTIMATED_COMPACT_MATCH_TOKENS;
  const detailCost = Math.min(compactMatches, recallPacking.detailExpansionLimit) * ESTIMATED_DETAIL_EXPANSION_TOKENS;
  return Math.max(Math.round(baseline - compactCost - detailCost), 0);
}

function isSameLocalDay(timestamp: string | undefined, referenceDate: Date): boolean {
  if (!timestamp) {
    return false;
  }

  const date = new Date(timestamp);
  return date.getFullYear() === referenceDate.getFullYear()
    && date.getMonth() === referenceDate.getMonth()
    && date.getDate() === referenceDate.getDate();
}

function buildRecallTrend(
  logs: VaultLogEntry[],
  days: number,
  recallPacking: { topMatchLimit: number; detailExpansionLimit: number },
): RecallDayMetric[] {
  const trend: RecallDayMetric[] = [];
  const now = new Date();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(now.getDate() - offset);

    const dayLogs = logs.filter((log) => isSameLocalDay(log.timestamp, date));
    const candidates = dayLogs.reduce((sum, log) => sum + extractTotalCandidates(log), 0);
    const returned = dayLogs.reduce((sum, log) => sum + extractResultCount(log), 0);

    trend.push({
      key: date.toISOString(),
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      recallCount: dayLogs.length,
      candidates,
      returned,
      tokensSaved: estimateTokensSaved(candidates, returned, recallPacking),
    });
  }

  return trend;
}

function getRecallPackingSettings(settings: VaultSettings | null): {
  topMatchLimit: number;
  detailExpansionLimit: number;
} {
  return {
    topMatchLimit: clampNumber(settings?.recall_top_match_limit, DEFAULT_RECALL_PACKING.topMatchLimit, 1, 8),
    detailExpansionLimit: clampNumber(settings?.recall_detail_expansion_limit, DEFAULT_RECALL_PACKING.detailExpansionLimit, 0, 4),
  };
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function formatCompactNumber(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }

  return String(value);
}
