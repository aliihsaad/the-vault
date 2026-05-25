import type {
  MemoryPack,
  RecallQuery,
} from '../types/index.js';
import type {
  GraphifyArtifactReportReadResult,
  GraphifyGraphFallbackReason,
  GraphifyGraphImpactInput,
  GraphifyGraphImpactResult,
  GraphifyGraphQueryInput,
  GraphifyGraphQueryResult,
  GraphifyGraphShortestPathInput,
  GraphifyGraphShortestPathResult,
  GraphifyImpactFileContext,
  GraphifyProjectStatus,
  GraphifyRecallBudget,
  GraphifyRecallContextInput,
  GraphifyRecallContextResult,
  GraphifyRecallGraphContext,
  GraphifyReportSnippet,
  GraphifyShortestPathContext,
} from '../types/graphify.js';
import { buildGraphifyRecallTelemetry } from './graphify-telemetry.service.js';

const DEFAULT_MAX_TOKENS = 1200;
const DEFAULT_MAX_FILES = 8;
const DEFAULT_MAX_GRAPH_NODES = 8;
const DEFAULT_MAX_GRAPH_EDGES = 16;
const DEFAULT_MAX_REPORT_BYTES = 4096;
const DEFAULT_MAX_REPORT_SNIPPETS = 3;
const DEFAULT_REPORT_SNIPPET_CHARS = 700;

export interface RecallWithGraphContextSource {
  recallContext(query: RecallQuery): Promise<MemoryPack> | MemoryPack;
  getGraphifyProjectStatus(project: string): GraphifyProjectStatus;
  queryGraphifyProjectGraph(project: string, input: GraphifyGraphQueryInput): GraphifyGraphQueryResult;
  explainGraphifyImpact(project: string, input: GraphifyGraphImpactInput): GraphifyGraphImpactResult;
  getGraphifyShortestPath(project: string, input: GraphifyGraphShortestPathInput): GraphifyGraphShortestPathResult;
  readGraphifyArtifactReport(project: string, options?: { maxBytes?: number }): GraphifyArtifactReportReadResult;
}

interface GraphifyRecallLimits {
  maxTokens: number;
  maxFiles: number;
  maxGraphNodes: number;
  maxGraphEdges: number;
  maxReportBytes: number;
  maxGraphBytes?: number;
}

