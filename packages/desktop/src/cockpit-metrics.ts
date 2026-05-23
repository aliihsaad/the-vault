export const MEMORY_TYPE_ORDER: VaultMemoryType[] = [
  'session',
  'summary',
  'decision',
  'plan',
  'artifact',
  'handoff',
  'reference',
];

export const DEFAULT_RECALL_PACKING = {
  topMatchLimit: 4,
  detailExpansionLimit: 2,
};

const ESTIMATED_FULL_CANDIDATE_TOKENS = 120;
const ESTIMATED_COMPACT_MATCH_TOKENS = 28;
const ESTIMATED_DETAIL_EXPANSION_TOKENS = 90;

export type RecallPackingSettings = {
  topMatchLimit: number;
  detailExpansionLimit: number;
};

export type RecallDayMetric = {
  key: string;
  label: string;
  isoDate: string;
  recallCount: number;
  candidates: number;
  returned: number;
  tokensSaved: number;
  reductionRatio: number;
};

export type RecallSummaryMetric = {
  recallCount: number;
  todayRecallCount: number;
  totalCandidates: number;
  totalReturned: number;
  tokensSaved14d: number;
  candidateReductionRatio: number;
  averageTopScore: number;
  latestTimestamp: string | null;
};

export type MemoryTypeMetric = {
  type: VaultMemoryType;
  count: number;
};

export type StatusMetric = {
  status: VaultStatusValue;
  count: number;
};

export type MemoryWorkspaceSummary = {
  total: number;
  promotedCount: number;
  withNextSteps: number;
  projectCount: number;
  activeCount: number;
  resolvedCount: number;
  highPriorityCount: number;
  recentCount: number;
  latestTimestamp: string | null;
};

export type ProjectCockpitRow = {
  name: string;
  description: string;
  memoryCount: number;
  last7dCount: number;
  prior7dCount: number;
  delta: number;
  direction: VaultProjectMomentumDirection;
  lastActivityAt: string | null;
  openLoopCount: number;
  workspacePath: string | null;
  workspaceTrusted: boolean;
  logCount: number;
};

export type RelationshipGraphNode = {
  id: string;
  label: string;
  kind: 'memory' | 'project' | 'file';
  group: string;
  memoryType?: VaultMemoryType;
};

export type RelationshipGraphLink = {
  source: string;
  target: string;
  kind: 'project' | 'related-memory' | 'related-file';
};

export type RelationshipGraphPreview = {
  nodes: RelationshipGraphNode[];
  links: RelationshipGraphLink[];
  typeCounts: MemoryTypeMetric[];
  linkedMemoryCount: number;
  linkedFileCount: number;
};

export function extractTotalCandidates(log: VaultLogEntry): number {
  const value = log.metadata?.totalCandidates;
  if (typeof value === 'number') {
    return value;
  }

  const parsed = parseRecallMessageCounts(log.message);
  return parsed?.totalCandidates ?? 0;
}

export function extractResultCount(log: VaultLogEntry): number {
  const value = log.metadata?.resultCount;
  if (typeof value === 'number') {
    return value;
  }

  const parsed = parseRecallMessageCounts(log.message);
  return parsed?.returned ?? 0;
}

