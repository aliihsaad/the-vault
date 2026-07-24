import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const expectedVersion = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8')).version;
const unpackedRoot = join(desktopDir, 'dist', 'win-unpacked');
const mcpRoot = join(unpackedRoot, 'resources', 'mcp');
const bundledNode = join(mcpRoot, 'node.exe');
const serverEntry = join(mcpRoot, 'dist', 'index.js');
const sdkRoot = join(mcpRoot, 'node_modules', '@modelcontextprotocol', 'sdk');
const nodePtyRoot = join(
  unpackedRoot,
  'resources',
  'app.asar.unpacked',
  'node_modules',
  'node-pty',
);
const fakeHome = mkdtempSync(join(tmpdir(), 'vault-packaged-runtime-'));
let child;

try {
  for (const [label, path] of [
    ['bundled MCP Node runtime', bundledNode],
    ['bundled MCP server entry', serverEntry],
    ['bundled MCP SDK', sdkRoot],
    ['unpacked node-pty package', nodePtyRoot],
  ]) {
    if (!existsSync(path)) {
      throw new Error(`Missing ${label}: ${path}`);
    }
  }

  const childEnv = {
    ...process.env,
    USERPROFILE: fakeHome,
    HOME: fakeHome,
    APPDATA: join(fakeHome, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(fakeHome, 'AppData', 'Local'),
  };
  delete childEnv.VAULT_BETTER_SQLITE3_NATIVE_BINDING;

  child = spawn(bundledNode, [serverEntry], {
    cwd: mcpRoot,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const responses = createJsonRpcResponseQueue(child);
  const initialize = await request(child, responses, 1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'vault-packaged-runtime-smoke',
      version: expectedVersion,
    },
  });
  if (!initialize.result) {
    throw new Error('Packaged MCP initialize response did not contain a result');
  }
  const serverVersion = initialize.result.serverInfo?.version;
  if (serverVersion !== expectedVersion) {
    throw new Error(`Packaged MCP version mismatch: expected ${expectedVersion}, received ${serverVersion || 'missing'}`);
  }

  send(child, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  });
  const toolsList = await request(child, responses, 2, 'tools/list', {});
  const tools = toolsList.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error('Packaged MCP tools/list returned no tools');
  }

  const databasePath = join(fakeHome, 'Vault', 'registry', 'vault.db');
  if (!existsSync(databasePath)) {
    throw new Error(`Packaged MCP did not create its sandbox database: ${databasePath}`);
  }

  const nodePty = require(nodePtyRoot);
  if (typeof nodePty.spawn !== 'function') {
    throw new Error('Packaged node-pty does not expose spawn()');
  }

  console.log(JSON.stringify({
    initializeResult: true,
    serverVersion,
    toolsCount: tools.length,
    databaseCreated: true,
    nodePtySpawnType: typeof nodePty.spawn,
    sandboxHome: fakeHome,
  }));
} finally {
  await stopChild(child);
  rmSync(fakeHome, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}

async function stopChild(processHandle) {
  if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) {
    return;
  }
  const exited = new Promise((resolveExit) => processHandle.once('exit', resolveExit));
  processHandle.stdin.end();
  processHandle.kill();
  await Promise.race([
    exited,
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
}

function send(processHandle, message) {
  processHandle.stdin.write(`${JSON.stringify(message)}\n`);
}

async function request(processHandle, responses, id, method, params) {
  const responsePromise = responses.waitFor(id);
  send(processHandle, { jsonrpc: '2.0', id, method, params });
  const response = await responsePromise;
  if (response.error) {
    throw new Error(`Packaged MCP ${method} failed: ${JSON.stringify(response.error)}`);
  }
  return response;
}

function createJsonRpcResponseQueue(processHandle) {
  const waiting = new Map();
  let stdoutBuffer = '';
  let stderrBuffer = '';

  processHandle.stdout.setEncoding('utf8');
  processHandle.stderr.setEncoding('utf8');
  processHandle.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        rejectAll(new Error(`Packaged MCP emitted non-JSON stdout: ${line}`));
        continue;
      }
      const pending = waiting.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        waiting.delete(message.id);
        pending.resolve(message);
      }
    }
  });
  processHandle.stderr.on('data', (chunk) => {
    stderrBuffer += chunk;
  });
  processHandle.on('error', (error) => rejectAll(error));
  processHandle.on('exit', (code, signal) => {
    if (waiting.size === 0) return;
    const detail = stderrBuffer.trim();
    rejectAll(new Error(
      `Packaged MCP exited before responding (code=${code}, signal=${signal})`
      + (detail ? `: ${detail}` : ''),
    ));
  });

  function rejectAll(error) {
    for (const pending of waiting.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    waiting.clear();
  }

  return {
    waitFor(id) {
      return new Promise((resolveResponse, rejectResponse) => {
        const timeout = setTimeout(() => {
          waiting.delete(id);
          rejectResponse(new Error(
            `Timed out waiting for packaged MCP response ${id}`
            + (stderrBuffer.trim() ? `: ${stderrBuffer.trim()}` : ''),
          ));
        }, 20_000);
        waiting.set(id, {
          resolve: resolveResponse,
          reject: rejectResponse,
          timeout,
        });
      });
    },
  };
}
