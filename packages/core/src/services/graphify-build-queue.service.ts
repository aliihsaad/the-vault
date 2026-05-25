import { slugify } from '../rules/naming.js';
import type { MemoryItem } from '../types/index.js';
import type {
  GraphifyBuildMode,
  GraphifyProjectState,
  GraphifyProjectStatus,
  UpsertGraphifyProjectStateInput,
} from '../types/graphify.js';
import type { GraphifyProjectBuildResult } from './graphify-build.service.js';

export interface GraphifyBuildQueueTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface GraphifyBuildQueueClock {
  now(): number;
  isoNow(): string;
}

export interface GraphifyBuildQueueProjectStore {
  getProjectStatus(project: string): GraphifyProjectStatus;
  getProjectState(project: string): GraphifyProjectState | null;
  upsertProjectState(input: UpsertGraphifyProjectStateInput): GraphifyProjectState;
}

export type GraphifyBuildQueueTrigger =
  | 'auto'
  | 'manual';

export type GraphifyBuildQueueReason =
  | 'sourceChanged'
  | 'memorySaved'
  | 'projectChanged'
  | 'manualRebuild'
  | 'openLoopChanged';

export interface GraphifyQueuedBuildRequest {
  project: string;
  buildId: string;
  buildMode: GraphifyBuildMode;
  trigger: GraphifyBuildQueueTrigger;
  reason: GraphifyBuildQueueReason;
  coalescedReasons: GraphifyBuildQueueReason[];
}

export type GraphifyQueuedBuildExecutor = (
  request: GraphifyQueuedBuildRequest,
) => Promise<GraphifyProjectBuildResult> | GraphifyProjectBuildResult;

export type GraphifyBuildQueueTriggerStatus =
  | 'queued'
  | 'coalesced'
  | 'ignored'
  | 'backoff';

export interface GraphifyBuildQueueTriggerResult {
  status: GraphifyBuildQueueTriggerStatus;
  project: string;
  reason: string;
  queuedBuildId: string | null;
  scheduledForMs: number | null;
  coalescedReasons: GraphifyBuildQueueReason[];
}

export interface GraphifyBuildQueueStaleResult {
  status: 'stale' | 'ignored';
  project: string;
  reason: string;
  state: GraphifyProjectState | null;
}

export interface GraphifyBuildQueueProjectRuntimeState {
  project: string;
  active: boolean;
  queued: boolean;
  failureStreak: number;
  backoffUntilMs: number | null;
  coalescedReasons: GraphifyBuildQueueReason[];
}

export interface GraphifyBuildQueueOptions {
  projectStore: GraphifyBuildQueueProjectStore;
  timers: GraphifyBuildQueueTimers;
  clock: GraphifyBuildQueueClock;
  buildExecutor: GraphifyQueuedBuildExecutor;
  debounceMs?: number;
  maxAutoFailures?: number;
  backoffMs?: number;
}

type QueueEntry = {
  project: string;
  timerHandle: unknown | null;
  activePromise: Promise<GraphifyProjectBuildResult> | null;
  queuedBuildId: string | null;
  scheduledForMs: number | null;
  coalescedReasons: GraphifyBuildQueueReason[];
  pendingWhileActive: boolean;
  failureStreak: number;
  backoffUntilMs: number | null;
};

const DEFAULT_DEBOUNCE_MS = 60000;
const DEFAULT_MAX_AUTO_FAILURES = 3;
const DEFAULT_BACKOFF_MS = 5 * 60 * 1000;
const STALE_MEMORY_TYPES = new Set<MemoryItem['memoryType']>([
  'decision',
  'handoff',
  'plan',
  'summary',
  'session',
]);

export class GraphifyBuildQueue {
  private readonly projectStore: GraphifyBuildQueueProjectStore;
  private readonly timers: GraphifyBuildQueueTimers;
  private readonly clock: GraphifyBuildQueueClock;
  private readonly buildExecutor: GraphifyQueuedBuildExecutor;
  private readonly debounceMs: number;
  private readonly maxAutoFailures: number;
  private readonly backoffMs: number;
  private readonly entries = new Map<string, QueueEntry>();
  private buildSequence = 0;

  constructor(options: GraphifyBuildQueueOptions) {
    this.projectStore = options.projectStore;
    this.timers = options.timers;
    this.clock = options.clock;
    this.buildExecutor = options.buildExecutor;
    this.debounceMs = normalizePositiveInteger(options.debounceMs, DEFAULT_DEBOUNCE_MS);
    this.maxAutoFailures = normalizePositiveInteger(options.maxAutoFailures, DEFAULT_MAX_AUTO_FAILURES);
    this.backoffMs = normalizePositiveInteger(options.backoffMs, DEFAULT_BACKOFF_MS);
  }

