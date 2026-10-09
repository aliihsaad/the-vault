import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createGraphifySourceFilter,
  detectGraphifyMultiProjectRoot,
  isGraphifyExcludedSourcePath,
} from './rules/graphify.js';

describe('isGraphifyExcludedSourcePath', () => {
  it('keeps ordinary source files', () => {
    expect(isGraphifyExcludedSourcePath('src/index.ts')).toBe(false);
    expect(isGraphifyExcludedSourcePath('apps/desktop/main.ts')).toBe(false);
    expect(isGraphifyExcludedSourcePath('README.md')).toBe(false);
  });

  it('excludes packaged Electron build output and asar archives', () => {
    // Regression: talabie-ai-waiter staging failed with ENOENT because fs.cp in the
    // Electron main process treats app.asar as a directory.
    expect(isGraphifyExcludedSourcePath('apps/desktop/release/win-unpacked/resources/app.asar')).toBe(true);
    expect(isGraphifyExcludedSourcePath('apps/desktop/release/builder-effective-config.yaml')).toBe(true);
    expect(isGraphifyExcludedSourcePath('apps/desktop/release/win-unpacked/app.exe')).toBe(true);
    expect(isGraphifyExcludedSourcePath('resources/app.asar')).toBe(true);
  });

  it('excludes dependency and build directories', () => {
    expect(isGraphifyExcludedSourcePath('node_modules/react/index.js')).toBe(true);
    expect(isGraphifyExcludedSourcePath('.git/config')).toBe(true);
    expect(isGraphifyExcludedSourcePath('dist/index.js')).toBe(true);
    expect(isGraphifyExcludedSourcePath('dist-electron/main.js')).toBe(true);
    expect(isGraphifyExcludedSourcePath('out/server.js')).toBe(true);
    expect(isGraphifyExcludedSourcePath('coverage/lcov.info')).toBe(true);
    expect(isGraphifyExcludedSourcePath('graphify-out/graph.json')).toBe(true);
  });

  it('excludes OS sidecar junk that breaks Windows staging deletes', () => {
    // desktop.ini marks its folder system/read-only on Windows -> rmdir EPERM.
    expect(isGraphifyExcludedSourcePath('assets/screenshots/desktop.ini')).toBe(true);
    expect(isGraphifyExcludedSourcePath('Thumbs.db')).toBe(true);
    expect(isGraphifyExcludedSourcePath('docs/.DS_Store')).toBe(true);
  });

  it('excludes env files and secret-like names', () => {
    expect(isGraphifyExcludedSourcePath('.env')).toBe(true);
    expect(isGraphifyExcludedSourcePath('config/.env.local')).toBe(true);
    expect(isGraphifyExcludedSourcePath('config/my-secret.json')).toBe(true);
    expect(isGraphifyExcludedSourcePath('auth/token-store.ts')).toBe(true);
  });

  it('excludes common credential and key files', () => {
    for (const path of [
      'vercel-recovery-codes.txt',
      'config/credentials.json',
      'deploy/secrets.yaml',
      'certs/server.pem',
      'certs/private.key',
      'keys/site.pfx',
      'id_rsa',
      'home/id_ed25519.pub',
      '.npmrc',
      '.netrc',
      '.git-credentials',
      '.ssh/config',
      '.aws/credentials',
    ]) {
      expect(isGraphifyExcludedSourcePath(path), path).toBe(true);
    }
  });

  it('does not exclude ordinary files that only resemble secret names', () => {
    expect(isGraphifyExcludedSourcePath('src/styles/design-tokens.css')).toBe(false);
    expect(isGraphifyExcludedSourcePath('src/keyboard.ts')).toBe(false);
    expect(isGraphifyExcludedSourcePath('src/id_generator.ts')).toBe(false);
  });

  it('normalizes Windows separators and is case-insensitive', () => {
    expect(isGraphifyExcludedSourcePath('apps\\desktop\\release\\win-unpacked\\resources\\app.asar')).toBe(true);
    expect(isGraphifyExcludedSourcePath('Node_Modules\\pkg\\index.js')).toBe(true);
  });

  it('treats an empty path as not excluded', () => {
    expect(isGraphifyExcludedSourcePath('')).toBe(false);
  });
});

describe('createGraphifySourceFilter', () => {
  let sourceRoot: string;

  beforeEach(() => {
    sourceRoot = mkdtempSync(join(tmpdir(), 'vault-graphify-ignore-'));
  });

  afterEach(() => {
    rmSync(sourceRoot, { recursive: true, force: true });
  });

  it('applies .graphifyignore patterns on top of the built-in rules', () => {
    writeFileSync(join(sourceRoot, '.graphifyignore'), [
      '# second checkout of the same repo',
      'lawyeah-main/',
      '/docs/archive',
      '*.log',
      'fixtures/**/large-*.json',
      '',
    ].join('\n'));
    const isExcluded = createGraphifySourceFilter(sourceRoot);

    expect(isExcluded('lawyeah-main')).toBe(true);
    expect(isExcluded('lawyeah-main/src/app/page.tsx')).toBe(true);
    expect(isExcluded('docs/archive/old.md')).toBe(true);
    expect(isExcluded('Work/docs/archive/old.md')).toBe(false); // anchored to the root
    expect(isExcluded('logs/app.log')).toBe(true);
    expect(isExcluded('fixtures/a/b/large-1.json')).toBe(true);
    expect(isExcluded('Work/src/app/page.tsx')).toBe(false);
    expect(isExcluded('Work/.env')).toBe(true); // built-in rules still apply
  });

  it('uses only the built-in rules when there is no .graphifyignore', () => {
    const isExcluded = createGraphifySourceFilter(sourceRoot);

    expect(isExcluded('src/index.ts')).toBe(false);
    expect(isExcluded('node_modules/a/index.js')).toBe(true);
  });
});

describe('detectGraphifyMultiProjectRoot', () => {
  let sourceRoot: string;

  beforeEach(() => {
    sourceRoot = mkdtempSync(join(tmpdir(), 'vault-graphify-multi-'));
  });

  afterEach(() => {
    rmSync(sourceRoot, { recursive: true, force: true });
  });

  it('lists child projects when the root is a folder holding several checkouts', () => {
    mkdirSync(join(sourceRoot, 'Work', '.git'), { recursive: true });
    mkdirSync(join(sourceRoot, 'lawyeah-main'));
    writeFileSync(join(sourceRoot, 'lawyeah-main', 'package.json'), '{}');

    expect(detectGraphifyMultiProjectRoot(sourceRoot)).toEqual(['lawyeah-main', 'Work']);
  });

  it('ignores child projects excluded by .graphifyignore', () => {
    mkdirSync(join(sourceRoot, 'Work', '.git'), { recursive: true });
    mkdirSync(join(sourceRoot, 'lawyeah-main'));
    writeFileSync(join(sourceRoot, 'lawyeah-main', 'package.json'), '{}');
    writeFileSync(join(sourceRoot, '.graphifyignore'), 'lawyeah-main/\n');

    expect(detectGraphifyMultiProjectRoot(sourceRoot)).toEqual([]);
  });

  it('does not flag a single repo with frontend and backend packages', () => {
    mkdirSync(join(sourceRoot, '.git'));
    for (const child of ['frontend', 'backend']) {
      mkdirSync(join(sourceRoot, child));
      writeFileSync(join(sourceRoot, child, 'package.json'), '{}');
    }

    expect(detectGraphifyMultiProjectRoot(sourceRoot)).toEqual([]);
  });
});
