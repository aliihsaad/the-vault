import { useCallback, useEffect, useState } from 'react';

/**
 * Renderer hook for the persistent Spark overlay window (roadmap D). Tracks the
 * overlay open/closed state (seeded from the host, kept live via the broadcast
 * `spark:overlay:state` event) and exposes open/close controls. Safe when the
 * bridge is absent (e.g. tests / web) — `available` is false and ops no-op.
 */
export interface SparkOverlayControls {
  available: boolean;
  open: boolean;
  openOverlay: () => Promise<void>;
  closeOverlay: () => Promise<void>;
}

export function useSparkOverlay(): SparkOverlayControls {
  const api = typeof window !== 'undefined' ? window.sparkOverlayApi : undefined;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!api) {
      return undefined;
    }
    let cancelled = false;
    void api
      .getStatus()
      .then((result) => {
        if (!cancelled && result.success && result.data) {
          setOpen(result.data.open);
        }
      })
      .catch(() => {
        /* status is best-effort */
      });
    const off = api.onState((state) => setOpen(state.open));
    return () => {
      cancelled = true;
      off();
    };
  }, [api]);

  const openOverlay = useCallback(async () => {
    const result = await api?.open();
    if (result?.success && result.data) {
      setOpen(result.data.open);
    }
  }, [api]);

  const closeOverlay = useCallback(async () => {
    const result = await api?.close();
    if (result?.success && result.data) {
      setOpen(result.data.open);
    }
  }, [api]);

  return { available: Boolean(api), open, openOverlay, closeOverlay };
}
