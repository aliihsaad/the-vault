// One-off: merge `Whisphry` (8 items) into `whisphry` (81 items).
// Uses EXACT-name lookup for source so we don't ambiguously hit the same-slug row.

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const Database = require('./_oneoff_deps/node_modules/better-sqlite3');

const VAULT_ROOT = 'C:\\Users\\Mini\\Vault';
const DB_PATH = join(VAULT_ROOT, 'registry', 'vault.db');
const PROJECT_SUBDIRS = ['sessions','summaries','decisions','plans','artifacts','references','handoffs','archive'];

function slugify(t) {
  return (t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0,60)) || 'memory';
}
function nowIso() { return new Date().toISOString(); }
function ensureDirs(slug) {
  const root = join(VAULT_ROOT, 'projects', slug);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  for (const s of PROJECT_SUBDIRS) {
    const p = join(root, s);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}
function relocate(oldPath, srcSlug, tgtSlug) {
  if (!oldPath) return { newPath: oldPath, moved: false, missing: false };
  const norm = oldPath.replace(/\\/g, '/');
  const marker = `/projects/${srcSlug}/`;
  const idx = norm.indexOf(marker);
  if (idx < 0) return { newPath: oldPath, moved: false, missing: false };
  const newPath = norm.slice(0, idx) + `/projects/${tgtSlug}/` + norm.slice(idx + marker.length);
  if (!existsSync(norm)) return { newPath, moved: false, missing: true };
  if (existsSync(newPath)) return { newPath: oldPath, moved: false, missing: true };
  const td = dirname(newPath);
  if (!existsSync(td)) mkdirSync(td, { recursive: true });
  renameSync(norm, newPath);
  return { newPath, moved: true, missing: false };
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SOURCE = 'Whisphry';   // 8-item, capital W
const TARGET = 'whisphry';   // 81-item, lowercase

const sourceRow = db.prepare('SELECT * FROM projects WHERE name = ?').get(SOURCE);
const targetRow = db.prepare('SELECT * FROM projects WHERE name = ?').get(TARGET);
if (!sourceRow) { console.error(`No source row named "${SOURCE}"`); process.exit(1); }
if (!targetRow) { console.error(`No target row named "${TARGET}"`); process.exit(1); }
console.log(`Merging "${sourceRow.name}" -> "${targetRow.name}"`);

const sourceSlug = slugify(sourceRow.name);
const targetSlug = slugify(targetRow.name);
ensureDirs(targetSlug);
const ts = nowIso();

const stats = { moved: 0, relocated: 0, missing: 0, rels: 0, relsRemoved: 0, tasks: 0, props: 0 };

const trx = db.transaction(() => {
  const items = db.prepare('SELECT id,item_uid,vault_path FROM memory_items WHERE project = ?').all(sourceRow.name);
  const upd = db.prepare('UPDATE memory_items SET project = ?, vault_path = ?, updated_at = ? WHERE id = ?');
  for (const it of items) {
    let np = it.vault_path;
    if (it.vault_path) {
      const r = relocate(it.vault_path, sourceSlug, targetSlug);
      np = r.newPath;
      if (r.moved) stats.relocated += 1;
      else if (r.missing) stats.missing += 1;
    }
    upd.run(targetRow.name, np, ts, it.id);
    stats.moved += 1;
  }

  const rels = db.prepare(
    'SELECT * FROM project_relationships WHERE source_project = ? OR target_project = ?'
  ).all(sourceRow.name, sourceRow.name);
  const findDup = db.prepare(
    'SELECT id FROM project_relationships WHERE source_project = ? AND target_project = ? AND link_type = ?'
  );
  const delRel = db.prepare('DELETE FROM project_relationships WHERE id = ?');
  const updRel = db.prepare('UPDATE project_relationships SET source_project = ?, target_project = ? WHERE id = ?');
  for (const r of rels) {
    const ns = r.source_project === sourceRow.name ? targetRow.name : r.source_project;
    const nt = r.target_project === sourceRow.name ? targetRow.name : r.target_project;
    if (ns === nt) { delRel.run(r.id); stats.relsRemoved += 1; continue; }
    const dup = findDup.get(ns, nt, r.link_type);
    if (dup && dup.id !== r.id) { delRel.run(r.id); stats.relsRemoved += 1; continue; }
    updRel.run(ns, nt, r.id); stats.rels += 1;
  }

  const taskRows = db.prepare('SELECT id FROM tasks WHERE project = ?').all(sourceRow.name);
  const updTask = db.prepare('UPDATE tasks SET project = ?, updated_at = ? WHERE id = ?');
  for (const t of taskRows) { updTask.run(targetRow.name, ts, t.id); stats.tasks += 1; }

  const propRows = db.prepare('SELECT id FROM project_proposals WHERE project = ?').all(sourceRow.name);
  const updProp = db.prepare('UPDATE project_proposals SET project = ?, updated_at = ? WHERE id = ?');
  for (const p of propRows) { updProp.run(targetRow.name, ts, p.id); stats.props += 1; }

  db.prepare('DELETE FROM projects WHERE id = ?').run(sourceRow.id);

  db.prepare(
    `INSERT INTO activity_logs (timestamp, source_client, project, action_type, target_item_id, status, latency_ms, ai_used, message, metadata_json)
     VALUES (?, ?, ?, 'update', NULL, 'success', NULL, 0, ?, ?)`
  ).run(
    ts,
    'one-off-2026-04-25',
    targetRow.name,
    `Merged casing duplicate "${sourceRow.name}" into "${targetRow.name}"`,
    JSON.stringify({ mergeKind: 'project_merge', sourceProject: sourceRow.name, targetProject: targetRow.name, ...stats }),
  );
});
trx();

console.log('Stats:', stats);

console.log('\nProjects after:');
for (const p of db.prepare(
  `SELECT name, (SELECT COUNT(*) FROM memory_items WHERE project = projects.name) AS items
     FROM projects ORDER BY name`
).all()) {
  console.log(`  ${p.name} (${p.items})`);
}
db.close();
