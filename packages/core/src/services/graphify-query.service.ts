import {
  readGraphifyArtifactJson,
  readGraphifyArtifactReport,
} from './graphify-artifact.service.js';
import type {
  GraphifyFreshnessState,
  GraphifyGraphContextBase,
  GraphifyGraphContextStatus,
  GraphifyGraphEdgeContext,
  GraphifyGraphFallbackReason,
  GraphifyGraphImpactInput,
  GraphifyGraphImpactResult,
  GraphifyGraphNeighborsInput,
  GraphifyGraphNeighborsResult,
  GraphifyGraphNodeContext,
  GraphifyGraphNodeInput,
  GraphifyGraphNodeResult,
  GraphifyGraphQueryInput,
  GraphifyGraphQueryResult,
  GraphifyGraphShortestPathInput,
  GraphifyGraphShortestPathResult,
  GraphifyImpactFileContext,
  GraphifyProjectStatus,
  GraphifyReportSnippet,
} from '../types/graphify.js';

const DEFAULT_MAX_NODES = 12;
const DEFAULT_MAX_EDGES = 24;
const DEFAULT_MAX_NEIGHBORS = 10;
const DEFAULT_MAX_FILES = 12;
const DEFAULT_MAX_REPORT_BYTES = 4096;
const DEFAULT_MAX_REPORT_SNIPPETS = 2;
const DEFAULT_REPORT_SNIPPET_CHARS = 700;
const QUERY_STOP_WORDS = new Set([
  'about',
  'and',
  'are',
  'for',
  'from',
  'how',
  'impact',
  'into',
  'the',
  'this',
  'what',
  'when',
  'where',
  'which',
  'with',
]);

interface ParsedGraph {
  nodes: GraphifyGraphNodeContext[];
  edges: GraphifyGraphEdgeContext[];
  nodeById: Map<string, GraphifyGraphNodeContext>;
  adjacency: Map<string, GraphifyGraphEdgeContext[]>;
}

interface LoadedGraphAvailable {
  ok: true;
  base: GraphifyGraphContextBase;
  graph: ParsedGraph;
}

interface LoadedGraphFallback {
  ok: false;
  base: GraphifyGraphContextBase;
}

type LoadedGraph = LoadedGraphAvailable | LoadedGraphFallback;

export function queryGraphifyProjectGraph(
  vaultRoot: string,
  project: string,
  projectStatus: GraphifyProjectStatus,
  input: GraphifyGraphQueryInput,
): GraphifyGraphQueryResult {
  const loaded = loadGraph(vaultRoot, project, projectStatus, input.maxBytes);
  if (!loaded.ok) {
    return {
      ...loaded.base,
      answer: null,
      nodes: [],
      edges: [],
      suggestedFileReads: [],
      truncated: false,
    };
  }

  const maxNodes = normalizeLimit(input.maxNodes, DEFAULT_MAX_NODES);
  const maxEdges = normalizeLimit(input.maxEdges, DEFAULT_MAX_EDGES);
  const selectedNodes = expandQueryNodes(loaded.graph, input.query).slice(0, maxNodes);
  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const incidentEdges = loaded.graph.edges.filter((edge) => (
    selectedIds.has(edge.source) || selectedIds.has(edge.target)
  ));
  const edges = incidentEdges.slice(0, maxEdges);
  const suggestedFileReads = collectFilePaths(selectedNodes, edges, loaded.graph, DEFAULT_MAX_FILES);

  return {
    ...loaded.base,
    answer: selectedNodes.length > 0
      ? `Found ${selectedNodes.length} graph node${selectedNodes.length === 1 ? '' : 's'} related to "${input.query}".`
      : `No graph nodes matched "${input.query}".`,
    nodes: selectedNodes,
    edges,
    suggestedFileReads,
    truncated: selectedNodes.length < expandQueryNodes(loaded.graph, input.query).length || edges.length < incidentEdges.length,
  };
}

