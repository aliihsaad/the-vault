import { describe, expect, it } from 'vitest';

import {
  fenceSparkEvidence,
  scrubSparkOutput,
} from './services/spark-voice/spark-voice-scrubber.js';

describe('scrubSparkOutput (v5 SurfaceAdapter scrubber)', () => {
  it('passes plain user-visible text through untouched', () => {
    const result = scrubSparkOutput('Sure — the meeting is at 3pm tomorrow.');
    expect(result.text).toBe('Sure — the meeting is at 3pm tomorrow.');
    expect(result.scrubbed).toBe(false);
  });

  it('removes fenced memory evidence blocks so they are never spoken', () => {
    const body = fenceSparkEvidence('memory', 'User prefers dark mode. Project deadline Friday.');
    const input = `Got it.${body} Anything else?`;
    const result = scrubSparkOutput(input);
    expect(result.text).not.toContain('dark mode');
    expect(result.text).not.toContain('spark-memory-evidence');
    expect(result.text).toContain('Got it.');
    expect(result.text).toContain('Anything else?');
    expect(result.scrubbed).toBe(true);
  });

  it('drops a dangling/unterminated fence from a truncated stream', () => {
    const input = 'Here is the answer. <spark-tool-evidence fence="data">partial block that never clo';
    const result = scrubSparkOutput(input);
    expect(result.text.trim()).toBe('Here is the answer.');
    expect(result.text).not.toContain('spark-tool-evidence');
    expect(result.scrubbed).toBe(true);
  });

  it('redacts token-like secrets (sk-, bearer, xi-, jwt)', () => {
    const samples = [
      'key is sk-abcdef1234567890ABCDEF',
      'header Bearer abcdefghijklmnop12345',
      'voice xi-0123456789abcdefghij',
      'token aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbb.cccccccccc',
    ];
    for (const sample of samples) {
      const result = scrubSparkOutput(sample);
      expect(result.text).toContain('[redacted]');
      expect(result.scrubbed).toBe(true);
    }
  });

  it('handles empty / non-string input safely', () => {
    expect(scrubSparkOutput('')).toEqual({ text: '', scrubbed: false });
    // @ts-expect-error — deliberately exercising the runtime guard
    expect(scrubSparkOutput(undefined)).toEqual({ text: '', scrubbed: false });
  });
});

describe('fenceSparkEvidence', () => {
  it('wraps content in a data fence the scrubber then removes', () => {
    const fenced = fenceSparkEvidence('memory', 'secret note');
    expect(fenced).toContain('fence="data"');
    expect(scrubSparkOutput(`hi ${fenced}`).text.trim()).toBe('hi');
  });
});
