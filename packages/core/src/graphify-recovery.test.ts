import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Vault } from './index.js';
import { getRawDatabase } from './database/connection.js';
import { getGraphifyProjectPaths } from './services/graphify-paths.service.js';

const PROJECT = 'Recovery Project';

describe('Graphify interrupted-build recovery', () => {
  let vaultRoot: string;
  let vault: Vault;
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
    vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-recovery-'));
    vault = new Vault(vaultRoot);
    vault.initialize();
  });

  afterEach(async () => {
    vault.close();
    await rm(vaultRoot, { recursive: true, force: true });
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

  it('recovers a long-interrupted building state to failed when no artifacts exist', () => {
    vault.recordGraphifyBuild({
      buildId: 'gb_interrupted_no_artifacts',
      project: PROJECT,
      status: 'building',
      buildMode: 'fast',
      startedAt: minutesAgo(40),
      completedAt: null,
    });

    const status = vault.getGraphifyProjectStatus(PROJECT);
    const history = vault.getGraphifyBuildHistory(PROJECT);

    expect(status.freshness).toBe('failed');
    expect(status.state?.lastError).toContain('interrupted');
    expect(status.state?.failureCount).toBe(1);
    expect(history[0]).toEqual(expect.objectContaining({
      buildId: 'gb_interrupted_no_artifacts',
      status: 'failed',
      errorMessage: expect.stringContaining('interrupted'),
    }));
    expect(history[0]?.completedAt).toBeTruthy();
  });

  it('recovers to stale and fails the dangling build when the last good graph.json survives', async () => {
    const artifactRoot = join(vaultRoot, 'recovered-artifacts');
    const graphJson = join(artifactRoot, 'graph.json');
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(graphJson, JSON.stringify({ nodes: [], links: [] }));

    vault.recordGraphifyBuild({
      buildId: 'gb_last_good',
      project: PROJECT,
      status: 'fresh',
      buildMode: 'full',
      startedAt: minutesAgo(120),
      completedAt: minutesAgo(110),
      artifactPaths: { graphJson },
      graphStats: { nodeCount: 5, edgeCount: 4, communityCount: 2 },
    });
    vault.recordGraphifyBuild({
      buildId: 'gb_interrupted_with_artifacts',
      project: PROJECT,
      status: 'building',
      buildMode: 'full',
      startedAt: minutesAgo(50),
      completedAt: null,
      artifactPaths: null,
      graphStats: null,
    });

    const status = vault.getGraphifyProjectStatus(PROJECT);
    const history = vault.getGraphifyBuildHistory(PROJECT);

    expect(status.freshness).toBe('stale');
    expect(status.state?.artifactPaths.graphJson).toBe(graphJson);
    expect(status.state?.graphStats).toEqual({ nodeCount: 5, edgeCount: 4, communityCount: 2 });
    expect(history.find((build) => build.buildId === 'gb_interrupted_with_artifacts')).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('interrupted'),
      }),
    );
  });

  it('leaves a recent building state untouched', () => {
    vault.recordGraphifyBuild({
      buildId: 'gb_still_running',
      project: PROJECT,
      status: 'building',
      buildMode: 'fast',
      startedAt: minutesAgo(5),
      completedAt: null,
    });

    const status = vault.getGraphifyProjectStatus(PROJECT);

    expect(status.freshness).toBe('building');
    expect(vault.getGraphifyBuildHistory(PROJECT)[0]?.status).toBe('building');
  });

  it('leaves an old building state untouched while another process holds a fresh build lock', async () => {
    vault.recordGraphifyBuild({
      buildId: 'gb_locked_elsewhere',
      project: PROJECT,
      status: 'building',
      buildMode: 'fast',
      startedAt: minutesAgo(40),
      completedAt: null,
    });

    const paths = getGraphifyProjectPaths(vaultRoot, PROJECT);
    await mkdir(paths.projectRoot, { recursive: true });
    const lockPath = join(paths.projectRoot, 'build.lock');
    await writeFile(lockPath, JSON.stringify({ pid: 4242, startedAt: new Date().toISOString() }));

    const status = vault.getGraphifyProjectStatus(PROJECT);

    expect(existsSync(lockPath)).toBe(true);
    expect(status.freshness).toBe('building');
  });

  it('recovers an abandoned queued state to missing', () => {
    vault.upsertGraphifyProjectState({
      project: PROJECT,
      enabled: true,
      sourceRoot: null,
      freshness: 'queued',
      buildMode: 'fast',
    });
    const raw = getRawDatabase();
    expect(raw).not.toBeNull();
    raw!
      .prepare('UPDATE graphify_project_state SET updated_at = ? WHERE project = ?')
      .run(minutesAgo(45), PROJECT);

    const status = vault.getGraphifyProjectStatus(PROJECT);

    expect(status.freshness).toBe('missing');
    expect(status.state?.lastError).toBeNull();
  });
});

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
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
