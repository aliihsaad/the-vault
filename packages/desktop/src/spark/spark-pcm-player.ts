/**
 * Streamed PCM player for the realtime Spark pipeline. The FreeLLMAPI realtime
 * socket returns 24kHz mono 16-bit little-endian PCM chunks (base64); this
 * schedules them back-to-back through a single AudioContext so a turn plays gap
 * free. Renderer-only (Web Audio); mirrors whispry's VoiceAudioPlayer.
 */

const DEFAULT_SAMPLE_RATE = 24000;

export interface SparkPcmPlayer {
  /** Queue a base64 PCM chunk for playback. mimeType may carry `;rate=NNNNN`. */
  play: (base64Pcm: string, mimeType: string) => void;
  /** Stop and flush all scheduled audio (barge-in / session stop). */
  stop: () => void;
}

export function createBrowserSparkPcmPlayer(): SparkPcmPlayer {
  let ctx: AudioContext | null = null;
  let nextPlaybackTime = 0;
  const active = new Set<AudioBufferSourceNode>();

  function ensureContext(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
      nextPlaybackTime = 0;
    }
    return ctx;
  }

  return {
    play(base64Pcm, mimeType) {
      if (!base64Pcm) {
        return;
      }
      const context = ensureContext();
      const sampleRate = parseSampleRate(mimeType, DEFAULT_SAMPLE_RATE);
      const floats = pcm16ToFloat32(base64ToUint8(base64Pcm));
      if (floats.length === 0) {
        return;
      }

      const buffer = context.createBuffer(1, floats.length, sampleRate);
      buffer.getChannelData(0).set(floats);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);

      const now = context.currentTime;
      const startAt = Math.max(now, nextPlaybackTime);
      source.start(startAt);
      nextPlaybackTime = startAt + buffer.duration;

      active.add(source);
      source.addEventListener('ended', () => active.delete(source));
    },
    stop() {
      for (const source of active) {
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
      }
      active.clear();
      nextPlaybackTime = ctx ? ctx.currentTime : 0;
    },
  };
}

function parseSampleRate(mimeType: string, fallback: number): number {
  const match = /rate=(\d+)/i.exec(mimeType || '');
  if (!match) {
    return fallback;
  }
  const rate = Number.parseInt(match[1], 10);
  return Number.isFinite(rate) && rate > 0 ? rate : fallback;
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}
