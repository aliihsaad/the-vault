import { describe, expect, it } from 'vitest';

import {
  createSparkRealtimeAudioInputMessage,
  createSparkRealtimeAudioStreamEndMessage,
  createSparkRealtimeSetupMessage,
  createSparkRealtimeToolResponseMessage,
  summarizeSparkRealtimeServerMessage,
} from './services/spark-voice/spark-realtime-messages.js';

describe('createSparkRealtimeSetupMessage', () => {
  it('builds a Gemini-Live setup with audio modality, voice, instructions, and tools', () => {
    const message = createSparkRealtimeSetupMessage({
      model: 'auto',
      voice: 'alloy',
      instructions: 'Be brief.',
      inputAudioTranscription: true,
      outputAudioTranscription: true,
      tools: [{ name: 'recall_memory', description: 'Recall', parameters: { type: 'object' } }],
    });
    const setup = (message as any).setup;
    expect(setup.model).toBe('models/auto');
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('alloy');
    expect(setup.systemInstruction.parts[0].text).toBe('Be brief.');
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.outputAudioTranscription).toEqual({});
    expect(setup.tools[0].functionDeclarations[0].name).toBe('recall_memory');
  });

  it('sanitizes tool schemas into the Gemini OpenAPI subset (no 400-causing shapes)', () => {
    const message = createSparkRealtimeSetupMessage({
      model: 'auto',
      tools: [
        {
          name: 'show_on_canvas',
          description: 'Render',
          parameters: {
            type: 'object',
            additionalProperties: true, // unsupported keyword — must be dropped
            properties: {
              kind: { type: 'string', enum: ['markdown', 'table'] },
              payload: { description: 'anything' }, // no type — must be coerced
            },
            required: ['kind', 'payload', 'ghost'], // ghost is not a property
          },
        },
      ],
    });
    const params = (message as any).setup.tools[0].functionDeclarations[0].parameters;
    expect(params.type).toBe('object');
    expect(params.additionalProperties).toBeUndefined();
    expect(params.properties.kind).toEqual({ type: 'string', enum: ['markdown', 'table'] });
    // typeless property is coerced to a concrete type so Gemini accepts it
    expect(params.properties.payload.type).toBe('string');
    // required is filtered to actual properties
    expect(params.required).toEqual(['kind', 'payload']);
  });

  it('forces a valid object schema when a tool declares no/invalid parameters', () => {
    const message = createSparkRealtimeSetupMessage({
      model: 'auto',
      tools: [{ name: 'no_args', description: 'x' }],
    });
    const params = (message as any).setup.tools[0].functionDeclarations[0].parameters;
    expect(params).toEqual({ type: 'object', properties: {} });
  });

  it('does not prefix an already-namespaced model and omits voice for text-only', () => {
    const message = createSparkRealtimeSetupMessage({
      model: 'models/gemini-live',
      responseModalities: ['TEXT'],
    });
    const setup = (message as any).setup;
    expect(setup.model).toBe('models/gemini-live');
    expect(setup.generationConfig.responseModalities).toEqual(['TEXT']);
    expect(setup.generationConfig.speechConfig).toBeUndefined();
  });
});

describe('realtime input messages', () => {
  it('wraps base64 PCM as a 16kHz media chunk', () => {
    const message = createSparkRealtimeAudioInputMessage('Zm9v', 16000) as any;
    expect(message.realtimeInput.mediaChunks[0]).toEqual({
      data: 'Zm9v',
      mimeType: 'audio/pcm;rate=16000',
    });
  });

  it('emits an audio stream-end signal', () => {
    expect(createSparkRealtimeAudioStreamEndMessage()).toEqual({
      realtimeInput: { audioStreamEnd: true },
    });
  });

  it('formats tool responses as functionResponses', () => {
    const message = createSparkRealtimeToolResponseMessage([
      { id: 'c1', name: 'recall_memory', result: '{"hits":1}' },
    ]) as any;
    expect(message.toolResponse.functionResponses[0]).toEqual({
      id: 'c1',
      name: 'recall_memory',
      response: { result: '{"hits":1}' },
    });
  });
});

describe('summarizeSparkRealtimeServerMessage', () => {
  it('extracts model text and 24kHz audio chunks from serverContent.modelTurn', () => {
    const summary = summarizeSparkRealtimeServerMessage({
      serverContent: {
        modelTurn: {
          parts: [
            { text: 'Hello ' },
            { text: 'there' },
            { inlineData: { data: 'QUJD', mimeType: 'audio/pcm;rate=24000' } },
          ],
        },
      },
    });
    expect(summary.text).toBe('Hello there');
    expect(summary.audioChunks).toEqual([{ data: 'QUJD', mimeType: 'audio/pcm;rate=24000' }]);
  });

  it('captures input/output transcripts, tool calls, turn-complete and setup-complete', () => {
    const toolSummary = summarizeSparkRealtimeServerMessage({
      toolCall: { functionCalls: [{ id: 'x1', name: 'recall_memory', args: { q: 'plan' } }] },
    });
    expect(toolSummary.toolCalls[0]).toMatchObject({
      id: 'x1',
      function: { name: 'recall_memory', arguments: '{"q":"plan"}' },
    });

    const transcripts = summarizeSparkRealtimeServerMessage({
      serverContent: {
        inputTranscription: { text: 'what time is it' },
        outputTranscription: { text: 'it is noon' },
        turnComplete: true,
      },
    });
    expect(transcripts.inputTranscription).toBe('what time is it');
    expect(transcripts.outputTranscription).toBe('it is noon');
    expect(transcripts.turnComplete).toBe(true);

    expect(summarizeSparkRealtimeServerMessage({ setupComplete: {} }).setupComplete).toBe(true);
  });
});
