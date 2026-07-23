// ============================================================================
// Open-Loops v2 — governed project classification and type conversion
// ============================================================================

import { and, eq, ne, or, sql } from 'drizzle-orm';
import {
  memoryItems,
  openLoops,
  projectEvents,
  projects,
} from '../database/schema.js';
import {
  ClassifyProjectInputSchema,
  ConvertProjectTypeInputSchema,
} from '../rules/validation.js';
import { generateProjectEventUid, generateProjectUid } from '../utils/uid.js';
import { now } from '../utils/datetime.js';
import { getProject } from './project.service.js';
import {
  getAuthorizationPolicy,
  getEvidencePolicy,
  getOpenLoopInstallationDefaults,
} from './open-loop-policy.service.js';
import { assertAuthorized, authorizeProjectAction } from './authorization.service.js';
import { recordInlineAuthorizationGrant } from './approval.service.js';
import { OpenLoopServiceError } from './open-loop-errors.js';
import type {
  ClassifyProjectInput,
  ConvertProjectTypeInput,
  Project,
  ProjectClassificationReport,
  ProjectClassificationResult,
  ProjectClassificationConfig,
} from '../types/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

export function classifyProject(
  db: DB,
  input: ClassifyProjectInput,
): ProjectClassificationResult {
  const validated = ClassifyProjectInputSchema.parse(input);
  const existingResult = validated.dryRun
    ? null
    : getProjectEventReplay(db, validated, 'classified');
  if (existingResult) {
    return { ...existingResult, idempotentReplay: true };
  }

  const report = buildClassificationReport(db, validated, false);
  if (validated.dryRun) {
    return { ...report, idempotentReplay: false, eventUid: null };
  }
  assertClassificationAllowed(report);

  return db.transaction((tx) => {
    const transactionalDb = tx as DB;
    const replay = getProjectEventReplay(transactionalDb, validated, 'classified');
    if (replay) return { ...replay, idempotentReplay: true };
    const current = requireProject(transactionalDb, validated.project);
    if (current.version !== validated.expectedVersion) {
      throw versionConflict(current, validated.expectedVersion);
    }
    if (current.projectType !== 'unclassified') {
      throw new OpenLoopServiceError(
        'PROJECT_ALREADY_CLASSIFIED',
        `Project ${current.name} is already ${current.projectType}`,
      );
    }

    const defaults = getOpenLoopInstallationDefaults(transactionalDb);
    const effectiveProject = withDefaultGovernance(current, defaults);
    const authorization = assertAuthorized(authorizeProjectAction(
      transactionalDb,
      effectiveProject,
      'classify_project',
      validated.actor,
      validated.authorizationRequestUid,
    ));
    const projectUid = current.projectUid || generateProjectUid();
    const eventUid = generateProjectEventUid();
    const timestamp = now();
    validateTargetPolicies(transactionalDb, validated.config, defaults, current);
    const values = projectTypeValues(
      validated.targetType,
      validated.config,
      defaults,
      validated.actor.actorUid,
      timestamp,
      current,
    );
    const update = transactionalDb.update(projects).set({
      projectUid,
      ...values,
      classificationVersion: current.classificationVersion + 1,
      classifiedByActorUid: validated.actor.actorUid,
      classifiedAt: timestamp,
      version: current.version + 1,
      updatedAt: timestamp,
    }).where(and(eq(projects.id, current.id), eq(projects.version, current.version))).run();
    if (update.changes !== 1) throw versionConflict(current, validated.expectedVersion);

    const updated = requireProject(transactionalDb, projectUid);
    const result: ProjectClassificationResult = {
      ...buildClassificationReportForProject(transactionalDb, updated, validated.targetType, false),
      idempotentReplay: false,
      eventUid,
    };
    if (authorization.policy.mode !== 'quorum') {
      recordInlineAuthorizationGrant(transactionalDb, {
        action: 'classify_project',
        targetUid: projectUid,
        policy: authorization.policy,
        actor: validated.actor,
        reason: 'Project classification',
        idempotencyKey: validated.idempotencyKey,
        eventUid,
        scope: { targetType: validated.targetType },
      });
    }
    transactionalDb.insert(projectEvents).values({
      eventUid,
      projectUid,
      idempotencyKey: validated.idempotencyKey,
      eventType: 'classified',
      actorUid: validated.actor.actorUid,
      actorKind: validated.actor.actorKind,
      authorizationPolicyUid: authorization.policy.policyUid,
      authorizationPolicyVersion: authorization.policy.version,
      payloadJson: JSON.stringify({ previousType: 'unclassified', nextType: validated.targetType }),
      resultJson: JSON.stringify(result),
      createdAt: timestamp,
    }).run();
    return result;
  });
}

