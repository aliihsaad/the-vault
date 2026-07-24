// ============================================================================
// Vault — Database Schema (Drizzle ORM)
// All table definitions for the SQLite registry.
// ============================================================================

import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// memory_items — The core table
// ---------------------------------------------------------------------------
export const memoryItems = sqliteTable(
  'memory_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemUid: text('item_uid').unique().notNull(),
    title: text('title').notNull(),
    project: text('project').notNull(),
    sourceApp: text('source_app').notNull().default('manual'),
    sourceSessionId: text('source_session_id'),
    memoryType: text('memory_type').notNull(),
    subject: text('subject').notNull(),
    summary: text('summary').notNull(),
    content: text('content'),
    keywordsJson: text('keywords_json').notNull().default('[]'),
    tagsJson: text('tags_json').notNull().default('[]'),
    routineType: text('routine_type'),
    status: text('status').notNull().default('active'),
    priority: text('priority').notNull().default('normal'),
    promoted: integer('promoted', { mode: 'boolean' }).notNull().default(false),
    nextStepsJson: text('next_steps_json').notNull().default('[]'),
    relatedItemIdsJson: text('related_item_ids_json').notNull().default('[]'),
    relatedFilesJson: text('related_files_json').notNull().default('[]'),
    vaultPath: text('vault_path'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    lastAccessedAt: text('last_accessed_at'),
    accessCount: integer('access_count').notNull().default(0),
    // Open-loops snooze: if set and in the future, the item is hidden from
    // the open-loops panel. Filter-only — no schema impact on recall.
    snoozedUntil: text('snoozed_until'),
    // Resolution outcome: set by vault_resolve_loop. One of fixed, won't_fix,
    // obsolete, duplicate. Null until the loop is closed.
    outcome: text('outcome'),
  },
  (table) => [
    index('idx_memory_items_project').on(table.project),
    index('idx_memory_items_memory_type').on(table.memoryType),
    index('idx_memory_items_subject').on(table.subject),
    index('idx_memory_items_status').on(table.status),
    index('idx_memory_items_priority').on(table.priority),
    index('idx_memory_items_promoted').on(table.promoted),
    index('idx_memory_items_created_at').on(table.createdAt),
    index('idx_memory_items_updated_at').on(table.updatedAt),
    index('idx_memory_items_snoozed_until').on(table.snoozedUntil),
    index('idx_memory_items_outcome').on(table.outcome),
  ],
);

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------
export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').unique().notNull(),
  description: text('description'),
  projectUid: text('project_uid'),
  projectType: text('project_type'),
  lifecycleState: text('lifecycle_state'),
  authorizationPolicyId: text('authorization_policy_id'),
  evidencePolicyId: text('evidence_policy_id'),
  classificationVersion: integer('classification_version').notNull().default(0),
  classifiedByActorUid: text('classified_by_actor_uid'),
  classifiedAt: text('classified_at'),
  version: integer('version').notNull().default(0),
  canonicalRoot: text('canonical_root'),
  repositoryUrl: text('repository_url'),
  defaultBranch: text('default_branch'),
  ownerActorUid: text('owner_actor_uid'),
  ownerRole: text('owner_role'),
  memoryPurpose: text('memory_purpose'),
  typeConfigJson: text('type_config_json').notNull().default('{}'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex('idx_projects_project_uid').on(table.projectUid),
  index('idx_projects_project_type').on(table.projectType),
  index('idx_projects_lifecycle_state').on(table.lifecycleState),
  index('idx_projects_authorization_policy').on(table.authorizationPolicyId),
]);

// ---------------------------------------------------------------------------
// project_relationships — Lineage / association links between projects
// (mirrors memory_links but at project scope)
// ---------------------------------------------------------------------------
export const projectRelationships = sqliteTable(
  'project_relationships',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceProject: text('source_project').notNull(),
    targetProject: text('target_project').notNull(),
    linkType: text('link_type').notNull(),
    note: text('note'),
    confidence: integer('confidence'), // 0-100, agent's certainty
    createdBy: text('created_by').notNull().default('user'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_project_relationships_source').on(table.sourceProject),
    index('idx_project_relationships_target').on(table.targetProject),
    index('idx_project_relationships_link_type').on(table.linkType),
  ],
);

