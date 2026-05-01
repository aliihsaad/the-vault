// ============================================================================
// Vault — Save Service
// Implements the full save protocol (Section 12 of the master plan).
// ============================================================================

import { eq } from 'drizzle-orm';
import { memoryItems, tags as tagsTable } from '../database/schema.js';
import { generateItemUid, generateShortUid } from '../utils/uid.js';
import { now } from '../utils/datetime.js';
import { SaveMemoryInputSchema } from '../rules/validation.js';
import {
  buildVaultPath,
  normalizeOrderedValues,
  normalizeRelatedFiles,
  normalizeTagLikeValues,
  writeMemoryFile,
} from './file.service.js';
import {
  ensureProject,
  inferProjectNameFromRelatedFiles,
  relatedFilesContainProjectSlug,
} from './project.service.js';
import { logActivity } from './log.service.js';
import { isEnrichmentAvailable, enrichAfterSave } from './enrichment.service.js';
import { schedulePostSaveDuties } from './agent-duties.service.js';
import { updateMemory } from './retrieve.service.js';
import type { MemoryItem, SaveMemoryInput, SaveMemoryResult } from '../types/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

/**
 * Save a memory item to the registry and filesystem.
 *
 * Steps:
 * 1. Validate input
 * 2. Generate UID
 * 3. Normalize tags
 * 4. Generate vault path
 * 5. Write Markdown file
 * 6. Insert DB record
 * 7. Ensure project exists
 * 8. Register new tags
 * 9. Log the save
 * 10. Return result
 */
export function saveMemory(
  db: DB,
  vaultRoot: string,
  logsPath: string,
  input: SaveMemoryInput,
): SaveMemoryResult {
  const startTime = Date.now();

  // 1. Validate input
  const validated = SaveMemoryInputSchema.parse(input);

  // 2. Generate UID
  const itemUid = generateItemUid();
  const shortUid = generateShortUid();

  // 3. Normalize tags (lowercase, trim)
  const normalizedRelatedFiles = normalizeRelatedFiles(validated.relatedFiles || []);

  // Resolve project to its canonical name first so casing/slug variants
  // collapse before any path is built or row is inserted. If absolute related
  // file paths point at exactly one known project folder and the requested
  // project is absent from those paths, prefer the file-derived project. This
  // prevents stale agent context from saving work under an unrelated project.
  const trimmedProject = validated.project.trim();
  const requestedProject = ensureProject(db, vaultRoot, trimmedProject);
  const relatedFileProject = inferProjectNameFromRelatedFiles(db, normalizedRelatedFiles);
  const normalizedProject =
    relatedFileProject && !relatedFilesContainProjectSlug(normalizedRelatedFiles, requestedProject)
      ? relatedFileProject
      : requestedProject;
  const normalizedTitle = validated.title.trim();
  const normalizedSubject = validated.subject.trim();
  const normalizedSummary = validated.summary.trim();
  const normalizedContent = validated.content?.trim() || null;
  const normalizedTags = normalizeTagLikeValues(validated.tags || []);
  const normalizedKeywords = normalizeTagLikeValues(validated.keywords || []);
  const normalizedNextSteps = normalizeOrderedValues(validated.nextSteps || []);
  const normalizedRelatedItemIds = normalizeOrderedValues(validated.relatedItemIds || []);

  // 4. Generate vault path
  const timestamp = now();
  const vaultPath = buildVaultPath(
    vaultRoot,
    normalizedProject,
    validated.memoryType,
    normalizedTitle,
    shortUid,
    timestamp,
  );

  // Build the memory item
  const item: MemoryItem = {
    id: 0, // Will be set by DB
    itemUid,
    title: normalizedTitle,
    project: normalizedProject,
    sourceApp: validated.sourceApp || 'manual',
    sourceSessionId: validated.sourceSessionId || null,
    memoryType: validated.memoryType,
    subject: normalizedSubject,
    summary: normalizedSummary,
    content: normalizedContent,
    keywords: normalizedKeywords,
    tags: normalizedTags,
    routineType: validated.routineType || null,
    status: validated.status || 'active',
    priority: validated.priority || 'normal',
    promoted: false,
    nextSteps: normalizedNextSteps,
    relatedItemIds: normalizedRelatedItemIds,
    relatedFiles: normalizedRelatedFiles,
    vaultPath,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAccessedAt: null,
    accessCount: 0,
  };

  // 5. Write Markdown file
  writeMemoryFile(vaultPath, item);

  // 6. Insert DB record
  db.insert(memoryItems)
    .values({
      itemUid,
      title: item.title,
      project: item.project,
      sourceApp: item.sourceApp,
      sourceSessionId: item.sourceSessionId,
      memoryType: item.memoryType,
      subject: item.subject,
      summary: item.summary,
      content: item.content,
      keywordsJson: JSON.stringify(item.keywords),
      tagsJson: JSON.stringify(item.tags),
      routineType: item.routineType,
      status: item.status,
      priority: item.priority,
      promoted: item.promoted,
      nextStepsJson: JSON.stringify(item.nextSteps),
      relatedItemIdsJson: JSON.stringify(item.relatedItemIds),
      relatedFilesJson: JSON.stringify(item.relatedFiles),
      vaultPath: item.vaultPath,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      lastAccessedAt: item.lastAccessedAt,
      accessCount: item.accessCount,
    })
    .run();

  // Get the inserted ID
  const inserted = db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.itemUid, itemUid))
    .get();
  if (inserted) {
    item.id = inserted.id;
  }

  // 7. Project already ensured above (step 3) so its directory tree exists
  // and the canonical name is in use throughout this save.

  // 8. Register new tags
  for (const tag of normalizedTags) {
    const existing = db
      .select()
      .from(tagsTable)
      .where(eq(tagsTable.normalizedName, tag))
      .get();
    if (!existing) {
      db.insert(tagsTable)
        .values({
          name: tag,
          normalizedName: tag,
          category: null,
          createdAt: timestamp,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  // 9. Log the save
  const latencyMs = Date.now() - startTime;
  logActivity(db, logsPath, {
    sourceClient: item.sourceApp,
    project: item.project,
    actionType: 'save',
    targetItemId: itemUid,
    status: 'success',
    latencyMs,
    message: `Saved: ${item.title}`,
  });

  // 10. Schedule AI enrichment (fire-and-forget)
  if (isEnrichmentAvailable()) {
    enrichAfterSave(item, (uid, updates) =>
      updateMemory(db, vaultRoot, logsPath, uid, updates),
    ).catch(() => {
      // Silent — enrichment failure must never surface
    });
  }

  void schedulePostSaveDuties(db, logsPath, item, { vaultRoot }).catch(() => {
    // Silent — duty scheduling must never block saves
  });

  // 11. Return result
  return {
    success: true,
    item,
    vaultPath,
    message: `Memory saved: "${item.title}" (${itemUid})`,
  };
}
