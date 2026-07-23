// ============================================================================
// Open-Loops v2 — authorized snooze request and decision lifecycle
// ============================================================================

import { and, eq } from 'drizzle-orm';
import {
  approvalRecords,
  approvalRequests,
  loopEvents,
  openLoops,
  projects,
} from '../database/schema.js';
import {
  DecideLoopSnoozeInputSchema,
  RequestLoopSnoozeInputSchema,
} from '../rules/validation.js';
import {
  generateApprovalRequestUid,
  generateApprovalUid,
  generateLoopEventUid,
} from '../utils/uid.js';
import { now } from '../utils/datetime.js';
import { getProject } from './project.service.js';
import { getAuthorizationPolicy } from './open-loop-policy.service.js';
import {
  authorizeProjectAction,
  isActorEligible,
} from './authorization.service.js';
import {
  getApprovalRecord,
  getApprovalRequest,
} from './approval.service.js';
import { OpenLoopServiceError } from './open-loop-errors.js';
import { requireOpenLoop } from './open-loop.service.js';
import type {
  ApprovalRequest,
  DecideLoopSnoozeInput,
  DedicatedOpenLoop,
  RequestLoopSnoozeInput,
  RequestLoopSnoozeResult,
  SnoozeDecisionResult,
} from '../types/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

export function requestLoopSnooze(
  db: DB,
  input: RequestLoopSnoozeInput,
): RequestLoopSnoozeResult {
  const validated = RequestLoopSnoozeInputSchema.parse(input);
  const replay = getLoopEventReplay<RequestLoopSnoozeResult>(db, validated.idempotencyKey, 'snooze_requested', validated.loopUid);
  if (replay) return { ...replay, idempotentReplay: true };
  if (validated.snoozedUntil && validated.snoozedUntil <= now()) {
    throw new OpenLoopServiceError('INVALID_SNOOZE', 'Snooze expiry must be in the future');
  }
  return db.transaction((tx) => {
    const transactionalDb = tx as DB;
    const transactionReplay = getLoopEventReplay<RequestLoopSnoozeResult>(transactionalDb, validated.idempotencyKey, 'snooze_requested', validated.loopUid);
    if (transactionReplay) return { ...transactionReplay, idempotentReplay: true };
    const loop = requireOpenLoop(transactionalDb, validated.loopUid);
    assertLoopVersion(loop, validated.expectedVersion);
    if (loop.state === 'resolved') {
      throw new OpenLoopServiceError('LOOP_ALREADY_RESOLVED', 'Resolved loops cannot be snoozed');
    }
    const project = requireProject(transactionalDb, loop.projectUid);
    if (!project.authorizationPolicyId) {
      throw new OpenLoopServiceError('AUTHORIZATION_POLICY_NOT_FOUND', 'Project has no authorization policy');
    }
    const policy = getAuthorizationPolicy(transactionalDb, project.authorizationPolicyId);
    if (!policy || !policy.enabled || !policy.actions.includes('decide_loop_snooze')) {
      throw new OpenLoopServiceError('AUTHORIZATION_ACTION_NOT_ALLOWED', 'Project policy does not permit loop snoozes');
    }
    const resumeState = loop.state === 'snoozed' ? loop.resumeState || 'open' : loop.state;
    const requestUid = generateApprovalRequestUid();
    const eventUid = generateLoopEventUid();
    const timestamp = now();
    const scope = {
      loopUid: loop.loopUid,
      resumeState,
      snoozedUntil: validated.snoozedUntil || null,
      dependencyTrigger: validated.dependencyTrigger || null,
    };
    transactionalDb.insert(approvalRequests).values({
      requestUid,
      action: 'decide_loop_snooze',
      targetUid: loop.loopUid,
      policyUid: policy.policyUid,
      policyVersion: policy.version,
      requesterActorUid: validated.requester.actorUid,
      requesterActorKind: validated.requester.actorKind,
      scopeJson: JSON.stringify(scope),
      reason: validated.reason,
      status: 'pending',
      expiresAt: validated.snoozedUntil || null,
      triggerJson: validated.dependencyTrigger
        ? JSON.stringify({ dependencyTrigger: validated.dependencyTrigger })
        : null,
      idempotencyKey: validated.idempotencyKey,
      createdAt: timestamp,
      decidedAt: null,
    }).run();
    const update = transactionalDb.update(openLoops).set({
      version: loop.version + 1,
      updatedAt: timestamp,
    }).where(and(eq(openLoops.loopUid, loop.loopUid), eq(openLoops.version, loop.version))).run();
    if (update.changes !== 1) throw loopVersionConflict(loop, validated.expectedVersion);
    const updated = requireOpenLoop(transactionalDb, loop.loopUid);
    const request = getApprovalRequest(transactionalDb, requestUid)!;
    const result: RequestLoopSnoozeResult = {
      request,
      loop: updated,
      eventUid,
      idempotentReplay: false,
    };
    transactionalDb.insert(loopEvents).values({
      eventUid,
      loopUid: loop.loopUid,
      idempotencyKey: validated.idempotencyKey,
      eventType: 'snooze_requested',
      actorUid: validated.requester.actorUid,
      actorKind: validated.requester.actorKind,
      authorizationPolicyUid: policy.policyUid,
      authorizationPolicyVersion: policy.version,
      previousState: loop.state,
      nextState: loop.state,
      payloadJson: JSON.stringify({ requestUid, reason: validated.reason, ...scope }),
      evidenceReferencesJson: '[]',
      resultJson: JSON.stringify(result),
      correlationUid: requestUid,
      createdAt: timestamp,
    }).run();
    return result;
  });
}