export function convertProjectType(
  db: DB,
  input: ConvertProjectTypeInput,
): ProjectClassificationResult {
  const validated = ConvertProjectTypeInputSchema.parse(input);
  const existingResult = validated.dryRun
    ? null
    : getProjectEventReplay(db, validated, 'type_converted');
  if (existingResult) return { ...existingResult, idempotentReplay: true };
  const report = buildClassificationReport(db, validated, true);
  if (validated.dryRun) return { ...report, idempotentReplay: false, eventUid: null };
  assertClassificationAllowed(report);

  return db.transaction((tx) => {
    const transactionalDb = tx as DB;
    const replay = getProjectEventReplay(transactionalDb, validated, 'type_converted');
    if (replay) return { ...replay, idempotentReplay: true };
    const current = requireProject(transactionalDb, validated.project);
    if (current.version !== validated.expectedVersion) {
      throw versionConflict(current, validated.expectedVersion);
    }
    if (current.projectType === 'unclassified') {
      throw new OpenLoopServiceError('PROJECT_NOT_CLASSIFIED', 'Use classify_project for legacy-unclassified projects');
    }
    if (current.projectType === validated.targetType) {
      throw new OpenLoopServiceError('PROJECT_TYPE_UNCHANGED', `Project is already ${validated.targetType}`);
    }
    if (validated.targetType === 'brain_context' && countDedicatedLoops(transactionalDb, current.projectUid) > 0) {
      throw new OpenLoopServiceError(
        'LOOPS_PREVENT_BRAIN_CONVERSION',
        'Migrate every dedicated loop row to an owning Work Project before converting to Brain',
      );
    }

    const authorization = assertAuthorized(authorizeProjectAction(
      transactionalDb,
      current,
      'convert_project_type',
      validated.actor,
      validated.authorizationRequestUid,
    ));
    const defaults = getOpenLoopInstallationDefaults(transactionalDb);
    const eventUid = generateProjectEventUid();
    const timestamp = now();
    validateTargetPolicies(transactionalDb, validated.config, defaults, current);
    const values = projectTypeValues(
      validated.targetType,
      validated.config,
      defaults,
      validated.actor.actorUid,
      timestamp,
      current,
    );
    const update = transactionalDb.update(projects).set({
      ...values,
      classificationVersion: current.classificationVersion + 1,
      classifiedByActorUid: validated.actor.actorUid,
      classifiedAt: timestamp,
      version: current.version + 1,
      updatedAt: timestamp,
    }).where(and(eq(projects.id, current.id), eq(projects.version, current.version))).run();
    if (update.changes !== 1) throw versionConflict(current, validated.expectedVersion);

    const updated = requireProject(transactionalDb, current.projectUid!);
    const result: ProjectClassificationResult = {
      ...buildClassificationReportForProject(transactionalDb, updated, validated.targetType, false),
      idempotentReplay: false,
      eventUid,
    };
    if (authorization.policy.mode !== 'quorum') {
      recordInlineAuthorizationGrant(transactionalDb, {
        action: 'convert_project_type',
        targetUid: current.projectUid!,
        policy: authorization.policy,
        actor: validated.actor,
        reason: validated.reason,
        idempotencyKey: validated.idempotencyKey,
        eventUid,
        scope: { previousType: current.projectType, nextType: validated.targetType },
      });
    }
    transactionalDb.insert(projectEvents).values({
      eventUid,
      projectUid: current.projectUid!,
      idempotencyKey: validated.idempotencyKey,
      eventType: 'type_converted',
      actorUid: validated.actor.actorUid,
      actorKind: validated.actor.actorKind,
      authorizationPolicyUid: authorization.policy.policyUid,
      authorizationPolicyVersion: authorization.policy.version,
      payloadJson: JSON.stringify({ previousType: current.projectType, nextType: validated.targetType, reason: validated.reason }),
      resultJson: JSON.stringify(result),
      createdAt: timestamp,
    }).run();
    return result;
  });
}