export function getGraphifyNodeContext(
  vaultRoot: string,
  project: string,
  projectStatus: GraphifyProjectStatus,
  input: GraphifyGraphNodeInput,
): GraphifyGraphNodeResult {
  const loaded = loadGraph(vaultRoot, project, projectStatus, input.maxBytes);
  if (!loaded.ok) {
    return {
      ...loaded.base,
      node: null,
      neighbors: [],
      edges: [],
    };
  }

  const node = findNode(loaded.graph, input.node);
  if (!node) {
    return {
      ...notFoundBase(loaded.base, 'nodeNotFound', `Graphify node was not found: ${input.node}`),
      node: null,
      neighbors: [],
      edges: [],
    };
  }

  const maxNeighbors = normalizeLimit(input.maxNeighbors, DEFAULT_MAX_NEIGHBORS);
  const edges = getIncidentEdges(loaded.graph, node.id).slice(0, maxNeighbors);
  const neighbors = edges
    .map((edge) => loaded.graph.nodeById.get(edge.source === node.id ? edge.target : edge.source))
    .filter(isDefined);

  return {
    ...loaded.base,
    node,
    neighbors,
    edges,
  };
}

export function getGraphifyNeighborsContext(
  vaultRoot: string,
  project: string,
  projectStatus: GraphifyProjectStatus,
  input: GraphifyGraphNeighborsInput,
): GraphifyGraphNeighborsResult {
  const loaded = loadGraph(vaultRoot, project, projectStatus, input.maxBytes);
  if (!loaded.ok) {
    return {
      ...loaded.base,
      root: null,
      nodes: [],
      edges: [],
      truncated: false,
    };
  }

  const root = findNode(loaded.graph, input.nodeId);
  if (!root) {
    return {
      ...notFoundBase(loaded.base, 'nodeNotFound', `Graphify node was not found: ${input.nodeId}`),
      root: null,
      nodes: [],
      edges: [],
      truncated: false,
    };
  }

  const depth = normalizeLimit(input.depth, 1);
  const maxNodes = normalizeLimit(input.maxNodes, DEFAULT_MAX_NODES);
  const maxEdges = normalizeLimit(input.maxEdges, DEFAULT_MAX_EDGES);
  const collected = collectNeighbors(loaded.graph, root.id, depth);

  return {
    ...loaded.base,
    root,
    nodes: collected.nodes.slice(0, maxNodes),
    edges: collected.edges.slice(0, maxEdges),
    truncated: collected.nodes.length > maxNodes || collected.edges.length > maxEdges,
  };
}

export function getGraphifyShortestPathContext(
  vaultRoot: string,
  project: string,
  projectStatus: GraphifyProjectStatus,
  input: GraphifyGraphShortestPathInput,
): GraphifyGraphShortestPathResult {
  const loaded = loadGraph(vaultRoot, project, projectStatus, input.maxBytes);
  if (!loaded.ok) {
    return {
      ...loaded.base,
      found: false,
      path: [],
      edges: [],
    };
  }

  const from = findNode(loaded.graph, input.from);
  const to = findNode(loaded.graph, input.to);
  if (!from || !to) {
    return {
      ...notFoundBase(loaded.base, 'nodeNotFound', 'Graphify path endpoint was not found.'),
      found: false,
      path: [],
      edges: [],
    };
  }

  const path = findShortestPath(loaded.graph, from.id, to.id, normalizeLimit(input.maxDepth, 8));
  if (!path) {
    return {
      ...notFoundBase(loaded.base, 'pathNotFound', 'No Graphify path was found within the requested depth.'),
      found: false,
      path: [],
      edges: [],
    };
  }

  return {
    ...loaded.base,
    found: true,
    path: path.nodeIds.map((id) => loaded.graph.nodeById.get(id)).filter(isDefined),
    edges: path.edgeIds.map((id) => loaded.graph.edges.find((edge) => edge.id === id)).filter(isDefined),
  };
}

