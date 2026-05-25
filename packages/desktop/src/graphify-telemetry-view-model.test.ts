import { describe, expect, it } from 'vitest';
import { buildGraphifyTelemetrySummary } from './cockpit-metrics.js';

function log(overrides: Partial<VaultLogEntry>): VaultLogEntry {
  return {
    sourceClient: 'codex',
    actionType: 'recall',
    status: 'success',
    message: 'Recalled context with Graphify graph for the-vault',
    timestamp: '2026-05-24T12:00:00.000Z',
    metadata: {
      recallKind: 'graph_context',
      graphTelemetryVersion: 1,
      graphQueriesPerRecall: 1,
      graphFreshness: 'fresh',
      graphFallbackReason: null,
      graphFilesAvoidedEstimate: 4,
      graphEstimatedTokensSaved: 2200,
    },
    ...overrides,
  };
}

describe('Graphify telemetry view model', () => {
  it('aggregates graph query count, fallbacks, freshness mix, tokens saved, and files avoided', () => {
    const summary = buildGraphifyTelemetrySummary([
      log({
        timestamp: '2026-05-24T10:00:00.000Z',
        metadata: {
          recallKind: 'graph_context',
          graphTelemetryVersion: 1,
          graphQueriesPerRecall: 1,
          graphFreshness: 'fresh',
          graphFallbackReason: null,
          graphFilesAvoidedEstimate: 4,
          graphEstimatedTokensSaved: 2200,
        },
      }),
      log({
        timestamp: '2026-05-24T11:00:00.000Z',
        metadata: {
          recallKind: 'graph_context',
          graphTelemetryVersion: 1,
          graphQueriesPerRecall: 1,
          graphFreshness: 'stale',
          graphFallbackReason: null,
          graphFilesAvoidedEstimate: 1,
          graphEstimatedTokensSaved: 500,
        },
      }),
      log({
        timestamp: '2026-05-24T12:00:00.000Z',
        metadata: {
          recallKind: 'graph_context',
          graphTelemetryVersion: 1,
          graphQueriesPerRecall: 0,
          graphFreshness: 'failed',
          graphFallbackReason: 'failed',
          graphFilesAvoidedEstimate: 0,
          graphEstimatedTokensSaved: 0,
        },
      }),
      log({
        timestamp: '2026-05-24T13:00:00.000Z',
        metadata: {
          recallKind: 'latest',
          totalCandidates: 5,
          resultCount: 3,
        },
      }),
    ]);

    expect(summary).toEqual({
      graphContextRecallCount: 3,
      graphQueryCount: 2,
      fallbackCount: 1,
      filesAvoided: 5,
      estimatedTokensSaved: 2700,
      latestTimestamp: '2026-05-24T12:00:00.000Z',
      freshnessMix: {
        fresh: 1,
        stale: 1,
        failed: 1,
      },
      fallbackReasons: [
        { reason: 'failed', count: 1 },
      ],
    });
  });
});
