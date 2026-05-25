import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { chmod, cp, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { now } from '../utils/datetime.js';
import { slugify } from '../rules/naming.js';
import { isGraphifyExcludedSourcePath } from '../rules/graphify.js';
import { exportGraphifyProjectCorpus } from './graphify-corpus.service.js';
import { getGraphifyRuntimeConfig } from './graphify-config.service.js';
import { assertGraphifySemanticBuildAllowed } from './graphify-quality.service.js';
import { resolveGraphifyCommandForRuntimeConfig } from './graphify-runtime.service.js';
import { getGraphifyProjectStatus, recordGraphifyBuild } from './graphify-project.service.js';
import { getGraphifyProjectPaths } from './graphify-paths.service.js';
import { discoverGraphifyArtifacts } from './graphify-artifact.service.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';
import type { ProjectWorkspaceRegistry } from '../types/index.js';
import type {
  GraphifyArtifactPaths,
  GraphifyBuildMode,
  GraphifyFreshnessState,
  GraphifyGraphStats,
} from '../types/graphify.js';

type DB = BetterSQLite3Database<typeof schema>;

// Graphify skips interactive graph.html generation for graphs above its viz node
// limit (default 5000). We raise the limit so normal-to-large projects still get a
// real embeddable graph, while extremely large graphs fall back to report/JSON.
const GRAPHIFY_VIZ_NODE_LIMIT = 20000;

export interface GraphifyBuildProcessOptions {
  cwd: string;
  logPath: string;
  artifactRoot: string;
  corpusRoot: string;
  memoryExportRoot: string;
  sourceRoot: string;
  env?: Record<string, string>;
}

export interface GraphifyBuildProcessResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export type GraphifyBuildProcessRunner = (
  command: string,
  args: string[],
  options: GraphifyBuildProcessOptions,
) => Promise<GraphifyBuildProcessResult> | GraphifyBuildProcessResult;

export interface BuildGraphifyProjectGraphInput {
  project: string;
  commandRunner: GraphifyBuildProcessRunner;
  buildId?: string;
  buildMode?: GraphifyBuildMode;
  graphifyCommand?: string;
}

export interface GraphifyProjectBuildResult {
  buildId: string;
  project: string;
  status: Extract<GraphifyFreshnessState, 'fresh' | 'failed'>;
  buildMode: GraphifyBuildMode;
  startedAt: string;
  completedAt: string;
  command: string;
  args: string[];
  logPath: string;
  artifactPaths: GraphifyArtifactPaths | null;
  graphStats: GraphifyGraphStats | null;
  errorMessage: string | null;
}

const activeProjectBuilds = new Set<string>();

// A build that crashes the process can leave its lock file behind; treat locks older
// than this (comfortably above the desktop build timeout) as stale and reclaim them.
const GRAPHIFY_BUILD_LOCK_STALE_MS = 35 * 60 * 1000;

/**
 * Single-flight guard around the build pipeline. Two concurrent builds for the same
 * project would race on the shared staged-input and managed-artifact directories and
 * corrupt outputs, so we serialize on two levels:
 *  - an in-process Set (a desktop click + an MCP call in the same process), and
 *  - a per-project lock file (desktop + a standalone MCP server process).
 */
export async function buildGraphifyProjectGraph(
  db: DB,
  vaultRoot: string,
  input: BuildGraphifyProjectGraphInput,
  workspaceRegistry?: ProjectWorkspaceRegistry | null,
): Promise<GraphifyProjectBuildResult> {
  const lockKey = slugify(input.project);
  if (activeProjectBuilds.has(lockKey)) {
    throw new Error('A Graphify build is already running for this project.');
  }
  const lockPath = join(getGraphifyProjectPaths(vaultRoot, input.project).projectRoot, 'build.lock');
  acquireGraphifyBuildLock(lockPath);
  activeProjectBuilds.add(lockKey);
  try {
    return await runBuildGraphifyProjectGraph(db, vaultRoot, input, workspaceRegistry);
  } finally {
    activeProjectBuilds.delete(lockKey);
    releaseGraphifyBuildLock(lockPath);
  }
}

function acquireGraphifyBuildLock(lockPath: string): void {
  mkdirSync(dirname(lockPath), { recursive: true });

  if (existsSync(lockPath)) {
    let stale = false;
    try {
      stale = Date.now() - statSync(lockPath).mtimeMs > GRAPHIFY_BUILD_LOCK_STALE_MS;
    } catch {
      stale = true;
    }
    if (stale) {
      removeGraphifyBuildLock(lockPath);
    }
  }

  try {
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      { flag: 'wx' },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('A Graphify build is already running for this project in another process.');
    }
    throw error;
  }
}

