import { and, desc, eq } from 'drizzle-orm';
import { resolve } from 'node:path';
import { graphifyBuilds, graphifyProjectState } from '../database/schema.js';
import { now } from '../utils/datetime.js';
import { slugify } from '../rules/naming.js';
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

export function getGraphifyProjectStatus(
  db: DB,
  project: string,
  workspaceRegistry?: ProjectWorkspaceRegistry | null,
): GraphifyProjectStatus {
  const normalizedProject = requireProject(project);
  const state = getGraphifyProjectState(db, normalizedProject);
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
