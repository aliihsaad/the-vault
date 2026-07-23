import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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

  it('exposes governed task admission fields on the task MCP contract', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    for (const field of ['work_intent', 'related_loop_uid', 'actor', 'authorization_request_uid', 'idempotency_key']) {
      expect(source).toContain(`${field}:`);
    }
  });
});
