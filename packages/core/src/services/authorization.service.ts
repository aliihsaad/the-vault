// ============================================================================
// Open-Loops v2 — deterministic authorization policy evaluation
// ============================================================================

import { and, eq } from 'drizzle-orm';
import {
  approvalRecords,
  approvalRequests,
  authorizationPolicies,
} from '../database/schema.js';
import { now } from '../utils/datetime.js';
import { getAuthorizationPolicy } from './open-loop-policy.service.js';
import { OpenLoopServiceError } from './open-loop-errors.js';
import type {
  ActorContext,
  AuthorizationPolicy,
  Project,
} from '../types/index.js';
import type {
  AuthorizationAction,
  AuthorizationPolicyMode,
} from '../rules/controlled-values.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

export interface AuthorizationEvaluation {
  authorized: boolean;
  reasonCode: 'AUTHORIZED' | 'AUTHORIZATION_DENIED' | 'QUORUM_NOT_SATISFIED';
  policy: AuthorizationPolicy;
  approvalsRequired: number;
  approvalsRecorded: number;
}

export interface CreateAuthorizationPolicyInput {
  policyUid: string;
  name: string;
  mode: AuthorizationPolicyMode;
  ownerActorUid?: string;
  allowedRoles?: string[];
  quorum?: number;
  externalProvider?: string;
  actions: AuthorizationAction[];
}

export interface AuthorizationRequestBinding {
  action: AuthorizationAction;
  targetUid: string;
  scope?: Record<string, unknown>;
  requireApprovedRequest?: boolean;
}

