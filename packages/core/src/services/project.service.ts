// ============================================================================
// Vault — Project Service
// CRUD operations for projects.
// ============================================================================

import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { and, eq, or, sql } from 'drizzle-orm';
import {
  projects,
  projectRelationships,
  projectProposals,
  memoryItems,
  openLoops,
  tasks,
} from '../database/schema.js';
import { now } from '../utils/datetime.js';
import { generateProjectUid } from '../utils/uid.js';
import { ensureProjectDirs } from '../config/vault-root.js';
import { slugify } from '../rules/naming.js';
import { PROJECT_LINK_TYPES, type ProjectLinkType } from '../rules/controlled-values.js';
import { CreateProjectInputSchema } from '../rules/validation.js';
import {
  getAuthorizationPolicy,
  getEvidencePolicy,
  getOpenLoopInstallationDefaults,
} from './open-loop-policy.service.js';
import { logActivity } from './log.service.js';
import type {
  AddProjectRelationshipInput,
  CreateProjectInput,
  MergeProjectResult,
  Project,
  ProjectMomentum,
  ProjectMomentumDirection,
  ProjectRelationship,
} from '../types/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

/**
 * Find an existing project whose slug matches the input name's slug.
 * Returns the canonical row (first-saved casing wins) or null.
 */
function findProjectBySlug(db: DB, name: string): typeof projects.$inferSelect | null {
  const targetSlug = slugify(name);
  const rows = db.select().from(projects).all();
  return rows.find((row) => slugify(row.name) === targetSlug) ?? null;
}

/**
 * Resolve a caller-supplied project name (any casing, or slug form like
 * "vault-collab") to the canonical stored name (e.g. "Vault Collab").
 * Returns the input unchanged when no project matches.
 */
export function resolveCanonicalProjectName(db: DB, name: string): string {
  const existing = findProjectBySlug(db, name);
  return existing ? existing.name : name;
}

/**
 * Infer the owning project from related file paths. This is intentionally
 * conservative: only absolute paths are considered, and all matching paths
 * must agree on the same known project slug.
 */
export function inferProjectNameFromRelatedFiles(
  db: DB,
  relatedFiles: string[],
): string | null {
  const projectRows = db.select().from(projects).all();
  const slugToName = new Map(projectRows.map((row) => [slugify(row.name), row.name]));
  const matches = new Set<string>();

  for (const filePath of relatedFiles) {
    if (!isAbsoluteRelatedFilePath(filePath)) {
      continue;
    }

    const pathMatches = filePath
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => slugify(segment))
      .filter((segment) => slugToName.has(segment));

    if (pathMatches.length > 0) {
      matches.add(pathMatches[pathMatches.length - 1]!);
    }
  }

  return matches.size === 1 ? slugToName.get([...matches][0]!) ?? null : null;
}

export function relatedFilesContainProjectSlug(
  relatedFiles: string[],
  projectName: string,
): boolean {
  const targetSlug = slugify(projectName);
  return relatedFiles.some((filePath) =>
    filePath
      .replace(/\\/g, '/')
      .split('/')
      .some((segment) => slugify(segment) === targetSlug),
  );
}

function isAbsoluteRelatedFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/');
}

/**
 * Create a new project. Also creates the directory structure.
 * If a project with the same slug already exists, returns it (first-casing wins).
 */
