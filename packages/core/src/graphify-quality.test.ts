import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Vault } from './index.js';
import { getGraphifyProjectPaths } from './services/graphify-paths.service.js';
import type { GraphifyBuildProcessRunner } from './services/graphify-build.service.js';

type GraphifySemanticModeStatus = {
  enabled: boolean;
  provider: string | null;
  providerConfigured: boolean;
  allowExternalProviders: boolean;
  externalProvider: boolean;
  buildAllowed: boolean;
  warnings: string[];
  message: string;
};

type ScheduledFullRebuildPlan = {
  shouldQueue: boolean;
  project: string;
  buildMode: string | null;
  reason: string;
  nextEligibleAt: string | null;
  warnings: string[];
};

type Phase12VaultApi = {
  getGraphifySemanticModeStatus(): GraphifySemanticModeStatus;
  planGraphifyScheduledFullRebuild(project: string, input: {
    now: string;
    intervalHours?: number;
  }): ScheduledFullRebuildPlan;
};

describe('Graphify semantic mode and quality optimization', () => {
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
    vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-quality-'));
    sourceRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-quality-source-'));
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

  it('keeps semantic mode disabled by default and blocks semantic builds until opt-in', async () => {
    const runtimeConfig = vault.getGraphifyRuntimeConfig();
    expect(runtimeConfig.semantic).toEqual({
      enabled: false,
      provider: null,
      allowExternalProviders: false,
    });

    let runnerCalled = false;
    const runner: GraphifyBuildProcessRunner = async () => {
      runnerCalled = true;
      await writeMinimalGraph('The Vault');
      return { exitCode: 0, stdout: 'semantic build ran\n', stderr: '' };
    };

    await expect(vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_semantic_disabled',
      buildMode: 'semantic',
      commandRunner: runner,
    })).rejects.toThrow(/semantic mode is disabled/i);
    expect(runnerCalled).toBe(false);
  });

  it('requires a configured semantic provider and warns before external provider use', async () => {
    const runner: GraphifyBuildProcessRunner = async () => {
      await writeMinimalGraph('The Vault');
      return { exitCode: 0, stdout: 'semantic build ran\n', stderr: '' };
    };

    vault.saveGraphifyRuntimeConfig({
      semantic: {
        enabled: true,
        provider: null,
        allowExternalProviders: false,
      },
    });
    await expect(vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_semantic_without_provider',
      buildMode: 'semantic',
      commandRunner: runner,
    })).rejects.toThrow(/semantic provider/i);

    vault.saveGraphifyRuntimeConfig({
      semantic: {
        enabled: true,
        provider: 'openai',
        allowExternalProviders: false,
      },
    });
    const externalStatus = (vault as Vault & Phase12VaultApi).getGraphifySemanticModeStatus();
    expect(externalStatus).toEqual(expect.objectContaining({
      enabled: true,
      provider: 'openai',
      providerConfigured: true,
      externalProvider: true,
      buildAllowed: false,
    }));
    expect(externalStatus.warnings.join(' ')).toMatch(/external provider/i);
    await expect(vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_semantic_external_blocked',
      buildMode: 'semantic',
      commandRunner: runner,
    })).rejects.toThrow(/external provider/i);

    vault.saveGraphifyRuntimeConfig({
      semantic: {
        enabled: true,
        provider: 'ollama',
        allowExternalProviders: false,
      },
    });
    expect((vault as Vault & Phase12VaultApi).getGraphifySemanticModeStatus()).toEqual(expect.objectContaining({
      enabled: true,
      provider: 'ollama',
      providerConfigured: true,
      externalProvider: false,
      buildAllowed: true,
    }));

    const result = await vault.buildGraphifyProjectGraph('The Vault', {
      buildId: 'gb_semantic_local_provider',
      buildMode: 'semantic',
      commandRunner: runner,
    });
    expect(result).toEqual(expect.objectContaining({
      buildId: 'gb_semantic_local_provider',
      status: 'fresh',
      buildMode: 'semantic',
    }));
  });

  it('plans scheduled full rebuilds as full mode only even when semantic mode is enabled', () => {
    vault.saveGraphifyRuntimeConfig({
      semantic: {
        enabled: true,
        provider: 'openai',
        allowExternalProviders: true,
      },
    });
    vault.upsertGraphifyProjectState({
      project: 'The Vault',
      enabled: true,
      sourceRoot,
      freshness: 'fresh',
      buildMode: 'semantic',
      latestBuildId: 'gb_old_semantic',
      artifactPaths: null,
      graphStats: null,
      detectedGraphifyVersion: '0.8.17',
      lastBuildStartedAt: '2026-05-23T00:00:00.000Z',
      lastBuildCompletedAt: '2026-05-23T00:05:00.000Z',
      failureCount: 0,
      lastError: null,
    });

    const plan = (vault as Vault & Phase12VaultApi).planGraphifyScheduledFullRebuild('The Vault', {
      now: '2026-05-25T00:00:00.000Z',
      intervalHours: 24,
    });

    expect(plan).toEqual(expect.objectContaining({
      shouldQueue: true,
      project: 'The Vault',
      buildMode: 'full',
      reason: 'due',
    }));
    expect(plan.warnings.join(' ')).toMatch(/semantic extraction stays manual/i);
  });

  it('returns budgeted impact neighborhoods, report snippets, and stale graph warnings', async () => {
    await writeImpactArtifacts('The Vault');
    const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
    vault.upsertGraphifyProjectState({
      project: 'The Vault',
      enabled: true,
      sourceRoot,
      freshness: 'stale',
      buildMode: 'fast',
      latestBuildId: 'gb_stale_quality',
      artifactPaths: {
        graphJson: paths.graphJson,
        graphHtml: null,
        graphReport: paths.graphReport,
        graphSvg: null,
      },
      graphStats: {
        nodeCount: 5,
        edgeCount: 4,
        communityCount: 1,
      },
      detectedGraphifyVersion: '0.8.17',
      failureCount: 0,
      lastError: null,
    });

    const impact = vault.explainGraphifyImpact('The Vault', {
      query: 'semantic provider scheduled full rebuild quality',
      maxFiles: 1,
      maxNodes: 2,
      maxReportBytes: 512,
    });
    const phase12Impact = impact as typeof impact & {
      relatedNodes: unknown[];
      reportSnippets: Array<{ text: string; truncated: boolean }>;
      truncated: boolean;
    };

    expect(phase12Impact.status).toBe('available');
    expect(phase12Impact.caveats).toContain('Graphify graph is stale; using the last available graph.');
    expect(phase12Impact.likelyFiles.length).toBeLessThanOrEqual(1);
    expect(phase12Impact.tests.length).toBeLessThanOrEqual(1);
    expect(phase12Impact.centralNodes.length).toBeLessThanOrEqual(2);
    expect(phase12Impact.relatedNodes.length).toBeLessThanOrEqual(2);
    expect(phase12Impact.reportSnippets[0]?.text).toContain('external provider use');
    expect(phase12Impact.truncated).toBe(true);
  });

  async function writeMinimalGraph(project: string): Promise<void> {
    const paths = getGraphifyProjectPaths(vaultRoot, project);
    await mkdir(dirname(paths.graphJson), { recursive: true });
    await writeFile(paths.graphJson, JSON.stringify({
      nodes: [{ id: 'file:src/index.ts', path: 'src/index.ts', type: 'file' }],
      edges: [],
      communities: [],
    }), 'utf8');
  }

  async function writeImpactArtifacts(project: string): Promise<void> {
    const paths = getGraphifyProjectPaths(vaultRoot, project);
    await mkdir(dirname(paths.graphJson), { recursive: true });
    await writeFile(paths.graphJson, JSON.stringify({
      nodes: [
        {
          id: 'symbol:planGraphifyScheduledFullRebuild',
          label: 'planGraphifyScheduledFullRebuild',
          type: 'symbol',
          path: 'packages/core/src/services/graphify-quality.service.ts',
          summary: 'Plans scheduled full rebuilds while keeping semantic extraction manual.',
        },
        {
          id: 'file:packages/core/src/services/graphify-quality.service.ts',
          label: 'graphify-quality.service.ts',
          type: 'file',
          path: 'packages/core/src/services/graphify-quality.service.ts',
          summary: 'Semantic mode status and scheduled full rebuild policy.',
        },
        {
          id: 'test:packages/core/src/graphify-quality.test.ts',
          label: 'graphify-quality.test.ts',
          type: 'test',
          path: 'packages/core/src/graphify-quality.test.ts',
          summary: 'Tests semantic opt-in and quality impact budgets.',
        },
        {
          id: 'file:packages/core/src/services/graphify-build.service.ts',
          label: 'graphify-build.service.ts',
          type: 'file',
          path: 'packages/core/src/services/graphify-build.service.ts',
          summary: 'Builds Graphify graphs with configured modes.',
        },
        {
          id: 'community:graphify-quality',
          label: 'Graphify Quality',
          type: 'community',
          summary: 'Quality optimization and semantic mode controls.',
        },
      ],
      edges: [
        {
          source: 'symbol:planGraphifyScheduledFullRebuild',
          target: 'file:packages/core/src/services/graphify-quality.service.ts',
          type: 'defined_in',
        },
        {
          source: 'symbol:planGraphifyScheduledFullRebuild',
          target: 'test:packages/core/src/graphify-quality.test.ts',
          type: 'tested_by',
        },
        {
          source: 'symbol:planGraphifyScheduledFullRebuild',
          target: 'file:packages/core/src/services/graphify-build.service.ts',
          type: 'protects',
        },
        {
          source: 'community:graphify-quality',
          target: 'symbol:planGraphifyScheduledFullRebuild',
          type: 'contains',
        },
      ],
      communities: [{ id: 'graphify-quality', label: 'Graphify Quality' }],
    }), 'utf8');
    await writeFile(paths.graphReport, [
      '# Graph Report',
      '',
      '## Semantic Provider Quality',
      'Semantic rebuilds must warn about external provider use before any project source or Vault memory export can be sent out.',
      'Scheduled full rebuilds stay on local full mode unless the user explicitly starts semantic extraction.',
      '',
      '## Other Notes',
      'This unrelated section should not be the first impact snippet for semantic provider queries.',
    ].join('\n'), 'utf8');
  }
});

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
