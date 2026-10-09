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

  it('recognises the Claude desktop app, whose MCP host client is named custom3p-main', () => {
    expect(detectSourceApp('custom3p-main')).toBe('claude');
  });

  it('labels other or missing clients as other, never manual', () => {
    expect(detectSourceApp('cursor-vscode')).toBe('other');
    expect(detectSourceApp(undefined)).toBe('other');
  });
});
