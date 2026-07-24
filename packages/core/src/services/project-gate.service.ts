// ============================================================================
// Open-Loops v2 — deterministic shadow-mode project gate evaluation
// ============================================================================

import { and, eq, ne } from 'drizzle-orm';
import { gateEvents, openLoops, projects } from '../database/schema.js';
import { EvaluateProjectGateInputSchema } from '../rules/validation.js';
import { WORK_INTENTS } from '../rules/controlled-values.js';
import { generateGateEventUid } from '../utils/uid.js';
import { now } from '../utils/datetime.js';
import { getProject } from './project.service.js';
import { getAuthorizationPolicy } from './open-loop-policy.service.js';
import { assertAuthorized, authorizeProjectAction } from './authorization.service.js';
import { recordInlineAuthorizationGrant } from './approval.service.js';
import { OpenLoopServiceError } from './open-loop-errors.js';
import type {
  EvaluateProjectGateInput,
  Project,
  ProjectGateResult,
} from '../types/index.js';
import type { WorkIntent } from '../rules/controlled-values.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

const BLOCKER_WORK_INTENTS: WorkIntent[] = [
  'close_loop',
  'gather_evidence',
  'request_decision',
  'request_snooze',
];

export function evaluateProjectGate(
  db: DB,
  input: EvaluateProjectGateInput,
): ProjectGateResult {
  const validated = EvaluateProjectGateInputSchema.parse(input);
  const replay = getGateReplay(db, validated);
  if (replay) return { ...replay, idempotentReplay: true };
  return db.transaction((tx) => {
    const transactionalDb = tx as DB;
    const transactionReplay = getGateReplay(transactionalDb, validated);
    if (transactionReplay) return { ...transactionReplay, idempotentReplay: true };
    const result = evaluateProjectGateSnapshot(transactionalDb, validated);
    const eventUid = generateGateEventUid();
    const project = requireProject(transactionalDb, validated.projectUid);
    if (validated.workIntent === 'urgent_safety' && result.allowed) {
      const authorization = assertAuthorized(authorizeProjectAction(
        transactionalDb,
        project,
        'urgent_safety_bypass',
        validated.actor,
        validated.authorizationRequestUid,
      ));
      if (authorization.policy.mode === 'owner' || authorization.policy.mode === 'role') {
        recordInlineAuthorizationGrant(transactionalDb, {
          action: 'urgent_safety_bypass',
          targetUid: validated.projectUid,
          policy: authorization.policy,
          actor: validated.actor,
          reason: 'Urgent safety gate bypass',
          idempotencyKey: validated.idempotencyKey,
          eventUid,
          scope: { blockerUids: result.blockerUids },
        });
      }
    }
    transactionalDb.insert(gateEvents).values({
      eventUid,
      projectUid: validated.projectUid,
      relatedLoopUid: validated.relatedLoopUid || null,
      idempotencyKey: validated.idempotencyKey,
      workIntent: validated.workIntent,
      actorUid: validated.actor.actorUid,
      actorKind: validated.actor.actorKind,
      decision: result.allowed ? 'allow' : 'deny',
      reasonCode: result.reasonCode,
      blockerUidsJson: JSON.stringify(result.blockerUids),
      resultJson: JSON.stringify(result),
      createdAt: result.evaluatedAt,
    }).run();
    return result;
  });
}

