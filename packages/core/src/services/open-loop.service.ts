// ============================================================================
// Open-Loops v2 — dedicated loop lifecycle and transactional event history
// ============================================================================

import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import {
  loopEvents,
  openLoops,
  projects,
} from '../database/schema.js';
import {
  AddLoopEvidenceInputSchema,
  CountDedicatedOpenLoopsInputSchema,
  CreateOpenLoopInputSchema,
  ListDedicatedOpenLoopsInputSchema,
  RecoverOpenLoopInputSchema,
  ResolveOpenLoopInputSchema,
  TransitionOpenLoopInputSchema,
} from '../rules/validation.js';
import {
  generateEvidenceUid,
  generateLoopEventUid,
  generateLoopUid,
} from '../utils/uid.js';
import { now } from '../utils/datetime.js';
import { getProject } from './project.service.js';
import { getEvidencePolicy, getOpenLoopInstallationDefaults } from './open-loop-policy.service.js';
import { assertAuthorized, authorizeProjectAction } from './authorization.service.js';
import { recordInlineAuthorizationGrant } from './approval.service.js';
import { OpenLoopServiceError } from './open-loop-errors.js';
import { evaluateProjectGateSnapshot } from './project-gate.service.js';
import type {
  AddLoopEvidenceInput,
  CountDedicatedOpenLoopsInput,
  CountDedicatedOpenLoopsResult,
  CreateOpenLoopInput,
  CreateOpenLoopResult,
  DedicatedOpenLoop,
  ListDedicatedOpenLoopsInput,
  ListDedicatedOpenLoopsResult,
  LoopEvidenceReference,
  OpenLoopMutationResult,
  RecoverOpenLoopInput,
  ResolveOpenLoopInput,
  ResolveOpenLoopResult,
  TransitionOpenLoopInput,
} from '../types/index.js';
import type { LoopState } from '../rules/controlled-values.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

export interface OpenLoopMutationHooks {
  beforeEventWrite?: () => void;
}

const LEGAL_TRANSITIONS: Record<Exclude<LoopState, 'resolved'>, LoopState[]> = {
  open: ['verification_needed', 'awaiting_approval', 'awaiting_user', 'externally_blocked', 'snoozed', 'resolved'],
  verification_needed: ['open', 'awaiting_approval', 'awaiting_user', 'externally_blocked', 'snoozed', 'resolved'],
  awaiting_approval: ['open', 'verification_needed', 'awaiting_user', 'externally_blocked', 'snoozed', 'resolved'],
  awaiting_user: ['open', 'verification_needed', 'awaiting_approval', 'externally_blocked', 'snoozed', 'resolved'],
  externally_blocked: ['open', 'verification_needed', 'awaiting_approval', 'awaiting_user', 'snoozed', 'resolved'],
  snoozed: ['open', 'verification_needed', 'awaiting_approval', 'awaiting_user', 'externally_blocked'],
};

