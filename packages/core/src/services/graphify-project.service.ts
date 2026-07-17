import { and, desc, eq } from 'drizzle-orm';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { graphifyBuilds, graphifyProjectState } from '../database/schema.js';
import { now } from '../utils/datetime.js';
import { slugify } from '../rules/naming.js';
import { GRAPHIFY_BUILD_STALE_MS } from '../rules/graphify.js';
import { getGraphifyProjectPaths } from './graphify-paths.service.js';
import {
  getProjectWorkspace,
  normalizeWorkspaceProject,
  validateWorkspacePath,
} from './workspace-registry.service.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';
import type {
  GraphifyArtifactPaths,
  GraphifyBuildRecord,
  GraphifyGraphStats,
  GraphifyProjectState,
  GraphifyProjectStatus,
  RecordGraphifyBuildInput,
  UpsertGraphifyProjectStateInput,
} from '../types/graphify.js';
import type { ProjectWorkspaceRegistry } from '../types/index.js';

type DB = BetterSQLite3Database<typeof schema>;

export function getGraphifyProjectState(
  db: DB,
  project: string,
): GraphifyProjectState | null {
  const row = findProjectStateRowBySlug(db, project);
  return row ? mapProjectStateRow(row) : null;
}

export function upsertGraphifyProjectState(
  db: DB,
  input: UpsertGraphifyProjectStateInput,
): GraphifyProjectState {
  const existing = findProjectStateRowBySlug(db, input.project);
  const timestamp = now();
  const artifactPaths = normalizeArtifactPaths(input.artifactPaths);
  const graphStats = input.graphStats ?? null;
  const values = {
    project: existing?.project ?? input.project,
    enabled: input.enabled,
    sourceRoot: normalizeOptionalPath(input.sourceRoot),
    freshness: input.freshness,
    buildMode: input.buildMode,
    latestBuildId: input.latestBuildId ?? null,
    graphJsonPath: artifactPaths.graphJson,
    graphHtmlPath: artifactPaths.graphHtml,
    graphReportPath: artifactPaths.graphReport,
    graphSvgPath: artifactPaths.graphSvg,
    nodeCount: graphStats?.nodeCount ?? null,
    edgeCount: graphStats?.edgeCount ?? null,
    communityCount: graphStats?.communityCount ?? null,
    failureCount: input.failureCount ?? 0,
    lastError: input.lastError ?? null,
    detectedGraphifyVersion: input.detectedGraphifyVersion ?? null,
    lastBuildStartedAt: input.lastBuildStartedAt ?? null,
    lastBuildCompletedAt: input.lastBuildCompletedAt ?? null,
    updatedAt: timestamp,
  };

  if (existing) {
    db.update(graphifyProjectState)
      .set(values)
      .where(eq(graphifyProjectState.id, existing.id))
      .run();
  } else {
    db.insert(graphifyProjectState)
      .values({
        ...values,
        createdAt: timestamp,
      })
      .run();
  }

  const saved = findProjectStateRowBySlug(db, values.project);
  if (!saved) {
    throw new Error('Failed to persist Graphify project state.');
  }
  return mapProjectStateRow(saved);
}

export interface GraphifyProjectStatusOptions {
  /** Enables the interrupted-build lock check under `<vaultRoot>/extensions/graphify`. */
  vaultRoot?: string;
  /** In-process guard: true while a build for the project is actually running. */
  isBuildActive?: (project: string) => boolean;
  /** Test hook for the current time in epoch milliseconds. */
  nowMs?: number;
}

