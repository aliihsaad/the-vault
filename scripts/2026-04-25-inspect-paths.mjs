import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
const Database = require('./_oneoff_deps/node_modules/better-sqlite3');

const db = new Database('C:\\Users\\Mini\\Vault\\registry\\vault.db');

// Sample paths of items whose project is now 'the-vault' but came from old 'Vault'
const rows = db.prepare(
  `SELECT item_uid, project, vault_path
   FROM memory_items
   WHERE project = 'the-vault'
     AND (vault_path LIKE '%/projects/vault/%'
       OR vault_path LIKE '%\\projects\\vault\\%'
       OR vault_path LIKE '%/projects/Vault/%'
       OR vault_path LIKE '%\\projects\\Vault\\%')
   LIMIT 10`
).all();
console.log('Items with vault paths still pointing at old Vault dir:');
for (const r of rows) {
  console.log(`  ${r.item_uid}  exists=${existsSync(r.vault_path)} path=${r.vault_path}`);
}

console.log('\nDistinct path-prefix samples for the-vault items:');
const all = db.prepare(
  `SELECT vault_path FROM memory_items WHERE project = 'the-vault'`
).all();
const prefixes = new Set();
for (const r of all) {
  if (!r.vault_path) continue;
  const norm = r.vault_path.replace(/\\/g, '/');
  const m = norm.match(/^(.*?\/projects\/[^/]+\/)/);
  if (m) prefixes.add(m[1]);
}
for (const p of [...prefixes].sort()) console.log('  ' + p);

console.log('\nWhisphry / whisphry split:');
for (const p of db.prepare(
  `SELECT name, (SELECT COUNT(*) FROM memory_items WHERE project = projects.name) AS items
     FROM projects WHERE LOWER(name) LIKE '%whisph%' ORDER BY name`
).all()) {
  console.log(`  ${p.name} (${p.items})`);
}
db.close();