export function evaluateProjectGateSnapshot(
  db: DB,
  input: EvaluateProjectGateInput,
): ProjectGateResult {
  const project = requireProject(db, input.projectUid);
  const evaluatedAt = now();
  const policyVersion = resolvePolicyVersion(db, project);

  if (project.projectType === 'brain_context') {
    const allowed = input.workIntent === 'memory_maintenance';
    return buildResult(
      input,
      project,
      allowed,
      [],
      allowed ? 'BRAIN_MEMORY_ALLOWED' : 'BRAIN_LOOP_OPERATION_DENIED',
      ['memory_maintenance'],
      policyVersion,
      evaluatedAt,
    );
  }
  if (project.projectType === 'unclassified') {
    return buildResult(
      input,
      project,
      false,
      [],
      'PROJECT_UNCLASSIFIED',
      ['memory_maintenance'],
      policyVersion,
      evaluatedAt,
    );
  }

  const blockers = db.select({ loopUid: openLoops.loopUid })
    .from(openLoops)
    .where(and(
      eq(openLoops.projectUid, project.projectUid!),
      ne(openLoops.state, 'resolved'),
      ne(openLoops.state, 'snoozed'),
    )).all().map((row) => row.loopUid);
  const allowedIntents: WorkIntent[] = blockers.length > 0
    ? ['close_loop', 'gather_evidence', 'request_decision', 'request_snooze', 'urgent_safety', 'memory_maintenance']
    : [...WORK_INTENTS];

  if (input.workIntent === 'urgent_safety') {
    try {
      const authorization = authorizeProjectAction(
        db,
        project,
        'urgent_safety_bypass',
        input.actor,
        input.authorizationRequestUid,
      );
      return buildResult(
        input,
        project,
        authorization.authorized,
        blockers,
        authorization.authorized ? 'URGENT_SAFETY_AUTHORIZED' : 'URGENT_SAFETY_UNAUTHORIZED',
        allowedIntents,
        policyVersion,
        evaluatedAt,
      );
    } catch {
      return buildResult(input, project, false, blockers, 'URGENT_SAFETY_UNAUTHORIZED', allowedIntents, policyVersion, evaluatedAt);
    }
  }
  if (input.workIntent === 'memory_maintenance') {
    return buildResult(input, project, true, blockers, 'MEMORY_MAINTENANCE_ALLOWED', allowedIntents, policyVersion, evaluatedAt);
  }
  if (BLOCKER_WORK_INTENTS.includes(input.workIntent)) {
    if (!input.relatedLoopUid) {
      return buildResult(input, project, false, blockers, 'RELATED_LOOP_REQUIRED', allowedIntents, policyVersion, evaluatedAt);
    }
    const relatedIsBlocking = blockers.includes(input.relatedLoopUid);
    return buildResult(
      input,
      project,
      relatedIsBlocking,
      blockers,
      relatedIsBlocking ? 'RELATED_LOOP_ALLOWED' : 'RELATED_LOOP_NOT_BLOCKING',
      allowedIntents,
      policyVersion,
      evaluatedAt,
    );
  }
  return buildResult(
    input,
    project,
    blockers.length === 0,
    blockers,
    blockers.length === 0 ? 'NO_BLOCKERS' : 'SAME_PROJECT_BLOCKED',
    allowedIntents,
    policyVersion,
    evaluatedAt,
  );
}

function requireProject(db: DB, projectUid: string): Project {
  const row = db.select().from(projects).where(eq(projects.projectUid, projectUid)).get();
  if (!row) throw new OpenLoopServiceError('PROJECT_NOT_FOUND', `Project UID not found: ${projectUid}`);
  return getProject(db, row.name)!;
}

function resolvePolicyVersion(db: DB, project: Project): number {
  return project.authorizationPolicyId
    ? getAuthorizationPolicy(db, project.authorizationPolicyId)?.version || 0
    : 0;
}

function buildResult(
  input: EvaluateProjectGateInput,
  project: Project,
  allowed: boolean,
  blockerUids: string[],
  reasonCode: ProjectGateResult['reasonCode'],
  allowedIntents: WorkIntent[],
  policyVersion: number,
  evaluatedAt: string,
): ProjectGateResult {
  return {
    allowed,
    projectUid: input.projectUid,
    projectType: project.projectType,
    policyVersion,
    blockerUids,
    reasonCode,
    allowedIntents,
    evaluatedAt,
    idempotentReplay: false,
  };
}

function getGateReplay(
  db: DB,
  input: ReturnType<typeof EvaluateProjectGateInputSchema.parse>,
): ProjectGateResult | null {
  const row = db.select().from(gateEvents).where(eq(gateEvents.idempotencyKey, input.idempotencyKey)).get();
  if (!row) return null;
  if (row.projectUid !== input.projectUid || row.workIntent !== input.workIntent
    || row.relatedLoopUid !== (input.relatedLoopUid || null)) {
    throw new OpenLoopServiceError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was already used for a different gate evaluation',
      { idempotencyKey: input.idempotencyKey, existingProjectUid: row.projectUid, existingWorkIntent: row.workIntent },
    );
  }
  return JSON.parse(row.resultJson) as ProjectGateResult;
}
