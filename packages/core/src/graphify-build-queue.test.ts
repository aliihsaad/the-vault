import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Vault } from './index.js';
import { getGraphifyProjectPaths } from './services/graphify-paths.service.js';
import {
  GraphifyBuildQueue,
  type GraphifyBuildQueueClock,
  type GraphifyBuildQueueTimers,
  type GraphifyQueuedBuildExecutor,
  type GraphifyQueuedBuildRequest,
} from './services/graphify-build-queue.service.js';
import type { GraphifyArtifactPaths, GraphifyGraphStats } from './types/graphify.js';

describe('Graphify auto-build queue', () => {
  let vaultRoot: string;
  let sourceRoot: string;
  let vault: Vault;
  let timers: FakeTimers;
  let clock: GraphifyBuildQueueClock;
  let queue: GraphifyBuildQueue | null;
  let extractedNativeBindingDir: string | null = null;
  const previousNativeBinding = process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING;

  beforeAll(async () => {
    const cachedPrebuild = await findCachedBetterSqlitePrebuild();
    if (!cachedPrebuild) {
      return;
    }

    extractedNativeBindingDir = await mkdtemp(join(tmpdir(), 'vault-sqlite-native-'));
    execFileSync('tar', ['-xf', basename(cachedPrebuild), '-C', extractedNativeBindingDir.replace(/\\/g, '/')], {
      cwd: dirname(cachedPrebuild),
    });
    process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING = join(
      extractedNativeBindingDir,
      'build',
      'Release',
      'better_sqlite3.node',
    );
  });

  beforeEach(async () => {
    vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-queue-'));
    sourceRoot = await makeTempSourceRoot();
    timers = new FakeTimers();
    clock = {
      now: () => timers.nowMs,
      isoNow: () => new Date(timers.nowMs).toISOString(),
    };
    queue = null;
    vault = new Vault(vaultRoot);
    vault.initialize();
    vault.setGraphifyProjectSourceRoot('The Vault', sourceRoot);
  });

  afterEach(async () => {
    queue?.dispose();
    vault.close();
    await rm(vaultRoot, { recursive: true, force: true });
    await rm(sourceRoot, { recursive: true, force: true });
  });

  afterAll(async () => {
    if (previousNativeBinding === undefined) {
      delete process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING;
    } else {
      process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING = previousNativeBinding;
    }

    if (extractedNativeBindingDir) {
      try {
        await rm(extractedNativeBindingDir, { recursive: true, force: true });
      } catch {
        // Windows keeps native .node files locked for the lifetime of the process.
      }
    }
  });

  it('coalesces multiple automatic triggers into one debounced build', async () => {
    const calls: GraphifyQueuedBuildRequest[] = [];
    queue = createQueue(async (request) => {
      calls.push(request);
      return recordBuild(request, 'fresh');
    });

    const first = queue.triggerAutoBuild('The Vault', { reason: 'sourceChanged' });
    const second = queue.triggerAutoBuild('The Vault', { reason: 'memorySaved' });
    const third = queue.triggerAutoBuild('The Vault', { reason: 'projectChanged' });

    expect(first).toEqual(expect.objectContaining({ status: 'queued' }));
    expect(second).toEqual(expect.objectContaining({ status: 'coalesced' }));
    expect(third).toEqual(expect.objectContaining({ status: 'coalesced' }));
    expect(vault.getGraphifyProjectState('The Vault')?.freshness).toBe('queued');
    expect(timers.pendingCount()).toBe(1);

    timers.advanceBy(99);
    await queue.waitForIdle('The Vault');
    expect(calls).toHaveLength(0);

    timers.advanceBy(1);
    await queue.waitForIdle('The Vault');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.objectContaining({
      project: 'The Vault',
      trigger: 'auto',
      reason: 'sourceChanged',
      coalescedReasons: ['sourceChanged', 'memorySaved', 'projectChanged'],
      buildMode: 'fast',
    }));
    expect(vault.getGraphifyProjectState('The Vault')?.freshness).toBe('fresh');
  });

  it('enforces one active build per project when triggers arrive during a build', async () => {
    const calls: GraphifyQueuedBuildRequest[] = [];
    let activeBuilds = 0;
    let maxActiveBuilds = 0;
    let releaseBuild: (() => void) | null = null;
    const releaseCurrentBuild = () => {
      if (!releaseBuild) {
        throw new Error('Expected an active Graphify build to release.');
      }
      const release = releaseBuild;
      releaseBuild = null;
      release();
    };
    queue = createQueue(async (request) => {
      calls.push(request);
      activeBuilds += 1;
      maxActiveBuilds = Math.max(maxActiveBuilds, activeBuilds);
      await new Promise<void>((resolveRelease) => {
        releaseBuild = resolveRelease;
      });
      activeBuilds -= 1;
      return recordBuild(request, 'fresh');
    });

    queue.triggerAutoBuild('The Vault', { reason: 'sourceChanged' });
    timers.advanceBy(100);
    expect(calls).toHaveLength(1);
    expect(vault.getGraphifyProjectState('The Vault')?.freshness).toBe('building');

    queue.triggerAutoBuild('The Vault', { reason: 'memorySaved' });
    timers.advanceBy(1000);
    expect(calls).toHaveLength(1);
    expect(maxActiveBuilds).toBe(1);

    releaseCurrentBuild();
    await queue.waitForIdle('The Vault');
    expect(timers.pendingCount()).toBe(1);

    timers.advanceBy(100);
    releaseCurrentBuild();
    await queue.waitForIdle('The Vault');

    expect(calls).toHaveLength(2);
    expect(maxActiveBuilds).toBe(1);
    expect(calls[1]?.reason).toBe('memorySaved');
  });

  it('lets a manual rebuild preempt a debounced automatic build', async () => {
    const calls: GraphifyQueuedBuildRequest[] = [];
    queue = createQueue(async (request) => {
      calls.push(request);
      return recordBuild(request, 'fresh');
    });

    queue.triggerAutoBuild('The Vault', { reason: 'sourceChanged' });
    expect(timers.pendingCount()).toBe(1);

    const manual = await queue.rebuildNow('The Vault', { reason: 'manualRebuild' });
    timers.advanceBy(1000);
    await queue.waitForIdle('The Vault');

    expect(manual.status).toBe('fresh');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.objectContaining({
      trigger: 'manual',
      reason: 'manualRebuild',
      coalescedReasons: ['manualRebuild'],
    }));
    expect(timers.pendingCount()).toBe(0);
  });

  it('activates backoff after repeated automatic failures and stops automatic retries', async () => {
    const calls: GraphifyQueuedBuildRequest[] = [];
    queue = createQueue(async (request) => {
      calls.push(request);
      return recordBuild(request, 'failed');
    }, {
      maxAutoFailures: 3,
      backoffMs: 5000,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const queued = queue.triggerAutoBuild('The Vault', { reason: 'sourceChanged' });
      expect(queued.status).toBe('queued');
      timers.advanceBy(100);
      await queue.waitForIdle('The Vault');
    }

    const backoffState = queue.getProjectQueueState('The Vault');
    const ignored = queue.triggerAutoBuild('The Vault', { reason: 'sourceChanged' });

    expect(calls).toHaveLength(3);
    expect(vault.getGraphifyProjectState('The Vault')).toEqual(expect.objectContaining({
      freshness: 'failed',
      failureCount: 3,
      lastError: 'Graphify exited with code 2.',
    }));
    expect(backoffState).toEqual(expect.objectContaining({
      failureStreak: 3,
      backoffUntilMs: timers.nowMs + 5000,
    }));
    expect(ignored).toEqual(expect.objectContaining({
      status: 'backoff',
      reason: 'backoff',
    }));
    expect(timers.pendingCount()).toBe(0);
  });

  it('marks stale state while keeping the last good graph available', () => {
    const good = seedFreshGraph();
    queue = createQueue(async (request) => recordBuild(request, 'fresh'));

    const stale = queue.markProjectStale('The Vault', { reason: 'sourceChanged' });
    const state = vault.getGraphifyProjectState('The Vault');

    expect(stale.status).toBe('stale');
    expect(state).toEqual(expect.objectContaining({
      freshness: 'stale',
      latestBuildId: 'gb_last_good',
      graphPath: good.graphJson,
      htmlPath: good.graphHtml,
      reportPath: good.graphReport,
      svgPath: good.graphSvg,
      lastError: null,
    }));
    expect(state?.graphStats).toEqual(defaultGraphStats);
  });

  it('ignores automatic triggers for disabled projects', () => {
    queue = createQueue(async (request) => recordBuild(request, 'fresh'));
    vault.setGraphifyProjectEnabled('The Vault', false);

    const result = queue.triggerAutoBuild('The Vault', { reason: 'memorySaved' });

    expect(result).toEqual(expect.objectContaining({
      status: 'ignored',
      reason: 'disabled',
    }));
    expect(vault.getGraphifyProjectState('The Vault')?.freshness).toBe('disabled');
    expect(timers.pendingCount()).toBe(0);
  });

  it('marks graphs stale after important memory saves and open-loop changes', () => {
    const good = seedFreshGraph();

    vault.saveMemory({
      title: 'Graphify queue decision',
      project: 'The Vault',
      memoryType: 'decision',
      subject: 'Graphify queue',
      summary: 'Important project decisions should stale the project graph.',
      sourceApp: 'codex',
    });
    expect(vault.getGraphifyProjectState('The Vault')).toEqual(expect.objectContaining({
      freshness: 'stale',
      graphPath: good.graphJson,
    }));

    seedFreshGraph();
    vault.saveMemory({
      title: 'Reference note',
      project: 'The Vault',
      memoryType: 'reference',
      subject: 'Graphify queue reference',
      summary: 'Plain references should not force a graph stale marker.',
      sourceApp: 'codex',
    });
    expect(vault.getGraphifyProjectState('The Vault')?.freshness).toBe('fresh');

    const loop = vault.saveMemory({
      title: 'Reference open loop seed',
      project: 'The Vault',
      memoryType: 'reference',
      subject: 'Graphify queue open loop',
      summary: 'This starts without an open loop.',
      sourceApp: 'codex',
    });
    vault.updateMemory(loop.item.itemUid, {
      nextSteps: ['Rebuild graph after this loop changes.'],
    });
    expect(vault.getGraphifyProjectState('The Vault')).toEqual(expect.objectContaining({
      freshness: 'stale',
      graphPath: good.graphJson,
    }));
  });

  function createQueue(
    buildExecutor: GraphifyQueuedBuildExecutor,
    options: Partial<ConstructorParameters<typeof GraphifyBuildQueue>[0]> = {},
  ): GraphifyBuildQueue {
    return new GraphifyBuildQueue({
      projectStore: {
        getProjectStatus: (project) => vault.getGraphifyProjectStatus(project),
        getProjectState: (project) => vault.getGraphifyProjectState(project),
        upsertProjectState: (input) => vault.upsertGraphifyProjectState(input),
      },
      timers,
      clock,
      buildExecutor,
      debounceMs: 100,
      maxAutoFailures: 3,
      backoffMs: 10000,
      ...options,
    });
  }

  function seedFreshGraph(): GraphifyArtifactPaths {
    const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
    const artifactPaths = {
      graphJson: paths.graphJson,
      graphHtml: paths.graphHtml,
      graphReport: paths.graphReport,
      graphSvg: paths.graphSvg,
    };
    vault.upsertGraphifyProjectState({
      project: 'The Vault',
      enabled: true,
      sourceRoot: sourceRoot,
      freshness: 'fresh',
      buildMode: 'fast',
      latestBuildId: 'gb_last_good',
      artifactPaths,
      graphStats: defaultGraphStats,
      detectedGraphifyVersion: '0.8.17',
      failureCount: 0,
      lastError: null,
    });
    return artifactPaths;
  }

  function recordBuild(
    request: GraphifyQueuedBuildRequest,
    status: 'fresh' | 'failed',
  ) {
    const artifactPaths = status === 'fresh'
      ? getGraphifyProjectPaths(vaultRoot, request.project)
      : null;
    const startedAt = clock.isoNow();
    const completedAt = clock.isoNow();
    const graphifyArtifactPaths = artifactPaths
      ? {
          graphJson: artifactPaths.graphJson,
          graphHtml: artifactPaths.graphHtml,
          graphReport: artifactPaths.graphReport,
          graphSvg: artifactPaths.graphSvg,
        }
      : null;

    vault.recordGraphifyBuild({
      buildId: request.buildId,
      project: request.project,
      status,
      buildMode: request.buildMode,
      startedAt,
      completedAt,
      artifactPaths: graphifyArtifactPaths,
      graphStats: status === 'fresh' ? defaultGraphStats : null,
      detectedGraphifyVersion: '0.8.17',
      logPath: join(vaultRoot, 'extensions', 'graphify', 'projects', 'the-vault', 'logs', `${request.buildId}.log`),
      errorMessage: status === 'failed' ? 'Graphify exited with code 2.' : null,
    });

    return {
      buildId: request.buildId,
      project: request.project,
      status,
      buildMode: request.buildMode,
      startedAt,
      completedAt,
      command: 'graphify',
      args: [],
      logPath: join(vaultRoot, 'extensions', 'graphify', 'projects', 'the-vault', 'logs', `${request.buildId}.log`),
      artifactPaths: graphifyArtifactPaths,
      graphStats: status === 'fresh' ? defaultGraphStats : null,
      errorMessage: status === 'failed' ? 'Graphify exited with code 2.' : null,
    };
  }
});

