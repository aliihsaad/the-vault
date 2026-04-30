#!/usr/bin/env node
/**
 * One-command Vault MCP setup for local agent clients.
 *
 * This intentionally avoids requiring users to hand-edit JSON/TOML files:
 *   pnpm setup:mcp
 *
 * It builds the required packages, deploys the standalone MCP server, writes
 * client config entries, backs up existing config files, and verifies an MCP
 * initialize handshake.
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const mcpEntry = resolve(root, 'mcp-standalone', 'dist', 'index.js');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipBuild = args.has('--skip-build');
const skipDeploy = args.has('--skip-deploy');
const clientArg = getFlagValue('--client') || 'all';
const selectedClients = parseClients(clientArg);

main().catch((error) => {
  console.error(`\nSetup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

async function main() {
  console.log('Vault MCP setup');
  console.log(`Repository: ${root}`);
  console.log(`Clients: ${[...selectedClients].join(', ')}`);
  if (dryRun) console.log('Mode: dry run');

  if (!skipBuild) {
    run('pnpm', ['--filter', '@the-vault/core', 'build']);
    run('pnpm', ['--filter', '@the-vault/mcp-server', 'build']);
  }

  if (!skipDeploy) {
    run('node', ['scripts/deploy-mcp.js']);
  }

  assertFile(mcpEntry, 'MCP server entry point');
  await verifyMcpHandshake(mcpEntry);

  const results = [];
  if (selectedClients.has('claude-desktop')) {
    results.push(configureJsonClient(
      getClaudeDesktopConfigPath(),
      'Claude Desktop',
      ['mcpServers', 'vault-memory'],
      { command: 'node', args: [mcpEntry] },
    ));
  }

  if (selectedClients.has('claude-code')) {
    results.push(configureJsonClient(
      join(homedir(), '.claude', 'settings.json'),
      'Claude Code',
      ['mcpServers', 'vault-memory'],
      { command: 'node', args: [mcpEntry] },
    ));
  }

  if (selectedClients.has('codex')) {
    results.push(configureCodex(join(homedir(), '.codex', 'config.toml')));
  }

  console.log('\nSetup summary');
  for (const result of results) {
    console.log(`- ${result.label}: ${result.changed ? 'configured' : 'already configured'}${result.backupPath ? ` (backup: ${result.backupPath})` : ''}`);
  }
  console.log('\nRestart the client app or start a new CLI session so it launches the updated vault-memory server.');
}

function run(command, commandArgs) {
  console.log(`\n> ${command} ${commandArgs.join(' ')}`);
  if (dryRun) return;
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: platform() === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}`);
  }
}

function assertFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  console.log(`Found ${label}: ${filePath}`);
}

async function verifyMcpHandshake(entryPath) {
  console.log('\nVerifying MCP handshake...');
  if (dryRun) return;

  const initialize = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'vault-setup', version: '1.0.0' },
    },
  });
  const message = `Content-Length: ${Buffer.byteLength(initialize, 'utf8')}\r\n\r\n${initialize}`;

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('node', [entryPath], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error(`MCP handshake timed out. ${stderr.trim()}`));
    }, 8000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (stdout.includes('"serverInfo"') && stdout.includes('"vault-memory"')) {
        console.log('MCP handshake ok.');
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`MCP server exited before handshake completed (code ${code}). ${stderr.trim()}`));
    });

    child.stdin.write(`${message}\r\n`);
    child.stdin.end();
  });
}

function configureJsonClient(configPath, label, keyPath, entry) {
  const existing = readJsonConfig(configPath);
  const config = existing.data || {};
  const current = getNested(config, keyPath);
  const changed = JSON.stringify(current) !== JSON.stringify(entry);
  let backupPath;

  if (changed && existing.exists && !dryRun) {
    backupPath = `${configPath}.vault-backup-${Date.now()}`;
    copyFileSync(configPath, backupPath);
  }

  if (changed && !dryRun) {
    setNested(config, keyPath, entry);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }

  return { label, changed, backupPath };
}

function configureCodex(configPath) {
  const entry = buildCodexEntry();
  let content = '';
  const exists = existsSync(configPath);
  if (exists) {
    content = readFileSync(configPath, 'utf8');
  }

  const nextContent = `${removeCodexVaultEntry(content).trimEnd()}${content.trim() ? '\n\n' : ''}${entry}`;
  const changed = content.trimEnd() !== nextContent.trimEnd();
  let backupPath;

  if (changed && exists && !dryRun) {
    backupPath = `${configPath}.vault-backup-${Date.now()}`;
    copyFileSync(configPath, backupPath);
  }

  if (changed && !dryRun) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, nextContent, 'utf8');
  }

  return { label: 'Codex', changed, backupPath };
}

function buildCodexEntry() {
  return [
    '[mcp_servers.vault-memory]',
    'command = "node"',
    `args = [${JSON.stringify(mcpEntry)}]`,
    '',
  ].join('\n');
}

function removeCodexVaultEntry(content) {
  return content
    .replace(/\n*\[mcp_servers(?:\."vault-memory"|\.vault-memory)\]\n[\s\S]*?(?=\n\[|$)/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function readJsonConfig(configPath) {
  if (!existsSync(configPath)) {
    return { exists: false, data: null };
  }
  try {
    const data = JSON.parse(readFileSync(configPath, 'utf8'));
    return { exists: true, data };
  } catch (error) {
    throw new Error(`Could not parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function getNested(object, path) {
  return path.reduce((current, key) => current?.[key], object);
}

function setNested(object, path, value) {
  let current = object;
  for (const key of path.slice(0, -1)) {
    current[key] = current[key] || {};
    current = current[key];
  }
  current[path[path.length - 1]] = value;
}

function getClaudeDesktopConfigPath() {
  if (platform() === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

function parseClients(value) {
  const aliases = {
    all: ['claude-desktop', 'claude-code', 'codex'],
    claude: ['claude-desktop', 'claude-code'],
    'claude-desktop': ['claude-desktop'],
    'claude-code': ['claude-code'],
    codex: ['codex'],
  };
  const out = new Set();
  for (const raw of value.split(',')) {
    const key = raw.trim();
    const mapped = aliases[key];
    if (!mapped) {
      throw new Error(`Unknown client "${key}". Use all, claude, claude-desktop, claude-code, or codex.`);
    }
    for (const client of mapped) out.add(client);
  }
  return out;
}

function getFlagValue(name) {
  const argv = process.argv.slice(2);
  const exact = argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}
