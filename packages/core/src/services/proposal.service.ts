// ============================================================================
// Vault — Project Proposal Service
// CRUD + decision routing for the project_review duty's review surface.
// See artifact vm_9KF5xz-QhjzMO5um for the design.
// ============================================================================

import { and, desc, eq, inArray } from 'drizzle-orm';
import { projectProposals, projectRelationships } from '../database/schema.js';
import { now } from '../utils/datetime.js';
import { generateProposalUid } from '../utils/uid.js';
import {
  PROPOSAL_TYPES,
  PROPOSAL_STATUSES,
  type ProposalStatus,
  type ProposalType,
} from '../rules/controlled-values.js';
import { logActivity } from './log.service.js';
import {
  addProjectRelationship,
  mergeProject,
  updateProjectDescription,
} from './project.service.js';
import type {
  CreateProjectProposalInput,
  DecideProjectProposalInput,
  DecideProjectProposalResult,
  FindProjectProposalsQuery,
  ProjectProposal,
  ProjectProposalPayload,
} from '../types/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

const ACTIVE_STATUSES: ProposalStatus[] = ['pending', 'accepted'];

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create a project proposal. Idempotent per the design's dedupe rules:
 *  - description: any existing pending description proposal for the project is
 *    marked superseded; the new one becomes pending.
 *  - relationship: if a pending|accepted proposal with the same triple exists,
 *    or if the relationship already exists in project_relationships, return
 *    the existing/equivalent row instead of inserting a duplicate.
 *  - merge: if a pending|accepted merge with the same (source, target) exists,
 *    return that row instead of inserting.
 */
export function createProjectProposal(
  db: DB,
  logsPath: string,
  input: CreateProjectProposalInput,
): ProjectProposal {
  const payload = input.payload;
  const timestamp = now();

  if (payload.type === 'description') {
    supersedePendingDescriptions(db, input.project);
  } else if (payload.type === 'relationship') {
    const dup = findEquivalentRelationshipProposal(
      db,
      payload.sourceProject,
      payload.targetProject,
      payload.linkType,
    );
    if (dup) return dup;
    if (relationshipAlreadyApplied(db, payload.sourceProject, payload.targetProject, payload.linkType)) {
      // Already applied — record as accepted so the audit trail reflects reality
      return insertProposal(db, logsPath, input, payload, 'accepted', timestamp);
    }
  } else if (payload.type === 'merge') {
    const dup = findEquivalentMergeProposal(db, payload.sourceProject, payload.targetProject);
    if (dup) return dup;
  }

  return insertProposal(db, logsPath, input, payload, 'pending', timestamp);
}