export async function buildRecallWithGraphContext(
  source: RecallWithGraphContextSource,
  input: GraphifyRecallContextInput,
): Promise<GraphifyRecallContextResult> {
  const limits = normalizeLimits(input);
  const recall = await source.recallContext(toRecallQuery(input));
  const queryText = buildGraphQueryText(input);
  const memoryFileReads = collectMemoryRelatedFiles(recall, limits.maxFiles);
  let truncated = false;

  let graph: GraphifyRecallGraphContext;
  try {
    const status = source.getGraphifyProjectStatus(input.project);
    if (!status.enabled) {
      graph = vaultOnlyGraphContext(status, 'disabled', [status.message], memoryFileReads);
    } else if (status.buildBlockedReason === 'sourceRootRequired' || !status.sourceRoot) {
      graph = vaultOnlyGraphContext(status, 'sourceRootRequired', [status.message], memoryFileReads);
    } else {
      const graphQuery = source.queryGraphifyProjectGraph(input.project, {
        query: queryText,
        maxNodes: limits.maxGraphNodes,
        maxEdges: limits.maxGraphEdges,
        maxBytes: limits.maxGraphBytes,
      });

      if (graphQuery.status !== 'available') {
        graph = vaultOnlyGraphContext(
          status,
          graphQuery.fallbackReason ?? graphQuery.status,
          graphQuery.warnings,
          memoryFileReads,
        );
      } else {
        const impact = source.explainGraphifyImpact(input.project, {
          query: queryText,
          maxFiles: limits.maxFiles,
          maxNodes: limits.maxGraphNodes,
          maxBytes: limits.maxGraphBytes,
        });
        const likelyFiles = uniqueImpactFiles(impact.likelyFiles).slice(0, limits.maxFiles);
        const tests = uniqueImpactFiles(impact.tests).slice(0, limits.maxFiles);
        const centralNodes = impact.centralNodes.slice(0, limits.maxGraphNodes);
        const communities = collectCommunities(graphQuery, impact).slice(0, limits.maxGraphNodes);
        const suggestedNextFileReads = uniqueStrings([
          ...likelyFiles.map((file) => file.path),
          ...tests.map((file) => file.path),
          ...graphQuery.suggestedFileReads,
          ...memoryFileReads,
        ]).slice(0, limits.maxFiles);
        const shortestPaths = buildShortestPaths(source, input.project, suggestedNextFileReads, limits);
        const report = readReportSnippets(source, input.project, queryText, limits);
        const warnings = uniqueStrings([
          ...graphQuery.warnings,
          ...impact.caveats,
          ...report.warnings,
        ]);

        truncated = graphQuery.truncated || report.truncated || suggestedNextFileReads.length >= limits.maxFiles;
        graph = {
          used: true,
          status: 'available',
          project: graphQuery.project,
          freshness: graphQuery.freshness,
          fallbackReason: null,
          warnings,
          freshnessWarnings: freshnessWarnings(warnings),
          query: graphQuery,
          impact,
          likelyRelevantFiles: likelyFiles,
          tests,
          centralNodes,
          communities,
          shortestPaths,
          reportSnippets: report.snippets,
          suggestedNextFileReads,
        };
      }
    }
  } catch (error) {
    graph = vaultOnlyGraphContext(
      {
        project: input.project,
        enabled: true,
        sourceRoot: null,
        sourceRootCandidate: null,
        freshness: 'failed',
        buildMode: 'fast',
        buildEligible: false,
        buildBlockedReason: null,
        uiState: 'ready',
        message: error instanceof Error ? error.message : String(error),
        state: null,
      },
      'failed',
      [error instanceof Error ? error.message : String(error)],
      memoryFileReads,
    );
  }

  const warnings = uniqueStrings(graph.warnings);
  const suggestedNextFileReads = graph.used
    ? graph.suggestedNextFileReads.slice(0, limits.maxFiles)
    : memoryFileReads.slice(0, limits.maxFiles);
  const estimate = estimateContextTokens(recall, graph, suggestedNextFileReads);
  const budget: GraphifyRecallBudget = {
    maxTokens: limits.maxTokens,
    estimatedTokens: Math.min(estimate, limits.maxTokens),
    truncated: truncated || estimate > limits.maxTokens,
    maxFiles: limits.maxFiles,
    maxGraphNodes: limits.maxGraphNodes,
    maxGraphEdges: limits.maxGraphEdges,
    maxReportBytes: limits.maxReportBytes,
  };

  const result: Omit<GraphifyRecallContextResult, 'telemetry'> = {
    recall,
    graph: {
      ...graph,
      suggestedNextFileReads,
    },
    suggestedNextFileReads,
    warnings,
    budget,
  };

  return {
    ...result,
    telemetry: buildGraphifyRecallTelemetry({
      result,
      broadSearchFileBaseline: input.broadSearchFileBaseline,
    }),
  };
}

function toRecallQuery(input: GraphifyRecallContextInput): RecallQuery {
  return {
    project: input.project,
    subject: input.subject,
    keywords: input.keywords,
    tags: input.tags,
    queryText: input.queryText,
    limit: input.limit,
  };
}

