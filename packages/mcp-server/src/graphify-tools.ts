import { spawn } from 'node:child_process';
import { z } from 'zod';
import type {
  BuildGraphifyProjectGraphInput,
  GraphifyBuildProcessRunner,
  GraphifyProjectBuildResult,
  GraphifyRecallContextResult,
} from '@the-vault/core';

export const GRAPHIFY_MCP_TOOL_NAMES = [
  'vault_graphify_status',
  'vault_graphify_build_project_graph',
  'vault_graphify_query',
  'vault_graphify_get_node',
  'vault_graphify_get_neighbors',
  'vault_graphify_shortest_path',
  'vault_graphify_explain_impact',
  'vault_recall_with_graph_context',
] as const;

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;
type ToolRegistrar = (
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>,
  handler: ToolHandler,
) => void;

export type GraphifyMcpServerLike = object;

export interface GraphifyMcpVaultLike {
  recordGraphifyToolActivity?(input: GraphifyMcpActivityInput): void;
  getGraphifyRuntimeConfig(): unknown;
  getGraphifyProjectStatus(project: string): unknown;
  getGraphifyArtifacts(project: string): unknown;
  getGraphifyBuildHistory(project: string, limit?: number): unknown;
  buildGraphifyProjectGraph(
    project: string,
    input: Omit<BuildGraphifyProjectGraphInput, 'project'>,
  ): Promise<GraphifyProjectBuildResult>;
  queryGraphifyProjectGraph(project: string, input: {
    query: string;
    maxNodes?: number;
    maxEdges?: number;
    maxBytes?: number;
  }): unknown;
  getGraphifyNode(project: string, input: {
    node: string;
    maxNeighbors?: number;
    maxBytes?: number;
  }): unknown;
  getGraphifyNeighbors(project: string, input: {
    nodeId: string;
    depth?: number;
    maxNodes?: number;
    maxEdges?: number;
    maxBytes?: number;
  }): unknown;
  getGraphifyShortestPath(project: string, input: {
    from: string;
    to: string;
    maxDepth?: number;
    maxBytes?: number;
  }): unknown;
  explainGraphifyImpact(project: string, input: {
    query: string;
    maxFiles?: number;
    maxNodes?: number;
    maxBytes?: number;
  }): unknown;
  recallWithGraphContext(input: {
    project: string;
    subject?: string;
    keywords?: string[];
    tags?: string[];
    queryText?: string;
    limit?: number;
    maxTokens?: number;
    maxFiles?: number;
    maxGraphNodes?: number;
    maxGraphEdges?: number;
    maxReportBytes?: number;
    maxGraphBytes?: number;
  }, options?: {
    logActivity?: boolean;
    sourceClient?: string;
    toolName?: string;
  }): Promise<unknown>;
}

export interface RegisterGraphifyMcpToolsOptions {
  buildRunner?: GraphifyBuildProcessRunner;
}

