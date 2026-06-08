import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Vault } from './index.js';
import { getGraphifyProjectPaths } from './services/graphify-paths.service.js';

describe('Graphify graph query context', () => {
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
    vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-query-'));
    sourceRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-query-source-'));
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

  it('returns budgeted graph query, node, neighbor, path, and impact context from managed graph.json', async () => {
    const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
    await writeManagedGraph(paths.graphJson);
    vault.upsertGraphifyProjectState({
      project: 'The Vault',
      enabled: true,
      sourceRoot,
      freshness: 'stale',
      buildMode: 'fast',
      latestBuildId: 'gb_query_context',
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

    const query = vault.queryGraphifyProjectGraph('The Vault', {
      query: 'buildGraphifyProjectGraph',
      maxNodes: 2,
      maxEdges: 2,
    });
    expect(query).toEqual(expect.objectContaining({
      status: 'available',
      project: 'The Vault',
      freshness: 'stale',
      fallbackReason: null,
      truncated: true,
    }));
    expect(query.warnings).toContain('Graphify graph is stale; using the last available graph.');
    expect(query.nodes.map((node) => node.id)).toEqual([
      'symbol:Vault.buildGraphifyProjectGraph',
      'file:packages/core/src/vault.ts',
    ]);
    expect(query.edges).toHaveLength(2);
    expect(query.suggestedFileReads).toContain('packages/core/src/vault.ts');

    const node = vault.getGraphifyNode('The Vault', {
      node: 'Vault.buildGraphifyProjectGraph',
      maxNeighbors: 2,
    });
    expect(node.status).toBe('available');
    expect(node.node?.id).toBe('symbol:Vault.buildGraphifyProjectGraph');
    expect(node.neighbors.map((neighbor) => neighbor.id)).toEqual([
      'file:packages/core/src/vault.ts',
      'test:packages/core/src/graphify-build.test.ts',
    ]);

    const neighbors = vault.getGraphifyNeighbors('The Vault', {
      nodeId: 'symbol:Vault.buildGraphifyProjectGraph',
      depth: 1,
      maxNodes: 2,
      maxEdges: 2,
    });
    expect(neighbors.status).toBe('available');
    expect(neighbors.nodes.map((neighbor) => neighbor.id)).toEqual([
      'file:packages/core/src/vault.ts',
      'test:packages/core/src/graphify-build.test.ts',
    ]);
    expect(neighbors.edges).toHaveLength(2);

    const shortestPath = vault.getGraphifyShortestPath('The Vault', {
      from: 'file:packages/core/src/vault.ts',
      to: 'test:packages/core/src/graphify-build.test.ts',
      maxDepth: 4,
    });
    expect(shortestPath.status).toBe('available');
    expect(shortestPath.path.map((pathNode) => pathNode.id)).toEqual([
      'file:packages/core/src/vault.ts',
      'symbol:Vault.buildGraphifyProjectGraph',
      'test:packages/core/src/graphify-build.test.ts',
    ]);

    const impact = vault.explainGraphifyImpact('The Vault', {
      query: 'buildGraphifyProjectGraph',
      maxFiles: 4,
    });
    expect(impact.status).toBe('available');
    expect(impact.likelyFiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'packages/core/src/vault.ts' }),
    ]));
    expect(impact.tests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'packages/core/src/graphify-build.test.ts' }),
    ]));
    expect(impact.centralNodes.map((centralNode) => centralNode.id)).toContain('symbol:Vault.buildGraphifyProjectGraph');
    expect(impact.caveats).toContain('Graphify graph is stale; using the last available graph.');
  });

  it('returns typed fallbacks when Graphify is disabled or graph artifacts are missing', () => {
    vault.upsertGraphifyProjectState({
      project: 'The Vault',
      enabled: false,
      sourceRoot,
      freshness: 'disabled',
      buildMode: 'fast',
      latestBuildId: null,
      artifactPaths: null,
      graphStats: null,
      detectedGraphifyVersion: null,
      failureCount: 0,
      lastError: null,
    });

    expect(vault.queryGraphifyProjectGraph('The Vault', { query: 'anything' })).toEqual(expect.objectContaining({
      status: 'disabled',
      fallbackReason: 'disabled',
      answer: null,
      nodes: [],
      edges: [],
    }));

    vault.upsertGraphifyProjectState({
      project: 'Missing Graph',
      enabled: true,
      sourceRoot,
      freshness: 'missing',
      buildMode: 'fast',
      latestBuildId: null,
      artifactPaths: null,
      graphStats: null,
      detectedGraphifyVersion: null,
      failureCount: 0,
      lastError: null,
    });

    expect(vault.getGraphifyNode('Missing Graph', { node: 'Vault' })).toEqual(expect.objectContaining({
      status: 'missing',
      fallbackReason: 'missing',
      node: null,
      neighbors: [],
    }));
  });

  it('normalizes Graphify source_file paths for lookup and query ranking', async () => {
    const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
    await writeGraphifySourceFileGraph(paths.graphJson);
    vault.upsertGraphifyProjectState({
      project: 'The Vault',
      enabled: true,
      sourceRoot,
      freshness: 'fresh',
      buildMode: 'fast',
      latestBuildId: 'gb_source_file_context',
      artifactPaths: {
        graphJson: paths.graphJson,
        graphHtml: null,
        graphReport: paths.graphReport,
        graphSvg: null,
      },
      graphStats: {
        nodeCount: 4,
        edgeCount: 2,
        communityCount: 1,
      },
      detectedGraphifyVersion: '0.8.18',
      failureCount: 0,
      lastError: null,
    });

    const pathQuery = vault.queryGraphifyProjectGraph('The Vault', {
      query: 'packages/mcp-server/src/graphify-tools.ts',
      maxNodes: 3,
      maxEdges: 3,
    });
    expect(pathQuery.status).toBe('available');
    expect(pathQuery.nodes[0]).toEqual(expect.objectContaining({
      id: 'source_packages_mcp_server_src_graphify_tools_ts',
      path: 'packages/mcp-server/src/graphify-tools.ts',
    }));
    expect(pathQuery.suggestedFileReads).toContain('packages/mcp-server/src/graphify-tools.ts');
    expect(pathQuery.suggestedFileReads).not.toContain('source/packages/mcp-server/src/graphify-tools.ts');

    const naturalQuery = vault.queryGraphifyProjectGraph('The Vault', {
      query: 'where is registerGraphifyMcpTools in graphify tools',
      maxNodes: 3,
      maxEdges: 3,
    });
    expect(naturalQuery.nodes.map((node) => node.id)).toContain('src_graphify_tools_registergraphifymcptools');
    expect(naturalQuery.nodes[0]?.id).not.toBe('source_package_json');

    const node = vault.getGraphifyNode('The Vault', {
      node: 'packages/mcp-server/src/graphify-tools.ts',
    });
    expect(node.status).toBe('available');
    expect(node.node).toEqual(expect.objectContaining({
      id: 'source_packages_mcp_server_src_graphify_tools_ts',
      path: 'packages/mcp-server/src/graphify-tools.ts',
    }));

    const impact = vault.explainGraphifyImpact('The Vault', {
      query: 'packages/mcp-server/src/graphify-tools.ts',
      maxFiles: 3,
    });
    expect(impact.status).toBe('available');
    expect(impact.likelyFiles[0]).toEqual(expect.objectContaining({
      path: 'packages/mcp-server/src/graphify-tools.ts',
    }));
  });

  it('reads normal Graphify graph artifacts within the default query budget', async () => {
    const paths = getGraphifyProjectPaths(vaultRoot, 'Large Graph');
    await writeLargeGraphifyGraph(paths.graphJson);
    vault.upsertGraphifyProjectState({
      project: 'Large Graph',
      enabled: true,
      sourceRoot,
      freshness: 'fresh',
      buildMode: 'fast',
      latestBuildId: 'gb_large_graph_context',
      artifactPaths: {
        graphJson: paths.graphJson,
        graphHtml: null,
        graphReport: paths.graphReport,
        graphSvg: null,
      },
      graphStats: {
        nodeCount: 450,
        edgeCount: 0,
        communityCount: 0,
      },
      detectedGraphifyVersion: '0.8.18',
      failureCount: 0,
      lastError: null,
    });

    const query = vault.queryGraphifyProjectGraph('Large Graph', {
      query: 'target-node',
      maxNodes: 2,
      maxEdges: 1,
    });

    expect(query.status).toBe('available');
    expect(query.fallbackReason).toBeNull();
    expect(query.nodes[0]).toEqual(expect.objectContaining({
      label: 'target-node.ts',
      path: 'packages/core/src/target-node.ts',
    }));
  });
});

