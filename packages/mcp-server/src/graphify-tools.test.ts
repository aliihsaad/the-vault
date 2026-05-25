import { describe, expect, it } from 'vitest';
import { GRAPHIFY_MCP_TOOL_NAMES, registerGraphifyMcpTools } from './graphify-tools.js';
import type { BuildGraphifyProjectGraphInput, GraphifyProjectBuildResult } from '@the-vault/core';
import type { GraphifyMcpActivityInput, GraphifyMcpVaultLike } from './graphify-tools.js';

describe('Vault MCP Graphify tools', () => {
  it('registers the Phase 8 and Phase 9 Graphify tools additively', () => {
    const server = new FakeMcpServer();
    server.tools.set('vault_save_memory', {
      description: 'existing memory tool',
      schema: {},
      handler: async () => ({ content: [{ type: 'text' as const, text: '{}' }] }),
    });

    registerGraphifyMcpTools(server, makeFakeVault());

    expect(Array.from(server.tools.keys())).toEqual([
      'vault_save_memory',
      'vault_graphify_status',
      'vault_graphify_build_project_graph',
      'vault_graphify_query',
      'vault_graphify_get_node',
      'vault_graphify_get_neighbors',
      'vault_graphify_shortest_path',
      'vault_graphify_explain_impact',
      'vault_recall_with_graph_context',
    ]);
    expect(GRAPHIFY_MCP_TOOL_NAMES).toContain('vault_recall_with_graph_context');
    expect(server.tools.get('vault_save_memory')?.description).toBe('existing memory tool');
  });

  it('formats status, build, query, node, neighbor, path, impact, and recall-with-graph responses as JSON', async () => {
    const server = new FakeMcpServer();
    const fakeVault = makeFakeVault();
    registerGraphifyMcpTools(server, fakeVault);

    const status = await callJson(server, 'vault_graphify_status', { project: 'The Vault' });
    expect(status).toEqual(expect.objectContaining({
      runtime: expect.objectContaining({ runtimeMode: 'managed' }),
      project: expect.objectContaining({
        project: 'The Vault',
        freshness: 'fresh',
      }),
      artifacts: expect.objectContaining({ available: true }),
      build_history: [],
    }));

    const build = await callJson(server, 'vault_graphify_build_project_graph', {
      project: 'The Vault',
      build_mode: 'full',
      build_id: 'gb_mcp_test',
    });
    expect(build).toEqual(expect.objectContaining({
      success: true,
      build: expect.objectContaining({
        buildId: 'gb_mcp_test',
        status: 'fresh',
        buildMode: 'full',
      }),
    }));
    expect(fakeVault.lastBuildInput).toEqual(expect.objectContaining({
      buildId: 'gb_mcp_test',
      buildMode: 'full',
    }));
    expect(typeof fakeVault.lastBuildInput?.commandRunner).toBe('function');

    await expect(callJson(server, 'vault_graphify_query', {
      project: 'Disabled Project',
      query: 'anything',
    })).resolves.toEqual(expect.objectContaining({
      status: 'disabled',
      fallbackReason: 'disabled',
      nodes: [],
      edges: [],
    }));

    await expect(callJson(server, 'vault_graphify_get_node', {
      project: 'The Vault',
      node: 'Vault.buildGraphifyProjectGraph',
    })).resolves.toEqual(expect.objectContaining({
      status: 'available',
      node: expect.objectContaining({ id: 'symbol:Vault.buildGraphifyProjectGraph' }),
    }));

    await expect(callJson(server, 'vault_graphify_get_neighbors', {
      project: 'The Vault',
      node_id: 'symbol:Vault.buildGraphifyProjectGraph',
    })).resolves.toEqual(expect.objectContaining({
      status: 'available',
      nodes: [expect.objectContaining({ id: 'file:packages/core/src/vault.ts' })],
    }));

    await expect(callJson(server, 'vault_graphify_shortest_path', {
      project: 'The Vault',
      from: 'file:packages/core/src/vault.ts',
      to: 'test:packages/core/src/graphify-build.test.ts',
    })).resolves.toEqual(expect.objectContaining({
      status: 'available',
      path: [
        expect.objectContaining({ id: 'file:packages/core/src/vault.ts' }),
        expect.objectContaining({ id: 'symbol:Vault.buildGraphifyProjectGraph' }),
        expect.objectContaining({ id: 'test:packages/core/src/graphify-build.test.ts' }),
      ],
    }));

    await expect(callJson(server, 'vault_graphify_explain_impact', {
      project: 'The Vault',
      query: 'buildGraphifyProjectGraph',
    })).resolves.toEqual(expect.objectContaining({
      status: 'available',
      likelyFiles: [expect.objectContaining({ path: 'packages/core/src/vault.ts' })],
      tests: [expect.objectContaining({ path: 'packages/core/src/graphify-build.test.ts' })],
    }));

    await expect(callJson(server, 'vault_recall_with_graph_context', {
      project: 'The Vault',
      query_text: 'Plan recallWithGraphContext',
      keywords: ['graphify', 'recall'],
      limit: 3,
      max_files: 4,
      max_graph_nodes: 8,
      max_graph_edges: 8,
      max_report_bytes: 1024,
      max_tokens: 900,
    })).resolves.toEqual(expect.objectContaining({
      recall: expect.objectContaining({
        top_matches: [expect.objectContaining({ uid: 'vm_phase9' })],
      }),
      graph: expect.objectContaining({
        used: true,
        fallback_reason: null,
        likely_relevant_files: [expect.objectContaining({ path: 'packages/core/src/vault.ts' })],
      }),
      suggested_next_file_reads: ['packages/core/src/vault.ts'],
    }));
    expect(fakeVault.lastRecallInput).toEqual(expect.objectContaining({
      project: 'The Vault',
      queryText: 'Plan recallWithGraphContext',
      keywords: ['graphify', 'recall'],
      maxFiles: 4,
      maxGraphNodes: 8,
      maxGraphEdges: 8,
      maxReportBytes: 1024,
      maxTokens: 900,
    }));
    expect(fakeVault.lastRecallOptions).toEqual(expect.objectContaining({
      logActivity: true,
      sourceClient: 'mcp',
      toolName: 'vault_recall_with_graph_context',
    }));
  });

  it('records Graphify MCP tool calls as activity', async () => {
    const server = new FakeMcpServer();
    const fakeVault = makeFakeVault();
    registerGraphifyMcpTools(server, fakeVault);

    await callJson(server, 'vault_graphify_status', { project: 'The Vault' });
    await callJson(server, 'vault_graphify_query', {
      project: 'The Vault',
      query: 'packages/mcp-server/src/graphify-tools.ts',
    });
    await callJson(server, 'vault_graphify_build_project_graph', {
      project: 'The Vault',
      build_mode: 'full',
      build_id: 'gb_activity_test',
    });

    expect(fakeVault.activity.map((entry) => entry.toolName)).toEqual([
      'vault_graphify_status',
      'vault_graphify_query',
      'vault_graphify_build_project_graph',
    ]);
    expect(fakeVault.activity.map((entry) => entry.sourceClient)).toEqual(['mcp', 'mcp', 'mcp']);
    expect(fakeVault.activity.map((entry) => entry.project)).toEqual(['The Vault', 'The Vault', 'The Vault']);
    expect(fakeVault.activity.map((entry) => entry.actionType)).toEqual(['recall', 'recall', 'update']);
    expect(fakeVault.activity[1]?.metadata).toEqual(expect.objectContaining({
      graphifyTool: true,
      toolName: 'vault_graphify_query',
      graphOperation: 'query',
      resultStatus: 'available',
      nodeCount: 1,
    }));
    expect(fakeVault.activity[2]?.metadata).toEqual(expect.objectContaining({
      graphifyTool: true,
      toolName: 'vault_graphify_build_project_graph',
      buildId: 'gb_activity_test',
      buildMode: 'full',
      resultStatus: 'fresh',
    }));
  });

  it('compacts graph responses by stripping per-node and per-edge data blobs', async () => {
    const server = new FakeMcpServer();
    registerGraphifyMcpTools(server, makeVerboseFakeVault());

    const query = await callJson(server, 'vault_graphify_query', { project: 'The Vault', query: 'ranking' });
    const nodes = query.nodes as Array<Record<string, unknown>>;
    const edges = query.edges as Array<Record<string, unknown>>;

    expect(nodes[0]).not.toHaveProperty('data');
    expect(nodes[0]).toEqual({ id: 'file:a', label: 'a.ts', type: 'code', path: 'src/a.ts', community: 3, line: 'L1' });
    expect(edges[0]).not.toHaveProperty('data');
    expect(edges[0]).toEqual({ source: 'file:a', target: 'file:b', relation: 'imports_from', line: 'L7' });
    // Status passthrough fields and counts are preserved for activity metadata.
    expect(query.status).toBe('available');
    expect(query.suggestedFileReads).toEqual(['src/a.ts']);
  });

  it('compacts recall-with-graph context to stay within a token budget', async () => {
    const server = new FakeMcpServer();
    registerGraphifyMcpTools(server, makeVerboseFakeVault());

    const recall = await callJson(server, 'vault_recall_with_graph_context', { project: 'The Vault' });
    const graph = recall.graph as Record<string, unknown>;
    const pack = recall.recall as Record<string, unknown>;
    const topMatches = pack.top_matches as Array<Record<string, unknown>>;

    // Redundant full graph objects are dropped.
    expect(graph).not.toHaveProperty('query');
    expect(graph).not.toHaveProperty('impact');
    // Central nodes are compacted (no raw data blob).
    expect((graph.central_nodes as Array<Record<string, unknown>>)[0]).not.toHaveProperty('data');

    // Buckets are capped and low-signal buckets become counts.
    expect(topMatches.length).toBe(5);
    expect(pack).not.toHaveProperty('related');
    expect(pack.bucket_counts).toEqual(expect.objectContaining({ related: 6, other: 4 }));

    // Items are trimmed and summaries truncated.
    const first = topMatches[0];
    expect(first).not.toHaveProperty('keywords');
    expect(first).not.toHaveProperty('related_files');
    expect(first.uid).toBe('vm_0');
    expect((first.summary as string).length).toBeLessThanOrEqual(220);
    expect((first.summary as string).endsWith('…')).toBe(true);

    // The whole serialized response is dramatically smaller than the raw pack.
    expect(JSON.stringify(recall).length).toBeLessThan(6000);
  });
});

