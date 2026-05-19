import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bug,
  CheckCircle2,
  Clock3,
  Eye,
  Flame,
  Gauge,
  Database,
  FileText,
  Filter,
  GitBranch,
  ListChecks,
  RefreshCw,
  Search,
  ShieldCheck,
  Tags,
  Target,
  Waypoints,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
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
  buildStatusMetrics,
  extractResultCount,
  extractTotalCandidates,
  formatCompactNumber,
  getRecallPackingSettings,
  type ProjectCockpitRow,
} from '../cockpit-metrics.js';
import {
  buildLoopControlModel,
  type LoopControlRow,
  type LoopControlRoutineFilter,
} from '../open-loop-ui.js';
import { MemoryGraphCanvas } from './MemoryGraphCanvas.js';

const CHART_COLORS = ['#38dfff', '#8b7cff', '#33d691', '#f5a524', '#5f8fff', '#ec6dff', '#8ba0b8'];

export function ProjectsOperationsView({
  vaultStatus,
}: {
  vaultStatus: VaultStatus | null;
}) {
  const [latest, setLatest] = useState<VaultMemory[]>([]);
  const [logs, setLogs] = useState<VaultLogEntry[]>([]);
  const [momentum, setMomentum] = useState<VaultProjectMomentum[]>([]);
  const [openLoops, setOpenLoops] = useState<VaultOpenLoop[]>([]);
  const [workspaces, setWorkspaces] = useState<ProjectWorkspaceConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void hydrate();
  }, []);

  async function hydrate() {
    setLoading(true);
    try {
      const [latestResponse, logsResponse, momentumResponse, loopsResponse, workspacesResponse] = await Promise.all([
        window.vaultAPI.getLatest(undefined, 160),
        window.vaultAPI.getRecentLogs(300),
        window.vaultAPI.getProjectsMomentum(),
        window.vaultAPI.getOpenLoops(),
        window.vaultAPI.listProjectWorkspaces(),
      ]);

      if (latestResponse.success) setLatest(latestResponse.data || []);
      if (logsResponse.success) setLogs(logsResponse.data || []);
      if (momentumResponse.success) setMomentum(momentumResponse.data || []);
      if (loopsResponse.success) setOpenLoops(loopsResponse.data || []);
      if (workspacesResponse.success) setWorkspaces(workspacesResponse.data || []);
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(
    () => buildProjectCockpitRows({
      projects: vaultStatus?.projects || [],
      momentum,
      workspaces,
      memories: latest,
      logs,
      openLoops,
    }),
    [vaultStatus?.projects, momentum, workspaces, latest, logs, openLoops],
  );
  const activeWorkspaces = rows.filter((row) => row.workspacePath).length;
  const movingProjects = rows.filter((row) => row.direction === 'up').length;

  return (
    <div className="ops-layout">
      <OpsIntro
        label="Projects"
        title="Project radar"
        text="Project health is derived from saved project metadata, recent memories, workspace registry state, activity logs, and open-loop pressure."
        chips={[`${rows.length} projects`, `${activeWorkspaces} workspaces`, `${movingProjects} gaining momentum`]}
        onRefresh={() => void hydrate()}
        loading={loading}
      />

      <section className="ops-project-grid">
        <div className="panel ops-project-chart">
          <PanelHeader icon={<BarChart3 size={18} />} title="Momentum map" subtitle="Last seven days by project." />
          <div className="ops-chart-tall">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
              <BarChart data={rows.slice(0, 12)} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
                <CartesianGrid stroke="rgba(148, 166, 198, 0.12)" horizontal={false} />
                <XAxis type="number" stroke="#708097" tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis dataKey="name" type="category" width={126} stroke="#a8b4c6" tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="last7dCount" fill="#38dfff" radius={[0, 7, 7, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="ops-project-list">
          {rows.length === 0 ? (
            <div className="panel empty-state">No projects are stored in this vault yet.</div>
          ) : rows.map((row) => <ProjectOpsRow key={row.name} row={row} />)}
        </div>
      </section>
    </div>
  );
}

export function FilteredMemoryWorkspaceView({
  memoryType,
  label,
  title,
  text,
  onOpenMemory,
}: {
  memoryType: VaultMemoryType;
  label: string;
  title: string;
  text: string;
  onOpenMemory?: (itemUid: string) => void;
}) {
  const [memories, setMemories] = useState<VaultMemory[]>([]);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | VaultStatusValue>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void hydrate();
  }, [memoryType]);

  async function hydrate() {
    setLoading(true);
    try {
      const response = await window.vaultAPI.findMemory({ memoryType, limit: 140 });
      if (response.success) {
        setMemories(response.data || []);
      }
    } finally {
      setLoading(false);
    }
  }

  const projects = Array.from(new Set(memories.map((memory) => memory.project))).sort();
  const visible = memories.filter((memory) => {
    const haystack = [memory.title, memory.project, memory.subject, memory.summary, ...memory.tags, ...memory.keywords].join(' ').toLowerCase();
    return (!search.trim() || haystack.includes(search.trim().toLowerCase()))
      && (projectFilter === 'all' || memory.project === projectFilter)
      && (statusFilter === 'all' || memory.status === statusFilter);
  });
  const promotedCount = memories.filter((memory) => memory.promoted).length;
  const withNextSteps = memories.filter((memory) => memory.nextSteps.length > 0).length;

  return (
    <div className="ops-layout">
      <OpsIntro
        label={label}
        title={title}
        text={text}
        chips={[`${memories.length} total`, `${promotedCount} promoted`, `${withNextSteps} with next steps`]}
        onRefresh={() => void hydrate()}
        loading={loading}
      />

      <section className="ops-workspace-grid">
        <div className="panel ops-filter-panel">
          <PanelHeader icon={<Filter size={18} />} title="Filters" subtitle={`Narrow ${memoryType} memories by project, status, and text.`} />
          <div className="toolbar-row toolbar-row-vertical">
            <label className="search-field">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${memoryType} memories`} />
            </label>
            <label className="select-field">
              <Database size={16} />
              <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                <option value="all">All projects</option>
                {projects.map((project) => <option key={project} value={project}>{project}</option>)}
              </select>
            </label>
            <label className="select-field">
              <ShieldCheck size={16} />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | VaultStatusValue)}>
                <option value="all">All statuses</option>
                <option value="active">active</option>
                <option value="resolved">resolved</option>
                <option value="draft">draft</option>
                <option value="promoted">promoted</option>
                <option value="archived">archived</option>
                <option value="stale">stale</option>
              </select>
            </label>
          </div>
        </div>

        <div className="ops-memory-results">
          {loading ? (
            <div className="panel empty-state">Loading {memoryType} memories...</div>
          ) : visible.length === 0 ? (
            <div className="panel empty-state">No {memoryType} memories match the current filters.</div>
          ) : visible.map((memory) => (
            <button key={memory.itemUid} type="button" className="ops-memory-row" onClick={() => onOpenMemory?.(memory.itemUid)}>
              <span className={`badge badge-${memory.memoryType}`}>{memory.memoryType}</span>
              <span className="ops-memory-copy">
                <strong>{memory.title}</strong>
                <span>{memory.summary}</span>
              </span>
              <span className="ops-memory-meta">
                <span>{memory.project}</span>
                <span>{memory.updatedAt ? formatDistanceToNow(new Date(memory.updatedAt)) : 'unknown'} ago</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function LoopsOperationsView({ onOpenMemory }: { onOpenMemory?: (itemUid: string) => void }) {
  const [loops, setLoops] = useState<VaultOpenLoop[]>([]);
  const [projectFilter, setProjectFilter] = useState('all');
  const [bucketFilter, setBucketFilter] = useState<'all' | VaultOpenLoopBucket>('all');
  const [routineFilter, setRoutineFilter] = useState<LoopControlRoutineFilter>('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [selectedLoopId, setSelectedLoopId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void hydrate();
  }, []);

  async function hydrate() {
    setLoading(true);
    try {
      const response = await window.vaultAPI.getOpenLoops();
      if (response.success) setLoops(response.data || []);
    } finally {
      setLoading(false);
    }
  }

  async function resolve(loop: VaultOpenLoop) {
    const response = await window.vaultAPI.resolveLoop({
      itemUid: loop.itemUid,
      outcome: 'fixed',
      resolutionNote: 'Resolved from the dedicated Loops control surface.',
    });
    if (response.success) void hydrate();
  }

  async function snooze(loop: VaultOpenLoop) {
    const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const response = await window.vaultAPI.updateMemory(loop.itemUid, { snoozedUntil });
    if (response.success) void hydrate();
  }

  const model = useMemo(
    () => buildLoopControlModel(loops, {
      project: projectFilter,
      bucket: bucketFilter,
      routine: routineFilter,
      tag: tagFilter,
      selectedItemUid: selectedLoopId,
    }),
    [loops, projectFilter, bucketFilter, routineFilter, tagFilter, selectedLoopId],
  );

  useEffect(() => {
    const nextSelectedId = model.selected?.loop.itemUid || null;
    if (selectedLoopId !== nextSelectedId) {
      setSelectedLoopId(nextSelectedId);
    }
  }, [model.selected?.loop.itemUid, selectedLoopId]);

  return (
    <div className="ops-layout">
      <OpsIntro
        label="Loops"
        title="Open-loop control"
        text="Loop pressure comes from active memories with next steps and stagnant debugging threads. Actions update the underlying memory item."
        chips={[`${model.metrics.total} open`, `${model.metrics.high} high-priority`, `${model.metrics.stale} stale`]}
        onRefresh={() => void hydrate()}
        loading={loading}
      />

      <section className="ops-loop-kpi-grid" aria-label="Loop pressure metrics">
        <LoopKpiCard icon={<Gauge size={18} />} label="Visible queue" value={model.metrics.visible} detail={`${model.metrics.total} active loops loaded`} tone="cyan" />
        <LoopKpiCard icon={<Flame size={18} />} label="High pressure" value={model.metrics.high} detail={`${model.metrics.critical} critical age signals`} tone="amber" />
        <LoopKpiCard icon={<Clock3 size={18} />} label="Stale loops" value={model.metrics.stale} detail="Open seven days or more" tone="violet" />
        <LoopKpiCard icon={<Database size={18} />} label="Projects affected" value={model.metrics.projectCount} detail={`${model.metrics.medium} medium, ${model.metrics.low} low`} tone="blue" />
      </section>

      <section className="ops-loop-board">
        <div className="panel ops-loop-queue-panel">
          <PanelHeader icon={<ListChecks size={18} />} title="Loop queue" subtitle="Score-ranked work with pressure, next action, and source signals." />

          <div className="ops-loop-filters">
            <div className="ops-loop-filter-row ops-loop-filter-row-buckets">
              {(['all', 'high', 'medium', 'low'] as Array<'all' | VaultOpenLoopBucket>).map((bucket) => (
                <button
                  key={bucket}
                  type="button"
                  className={`ops-loop-filter-chip ${bucketFilter === bucket ? 'active' : ''}`}
                  onClick={() => setBucketFilter(bucket)}
                >
                  {bucket === 'all' ? 'All' : bucket}
                </button>
              ))}
            </div>

            <div className="ops-loop-filter-row">
              <label className="select-field">
                <Database size={16} />
                <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                  <option value="all">All projects</option>
                  {model.projects.map((project) => <option key={project} value={project}>{project}</option>)}
                </select>
              </label>
              <label className="select-field">
                <Target size={16} />
                <select value={routineFilter} onChange={(event) => setRoutineFilter(event.target.value as LoopControlRoutineFilter)}>
                  <option value="all">All routines</option>
                  {model.routines.map((routine) => <option key={routine} value={routine}>{routine === 'none' ? 'No routine' : routine}</option>)}
                </select>
              </label>
              <label className="select-field">
                <Tags size={16} />
                <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
                  <option value="all">All tags</option>
                  {model.tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="ops-loop-ticket-list">
            {loading ? (
              <div className="empty-state">Loading open loops...</div>
            ) : model.visible.length === 0 ? (
              <div className="empty-state">No loops match the current filters.</div>
            ) : model.visible.map((row) => (
              <LoopTicket
                key={row.loop.itemUid}
                row={row}
                selected={model.selected?.loop.itemUid === row.loop.itemUid}
                onSelect={() => setSelectedLoopId(row.loop.itemUid)}
              />
            ))}
          </div>
        </div>

        <LoopInspector
          row={model.selected}
          onOpenMemory={onOpenMemory}
          onSnooze={snooze}
          onResolve={resolve}
        />
      </section>
    </div>
  );
}

function LoopKpiCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  detail: string;
  tone: 'cyan' | 'amber' | 'violet' | 'blue';
}) {
  return (
    <article className={`ops-loop-kpi ops-loop-kpi-${tone}`}>
      <span className="ops-loop-kpi-icon">{icon}</span>
      <span className="ops-loop-kpi-copy">
        <strong>{value}</strong>
        <span>{label}</span>
        <em>{detail}</em>
      </span>
    </article>
  );
}

function LoopTicket({
  row,
  selected,
  onSelect,
}: {
  row: LoopControlRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const { loop, staleness, nextAction, pressure } = row;

  return (
    <button
      type="button"
      className={`ops-loop-ticket ops-loop-ticket-${loop.bucket} ops-loop-ticket-${staleness.tone} ${selected ? 'active' : ''}`}
      onClick={onSelect}
    >
      <span className="ops-loop-ticket-rail" aria-hidden="true">
        <span style={{ height: `${pressure}%` }} />
      </span>
      <span className="ops-loop-ticket-main">
        <span className="ops-loop-ticket-topline">
          <span className={`ops-loop-bucket ops-loop-bucket-${loop.bucket}`}>{loop.bucket}</span>
          <span className={`ops-loop-age ops-loop-age-${staleness.tone}`} title={staleness.title}>{staleness.label}</span>
          <span className="ops-loop-ticket-project">{loop.project}</span>
        </span>
        <strong>{loop.title}</strong>
        <span className="ops-loop-next">
          <span>Next</span>
          {nextAction}
        </span>
        <span className="ops-loop-ticket-meta">
          <span><RoutineGlyph routineType={loop.routineType} />{loop.routineType || 'general'}</span>
          <span>{loop.memoryType}</span>
          <span>score {Math.round(loop.score)}</span>
          {loop.recentlyReferenced ? <span>recent</span> : null}
          {loop.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}
        </span>
      </span>
    </button>
  );
}

function LoopInspector({
  row,
  onOpenMemory,
  onSnooze,
  onResolve,
}: {
  row: LoopControlRow | null;
  onOpenMemory?: (itemUid: string) => void;
  onSnooze: (loop: VaultOpenLoop) => Promise<void>;
  onResolve: (loop: VaultOpenLoop) => Promise<void>;
}) {
  if (!row) {
    return (
      <aside className="panel ops-loop-inspector ops-loop-inspector-empty">
        <PanelHeader icon={<Eye size={18} />} title="Loop inspector" subtitle="Select a loop to inspect source context and actions." />
        <div className="empty-state">No open loop selected.</div>
      </aside>
    );
  }

  const { loop, staleness, nextAction, signals, pressure } = row;

  return (
    <aside className={`panel ops-loop-inspector ops-loop-inspector-${loop.bucket}`}>
      <div className="ops-loop-inspector-head">
        <div>
          <span className="section-intro-eyebrow">Selected loop</span>
          <h2>{loop.title}</h2>
          <p>{loop.summary}</p>
        </div>
        <span className={`ops-loop-age ops-loop-age-${staleness.tone}`} title={staleness.title}>{staleness.label}</span>
      </div>

      <div className="ops-loop-pressure-block">
        <div className="ops-loop-pressure-copy">
          <span>Pressure</span>
          <strong>{pressure}</strong>
        </div>
        <div className="ops-loop-pressure-meter" aria-hidden="true">
          <span style={{ width: `${pressure}%` }} />
        </div>
      </div>

      <div className="ops-loop-inspector-actions">
        <button type="button" className="header-button" onClick={() => onOpenMemory?.(loop.itemUid)}>
          <Eye size={15} />
          <span>Open</span>
        </button>
        <button type="button" className="header-button" onClick={() => void onSnooze(loop)}>
          <Clock3 size={15} />
          <span>Snooze 1d</span>
        </button>
        <button type="button" className="primary-button" onClick={() => void onResolve(loop)}>
          <CheckCircle2 size={15} />
          <span>Resolve fixed</span>
        </button>
      </div>

      <div className="ops-loop-inspector-grid">
        <LoopInspectorMetric label="Project" value={loop.project} />
        <LoopInspectorMetric label="Memory" value={loop.memoryType} />
        <LoopInspectorMetric label="Routine" value={loop.routineType || 'general'} />
        <LoopInspectorMetric label="Score" value={String(Math.round(loop.score))} />
      </div>

      <div className="ops-loop-detail-block">
        <span>Next action</span>
        <strong>{nextAction}</strong>
      </div>

      {loop.nextSteps.length > 1 ? (
        <div className="ops-loop-detail-block">
          <span>Queued steps</span>
          <ol className="ops-loop-step-list">
            {loop.nextSteps.slice(1, 5).map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>
      ) : null}

      <div className="ops-loop-detail-block">
        <span>Signals</span>
        <strong>{signals}</strong>
      </div>

      <div className="ops-loop-tag-list">
        {loop.priority ? <span>{loop.priority}</span> : null}
        {loop.tags.length === 0 ? <span>no tags</span> : loop.tags.map((tag) => <span key={tag}>#{tag}</span>)}
        <span>{loop.daysOpen} days open</span>
        {loop.lastUpdated ? <span>updated {formatDistanceToNow(new Date(loop.lastUpdated))} ago</span> : null}
      </div>
    </aside>
  );
}

function LoopInspectorMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="ops-loop-inspector-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function RoutineGlyph({ routineType }: { routineType: VaultRoutineType | null }) {
  const size = 13;

  switch (routineType) {
    case 'debugging':
      return <Bug size={size} />;
    case 'deployment':
      return <Flame size={size} />;
    case 'review':
      return <Eye size={size} />;
    case 'testing':
      return <ShieldCheck size={size} />;
    case 'planning':
      return <Target size={size} />;
    case 'refactor':
      return <GitBranch size={size} />;
    case 'brainstorming':
      return <AlertTriangle size={size} />;
    default:
      return <Gauge size={size} />;
  }
}

export function GraphOperationsView({
  vaultStatus,
  onOpenMemory,
}: {
  vaultStatus: VaultStatus | null;
  onOpenMemory?: (itemUid: string) => void;
}) {
  const [memories, setMemories] = useState<VaultMemory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void hydrate();
  }, []);

  async function hydrate() {
    setLoading(true);
    try {
      const response = await window.vaultAPI.getLatest(undefined, 180);
      if (response.success) setMemories(response.data || []);
    } finally {
      setLoading(false);
    }
  }

  const graph = useMemo(() => buildRelationshipGraphPreview(memories, vaultStatus?.projects || [], 48), [memories, vaultStatus?.projects]);
  const linked = memories.filter((memory) => memory.relatedItemIds.length > 0 || memory.relatedFiles.length > 0);

  return (
    <div className="ops-layout">
      <OpsIntro
        label="Graph"
        title="Recent relationship preview"
        text="This graph is read-only and sampled from the most recent loaded memories. It shows stored project links, related memory UIDs, and related file paths, so quiet projects may not appear until their linked memories are loaded."
        chips={[`${graph.nodes.length} nodes`, `${graph.links.length} links`, `${linked.length} linked memories`]}
        onRefresh={() => void hydrate()}
        loading={loading}
      />

      <section className="ops-graph-grid">
        <div className="panel ops-graph-canvas">
          <PanelHeader icon={<Waypoints size={18} />} title="Recent relationship map" subtitle="Stored links from the loaded memory sample." />
          <MemoryGraphCanvas graph={graph} variant="full" onOpenMemory={onOpenMemory} />
        </div>

        <div className="panel ops-graph-side">
          <PanelHeader icon={<FileText size={18} />} title="Linked memories" subtitle="Loaded memories that already carry relationship data." />
          <div className="ops-side-list">
            {linked.length === 0 ? <div className="empty-state">No linked memory items found in the loaded set.</div> : linked.slice(0, 18).map((memory) => (
              <button key={memory.itemUid} type="button" className="ops-side-row" onClick={() => onOpenMemory?.(memory.itemUid)}>
                <strong>{memory.title}</strong>
                <span>{memory.relatedItemIds.length} memory links · {memory.relatedFiles.length} files</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export function RecallOperationsView() {
  const [logs, setLogs] = useState<VaultLogEntry[]>([]);
  const [settings, setSettings] = useState<VaultSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void hydrate();
  }, []);

  async function hydrate() {
    setLoading(true);
    try {
      const [logsResponse, settingsResponse] = await Promise.all([
        window.vaultAPI.getRecentLogs(420, { actionType: 'recall' }),
        window.vaultAPI.getAllSettings(),
      ]);
      if (logsResponse.success) setLogs(logsResponse.data || []);
      if (settingsResponse.success) setSettings(settingsResponse.data || null);
    } finally {
      setLoading(false);
    }
  }

  const recallPacking = getRecallPackingSettings(settings);
  const trend = useMemo(() => buildRecallTrend(logs, 14, recallPacking), [logs, recallPacking]);
  const trendTokensSaved = trend.reduce((sum, day) => sum + day.tokensSaved, 0);
  const totalCandidates = logs.reduce((sum, log) => sum + extractTotalCandidates(log), 0);
  const totalReturned = logs.reduce((sum, log) => sum + extractResultCount(log), 0);
  const avgTopScore = logs.length > 0
    ? logs.reduce((sum, log) => sum + (typeof log.metadata?.topScore === 'number' ? log.metadata.topScore : 0), 0) / logs.length
    : 0;

  return (
    <div className="ops-layout">
      <OpsIntro
        label="Recall"
        title="Recall efficiency"
        text="Recall health is derived from persisted recall logs and the configured prompt-packing strategy."
        chips={[
          `${logs.length} recalls`,
          `${totalReturned}/${totalCandidates || 0} surfaced`,
          `${formatCompactNumber(trendTokensSaved)} tokens avoided / 14d`,
          `avg top score ${avgTopScore.toFixed(1)}`,
        ]}
        onRefresh={() => void hydrate()}
        loading={loading}
      />

      <section className="ops-two-column">
        <div className="panel">
          <PanelHeader icon={<Search size={18} />} title="Candidate reduction" subtitle="Fourteen-day estimated context avoided." />
          <div className="ops-chart-tall">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
              <AreaChart data={trend} margin={{ top: 12, right: 20, bottom: 6, left: -12 }}>
                <defs>
                  <linearGradient id="opsRecallFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b7cff" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="#8b7cff" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148, 166, 198, 0.12)" vertical={false} />
                <XAxis dataKey="isoDate" stroke="#708097" tickLine={false} axisLine={false} tickFormatter={formatDateTick} />
                <YAxis stroke="#708097" tickLine={false} axisLine={false} tickFormatter={formatCompactNumber} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="tokensSaved" stroke="#8b7cff" strokeWidth={2} fill="url(#opsRecallFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <PanelHeader icon={<Database size={18} />} title="Recall log detail" subtitle="Most recent recall operations." />
          <div className="ops-side-list">
            {loading ? <div className="empty-state">Loading recall logs...</div> : logs.length === 0 ? <div className="empty-state">No recall logs found.</div> : logs.slice(0, 16).map((log) => (
              <div key={`${log.id ?? log.timestamp}-${log.message}`} className="ops-side-row ops-side-row-static">
                <strong>{log.message || 'Recall event'}</strong>
                <span>
                  {extractResultCount(log)} returned from {extractTotalCandidates(log)} candidates
                  {log.project ? ` · ${log.project}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export function AnalyticsOperationsView() {
  const [logs, setLogs] = useState<VaultLogEntry[]>([]);
  const [latest, setLatest] = useState<VaultMemory[]>([]);
  const [queueStats, setQueueStats] = useState<VaultTaskQueueStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void hydrate();
  }, []);

  async function hydrate() {
    setLoading(true);
    try {
      const [logsResponse, latestResponse, queueResponse] = await Promise.all([
        window.vaultAPI.getRecentLogs(500),
        window.vaultAPI.getLatest(undefined, 220),
        window.vaultAPI.getTaskQueueStats(),
      ]);
      if (logsResponse.success) setLogs(logsResponse.data || []);
      if (latestResponse.success) setLatest(latestResponse.data || []);
      if (queueResponse.success) setQueueStats(queueResponse.data || null);
    } finally {
      setLoading(false);
    }
  }

  const activitySeries = useMemo(() => buildActivitySeries(logs, 14), [logs]);
  const typeMetrics = useMemo(() => buildMemoryTypeMetrics(latest), [latest]);
  const statusMetrics = useMemo(() => buildStatusMetrics(latest), [latest]);
  const queueTotal = queueStats
    ? queueStats.pending + queueStats.running + queueStats.completed + queueStats.failed + queueStats.cancelled
    : 0;

  return (
    <div className="ops-layout">
      <OpsIntro
        label="Analytics"
        title="Operational analytics"
        text="Analytics are assembled from Vault activity logs, loaded memory records, and task queue counters."
        chips={[`${logs.length} events`, `${latest.length} memories sampled`, `${queueTotal} queue records`]}
        onRefresh={() => void hydrate()}
        loading={loading}
      />

      <section className="ops-analytics-grid">
        <div className="panel">
          <PanelHeader icon={<BarChart3 size={18} />} title="Activity rate" subtitle="Fourteen-day action mix." />
          <div className="ops-chart-tall">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
              <BarChart data={activitySeries} margin={{ top: 12, right: 18, bottom: 6, left: -12 }}>
                <CartesianGrid stroke="rgba(148, 166, 198, 0.12)" vertical={false} />
                <XAxis dataKey="key" stroke="#708097" tickLine={false} axisLine={false} tickFormatter={formatDateTick} />
                <YAxis stroke="#708097" tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="save" stackId="a" fill="#38dfff" />
                <Bar dataKey="recall" stackId="a" fill="#8b7cff" />
                <Bar dataKey="update" stackId="a" fill="#33d691" />
                <Bar dataKey="error" stackId="a" fill="#f5a524" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <PanelHeader icon={<Database size={18} />} title="Memory mix" subtitle="Type distribution in the loaded sample." />
          <Donut data={typeMetrics.map((entry) => ({ name: entry.type, value: entry.count }))} />
        </div>

        <div className="panel">
          <PanelHeader icon={<Archive size={18} />} title="Lifecycle state" subtitle="Status distribution in the loaded sample." />
          <div className="ops-side-list">
            {statusMetrics.length === 0 ? <div className="empty-state">No memory sample loaded.</div> : statusMetrics.map((entry) => (
              <div key={entry.status} className="ops-meter-row">
                <span>{entry.status}</span>
                <strong>{entry.count}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <PanelHeader icon={<ListChecks size={18} />} title="Task queue" subtitle="Current delegated queue counters." />
          <div className="ops-side-list">
            {queueStats ? Object.entries({
              pending: queueStats.pending,
              running: queueStats.running,
              completed: queueStats.completed,
              failed: queueStats.failed,
              cancelled: queueStats.cancelled,
            }).map(([label, value]) => (
              <div key={label} className="ops-meter-row">
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            )) : <div className="empty-state">Task queue metrics are unavailable.</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

function OpsIntro({
  label,
  title,
  text,
  chips,
  onRefresh,
  loading,
}: {
  label: string;
  title: string;
  text: string;
  chips: string[];
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <section className="section-intro ops-intro">
      <div className="section-intro-copy">
        <span className="section-intro-eyebrow">{label}</span>
        <div className="section-intro-title">{title}</div>
        <p className="section-intro-text">{text}</p>
      </div>
      <div className="section-intro-meta">
        {chips.map((chip) => <span key={chip} className="section-intro-chip">{chip}</span>)}
        <button type="button" className="header-button header-button-compact" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={15} />
          <span>{loading ? 'Loading' : 'Refresh'}</span>
        </button>
      </div>
    </section>
  );
}

function PanelHeader({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="panel-header">
      <div>
        <div className="panel-title">
          <span className="cockpit-panel-title-icon">{icon}</span>
          {title}
        </div>
        <div className="panel-subtitle">{subtitle}</div>
      </div>
    </div>
  );
}

function ProjectOpsRow({ row }: { row: ProjectCockpitRow }) {
  return (
    <article className="panel ops-project-row">
      <div className="ops-project-row-head">
        <div>
          <h3>{row.name}</h3>
          <p>{row.description}</p>
        </div>
        <span className={`ops-momentum ops-momentum-${row.direction}`}>{row.direction}</span>
      </div>
      <div className="ops-project-metrics">
        <Metric label="memories" value={row.memoryCount} />
        <Metric label="recent" value={row.last7dCount} />
        <Metric label="loops" value={row.openLoopCount} />
        <Metric label="events" value={row.logCount} />
      </div>
      <div className="ops-project-workspace">
        <GitBranch size={14} />
        <span>{row.workspacePath || 'No workspace mapped'}</span>
        {row.workspacePath ? <strong>{row.workspaceTrusted ? 'trusted' : 'untrusted'}</strong> : null}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="ops-mini-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
}

function Donut({ data }: { data: Array<{ name: string; value: number }> }) {
  if (data.length === 0) {
    return <div className="empty-state">No memory sample loaded.</div>;
  }

  return (
    <div className="ops-donut">
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={3}>
            {data.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="ops-donut-legend">
        {data.map((entry, index) => (
          <span key={entry.name}>
            <i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
            {entry.name} {entry.value}
          </span>
        ))}
      </div>
    </div>
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
        <span key={`${entry.name}-${entry.value}`} style={{ color: entry.color }}>
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
