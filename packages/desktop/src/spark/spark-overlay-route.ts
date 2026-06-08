/**
 * Shared constants/helpers for the persistent Spark overlay window (roadmap D).
 *
 * The overlay is a separate always-on-top BrowserWindow that loads the SAME
 * renderer bundle as the main window, distinguished only by the URL hash. Both
 * the Electron main process (to build the load URL) and the renderer entry (to
 * decide what to mount) import from here, so the contract stays in one place and
 * is unit-testable without Electron or a DOM.
 */

export const SPARK_OVERLAY_HASH = 'spark-overlay';

/** True when a location hash/url addresses the Spark overlay route. */
export function isSparkOverlayRoute(hash: string | null | undefined): boolean {
  if (!hash) {
    return false;
  }
  const fragment = hash.includes('#') ? hash.slice(hash.indexOf('#') + 1) : hash;
  return fragment.replace(/^\//, '').split('?')[0] === SPARK_OVERLAY_HASH;
}

/** Geometry/behavior for the overlay BrowserWindow (webPreferences added in main). */
export interface SparkOverlayWindowOptions {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  frame: boolean;
  resizable: boolean;
  minimizable: boolean;
  maximizable: boolean;
  fullscreenable: boolean;
  alwaysOnTop: boolean;
  skipTaskbar: boolean;
  backgroundColor: string;
}

export function sparkOverlayWindowOptions(): SparkOverlayWindowOptions {
  return {
    width: 360,
    height: 560,
    minWidth: 300,
    minHeight: 420,
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#020617',
  };
}