  triggerAutoBuild(
    project: string,
    input: { reason: GraphifyBuildQueueReason },
  ): GraphifyBuildQueueTriggerResult {
    const status = this.projectStore.getProjectStatus(project);
    const eligibility = getBuildEligibility(status);
    if (!eligibility.ok) {
      return {
        status: 'ignored',
        project: status.project,
        reason: eligibility.reason,
        queuedBuildId: null,
        scheduledForMs: null,
        coalescedReasons: [],
      };
    }

    const entry = this.getEntry(status.project);
    if (entry.backoffUntilMs !== null && this.clock.now() < entry.backoffUntilMs) {
      return {
        status: 'backoff',
        project: status.project,
        reason: 'backoff',
        queuedBuildId: null,
        scheduledForMs: entry.backoffUntilMs,
        coalescedReasons: [],
      };
    }

    if (entry.activePromise) {
      entry.pendingWhileActive = true;
      addCoalescedReason(entry, input.reason);
      return {
        status: 'queued',
        project: status.project,
        reason: 'active',
        queuedBuildId: entry.queuedBuildId,
        scheduledForMs: entry.scheduledForMs,
        coalescedReasons: [...entry.coalescedReasons],
      };
    }

    if (entry.timerHandle !== null) {
      addCoalescedReason(entry, input.reason);
      return {
        status: 'coalesced',
        project: status.project,
        reason: input.reason,
        queuedBuildId: entry.queuedBuildId,
        scheduledForMs: entry.scheduledForMs,
        coalescedReasons: [...entry.coalescedReasons],
      };
    }

    addCoalescedReason(entry, input.reason);
    entry.queuedBuildId = this.createBuildId(status.project);
    entry.scheduledForMs = this.clock.now() + this.debounceMs;
    entry.timerHandle = this.timers.setTimeout(() => {
      this.runQueuedBuild(status.project);
    }, this.debounceMs);

    writeGraphifyProjectFreshness(this.projectStore, status.project, 'queued', {
      buildMode: status.buildMode,
      latestBuildId: status.state?.latestBuildId ?? null,
      lastError: status.state?.lastError ?? null,
    });

    return {
      status: 'queued',
      project: status.project,
      reason: input.reason,
      queuedBuildId: entry.queuedBuildId,
      scheduledForMs: entry.scheduledForMs,
      coalescedReasons: [...entry.coalescedReasons],
    };
  }

  rebuildNow(
    project: string,
    input: { reason: GraphifyBuildQueueReason },
  ): Promise<GraphifyProjectBuildResult> {
    const status = this.projectStore.getProjectStatus(project);
    const eligibility = getBuildEligibility(status);
    if (!eligibility.ok) {
      return Promise.reject(new Error(eligibility.reason));
    }

    const entry = this.getEntry(status.project);
    this.clearQueuedTimer(entry);
    entry.coalescedReasons = [input.reason];
    entry.pendingWhileActive = false;
    entry.backoffUntilMs = null;

    return this.startBuild(status.project, 'manual', input.reason, [input.reason]);
  }

  markProjectStale(
    project: string,
    input: { reason: GraphifyBuildQueueReason },
  ): GraphifyBuildQueueStaleResult {
    return markGraphifyProjectStale(this.projectStore, project, input.reason);
  }

  getProjectQueueState(project: string): GraphifyBuildQueueProjectRuntimeState | null {
    const entry = this.entries.get(slugify(project));
    if (!entry) {
      return null;
    }

    return {
      project: entry.project,
      active: entry.activePromise !== null,
      queued: entry.timerHandle !== null || entry.pendingWhileActive,
      failureStreak: entry.failureStreak,
      backoffUntilMs: entry.backoffUntilMs,
      coalescedReasons: [...entry.coalescedReasons],
    };
  }

  async waitForIdle(project: string): Promise<void> {
    const entry = this.entries.get(slugify(project));
    if (!entry) {
      return;
    }

    while (entry.activePromise) {
      await entry.activePromise.catch(() => undefined);
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      this.clearQueuedTimer(entry);
    }
    this.entries.clear();
  }

  private runQueuedBuild(project: string): void {
    const entry = this.getEntry(project);
    entry.timerHandle = null;
    entry.scheduledForMs = null;

    if (entry.activePromise) {
      entry.pendingWhileActive = true;
      return;
    }

    const buildId = entry.queuedBuildId ?? this.createBuildId(project);
    const reasons: GraphifyBuildQueueReason[] = entry.coalescedReasons.length > 0
      ? [...entry.coalescedReasons]
      : ['sourceChanged'];
    const primaryReason = reasons[0] ?? 'sourceChanged';
    entry.queuedBuildId = buildId;
    entry.coalescedReasons = [];
    entry.pendingWhileActive = false;

    void this.startBuild(project, 'auto', primaryReason, reasons, buildId);
  }