export function explainGraphifyImpact(
  vaultRoot: string,
  project: string,
  projectStatus: GraphifyProjectStatus,
  input: GraphifyGraphImpactInput,
): GraphifyGraphImpactResult {
  const loaded = loadGraph(vaultRoot, project, projectStatus, input.maxBytes);
  if (!loaded.ok) {
    return {
      ...loaded.base,
      likelyFiles: [],
      tests: [],
      centralNodes: [],
      relatedNodes: [],
      reportSnippets: [],
      caveats: loaded.base.warnings,
      truncated: false,
    };
  }

  const maxNodes = normalizeLimit(input.maxNodes, DEFAULT_MAX_NODES);
  const maxFiles = normalizeLimit(input.maxFiles, DEFAULT_MAX_FILES);
  const expandedNodes = expandQueryNodes(loaded.graph, input.query);
  const centralNodes = expandedNodes.slice(0, maxNodes);
  const relevantEdges = loaded.graph.edges.filter((edge) => (
    centralNodes.some((node) => node.id === edge.source || node.id === edge.target)
  ));
  const connectedNodes = uniqueNodes([
    ...centralNodes,
    ...relevantEdges
      .flatMap((edge) => [loaded.graph.nodeById.get(edge.source), loaded.graph.nodeById.get(edge.target)])
      .filter(isDefined),
  ]);
  const centralNodeIds = new Set(centralNodes.map((node) => node.id));
  const relatedNodeCandidates = connectedNodes.filter((node) => !centralNodeIds.has(node.id));
  const fileContexts = connectedNodes
    .filter((node) => isFileLikeNode(node))
    .map((node) => toImpactFile(node, 'Graph node matched the impact query or is directly connected.'))
    .filter(isDefined);
  const testContexts = connectedNodes
    .filter((node) => isTestLikeNode(node))
    .map((node) => toImpactFile(node, 'Graph node is a directly connected test context.'))
    .filter(isDefined);
  const report = readImpactReportSnippets(vaultRoot, project, input.query, input.maxReportBytes);

  return {
    ...loaded.base,
    likelyFiles: uniqueImpactFiles(fileContexts).slice(0, maxFiles),
    tests: uniqueImpactFiles(testContexts).slice(0, maxFiles),
    centralNodes,
    relatedNodes: relatedNodeCandidates.slice(0, maxNodes),
    reportSnippets: report.snippets,
    caveats: uniqueStrings([
      ...loaded.base.warnings,
      ...report.warnings,
    ]),
    truncated: expandedNodes.length > maxNodes
      || relatedNodeCandidates.length > maxNodes
      || uniqueImpactFiles(fileContexts).length > maxFiles
      || uniqueImpactFiles(testContexts).length > maxFiles
      || report.truncated,
  };
}

function loadGraph(
  vaultRoot: string,
  project: string,
  projectStatus: GraphifyProjectStatus,
  maxBytes: number | undefined,
): LoadedGraph {
  const projectName = projectStatus.project || project;
  const freshness = projectStatus.freshness;
  if (!projectStatus.enabled) {
    return {
      ok: false,
      base: fallbackBase(projectName, freshness, 'disabled', projectStatus.message),
    };
  }
  if (!projectStatus.sourceRoot || projectStatus.buildBlockedReason === 'sourceRootRequired') {
    return {
      ok: false,
      base: fallbackBase(projectName, freshness, 'sourceRootRequired', projectStatus.message),
    };
  }

  const artifact = readGraphifyArtifactJson(vaultRoot, projectName, { maxBytes });
  if (artifact.status !== 'available') {
    const reason = artifact.status === 'missing'
      ? freshness === 'failed' ? 'failed' : 'missing'
      : artifact.status;
    const message = freshness === 'failed' && projectStatus.state?.lastError
      ? `Latest Graphify build failed: ${projectStatus.state.lastError}`
      : artifact.message;
    return {
      ok: false,
      base: fallbackBase(projectName, freshness, reason, message),
    };
  }

  const warnings = buildFreshnessWarnings(projectStatus);
  return {
    ok: true,
    base: {
      status: 'available',
      project: projectName,
      freshness,
      fallbackReason: null,
      warnings,
    },
    graph: parseGraph(artifact.data),
  };
}

function parseGraph(data: unknown): ParsedGraph {
  const root = asRecord(data) ?? {};
  const graph = asRecord(root.graph) ?? root;
  const nodes = readNodeCollection(root.nodes)
    ?? readNodeCollection(graph.nodes)
    ?? readNodeCollection(asRecord(root.elements)?.nodes)
    ?? [];
  const nodeContexts = nodes.map((node, index) => normalizeNode(node, index));
  const nodeById = new Map(nodeContexts.map((node) => [node.id, node]));
  const edges = (readEdgeCollection(root.edges)
    ?? readEdgeCollection(root.links)
    ?? readEdgeCollection(graph.edges)
    ?? readEdgeCollection(graph.links)
    ?? readEdgeCollection(asRecord(root.elements)?.edges)
    ?? [])
    .map((edge, index) => normalizeEdge(edge, index))
    .filter((edge) => edge.source && edge.target);
  const adjacency = new Map<string, GraphifyGraphEdgeContext[]>();
  for (const edge of edges) {
    pushAdjacency(adjacency, edge.source, edge);
    pushAdjacency(adjacency, edge.target, edge);
  }

  return {
    nodes: nodeContexts,
    edges,
    nodeById,
    adjacency,
  };
}