export function createOpenLoop(
  db: DB,
  input: CreateOpenLoopInput,
  hooks: OpenLoopMutationHooks = {},
): CreateOpenLoopResult {
  const validated = CreateOpenLoopInputSchema.parse(input);
  const replay = getLoopEventReplay<CreateOpenLoopResult>(db, validated.idempotencyKey, 'created');
  if (replay) {
    assertCreateReplayMatches(replay, validated);
    return { ...replay, idempotentReplay: true };
  }

  try {
    return db.transaction((tx) => {
      const transactionalDb = tx as DB;
      const transactionReplay = getLoopEventReplay<CreateOpenLoopResult>(transactionalDb, validated.idempotencyKey, 'created');
      if (transactionReplay) {
        assertCreateReplayMatches(transactionReplay, validated);
        return { ...transactionReplay, idempotentReplay: true };
      }
      const project = requireProjectByUid(transactionalDb, validated.projectUid);
      if (project.projectType !== 'work_project') {
        throw new OpenLoopServiceError(
          'BRAIN_CONTEXT_LOOPS_FORBIDDEN',
          project.projectType === 'brain_context'
            ? 'Brain contexts cannot own dedicated open loops'
            : 'Legacy-unclassified projects must be classified before loop admission',
          { projectType: project.projectType },
        );
      }
      const authorization = assertAuthorized(authorizeProjectAction(
        transactionalDb,
        project,
        'create_open_loop',
        validated.creatingActor,
        validated.authorizationRequestUid,
      ));
      const duplicate = transactionalDb.select().from(openLoops).where(and(
        eq(openLoops.projectUid, validated.projectUid),
        eq(openLoops.dedupeKey, validated.dedupeKey),
        ne(openLoops.state, 'resolved'),
      )).get();
      if (duplicate) {
        throw new OpenLoopServiceError(
          'DUPLICATE_OPEN_LOOP',
          `A nonterminal loop already uses dedupe key ${validated.dedupeKey}`,
          { loopUid: duplicate.loopUid },
        );
      }

      const loopUid = generateLoopUid();
      const eventUid = generateLoopEventUid();
      const timestamp = now();
      transactionalDb.insert(openLoops).values({
        loopUid,
        projectUid: validated.projectUid,
        title: validated.title,
        commitment: validated.commitment,
        deferredReason: validated.deferredReason,
        ownerKind: validated.ownerKind,
        ownerReference: validated.ownerReference,
        immediateNextAction: validated.immediateNextAction,
        triggerKind: validated.triggerKind,
        triggerValue: validated.triggerValue,
        currentEvidenceSummary: validated.currentEvidenceSummary,
        closureCriteria: validated.closureCriteria,
        evidenceJson: '[]',
        state: 'open',
        terminalOutcome: null,
        priority: validated.priority,
        blockingScope: validated.blockingScope,
        dedupeKey: validated.dedupeKey,
        sourceMemoryUid: validated.sourceMemoryUid || null,
        sourceTaskUid: validated.sourceTaskUid || null,
        sourceSessionUid: validated.sourceSessionUid || null,
        sourceHandoffUid: validated.sourceHandoffUid || null,
        externalReference: validated.externalReference || null,
        sourceContextJson: JSON.stringify(validated.sourceContext),
        creatingActorUid: validated.creatingActor.actorUid,
        creatingActorKind: validated.creatingActor.actorKind,
        resumeState: null,
        snoozedUntil: null,
        dependencyTrigger: null,
        resolutionNote: null,
        resolvedAt: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).run();
      const loop = requireOpenLoop(transactionalDb, loopUid);
      const result: CreateOpenLoopResult = {
        loop,
        eventUid,
        idempotentReplay: false,
      };
      if (authorization.policy.mode === 'owner' || authorization.policy.mode === 'role') {
        recordInlineAuthorizationGrant(transactionalDb, {
          action: 'create_open_loop',
          targetUid: loopUid,
          policy: authorization.policy,
          actor: validated.creatingActor,
          reason: validated.deferredReason,
          idempotencyKey: validated.idempotencyKey,
          eventUid,
          scope: { projectUid: validated.projectUid, dedupeKey: validated.dedupeKey },
        });
      }
      hooks.beforeEventWrite?.();
      insertLoopEvent(transactionalDb, {
        eventUid,
        loopUid,
        idempotencyKey: validated.idempotencyKey,
        eventType: 'created',
        actorUid: validated.creatingActor.actorUid,
        actorKind: validated.creatingActor.actorKind,
        authorizationPolicyUid: authorization.policy.policyUid,
        authorizationPolicyVersion: authorization.policy.version,
        previousState: null,
        nextState: 'open',
        payload: { dedupeKey: validated.dedupeKey, sourceContext: validated.sourceContext },
        evidenceReferences: [],
        result,
        correlationUid: validated.correlationUid || null,
        createdAt: timestamp,
      });
      return result;
    });
  } catch (error) {
    if (error instanceof OpenLoopServiceError) throw error;
    if (String(error).includes('idx_open_loops_active_dedupe') || String(error).includes('UNIQUE constraint failed: open_loops.project_uid, open_loops.dedupe_key')) {
      const duplicate = db.select().from(openLoops).where(and(
        eq(openLoops.projectUid, validated.projectUid),
        eq(openLoops.dedupeKey, validated.dedupeKey),
        ne(openLoops.state, 'resolved'),
      )).get();
      throw new OpenLoopServiceError('DUPLICATE_OPEN_LOOP', 'Concurrent admission created the canonical loop first', {
        loopUid: duplicate?.loopUid,
      });
    }
    throw error;
  }
}

export function getOpenLoop(db: DB, loopUid: string): DedicatedOpenLoop | null {
  expireDueSnoozes(db);
  const row = db.select().from(openLoops).where(eq(openLoops.loopUid, loopUid)).get();
  return row ? mapOpenLoopRow(db, row) : null;
}

export function listDedicatedOpenLoops(
  db: DB,
  input: ListDedicatedOpenLoopsInput = {},
): ListDedicatedOpenLoopsResult {
  expireDueSnoozes(db);
  const validated = ListDedicatedOpenLoopsInputSchema.parse(input);
  const conditions = [];
  if (validated.projectUid) conditions.push(eq(openLoops.projectUid, validated.projectUid));
  if (validated.states?.length) conditions.push(inArray(openLoops.state, validated.states));
  else if (!validated.includeResolved) conditions.push(ne(openLoops.state, 'resolved'));
  const rows = db.select().from(openLoops)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(openLoops.createdAt), asc(openLoops.id))
    .all();
  const page = rows.slice(validated.offset, validated.offset + validated.limit);
  return {
    source: 'dedicated_open_loops',
    total: rows.length,
    limit: validated.limit,
    offset: validated.offset,
    hasMore: validated.offset + validated.limit < rows.length,
    generatedAt: now(),
    items: page.map((row) => mapOpenLoopRow(db, row)),
  };
}

