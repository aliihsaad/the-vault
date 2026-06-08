import { describe, expect, it, vi } from 'vitest';

import type { SparkSkillRow } from './types/spark-extension.js';
import {
  buildSparkHostTools,
  buildVoiceToolsFromSkillRows,
  createSparkToolDispatcher,
  sanitizeToolName,
  type SparkVoiceTool,
} from './services/spark-voice/spark-voice-tools.js';

function skillRow(partial: Partial<SparkSkillRow>): SparkSkillRow {
  return {
    skillId: 'vault.recall',
    name: 'Recall Memory',
    namespace: 'vault',
    source: 'core',
    version: '1.0.0',
    enabled: true,
    packSource: null,
    permissions: [],
    supportedTools: [],
    outputContracts: [],
    hasExecutableRegistration: true,
    health: 'ready',
    lockedReason: null,
    ...partial,
  };
}

function tool(partial: Partial<SparkVoiceTool> & { name: string }): SparkVoiceTool {
  return {
    definition: {
      type: 'function',
      function: { name: partial.name, parameters: { type: 'object' } },
    },
    policy: {
      risk: 'low',
      permission: 'vault',
      parallelism: 'read_only',
      requiresApproval: false,
      memoryWriteAllowed: false,
    },
    handler: partial.handler ?? (() => 'ok'),
    ...partial,
  };
}

describe('createSparkToolDispatcher (single policy-routed path)', () => {
  it('only advertises non-approval tools but can name all of them', () => {
    const dispatcher = createSparkToolDispatcher([
      tool({ name: 'recall' }),
      tool({
        name: 'save_memory',
        policy: {
          risk: 'high',
          permission: 'vault',
          parallelism: 'never',
          requiresApproval: true,
          memoryWriteAllowed: true,
        },
      }),
    ]);
    expect(dispatcher.listDefinitions().map((d) => d.function.name)).toEqual(['recall']);
    expect(dispatcher.listNames().sort()).toEqual(['recall', 'save_memory']);
  });

  it('dispatches a tool, parses JSON args, and reports durationMs', async () => {
    const handler = vi.fn((args: unknown) => ({ echoed: args }));
    const dispatcher = createSparkToolDispatcher([tool({ name: 'recall', handler })]);
    const result = await dispatcher.dispatch('recall', '{"q":"hi"}');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ echoed: { q: 'hi' } });
    expect(handler).toHaveBeenCalledWith({ q: 'hi' }, expect.anything());
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('blocks unknown tools', async () => {
    const dispatcher = createSparkToolDispatcher([]);
    const result = await dispatcher.dispatch('nope', '{}');
    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.error?.code).toBe('unknown_tool');
  });

  it('blocks approval-required tools unless approved', async () => {
    const dispatcher = createSparkToolDispatcher([
      tool({
        name: 'save_memory',
        policy: {
          risk: 'high',
          permission: 'vault',
          parallelism: 'never',
          requiresApproval: true,
          memoryWriteAllowed: true,
        },
      }),
    ]);
    const blocked = await dispatcher.dispatch('save_memory', '{}', { turnComplete: true });
    expect(blocked.blocked).toBe(true);
    expect(blocked.error?.code).toBe('approval_required');

    const ok = await dispatcher.dispatch('save_memory', '{}', { approved: true, turnComplete: true });
    expect(ok.ok).toBe(true);
  });

  it('blocks memory writes on incomplete turns', async () => {
    const dispatcher = createSparkToolDispatcher([
      tool({
        name: 'save_memory',
        policy: {
          risk: 'medium',
          permission: 'vault',
          parallelism: 'never',
          requiresApproval: false,
          memoryWriteAllowed: true,
        },
      }),
    ]);
    const result = await dispatcher.dispatch('save_memory', '{}', { turnComplete: false });
    expect(result.blocked).toBe(true);
    expect(result.error?.code).toBe('partial_turn_write_blocked');
  });

  it('captures handler errors as typed results', async () => {
    const dispatcher = createSparkToolDispatcher([
      tool({
        name: 'boom',
        handler: () => {
          throw new Error('kaboom');
        },
      }),
    ]);
    const result = await dispatcher.dispatch('boom', '{}');
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({ code: 'handler_error', message: 'kaboom' });
  });
});