async function writeManagedGraph(graphJsonPath: string): Promise<void> {
  await mkdir(join(graphJsonPath, '..'), { recursive: true });
  await writeFile(graphJsonPath, JSON.stringify({
    nodes: [
      {
        id: 'file:packages/core/src/vault.ts',
        label: 'packages/core/src/vault.ts',
        type: 'file',
        path: 'packages/core/src/vault.ts',
        summary: 'Vault core facade exposes Graphify build APIs.',
      },
      {
        id: 'symbol:Vault.buildGraphifyProjectGraph',
        label: 'Vault.buildGraphifyProjectGraph',
        type: 'symbol',
        path: 'packages/core/src/vault.ts',
        summary: 'Thin wrapper around the Graphify build service.',
      },
      {
        id: 'test:packages/core/src/graphify-build.test.ts',
        label: 'graphify-build.test.ts',
        type: 'test',
        path: 'packages/core/src/graphify-build.test.ts',
        summary: 'Tests manual Graphify build behavior.',
      },
      {
        id: 'file:packages/core/src/services/graphify-build.service.ts',
        label: 'graphify-build.service.ts',
        type: 'file',
        path: 'packages/core/src/services/graphify-build.service.ts',
      },
      {
        id: 'community:graphify-core',
        label: 'Graphify Core',
        type: 'community',
      },
    ],
    edges: [
      {
        source: 'file:packages/core/src/vault.ts',
        target: 'symbol:Vault.buildGraphifyProjectGraph',
        type: 'exports',
        label: 'exports',
      },
      {
        source: 'symbol:Vault.buildGraphifyProjectGraph',
        target: 'test:packages/core/src/graphify-build.test.ts',
        type: 'tested_by',
        label: 'tested by',
      },
      {
        source: 'symbol:Vault.buildGraphifyProjectGraph',
        target: 'file:packages/core/src/services/graphify-build.service.ts',
        type: 'calls',
        label: 'calls',
      },
      {
        source: 'community:graphify-core',
        target: 'symbol:Vault.buildGraphifyProjectGraph',
        type: 'contains',
        label: 'contains',
      },
    ],
    communities: [{ id: 'graphify-core', label: 'Graphify Core' }],
  }), 'utf8');
}

