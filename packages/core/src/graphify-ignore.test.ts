import { describe, expect, it } from 'vitest';
import { isGraphifyExcludedSourcePath } from './rules/graphify.js';

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

  it('normalizes Windows separators and is case-insensitive', () => {
    expect(isGraphifyExcludedSourcePath('apps\\desktop\\release\\win-unpacked\\resources\\app.asar')).toBe(true);
    expect(isGraphifyExcludedSourcePath('Node_Modules\\pkg\\index.js')).toBe(true);
  });

  it('treats an empty path as not excluded', () => {
    expect(isGraphifyExcludedSourcePath('')).toBe(false);
  });
});