function expandQueryNodes(graph: ParsedGraph, query: string): GraphifyGraphNodeContext[] {
  const matches = findQueryMatches(graph, query);
  const expanded = uniqueNodes([
    ...matches,
    ...matches.flatMap((match) => getIncidentEdges(graph, match.id)
      .map((edge) => graph.nodeById.get(edge.source === match.id ? edge.target : edge.source))
      .filter(isDefined)),
  ]);
  return expanded.length > 0 ? expanded : graph.nodes;
}

function findQueryMatches(graph: ParsedGraph, query: string): GraphifyGraphNodeContext[] {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) {
    return graph.nodes;
  }

  return graph.nodes
    .map((node) => ({
      node,
      score: scoreNode(node, normalizedQuery),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id))
    .map((entry) => entry.node);
}

function scoreNode(node: GraphifyGraphNodeContext, query: string): number {
  const id = normalizeSearch(node.id);
  const label = normalizeSearch(node.label);
  const path = normalizePathSearch(node.path ?? '');
  const queryPath = normalizePathSearch(query);
  const summary = normalizeSearch(node.summary ?? '');
  const type = normalizeSearch(node.type ?? '');
  const dataText = normalizeSearch(JSON.stringify(node.data));
  const terms = tokenize(query).filter((term) => !QUERY_STOP_WORDS.has(term));
  let score = 0;

  if (id === query || label === query || path === queryPath) score += 200;
  if (path && (path.endsWith(queryPath) || queryPath.endsWith(path))) score += 180;
  if (id.includes(query) || label.includes(query)) score += 120;
  if (path.includes(queryPath)) score += 110;
  if (summary.includes(query)) score += 40;
  if (type.includes(query) || dataText.includes(query)) score += 20;

  for (const term of terms) {
    const specificSymbolTerm = term.length >= 8;
    if (specificSymbolTerm && (label.includes(term) || id.includes(term))) score += 180;
    if (specificSymbolTerm && summary.includes(term)) score += 80;
    if (label.includes(term)) score += 50;
    if (path.includes(term)) score += 45;
    if (id.includes(term)) score += 35;
    if (summary.includes(term)) score += 12;
    if (dataText.includes(term)) score += 4;
  }

  return score;
}

function findNode(graph: ParsedGraph, nodeRef: string): GraphifyGraphNodeContext | null {
  const normalizedRef = normalizeSearch(nodeRef);
  const normalizedPathRef = normalizePathSearch(nodeRef);
  return graph.nodes.find((node) => (
    normalizeSearch(node.id) === normalizedRef ||
    normalizeSearch(node.label) === normalizedRef ||
    normalizePathSearch(node.path ?? '') === normalizedPathRef
  )) ?? graph.nodes.find((node) => (
    normalizeSearch(node.id).includes(normalizedRef) ||
    normalizeSearch(node.label).includes(normalizedRef) ||
    normalizePathSearch(node.path ?? '').includes(normalizedPathRef)
  )) ?? null;
}

function collectNeighbors(
  graph: ParsedGraph,
  rootId: string,
  maxDepth: number,
): { nodes: GraphifyGraphNodeContext[]; edges: GraphifyGraphEdgeContext[] } {
  const seen = new Set([rootId]);
  const seenEdges = new Set<string>();
  const nodes: GraphifyGraphNodeContext[] = [];
  const edges: GraphifyGraphEdgeContext[] = [];
  let frontier = [rootId];

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const edge of getIncidentEdges(graph, nodeId)) {
        if (!seenEdges.has(edge.id)) {
          seenEdges.add(edge.id);
          edges.push(edge);
        }
        const neighborId = edge.source === nodeId ? edge.target : edge.source;
        if (!seen.has(neighborId)) {
          seen.add(neighborId);
          next.push(neighborId);
          const neighbor = graph.nodeById.get(neighborId);
          if (neighbor) {
            nodes.push(neighbor);
          }
        }
      }
    }
    frontier = next;
  }

  return { nodes, edges };
}

function findShortestPath(
  graph: ParsedGraph,
  fromId: string,
  toId: string,
  maxDepth: number,
): { nodeIds: string[]; edgeIds: string[] } | null {
  const queue: Array<{ nodeId: string; nodeIds: string[]; edgeIds: string[] }> = [{
    nodeId: fromId,
    nodeIds: [fromId],
    edgeIds: [],
  }];
  const seen = new Set([fromId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.nodeId === toId) {
      return {
        nodeIds: current.nodeIds,
        edgeIds: current.edgeIds,
      };
    }
    if (current.edgeIds.length >= maxDepth) {
      continue;
    }

    for (const edge of getIncidentEdges(graph, current.nodeId)) {
      const neighborId = edge.source === current.nodeId ? edge.target : edge.source;
      if (seen.has(neighborId)) {
        continue;
      }
      seen.add(neighborId);
      queue.push({
        nodeId: neighborId,
        nodeIds: [...current.nodeIds, neighborId],
        edgeIds: [...current.edgeIds, edge.id],
      });
    }
  }

  return null;
}

