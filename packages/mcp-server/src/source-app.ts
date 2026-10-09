import type { SourceApp } from '@the-vault/core';

/**
 * Map the MCP client name from the initialize handshake (e.g. "claude-code",
 * "claude-ai", "codex-mcp-client") to a Vault source app. Agent writes always
 * come from some MCP client, so unknown clients are "other" rather than
 * "manual", which is reserved for writes a person makes in the desktop UI.
 */
export function detectSourceApp(clientName: string | undefined): SourceApp {
  const name = (clientName ?? '').toLowerCase();
  if (name.includes('claude')) return 'claude';
  if (name.includes('codex')) return 'codex';
  if (name.includes('openclaw')) return 'openclaw';
  return 'other';
}
