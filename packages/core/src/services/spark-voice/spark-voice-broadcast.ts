/**
 * Multi-window broadcast for Spark voice events (roadmap D — persistent overlay).
 *
 * The host pushes `spark:voice:*` messages (events, PCM/audio playback, stop) to
 * the renderer. Once a separate always-on-top overlay window also owns capture +
 * playback, those messages must reach BOTH the main window and the overlay. This
 * is a tiny, electron-agnostic fan-out: targets are anything with a structural
 * `send` + `isDestroyed`, so it unit-tests without Electron and main.ts wires the
 * real `webContents` in.
 *
 * Destroyed targets are pruned on send, so closing the overlay (or main window)
 * never throws "Object has been destroyed".
 */

export interface SparkBroadcastTarget {
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

export interface SparkVoiceBroadcaster {
  /** Register a renderer target (idempotent). */
  add(target: SparkBroadcastTarget): void;
  /** Remove a target. */
  remove(target: SparkBroadcastTarget): void;
  /** Send to every live target, pruning any that are destroyed. */
  send(channel: string, ...args: unknown[]): void;
  /** Number of live (non-destroyed) registered targets. */
  count(): number;
}

export function createSparkVoiceBroadcaster(): SparkVoiceBroadcaster {
  const targets = new Set<SparkBroadcastTarget>();

  function pruneDestroyed(): void {
    for (const target of targets) {
      if (target.isDestroyed()) {
        targets.delete(target);
      }
    }
  }

  return {
    add(target) {
      targets.add(target);
    },
    remove(target) {
      targets.delete(target);
    },
    send(channel, ...args) {
      for (const target of [...targets]) {
        if (target.isDestroyed()) {
          targets.delete(target);
          continue;
        }
        try {
          target.send(channel, ...args);
        } catch {
          // A target can be torn down between the check and the send; drop it.
          targets.delete(target);
        }
      }
    },
    count() {
      pruneDestroyed();
      return targets.size;
    },
  };
}
