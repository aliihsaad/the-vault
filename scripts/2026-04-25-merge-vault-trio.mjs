// ============================================================================
// One-off: Layer 2 step 3 cleanup pass (self-contained)
//   1. Merge `vault`         -> `the-vault`
//   2. Merge `vault-memory`  -> `the-vault`
//   3. Add whisphr -> whisphry predecessor_of relationship
//
// Self-contained because the running MCP server has the project's
// better-sqlite3 .node loaded for a different Node version. We use an
// isolated copy from scripts/_oneoff_deps and execute the merge logic
// directly via raw SQL, mirroring packages/core/src/services/project.service.ts.
// ============================================================================

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('./_oneoff_deps/node_modules/better-sqlite3');

const VAULT_ROOT = 'C:\\Users\\Mini\\Vault';
const DB_PATH = join(VAULT_ROOT, 'registry', 'vault.db');
const PROJECT_SUBDIRS = [
  'sessions', 'summaries', 'decisions', 'plans',
  'artifacts', 'references', 'handoffs', 'archive',
];

function slugify(text) {
  const slug = text.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'memory';
}

function nowIso() {
  return new Date().toISOString();
}

function ensureProjectDirs(slug) {
  const root = join(VAULT_ROOT, 'projects', slug);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  for (const sub of PROJECT_SUBDIRS) {
    const p = join(root, sub);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

function findProjectBySlug(db, name) {
  const target = slugify(name);
  const rows = db.prepare('SELECT * FROM projects').all();
  return rows.find((r) => slugify(r.name) === target) ?? null;
}

function ensureProject(db, name) {
  const existing = findProjectBySlug(db, name);
  if (existing) {
    ensureProjectDirs(slugify(existing.name));
    return existing.name;
  }
  const ts = nowIso();
  db.prepare(
    'INSERT INTO projects (name, description, created_at, updated_at) VALUES (?, NULL, ?, ?)'
  ).run(name, ts, ts);
  ensureProjectDirs(slugify(name));
  return name;
}

function relocateProjectFile(oldPath, sourceSlug, targetSlug) {
  if (!oldPath) return { newPath: oldPath, moved: false, missing: false };
  const normalizedOld = oldPath.replace(/\\/g, '/');
  const marker = `/projects/${sourceSlug}/`;
  const idx = normalizedOld.indexOf(marker);
  if (idx < 0) return { newPath: oldPath, moved: false, missing: false };

  const newPath =
    normalizedOld.slice(0, idx) +
    `/projects/${targetSlug}/` +
    normalizedOld.slice(idx + marker.length);

  if (!existsSync(normalizedOld)) {
    return { newPath, moved: false, missing: true };
  }
  if (existsSync(newPath)) {
    // refuse to overwrite — keep the source pointer for audit
    return { newPath: oldPath, moved: false, missing: true };
  }
  const targetDir = dirname(newPath);
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  renameSync(normalizedOld, newPath);
  return { newPath, moved: true, missing: false };
}

function logActivity(db, project, message, metadata) {
  const ts = nowIso();
  db.prepare(
    `INSERT INTO activity_logs
       (timestamp, source_client, project, action_type, target_item_id,
        status, latency_ms, ai_used, message, metadata_json)
     VALUES (?, ?, ?, ?, NULL, ?, NULL, 0, ?, ?)`
  ).run(
    ts,
    'one-off-2026-04-25',
    project,
    'update',
    'success',
    message,
    JSON.stringify(metadata),
  );
}

function mergeProject(db, sourceName, targetName) {
  const sourceRow = findProjectBySlug(db, sourceName);
  if (!sourceRow) {
    return { skipped: true, reason: `source "${sourceName}" not found` };
  }
  if (slugify(sourceRow.name) === slugify(targetName)) {
    throw new Error(`Cannot merge project into itself: ${sourceRow.name}`);
  }
  const targetCanonical = ensureProject(db, targetName);
  const sourceCanonical = sourceRow.name;
  const sourceSlug = slugify(sourceCanonical);
  const targetSlug = slugify(targetCanonical);
  ensureProjectDirs(targetSlug);

  const ts = nowIso();
  const result = {
    sourceProject: sourceCanonical,
    targetProject: targetCanonical,
    movedItemUids: [],
    filesRelocated: 0,
    filesMissing: 0,
    rewrittenRelationshipIds: [],
    removedRelationshipIds: [],
    rewrittenTaskUids: [],
    rewrittenProposalUids: [],
    sourceProjectDeleted: false,
  };

  const trx = db.transaction(() => {
    // memory_items
    const items = db.prepare(
      'SELECT id, item_uid, vault_path FROM memory_items WHERE project = ?'
    ).all(sourceCanonical);
    const updItem = db.prepare(
      'UPDATE memory_items SET project = ?, vault_path = ?, updated_at = ? WHERE id = ?'
    );
    for (const it of items) {
      let nextPath = it.vault_path;
      if (it.vault_path) {
        const r = relocateProjectFile(it.vault_path, sourceSlug, targetSlug);
        nextPath = r.newPath;
        if (r.moved) result.filesRelocated += 1;
        else if (r.missing) result.filesMissing += 1;
      }
      updItem.run(targetCanonical, nextPath, ts, it.id);
      result.movedItemUids.push(it.item_uid);
    }

    // project_relationships — rewire, drop self-loops + dups
    const rels = db.prepare(
      `SELECT * FROM project_relationships
       WHERE source_project = ? OR target_project = ?`
    ).all(sourceCanonical, sourceCanonical);
    const findDupRel = db.prepare(
      `SELECT id FROM project_relationships
       WHERE source_project = ? AND target_project = ? AND link_type = ?`
    );
    const delRel = db.prepare('DELETE FROM project_relationships WHERE id = ?');
    const updRel = db.prepare(
      'UPDATE project_relationships SET source_project = ?, target_project = ? WHERE id = ?'
    );
    for (const rel of rels) {
      const newSource = rel.source_project === sourceCanonical
        ? targetCanonical : rel.source_project;
      const newTarget = rel.target_project === sourceCanonical
        ? targetCanonical : rel.target_project;
      if (newSource === newTarget) {
        delRel.run(rel.id);
        result.removedRelationshipIds.push(rel.id);
        continue;
      }
      const dup = findDupRel.get(newSource, newTarget, rel.link_type);
      if (dup && dup.id !== rel.id) {
        delRel.run(rel.id);
        result.removedRelationshipIds.push(rel.id);
        continue;
      }
      updRel.run(newSource, newTarget, rel.id);
      result.rewrittenRelationshipIds.push(rel.id);
    }

    // tasks
    const taskRows = db.prepare(
      'SELECT id, task_uid FROM tasks WHERE project = ?'
    ).all(sourceCanonical);
    const updTask = db.prepare(
      'UPDATE tasks SET project = ?, updated_at = ? WHERE id = ?'
    );
    for (const t of taskRows) {
      updTask.run(targetCanonical, ts, t.id);
      result.rewrittenTaskUids.push(t.task_uid);
    }

    // project_proposals
    const propRows = db.prepare(
      'SELECT id, proposal_uid FROM project_proposals WHERE project = ?'
    ).all(sourceCanonical);
    const updProp = db.prepare(
      'UPDATE project_proposals SET project = ?, updated_at = ? WHERE id = ?'
    );
    for (const p of propRows) {
      updProp.run(targetCanonical, ts, p.id);
      result.rewrittenProposalUids.push(p.proposal_uid);
    }

    // delete source row
    db.prepare('DELETE FROM projects WHERE id = ?').run(sourceRow.id);
    result.sourceProjectDeleted = true;

    logActivity(
      db,
      targetCanonical,
      `Merged project "${sourceCanonical}" into "${targetCanonical}"`,
      {
        mergeKind: 'project_merge',
        sourceProject: sourceCanonical,
        targetProject: targetCanonical,
        movedItems: result.movedItemUids.length,
        filesRelocated: result.filesRelocated,
        filesMissing: result.filesMissing,
        rewrittenRelationships: result.rewrittenRelationshipIds.length,
        removedRelationships: result.removedRelationshipIds.length,
        rewrittenTasks: result.rewrittenTaskUids.length,
        rewrittenProposals: result.rewrittenProposalUids.length,
      },
    );
  });
  trx();
  return result;
}

function addProjectRelationship(db, sourceName, targetName, linkType, note, createdBy) {
  const sourceCanonical = ensureProject(db, sourceName);
  const targetCanonical = ensureProject(db, targetName);
  if (slugify(sourceCanonical) === slugify(targetCanonical)) {
    throw new Error('Source and target slugify to the same project');
  }
  const existing = db.prepare(
    `SELECT id FROM project_relationships
     WHERE source_project = ? AND target_project = ? AND link_type = ?`
  ).get(sourceCanonical, targetCanonical, linkType);
  if (existing) {
    return { id: existing.id, created: false };
  }
  const ts = nowIso();
  const info = db.prepare(
    `INSERT INTO project_relationships
       (source_project, target_project, link_type, note, confidence, created_by, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`
  ).run(sourceCanonical, targetCanonical, linkType, note ?? null, createdBy, ts);
  return { id: Number(info.lastInsertRowid), created: true };
}

// ----------------------------------------------------------------------------

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Ensure Layer 2 tables exist (running MCP server may predate them).
db.exec(`
  CREATE TABLE IF NOT EXISTS project_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_project TEXT NOT NULL,
    target_project TEXT NOT NULL,
    link_type TEXT NOT NULL,
    note TEXT,
    confidence INTEGER,
    created_by TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_project_relationships_source ON project_relationships(source_project);
  CREATE INDEX IF NOT EXISTS idx_project_relationships_target ON project_relationships(target_project);
  CREATE INDEX IF NOT EXISTS idx_project_relationships_link_type ON project_relationships(link_type);

  CREATE TABLE IF NOT EXISTS project_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_uid TEXT UNIQUE NOT NULL,
    project TEXT NOT NULL,
    proposal_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    rationale TEXT,
    confidence INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    source_task_uid TEXT,
    evidence_item_uids_json TEXT NOT NULL DEFAULT '[]',
    created_by TEXT NOT NULL DEFAULT 'agent',
    decided_by TEXT,
    decided_at TEXT,
    decision_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_project_proposals_project ON project_proposals(project);
  CREATE INDEX IF NOT EXISTS idx_project_proposals_status ON project_proposals(status);
  CREATE INDEX IF NOT EXISTS idx_project_proposals_proposal_type ON project_proposals(proposal_type);
  CREATE INDEX IF NOT EXISTS idx_project_proposals_created_at ON project_proposals(created_at);
`);

function header(label) {
  console.log(`\n=== ${label} ===`);
}

function listProjectsWithCounts() {
  return db.prepare(
    `SELECT p.name,
            (SELECT COUNT(*) FROM memory_items mi WHERE mi.project = p.name) AS items
       FROM projects p
   ORDER BY p.name`
  ).all();
}

function printResult(r) {
  if (r.skipped) {
    console.log(`  skip: ${r.reason}`);
    return;
  }
  console.log(`  source -> target:    ${r.sourceProject} -> ${r.targetProject}`);
  console.log(`  moved items:         ${r.movedItemUids.length}`);
  console.log(`  files relocated:     ${r.filesRelocated}`);
  console.log(`  files missing:       ${r.filesMissing}`);
  console.log(`  rels rewritten:      ${r.rewrittenRelationshipIds.length}`);
  console.log(`  rels removed (dup):  ${r.removedRelationshipIds.length}`);
  console.log(`  tasks rewritten:     ${r.rewrittenTaskUids.length}`);
  console.log(`  proposals rewritten: ${r.rewrittenProposalUids.length}`);
  console.log(`  source row deleted:  ${r.sourceProjectDeleted}`);
}

header('Before');
for (const row of listProjectsWithCounts()) {
  console.log(`  ${row.name} (${row.items})`);
}

header('Merge: vault -> the-vault');
printResult(mergeProject(db, 'vault', 'the-vault'));

header('Merge: vault-memory -> the-vault');
printResult(mergeProject(db, 'vault-memory', 'the-vault'));

header('Relationship: whisphr -predecessor_of-> whisphry');
try {
  const r = addProjectRelationship(
    db,
    'whisphr',
    'whisphry',
    'predecessor_of',
    'whisphr was the former identity of whisphry (interview-assistant lineage)',
    'user',
  );
  console.log(`  ${r.created ? 'created' : 'already exists'}: id=${r.id}`);
} catch (err) {
  console.error(`  FAILED: ${err?.message || err}`);
}

header('After');
for (const row of listProjectsWithCounts()) {
  console.log(`  ${row.name} (${row.items})`);
}

header('the-vault relationships');
for (const r of db.prepare(
  `SELECT source_project, target_project, link_type FROM project_relationships
    WHERE source_project = ? OR target_project = ?`
).all('the-vault', 'the-vault')) {
  console.log(`  ${r.source_project} -${r.link_type}-> ${r.target_project}`);
}

header('whisphry relationships');
for (const r of db.prepare(
  `SELECT source_project, target_project, link_type FROM project_relationships
    WHERE source_project = ? OR target_project = ?`
).all('whisphry', 'whisphry')) {
  console.log(`  ${r.source_project} -${r.link_type}-> ${r.target_project}`);
}

db.close();
console.log('\nDone.');
