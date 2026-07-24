// ============================================================================
// Open-Loops v2 — immutable approval request and decision records
// ============================================================================

import { eq } from 'drizzle-orm';
import { approvalRecords, approvalRequests } from '../database/schema.js';
import { now } from '../utils/datetime.js';
import { generateApprovalRequestUid, generateApprovalUid } from '../utils/uid.js';
import type {
  ActorContext,
  ApprovalRecord,
  ApprovalRequest,
  AuthorizationPolicy,
} from '../types/index.js';
import type { AuthorizationAction } from '../rules/controlled-values.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

export interface InlineAuthorizationGrantInput {
  action: AuthorizationAction;
  targetUid: string;
  policy: AuthorizationPolicy;
  actor: ActorContext;
  reason: string;
  idempotencyKey: string;
  eventUid?: string;
  scope?: Record<string, unknown>;
}

export function recordInlineAuthorizationGrant(
  db: DB,
  input: InlineAuthorizationGrantInput,
): { request: ApprovalRequest; approval: ApprovalRecord } {
  const requestUid = generateApprovalRequestUid();
  const approvalUid = generateApprovalUid();
  const timestamp = now();
  const scope = input.scope || {};
  db.insert(approvalRequests).values({
    requestUid,
    action: input.action,
    targetUid: input.targetUid,
    policyUid: input.policy.policyUid,
    policyVersion: input.policy.version,
    requesterActorUid: input.actor.actorUid,
    requesterActorKind: input.actor.actorKind,
    scopeJson: JSON.stringify(scope),
    reason: input.reason,
    status: 'approved',
    expiresAt: null,
    triggerJson: null,
    idempotencyKey: `${input.idempotencyKey}:authorization-request`,
    createdAt: timestamp,
    decidedAt: timestamp,
  }).run();
  db.insert(approvalRecords).values({
    approvalUid,
    requestUid,
    action: input.action,
    targetUid: input.targetUid,
    policyUid: input.policy.policyUid,
    policyVersion: input.policy.version,
    actorUid: input.actor.actorUid,
    actorKind: input.actor.actorKind,
    actorRolesJson: JSON.stringify(input.actor.roles),
    decision: 'approved',
    scopeJson: JSON.stringify(scope),
    reason: input.reason,
    externalDecisionId: input.actor.externalDecisionId || null,
    externalProvider: input.actor.actorKind === 'external'
      ? input.actor.externalProvider || null
      : null,
    eventUid: input.eventUid || null,
    idempotencyKey: `${input.idempotencyKey}:authorization-record`,
    createdAt: timestamp,
  }).run();
  return {
    request: getApprovalRequest(db, requestUid)!,
    approval: getApprovalRecord(db, approvalUid)!,
  };
}

export function getApprovalRequest(db: DB, requestUid: string): ApprovalRequest | null {
  const row = db.select().from(approvalRequests)
    .where(eq(approvalRequests.requestUid, requestUid)).get();
  if (!row) return null;
  return {
    requestUid: row.requestUid,
    action: row.action as ApprovalRequest['action'],
    targetUid: row.targetUid,
    policyUid: row.policyUid,
    policyVersion: row.policyVersion,
    requesterActorUid: row.requesterActorUid,
    requesterActorKind: row.requesterActorKind as ApprovalRequest['requesterActorKind'],
    scope: parseRecord(row.scopeJson),
    reason: row.reason,
    status: row.status as ApprovalRequest['status'],
    expiresAt: row.expiresAt,
    trigger: row.triggerJson ? parseRecord(row.triggerJson) : null,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

export function getApprovalRecord(db: DB, approvalUid: string): ApprovalRecord | null {
  const row = db.select().from(approvalRecords)
    .where(eq(approvalRecords.approvalUid, approvalUid)).get();
  if (!row) return null;
  return mapApprovalRecord(row);
}

export function listApprovalRecords(db: DB, requestUid: string): ApprovalRecord[] {
  return db.select().from(approvalRecords)
    .where(eq(approvalRecords.requestUid, requestUid)).all()
    .map(mapApprovalRecord);
}

function mapApprovalRecord(row: typeof approvalRecords.$inferSelect): ApprovalRecord {
  return {
    approvalUid: row.approvalUid,
    requestUid: row.requestUid,
    action: row.action as ApprovalRecord['action'],
    targetUid: row.targetUid,
    policyUid: row.policyUid,
    policyVersion: row.policyVersion,
    actorUid: row.actorUid,
    actorKind: row.actorKind as ApprovalRecord['actorKind'],
    actorRoles: parseStringArray(row.actorRolesJson),
    decision: row.decision as ApprovalRecord['decision'],
    scope: parseRecord(row.scopeJson),
    reason: row.reason,
    externalDecisionId: row.externalDecisionId,
    externalProvider: row.externalProvider,
    eventUid: row.eventUid,
    createdAt: row.createdAt,
  };
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
}
