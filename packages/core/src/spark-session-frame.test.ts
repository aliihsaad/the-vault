import { describe, expect, it } from 'vitest';

import {
  clampSparkAudioLevel,
  createEmptySparkSessionFrame,
  type SparkSessionFrame,
} from './types/spark-session-frame.js';

describe('spark session frame contract', () => {
  it('creates an inert empty session frame with honest empty defaults', () => {
    const frame = createEmptySparkSessionFrame();

    expect(frame).toEqual({
      transcript: [],
      toolCalls: [],
      audioLevel: 0,
      canvasItems: [],
    } satisfies SparkSessionFrame);
  });

  it('returns independent array instances on each call', () => {
    const first = createEmptySparkSessionFrame();
    const second = createEmptySparkSessionFrame();

    first.transcript.push({ id: 't1', role: 'user', text: 'hi', final: true, ts: 1 });
    first.toolCalls.push({ id: 'c1', name: 'noop', status: 'pending', ts: 1 });
    first.canvasItems.push({ id: 'k1', kind: 'markdown', payload: null });

    expect(second.transcript).toEqual([]);
    expect(second.toolCalls).toEqual([]);
    expect(second.canvasItems).toEqual([]);
  });

  it('clamps audio level into the 0..1 visualizer range', () => {
    expect(clampSparkAudioLevel(0)).toBe(0);
    expect(clampSparkAudioLevel(0.5)).toBe(0.5);
    expect(clampSparkAudioLevel(1)).toBe(1);
    expect(clampSparkAudioLevel(1.5)).toBe(1);
    expect(clampSparkAudioLevel(-2)).toBe(0);
    expect(clampSparkAudioLevel(Number.NaN)).toBe(0);
  });
});
