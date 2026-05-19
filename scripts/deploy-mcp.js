/**
 * Creates a standalone MCP server deployment with native modules compiled
 * for the system Node.js (not Electron's bundled Node).
 *
 * Why: electron-builder recompiles better-sqlite3 for Electron's ABI, but
 * the MCP server runs under the system Node which has a different ABI.
 * This script creates an isolated copy with its own node_modules so the
 * two don't conflict.
 */
import { execSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const standalone = resolve(root, 'mcp-standalone');

console.log('Deploying standalone MCP server...');

// 1. Clean previous deployment when possible. If a running MCP client has a
// handle open inside mcp-standalone, Windows can reject deleting the whole
// folder. In that case, refresh in place so the server is not left half-built.
let cleanInstall = true;
try {
  rmSync(standalone, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  mkdirSync(standalone, { recursive: true });
} catch (error) {
  cleanInstall = false;
  console.warn(
    'Could not remove existing mcp-standalone folder; refreshing in place. '
      + 'Stop running MCP clients before deploy for a fully clean install.',
  );
  console.warn(error instanceof Error ? error.message : String(error));
  mkdirSync(standalone, { recursive: true });
}

// 2. Create package.json with all runtime dependencies (merged from core + mcp-server).
//    npm install compiles better-sqlite3 for system Node in a flat node_modules.
const pkg = {
  name: 'vault-mcp-standalone',
  private: true,
  type: 'module',
  dependencies: {
    // From @the-vault/core
    'better-sqlite3': '^12.0.0',
    'drizzle-orm': '^0.45.2',
    'nanoid': '^5.1.0',
    'zod': '^3.24.0',
    'gray-matter': '^4.0.3',
    // From @the-vault/mcp-server
    '@modelcontextprotocol/sdk': '^1.12.0',
  },
};
writeFileSync(resolve(standalone, 'package.json'), JSON.stringify(pkg, null, 2));

// 3. Install dependencies (flat node_modules — avoids deep pnpm paths on Windows)
console.log('Installing dependencies (compiling native modules for system Node)...');
execSync('npm install --ignore-scripts=false', { cwd: standalone, stdio: 'inherit' });

// 4. Copy built workspace packages into node_modules
console.log('Copying workspace package builds...');

const coreTarget = resolve(standalone, 'node_modules/@the-vault/core');
const mcpDist = resolve(standalone, 'dist');
const bundledNodeName = process.platform === 'win32' ? 'node.exe' : 'node';
const bundledNodePath = resolve(standalone, bundledNodeName);

mkdirSync(coreTarget, { recursive: true });
ensureDirectory(mcpDist);

// Core package (needed by mcp-server at runtime)
copyIfDifferent(resolve(root, 'packages/core/dist'), resolve(coreTarget, 'dist'));
copyIfDifferent(resolve(root, 'packages/core/package.json'), resolve(coreTarget, 'package.json'));

// MCP server dist (entry point)
cpSync(resolve(root, 'packages/mcp-server/dist'), mcpDist, { recursive: true });

// Packaged desktop releases cannot assume users have Node.js installed. Copy
// the build-time Node binary beside the standalone MCP runtime so the installer
// can ship a complete stdio sidecar under app resources.
copyFileSync(process.execPath, bundledNodePath);
if (process.platform !== 'win32') {
  chmodSync(bundledNodePath, 0o755);
}

console.log('Standalone MCP server deployed to:', standalone);
console.log('Entry point:', resolve(mcpDist, 'index.js'));
console.log('Bundled Node runtime:', bundledNodePath);

if (!cleanInstall) {
  console.log('Deployment used in-place refresh because the previous standalone folder was locked.');
}

function ensureDirectory(path) {
  if (existsSync(path)) {
    const stat = statSync(path);
    if (stat.isFile()) {
      unlinkSync(path);
    }
  }
  mkdirSync(path, { recursive: true });
}

function copyIfDifferent(source, target) {
  if (existsSync(source) && existsSync(target)) {
    try {
      if (realpathSync(source) === realpathSync(target)) {
        return;
      }
    } catch {
      // Fall through and let cpSync surface a useful filesystem error.
    }
  }
  cpSync(source, target, { recursive: true });
}