function releaseGraphifyBuildLock(lockPath: string): void {
  try {
    removeGraphifyBuildLock(lockPath);
  } catch {
    // Best-effort: a leftover lock is reclaimed by staleness on the next build.
  }
}

function removeGraphifyBuildLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

async function runBuildGraphifyProjectGraph(
  db: DB,
  vaultRoot: string,
  input: BuildGraphifyProjectGraphInput,
  workspaceRegistry?: ProjectWorkspaceRegistry | null,
): Promise<GraphifyProjectBuildResult> {
  const status = getGraphifyProjectStatus(db, input.project, workspaceRegistry);
  if (!status.enabled) {
    throw new Error('Graphify is disabled for this project.');
  }
  if (!status.sourceRoot || !status.buildEligible) {
    throw new Error('Choose a source folder before building a Graphify project graph.');
  }

  const paths = getGraphifyProjectPaths(vaultRoot, status.project);
  const runtimeConfig = getGraphifyRuntimeConfig(vaultRoot);
  const sourceRoot = resolve(status.sourceRoot);
  const buildMode = input.buildMode ?? status.buildMode;
  if (buildMode === 'semantic') {
    assertGraphifySemanticBuildAllowed(runtimeConfig);
  }
  const buildId = input.buildId ?? createBuildId(status.project);
  assertSafeBuildId(buildId);
  const logPath = join(paths.logsRoot, `${buildId}.log`);
  const command = input.graphifyCommand ?? resolveGraphifyCommandForRuntimeConfig(runtimeConfig);
  const startedAt = now();

  await mkdir(paths.logsRoot, { recursive: true });
  await mkdir(paths.artifactRoot, { recursive: true });
  exportGraphifyProjectCorpus(db, vaultRoot, { project: status.project, buildMode }, workspaceRegistry);
  // Stage under a project-named directory so Graphify labels artifacts/reports with
  // the project (it derives the label from the corpus directory basename) instead of
  // a generic "graphify-input".
  const graphifyInputRoot = await prepareGraphifyBuildInput(
    sourceRoot,
    paths.corpusRoot,
    paths.memoryExportRoot,
    paths.projectSlug,
  );
  const stagedArtifactRoot = join(graphifyInputRoot, 'graphify-out');
  const stagedGraphJson = join(stagedArtifactRoot, 'graph.json');
  const stagedGraphHtml = join(stagedArtifactRoot, 'graph.html');
  const vizEnv = { GRAPHIFY_VIZ_NODE_LIMIT: String(GRAPHIFY_VIZ_NODE_LIMIT) };
  const args = [
    'update',
    graphifyInputRoot,
  ];

  recordGraphifyBuild(db, {
    buildId,
    project: status.project,
    status: 'building',
    buildMode,
    startedAt,
    completedAt: null,
    artifactPaths: null,
    graphStats: null,
    detectedGraphifyVersion: status.state?.detectedGraphifyVersion ?? null,
    logPath,
    errorMessage: null,
  });

  let processResult: GraphifyBuildProcessResult;
  let runnerError: unknown = null;
  try {
    processResult = await input.commandRunner(command, args, {
      cwd: graphifyInputRoot,
      logPath,
      artifactRoot: paths.artifactRoot,
      corpusRoot: paths.corpusRoot,
      memoryExportRoot: paths.memoryExportRoot,
      sourceRoot,
      env: vizEnv,
    });
  } catch (error) {
    runnerError = error;
    processResult = {
      exitCode: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    };
  }

  const completedAt = now();
  if (processResult.exitCode !== 0 || runnerError) {
    const errorMessage = processResult.exitCode !== 0
      ? `Graphify exited with code ${processResult.exitCode}.`
      : 'Graphify build failed.';
    writeBuildLog({
      command,
      args,
      buildId,
      startedAt,
      completedAt,
      logPath,
      latestLogPath: paths.latestLog,
      processResult,
      errorMessage,
    });
    return finishBuild(db, {
      buildId,
      project: status.project,
      status: 'failed',
      buildMode,
      startedAt,
      completedAt,
      command,
      args,
      logPath,
      artifactPaths: null,
      graphStats: null,
      detectedGraphifyVersion: status.state?.detectedGraphifyVersion ?? null,
      errorMessage,
    });
  }

  // `graphify update` skips graph.html when the graph exceeds its viz node limit or
  // when no topology changed. If we have a graph but no HTML, force the visualization
  // from the existing graph.json so the desktop can embed the real Graphify graph.
  // Best-effort: a failure here still leaves report/JSON artifacts usable.
  if (existsSync(stagedGraphJson) && !existsSync(stagedGraphHtml)) {
    try {
      // Run from the corpus root with the project basename so Graphify labels the
      // regenerated report with the project (cluster-only uses the path arg verbatim
      // as the label, unlike `update` which uses the basename).
      await input.commandRunner(command, ['cluster-only', paths.projectSlug], {
        cwd: paths.corpusRoot,
        logPath,
        artifactRoot: paths.artifactRoot,
        corpusRoot: paths.corpusRoot,
        memoryExportRoot: paths.memoryExportRoot,
        sourceRoot,
        env: vizEnv,
      });
    } catch {
      // Visualization is optional; keep the build successful with report/JSON fallback.
    }
  }

  await copyStagedGraphifyArtifacts(stagedArtifactRoot, paths.artifactRoot);
  const discovery = discoverGraphifyArtifacts(vaultRoot, status.project);
  if (!discovery.available || !discovery.artifactPaths.graphJson) {
    const errorMessage = discovery.errorMessage ?? 'Graphify build did not produce graph.json.';
    writeBuildLog({
      command,
      args,
      buildId,
      startedAt,
      completedAt,
      logPath,
      latestLogPath: paths.latestLog,
      processResult,
      errorMessage,
    });
    return finishBuild(db, {
      buildId,
      project: status.project,
      status: 'failed',
      buildMode,
      startedAt,
      completedAt,
      command,
      args,
      logPath,
      artifactPaths: null,
      graphStats: null,
      detectedGraphifyVersion: status.state?.detectedGraphifyVersion ?? null,
      errorMessage,
    });
  }

  writeBuildLog({
    command,
    args,
    buildId,
    startedAt,
    completedAt,
    logPath,
    latestLogPath: paths.latestLog,
    processResult,
    errorMessage: null,
  });
  return finishBuild(db, {
    buildId,
    project: status.project,
    status: 'fresh',
    buildMode,
    startedAt,
    completedAt,
    command,
    args,
    logPath,
    artifactPaths: discovery.artifactPaths,
    graphStats: discovery.graphStats,
    detectedGraphifyVersion: status.state?.detectedGraphifyVersion ?? null,
    errorMessage: null,
  });
}

