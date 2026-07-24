import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const coreDir = resolve(desktopDir, '../core');
const betterSqlitePackage = require.resolve('better-sqlite3/package.json', {
  paths: [coreDir],
});
const nodeGypEntry = require.resolve('node-gyp/bin/node-gyp.js');
const electronVersion = require('electron/package.json').version;
const arch = process.env.npm_config_arch || process.arch;

const result = spawnSync(
  process.execPath,
  [
    nodeGypEntry,
    'rebuild',
    '--release',
    `--target=${electronVersion}`,
    `--arch=${arch}`,
    '--dist-url=https://electronjs.org/headers',
  ],
  {
    cwd: dirname(betterSqlitePackage),
    env: {
      ...process.env,
      npm_config_runtime: 'electron',
      npm_config_target: electronVersion,
      npm_config_arch: arch,
      npm_config_target_arch: arch,
      VAULT_BETTER_SQLITE3_NATIVE_BINDING: '',
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