export function createProject(
  db: DB,
  vaultRoot: string,
  input: CreateProjectInput,
): Project {
  const validated = CreateProjectInputSchema.parse(input);
  const timestamp = now();
  const name = validated.name;

  const existing = findProjectBySlug(db, name);
  if (existing) {
    ensureProjectDirs(vaultRoot, slugify(existing.name));
    const mapped = mapProjectRow(existing);
    if (mapped.projectType === 'unclassified') {
      throw new Error(`Project "${mapped.name}" is legacy-unclassified; use classify_project before typed work`);
    }
    if (mapped.projectType !== validated.projectType) {
      throw new Error(`Project "${mapped.name}" already exists as ${mapped.projectType}`);
    }
    return mapProjectRow(existing);
  }

  const defaults = getOpenLoopInstallationDefaults(db);
  const ownerActorUid = validated.ownerActorUid || defaults.actor.actorUid;
  const authorizationPolicyId = validated.authorizationPolicyId || defaults.authorizationPolicyUid;
  const evidencePolicyId = validated.evidencePolicyId || defaults.evidencePolicyUid;
  if (!getAuthorizationPolicy(db, authorizationPolicyId)) {
    throw new Error(`Authorization policy not found: ${authorizationPolicyId}`);
  }
  if (!getEvidencePolicy(db, evidencePolicyId)) {
    throw new Error(`Evidence policy not found: ${evidencePolicyId}`);
  }

  db.insert(projects)
    .values({
      name,
      description: validated.description || null,
      projectUid: generateProjectUid(),
      projectType: validated.projectType,
      lifecycleState: 'shadow',
      authorizationPolicyId,
      evidencePolicyId,
      classificationVersion: 1,
      classifiedByActorUid: ownerActorUid,
      classifiedAt: timestamp,
      version: 1,
      canonicalRoot: validated.projectType === 'work_project' ? validated.canonicalRoot! : null,
      repositoryUrl: validated.repositoryUrl || null,
      defaultBranch: validated.defaultBranch || null,
      ownerActorUid,
      ownerRole: validated.ownerRole || null,
      memoryPurpose: validated.projectType === 'brain_context' ? validated.memoryPurpose! : null,
      typeConfigJson: JSON.stringify(validated.typeConfig),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .run();

  ensureProjectDirs(vaultRoot, slugify(name));

  const row = db.select().from(projects).where(eq(projects.name, name)).get();
  return mapProjectRow(row!);
}

/**
 * Ensure a project exists (create if not). Matches by slug so casing variants
 * collapse to a single row. Returns the canonical project name to use for
 * downstream writes (e.g. memory_items.project).
 */
export function ensureProject(
  db: DB,
  vaultRoot: string,
  name: string,
): string {
  const existing = findProjectBySlug(db, name);
  if (existing) {
    ensureProjectDirs(vaultRoot, slugify(existing.name));
    return existing.name;
  }

  createLegacyUnclassifiedProject(db, vaultRoot, name);
  return name;
}

function createLegacyUnclassifiedProject(
  db: DB,
  vaultRoot: string,
  name: string,
): Project {
  const timestamp = now();
  db.insert(projects)
    .values({
      name,
      description: null,
      projectUid: null,
      projectType: null,
      lifecycleState: null,
      authorizationPolicyId: null,
      evidencePolicyId: null,
      classificationVersion: 0,
      classifiedByActorUid: null,
      classifiedAt: null,
      version: 0,
      canonicalRoot: null,
      repositoryUrl: null,
      defaultBranch: null,
      ownerActorUid: null,
      ownerRole: null,
      memoryPurpose: null,
      typeConfigJson: '{}',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .run();
  ensureProjectDirs(vaultRoot, slugify(name));
  const row = db.select().from(projects).where(eq(projects.name, name)).get();
  return mapProjectRow(row!);
}

/**
 * List all projects with memory counts and relationships.
 */
export function listProjects(db: DB): Project[] {
  const rows = db.select().from(projects).all();
  const allRelationships = db.select().from(projectRelationships).all();

  return rows.map((row) => {
    const countResult = db
      .select({ count: sql<number>`count(*)` })
      .from(memoryItems)
      .where(eq(memoryItems.project, row.name))
      .get();

    const relationships = allRelationships
      .filter((r) => r.sourceProject === row.name || r.targetProject === row.name)
      .map(mapRelationshipRow);

    return {
      ...mapProjectRow(row),
      memoryCount: countResult?.count || 0,
      relationships,
    };
  });
}

/**
 * Per-project activity momentum for the Overview "Project radar" panel.
 * Compares memory creation in the trailing 7 days against the preceding 7
 * days, plus the most recent activity timestamp. Pure read-only aggregation
 * over `memory_items.created_at` — no schema change, no writes.
 */
export function getProjectsMomentum(db: DB, referenceDate?: Date): ProjectMomentum[] {
  const now = referenceDate ?? new Date();
  const last7Cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const prior7Cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const inactiveCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const projectRows = db.select().from(projects).all();

  return projectRows.map((row) => {
    const stats = db
      .select({
        last7d: sql<number>`SUM(CASE WHEN ${memoryItems.createdAt} >= ${last7Cutoff} THEN 1 ELSE 0 END)`,
        prior7d: sql<number>`SUM(CASE WHEN ${memoryItems.createdAt} >= ${prior7Cutoff} AND ${memoryItems.createdAt} < ${last7Cutoff} THEN 1 ELSE 0 END)`,
        lastActivityAt: sql<string | null>`MAX(${memoryItems.createdAt})`,
      })
      .from(memoryItems)
      .where(eq(memoryItems.project, row.name))
      .get();

    const last7dCount = Number(stats?.last7d ?? 0);
    const prior7dCount = Number(stats?.prior7d ?? 0);
    const delta = last7dCount - prior7dCount;
    const lastActivityAt = stats?.lastActivityAt ?? null;

    let direction: ProjectMomentumDirection;
    if (!lastActivityAt || lastActivityAt < inactiveCutoff) {
      direction = 'inactive';
    } else if (delta > 0) {
      direction = 'up';
    } else if (delta < 0) {
      direction = 'down';
    } else {
      direction = 'flat';
    }

    return {
      name: row.name,
      last7dCount,
      prior7dCount,
      delta,
      direction,
      lastActivityAt,
    };
  });
}

/**
 * Get a single project by name. Slug-matched so casing variants resolve
 * to the canonical row. Includes relationships.
 */
export function getProject(db: DB, name: string): Project | null {
  const row = findProjectBySlug(db, name);
  if (!row) return null;
  return {
    ...mapProjectRow(row),
    relationships: listProjectRelationships(db, row.name),
  };
}

/**
 * Update the description on an existing project (matched by slug).
 * Returns the updated row, or null if no match.
 */
export function updateProjectDescription(
  db: DB,
  name: string,
  description: string | null,
): Project | null {
  const existing = findProjectBySlug(db, name);
  if (!existing) return null;

  db.update(projects)
    .set({ description, updatedAt: now() })
    .where(eq(projects.id, existing.id))
    .run();

  const refreshed = db.select().from(projects).where(eq(projects.id, existing.id)).get();
  return refreshed ? mapProjectRow(refreshed) : null;
}

// ---------------------------------------------------------------------------
// Project relationships
// ---------------------------------------------------------------------------

function isProjectLinkType(value: string): value is ProjectLinkType {
  return (PROJECT_LINK_TYPES as readonly string[]).includes(value);
}

/**
 * List all relationships involving the given project (as either source or target).
 * Project name is slug-matched against the canonical row, so casing variants
 * resolve to the same set of relationships.
 */
export function listProjectRelationships(db: DB, projectName: string): ProjectRelationship[] {
  const canonical = findProjectBySlug(db, projectName);
  const target = canonical?.name ?? projectName;
  const rows = db
    .select()
    .from(projectRelationships)
    .where(
      or(
        eq(projectRelationships.sourceProject, target),
        eq(projectRelationships.targetProject, target),
      ),
    )
    .all();
  return rows.map(mapRelationshipRow);
}

/**
 * Add a relationship between two projects. Source/target are slug-resolved to
 * canonical names so a relationship survives casing drift on either side.
 * Idempotent on (source, target, link_type) — re-adding the same triple is a no-op.
 */
export function addProjectRelationship(
  db: DB,
  input: AddProjectRelationshipInput,
): ProjectRelationship {
  const sourceCanonical = findProjectBySlug(db, input.sourceProject)?.name ?? input.sourceProject;
  const targetCanonical = findProjectBySlug(db, input.targetProject)?.name ?? input.targetProject;

  if (sourceCanonical === targetCanonical) {
    throw new Error(`A project cannot have a relationship to itself: ${sourceCanonical}`);
  }

  const existing = db
    .select()
    .from(projectRelationships)
    .where(
      and(
        eq(projectRelationships.sourceProject, sourceCanonical),
        eq(projectRelationships.targetProject, targetCanonical),
        eq(projectRelationships.linkType, input.linkType),
      ),
    )
    .get();
  if (existing) return mapRelationshipRow(existing);

  const timestamp = now();
  db.insert(projectRelationships)
    .values({
      sourceProject: sourceCanonical,
      targetProject: targetCanonical,
      linkType: input.linkType,
      note: input.note ?? null,
      confidence: input.confidence ?? null,
      createdBy: input.createdBy ?? 'user',
      createdAt: timestamp,
    })
    .run();

  const inserted = db
    .select()
    .from(projectRelationships)
    .where(
      and(
        eq(projectRelationships.sourceProject, sourceCanonical),
        eq(projectRelationships.targetProject, targetCanonical),
        eq(projectRelationships.linkType, input.linkType),
      ),
    )
    .get();
  return mapRelationshipRow(inserted!);
}

/**
 * Remove a project relationship by id. Returns true if a row was deleted.
 */
export function removeProjectRelationship(db: DB, id: number): boolean {
  const before = db.select().from(projectRelationships).where(eq(projectRelationships.id, id)).get();
  if (!before) return false;
  db.delete(projectRelationships).where(eq(projectRelationships.id, id)).run();
  return true;
}

// ---------------------------------------------------------------------------
// Project merge — collapses sourceProject into targetProject
// ---------------------------------------------------------------------------

/**
 * Merge `sourceName` into `targetName`. After this returns:
 *  - every memory_items row whose project matched sourceName has its project
 *    rewritten to the canonical target name and its vault_path rewritten to
 *    the target project's directory (files are relocated on disk when present);
 *  - every project_relationships row touching sourceName is rewired to target
 *    (self-loops / duplicates are dropped);
 *  - every tasks.project and project_proposals.project reference is rewritten;
 *  - the sourceName row in projects is deleted.
 *
 * Activity history (activity_logs) is intentionally left alone for audit fidelity.
 *
 * Both names are slug-resolved so casing variants collapse. Throws when source
 * and target slugify to the same value (you cannot merge a project into itself)
 * or when source does not exist.
 */
export function mergeProject(
  db: DB,
  vaultRoot: string,
  logsPath: string,
  sourceName: string,
  targetName: string,
  options: { relocateFiles?: boolean; decidedBy?: string } = {},
): MergeProjectResult {
  const relocateFiles = options.relocateFiles !== false;
  const decidedBy = options.decidedBy ?? 'system';

  const sourceRow = findProjectBySlug(db, sourceName);
  if (!sourceRow) {
    throw new Error(`Source project not found: ${sourceName}`);
  }
  if (slugify(sourceRow.name) === slugify(targetName)) {
    throw new Error(`Cannot merge a project into itself: ${sourceRow.name}`);
  }

  // Ensure target exists and resolve to its canonical name.
  const targetCanonicalName = ensureProject(db, vaultRoot, targetName);
  const targetRow = findProjectBySlug(db, targetCanonicalName)!;
  const targetSlug = slugify(targetCanonicalName);
  ensureProjectDirs(vaultRoot, targetSlug);

  const sourceCanonicalName = sourceRow.name;
  const sourceSlug = slugify(sourceCanonicalName);
  const timestamp = now();

  // Dedicated loops are keyed by immutable project UIDs rather than project
  // names. Validate the move before touching files or legacy rows so a merge
  // cannot strand a loop or violate active-loop deduplication.
  const sourceLoops = sourceRow.projectUid
    ? db.select().from(openLoops).where(eq(openLoops.projectUid, sourceRow.projectUid)).all()
    : [];
  if (sourceLoops.length > 0) {
    if (targetRow.projectType !== 'work_project' || !targetRow.projectUid) {
      throw new Error('Projects with dedicated open loops can only merge into a typed Work Project');
    }
    const targetActiveKeys = new Set(
      db.select({ dedupeKey: openLoops.dedupeKey, state: openLoops.state })
        .from(openLoops)
        .where(eq(openLoops.projectUid, targetRow.projectUid))
        .all()
        .filter((loop) => loop.state !== 'resolved')
        .map((loop) => loop.dedupeKey),
    );
    const conflict = sourceLoops.find(
      (loop) => loop.state !== 'resolved' && targetActiveKeys.has(loop.dedupeKey),
    );
    if (conflict) {
      throw new Error(`Cannot merge projects with duplicate active loop dedupe key: ${conflict.dedupeKey}`);
    }
  }

  // -------- memory_items --------
  const sourceItems = db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.project, sourceCanonicalName))
    .all();

  const movedItemUids: string[] = [];
  let filesRelocated = 0;
  let filesMissing = 0;

  for (const row of sourceItems) {
    let nextPath = row.vaultPath;
    if (row.vaultPath) {
      const result = relocateProjectFile(
        row.vaultPath,
        sourceSlug,
        targetSlug,
        relocateFiles,
      );
      nextPath = result.newPath;
      if (result.moved) filesRelocated += 1;
      else if (relocateFiles) filesMissing += 1;
    }

    db.update(memoryItems)
      .set({
        project: targetCanonicalName,
        vaultPath: nextPath,
        updatedAt: timestamp,
      })
      .where(eq(memoryItems.id, row.id))
      .run();
    movedItemUids.push(row.itemUid);
  }

  // -------- project_relationships --------
  const sourceRels = db
    .select()
    .from(projectRelationships)
    .where(
      or(
        eq(projectRelationships.sourceProject, sourceCanonicalName),
        eq(projectRelationships.targetProject, sourceCanonicalName),
      ),
    )
    .all();

  const rewrittenRelationshipIds: number[] = [];
  const removedRelationshipIds: number[] = [];

  for (const rel of sourceRels) {
    const newSource = rel.sourceProject === sourceCanonicalName
      ? targetCanonicalName
      : rel.sourceProject;
    const newTarget = rel.targetProject === sourceCanonicalName
      ? targetCanonicalName
      : rel.targetProject;

    if (newSource === newTarget) {
      db.delete(projectRelationships).where(eq(projectRelationships.id, rel.id)).run();
      removedRelationshipIds.push(rel.id);
      continue;
    }

    const duplicate = db
      .select()
      .from(projectRelationships)
      .where(
        and(
          eq(projectRelationships.sourceProject, newSource),
          eq(projectRelationships.targetProject, newTarget),
          eq(projectRelationships.linkType, rel.linkType),
        ),
      )
      .get();
    if (duplicate && duplicate.id !== rel.id) {
      db.delete(projectRelationships).where(eq(projectRelationships.id, rel.id)).run();
      removedRelationshipIds.push(rel.id);
      continue;
    }

    db.update(projectRelationships)
      .set({ sourceProject: newSource, targetProject: newTarget })
      .where(eq(projectRelationships.id, rel.id))
      .run();
    rewrittenRelationshipIds.push(rel.id);
  }

  // -------- tasks.project --------
  const sourceTasks = db
    .select()
    .from(tasks)
    .where(eq(tasks.project, sourceCanonicalName))
    .all();
  const rewrittenTaskUids: string[] = [];
  for (const taskRow of sourceTasks) {
    db.update(tasks)
      .set({ project: targetCanonicalName, updatedAt: timestamp })
      .where(eq(tasks.id, taskRow.id))
      .run();
    rewrittenTaskUids.push(taskRow.taskUid);
  }

  // -------- project_proposals.project --------
  const sourceProposals = db
    .select()
    .from(projectProposals)
    .where(eq(projectProposals.project, sourceCanonicalName))
    .all();
  const rewrittenProposalUids: string[] = [];
  for (const prop of sourceProposals) {
    db.update(projectProposals)
      .set({ project: targetCanonicalName, updatedAt: timestamp })
      .where(eq(projectProposals.id, prop.id))
      .run();
    rewrittenProposalUids.push(prop.proposalUid);
  }

  // -------- open_loops.project_uid --------
  const movedLoopUids = sourceLoops.map((loop) => loop.loopUid);
  if (movedLoopUids.length > 0) {
    db.update(openLoops)
      .set({ projectUid: targetRow.projectUid!, updatedAt: timestamp })
      .where(eq(openLoops.projectUid, sourceRow.projectUid!))
      .run();
  }

  // -------- delete source project row --------
  db.delete(projects).where(eq(projects.id, sourceRow.id)).run();

  logActivity(db, logsPath, {
    timestamp,
    sourceClient: decidedBy,
    project: targetCanonicalName,
    actionType: 'update',
    status: 'success',
    aiUsed: false,
    message: `Merged project "${sourceCanonicalName}" into "${targetCanonicalName}"`,
    metadata: {
      mergeKind: 'project_merge',
      sourceProject: sourceCanonicalName,
      targetProject: targetCanonicalName,
      movedItems: movedItemUids.length,
      filesRelocated,
      filesMissing,
      rewrittenRelationships: rewrittenRelationshipIds.length,
      removedRelationships: removedRelationshipIds.length,
      rewrittenTasks: rewrittenTaskUids.length,
      rewrittenProposals: rewrittenProposalUids.length,
      movedLoops: movedLoopUids.length,
    },
  });

  return {
    sourceProject: sourceCanonicalName,
    targetProject: targetCanonicalName,
    movedItemUids,
    filesRelocated,
    filesMissing,
    rewrittenRelationshipIds,
    removedRelationshipIds,
    rewrittenTaskUids,
    rewrittenProposalUids,
    movedLoopUids,
    sourceProjectDeleted: true,
  };
}

/**
 * Rewrite a vault path's project segment from sourceSlug to targetSlug, and
 * physically move the file when relocateFiles is true and the file exists.
 * Idempotent: if the file is already at the target path, returns moved=false
 * with the new path. Returns the original path unchanged if the source slug
 * marker is not present (e.g. shared/ items, custom paths).
 */
function relocateProjectFile(
  oldPath: string,
  sourceSlug: string,
  targetSlug: string,
  relocateFiles: boolean,
): { newPath: string; moved: boolean } {
  const normalizedOld = oldPath.replace(/\\/g, '/');
  const marker = `/projects/${sourceSlug}/`;
  const idx = normalizedOld.indexOf(marker);
  if (idx < 0) {
    return { newPath: oldPath, moved: false };
  }

  const newNormalized =
    normalizedOld.slice(0, idx)
    + `/projects/${targetSlug}/`
    + normalizedOld.slice(idx + marker.length);

  if (!relocateFiles) {
    return { newPath: newNormalized, moved: false };
  }

  if (!existsSync(normalizedOld)) {
    // File never existed on disk; rewrite the path anyway so the row points
    // into the merged project's tree.
    return { newPath: newNormalized, moved: false };
  }

  if (existsSync(newNormalized)) {
    // Don't overwrite a pre-existing file at the target. Keep the row pointing
    // at the original location for safety; caller can audit via filesMissing.
    return { newPath: oldPath, moved: false };
  }

  const targetDir = dirname(newNormalized);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  renameSync(normalizedOld, newNormalized);
  return { newPath: newNormalized, moved: true };
}

function mapProjectRow(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    name: row.name,
    slug: slugify(row.name),
    description: row.description,
    projectUid: row.projectUid,
    projectType: row.projectType === 'work_project' || row.projectType === 'brain_context'
      ? row.projectType
      : 'unclassified',
    lifecycleState: isProjectLifecycleState(row.lifecycleState) ? row.lifecycleState : null,
    authorizationPolicyId: row.authorizationPolicyId,
    evidencePolicyId: row.evidencePolicyId,
    classificationVersion: row.classificationVersion,
    classifiedByActorUid: row.classifiedByActorUid,
    classifiedAt: row.classifiedAt,
    version: row.version,
    canonicalRoot: row.canonicalRoot,
    repositoryUrl: row.repositoryUrl,
    defaultBranch: row.defaultBranch,
    ownerActorUid: row.ownerActorUid,
    ownerRole: row.ownerRole,
    memoryPurpose: row.memoryPurpose,
    typeConfig: parseProjectTypeConfig(row.typeConfigJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isProjectLifecycleState(
  value: string | null,
): value is NonNullable<Project['lifecycleState']> {
  return value === 'legacy_cleanup'
    || value === 'shadow'
    || value === 'gate_ready'
    || value === 'gate_active'
    || value === 'suspended';
}

function parseProjectTypeConfig(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function mapRelationshipRow(row: typeof projectRelationships.$inferSelect): ProjectRelationship {
  const linkType: ProjectLinkType = isProjectLinkType(row.linkType) ? row.linkType : 'related_to';
  return {
    id: row.id,
    sourceProject: row.sourceProject,
    targetProject: row.targetProject,
    linkType,
    note: row.note,
    confidence: row.confidence,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}
