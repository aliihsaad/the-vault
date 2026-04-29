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
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const standalone = resolve(root, 'mcp-standalone');

console.log('Deploying standalone MCP server...');

// 1. Clean previous deployment
rmSync(standalone, { recursive: true, force: true });
mkdirSync(standalone, { recursive: true });

// 2. Create package.json with all runtime dependencies (merged from core + mcp-server).
//    npm install compiles better-sqlite3 for system Node in a flat node_modules.
const pkg = {
  name: 'vault-mcp-standalone',
  private: true,
  type: 'module',
  dependencies: {
    // From @the-vault/core
    'better-sqlite3': '^12.0.0',
    'drizzle-orm': '^0.39.0',
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

mkdirSync(coreTarget, { recursive: true });
mkdirSync(mcpDist, { recursive: true });

// Core package (needed by mcp-server at runtime)
cpSync(resolve(root, 'packages/core/dist'), resolve(coreTarget, 'dist'), { recursive: true });
cpSync(resolve(root, 'packages/core/package.json'), resolve(coreTarget, 'package.json'));

// MCP server dist (entry point)
cpSync(resolve(root, 'packages/mcp-server/dist'), mcpDist, { recursive: true });

console.log('Standalone MCP server deployed to:', standalone);
console.log('Entry point:', resolve(mcpDist, 'index.js'));
