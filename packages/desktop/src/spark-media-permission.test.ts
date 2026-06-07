import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

/**
 * Regression guard: the Spark voice runtime depends on renderer getUserMedia,
 * which Electron denies unless the session grants the media permission. Without
 * this handler the mic silently produces no audio (visualizer stuck on "Audio
 * inactive", no utterance reaches STT). Lock the grant so it can't be dropped.
 */
describe('Electron microphone permission (Spark voice)', () => {
  const main = () => readSource('../electron/main.ts');

  it('registers a permission request handler that grants media/microphone', () => {
    const source = main();
    expect(source).toContain('setPermissionRequestHandler');
    expect(source).toContain('setPermissionCheckHandler');
    expect(source).toMatch(/permission === 'media'/);
    expect(source).toMatch(/microphone|audioCapture/);
  });
});