export function extractTopScore(log: VaultLogEntry): number {
  const value = log.metadata?.topScore;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function parseRecallMessageCounts(message: string | undefined): {
  returned: number;
  totalCandidates: number;
} | null {
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

export function estimateTokensSaved(
  totalCandidates: number,
  returned: number,
  recallPacking: RecallPackingSettings = DEFAULT_RECALL_PACKING,
): number {
  const baseline = Math.max(totalCandidates, 0) * ESTIMATED_FULL_CANDIDATE_TOKENS;
  const compactMatches = Math.min(Math.max(returned, 0), recallPacking.topMatchLimit);
  const compactCost = compactMatches * ESTIMATED_COMPACT_MATCH_TOKENS;
  const detailCost = Math.min(compactMatches, recallPacking.detailExpansionLimit) * ESTIMATED_DETAIL_EXPANSION_TOKENS;
  return Math.max(Math.round(baseline - compactCost - detailCost), 0);
}

export function getRecallPackingSettings(settings: VaultSettings | null): RecallPackingSettings {
  return {
    topMatchLimit: clampNumber(settings?.recall_top_match_limit, DEFAULT_RECALL_PACKING.topMatchLimit, 1, 8),
    detailExpansionLimit: clampNumber(
      settings?.recall_detail_expansion_limit,
      DEFAULT_RECALL_PACKING.detailExpansionLimit,
      0,
      4,
    ),
  };
}

export function buildRecallTrend(
  logs: VaultLogEntry[],
  days: number,
  recallPacking: RecallPackingSettings = DEFAULT_RECALL_PACKING,
  referenceDate: Date = new Date(),
): RecallDayMetric[] {
  const recallLogs = logs.filter((log) => log.actionType === 'recall');
  const trend: RecallDayMetric[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(referenceDate);
    date.setHours(0, 0, 0, 0);
    date.setDate(referenceDate.getDate() - offset);

    const dayLogs = recallLogs.filter((log) => isSameLocalDay(log.timestamp, date));
    const candidates = dayLogs.reduce((sum, log) => sum + extractTotalCandidates(log), 0);
    const returned = dayLogs.reduce((sum, log) => sum + extractResultCount(log), 0);
    const reductionRatio = candidates > 0 ? 1 - returned / candidates : 0;

    const isoDate = toLocalDateKey(date);

    trend.push({
      key: isoDate,
      isoDate,
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      recallCount: dayLogs.length,
      candidates,
      returned,
      tokensSaved: estimateTokensSaved(candidates, returned, recallPacking),
      reductionRatio: clampRatio(reductionRatio),
    });
  }

  return trend;
}

export function buildRecallSummary(
  logs: VaultLogEntry[],
  recallPacking: RecallPackingSettings = DEFAULT_RECALL_PACKING,
  referenceDate: Date = new Date(),
): RecallSummaryMetric {
  const recallLogs = logs.filter((log) => log.actionType === 'recall');
  const totalCandidates = recallLogs.reduce((sum, log) => sum + extractTotalCandidates(log), 0);
  const totalReturned = recallLogs.reduce((sum, log) => sum + extractResultCount(log), 0);
  const tokensSaved14d = buildRecallTrend(recallLogs, 14, recallPacking, referenceDate)
    .reduce((sum, day) => sum + day.tokensSaved, 0);
  const latestTimestamp = recallLogs.reduce<string | null>((latest, log) => {
    if (!log.timestamp) {
      return latest;
    }
    if (!latest || new Date(log.timestamp).getTime() > new Date(latest).getTime()) {
      return log.timestamp;
    }
    return latest;
  }, null);

  return {
    recallCount: recallLogs.length,
    todayRecallCount: recallLogs.filter((log) => isSameLocalDay(log.timestamp, referenceDate)).length,
    totalCandidates,
    totalReturned,
    tokensSaved14d,
    candidateReductionRatio: totalCandidates > 0 ? clampRatio(1 - totalReturned / totalCandidates) : 0,
    averageTopScore: recallLogs.length > 0
      ? recallLogs.reduce((sum, log) => sum + extractTopScore(log), 0) / recallLogs.length
      : 0,
    latestTimestamp,
  };
}

export function buildMemoryTypeMetrics(memories: VaultMemory[]): MemoryTypeMetric[] {
  return MEMORY_TYPE_ORDER.map((type) => ({
    type,
    count: memories.filter((memory) => memory.memoryType === type).length,
  })).filter((entry) => entry.count > 0);
}

export function buildStatusMetrics(memories: VaultMemory[]): StatusMetric[] {
  const map = new Map<VaultStatusValue, number>();
  for (const memory of memories) {
    map.set(memory.status, (map.get(memory.status) || 0) + 1);
  }

  return Array.from(map.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status));
}

export function buildMemoryWorkspaceSummary(
  memories: VaultMemory[],
  referenceDate: Date = new Date(),
): MemoryWorkspaceSummary {
  const recentCutoff = new Date(referenceDate);
  recentCutoff.setDate(referenceDate.getDate() - 7);

  const latestMemory = memories.reduce<VaultMemory | null>((latest, memory) => {
    const latestTime = latest ? getMemoryUpdatedTime(latest) : Number.NEGATIVE_INFINITY;
    return getMemoryUpdatedTime(memory) > latestTime ? memory : latest;
  }, null);

  return {
    total: memories.length,
    promotedCount: memories.filter((memory) => memory.promoted).length,
    withNextSteps: memories.filter((memory) => memory.nextSteps.length > 0).length,
    projectCount: new Set(memories.map((memory) => memory.project).filter(Boolean)).size,
    activeCount: memories.filter((memory) => memory.status === 'active').length,
    resolvedCount: memories.filter((memory) => memory.status === 'resolved').length,
    highPriorityCount: memories.filter((memory) => memory.priority === 'high' || memory.priority === 'critical').length,
    recentCount: memories.filter((memory) => {
      const updatedTime = getMemoryUpdatedTime(memory);
      return Number.isFinite(updatedTime)
        && updatedTime >= recentCutoff.getTime()
        && updatedTime <= referenceDate.getTime();
    }).length,
    latestTimestamp: latestMemory?.updatedAt || latestMemory?.createdAt || null,
  };
}

export function buildActivitySeries(
  logs: VaultLogEntry[],
  days: number,
  referenceDate: Date = new Date(),
): Array<{ key: string; label: string; save: number; recall: number; update: number; error: number; total: number }> {
  const series = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(referenceDate);
    date.setHours(0, 0, 0, 0);
    date.setDate(referenceDate.getDate() - offset);

    const dayLogs = logs.filter((log) => isSameLocalDay(log.timestamp, date));
    const save = dayLogs.filter((log) => log.actionType === 'save').length;
    const recall = dayLogs.filter((log) => log.actionType === 'recall').length;
    const update = dayLogs.filter((log) => log.actionType === 'update' || log.actionType === 'promote').length;
    const error = dayLogs.filter((log) => log.actionType === 'error' || log.status === 'error').length;

    series.push({
      key: date.toISOString(),
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      save,
      recall,
      update,
      error,
      total: dayLogs.length,
    });
  }

  return series;
}

