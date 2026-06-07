/**
 * Realtime mic capture for the Spark FreeLLMAPI pipeline. Captures the mic at
 * 16kHz mono, converts each frame to 16-bit PCM, and streams it (base64) to the
 * host over `sparkVoiceApi.sendPcmChunk`. The server does VAD/STT, so capture is
 * continuous while the session is live. Also emits an RMS level for the
 * visualizer. Renderer-only (Web Audio); mirrors whispry's AudioCapture.
 *
 * Keep this file renderer-self-contained — importing the broad core barrel here
 * would pull Node-only database deps into the browser bundle.
 */

export interface SparkPcmCaptureOptions {
  api: Window['sparkVoiceApi'];
  /** Requested capture sample rate (the server expects 16kHz). */
  sampleRate?: number;
}

export interface SparkPcmCapture {
  start: () => Promise<void>;
  stop: () => void;
  isCapturing: () => boolean;
}

export function createSparkPcmCapture(options: SparkPcmCaptureOptions): SparkPcmCapture {
  const { api } = options;
  const targetRate = options.sampleRate ?? 16000;
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let silentSink: GainNode | null = null;
  let capturing = false;

  async function start(): Promise<void> {
    if (capturing) {
      return;
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: targetRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    context = new AudioContext({ sampleRate: targetRate });
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    // A ScriptProcessor only fires onaudioprocess when connected to a destination;
    // route it through a muted gain so nothing is actually played back.
    silentSink = context.createGain();
    silentSink.gain.value = 0;

    processor.onaudioprocess = (event) => {
      if (!capturing) {
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      api.sendAudioLevel(computeRms(input));
      api.sendPcmChunk(floatToBase64Pcm16(input));
    };

    source.connect(processor);
    processor.connect(silentSink);
    silentSink.connect(context.destination);
    capturing = true;
  }

  function stop(): void {
    capturing = false;
    processor?.disconnect();
    source?.disconnect();
    silentSink?.disconnect();
    processor = null;
    source = null;
    silentSink = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    if (context) {
      void context.close();
      context = null;
    }
  }

  return {
    start,
    stop,
    isCapturing: () => capturing,
  };
}

function computeRms(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sumSquares += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  if (!Number.isFinite(rms) || rms < 0) {
    return 0;
  }
  return rms > 1 ? 1 : rms;
}

function floatToBase64Pcm16(samples: Float32Array): string {
  const pcm = new Uint8Array(samples.length * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  let binary = '';
  for (let i = 0; i < pcm.length; i += 1) {
    binary += String.fromCharCode(pcm[i]);
  }
  return btoa(binary);
}
