import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Vault } from './index.js';
import { getGraphifyProjectPaths } from './services/graphify-paths.service.js';

describe('Vault recall with Graphify graph context', () => {
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
    vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-recall-'));
    sourceRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-recall-source-'));
    vault = new Vault(vaultRoot);
    vault.initialize();
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

  it('returns Vault recall results plus budgeted Graphify context for one project', async () => {
    await seedRecallMemories();
    await writeManagedGraphifyArtifacts('The Vault');
    upsertGraphifyState('The Vault', 'fresh');

    const context = await vault.recallWithGraphContext({
      project: 'The Vault',
      queryText: 'Plan work around recallWithGraphContext',
      keywords: ['graphify', 'recall'],
      limit: 3,
      maxFiles: 4,
      maxGraphNodes: 8,
      maxGraphEdges: 8,
      maxReportBytes: 1024,
      maxTokens: 900,
    });

    expect(context.recall.topMatches.map((match) => match.item.title)).toContain('Graphify recall routing decision');
    expect(context.graph.used).toBe(true);
    expect(context.graph.query?.status).toBe('available');
    expect(context.graph.impact?.status).toBe('available');
    expect(context.graph.freshnessWarnings).toEqual([]);
    expect(context.graph.likelyRelevantFiles.map((file) => file.path)).toEqual(expect.arrayContaining([
      'packages/core/src/vault.ts',
      'packages/core/src/services/graphify-recall.service.ts',
    ]));
    expect(context.graph.tests.map((file) => file.path)).toContain('packages/core/src/graphify-recall.test.ts');
    expect(context.graph.centralNodes.map((node) => node.id)).toContain('symbol:Vault.recallWithGraphContext');
    expect(context.graph.communities.map((node) => node.id)).toContain('community:recall-context');
    expect(context.graph.shortestPaths[0]).toEqual(expect.objectContaining({
      found: true,
      from: 'packages/core/src/vault.ts',
      to: 'packages/core/src/graphify-recall.test.ts',
    }));
    expect(context.graph.shortestPaths[0]?.path.map((node) => node.id)).toEqual([
      'file:packages/core/src/vault.ts',
      'symbol:Vault.recallWithGraphContext',
      'test:packages/core/src/graphify-recall.test.ts',
    ]);
    expect(context.graph.reportSnippets[0]?.text).toContain('buildRecallWithGraphContext');
    expect(context.suggestedNextFileReads).toEqual(expect.arrayContaining([
      'packages/core/src/vault.ts',
      'packages/core/src/services/graphify-recall.service.ts',
      'packages/core/src/graphify-recall.test.ts',
    ]));
    expect(context.suggestedNextFileReads.length).toBeLessThanOrEqual(4);
    expect(context.budget.maxTokens).toBe(900);
    expect(context.budget.estimatedTokens).toBeLessThanOrEqual(context.budget.maxTokens);
  });

  it('surfaces stale graph warnings when a last good graph is usable', async () => {
    await seedRecallMemories();
    await writeManagedGraphifyArtifacts('The Vault');
    upsertGraphifyState('The Vault', 'stale');

    const context = await vault.recallWithGraphContext({
      project: 'The Vault',
      queryText: 'recallWithGraphContext',
      limit: 2,
    });

    expect(context.graph.used).toBe(true);
    expect(context.graph.freshnessWarnings).toContain('Graphify graph is stale; using the last available graph.');
    expect(context.warnings).toContain('Graphify graph is stale; using the last available graph.');
  });

  it('uses the last available graph when latest Graphify freshness is failed', async () => {
    await seedRecallMemories('Failed With Graph');
    await writeManagedGraphifyArtifacts('Failed With Graph');
    upsertGraphifyState('Failed With Graph', 'failed', 'EPERM: cleanup failed');

    const context = await vault.recallWithGraphContext({
      project: 'Failed With Graph',
      queryText: 'recallWithGraphContext',
      limit: 2,
    });

    expect(context.graph.used).toBe(true);
    expect(context.graph.status).toBe('available');
    expect(context.graph.fallbackReason).toBeNull();
    expect(context.graph.query?.status).toBe('available');
    expect(context.graph.impact?.status).toBe('available');
    expect(context.graph.freshnessWarnings).toContain('Latest Graphify build failed; using the last available graph. Last error: EPERM: cleanup failed');
    expect(context.graph.likelyRelevantFiles.map((file) => file.path)).toContain('packages/core/src/vault.ts');
  });

  it('falls back to Vault-only recall and logs the fallback reason when graph context is unusable', async () => {
    await seedRecallMemories('Broken Graph');
    upsertGraphifyState('Broken Graph', 'failed', 'Graphify exited with code 1.');

    const failedContext = await vault.recallWithGraphContext({
      project: 'Broken Graph',
      queryText: 'recallWithGraphContext',
      limit: 2,
    });

    expect(failedContext.recall.topMatches.map((match) => match.item.title)).toContain('Graphify recall routing decision');
    expect(failedContext.graph).toEqual(expect.objectContaining({
      used: false,
      fallbackReason: 'failed',
      query: null,
      impact: null,
      reportSnippets: [],
    }));
    expect(failedContext.suggestedNextFileReads).toContain('packages/core/src/vault.ts');

    const logs = vault.getRecentLogs(10, { actionType: 'recall' });
    expect(logs.some((log) => (
      log.metadata?.recallKind === 'graph_context' &&
      log.metadata?.graphFallbackReason === 'failed'
    ))).toBe(true);

    await seedRecallMemories('Stale Missing Graph');
    vault.upsertGraphifyProjectState({
      project: 'Stale Missing Graph',
      enabled: true,
      sourceRoot,
      freshness: 'stale',
      buildMode: 'fast',
      latestBuildId: 'gb_missing_artifacts',
      artifactPaths: null,
      graphStats: null,
      detectedGraphifyVersion: '0.8.17',
      failureCount: 0,
      lastError: null,
    });

    const staleMissingContext = await vault.recallWithGraphContext({
      project: 'Stale Missing Graph',
      queryText: 'recallWithGraphContext',
      limit: 2,
    });

    expect(staleMissingContext.graph).toEqual(expect.objectContaining({
      used: false,
      fallbackReason: 'missing',
    }));
  });

  it('respects graph context budgets before suggesting file reads', async () => {
    await seedRecallMemories();
    await writeManagedGraphifyArtifacts('The Vault');
    upsertGraphifyState('The Vault', 'fresh');

    const context = await vault.recallWithGraphContext({
      project: 'The Vault',
      queryText: 'recallWithGraphContext',
      limit: 1,
      maxFiles: 1,
      maxGraphNodes: 1,
      maxGraphEdges: 1,
      maxReportBytes: 128,
      maxTokens: 180,
    });

    expect(context.graph.query?.nodes.length).toBeLessThanOrEqual(1);
    expect(context.graph.query?.edges.length).toBeLessThanOrEqual(1);
    expect(context.graph.likelyRelevantFiles.length).toBeLessThanOrEqual(1);
    expect(context.graph.centralNodes.length).toBeLessThanOrEqual(1);
    expect(context.suggestedNextFileReads.length).toBeLessThanOrEqual(1);
    expect(context.budget.truncated).toBe(true);
    expect(context.budget.estimatedTokens).toBeLessThanOrEqual(context.budget.maxTokens);
  });

  async function seedRecallMemories(project = 'The Vault'): Promise<void> {
    vault.saveMemory({
      title: 'Graphify recall routing decision',
      project,
      memoryType: 'decision',
      subject: 'vault_recall_with_graph_context',
      summary: 'Combine Vault recall with Graphify graph context before risky implementation work.',
      keywords: ['graphify', 'recall', 'context'],
      tags: ['graphify', 'phase-9'],
      relatedFiles: [
        'packages/core/src/vault.ts',
        'packages/core/src/services/graphify-recall.service.ts',
      ],
      sourceApp: 'codex',
    });
    vault.saveMemory({
      title: 'Graphify recall test handoff',
      project,
      memoryType: 'handoff',
      subject: 'graphify recall tests',
      summary: 'The combined recall tool should suggest next file reads rather than dumping source files.',
      keywords: ['graphify', 'tests'],
      tags: ['phase-9'],
      relatedFiles: ['packages/core/src/graphify-recall.test.ts'],
      sourceApp: 'codex',
    });
  }

  async function writeManagedGraphifyArtifacts(project: string): Promise<void> {
    const paths = getGraphifyProjectPaths(vaultRoot, project);
    await mkdir(dirname(paths.graphJson), { recursive: true });
    await writeFile(paths.graphJson, JSON.stringify({
      nodes: [
        {
          id: 'file:packages/core/src/vault.ts',
          label: 'packages/core/src/vault.ts',
          type: 'file',
          path: 'packages/core/src/vault.ts',
          summary: 'Vault core facade exposes recallWithGraphContext.',
        },
        {
          id: 'symbol:Vault.recallWithGraphContext',
          label: 'Vault.recallWithGraphContext',
          type: 'symbol',
          path: 'packages/core/src/vault.ts',
          summary: 'Thin wrapper around buildRecallWithGraphContext.',
        },
        {
          id: 'file:packages/core/src/services/graphify-recall.service.ts',
          label: 'graphify-recall.service.ts',
          type: 'file',
          path: 'packages/core/src/services/graphify-recall.service.ts',
          summary: 'Builds a budgeted recall and graph context pack.',
        },
        {
          id: 'test:packages/core/src/graphify-recall.test.ts',
          label: 'graphify-recall.test.ts',
          type: 'test',
          path: 'packages/core/src/graphify-recall.test.ts',
          summary: 'Tests vault_recall_with_graph_context behavior.',
        },
        {
          id: 'community:recall-context',
          label: 'Recall Context',
          type: 'community',
          summary: 'Graphify recall and agent routing surface.',
        },
      ],
      edges: [
        {
          source: 'file:packages/core/src/vault.ts',
          target: 'symbol:Vault.recallWithGraphContext',
          type: 'exports',
          label: 'exports',
        },
        {
          source: 'symbol:Vault.recallWithGraphContext',
          target: 'file:packages/core/src/services/graphify-recall.service.ts',
          type: 'calls',
          label: 'calls',
        },
        {
          source: 'symbol:Vault.recallWithGraphContext',
          target: 'test:packages/core/src/graphify-recall.test.ts',
          type: 'tested_by',
          label: 'tested by',
        },
        {
          source: 'community:recall-context',
          target: 'symbol:Vault.recallWithGraphContext',
          type: 'contains',
          label: 'contains',
        },
      ],
      communities: [{ id: 'recall-context', label: 'Recall Context' }],
    }), 'utf8');
    await writeFile(paths.graphReport, [
      '# Graph Report',
      '',
      '## Recall With Graph Context',
      'buildRecallWithGraphContext combines Vault memories, graph impact, shortest paths, and report snippets.',
      'It should return suggested next file reads instead of source file dumps.',
      '',
      '## Unrelated',
      'Other architecture notes are intentionally less relevant.',
    ].join('\n'), 'utf8');
  }

  function upsertGraphifyState(
    project: string,
    freshness: 'fresh' | 'stale' | 'failed',
    lastError: string | null = null,
  ): void {
    const paths = getGraphifyProjectPaths(vaultRoot, project);
    vault.upsertGraphifyProjectState({
      project,
      enabled: true,
      sourceRoot,
      freshness,
      buildMode: 'fast',
      latestBuildId: `gb_${freshness}_recall`,
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
      failureCount: freshness === 'failed' ? 1 : 0,
      lastError,
    });
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
