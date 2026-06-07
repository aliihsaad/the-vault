/**
 * Spark voice-runtime event model — the S3 host → S4 renderer seam.
 *
 * The host `VoiceSession` (S3) emits a stream of `SparkVoiceEvent`s as a
 * conversation unfolds (mic → STT → LLM → tools → TTS). Those events are bridged
 * over IPC to the renderer and folded — with `applySparkVoiceEvent` — into the
 * exact `SparkSessionFrame` prop contract S1 defined and S4 renders
 * (transcript / toolCalls / audioLevel / canvasItems). Keeping the event union
 * here, in core, means both ends (host emitter + renderer reducer) share one
 * source of truth and can be unit-tested without Electron or audio hardware.
 */

import type {
  SparkCanvasItem,
  SparkToolCallEntry,
  SparkTranscriptEntry,
} from './spark-session-frame.js';

/** High-level lifecycle phase of a live voice session. */
export type SparkVoiceStatus = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

/**
 * A single event emitted by the host VoiceSession. Each variant maps to one of
 * the documented session callbacks:
 * - `partialTranscript` / `finalTranscript` → onPartialTranscript / onFinalTranscript (user speech)
 * - `responseText` → onResponseText (streaming assistant text, role 'spark')
 * - `toolCall` → onToolCall (skill/tool invocation lifecycle)
 * - `audioLevel` → onAudioLevel (0..1 mic/output level for the visualizer)
 * - `canvasItem` → canvas surface payloads (S4 renders these)
 * - `error` → onError
 * - `status` → session phase changes (side-channel; not part of the frame)
 */
export type SparkVoiceEvent =
  | { kind: 'partialTranscript'; entry: SparkTranscriptEntry }
  | { kind: 'finalTranscript'; entry: SparkTranscriptEntry }
  | { kind: 'responseText'; entry: SparkTranscriptEntry }
  | { kind: 'toolCall'; entry: SparkToolCallEntry }
  | { kind: 'audioLevel'; level: number; ts: number }
  | { kind: 'canvasItem'; item: SparkCanvasItem; ts: number }
  | { kind: 'error'; message: string; ts: number }
  | { kind: 'status'; status: SparkVoiceStatus; ts: number };

/** The named callback surface a host VoiceSession exposes to its consumers. */
export interface SparkVoiceSessionCallbacks {
  onPartialTranscript?: (entry: SparkTranscriptEntry) => void;
  onFinalTranscript?: (entry: SparkTranscriptEntry) => void;
  onResponseText?: (entry: SparkTranscriptEntry) => void;
  onToolCall?: (entry: SparkToolCallEntry) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (message: string) => void;
  onStatus?: (status: SparkVoiceStatus) => void;
  onCanvasItem?: (item: SparkCanvasItem) => void;
  /** Catch-all firehose — receives every event in emission order. */
  onEvent?: (event: SparkVoiceEvent) => void;
}
