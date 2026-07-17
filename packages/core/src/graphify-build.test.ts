import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, utimesSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Vault } from './index.js';
import { getGraphifyProjectPaths } from './services/graphify-paths.service.js';
import type { GraphifyBuildProcessRunner } from './services/graphify-build.service.js';

describe('Graphify manual build pipeline', () => {
  let vaultRoot: string;
  let sourceRoot: string;
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
    vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-build-'));
    sourceRoot = await makeTempSourceRoot();
    vault = new Vault(vaultRoot);
    vault.initialize();
    vault.setGraphifyProjectSourceRoot('The Vault', sourceRoot);
  });

  afterEach(async () => {
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

  it('runs a manual build through an injected runner and records missing -> building -> fresh', async () => {
    const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
    const managedCommand = join(vaultRoot, 'extensions', 'graphify', 'runtime', 'Scripts', 'graphify.exe');
    const managedInputRoot = join(paths.corpusRoot, paths.projectSlug);
    const stagedOutputRoot = join(managedInputRoot, 'graphify-out');
    const observedStates: string[] = [];
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const runner: GraphifyBuildProcessRunner = async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      observedStates.push(vault.getGraphifyProjectState('The Vault')?.freshness ?? 'missing');
      expect(options.logPath).toBe(join(paths.logsRoot, 'gb_success_manual.log'));
      expect(options.cwd).toBe(managedInputRoot);
      expect(options.env?.GRAPHIFY_VIZ_NODE_LIMIT).toBe('20000');
      if (args[0] === '--version') {
        return { exitCode: 0, stdout: 'graphify 0.9.17\n', stderr: '' };
      }
      expect(args).toEqual(['update', managedInputRoot]);
      expect(existsSync(join(managedInputRoot, 'source', 'src', 'index.ts'))).toBe(true);
      expect(existsSync(join(managedInputRoot, 'vault-memory-export', 'memories.ndjson'))).toBe(true);
      expect(existsSync(join(sourceRoot, 'graphify-out'))).toBe(false);

      await mkdir(stagedOutputRoot, { recursive: true });
      await writeFile(join(stagedOutputRoot, 'graph.json'), JSON.stringify({
        nodes: [{ id: 'memory:1' }, { id: 'file:src/index.ts' }],
        edges: [{ source: 'memory:1', target: 'file:src/index.ts' }],
        communities: [{ id: 'core' }],
      }));
      await writeFile(join(stagedOutputRoot, 'graph.html'), '<!doctype html><title>Graphify</title>');
      await writeFile(join(stagedOutputRoot, 'GRAPH_REPORT.md'), '# Graph Report\n');
      await writeFile(join(stagedOutputRoot, 'graph.svg'), '<svg></svg>');
      return { exitCode: 0, stdout: 'Graphify build complete\n', stderr: '' };
    };

    expect(vault.getGraphifyProjectState('The Vault')?.freshness).toBe('missing');

    const result = await vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_success_manual',
      commandRunner: runner,
    });
    const state = vault.getGraphifyProjectState('The Vault');
    const buildLog = await readFile(join(paths.logsRoot, 'gb_success_manual.log'), 'utf8');
    const latestLog = await readFile(paths.latestLog, 'utf8');

    expect(calls).toEqual([
      {
        command: managedCommand,
        args: ['--version'],
        cwd: managedInputRoot,
      },
      {
        command: managedCommand,
        args: [
          'update',
          managedInputRoot,
        ],
        cwd: managedInputRoot,
      },
    ]);
    expect(observedStates).toEqual(['missing', 'building']);
    expect(result).toEqual(expect.objectContaining({
      buildId: 'gb_success_manual',
      project: 'The Vault',
      status: 'fresh',
      logPath: join(paths.logsRoot, 'gb_success_manual.log'),
      artifactPaths: {
        graphJson: paths.graphJson,
        graphHtml: paths.graphHtml,
        graphReport: paths.graphReport,
        graphSvg: paths.graphSvg,
      },
      graphStats: {
        nodeCount: 2,
        edgeCount: 1,
        communityCount: 1,
      },
      errorMessage: null,
    }));
    expect(state).toEqual(expect.objectContaining({
      freshness: 'fresh',
      latestBuildId: 'gb_success_manual',
      graphPath: paths.graphJson,
      htmlPath: paths.graphHtml,
      reportPath: paths.graphReport,
      svgPath: paths.graphSvg,
      failureCount: 0,
      lastError: null,
      detectedGraphifyVersion: '0.9.17',
    }));
    expect(vault.getGraphifyBuildHistory('The Vault')[0]?.detectedGraphifyVersion).toBe('0.9.17');
    expect(state?.graphStats).toEqual({ nodeCount: 2, edgeCount: 1, communityCount: 1 });
    expect(buildLog).toContain('Graphify build complete');
    expect(latestLog).toBe(buildLog);
  });

  it('regenerates graph.html via cluster-only when update skips visualization', async () => {
    const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
    const managedInputRoot = join(paths.corpusRoot, paths.projectSlug);
    const stagedOutputRoot = join(managedInputRoot, 'graphify-out');
    const commands: Array<{ args: string[]; cwd: string }> = [];
    const runner: GraphifyBuildProcessRunner = async (_command, args, options) => {
      commands.push({ args, cwd: options.cwd });
      expect(options.env?.GRAPHIFY_VIZ_NODE_LIMIT).toBe('20000');
      if (args[0] === '--version') {
        return { exitCode: 0, stdout: 'graphify 0.9.17\n', stderr: '' };
      }
      await mkdir(stagedOutputRoot, { recursive: true });
      if (args[0] === 'update') {
        // Large graph: update writes graph.json + report but skips graph.html.
        await writeFile(join(stagedOutputRoot, 'graph.json'), JSON.stringify({
          nodes: [{ id: 'a' }, { id: 'b' }],
          edges: [{ source: 'a', target: 'b' }],
          communities: [{ id: 'c' }],
        }));
        await writeFile(join(stagedOutputRoot, 'GRAPH_REPORT.md'), '# Graph Report\n');
        return { exitCode: 0, stdout: 'updated\n', stderr: '' };
      }
      // cluster-only fallback forces the visualization from the existing graph.json.
      await writeFile(join(stagedOutputRoot, 'graph.html'), '<!doctype html><title>Graphify</title>');
      return { exitCode: 0, stdout: 'viz\n', stderr: '' };
    };

    const result = await vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_viz_fallback',
      commandRunner: runner,
    });

    expect(commands).toEqual([
      { args: ['--version'], cwd: managedInputRoot },
      { args: ['update', managedInputRoot], cwd: managedInputRoot },
      { args: ['cluster-only', paths.projectSlug], cwd: paths.corpusRoot },
    ]);
    expect(result.status).toBe('fresh');
    expect(result.artifactPaths?.graphHtml).toBe(paths.graphHtml);
    expect(existsSync(paths.graphHtml)).toBe(true);
  });

  it('rejects a second concurrent build for the same project', async () => {
    let releaseFirst: () => void = () => {};
    let markStarted: () => void = () => {};
    const firstStarted = new Promise<void>((resolveStarted) => { markStarted = resolveStarted; });
    const blockingRunner: GraphifyBuildProcessRunner = async (_command, args, options) => {
      if (args[0] === '--version') {
        return { exitCode: 0, stdout: 'graphify 0.9.17\n', stderr: '' };
      }
      markStarted();
      await new Promise<void>((release) => { releaseFirst = release; });
      const stagedOutputRoot = join(options.cwd, 'graphify-out');
      await mkdir(stagedOutputRoot, { recursive: true });
      await writeFile(join(stagedOutputRoot, 'graph.json'), JSON.stringify({ nodes: [], edges: [], communities: [] }));
      await writeFile(join(stagedOutputRoot, 'graph.html'), '<!doctype html>');
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const firstBuild = vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_lock_first',
      commandRunner: blockingRunner,
    });
    await firstStarted;

    await expect(vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_lock_second',
      commandRunner: blockingRunner,
    })).rejects.toThrow('A Graphify build is already running for this project.');

    releaseFirst();
    const result = await firstBuild;
    expect(result.status).toBe('fresh');
  });

  it('rejects a build when another process holds the project lock', async () => {
    const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
    await mkdir(paths.projectRoot, { recursive: true });
    await writeFile(
      join(paths.projectRoot, 'build.lock'),
      JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }),
    );
    let runnerCalled = false;
    const runner: GraphifyBuildProcessRunner = async () => {
      runnerCalled = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await expect(vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_cross_process_locked',
      commandRunner: runner,
    })).rejects.toThrow('another process');
    expect(runnerCalled).toBe(false);
  });

  it('reclaims a stale project lock left by a crashed build', async () => {
    const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
    const lockPath = join(paths.projectRoot, 'build.lock');
    await mkdir(paths.projectRoot, { recursive: true });
    await writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: '2000-01-01T00:00:00.000Z' }));
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(lockPath, longAgo, longAgo);

    const runner: GraphifyBuildProcessRunner = async (_command, _args, options) => {
      const stagedOutputRoot = join(options.cwd, 'graphify-out');
      await mkdir(stagedOutputRoot, { recursive: true });
      await writeFile(join(stagedOutputRoot, 'graph.json'), JSON.stringify({ nodes: [], edges: [], communities: [] }));
      await writeFile(join(stagedOutputRoot, 'graph.html'), '<!doctype html>');
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const result = await vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_stale_reclaim',
      commandRunner: runner,
    });
    expect(result.status).toBe('fresh');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('re-stages over a previous staged input that contains read-only files', async () => {
    const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
    // Simulate a stuck staged copy from a prior build: a read-only file (e.g. a folder
    // that carried a Windows desktop.ini) that plain fs.rm cannot delete (EPERM).
    const staleDir = join(paths.corpusRoot, paths.projectSlug, 'source', 'assets');
    await mkdir(staleDir, { recursive: true });
    const readonlyFile = join(staleDir, 'locked.txt');
    await writeFile(readonlyFile, 'stale');
    chmodSync(readonlyFile, 0o444);

    const runner: GraphifyBuildProcessRunner = async (_command, _args, options) => {
      const stagedOutputRoot = join(options.cwd, 'graphify-out');
      await mkdir(stagedOutputRoot, { recursive: true });
      await writeFile(join(stagedOutputRoot, 'graph.json'), JSON.stringify({ nodes: [], edges: [], communities: [] }));
      await writeFile(join(stagedOutputRoot, 'graph.html'), '<!doctype html>');
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const result = await vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_readonly_restage',
      commandRunner: runner,
    });

    expect(result.status).toBe('fresh');
    expect(existsSync(readonlyFile)).toBe(false);
  });

  it('records failed manual builds while preserving last good artifact pointers', async () => {
    const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
    const successfulRunner: GraphifyBuildProcessRunner = async () => {
      await mkdir(paths.artifactRoot, { recursive: true });
      await writeFile(paths.graphJson, JSON.stringify({
        nodes: [{ id: 'a' }],
        edges: [],
        communities: [],
      }));
      return { exitCode: 0, stdout: 'ok\n', stderr: '' };
    };
    const failingRunner: GraphifyBuildProcessRunner = async (_command, args, options) => {
      if (args[0] === '--version') {
        return { exitCode: 0, stdout: 'graphify 0.9.17\n', stderr: '' };
      }
      expect(vault.getGraphifyProjectState('The Vault')?.freshness).toBe('building');
      expect(options.logPath).toBe(join(paths.logsRoot, 'gb_failed_manual.log'));
      return { exitCode: 2, stdout: '', stderr: 'Graphify failed loudly\n' };
    };

    await vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_good_manual',
      commandRunner: successfulRunner,
    });
    const goodState = vault.getGraphifyProjectState('The Vault');

    const failed = await vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_failed_manual',
      commandRunner: failingRunner,
    });
    const failedState = vault.getGraphifyProjectState('The Vault');
    const history = vault.getGraphifyBuildHistory('The Vault');
    const failedLog = await readFile(join(paths.logsRoot, 'gb_failed_manual.log'), 'utf8');

    expect(failed).toEqual(expect.objectContaining({
      buildId: 'gb_failed_manual',
      status: 'failed',
      artifactPaths: null,
      graphStats: null,
      errorMessage: 'Graphify exited with code 2.',
    }));
    expect(failedState).toEqual(expect.objectContaining({
      freshness: 'failed',
      latestBuildId: 'gb_failed_manual',
      graphPath: goodState?.graphPath,
      htmlPath: goodState?.htmlPath,
      reportPath: goodState?.reportPath,
      svgPath: goodState?.svgPath,
      failureCount: 1,
      lastError: 'Graphify exited with code 2.',
    }));
    expect(failedState?.graphStats).toEqual(goodState?.graphStats);
    expect(history.map((build) => build.buildId)).toEqual(['gb_failed_manual', 'gb_good_manual']);
    expect(failedLog).toContain('Graphify failed loudly');
  });

  it('treats successful process exits without graph.json as failed builds', async () => {
    const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
    const runner: GraphifyBuildProcessRunner = async () => {
      await mkdir(paths.artifactRoot, { recursive: true });
      await writeFile(paths.graphHtml, '<!doctype html><title>Missing JSON</title>');
      return { exitCode: 0, stdout: 'completed without graph json\n', stderr: '' };
    };

    const result = await vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_missing_json',
      commandRunner: runner,
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      artifactPaths: null,
      graphStats: null,
      errorMessage: 'Graphify build did not produce graph.json.',
    }));
    expect(vault.getGraphifyProjectState('The Vault')).toEqual(expect.objectContaining({
      freshness: 'failed',
      latestBuildId: 'gb_missing_json',
      graphPath: null,
      failureCount: 1,
      lastError: 'Graphify build did not produce graph.json.',
    }));
  });

  it('rejects unsafe build IDs before logs can escape the managed logs directory', async () => {
    let runnerCalled = false;
    const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
    const runner: GraphifyBuildProcessRunner = async () => {
      runnerCalled = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    await expect(vault.buildGraphifyProjectGraph('The Vault', {
      buildId: '../escape',
      commandRunner: runner,
    })).rejects.toThrow('Graphify build IDs may only contain letters, numbers, underscores, and dashes.');

    expect(runnerCalled).toBe(false);
    expect(existsSync(join(paths.projectRoot, 'escape.log'))).toBe(false);
  });

  it('keeps managed source staging asynchronous so desktop builds do not block Electron', () => {
    const serviceSource = readFileSync(
      join(process.cwd(), 'packages/core/src/services/graphify-build.service.ts'),
      'utf8',
    );

    expect(serviceSource).not.toMatch(/\bcpSync\b/);
    expect(serviceSource).not.toMatch(/\brmSync\b/);
    expect(serviceSource).toContain('await prepareGraphifyBuildInput');
    expect(serviceSource).toContain('await copyStagedGraphifyArtifacts');
  });
});

async function makeTempSourceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vault-graphify-build-source-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.ts'), 'export const answer = 42;\n');
  return root;
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
