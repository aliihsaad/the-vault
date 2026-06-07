import { describe, expect, it, vi } from 'vitest';

import {
  createSparkVoiceSession,
  type SparkAudioOutput,
  type SparkVoiceSessionDeps,
} from './services/spark-voice/spark-voice-session.js';
import { createSparkToolDispatcher, type SparkVoiceTool } from './services/spark-voice/spark-voice-tools.js';
import type {
  SparkLlmAdapter,
  SparkLlmResult,
  SparkSttAdapter,
  SparkTtsAdapter,
} from './services/spark-voice/spark-voice-transports.js';
import type { SparkVoiceEvent } from './types/spark-voice.js';

/** A scripted LLM adapter — returns queued results, streaming their text. */
function scriptedLlm(results: SparkLlmResult[]): { adapter: SparkLlmAdapter; calls: number } {
  const state = { calls: 0 };
  const adapter: SparkLlmAdapter = {
    async streamChat(_input, handlers) {
      const result = results[Math.min(state.calls, results.length - 1)];
      state.calls += 1;
      if (result.text && handlers?.onTextDelta) {
        handlers.onTextDelta(result.text);
      }
      return result;
    },
  };
  return { adapter, get calls() { return state.calls; } } as never;
}

function llmResult(partial: Partial<SparkLlmResult>): SparkLlmResult {
  return { text: '', toolCalls: [], durationMs: 1, ...partial };
}

function fakeTts(): SparkTtsAdapter {
  return {
    synthesize: vi.fn(async () => ({
      audio: new TextEncoder().encode('AUDIO').buffer,
      mimeType: 'audio/mpeg',
      durationMs: 1,
    })),
  };
}

function fakeStt(text: string): SparkSttAdapter {
  return { transcribe: vi.fn(async () => ({ text })) };
}

function fakeAudio(): SparkAudioOutput & { play: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } {
  return { play: vi.fn(), stop: vi.fn() } as never;
}

function baseDeps(overrides: Partial<SparkVoiceSessionDeps> = {}): {
  deps: SparkVoiceSessionDeps;
  events: SparkVoiceEvent[];
} {
  const events: SparkVoiceEvent[] = [];
  let idn = 0;
  const deps: SparkVoiceSessionDeps = {
    stt: fakeStt('hello from speech'),
    llm: { async streamChat() { return llmResult({ text: 'Hi!' }); } },
    tts: fakeTts(),
    toolDispatcher: createSparkToolDispatcher([]),
    audioOutput: fakeAudio(),
    emit: (e) => events.push(e),
    now: () => 1000,
    idGen: () => `id_${(idn += 1)}`,
    ...overrides,
  };
  return { deps, events };
}

function eventsOf(events: SparkVoiceEvent[], kind: SparkVoiceEvent['kind']): SparkVoiceEvent[] {
  return events.filter((e) => e.kind === kind);
}

