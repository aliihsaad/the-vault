export type OpenLoopStalenessTone = 'fresh' | 'watch' | 'stale' | 'critical';

export function getOpenLoopStaleness(daysOpen: number): {
  tone: OpenLoopStalenessTone;
  label: string;
  title: string;
} {
  const days = Math.max(0, Math.floor(daysOpen));
  if (days >= 14) {
    return {
      tone: 'critical',
      label: `Stale ${days}d`,
      title: `This loop has been open for ${days} days.`,
    };
  }

  if (days >= 7) {
    return {
      tone: 'stale',
      label: `Stale ${days}d`,
      title: `This loop has been open for ${days} days.`,
    };
  }

  if (days >= 2) {
    return {
      tone: 'watch',
      label: `${days}d`,
      title: `This loop has been open for ${days} days.`,
    };
  }

  return {
    tone: 'fresh',
    label: days === 0 ? 'Today' : '1d',
    title: days === 0 ? 'Updated today.' : 'This loop has been open for 1 day.',
  };
}

export function describeOpenLoopSignals(
  loop: Pick<VaultOpenLoop, 'routineType' | 'daysOpen' | 'score' | 'recentlyReferenced'>,
): string {
  const staleness = getOpenLoopStaleness(loop.daysOpen);
  const signals = [
    loop.routineType || 'general',
    staleness.tone === 'fresh' ? 'fresh' : staleness.label.toLowerCase(),
    `score ${loop.score}`,
  ];

  if (loop.recentlyReferenced) {
    signals.push('recently referenced');
  }

  return signals.join(' - ');
}

export function buildOpenLoopFocusList(loops: VaultOpenLoop[], limit = 3): VaultOpenLoop[] {
  return loops
    .filter((loop) => loop.bucket === 'high')
    .slice()
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.daysOpen - left.daysOpen;
    })
    .slice(0, limit);
}

export function getOpenLoopNextAction(loop: Pick<VaultOpenLoop, 'nextSteps' | 'routineType'>): string {
  if (loop.nextSteps.length > 0) {
    return loop.nextSteps[0];
  }

  if (loop.routineType === 'debugging') {
    return 'Reproduce or resolve this debugging thread';
  }

  return 'Decide whether this loop is still active';
}