function getIncidentEdges(graph: ParsedGraph, nodeId: string): GraphifyGraphEdgeContext[] {
  return graph.adjacency.get(nodeId) ?? [];
}

function collectFilePaths(
  nodes: GraphifyGraphNodeContext[],
  edges: GraphifyGraphEdgeContext[],
  graph: ParsedGraph,
  maxFiles: number,
): string[] {
  const candidates = uniqueNodes([
    ...nodes,
    ...edges
      .flatMap((edge) => [graph.nodeById.get(edge.source), graph.nodeById.get(edge.target)])
      .filter(isDefined),
  ]);
  return Array.from(new Set(
    candidates
      .map((node) => node.path)
      .filter(isDefined),
  )).slice(0, maxFiles);
}

function toImpactFile(node: GraphifyGraphNodeContext, reason: string): GraphifyImpactFileContext | null {
  if (!node.path) {
    return null;
  }
  return {
    path: node.path,
    nodeId: node.id,
    label: node.label,
    reason,
  };
}

function uniqueImpactFiles(files: GraphifyImpactFileContext[]): GraphifyImpactFileContext[] {
  const seen = new Set<string>();
  const unique: GraphifyImpactFileContext[] = [];
  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    unique.push(file);
  }
  return unique;
}

function uniqueNodes(nodes: GraphifyGraphNodeContext[]): GraphifyGraphNodeContext[] {
  const seen = new Set<string>();
  const unique: GraphifyGraphNodeContext[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    unique.push(node);
  }
  return unique;
}

function readImpactReportSnippets(
  vaultRoot: string,
  project: string,
  queryText: string,
  maxReportBytes: number | undefined,
): { snippets: GraphifyReportSnippet[]; warnings: string[]; truncated: boolean } {
  const report = readGraphifyArtifactReport(vaultRoot, project, {
    maxBytes: normalizeLimit(maxReportBytes, DEFAULT_MAX_REPORT_BYTES),
  });
  if (report.status !== 'available') {
    return {
      snippets: [],
      warnings: report.status === 'missing' ? [] : [report.message],
      truncated: report.status === 'tooLarge',
    };
  }

  const snippets = selectReportSnippets(report.text, queryText)
    .slice(0, DEFAULT_MAX_REPORT_SNIPPETS)
    .map((snippet) => {
      const text = truncateText(snippet.text, DEFAULT_REPORT_SNIPPET_CHARS);
      return {
        source: 'GRAPH_REPORT.md' as const,
        heading: snippet.heading,
        text,
        truncated: text.length < snippet.text.length,
      };
    });

  return {
    snippets,
    warnings: [],
    truncated: snippets.some((snippet) => snippet.truncated),
  };
}

function selectReportSnippets(text: string, queryText: string): Array<{ heading: string | null; text: string; score: number }> {
  const terms = tokenize(queryText);
  const scored = splitMarkdownBlocks(text)
    .map((block) => ({
      ...block,
      score: scoreText(block.text, terms),
    }))
    .filter((block) => block.text.trim().length > 0)
    .sort((left, right) => right.score - left.score);
  const matching = scored.filter((block) => block.score > 0);
  return matching.length > 0 ? matching : scored.slice(0, 1);
}