async function writeGraphifySourceFileGraph(graphJsonPath: string): Promise<void> {
  await mkdir(join(graphJsonPath, '..'), { recursive: true });
  await writeFile(graphJsonPath, JSON.stringify({
    directed: true,
    multigraph: false,
    graph: {},
    nodes: [
      {
        label: 'package.json',
        file_type: 'code',
        source_file: 'source/package.json',
        source_location: 'L1',
        id: 'source_package_json',
        norm_label: 'package.json',
      },
      {
        label: 'graphify-tools.ts',
        file_type: 'code',
        source_file: 'source/packages/mcp-server/src/graphify-tools.ts',
        source_location: 'L1',
        id: 'source_packages_mcp_server_src_graphify_tools_ts',
        norm_label: 'graphify-tools.ts',
      },
      {
        label: 'registerGraphifyMcpTools()',
        file_type: 'code',
        source_file: 'source/packages/mcp-server/src/graphify-tools.ts',
        source_location: 'L90',
        id: 'src_graphify_tools_registergraphifymcptools',
        norm_label: 'registergraphifymcptools()',
      },
      {
        label: 'graphify-tools.test.ts',
        file_type: 'code',
        source_file: 'source/packages/mcp-server/src/graphify-tools.test.ts',
        source_location: 'L1',
        id: 'source_packages_mcp_server_src_graphify_tools_test_ts',
        norm_label: 'graphify-tools.test.ts',
      },
    ],
    links: [
      {
        relation: 'contains',
        source_file: 'source/packages/mcp-server/src/graphify-tools.ts',
        source_location: 'L90',
        source: 'source_packages_mcp_server_src_graphify_tools_ts',
        target: 'src_graphify_tools_registergraphifymcptools',
      },
      {
        relation: 'tested_by',
        source_file: 'source/packages/mcp-server/src/graphify-tools.test.ts',
        source_location: 'L1',
        source: 'src_graphify_tools_registergraphifymcptools',
        target: 'source_packages_mcp_server_src_graphify_tools_test_ts',
      },
    ],
  }), 'utf8');
}

async function writeLargeGraphifyGraph(graphJsonPath: string): Promise<void> {
  await mkdir(join(graphJsonPath, '..'), { recursive: true });
  const filler = 'x'.repeat(900);
  const nodes = Array.from({ length: 450 }, (_, index) => ({
    label: index === 449 ? 'target-node.ts' : `generated-${index}.ts`,
    file_type: 'code',
    source_file: index === 449
      ? 'source/packages/core/src/target-node.ts'
      : `source/packages/generated/generated-${index}.ts`,
    source_location: 'L1',
    id: index === 449 ? 'source_packages_core_src_target_node_ts' : `source_packages_generated_generated_${index}_ts`,
    norm_label: index === 449 ? 'target-node.ts' : `generated-${index}.ts`,
    summary: filler,
  }));
  await writeFile(graphJsonPath, JSON.stringify({
    directed: true,
    multigraph: false,
    graph: {},
    nodes,
    links: [],
  }), 'utf8');
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
