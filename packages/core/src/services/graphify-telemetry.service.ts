import type {
  GraphifyRecallContextResult,
  GraphifyRecallTelemetry,
} from '../types/graphify.js';

const TELEMETRY_VERSION = 1;
const ESTIMATED_BROAD_FILE_READ_TOKENS = 600;

type GraphifyRecallTelemetryResultInput = Omit<GraphifyRecallContextResult, 'telemetry'> & {
  telemetry?: GraphifyRecallTelemetry;
};

export interface BuildGraphifyRecallTelemetryInput {
  result: GraphifyRecallTelemetryResultInput;
  broadSearchFileBaseline?: number;
}

export function buildGraphifyRecallTelemetry(
  input: BuildGraphifyRecallTelemetryInput,
): GraphifyRecallTelemetry {
  const { result } = input;
  const graphUsed = result.graph.used;
  const suggestedFileReadCount = result.suggestedNextFileReads.length;
  const graphCandidateFileCount = collectGraphCandidateFiles(result).length;
  const derivedBaseline = Math.max(graphCandidateFileCount, suggestedFileReadCount);
  const broadSearchFileBaseline = graphUsed
    ? Math.max(positiveInt(input.broadSearchFileBaseline, derivedBaseline), suggestedFileReadCount)
    : Math.max(positiveInt(input.broadSearchFileBaseline, derivedBaseline), 0);
  const filesAvoidedEstimate = graphUsed
    ? Math.max(broadSearchFileBaseline - suggestedFileReadCount, 0)
    : 0;
  const contextPackTokenEstimate = Math.max(0, Math.floor(result.budget.estimatedTokens));
  const estimatedBroadSearchTokens = graphUsed
    ? broadSearchFileBaseline * ESTIMATED_BROAD_FILE_READ_TOKENS
    : 0;
  const estimatedTokensSaved = graphUsed
    ? Math.max(estimatedBroadSearchTokens - contextPackTokenEstimate, 0)
    : 0;

  return {
    version: TELEMETRY_VERSION,
    graphUsed,
    graphQueriesPerRecall: graphUsed && result.graph.query?.status === 'available' ? 1 : 0,
    graphFreshness: result.graph.freshness,
    graphFallbackReason: result.graph.fallbackReason,
    broadSearchFileBaseline,
    graphCandidateFileCount,
    suggestedFileReadCount,
    filesAvoidedEstimate,
    contextPackTokenEstimate,
    estimatedBroadSearchTokens,
    estimatedTokensSaved,
    estimationMethod: 'graph-guided-file-baseline-v1',
  };
}

export function toGraphifyTelemetryLogMetadata(
  telemetry: GraphifyRecallTelemetry,
): Record<string, unknown> {
  return {
    graphTelemetryVersion: telemetry.version,
    graphUsed: telemetry.graphUsed,
    graphQueriesPerRecall: telemetry.graphQueriesPerRecall,
    graphFreshness: telemetry.graphFreshness,
    graphFallbackReason: telemetry.graphFallbackReason,
    graphBroadSearchFileBaseline: telemetry.broadSearchFileBaseline,
    graphCandidateFileCount: telemetry.graphCandidateFileCount,
    graphSuggestedFileReadCount: telemetry.suggestedFileReadCount,
    graphFilesAvoidedEstimate: telemetry.filesAvoidedEstimate,
    graphContextPackTokens: telemetry.contextPackTokenEstimate,
    graphEstimatedBroadSearchTokens: telemetry.estimatedBroadSearchTokens,
    graphEstimatedTokensSaved: telemetry.estimatedTokensSaved,
    graphTelemetryEstimationMethod: telemetry.estimationMethod,
  };
}

function collectGraphCandidateFiles(result: GraphifyRecallTelemetryResultInput): string[] {
  const values = [
    ...result.suggestedNextFileReads,
    ...(result.graph.query?.suggestedFileReads ?? []),
    ...result.graph.likelyRelevantFiles.map((file) => file.path),
    ...result.graph.tests.map((file) => file.path),
    ...result.graph.centralNodes.map((node) => node.path).filter((path): path is string => Boolean(path)),
    ...result.graph.shortestPaths.flatMap((path) => path.path.map((node) => node.path).filter((nodePath): nodePath is string => Boolean(nodePath))),
    ...result.recall.topMatches.flatMap((match) => match.item.relatedFiles),
    ...result.recall.related.flatMap((item) => item.relatedFiles),
    ...result.recall.proactive.flatMap((item) => item.relatedFiles),
  ];

  return uniqueStrings(values);
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
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
