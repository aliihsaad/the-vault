import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ACTOR_KINDS,
  APPROVAL_DECISIONS,
  EVIDENCE_KINDS,
  LOOP_OUTCOMES,
  LOOP_PRIORITIES,
  LOOP_STATES,
  LOOP_TRIGGER_KINDS,
  PROJECT_TYPES,
  PROJECT_LIFECYCLE_STATES,
  WORK_INTENTS,
  OpenLoopServiceError,
  type Vault,
} from '@the-vault/core';

export function registerOpenLoopsV2McpTools(server: McpServer, vault: Vault): void {
  const trustedActor = () => vault.getOpenLoopInstallationDefaults().actor;
  server.tool(
    'vault_create_project',
    'Create a new explicitly typed Work Project or Brain / Memory-Context Project. Legacy unclassified is not accepted.',
    {
      name: z.string().min(1).max(100),
      project_type: z.enum(PROJECT_TYPES).refine((value) => value !== 'unclassified'),
      description: z.string().max(5000).optional(),
      canonical_root: z.string().max(2000).optional(),
      repository_url: z.string().max(2000).optional(),
      default_branch: z.string().max(200).optional(),
      owner_actor_uid: z.string().max(200).optional(),
      owner_role: z.string().max(100).optional(),
      memory_purpose: z.string().max(5000).optional(),
      authorization_policy_id: z.string().max(200).optional(),
      evidence_policy_id: z.string().max(200).optional(),
      type_config: z.record(z.unknown()).optional(),
    },
    async (args) => toolResult(() => vault.createProject({
      name: args.name,
      projectType: args.project_type as 'work_project' | 'brain_context',
      description: args.description,
      canonicalRoot: args.canonical_root,
      repositoryUrl: args.repository_url,
      defaultBranch: args.default_branch,
      ownerActorUid: args.owner_actor_uid,
      ownerRole: args.owner_role,
      memoryPurpose: args.memory_purpose,
      authorizationPolicyId: args.authorization_policy_id,
      evidencePolicyId: args.evidence_policy_id,
      typeConfig: args.type_config,
    })),
  );

  server.tool(
    'vault_transition_project_lifecycle',
    'Govern a classified project lifecycle transition (including activation or rollback) with authorization, optimistic concurrency, idempotency, and persisted evidence.',
    {
      project: z.string().min(1).max(200),
      next_state: z.enum(PROJECT_LIFECYCLE_STATES),
      reason: z.string().min(1).max(2000),
      evidence: z.array(z.object({
        kind: z.enum(EVIDENCE_KINDS),
        reference: z.string().min(1).max(4000),
        description: z.string().min(1).max(2000),
        immutable_hash: z.string().min(8).max(256).optional(),
      })).max(50).optional(),
      expected_version: z.number().int().min(0),
      idempotency_key: z.string().min(1).max(200),
      authorization_request_uid: z.string().max(200).optional(),
    },
    async (args) => toolResult(() => vault.transitionProjectLifecycle({
      project: args.project,
      nextState: args.next_state,
      reason: args.reason,
      evidence: args.evidence?.map((item) => ({
        kind: item.kind,
        reference: item.reference,
        description: item.description,
        immutableHash: item.immutable_hash,
      })),
      actor: trustedActor(),
      expectedVersion: args.expected_version,
      idempotencyKey: args.idempotency_key,
      authorizationRequestUid: args.authorization_request_uid,
    })),
  );

  server.tool(
    'vault_create_open_loop',
    'Strictly admit a dedicated executable commitment for a typed Work Project. Writes one loop row and immutable creation event transactionally.',
    {
      project_uid: z.string().min(1).max(200),
      title: z.string().min(1).max(200),
      commitment: z.string().min(1).max(5000),
      deferred_reason: z.string().min(1).max(2000),
      owner_kind: z.enum(ACTOR_KINDS),
      owner_reference: z.string().min(1).max(200),
      immediate_next_action: z.string().min(1).max(2000),
      trigger_kind: z.enum(LOOP_TRIGGER_KINDS),
      trigger_value: z.string().min(1).max(2000),
      current_evidence_summary: z.string().min(1).max(5000),
      closure_criteria: z.string().min(1).max(5000),
      priority: z.enum(LOOP_PRIORITIES),
      dedupe_key: z.string().min(1).max(300),
      source_memory_uid: z.string().max(200).optional(),
      source_task_uid: z.string().max(200).optional(),
      source_session_uid: z.string().max(200).optional(),
      source_handoff_uid: z.string().max(200).optional(),
      external_reference: z.string().max(2000).optional(),
      source_context: z.record(z.unknown()),
      authorization_request_uid: z.string().max(200).optional(),
      idempotency_key: z.string().min(1).max(200),
      correlation_uid: z.string().max(200).optional(),
    },
    async (args) => toolResult(() => vault.createOpenLoop({
      projectUid: args.project_uid,
      title: args.title,
      commitment: args.commitment,
      deferredReason: args.deferred_reason,
      ownerKind: args.owner_kind,
      ownerReference: args.owner_reference,
      immediateNextAction: args.immediate_next_action,
      triggerKind: args.trigger_kind,
      triggerValue: args.trigger_value,
      currentEvidenceSummary: args.current_evidence_summary,
      closureCriteria: args.closure_criteria,
      priority: args.priority,
      dedupeKey: args.dedupe_key,
      sourceMemoryUid: args.source_memory_uid,
      sourceTaskUid: args.source_task_uid,
      sourceSessionUid: args.source_session_uid,
      sourceHandoffUid: args.source_handoff_uid,
      externalReference: args.external_reference,
      sourceContext: args.source_context,
      creatingActor: trustedActor(),
      authorizationRequestUid: args.authorization_request_uid,
      idempotencyKey: args.idempotency_key,
      correlationUid: args.correlation_uid,
    })),
  );

  server.tool(
    'vault_get_open_loop',
    'Read one dedicated Open-Loops v2 record from the open_loops table.',
    { loop_uid: z.string().min(1).max(200) },
    async (args) => toolResult(() => ({ source: 'dedicated_open_loops', item: vault.getDedicatedOpenLoop(args.loop_uid) })),
  );

  server.tool(
    'vault_list_dedicated_open_loops',
    'List dedicated Open-Loops v2 records. This reads open_loops; vault_list_open_loops remains the legacy memory_items compatibility read.',
    {
      project_uid: z.string().max(200).optional(),
      states: z.array(z.enum(LOOP_STATES)).max(20).optional(),
      include_resolved: z.boolean().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
      offset: z.number().int().min(0).optional(),
    },
    async (args) => toolResult(() => vault.listDedicatedOpenLoops({
      projectUid: args.project_uid,
      states: args.states,
      includeResolved: args.include_resolved,
      limit: args.limit,
      offset: args.offset,
    })),
  );

  server.tool(
    'vault_count_dedicated_open_loops',
    'Count dedicated Open-Loops v2 records. This reads open_loops; vault_count_open_loops remains the legacy memory_items compatibility read.',
    {
      project_uid: z.string().max(200).optional(),
      states: z.array(z.enum(LOOP_STATES)).max(20).optional(),
      include_resolved: z.boolean().optional(),
      by_project: z.boolean().optional(),
    },
    async (args) => toolResult(() => vault.countDedicatedOpenLoops({
      projectUid: args.project_uid,
      states: args.states,
      includeResolved: args.include_resolved,
      byProject: args.by_project,
    })),
  );

  server.tool(
    'vault_add_loop_evidence',
    'Append immutable evidence references to a dedicated loop with optimistic concurrency and a transactional event.',
    {
      loop_uid: z.string().min(1).max(200),
      evidence: z.array(z.object({
        kind: z.enum(EVIDENCE_KINDS),
        reference: z.string().min(1).max(4000),
        description: z.string().min(1).max(2000),
        immutable_hash: z.string().min(8).max(256).optional(),
      })).min(1).max(50),
      current_evidence_summary: z.string().min(1).max(5000),
      expected_version: z.number().int().positive(),
      idempotency_key: z.string().min(1).max(200),
      transition_to_verification: z.boolean().optional(),
      correlation_uid: z.string().max(200).optional(),
    },
    async (args) => toolResult(() => vault.addLoopEvidence({
      loopUid: args.loop_uid,
      evidence: args.evidence.map((item) => ({
        kind: item.kind,
        reference: item.reference,
        description: item.description,
        immutableHash: item.immutable_hash,
      })),
      currentEvidenceSummary: args.current_evidence_summary,
      actor: trustedActor(),
      expectedVersion: args.expected_version,
      idempotencyKey: args.idempotency_key,
      transitionToVerification: args.transition_to_verification,
      correlationUid: args.correlation_uid,
    })),
  );

  server.tool(
    'vault_evaluate_project_gate',
    'Evaluate the deterministic per-project gate in shadow mode. The result is audited but does not enforce or block real work in Phases A-D.',
    {
      project_uid: z.string().min(1).max(200),
      work_intent: z.enum(WORK_INTENTS),
      related_loop_uid: z.string().max(200).optional(),
      authorization_request_uid: z.string().max(200).optional(),
      idempotency_key: z.string().min(1).max(200),
    },
    async (args) => toolResult(() => vault.evaluateProjectGate({
      projectUid: args.project_uid,
      workIntent: args.work_intent,
      relatedLoopUid: args.related_loop_uid,
      actor: trustedActor(),
      authorizationRequestUid: args.authorization_request_uid,
      idempotencyKey: args.idempotency_key,
    })),
  );

  registerSnoozeAndResolutionTools(server, vault, trustedActor);
  registerClassificationAndMigrationTools(server, vault, trustedActor);
}