// ---------------------------------------------------------------------------
// project_proposals — Pending agent proposals awaiting user decision
// (description / relationship / merge — see types/index.ts ProjectProposalPayload)
// ---------------------------------------------------------------------------
export const projectProposals = sqliteTable(
  'project_proposals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    proposalUid: text('proposal_uid').unique().notNull(),
    project: text('project').notNull(),
    proposalType: text('proposal_type').notNull(),
    payloadJson: text('payload_json').notNull(),
    rationale: text('rationale'),
    confidence: integer('confidence'),
    status: text('status').notNull().default('pending'),
    sourceTaskUid: text('source_task_uid'),
    evidenceItemUidsJson: text('evidence_item_uids_json').notNull().default('[]'),
    createdBy: text('created_by').notNull().default('agent'),
    decidedBy: text('decided_by'),
    decidedAt: text('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_project_proposals_project').on(table.project),
    index('idx_project_proposals_status').on(table.status),
    index('idx_project_proposals_proposal_type').on(table.proposalType),
    index('idx_project_proposals_created_at').on(table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// tags
// ---------------------------------------------------------------------------
export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').unique().notNull(),
  normalizedName: text('normalized_name').notNull(),
  category: text('category'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ---------------------------------------------------------------------------
// memory_links
// ---------------------------------------------------------------------------
export const memoryLinks = sqliteTable('memory_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceItemId: text('source_item_id').notNull(),
  targetItemId: text('target_item_id').notNull(),
  linkType: text('link_type').notNull().default('related'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ---------------------------------------------------------------------------
// activity_logs
// ---------------------------------------------------------------------------
export const activityLogs = sqliteTable(
  'activity_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    timestamp: text('timestamp')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    sourceClient: text('source_client').notNull(),
    project: text('project'),
    actionType: text('action_type').notNull(),
    targetItemId: text('target_item_id'),
    status: text('status').notNull().default('success'),
    latencyMs: integer('latency_ms'),
    aiUsed: integer('ai_used', { mode: 'boolean' }).notNull().default(false),
    message: text('message'),
    metadataJson: text('metadata_json'),
  },
  (table) => [
    index('idx_activity_logs_timestamp').on(table.timestamp),
    index('idx_activity_logs_action_type').on(table.actionType),
    index('idx_activity_logs_project').on(table.project),
  ],
);

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').unique().notNull(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ---------------------------------------------------------------------------
// tasks — First-class task queue for delegated work
// ---------------------------------------------------------------------------
export const tasks = sqliteTable(
  'tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskUid: text('task_uid').unique().notNull(),
    title: text('title').notNull(),
    taskType: text('task_type').notNull(),
    status: text('status').notNull().default('pending'),
    priority: text('priority').notNull().default('normal'),
    project: text('project'),
    prompt: text('prompt').notNull(),
    contextJson: text('context_json').notNull().default('{}'),
    routedModel: text('routed_model'),
    resultText: text('result_text'),
    resultMetadataJson: text('result_metadata_json'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(2),
    parentTaskUid: text('parent_task_uid'),
    sourceMemoryUid: text('source_memory_uid'),
    targetMemoryUid: text('target_memory_uid'),
    idempotencyKey: text('idempotency_key').unique(),
    createdBy: text('created_by').notNull().default('system'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_tasks_status').on(table.status),
    index('idx_tasks_task_type').on(table.taskType),
    index('idx_tasks_priority').on(table.priority),
    index('idx_tasks_project').on(table.project),
    index('idx_tasks_created_at').on(table.createdAt),
    index('idx_tasks_parent_task_uid').on(table.parentTaskUid),
  ],
);

// ---------------------------------------------------------------------------
// graphify_project_state — Queryable product state for the optional Graphify
// extension. Machine-local runtime paths live in JSON config, not here.
// ---------------------------------------------------------------------------
export const graphifyProjectState = sqliteTable(
  'graphify_project_state',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    project: text('project').unique().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    sourceRoot: text('source_root'),
    freshness: text('freshness').notNull().default('missing'),
    buildMode: text('build_mode').notNull().default('fast'),
    latestBuildId: text('latest_build_id'),
    graphJsonPath: text('graph_json_path'),
    graphHtmlPath: text('graph_html_path'),
    graphReportPath: text('graph_report_path'),
    graphSvgPath: text('graph_svg_path'),
    nodeCount: integer('node_count'),
    edgeCount: integer('edge_count'),
    communityCount: integer('community_count'),
    failureCount: integer('failure_count').notNull().default(0),
    lastError: text('last_error'),
    detectedGraphifyVersion: text('detected_graphify_version'),
    lastBuildStartedAt: text('last_build_started_at'),
    lastBuildCompletedAt: text('last_build_completed_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_graphify_project_state_project').on(table.project),
    index('idx_graphify_project_state_freshness').on(table.freshness),
    index('idx_graphify_project_state_enabled').on(table.enabled),
    index('idx_graphify_project_state_latest_build_id').on(table.latestBuildId),
  ],
);

// ---------------------------------------------------------------------------
// graphify_builds — Build history and artifact snapshots for Graphify.
// ---------------------------------------------------------------------------
export const graphifyBuilds = sqliteTable(
  'graphify_builds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    buildId: text('build_id').unique().notNull(),
    project: text('project').notNull(),
    status: text('status').notNull(),
    buildMode: text('build_mode').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    artifactJson: text('artifact_json'),
    graphStatsJson: text('graph_stats_json'),
    detectedGraphifyVersion: text('detected_graphify_version'),
    logPath: text('log_path'),
    errorMessage: text('error_message'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_graphify_builds_project').on(table.project),
    index('idx_graphify_builds_status').on(table.status),
    index('idx_graphify_builds_started_at').on(table.startedAt),
  ],
);

// ---------------------------------------------------------------------------
// Open-Loops v2 governance and dedicated lifecycle tables
// ---------------------------------------------------------------------------
export const authorizationPolicies = sqliteTable(
  'authorization_policies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    policyUid: text('policy_uid').unique().notNull(),
    name: text('name').notNull(),
    mode: text('mode').notNull(),
    ownerActorUid: text('owner_actor_uid'),
    allowedRolesJson: text('allowed_roles_json').notNull().default('[]'),
    quorum: integer('quorum').notNull().default(1),
    externalProvider: text('external_provider'),
    actionsJson: text('actions_json').notNull().default('[]'),
    version: integer('version').notNull().default(1),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_authorization_policies_mode').on(table.mode),
    index('idx_authorization_policies_enabled').on(table.enabled),
  ],
);

export const evidencePolicies = sqliteTable('evidence_policies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  policyUid: text('policy_uid').unique().notNull(),
  name: text('name').notNull(),
  requirementsJson: text('requirements_json').notNull(),
  version: integer('version').notNull().default(1),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const openLoops = sqliteTable(
  'open_loops',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    loopUid: text('loop_uid').unique().notNull(),
    projectUid: text('project_uid').notNull(),
    title: text('title').notNull(),
    commitment: text('commitment').notNull(),
    deferredReason: text('deferred_reason').notNull(),
    ownerKind: text('owner_kind').notNull(),
    ownerReference: text('owner_reference').notNull(),
    immediateNextAction: text('immediate_next_action').notNull(),
    triggerKind: text('trigger_kind').notNull(),
    triggerValue: text('trigger_value').notNull(),
    currentEvidenceSummary: text('current_evidence_summary').notNull(),
    closureCriteria: text('closure_criteria').notNull(),
    evidenceJson: text('evidence_json').notNull().default('[]'),
    state: text('state').notNull().default('open'),
    terminalOutcome: text('terminal_outcome'),
    priority: text('priority').notNull(),
    blockingScope: text('blocking_scope').notNull().default('project'),
    dedupeKey: text('dedupe_key').notNull(),
    sourceMemoryUid: text('source_memory_uid'),
    sourceTaskUid: text('source_task_uid'),
    sourceSessionUid: text('source_session_uid'),
    sourceHandoffUid: text('source_handoff_uid'),
    externalReference: text('external_reference'),
    sourceContextJson: text('source_context_json').notNull(),
    creatingActorUid: text('creating_actor_uid').notNull(),
    creatingActorKind: text('creating_actor_kind').notNull(),
    resumeState: text('resume_state'),
    snoozedUntil: text('snoozed_until'),
    dependencyTrigger: text('dependency_trigger'),
    resolutionNote: text('resolution_note'),
    resolvedAt: text('resolved_at'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_open_loops_project_state').on(table.projectUid, table.state),
    index('idx_open_loops_snooze_expiry').on(table.snoozedUntil),
    index('idx_open_loops_owner').on(table.ownerKind, table.ownerReference),
    index('idx_open_loops_priority').on(table.priority),
    index('idx_open_loops_trigger').on(table.triggerKind, table.triggerValue),
  ],
);

export const loopEvents = sqliteTable(
  'loop_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventUid: text('event_uid').unique().notNull(),
    loopUid: text('loop_uid').notNull(),
    idempotencyKey: text('idempotency_key').unique().notNull(),
    eventType: text('event_type').notNull(),
    actorUid: text('actor_uid').notNull(),
    actorKind: text('actor_kind').notNull(),
    authorizationPolicyUid: text('authorization_policy_uid'),
    authorizationPolicyVersion: integer('authorization_policy_version'),
    previousState: text('previous_state'),
    nextState: text('next_state'),
    payloadJson: text('payload_json').notNull().default('{}'),
    evidenceReferencesJson: text('evidence_references_json').notNull().default('[]'),
    resultJson: text('result_json').notNull(),
    correlationUid: text('correlation_uid'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_loop_events_loop').on(table.loopUid, table.createdAt),
    index('idx_loop_events_type').on(table.eventType),
  ],
);

export const approvalRequests = sqliteTable(
  'approval_requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    requestUid: text('request_uid').unique().notNull(),
    action: text('action').notNull(),
    targetUid: text('target_uid').notNull(),
    policyUid: text('policy_uid').notNull(),
    policyVersion: integer('policy_version').notNull(),
    requesterActorUid: text('requester_actor_uid').notNull(),
    requesterActorKind: text('requester_actor_kind').notNull(),
    scopeJson: text('scope_json').notNull().default('{}'),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: text('expires_at'),
    triggerJson: text('trigger_json'),
    idempotencyKey: text('idempotency_key').unique().notNull(),
    createdAt: text('created_at').notNull(),
    decidedAt: text('decided_at'),
  },
  (table) => [
    index('idx_approval_requests_target').on(table.targetUid, table.action),
    index('idx_approval_requests_status').on(table.status),
  ],
);

export const approvalRecords = sqliteTable(
  'approval_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    approvalUid: text('approval_uid').unique().notNull(),
    requestUid: text('request_uid').notNull(),
    action: text('action').notNull(),
    targetUid: text('target_uid').notNull(),
    policyUid: text('policy_uid').notNull(),
    policyVersion: integer('policy_version').notNull(),
    actorUid: text('actor_uid').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorRolesJson: text('actor_roles_json').notNull().default('[]'),
    decision: text('decision').notNull(),
    scopeJson: text('scope_json').notNull().default('{}'),
    reason: text('reason').notNull(),
    externalDecisionId: text('external_decision_id'),
    // Identifier of the external authority that issued this decision. Persisted
    // so the evaluator can bind it to the policy's configured externalProvider.
    externalProvider: text('external_provider'),
    eventUid: text('event_uid'),
    idempotencyKey: text('idempotency_key').unique().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_approval_records_request_actor').on(table.requestUid, table.actorUid),
    index('idx_approval_records_target').on(table.targetUid, table.action),
  ],
);

export const projectEvents = sqliteTable(
  'project_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventUid: text('event_uid').unique().notNull(),
    projectUid: text('project_uid').notNull(),
    idempotencyKey: text('idempotency_key').unique().notNull(),
    eventType: text('event_type').notNull(),
    actorUid: text('actor_uid').notNull(),
    actorKind: text('actor_kind').notNull(),
    authorizationPolicyUid: text('authorization_policy_uid').notNull(),
    authorizationPolicyVersion: integer('authorization_policy_version').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    resultJson: text('result_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_project_events_project').on(table.projectUid, table.createdAt),
    index('idx_project_events_type').on(table.eventType),
  ],
);

export const gateEvents = sqliteTable(
  'gate_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventUid: text('event_uid').unique().notNull(),
    projectUid: text('project_uid').notNull(),
    relatedLoopUid: text('related_loop_uid'),
    idempotencyKey: text('idempotency_key').unique().notNull(),
    workIntent: text('work_intent').notNull(),
    actorUid: text('actor_uid').notNull(),
    actorKind: text('actor_kind').notNull(),
    decision: text('decision').notNull(),
    reasonCode: text('reason_code').notNull(),
    blockerUidsJson: text('blocker_uids_json').notNull().default('[]'),
    resultJson: text('result_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_gate_events_project').on(table.projectUid, table.createdAt),
    index('idx_gate_events_decision').on(table.decision),
  ],
);

export const migrationLedger = sqliteTable('migration_ledger', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  migrationUid: text('migration_uid').unique().notNull(),
  phase: text('phase').notNull(),
  version: integer('version').notNull(),
  preStateJson: text('pre_state_json').notNull(),
  appliedAt: text('applied_at').notNull(),
});
