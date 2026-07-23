// ============================================================================
// Open-Loops v2 — deterministic authorization policy evaluation
// ============================================================================

import { and, eq } from 'drizzle-orm';
import {
  approvalRecords,
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

export function authorizeProjectAction(
  db: DB,
  project: Project,
  action: AuthorizationAction,
  actor: ActorContext,
  approvalRequestUid?: string,
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
  );
}

export function evaluateAuthorizationPolicy(
  db: DB,
  policy: AuthorizationPolicy,
  actor: ActorContext,
  projectOwnerActorUid?: string | null,
  approvalRequestUid?: string,
): AuthorizationEvaluation {
  if (policy.mode === 'quorum') {
    const approvalsRecorded = approvalRequestUid
      ? countEligibleApprovals(db, policy, approvalRequestUid)
      : 0;
    const authorized = approvalsRecorded >= policy.quorum;
    return {
      authorized,
      reasonCode: authorized ? 'AUTHORIZED' : 'QUORUM_NOT_SATISFIED',
      policy,
      approvalsRequired: policy.quorum,
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
  return actor.actorKind === 'external'
    && Boolean(policy.externalProvider)
    && actor.externalProvider === policy.externalProvider
    && actor.externalApproved === true
    && Boolean(actor.externalDecisionId);
}

function countEligibleApprovals(
  db: DB,
  policy: AuthorizationPolicy,
  requestUid: string,
): number {
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

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
}
