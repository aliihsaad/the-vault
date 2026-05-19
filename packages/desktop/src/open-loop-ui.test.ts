import { describe, expect, it } from 'vitest';

import {
  buildLoopControlModel,
  buildOpenLoopFocusList,
  describeOpenLoopSignals,
  getOpenLoopPressure,
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

  it('scores stale high-priority loops as stronger pressure signals', () => {
    expect(getOpenLoopPressure(loop({ bucket: 'low', daysOpen: 0, score: 4 }))).toBeLessThan(35);
    expect(getOpenLoopPressure(loop({ bucket: 'high', daysOpen: 16, score: 42 }))).toBe(100);
  });

  it('builds a filtered control-board model with counts and selected-loop fallback', () => {
    const loops = [
      loop({ itemUid: 'selected-out', project: 'alpha', bucket: 'medium', routineType: 'planning', tags: ['roadmap'], score: 90 }),
      loop({ itemUid: 'match-1', project: 'beta', bucket: 'high', routineType: 'debugging', tags: ['bug'], daysOpen: 9, score: 60 }),
      loop({ itemUid: 'match-2', project: 'beta', bucket: 'high', routineType: 'debugging', tags: ['bug', 'release'], daysOpen: 14, score: 44 }),
      loop({ itemUid: 'other', project: 'beta', bucket: 'low', routineType: 'review', tags: ['bug'], score: 80 }),
    ];

    const model = buildLoopControlModel(loops, {
      project: 'beta',
      bucket: 'high',
      routine: 'debugging',
      tag: 'bug',
      selectedItemUid: 'selected-out',
    });

    expect(model.metrics).toMatchObject({
      total: 4,
      visible: 2,
      high: 2,
      stale: 2,
      critical: 1,
      projectCount: 2,
    });
    expect(model.visible.map((item) => item.loop.itemUid)).toEqual(['match-1', 'match-2']);
    expect(model.selected?.loop.itemUid).toBe('match-1');
    expect(model.projects).toEqual(['alpha', 'beta']);
    expect(model.tags).toEqual(['bug', 'release', 'roadmap']);
  });
});
