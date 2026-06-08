import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Vault } from './index.js';
import { getRawDatabase } from './database/connection.js';
import { getGraphifyExtensionPaths } from './services/graphify-paths.service.js';

describe('Graphify split storage', () => {
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
    vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-storage-'));
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

  it('initializes idempotent SQLite tables without disturbing existing Vault data', () => {
    const raw = getRawDatabase();
    expect(raw).not.toBeNull();

    const initialTables = listGraphifyTables();
    expect(initialTables).toEqual([
      'graphify_builds',
      'graphify_project_state',
    ]);

    expect(listColumns('graphify_project_state')).toEqual(expect.arrayContaining([
      'project',
      'enabled',
      'source_root',
      'freshness',
      'latest_build_id',
      'graph_json_path',
      'graph_html_path',
      'graph_report_path',
      'graph_svg_path',
      'node_count',
      'edge_count',
      'community_count',
      'failure_count',
      'last_error',
      'detected_graphify_version',
    ]));
    expect(listColumns('graphify_builds')).toEqual(expect.arrayContaining([
      'build_id',
      'project',
      'status',
      'build_mode',
      'artifact_json',
      'graph_stats_json',
      'error_message',
      'detected_graphify_version',
    ]));

    const saved = vault.saveMemory({
      title: 'Preexisting memory row',
      project: 'the-vault',
      memoryType: 'summary',
      subject: 'schema safety check',
      summary: 'This row should survive Graphify storage initialization.',
      sourceApp: 'codex',
    });

    vault.close();
    vault = new Vault(vaultRoot);
    vault.initialize();

    expect(listGraphifyTables()).toEqual(initialTables);
    expect(vault.getMemoryDetail(saved.item.itemUid)?.title).toBe('Preexisting memory row');
  });

  it('persists queryable per-project state, artifact pointers, graph stats, failures, and build history in SQLite', () => {
    const artifactPaths = {
      graphJson: join(vaultRoot, 'extensions', 'graphify', 'projects', 'the-vault', 'graphify-out', 'graph.json'),
      graphHtml: join(vaultRoot, 'extensions', 'graphify', 'projects', 'the-vault', 'graphify-out', 'graph.html'),
      graphReport: join(vaultRoot, 'extensions', 'graphify', 'projects', 'the-vault', 'graphify-out', 'GRAPH_REPORT.md'),
      graphSvg: join(vaultRoot, 'extensions', 'graphify', 'projects', 'the-vault', 'graphify-out', 'graph.svg'),
    };
    const graphStats = {
      nodeCount: 42,
      edgeCount: 77,
      communityCount: 5,
    };

    vault.upsertGraphifyProjectState({
      project: 'The Vault',
      enabled: true,
      sourceRoot: 'C:/Users/Mini/Desktop/Projects/the-vault',
      freshness: 'fresh',
      buildMode: 'fast',
      latestBuildId: 'gb_success_001',
      artifactPaths,
      graphStats,
      detectedGraphifyVersion: '0.8.17',
      failureCount: 0,
      lastError: null,
    });
    vault.recordGraphifyBuild({
      buildId: 'gb_success_001',
      project: 'The Vault',
      status: 'fresh',
      buildMode: 'fast',
      startedAt: '2026-05-24T18:40:00.000Z',
      completedAt: '2026-05-24T18:41:00.000Z',
      artifactPaths,
      graphStats,
      detectedGraphifyVersion: '0.8.17',
      logPath: join(vaultRoot, 'extensions', 'graphify', 'projects', 'the-vault', 'logs', 'gb_success_001.log'),
      errorMessage: null,
    });
    vault.recordGraphifyBuild({
      buildId: 'gb_failed_002',
      project: 'The Vault',
      status: 'failed',
      buildMode: 'full',
      startedAt: '2026-05-24T18:45:00.000Z',
      completedAt: '2026-05-24T18:45:05.000Z',
      artifactPaths: null,
      graphStats: null,
      detectedGraphifyVersion: '0.8.17',
      logPath: join(vaultRoot, 'extensions', 'graphify', 'projects', 'the-vault', 'logs', 'gb_failed_002.log'),
      errorMessage: 'Graphify exited with code 2',
    });

    const state = vault.getGraphifyProjectState('The Vault');
    expect(state).toEqual(expect.objectContaining({
      project: 'The Vault',
      enabled: true,
      sourceRoot: 'C:\\Users\\Mini\\Desktop\\Projects\\the-vault',
      freshness: 'failed',
      buildMode: 'full',
      latestBuildId: 'gb_failed_002',
      graphPath: artifactPaths.graphJson,
      htmlPath: artifactPaths.graphHtml,
      reportPath: artifactPaths.graphReport,
      svgPath: artifactPaths.graphSvg,
      detectedGraphifyVersion: '0.8.17',
      failureCount: 1,
      lastError: 'Graphify exited with code 2',
    }));
    expect(state?.graphStats).toEqual(graphStats);

    const history = vault.getGraphifyBuildHistory('The Vault');
    expect(history.map((build) => build.buildId)).toEqual(['gb_failed_002', 'gb_success_001']);
    expect(history[0]).toEqual(expect.objectContaining({
      project: 'The Vault',
      status: 'failed',
      buildMode: 'full',
      errorMessage: 'Graphify exited with code 2',
      detectedGraphifyVersion: '0.8.17',
    }));
    expect(history[1]?.artifactPaths).toEqual(artifactPaths);
    expect(history[1]?.graphStats).toEqual(graphStats);
  });

  it('stores machine-local runtime configuration in JSON', async () => {
    const config = vault.saveGraphifyRuntimeConfig({
      runtimeMode: 'localSource',
      managedRuntimePath: 'C:/Users/Mini/Vault/extensions/graphify/runtime',
      customExecutablePath: 'C:/Tools/graphify/graphify.exe',
      localSourceCheckoutPath: 'C:/Users/Mini/Desktop/cloned-repos/graphify',
      installProfile: 'documents',
      installExtras: ['mcp', 'pdf', 'office', 'svg', 'sql'],
      debounce: {
        autoBuildDelayMs: 45000,
        maxCoalesceDelayMs: 180000,
      },
      semantic: {
        enabled: true,
        provider: 'ollama',
        allowExternalProviders: false,
      },
    });

    expect(config).toEqual({
      runtimeMode: 'localSource',
      managedRuntimePath: 'C:\\Users\\Mini\\Vault\\extensions\\graphify\\runtime',
      customExecutablePath: 'C:\\Tools\\graphify\\graphify.exe',
      localSourceCheckoutPath: 'C:\\Users\\Mini\\Desktop\\cloned-repos\\graphify',
      installProfile: 'documents',
      installExtras: ['mcp', 'pdf', 'office', 'svg', 'sql'],
      debounce: {
        autoBuildDelayMs: 45000,
        maxCoalesceDelayMs: 180000,
      },
      semantic: {
        enabled: true,
        provider: 'ollama',
        allowExternalProviders: false,
      },
    });
    expect(vault.getGraphifyRuntimeConfig()).toEqual(config);

    const configPath = getGraphifyExtensionPaths(vaultRoot).config;
    const onDisk = JSON.parse(await readFile(configPath, 'utf8'));
    expect(onDisk.runtimeMode).toBe('localSource');
    expect(onDisk.localSourceCheckoutPath).toBe('C:\\Users\\Mini\\Desktop\\cloned-repos\\graphify');
    expect(onDisk.debounce.autoBuildDelayMs).toBe(45000);
  });

  it('keeps JSON runtime changes and resets isolated from SQLite project history', () => {
    vault.upsertGraphifyProjectState({
      project: 'the-vault',
      enabled: true,
      sourceRoot: 'C:/Users/Mini/Desktop/Projects/the-vault',
      freshness: 'fresh',
      buildMode: 'fast',
      latestBuildId: 'gb_001',
      artifactPaths: {
        graphJson: join(vaultRoot, 'extensions', 'graphify', 'projects', 'the-vault', 'graphify-out', 'graph.json'),
        graphHtml: null,
        graphReport: null,
        graphSvg: null,
      },
      graphStats: {
        nodeCount: 2,
        edgeCount: 1,
        communityCount: 1,
      },
      detectedGraphifyVersion: '0.8.17',
      failureCount: 0,
      lastError: null,
    });
    vault.recordGraphifyBuild({
      buildId: 'gb_001',
      project: 'the-vault',
      status: 'fresh',
      buildMode: 'fast',
      startedAt: '2026-05-24T18:40:00.000Z',
      completedAt: '2026-05-24T18:41:00.000Z',
      artifactPaths: {
        graphJson: join(vaultRoot, 'extensions', 'graphify', 'projects', 'the-vault', 'graphify-out', 'graph.json'),
        graphHtml: null,
        graphReport: null,
        graphSvg: null,
      },
      graphStats: {
        nodeCount: 2,
        edgeCount: 1,
        communityCount: 1,
      },
      detectedGraphifyVersion: '0.8.17',
      logPath: null,
      errorMessage: null,
    });

    const beforeState = vault.getGraphifyProjectState('the-vault');
    const beforeHistory = vault.getGraphifyBuildHistory('the-vault');

    vault.saveGraphifyRuntimeConfig({
      runtimeMode: 'path',
      managedRuntimePath: 'D:/VaultRuntime/graphify',
      customExecutablePath: 'D:/Tools/graphify.exe',
      localSourceCheckoutPath: 'D:/dev/graphify',
      installProfile: 'full',
      installExtras: ['mcp'],
      debounce: {
        autoBuildDelayMs: 90000,
        maxCoalesceDelayMs: 300000,
      },
      semantic: {
        enabled: false,
        provider: null,
        allowExternalProviders: false,
      },
    });

    expect(vault.getGraphifyProjectState('the-vault')).toEqual(beforeState);
    expect(vault.getGraphifyBuildHistory('the-vault')).toEqual(beforeHistory);

    const resetConfig = vault.resetGraphifyRuntimeConfig();

    expect(resetConfig.runtimeMode).toBe('managed');
    expect(resetConfig.managedRuntimePath).toBe(getGraphifyExtensionPaths(vaultRoot).runtime);
    expect(resetConfig.customExecutablePath).toBeNull();
    expect(resetConfig.localSourceCheckoutPath).toBeNull();
    expect(vault.getGraphifyProjectState('the-vault')).toEqual(beforeState);
    expect(vault.getGraphifyBuildHistory('the-vault')).toEqual(beforeHistory);
  });

  it('keeps duplicate build writes idempotent', () => {
    vault.upsertGraphifyProjectState({
      project: 'the-vault',
      enabled: true,
      sourceRoot: 'C:/Users/Mini/Desktop/Projects/the-vault',
      freshness: 'missing',
      buildMode: 'fast',
      latestBuildId: null,
      artifactPaths: null,
      graphStats: null,
      detectedGraphifyVersion: null,
      failureCount: 0,
      lastError: null,
    });

    const failedBuild = {
      buildId: 'gb_failed_once',
      project: 'the-vault',
      status: 'failed' as const,
      buildMode: 'fast' as const,
      startedAt: '2026-05-24T19:00:00.000Z',
      completedAt: '2026-05-24T19:00:05.000Z',
      artifactPaths: null,
      graphStats: null,
      detectedGraphifyVersion: '0.8.17',
      logPath: null,
      errorMessage: 'Graphify exited with code 2',
    };

    vault.recordGraphifyBuild(failedBuild);
    vault.recordGraphifyBuild(failedBuild);

    expect(vault.getGraphifyBuildHistory('the-vault')).toHaveLength(1);
    expect(vault.getGraphifyProjectState('the-vault')).toEqual(expect.objectContaining({
      latestBuildId: 'gb_failed_once',
      freshness: 'failed',
      failureCount: 1,
      lastError: 'Graphify exited with code 2',
    }));
  });
});

function listGraphifyTables(): string[] {
  const raw = getRawDatabase();
  if (!raw) {
    throw new Error('Database not initialized');
  }

  const rows = raw.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name LIKE 'graphify_%'
    ORDER BY name
  `).all() as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

function listColumns(table: string): string[] {
  const raw = getRawDatabase();
  if (!raw) {
    throw new Error('Database not initialized');
  }

  const rows = raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
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
