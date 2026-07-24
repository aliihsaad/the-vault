// electron-builder afterPack hook.
//
// electron-builder 26 excludes `node_modules` from `extraResources` copies, so
// the bundled MCP sidecar (resources/mcp) ships without its dependencies and
// cannot start. This hook copies the standalone sidecar's flat, Node-ABI
// `node_modules` into the packed resources before the installer is assembled,
// so the shipped app can spawn the sidecar with its own bundled node.exe.
const { cpSync, existsSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');

exports.default = async function afterPack(context) {
  const sidecarModules = resolve(__dirname, '..', '..', '..', 'mcp-standalone', 'node_modules');
  const dest = join(context.appOutDir, 'resources', 'mcp', 'node_modules');

  if (!existsSync(sidecarModules)) {
    throw new Error(`[after-pack] MCP sidecar node_modules not found at ${sidecarModules}`);
  }
  mkdirSync(dest, { recursive: true });
  cpSync(sidecarModules, dest, { recursive: true, dereference: true });

  // Fail loudly if the critical dependency did not make it across.
  if (!existsSync(join(dest, '@modelcontextprotocol', 'sdk'))) {
    throw new Error('[after-pack] MCP SDK missing after sidecar node_modules copy');
  }
  console.log(`[after-pack] copied MCP sidecar node_modules -> ${dest}`);
};