export function countDedicatedOpenLoops(
  db: DB,
  input: CountDedicatedOpenLoopsInput = {},
): CountDedicatedOpenLoopsResult {
  expireDueSnoozes(db);
  const validated = CountDedicatedOpenLoopsInputSchema.parse(input);
  const conditions = [];
  if (validated.projectUid) conditions.push(eq(openLoops.projectUid, validated.projectUid));
  if (validated.states?.length) conditions.push(inArray(openLoops.state, validated.states));
  else if (!validated.includeResolved) conditions.push(ne(openLoops.state, 'resolved'));
  const rows = db.select({ projectUid: openLoops.projectUid })
    .from(openLoops)
    .where(conditions.length ? and(...conditions) : undefined)
    .all();
  const result: CountDedicatedOpenLoopsResult = {
    source: 'dedicated_open_loops',
    total: rows.length,
    generatedAt: now(),
  };
  if (validated.byProject) {
    result.byProject = {};
    const projectNames = new Map(
      db.select({ projectUid: projects.projectUid, name: projects.name })
        .from(projects)
        .all()
        .filter((project) => project.projectUid)
        .map((project) => [project.projectUid!, project.name]),
    );
    for (const row of rows) {
      const projectName = projectNames.get(row.projectUid) ?? row.projectUid;
      result.byProject[projectName] = (result.byProject[projectName] || 0) + 1;
    }
  }
  return result;
}

export function transitionOpenLoop(
  db: DB,
  input: TransitionOpenLoopInput,
  hooks: OpenLoopMutationHooks = {},
): OpenLoopMutationResult {
  const validated = TransitionOpenLoopInputSchema.parse(input);
  const replay = getLoopEventReplay<OpenLoopMutationResult>(db, validated.idempotencyKey, 'state_changed', validated.loopUid);
  if (replay) return { ...replay, idempotentReplay: true };
  return db.transaction((tx) => {
    const transactionalDb = tx as DB;
    const transactionReplay = getLoopEventReplay<OpenLoopMutationResult>(transactionalDb, validated.idempotencyKey, 'state_changed', validated.loopUid);
    if (transactionReplay) return { ...transactionReplay, idempotentReplay: true };
    const loop = requireOpenLoop(transactionalDb, validated.loopUid);
    assertExpectedLoopVersion(loop, validated.expectedVersion);
    if (loop.state === 'snoozed') {
      throw new OpenLoopServiceError(
        'ILLEGAL_STATE_TRANSITION',
        'Snoozed loops must resume through their governed lifecycle operation',
      );
    }
    assertLegalTransition(loop.state, validated.nextState);
    const eventUid = generateLoopEventUid();
    const timestamp = now();
    const update = transactionalDb.update(openLoops).set({
      state: validated.nextState,
      version: loop.version + 1,
      updatedAt: timestamp,
    }).where(and(eq(openLoops.loopUid, loop.loopUid), eq(openLoops.version, loop.version))).run();
    if (update.changes !== 1) throw loopVersionConflict(loop, validated.expectedVersion);
    const updated = requireOpenLoop(transactionalDb, loop.loopUid);
    const result: OpenLoopMutationResult = { loop: updated, eventUid, idempotentReplay: false };
    hooks.beforeEventWrite?.();
    insertLoopEvent(transactionalDb, {
      eventUid,
      loopUid: loop.loopUid,
      idempotencyKey: validated.idempotencyKey,
      eventType: 'state_changed',
      actorUid: validated.actor.actorUid,
      actorKind: validated.actor.actorKind,
      authorizationPolicyUid: null,
      authorizationPolicyVersion: null,
      previousState: loop.state,
      nextState: validated.nextState,
      payload: { reason: validated.reason },
      evidenceReferences: [],
      result,
      correlationUid: validated.correlationUid || null,
      createdAt: timestamp,
    });
    return result;
  });
}

