import { describe, expect, it } from 'vitest';
import { detectSourceApp } from './source-app.js';

describe('detectSourceApp', () => {
  it('maps known MCP client names from the initialize handshake', () => {
    expect(detectSourceApp('claude-code')).toBe('claude');
    expect(detectSourceApp('claude-ai')).toBe('claude');
    expect(detectSourceApp('Claude Desktop')).toBe('claude');
    expect(detectSourceApp('codex-mcp-client')).toBe('codex');
    expect(detectSourceApp('openclaw')).toBe('openclaw');
  });

  it('recognises the Claude desktop app clients', () => {
    // Code-tab / agent-mode sessions name the client "local-agent-mode-<server>" (seen live).
    expect(detectSourceApp('local-agent-mode-vault-memory')).toBe('claude');
    expect(detectSourceApp('custom3p-main')).toBe('claude');
  });

  it('labels other or missing clients as other, never manual', () => {
    expect(detectSourceApp('cursor-vscode')).toBe('other');
    expect(detectSourceApp(undefined)).toBe('other');
  });
});