  private startBuild(
    project: string,
    trigger: GraphifyBuildQueueTrigger,
    reason: GraphifyBuildQueueReason,
    coalescedReasons: GraphifyBuildQueueReason[],
    buildId = this.createBuildId(project),
  ): Promise<GraphifyProjectBuildResult> {
    const status = this.projectStore.getProjectStatus(project);
    const entry = this.getEntry(status.project);
    if (entry.activePromise) {
      return entry.activePromise;
    }

    entry.queuedBuildId = null;
    entry.scheduledForMs = null;
    writeGraphifyProjectFreshness(this.projectStore, status.project, 'building', {
      buildMode: status.buildMode,
      latestBuildId: buildId,
      lastBuildStartedAt: this.clock.isoNow(),
      lastBuildCompletedAt: null,
      lastError: null,
    });

    const request: GraphifyQueuedBuildRequest = {
      project: status.project,
      buildId,
      buildMode: status.buildMode,
      trigger,
      reason,
      coalescedReasons,
    };

    let buildResult: Promise<GraphifyProjectBuildResult> | GraphifyProjectBuildResult;
    try {
      buildResult = this.buildExecutor(request);
    } catch (error) {
      buildResult = this.recordThrownFailure(status.project, status.buildMode, buildId, error, trigger);
    }

    const activePromise = Promise.resolve(buildResult)
      .then((result) => {
        this.recordResult(entry, result, trigger);
        return result;
      })
      .catch((error) => {
        const result = this.recordThrownFailure(status.project, status.buildMode, buildId, error, trigger);
        return result;
      })
      .finally(() => {
        entry.activePromise = null;
        if (entry.pendingWhileActive) {
          const pendingReasons: GraphifyBuildQueueReason[] = entry.coalescedReasons.length > 0
            ? [...entry.coalescedReasons]
            : ['sourceChanged'];
          entry.coalescedReasons = [];
          entry.pendingWhileActive = false;
          const pendingReason = pendingReasons[0] ?? 'sourceChanged';
          for (const nextReason of pendingReasons) {
            addCoalescedReason(entry, nextReason);
          }

          if (entry.backoffUntilMs === null || this.clock.now() >= entry.backoffUntilMs) {
            this.triggerAutoBuild(status.project, { reason: pendingReason });
          }
        }
      });

    entry.activePromise = activePromise;
    return activePromise;
  }

  private recordResult(
    entry: QueueEntry,
    result: GraphifyProjectBuildResult,
    trigger: GraphifyBuildQueueTrigger,
  ): void {
    if (result.status === 'fresh') {
      entry.failureStreak = 0;
      entry.backoffUntilMs = null;
      return;
    }

    if (trigger === 'auto') {
      entry.failureStreak += 1;
      if (entry.failureStreak >= this.maxAutoFailures) {
        entry.backoffUntilMs = this.clock.now() + this.backoffMs;
      }
    }
  }

