// ============================================================================
// Open-Loops v2 — legacy candidate inventory and shadow telemetry
// ============================================================================

import { and, eq, ne, or, sql } from 'drizzle-orm';
import { memoryItems, openLoops, projects } from '../database/schema.js';
import { now } from '../utils/datetime.js';
import { getProject } from './project.service.js';
import { countOpenLoops } from './retrieve.service.js';
import type {
  LegacyLoopCandidate,
  LegacyLoopCandidateReport,
  OpenLoopShadowTelemetry,
} from '../types/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

export function inventoryLegacyLoopCandidates(
  db: DB,
  project?: string,
): LegacyLoopCandidateReport {
  const conditions = [or(
    sql`TRIM(${memoryItems.nextStepsJson}) NOT IN ('', '[]')`,
    sql`${memoryItems.snoozedUntil} IS NOT NULL`,
    and(eq(memoryItems.status, 'active'), eq(memoryItems.routineType, 'debugging')),
    eq(memoryItems.status, 'resolved'),
  )];
  if (project) conditions.push(eq(memoryItems.project, project));
  const rows = db.select().from(memoryItems)
    .where(and(...conditions))
    .orderBy(memoryItems.id)
    .all();
  const candidates = rows.map((row): LegacyLoopCandidate => {
    const nextSteps = parseStringArray(row.nextStepsJson);
    const reasons: LegacyLoopCandidate['reasons'] = [];
    if (nextSteps.length > 0) reasons.push('non_empty_next_steps');
    if (row.snoozedUntil) reasons.push('snoozed');
    if (row.status === 'active' && row.routineType === 'debugging') reasons.push('active_debugging');
    if (row.status === 'resolved') reasons.push('resolved');
    return {
      itemUid: row.itemUid,
      project: row.project,
      status: row.status as LegacyLoopCandidate['status'],
      routineType: row.routineType as LegacyLoopCandidate['routineType'],
      nextSteps,
      snoozedUntil: row.snoozedUntil,
      outcome: row.outcome as LegacyLoopCandidate['outcome'],
      reasons,
    };
  });
  const byReason: Record<string, number> = {};
  for (const candidate of candidates) {
    for (const reason of candidate.reasons) {
      byReason[reason] = (byReason[reason] || 0) + 1;
    }
  }
  return {
    generatedAt: now(),
    total: candidates.length,
    byReason,
    candidates,
    dedicatedLoopsCreated: 0,
  };
}

export function getOpenLoopShadowTelemetry(
  db: DB,
  projectIdentifier?: string,
): OpenLoopShadowTelemetry {
  const projectRow = projectIdentifier
    ? db.select().from(projects).where(or(
        eq(projects.projectUid, projectIdentifier),
        eq(projects.name, projectIdentifier),
      )).get()
    : null;
  if (projectIdentifier && !projectRow) {
    throw new Error(`Project not found: ${projectIdentifier}`);
  }
  const project = projectRow ? getProject(db, projectRow.name) : null;
  const legacyCount = countOpenLoops(db, { project: project?.name }).total;
  const dedicatedConditions = [ne(openLoops.state, 'resolved')];
  if (project?.projectUid) dedicatedConditions.push(eq(openLoops.projectUid, project.projectUid));
  const dedicatedCount = project && !project.projectUid
    ? 0
    : Number(db.select({ count: sql<number>`count(*)` })
        .from(openLoops).where(and(...dedicatedConditions)).get()?.count || 0);

  return {
    generatedAt: now(),
    projectUid: project?.projectUid || null,
    projectName: project?.name || null,
    projectType: project?.projectType || null,
    lifecycleState: project?.lifecycleState || null,
    legacySource: 'legacy_memory_items',
    dedicatedSource: 'dedicated_open_loops',
    legacyCount,
    dedicatedCount,
    divergence: dedicatedCount - legacyCount,
    brainInvariantSatisfied: project?.projectType !== 'brain_context' || dedicatedCount === 0,
    gateEnforced: false,
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}