export function addLoopEvidence(
  db: DB,
  input: AddLoopEvidenceInput,
  hooks: OpenLoopMutationHooks = {},
): OpenLoopMutationResult {
  const validated = AddLoopEvidenceInputSchema.parse(input);
  const replay = getLoopEventReplay<OpenLoopMutationResult>(db, validated.idempotencyKey, 'evidence_added', validated.loopUid);
  if (replay) return { ...replay, idempotentReplay: true };
  for (const evidence of validated.evidence) assertEvidenceReferenceSafe(evidence.reference);
  return db.transaction((tx) => {
    const transactionalDb = tx as DB;
    const transactionReplay = getLoopEventReplay<OpenLoopMutationResult>(transactionalDb, validated.idempotencyKey, 'evidence_added', validated.loopUid);
    if (transactionReplay) return { ...transactionReplay, idempotentReplay: true };
    const loop = requireOpenLoop(transactionalDb, validated.loopUid);
    assertExpectedLoopVersion(loop, validated.expectedVersion);
    if (loop.state === 'resolved') {
      throw new OpenLoopServiceError('LOOP_ALREADY_RESOLVED', 'Resolved loops cannot accept new evidence');
    }
    const timestamp = now();
    const additions: LoopEvidenceReference[] = validated.evidence.map((evidence) => ({
      evidenceUid: generateEvidenceUid(),
      kind: evidence.kind,
      reference: evidence.reference,
      description: evidence.description,
      immutableHash: evidence.immutableHash || null,
      addedByActorUid: validated.actor.actorUid,
      addedByActorKind: validated.actor.actorKind,
      addedAt: timestamp,
    }));
    const nextState = validated.transitionToVerification ? 'verification_needed' : loop.state;
    if (validated.transitionToVerification) assertLegalTransition(loop.state, nextState);
    const eventUid = generateLoopEventUid();
    const update = transactionalDb.update(openLoops).set({
      evidenceJson: JSON.stringify([...loop.evidence, ...additions]),
      currentEvidenceSummary: validated.currentEvidenceSummary,
      state: nextState,
      version: loop.version + 1,
      updatedAt: timestamp,
    }).where(and(eq(openLoops.loopUid, loop.loopUid), eq(openLoops.version, loop.version))).run();
    if (update.changes !== 1) throw loopVersionConflict(loop, validated.expectedVersion);
    const updated = requireOpenLoop(transactionalDb, loop.loopUid);
    const result: OpenLoopMutationResult = { loop: updated, eventUid, idempotentReplay: false };
    hooks.beforeEventWrite?.();
    insertLoopEvent(transactionalDb, {
      eventUid,
      loopUid: loop.loopUid,
      idempotencyKey: validated.idempotencyKey,
      eventType: 'evidence_added',
      actorUid: validated.actor.actorUid,
      actorKind: validated.actor.actorKind,
      authorizationPolicyUid: null,
      authorizationPolicyVersion: null,
      previousState: loop.state,
      nextState,
      payload: { currentEvidenceSummary: validated.currentEvidenceSummary },
      evidenceReferences: additions,
      result,
      correlationUid: validated.correlationUid || null,
      createdAt: timestamp,
    });
    return result;
  });
}

export function resolveOpenLoop(
  db: DB,
  input: ResolveOpenLoopInput,
  hooks: OpenLoopMutationHooks = {},
): ResolveOpenLoopResult {
  const validated = ResolveOpenLoopInputSchema.parse(input);
  const replay = getLoopEventReplay<ResolveOpenLoopResult>(db, validated.idempotencyKey, 'resolved', validated.loopUid);
  if (replay) return { ...replay, idempotentReplay: true };
  return db.transaction((tx) => {
    const transactionalDb = tx as DB;
    const transactionReplay = getLoopEventReplay<ResolveOpenLoopResult>(transactionalDb, validated.idempotencyKey, 'resolved', validated.loopUid);
    if (transactionReplay) return { ...transactionReplay, idempotentReplay: true };
    const loop = requireOpenLoop(transactionalDb, validated.loopUid);
    assertExpectedLoopVersion(loop, validated.expectedVersion);
    if (loop.state === 'resolved') {
      throw new OpenLoopServiceError('LOOP_ALREADY_RESOLVED', 'Loop is already resolved');
    }
    if (validated.outcome === 'fixed' && loop.state !== 'verification_needed') {
      throw new OpenLoopServiceError('ILLEGAL_STATE_TRANSITION', 'Fixed outcomes require verification_needed state');
    }
    const evidencePolicy = assertResolutionEvidence(
      transactionalDb,
      loop,
      validated.outcome,
      validated.duplicateOfLoopUid,
    );
    assertLegalTransition(loop.state, 'resolved');
    const eventUid = generateLoopEventUid();
    const timestamp = now();
    const update = transactionalDb.update(openLoops).set({
      state: 'resolved',
      terminalOutcome: validated.outcome,
      resolutionNote: validated.resolutionNote,
      resolvedAt: timestamp,
      resumeState: null,
      snoozedUntil: null,
      dependencyTrigger: null,
      version: loop.version + 1,
      updatedAt: timestamp,
    }).where(and(eq(openLoops.loopUid, loop.loopUid), eq(openLoops.version, loop.version))).run();
    if (update.changes !== 1) throw loopVersionConflict(loop, validated.expectedVersion);
    const updated = requireOpenLoop(transactionalDb, loop.loopUid);
    const gate = evaluateProjectGateSnapshot(transactionalDb, {
      projectUid: loop.projectUid,
      workIntent: 'normal_work',
      actor: validated.verifier,
      idempotencyKey: `${validated.idempotencyKey}:read-back`,
    });
    const result: ResolveOpenLoopResult = {
      loop: updated,
      gate,
      eventUid,
      idempotentReplay: false,
    };
    hooks.beforeEventWrite?.();
    insertLoopEvent(transactionalDb, {
      eventUid,
      loopUid: loop.loopUid,
      idempotencyKey: validated.idempotencyKey,
      eventType: 'resolved',
      actorUid: validated.verifier.actorUid,
      actorKind: validated.verifier.actorKind,
      authorizationPolicyUid: null,
      authorizationPolicyVersion: null,
      previousState: loop.state,
      nextState: 'resolved',
      payload: {
        outcome: validated.outcome,
        resolutionNote: validated.resolutionNote,
        duplicateOfLoopUid: validated.duplicateOfLoopUid || null,
        evidencePolicyUid: evidencePolicy.policyUid,
        evidencePolicyVersion: evidencePolicy.version,
        expectedVersion: validated.expectedVersion,
        gateReadBack: gate,
      },
      evidenceReferences: loop.evidence,
      result,
      correlationUid: validated.correlationUid || null,
      createdAt: timestamp,
    });
    return result;
  });
}

