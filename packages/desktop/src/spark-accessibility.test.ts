import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('Spark control page accessibility (S5)', () => {
  const page = () => readSource('./components/spark/SparkControlPage.tsx');

  it('announces error, action, and voice failures with role="alert"', () => {
    const source = page();
    // Each of the three warning note cards must be an assertive live region so a
    // screen reader announces a mid-session adapter failure, not just a silent
    // colour change.
    const alertCards = source.match(/role="alert"/g) ?? [];
    expect(alertCards.length).toBeGreaterThanOrEqual(3);
  });

  it('marks the page busy while the snapshot is loading', () => {
    expect(page()).toContain('aria-busy={loading}');
  });

  it('gives the conversation-mode radiogroup keyboard arrow navigation', () => {
    const source = page();
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('onKeyDown');
    // Roving tab index: only the checked radio is in the tab order.
    expect(source).toContain('tabIndex');
  });
});

describe('Spark session frame accessibility (S5)', () => {
  const frame = () => readSource('./components/spark/SparkSessionFrame.tsx');

  it('streams transcript updates through a polite live region', () => {
    const source = frame();
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('aria-atomic="false"');
  });

  it('keeps the visualizer described for assistive tech', () => {
    // Already present from S4 — lock it so a refactor cannot silently drop it.
    expect(frame()).toContain('role="img"');
  });
});