describe('createSparkVoiceSession — text turn (STT→LLM→TTS)', () => {
  it('runs a simple turn: user transcript, streamed response, spoken reply', async () => {
    const { deps, events } = baseDeps({
      llm: {
        async streamChat(_i, handlers) {
          handlers?.onTextDelta?.('Hello ');
          handlers?.onTextDelta?.('there!');
          return llmResult({ text: 'Hello there!' });
        },
      },
    });
    const session = createSparkVoiceSession(deps);
    session.start();
    await session.sendText('hi spark');

    const finals = eventsOf(events, 'finalTranscript');
    expect(finals[0]).toMatchObject({ entry: { role: 'user', text: 'hi spark' } });

    const responses = eventsOf(events, 'responseText');
    expect(responses.some((e) => e.kind === 'responseText' && e.entry.final === false)).toBe(true);
    const final = responses.find((e) => e.kind === 'responseText' && e.entry.final);
    expect(final).toMatchObject({ entry: { role: 'spark', text: 'Hello there!', final: true } });

    // TTS + playback happened.
    expect(deps.tts.synthesize).toHaveBeenCalledWith('Hello there!');
    expect((deps.audioOutput.play as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect(session.getStatus()).toBe('speaking');

    // Folded frame matches the session-frame contract.
    const frame = session.getFrame();
    expect(frame.transcript.map((t) => t.role)).toEqual(['user', 'spark']);
  });

  it('transcribes a pushed audio utterance then answers', async () => {
    const { deps, events } = baseDeps({ stt: fakeStt('what time is it') });
    const session = createSparkVoiceSession(deps);
    session.start();
    await session.pushAudioUtterance({ data: new Uint8Array([1, 2]), mimeType: 'audio/webm' });
    expect(deps.stt.transcribe).toHaveBeenCalledOnce();
    expect(eventsOf(events, 'finalTranscript')[0]).toMatchObject({
      entry: { role: 'user', text: 'what time is it' },
    });
  });
});

describe('createSparkVoiceSession — tool dispatch loop (S3b)', () => {
  it('dispatches a tool call, surfaces it in the stream, then answers with the result', async () => {
    const handler = vi.fn(async () => ({ memories: ['deadline is Friday'] }));
    const tool: SparkVoiceTool = {
      definition: { type: 'function', function: { name: 'recall', parameters: { type: 'object' } } },
      policy: {
        risk: 'low',
        permission: 'vault',
        parallelism: 'read_only',
        requiresApproval: false,
        memoryWriteAllowed: false,
      },
      handler,
    };
    const results = [
      llmResult({
        text: '',
        toolCalls: [{ id: 'call_1', name: 'recall', arguments: '{"q":"deadline"}' }],
      }),
      llmResult({ text: 'Your deadline is Friday.' }),
    ];
    let calls = 0;
    const llm: SparkLlmAdapter = {
      async streamChat(_i, handlers) {
        const r = results[Math.min(calls, results.length - 1)];
        calls += 1;
        if (r.text) handlers?.onTextDelta?.(r.text);
        return r;
      },
    };
    const { deps, events } = baseDeps({ llm, toolDispatcher: createSparkToolDispatcher([tool]) });
    const session = createSparkVoiceSession(deps);
    session.start();
    await session.sendText('when is my deadline');

    expect(handler).toHaveBeenCalledWith({ q: 'deadline' }, expect.objectContaining({ turnComplete: false }));

    const toolEvents = eventsOf(events, 'toolCall');
    expect(toolEvents.map((e) => e.kind === 'toolCall' && e.entry.status)).toEqual(['running', 'done']);

    const final = eventsOf(events, 'responseText').find((e) => e.kind === 'responseText' && e.entry.final);
    expect(final).toMatchObject({ entry: { text: 'Your deadline is Friday.' } });

    // Frame shows the completed tool call.
    expect(session.getFrame().toolCalls[0]).toMatchObject({ name: 'recall', status: 'done' });
  });
});

describe('createSparkVoiceSession — safety hardening', () => {
  it('fences recalled memory as data and never lets it leak into spoken text', async () => {
    const recallContext = vi.fn(async () => 'SECRET: the launch code is 1234');
    let captured: unknown;
    const llm: SparkLlmAdapter = {
      async streamChat(input, handlers) {
        captured = input.messages;
        handlers?.onTextDelta?.('Noted.');
        return llmResult({ text: 'Noted.' });
      },
    };
    const { deps, events } = baseDeps({ llm, recallContext });
    const session = createSparkVoiceSession(deps);
    session.start();
    await session.sendText('remember the code');

    // Recall is injected to the model fenced as data...
    const msgs = captured as Array<{ role: string; content: string }>;
    const fenced = msgs.find((m) => m.content.includes('spark-memory-evidence'));
    expect(fenced).toBeDefined();
    // ...but the spoken/displayed response never contains the secret.
    const final = eventsOf(events, 'responseText').find((e) => e.kind === 'responseText' && e.entry.final);
    expect(JSON.stringify(final)).not.toContain('launch code');
  });

  it('scrubs fenced evidence accidentally emitted by the model', async () => {
    const leaky = 'Sure. <spark-memory-evidence fence="data">internal</spark-memory-evidence> Done.';
    const llm: SparkLlmAdapter = {
      async streamChat(_i, handlers) {
        handlers?.onTextDelta?.(leaky);
        return llmResult({ text: leaky });
      },
    };
    const { deps, events } = baseDeps({ llm });
    const session = createSparkVoiceSession(deps);
    session.start();
    await session.sendText('hi');
    const final = eventsOf(events, 'responseText').find((e) => e.kind === 'responseText' && e.entry.final);
    expect(final && final.kind === 'responseText' && final.entry.text).not.toContain('spark-memory-evidence');
    expect(deps.tts.synthesize).toHaveBeenCalledWith(expect.not.stringContaining('internal'));
  });

  it('barge-in: a VAD onset while speaking stops playback', async () => {
    const { deps } = baseDeps({ vadOptions: { speechThreshold: 0.1 } });
    const session = createSparkVoiceSession(deps);
    session.start();
    await session.sendText('say something');
    expect(session.getStatus()).toBe('speaking');

    session.pushAudioLevel(0.8, 0); // user talks over the assistant
    expect((deps.audioOutput.stop as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect(session.getStatus()).toBe('listening');
  });

  it('emits an error event when the LLM fails, and recovers to listening', async () => {
    const llm: SparkLlmAdapter = {
      async streamChat() {
        throw new Error('provider down');
      },
    };
    const { deps, events } = baseDeps({ llm });
    const session = createSparkVoiceSession(deps);
    session.start();
    await session.sendText('hi');
    expect(eventsOf(events, 'error')[0]).toMatchObject({ message: 'provider down' });
    expect(session.getStatus()).toBe('listening');
  });

  it('forwards audio levels to the event stream', () => {
    const { deps, events } = baseDeps();
    const session = createSparkVoiceSession(deps);
    session.start();
    session.pushAudioLevel(0.42, 5);
    expect(eventsOf(events, 'audioLevel').at(-1)).toMatchObject({ level: 0.42 });
  });
});
