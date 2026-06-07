import { describe, expect, it } from 'vitest';

import {
  computePcm16Level,
  computeRmsLevel,
  createSparkVad,
  type SparkVadSignal,
} from './services/spark-voice/spark-voice-vad.js';

/** Drive the VAD with a level/duration script at a fixed frame interval. */
function runVad(
  vad: ReturnType<typeof createSparkVad>,
  frames: Array<{ level: number; ms: number }>,
  frameMs = 20,
): { signals: SparkVadSignal[]; onsetTs: number | null } {
  const signals: SparkVadSignal[] = [];
  let ts = 0;
  let onsetTs: number | null = null;
  for (const frame of frames) {
    const count = Math.max(1, Math.round(frame.ms / frameMs));
    for (let i = 0; i < count; i += 1) {
      const produced = vad.process({ level: frame.level, ts });
      for (const sig of produced) {
        if (sig === 'onset' && onsetTs === null) {
          onsetTs = ts;
        }
        signals.push(sig);
      }
      ts += frameMs;
    }
  }
  return { signals, onsetTs };
}

describe('createSparkVad (endpointing + <200ms onset ack)', () => {
  it('fires onset on the very first speech frame (local ack primitive)', () => {
    const vad = createSparkVad({ speechThreshold: 0.1 });
    const first = vad.process({ level: 0.5, ts: 0 });
    expect(first).toContain('onset');
    // The ack primitive is immediate — no sustain wait, no model call.
  });

  it('confirms speech-start only after the sustain window, then ends after hangover', () => {
    const vad = createSparkVad({ speechThreshold: 0.1, minSpeechMs: 120, hangoverMs: 400 });
    const { signals, onsetTs } = runVad(vad, [
      { level: 0.5, ms: 400 }, // sustained speech
      { level: 0.0, ms: 600 }, // trailing silence > hangover
    ]);
    expect(onsetTs).toBe(0);
    expect(signals).toContain('onset');
    expect(signals).toContain('speech-start');
    expect(signals).toContain('speech-end');
    // Ordering: onset → speech-start → speech-end.
    expect(signals.indexOf('onset')).toBeLessThan(signals.indexOf('speech-start'));
    expect(signals.indexOf('speech-start')).toBeLessThan(signals.indexOf('speech-end'));
  });

  it('rejects a single-frame blip as not a real utterance', () => {
    const vad = createSparkVad({ speechThreshold: 0.1, minSpeechMs: 120, hangoverMs: 300 });
    const { signals } = runVad(vad, [
      { level: 0.5, ms: 20 }, // one loud frame
      { level: 0.0, ms: 400 }, // immediate silence
    ]);
    expect(signals).toEqual(['onset']); // onset fired, but reverted with no speech-start/end
    expect(vad.getState()).toBe('idle');
  });

  it('does not end prematurely on a brief dip shorter than the hangover', () => {
    const vad = createSparkVad({ speechThreshold: 0.1, minSpeechMs: 60, hangoverMs: 400 });
    const { signals } = runVad(vad, [
      { level: 0.5, ms: 200 }, // speech
      { level: 0.0, ms: 200 }, // dip < hangover
      { level: 0.5, ms: 200 }, // speech resumes
      { level: 0.0, ms: 600 }, // real endpoint
    ]);
    // Exactly one utterance: one start, one end.
    expect(signals.filter((s) => s === 'speech-start')).toHaveLength(1);
    expect(signals.filter((s) => s === 'speech-end')).toHaveLength(1);
  });

  it('flush() closes an in-flight utterance on stop', () => {
    const vad = createSparkVad({ speechThreshold: 0.1, minSpeechMs: 40 });
    vad.process({ level: 0.5, ts: 0 });
    vad.process({ level: 0.5, ts: 50 }); // confirmed speaking
    expect(vad.getState()).toBe('speaking');
    expect(vad.flush(100)).toContain('speech-end');
    expect(vad.getState()).toBe('idle');
  });
});

describe('audio level helpers', () => {
  it('computes RMS level of float samples and clamps to 0..1', () => {
    expect(computeRmsLevel([])).toBe(0);
    expect(computeRmsLevel([0, 0, 0])).toBe(0);
    expect(computeRmsLevel([1, -1, 1, -1])).toBe(1);
    const mid = computeRmsLevel([0.5, -0.5, 0.5, -0.5]);
    expect(mid).toBeCloseTo(0.5, 5);
  });

  it('converts PCM16 to a normalized level', () => {
    expect(computePcm16Level([])).toBe(0);
    expect(computePcm16Level([32767, -32768, 32767, -32768])).toBeCloseTo(1, 2);
    expect(computePcm16Level([0, 0, 0])).toBe(0);
  });
});
