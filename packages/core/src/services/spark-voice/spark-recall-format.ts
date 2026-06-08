/**
 * Pure formatting for Spark's `recall_memory` tool output (roadmap C — deeper
 * cross-project intelligence). Combines cross-project Vault recall (breadth)
 * with optional Graphify graph context for the dominant project (depth) into a
 * single concise text block the realtime model can ground answers in.
 *
 * No I/O: the host fetches the recall pack + graph context and feeds them here.
 * The view interfaces are intentionally narrow so the real `MemoryPack` and
 * `GraphifyRecallGraphContext` are structurally assignable without coupling.
 */

export interface SparkRecallItemView {
  project?: string | null;
  title?: string | null;
  subject?: string | null;
  summary?: string | null;
}

export interface SparkRecallPackView {
  topMatches: Array<{ item: SparkRecallItemView }>;
  contextSummary?: string | null;
}

export interface SparkRecallGraphView {
  used: boolean;
  project: string;
  centralNodes: Array<{ label: string; summary?: string | null }>;
  likelyRelevantFiles: Array<{ path: string; reason: string }>;
  reportSnippets: Array<{ heading: string | null; text: string }>;
}

const MAX_ITEMS = 8;
const MAX_GRAPH_NODES = 5;
const MAX_GRAPH_FILES = 5;
const MAX_REPORT_SNIPPETS = 2;

/**
 * Pick the project to pull graph depth for: the most frequent project across
 * the ranked matches, ties broken by rank (the higher-ranked project wins).
 */
export function pickDominantProject(pack: SparkRecallPackView | null | undefined): string | null {
  if (!pack?.topMatches?.length) {
    return null;
  }
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  for (const match of pack.topMatches) {
    const project = match.item.project?.trim();
    if (!project) {
      continue;
    }
    const next = (counts.get(project) ?? 0) + 1;
    counts.set(project, next);
    // Strictly-greater keeps the first project to reach the max, so ties break
    // toward the higher-ranked match (earlier in the list).
    if (next > bestCount) {
      bestCount = next;
      best = project;
    }
  }
  return best;
}

/**
 * Render the combined recall + graph context. Returns null when there is
 * nothing worth grounding on (so the tool can stay silent).
 */
export function formatSparkRecall(
  pack: SparkRecallPackView | null | undefined,
  graph?: SparkRecallGraphView | null,
): string | null {
  const sections: string[] = [];

  const memoryLines = (pack?.topMatches ?? [])
    .slice(0, MAX_ITEMS)
    .map(({ item }) => {
      const project = item.project ? `[${item.project}] ` : '';
      const title = item.title ?? item.subject ?? 'memory';
      return `- ${project}${title}: ${item.summary ?? ''}`.trim();
    })
    .filter((line) => line.length > 1);
  if (memoryLines.length > 0) {
    sections.push(memoryLines.join('\n'));
  }

  if (graph?.used) {
    const graphLines: string[] = [];
    const nodes = graph.centralNodes
      .slice(0, MAX_GRAPH_NODES)
      .map((node) => `  - ${node.label}${node.summary ? `: ${node.summary}` : ''}`);
    if (nodes.length > 0) {
      graphLines.push('central code:', ...nodes);
    }
    const files = graph.likelyRelevantFiles
      .slice(0, MAX_GRAPH_FILES)
      .map((file) => `  - ${file.path}${file.reason ? ` (${file.reason})` : ''}`);
    if (files.length > 0) {
      graphLines.push('likely relevant files:', ...files);
    }
    const snippets = graph.reportSnippets
      .slice(0, MAX_REPORT_SNIPPETS)
      .map((snippet) => `  - ${snippet.heading ?? 'note'}`);
    if (snippets.length > 0) {
      graphLines.push('graph report:', ...snippets);
    }
    if (graphLines.length > 0) {
      sections.push(`Graph context (${graph.project}):\n${graphLines.join('\n')}`);
    }
  }

  if (sections.length > 0) {
    return sections.join('\n\n');
  }
  const summary = pack?.contextSummary?.trim();
  return summary && summary.length > 0 ? summary : null;
}
