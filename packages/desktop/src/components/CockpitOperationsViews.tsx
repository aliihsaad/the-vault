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
  FolderOpen,
  GitBranch,
  ListChecks,
  RefreshCw,
  Search,
  ShieldCheck,
  Tags,
  Target,
  Trash2,
  Waypoints,
  X,
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
  buildMemoryWorkspaceSummary,
  buildProjectCockpitRows,
  buildRecallSummary,
  buildRecallTrend,
  buildRelationshipGraphPreview,
  buildStatusMetrics,
  extractResultCount,
  extractTopScore,
  extractTotalCandidates,
  filterProjectCockpitRows,
  formatCompactNumber,
  getOperationalAnalyticsDateFrom,
  getRecallAnalyticsDateFrom,
  getRecallPackingSettings,
  OPERATIONAL_ANALYTICS_DAYS,
  OPERATIONAL_ANALYTICS_LOG_LIMIT,
  RECALL_ANALYTICS_LOG_LIMIT,
  type ProjectCockpitRow,
} from '../cockpit-metrics.js';
import {
  buildLoopControlModel,
  type LoopControlRow,
  type LoopControlRoutineFilter,
} from '../open-loop-ui.js';
import { requestGraphifyArtifactUrl } from '../graphify-artifact-url.js';
import { buildGraphifyProjectGraphViewModel } from '../graphify-view-model.js';
import { MemoryGraphCanvas } from './MemoryGraphCanvas.js';
import type {
  GraphifyArtifactDiscoveryResult,
  GraphifyArtifactReportReadResult,
  GraphifyBuildRecord,
  GraphifyBuildMode,
  GraphifyHtmlArtifactResult,
  GraphifyProjectStatus,
} from '@the-vault/core';

const CHART_COLORS = ['#38dfff', '#8b7cff', '#33d691', '#f5a524', '#5f8fff', '#ec6dff', '#8ba0b8'];

