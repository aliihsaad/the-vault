/**
 * Single policy-routed tool dispatcher (S3b; v5 ToolExecutionPolicy contract,
 * vm_0vFbOo9l8sfyWsJi §5).
 *
 * Every model-invoked tool flows through one `dispatch()` path. Provider-native
 * tool schemas are generated ONLY from policy-visible, executable tools
 * (approval-required tools are hidden from the model and blocked if invoked).
 * The brain bridge maps the runtime's policy-gated skills
 * (`SparkSkillRow[]` from `skillRegistry.discover()`) into voice tools, so tool
 * calls "dispatch through the brain runtime's policy-gated skills" without the
 * orchestrator ever talking to a provider or the registry directly.
 */

import type { SparkSkillRow } from '../../types/spark-extension.js';
import type { SparkToolDefinition } from './spark-voice-transports.js';

export type SparkToolRisk = 'low' | 'medium' | 'high';
export type SparkToolParallelism = 'never' | 'read_only' | 'resource_scoped';

/** Per-tool execution policy (the MVP subset of the v5 ToolExecutionPolicy). */
export interface SparkToolExecutionPolicy {
  risk: SparkToolRisk;
  /** Coordination/permission scope label (informational for the ledger). */
  permission: string;
  parallelism: SparkToolParallelism;
  /** When true the tool is hidden from the model schema and blocked unless approved. */
  requiresApproval: boolean;
  /** When false, the handler must not persist durable memory. */
  memoryWriteAllowed: boolean;
  streamingSafe?: boolean;
  latencyBudgetMs?: number;
}

export interface SparkToolActionResult {
  ok: boolean;
  name: string;
  value?: unknown;
  userMessage?: string;
  blocked?: boolean;
  error?: { code: string; message: string };
  durationMs: number;
}

export interface SparkToolDispatchContext {
  /** Whether the user has approved this specific call (gates requiresApproval tools). */
  approved?: boolean;
  /** Whether the current turn is complete + uninterrupted (gates memory writes). */
  turnComplete?: boolean;
  signal?: AbortSignal;
}

export type SparkToolHandler = (
  args: unknown,
  ctx: SparkToolDispatchContext,
) => Promise<unknown> | unknown;

export interface SparkVoiceTool {
  definition: SparkToolDefinition;
  policy: SparkToolExecutionPolicy;
  handler: SparkToolHandler;
  /** Original brain skill id, when this tool bridges a skill. */
  skillId?: string;
}

export interface SparkToolDispatcher {
  /** Provider-native schemas for policy-visible (non-approval) executable tools. */
  listDefinitions: () => SparkToolDefinition[];
  /** All registered tool names (including hidden approval-required ones). */
  listNames: () => string[];
  dispatch: (
    name: string,
    rawArgs: unknown,
    ctx?: SparkToolDispatchContext,
  ) => Promise<SparkToolActionResult>;
}

/** OpenAI tool-name charset: ^[a-zA-Z0-9_-]{1,64}$ — sanitize skill ids. */
export function sanitizeToolName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'tool';
}