function insertProposal(
  db: DB,
  logsPath: string,
  input: CreateProjectProposalInput,
  payload: ProjectProposalPayload,
  status: ProposalStatus,
  timestamp: string,
): ProjectProposal {
  const proposalUid = generateProposalUid();
  db.insert(projectProposals)
    .values({
      proposalUid,
      project: input.project,
      proposalType: payload.type,
      payloadJson: JSON.stringify(payload),
      rationale: input.rationale ?? null,
      confidence: input.confidence ?? null,
      status,
      sourceTaskUid: input.sourceTaskUid ?? null,
      evidenceItemUidsJson: JSON.stringify(input.evidenceItemUids ?? []),
      createdBy: input.createdBy ?? 'agent',
      decidedBy: status === 'pending' ? null : (input.createdBy ?? 'agent'),
      decidedAt: status === 'pending' ? null : timestamp,
      decisionNote: status === 'pending'
        ? null
        : 'Auto-recorded as accepted (relationship already existed)',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const row = db
    .select()
    .from(projectProposals)
    .where(eq(projectProposals.proposalUid, proposalUid))
    .get();
  const proposal = mapRow(row!);

  logActivity(db, logsPath, {
    timestamp,
    sourceClient: input.createdBy ?? 'agent',
    project: input.project,
    actionType: 'proposal_create',
    targetItemId: proposalUid,
    status: 'success',
    aiUsed: false,
    message: `Created ${payload.type} proposal for ${input.project}`,
    metadata: { proposalType: payload.type, status },
  });

  return proposal;
}

function supersedePendingDescriptions(db: DB, project: string): void {
  const pending = db
    .select()
    .from(projectProposals)
    .where(
      and(
        eq(projectProposals.project, project),
        eq(projectProposals.proposalType, 'description'),
        eq(projectProposals.status, 'pending'),
      ),
    )
    .all();
  if (pending.length === 0) return;

  const timestamp = now();
  db.update(projectProposals)
    .set({
      status: 'superseded',
      decidedAt: timestamp,
      decisionNote: 'Superseded by a newer description proposal',
      updatedAt: timestamp,
    })
    .where(
      inArray(
        projectProposals.id,
        pending.map((p) => p.id),
      ),
    )
    .run();
}

function findEquivalentRelationshipProposal(
  db: DB,
  source: string,
  target: string,
  linkType: string,
): ProjectProposal | null {
  const candidates = db
    .select()
    .from(projectProposals)
    .where(
      and(
        eq(projectProposals.proposalType, 'relationship'),
        inArray(projectProposals.status, ACTIVE_STATUSES),
      ),
    )
    .all();
  for (const row of candidates) {
    const payload = safeParsePayload(row.payloadJson);
    if (
      payload?.type === 'relationship'
      && payload.sourceProject === source
      && payload.targetProject === target
      && payload.linkType === linkType
    ) {
      return mapRow(row);
    }
  }
  return null;
}

function findEquivalentMergeProposal(
  db: DB,
  source: string,
  target: string,
): ProjectProposal | null {
  const candidates = db
    .select()
    .from(projectProposals)
    .where(
      and(
        eq(projectProposals.proposalType, 'merge'),
        inArray(projectProposals.status, ACTIVE_STATUSES),
      ),
    )
    .all();
  for (const row of candidates) {
    const payload = safeParsePayload(row.payloadJson);
    if (
      payload?.type === 'merge'
      && payload.sourceProject === source
      && payload.targetProject === target
    ) {
      return mapRow(row);
    }
  }
  return null;
}

function relationshipAlreadyApplied(
  db: DB,
  source: string,
  target: string,
  linkType: string,
): boolean {
  const existing = db
    .select()
    .from(projectRelationships)
    .where(
      and(
        eq(projectRelationships.sourceProject, source),
        eq(projectRelationships.targetProject, target),
        eq(projectRelationships.linkType, linkType),
      ),
    )
    .get();
  return Boolean(existing);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function listProjectProposals(
  db: DB,
  query: FindProjectProposalsQuery = {},
): ProjectProposal[] {
  const conditions = [];
  if (query.project) conditions.push(eq(projectProposals.project, query.project));
  if (query.status) conditions.push(eq(projectProposals.status, query.status));
  if (query.proposalType) conditions.push(eq(projectProposals.proposalType, query.proposalType));

  const baseQuery = db.select().from(projectProposals);
  const filtered = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;
  const rows = filtered
    .orderBy(desc(projectProposals.createdAt))
    .limit(query.limit ?? 50)
    .all();
  return rows.map(mapRow);
}

export function getProjectProposal(db: DB, proposalUid: string): ProjectProposal | null {
  const row = db
    .select()
    .from(projectProposals)
    .where(eq(projectProposals.proposalUid, proposalUid))
    .get();
  return row ? mapRow(row) : null;
}

// ---------------------------------------------------------------------------
// Decide (accept / reject)
// ---------------------------------------------------------------------------

/**
 * Decide a pending proposal. On accept, the apply path runs:
 *  - description → updateProjectDescription
 *  - relationship → addProjectRelationship
 *  - merge → mergeProject (NOT YET IMPLEMENTED — throws)
 *
 * Returns { proposal, applied, error? }. `applied` is true only when the apply
 * path succeeded. On apply failure the proposal status reverts to pending.
 */
export function decideProjectProposal(
  db: DB,
  vaultRoot: string,
  logsPath: string,
  input: DecideProjectProposalInput,
): DecideProjectProposalResult {
  const row = db
    .select()
    .from(projectProposals)
    .where(eq(projectProposals.proposalUid, input.proposalUid))
    .get();
  if (!row) throw new Error(`Proposal not found: ${input.proposalUid}`);

  if (row.status !== 'pending') {
    throw new Error(`Proposal already decided: ${row.status}`);
  }

  const timestamp = now();
  const decidedBy = input.decidedBy ?? 'user';

  if (input.decision === 'reject') {
    db.update(projectProposals)
      .set({
        status: 'rejected',
        decidedBy,
        decidedAt: timestamp,
        decisionNote: input.decisionNote ?? null,
        updatedAt: timestamp,
      })
      .where(eq(projectProposals.id, row.id))
      .run();

    logActivity(db, logsPath, {
      timestamp,
      sourceClient: decidedBy,
      project: row.project,
      actionType: 'proposal_reject',
      targetItemId: input.proposalUid,
      status: 'success',
      aiUsed: false,
      message: `Rejected ${row.proposalType} proposal for ${row.project}`,
      metadata: { proposalType: row.proposalType },
    });

    const refreshed = db
      .select()
      .from(projectProposals)
      .where(eq(projectProposals.id, row.id))
      .get();
    return { proposal: mapRow(refreshed!), applied: false };
  }

  // accept path — flip status first so concurrent reads see the decision,
  // then run the apply path; on apply failure, revert.
  db.update(projectProposals)
    .set({
      status: 'accepted',
      decidedBy,
      decidedAt: timestamp,
      decisionNote: input.decisionNote ?? null,
      updatedAt: timestamp,
    })
    .where(eq(projectProposals.id, row.id))
    .run();

  const payload = safeParsePayload(row.payloadJson);
  if (!payload) {
    revertToPending(db, row.id);
    throw new Error(`Proposal ${input.proposalUid} has invalid payload_json`);
  }

  let applyError: string | undefined;
  try {
    if (payload.type === 'description') {
      const result = updateProjectDescription(db, row.project, payload.description);
      if (!result) throw new Error(`Project not found: ${row.project}`);
    } else if (payload.type === 'relationship') {
      addProjectRelationship(db, {
        sourceProject: payload.sourceProject,
        targetProject: payload.targetProject,
        linkType: payload.linkType,
        note: payload.note,
        createdBy: decidedBy,
      });
    } else if (payload.type === 'merge') {
      mergeProject(db, vaultRoot, logsPath, payload.sourceProject, payload.targetProject, {
        relocateFiles: payload.relocateFiles,
        decidedBy,
      });
    }
  } catch (err) {
    applyError = err instanceof Error ? err.message : String(err);
    revertToPending(db, row.id);
  }

  if (applyError) {
    logActivity(db, logsPath, {
      timestamp,
      sourceClient: decidedBy,
      project: row.project,
      actionType: 'proposal_accept',
      targetItemId: input.proposalUid,
      status: 'failure',
      aiUsed: false,
      message: `Failed to apply ${row.proposalType} proposal: ${applyError}`,
      metadata: { proposalType: row.proposalType },
    });
    const refreshed = db
      .select()
      .from(projectProposals)
      .where(eq(projectProposals.id, row.id))
      .get();
    return { proposal: mapRow(refreshed!), applied: false, error: applyError };
  }

  logActivity(db, logsPath, {
    timestamp,
    sourceClient: decidedBy,
    project: row.project,
    actionType: 'proposal_accept',
    targetItemId: input.proposalUid,
    status: 'success',
    aiUsed: false,
    message: `Accepted ${row.proposalType} proposal for ${row.project}`,
    metadata: { proposalType: row.proposalType },
  });

  const refreshed = db
    .select()
    .from(projectProposals)
    .where(eq(projectProposals.id, row.id))
    .get();
  return { proposal: mapRow(refreshed!), applied: true };
}

function revertToPending(db: DB, id: number): void {
  const timestamp = now();
  db.update(projectProposals)
    .set({
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      updatedAt: timestamp,
    })
    .where(eq(projectProposals.id, id))
    .run();
}

// ---------------------------------------------------------------------------
// Mappers / guards
// ---------------------------------------------------------------------------

function isProposalType(value: string): value is ProposalType {
  return (PROPOSAL_TYPES as readonly string[]).includes(value);
}

function isProposalStatus(value: string): value is ProposalStatus {
  return (PROPOSAL_STATUSES as readonly string[]).includes(value);
}

function safeParsePayload(json: string): ProjectProposalPayload | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed as ProjectProposalPayload;
    }
  } catch {
    // fall through
  }
  return null;
}

function safeParseEvidence(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return [];
}

function mapRow(row: typeof projectProposals.$inferSelect): ProjectProposal {
  const proposalType: ProposalType = isProposalType(row.proposalType) ? row.proposalType : 'description';
  const status: ProposalStatus = isProposalStatus(row.status) ? row.status : 'pending';
  const payload = safeParsePayload(row.payloadJson) ?? { type: 'description', description: '' };
  return {
    id: row.id,
    proposalUid: row.proposalUid,
    project: row.project,
    proposalType,
    payload,
    rationale: row.rationale,
    confidence: row.confidence,
    status,
    sourceTaskUid: row.sourceTaskUid,
    evidenceItemUids: safeParseEvidence(row.evidenceItemUidsJson),
    createdBy: row.createdBy,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