export function decideLoopSnooze(
  db: DB,
  input: DecideLoopSnoozeInput,
): SnoozeDecisionResult {
  const validated = DecideLoopSnoozeInputSchema.parse(input);
  const replay = getLoopEventReplay<SnoozeDecisionResult>(db, validated.idempotencyKey, 'snooze_decided', validated.loopUid, validated.requestUid);
  if (replay) return { ...replay, idempotentReplay: true };
  return db.transaction((tx) => {
    const transactionalDb = tx as DB;
    const transactionReplay = getLoopEventReplay<SnoozeDecisionResult>(transactionalDb, validated.idempotencyKey, 'snooze_decided', validated.loopUid, validated.requestUid);
    if (transactionReplay) return { ...transactionReplay, idempotentReplay: true };
    const request = requireSnoozeRequest(transactionalDb, validated.requestUid, validated.loopUid);
    if (request.status !== 'pending') {
      throw new OpenLoopServiceError('APPROVAL_REQUEST_MISMATCH', `Snooze request is already ${request.status}`);
    }
    if (request.expiresAt && request.expiresAt <= now()) {
      throw new OpenLoopServiceError('APPROVAL_REQUEST_EXPIRED', 'The requested snooze expiry has already passed');
    }
    const loop = requireOpenLoop(transactionalDb, validated.loopUid);
    assertLoopVersion(loop, validated.expectedVersion);
    const project = requireProject(transactionalDb, loop.projectUid);
    const policy = getAuthorizationPolicy(transactionalDb, request.policyUid);
    if (!policy || !policy.enabled || policy.version !== request.policyVersion) {
      throw new OpenLoopServiceError('AUTHORIZATION_POLICY_NOT_FOUND', 'The request policy version is unavailable');
    }
    if (!isActorEligible(policy, validated.approver, project.ownerActorUid)) {
      throw new OpenLoopServiceError('AUTHORIZATION_DENIED', 'Approver is not eligible under the request policy');
    }
    const existingActorDecision = transactionalDb.select().from(approvalRecords).where(and(
      eq(approvalRecords.requestUid, request.requestUid),
      eq(approvalRecords.actorUid, validated.approver.actorUid),
    )).get();
    if (existingActorDecision) {
      throw new OpenLoopServiceError('APPROVAL_ALREADY_RECORDED', 'This actor already decided the snooze request');
    }

    const eventUid = generateLoopEventUid();
    const approvalUid = generateApprovalUid();
    const timestamp = now();
    transactionalDb.insert(approvalRecords).values({
      approvalUid,
      requestUid: request.requestUid,
      action: 'decide_loop_snooze',
      targetUid: loop.loopUid,
      policyUid: policy.policyUid,
      policyVersion: policy.version,
      actorUid: validated.approver.actorUid,
      actorKind: validated.approver.actorKind,
      actorRolesJson: JSON.stringify(validated.approver.roles),
      decision: validated.decision,
      scopeJson: JSON.stringify(request.scope),
      reason: validated.reason,
      externalDecisionId: validated.approver.externalDecisionId || null,
      eventUid,
      idempotencyKey: validated.idempotencyKey,
      createdAt: timestamp,
    }).run();

    let policySatisfied = false;
    let requestStatus: ApprovalRequest['status'] = 'pending';
    if (validated.decision === 'denied') {
      requestStatus = 'denied';
    } else {
      policySatisfied = authorizeProjectAction(
        transactionalDb,
        project,
        'decide_loop_snooze',
        validated.approver,
        request.requestUid,
      ).authorized;
      if (policySatisfied) requestStatus = 'approved';
    }

    const nextValues: Partial<typeof openLoops.$inferInsert> = {
      version: loop.version + 1,
      updatedAt: timestamp,
    };
    if (requestStatus === 'approved') {
      const resumeState = readResumeState(request);
      nextValues.state = 'snoozed';
      nextValues.resumeState = resumeState;
      nextValues.snoozedUntil = readScopeString(request.scope, 'snoozedUntil');
      nextValues.dependencyTrigger = readScopeString(request.scope, 'dependencyTrigger');
    }
    const update = transactionalDb.update(openLoops).set(nextValues)
      .where(and(eq(openLoops.loopUid, loop.loopUid), eq(openLoops.version, loop.version))).run();
    if (update.changes !== 1) throw loopVersionConflict(loop, validated.expectedVersion);
    transactionalDb.update(approvalRequests).set({
      status: requestStatus,
      decidedAt: requestStatus === 'pending' ? null : timestamp,
    }).where(eq(approvalRequests.requestUid, request.requestUid)).run();

    const updatedLoop = requireOpenLoop(transactionalDb, loop.loopUid);
    const updatedRequest = getApprovalRequest(transactionalDb, request.requestUid)!;
    const approval = getApprovalRecord(transactionalDb, approvalUid)!;
    const result: SnoozeDecisionResult = {
      request: updatedRequest,
      approval,
      loop: updatedLoop,
      policySatisfied,
      idempotentReplay: false,
    };
    transactionalDb.insert(loopEvents).values({
      eventUid,
      loopUid: loop.loopUid,
      idempotencyKey: validated.idempotencyKey,
      eventType: 'snooze_decided',
      actorUid: validated.approver.actorUid,
      actorKind: validated.approver.actorKind,
      authorizationPolicyUid: policy.policyUid,
      authorizationPolicyVersion: policy.version,
      previousState: loop.state,
      nextState: updatedLoop.state,
      payloadJson: JSON.stringify({
        requestUid: request.requestUid,
        approvalUid,
        decision: validated.decision,
        policySatisfied,
        reason: validated.reason,
      }),
      evidenceReferencesJson: '[]',
      resultJson: JSON.stringify(result),
      correlationUid: request.requestUid,
      createdAt: timestamp,
    }).run();
    return result;
  });
}