export function getGraphifyProjectStatus(
  db: DB,
  project: string,
  workspaceRegistry?: ProjectWorkspaceRegistry | null,
  options?: GraphifyProjectStatusOptions,
): GraphifyProjectStatus {
  const normalizedProject = requireProject(project);
  const state = reconcileInterruptedGraphifyBuild(
    db,
    getGraphifyProjectState(db, normalizedProject),
    options,
  );
  const enabled = state?.enabled ?? true;
  const sourceRoot = state?.sourceRoot ?? null;
  const freshness = state?.freshness ?? 'missing';
  const buildMode = state?.buildMode ?? 'fast';
  const sourceRootValidation = sourceRoot ? validateWorkspacePath(sourceRoot) : null;
  const sourceRootInvalid = Boolean(sourceRootValidation && !sourceRootValidation.ok);
  const sourceRootCandidate = enabled && (!sourceRoot || sourceRootInvalid)
    ? getInitialSourceRootCandidate(workspaceRegistry, normalizedProject)
    : null;

  if (!enabled) {
    return {
      project: state?.project ?? normalizedProject,
      enabled,
      sourceRoot,
      sourceRootCandidate,
      freshness,
      buildMode,
      buildEligible: false,
      buildBlockedReason: 'disabled',
      uiState: 'disabled',
      message: 'Graphify is disabled for this project. Vault memory remains available.',
      state,
    };
  }

  if (!sourceRoot) {
    return {
      project: state?.project ?? normalizedProject,
      enabled,
      sourceRoot,
      sourceRootCandidate,
      freshness,
      buildMode,
      buildEligible: false,
      buildBlockedReason: 'sourceRootRequired',
      uiState: 'sourceRootRequired',
      message: 'Choose a source folder before building a Graphify project graph.',
      state,
    };
  }

  if (sourceRootInvalid && sourceRootValidation) {
    return {
      project: state?.project ?? normalizedProject,
      enabled,
      sourceRoot,
      sourceRootCandidate,
      freshness,
      buildMode,
      buildEligible: false,
      buildBlockedReason: 'sourceRootRequired',
      uiState: 'sourceRootRequired',
      message: `Saved Graphify source folder is invalid: ${sourceRootValidation.message} Choose a source folder before building.`,
      state,
    };
  }

  return {
    project: state?.project ?? normalizedProject,
    enabled,
    sourceRoot,
    sourceRootCandidate: null,
    freshness,
    buildMode,
    buildEligible: true,
    buildBlockedReason: null,
    uiState: 'ready',
    message: 'Graphify source root is configured. Manual graph builds can be enabled in a later phase.',
    state,
  };
}

export function setGraphifyProjectSourceRoot(
  db: DB,
  project: string,
  sourceRoot: string,
): GraphifyProjectState {
  const normalizedProject = requireProject(project);
  const validation = validateWorkspacePath(sourceRoot);
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  const existing = getGraphifyProjectState(db, normalizedProject);
  return upsertGraphifyProjectState(db, {
    project: existing?.project ?? normalizedProject,
    enabled: existing?.enabled ?? true,
    sourceRoot: validation.workspacePath,
    freshness: existing?.enabled === false ? 'disabled' : 'missing',
    buildMode: existing?.buildMode ?? 'fast',
    latestBuildId: null,
    artifactPaths: null,
    graphStats: null,
    detectedGraphifyVersion: existing?.detectedGraphifyVersion ?? null,
    failureCount: 0,
    lastError: null,
    lastBuildStartedAt: null,
    lastBuildCompletedAt: null,
  });
}

export function setGraphifyProjectEnabled(
  db: DB,
  project: string,
  enabled: boolean,
): GraphifyProjectState {
  const normalizedProject = requireProject(project);
  const existing = getGraphifyProjectState(db, normalizedProject);
  const existingFreshness = existing?.freshness ?? 'missing';
  const nextFreshness = enabled
    ? existingFreshness === 'disabled'
      ? 'missing'
      : existingFreshness
    : 'disabled';

  return upsertGraphifyProjectState(db, {
    project: existing?.project ?? normalizedProject,
    enabled,
    sourceRoot: existing?.sourceRoot ?? null,
    freshness: nextFreshness,
    buildMode: existing?.buildMode ?? 'fast',
    latestBuildId: existing?.latestBuildId ?? null,
    artifactPaths: existing?.artifactPaths ?? null,
    graphStats: existing?.graphStats ?? null,
    detectedGraphifyVersion: existing?.detectedGraphifyVersion ?? null,
    failureCount: existing?.failureCount ?? 0,
    lastError: existing?.lastError ?? null,
    lastBuildStartedAt: existing?.lastBuildStartedAt ?? null,
    lastBuildCompletedAt: existing?.lastBuildCompletedAt ?? null,
  });
}

