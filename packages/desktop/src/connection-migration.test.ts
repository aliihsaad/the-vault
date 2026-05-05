import { describe, expect, it } from 'vitest';

import {
  hasAnyMcpEntry,
  mcpEntriesMatch,
  shouldAutoConnectJsonMcp,
  shouldAutoInstallClaudeSkill,
  type McpLaunchConfig,
} from '../electron/connection-migration.js';

const launchConfig: McpLaunchConfig = {
  command: 'C:\\Program Files\\The Vault\\resources\\mcp\\node.exe',
  args: ['C:\\Program Files\\The Vault\\resources\\mcp\\dist\\index.js'],
};

describe('connection migration decisions', () => {
  it('detects matching and non-matching MCP entries', () => {
    expect(mcpEntriesMatch({ command: launchConfig.command, args: launchConfig.args }, launchConfig)).toBe(true);
    expect(mcpEntriesMatch({ command: 'node', args: ['old.js'] }, launchConfig)).toBe(false);
    expect(mcpEntriesMatch(null, launchConfig)).toBe(false);
  });

  it('detects existing Vault MCP entries without requiring the current path', () => {
    expect(hasAnyMcpEntry({ mcpServers: { 'vault-memory': { command: 'node', args: ['old.js'] } } })).toBe(true);
    expect(hasAnyMcpEntry({ mcpServers: {} })).toBe(false);
    expect(hasAnyMcpEntry(null)).toBe(false);
  });

  it('auto-connects stale JSON MCP entries but leaves untouched clients alone', () => {
    expect(shouldAutoConnectJsonMcp({
      currentConfig: { mcpServers: { 'vault-memory': { command: 'node', args: ['old.js'] } } },
      launchConfig,
    })).toBe(true);

    expect(shouldAutoConnectJsonMcp({
      currentConfig: { mcpServers: {} },
      launchConfig,
    })).toBe(false);
  });

  it('auto-connects Claude Code when only the v0.2.0 legacy settings entry exists', () => {
    expect(shouldAutoConnectJsonMcp({
      currentConfig: {},
      legacyConfig: { mcpServers: { 'vault-memory': { command: 'node', args: ['broken-v0.2.0.js'] } } },
      launchConfig,
    })).toBe(true);
  });

  it('does not auto-connect when the current MCP entry is already correct', () => {
    expect(shouldAutoConnectJsonMcp({
      currentConfig: { mcpServers: { 'vault-memory': { command: launchConfig.command, args: launchConfig.args } } },
      legacyConfig: { mcpServers: { 'vault-memory': { command: 'node', args: ['old.js'] } } },
      launchConfig,
    })).toBe(false);
  });

  it('installs Claude SKILL.md only for legacy references or stale installed skills', () => {
    expect(shouldAutoInstallClaudeSkill({
      bundledSkillContent: 'current skill',
      installedSkillContent: null,
      claudeInstructionsContent: '## Vault Memory Skill\nSee claude-vault-skill.md',
    })).toBe(true);

    expect(shouldAutoInstallClaudeSkill({
      bundledSkillContent: 'current skill',
      installedSkillContent: 'old skill',
      claudeInstructionsContent: '',
    })).toBe(true);

    expect(shouldAutoInstallClaudeSkill({
      bundledSkillContent: 'current skill',
      installedSkillContent: null,
      claudeInstructionsContent: '',
    })).toBe(false);

    expect(shouldAutoInstallClaudeSkill({
      bundledSkillContent: 'current skill',
      installedSkillContent: 'current skill',
      claudeInstructionsContent: '## Vault Memory Skill',
    })).toBe(false);
  });
});
