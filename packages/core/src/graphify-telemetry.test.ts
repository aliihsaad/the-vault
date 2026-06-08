import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  Vault,
  buildGraphifyRecallTelemetry,
  toGraphifyTelemetryLogMetadata,
  type MemoryItem,
  type MemoryPack,
} from './index.js';
import { getGraphifyProjectPaths } from './services/graphify-paths.service.js';

type GraphifyRecallTelemetryResultInput = Parameters<typeof buildGraphifyRecallTelemetry>[0]['result'];

describe('Graphify token-savings telemetry', () => {
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
    vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-telemetry-'));
    sourceRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-telemetry-source-'));
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

  it('estimates graph-backed recall savings without logging source paths or snippets', () => {
    const result = graphRecallResult({
      budget: {
        maxTokens: 900,
        estimatedTokens: 420,
        truncated: false,
        maxFiles: 4,
        maxGraphNodes: 8,
        maxGraphEdges: 8,
        maxReportBytes: 2048,
      },
    });

    const telemetry = buildGraphifyRecallTelemetry({
      result,
      broadSearchFileBaseline: 7,
    });

    expect(telemetry).toMatchObject({
      graphUsed: true,
      graphQueriesPerRecall: 1,
      graphFreshness: 'fresh',
      graphFallbackReason: null,
      broadSearchFileBaseline: 7,
      suggestedFileReadCount: 2,
      filesAvoidedEstimate: 5,
      contextPackTokenEstimate: 420,
    });
    expect(telemetry.estimatedTokensSaved).toBeGreaterThan(0);

    const metadata = toGraphifyTelemetryLogMetadata(telemetry);
    expect(metadata).toMatchObject({
      graphTelemetryVersion: 1,
      graphQueriesPerRecall: 1,
      graphFreshness: 'fresh',
      graphFallbackReason: null,
      graphFilesAvoidedEstimate: 5,
      graphContextPackTokens: 420,
    });
    expect(JSON.stringify(metadata)).not.toContain('packages/core/src/vault.ts');
    expect(JSON.stringify(metadata)).not.toContain('packages/core/src/secrets/token.ts');
    expect(JSON.stringify(metadata)).not.toContain('SECRET_VALUE_SHOULD_NOT_BE_LOGGED');
  });

  it('records fallback reasons without claiming avoided files or saved tokens', () => {
    const result = graphRecallResult({
      graphUsed: false,
      graphStatus: 'failed',
      graphFreshness: 'failed',
      graphFallbackReason: 'failed',
      budget: {
        maxTokens: 900,
        estimatedTokens: 180,
        truncated: false,
        maxFiles: 4,
        maxGraphNodes: 8,
        maxGraphEdges: 8,
        maxReportBytes: 2048,
      },
    });

    const telemetry = buildGraphifyRecallTelemetry({
      result,
      broadSearchFileBaseline: 9,
    });

    expect(telemetry).toMatchObject({
      graphUsed: false,
      graphQueriesPerRecall: 0,
      graphFreshness: 'failed',
      graphFallbackReason: 'failed',
      filesAvoidedEstimate: 0,
      estimatedTokensSaved: 0,
    });
  });

  it('stores token-savings telemetry on the graph-context activity log row', async () => {
    seedRecallMemories('The Vault');
    await writeManagedGraphifyArtifacts('The Vault');
    upsertGraphifyState('The Vault', 'fresh');

    const context = await vault.recallWithGraphContext({
      project: 'The Vault',
      queryText: 'Graphify telemetry service',
      keywords: ['graphify', 'telemetry'],
      limit: 2,
      maxFiles: 2,
      maxGraphNodes: 6,
      maxGraphEdges: 6,
      maxReportBytes: 1024,
      maxTokens: 800,
      broadSearchFileBaseline: 6,
    });

    expect(context.telemetry).toEqual(expect.objectContaining({
      graphQueriesPerRecall: 1,
      graphFreshness: 'fresh',
      graphFallbackReason: null,
      filesAvoidedEstimate: 4,
    }));

    const logs = vault.getRecentLogs(20, { actionType: 'recall' });
    const graphContextLog = logs.find((log) => log.metadata?.recallKind === 'graph_context');

    expect(graphContextLog?.metadata).toMatchObject({
      recallKind: 'graph_context',
      graphTelemetryVersion: 1,
      graphQueriesPerRecall: 1,
      graphFreshness: 'fresh',
      graphFilesAvoidedEstimate: 4,
      graphContextPackTokens: context.budget.estimatedTokens,
      graphEstimatedTokensSaved: context.telemetry.estimatedTokensSaved,
    });
    expect(JSON.stringify(graphContextLog?.metadata)).not.toContain('packages/core/src/secrets/token.ts');
    expect(JSON.stringify(graphContextLog?.metadata)).not.toContain('SECRET_VALUE_SHOULD_NOT_BE_LOGGED');
  });

  it('tracks MCP Graphify recall activity with the MCP source client', async () => {
    seedRecallMemories('The Vault');
    await writeManagedGraphifyArtifacts('The Vault');
    upsertGraphifyState('The Vault', 'fresh');

    await vault.recallWithGraphContext({
      project: 'The Vault',
      queryText: 'Graphify MCP activity tracking',
      keywords: ['graphify', 'activity'],
      limit: 2,
      maxFiles: 2,
      maxGraphNodes: 6,
      maxGraphEdges: 6,
      maxReportBytes: 1024,
      maxTokens: 800,
    }, {
      logActivity: true,
      sourceClient: 'mcp',
      toolName: 'vault_recall_with_graph_context',
    });

    const graphContextLog = vault.getRecentLogs(20, { actionType: 'recall' })
      .find((log) => log.metadata?.recallKind === 'graph_context');

    expect(graphContextLog).toEqual(expect.objectContaining({
      sourceClient: 'mcp',
      project: 'The Vault',
      actionType: 'recall',
    }));
    expect(graphContextLog?.metadata).toEqual(expect.objectContaining({
      toolName: 'vault_recall_with_graph_context',
      graphifyTool: true,
      graphUsed: true,
    }));
  });

  it('records Graphify MCP tool activity without logging graph content', () => {
    vault.recordGraphifyToolActivity({
      sourceClient: 'mcp',
      project: 'The Vault',
      toolName: 'vault_graphify_query',
      actionType: 'recall',
      status: 'success',
      latencyMs: 12,
      message: 'Queried Graphify graph for The Vault',
      metadata: {
        graphOperation: 'query',
        resultStatus: 'available',
        queryPreview: 'SECRET_VALUE_SHOULD_NOT_BE_LOGGED'.repeat(20),
        nodeCount: 2,
      },
    });

    const log = vault.getRecentLogs(5, { actionType: 'recall' })[0];
    expect(log).toEqual(expect.objectContaining({
      sourceClient: 'mcp',
      project: 'The Vault',
      actionType: 'recall',
      status: 'success',
      latencyMs: 12,
      message: 'Queried Graphify graph for The Vault',
    }));
    expect(log.metadata).toEqual(expect.objectContaining({
      graphifyTool: true,
      toolName: 'vault_graphify_query',
      graphOperation: 'query',
      resultStatus: 'available',
      nodeCount: 2,
    }));
    expect(JSON.stringify(log.metadata)).not.toContain('SECRET_VALUE_SHOULD_NOT_BE_LOGGEDSECRET_VALUE_SHOULD_NOT_BE_LOGGED');
  });

  function seedRecallMemories(project: string): void {
    vault.saveMemory({
      title: 'Graphify telemetry routing decision',
      project,
      memoryType: 'decision',
      subject: 'graphify telemetry',
      summary: 'Measure Graphify token savings from graph-guided recall without logging source content.',
      keywords: ['graphify', 'telemetry'],
      tags: ['graphify', 'phase-11'],
      relatedFiles: [
        'packages/core/src/vault.ts',
        'packages/core/src/services/graphify-telemetry.service.ts',
        'packages/core/src/secrets/token.ts',
      ],
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
          summary: 'Vault core facade logs Graphify telemetry.',
        },
        {
          id: 'file:packages/core/src/services/graphify-telemetry.service.ts',
          label: 'graphify-telemetry.service.ts',
          type: 'file',
          path: 'packages/core/src/services/graphify-telemetry.service.ts',
          summary: 'Builds token-savings estimates for Graphify recall.',
        },
        {
          id: 'test:packages/core/src/graphify-telemetry.test.ts',
          label: 'graphify-telemetry.test.ts',
          type: 'test',
          path: 'packages/core/src/graphify-telemetry.test.ts',
          summary: 'Tests Phase 11 telemetry behavior.',
        },
      ],
      edges: [
        {
          source: 'file:packages/core/src/vault.ts',
          target: 'file:packages/core/src/services/graphify-telemetry.service.ts',
          type: 'calls',
          label: 'calls',
        },
        {
          source: 'file:packages/core/src/services/graphify-telemetry.service.ts',
          target: 'test:packages/core/src/graphify-telemetry.test.ts',
          type: 'tested_by',
          label: 'tested by',
        },
      ],
    }), 'utf8');
    await writeFile(paths.graphReport, [
      '# Graph Report',
      '',
      '## Graphify Telemetry',
      'The telemetry helper counts graph queries, files avoided, freshness, and token estimates.',
      'SECRET_VALUE_SHOULD_NOT_BE_LOGGED appears in report content and must not enter activity metadata.',
    ].join('\n'), 'utf8');
  }

  function upsertGraphifyState(
    project: string,
    freshness: 'fresh' | 'stale' | 'failed',
  ): void {
    const paths = getGraphifyProjectPaths(vaultRoot, project);
    vault.upsertGraphifyProjectState({
      project,
      enabled: true,
      sourceRoot,
      freshness,
      buildMode: 'fast',
      latestBuildId: `gb_${freshness}_telemetry`,
      artifactPaths: {
        graphJson: paths.graphJson,
        graphHtml: null,
        graphReport: paths.graphReport,
        graphSvg: null,
      },
      graphStats: {
        nodeCount: 3,
        edgeCount: 2,
        communityCount: 0,
      },
      detectedGraphifyVersion: '0.8.17',
      failureCount: freshness === 'failed' ? 1 : 0,
      lastError: freshness === 'failed' ? 'Graphify failed' : null,
    });
  }
});