export function buildProjectCockpitRows({
  projects,
  momentum,
  workspaces,
  memories,
  logs,
  openLoops,
}: {
  projects: VaultProject[];
  momentum: VaultProjectMomentum[];
  workspaces: ProjectWorkspaceConfig[];
  memories: VaultMemory[];
  logs: VaultLogEntry[];
  openLoops: VaultOpenLoop[];
}): ProjectCockpitRow[] {
  const momentumByName = new Map(momentum.map((entry) => [entry.name, entry]));
  const workspacesByName = new Map(workspaces.map((entry) => [entry.project, entry]));
  const logsByProject = countBy(logs.filter((log) => log.project), (log) => log.project || '');
  const loopsByProject = countBy(openLoops, (loop) => loop.project);
  const memoriesByProject = countBy(memories, (memory) => memory.project);

  return projects.map((project) => {
    const m = momentumByName.get(project.name);
    const workspace = workspacesByName.get(project.name) || null;
    const memoryCount = project.memoryCount || memoriesByProject.get(project.name) || 0;
    const openLoopCount = loopsByProject.get(project.name) || 0;
    const logCount = logsByProject.get(project.name) || 0;
    const last7dCount = m?.last7dCount || 0;
    const prior7dCount = m?.prior7dCount || 0;

    return {
      name: project.name,
      description: project.description || 'No description stored for this project.',
      memoryCount,
      last7dCount,
      prior7dCount,
      delta: m?.delta || 0,
      direction: m?.direction || 'inactive',
      lastActivityAt: m?.lastActivityAt || null,
      openLoopCount,
      workspacePath: workspace?.workspacePath || null,
      workspaceTrusted: Boolean(workspace?.trusted),
      logCount,
    };
  }).sort((left, right) => {
    const activityDelta = right.last7dCount - left.last7dCount;
    if (activityDelta !== 0) {
      return activityDelta;
    }

    return right.memoryCount - left.memoryCount || left.name.localeCompare(right.name);
  });
}