function finishBuild(
  db: DB,
  input: GraphifyProjectBuildResult & { detectedGraphifyVersion: string | null },
): GraphifyProjectBuildResult {
  recordGraphifyBuild(db, {
    buildId: input.buildId,
    project: input.project,
    status: input.status,
    buildMode: input.buildMode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    artifactPaths: input.artifactPaths,
    graphStats: input.graphStats,
    detectedGraphifyVersion: input.detectedGraphifyVersion,
    logPath: input.logPath,
    errorMessage: input.errorMessage,
  });

  return {
    buildId: input.buildId,
    project: input.project,
    status: input.status,
    buildMode: input.buildMode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    command: input.command,
    args: input.args,
    logPath: input.logPath,
    artifactPaths: input.artifactPaths,
    graphStats: input.graphStats,
    errorMessage: input.errorMessage,
  };
}

function writeBuildLog(input: {
  command: string;
  args: string[];
  buildId: string;
  startedAt: string;
  completedAt: string;
  logPath: string;
  latestLogPath: string;
  processResult: GraphifyBuildProcessResult;
  errorMessage: string | null;
}): void {
  const lines = [
    `Build ID: ${input.buildId}`,
    `Started: ${input.startedAt}`,
    `Completed: ${input.completedAt}`,
    `Command: ${[input.command, ...input.args].join(' ')}`,
    `Exit Code: ${input.processResult.exitCode}`,
    '',
    'STDOUT:',
    input.processResult.stdout ?? '',
    '',
    'STDERR:',
    input.processResult.stderr ?? '',
  ];
  if (input.errorMessage) {
    lines.push('', 'ERROR:', input.errorMessage);
  }

  const logText = `${lines.join('\n')}\n`;
  writeFileSync(input.logPath, logText, 'utf8');
  writeFileSync(input.latestLogPath, logText, 'utf8');
}