function graphRecallResult(overrides: {
  graphUsed?: boolean;
  graphStatus?: GraphifyRecallTelemetryResultInput['graph']['status'];
  graphFreshness?: GraphifyRecallTelemetryResultInput['graph']['freshness'];
  graphFallbackReason?: GraphifyRecallTelemetryResultInput['graph']['fallbackReason'];
  budget: GraphifyRecallTelemetryResultInput['budget'];
}): GraphifyRecallTelemetryResultInput {
  const graphUsed = overrides.graphUsed ?? true;
  return {
    recall: memoryPack(),
    graph: {
      used: graphUsed,
      status: overrides.graphStatus ?? 'available',
      project: 'The Vault',
      freshness: overrides.graphFreshness ?? 'fresh',
      fallbackReason: overrides.graphFallbackReason ?? null,
      warnings: [],
      freshnessWarnings: [],
      query: graphUsed
        ? {
            status: 'available',
            project: 'The Vault',
            freshness: 'fresh',
            fallbackReason: null,
            warnings: [],
            answer: 'Telemetry narrows recall to graph-backed file candidates.',
            nodes: [],
            edges: [],
            suggestedFileReads: [
              'packages/core/src/vault.ts',
              'packages/core/src/services/graphify-telemetry.service.ts',
            ],
            truncated: false,
          }
        : null,
      impact: null,
      likelyRelevantFiles: graphUsed
        ? [
            {
              path: 'packages/core/src/vault.ts',
              nodeId: 'file:packages/core/src/vault.ts',
              label: 'vault.ts',
              reason: 'Logs Graphify telemetry.',
            },
          ]
        : [],
      tests: graphUsed
        ? [
            {
              path: 'packages/core/src/graphify-telemetry.test.ts',
              nodeId: 'test:packages/core/src/graphify-telemetry.test.ts',
              label: 'graphify-telemetry.test.ts',
              reason: 'Tests telemetry.',
            },
          ]
        : [],
      centralNodes: [],
      communities: [],
      shortestPaths: [],
      reportSnippets: graphUsed
        ? [
            {
              source: 'GRAPH_REPORT.md',
              heading: 'Secret-bearing report section',
              text: 'SECRET_VALUE_SHOULD_NOT_BE_LOGGED',
              truncated: false,
            },
          ]
        : [],
      suggestedNextFileReads: graphUsed
        ? [
            'packages/core/src/vault.ts',
            'packages/core/src/services/graphify-telemetry.service.ts',
          ]
        : [],
    },
    suggestedNextFileReads: graphUsed
      ? [
          'packages/core/src/vault.ts',
          'packages/core/src/services/graphify-telemetry.service.ts',
        ]
      : [],
    warnings: [],
    budget: overrides.budget,
  };
}