export function ProjectsOperationsView({
  vaultStatus,
  onStatusRefresh,
}: {
  vaultStatus: VaultStatus | null;
  onStatusRefresh?: () => Promise<void>;
}) {
  const [latest, setLatest] = useState<VaultMemory[]>([]);
  const [logs, setLogs] = useState<VaultLogEntry[]>([]);
  const [momentum, setMomentum] = useState<VaultProjectMomentum[]>([]);
  const [openLoops, setOpenLoops] = useState<VaultOpenLoop[]>([]);
  const [workspaces, setWorkspaces] = useState<ProjectWorkspaceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectSearch, setProjectSearch] = useState('');
  const [deleteCandidate, setDeleteCandidate] = useState<ProjectCockpitRow | null>(null);
  const [deletingProjectSlug, setDeletingProjectSlug] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  async function refreshAll() {
    await Promise.all([
      hydrate(),
      onStatusRefresh?.() ?? Promise.resolve(),
    ]);
  }

  async function confirmDeleteProject() {
    if (!deleteCandidate) {
      return;
    }

    setDeletingProjectSlug(deleteCandidate.slug);
    setDeleteError(null);
    try {
      const response = await window.vaultAPI.mergeProject(deleteCandidate.slug, DELETE_PROJECT_TARGET_SLUG, {
        decidedBy: 'desktop',
        relocateFiles: true,
      });
      if (!response.success) {
        setDeleteError(response.error ?? `Failed to delete ${deleteCandidate.name}`);
        return;
      }

      setDeleteCandidate(null);
      await refreshAll();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : `Failed to delete ${deleteCandidate.name}`);
    } finally {
      setDeletingProjectSlug(null);
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
  const visibleRows = useMemo(() => filterProjectCockpitRows(rows, projectSearch), [rows, projectSearch]);
  const activeWorkspaces = rows.filter((row) => row.workspacePath).length;
  const movingProjects = rows.filter((row) => row.direction === 'up').length;

  return (
    <div className="ops-layout">
      <OpsIntro
        label="Projects"
        title="Project radar"
        text="Project health is derived from saved project metadata, recent memories, workspace registry state, activity logs, and open-loop pressure."
        chips={[`${visibleRows.length}/${rows.length} visible`, `${activeWorkspaces} workspaces`, `${movingProjects} gaining momentum`]}
        onRefresh={() => void refreshAll()}
        loading={loading}
      />

      <section className="panel ops-project-directory">
        <div className="ops-project-directory-header">
          <PanelHeader
            icon={<FolderOpen size={18} />}
            title="Project directory"
            subtitle="Dense project index with memory counts, descriptions, creation dates, and delete controls."
          />
          <label className="search-field ops-project-search">
            <Search size={16} />
            <input
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
              placeholder="Search projects"
            />
          </label>
        </div>

        <div className="ops-project-table-scroll">
          {rows.length === 0 ? (
            <div className="empty-state">No projects are stored in this vault yet.</div>
          ) : visibleRows.length === 0 ? (
            <div className="empty-state">No projects match the current search.</div>
          ) : (
            <div className="ops-project-table" role="table" aria-label="Projects">
              <div className="ops-project-table-head" role="row">
                <span role="columnheader">Name</span>
                <span role="columnheader">Memories</span>
                <span role="columnheader">Description</span>
                <span role="columnheader">Created</span>
                <span role="columnheader" aria-label="Actions" />
              </div>
              {visibleRows.map((row) => (
                <ProjectOpsRow
                  key={row.name}
                  row={row}
                  deleting={deletingProjectSlug === row.slug}
                  onDelete={() => {
                    setDeleteError(null);
                    setDeleteCandidate(row);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {deleteCandidate ? (
        <ProjectDeleteModal
          project={deleteCandidate}
          deleting={deletingProjectSlug === deleteCandidate.slug}
          error={deleteError}
          onCancel={() => {
            if (!deletingProjectSlug) {
              setDeleteCandidate(null);
              setDeleteError(null);
            }
          }}
          onConfirm={() => void confirmDeleteProject()}
        />
      ) : null}
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
  const summary = useMemo(() => buildMemoryWorkspaceSummary(memories), [memories]);
  const visibleSummary = useMemo(() => buildMemoryWorkspaceSummary(visible), [visible]);
  const isDecisionWorkspace = memoryType === 'decision';
  const workspaceAccent = isDecisionWorkspace ? 'violet' : 'green';
  const latestLabel = formatRelativeTime(summary.latestTimestamp);
  const ctaCards = isDecisionWorkspace ? [
    {
      icon: <ShieldCheck size={18} />,
      label: 'Recorded decisions',
      value: formatCompactNumber(summary.total),
      detail: `${formatCompactNumber(visibleSummary.total)} visible after filters across ${formatCompactNumber(summary.projectCount)} projects.`,
      tone: 'primary' as const,
    },
    {
      icon: <Target size={18} />,
      label: 'Promoted constraints',
      value: formatCompactNumber(summary.promotedCount),
      detail: `${formatCompactNumber(summary.highPriorityCount)} high-priority decision records need extra attention.`,
      tone: 'violet' as const,
    },
    {
      icon: <Database size={18} />,
      label: 'Projects covered',
      value: formatCompactNumber(summary.projectCount),
      detail: `${formatCompactNumber(summary.activeCount)} active, ${formatCompactNumber(summary.resolvedCount)} resolved decisions loaded.`,
      tone: 'cyan' as const,
    },
    {
      icon: <Clock3 size={18} />,
      label: 'Recently updated',
      value: formatCompactNumber(summary.recentCount),
      detail: `Latest decision changed ${latestLabel}.`,
      tone: 'green' as const,
    },
  ] : [
    {
      icon: <FileText size={18} />,
      label: 'Transfer notes',
      value: formatCompactNumber(summary.total),
      detail: `${formatCompactNumber(visibleSummary.total)} visible after filters across ${formatCompactNumber(summary.projectCount)} projects.`,
      tone: 'primary' as const,
    },
    {
      icon: <ListChecks size={18} />,
      label: 'Open next steps',
      value: formatCompactNumber(summary.withNextSteps),
      detail: `${formatCompactNumber(summary.activeCount)} active handoffs are still in motion.`,
      tone: 'green' as const,
    },
    {
      icon: <Database size={18} />,
      label: 'Projects covered',
      value: formatCompactNumber(summary.projectCount),
      detail: `${formatCompactNumber(summary.highPriorityCount)} high-priority handoff records in the loaded set.`,
      tone: 'cyan' as const,
    },
    {
      icon: <Clock3 size={18} />,
      label: 'Recently updated',
      value: formatCompactNumber(summary.recentCount),
      detail: `Latest handoff changed ${latestLabel}.`,
      tone: 'violet' as const,
    },
  ];
  const insightRows = isDecisionWorkspace ? [
    { label: 'Promoted constraints', value: summary.promotedCount, detail: 'Canonical choices agents should preserve' },
    { label: 'Active decisions', value: summary.activeCount, detail: 'Still relevant in current project work' },
    { label: 'Resolved decisions', value: summary.resolvedCount, detail: 'Closed or superseded decision records' },
    { label: 'High priority', value: summary.highPriorityCount, detail: 'Marked high or critical' },
  ] : [
    { label: 'Open next steps', value: summary.withNextSteps, detail: 'Transfer notes with follow-up work' },
    { label: 'Active transfers', value: summary.activeCount, detail: 'Handoffs still available to continue' },
    { label: 'Recent handoffs', value: summary.recentCount, detail: 'Updated in the last seven days' },
    { label: 'High priority', value: summary.highPriorityCount, detail: 'Marked high or critical' },
  ];

  return (
    <div className="ops-layout">
      <OpsIntro
        label={label}
        title={title}
        text={text}
        chips={[
          `${summary.total} total`,
          `${summary.projectCount} projects`,
          isDecisionWorkspace ? `${summary.promotedCount} promoted` : `${summary.withNextSteps} with next steps`,
          `${summary.recentCount} recent`,
        ]}
        onRefresh={() => void hydrate()}
        loading={loading}
      />

      <section className="workspace-cta-grid" aria-label={`${label} workspace highlights`}>
        {ctaCards.map((card) => (
          <WorkspaceCtaCard
            key={card.label}
            icon={card.icon}
            label={card.label}
            value={card.value}
            detail={card.detail}
            tone={card.tone}
          />
        ))}
      </section>

      <section className="ops-workspace-grid">
        <div className="workspace-control-stack">
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
            <div className="workspace-filter-foot">
              <span>{visibleSummary.total} visible</span>
              <strong>{visibleSummary.projectCount} projects</strong>
            </div>
          </div>

          <div className={`panel workspace-insight-panel workspace-insight-panel-${workspaceAccent}`}>
            <PanelHeader
              icon={isDecisionWorkspace ? <ShieldCheck size={18} /> : <ListChecks size={18} />}
              title={isDecisionWorkspace ? 'Decision quality' : 'Handoff readiness'}
              subtitle={isDecisionWorkspace ? 'Promoted, active, and high-priority decision signals.' : 'Transfer notes ranked by follow-up pressure.'}
            />
            <div className="workspace-insight-list">
              {insightRows.map((row) => <WorkspaceInsightRow key={row.label} row={row} />)}
            </div>
          </div>
        </div>

        <div className="ops-memory-results">
          {loading ? (
            <div className="panel empty-state">Loading {memoryType} memories...</div>
          ) : visible.length === 0 ? (
            <div className="panel empty-state">No {memoryType} memories match the current filters.</div>
          ) : visible.map((memory) => <WorkspaceMemoryRow key={memory.itemUid} memory={memory} onOpenMemory={onOpenMemory} />)}
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
  const [selectedProject, setSelectedProject] = useState('');
  const [projectStatus, setProjectStatus] = useState<GraphifyProjectStatus | null>(null);
  const [artifactDiscovery, setArtifactDiscovery] = useState<GraphifyArtifactDiscoveryResult | null>(null);
  const [htmlArtifact, setHtmlArtifact] = useState<GraphifyHtmlArtifactResult | null>(null);
  const [artifactUrl, setArtifactUrl] = useState<string | null>(null);
  const [report, setReport] = useState<GraphifyArtifactReportReadResult | null>(null);
  const [buildHistory, setBuildHistory] = useState<GraphifyBuildRecord[]>([]);
  const [activeGraphTab, setActiveGraphTab] = useState<'graph' | 'report' | 'vault'>('graph');
  const [graphifyError, setGraphifyError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const firstProject = vaultStatus?.projects[0]?.name || '';
    if (!selectedProject && firstProject) {
      setSelectedProject(firstProject);
    }
  }, [selectedProject, vaultStatus?.projects]);

  useEffect(() => {
    void hydrate(selectedProject);
  }, [selectedProject]);

  async function hydrate(project = selectedProject) {
    setLoading(true);
    setGraphifyError(null);
    setMessage(null);
    try {
      const latestResponse = await window.vaultAPI.getLatest(undefined, 180);
      if (latestResponse.success) setMemories(latestResponse.data || []);

      if (!project) {
        setProjectStatus(null);
        setArtifactDiscovery(null);
        setHtmlArtifact(null);
        setArtifactUrl(null);
        setReport(null);
        setBuildHistory([]);
        return;
      }

      const [
        statusResponse,
        artifactsResponse,
        htmlResponse,
        reportResponse,
        historyResponse,
      ] = await Promise.all([
        window.vaultAPI.getGraphifyProjectStatus(project),
        window.vaultAPI.getGraphifyArtifacts(project),
        window.vaultAPI.getGraphifyHtmlArtifact(project),
        window.vaultAPI.readGraphifyArtifactReport(project, { maxBytes: 256 * 1024 }),
        window.vaultAPI.getGraphifyBuildHistory(project, 8),
      ]);

      if (!statusResponse.success || !statusResponse.data) {
        throw new Error(statusResponse.error || 'Failed to load Graphify project status');
      }

      setProjectStatus(statusResponse.data);
      setArtifactDiscovery(artifactsResponse.success ? artifactsResponse.data || null : null);
      setHtmlArtifact(htmlResponse.success ? htmlResponse.data || null : null);
      setReport(reportResponse.success ? reportResponse.data || null : null);
      setBuildHistory(historyResponse.success ? historyResponse.data || [] : []);

      if (htmlResponse.success && htmlResponse.data?.status === 'available') {
        try {
          setArtifactUrl(await requestGraphifyArtifactUrl(window.vaultAPI, {
            project,
            artifact: 'graphHtml',
          }));
        } catch (err) {
          setArtifactUrl(null);
          setGraphifyError(err instanceof Error ? err.message : 'Graphify artifact URL is unavailable');
        }
      } else {
        setArtifactUrl(null);
      }
    } catch (err) {
      setGraphifyError(err instanceof Error ? err.message : 'Failed to load Graphify dashboard');
    } finally {
      setLoading(false);
    }
  }

  async function runBuild(buildMode: GraphifyBuildMode) {
    if (!selectedProject) return;
    setLoading(true);
    setGraphifyError(null);
    setMessage(null);
    try {
      const response = await window.vaultAPI.buildGraphifyProjectGraph({ project: selectedProject, buildMode });
      if (!response.success) {
        throw new Error(response.error || 'Graphify build failed');
      }
      setMessage(`Graphify ${buildMode} build finished with status ${response.data?.status || 'unknown'}.`);
      await hydrate(selectedProject);
    } catch (err) {
      setGraphifyError(err instanceof Error ? err.message : 'Graphify build failed');
    } finally {
      setLoading(false);
    }
  }

  async function useCandidateSourceRoot() {
    if (!selectedProject || !projectStatus?.sourceRootCandidate) return;
    const response = await window.vaultAPI.setGraphifyProjectSourceRoot(selectedProject, projectStatus.sourceRootCandidate.path);
    if (!response.success) {
      setGraphifyError(response.error || 'Failed to set Graphify source root');
      return;
    }
    setMessage('Graphify source root saved.');
    await hydrate(selectedProject);
  }

  async function chooseGraphifyProjectSourceRoot() {
    if (!selectedProject) return;
    const response = await window.vaultAPI.chooseGraphifyProjectSourceRoot(selectedProject);
    if (!response.success) {
      setGraphifyError(response.error || 'Failed to choose Graphify source root');
      return;
    }
    if (response.data) {
      setMessage('Graphify source root saved.');
      await hydrate(selectedProject);
    }
  }

  async function setGraphifyEnabled(enabled: boolean) {
    if (!selectedProject) return;
    const response = await window.vaultAPI.setGraphifyProjectEnabled(selectedProject, enabled);
    if (!response.success) {
      setGraphifyError(response.error || 'Failed to update Graphify project state');
      return;
    }
    await hydrate(selectedProject);
  }

  async function openArtifactFolder() {
    if (!selectedProject) return;
    const response = await window.vaultAPI.openGraphifyArtifactFolder(selectedProject);
    if (!response.success) {
      setGraphifyError(response.error || 'Failed to open Graphify artifact folder');
    }
  }

  async function exportArtifacts() {
    if (!selectedProject) return;
    const response = await window.vaultAPI.exportGraphifyArtifacts(selectedProject);
    if (!response.success) {
      setGraphifyError(response.error || 'Failed to export Graphify artifacts');
      return;
    }
    if (response.data) {
      setMessage(`Exported ${response.data.copied.length} artifacts to ${response.data.targetRoot}.`);
    }
  }

  const graph = useMemo(() => buildRelationshipGraphPreview(memories, vaultStatus?.projects || [], 48), [memories, vaultStatus?.projects]);
  const linked = memories.filter((memory) => memory.relatedItemIds.length > 0 || memory.relatedFiles.length > 0);
  const graphifyModel = projectStatus
    ? buildGraphifyProjectGraphViewModel({
        projectStatus,
        artifactDiscovery,
        htmlArtifact,
        artifactUrl,
        buildHistory,
      })
    : null;

  useEffect(() => {
    if (graphifyModel) {
      setActiveGraphTab(graphifyModel.preferredTab);
    }
  }, [selectedProject, graphifyModel?.preferredTab]);

  return (
    <div className="ops-layout graphify-workspace">
      <OpsIntro
        label="Graph"
        title="Graphify project graph"
        text="Vault embeds Graphify's managed graph.html when it is available, keeps stale or failed graphs visible when safe, and preserves the memory relationship preview as a secondary Vault view."
        chips={[
          graphifyModel ? graphifyModel.statusLabel : 'No project selected',
          graphifyModel?.stats ? `${graphifyModel.stats.nodes} nodes` : `${graph.nodes.length} Vault nodes`,
          graphifyModel?.stats ? `${graphifyModel.stats.edges} edges` : `${graph.links.length} Vault links`,
        ]}
        onRefresh={() => void hydrate(selectedProject)}
        loading={loading}
      />

      <section className="graphify-dashboard">
        <div className="graphify-dashboard-top">
          <div className="toolbar-row">
            <label className="select-field">
              <Database size={16} />
              <select value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)}>
                <option value="">Select a project</option>
                {(vaultStatus?.projects || []).map((project) => (
                  <option key={project.name} value={project.name}>{project.name}</option>
                ))}
              </select>
            </label>

            {graphifyModel ? (
              <span className={`graphify-state-pill graphify-state-pill-${graphifyModel.state}`}>
                {graphifyModel.statusLabel}
              </span>
            ) : null}
          </div>

          <div className="inline-actions">
            <button type="button" className="header-button" onClick={() => void runBuild('fast')} disabled={!graphifyModel?.actions.rebuild.enabled}>
              <RefreshCw size={15} />
              <span>{graphifyModel?.actions.rebuild.label || 'Rebuild'}</span>
            </button>
            <button type="button" className="header-button" onClick={() => void runBuild('full')} disabled={!graphifyModel?.actions.fullRebuild.enabled}>
              <RefreshCw size={15} />
              <span>{graphifyModel?.actions.fullRebuild.label || 'Full rebuild'}</span>
            </button>
            <button type="button" className="header-button" onClick={() => void exportArtifacts()} disabled={!graphifyModel?.actions.exportArtifacts.enabled}>
              <Archive size={15} />
              <span>{graphifyModel?.actions.exportArtifacts.label || 'Export artifacts'}</span>
            </button>
            <button type="button" className="header-button" onClick={() => void openArtifactFolder()} disabled={!graphifyModel?.actions.openFolder.enabled}>
              <FolderOpen size={15} />
              <span>{graphifyModel?.actions.openFolder.label || 'Open folder'}</span>
            </button>
          </div>
        </div>

        {message ? <div className="success-text graphify-dashboard-message">{message}</div> : null}
        {graphifyError ? <div className="error-text graphify-dashboard-message">{graphifyError}</div> : null}
        {graphifyModel?.warning ? <div className="note-card note-card-warning">{graphifyModel.warning}</div> : null}
        {graphifyModel?.failure ? (
          <div className="note-card note-card-warning">
            <p>{graphifyModel.failure.message}</p>
            {graphifyModel.failure.logPath ? <p className="text-mono">{graphifyModel.failure.logPath}</p> : null}
          </div>
        ) : null}

        {graphifyModel?.state === 'sourceRootRequired' ? (
          <div className="graphify-source-root-panel">
            <div>
              <strong>Choose a source folder before building</strong>
              <p>{projectStatus?.sourceRootCandidate?.message || projectStatus?.message}</p>
              {projectStatus?.sourceRootCandidate ? <span className="text-mono">{projectStatus.sourceRootCandidate.path}</span> : null}
            </div>
            <div className="inline-actions graphify-source-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => void chooseGraphifyProjectSourceRoot()}
              >
                <FolderOpen size={15} />
                Choose folder
              </button>
              {projectStatus?.sourceRootCandidate ? (
                <button
                  type="button"
                  className="header-button"
                  onClick={() => void useCandidateSourceRoot()}
                >
                  Use workspace
                </button>
              ) : null}
              <button type="button" className="header-button" onClick={() => void setGraphifyEnabled(false)}>
                Disable for project
              </button>
            </div>
          </div>
        ) : graphifyModel?.sourceRoot && graphifyModel.state !== 'disabled' ? (
          <div className="graphify-source-root-panel">
            <div>
              <strong>Change source folder</strong>
              <p>Graphify builds from this saved folder.</p>
              <span className="text-mono">{graphifyModel.sourceRoot}</span>
            </div>
            <div className="inline-actions graphify-source-actions">
              <button
                type="button"
                className="header-button"
                aria-label="Change folder"
                onClick={() => void chooseGraphifyProjectSourceRoot()}
                disabled={!graphifyModel.actions.changeSourceRoot.enabled}
              >
                <FolderOpen size={15} />
                {graphifyModel.actions.changeSourceRoot.label}
              </button>
              <button type="button" className="header-button" onClick={() => void setGraphifyEnabled(false)}>
                Disable for project
              </button>
            </div>
          </div>
        ) : null}

        {graphifyModel?.state === 'disabled' ? (
          <div className="graphify-source-root-panel">
            <div>
              <strong>Graphify is disabled for this project</strong>
              <p>Vault memory remains available. Re-enable Graphify to build a project graph.</p>
            </div>
            <button type="button" className="primary-button" onClick={() => void setGraphifyEnabled(true)}>
              Enable Graphify
            </button>
          </div>
        ) : null}

        <div className="graphify-tab-strip" role="tablist" aria-label="Graphify graph views">
          {[
            ['graph', 'Graph'],
            ['report', 'Report'],
            ['vault', 'Vault links'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeGraphTab === id}
              className={`graphify-tab ${activeGraphTab === id ? 'graphify-tab-active' : ''}`}
              onClick={() => setActiveGraphTab(id as 'graph' | 'report' | 'vault')}
            >
              {label}
            </button>
          ))}
        </div>

        {activeGraphTab === 'graph' ? (
          <div className="graphify-embed-frame">
            {graphifyModel?.embedUrl ? (
              <iframe title={`${selectedProject} Graphify graph`} src={graphifyModel.embedUrl} sandbox="allow-scripts allow-same-origin" />
            ) : (
              <div className="empty-state">
                {htmlArtifact?.status === 'missing'
                  ? htmlArtifact.message
                  : 'Graphify graph.html is not available yet.'}
              </div>
            )}
          </div>
        ) : null}

        {activeGraphTab === 'report' ? (
          <div className="graphify-report-panel">
            {report?.status === 'available' ? (
              <pre className="snippet-block graphify-report-block">{report.text}</pre>
            ) : (
              <div className="empty-state">{report?.message || 'GRAPH_REPORT.md is not available yet.'}</div>
            )}
          </div>
        ) : null}

        {activeGraphTab === 'vault' ? (
          <section className="ops-graph-grid graphify-vault-preview-grid">
            <div className="panel ops-graph-canvas">
              <PanelHeader icon={<Waypoints size={18} />} title="Vault relationship fallback" subtitle="Stored links from the loaded memory sample." />
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
        ) : null}
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
        window.vaultAPI.getRecentLogs(RECALL_ANALYTICS_LOG_LIMIT, { actionType: 'recall', dateFrom: getRecallAnalyticsDateFrom() }),
        window.vaultAPI.getAllSettings(),
      ]);
      if (logsResponse.success) setLogs(logsResponse.data || []);
      if (settingsResponse.success) setSettings(settingsResponse.data || null);
    } finally {
      setLoading(false);
    }
  }

  const recallPacking = useMemo(() => getRecallPackingSettings(settings), [settings]);
  const trend = useMemo(() => buildRecallTrend(logs, 14, recallPacking), [logs, recallPacking]);
  const summary = useMemo(() => buildRecallSummary(logs, recallPacking), [logs, recallPacking]);
  const candidateReduction = formatPercent(summary.candidateReductionRatio);
  const latestLabel = formatRelativeTime(summary.latestTimestamp);
  const packedLimitLabel = `${recallPacking.topMatchLimit} compact / ${recallPacking.detailExpansionLimit} expanded`;

  return (
    <div className="ops-layout">
      <OpsIntro
        label="Recall"
        title="Recall efficiency"
        text="Recall health is measured as work avoided: candidates scanned, matches returned, and prompt context kept out of the agent window."
        chips={[
          `${summary.recallCount} recalls`,
          `${formatCompactNumber(summary.tokensSaved14d)} tokens saved / 14d`,
          `${candidateReduction} candidates pruned`,
          `packing ${packedLimitLabel}`,
        ]}
        onRefresh={() => void hydrate()}
        loading={loading}
      />

      <section className="recall-cta-grid" aria-label="Recall efficiency highlights">
        <RecallCtaCard
          tone="primary"
          icon={<Target size={18} />}
          label="Estimated tokens saved"
          value={formatCompactNumber(summary.tokensSaved14d)}
          detail={`14-day estimate after pruning ${formatCompactNumber(summary.totalCandidates)} candidates to ${formatCompactNumber(summary.totalReturned)} returned matches.`}
        />
        <RecallCtaCard
          tone="cyan"
          icon={<Search size={18} />}
          label="Candidate reduction"
          value={candidateReduction}
          detail={`${formatCompactNumber(Math.max(summary.totalCandidates - summary.totalReturned, 0))} candidates skipped before prompt packing.`}
        />
        <RecallCtaCard
          tone="green"
          icon={<Clock3 size={18} />}
          label="Recall volume"
          value={`${summary.todayRecallCount} today`}
          detail={`${summary.recallCount} loaded recall events, latest ${latestLabel}.`}
        />
        <RecallCtaCard
          tone="violet"
          icon={<Gauge size={18} />}
          label="Signal strength"
          value={summary.averageTopScore.toFixed(1)}
          detail={`Average top score with ${packedLimitLabel} packing limits.`}
        />
      </section>

      <section className="ops-two-column">
        <div className="panel">
          <PanelHeader icon={<Search size={18} />} title="Candidate reduction" subtitle="Daily estimated tokens avoided from candidate pruning." />
          <div className="recall-chart-strip" aria-label="Recall chart totals">
            <span><strong>{formatCompactNumber(summary.totalCandidates)}</strong> candidates scanned</span>
            <span><strong>{formatCompactNumber(summary.totalReturned)}</strong> matches surfaced</span>
            <span><strong>{packedLimitLabel}</strong> current packing</span>
          </div>
          <div className="ops-chart-tall">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 1, height: 1 }}>
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
          <PanelHeader icon={<Database size={18} />} title="Compact recall log" subtitle="Latest recall signals only. Activity keeps full event detail." />
          <div className="recall-compact-list">
            {loading ? <div className="empty-state">Loading recall logs...</div> : logs.length === 0 ? <div className="empty-state">No recall logs found.</div> : logs.slice(0, 16).map((log) => (
              <div key={`${log.id ?? log.timestamp}-${log.message}`} className="recall-compact-row" title={log.message || 'Recall event'}>
                <div className="recall-compact-main">
                  <span className="recall-compact-time">{formatRelativeTime(log.timestamp)}</span>
                  <strong>{log.project || 'Unscoped recall'}</strong>
                  <span>{log.sourceClient || 'unknown client'} · {log.status || 'logged'}</span>
                </div>
                <div className="recall-compact-stats">
                  <span>{extractResultCount(log)}/{extractTotalCandidates(log) || 0}</span>
                  <span>{formatPercent(getRecallReductionRatio(log))} pruned</span>
                  {extractTopScore(log) > 0 ? <span>score {extractTopScore(log).toFixed(1)}</span> : null}
                  {typeof log.latencyMs === 'number' ? <span>{formatLatency(log.latencyMs)}</span> : null}
                </div>
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
        window.vaultAPI.getRecentLogs(OPERATIONAL_ANALYTICS_LOG_LIMIT, { dateFrom: getOperationalAnalyticsDateFrom() }),
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

  const activitySeries = useMemo(() => buildActivitySeries(logs, OPERATIONAL_ANALYTICS_DAYS), [logs]);
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
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 1, height: 1 }}>
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

const DELETE_PROJECT_TARGET_SLUG = 'the-vault';

function ProjectOpsRow({
  row,
  deleting,
  onDelete,
}: {
  row: ProjectCockpitRow;
  deleting: boolean;
  onDelete: () => void;
}) {
  const isFallbackTarget = row.slug === DELETE_PROJECT_TARGET_SLUG;

  return (
    <div className="ops-project-table-row" role="row">
      <div className="ops-project-name-cell" role="cell">
        <strong title={row.name}>{row.name}</strong>
        <span>{row.slug}</span>
      </div>
      <span className="ops-project-memory-cell" role="cell">{formatCompactNumber(row.memoryCount)}</span>
      <span className="ops-project-description-cell" role="cell" title={row.description}>{row.description}</span>
      <span className="ops-project-created-cell" role="cell" title={row.createdAt || 'not recorded'}>{formatShortDate(row.createdAt)}</span>
      <span className="ops-project-action-cell" role="cell">
        <button
          type="button"
          className="header-button icon-only-button danger-button ops-project-delete-button"
          onClick={onDelete}
          disabled={deleting || isFallbackTarget}
          title={isFallbackTarget ? 'Cannot delete the fallback project' : `Delete ${row.name}`}
          aria-label={isFallbackTarget ? 'Cannot delete the fallback project' : `Delete ${row.name}`}
        >
          <Trash2 size={15} />
        </button>
      </span>
    </div>
  );
}

function ProjectDeleteModal({
  project,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  project: ProjectCockpitRow;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = `ops-project-delete-title-${project.slug}`;
  const hasMemories = project.memoryCount > 0;

  return (
    <div className="ops-project-delete-modal-backdrop" onClick={onCancel}>
      <section
        className="ops-project-delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ops-project-delete-modal-header">
          <div>
            <span>Delete project</span>
            <strong id={titleId}>{project.name}</strong>
          </div>
          <button
            type="button"
            className="header-button icon-only-button ops-project-delete-modal-close"
            onClick={onCancel}
            disabled={deleting}
            aria-label="Close delete project dialog"
          >
            <X size={15} />
          </button>
        </header>

        <div className="ops-project-delete-modal-body">
          <div className="ops-project-delete-warning">
            <AlertTriangle size={18} />
            <p>Are you sure you want to delete {project.name}? This cannot be undone.</p>
          </div>
          {hasMemories ? (
            <p>This project has {project.memoryCount} memories. Confirming will merge them into {DELETE_PROJECT_TARGET_SLUG} before removing the project.</p>
          ) : (
            <p>This empty project will be merged into {DELETE_PROJECT_TARGET_SLUG} and removed from the project list.</p>
          )}
          {error ? <div className="ops-project-delete-error">{error}</div> : null}
        </div>

        <footer className="ops-project-delete-modal-actions">
          <button type="button" className="pill-button" onClick={onCancel} disabled={deleting}>
            Cancel
          </button>
          <button type="button" className="danger-button" onClick={onConfirm} disabled={deleting}>
            <Trash2 size={16} />
            <span>{deleting ? 'Deleting...' : 'Delete project'}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

function WorkspaceCtaCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: 'primary' | 'cyan' | 'green' | 'violet';
}) {
  return (
    <article className={`workspace-cta-card workspace-cta-card-${tone}`}>
      <div className="workspace-cta-head">
        <span className="workspace-cta-icon">{icon}</span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function WorkspaceInsightRow({
  row,
}: {
  row: { label: string; value: number; detail: string };
}) {
  return (
    <div className="workspace-insight-row">
      <span>
        <strong>{formatCompactNumber(row.value)}</strong>
        <span>{row.label}</span>
      </span>
      <p>{row.detail}</p>
    </div>
  );
}

function WorkspaceMemoryRow({
  memory,
  onOpenMemory,
}: {
  memory: VaultMemory;
  onOpenMemory?: (itemUid: string) => void;
}) {
  const chips = [...memory.tags, ...memory.keywords].filter(Boolean).slice(0, 5);
  const age = formatRelativeTime(memory.updatedAt || memory.createdAt);

  return (
    <button
      key={memory.itemUid}
      type="button"
      className={`workspace-memory-row workspace-memory-row-${memory.memoryType}`}
      onClick={() => onOpenMemory?.(memory.itemUid)}
    >
      <span className={`workspace-memory-icon workspace-memory-icon-${memory.memoryType}`}>
        {memory.memoryType === 'decision' ? <ShieldCheck size={16} /> : <FileText size={16} />}
      </span>
      <span className="workspace-memory-main">
        <span className="workspace-memory-head">
          <strong>{memory.title}</strong>
          <span>{memory.project}</span>
        </span>
        <span className="workspace-memory-summary">{memory.summary}</span>
        <span className="workspace-chip-row">
          {chips.map((chip, index) => <i key={`${chip}-${index}`}>{chip}</i>)}
          {memory.nextSteps.length > 0 ? <i>{memory.nextSteps.length} next steps</i> : null}
          {memory.promoted ? <i>promoted</i> : null}
        </span>
      </span>
      <span className="workspace-memory-meta">
        <span>{memory.status}</span>
        <span>{memory.priority}</span>
        <span>{age}</span>
      </span>
    </button>
  );
}

function RecallCtaCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: 'primary' | 'cyan' | 'green' | 'violet';
}) {
  return (
    <article className={`recall-cta-card recall-cta-card-${tone}`}>
      <div className="recall-cta-head">
        <span className="recall-cta-icon">{icon}</span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function Donut({ data }: { data: Array<{ name: string; value: number }> }) {
  if (data.length === 0) {
    return <div className="empty-state">No memory sample loaded.</div>;
  }

  return (
    <div className="ops-donut">
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 1, height: 1 }}>
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

function formatPercent(value: number): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return `${Math.round(clamped * 100)}%`;
}

function getRecallReductionRatio(log: VaultLogEntry): number {
  const candidates = extractTotalCandidates(log);
  return candidates > 0 ? 1 - extractResultCount(log) / candidates : 0;
}

function formatLatency(latencyMs: number): string {
  if (!Number.isFinite(latencyMs)) {
    return 'n/a';
  }

  return latencyMs >= 1000
    ? `${(latencyMs / 1000).toFixed(1)}s`
    : `${Math.max(Math.round(latencyMs), 0)}ms`;
}

function formatRelativeTime(timestamp: string | null | undefined): string {
  if (!timestamp) {
    return 'not recorded';
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? 'not recorded'
    : `${formatDistanceToNow(date)} ago`;
}

function formatShortDate(timestamp: string | null | undefined): string {
  if (!timestamp) {
    return 'not recorded';
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? 'not recorded'
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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