/** Parse tool-call argument JSON safely; `{}` for empty/invalid. */
function parseArgs(raw: unknown): unknown {
  if (raw == null || raw === '') {
    return {};
  }
  if (typeof raw !== 'string') {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function createSparkToolDispatcher(
  tools: SparkVoiceTool[],
  now: () => number = () => Date.now(),
): SparkToolDispatcher {
  const byName = new Map<string, SparkVoiceTool>();
  for (const tool of tools) {
    byName.set(tool.definition.function.name, tool);
  }

  return {
    listDefinitions() {
      // Only policy-visible, executable tools are advertised to the model.
      return tools
        .filter((tool) => !tool.policy.requiresApproval)
        .map((tool) => tool.definition);
    },
    listNames() {
      return [...byName.keys()];
    },
    async dispatch(name, rawArgs, ctx = {}) {
      const started = now();
      const tool = byName.get(name);
      if (!tool) {
        return {
          ok: false,
          name,
          blocked: true,
          error: { code: 'unknown_tool', message: `Tool ${name} is not registered.` },
          durationMs: now() - started,
        };
      }
      // Policy preflight: approval-required tools are blocked unless approved.
      if (tool.policy.requiresApproval && !ctx.approved) {
        return {
          ok: false,
          name,
          blocked: true,
          error: {
            code: 'approval_required',
            message: `Tool ${name} requires explicit approval.`,
          },
          durationMs: now() - started,
        };
      }
      // No durable memory writes on partial/interrupted turns.
      if (tool.policy.memoryWriteAllowed && ctx.turnComplete === false) {
        return {
          ok: false,
          name,
          blocked: true,
          error: {
            code: 'partial_turn_write_blocked',
            message: `Tool ${name} cannot write memory on an incomplete turn.`,
          },
          durationMs: now() - started,
        };
      }
      try {
        const value = await tool.handler(parseArgs(rawArgs), ctx);
        return { ok: true, name, value, durationMs: now() - started };
      } catch (error) {
        return {
          ok: false,
          name,
          error: {
            code: 'handler_error',
            message: error instanceof Error ? error.message : 'Tool handler failed.',
          },
          durationMs: now() - started,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Brain-skill → voice-tool bridge
// ---------------------------------------------------------------------------

/** Skill permissions that imply durable memory writes. */
const MEMORY_WRITE_PERMISSIONS = new Set(['memory.write', 'memory.save', 'vault.write']);
/** Skill permissions that require explicit user approval to run. */
const APPROVAL_PERMISSIONS = new Set(['memory.write', 'memory.save', 'vault.write', 'approval.required']);

/**
 * Minimal fixed host tool catalog (v4 ToolRegistry MVP: "Vault recall /
 * read-only status"). These are executed directly by the host (Vault is in the
 * main process) so a real, policy-gated, read-only tool is demoable without the
 * brain runtime exposing skill execution. All are read-only — no memory writes.
 */
/** A renderable canvas payload Spark can push to the live session canvas. */
export interface SparkCanvasToolItem {
  kind: string;
  payload: unknown;
}

export interface SparkHostToolDeps {
  /** Read-only Vault memory recall, returns reference material for a query. */
  recallMemory?: (query: string) => Promise<unknown> | unknown;
  /** Render an item to the session canvas (markdown/table/result/artifact). */
  showOnCanvas?: (item: SparkCanvasToolItem) => void;
}

export function buildSparkHostTools(deps: SparkHostToolDeps): SparkVoiceTool[] {
  const tools: SparkVoiceTool[] = [];
  if (deps.recallMemory) {
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'recall_memory',
          description: "Search the user's Vault memory for relevant past context. Read-only.",
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'What to recall' } },
            required: ['query'],
          },
        },
      },
      policy: {
        risk: 'low',
        permission: 'vault.read',
        parallelism: 'read_only',
        requiresApproval: false,
        memoryWriteAllowed: false,
        streamingSafe: true,
      },
      handler: (args) => {
        const query =
          args && typeof args === 'object' ? String((args as { query?: unknown }).query ?? '') : '';
        return deps.recallMemory!(query);
      },
    });
  }
  if (deps.showOnCanvas) {
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'show_on_canvas',
          description:
            'Render content to the live canvas so the user can see it: write notes, show a worked solution, a table, or a result. Use this to "show your work" instead of only speaking.',
          parameters: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['markdown', 'table', 'result', 'artifact'],
                description: 'markdown text, an array of row objects (table), or an object (result/artifact)',
              },
              payload: {
                type: 'string',
                description:
                  'Markdown text for kind=markdown; otherwise a JSON string (an array of row objects for table, an object for result/artifact).',
              },
            },
            required: ['kind', 'payload'],
          },
        },
      },
      policy: {
        risk: 'low',
        permission: 'ui.canvas',
        parallelism: 'read_only',
        requiresApproval: false,
        memoryWriteAllowed: false,
        streamingSafe: true,
      },
      handler: (args) => {
        const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
        const kind = typeof record.kind === 'string' ? record.kind : 'markdown';
        // The realtime schema sends payload as a string; for non-markdown kinds
        // the model passes JSON — parse it back so the canvas gets real data.
        let payload = record.payload;
        if (kind !== 'markdown' && typeof payload === 'string') {
          try {
            payload = JSON.parse(payload);
          } catch {
            /* not JSON — fall through with the raw string */
          }
        }
        deps.showOnCanvas!({ kind, payload });
        return { ok: true, message: 'Displayed on the canvas.' };
      },
    });
  }
  return tools;
}

// ---------------------------------------------------------------------------
// Brain runtime tool-registry → voice-tool bridge (roadmap E)
// ---------------------------------------------------------------------------

/**
 * Minimal structural view of the `@spark/core` `ToolRegistry` that the Wave 8
 * brain runtime exposes as `runtime.runtimeToolRegistry`. The Vault host loads
 * the brain as built ESM, so we mirror only the fields we read; the real
 * registry structurally satisfies this.
 */
export interface BrainToolPolicyLike {
  risk?: string;
  permission?: string;
  requiresApproval?: boolean;
  memoryWriteAllowed?: boolean;
  streamingSafe?: boolean;
}

export interface BrainToolDefinitionLike {
  name: string;
  description?: string;
  schema?: Record<string, unknown>;
  policy?: BrainToolPolicyLike;
}

export interface BrainToolActionResultLike {
  ok: boolean;
  value?: unknown;
  userMessage?: string;
  blocked?: boolean;
  error?: { code?: string; message?: string };
}

export interface BrainToolDispatchResultLike {
  ok: boolean;
  value?: BrainToolActionResultLike;
  error?: { code?: string; message?: string };
}

export interface BrainToolRegistryLike {
  listExecutable(): BrainToolDefinitionLike[];
  dispatch(call: {
    callId: string;
    turnId?: string;
    name: string;
    args: unknown;
  }): Promise<BrainToolDispatchResultLike> | BrainToolDispatchResultLike;
}