export interface GraphifyMcpActivityInput {
  sourceClient?: string;
  project?: string;
  toolName: string;
  actionType?: 'recall' | 'update' | 'error';
  status?: string;
  latencyMs?: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

export function registerGraphifyMcpTools(
  server: GraphifyMcpServerLike,
  vault: GraphifyMcpVaultLike,
  options: RegisterGraphifyMcpToolsOptions = {},
): void {
  const registerTool = getToolRegistrar(server);
  const buildRunner = options.buildRunner ?? runGraphifyBuildProcess;

  registerTool(
    'vault_graphify_status',
    'Report Graphify runtime configuration and, when a project is provided, per-project graph state, artifacts, and recent build history.',
    {
      project: z.string().optional().describe('Project name to inspect'),
      history_limit: z.number().optional().describe('Max build history rows when project is provided (default: 5)'),
    },
    async (args) => {
      const project = readOptionalString(args.project);
      return jsonResult(() => ({
          runtime: vault.getGraphifyRuntimeConfig(),
          project: project ? vault.getGraphifyProjectStatus(project) : null,
          artifacts: project ? vault.getGraphifyArtifacts(project) : null,
          build_history: project ? vault.getGraphifyBuildHistory(project, readOptionalNumber(args.history_limit) ?? 5) : [],
        }), {
          vault,
          toolName: 'vault_graphify_status',
          project,
          actionType: 'recall',
          message: () => project ? `Checked Graphify status for ${project}` : 'Checked Graphify runtime status',
          metadata: (value) => {
            const result = value as {
              runtime?: { runtimeMode?: unknown };
              project?: { freshness?: unknown };
              artifacts?: { available?: unknown };
              build_history?: unknown[];
            };
            return {
              graphOperation: 'status',
              runtimeMode: result.runtime?.runtimeMode,
              projectFreshness: result.project?.freshness,
              artifactAvailable: result.artifacts?.available ?? null,
              buildHistoryCount: Array.isArray(result.build_history) ? result.build_history.length : 0,
            };
          },
        });
    },
  );

  registerTool(
    'vault_graphify_build_project_graph',
    'Run a Graphify build for a Vault project through the Vault-managed build pipeline and return the resulting build status.',
    {
      project: z.string().describe('Project name'),
      build_id: z.string().optional().describe('Optional deterministic build id for tests or manual correlation'),
      build_mode: z.enum(['fast', 'full', 'semantic']).optional().describe('Graphify build mode (default: project setting)'),
      graphify_command: z.string().optional().describe('Optional graphify executable path or command'),
    },
    async (args) => {
      const projectForActivity = readOptionalString(args.project);
      return jsonResult(async () => {
      const project = readRequiredString(args.project, 'project');
      const build = await vault.buildGraphifyProjectGraph(project, {
        commandRunner: buildRunner,
        buildId: readOptionalString(args.build_id),
        buildMode: readOptionalBuildMode(args.build_mode),
        graphifyCommand: readOptionalString(args.graphify_command),
      });
      return {
        success: build.status === 'fresh',
        build,
      };
    }, {
      vault,
      toolName: 'vault_graphify_build_project_graph',
      project: projectForActivity,
      actionType: 'update',
      message: () => projectForActivity ? `Built Graphify graph for ${projectForActivity}` : 'Built Graphify graph',
      metadata: (value) => {
        const result = value as { build?: GraphifyProjectBuildResult };
        return {
          graphOperation: 'build',
          resultStatus: result.build?.status,
          buildId: result.build?.buildId,
          buildMode: result.build?.buildMode,
          nodeCount: result.build?.graphStats?.nodeCount ?? null,
          edgeCount: result.build?.graphStats?.edgeCount ?? null,
        };
      },
    });
    },
  );

  registerTool(
    'vault_graphify_query',
    'Query the latest managed Graphify graph artifact for a project and return budgeted graph context with freshness warnings.',
    {
      project: z.string().describe('Project name'),
      query: z.string().describe('Graph search question or symbol/file text'),
      max_nodes: z.number().optional().describe('Maximum graph nodes to return'),
      max_edges: z.number().optional().describe('Maximum graph edges to return'),
      max_bytes: z.number().optional().describe('Maximum graph.json bytes to read'),
    },
    async (args) => graphJsonResult(() => vault.queryGraphifyProjectGraph(
        readRequiredString(args.project, 'project'),
        {
          query: readRequiredString(args.query, 'query'),
          maxNodes: readOptionalNumber(args.max_nodes),
          maxEdges: readOptionalNumber(args.max_edges),
          maxBytes: readOptionalNumber(args.max_bytes),
        },
      ), {
        vault,
        toolName: 'vault_graphify_query',
        project: readOptionalString(args.project),
        actionType: 'recall',
        message: () => `Queried Graphify graph for ${readOptionalString(args.project) ?? 'project'}`,
        metadata: (value) => graphQueryActivityMetadata(value, 'query', {
          queryPreview: readOptionalString(args.query),
        }),
      }),
  );

  registerTool(
    'vault_graphify_get_node',
    'Fetch a Graphify node by id, label, or path plus budgeted direct neighbor context.',
    {
      project: z.string().describe('Project name'),
      node: z.string().describe('Node id, label, or path'),
      max_neighbors: z.number().optional().describe('Maximum direct neighbors to return'),
      max_bytes: z.number().optional().describe('Maximum graph.json bytes to read'),
    },
    async (args) => graphJsonResult(() => vault.getGraphifyNode(
        readRequiredString(args.project, 'project'),
        {
          node: readRequiredString(args.node, 'node'),
          maxNeighbors: readOptionalNumber(args.max_neighbors),
          maxBytes: readOptionalNumber(args.max_bytes),
        },
      ), {
        vault,
        toolName: 'vault_graphify_get_node',
        project: readOptionalString(args.project),
        actionType: 'recall',
        message: () => `Fetched Graphify node for ${readOptionalString(args.project) ?? 'project'}`,
        metadata: (value) => graphQueryActivityMetadata(value, 'get_node', {
          nodeRef: readOptionalString(args.node),
        }),
      }),
  );

  registerTool(
    'vault_graphify_get_neighbors',
    'Fetch budgeted Graphify neighbor context for a node.',
    {
      project: z.string().describe('Project name'),
      node_id: z.string().describe('Node id, label, or path'),
      depth: z.number().optional().describe('Neighbor traversal depth (default: 1)'),
      max_nodes: z.number().optional().describe('Maximum neighbor nodes to return'),
      max_edges: z.number().optional().describe('Maximum neighbor edges to return'),
      max_bytes: z.number().optional().describe('Maximum graph.json bytes to read'),
    },
    async (args) => graphJsonResult(() => vault.getGraphifyNeighbors(
        readRequiredString(args.project, 'project'),
        {
          nodeId: readRequiredString(args.node_id, 'node_id'),
          depth: readOptionalNumber(args.depth),
          maxNodes: readOptionalNumber(args.max_nodes),
          maxEdges: readOptionalNumber(args.max_edges),
          maxBytes: readOptionalNumber(args.max_bytes),
        },
      ), {
        vault,
        toolName: 'vault_graphify_get_neighbors',
        project: readOptionalString(args.project),
        actionType: 'recall',
        message: () => `Fetched Graphify neighbors for ${readOptionalString(args.project) ?? 'project'}`,
        metadata: (value) => graphQueryActivityMetadata(value, 'get_neighbors', {
          nodeRef: readOptionalString(args.node_id),
          depth: readOptionalNumber(args.depth) ?? 1,
        }),
      }),
  );

  registerTool(
    'vault_graphify_shortest_path',
    'Find the shortest path between two Graphify nodes in the latest managed graph artifact.',
    {
      project: z.string().describe('Project name'),
      from: z.string().describe('Starting node id, label, or path'),
      to: z.string().describe('Ending node id, label, or path'),
      max_depth: z.number().optional().describe('Maximum traversal depth (default: 8)'),
      max_bytes: z.number().optional().describe('Maximum graph.json bytes to read'),
    },
    async (args) => graphJsonResult(() => vault.getGraphifyShortestPath(
        readRequiredString(args.project, 'project'),
        {
          from: readRequiredString(args.from, 'from'),
          to: readRequiredString(args.to, 'to'),
          maxDepth: readOptionalNumber(args.max_depth),
          maxBytes: readOptionalNumber(args.max_bytes),
        },
      ), {
        vault,
        toolName: 'vault_graphify_shortest_path',
        project: readOptionalString(args.project),
        actionType: 'recall',
        message: () => `Found Graphify shortest path for ${readOptionalString(args.project) ?? 'project'}`,
        metadata: (value) => graphQueryActivityMetadata(value, 'shortest_path', {
          from: readOptionalString(args.from),
          to: readOptionalString(args.to),
        }),
      }),
  );

  registerTool(
    'vault_graphify_explain_impact',
    'Summarize likely files, tests, central nodes, and caveats for a proposed change using the latest managed Graphify graph artifact.',
    {
      project: z.string().describe('Project name'),
      query: z.string().describe('Change, file, symbol, or impact question'),
      max_files: z.number().optional().describe('Maximum likely files/tests to return'),
      max_nodes: z.number().optional().describe('Maximum central nodes to return'),
      max_bytes: z.number().optional().describe('Maximum graph.json bytes to read'),
    },
    async (args) => graphJsonResult(() => vault.explainGraphifyImpact(
        readRequiredString(args.project, 'project'),
        {
          query: readRequiredString(args.query, 'query'),
          maxFiles: readOptionalNumber(args.max_files),
          maxNodes: readOptionalNumber(args.max_nodes),
          maxBytes: readOptionalNumber(args.max_bytes),
        },
      ), {
        vault,
        toolName: 'vault_graphify_explain_impact',
        project: readOptionalString(args.project),
        actionType: 'recall',
        message: () => `Explained Graphify impact for ${readOptionalString(args.project) ?? 'project'}`,
        metadata: (value) => graphQueryActivityMetadata(value, 'explain_impact', {
          queryPreview: readOptionalString(args.query),
        }),
      }),
  );

  registerTool(
    'vault_recall_with_graph_context',
    'Combine Vault memory recall with optional Graphify graph context, returning budgeted likely files, central nodes, paths, report snippets, freshness warnings, and next file reads.',
    {
      project: z.string().describe('Project name'),
      subject: z.string().optional().describe('Memory subject to match'),
      keywords: z.array(z.string()).optional().describe('Memory keywords to match'),
      tags: z.array(z.string()).optional().describe('Memory tags to match'),
      query_text: z.string().optional().describe('Natural language query text'),
      limit: z.number().optional().describe('Max Vault recall results'),
      max_tokens: z.number().optional().describe('Approximate maximum context budget'),
      max_files: z.number().optional().describe('Maximum suggested files/tests'),
      max_graph_nodes: z.number().optional().describe('Maximum Graphify nodes'),
      max_graph_edges: z.number().optional().describe('Maximum Graphify edges'),
      max_report_bytes: z.number().optional().describe('Maximum GRAPH_REPORT.md bytes to read'),
      max_graph_bytes: z.number().optional().describe('Maximum graph.json bytes to read'),
    },
    async (args) => jsonResult(async () => formatRecallWithGraphContext(await vault.recallWithGraphContext({
      project: readRequiredString(args.project, 'project'),
      subject: readOptionalString(args.subject),
      keywords: readOptionalStringArray(args.keywords),
      tags: readOptionalStringArray(args.tags),
      queryText: readOptionalString(args.query_text),
      limit: readOptionalNumber(args.limit),
      maxTokens: readOptionalNumber(args.max_tokens),
      maxFiles: readOptionalNumber(args.max_files),
      maxGraphNodes: readOptionalNumber(args.max_graph_nodes),
      maxGraphEdges: readOptionalNumber(args.max_graph_edges),
      maxReportBytes: readOptionalNumber(args.max_report_bytes),
      maxGraphBytes: readOptionalNumber(args.max_graph_bytes),
    }, {
      logActivity: true,
      sourceClient: 'mcp',
      toolName: 'vault_recall_with_graph_context',
    }))),
  );
}

function getToolRegistrar(server: GraphifyMcpServerLike): ToolRegistrar {
  const tool = (server as { tool?: unknown }).tool;
  if (typeof tool !== 'function') {
    throw new Error('MCP server does not expose a tool registration method.');
  }
  return tool.bind(server) as ToolRegistrar;
}

export const runGraphifyBuildProcess: GraphifyBuildProcessRunner = (
  command,
  args,
  options,
) => new Promise((resolve) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    windowsHide: true,
    shell: false,
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
  const stdout: string[] = [];
  const stderr: string[] = [];

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => stdout.push(chunk));
  child.stderr?.on('data', (chunk: string) => stderr.push(chunk));
  child.on('error', (error) => {
    resolve({
      exitCode: 1,
      stdout: stdout.join(''),
      stderr: [stderr.join(''), error.message].filter(Boolean).join('\n'),
    });
  });
  child.on('close', (code) => {
    resolve({
      exitCode: code ?? 1,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    });
  });
});

