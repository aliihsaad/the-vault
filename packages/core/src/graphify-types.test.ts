import { describe, expect, it } from 'vitest';
import {
  GRAPHIFY_BUILD_MODES,
  GRAPHIFY_FRESHNESS_STATES,
  GRAPHIFY_RUNTIME_MODES,
  GraphifyBuildModeSchema,
  GraphifyFreshnessStateSchema,
  GraphifyRuntimeModeSchema,
} from './rules/graphify.js';

describe('Graphify controlled values', () => {
  it('defines the supported freshness states', () => {
    expect(GRAPHIFY_FRESHNESS_STATES).toEqual([
      'missing',
      'queued',
      'building',
      'fresh',
      'stale',
      'failed',
      'disabled',
    ]);
  });

  it('defines the supported runtime modes', () => {
    expect(GRAPHIFY_RUNTIME_MODES).toEqual([
      'managed',
      'path',
      'localSource',
    ]);
  });

  it('defines the supported build modes', () => {
    expect(GRAPHIFY_BUILD_MODES).toEqual([
      'fast',
      'full',
      'semantic',
    ]);
  });

  it('rejects unknown Graphify values', () => {
    expect(() => GraphifyFreshnessStateSchema.parse('ready')).toThrow();
    expect(() => GraphifyRuntimeModeSchema.parse('global')).toThrow();
    expect(() => GraphifyBuildModeSchema.parse('deep')).toThrow();
  });
});