function registerSnoozeAndResolutionTools(
  server: McpServer,
  vault: Vault,
  trustedActor: () => ReturnType<Vault['getOpenLoopInstallationDefaults']>['actor'],
): void {
  server.tool(
    'vault_request_loop_snooze',
    'Request a visible, time- or dependency-bounded snooze for a dedicated loop. The loop remains blocking until the configured policy approves.',
    {
      loop_uid: z.string().min(1).max(200),
      reason: z.string().min(1).max(2000),
      snoozed_until: z.string().datetime({ offset: true }).optional(),
      dependency_trigger: z.string().min(1).max(2000).optional(),
      expected_version: z.number().int().positive(),
      idempotency_key: z.string().min(1).max(200),
    },
    async (args) => toolResult(() => vault.requestLoopSnooze({
      loopUid: args.loop_uid,
      reason: args.reason,
      snoozedUntil: args.snoozed_until,
      dependencyTrigger: args.dependency_trigger,
      requester: trustedActor(),
      expectedVersion: args.expected_version,
      idempotencyKey: args.idempotency_key,
    })),
  );

  server.tool(
    'vault_decide_loop_snooze',
    'Record one authorized snooze decision. Owner, role, quorum, and external policy modes are resolved in core.',
    {
      request_uid: z.string().min(1).max(200),
      loop_uid: z.string().min(1).max(200),
      decision: z.enum(APPROVAL_DECISIONS),
      reason: z.string().min(1).max(2000),
      expected_version: z.number().int().positive(),
      idempotency_key: z.string().min(1).max(200),
    },
    async (args) => toolResult(() => vault.decideLoopSnooze({
      requestUid: args.request_uid,
      loopUid: args.loop_uid,
      decision: args.decision,
      reason: args.reason,
      approver: trustedActor(),
      expectedVersion: args.expected_version,
      idempotencyKey: args.idempotency_key,
    })),
  );

  server.tool(
    'vault_resolve_open_loop',
    'Resolve a dedicated loop with outcome-specific evidence, expected_version, immutable event history, and gate read-back.',
    {
      loop_uid: z.string().min(1).max(200),
      outcome: z.enum(LOOP_OUTCOMES),
      resolution_note: z.string().min(1).max(5000),
      expected_version: z.number().int().positive(),
      idempotency_key: z.string().min(1).max(200),
      duplicate_of_loop_uid: z.string().max(200).optional(),
      correlation_uid: z.string().max(200).optional(),
    },
    async (args) => toolResult(() => vault.resolveOpenLoop({
      loopUid: args.loop_uid,
      outcome: args.outcome,
      resolutionNote: args.resolution_note,
      verifier: trustedActor(),
      expectedVersion: args.expected_version,
      idempotencyKey: args.idempotency_key,
      duplicateOfLoopUid: args.duplicate_of_loop_uid,
      correlationUid: args.correlation_uid,
    })),
  );

  server.tool(
    'vault_recover_open_loop',
    'Governed recovery of a resolved dedicated loop. Requires policy authorization, a reason, idempotency, and expected_version.',
    {
      loop_uid: z.string().min(1).max(200),
      reason: z.string().min(1).max(5000),
      expected_version: z.number().int().positive(),
      idempotency_key: z.string().min(1).max(200),
      authorization_request_uid: z.string().max(200).optional(),
      recovery_state: z.enum(['open', 'verification_needed', 'awaiting_approval', 'awaiting_user', 'externally_blocked']).optional(),
      correlation_uid: z.string().max(200).optional(),
    },
    async (args) => toolResult(() => vault.recoverOpenLoop({
      loopUid: args.loop_uid,
      reason: args.reason,
      actor: trustedActor(),
      expectedVersion: args.expected_version,
      idempotencyKey: args.idempotency_key,
      authorizationRequestUid: args.authorization_request_uid,
      recoveryState: args.recovery_state,
      correlationUid: args.correlation_uid,
    })),
  );
}