interface ActivitySpec {
  vault: GraphifyMcpVaultLike;
  toolName: string;
  project?: string;
  actionType?: 'recall' | 'update';
  message?: (value: unknown) => string;
  metadata?: (value: unknown) => Record<string, unknown>;
}

async function jsonResult(
  build: () => unknown | Promise<unknown>,
  activity?: ActivitySpec,
) {
  const startedAt = Date.now();
  try {
    const value = await build();
    recordToolActivity(activity, {
      status: 'success',
      latencyMs: Date.now() - startedAt,
      value,
    });
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(value, null, 2),
      }],
    };
  } catch (error) {
    recordToolActivity(activity, {
      status: 'error',
      latencyMs: Date.now() - startedAt,
      error,
    });
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }, null, 2),
      }],
      isError: true,
    };
  }
}

function recordToolActivity(
  activity: ActivitySpec | undefined,
  result: { status: 'success'; latencyMs: number; value: unknown } | { status: 'error'; latencyMs: number; error: unknown },
): void {
  if (!activity || typeof activity.vault.recordGraphifyToolActivity !== 'function') {
    return;
  }
  const success = result.status === 'success';
  const metadata = success
    ? activity.metadata?.(result.value) ?? {}
    : {
        errorMessage: result.error instanceof Error ? result.error.message : String(result.error),
        intendedActionType: activity.actionType ?? 'recall',
      };
  activity.vault.recordGraphifyToolActivity({
    sourceClient: 'mcp',
    project: activity.project,
    toolName: activity.toolName,
    actionType: success ? activity.actionType ?? 'recall' : 'error',
    status: result.status,
    latencyMs: result.latencyMs,
    message: success
      ? activity.message?.(result.value) ?? `${activity.toolName} completed`
      : `${activity.toolName} failed`,
    metadata: {
      graphifyTool: true,
      toolName: activity.toolName,
      ...metadata,
    },
  });
}

