import { describe, expect, it } from 'vitest';

import {
  buildActivitySeries,
  buildMemoryWorkspaceSummary,
  filterProjectCockpitRows,
  buildProjectCockpitRows,
  buildRecallSummary,
  buildRecallTrend,
  buildRelationshipGraphPreview,
  estimateTokensSaved,
  extractResultCount,
  extractTotalCandidates,
  getOverviewTelemetryDateFrom,
  getOperationalAnalyticsDateFrom,
  OVERVIEW_TELEMETRY_DAYS,
  OVERVIEW_TELEMETRY_LOG_LIMIT,
  OPERATIONAL_ANALYTICS_DAYS,
  OPERATIONAL_ANALYTICS_LOG_LIMIT,
} from './cockpit-metrics.js';

function log(overrides: Partial<VaultLogEntry>): VaultLogEntry {
  return {
    sourceClient: 'codex',
    actionType: 'recall',
    status: 'success',
    message: 'Recalled 3 items from 12 candidates',
    timestamp: '2026-05-18T12:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

function memory(overrides: Partial<VaultMemory>): VaultMemory {
  return {
    id: 1,
    itemUid: overrides.itemUid || 'vm_test',
    title: overrides.title || 'Memory item',
    project: overrides.project || 'the-vault',
    sourceApp: 'codex',
    sourceSessionId: null,
    memoryType: overrides.memoryType || 'session',
    subject: 'subject',
    summary: 'summary',
    content: null,
    keywords: [],
    tags: [],
    routineType: null,
    status: 'active',
    priority: 'normal',
    promoted: false,
    nextSteps: [],
    relatedItemIds: [],
    relatedFiles: [],
    vaultPath: null,
    createdAt: '2026-05-18T12:00:00.000Z',
    updatedAt: '2026-05-18T12:00:00.000Z',
    lastAccessedAt: null,
    accessCount: 0,
    snoozedUntil: null,
    outcome: null,
    ...overrides,
  };
}

describe('cockpit metrics', () => {
  it('extracts recall counts from metadata before parsing log copy', () => {
    expect(extractTotalCandidates(log({ metadata: { totalCandidates: 42 }, message: 'Recalled 1 item from 2 candidates' }))).toBe(42);
    expect(extractResultCount(log({ metadata: { resultCount: 9 }, message: 'Recalled 1 item from 2 candidates' }))).toBe(9);
    expect(extractTotalCandidates(log({ metadata: {}, message: 'Recalled 4 items from 19 candidates' }))).toBe(19);
    expect(extractResultCount(log({ metadata: {}, message: 'Recalled 4 items from 19 candidates' }))).toBe(4);
  });

  it('builds honest seven-day recall trend rows with estimated savings', () => {
    const trend = buildRecallTrend(
      [
        log({ timestamp: '2026-05-17T10:00:00.000Z', metadata: { totalCandidates: 10, resultCount: 2 } }),
        log({ timestamp: '2026-05-18T10:00:00.000Z', metadata: { totalCandidates: 20, resultCount: 4 } }),
        log({ actionType: 'save', timestamp: '2026-05-18T11:00:00.000Z' }),
      ],
      2,
      { topMatchLimit: 4, detailExpansionLimit: 2 },
      new Date('2026-05-18T12:00:00.000Z'),
    );

    expect(trend).toHaveLength(2);
    expect(trend[0]).toMatchObject({ isoDate: '2026-05-17', recallCount: 1, candidates: 10, returned: 2 });
    expect(trend[1]).toMatchObject({ isoDate: '2026-05-18', recallCount: 1, candidates: 20, returned: 4 });
    expect(trend[1].tokensSaved).toBe(estimateTokensSaved(20, 4, { topMatchLimit: 4, detailExpansionLimit: 2 }));
  });

  it('summarizes recall efficiency for the CTA band', () => {
    const summary = buildRecallSummary(
      [
        log({ timestamp: '2026-05-17T10:00:00.000Z', metadata: { totalCandidates: 10, resultCount: 2, topScore: 61 } }),
        log({ timestamp: '2026-05-18T10:00:00.000Z', metadata: { totalCandidates: 20, resultCount: 4, topScore: 89 } }),
        log({ actionType: 'save', timestamp: '2026-05-18T11:00:00.000Z', metadata: { totalCandidates: 100, resultCount: 100, topScore: 100 } }),
      ],
      { topMatchLimit: 4, detailExpansionLimit: 2 },
      new Date('2026-05-18T12:00:00.000Z'),
    );

    expect(summary).toMatchObject({
      recallCount: 2,
      todayRecallCount: 1,
      totalCandidates: 30,
      totalReturned: 6,
      candidateReductionRatio: 0.8,
      averageTopScore: 75,
      latestTimestamp: '2026-05-18T10:00:00.000Z',
    });
    expect(summary.tokensSaved14d).toBe(
      estimateTokensSaved(10, 2, { topMatchLimit: 4, detailExpansionLimit: 2 })
      + estimateTokensSaved(20, 4, { topMatchLimit: 4, detailExpansionLimit: 2 }),
    );
  });

  it('summarizes filtered memory workspaces for Handoffs and Decisions CTAs', () => {
    const summary = buildMemoryWorkspaceSummary(
      [
        memory({
          project: 'the-vault',
          promoted: true,
          priority: 'high',
          status: 'active',
          nextSteps: ['Ship release'],
          updatedAt: '2026-05-18T12:00:00.000Z',
        }),
        memory({
          project: 'the-vault',
          status: 'resolved',
          nextSteps: [],
          updatedAt: '2026-05-10T12:00:00.000Z',
        }),
        memory({
          project: 'other',
          priority: 'critical',
          status: 'draft',
          nextSteps: ['Review'],
          updatedAt: '2026-05-16T12:00:00.000Z',
        }),
      ],
      new Date('2026-05-18T12:00:00.000Z'),
    );

    expect(summary).toMatchObject({
      total: 3,
      promotedCount: 1,
      withNextSteps: 2,
      projectCount: 2,
      activeCount: 1,
      resolvedCount: 1,
      highPriorityCount: 2,
      recentCount: 2,
      latestTimestamp: '2026-05-18T12:00:00.000Z',
    });
  });

  it('uses unique activity keys even when weekday labels repeat', () => {
    const series = buildActivitySeries(
      [
        log({ actionType: 'save', timestamp: '2026-05-09T10:00:00.000Z' }),
        log({ actionType: 'update', timestamp: '2026-05-16T10:00:00.000Z' }),
      ],
      14,
      new Date('2026-05-19T12:00:00.000Z'),
    );

    const saturdayRows = series.filter((row) => row.label === 'Sat');

    expect(saturdayRows).toHaveLength(2);
    expect(new Set(saturdayRows.map((row) => row.key)).size).toBe(2);
    expect(saturdayRows.map((row) => row.total)).toEqual([1, 1]);
  });

  it('keeps every overview activity day visible with zero-filled gaps', () => {
    const series = buildActivitySeries(
      [
        log({ actionType: 'recall', timestamp: '2026-05-14T10:00:00.000Z' }),
        log({ actionType: 'save', timestamp: '2026-05-18T10:00:00.000Z' }),
      ],
      OVERVIEW_TELEMETRY_DAYS,
      new Date('2026-05-18T12:00:00.000Z'),
    );

    expect(series).toHaveLength(7);
    expect(series.map((row) => row.total)).toEqual([0, 0, 1, 0, 0, 0, 1]);
    expect(series[0]).toMatchObject({ save: 0, recall: 0, update: 0, error: 0, total: 0 });
    expect(series[2]).toMatchObject({ recall: 1, total: 1 });
    expect(series[6]).toMatchObject({ save: 1, total: 1 });
  });

  it('uses an explicit seven-day window for overview operational telemetry logs', () => {
    const start = new Date(getOverviewTelemetryDateFrom(new Date(2026, 4, 28, 15, 30)));

    expect(OVERVIEW_TELEMETRY_DAYS).toBe(7);
    expect(OVERVIEW_TELEMETRY_LOG_LIMIT).toBeGreaterThan(500);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(4);
    expect(start.getDate()).toBe(22);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it('uses an explicit full fourteen-day window for operational analytics logs', () => {
    const start = new Date(getOperationalAnalyticsDateFrom(new Date(2026, 4, 28, 15, 30)));

    expect(OPERATIONAL_ANALYTICS_DAYS).toBe(14);
    expect(OPERATIONAL_ANALYTICS_LOG_LIMIT).toBeGreaterThan(500);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(4);
    expect(start.getDate()).toBe(15);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it('derives project cockpit rows from real project, workspace, log, memory, and loop inputs', () => {
    const rows = buildProjectCockpitRows({
      projects: [
        { id: 1, name: 'the-vault', slug: 'the-vault', description: 'Memory system', createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '', memoryCount: 12 },
        { id: 2, name: 'other', slug: 'other', description: null, createdAt: '', updatedAt: '', memoryCount: 2 },
      ],
      momentum: [
        { name: 'the-vault', last7dCount: 5, prior7dCount: 2, delta: 3, direction: 'up', lastActivityAt: '2026-05-18T00:00:00.000Z' },
      ],
      workspaces: [
        { project: 'the-vault', workspacePath: 'C:/repo/the-vault', trusted: true, gitRootDetected: true, lastValidatedAt: '', notes: null },
      ],
      memories: [memory({ project: 'other' })],
      logs: [log({ project: 'the-vault' }), log({ project: 'the-vault', actionType: 'save' })],
      openLoops: [
        {
          itemUid: 'loop',
          title: 'Loop',
          project: 'the-vault',
          memoryType: 'session',
          subject: 'subject',
          summary: 'summary',
          priority: 'high',
          routineType: 'implementation',
          tags: [],
          nextSteps: ['Continue'],
          lastUpdated: '',
          lastAccessedAt: null,
          daysOpen: 1,
          score: 10,
          bucket: 'high',
          recentlyReferenced: false,
        },
      ],
    });

    expect(rows[0]).toMatchObject({
      name: 'the-vault',
      slug: 'the-vault',
      createdAt: '2026-05-01T00:00:00.000Z',
      memoryCount: 12,
      last7dCount: 5,
      openLoopCount: 1,
      workspacePath: 'C:/repo/the-vault',
      workspaceTrusted: true,
      logCount: 2,
    });
    expect(rows[0]).not.toHaveProperty('qualityScore');
    expect(rows[0]).not.toHaveProperty('taskPressureScore');
  });

  it('keeps every project cockpit row available while filtering by name and description', () => {
    const rows = buildProjectCockpitRows({
      projects: Array.from({ length: 18 }, (_, index) => ({
        id: index + 1,
        name: `project-${index + 1}`,
        slug: `project-${index + 1}`,
        description: index === 16 ? 'Needle project with archival notes' : 'General project notes',
        createdAt: `2026-05-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        updatedAt: '',
        memoryCount: index + 1,
      })),
      momentum: [],
      workspaces: [],
      memories: [],
      logs: [],
      openLoops: [],
    });

    expect(rows).toHaveLength(18);
    expect(filterProjectCockpitRows(rows, '')).toHaveLength(18);
    expect(filterProjectCockpitRows(rows, 'needle')).toMatchObject([
      { name: 'project-17', createdAt: '2026-05-17T00:00:00.000Z' },
    ]);
  });

  it('builds a relationship graph only from actual project, memory, file, and related-item data', () => {
    const graph = buildRelationshipGraphPreview(
      [
        memory({
          itemUid: 'vm_a',
          title: 'Decision A',
          memoryType: 'decision',
          project: 'the-vault',
          relatedItemIds: ['vm_b'],
          relatedFiles: ['packages/desktop/src/App.tsx'],
        }),
        memory({ itemUid: 'vm_b', title: 'Handoff B', memoryType: 'handoff', project: 'the-vault' }),
      ],
      [{ id: 1, name: 'the-vault', slug: 'the-vault', description: null, createdAt: '', updatedAt: '', memoryCount: 2 }],
    );

    expect(graph.nodes.some((node) => node.id === 'project:the-vault')).toBe(true);
    expect(graph.nodes.some((node) => node.id === 'file:packages/desktop/src/App.tsx')).toBe(true);
    expect(graph.links.map((link) => link.kind)).toContain('related-memory');
    expect(graph.linkedFileCount).toBe(1);
  });
});
