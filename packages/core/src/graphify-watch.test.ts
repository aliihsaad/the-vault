import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGraphifySourceFilter } from './rules/graphify.js';
import { shouldTriggerGraphifyBuildForWatchEvent } from './services/graphify-build-queue.service.js';

describe('shouldTriggerGraphifyBuildForWatchEvent', () => {
  let sourceRoot: string;
  const lastBuildStartedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600 * 1000);

  function decide(eventType: string, filename: string | null, lastBuild: string | null = lastBuildStartedAt) {
    return shouldTriggerGraphifyBuildForWatchEvent({
      sourceRoot,
      eventType,
      filename,
      lastBuildStartedAt: lastBuild,
      isExcluded: createGraphifySourceFilter(sourceRoot),
    });
  }

  beforeEach(() => {
    sourceRoot = mkdtempSync(join(tmpdir(), 'vault-graphify-watch-'));
    mkdirSync(join(sourceRoot, 'src'));
    writeFileSync(join(sourceRoot, 'src', 'old.ts'), 'export {};');
    // Content last written before the last build; only its access time changes on read.
    utimesSync(join(sourceRoot, 'src', 'old.ts'), new Date(), hoursAgo(3));
    writeFileSync(join(sourceRoot, 'src', 'new.ts'), 'export const x = 1;');
  });

  afterEach(() => {
    rmSync(sourceRoot, { recursive: true, force: true });
  });

  it('ignores a change event caused only by reading a file (access time update)', () => {
    expect(decide('change', 'src/old.ts')).toBe(false);
    expect(decide('change', 'src\\old.ts')).toBe(false);
  });

  it('triggers when a file was written after the last build started', () => {
    expect(decide('change', 'src/new.ts')).toBe(true);
  });

  it('triggers on create, delete and rename events', () => {
    expect(decide('rename', 'src/old.ts')).toBe(true);
    expect(decide('rename', 'src/deleted.ts')).toBe(true);
  });

  it('triggers when a changed file can no longer be read', () => {
    expect(decide('change', 'src/gone.ts')).toBe(true);
  });

  it('ignores change events on folders, whose entries report their own events', () => {
    expect(decide('change', 'src')).toBe(false);
  });

  it('ignores paths the build excludes, including .graphifyignore entries', () => {
    writeFileSync(join(sourceRoot, '.graphifyignore'), 'archive/\n');
    expect(decide('rename', 'node_modules/pkg/index.js')).toBe(false);
    expect(decide('rename', 'archive/src/app.ts')).toBe(false);
    expect(decide('rename', '.env.local')).toBe(false);
  });

  it('triggers when the watcher cannot say what changed', () => {
    expect(decide('change', null)).toBe(true);
  });

  it('triggers on any content change when there has been no build yet', () => {
    expect(decide('change', 'src/old.ts', null)).toBe(true);
  });
});
