import { describe, expect, it, vi } from 'vitest';

import {
  createSparkVoiceSession,
  type SparkAudioOutput,
  type SparkVoiceSessionDeps,
} from './services/spark-voice/spark-voice-session.js';
import { createSparkToolDispatcher } from './services/spark-voice/spark-voice-tools.js';
import type { SparkLlmResult } from './services/spark-voice/spark-voice-transports.js';
import type { SparkVoiceEvent } from './types/spark-voice.js';

/**
 * S5 security regression: every assistant-text path that reaches the user — the
 * streamed `responseText` deltas, the final answer, AND the TTS synthesis call —
 * MUST pass through the scrubber so fenced internal evidence and token-like
 * secrets can never be displayed or spoken. This guards the v5 SurfaceAdapter
 * scrubber contract (vm_0vFbOo9l8sfyWsJi §3) against a refactor that emits or
 * speaks raw model text.
 */

const SECRET_TOKEN = 'sk-livesecret0123456789abcdef';
const FENCED_EVIDENCE =
  '<spark-memory-evidence fence="data">internal recall that must stay hidden</spark-memory-evidence>';

function llmResult(partial: Partial<SparkLlmResult>): SparkLlmResult {
  return { text: '', toolCalls: [], durationMs: 1, ...partial };
}

function buildSession() {
  const events: SparkVoiceEvent[] = [];
  const synthesize = vi.fn(async (_text: string) => ({
    audio: new TextEncoder().encode('AUDIO').buffer,
    mimeType: 'audio/mpeg',
    durationMs: 1,
  }));
  const audioOutput: SparkAudioOutput = { play: vi.fn(), stop: vi.fn() };

  const deps: SparkVoiceSessionDeps = {
    stt: { transcribe: vi.fn(async () => ({ text: 'ignored' })) },
    llm: {
      async streamChat(_input, handlers) {
        // Model leaks a fenced evidence block and an API key in its stream.
        handlers?.onTextDelta?.(`Here is the answer ${SECRET_TOKEN} `);
        handlers?.onTextDelta?.(FENCED_EVIDENCE);
        return llmResult({ text: `Here is the answer ${SECRET_TOKEN} ${FENCED_EVIDENCE}` });
      },
    },
    tts: { synthesize },
    toolDispatcher: createSparkToolDispatcher([]),
    audioOutput,
    emit: (e) => events.push(e),
    now: () => 1000,
    idGen: (() => {
      let n = 0;
      return () => `id_${(n += 1)}`;
    })(),
  };

  return { deps, events, synthesize };
}

describe('Spark voice session — output security (S5)', () => {
  it('never emits the API key or fenced evidence in any responseText event', async () => {
    const { deps, events } = buildSession();
    const session = createSparkVoiceSession(deps);
    session.start();
    await session.sendText('what is the answer');

    const responses = events.filter((e) => e.kind === 'responseText');
    expect(responses.length).toBeGreaterThan(0);
    for (const event of responses) {
      if (event.kind !== 'responseText') {
        continue;
      }
      expect(event.entry.text).not.toContain(SECRET_TOKEN);
      expect(event.entry.text).not.toContain('spark-memory-evidence');
      expect(event.entry.text).not.toContain('must stay hidden');
    }
  });

  it('never speaks the API key or fenced evidence through TTS', async () => {
    const { deps, synthesize } = buildSession();
    const session = createSparkVoiceSession(deps);
    session.start();
    await session.sendText('what is the answer');

    expect(synthesize).toHaveBeenCalled();
    for (const call of synthesize.mock.calls) {
      const spoken = String(call[0]);
      expect(spoken).not.toContain(SECRET_TOKEN);
      expect(spoken).not.toContain('spark-memory-evidence');
      expect(spoken).not.toContain('must stay hidden');
    }
  });
});