function memoryPack(): MemoryPack {
  const item = memoryItem();
  return {
    summaries: [],
    decisions: [item],
    plans: [],
    other: [],
    related: [],
    proactive: [],
    topMatches: [{
      item,
      score: 100,
      reasons: ['query words matched subject'],
      signals: {},
    }],
    totalCandidates: 12,
    topScore: 100,
    openLoops: [],
  };
}

function memoryItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 1,
    itemUid: 'vm_graphify_telemetry',
    title: 'Graphify telemetry decision',
    project: 'The Vault',
    sourceApp: 'codex',
    sourceSessionId: null,
    memoryType: 'decision',
    subject: 'graphify telemetry',
    summary: 'Telemetry estimates files avoided and context tokens.',
    content: null,
    keywords: ['graphify', 'telemetry'],
    tags: ['graphify', 'phase-11'],
    routineType: null,
    status: 'active',
    priority: 'normal',
    promoted: false,
    nextSteps: [],
    relatedItemIds: [],
    relatedFiles: [
      'packages/core/src/vault.ts',
      'packages/core/src/services/graphify-telemetry.service.ts',
      'packages/core/src/secrets/token.ts',
    ],
    vaultPath: null,
    createdAt: '2026-05-24T00:00:00.000Z',
    updatedAt: '2026-05-24T00:00:00.000Z',
    lastAccessedAt: null,
    accessCount: 0,
    snoozedUntil: null,
    outcome: null,
    ...overrides,
  };
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
