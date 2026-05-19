export type OpenLoopStalenessTone = 'fresh' | 'watch' | 'stale' | 'critical';
export type LoopControlRoutineFilter = 'all' | VaultRoutineType | 'none';

export type LoopControlFilters = {
  project: string;
  bucket: 'all' | VaultOpenLoopBucket;
  routine: LoopControlRoutineFilter;
  tag: string;
  selectedItemUid?: string | null;
};

export type LoopControlRow = {
  loop: VaultOpenLoop;
  staleness: ReturnType<typeof getOpenLoopStaleness>;
  nextAction: string;
  signals: string;
  pressure: number;
};

export type LoopControlModel = {
  metrics: {
    total: number;
    visible: number;
    high: number;
    medium: number;
    low: number;
    stale: number;
    critical: number;
    projectCount: number;
  };
  projects: string[];
  routines: LoopControlRoutineFilter[];
  tags: string[];
  visible: LoopControlRow[];
  selected: LoopControlRow | null;
};

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

export function getOpenLoopPressure(loop: Pick<VaultOpenLoop, 'bucket' | 'daysOpen' | 'score'>): number {
  const bucketBase: Record<VaultOpenLoopBucket, number> = {
    high: 44,
    medium: 25,
    low: 10,
  };
  const agePressure = Math.min(Math.max(loop.daysOpen, 0) * 3, 36);
  const scorePressure = Math.min(Math.max(loop.score, 0), 60) / 3;
  const criticalAgeBoost = loop.daysOpen >= 14 ? 10 : 0;

  return clampInteger(bucketBase[loop.bucket] + agePressure + scorePressure + criticalAgeBoost, 0, 100);
}

export function buildLoopControlModel(
  loops: VaultOpenLoop[],
  filters: LoopControlFilters,
): LoopControlModel {
  const projects = Array.from(new Set(loops.map((loop) => loop.project))).sort();
  const routines = Array.from(new Set(loops.map((loop) => loop.routineType || 'none'))).sort() as LoopControlRoutineFilter[];
  const tags = Array.from(new Set(loops.flatMap((loop) => loop.tags))).sort();
  const visibleLoops = loops.filter((loop) => (
    (filters.project === 'all' || loop.project === filters.project)
    && (filters.bucket === 'all' || loop.bucket === filters.bucket)
    && (filters.routine === 'all' || (filters.routine === 'none' ? !loop.routineType : loop.routineType === filters.routine))
    && (filters.tag === 'all' || loop.tags.includes(filters.tag))
  ));
  const visible = visibleLoops
    .map((loop): LoopControlRow => ({
      loop,
      staleness: getOpenLoopStaleness(loop.daysOpen),
      nextAction: getOpenLoopNextAction(loop),
      signals: describeOpenLoopSignals(loop),
      pressure: getOpenLoopPressure(loop),
    }))
    .sort((left, right) => {
      const bucketOrder: Record<VaultOpenLoopBucket, number> = { high: 0, medium: 1, low: 2 };
      if (bucketOrder[left.loop.bucket] !== bucketOrder[right.loop.bucket]) {
        return bucketOrder[left.loop.bucket] - bucketOrder[right.loop.bucket];
      }

      if (right.loop.score !== left.loop.score) {
        return right.loop.score - left.loop.score;
      }

      if (right.pressure !== left.pressure) {
        return right.pressure - left.pressure;
      }

      return right.loop.daysOpen - left.loop.daysOpen || left.loop.title.localeCompare(right.loop.title);
    });
  const selected = visible.find((row) => row.loop.itemUid === filters.selectedItemUid) || visible[0] || null;

  return {
    metrics: {
      total: loops.length,
      visible: visible.length,
      high: loops.filter((loop) => loop.bucket === 'high').length,
      medium: loops.filter((loop) => loop.bucket === 'medium').length,
      low: loops.filter((loop) => loop.bucket === 'low').length,
      stale: loops.filter((loop) => loop.daysOpen >= 7).length,
      critical: loops.filter((loop) => loop.daysOpen >= 14).length,
      projectCount: projects.length,
    },
    projects,
    routines: routines.length > 0 ? routines : ['none'],
    tags,
    visible,
    selected,
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.round(Math.max(min, Math.min(max, value)));
}
