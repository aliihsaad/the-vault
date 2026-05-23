import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Activity,
  AlertTriangle,
  Boxes,
  BrainCircuit,
  Database,
  FileText,
  GitBranch,
  ListChecks,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildActivitySeries,
  buildMemoryTypeMetrics,
  buildProjectCockpitRows,
  buildRecallTrend,
  buildRelationshipGraphPreview,
  extractResultCount,
  extractTotalCandidates,
  formatCompactNumber,
  getRecallPackingSettings,
  isSameLocalDay,
  type ProjectCockpitRow,
} from '../cockpit-metrics.js';
import { buildPendingDeleteReviewQuery } from '../agent-review-query.js';
import { MemoryGraphCanvas } from './MemoryGraphCanvas.js';

type PrimaryCockpitTab =
  | 'memories'
  | 'projects'
  | 'handoffs'
  | 'decisions'
  | 'loops'
  | 'graph'
  | 'recall'
  | 'analytics'
  | 'agent';

type OverviewCockpitViewProps = {
  vaultStatus: VaultStatus | null;
  onOpenReview?: (tab: 'proposals' | 'pending-deletes') => void;
  onOpenMemory?: (itemUid: string) => void;
  onNavigate?: (tab: PrimaryCockpitTab) => void;
};

export function OverviewCockpitView({
  vaultStatus,
  onOpenReview,
  onOpenMemory,
  onNavigate,
}: OverviewCockpitViewProps) {
  const [logs, setLogs] = useState<VaultLogEntry[]>([]);
  const [recallLogs, setRecallLogs] = useState<VaultLogEntry[]>([]);
  const [latest, setLatest] = useState<VaultMemory[]>([]);
  const [settings, setSettings] = useState<VaultSettings | null>(null);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);
  const [pendingDeleteCount, setPendingDeleteCount] = useState(0);
  const [momentum, setMomentum] = useState<VaultProjectMomentum[]>([]);
  const [openLoops, setOpenLoops] = useState<VaultOpenLoop[]>([]);
  const [workspaces, setWorkspaces] = useState<ProjectWorkspaceConfig[]>([]);
  const [queueStats, setQueueStats] = useState<VaultTaskQueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrateOverview();
  }, []);

  async function hydrateOverview() {
    setLoading(true);
    setError(null);

    try {
      const [
        latestResponse,
        logsResponse,
        recallLogsResponse,
        settingsResponse,
        proposalsResponse,
        pendingDeleteResponse,
        momentumResponse,
        openLoopsResponse,
        workspacesResponse,
        queueStatsResponse,
      ] = await Promise.all([
        window.vaultAPI.getLatest(undefined, 80),
        window.vaultAPI.getRecentLogs(320),
        window.vaultAPI.getRecentLogs(420, { actionType: 'recall' }),
        window.vaultAPI.getAllSettings(),
        window.vaultAPI.listProjectProposals({ status: 'pending' }),
        window.vaultAPI.findMemory(buildPendingDeleteReviewQuery()),
        window.vaultAPI.getProjectsMomentum(),
        window.vaultAPI.getOpenLoops(),
        window.vaultAPI.listProjectWorkspaces(),
        window.vaultAPI.getTaskQueueStats(),
      ]);

      if (latestResponse.success) setLatest(latestResponse.data || []);
      if (logsResponse.success) setLogs(logsResponse.data || []);
      if (recallLogsResponse.success) setRecallLogs(recallLogsResponse.data || []);
      if (settingsResponse.success) setSettings(settingsResponse.data || null);
      if (proposalsResponse.success) setPendingProposalCount(proposalsResponse.data?.length || 0);
      if (pendingDeleteResponse.success) setPendingDeleteCount(pendingDeleteResponse.data?.length || 0);
      if (momentumResponse.success) setMomentum(momentumResponse.data || []);
      if (openLoopsResponse.success) setOpenLoops(openLoopsResponse.data || []);
      if (workspacesResponse.success) setWorkspaces(workspacesResponse.data || []);
      if (queueStatsResponse.success) setQueueStats(queueStatsResponse.data || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load overview data');
    } finally {
      setLoading(false);
    }
  }

  const projects = vaultStatus?.projects || [];
  const totalMemories = projects.reduce((count, project) => count + (project.memoryCount || 0), 0);
  const recallPacking = getRecallPackingSettings(settings);
  const recallTrend = useMemo(() => buildRecallTrend(recallLogs, 14, recallPacking), [recallLogs, recallPacking]);
  const activitySeries = useMemo(() => buildActivitySeries(logs, 7), [logs]);
  const memoryTypeMetrics = useMemo(() => buildMemoryTypeMetrics(latest), [latest]);
  const projectRows = useMemo(
    () => buildProjectCockpitRows({ projects, momentum, workspaces, memories: latest, logs, openLoops }),
    [projects, momentum, workspaces, latest, logs, openLoops],
  );
  const graph = useMemo(() => buildRelationshipGraphPreview(latest, projects, 28), [latest, projects]);
  const todayRecallLogs = recallLogs.filter((log) => isSameLocalDay(log.timestamp, new Date()));
  const todayCandidates = todayRecallLogs.reduce((sum, log) => sum + extractTotalCandidates(log), 0);
  const todayReturned = todayRecallLogs.reduce((sum, log) => sum + extractResultCount(log), 0);
  const recallWindowCandidates = recallTrend.reduce((sum, day) => sum + day.candidates, 0);
  const recallWindowReturned = recallTrend.reduce((sum, day) => sum + day.returned, 0);
  const recallWindowTokensSaved = recallTrend.reduce((sum, day) => sum + day.tokensSaved, 0);
  const recallEfficiency = recallWindowCandidates > 0 ? Math.round((1 - recallWindowReturned / recallWindowCandidates) * 100) : 0;
  const latestCapture = latest[0]?.createdAt ? `${formatDistanceToNow(new Date(latest[0].createdAt))} ago` : 'No captures';
  const latestActivity = logs[0]?.timestamp ? `${formatDistanceToNow(new Date(logs[0].timestamp))} ago` : 'No activity';
  const unresolvedReviewCount = pendingProposalCount + pendingDeleteCount;

  return (
    <div className="cockpit-overview">
      <section className="cockpit-hero">
        <div className="cockpit-hero-copy">
          <span className="cockpit-kicker">Local memory operations</span>
          <h1>The Vault is running locally</h1>
          <p>
            A live control surface for project memory, recall health, open loops, MCP-connected work,
            and review queues. Every number below is derived from this vault instance.
          </p>
        </div>

        <div className="cockpit-status-grid">
          <div className="cockpit-status-card">
            <span className="status-dot status-dot-online" />
            <div>
              <strong>{vaultStatus?.initialized ? 'Local mode' : loading ? 'Connecting' : 'Unavailable'}</strong>
              <span>{vaultStatus?.root || 'Vault root unavailable'}</span>
            </div>
          </div>
          <button type="button" className="header-button" onClick={() => void hydrateOverview()} disabled={loading}>
            <RefreshCw size={16} />
            <span>{loading ? 'Refreshing' : 'Refresh telemetry'}</span>
          </button>
        </div>
      </section>

      {error ? <div className="panel empty-state empty-state-error">{error}</div> : null}

      <section className="cockpit-metric-grid" aria-label="Vault operation metrics">
        <MetricCard
          icon={<Database size={18} />}
          label="Memory footprint"
          value={formatCompactNumber(totalMemories)}
          note={`${projects.length} project${projects.length === 1 ? '' : 's'} indexed locally`}
          tone="blue"
          series={projectRows.map((row) => row.memoryCount)}
        />
        <MetricCard
          icon={<Sparkles size={18} />}
          label="Latest capture"
          value={latestCapture}
          note={latest[0] ? `${latest[0].memoryType} in ${latest[0].project}` : 'No memory items stored yet'}
          tone="cyan"
          series={activitySeries.map((day) => day.save)}
        />
        <MetricCard
          icon={<ListChecks size={18} />}
          label="Open loops"
          value={String(openLoops.length)}
          note={openLoops.length > 0 ? `${openLoops.filter((loop) => loop.bucket === 'high').length} high-priority` : 'No active loop pressure'}
          tone="amber"
          series={projectRows.map((row) => row.openLoopCount)}
          onClick={() => onNavigate?.('loops')}
        />
        <MetricCard
          icon={<BrainCircuit size={18} />}
          label="Recall efficiency"
          value={`${recallEfficiency}%`}
          note={`${formatCompactNumber(recallWindowTokensSaved)} estimated tokens avoided over 14 days`}
          tone="violet"
          series={recallTrend.map((day) => day.tokensSaved)}
          onClick={() => onNavigate?.('recall')}
        />
      </section>

      <section className="cockpit-main-grid">
        <article className="panel cockpit-activity-panel">
          <PanelTitle
            icon={<Activity size={18} />}
            title="Activity feed"
            subtitle={`Latest operational event ${latestActivity}`}
            actionLabel="Open Activity"
            onAction={() => onNavigate?.('analytics')}
          />
          {logs.length === 0 ? (
            <div className="empty-state">No operational activity has been logged yet.</div>
          ) : (
            <div className="cockpit-feed">
              {logs.slice(0, 10).map((log) => (
                <button
                  key={`${log.id ?? log.timestamp}-${log.actionType}-${log.targetItemId ?? ''}`}
                  type="button"
                  className="cockpit-feed-row"
                  onClick={() => {
                    if (log.targetItemId) {
                      onOpenMemory?.(log.targetItemId);
                    }
                  }}
                  disabled={!log.targetItemId}
                >
                  <span className={`cockpit-feed-icon cockpit-feed-icon-${log.actionType}`}>
                    {actionIcon(log.actionType)}
                  </span>
                  <span className="cockpit-feed-copy">
                    <strong>{log.message || `${log.actionType} event`}</strong>
                    <span>
                      {log.project || 'global'} · {log.sourceClient}
                      {typeof log.latencyMs === 'number' ? ` · ${log.latencyMs}ms` : ''}
                    </span>
                  </span>
                  <span className="cockpit-feed-time">
                    {log.timestamp ? formatDistanceToNow(new Date(log.timestamp)) : 'unknown'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="panel cockpit-graph-panel">
          <PanelTitle
            icon={<Waypoints size={18} />}
            title="Recent relationship graph"
            subtitle={`${graph.nodes.length} nodes from recent linked memories, files, and their projects`}
            actionLabel="Open Graph"
            onAction={() => onNavigate?.('graph')}
          />
          <MemoryGraphCanvas graph={graph} variant="compact" onOpenMemory={onOpenMemory} />
        </article>

        <article className="panel cockpit-radar-panel">
          <PanelTitle
            icon={<GitBranch size={18} />}
            title="Project radar"
            subtitle="Direct counters from projects, logs, loops, and workspaces"
            actionLabel="Open Projects"
            onAction={() => onNavigate?.('projects')}
          />
          <ProjectRadar rows={projectRows.slice(0, 4)} />
        </article>
      </section>

      <section className="cockpit-lower-grid">
        <article className="panel">
          <PanelTitle
            icon={<ListChecks size={18} />}
            title="Open loop control"
            subtitle="Next actions surfaced from active memory items"
            actionLabel="Open Loops"
            onAction={() => onNavigate?.('loops')}
          />
          {openLoops.length === 0 ? (
            <div className="empty-state">No open loops detected.</div>
          ) : (
            <div className="cockpit-loop-list">
              {openLoops.slice(0, 5).map((loop) => (
                <button
                  key={loop.itemUid}
                  type="button"
                  className={`cockpit-loop-row cockpit-loop-${loop.bucket}`}
                  onClick={() => onOpenMemory?.(loop.itemUid)}
                >
                  <span className="cockpit-loop-pressure">{loop.bucket}</span>
                  <span className="cockpit-loop-copy">
                    <strong>{loop.title}</strong>
                    <span>{loop.nextSteps[0] || loop.summary}</span>
                  </span>
                  <span className="cockpit-loop-age">{loop.daysOpen}d</span>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <PanelTitle
            icon={<Search size={18} />}
            title="Recall trend"
            subtitle={`${todayReturned} of ${todayCandidates} candidates returned today`}
            actionLabel="Open Recall"
            onAction={() => onNavigate?.('recall')}
          />
          <div className="cockpit-chart cockpit-chart-short">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
              <AreaChart data={recallTrend} margin={{ top: 12, right: 16, bottom: 4, left: -18 }}>
                <defs>
                  <linearGradient id="recallFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b7cff" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="#8b7cff" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148, 166, 198, 0.12)" vertical={false} />
                <XAxis dataKey="isoDate" stroke="#708097" tickLine={false} axisLine={false} tickFormatter={formatDateTick} />
                <YAxis stroke="#708097" tickLine={false} axisLine={false} tickFormatter={formatCompactNumber} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="tokensSaved" stroke="#8b7cff" strokeWidth={2} fill="url(#recallFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel">
          <PanelTitle
            icon={<Boxes size={18} />}
            title="Operational telemetry"
            subtitle="Activity rates from stored logs"
            actionLabel="Open Analytics"
            onAction={() => onNavigate?.('analytics')}
          />
          <div className="cockpit-chart cockpit-chart-short">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
              <BarChart data={activitySeries} margin={{ top: 12, right: 16, bottom: 4, left: -18 }}>
                <CartesianGrid stroke="rgba(148, 166, 198, 0.12)" vertical={false} />
                <XAxis dataKey="key" stroke="#708097" tickLine={false} axisLine={false} tickFormatter={formatDateTick} />
                <YAxis stroke="#708097" tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="save" stackId="activity" fill="#38dfff" radius={[4, 4, 0, 0]} />
                <Bar dataKey="recall" stackId="activity" fill="#8b7cff" radius={[4, 4, 0, 0]} />
                <Bar dataKey="update" stackId="activity" fill="#33d691" radius={[4, 4, 0, 0]} />
                <Bar dataKey="error" stackId="activity" fill="#f5a524" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="cockpit-secondary-grid">
        <SecondaryCard
          icon={<ShieldCheck size={18} />}
          title="Review queue"
          value={String(unresolvedReviewCount)}
          detail={`${pendingProposalCount} proposals, ${pendingDeleteCount} pending deletes`}
          onClick={() => onOpenReview?.(pendingProposalCount > 0 ? 'proposals' : 'pending-deletes')}
        />
        <SecondaryCard
          icon={<FileText size={18} />}
          title="Recent captures"
          value={String(latest.length)}
          detail={latest[0] ? `${latest[0].title} in ${latest[0].project}` : 'No captures loaded'}
          onClick={() => onNavigate?.('memories')}
        />
        <SecondaryCard
          icon={<BrainCircuit size={18} />}
          title="Agent queue"
          value={String((queueStats?.pending || 0) + (queueStats?.running || 0))}
          detail={`${queueStats?.pending || 0} pending, ${queueStats?.running || 0} running`}
          onClick={() => onNavigate?.('agent')}
        />
        <SecondaryCard
          icon={<Database size={18} />}
          title="Memory types"
          value={String(memoryTypeMetrics.reduce((sum, entry) => sum + entry.count, 0))}
          detail={memoryTypeMetrics.map((entry) => `${entry.type} ${entry.count}`).slice(0, 3).join(' · ') || 'No recent memory type mix'}
          onClick={() => onNavigate?.('memories')}
        />
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  note,
  tone,
  series,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  tone: 'blue' | 'cyan' | 'violet' | 'amber';
  series: number[];
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="cockpit-metric-head">
        <span className={`cockpit-metric-icon cockpit-metric-icon-${tone}`}>{icon}</span>
        <span>{label}</span>
      </div>
      <div className="cockpit-metric-body">
        <strong>{value}</strong>
        <Sparkline values={series} tone={tone} />
      </div>
      <p>{note}</p>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="cockpit-metric-card cockpit-metric-card-button" onClick={onClick}>
        {content}
      </button>
    );
  }

  return <article className="cockpit-metric-card">{content}</article>;
}

function Sparkline({ values, tone }: { values: number[]; tone: 'blue' | 'cyan' | 'violet' | 'amber' }) {
  const normalizedValues = values.length > 1 ? values : [0, values[0] || 0];
  const max = Math.max(...normalizedValues, 1);
  const points = normalizedValues
    .map((value, index) => {
      const x = (index / Math.max(normalizedValues.length - 1, 1)) * 112;
      const y = 34 - (value / max) * 30;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className={`cockpit-sparkline cockpit-sparkline-${tone}`} viewBox="0 0 112 38" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

function PanelTitle({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="panel-header cockpit-panel-header">
      <div>
        <div className="panel-title">
          <span className="cockpit-panel-title-icon">{icon}</span>
          {title}
        </div>
        <div className="panel-subtitle">{subtitle}</div>
      </div>
      {actionLabel && onAction ? (
        <button type="button" className="header-button header-button-compact" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function ProjectRadar({ rows }: { rows: ProjectCockpitRow[] }) {
  if (rows.length === 0) {
    return <div className="empty-state">No projects available for project signals.</div>;
  }

  const maxMemory = Math.max(...rows.map((row) => row.memoryCount), 1);
  const maxRecent = Math.max(...rows.map((row) => row.last7dCount), 1);
  const maxLogs = Math.max(...rows.map((row) => row.logCount), 1);

  return (
    <div className="cockpit-project-signal-board">
      {rows.map((row) => {
        const memoryWidth = signalWidth(row.memoryCount, maxMemory);
        const recentWidth = signalWidth(row.last7dCount, maxRecent);
        const logWidth = signalWidth(row.logCount, maxLogs);
        const deltaLabel = row.direction === 'up'
          ? `+${row.delta}`
          : row.direction === 'down'
            ? String(row.delta)
            : '0';

        return (
          <article key={row.name} className="cockpit-project-signal-row">
            <div className="cockpit-project-signal-head">
              <div>
                <strong>{row.name}</strong>
                <span>{row.description}</span>
              </div>
              <em className={`ops-momentum ops-momentum-${row.direction}`}>{deltaLabel}</em>
            </div>

            <div className="cockpit-project-signal-bars">
              <SignalBar label="Memories" value={formatCompactNumber(row.memoryCount)} width={memoryWidth} tone="cyan" />
              <SignalBar label="Recent 7d" value={formatCompactNumber(row.last7dCount)} width={recentWidth} tone="violet" />
              <SignalBar label="Log events" value={formatCompactNumber(row.logCount)} width={logWidth} tone="blue" />
            </div>

            <div className="cockpit-project-signal-meta">
              <span>{row.openLoopCount} open loop{row.openLoopCount === 1 ? '' : 's'}</span>
              <span>{row.prior7dCount} prior 7d</span>
              <span>{row.workspacePath ? (row.workspaceTrusted ? 'trusted workspace' : 'workspace mapped') : 'no workspace'}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SignalBar({
  label,
  value,
  width,
  tone,
}: {
  label: string;
  value: string;
  width: string;
  tone: 'blue' | 'cyan' | 'violet';
}) {
  return (
    <div className="cockpit-project-signal-bar">
      <div className="cockpit-project-signal-bar-head">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="cockpit-project-signal-track" aria-hidden="true">
        <span className={`cockpit-project-signal-fill cockpit-project-signal-fill-${tone}`} style={{ width }} />
      </div>
    </div>
  );
}

function signalWidth(value: number, max: number): string {
  if (value <= 0 || max <= 0) {
    return '0%';
  }

  return `${Math.max(5, Math.round((value / max) * 100))}%`;
}

function SecondaryCard({
  icon,
  title,
  value,
  detail,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  detail: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="cockpit-secondary-card" onClick={onClick}>
      <span className="cockpit-secondary-icon">{icon}</span>
      <span className="cockpit-secondary-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <span className="cockpit-secondary-value">{value}</span>
    </button>
  );
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: { label?: string; name?: string } }>;
  label?: string;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const formattedLabel = formatChartLabel(label);
  const title = formattedLabel === 'Value'
    ? payload[0]?.payload?.name || payload[0]?.payload?.label || formattedLabel
    : formattedLabel;

  return (
    <div className="cockpit-chart-tooltip">
      <strong>{title}</strong>
      {payload.map((entry) => (
        <span key={entry.name} style={{ color: entry.color }}>
          {entry.name}: {typeof entry.value === 'number' ? formatCompactNumber(entry.value) : entry.value}
        </span>
      ))}
    </div>
  );
}

function formatDateTick(value: string | number): string {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString(undefined, { weekday: 'short' });
}

function formatChartLabel(value: string | undefined): string {
  if (!value) {
    return 'Value';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function actionIcon(actionType: VaultActionType) {
  switch (actionType) {
    case 'error':
      return <AlertTriangle size={15} />;
    case 'recall':
      return <Search size={15} />;
    case 'save':
      return <Database size={15} />;
    default:
      return <Activity size={15} />;
  }
}
