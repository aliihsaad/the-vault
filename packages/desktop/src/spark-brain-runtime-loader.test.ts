import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSparkBrainRuntimeLoader } from '../electron/spark-brain-runtime-loader.js';

function makeExtensionDir(withDist: boolean): string {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'spark-loader-'));
  const pkgRoot = join(vaultRoot, 'extensions', 'spark-brain', 'packages', 'spark-brain');
  mkdirSync(pkgRoot, { recursive: true });
  writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({ name: '@spark/brain', version: '1.2.3' }));
  if (withDist) {
    const distDir = join(pkgRoot, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      join(distDir, 'index.js'),
      'export function createSparkBrainRuntime() { return { ok: true, value: { project: "Spark-Brain" } }; }\n',
    );
  }
  return vaultRoot;
}

describe('Spark Brain runtime loader', () => {
  it('reports the package as available with its version when dist exists', () => {
    const loader = createSparkBrainRuntimeLoader(makeExtensionDir(true));
    expect(loader.getPackageInfo()).toEqual({ available: true, version: '1.2.3' });
  });

  it('dynamically imports the built runtime module when dist exists', async () => {
    const loader = createSparkBrainRuntimeLoader(makeExtensionDir(true));
    const mod = await loader.loadModule();
    expect(mod).not.toBeNull();
    expect(typeof mod?.createSparkBrainRuntime).toBe('function');
  });

  it('returns null when the runtime has not been built', async () => {
    const loader = createSparkBrainRuntimeLoader(makeExtensionDir(false));
    expect(await loader.loadModule()).toBeNull();
    expect(loader.getPackageInfo().available).toBe(false);
  });
});
