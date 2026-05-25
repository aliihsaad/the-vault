import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  GRAPHIFY_INSTRUCTION_END_MARKER,
  GRAPHIFY_INSTRUCTION_START_MARKER,
  applyGraphifyInstructionSync,
  buildGraphifyInstructionSyncPreview,
  previewGraphifyInstructionSync,
} from './services/graphify-instruction-sync.service.js';

describe('Graphify instruction sync', () => {
  it('previews creation of a missing AGENTS.md without writing the file', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-instructions-'));
    try {
      const instructionPath = join(projectRoot, 'AGENTS.md');

      const preview = await previewGraphifyInstructionSync({
        projectRoot,
        target: 'codex',
      });

      expect(preview).toEqual(expect.objectContaining({
        target: 'codex',
        operation: 'apply',
        path: resolve(instructionPath),
        exists: false,
        willCreate: true,
        changed: true,
      }));
      expect(preview.afterContent).toContain(GRAPHIFY_INSTRUCTION_START_MARKER);
      expect(preview.afterContent).toContain('## Vault Graphify Extension');
      expect(preview.afterContent).toContain('call Vault Graphify MCP tools before broad search or large file reads');
      expect(preview.afterContent).toContain(GRAPHIFY_INSTRUCTION_END_MARKER);
      expect(preview.diff).toContain(`+++ ${resolve(instructionPath)} (after)`);
      expect(preview.diff).toContain(`+${GRAPHIFY_INSTRUCTION_START_MARKER}`);
      expect(existsSync(instructionPath)).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('updates only an existing marked section and is idempotent after the first update', () => {
    const projectRoot = 'C:/Users/Mini/Desktop/Projects/the-vault';
    const existing = [
      '# Project Instructions',
      '',
      '## Vault Memory Skill',
      'Keep the stable Vault memory skill path installed.',
      '',
      GRAPHIFY_INSTRUCTION_START_MARKER,
      'Old Graphify routing text that should be replaced.',
      GRAPHIFY_INSTRUCTION_END_MARKER,
      '',
      '## MCP Connector Setup',
      'Existing connector setup steps stay separate.',
      '',
    ].join('\n');

    const preview = buildGraphifyInstructionSyncPreview({
      projectRoot,
      target: 'codex',
      existingContent: existing,
    });

    expect(preview.changed).toBe(true);
    expect(preview.afterContent).toContain('## Vault Memory Skill\nKeep the stable Vault memory skill path installed.');
    expect(preview.afterContent).toContain('## MCP Connector Setup\nExisting connector setup steps stay separate.');
    expect(preview.afterContent).not.toContain('Old Graphify routing text');
    expect(preview.afterContent.match(/vault-graphify:start/g)).toHaveLength(1);
    expect(preview.afterContent.match(/vault-graphify:end/g)).toHaveLength(1);
    expect(preview.diff).toContain('-Old Graphify routing text that should be replaced.');
    expect(preview.diff).toContain('+For project architecture, code impact, symbol/file relationships');

    const secondPreview = buildGraphifyInstructionSyncPreview({
      projectRoot,
      target: 'codex',
      existingContent: preview.afterContent,
    });

    expect(secondPreview.changed).toBe(false);
    expect(secondPreview.diff).toBe('');
    expect(secondPreview.afterContent).toBe(preview.afterContent);
  });

  it('removes only the marked section and preserves unrelated instruction content', () => {
    const projectRoot = 'C:/Users/Mini/Desktop/Projects/the-vault';
    const existing = [
      '# AGENTS.md instructions',
      '',
      '## Vault Memory Skill',
      'Use Vault MCP for recall/save behavior.',
      '',
      GRAPHIFY_INSTRUCTION_START_MARKER,
      '## Vault Graphify Extension',
      'Temporary Graphify instructions.',
      GRAPHIFY_INSTRUCTION_END_MARKER,
      '',
      '## Existing MCP Connector Flows',
      'Do not disturb connector setup.',
      '',
    ].join('\n');

    const preview = buildGraphifyInstructionSyncPreview({
      projectRoot,
      target: 'codex',
      operation: 'remove',
      existingContent: existing,
    });

    expect(preview.changed).toBe(true);
    expect(preview.afterContent).not.toContain(GRAPHIFY_INSTRUCTION_START_MARKER);
    expect(preview.afterContent).not.toContain(GRAPHIFY_INSTRUCTION_END_MARKER);
    expect(preview.afterContent).toContain('## Vault Memory Skill\nUse Vault MCP for recall/save behavior.');
    expect(preview.afterContent).toContain('## Existing MCP Connector Flows\nDo not disturb connector setup.');
    expect(preview.diff).toContain(`-${GRAPHIFY_INSTRUCTION_START_MARKER}`);
    expect(preview.diff).toContain('-Temporary Graphify instructions.');
  });

  it('writes only on apply and returns the same preview shape used for confirmation', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-instructions-apply-'));
    try {
      const instructionPath = join(projectRoot, 'CLAUDE.md');
      await writeFile(instructionPath, '# Claude Project Guide\n\nKeep existing Claude guidance.\n', 'utf8');

      const preview = await previewGraphifyInstructionSync({
        projectRoot,
        target: 'claude',
      });

      expect(await readFile(instructionPath, 'utf8')).toBe('# Claude Project Guide\n\nKeep existing Claude guidance.\n');
      expect(preview.changed).toBe(true);
      expect(preview.willCreate).toBe(false);

      const applied = await applyGraphifyInstructionSync({
        projectRoot,
        target: 'claude',
      });

      expect(applied.changed).toBe(true);
      expect(applied.diff).toBe(preview.diff);
      expect(await readFile(instructionPath, 'utf8')).toBe(preview.afterContent);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects paths outside the selected instruction target', () => {
    const projectRoot = 'C:/Users/Mini/Desktop/Projects/the-vault';

    expect(() => buildGraphifyInstructionSyncPreview({
      projectRoot,
      target: 'codex',
      instructionPath: 'C:/Users/Mini/Desktop/Projects/the-vault/CLAUDE.md',
      existingContent: '',
    })).toThrow('Graphify Codex instruction sync can only target AGENTS.md.');

    expect(() => buildGraphifyInstructionSyncPreview({
      projectRoot,
      target: 'codex',
      instructionPath: 'C:/Users/Mini/Desktop/AGENTS.md',
      existingContent: '',
    })).toThrow('Graphify instruction sync path must stay inside the selected project root.');
  });
});
