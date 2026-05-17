import type {
  LocalWorkbenchLaunchInput,
  LocalWorkbenchLaunchSpec,
} from '../types/index.js';

export function buildLocalWorkbenchLaunch(input: LocalWorkbenchLaunchInput): LocalWorkbenchLaunchSpec {
  const adapterType = input.adapterType;
  const workspacePath = input.workspacePath.trim();
  const contextPackPath = input.contextPackPath.trim();
  const model = input.model?.trim() || '';
  const effort = input.effort?.trim() || '';

  if (adapterType !== 'claude_local' && adapterType !== 'codex_local') {
    throw new Error('Unsupported local adapter type.');
  }

  if (!workspacePath) {
    throw new Error('Workspace path is required.');
  }

  if (!contextPackPath) {
    throw new Error('Context pack path is required.');
  }

  const command = adapterType === 'claude_local' ? 'claude' : 'codex';
  const args = adapterType === 'claude_local'
    ? buildClaudeArgs(model)
    : buildCodexArgs(model, effort);

  return {
    adapterType,
    command,
    args,
    workspacePath,
    contextPackPath,
    displayCommand: [
      `Set-Location -LiteralPath ${quotePowerShell(workspacePath)}`,
      `${buildPromptPipe(contextPackPath)} | ${[command, ...args].map(quoteCommandPart).join(' ')}`,
    ].join('; '),
  };
}

function buildClaudeArgs(model: string): string[] {
  const args = ['--print', '-', '--output-format', 'stream-json', '--verbose'];
  if (model) {
    args.push('--model', model);
  }
  return args;
}

function buildCodexArgs(model: string, effort: string): string[] {
  const args = ['exec', '--json', '--skip-git-repo-check', '--color', 'never'];
  if (model) {
    args.push('--model', model);
  }
  if (effort) {
    args.push('--config', `model_reasoning_effort=${effort}`);
  }
  args.push('-');
  return args;
}

function buildPromptPipe(contextPackPath: string): string {
  return `Get-Content -Raw -LiteralPath ${quotePowerShell(contextPackPath)}`;
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteCommandPart(value: string): string {
  return /^[A-Za-z0-9_.:=/-]+$/.test(value) ? value : quotePowerShell(value);
}
