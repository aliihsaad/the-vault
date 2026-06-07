import { describe, expect, it } from 'vitest';

import {
  applySparkVoiceEvent,
  reduceSparkVoiceEvents,
} from './services/spark-voice/spark-voice-frame.js';
import { createEmptySparkSessionFrame } from './types/spark-session-frame.js';
import type { SparkVoiceEvent } from './types/spark-voice.js';

describe('applySparkVoiceEvent (S3 event stream → S1 SparkSessionFrame)', () => {
  it('grows a single user transcript entry from partial to final by id', () => {
    let frame = createEmptySparkSessionFrame();
    frame = applySparkVoiceEvent(frame, {
      kind: 'partialTranscript',
      entry: { id: 'u1', role: 'user', text: 'hello', final: false, ts: 1 },
    });
    expect(frame.transcript).toHaveLength(1);
    expect(frame.transcript[0]).toMatchObject({ text: 'hello', final: false });

    frame = applySparkVoiceEvent(frame, {
      kind: 'partialTranscript',
      entry: { id: 'u1', role: 'user', text: 'hello there', final: false, ts: 2 },
    });
    frame = applySparkVoiceEvent(frame, {
      kind: 'finalTranscript',
      entry: { id: 'u1', role: 'user', text: 'hello there friend', final: true, ts: 3 },
    });

    // Still one entry — partials are coalesced by id, then settled to final.
    expect(frame.transcript).toHaveLength(1);
    expect(frame.transcript[0]).toMatchObject({ text: 'hello there friend', final: true });
  });

  it('streams an assistant (spark) response into its own transcript entry', () => {
    const events: SparkVoiceEvent[] = [
      { kind: 'finalTranscript', entry: { id: 'u1', role: 'user', text: 'hi', final: true, ts: 1 } },
      { kind: 'responseText', entry: { id: 's1', role: 'spark', text: 'Hel', final: false, ts: 2 } },
      { kind: 'responseText', entry: { id: 's1', role: 'spark', text: 'Hello!', final: true, ts: 3 } },
    ];
    const frame = reduceSparkVoiceEvents(events);
    expect(frame.transcript.map((t) => t.role)).toEqual(['user', 'spark']);
    expect(frame.transcript[1]).toMatchObject({ text: 'Hello!', final: true });
  });

  it('tracks a tool call through its pending → running → done lifecycle by id', () => {
    const events: SparkVoiceEvent[] = [
      { kind: 'toolCall', entry: { id: 't1', name: 'recall_memory', status: 'pending', ts: 1 } },
      { kind: 'toolCall', entry: { id: 't1', name: 'recall_memory', status: 'running', ts: 2 } },
      {
        kind: 'toolCall',
        entry: { id: 't1', name: 'recall_memory', status: 'done', result: { hits: 3 }, ts: 3 },
      },
    ];
    const frame = reduceSparkVoiceEvents(events);
    expect(frame.toolCalls).toHaveLength(1);
    expect(frame.toolCalls[0]).toMatchObject({ status: 'done', result: { hits: 3 } });
  });

  it('clamps audio level into 0..1 and upserts canvas items by id', () => {
    let frame = createEmptySparkSessionFrame();
    frame = applySparkVoiceEvent(frame, { kind: 'audioLevel', level: 2.5, ts: 1 });
    expect(frame.audioLevel).toBe(1);
    frame = applySparkVoiceEvent(frame, { kind: 'audioLevel', level: -3, ts: 2 });
    expect(frame.audioLevel).toBe(0);

    frame = applySparkVoiceEvent(frame, {
      kind: 'canvasItem',
      item: { id: 'c1', kind: 'markdown', payload: '# v1' },
      ts: 3,
    });
    frame = applySparkVoiceEvent(frame, {
      kind: 'canvasItem',
      item: { id: 'c1', kind: 'markdown', payload: '# v2' },
      ts: 4,
    });
    expect(frame.canvasItems).toHaveLength(1);
    expect(frame.canvasItems[0].payload).toBe('# v2');
  });

  it('leaves the frame unchanged for status and error side-channel events', () => {
    const frame = createEmptySparkSessionFrame();
    const afterStatus = applySparkVoiceEvent(frame, { kind: 'status', status: 'thinking', ts: 1 });
    const afterError = applySparkVoiceEvent(afterStatus, { kind: 'error', message: 'boom', ts: 2 });
    expect(afterError).toEqual(createEmptySparkSessionFrame());
  });

  it('returns a new frame object (never mutates the input) for React safety', () => {
    const frame = createEmptySparkSessionFrame();
    const next = applySparkVoiceEvent(frame, {
      kind: 'finalTranscript',
      entry: { id: 'u1', role: 'user', text: 'x', final: true, ts: 1 },
    });
    expect(next).not.toBe(frame);
    expect(frame.transcript).toHaveLength(0);
  });
});
