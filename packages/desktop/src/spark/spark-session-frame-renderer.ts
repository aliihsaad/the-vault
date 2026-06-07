import type {
  SparkCanvasItem,
  SparkSessionFrame,
  SparkToolCallEntry,
  SparkTranscriptEntry,
  SparkVoiceEvent,
} from '@the-vault/core';

export function createEmptySparkSessionFrame(): SparkSessionFrame {
  return {
    transcript: [],
    toolCalls: [],
    audioLevel: 0,
    canvasItems: [],
  };
}

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

function upsertById<T extends { id: string }>(list: readonly T[], next: T): T[] {
  const index = list.findIndex((item) => item.id === next.id);
  if (index === -1) {
    return [...list, next];
  }

  const copy = list.slice();
  copy[index] = next;
  return copy;
}

export function applySparkVoiceEvent(
  frame: SparkSessionFrame,
  event: SparkVoiceEvent,
): SparkSessionFrame {
  switch (event.kind) {
    case 'partialTranscript':
    case 'finalTranscript':
    case 'responseText':
      return {
        ...frame,
        transcript: upsertById<SparkTranscriptEntry>(frame.transcript, event.entry),
      };
    case 'toolCall':
      return {
        ...frame,
        toolCalls: upsertById<SparkToolCallEntry>(frame.toolCalls, event.entry),
      };
    case 'canvasItem':
      return {
        ...frame,
        canvasItems: upsertById<SparkCanvasItem>(frame.canvasItems, event.item),
      };
    case 'audioLevel':
      return { ...frame, audioLevel: clampSparkAudioLevel(event.level) };
    case 'error':
    case 'status':
      return frame;
    default: {
      const _never: never = event;
      return _never;
    }
  }
}
