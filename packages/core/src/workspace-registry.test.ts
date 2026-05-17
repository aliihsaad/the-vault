import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getProjectWorkspace,
  removeProjectWorkspace,
  setProjectWorkspace,
  validateWorkspacePath,
} from './services/workspace-registry.service.js';
import type { ProjectWorkspaceRegistry } from './types/index.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'vault-workspace-'));
  tempRoots.push(root);
  mkdirSync(join(root, '.git'));
  return root;
}

describe('workspace registry service', () => {
  it('validates an absolute repository path and detects .git', () => {
    const workspacePath = makeTempRepo();

    const result = validateWorkspacePath(workspacePath);

    expect(result.ok).toBe(true);
    expect(result.workspacePath).toBe(resolve(workspacePath));
    expect(result.exists).toBe(true);
    expect(result.isDirectory).toBe(true);
    expect(result.gitRootDetected).toBe(true);
  });

  it('rejects relative paths before any launch command can be prepared', () => {
    const result = validateWorkspacePath('relative/project');

    expect(result.ok).toBe(false);
    expect(result.exists).toBe(false);
    expect(result.isDirectory).toBe(false);
    expect(result.message).toBe('Workspace path must be absolute.');
  });

  it('stores a trusted workspace by normalized project name', () => {
    const workspacePath = makeTempRepo();
    const registry: ProjectWorkspaceRegistry = {};

    const next = setProjectWorkspace(registry, {
      project: 'The Vault',
      workspacePath,
      trusted: true,
      notes: 'Main repo',
    });

    expect(Object.keys(next)).toEqual(['The Vault']);
    expect(next['The Vault'].workspacePath).toBe(resolve(workspacePath));
    expect(next['The Vault'].trusted).toBe(true);
    expect(next['The Vault'].gitRootDetected).toBe(true);
    expect(next['The Vault'].notes).toBe('Main repo');
    expect(getProjectWorkspace(next, 'The Vault')?.workspacePath).toBe(resolve(workspacePath));
  });

  it('removes a workspace without mutating the original registry object', () => {
    const workspacePath = makeTempRepo();
    const registry = setProjectWorkspace({}, {
      project: 'the-vault',
      workspacePath,
      trusted: true,
      notes: null,
    });

    const next = removeProjectWorkspace(registry, 'the-vault');

    expect(registry['the-vault']).toBeDefined();
    expect(next['the-vault']).toBeUndefined();
  });
});
