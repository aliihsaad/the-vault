import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Vault } from '@the-vault/core';

import { registerOpenLoopsV2McpTools } from './open-loops-v2-tools.js';

const DEDICATED_TOOL_NAMES = [
  'vault_create_project',
  'vault_transition_project_lifecycle',
  'vault_create_open_loop',
  'vault_get_open_loop',
  'vault_list_dedicated_open_loops',
  'vault_count_dedicated_open_loops',
  'vault_add_loop_evidence',
  'vault_evaluate_project_gate',
  'vault_request_loop_snooze',
  'vault_decide_loop_snooze',
  'vault_resolve_open_loop',
  'vault_recover_open_loop',
  'vault_classify_project',
  'vault_convert_project_type',
  'vault_inventory_legacy_loop_candidates',
  'vault_get_open_loop_shadow_telemetry',
] as const;

describe('Open-Loops v2 MCP contract', () => {
  it('registers every dedicated A-E operation additively', () => {
    const names: string[] = [];
    const server = {
      tool(name: string) {
        names.push(name);
      },
    } as unknown as McpServer;

    registerOpenLoopsV2McpTools(server, {} as Vault);

    expect(names).toEqual(DEDICATED_TOOL_NAMES);
  });

  it('derives governed actor identity from the trusted MCP server boundary', async () => {
    const registrations = new Map<string, { schema: Record<string, unknown>; handler: (args: Record<string, unknown>) => Promise<unknown> }>();
    const server = {
      tool(name: string, _description: string, schema: Record<string, unknown>, handler: (args: Record<string, unknown>) => Promise<unknown>) {
        registrations.set(name, { schema, handler });
      },
    } as unknown as McpServer;
    const trustedActor = { actorUid: 'installation-owner', actorKind: 'installation' as const, roles: ['owner'] };
    const vault = {
      getOpenLoopInstallationDefaults: vi.fn(() => ({ actor: trustedActor })),
      transitionProjectLifecycle: vi.fn(() => ({ eventUid: 'event-1' })),
    } as unknown as Vault;

    registerOpenLoopsV2McpTools(server, vault);
    const transition = registrations.get('vault_transition_project_lifecycle')!;
    expect(transition.schema).not.toHaveProperty('actor');
    await transition.handler({
      project: 'project-1',
      next_state: 'shadow',
      reason: 'Trusted-boundary fixture.',
      expected_version: 1,
      idempotency_key: 'trusted-boundary-fixture',
    });
    expect(vault.transitionProjectLifecycle).toHaveBeenCalledWith(expect.objectContaining({ actor: trustedActor }));
  });

  it('keeps public task admission ordinary, project-scoped, and identity-free', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const taskContract = source.slice(
      source.indexOf('// Tool: vault_create_task'),
      source.indexOf('// Tool: vault_list_tasks'),
    );
    for (const field of ['work_intent', 'related_loop_uid', 'actor:', 'authorization_request_uid']) {
      expect(taskContract).not.toContain(field);
    }
    expect(taskContract).toContain('project: z.string().min(1)');
    expect(taskContract).toContain('idempotency_key:');
  });
});