export interface BuildVoiceToolsFromBrainRegistryOptions {
  /** Prefix for generated dispatch call ids. */
  idPrefix?: string;
  /** Tool names already taken by host tools — skip them to avoid collisions. */
  reservedNames?: Iterable<string>;
}

/** Map an `@spark/core` ToolRisk onto the MVP SparkToolRisk (critical → high). */
function mapBrainRisk(risk: string | undefined): SparkToolRisk {
  return risk === 'high' || risk === 'critical' ? 'high' : risk === 'medium' ? 'medium' : 'low';
}

function normalizeBrainSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  return schema && typeof schema === 'object' ? schema : { type: 'object', properties: {} };
}

/**
 * Bridge the brain runtime's executable tools into dispatchable voice tools, so
 * the realtime model can actually run the brain's policy-gated skills (not just
 * recall + canvas). Each tool's handler delegates to `registry.dispatch`; the
 * SparkResult/ToolActionResult is unwrapped to the action value, and failures
 * throw so the outer dispatcher reports `ok:false`. Approval-required tools keep
 * `requiresApproval`, so they stay hidden from the model schema and blocked
 * unless approved — the "policy-visible tools only" rule.
 */
export function buildVoiceToolsFromBrainRegistry(
  registry: BrainToolRegistryLike,
  options: BuildVoiceToolsFromBrainRegistryOptions = {},
): SparkVoiceTool[] {
  const reserved = new Set(options.reservedNames ?? []);
  let defs: BrainToolDefinitionLike[];
  try {
    defs = registry.listExecutable() ?? [];
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const tools: SparkVoiceTool[] = [];
  let seq = 0;
  for (const def of defs) {
    if (!def || typeof def.name !== 'string' || !def.name) {
      continue;
    }
    if (reserved.has(def.name) || seen.has(def.name)) {
      continue;
    }
    seen.add(def.name);
    const toolPolicy = def.policy ?? {};
    const definition: SparkToolDefinition = {
      type: 'function',
      function: {
        name: def.name,
        description: def.description ?? def.name,
        parameters: normalizeBrainSchema(def.schema),
      },
    };
    const policy: SparkToolExecutionPolicy = {
      risk: mapBrainRisk(toolPolicy.risk),
      permission: toolPolicy.permission ?? 'brain.skill',
      parallelism: 'read_only',
      requiresApproval: toolPolicy.requiresApproval ?? false,
      memoryWriteAllowed: toolPolicy.memoryWriteAllowed ?? false,
      streamingSafe: toolPolicy.streamingSafe ?? true,
    };
    tools.push({
      definition,
      policy,
      handler: async (args) => {
        const callId = `${options.idPrefix ?? 'spark_rt'}_${(seq += 1)}`;
        const result = await registry.dispatch({ callId, name: def.name, args });
        if (!result || result.ok !== true) {
          throw new Error(result?.error?.message ?? `Tool ${def.name} failed.`);
        }
        const action = result.value;
        if (action && action.ok === false) {
          throw new Error(action.error?.message ?? action.userMessage ?? `Tool ${def.name} was blocked.`);
        }
        return action?.value ?? action?.userMessage ?? { ok: true };
      },
    });
  }
  return tools;
}

export type SparkSkillExecutor = (skillId: string, args: unknown) => Promise<unknown> | unknown;

/**
 * Map the brain runtime's policy-gated skills into dispatchable voice tools.
 * Only skills that are enabled AND have an executable registration become tools
 * — exactly the "policy-visible tools only" rule. Execution is delegated to the
 * injected `executeSkill`, which in the host wires into the brain runtime.
 */
export function buildVoiceToolsFromSkillRows(
  rows: SparkSkillRow[],
  executeSkill: SparkSkillExecutor,
): SparkVoiceTool[] {
  return rows
    .filter((row) => row.enabled && row.hasExecutableRegistration)
    .map((row) => {
      const permissions = row.permissions ?? [];
      const memoryWriteAllowed = permissions.some((p) => MEMORY_WRITE_PERMISSIONS.has(p));
      const requiresApproval = permissions.some((p) => APPROVAL_PERMISSIONS.has(p));
      const name = sanitizeToolName(row.skillId);
      const definition: SparkToolDefinition = {
        type: 'function',
        function: {
          name,
          description: `${row.name} (${row.namespace})`,
          parameters: { type: 'object', properties: {}, additionalProperties: true },
        },
      };
      const policy: SparkToolExecutionPolicy = {
        risk: requiresApproval ? 'high' : 'low',
        permission: row.namespace,
        parallelism: 'read_only',
        requiresApproval,
        memoryWriteAllowed,
        streamingSafe: true,
      };
      return {
        definition,
        policy,
        skillId: row.skillId,
        handler: (args: unknown) => executeSkill(row.skillId, args),
      };
    });
}
