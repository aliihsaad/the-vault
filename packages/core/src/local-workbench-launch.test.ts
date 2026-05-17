import { describe, expect, it } from 'vitest';
import { buildLocalWorkbenchLaunch } from './services/local-workbench-launch.service.js';

describe('local workbench launch service', () => {
  it('builds a Codex CLI launch spec with repo cwd and context pack path', () => {
    const launch = buildLocalWorkbenchLaunch({
      adapterType: 'codex_local',
      workspacePath: String.raw`C:\Users\Mini\Desktop\Projects\the-vault`,
      contextPackPath: String.raw`C:\tmp\vault-context.md`,
      model: 'gpt-5.2',
      effort: 'medium',
      prompt: 'Review the plan.',
    });

    expect(launch.command).toBe('codex');
    expect(launch.args).toContain('exec');
    expect(launch.args).toContain('--skip-git-repo-check');
    expect(launch.displayCommand).toContain(String.raw`Set-Location -LiteralPath 'C:\Users\Mini\Desktop\Projects\the-vault'`);
    expect(launch.displayCommand).toContain(String.raw`Get-Content -Raw -LiteralPath 'C:\tmp\vault-context.md' | codex exec`);
    expect(launch.displayCommand).toContain('--model gpt-5.2');
    expect(launch.displayCommand).toContain('--config model_reasoning_effort=medium');
  });

  it('builds a Claude Code launch spec with stream json output and model when selected', () => {
    const launch = buildLocalWorkbenchLaunch({
      adapterType: 'claude_local',
      workspacePath: String.raw`C:\Users\Mini\Desktop\Projects\whisphry`,
      contextPackPath: String.raw`C:\tmp\vault-context.md`,
      model: 'claude-sonnet-4-5',
      effort: '',
      prompt: 'Fix the failing tests.',
    });

    expect(launch.command).toBe('claude');
    expect(launch.args).toEqual(['--print', '-', '--output-format', 'stream-json', '--verbose', '--model', 'claude-sonnet-4-5']);
    expect(launch.displayCommand).toContain(String.raw`Set-Location -LiteralPath 'C:\Users\Mini\Desktop\Projects\whisphry'`);
    expect(launch.displayCommand).toContain(String.raw`Get-Content -Raw -LiteralPath 'C:\tmp\vault-context.md' | claude --print - --output-format stream-json --verbose --model claude-sonnet-4-5`);
  });

  it('rejects untrusted adapter types', () => {
    expect(() => buildLocalWorkbenchLaunch({
      adapterType: 'api' as never,
      workspacePath: 'C:\\repo',
      contextPackPath: 'C:\\tmp\\pack.md',
      model: '',
      effort: '',
      prompt: 'Nope',
    })).toThrow('Unsupported local adapter type.');
  });
});