const ProjectConfigShape = {
  description: z.string().max(5000).optional(),
  canonical_root: z.string().max(2000).optional(),
  repository_url: z.string().max(2000).optional(),
  default_branch: z.string().max(200).optional(),
  owner_actor_uid: z.string().max(200).optional(),
  owner_role: z.string().max(100).optional(),
  memory_purpose: z.string().max(5000).optional(),
  authorization_policy_id: z.string().max(200).optional(),
  evidence_policy_id: z.string().max(200).optional(),
  type_config: z.record(z.unknown()).optional(),
};

const ProjectConfigSchema = z.object(ProjectConfigShape);

function registerClassificationAndMigrationTools(
  server: McpServer,
  vault: Vault,
  trustedActor: () => ReturnType<Vault['getOpenLoopInstallationDefaults']>['actor'],
): void {
  server.tool(
    'vault_classify_project',
    'Dry-run or apply governed classification of a legacy-unclassified project. No project type is inferred from its name.',
    {
      project: z.string().min(1).max(200),
      target_type: z.enum(['work_project', 'brain_context']),
      config: ProjectConfigSchema,
      expected_version: z.number().int().min(0),
      idempotency_key: z.string().min(1).max(200),
      authorization_request_uid: z.string().max(200).optional(),
      dry_run: z.boolean().optional(),
    },
    async (args) => toolResult(() => vault.classifyProject({
      project: args.project,
      targetType: args.target_type,
      config: projectConfigFrom(args.config),
      actor: trustedActor(),
      expectedVersion: args.expected_version,
      idempotencyKey: args.idempotency_key,
      authorizationRequestUid: args.authorization_request_uid,
      dryRun: args.dry_run,
    })),
  );

  server.tool(
    'vault_convert_project_type',
    'Dry-run or apply governed Work ↔ Brain conversion. Work-to-Brain refuses nonterminal dedicated loops; every conversion remains shadow mode.',
    {
      project: z.string().min(1).max(200),
      target_type: z.enum(['work_project', 'brain_context']),
      config: ProjectConfigSchema,
      reason: z.string().min(1).max(2000),
      expected_version: z.number().int().min(0),
      idempotency_key: z.string().min(1).max(200),
      authorization_request_uid: z.string().max(200).optional(),
      dry_run: z.boolean().optional(),
    },
    async (args) => toolResult(() => vault.convertProjectType({
      project: args.project,
      targetType: args.target_type,
      config: projectConfigFrom(args.config),
      reason: args.reason,
      actor: trustedActor(),
      expectedVersion: args.expected_version,
      idempotencyKey: args.idempotency_key,
      authorizationRequestUid: args.authorization_request_uid,
      dryRun: args.dry_run,
    })),
  );

  server.tool(
    'vault_inventory_legacy_loop_candidates',
    'Read-only Phase C report of legacy next_steps, snoozes, active debugging rows, and resolved rows. It never creates a dedicated loop.',
    { project: z.string().max(200).optional() },
    async (args) => toolResult(() => vault.inventoryLegacyLoopCandidates(args.project)),
  );

  server.tool(
    'vault_get_open_loop_shadow_telemetry',
    'Compare legacy memory-derived and dedicated open-loop counts in shadow mode. Gate enforcement is always false in Phases A-D.',
    { project: z.string().max(200).optional() },
    async (args) => toolResult(() => vault.getOpenLoopShadowTelemetry(args.project)),
  );
}

function projectConfigFrom(input: z.infer<typeof ProjectConfigSchema>) {
  return {
    description: input.description,
    canonicalRoot: input.canonical_root,
    repositoryUrl: input.repository_url,
    defaultBranch: input.default_branch,
    ownerActorUid: input.owner_actor_uid,
    ownerRole: input.owner_role,
    memoryPurpose: input.memory_purpose,
    authorizationPolicyId: input.authorization_policy_id,
    evidencePolicyId: input.evidence_policy_id,
    typeConfig: input.type_config,
  };
}

async function toolResult<T>(operation: () => T) {
  try {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(operation(), null, 2) }],
    };
  } catch (error) {
    const payload = error instanceof OpenLoopServiceError
      ? { success: false, error: error.message, reason_code: error.code, details: error.details }
      : { success: false, error: error instanceof Error ? error.message : String(error) };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      isError: true,
    };
  }
}