function graphQueryActivityMetadata(
  value: unknown,
  graphOperation: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const result = value as {
    status?: unknown;
    freshness?: unknown;
    fallbackReason?: unknown;
    nodes?: unknown[];
    edges?: unknown[];
    neighbors?: unknown[];
    path?: unknown[];
    likelyFiles?: unknown[];
    tests?: unknown[];
    suggestedFileReads?: unknown[];
    truncated?: unknown;
  };
  return {
    graphOperation,
    resultStatus: result.status,
    graphFreshness: result.freshness,
    graphFallbackReason: result.fallbackReason ?? null,
    nodeCount: countArray(result.nodes) + countArray(result.neighbors) + countArray(result.path),
    edgeCount: countArray(result.edges),
    likelyFileCount: countArray(result.likelyFiles),
    testFileCount: countArray(result.tests),
    suggestedFileReadCount: countArray(result.suggestedFileReads),
    truncated: Boolean(result.truncated),
    ...extra,
  };
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined;
}

function readOptionalBuildMode(value: unknown): 'fast' | 'full' | 'semantic' | undefined {
  if (value === 'fast' || value === 'full' || value === 'semantic') {
    return value;
  }
  return undefined;
}

// --- Token-budget compaction for agent-facing responses ---
// The graph tools and the recall pack carry verbose payloads (raw per-node `data`
// blobs, full edge metadata, every recall bucket with full summaries). Agents pay
// for every byte, and reducing that is a core goal of the Graphify tools. These
// helpers project the rich core results down to the minimum an agent needs to act,
// without changing any core type or behavior (compaction happens only at the MCP
// serialization boundary).