  private recordThrownFailure(
    project: string,
    buildMode: GraphifyBuildMode,
    buildId: string,
    error: unknown,
    trigger: GraphifyBuildQueueTrigger,
  ): GraphifyProjectBuildResult {
    const entry = this.getEntry(project);
    if (trigger === 'auto') {
      entry.failureStreak += 1;
      if (entry.failureStreak >= this.maxAutoFailures) {
        entry.backoffUntilMs = this.clock.now() + this.backoffMs;
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    const state = writeGraphifyProjectFreshness(this.projectStore, project, 'failed', {
      buildMode,
      latestBuildId: buildId,
      lastBuildCompletedAt: this.clock.isoNow(),
      failureCountIncrement: 1,
      lastError: message,
    });

    return {
      buildId,
      project,
      status: 'failed',
      buildMode,
      startedAt: state?.lastBuildStartedAt ?? this.clock.isoNow(),
      completedAt: this.clock.isoNow(),
      command: 'graphify',
      args: [],
      logPath: '',
      artifactPaths: null,
      graphStats: null,
      errorMessage: message,
    };
  }

  private clearQueuedTimer(entry: QueueEntry): void {
    if (entry.timerHandle !== null) {
      this.timers.clearTimeout(entry.timerHandle);
    }
    entry.timerHandle = null;
    entry.queuedBuildId = null;
    entry.scheduledForMs = null;
    entry.coalescedReasons = [];
  }

  private getEntry(project: string): QueueEntry {
    const key = slugify(project);
    const existing = this.entries.get(key);
    if (existing) {
      return existing;
    }

    const entry: QueueEntry = {
      project,
      timerHandle: null,
      activePromise: null,
      queuedBuildId: null,
      scheduledForMs: null,
      coalescedReasons: [],
      pendingWhileActive: false,
      failureStreak: 0,
      backoffUntilMs: null,
    };
    this.entries.set(key, entry);
    return entry;
  }

  private createBuildId(project: string): string {
    this.buildSequence += 1;
    return `gb_${slugify(project)}_${this.clock.now().toString(36)}_${this.buildSequence}`;
  }
}

export function shouldMarkGraphifyStaleForMemoryChange(
  item: MemoryItem,
  updates?: Partial<MemoryItem>,
): boolean {
  if (STALE_MEMORY_TYPES.has(item.memoryType)) {
    return true;
  }

  if (updates && (
    updates.nextSteps !== undefined ||
    updates.snoozedUntil !== undefined ||
    updates.outcome !== undefined ||
    updates.status !== undefined
  )) {
    return true;
  }

  return item.status === 'active' && item.nextSteps.length > 0;
}

export function markGraphifyProjectStaleForMemoryChange(
  projectStore: GraphifyBuildQueueProjectStore,
  item: MemoryItem,
  updates?: Partial<MemoryItem>,
): GraphifyBuildQueueStaleResult {
  if (!shouldMarkGraphifyStaleForMemoryChange(item, updates)) {
    return {
      status: 'ignored',
      project: item.project,
      reason: 'memoryTypeIgnored',
      state: projectStore.getProjectState(item.project),
    };
  }

  return markGraphifyProjectStale(projectStore, item.project, 'memorySaved');
}

export function markGraphifyProjectStale(
  projectStore: GraphifyBuildQueueProjectStore,
  project: string,
  reason: GraphifyBuildQueueReason,
): GraphifyBuildQueueStaleResult {
  const status = projectStore.getProjectStatus(project);
  if (!status.enabled) {
    return {
      status: 'ignored',
      project: status.project,
      reason: 'disabled',
      state: status.state,
    };
  }

  if (!status.state || !status.state.sourceRoot) {
    return {
      status: 'ignored',
      project: status.project,
      reason: 'sourceRootRequired',
      state: status.state,
    };
  }

  const state = writeGraphifyProjectFreshness(projectStore, status.project, 'stale', {
    buildMode: status.buildMode,
    lastError: null,
  });
  return {
    status: 'stale',
    project: status.project,
    reason,
    state,
  };
}

function writeGraphifyProjectFreshness(
  projectStore: GraphifyBuildQueueProjectStore,
  project: string,
  freshness: GraphifyProjectState['freshness'],
  input: {
    buildMode?: GraphifyBuildMode;
    latestBuildId?: string | null;
    lastBuildStartedAt?: string | null;
    lastBuildCompletedAt?: string | null;
    failureCountIncrement?: number;
    lastError?: string | null;
  } = {},
): GraphifyProjectState | null {
  const status = projectStore.getProjectStatus(project);
  const state = status.state ?? projectStore.getProjectState(status.project);
  if (!state && !status.sourceRoot) {
    return null;
  }

  const failureCount = (state?.failureCount ?? 0) + (input.failureCountIncrement ?? 0);
  return projectStore.upsertProjectState({
    project: state?.project ?? status.project,
    enabled: state?.enabled ?? status.enabled,
    sourceRoot: state?.sourceRoot ?? status.sourceRoot,
    freshness,
    buildMode: input.buildMode ?? state?.buildMode ?? status.buildMode,
    latestBuildId: input.latestBuildId !== undefined
      ? input.latestBuildId
      : state?.latestBuildId ?? null,
    artifactPaths: state?.artifactPaths ?? null,
    graphStats: state?.graphStats ?? null,
    detectedGraphifyVersion: state?.detectedGraphifyVersion ?? null,
    lastBuildStartedAt: input.lastBuildStartedAt !== undefined
      ? input.lastBuildStartedAt
      : state?.lastBuildStartedAt ?? null,
    lastBuildCompletedAt: input.lastBuildCompletedAt !== undefined
      ? input.lastBuildCompletedAt
      : state?.lastBuildCompletedAt ?? null,
    failureCount,
    lastError: input.lastError !== undefined
      ? input.lastError
      : state?.lastError ?? null,
  });
}

function getBuildEligibility(status: GraphifyProjectStatus): { ok: true } | { ok: false; reason: string } {
  if (!status.enabled) {
    return { ok: false, reason: 'disabled' };
  }
  if (!status.sourceRoot || !status.buildEligible) {
    return { ok: false, reason: 'sourceRootRequired' };
  }
  return { ok: true };
}

function addCoalescedReason(entry: QueueEntry, reason: GraphifyBuildQueueReason): void {
  entry.coalescedReasons.push(reason);
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