export function buildRelationshipGraphPreview(
  memories: VaultMemory[],
  projects: VaultProject[],
  limit = 24,
): RelationshipGraphPreview {
  const nodes = new Map<string, RelationshipGraphNode>();
  const links: RelationshipGraphLink[] = [];
  const knownProjectNames = new Set(projects.map((project) => project.name));
  const selectedMemories = memories
    .filter((memory) => memory.relatedItemIds.length > 0 || memory.relatedFiles.length > 0 || knownProjectNames.has(memory.project))
    .slice(0, limit);

  for (const memory of selectedMemories) {
    nodes.set(memory.itemUid, {
      id: memory.itemUid,
      label: memory.title,
      kind: 'memory',
      group: memory.project,
      memoryType: memory.memoryType,
    });

    const projectId = `project:${memory.project}`;
    nodes.set(projectId, {
      id: projectId,
      label: memory.project,
      kind: 'project',
      group: memory.project,
    });
    links.push({ source: projectId, target: memory.itemUid, kind: 'project' });

    for (const relatedId of memory.relatedItemIds.slice(0, 4)) {
      const relatedNodeId = `memory:${relatedId}`;
      if (!nodes.has(relatedNodeId) && !nodes.has(relatedId)) {
        nodes.set(relatedNodeId, {
          id: relatedNodeId,
          label: relatedId,
          kind: 'memory',
          group: memory.project,
        });
      }
      links.push({
        source: memory.itemUid,
        target: nodes.has(relatedId) ? relatedId : relatedNodeId,
        kind: 'related-memory',
      });
    }

    for (const filePath of memory.relatedFiles.slice(0, 3)) {
      const fileNodeId = `file:${filePath}`;
      nodes.set(fileNodeId, {
        id: fileNodeId,
        label: shortFileName(filePath),
        kind: 'file',
        group: memory.project,
      });
      links.push({ source: memory.itemUid, target: fileNodeId, kind: 'related-file' });
    }
  }

  const graphNodes = Array.from(nodes.values()).slice(0, limit + projects.length);
  const visibleNodeIds = new Set(graphNodes.map((node) => node.id));
  const graphLinks = links.filter((link) => visibleNodeIds.has(link.source) && visibleNodeIds.has(link.target));

  return {
    nodes: graphNodes,
    links: graphLinks,
    typeCounts: buildMemoryTypeMetrics(selectedMemories),
    linkedMemoryCount: selectedMemories.filter((memory) => memory.relatedItemIds.length > 0).length,
    linkedFileCount: selectedMemories.reduce((sum, memory) => sum + memory.relatedFiles.length, 0),
  };
}

export function isSameLocalDay(timestamp: string | undefined, referenceDate: Date): boolean {
  if (!timestamp) {
    return false;
  }

  const date = new Date(timestamp);
  return date.getFullYear() === referenceDate.getFullYear()
    && date.getMonth() === referenceDate.getMonth()
    && date.getDate() === referenceDate.getDate();
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }

  return String(value);
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function getMemoryUpdatedTime(memory: VaultMemory): number {
  const timestamp = memory.updatedAt || memory.createdAt;
  if (!timestamp) {
    return Number.NEGATIVE_INFINITY;
  }

  const time = new Date(timestamp).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function countBy<T>(items: T[], getKey: (item: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    if (!key) {
      continue;
    }
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function shortFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || filePath;
}
