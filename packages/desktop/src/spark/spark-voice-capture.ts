/**
 * Renderer microphone capture (S3a; v5 CaptureAdapter, vm_0vFbOo9l8sfyWsJi §2).
 *
 * Web Audio only runs in the renderer, so this module is the thin browser-bound
 * layer: it owns the mic stream, computes a per-frame RMS level, drives local
 * endpointing, records each utterance with MediaRecorder, and forwards levels +
 * captured audio to the host over the injected `SparkVoiceAPI`. Keep this file
 * renderer-self-contained; importing the broad core barrel here pulls Node-only
 * database dependencies into the browser bundle.
 */

export interface SparkVoiceCaptureOptions {
  api: Window['sparkVoiceApi'];
  /** Analyser frame size (power of two). Reported sample rate comes from the context. */
  fftSize?: number;
  /** Speech-energy threshold (0..1) for the local VAD. */
  speechThreshold?: number;
}

export interface SparkVoiceCapture {
  start: () => Promise<void>;
  stop: () => void;
  getSampleRate: () => number | null;
  isCapturing: () => boolean;
}

type SparkVadSignal = 'onset' | 'speech-start' | 'speech-end';
type SparkVadState = 'idle' | 'onset' | 'speaking';

interface SparkVad {
  process: (sample: { level: number; ts: number }) => SparkVadSignal[];
}

function createRendererSparkVad(options: { speechThreshold: number }): SparkVad {
  const speechThreshold = options.speechThreshold;
  const silenceThreshold = speechThreshold * 0.6;
  const minSpeechMs = 120;
  const hangoverMs = 700;
  let state: SparkVadState = 'idle';
  let onsetTs = 0;
  let lastVoiceTs = 0;

  return {
    process({ level, ts }) {
      const signals: SparkVadSignal[] = [];
      const isVoice = level >= speechThreshold;
      const isSilence = level < silenceThreshold;

      if (state === 'idle' && isVoice) {
        state = 'onset';
        onsetTs = ts;
        lastVoiceTs = ts;
        signals.push('onset');
        return signals;
      }

      if (state === 'onset') {
        if (isVoice) {
          lastVoiceTs = ts;
          if (ts - onsetTs >= minSpeechMs) {
            state = 'speaking';
            signals.push('speech-start');
          }
        } else if (isSilence) {
          state = 'idle';
        }
        return signals;
      }

      if (state === 'speaking') {
        if (isVoice) {
          lastVoiceTs = ts;
        } else if (isSilence && ts - lastVoiceTs >= hangoverMs) {
          state = 'idle';
          signals.push('speech-end');
        }
      }

      return signals;
    },
  };
}

function computeRendererRmsLevel(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) {
    return 0;
  }

  let sumSquares = 0;
  for (let i = 0; i < n; i += 1) {
    const sample = samples[i];
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / n);
  if (!Number.isFinite(rms) || rms < 0) {
    return 0;
  }

  return rms > 1 ? 1 : rms;
}

export function createSparkVoiceCapture(options: SparkVoiceCaptureOptions): SparkVoiceCapture {
  const { api } = options;
  let audioContext: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let recorder: MediaRecorder | null = null;
  let rafId: number | null = null;
  let capturing = false;
  const vad: SparkVad = createRendererSparkVad({ speechThreshold: options.speechThreshold ?? 0.08 });
  let recordedChunks: Blob[] = [];

  async function start(): Promise<void> {
    if (capturing) {
      return;
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = options.fftSize ?? 2048;
    source.connect(analyser);

    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      void flushUtterance();
    };

    capturing = true;
    pump();
  }

  function pump(): void {
    if (!analyser) {
      return;
    }
    const buffer = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!capturing || !analyser) {
        return;
      }
      analyser.getFloatTimeDomainData(buffer);
      const level = computeRendererRmsLevel(buffer);
      const ts = audioContext ? audioContext.currentTime * 1000 : Date.now();
      api.sendAudioLevel(level, ts);

      const signals = vad.process({ level, ts });
      if (signals.includes('speech-start') && recorder && recorder.state === 'inactive') {
        recordedChunks = [];
        recorder.start();
      }
      if (signals.includes('speech-end') && recorder && recorder.state === 'recording') {
        recorder.stop();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  async function flushUtterance(): Promise<void> {
    if (recordedChunks.length === 0) {
      return;
    }
    const blob = new Blob(recordedChunks, { type: recordedChunks[0].type || 'audio/webm' });
    recordedChunks = [];
    const buffer = await blob.arrayBuffer();
    await api.sendAudioUtterance(buffer, blob.type);
  }

  function stop(): void {
    capturing = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
    recorder = null;
    analyser = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    if (audioContext) {
      void audioContext.close();
      audioContext = null;
    }
  }

  return {
    start,
    stop,
    getSampleRate: () => audioContext?.sampleRate ?? null,
    isCapturing: () => capturing,
  };
}
