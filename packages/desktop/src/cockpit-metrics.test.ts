import { describe, expect, it } from 'vitest';

import {
  buildActivitySeries,
  buildMemoryWorkspaceSummary,
  buildProjectCockpitRows,
  buildRecallSummary,
  buildRecallTrend,
  buildRelationshipGraphPreview,
  estimateTokensSaved,
  extractResultCount,
  extractTotalCandidates,
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

  it('derives project cockpit rows from real project, workspace, log, memory, and loop inputs', () => {
    const rows = buildProjectCockpitRows({
      projects: [
        { id: 1, name: 'the-vault', description: 'Memory system', createdAt: '', updatedAt: '', memoryCount: 12 },
        { id: 2, name: 'other', description: null, createdAt: '', updatedAt: '', memoryCount: 2 },
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
      [{ id: 1, name: 'the-vault', description: null, createdAt: '', updatedAt: '', memoryCount: 2 }],
    );

    expect(graph.nodes.some((node) => node.id === 'project:the-vault')).toBe(true);
    expect(graph.nodes.some((node) => node.id === 'file:packages/desktop/src/App.tsx')).toBe(true);
    expect(graph.links.map((link) => link.kind)).toContain('related-memory');
    expect(graph.linkedFileCount).toBe(1);
  });
});