const RECALL_TOP_MATCH_CAP = 5;
const RECALL_BUCKET_CAP = 3;
const RECALL_OPEN_LOOP_CAP = 5;
const RECALL_SUMMARY_CHARS = 220;

// Result-array keys whose elements are graph nodes / edges / impact files. Used to
// compact the five graph tools uniformly while preserving all other fields and the
// camelCase shape the activity-metadata reader and existing tests rely on.
const GRAPH_NODE_ARRAY_KEYS = ['nodes', 'neighbors', 'path', 'centralNodes', 'relatedNodes', 'communities'];
const GRAPH_NODE_SINGLE_KEYS = ['node', 'root'];
const GRAPH_EDGE_ARRAY_KEYS = ['edges'];
const GRAPH_FILE_ARRAY_KEYS = ['likelyFiles', 'tests'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactGraphNode(node: unknown): unknown {
  if (!isPlainObject(node)) {
    return node;
  }
  const data = isPlainObject(node.data) ? node.data : {};
  const out: Record<string, unknown> = { id: node.id };
  if (node.label !== undefined && node.label !== null) out.label = node.label;
  if (node.type !== undefined && node.type !== null) out.type = node.type;
  if (node.path !== undefined && node.path !== null) out.path = node.path;
  if (node.summary !== undefined && node.summary !== null) out.summary = node.summary;
  if (typeof data.community === 'number') out.community = data.community;
  const line = data.source_location ?? data.line;
  if (typeof line === 'string' || typeof line === 'number') out.line = line;
  return out;
}

function compactGraphEdge(edge: unknown): unknown {
  if (!isPlainObject(edge)) {
    return edge;
  }
  const data = isPlainObject(edge.data) ? edge.data : {};
  const out: Record<string, unknown> = { source: edge.source, target: edge.target };
  const relation = edge.type ?? edge.label ?? data.relation;
  if (relation !== undefined && relation !== null) out.relation = relation;
  const line = data.source_location ?? data.line;
  if (typeof line === 'string' || typeof line === 'number') out.line = line;
  return out;
}

function compactImpactFile(file: unknown): unknown {
  if (!isPlainObject(file)) {
    return file;
  }
  const out: Record<string, unknown> = {};
  if (file.path !== undefined) out.path = file.path;
  if (file.label !== undefined) out.label = file.label;
  return out;
}

// Strip per-node/edge `data` blobs from any graph-tool result, preserving every other
// field and the result's overall shape.
function compactGraphResult(value: unknown): unknown {
  if (!isPlainObject(value)) {
    return value;
  }
  const out: Record<string, unknown> = { ...value };
  for (const key of GRAPH_NODE_ARRAY_KEYS) {
    if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).map(compactGraphNode);
  }
  for (const key of GRAPH_NODE_SINGLE_KEYS) {
    if (isPlainObject(out[key])) out[key] = compactGraphNode(out[key]);
  }
  for (const key of GRAPH_EDGE_ARRAY_KEYS) {
    if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).map(compactGraphEdge);
  }
  for (const key of GRAPH_FILE_ARRAY_KEYS) {
    if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).map(compactImpactFile);
  }
  return out;
}

