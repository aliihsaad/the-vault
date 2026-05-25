// ============================================================================
// Vault — Database Schema (Drizzle ORM)
// All table definitions for the SQLite registry.
// ============================================================================

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

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
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

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
