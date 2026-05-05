import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  BarChart3,
  Bug,
  CheckCircle2,
  Clock3,
  Coins,
  ExternalLink,
  FolderKanban,
  Hammer,
  Lightbulb,
  ListChecks,
  Microscope,
  Minus,
  MoonStar,
  PencilRuler,
  Rocket,
  Search,
  Sparkles,
  TestTube2,
  TrendingDown,
  TrendingUp,
  Waypoints,
  Inbox,
  Trash2,
  Wrench,
} from 'lucide-react';
import { DayGroupedList } from './DayGroupedList.js';
import { buildPendingDeleteReviewQuery } from '../agent-review-query.js';
import {
  buildOpenLoopFocusList,
  describeOpenLoopSignals,
  getOpenLoopNextAction,
  getOpenLoopStaleness,
  type OpenLoopStalenessTone,
} from '../open-loop-ui.js';

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
  onOpenMemory?: (itemUid: string) => void;
}

export function DashboardView({ vaultStatus, onOpenReview, onOpenMemory }: DashboardViewProps) {
  const [logs, setLogs] = useState<VaultLogEntry[]>([]);
  const [latest, setLatest] = useState<VaultMemory[]>([]);
  const [settings, setSettings] = useState<VaultSettings | null>(null);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);
  const [pendingDeleteCount, setPendingDeleteCount] = useState(0);
  const [momentum, setMomentum] = useState<VaultProjectMomentum[]>([]);
  const [openLoops, setOpenLoops] = useState<VaultOpenLoop[]>([]);
  const [openLoopTagFilter, setOpenLoopTagFilter] = useState<string[]>([]);

  useEffect(() => {
    void hydrateOverview();
  }, []);

  async function hydrateOverview() {
    try {
      const [
        latestResponse,
        logsResponse,
        settingsResponse,
        proposalsResponse,
        pendingDeleteResponse,
        momentumResponse,
        openLoopsResponse,
      ] = await Promise.all([
        window.vaultAPI.getLatest(undefined, 8),
        window.vaultAPI.getRecentLogs(240),
        window.vaultAPI.getAllSettings(),
        window.vaultAPI.listProjectProposals({ status: 'pending' }),
        window.vaultAPI.findMemory(buildPendingDeleteReviewQuery()),
        window.vaultAPI.getProjectsMomentum(),
        window.vaultAPI.getOpenLoops(),
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

      if (momentumResponse.success && Array.isArray(momentumResponse.data)) {
        setMomentum(momentumResponse.data);
      }

      if (openLoopsResponse.success && Array.isArray(openLoopsResponse.data)) {
        setOpenLoops(openLoopsResponse.data);
      }
    } catch {
      setLatest([]);
      setLogs([]);
      setSettings(null);
      setPendingProposalCount(0);
      setPendingDeleteCount(0);
      setMomentum([]);
      setOpenLoops([]);
    }
  }

  const projectCount = vaultStatus?.projects.length || 0;
  const memoryCount =
    vaultStatus?.projects.reduce((count: number, project: VaultProject) => count + (project.memoryCount || 0), 0) || 0;
  const topProjects = [...(vaultStatus?.projects || [])]
    .sort((left, right) => (right.memoryCount || 0) - (left.memoryCount || 0))
    .slice(0, 5);
  const momentumByName = useMemo(
    () => new Map(momentum.map((entry) => [entry.name, entry])),
    [momentum],
  );
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
              <div className="panel-subtitle">Workspaces with the heaviest context footprint and weekly direction.</div>
            </div>
            <FolderKanban size={18} className="panel-icon" />
          </div>

          {topProjects.length === 0 ? (
            <div className="empty-state">No projects detected in the vault.</div>
          ) : (
            <div className="project-list">
              {topProjects.map((project) => {
                const m = momentumByName.get(project.name);
                return (
                  <article key={project.name} className="project-row">
                    <div>
                      <div className="project-row-title">
                        <span>{project.name}</span>
                        {m ? <MomentumBadge momentum={m} /> : null}
                      </div>
                      <div className="project-row-description">
                        {project.description || 'No description stored for this project.'}
                      </div>
                    </div>
                    <strong className="project-row-count">{project.memoryCount || 0}</strong>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <OpenLoopsSection
        loops={openLoops}
        activeTagFilter={openLoopTagFilter}
        onToggleTag={(tag) => setOpenLoopTagFilter((prev) => (
          prev.includes(tag) ? prev.filter((entry) => entry !== tag) : [...prev, tag]
        ))}
        onClearTags={() => setOpenLoopTagFilter([])}
        onRefresh={() => void hydrateOverview()}
        onOpenMemory={onOpenMemory}
      />

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

function MomentumBadge({ momentum }: { momentum: VaultProjectMomentum }) {
  const { direction, delta, lastActivityAt } = momentum;

  if (direction === 'inactive') {
    const inactiveDays = lastActivityAt
      ? Math.max(Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / (24 * 60 * 60 * 1000)), 14)
      : null;
    const note = inactiveDays !== null ? `inactive ${inactiveDays}d` : 'inactive';
    return (
      <span className="momentum-badge momentum-badge-inactive" title={lastActivityAt ? `Last activity ${new Date(lastActivityAt).toLocaleDateString()}` : 'No activity recorded'}>
        <MoonStar size={11} />
        <span>{note}</span>
      </span>
    );
  }

  if (direction === 'up') {
    return (
      <span className="momentum-badge momentum-badge-up" title={`+${delta} memories vs prior 7 days`}>
        <TrendingUp size={11} />
        <span>+{delta} this week</span>
      </span>
    );
  }

  if (direction === 'down') {
    return (
      <span className="momentum-badge momentum-badge-down" title={`${delta} memories vs prior 7 days`}>
        <TrendingDown size={11} />
        <span>{delta} this week</span>
      </span>
    );
  }

  return (
    <span className="momentum-badge momentum-badge-flat" title="No change vs prior 7 days">
      <Minus size={11} />
      <span>flat</span>
    </span>
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

const OPEN_LOOP_BUCKET_LABELS: Record<VaultOpenLoopBucket, { label: string; emoji: string }> = {
  high: { label: 'High priority', emoji: '🔥' },
  medium: { label: 'Medium', emoji: '🟡' },
  low: { label: 'Low / older', emoji: '⚪' },
};

const OPEN_LOOP_BUCKET_ORDER: VaultOpenLoopBucket[] = ['high', 'medium', 'low'];

const OPEN_LOOP_BUCKET_DEFAULT_LIMIT: Record<VaultOpenLoopBucket, number> = {
  high: 5,
  medium: 5,
  low: 3,
};

function OpenLoopsSection({
  loops,
  activeTagFilter,
  onToggleTag,
  onClearTags,
  onRefresh,
  onOpenMemory,
}: {
  loops: VaultOpenLoop[];
  activeTagFilter: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  onRefresh: () => void;
  onOpenMemory?: (itemUid: string) => void;
}) {
  const distinctTags = useMemo(() => {
    const map = new Map<string, number>();
    for (const loop of loops) {
      for (const tag of loop.tags) {
        map.set(tag, (map.get(tag) || 0) + 1);
      }
    }
    return Array.from(map.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([tag]) => tag);
  }, [loops]);

  const filteredLoops = useMemo(() => {
    if (activeTagFilter.length === 0) return loops;
    return loops.filter((loop) => activeTagFilter.every((tag) => loop.tags.includes(tag)));
  }, [loops, activeTagFilter]);

  const bucketed = useMemo(() => {
    const groups: Record<VaultOpenLoopBucket, VaultOpenLoop[]> = { high: [], medium: [], low: [] };
    for (const loop of filteredLoops) {
      groups[loop.bucket].push(loop);
    }
    return groups;
  }, [filteredLoops]);

  const focusLoops = useMemo(() => buildOpenLoopFocusList(filteredLoops, 3), [filteredLoops]);

  const [expandedBuckets, setExpandedBuckets] = useState<Record<VaultOpenLoopBucket, boolean>>({
    high: false,
    medium: false,
    low: false,
  });

  function toggleBucket(bucket: VaultOpenLoopBucket) {
    setExpandedBuckets((prev) => ({ ...prev, [bucket]: !prev[bucket] }));
  }

  return (
    <section className="panel open-loops-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">Open loops</div>
          <div className="panel-subtitle">
            Unfinished work surfaced from active memories with next steps and stagnant debugging items.
          </div>
        </div>
        <ListChecks size={18} className="panel-icon" />
      </div>

      {loops.length === 0 ? (
        <div className="empty-state">No open loops detected — everything active has been resolved or has no next steps.</div>
      ) : (
        <>
          {distinctTags.length > 0 ? (
            <div className="open-loops-tag-filter">
              <span className="open-loops-tag-filter-label">Filter by tag</span>
              <div className="open-loops-tag-chips">
                {distinctTags.slice(0, 18).map((tag) => {
                  const active = activeTagFilter.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`open-loops-tag-chip${active ? ' open-loops-tag-chip-active' : ''}`}
                      onClick={() => onToggleTag(tag)}
                    >
                      {tag}
                    </button>
                  );
                })}
                {activeTagFilter.length > 0 ? (
                  <button
                    type="button"
                    className="open-loops-tag-chip-clear"
                    onClick={onClearTags}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {filteredLoops.length === 0 ? (
            <div className="empty-state">No open loops match the current tag filter.</div>
          ) : (
            <>
              {focusLoops.length > 0 ? (
                <div className="open-loops-focus">
                  <div className="open-loops-focus-label">Today</div>
                  <ol className="open-loops-focus-list">
                    {focusLoops.map((loop) => (
                      <li key={loop.itemUid}>
                        <span className="open-loops-focus-title">{loop.title}</span>
                        <span className="open-loops-focus-next">Next: {getOpenLoopNextAction(loop)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              <div className="open-loops-buckets">
                {OPEN_LOOP_BUCKET_ORDER.map((bucket) => {
                  const items = bucketed[bucket];
                  if (items.length === 0) return null;
                  const meta = OPEN_LOOP_BUCKET_LABELS[bucket];
                  const limit = OPEN_LOOP_BUCKET_DEFAULT_LIMIT[bucket];
                  const expanded = expandedBuckets[bucket];
                  const hiddenCount = Math.max(0, items.length - limit);
                  const visibleItems = expanded ? items : items.slice(0, limit);
                  return (
                    <div key={bucket} className={`open-loops-bucket open-loops-bucket-${bucket}`}>
                      <div className="open-loops-bucket-header">
                        <span className="open-loops-bucket-emoji" aria-hidden>{meta.emoji}</span>
                        <span className="open-loops-bucket-label">{meta.label}</span>
                        <span className="open-loops-bucket-count">{items.length}</span>
                      </div>
                      <ul className="open-loops-list">
                        {visibleItems.map((loop) => (
                          <OpenLoopRow
                            key={loop.itemUid}
                            loop={loop}
                            onRefresh={onRefresh}
                            onOpenMemory={onOpenMemory}
                          />
                        ))}
                      </ul>
                      {hiddenCount > 0 ? (
                        <button
                          type="button"
                          className="open-loops-bucket-toggle"
                          onClick={() => toggleBucket(bucket)}
                        >
                          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function OpenLoopRow({
  loop,
  onRefresh,
  onOpenMemory,
}: {
  loop: VaultOpenLoop;
  onRefresh: () => void;
  onOpenMemory?: (itemUid: string) => void;
}) {
  const staleness = getOpenLoopStaleness(loop.daysOpen);
  const nextAction = getOpenLoopNextAction(loop);
  const [busyAction, setBusyAction] = useState<'resolve' | 'snooze' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleResolve() {
    setBusyAction('resolve');
    setError(null);
    try {
      const response = await window.vaultAPI.resolveLoop({
        itemUid: loop.itemUid,
        outcome: 'fixed',
        resolutionNote: 'Resolved from the Overview open loops panel.',
      });
      if (!response.success) {
        throw new Error(response.error || 'Failed to resolve loop');
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve loop');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSnooze() {
    setBusyAction('snooze');
    setError(null);
    try {
      const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const response = await window.vaultAPI.updateMemory(loop.itemUid, { snoozedUntil });
      if (!response.success) {
        throw new Error(response.error || 'Failed to snooze loop');
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to snooze loop');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <li className={`open-loops-row open-loops-row-pressure-${staleness.tone}`}>
      <div className="open-loops-row-head">
        <RoutineIcon routineType={loop.routineType} />
        <span className="open-loops-row-title">{loop.title}</span>
        <StalenessBadge staleness={staleness} lastUpdated={loop.lastUpdated} />
      </div>
      <div className="open-loops-row-meta">
        <span className="open-loops-row-project">{loop.project}</span>
        <span className="open-loops-row-signals" title="Why this loop is surfaced">
          {describeOpenLoopSignals(loop)}
        </span>
        {loop.recentlyReferenced ? (
          <span className="open-loops-row-recent" title="Referenced within the last 3 days">
            recently referenced
          </span>
        ) : null}
      </div>
      {nextAction ? (
        <div className="open-loops-row-next" title={loop.nextSteps.join(' • ') || nextAction}>
          <span>Next:</span> {nextAction}
          {loop.nextSteps.length > 1 ? (
            <span className="open-loops-row-next-more"> (+{loop.nextSteps.length - 1})</span>
          ) : null}
        </div>
      ) : null}
      <div className="open-loops-row-actions">
        <button
          type="button"
          className="open-loops-row-action open-loops-row-action-resolve"
          title="Close this loop with outcome: fixed"
          onClick={() => void handleResolve()}
          disabled={busyAction !== null}
        >
          <CheckCircle2 size={12} />
          <span>{busyAction === 'resolve' ? 'Resolving' : 'Resolve fixed'}</span>
        </button>
        <button
          type="button"
          className="open-loops-row-action"
          onClick={() => void handleSnooze()}
          disabled={busyAction !== null}
        >
          <Clock3 size={12} />
          <span>{busyAction === 'snooze' ? 'Snoozing' : 'Snooze 1d'}</span>
        </button>
        {onOpenMemory ? (
          <button
            type="button"
            className="open-loops-row-action"
            onClick={() => onOpenMemory(loop.itemUid)}
            disabled={busyAction !== null}
          >
            <ExternalLink size={12} />
            <span>Open</span>
          </button>
        ) : null}
      </div>
      {error ? <div className="open-loops-row-error">{error}</div> : null}
    </li>
  );
}

function StalenessBadge({
  staleness,
  lastUpdated,
}: {
  staleness: { tone: OpenLoopStalenessTone; label: string; title: string };
  lastUpdated: string;
}) {
  return (
    <span
      className={`open-loops-row-age open-loops-row-age-${staleness.tone}`}
      title={`${staleness.title} Last updated ${new Date(lastUpdated).toLocaleString()}`}
    >
      {staleness.label}
    </span>
  );
}

function RoutineIcon({ routineType }: { routineType: VaultRoutineType | null }) {
  const size = 12;
  const iconClass = `open-loops-routine-icon open-loops-routine-${routineType ?? 'none'}`;
  switch (routineType) {
    case 'debugging':
      return <Bug size={size} className={iconClass} aria-label="debugging" />;
    case 'deployment':
      return <Rocket size={size} className={iconClass} aria-label="deployment" />;
    case 'planning':
      return <ListChecks size={size} className={iconClass} aria-label="planning" />;
    case 'testing':
      return <TestTube2 size={size} className={iconClass} aria-label="testing" />;
    case 'review':
      return <Search size={size} className={iconClass} aria-label="review" />;
    case 'implementation':
      return <Hammer size={size} className={iconClass} aria-label="implementation" />;
    case 'refactor':
      return <Wrench size={size} className={iconClass} aria-label="refactor" />;
    case 'brainstorming':
      return <Lightbulb size={size} className={iconClass} aria-label="brainstorming" />;
    default:
      return <PencilRuler size={size} className={iconClass} aria-label="general" />;
  }
}