export function recoverOpenLoop(
  db: DB,
  input: RecoverOpenLoopInput,
  hooks: OpenLoopMutationHooks = {},
): OpenLoopMutationResult {
  const validated = RecoverOpenLoopInputSchema.parse(input);
  const replay = getLoopEventReplay<OpenLoopMutationResult>(db, validated.idempotencyKey, 'recovered', validated.loopUid);
  if (replay) return { ...replay, idempotentReplay: true };
  return db.transaction((tx) => {
    const transactionalDb = tx as DB;
    const transactionReplay = getLoopEventReplay<OpenLoopMutationResult>(transactionalDb, validated.idempotencyKey, 'recovered', validated.loopUid);
    if (transactionReplay) return { ...transactionReplay, idempotentReplay: true };
    const loop = requireOpenLoop(transactionalDb, validated.loopUid);
    assertExpectedLoopVersion(loop, validated.expectedVersion);
    if (loop.state !== 'resolved') {
      throw new OpenLoopServiceError('LOOP_NOT_RESOLVED', 'Only terminal loops can be recovered');
    }
    const project = requireProjectByUid(transactionalDb, loop.projectUid);
    const authorization = assertAuthorized(authorizeProjectAction(
      transactionalDb,
      project,
      'recover_open_loop',
      validated.actor,
      validated.authorizationRequestUid,
    ));
    const eventUid = generateLoopEventUid();
    const timestamp = now();
    const update = transactionalDb.update(openLoops).set({
      state: validated.recoveryState,
      terminalOutcome: null,
      resolutionNote: null,
      resolvedAt: null,
      resumeState: null,
      snoozedUntil: null,
      dependencyTrigger: null,
      version: loop.version + 1,
      updatedAt: timestamp,
    }).where(and(eq(openLoops.loopUid, loop.loopUid), eq(openLoops.version, loop.version))).run();
    if (update.changes !== 1) throw loopVersionConflict(loop, validated.expectedVersion);
    const updated = requireOpenLoop(transactionalDb, loop.loopUid);
    const result: OpenLoopMutationResult = { loop: updated, eventUid, idempotentReplay: false };
    if (authorization.policy.mode === 'owner' || authorization.policy.mode === 'role') {
      recordInlineAuthorizationGrant(transactionalDb, {
        action: 'recover_open_loop',
        targetUid: loop.loopUid,
        policy: authorization.policy,
        actor: validated.actor,
        reason: validated.reason,
        idempotencyKey: validated.idempotencyKey,
        eventUid,
        scope: { previousOutcome: loop.terminalOutcome, recoveryState: validated.recoveryState },
      });
    }
    hooks.beforeEventWrite?.();
    insertLoopEvent(transactionalDb, {
      eventUid,
      loopUid: loop.loopUid,
      idempotencyKey: validated.idempotencyKey,
      eventType: 'recovered',
      actorUid: validated.actor.actorUid,
      actorKind: validated.actor.actorKind,
      authorizationPolicyUid: authorization.policy.policyUid,
      authorizationPolicyVersion: authorization.policy.version,
      previousState: 'resolved',
      nextState: validated.recoveryState,
      payload: { reason: validated.reason, previousOutcome: loop.terminalOutcome },
      evidenceReferences: [],
      result,
      correlationUid: validated.correlationUid || null,
      createdAt: timestamp,
    });
    return result;
  });
}

