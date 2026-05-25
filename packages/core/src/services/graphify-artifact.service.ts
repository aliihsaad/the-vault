import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { getGraphifyProjectPaths } from './graphify-paths.service.js';
import type {
  GraphifyArtifactDiscoveryResult,
  GraphifyArtifactJsonReadResult,
  GraphifyArtifactPaths,
  GraphifyArtifactReportReadResult,
  GraphifyGraphStats,
  GraphifyHtmlArtifactResult,
} from '../types/graphify.js';

const DEFAULT_JSON_BUDGET_BYTES = 8 * 1024 * 1024;
const DEFAULT_REPORT_BUDGET_BYTES = 128 * 1024;

export interface GraphifyArtifactReadOptions {
  path?: string;
  maxBytes?: number;
}

export function discoverGraphifyArtifacts(
  vaultRoot: string,
  project: string,
): GraphifyArtifactDiscoveryResult {
  const paths = getGraphifyProjectPaths(vaultRoot, project);
  const artifactPaths: GraphifyArtifactPaths = {
    graphJson: existsSync(paths.graphJson) ? paths.graphJson : null,
    graphHtml: existsSync(paths.graphHtml) ? paths.graphHtml : null,
    graphReport: existsSync(paths.graphReport) ? paths.graphReport : null,
    graphSvg: existsSync(paths.graphSvg) ? paths.graphSvg : null,
  };

  if (!artifactPaths.graphJson) {
    return {
      available: false,
      artifactRoot: paths.artifactRoot,
      artifactPaths,
      graphStats: null,
      missingRequired: ['graph.json'],
      errorMessage: 'Graphify build did not produce graph.json.',
    };
  }

  try {
    return {
      available: true,
      artifactRoot: paths.artifactRoot,
      artifactPaths,
      graphStats: readGraphStatsFromGraphJson(artifactPaths.graphJson),
      missingRequired: [],
      errorMessage: null,
    };
  } catch (error) {
    return {
      available: false,
      artifactRoot: paths.artifactRoot,
      artifactPaths,
      graphStats: null,
      missingRequired: [],
      errorMessage: error instanceof Error
        ? error.message
        : 'Graphify graph.json could not be read.',
    };
  }
}

export function resolveGraphifyArtifactPath(
  vaultRoot: string,
  project: string,
  artifactPath: string,
): string {
  const paths = getGraphifyProjectPaths(vaultRoot, project);
  const artifactRoot = resolve(paths.artifactRoot);
  const targetPath = isAbsolute(artifactPath)
    ? resolve(artifactPath)
    : resolve(artifactRoot, artifactPath);
  const pathFromRoot = relative(artifactRoot, targetPath);

  if (!pathFromRoot || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw new Error('Graphify artifact paths must stay under the managed artifact root.');
  }

  return targetPath;
}

export function readGraphifyArtifactJson(
  vaultRoot: string,
  project: string,
  options: GraphifyArtifactReadOptions = {},
): GraphifyArtifactJsonReadResult {
  const path = resolveGraphifyArtifactPath(vaultRoot, project, options.path ?? 'graph.json');
  const budget = options.maxBytes ?? DEFAULT_JSON_BUDGET_BYTES;
  const budgeted = readBudgetedFile(path, budget);
  if (budgeted.status !== 'available') {
    return budgeted;
  }

  try {
    return {
      ...budgeted,
      data: JSON.parse(budgeted.text) as unknown,
    };
  } catch {
    return {
      status: 'invalid',
      path,
      bytes: budgeted.bytes,
      maxBytes: budget,
      message: 'Graphify JSON artifact is not valid JSON.',
    };
  }
}

export function readGraphifyArtifactReport(
  vaultRoot: string,
  project: string,
  options: GraphifyArtifactReadOptions = {},
): GraphifyArtifactReportReadResult {
  const path = resolveGraphifyArtifactPath(vaultRoot, project, options.path ?? 'GRAPH_REPORT.md');
  const budget = options.maxBytes ?? DEFAULT_REPORT_BUDGET_BYTES;
  return readBudgetedFile(path, budget);
}

export function getGraphifyHtmlArtifact(
  vaultRoot: string,
  project: string,
): GraphifyHtmlArtifactResult {
  const paths = getGraphifyProjectPaths(vaultRoot, project);
  if (existsSync(paths.graphHtml)) {
    return {
      status: 'available',
      path: paths.graphHtml,
    };
  }

  return {
    status: 'missing',
    path: paths.graphHtml,
    fallback: {
      graphJson: existsSync(paths.graphJson) ? paths.graphJson : null,
      graphReport: existsSync(paths.graphReport) ? paths.graphReport : null,
    },
    message: 'graph.html is missing; use graph.json or GRAPH_REPORT.md until Graphify rebuilds the HTML artifact.',
  };
}

export function readGraphStatsFromGraphJson(path: string): GraphifyGraphStats {
  const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const stats = getObject(data.stats) ?? getObject(data.metadata)?.stats as Record<string, unknown> | undefined;

  return {
    nodeCount: readExplicitCount(stats, ['nodeCount', 'nodes', 'node_count'])
      ?? countCollection(data.nodes)
      ?? countCollection(getObject(data.graph)?.nodes)
      ?? countCollection(getObject(data.elements)?.nodes)
      ?? 0,
    edgeCount: readExplicitCount(stats, ['edgeCount', 'edges', 'edge_count'])
      ?? countCollection(data.edges)
      ?? countCollection(data.links)
      ?? countCollection(getObject(data.graph)?.edges)
      ?? countCollection(getObject(data.elements)?.edges)
      ?? 0,
    communityCount: readExplicitCount(stats, ['communityCount', 'communities', 'community_count'])
      ?? countCollection(data.communities)
      ?? countCollection(data.clusters)
      ?? countCollection(getObject(data.graph)?.communities)
      // Graphify stores community membership as a per-node attribute rather than a
      // top-level collection, so fall back to counting distinct node communities.
      ?? countDistinctCommunities(data.nodes)
      ?? countDistinctCommunities(getObject(data.graph)?.nodes)
      ?? countDistinctCommunities(getObject(data.elements)?.nodes)
      ?? 0,
  };
}

function countDistinctCommunities(nodes: unknown): number | null {
  if (!Array.isArray(nodes)) {
    return null;
  }
  const communities = new Set<number | string>();
  for (const node of nodes) {
    if (node && typeof node === 'object') {
      const community = (node as Record<string, unknown>).community;
      if (typeof community === 'number' && Number.isFinite(community)) {
        communities.add(community);
      } else if (typeof community === 'string' && community.trim().length > 0) {
        communities.add(community);
      }
    }
  }
  return communities.size > 0 ? communities.size : null;
}

function readBudgetedFile(
  path: string,
  maxBytes: number,
): GraphifyArtifactReportReadResult {
  if (!existsSync(path)) {
    return {
      status: 'missing',
      path,
      bytes: null,
      maxBytes,
      message: 'Graphify artifact is missing.',
    };
  }

  const bytes = statSync(path).size;
  if (bytes > maxBytes) {
    return {
      status: 'tooLarge',
      path,
      bytes,
      maxBytes,
      message: 'Graphify artifact exceeds the read budget.',
    };
  }

  return {
    status: 'available',
    path,
    bytes,
    maxBytes,
    text: readFileSync(path, 'utf8'),
  };
}

function countCollection(value: unknown): number | null {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).length;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function readExplicitCount(
  stats: Record<string, unknown> | undefined,
  keys: string[],
): number | null {
  if (!stats) {
    return null;
  }

  for (const key of keys) {
    const value = stats[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
