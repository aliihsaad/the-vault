import { describe, expect, it } from 'vitest';
import {
  isSparkOverlayRoute,
  sparkOverlayWindowOptions,
  SPARK_OVERLAY_HASH,
} from './spark/spark-overlay-route.js';

describe('isSparkOverlayRoute', () => {
  it('matches the overlay hash in bare, #-prefixed, and full-URL forms', () => {
    expect(isSparkOverlayRoute(SPARK_OVERLAY_HASH)).toBe(true);
    expect(isSparkOverlayRoute('#spark-overlay')).toBe(true);
    expect(isSparkOverlayRoute('#/spark-overlay')).toBe(true);
    expect(isSparkOverlayRoute('http://localhost:5173/#spark-overlay')).toBe(true);
    expect(isSparkOverlayRoute('file:///C:/app/index.html#spark-overlay?x=1')).toBe(true);
  });

  it('does not match the main window or empty hashes', () => {
    expect(isSparkOverlayRoute('')).toBe(false);
    expect(isSparkOverlayRoute(null)).toBe(false);
    expect(isSparkOverlayRoute(undefined)).toBe(false);
    expect(isSparkOverlayRoute('#overview')).toBe(false);
    expect(isSparkOverlayRoute('http://localhost:5173/')).toBe(false);
  });
});

describe('sparkOverlayWindowOptions', () => {
  it('describes a small, frameless, always-on-top floating window', () => {
    const opts = sparkOverlayWindowOptions();
    expect(opts.alwaysOnTop).toBe(true);
    expect(opts.frame).toBe(false);
    expect(opts.maximizable).toBe(false);
    expect(opts.fullscreenable).toBe(false);
    expect(opts.skipTaskbar).toBe(true);
    expect(opts.width).toBeGreaterThan(0);
    expect(opts.height).toBeGreaterThan(0);
    expect(opts.minWidth).toBeLessThanOrEqual(opts.width);
    expect(opts.minHeight).toBeLessThanOrEqual(opts.height);
  });
});