function requireSnoozeRequest(db: DB, requestUid: string, loopUid: string): ApprovalRequest {
  const request = getApprovalRequest(db, requestUid);
  if (!request) throw new OpenLoopServiceError('APPROVAL_REQUEST_NOT_FOUND', `Approval request not found: ${requestUid}`);
  if (request.action !== 'decide_loop_snooze' || request.targetUid !== loopUid) {
    throw new OpenLoopServiceError('APPROVAL_REQUEST_MISMATCH', 'Approval request does not target this loop snooze');
  }
  return request;
}

function requireProject(db: DB, projectUid: string): NonNullable<ReturnType<typeof getProject>> {
  const row = db.select().from(projects).where(eq(projects.projectUid, projectUid)).get();
  if (!row) throw new OpenLoopServiceError('PROJECT_NOT_FOUND', `Project UID not found: ${projectUid}`);
  return getProject(db, row.name)!;
}

function readResumeState(request: ApprovalRequest): DedicatedOpenLoop['resumeState'] {
  const value = request.scope.resumeState;
  if (value === 'open' || value === 'verification_needed' || value === 'awaiting_approval'
    || value === 'awaiting_user' || value === 'externally_blocked') return value;
  return 'open';
}

function readScopeString(scope: Record<string, unknown>, key: string): string | null {
  const value = scope[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function assertLoopVersion(loop: DedicatedOpenLoop, expectedVersion: number): void {
  if (loop.version !== expectedVersion) throw loopVersionConflict(loop, expectedVersion);
}

function loopVersionConflict(loop: DedicatedOpenLoop, expectedVersion: number): OpenLoopServiceError {
  return new OpenLoopServiceError(
    'VERSION_CONFLICT',
    `Loop version conflict: expected ${expectedVersion}, found ${loop.version}`,
    { loopUid: loop.loopUid, expectedVersion, actualVersion: loop.version },
  );
}

function getLoopEventReplay<T>(
  db: DB,
  idempotencyKey: string,
  expectedEventType: string,
  expectedLoopUid: string,
  expectedCorrelationUid?: string,
): T | null {
  const row = db.select().from(loopEvents).where(eq(loopEvents.idempotencyKey, idempotencyKey)).get();
  if (!row) return null;
  if (row.eventType !== expectedEventType || row.loopUid !== expectedLoopUid
    || (expectedCorrelationUid && row.correlationUid !== expectedCorrelationUid)) {
    throw new OpenLoopServiceError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was already used for a different snooze mutation',
      { idempotencyKey, existingEventType: row.eventType, existingLoopUid: row.loopUid },
    );
  }
  return JSON.parse(row.resultJson) as T;
}
