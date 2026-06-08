import { describe, expect, it, vi } from 'vitest';
import {
  buildVoiceToolsFromBrainRegistry,
  createSparkToolDispatcher,
  type BrainToolDefinitionLike,
  type BrainToolRegistryLike,
} from './services/spark-voice/spark-voice-tools.js';

function registry(
  defs: BrainToolDefinitionLike[],
  dispatch: BrainToolRegistryLike['dispatch'] = async () => ({
    ok: true,
    value: { ok: true, value: 'done', userMessage: 'done', evidenceRefs: [], duration_ms: 1 },
  }),
): BrainToolRegistryLike {
  return { listExecutable: () => defs, dispatch };
}

describe('buildVoiceToolsFromBrainRegistry', () => {
  it('maps executable brain tools into voice tools with their schema + policy', () => {
    const tools = buildVoiceToolsFromBrainRegistry(
      registry([
        {
          name: 'graphify_query',
          description: 'Query the code graph',
          schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
          policy: { risk: 'low', permission: 'graph.read', requiresApproval: false, memoryWriteAllowed: false },
        },
      ]),
    );
    expect(tools).toHaveLength(1);
    expect(tools[0].definition.function.name).toBe('graphify_query');
    expect(tools[0].definition.function.parameters).toEqual({
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    });
    expect(tools[0].policy.requiresApproval).toBe(false);
    expect(tools[0].policy.permission).toBe('graph.read');
  });

  it('dispatches through the registry and unwraps the action value', async () => {
    const dispatch = vi.fn(async () => ({
      ok: true,
      value: { ok: true, value: { rows: 3 }, userMessage: 'ok', evidenceRefs: [], duration_ms: 2 },
    }));
    const tools = buildVoiceToolsFromBrainRegistry(registry([{ name: 'do_thing' }], dispatch));
    const dispatcher = createSparkToolDispatcher(tools);
    const result = await dispatcher.dispatch('do_thing', JSON.stringify({ a: 1 }), { turnComplete: true });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ rows: 3 });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'do_thing', args: { a: 1 } }),
    );
  });

  it('reports ok:false when the registry result or action fails', async () => {
    const failing = registry([{ name: 'boom' }], async () => ({
      ok: false,
      error: { code: 'tool_failed', message: 'kaboom' },
    }));
    const dispatcher = createSparkToolDispatcher(buildVoiceToolsFromBrainRegistry(failing));
    const result = await dispatcher.dispatch('boom', '{}', { turnComplete: true });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('kaboom');
  });

  it('hides approval-required brain tools from the model schema', () => {
    const tools = buildVoiceToolsFromBrainRegistry(
      registry([
        { name: 'safe_read', policy: { requiresApproval: false } },
        { name: 'danger_write', policy: { requiresApproval: true, memoryWriteAllowed: true } },
      ]),
    );
    const dispatcher = createSparkToolDispatcher(tools);
    const visible = dispatcher.listDefinitions().map((d) => d.function.name);
    expect(visible).toContain('safe_read');
    expect(visible).not.toContain('danger_write');
    // still registered (and blocked) — just not advertised
    expect(dispatcher.listNames()).toContain('danger_write');
  });

  it('skips reserved (host-owned) names and duplicates', () => {
    const tools = buildVoiceToolsFromBrainRegistry(
      registry([
        { name: 'recall_memory' },
        { name: 'dup' },
        { name: 'dup' },
      ]),
      { reservedNames: ['recall_memory', 'show_on_canvas'] },
    );
    expect(tools.map((t) => t.definition.function.name)).toEqual(['dup']);
  });

  it('returns an empty catalog when listExecutable throws or is empty', () => {
    expect(buildVoiceToolsFromBrainRegistry(registry([]))).toEqual([]);
    const throwing: BrainToolRegistryLike = {
      listExecutable: () => {
        throw new Error('no graph');
      },
      dispatch: async () => ({ ok: true }),
    };
    expect(buildVoiceToolsFromBrainRegistry(throwing)).toEqual([]);
  });
});
