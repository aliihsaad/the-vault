export type McpLaunchConfig = {
  command: string;
  args: string[];
};

type AutoConnectJsonMcpInput = {
  currentConfig: Record<string, any> | null;
  legacyConfig?: Record<string, any> | null;
  launchConfig: McpLaunchConfig;
};

type AutoInstallClaudeSkillInput = {
  bundledSkillContent: string | null;
  installedSkillContent: string | null;
  claudeInstructionsContent: string | null;
};

export function mcpEntriesMatch(entry: any, launchConfig: McpLaunchConfig): boolean {
  return !!entry
    && entry.command === launchConfig.command
    && Array.isArray(entry.args)
    && JSON.stringify(entry.args) === JSON.stringify(launchConfig.args);
}

export function hasAnyMcpEntry(config: Record<string, any> | null | undefined): boolean {
  return !!config?.mcpServers?.['vault-memory'];
}

export function shouldAutoConnectJsonMcp({
  currentConfig,
  legacyConfig,
  launchConfig,
}: AutoConnectJsonMcpInput): boolean {
  const currentEntry = currentConfig?.mcpServers?.['vault-memory'];
  if (mcpEntriesMatch(currentEntry, launchConfig)) {
    return false;
  }

  return !!currentEntry || hasAnyMcpEntry(legacyConfig);
}

export function hasLegacyClaudeSkillReference(content: string | null | undefined): boolean {
  return !!content && (content.includes('claude-vault-skill') || content.includes('## Vault Memory Skill'));
}

export function shouldAutoInstallClaudeSkill({
  bundledSkillContent,
  installedSkillContent,
  claudeInstructionsContent,
}: AutoInstallClaudeSkillInput): boolean {
  if (!bundledSkillContent) {
    return false;
  }

  if (installedSkillContent !== null) {
    return installedSkillContent.trim() !== bundledSkillContent.trim();
  }

  return hasLegacyClaudeSkillReference(claudeInstructionsContent);
}