export function expireDueSnoozes(db: DB, referenceTime = now()): number {
  const automaticActor = getOpenLoopInstallationDefaults(db).actor;
  const due = db.select().from(openLoops).where(and(
    eq(openLoops.state, 'snoozed'),
    sql`${openLoops.snoozedUntil} IS NOT NULL`,
    sql`${openLoops.snoozedUntil} <= ${referenceTime}`,
  )).all();
  let expired = 0;
  for (const row of due) {
    const idempotencyKey = `snooze-expiry:${row.loopUid}:${row.snoozedUntil}`;
    const replay = getLoopEventReplay<OpenLoopMutationResult>(db, idempotencyKey, 'snooze_expired', row.loopUid);
    if (replay) continue;
    db.transaction((tx) => {
      const transactionalDb = tx as DB;
      if (getLoopEventReplay<OpenLoopMutationResult>(transactionalDb, idempotencyKey, 'snooze_expired', row.loopUid)) return;
      const loop = requireOpenLoop(transactionalDb, row.loopUid);
      if (loop.state !== 'snoozed' || loop.snoozedUntil !== row.snoozedUntil) return;
      const resumeState = loop.resumeState || 'open';
      const eventUid = generateLoopEventUid();
      const update = transactionalDb.update(openLoops).set({
        state: resumeState,
        resumeState: null,
        snoozedUntil: null,
        dependencyTrigger: null,
        version: loop.version + 1,
        updatedAt: referenceTime,
      }).where(and(eq(openLoops.loopUid, loop.loopUid), eq(openLoops.version, loop.version))).run();
      if (update.changes !== 1) return;
      const updated = requireOpenLoop(transactionalDb, loop.loopUid);
      const result: OpenLoopMutationResult = { loop: updated, eventUid, idempotentReplay: false };
      insertLoopEvent(transactionalDb, {
        eventUid,
        loopUid: loop.loopUid,
        idempotencyKey,
        eventType: 'snooze_expired',
        actorUid: automaticActor.actorUid,
        actorKind: automaticActor.actorKind,
        authorizationPolicyUid: null,
        authorizationPolicyVersion: null,
        previousState: 'snoozed',
        nextState: resumeState,
        payload: { expiredAt: referenceTime, scheduledUntil: row.snoozedUntil },
        evidenceReferences: [],
        result,
        correlationUid: null,
        createdAt: referenceTime,
      });
      expired += 1;
    });
  }
  return expired;
}

export function resumeDependencySnooze(
  db: DB,
  loopUid: string,
  dependencyTrigger: string,
  actorUid: string,
  idempotencyKey: string,
): OpenLoopMutationResult {
  const replay = getLoopEventReplay<OpenLoopMutationResult>(db, idempotencyKey, 'snooze_expired', loopUid);
  if (replay) return { ...replay, idempotentReplay: true };
  return db.transaction((tx) => {
    const transactionalDb = tx as DB;
    const loop = requireOpenLoop(transactionalDb, loopUid);
    if (loop.state !== 'snoozed' || loop.dependencyTrigger !== dependencyTrigger) {
      throw new OpenLoopServiceError('INVALID_SNOOZE', 'Dependency trigger does not match an active snooze');
    }
    const resumeState = loop.resumeState || 'open';
    const eventUid = generateLoopEventUid();
    const timestamp = now();
    const update = transactionalDb.update(openLoops).set({
      state: resumeState,
      resumeState: null,
      snoozedUntil: null,
      dependencyTrigger: null,
      version: loop.version + 1,
      updatedAt: timestamp,
    }).where(and(eq(openLoops.loopUid, loop.loopUid), eq(openLoops.version, loop.version))).run();
    if (update.changes !== 1) throw loopVersionConflict(loop, loop.version);
    const updated = requireOpenLoop(transactionalDb, loop.loopUid);
    const result: OpenLoopMutationResult = { loop: updated, eventUid, idempotentReplay: false };
    insertLoopEvent(transactionalDb, {
      eventUid,
      loopUid: loop.loopUid,
      idempotencyKey,
      eventType: 'snooze_expired',
      actorUid,
      actorKind: 'service',
      authorizationPolicyUid: null,
      authorizationPolicyVersion: null,
      previousState: 'snoozed',
      nextState: resumeState,
      payload: { dependencyTrigger },
      evidenceReferences: [],
      result,
      correlationUid: null,
      createdAt: timestamp,
    });
    return result;
  });
}

