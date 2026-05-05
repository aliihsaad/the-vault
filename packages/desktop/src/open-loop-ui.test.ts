import { describe, expect, it } from 'vitest';

import {
  buildOpenLoopFocusList,
  describeOpenLoopSignals,
  getOpenLoopNextAction,
  getOpenLoopStaleness,
} from './open-loop-ui.js';

function loop(overrides: Partial<VaultOpenLoop>): VaultOpenLoop {
  return {
    itemUid: overrides.itemUid || 'vm_test',
    title: overrides.title || 'Open loop',
    project: overrides.project || 'the-vault',
    memoryType: overrides.memoryType || 'session',
    subject: overrides.subject || 'test',
    summary: overrides.summary || 'summary',
    priority: overrides.priority || 'high',
    routineType: overrides.routineType ?? 'implementation',
    tags: overrides.tags || [],
    nextSteps: overrides.nextSteps || ['Do the next thing'],
    lastUpdated: overrides.lastUpdated || new Date().toISOString(),
    lastAccessedAt: overrides.lastAccessedAt || null,
    daysOpen: overrides.daysOpen ?? 0,
    score: overrides.score ?? 10,
    bucket: overrides.bucket || 'medium',
    recentlyReferenced: overrides.recentlyReferenced || false,
  };
}

describe('open loop UI helpers', () => {
  it('turns passive age into explicit staleness labels', () => {
    expect(getOpenLoopStaleness(0)).toMatchObject({ tone: 'fresh', label: 'Today' });
    expect(getOpenLoopStaleness(3)).toMatchObject({ tone: 'watch', label: '3d' });
    expect(getOpenLoopStaleness(9)).toMatchObject({ tone: 'stale', label: 'Stale 9d' });
    expect(getOpenLoopStaleness(17)).toMatchObject({ tone: 'critical', label: 'Stale 17d' });
  });

  it('explains why a row is important with routine, staleness, score, and recent reference signals', () => {
    expect(describeOpenLoopSignals(loop({
      routineType: 'debugging',
      daysOpen: 18,
      score: 52,
      recentlyReferenced: true,
    }))).toBe('debugging - stale 18d - score 52 - recently referenced');
  });

  it('selects a short today focus list from highest-scoring high priority loops', () => {
    const loops = [
      loop({ itemUid: 'low', bucket: 'low', score: 99, daysOpen: 30 }),
      loop({ itemUid: 'second', bucket: 'high', score: 40, daysOpen: 18 }),
      loop({ itemUid: 'first', bucket: 'high', score: 55, daysOpen: 4 }),
      loop({ itemUid: 'third', bucket: 'high', score: 40, daysOpen: 21 }),
      loop({ itemUid: 'medium', bucket: 'medium', score: 60, daysOpen: 10 }),
    ];

    expect(buildOpenLoopFocusList(loops, 3).map((item) => item.itemUid)).toEqual(['first', 'third', 'second']);
  });

  it('uses a fallback command for stagnant debugging loops without next steps', () => {
    expect(getOpenLoopNextAction(loop({ routineType: 'debugging', nextSteps: [] }))).toBe('Reproduce or resolve this debugging thread');
    expect(getOpenLoopNextAction(loop({ nextSteps: ['Write implementation plan'] }))).toBe('Write implementation plan');
  });
});