function splitMarkdownBlocks(text: string): Array<{ heading: string | null; text: string }> {
  const lines = text.split(/\r?\n/);
  const blocks: Array<{ heading: string | null; lines: string[] }> = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line) && current.lines.length > 0) {
      blocks.push(current);
      current = { heading: line.replace(/^#{1,6}\s+/, '').trim(), lines: [line] };
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      current.heading = line.replace(/^#{1,6}\s+/, '').trim();
    }
    current.lines.push(line);
  }
  if (current.lines.length > 0) {
    blocks.push(current);
  }

  return blocks.map((block) => ({
    heading: block.heading,
    text: block.lines.join('\n').trim(),
  }));
}

function scoreText(text: string, terms: string[]): number {
  const normalized = normalizeSearch(text);
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

function tokenize(value: string): string[] {
  return uniqueStrings(
    value
      .toLowerCase()
      .split(/[^a-z0-9_./:-]+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 2),
  );
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function normalizeNode(input: Record<string, unknown>, index: number): GraphifyGraphNodeContext {
  const id = readString(input.id)
    ?? readString(input.key)
    ?? readString(input.name)
    ?? readString(input.label)
    ?? `node:${index}`;
  const label = readString(input.label)
    ?? readString(input.name)
    ?? readString(input.title)
    ?? id;
  const path = readPath(input.path)
    ?? readPath(input.file)
    ?? readPath(input.filePath)
    ?? readPath(input.relativePath)
    ?? readPath(input.source_file)
    ?? readPath(input.sourceFile);
  return {
    id,
    label,
    type: readString(input.type) ?? readString(input.kind) ?? readString(input.category) ?? readString(input.file_type) ?? null,
    path,
    summary: readString(input.summary) ?? readString(input.description) ?? null,
    data: input,
  };
}

function normalizeEdge(input: Record<string, unknown>, index: number): GraphifyGraphEdgeContext {
  const source = readEndpoint(input.source) ?? readEndpoint(input.from) ?? '';
  const target = readEndpoint(input.target) ?? readEndpoint(input.to) ?? '';
  const type = readString(input.type) ?? readString(input.kind) ?? readString(input.relation) ?? null;
  const label = readString(input.label) ?? readString(input.name) ?? type;
  return {
    id: readString(input.id) ?? `${source}->${target}:${index}`,
    source,
    target,
    label,
    type,
    data: input,
  };
}

function readNodeCollection(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) {
    return value.map(asRecord).filter(isDefined);
  }
  const record = asRecord(value);
  if (record) {
    return Object.entries(record).map(([id, node]) => ({
      id,
      ...(asRecord(node) ?? {}),
    }));
  }
  return null;
}

function readEdgeCollection(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) {
    return value.map(asRecord).filter(isDefined);
  }
  const record = asRecord(value);
  if (record) {
    return Object.entries(record).map(([id, edge]) => ({
      id,
      ...(asRecord(edge) ?? {}),
    }));
  }
  return null;
}

function readEndpoint(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  const record = asRecord(value);
  return record ? readString(record.id) ?? readString(record.label) : null;
}

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function readPath(value: unknown): string | null {
  const path = readString(value);
  return path ? normalizeGraphifySourcePath(path) : null;
}

function normalizeGraphifySourcePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^source\//i, '');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pushAdjacency(
  adjacency: Map<string, GraphifyGraphEdgeContext[]>,
  nodeId: string,
  edge: GraphifyGraphEdgeContext,
): void {
  const existing = adjacency.get(nodeId) ?? [];
  existing.push(edge);
  adjacency.set(nodeId, existing);
}

function fallbackBase(
  project: string,
  freshness: GraphifyFreshnessState,
  reason: GraphifyGraphFallbackReason,
  message: string,
): GraphifyGraphContextBase {
  return {
    status: reason,
    project,
    freshness,
    fallbackReason: reason,
    warnings: [message],
  };
}

function notFoundBase(
  base: GraphifyGraphContextBase,
  status: Extract<GraphifyGraphContextStatus, 'nodeNotFound' | 'pathNotFound'>,
  message: string,
): GraphifyGraphContextBase {
  return {
    ...base,
    status,
    fallbackReason: status,
    warnings: [...base.warnings, message],
  };
}

function buildFreshnessWarnings(projectStatus: GraphifyProjectStatus): string[] {
  if (projectStatus.freshness === 'stale') {
    return ['Graphify graph is stale; using the last available graph.'];
  }
  if (projectStatus.freshness === 'failed') {
    return [
      projectStatus.state?.lastError
        ? `Latest Graphify build failed; using the last available graph. Last error: ${projectStatus.state.lastError}`
        : 'Latest Graphify build failed; using the last available graph.',
    ];
  }
  return [];
}

function isFileLikeNode(node: GraphifyGraphNodeContext): boolean {
  const type = normalizeSearch(node.type ?? '');
  return Boolean(node.path) && type !== 'test';
}

function isTestLikeNode(node: GraphifyGraphNodeContext): boolean {
  const text = normalizeSearch(`${node.type ?? ''} ${node.path ?? ''} ${node.label}`);
  return Boolean(node.path) && (
    text.includes('test') ||
    text.includes('.spec.') ||
    text.includes('.test.')
  );
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePathSearch(value: string): string {
  return normalizeSearch(normalizeGraphifySourcePath(value));
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