export function recordGraphifyBuild(
  db: DB,
  input: RecordGraphifyBuildInput,
): GraphifyBuildRecord {
  const existingBuild = db
    .select()
    .from(graphifyBuilds)
    .where(eq(graphifyBuilds.buildId, input.buildId))
    .get();
  const existingState = findProjectStateRowBySlug(db, input.project);
  const timestamp = now();
  const canonicalProject = existingState?.project ?? input.project;
  const artifactPaths = input.artifactPaths === null
    ? null
    : normalizeArtifactPaths(input.artifactPaths);
  const graphStats = input.graphStats ?? null;
  const buildValues = {
    project: canonicalProject,
    status: input.status,
    buildMode: input.buildMode,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    artifactJson: artifactPaths ? JSON.stringify(artifactPaths) : null,
    graphStatsJson: graphStats ? JSON.stringify(graphStats) : null,
    detectedGraphifyVersion: input.detectedGraphifyVersion ?? null,
    logPath: normalizeOptionalPath(input.logPath ?? null),
    errorMessage: input.errorMessage ?? null,
    updatedAt: timestamp,
  };

  if (existingBuild) {
    db.update(graphifyBuilds)
      .set(buildValues)
      .where(eq(graphifyBuilds.buildId, input.buildId))
      .run();
  } else {
    db.insert(graphifyBuilds)
      .values({
        buildId: input.buildId,
        ...buildValues,
        createdAt: timestamp,
      })
      .run();
  }

  applyBuildToProjectState(db, {
    project: canonicalProject,
    buildId: input.buildId,
    status: input.status,
    buildMode: input.buildMode,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    artifactPaths,
    graphStats,
    detectedGraphifyVersion: input.detectedGraphifyVersion ?? null,
    errorMessage: input.errorMessage ?? null,
  });

  const saved = db
    .select()
    .from(graphifyBuilds)
    .where(eq(graphifyBuilds.buildId, input.buildId))
    .get();
  if (!saved) {
    throw new Error('Failed to persist Graphify build history.');
  }
  return mapBuildRow(saved);
}

export function getGraphifyBuildHistory(
  db: DB,
  project: string,
  limit = 20,
): GraphifyBuildRecord[] {
  const existingState = findProjectStateRowBySlug(db, project);
  const canonicalProject = existingState?.project ?? project;
  return db
    .select()
    .from(graphifyBuilds)
    .where(eq(graphifyBuilds.project, canonicalProject))
    .orderBy(desc(graphifyBuilds.startedAt), desc(graphifyBuilds.id))
    .limit(limit)
    .all()
    .map(mapBuildRow);
}

/**
 * Self-healing for builds that died with their process: a state stuck in
 * 'building'/'queued' longer than the stale window, with no live in-process build and
 * no fresh build lock, is reconciled on the next status read — 'stale' when a usable
 * graph.json still exists on disk, 'failed' for an interrupted build without
 * artifacts, 'missing' for an abandoned queue entry. The dangling build record (if
 * any) is closed as failed so history stops showing a forever-running build.
 */
