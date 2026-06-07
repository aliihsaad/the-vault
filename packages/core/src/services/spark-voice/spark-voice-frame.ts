/**
 * Pure reducer that folds the host VoiceSession event stream (S3) into the
 * `SparkSessionFrame` prop contract (S1) the renderer binds to (S4).
 *
 * This is the precise bridge the S3 handoff requires: "VoiceSession event stream
 * bridged over IPC to renderer matching S1 panel props exactly
 * (transcript/toolCalls/audioLevel/canvasItems)". It is deliberately pure and
 * total — every event kind is handled and a brand-new frame object is returned
 * so React state updates stay referentially honest.
 */

import {
  clampSparkAudioLevel,
  createEmptySparkSessionFrame,
  type SparkSessionFrame,
  type SparkToolCallEntry,
  type SparkTranscriptEntry,
} from '../../types/spark-session-frame.js';
import type { SparkVoiceEvent } from '../../types/spark-voice.js';
import type { SparkCanvasItem } from '../../types/spark-session-frame.js';

/** Replace an entry sharing the same id, otherwise append. Order is preserved. */
function upsertById<T extends { id: string }>(list: readonly T[], next: T): T[] {
  const index = list.findIndex((item) => item.id === next.id);
  if (index === -1) {
    return [...list, next];
  }
  const copy = list.slice();
  copy[index] = next;
  return copy;
}

/**
 * Apply a single VoiceSession event to a frame, returning the next frame.
 * `status` and `error` events carry no frame-visible state (they are surfaced
 * via side channels), so the frame is returned unchanged for those kinds.
 */
export function applySparkVoiceEvent(
  frame: SparkSessionFrame,
  event: SparkVoiceEvent,
): SparkSessionFrame {
  switch (event.kind) {
    case 'partialTranscript':
    case 'finalTranscript':
    case 'responseText': {
      const transcript = upsertById<SparkTranscriptEntry>(frame.transcript, event.entry);
      return { ...frame, transcript };
    }
    case 'toolCall': {
      const toolCalls = upsertById<SparkToolCallEntry>(frame.toolCalls, event.entry);
      return { ...frame, toolCalls };
    }
    case 'canvasItem': {
      const canvasItems = upsertById<SparkCanvasItem>(frame.canvasItems, event.item);
      return { ...frame, canvasItems };
    }
    case 'audioLevel': {
      return { ...frame, audioLevel: clampSparkAudioLevel(event.level) };
    }
    case 'error':
    case 'status':
      return frame;
    default: {
      // Exhaustiveness guard: a new event kind must be handled above.
      const _never: never = event;
      return _never;
    }
  }
}

/** Fold a sequence of events onto a starting frame (defaults to an empty one). */
export function reduceSparkVoiceEvents(
  events: Iterable<SparkVoiceEvent>,
  initial: SparkSessionFrame = createEmptySparkSessionFrame(),
): SparkSessionFrame {
  let frame = initial;
  for (const event of events) {
    frame = applySparkVoiceEvent(frame, event);
  }
  return frame;
}