export function createAuthorizationPolicy(
  db: DB,
  input: CreateAuthorizationPolicyInput,
): AuthorizationPolicy {
  const timestamp = now();
  const roles = [...new Set((input.allowedRoles || []).map((role) => role.trim()).filter(Boolean))];
  const quorum = input.quorum ?? 1;
  validatePolicyConfiguration(input.mode, input.ownerActorUid, roles, quorum, input.externalProvider);

  db.insert(authorizationPolicies).values({
    policyUid: input.policyUid.trim(),
    name: input.name.trim(),
    mode: input.mode,
    ownerActorUid: input.ownerActorUid?.trim() || null,
    allowedRolesJson: JSON.stringify(roles),
    quorum,
    externalProvider: input.externalProvider?.trim() || null,
    actionsJson: JSON.stringify([...new Set(input.actions)]),
    version: 1,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();

  return getAuthorizationPolicy(db, input.policyUid)!;
}

export interface RecordExternalApprovalDecisionInput {
  approvalUid: string;
  requestUid: string;
  action: AuthorizationAction;
  targetUid: string;
  policyUid: string;
  externalProvider: string;
  externalDecisionId: string;
  scope?: Record<string, unknown>;
  reason: string;
  idempotencyKey: string;
}

/**
 * Trusted-only ingestion of an external authorization decision.
 *
 * This MUST be called from a trusted internal/broker route, never from an
 * ordinary public MCP tool: ordinary callers cannot select provider authority.
 * It asserts the decision's provider matches the policy's configured
 * externalProvider, verifies the decision is bound to an existing pending or
 * approved, unexpired request for the same action/target/policy/version/scope,
 * and persists the provider identity so the evaluator can re-verify the
 * binding. Caller booleans such as `externalApproved` are never trusted — only
 * this stored record counts.
 */
export function recordExternalApprovalDecision(
  db: DB,
  input: RecordExternalApprovalDecisionInput,
): void {
  const approvalUid = input.approvalUid.trim();
  const requestUid = input.requestUid.trim();
  const provider = input.externalProvider.trim();
  const decisionId = input.externalDecisionId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  const reason = input.reason.trim();
  if (!approvalUid || !requestUid || !provider || !decisionId || !idempotencyKey || !reason) {
    throw new OpenLoopServiceError(
      'AUTHORIZATION_DENIED',
      'External decisions require non-empty approval, request, provider, decision, reason, and idempotency identifiers',
    );
  }

  db.transaction((tx) => {
    const transactionalDb = tx as DB;
    const policy = getAuthorizationPolicy(transactionalDb, input.policyUid);
    if (!policy || !policy.enabled) {
      throw new OpenLoopServiceError(
        'AUTHORIZATION_POLICY_NOT_FOUND',
        `Authorization policy ${input.policyUid} was not found or is disabled`,
      );
    }
    if (policy.mode !== 'external') {
      throw new OpenLoopServiceError(
        'AUTHORIZATION_ACTION_NOT_ALLOWED',
        `Policy ${policy.policyUid} is not an external authorization policy`,
      );
    }
    if (!policy.actions.includes(input.action)) {
      throw new OpenLoopServiceError(
        'AUTHORIZATION_ACTION_NOT_ALLOWED',
        `Policy ${policy.policyUid} does not allow ${input.action}`,
      );
    }
    if (!policy.externalProvider || provider !== policy.externalProvider) {
      throw new OpenLoopServiceError(
        'AUTHORIZATION_DENIED',
        'External decision provider does not match the configured policy provider',
      );
    }

    const request = transactionalDb.select()
      .from(approvalRequests)
      .where(eq(approvalRequests.requestUid, requestUid))
      .get();
    if (!request
      || request.action !== input.action
      || request.targetUid !== input.targetUid
      || request.policyUid !== policy.policyUid
      || request.policyVersion !== policy.version
      || !['pending', 'approved'].includes(request.status)
      || isExpiredApprovalRequest(request.expiresAt)) {
      throw new OpenLoopServiceError(
        'AUTHORIZATION_DENIED',
        'External decision does not match a pending or approved authorization request',
      );
    }

    const requestScope = parseObject(request.scopeJson);
    const decisionScope = input.scope ?? requestScope;
    if (canonicalJson(decisionScope) !== canonicalJson(requestScope)) {
      throw new OpenLoopServiceError(
        'AUTHORIZATION_DENIED',
        'External decision scope does not match the authorization request',
      );
    }

    const actorUid = `external:${provider}`;
    const matchesDecision = (row: typeof approvalRecords.$inferSelect): boolean => (
      row.approvalUid === approvalUid
      && row.requestUid === requestUid
      && row.action === input.action
      && row.targetUid === input.targetUid
      && row.policyUid === policy.policyUid
      && row.policyVersion === policy.version
      && row.actorUid === actorUid
      && row.actorKind === 'external'
      && row.decision === 'approved'
      && row.externalDecisionId === decisionId
      && row.externalProvider === provider
      && canonicalJson(parseObject(row.scopeJson)) === canonicalJson(requestScope)
    );
    const approveRequest = (): void => {
      transactionalDb.update(approvalRequests).set({
        status: 'approved',
        decidedAt: now(),
      }).where(eq(approvalRequests.requestUid, requestUid)).run();
    };

    const existingIdempotency = transactionalDb.select().from(approvalRecords)
      .where(eq(approvalRecords.idempotencyKey, idempotencyKey)).get();
    if (existingIdempotency) {
      if (!matchesDecision(existingIdempotency)) {
        throw new OpenLoopServiceError(
          'IDEMPOTENCY_CONFLICT',
          'External approval idempotency key was already used for another decision',
        );
      }
      approveRequest();
      return;
    }

    const existingProviderDecision = transactionalDb.select().from(approvalRecords)
      .where(and(
        eq(approvalRecords.requestUid, requestUid),
        eq(approvalRecords.actorUid, actorUid),
      )).get();
    if (existingProviderDecision) {
      if (!matchesDecision(existingProviderDecision)) {
        throw new OpenLoopServiceError(
          'APPROVAL_ALREADY_RECORDED',
          'The external provider already recorded a different decision for this request',
        );
      }
      approveRequest();
      return;
    }

    const timestamp = now();
    transactionalDb.insert(approvalRecords).values({
      approvalUid,
      requestUid,
      action: input.action,
      targetUid: input.targetUid,
      policyUid: policy.policyUid,
      policyVersion: policy.version,
      actorUid,
      actorKind: 'external',
      actorRolesJson: '[]',
      decision: 'approved',
      scopeJson: canonicalJson(requestScope),
      reason,
      externalDecisionId: decisionId,
      externalProvider: provider,
      idempotencyKey,
      createdAt: timestamp,
    }).run();
    transactionalDb.update(approvalRequests).set({
      status: 'approved',
      decidedAt: timestamp,
    }).where(eq(approvalRequests.requestUid, requestUid)).run();
  });
}
export function authorizeProjectAction(
  db: DB,
  project: Project,
  action: AuthorizationAction,
  actor: ActorContext,
  approvalRequestUid?: string,
  binding?: Omit<AuthorizationRequestBinding, 'action'>,
): AuthorizationEvaluation {
  const policyUid = project.authorizationPolicyId;
  if (!policyUid) {
    throw new OpenLoopServiceError(
      'AUTHORIZATION_POLICY_NOT_FOUND',
      `Project ${project.name} has no authorization policy`,
    );
  }
  const policy = getAuthorizationPolicy(db, policyUid);
  if (!policy || !policy.enabled) {
    throw new OpenLoopServiceError(
      'AUTHORIZATION_POLICY_NOT_FOUND',
      `Authorization policy ${policyUid} was not found or is disabled`,
    );
  }
  if (!policy.actions.includes(action)) {
    throw new OpenLoopServiceError(
      'AUTHORIZATION_ACTION_NOT_ALLOWED',
      `Policy ${policy.policyUid} does not allow ${action}`,
    );
  }

  return evaluateAuthorizationPolicy(
    db,
    policy,
    actor,
    project.ownerActorUid,
    approvalRequestUid,
    {
      action,
      targetUid: binding?.targetUid || project.projectUid!,
      scope: binding?.scope,
      requireApprovedRequest: binding?.requireApprovedRequest,
    },
  );
}

export function evaluateAuthorizationPolicy(
  db: DB,
  policy: AuthorizationPolicy,
  actor: ActorContext,
  projectOwnerActorUid?: string | null,
  approvalRequestUid?: string,
  binding?: AuthorizationRequestBinding,
): AuthorizationEvaluation {
  if (policy.mode === 'quorum' || policy.mode === 'external') {
    const approvalsRecorded = approvalRequestUid && binding
      ? countEligibleApprovals(db, policy, approvalRequestUid, binding)
      : 0;
    const approvalsRequired = policy.mode === 'quorum' ? policy.quorum : 1;
    const authorized = approvalsRecorded >= approvalsRequired;
    return {
      authorized,
      reasonCode: authorized ? 'AUTHORIZED' : 'QUORUM_NOT_SATISFIED',
      policy,
      approvalsRequired,
      approvalsRecorded,
    };
  }

  const authorized = isActorEligible(policy, actor, projectOwnerActorUid);
  return {
    authorized,
    reasonCode: authorized ? 'AUTHORIZED' : 'AUTHORIZATION_DENIED',
    policy,
    approvalsRequired: 1,
    approvalsRecorded: authorized ? 1 : 0,
  };
}

export function assertAuthorized(evaluation: AuthorizationEvaluation): AuthorizationEvaluation {
  if (!evaluation.authorized) {
    throw new OpenLoopServiceError(
      evaluation.reasonCode === 'QUORUM_NOT_SATISFIED'
        ? 'QUORUM_NOT_SATISFIED'
        : 'AUTHORIZATION_DENIED',
      evaluation.reasonCode === 'QUORUM_NOT_SATISFIED'
        ? `Authorization quorum not satisfied (${evaluation.approvalsRecorded}/${evaluation.approvalsRequired})`
        : 'Actor is not authorized by the resolved policy',
      {
        policyUid: evaluation.policy.policyUid,
        approvalsRecorded: evaluation.approvalsRecorded,
        approvalsRequired: evaluation.approvalsRequired,
      },
    );
  }
  return evaluation;
}

export function isActorEligible(
  policy: AuthorizationPolicy,
  actor: ActorContext,
  projectOwnerActorUid?: string | null,
): boolean {
  if (policy.mode === 'owner') {
    const ownerActorUid = projectOwnerActorUid || policy.ownerActorUid;
    return Boolean(ownerActorUid && actor.actorUid === ownerActorUid);
  }
  if (policy.mode === 'role' || policy.mode === 'quorum') {
    return actor.roles.some((role) => policy.allowedRoles.includes(role));
  }
  // External authority is accepted only through a persisted, bound approval request.
  return false;
}

function countEligibleApprovals(
  db: DB,
  policy: AuthorizationPolicy,
  requestUid: string,
  binding: AuthorizationRequestBinding,
): number {
  const request = db.select()
    .from(approvalRequests)
    .where(eq(approvalRequests.requestUid, requestUid))
    .get();
  const allowedStatuses = binding.requireApprovedRequest === false
    ? new Set(['pending', 'approved'])
    : new Set(['approved']);
  if (!request
    || request.action !== binding.action
    || request.targetUid !== binding.targetUid
    || request.policyUid !== policy.policyUid
    || request.policyVersion !== policy.version
    || !allowedStatuses.has(request.status)
    || isExpiredApprovalRequest(request.expiresAt)
    || (binding.scope !== undefined
      && canonicalJson(parseObject(request.scopeJson)) !== canonicalJson(binding.scope))) {
    return 0;
  }

  const rows = db.select()
    .from(approvalRecords)
    .where(and(
      eq(approvalRecords.requestUid, requestUid),
      eq(approvalRecords.policyUid, policy.policyUid),
      eq(approvalRecords.policyVersion, policy.version),
      eq(approvalRecords.decision, 'approved'),
    ))
    .all();
  const actors = new Set<string>();
  for (const row of rows) {
    if (row.action !== request.action
      || row.targetUid !== request.targetUid
      || canonicalJson(parseObject(row.scopeJson)) !== canonicalJson(parseObject(request.scopeJson))) {
      continue;
    }
    if (policy.mode === 'external') {
      // A persisted external decision authorizes only when it carries a decision
      // id AND its provider matches the policy's configured externalProvider.
      // Caller-supplied booleans are never trusted; only the stored binding is.
      if (row.actorKind === 'external'
        && Boolean(row.externalDecisionId)
        && Boolean(row.externalProvider)
        && row.externalProvider === policy.externalProvider) {
        actors.add(row.actorUid);
      }
      continue;
    }
    const roles = parseStringArray(row.actorRolesJson);
    if (roles.some((role) => policy.allowedRoles.includes(role))) {
      actors.add(row.actorUid);
    }
  }
  return actors.size;
}

function validatePolicyConfiguration(
  mode: AuthorizationPolicyMode,
  ownerActorUid: string | undefined,
  roles: string[],
  quorum: number,
  externalProvider: string | undefined,
): void {
  if (!Number.isInteger(quorum) || quorum < 1) {
    throw new Error('Authorization policy quorum must be a positive integer');
  }
  if (mode === 'owner' && !ownerActorUid?.trim()) {
    throw new Error('Owner authorization policies require an owner actor UID');
  }
  if ((mode === 'role' || mode === 'quorum') && roles.length === 0) {
    throw new Error(`${mode} authorization policies require at least one allowed role`);
  }
  if (mode === 'external' && !externalProvider?.trim()) {
    throw new Error('External authorization policies require a provider identifier');
  }
}

function isExpiredApprovalRequest(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}
function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForCanonicalJson(value)) ?? 'null';
}

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => entry === undefined ? null : sortForCanonicalJson(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortForCanonicalJson(entry)]),
    );
  }
  return value;
}