function reconcileInterruptedGraphifyBuild(
  db: DB,
  state: GraphifyProjectState | null,
  options?: GraphifyProjectStatusOptions,
): GraphifyProjectState | null {
  if (!state || (state.freshness !== 'building' && state.freshness !== 'queued')) {
    return state;
  }

  // 'queued' rows keep the previous build's start time, so their age is measured from
  // the moment the queued freshness was written instead.
  const referenceTimestamp = state.freshness === 'building'
    ? state.lastBuildStartedAt ?? state.updatedAt
    : state.updatedAt;
  const referenceMs = Date.parse(referenceTimestamp ?? '');
  const nowMs = options?.nowMs ?? Date.now();
  if (!Number.isFinite(referenceMs) || nowMs - referenceMs < GRAPHIFY_BUILD_STALE_MS) {
    return state;
  }
  if (options?.isBuildActive?.(state.project)) {
    return state;
  }
  if (options?.vaultRoot && hasFreshGraphifyBuildLock(options.vaultRoot, state.project, nowMs)) {
    return state;
  }

  const interruptedMessage = 'Graphify build was interrupted before completion (app quit or crash); Vault recovered the project state automatically.';
  const artifactsUsable = Boolean(
    state.artifactPaths.graphJson && existsSync(state.artifactPaths.graphJson),
  );

  if (state.freshness === 'building' && state.latestBuildId) {
    const danglingBuild = db
      .select()
      .from(graphifyBuilds)
      .where(eq(graphifyBuilds.buildId, state.latestBuildId))
      .get();
    if (danglingBuild && (danglingBuild.status === 'building' || danglingBuild.status === 'queued')) {
      recordGraphifyBuild(db, {
        buildId: danglingBuild.buildId,
        project: state.project,
        status: 'failed',
        buildMode: danglingBuild.buildMode as GraphifyProjectState['buildMode'],
        startedAt: danglingBuild.startedAt,
        completedAt: now(),
        artifactPaths: null,
        graphStats: null,
        detectedGraphifyVersion: state.detectedGraphifyVersion,
        logPath: danglingBuild.logPath,
        errorMessage: interruptedMessage,
      });
    }
  }

  const finalFreshness = artifactsUsable
    ? 'stale'
    : state.freshness === 'building'
      ? 'failed'
      : 'missing';
  const refreshed = getGraphifyProjectState(db, state.project) ?? state;

  return upsertGraphifyProjectState(db, {
    project: refreshed.project,
    enabled: refreshed.enabled,
    sourceRoot: refreshed.sourceRoot,
    freshness: finalFreshness,
    buildMode: refreshed.buildMode,
    latestBuildId: refreshed.latestBuildId,
    artifactPaths: refreshed.artifactPaths,
    graphStats: refreshed.graphStats,
    detectedGraphifyVersion: refreshed.detectedGraphifyVersion,
    failureCount: refreshed.failureCount,
    lastError: finalFreshness === 'failed' ? interruptedMessage : refreshed.lastError,
    lastBuildStartedAt: refreshed.lastBuildStartedAt,
    lastBuildCompletedAt: refreshed.lastBuildCompletedAt,
  });
}

function hasFreshGraphifyBuildLock(vaultRoot: string, project: string, nowMs: number): boolean {
  try {
    const lockPath = join(getGraphifyProjectPaths(vaultRoot, project).projectRoot, 'build.lock');
    return nowMs - statSync(lockPath).mtimeMs < GRAPHIFY_BUILD_STALE_MS;
  } catch {
    return false;
  }
}

function applyBuildToProjectState(
  db: DB,
  input: {
    project: string;
    buildId: string;
    status: RecordGraphifyBuildInput['status'];
    buildMode: RecordGraphifyBuildInput['buildMode'];
    startedAt: string | null;
    completedAt: string | null;
    artifactPaths: GraphifyArtifactPaths | null;
    graphStats: GraphifyGraphStats | null;
    detectedGraphifyVersion: string | null;
    errorMessage: string | null;
  },
): void {
  const existing = findProjectStateRowBySlug(db, input.project);
  const existingState = existing ? mapProjectStateRow(existing) : null;
  const nextArtifactPaths = input.artifactPaths ?? existingState?.artifactPaths ?? normalizeArtifactPaths(null);
  const nextGraphStats = input.graphStats ?? existingState?.graphStats ?? null;
  const failureCount = countFailedBuilds(db, existingState?.project ?? input.project);
  const lastError = input.status === 'failed'
    ? input.errorMessage
    : failureCount > 0
      ? existingState?.lastError ?? null
      : null;

  upsertGraphifyProjectState(db, {
    project: existingState?.project ?? input.project,
    enabled: existingState?.enabled ?? true,
    sourceRoot: existingState?.sourceRoot ?? null,
    freshness: input.status,
    buildMode: input.buildMode,
    latestBuildId: input.buildId,
    artifactPaths: nextArtifactPaths,
    graphStats: nextGraphStats,
    detectedGraphifyVersion: input.detectedGraphifyVersion ?? existingState?.detectedGraphifyVersion ?? null,
    lastBuildStartedAt: input.startedAt,
    lastBuildCompletedAt: input.completedAt,
    failureCount,
    lastError,
  });
}

