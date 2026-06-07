/**
 * Energy-based voice-activity detection + endpointing (S3a; v5 CaptureAdapter
 * contract, vm_0vFbOo9l8sfyWsJi §2).
 *
 * Pure and deterministic: it consumes normalized audio levels (0..1 RMS) tagged
 * with a timestamp and returns endpointing signals. The hot path never calls a
 * provider/model — the `onset` signal is the local <200ms acknowledgement
 * primitive, fired the instant speech energy crosses the threshold, before any
 * confirmation delay. `speech-start` confirms a real utterance after a short
 * sustain; `speech-end` marks the endpoint after a hangover of silence.
 */

export type SparkVadSignal = 'onset' | 'speech-start' | 'speech-end';

export interface SparkVadOptions {
  /** Level (0..1) at/above which speech energy is present. */
  speechThreshold?: number;
  /** Level below which we count silence (hysteresis; defaults to 60% of speechThreshold). */
  silenceThreshold?: number;
  /** Sustained ms above threshold before a provisional onset becomes a confirmed utterance. */
  minSpeechMs?: number;
  /** Silence ms after speech before the endpoint (`speech-end`) fires. */
  hangoverMs?: number;
}

export interface SparkVadSample {
  level: number;
  ts: number;
}

type VadState = 'idle' | 'onset' | 'speaking';

export interface SparkVad {
  /** Feed one level sample; returns any endpointing signals it produced. */
  process: (sample: SparkVadSample) => SparkVadSignal[];
  /** Force-close an in-flight utterance (e.g. on stop); emits speech-end if speaking. */
  flush: (ts: number) => SparkVadSignal[];
  reset: () => void;
  getState: () => VadState;
}

const DEFAULTS = {
  speechThreshold: 0.08,
  minSpeechMs: 120,
  hangoverMs: 700,
};

export function createSparkVad(options: SparkVadOptions = {}): SparkVad {
  const speechThreshold = options.speechThreshold ?? DEFAULTS.speechThreshold;
  const silenceThreshold = options.silenceThreshold ?? speechThreshold * 0.6;
  const minSpeechMs = options.minSpeechMs ?? DEFAULTS.minSpeechMs;
  const hangoverMs = options.hangoverMs ?? DEFAULTS.hangoverMs;

  let state: VadState = 'idle';
  let onsetTs = 0;
  let lastVoiceTs = 0;

  function process(sample: SparkVadSample): SparkVadSignal[] {
    const { level, ts } = sample;
    const signals: SparkVadSignal[] = [];
    const isVoice = level >= speechThreshold;
    const isSilence = level < silenceThreshold;

    switch (state) {
      case 'idle': {
        if (isVoice) {
          state = 'onset';
          onsetTs = ts;
          lastVoiceTs = ts;
          signals.push('onset'); // immediate local ack primitive
        }
        break;
      }
      case 'onset': {
        if (isVoice) {
          lastVoiceTs = ts;
          if (ts - onsetTs >= minSpeechMs) {
            state = 'speaking';
            signals.push('speech-start');
          }
        } else if (isSilence) {
          // Provisional onset was a blip — revert without emitting an utterance.
          state = 'idle';
        }
        break;
      }
      case 'speaking': {
        if (isVoice) {
          lastVoiceTs = ts;
        } else if (isSilence && ts - lastVoiceTs >= hangoverMs) {
          state = 'idle';
          signals.push('speech-end');
        }
        break;
      }
    }

    return signals;
  }

  function flush(ts: number): SparkVadSignal[] {
    const signals: SparkVadSignal[] = [];
    if (state === 'speaking') {
      signals.push('speech-end');
    }
    state = 'idle';
    return signals;
  }

  function reset(): void {
    state = 'idle';
    onsetTs = 0;
    lastVoiceTs = 0;
  }

  return { process, flush, reset, getState: () => state };
}

// ---------------------------------------------------------------------------
// Pure audio-level helpers. The renderer computes a level per frame and forwards
// it; these keep the math in one tested place. Never trust a requested sample
// rate — the caller passes whatever the AudioContext actually delivered.
// ---------------------------------------------------------------------------

/** Root-mean-square of float samples in [-1, 1], clamped to a 0..1 level. */
export function computeRmsLevel(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) {
    return 0;
  }
  let sumSquares = 0;
  for (let i = 0; i < n; i += 1) {
    const s = samples[i];
    sumSquares += s * s;
  }
  const rms = Math.sqrt(sumSquares / n);
  if (!Number.isFinite(rms) || rms < 0) {
    return 0;
  }
  return rms > 1 ? 1 : rms;
}

/** Convert signed 16-bit PCM to a normalized 0..1 RMS level. */
export function computePcm16Level(pcm: ArrayLike<number>): number {
  const n = pcm.length;
  if (n === 0) {
    return 0;
  }
  let sumSquares = 0;
  for (let i = 0; i < n; i += 1) {
    const s = pcm[i] / 32768;
    sumSquares += s * s;
  }
  const rms = Math.sqrt(sumSquares / n);
  return rms > 1 ? 1 : rms;
}
