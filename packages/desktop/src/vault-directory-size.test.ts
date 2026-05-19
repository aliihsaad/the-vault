import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { getDirectorySizeSummary } from '../electron/vault-directory-size.js';

describe('vault directory size summary', () => {
  it('counts nested files and formats bytes for sidebar status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vault-size-'));
    await writeFile(join(root, 'vault.db'), Buffer.alloc(512));
    await mkdir(join(root, 'projects', 'the-vault'), { recursive: true });
    await writeFile(join(root, 'projects', 'the-vault', 'memory.md'), Buffer.alloc(1536));

    const summary = await getDirectorySizeSummary(root);

    expect(summary).toEqual({
      bytes: 2048,
      files: 2,
      directories: 2,
      displaySize: '2 KB',
    });
  });
});