export function buildProjectClassificationDryRun(
  db: DB,
  input: ClassifyProjectInput | ConvertProjectTypeInput,
): ProjectClassificationReport {
  const isConversion = 'reason' in input;
  const validated = isConversion
    ? ConvertProjectTypeInputSchema.parse({ ...input, dryRun: true })
    : ClassifyProjectInputSchema.parse({ ...input, dryRun: true });
  return buildClassificationReport(db, validated, isConversion);
}

function buildClassificationReport(
  db: DB,
  input: ReturnType<typeof ClassifyProjectInputSchema.parse>,
  conversion: boolean,
): ProjectClassificationReport {
  const project = requireProject(db, input.project);
  const report = buildClassificationReportForProject(db, project, input.targetType, true);
  const reasonCodes = [...report.reasonCodes];
  if (project.version !== input.expectedVersion) reasonCodes.push('VERSION_CONFLICT');
  if (!conversion && project.projectType !== 'unclassified') reasonCodes.push('PROJECT_ALREADY_CLASSIFIED');
  if (conversion && project.projectType === 'unclassified') reasonCodes.push('PROJECT_NOT_CLASSIFIED');
  if (conversion && project.projectType === input.targetType) reasonCodes.push('PROJECT_TYPE_UNCHANGED');
  if (conversion && input.targetType === 'brain_context' && report.dedicatedLoopCount > 0) {
    reasonCodes.push('LOOPS_PREVENT_BRAIN_CONVERSION');
  }
  const defaults = getOpenLoopInstallationDefaults(db);
  const effective = withDefaultGovernance(project, defaults);
  try {
    const authorization = authorizeProjectAction(
      db,
      effective,
      conversion ? 'convert_project_type' : 'classify_project',
      input.actor,
      input.authorizationRequestUid,
    );
    if (!authorization.authorized) reasonCodes.push(authorization.reasonCode);
  } catch (error) {
    reasonCodes.push(error instanceof OpenLoopServiceError ? error.code : 'AUTHORIZATION_DENIED');
  }
  return { ...report, allowed: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}

function buildClassificationReportForProject(
  db: DB,
  project: Project,
  requestedType: 'work_project' | 'brain_context',
  dryRun: boolean,
): ProjectClassificationReport {
  return {
    project,
    requestedType,
    dryRun,
    allowed: true,
    reasonCodes: [],
    legacyCandidateCount: countLegacyCandidates(db, project.name),
    dedicatedNonterminalLoopCount: countDedicatedNonterminalLoops(db, project.projectUid),
    dedicatedLoopCount: countDedicatedLoops(db, project.projectUid),
    resultingLifecycleState: 'shadow',
  };
}

function projectTypeValues(
  targetType: 'work_project' | 'brain_context',
  config: ProjectClassificationConfig,
  defaults: ReturnType<typeof getOpenLoopInstallationDefaults>,
  actorUid: string,
  timestamp: string,
  current?: Project,
): Partial<typeof projects.$inferInsert> {
  return {
    projectType: targetType,
    lifecycleState: 'shadow',
    description: config.description || current?.description || null,
    canonicalRoot: targetType === 'work_project' ? config.canonicalRoot! : null,
    repositoryUrl: targetType === 'work_project' ? config.repositoryUrl || null : null,
    defaultBranch: targetType === 'work_project' ? config.defaultBranch || null : null,
    memoryPurpose: targetType === 'brain_context' ? config.memoryPurpose! : null,
    ownerActorUid: config.ownerActorUid || current?.ownerActorUid || actorUid || defaults.actor.actorUid,
    ownerRole: config.ownerRole || current?.ownerRole || null,
    authorizationPolicyId: config.authorizationPolicyId || current?.authorizationPolicyId || defaults.authorizationPolicyUid,
    evidencePolicyId: config.evidencePolicyId || current?.evidencePolicyId || defaults.evidencePolicyUid,
    typeConfigJson: JSON.stringify(config.typeConfig || current?.typeConfig || {}),
    classifiedAt: timestamp,
  };
}

function requireProject(db: DB, identifier: string): Project {
  const row = db.select().from(projects)
    .where(or(eq(projects.name, identifier), eq(projects.projectUid, identifier)))
    .get();
  if (!row) throw new OpenLoopServiceError('PROJECT_NOT_FOUND', `Project not found: ${identifier}`);
  return getProject(db, row.name)!;
}

function countLegacyCandidates(db: DB, projectName: string): number {
  const row = db.select({ count: sql<number>`count(*)` }).from(memoryItems).where(and(
    eq(memoryItems.project, projectName),
    or(
      ne(memoryItems.nextStepsJson, '[]'),
      eq(memoryItems.routineType, 'debugging'),
      sql`${memoryItems.snoozedUntil} IS NOT NULL`,
      eq(memoryItems.status, 'resolved'),
    ),
  )).get();
  return Number(row?.count || 0);
}

function countDedicatedNonterminalLoops(db: DB, projectUid: string | null): number {
  if (!projectUid) return 0;
  const row = db.select({ count: sql<number>`count(*)` }).from(openLoops).where(and(
    eq(openLoops.projectUid, projectUid),
    ne(openLoops.state, 'resolved'),
  )).get();
  return Number(row?.count || 0);
}

function countDedicatedLoops(db: DB, projectUid: string | null): number {
  if (!projectUid) return 0;
  const row = db.select({ count: sql<number>`count(*)` }).from(openLoops)
    .where(eq(openLoops.projectUid, projectUid)).get();
  return Number(row?.count || 0);
}

function withDefaultGovernance(
  project: Project,
  defaults: ReturnType<typeof getOpenLoopInstallationDefaults>,
): Project {
  return {
    ...project,
    authorizationPolicyId: project.authorizationPolicyId || defaults.authorizationPolicyUid,
    evidencePolicyId: project.evidencePolicyId || defaults.evidencePolicyUid,
    ownerActorUid: project.ownerActorUid || defaults.actor.actorUid,
  };
}

function validateTargetPolicies(
  db: DB,
  config: ProjectClassificationConfig,
  defaults: ReturnType<typeof getOpenLoopInstallationDefaults>,
  current?: Project,
): void {
  const authorizationPolicyUid = config.authorizationPolicyId || current?.authorizationPolicyId || defaults.authorizationPolicyUid;
  const evidencePolicyUid = config.evidencePolicyId || current?.evidencePolicyId || defaults.evidencePolicyUid;
  if (!getAuthorizationPolicy(db, authorizationPolicyUid)) {
    throw new OpenLoopServiceError('AUTHORIZATION_POLICY_NOT_FOUND', `Authorization policy not found: ${authorizationPolicyUid}`);
  }
  if (!getEvidencePolicy(db, evidencePolicyUid)) {
    throw new OpenLoopServiceError('EVIDENCE_POLICY_NOT_FOUND', `Evidence policy not found: ${evidencePolicyUid}`);
  }
}

function assertClassificationAllowed(report: ProjectClassificationReport): void {
  if (!report.allowed) {
    const first = report.reasonCodes[0] || 'AUTHORIZATION_DENIED';
    throw new OpenLoopServiceError(
      first as ConstructorParameters<typeof OpenLoopServiceError>[0],
      `Project classification is not allowed: ${report.reasonCodes.join(', ')}`,
      { reasonCodes: report.reasonCodes },
    );
  }
}

function versionConflict(project: Project, expectedVersion: number): OpenLoopServiceError {
  return new OpenLoopServiceError(
    'VERSION_CONFLICT',
    `Project version conflict: expected ${expectedVersion}, found ${project.version}`,
    { expectedVersion, actualVersion: project.version },
  );
}

function getProjectEventReplay(
  db: DB,
  input: ReturnType<typeof ClassifyProjectInputSchema.parse>,
  expectedEventType: 'classified' | 'type_converted',
): ProjectClassificationResult | null {
  const row = db.select().from(projectEvents)
    .where(eq(projectEvents.idempotencyKey, input.idempotencyKey)).get();
  if (!row) return null;
  const result = JSON.parse(row.resultJson) as ProjectClassificationResult;
  const projectMatches = input.project === result.project.projectUid || input.project === result.project.name;
  if (row.eventType !== expectedEventType || !projectMatches || result.requestedType !== input.targetType) {
    throw new OpenLoopServiceError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was already used for a different project classification mutation',
      { idempotencyKey: input.idempotencyKey, existingEventType: row.eventType, existingProjectUid: row.projectUid },
    );
  }
  return result;
}