function findProjectStateRowBySlug(
  db: DB,
  project: string,
): typeof graphifyProjectState.$inferSelect | null {
  const targetSlug = slugify(project);
  const rows = db.select().from(graphifyProjectState).all();
  return rows.find((row) => slugify(row.project) === targetSlug) ?? null;
}

function countFailedBuilds(db: DB, project: string): number {
  return db
    .select()
    .from(graphifyBuilds)
    .where(and(
      eq(graphifyBuilds.project, project),
      eq(graphifyBuilds.status, 'failed'),
    ))
    .all()
    .length;
}

function getInitialSourceRootCandidate(
  workspaceRegistry: ProjectWorkspaceRegistry | null | undefined,
  project: string,
): GraphifyProjectStatus['sourceRootCandidate'] {
  const workspace = getProjectWorkspace(workspaceRegistry, project);
  if (!workspace) {
    return null;
  }
  const validation = validateWorkspacePath(workspace.workspacePath);
  if (!validation.ok) {
    return null;
  }

  return {
    source: 'project_workspace_registry',
    path: validation.workspacePath,
    trusted: workspace.trusted,
    message: 'Existing project workspace can be used as the Graphify source root after confirmation.',
  };
}

function requireProject(project: string): string {
  const normalizedProject = normalizeWorkspaceProject(project);
  if (!normalizedProject) {
    throw new Error('Project is required.');
  }
  return normalizedProject;
}

function mapProjectStateRow(row: typeof graphifyProjectState.$inferSelect): GraphifyProjectState {
  const artifactPaths = {
    graphJson: row.graphJsonPath,
    graphHtml: row.graphHtmlPath,
    graphReport: row.graphReportPath,
    graphSvg: row.graphSvgPath,
  };
  const graphStats = row.nodeCount === null && row.edgeCount === null && row.communityCount === null
    ? null
    : {
        nodeCount: row.nodeCount ?? 0,
        edgeCount: row.edgeCount ?? 0,
        communityCount: row.communityCount ?? 0,
      };

  return {
    project: row.project,
    enabled: row.enabled,
    sourceRoot: row.sourceRoot,
    freshness: row.freshness as GraphifyProjectState['freshness'],
    buildMode: row.buildMode as GraphifyProjectState['buildMode'],
    latestBuildId: row.latestBuildId,
    artifactPaths,
    graphPath: row.graphJsonPath,
    htmlPath: row.graphHtmlPath,
    reportPath: row.graphReportPath,
    svgPath: row.graphSvgPath,
    graphStats,
    detectedGraphifyVersion: row.detectedGraphifyVersion,
    lastBuildStartedAt: row.lastBuildStartedAt,
    lastBuildCompletedAt: row.lastBuildCompletedAt,
    failureCount: row.failureCount,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapBuildRow(row: typeof graphifyBuilds.$inferSelect): GraphifyBuildRecord {
  return {
    buildId: row.buildId,
    project: row.project,
    status: row.status as GraphifyBuildRecord['status'],
    buildMode: row.buildMode as GraphifyBuildRecord['buildMode'],
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    artifactPaths: row.artifactJson ? JSON.parse(row.artifactJson) as GraphifyArtifactPaths : null,
    graphStats: row.graphStatsJson ? JSON.parse(row.graphStatsJson) as GraphifyGraphStats : null,
    detectedGraphifyVersion: row.detectedGraphifyVersion,
    logPath: row.logPath,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeArtifactPaths(input: Partial<GraphifyArtifactPaths> | null | undefined): GraphifyArtifactPaths {
  return {
    graphJson: normalizeOptionalPath(input?.graphJson ?? null),
    graphHtml: normalizeOptionalPath(input?.graphHtml ?? null),
    graphReport: normalizeOptionalPath(input?.graphReport ?? null),
    graphSvg: normalizeOptionalPath(input?.graphSvg ?? null),
  };
}

function normalizeOptionalPath(pathValue: string | null | undefined): string | null {
  if (!pathValue?.trim()) {
    return null;
  }
  return resolve(pathValue.trim());
}