async function prepareGraphifyBuildInput(
  sourceRoot: string,
  corpusRoot: string,
  memoryExportRoot: string,
  inputDirName: string,
): Promise<string> {
  const inputRoot = join(corpusRoot, inputDirName);
  const inputSourceRoot = join(inputRoot, 'source');
  const inputMemoryRoot = join(inputRoot, 'vault-memory-export');

  await removeDirResilient(inputRoot);
  await mkdir(inputRoot, { recursive: true });
  await cp(sourceRoot, inputSourceRoot, {
    recursive: true,
    filter: (sourcePath) => shouldCopySourcePath(sourceRoot, sourcePath),
  });
  if (existsSync(memoryExportRoot)) {
    await cp(memoryExportRoot, inputMemoryRoot, { recursive: true });
  }

  return inputRoot;
}

async function copyStagedGraphifyArtifacts(stagedArtifactRoot: string, artifactRoot: string): Promise<void> {
  if (!existsSync(stagedArtifactRoot)) {
    return;
  }

  await removeDirResilient(artifactRoot);
  await cp(stagedArtifactRoot, artifactRoot, { recursive: true });
}

/**
 * Delete a managed directory robustly on Windows. Plain `fs.rm` fails with EPERM when
 * a file/folder carries the read-only attribute (e.g. a `desktop.ini` makes its folder
 * a read-only system folder), which previously left builds stuck in a `failed` loop.
 * We first try a retrying `rm` (handles transient AV/indexer locks); if that hits a
 * permission error we clear read-only attributes across the tree and retry once more.
 * Only ever called on Vault-managed staging/artifact dirs, never on user source.
 */
async function removeDirResilient(target: string): Promise<void> {
  if (!existsSync(target)) {
    return;
  }
  try {
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOTEMPTY') {
      throw error;
    }
  }
  await clearReadonlyRecursive(target);
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function clearReadonlyRecursive(target: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(target);
  } catch {
    return;
  }
  // chmod 0o666/0o777 clears the Windows read-only attribute, which is what blocks
  // unlink/rmdir; do directories before recursing so their entries become removable.
  try {
    await chmod(target, stats.isDirectory() ? 0o777 : 0o666);
  } catch {
    // Best-effort; the follow-up rm still has force + retries.
  }
  if (stats.isDirectory()) {
    let entries: string[] = [];
    try {
      entries = await readdir(target);
    } catch {
      return;
    }
    for (const entry of entries) {
      await clearReadonlyRecursive(join(target, entry));
    }
  }
}

function shouldCopySourcePath(sourceRoot: string, sourcePath: string): boolean {
  const relativePath = relative(sourceRoot, sourcePath).replace(/\\/g, '/');
  if (!relativePath) {
    return true;
  }
  return !isGraphifyExcludedSourcePath(relativePath);
}

function createBuildId(project: string): string {
  return `gb_${slugify(project)}_${Date.now().toString(36)}`;
}

function assertSafeBuildId(buildId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(buildId)) {
    throw new Error('Graphify build IDs may only contain letters, numbers, underscores, and dashes.');
  }
}
