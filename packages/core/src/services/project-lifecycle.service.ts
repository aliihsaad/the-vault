// ============================================================================
// Open-Loops v2 Phase E — governed project lifecycle activation and rollback
// ============================================================================

import { and, eq, ne, or, sql } from 'drizzle-orm';
import { memoryItems, projectEvents, projects } from '../database/schema.js';
import { TransitionProjectLifecycleInputSchema } from '../rules/validation.js';
import { generateProjectEventUid } from '../utils/uid.js';
import { now } from '../utils/datetime.js';
import { getProject } from './project.service.js';
import { assertAuthorized, authorizeProjectAction } from './authorization.service.js';
import { recordInlineAuthorizationGrant } from './approval.service.js';
import { OpenLoopServiceError } from './open-loop-errors.js';
import type {
  Project,
  ProjectLifecycleTransitionResult,
  TransitionProjectLifecycleInput,
} from '../types/index.js';
import type { ProjectLifecycleState } from '../rules/controlled-values.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;
type GovernedLifecycleState = Exclude<ProjectLifecycleState, 'unclassified'>;

const ALLOWED_TRANSITIONS: Record<GovernedLifecycleState, GovernedLifecycleState[]> = {
  legacy_cleanup: ['shadow', 'gate_ready', 'suspended'],
  shadow: ['legacy_cleanup', 'gate_ready', 'gate_active', 'suspended'],
  gate_ready: ['shadow', 'gate_active', 'suspended'],
  gate_active: ['shadow', 'gate_ready', 'suspended'],
  suspended: ['legacy_cleanup', 'shadow', 'gate_ready'],
};

export function transitionProjectLifecycle(
  db: DB,
  input: TransitionProjectLifecycleInput,
): ProjectLifecycleTransitionResult {
  const validated = TransitionProjectLifecycleInputSchema.parse(input) as TransitionProjectLifecycleInput;
  const replay = getReplay(db, validated);
  if (replay) return { ...replay, idempotentReplay: true };

  return db.transaction((tx) => {
    const transactionalDb = tx as DB;
    const transactionReplay = getReplay(transactionalDb, validated);
    if (transactionReplay) return { ...transactionReplay, idempotentReplay: true };

    const current = requireProject(transactionalDb, validated.project);
    if (current.version !== validated.expectedVersion) {
      throw new OpenLoopServiceError(
        'VERSION_CONFLICT',
        `Project version conflict: expected ${validated.expectedVersion}, found ${current.version}`,
        { expectedVersion: validated.expectedVersion, actualVersion: current.version },
      );
    }
    if (current.projectType === 'unclassified') {
      throw new OpenLoopServiceError(
        'PROJECT_NOT_CLASSIFIED',
        `Project ${current.name} must be classified before changing lifecycle state`,
      );
    }
    if (current.lifecycleState === validated.nextState) {
      throw new OpenLoopServiceError(
        'PROJECT_LIFECYCLE_UNCHANGED',
        `Project ${current.name} is already ${validated.nextState}`,
      );
    }
    if (!current.lifecycleState) {
      throw new OpenLoopServiceError(
        'PROJECT_NOT_CLASSIFIED',
        `Project ${current.name} has no governed lifecycle state`,
      );
    }
    const currentState = current.lifecycleState;
    if (!ALLOWED_TRANSITIONS[currentState]?.includes(validated.nextState)) {
      throw new OpenLoopServiceError(
        'PROJECT_LIFECYCLE_TRANSITION_DENIED',
        `Project lifecycle transition ${currentState} -> ${validated.nextState} is not allowed`,
      );
    }
    if ((validated.nextState === 'gate_ready' || validated.nextState === 'gate_active')
      && countActiveLegacyNextSteps(transactionalDb, current.name) > 0) {
      throw new OpenLoopServiceError(
        'LEGACY_CANDIDATES_PREVENT_GATE_ACTIVATION',
        `Project ${current.name} still has active legacy next_steps`,
      );
    }

    const authorization = assertAuthorized(authorizeProjectAction(
      transactionalDb,
      current,
      'transition_project_lifecycle',
      validated.actor,
      validated.authorizationRequestUid,
    ));
    const eventUid = generateProjectEventUid();
    const timestamp = now();
    const update = transactionalDb.update(projects).set({
      lifecycleState: validated.nextState,
      version: current.version + 1,
      updatedAt: timestamp,
    }).where(and(eq(projects.id, current.id), eq(projects.version, current.version))).run();
    if (update.changes !== 1) {
      throw new OpenLoopServiceError('VERSION_CONFLICT', 'Project changed during lifecycle transition');
    }

    const updated = requireProject(transactionalDb, current.projectUid || current.name);
    const result: ProjectLifecycleTransitionResult = {
      eventUid,
      project: updated,
      previousState: currentState,
      nextState: validated.nextState as GovernedLifecycleState,
      reason: validated.reason,
      idempotentReplay: false,
    };
    if (authorization.policy.mode !== 'quorum') {
      recordInlineAuthorizationGrant(transactionalDb, {
        action: 'transition_project_lifecycle',
        targetUid: updated.projectUid!,
        policy: authorization.policy,
        actor: validated.actor,
        reason: validated.reason,
        idempotencyKey: validated.idempotencyKey,
        eventUid,
        scope: { previousState: currentState, nextState: validated.nextState },
      });
    }
    transactionalDb.insert(projectEvents).values({
      eventUid,
      projectUid: updated.projectUid!,
      idempotencyKey: validated.idempotencyKey,
      eventType: 'lifecycle_transitioned',
      actorUid: validated.actor.actorUid,
      actorKind: validated.actor.actorKind,
      authorizationPolicyUid: authorization.policy.policyUid,
      authorizationPolicyVersion: authorization.policy.version,
      payloadJson: JSON.stringify({
        previousState: currentState,
        nextState: validated.nextState,
        reason: validated.reason,
      }),
      resultJson: JSON.stringify(result),
      createdAt: timestamp,
    }).run();
    return result;
  });
}

function getReplay(
  db: DB,
  input: TransitionProjectLifecycleInput,
): ProjectLifecycleTransitionResult | null {
  const row = db.select().from(projectEvents)
    .where(eq(projectEvents.idempotencyKey, input.idempotencyKey)).get();
  if (!row) return null;
  const result = JSON.parse(row.resultJson) as ProjectLifecycleTransitionResult;
  const sameProject = input.project === result.project.projectUid || input.project === result.project.name;
  const sameMutation = row.eventType === 'lifecycle_transitioned'
    && sameProject
    && result.nextState === input.nextState
    && result.reason === input.reason;
  if (!sameMutation) {
    throw new OpenLoopServiceError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was already used for another project mutation',
      { idempotencyKey: input.idempotencyKey, existingEventType: row.eventType },
    );
  }
  return result;
}

function requireProject(db: DB, identifier: string): Project {
  const row = db.select().from(projects)
    .where(or(eq(projects.projectUid, identifier), eq(projects.name, identifier))).get();
  if (!row) throw new OpenLoopServiceError('PROJECT_NOT_FOUND', `Project not found: ${identifier}`);
  return getProject(db, row.name)!;
}

function countActiveLegacyNextSteps(db: DB, projectName: string): number {
  const row = db.select({ count: sql<number>`count(*)` }).from(memoryItems).where(and(
    eq(memoryItems.project, projectName),
    eq(memoryItems.status, 'active'),
    ne(memoryItems.nextStepsJson, '[]'),
  )).get();
  return Number(row?.count || 0);
}