function normalizeLimits(input: GraphifyRecallContextInput): GraphifyRecallLimits {
  const maxTokens = positiveInt(input.maxTokens, DEFAULT_MAX_TOKENS);
  const tokenFileCap = Math.max(1, Math.floor(maxTokens / 160));
  const tokenNodeCap = Math.max(1, Math.floor(maxTokens / 130));
  const tokenEdgeCap = Math.max(1, Math.floor(maxTokens / 90));

  return {
    maxTokens,
    maxFiles: Math.min(positiveInt(input.maxFiles, DEFAULT_MAX_FILES), tokenFileCap),
    maxGraphNodes: Math.min(positiveInt(input.maxGraphNodes, DEFAULT_MAX_GRAPH_NODES), tokenNodeCap),
    maxGraphEdges: Math.min(positiveInt(input.maxGraphEdges, DEFAULT_MAX_GRAPH_EDGES), tokenEdgeCap),
    maxReportBytes: Math.min(positiveInt(input.maxReportBytes, DEFAULT_MAX_REPORT_BYTES), maxTokens * 4),
    maxGraphBytes: input.maxGraphBytes,
  };
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function buildGraphQueryText(input: GraphifyRecallContextInput): string {
  const parts = [
    input.queryText,
    input.subject,
    ...(input.keywords ?? []),
    ...(input.tags ?? []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return parts.join(' ').trim() || input.project;
}

function vaultOnlyGraphContext(
  status: GraphifyProjectStatus,
  reason: GraphifyGraphFallbackReason,
  warnings: string[],
  suggestedFileReads: string[],
): GraphifyRecallGraphContext {
  return {
    used: false,
    status: reason,
    project: status.project,
    freshness: status.freshness,
    fallbackReason: reason,
    warnings: warnings.length > 0 ? warnings : [status.message],
    freshnessWarnings: freshnessWarnings(warnings),
    query: null,
    impact: null,
    likelyRelevantFiles: [],
    tests: [],
    centralNodes: [],
    communities: [],
    shortestPaths: [],
    reportSnippets: [],
    suggestedNextFileReads: suggestedFileReads,
  };
}

function collectMemoryRelatedFiles(pack: MemoryPack, limit: number): string[] {
  const matches = pack.topMatches.map((match) => match.item);
  return uniqueStrings([
    ...matches.flatMap((item) => item.relatedFiles),
    ...pack.related.flatMap((item) => item.relatedFiles),
    ...pack.proactive.flatMap((item) => item.relatedFiles),
  ]).slice(0, limit);
}

function collectCommunities(
  query: GraphifyGraphQueryResult,
  impact: GraphifyGraphImpactResult,
) {
  return uniqueNodes([
    ...query.nodes,
    ...impact.centralNodes,
  ].filter((node) => {
    const type = normalizeSearch(node.type ?? '');
    const id = normalizeSearch(node.id);
    return type === 'community' || id.startsWith('community:');
  }));
}

function buildShortestPaths(
  source: RecallWithGraphContextSource,
  project: string,
  suggestedFileReads: string[],
  limits: GraphifyRecallLimits,
): GraphifyShortestPathContext[] {
  const uniqueReads = uniqueStrings(suggestedFileReads);
  const from = uniqueReads.find((path) => !isTestPath(path)) ?? uniqueReads[0];
  const to = uniqueReads.find((path) => path !== from && isTestPath(path))
    ?? uniqueReads.find((path) => path !== from);
  if (!from || !to) {
    return [];
  }

  const path = source.getGraphifyShortestPath(project, {
    from,
    to,
    maxDepth: 6,
    maxBytes: limits.maxGraphBytes,
  });
  return [{
    from,
    to,
    found: path.found,
    path: path.path,
    edges: path.edges,
    warnings: path.warnings,
  }];
}

function isTestPath(path: string): boolean {
  const normalized = normalizeSearch(path);
  return normalized.includes('/test/')
    || normalized.includes('\\test\\')
    || normalized.includes('.test.')
    || normalized.includes('.spec.');
}

function readReportSnippets(
  source: RecallWithGraphContextSource,
  project: string,
  queryText: string,
  limits: GraphifyRecallLimits,
): { snippets: GraphifyReportSnippet[]; warnings: string[]; truncated: boolean } {
  const report = source.readGraphifyArtifactReport(project, {
    maxBytes: limits.maxReportBytes,
  });
  if (report.status !== 'available') {
    return {
      snippets: [],
      warnings: [report.message],
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
  const blocks = splitMarkdownBlocks(text);
  const scored = blocks
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
    } else {
      if (/^#{1,6}\s+/.test(line)) {
        current.heading = line.replace(/^#{1,6}\s+/, '').trim();
      }
      current.lines.push(line);
    }
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

function freshnessWarnings(warnings: string[]): string[] {
  return warnings.filter((warning) => /stale|failed/i.test(warning));
}

function estimateContextTokens(
  recall: MemoryPack,
  graph: GraphifyRecallGraphContext,
  suggestedNextFileReads: string[],
): number {
  const recallText = recall.topMatches
    .slice(0, 5)
    .map((match) => `${match.item.title} ${match.item.summary}`)
    .join('\n');
  const graphText = [
    graph.warnings.join('\n'),
    graph.centralNodes.map((node) => `${node.label} ${node.summary ?? ''}`).join('\n'),
    graph.likelyRelevantFiles.map((file) => `${file.path} ${file.reason}`).join('\n'),
    graph.tests.map((file) => `${file.path} ${file.reason}`).join('\n'),
    graph.reportSnippets.map((snippet) => snippet.text).join('\n'),
    suggestedNextFileReads.join('\n'),
  ].join('\n');
  return Math.ceil((recallText.length + graphText.length) / 4);
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

function uniqueNodes<T extends { id: string }>(nodes: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    unique.push(node);
  }
  return unique;
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

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}