// jsonResult variant that compacts a graph-tool result before serializing, while
// still feeding the (compacted) value to activity metadata (counts are preserved).
function graphJsonResult(
  build: () => unknown | Promise<unknown>,
  activity?: ActivitySpec,
) {
  return jsonResult(async () => compactGraphResult(await build()), activity);
}

function truncateSummary(value: string | null | undefined, maxChars: number): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function formatRecallWithGraphContext(value: unknown): Record<string, unknown> {
  const context = value as GraphifyRecallContextResult;
  const graph = context.graph;
  return {
    recall: formatRecallPack(context.recall),
    graph: {
      used: graph.used,
      status: graph.status,
      project: graph.project,
      freshness: graph.freshness,
      fallback_reason: graph.fallbackReason,
      warnings: graph.warnings,
      freshness_warnings: graph.freshnessWarnings,
      // `query` and `impact` are intentionally omitted: their useful content is
      // already projected into the compact arrays below, and including the full
      // objects (with node `data` blobs) roughly tripled the response size.
      likely_relevant_files: graph.likelyRelevantFiles.map(compactImpactFile),
      tests: graph.tests.map(compactImpactFile),
      central_nodes: graph.centralNodes.map(compactGraphNode),
      communities: graph.communities.map(compactGraphNode),
      shortest_paths: graph.shortestPaths.map((sp) => ({
        from: sp.from,
        to: sp.to,
        found: sp.found,
        path: sp.path.map(compactGraphNode),
        edges: sp.edges.map(compactGraphEdge),
        warnings: sp.warnings,
      })),
      report_snippets: graph.reportSnippets,
      suggested_next_file_reads: graph.suggestedNextFileReads,
    },
    suggested_next_file_reads: context.suggestedNextFileReads,
    warnings: context.warnings,
    budget: context.budget,
  };
}

function formatRecallPack(pack: GraphifyRecallContextResult['recall']): Record<string, unknown> {
  return {
    total_candidates: pack.totalCandidates,
    top_score: pack.topScore,
    context_summary: truncateSummary(pack.contextSummary, RECALL_SUMMARY_CHARS),
    top_matches: pack.topMatches.slice(0, RECALL_TOP_MATCH_CAP).map((match) => ({
      ...briefMemoryItem(match.item),
      score: match.score,
    })),
    decisions: pack.decisions.slice(0, RECALL_BUCKET_CAP).map(briefMemoryItem),
    plans: pack.plans.slice(0, RECALL_BUCKET_CAP).map(briefMemoryItem),
    open_loops: pack.openLoops.slice(0, RECALL_OPEN_LOOP_CAP).map((loop) => ({
      uid: loop.itemUid,
      title: loop.title,
      next_steps: loop.nextSteps,
      days_open: loop.daysOpen,
    })),
    // Lower-signal buckets are summarized as counts instead of dumped in full.
    bucket_counts: {
      related: pack.related.length,
      proactive: pack.proactive.length,
      summaries: pack.summaries.length,
      other: pack.other.length,
    },
  };
}

function briefMemoryItem(item: GraphifyRecallContextResult['recall']['topMatches'][number]['item']): Record<string, unknown> {
  return {
    uid: item.itemUid,
    title: item.title,
    memory_type: item.memoryType,
    subject: item.subject,
    summary: truncateSummary(item.summary, RECALL_SUMMARY_CHARS),
    tags: item.tags,
  };
}
