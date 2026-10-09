import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSourceGitHead } from './services/graphify-corpus.service.js';

describe('readSourceGitHead', () => {
  let root: string;
  const sha = '0123456789abcdef0123456789abcdef01234567';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vault-graphify-git-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the branch and commit from a loose ref', () => {
    mkdirSync(join(root, '.git', 'refs', 'heads', 'feature'), { recursive: true });
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
    writeFileSync(join(root, '.git', 'refs', 'heads', 'feature', 'x'), `${sha}\n`);

    expect(readSourceGitHead(root)).toEqual({ branch: 'feature/x', head: sha });
  });

  it('falls back to packed refs', () => {
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/dev\n');
    writeFileSync(join(root, '.git', 'packed-refs'), `# pack-refs with: peeled\n${sha} refs/heads/dev\n`);

    expect(readSourceGitHead(root)).toEqual({ branch: 'dev', head: sha });
  });

  it('reports a detached HEAD without a branch', () => {
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'HEAD'), `${sha}\n`);

    expect(readSourceGitHead(root)).toEqual({ branch: null, head: sha });
  });

  it('returns null outside a git checkout', () => {
    expect(readSourceGitHead(root)).toBeNull();
  });
});