export function requireOpenLoop(db: DB, loopUid: string): DedicatedOpenLoop {
  const row = db.select().from(openLoops).where(eq(openLoops.loopUid, loopUid)).get();
  if (!row) throw new OpenLoopServiceError('LOOP_NOT_FOUND', `Open loop not found: ${loopUid}`);
  return mapOpenLoopRow(db, row);
}

function mapOpenLoopRow(db: DB, row: typeof openLoops.$inferSelect): DedicatedOpenLoop {
  const project = requireProjectByUid(db, row.projectUid);
  return {
    id: row.id,
    loopUid: row.loopUid,
    projectUid: row.projectUid,
    projectName: project.name,
    title: row.title,
    commitment: row.commitment,
    deferredReason: row.deferredReason,
    ownerKind: row.ownerKind as DedicatedOpenLoop['ownerKind'],
    ownerReference: row.ownerReference,
    immediateNextAction: row.immediateNextAction,
    triggerKind: row.triggerKind as DedicatedOpenLoop['triggerKind'],
    triggerValue: row.triggerValue,
    currentEvidenceSummary: row.currentEvidenceSummary,
    closureCriteria: row.closureCriteria,
    evidence: parseEvidence(row.evidenceJson),
    state: row.state as DedicatedOpenLoop['state'],
    terminalOutcome: row.terminalOutcome as DedicatedOpenLoop['terminalOutcome'],
    priority: row.priority as DedicatedOpenLoop['priority'],
    blockingScope: row.blockingScope as DedicatedOpenLoop['blockingScope'],
    dedupeKey: row.dedupeKey,
    sourceMemoryUid: row.sourceMemoryUid,
    sourceTaskUid: row.sourceTaskUid,
    sourceSessionUid: row.sourceSessionUid,
    sourceHandoffUid: row.sourceHandoffUid,
    externalReference: row.externalReference,
    sourceContext: parseRecord(row.sourceContextJson),
    creatingActorUid: row.creatingActorUid,
    creatingActorKind: row.creatingActorKind as DedicatedOpenLoop['creatingActorKind'],
    resumeState: row.resumeState as DedicatedOpenLoop['resumeState'],
    snoozedUntil: row.snoozedUntil,
    dependencyTrigger: row.dependencyTrigger,
    resolutionNote: row.resolutionNote,
    resolvedAt: row.resolvedAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function requireProjectByUid(db: DB, projectUid: string): NonNullable<ReturnType<typeof getProject>> {
  const row = db.select().from(projects).where(eq(projects.projectUid, projectUid)).get();
  if (!row) throw new OpenLoopServiceError('PROJECT_NOT_FOUND', `Project UID not found: ${projectUid}`);
  return getProject(db, row.name)!;
}

function assertExpectedLoopVersion(loop: DedicatedOpenLoop, expectedVersion: number): void {
  if (loop.version !== expectedVersion) throw loopVersionConflict(loop, expectedVersion);
}

function loopVersionConflict(loop: DedicatedOpenLoop, expectedVersion: number): OpenLoopServiceError {
  return new OpenLoopServiceError(
    'VERSION_CONFLICT',
    `Loop version conflict: expected ${expectedVersion}, found ${loop.version}`,
    { loopUid: loop.loopUid, expectedVersion, actualVersion: loop.version },
  );
}

function assertLegalTransition(previousState: LoopState, nextState: LoopState): void {
  if (previousState === 'resolved' || !LEGAL_TRANSITIONS[previousState].includes(nextState)) {
    throw new OpenLoopServiceError(
      'ILLEGAL_STATE_TRANSITION',
      `Illegal loop transition ${previousState} -> ${nextState}`,
    );
  }
}

function assertResolutionEvidence(
  db: DB,
  loop: DedicatedOpenLoop,
  outcome: ResolveOpenLoopInput['outcome'],
  duplicateOfLoopUid?: string,
): NonNullable<ReturnType<typeof getEvidencePolicy>> {
  const project = requireProjectByUid(db, loop.projectUid);
  if (!project.evidencePolicyId) {
    throw new OpenLoopServiceError('EVIDENCE_POLICY_NOT_FOUND', 'Project has no evidence policy');
  }
  const policy = getEvidencePolicy(db, project.evidencePolicyId);
  if (!policy || !policy.enabled) {
    throw new OpenLoopServiceError('EVIDENCE_POLICY_NOT_FOUND', `Evidence policy ${project.evidencePolicyId} is unavailable`);
  }
  if (loop.evidence.length < policy.requirements.minimumReferences) {
    throw new OpenLoopServiceError('INSUFFICIENT_EVIDENCE', 'Resolution has fewer evidence references than the policy requires');
  }
  if (outcome === 'fixed' && !loop.evidence.some((evidence) => policy.requirements.fixedKinds.includes(evidence.kind))) {
    throw new OpenLoopServiceError('INSUFFICIENT_EVIDENCE', 'Fixed resolution lacks a permitted verification evidence kind');
  }
  if (outcome === 'duplicate') {
    const canonicalLoop = duplicateOfLoopUid
      ? db.select({ loopUid: openLoops.loopUid }).from(openLoops)
          .where(eq(openLoops.loopUid, duplicateOfLoopUid)).get()
      : null;
    if (!duplicateOfLoopUid || duplicateOfLoopUid === loop.loopUid || !canonicalLoop) {
      throw new OpenLoopServiceError('INSUFFICIENT_EVIDENCE', 'Duplicate resolution requires an existing distinct canonical loop');
    }
    const canonicalEvidence = loop.evidence.some((evidence) => (
      policy.requirements.duplicateKinds.includes(evidence.kind)
      && evidence.reference === duplicateOfLoopUid
    ));
    if (!canonicalEvidence) {
      throw new OpenLoopServiceError('INSUFFICIENT_EVIDENCE', 'Duplicate resolution lacks canonical-loop evidence');
    }
  }
  if ((outcome === 'obsolete' || outcome === 'wont_fix')
    && !loop.evidence.some((evidence) => policy.requirements.retirementKinds.includes(evidence.kind))) {
    throw new OpenLoopServiceError('INSUFFICIENT_EVIDENCE', 'Retirement resolution requires a durable decision or approval');
  }
  return policy;
}

function assertEvidenceReferenceSafe(reference: string): void {
  if (/(?:api[_-]?key|password|secret|token)\s*[:=]|bearer\s+[a-z0-9._-]+/i.test(reference)) {
    throw new OpenLoopServiceError(
      'EVIDENCE_REFERENCE_REJECTED',
      'Evidence references must not contain credentials, tokens, or secret values',
    );
  }
}

interface InsertLoopEventInput {
  eventUid: string;
  loopUid: string;
  idempotencyKey: string;
  eventType: typeof loopEvents.$inferInsert.eventType;
  actorUid: string;
  actorKind: string;
  authorizationPolicyUid: string | null;
  authorizationPolicyVersion: number | null;
  previousState: string | null;
  nextState: string | null;
  payload: Record<string, unknown>;
  evidenceReferences: unknown[];
  result: unknown;
  correlationUid: string | null;
  createdAt: string;
}

function insertLoopEvent(db: DB, input: InsertLoopEventInput): void {
  db.insert(loopEvents).values({
    eventUid: input.eventUid,
    loopUid: input.loopUid,
    idempotencyKey: input.idempotencyKey,
    eventType: input.eventType,
    actorUid: input.actorUid,
    actorKind: input.actorKind,
    authorizationPolicyUid: input.authorizationPolicyUid,
    authorizationPolicyVersion: input.authorizationPolicyVersion,
    previousState: input.previousState,
    nextState: input.nextState,
    payloadJson: JSON.stringify(input.payload),
    evidenceReferencesJson: JSON.stringify(input.evidenceReferences),
    resultJson: JSON.stringify(input.result),
    correlationUid: input.correlationUid,
    createdAt: input.createdAt,
  }).run();
}

function getLoopEventReplay<T>(
  db: DB,
  idempotencyKey: string,
  expectedEventType: string,
  expectedLoopUid?: string,
): T | null {
  const row = db.select().from(loopEvents).where(eq(loopEvents.idempotencyKey, idempotencyKey)).get();
  if (!row) return null;
  if (row.eventType !== expectedEventType || (expectedLoopUid && row.loopUid !== expectedLoopUid)) {
    throw new OpenLoopServiceError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was already used for a different loop mutation',
      { idempotencyKey, existingEventType: row.eventType, existingLoopUid: row.loopUid },
    );
  }
  return JSON.parse(row.resultJson) as T;
}

function assertCreateReplayMatches(result: CreateOpenLoopResult, input: ReturnType<typeof CreateOpenLoopInputSchema.parse>): void {
  const loop = result.loop;
  if (loop.projectUid !== input.projectUid || loop.dedupeKey !== input.dedupeKey
    || loop.title !== input.title || loop.commitment !== input.commitment) {
    throw new OpenLoopServiceError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was already used for a different loop admission',
      { loopUid: loop.loopUid, projectUid: loop.projectUid, dedupeKey: loop.dedupeKey },
    );
  }
}

function parseEvidence(value: string): LoopEvidenceReference[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as LoopEvidenceReference[] : [];
  } catch {
    return [];
  }
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