describe('buildVoiceToolsFromSkillRows (brain bridge)', () => {
  it('includes only enabled + executable skills (policy-visible only)', () => {
    const rows = [
      skillRow({ skillId: 'vault.recall' }),
      skillRow({ skillId: 'vault.disabled', enabled: false }),
      skillRow({ skillId: 'vault.no-exec', hasExecutableRegistration: false }),
    ];
    const tools = buildVoiceToolsFromSkillRows(rows, () => 'x');
    expect(tools.map((t) => t.skillId)).toEqual(['vault.recall']);
  });

  it('sanitizes skill ids into valid tool names and dispatches by them', async () => {
    const execute = vi.fn(async (skillId: string, args: unknown) => ({ skillId, args }));
    const tools = buildVoiceToolsFromSkillRows([skillRow({ skillId: 'vault.recall.v2' })], execute);
    expect(tools[0].definition.function.name).toBe('vault_recall_v2');

    const dispatcher = createSparkToolDispatcher(tools);
    const result = await dispatcher.dispatch('vault_recall_v2', '{"q":"x"}');
    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith('vault.recall.v2', { q: 'x' });
  });

  it('marks memory-writing skills as approval-required (hidden from schema)', () => {
    const tools = buildVoiceToolsFromSkillRows(
      [skillRow({ skillId: 'vault.save', permissions: ['memory.write'] })],
      () => 'x',
    );
    expect(tools[0].policy.requiresApproval).toBe(true);
    expect(tools[0].policy.memoryWriteAllowed).toBe(true);
    // Hidden from the advertised schema.
    expect(createSparkToolDispatcher(tools).listDefinitions()).toHaveLength(0);
  });

  it('sanitizeToolName handles dotted/odd ids', () => {
    expect(sanitizeToolName('a.b/c')).toBe('a_b_c');
    expect(sanitizeToolName('')).toBe('tool');
  });
});

describe('buildSparkHostTools (fixed read-only catalog)', () => {
  it('exposes a read-only recall_memory tool that dispatches to the injected recall fn', async () => {
    const recallMemory = vi.fn(async (q: string) => ({ hits: [q] }));
    const tools = buildSparkHostTools({ recallMemory });
    expect(tools).toHaveLength(1);
    expect(tools[0].definition.function.name).toBe('recall_memory');
    expect(tools[0].policy.memoryWriteAllowed).toBe(false);
    expect(tools[0].policy.requiresApproval).toBe(false);

    const dispatcher = createSparkToolDispatcher(tools);
    expect(dispatcher.listDefinitions()).toHaveLength(1); // visible to the model
    const result = await dispatcher.dispatch('recall_memory', '{"query":"deadline"}');
    expect(result.ok).toBe(true);
    expect(recallMemory).toHaveBeenCalledWith('deadline');
  });

  it('exposes a show_on_canvas tool that renders to the canvas via the injected sink', async () => {
    const showOnCanvas = vi.fn();
    const tools = buildSparkHostTools({ showOnCanvas });
    const canvas = tools.find((t) => t.definition.function.name === 'show_on_canvas');
    expect(canvas).toBeDefined();
    expect(canvas!.policy.requiresApproval).toBe(false);
    expect(canvas!.policy.memoryWriteAllowed).toBe(false);

    const dispatcher = createSparkToolDispatcher(tools);
    const result = await dispatcher.dispatch(
      'show_on_canvas',
      JSON.stringify({ kind: 'markdown', payload: '## Plan\n- step 1' }),
    );
    expect(result.ok).toBe(true);
    expect(showOnCanvas).toHaveBeenCalledWith({ kind: 'markdown', payload: '## Plan\n- step 1' });
  });

  it('returns an empty catalog when no capabilities are wired', () => {
    expect(buildSparkHostTools({})).toEqual([]);
  });
});
