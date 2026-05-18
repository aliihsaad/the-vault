import type { LocalWorkbenchRecentRun, LocalWorkbenchRunStatus } from '../types/index.js';

const DEFAULT_RUN_LIMIT = 20;

export function listLocalWorkbenchRuns(runs: unknown, limit = DEFAULT_RUN_LIMIT): LocalWorkbenchRecentRun[] {
  if (!Array.isArray(runs)) {
    return [];
  }

  return runs
    .map(normalizeLocalWorkbenchRun)
    .filter((run): run is LocalWorkbenchRecentRun => Boolean(run))
    .sort((left, right) => getRunSortTime(right) - getRunSortTime(left))
    .slice(0, Math.max(1, limit));
}

export function upsertLocalWorkbenchRun(
  runs: unknown,
  run: LocalWorkbenchRecentRun,
  limit = DEFAULT_RUN_LIMIT,
): LocalWorkbenchRecentRun[] {
  const normalizedRun = normalizeLocalWorkbenchRun(run);
  if (!normalizedRun) {
    throw new Error('Local agent run is invalid.');
  }

  const existingRuns = listLocalWorkbenchRuns(runs, Math.max(limit, DEFAULT_RUN_LIMIT));
  const nextRuns = [
    normalizedRun,
    ...existingRuns.filter((existingRun) => existingRun.runId !== normalizedRun.runId),
  ];

  return listLocalWorkbenchRuns(nextRuns, limit);
}

export function markLocalWorkbenchRunLaunched(
  runs: unknown,
  runId: string,
  launchedAt: string,
  terminalPid: number | null = null,
): LocalWorkbenchRecentRun[] {
  return updateLocalWorkbenchRun(runs, runId, (run) => ({
    ...run,
    status: 'launched',
    launchedAt,
    terminalPid,
    updatedAt: launchedAt,
  }));
}

export function markLocalWorkbenchRunCompleted(
  runs: unknown,
  runId: string,
  completedAt: string,
  resultMemoryUid: string,
  resultSummary: string,
): LocalWorkbenchRecentRun[] {
  return updateLocalWorkbenchRun(runs, runId, (run) => ({
    ...run,
    status: 'completed',
    completedAt,
    resultMemoryUid,
    resultSummary,
    updatedAt: completedAt,
  }));
}

export function getLocalWorkbenchRun(runs: unknown, runId: string): LocalWorkbenchRecentRun | null {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId) {
    return null;
  }

  return listLocalWorkbenchRuns(runs, Number.MAX_SAFE_INTEGER)
    .find((run) => run.runId === normalizedRunId) || null;
}

function updateLocalWorkbenchRun(
  runs: unknown,
  runId: string,
  update: (run: LocalWorkbenchRecentRun) => LocalWorkbenchRecentRun,
): LocalWorkbenchRecentRun[] {
  const normalizedRunId = runId.trim();
  const currentRuns = listLocalWorkbenchRuns(runs, Number.MAX_SAFE_INTEGER);
  const currentRun = currentRuns.find((run) => run.runId === normalizedRunId);
  if (!currentRun) {
    throw new Error('Local agent run was not found.');
  }

  return upsertLocalWorkbenchRun(currentRuns, update(currentRun));
}

function normalizeLocalWorkbenchRun(value: unknown): LocalWorkbenchRecentRun | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const runId = stringValue(record.runId);
  const project = stringValue(record.project);
  const title = stringValue(record.title);
  const adapterType = record.adapterType === 'claude_local' || record.adapterType === 'codex_local'
    ? record.adapterType
    : null;
  const workspacePath = stringValue(record.workspacePath);
  const contextPackPath = stringValue(record.contextPackPath);
  const createdAt = stringValue(record.createdAt);

  if (!runId || !project || !title || !adapterType || !workspacePath || !contextPackPath || !createdAt) {
    return null;
  }

  const status = normalizeStatus(record.status);
  const updatedAt = stringValue(record.updatedAt) || stringValue(record.completedAt) || stringValue(record.launchedAt) || createdAt;

  return {
    runId,
    project,
    title,
    adapterType,
    workspacePath,
    contextPackPath,
    createdAt,
    updatedAt,
    status,
    prompt: stringValue(record.prompt) || undefined,
    displayCommand: stringValue(record.displayCommand) || undefined,
    model: stringValue(record.model) || undefined,
    effort: stringValue(record.effort) || undefined,
    launchedAt: stringValue(record.launchedAt) || null,
    completedAt: stringValue(record.completedAt) || null,
    terminalPid: typeof record.terminalPid === 'number' ? record.terminalPid : null,
    resultMemoryUid: stringValue(record.resultMemoryUid) || null,
    resultSummary: stringValue(record.resultSummary) || null,
  };
}

function normalizeStatus(value: unknown): LocalWorkbenchRunStatus {
  return value === 'launched' || value === 'completed' || value === 'prepared' ? value : 'prepared';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getRunSortTime(run: LocalWorkbenchRecentRun): number {
  const timestamp = Date.parse(run.updatedAt || run.completedAt || run.launchedAt || run.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