const defaultGraphStats: GraphifyGraphStats = {
  nodeCount: 10,
  edgeCount: 12,
  communityCount: 2,
};

class FakeTimers implements GraphifyBuildQueueTimers {
  nowMs = Date.parse('2026-05-24T20:00:00.000Z');
  private nextHandle = 1;
  private scheduled = new Map<number, { dueAt: number; callback: () => void }>();

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.scheduled.set(handle, {
      dueAt: this.nowMs + delayMs,
      callback,
    });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') {
      this.scheduled.delete(handle);
    }
  }

  advanceBy(ms: number): void {
    this.nowMs += ms;
    const due = Array.from(this.scheduled.entries())
      .filter(([, timer]) => timer.dueAt <= this.nowMs)
      .sort((left, right) => left[1].dueAt - right[1].dueAt);

    for (const [handle, timer] of due) {
      if (!this.scheduled.has(handle)) {
        continue;
      }
      this.scheduled.delete(handle);
      timer.callback();
    }
  }

  pendingCount(): number {
    return this.scheduled.size;
  }
}

async function makeTempSourceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vault-graphify-queue-source-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.ts'), 'export const answer = 42;\n');
  return resolve(root);
}

async function findCachedBetterSqlitePrebuild(): Promise<string | null> {
  const expectedSuffix = `better-sqlite3-v12.9.0-node-v${process.versions.modules}-${process.platform}-${process.arch}.tar.gz`;
  const cacheDirs = [
    join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm-cache', '_prebuilds'),
    join(homedir(), '.npm', '_prebuilds'),
  ];

  for (const cacheDir of cacheDirs) {
    if (!existsSync(cacheDir)) {
      continue;
    }

    const entries = await readdir(cacheDir);
    const match = entries.find((entry) => entry.endsWith(expectedSuffix));
    if (match) {
      return join(cacheDir, match);
    }
  }

  return null;
}
