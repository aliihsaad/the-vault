import { describe, expect, it, vi } from 'vitest';
import {
  createSparkVoiceBroadcaster,
  type SparkBroadcastTarget,
} from './services/spark-voice/spark-voice-broadcast.js';

function fakeTarget(): SparkBroadcastTarget & { sent: Array<[string, unknown[]]>; destroyed: boolean } {
  return {
    destroyed: false,
    sent: [],
    isDestroyed() {
      return this.destroyed;
    },
    send(channel, ...args) {
      this.sent.push([channel, args]);
    },
  };
}

describe('createSparkVoiceBroadcaster', () => {
  it('fans a message out to every registered target', () => {
    const b = createSparkVoiceBroadcaster();
    const a = fakeTarget();
    const c = fakeTarget();
    b.add(a);
    b.add(c);

    b.send('spark:voice:event', { kind: 'status' });

    expect(a.sent).toEqual([['spark:voice:event', [{ kind: 'status' }]]]);
    expect(c.sent).toEqual([['spark:voice:event', [{ kind: 'status' }]]]);
  });

  it('is idempotent on add and supports remove', () => {
    const b = createSparkVoiceBroadcaster();
    const a = fakeTarget();
    b.add(a);
    b.add(a);
    expect(b.count()).toBe(1);

    b.remove(a);
    b.send('spark:voice:stopAudio');
    expect(a.sent).toHaveLength(0);
    expect(b.count()).toBe(0);
  });

  it('skips and prunes destroyed targets instead of throwing', () => {
    const b = createSparkVoiceBroadcaster();
    const live = fakeTarget();
    const dead = fakeTarget();
    dead.destroyed = true;
    b.add(live);
    b.add(dead);

    b.send('spark:voice:playPcm', 'base64', 'audio/pcm');

    expect(live.sent).toHaveLength(1);
    expect(dead.sent).toHaveLength(0);
    expect(b.count()).toBe(1); // dead pruned
  });

  it('drops a target that throws mid-send (torn down between check and send)', () => {
    const b = createSparkVoiceBroadcaster();
    const flaky: SparkBroadcastTarget = {
      isDestroyed: () => false,
      send: vi.fn(() => {
        throw new Error('Object has been destroyed');
      }),
    };
    const good = fakeTarget();
    b.add(flaky);
    b.add(good);

    expect(() => b.send('spark:voice:event', {})).not.toThrow();
    expect(good.sent).toHaveLength(1);
    expect(b.count()).toBe(1); // flaky dropped
  });
});