class FakeMcpServer {
  readonly tools = new Map<string, {
    description: string;
    schema: unknown;
    handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  }>();

  tool(
    name: string,
    description: string,
    schema: unknown,
    handler: (args: Record<string, unknown>) => Promise<unknown> | unknown,
  ): void {
    this.tools.set(name, { description, schema, handler });
  }
}

async function callJson(
  server: FakeMcpServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tool = server.tools.get(toolName);
  if (!tool) {
    throw new Error(`Tool not registered: ${toolName}`);
  }

  const result = await tool.handler(args) as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

type FakeGraphifyMcpVault = GraphifyMcpVaultLike & {
  lastBuildInput: Record<string, unknown> | null;
  lastRecallInput: Record<string, unknown> | null;
  lastRecallOptions: Record<string, unknown> | null;
  activity: GraphifyMcpActivityInput[];
  recallWithGraphContext(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
};

function makeFakeVault(): FakeGraphifyMcpVault {
  return {
    lastBuildInput: null as Record<string, unknown> | null,
    lastRecallInput: null as Record<string, unknown> | null,
    lastRecallOptions: null as Record<string, unknown> | null,
    activity: [] as GraphifyMcpActivityInput[],
    recordGraphifyToolActivity(input: GraphifyMcpActivityInput): void {
      this.activity.push(input);
    },
    getGraphifyRuntimeConfig: () => ({
      runtimeMode: 'managed',
      managedRuntimePath: 'C:/Vault/extensions/graphify/runtime',
      customExecutablePath: null,
      localSourceCheckoutPath: null,
      installProfile: 'base',
      installExtras: [],
      debounce: {
        autoBuildDelayMs: 60000,
        maxCoalesceDelayMs: 180000,
      },
      semantic: {
        enabled: false,
        provider: null,
        allowExternalProviders: false,
      },
    }),
    getGraphifyProjectStatus: (project: string) => ({
      project,
      enabled: project !== 'Disabled Project',
      sourceRoot: project === 'Disabled Project' ? null : 'C:/Users/Mini/Desktop/Projects/the-vault',
      sourceRootCandidate: null,
      freshness: project === 'Disabled Project' ? 'disabled' : 'fresh',
      buildMode: 'fast',
      buildEligible: project !== 'Disabled Project',
      buildBlockedReason: project === 'Disabled Project' ? 'disabled' : null,
      uiState: project === 'Disabled Project' ? 'disabled' : 'ready',
      message: project === 'Disabled Project'
        ? 'Graphify is disabled for this project. Vault memory remains available.'
        : 'Graphify source root is configured.',
      state: null,
    }),
    getGraphifyArtifacts: () => ({
      available: true,
      artifactRoot: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out',
      artifactPaths: {
        graphJson: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.json',
        graphHtml: null,
        graphReport: null,
        graphSvg: null,
      },
      graphStats: {
        nodeCount: 2,
        edgeCount: 1,
        communityCount: 1,
      },
      missingRequired: [],
      errorMessage: null,
    }),
    getGraphifyBuildHistory: () => [],
    buildGraphifyProjectGraph(project: string, input: Omit<BuildGraphifyProjectGraphInput, 'project'>): Promise<GraphifyProjectBuildResult> {
      this.lastBuildInput = input as Record<string, unknown>;
      return Promise.resolve({
        buildId: input.buildId ?? 'gb_mcp_test',
        project,
        status: 'fresh' as const,
        buildMode: input.buildMode ?? 'fast',
        startedAt: '2026-05-24T20:00:00.000Z',
        completedAt: '2026-05-24T20:00:01.000Z',
        command: 'graphify',
        args: [],
        logPath: 'C:/Vault/extensions/graphify/projects/the-vault/logs/gb_mcp_test.log',
        artifactPaths: {
          graphJson: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.json',
          graphHtml: null,
          graphReport: null,
          graphSvg: null,
        },
        graphStats: {
          nodeCount: 2,
          edgeCount: 1,
          communityCount: 1,
        },
        errorMessage: null,
      });
    },
    queryGraphifyProjectGraph: (project: string) => project === 'Disabled Project'
      ? {
          status: 'disabled',
          project,
          freshness: 'disabled',
          fallbackReason: 'disabled',
          warnings: ['Graphify is disabled for this project. Vault memory remains available.'],
          answer: null,
          nodes: [],
          edges: [],
          suggestedFileReads: [],
          truncated: false,
        }
      : {
          status: 'available',
          project,
          freshness: 'fresh',
          fallbackReason: null,
          warnings: [],
          answer: 'Found 2 related graph nodes.',
          nodes: [{ id: 'symbol:Vault.buildGraphifyProjectGraph' }],
          edges: [],
          suggestedFileReads: ['packages/core/src/vault.ts'],
          truncated: false,
        },
    getGraphifyNode: () => ({
      status: 'available',
      project: 'The Vault',
      freshness: 'fresh',
      fallbackReason: null,
      warnings: [],
      node: { id: 'symbol:Vault.buildGraphifyProjectGraph' },
      neighbors: [],
      edges: [],
    }),
    getGraphifyNeighbors: () => ({
      status: 'available',
      project: 'The Vault',
      freshness: 'fresh',
      fallbackReason: null,
      warnings: [],
      nodes: [{ id: 'file:packages/core/src/vault.ts' }],
      edges: [],
      truncated: false,
    }),
    getGraphifyShortestPath: () => ({
      status: 'available',
      project: 'The Vault',
      freshness: 'fresh',
      fallbackReason: null,
      warnings: [],
      path: [
        { id: 'file:packages/core/src/vault.ts' },
        { id: 'symbol:Vault.buildGraphifyProjectGraph' },
        { id: 'test:packages/core/src/graphify-build.test.ts' },
      ],
      edges: [],
      found: true,
    }),
    explainGraphifyImpact: () => ({
      status: 'available',
      project: 'The Vault',
      freshness: 'fresh',
      fallbackReason: null,
      warnings: [],
      likelyFiles: [{ path: 'packages/core/src/vault.ts' }],
      tests: [{ path: 'packages/core/src/graphify-build.test.ts' }],
      centralNodes: [{ id: 'symbol:Vault.buildGraphifyProjectGraph' }],
      caveats: [],
    }),
    recallWithGraphContext(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<Record<string, unknown>> {
      this.lastRecallInput = input;
      this.lastRecallOptions = options ?? null;
      return Promise.resolve({
        recall: {
          topMatches: [{
            item: {
              itemUid: 'vm_phase9',
              title: 'Phase 9 recall context',
              project: 'The Vault',
              memoryType: 'session',
              subject: 'vault_recall_with_graph_context',
              summary: 'Combined Vault recall with Graphify context.',
              status: 'active',
              priority: 'high',
              promoted: false,
              tags: ['graphify'],
              createdAt: '2026-05-24T20:00:00.000Z',
            },
            score: 42,
            reasons: ['query matched summary'],
          }],
          totalCandidates: 1,
          topScore: 42,
          contextSummary: null,
          related: [],
          proactive: [],
          summaries: [],
          decisions: [],
          plans: [],
          other: [],
          openLoops: [],
        },
        graph: {
          used: true,
          status: 'available',
          fallbackReason: null,
          freshness: 'fresh',
          warnings: [],
          freshnessWarnings: [],
          query: null,
          impact: null,
          likelyRelevantFiles: [{ path: 'packages/core/src/vault.ts' }],
          tests: [],
          centralNodes: [],
          communities: [],
          shortestPaths: [],
          reportSnippets: [],
          suggestedNextFileReads: ['packages/core/src/vault.ts'],
        },
        suggestedNextFileReads: ['packages/core/src/vault.ts'],
        warnings: [],
        budget: {
          maxTokens: 900,
          estimatedTokens: 120,
          truncated: false,
        },
      });
    },
  };
}

function makeVerboseFakeVault(): FakeGraphifyMcpVault {
  const base = makeFakeVault();
  const longSummary = 'lorem ipsum dolor sit amet consectetur '.repeat(30);
  const makeItem = (i: number) => ({
    itemUid: `vm_${i}`,
    title: `Match ${i}`,
    project: 'The Vault',
    memoryType: 'session',
    subject: `Subject ${i}`,
    summary: longSummary,
    status: 'active',
    priority: 'normal',
    promoted: false,
    tags: ['tag'],
    keywords: ['k1', 'k2'],
    relatedFiles: ['src/a.ts'],
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  base.queryGraphifyProjectGraph = () => ({
    status: 'available',
    project: 'The Vault',
    freshness: 'fresh',
    fallbackReason: null,
    warnings: [],
    answer: 'Found graph nodes.',
    nodes: [{
      id: 'file:a',
      label: 'a.ts',
      type: 'code',
      path: 'src/a.ts',
      summary: null,
      data: { label: 'a.ts', file_type: 'code', source_file: 'source/src/a.ts', source_location: 'L1', id: 'file:a', community: 3, norm_label: 'a.ts' },
    }],
    edges: [{
      id: 'file:a->file:b:7',
      source: 'file:a',
      target: 'file:b',
      label: 'imports_from',
      type: 'imports_from',
      data: { relation: 'imports_from', context: 'import', confidence: 'EXTRACTED', source_file: 'source/src/a.ts', source_location: 'L7', weight: 1, source: 'file:a', target: 'file:b', confidence_score: 1 },
    }],
    suggestedFileReads: ['src/a.ts'],
    truncated: false,
  });

  base.recallWithGraphContext = (input: Record<string, unknown>, options?: Record<string, unknown>) => {
    base.lastRecallInput = input;
    base.lastRecallOptions = options ?? null;
    return Promise.resolve({
      recall: {
        topMatches: Array.from({ length: 12 }, (_, i) => ({ item: makeItem(i), score: 100 - i, reasons: ['matched summary'] })),
        totalCandidates: 60,
        topScore: 100,
        contextSummary: longSummary,
        related: Array.from({ length: 6 }, (_, i) => makeItem(100 + i)),
        proactive: Array.from({ length: 2 }, (_, i) => makeItem(200 + i)),
        summaries: Array.from({ length: 2 }, (_, i) => makeItem(300 + i)),
        decisions: Array.from({ length: 2 }, (_, i) => makeItem(400 + i)),
        plans: Array.from({ length: 2 }, (_, i) => makeItem(500 + i)),
        other: Array.from({ length: 4 }, (_, i) => makeItem(600 + i)),
        openLoops: [],
      },
      graph: {
        used: true,
        status: 'available',
        fallbackReason: null,
        freshness: 'fresh',
        warnings: [],
        freshnessWarnings: [],
        query: { status: 'available', nodes: [{ id: 'file:a', data: { community: 3, norm_label: 'a.ts' } }], edges: [] },
        impact: { status: 'available', likelyFiles: [{ path: 'src/a.ts' }], centralNodes: [{ id: 'sym:x', data: { community: 1 } }] },
        likelyRelevantFiles: [{ path: 'src/a.ts', nodeId: 'file:a', label: 'a.ts', reason: 'matched' }],
        tests: [],
        centralNodes: [{
          id: 'sym:x',
          label: 'x',
          type: 'code',
          path: 'src/a.ts',
          summary: null,
          data: { community: 1, source_location: 'L9', norm_label: 'x' },
        }],
        communities: [],
        shortestPaths: [],
        reportSnippets: [],
        suggestedNextFileReads: ['src/a.ts'],
      },
      suggestedNextFileReads: ['src/a.ts'],
      warnings: [],
      budget: { maxTokens: 1200, estimatedTokens: 1200, truncated: true },
    });
  };

  return base;
}
