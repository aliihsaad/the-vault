/**
 * Spark session-frame prop contract — the S3→S4 seam.
 *
 * S1 produces this typed contract and renders four INERT panels against it
 * (transcript, tool-call log, voice visualizer, canvas). S3 wires the real
 * voice runtime and S4 fills these arrays with live event data. In S1 every
 * field is empty / zero by design: no fake live affordances.
 */

export type SparkTranscriptRole = 'user' | 'spark';

/** A single transcript turn. `final` distinguishes partial vs settled text. */
export interface SparkTranscriptEntry {
  id: string;
  role: SparkTranscriptRole;
  text: string;
  final: boolean;
  ts: number;
}

export type SparkToolCallStatus = 'pending' | 'running' | 'done' | 'error';

/** A tool/skill invocation surfaced in the tool-call log. */
export interface SparkToolCallEntry {
  id: string;
  name: string;
  args?: unknown;
  status: SparkToolCallStatus;
  result?: unknown;
  ts: number;
}

/** A renderable item placed on the conversation canvas. */
export interface SparkCanvasItem {
  id: string;
  kind: string;
  payload: unknown;
}

/**
 * The complete set of typed props the live session frame binds to. S4 will
 * stream real data into these; S1 only ever passes the empty frame.
 */
export interface SparkSessionFrame {
  transcript: SparkTranscriptEntry[];
  toolCalls: SparkToolCallEntry[];
  /** Normalized microphone/output level in the 0..1 range. */
  audioLevel: number;
  canvasItems: SparkCanvasItem[];
}

/** A fresh, inert session frame with honest empty states. */
export function createEmptySparkSessionFrame(): SparkSessionFrame {
  return {
    transcript: [],
    toolCalls: [],
    audioLevel: 0,
    canvasItems: [],
  };
}

/** Clamp an arbitrary level into the 0..1 visualizer range (NaN → 0). */
export function clampSparkAudioLevel(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}
