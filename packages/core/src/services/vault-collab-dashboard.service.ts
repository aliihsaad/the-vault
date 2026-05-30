import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { detectVaultCollabRuntime } from './vault-collab-runtime.service.js';
import type {
  VaultCollabClientType,
  VaultCollabDashboardCounts,
  VaultCollabDashboardOptions,
  VaultCollabDashboardSnapshot,
  VaultCollabDiscussionThreadStatus,
  VaultCollabDiscussionThreadSummary,
  VaultCollabEventSnapshot,
  VaultCollabHandoffPriority,
  VaultCollabHandoffSnapshot,
  VaultCollabHandoffStatus,
  VaultCollabJsonRecord,
  VaultCollabLaunchRequestSnapshot,
  VaultCollabLaunchRequestStatus,
  VaultCollabRuntimeConfig,
  VaultCollabSessionConnectionState,
  VaultCollabSessionSnapshot,
  VaultCollabSessionStatus,
} from '../types/vault-collab.js';

const DEFAULT_SESSION_LIMIT = 12;
const DEFAULT_HANDOFF_LIMIT = 20;
const DEFAULT_LAUNCH_REQUEST_LIMIT = 20;
const DEFAULT_EVENT_LIMIT = 24;
const DEFAULT_STALE_SESSION_AFTER_MS = 15 * 60 * 1000;
const DEFAULT_STALE_SESSION_VISIBILITY_MS = 2 * 60 * 60 * 1000;
const DEFAULT_CLOSED_SESSION_VISIBILITY_MS = 6 * 60 * 60 * 1000;
const MAX_SESSION_SCAN_LIMIT = 200;
const REQUIRED_TABLES = ['sessions', 'handoffs', 'events'];
const CLOSED_HANDOFF_STATUSES: VaultCollabHandoffStatus[] = ['resolved', 'abandoned', 'stale'];
const PERMISSION_REQUEST_EVENT_TYPES = new Set([
  'session.permission_requested',
  'handoff.permission_requested',
]);
const ATTENTION_PING_EVENT_TYPE = 'session.pinged';
const ACTIVE_LAUNCH_REQUEST_STATUSES: VaultCollabLaunchRequestStatus[] = [
  'requested',
  'approved',
  'launching',
  'running',
];

interface SessionRow {
  session_uid: string;
  display_name: string;
  client_type: string;
  project: string;
  workspace_path: string;
  status: string;
  status_detail: string | null;
  capabilities_json: string;
  agent_uid: string | null;
  agent_stable_name: string | null;
  agent_display_name: string | null;
  agent_role: string | null;
  current_handoff_uid: string | null;
  last_heartbeat_at: string;
  created_at: string;
  updated_at: string;
  disconnected_at: string | null;
}

interface HandoffRow {
  handoff_uid: string;
  vault_memory_uid: string | null;
  short_prompt: string;
  source_project: string;
  target_project: string;
  related_projects_json: string;
  related_files_json: string;
  source_session_uid: string | null;
  suggested_session_uid: string | null;
  suggested_client_type: string | null;
  queue_key: string;
  labels_json: string;
  queue_position: number | null;
  depends_on_handoff_uid: string | null;
  status: string;
  priority: string;
  urgent: 0 | 1;
  claimed_by_session_uid: string | null;
  lease_expires_at: string | null;
  progress_note: string | null;
  resolution_summary: string | null;
  reopen_reason: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  stale_at: string | null;
}

interface EventRow {
  event_id: number;
  handoff_uid: string | null;
  session_uid: string | null;
  event_type: string;
  payload_json: string;
  created_at: string;
}

interface LaunchRequestRow {
  launch_request_uid: string;
  provider: string;
  model: string | null;
  effort_level: string | null;
  project: string | null;
  workspace_path: string | null;
  role: string | null;
  initial_instructions: string | null;
  permission_mode: string | null;
  command_preview: string | null;
  requested_capabilities_json: string | null;
  approval_policy_version: string | null;
  approval_snapshot_json: string | null;
  status: string;
  status_detail: string | null;
  requested_by_session_uid: string | null;
  approved_by_session_uid: string | null;
  rejected_by_session_uid: string | null;
  broker_session_uid: string | null;
  launched_session_uid: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface DiscussionThreadRow {
  thread_uid: string;
  handoff_uid: string | null;
  project: string;
  title: string;
  status: string;
  created_by_session_uid: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  message_count: number;
  last_message_at: string | null;
}

export function getVaultCollabDashboardSnapshot(
  config: VaultCollabRuntimeConfig,
  options: VaultCollabDashboardOptions = {},
): VaultCollabDashboardSnapshot {
  const runtimeStatus = detectVaultCollabRuntime(config);
  const base = createEmptySnapshot(config.databasePath, runtimeStatus.configured, runtimeStatus.ready, runtimeStatus.message);

  if (!runtimeStatus.database.available || !existsSync(config.databasePath)) {
    return {
      ...base,
      dataReady: false,
    };
  }

  let db: Database.Database | null = null;
  try {
    db = openReadOnlyVaultCollabDatabase(config.databasePath);
    if (!hasVaultCollabDashboardTables(db)) {
      return {
        ...base,
        dataReady: false,
        message: 'Vault Collab database exists, but collaboration tables are not initialized yet.',
      };
    }

    const now = options.now ?? new Date();
    const staleSessionAfterMs = Math.max(1, options.staleSessionAfterMs ?? DEFAULT_STALE_SESSION_AFTER_MS);
    const staleSessionVisibilityMs = Math.max(staleSessionAfterMs, options.staleSessionVisibilityMs ?? DEFAULT_STALE_SESSION_VISIBILITY_MS);
    const closedSessionVisibilityMs = Math.max(0, options.closedSessionVisibilityMs ?? DEFAULT_CLOSED_SESSION_VISIBILITY_MS);
    const sessions = listSessions(
      db,
      clampLimit(options.sessionLimit, DEFAULT_SESSION_LIMIT),
      now,
      staleSessionAfterMs,
      staleSessionVisibilityMs,
      closedSessionVisibilityMs,
    );
    const handoffs = listOpenHandoffs(db, clampLimit(options.handoffLimit, DEFAULT_HANDOFF_LIMIT));
    const launchRequests = listLaunchRequests(db, clampLimit(options.launchRequestLimit, DEFAULT_LAUNCH_REQUEST_LIMIT));
    const events = listRecentEvents(db, clampLimit(options.eventLimit, DEFAULT_EVENT_LIMIT));

    return {
      ...base,
      dataReady: true,
      sessions,
      handoffs,
      launchRequests,
      events,
      counts: buildDashboardCounts(sessions, handoffs, launchRequests, events),
    };
  } catch (error) {
    return {
      ...base,
      dataReady: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      message: 'Vault Collab dashboard data could not be read from the configured database.',
    };
  } finally {
    db?.close();
  }
}

function openReadOnlyVaultCollabDatabase(databasePath: string): Database.Database {
  const nativeBinding = process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING?.trim();
  return nativeBinding
    ? new Database(databasePath, { readonly: true, fileMustExist: true, nativeBinding })
    : new Database(databasePath, { readonly: true, fileMustExist: true });
}

function hasVaultCollabDashboardTables(db: Database.Database): boolean {
  return REQUIRED_TABLES.every((table) => tableExists(db, table));
}

function listSessions(
  db: Database.Database,
  limit: number,
  now: Date,
  staleSessionAfterMs: number,
  staleSessionVisibilityMs: number,
  closedSessionVisibilityMs: number,
): VaultCollabSessionSnapshot[] {
  const scanLimit = Math.min(MAX_SESSION_SCAN_LIMIT, Math.max(limit, limit * 8));
  const hasSessionAgentUid = columnExists(db, 'sessions', 'agent_uid');
  const hasAgentProfiles = hasSessionAgentUid && tableExists(db, 'agent_profiles');
  const hasAgentStableName = hasAgentProfiles && columnExists(db, 'agent_profiles', 'stable_name');
  const hasAgentDisplayName = hasAgentProfiles && columnExists(db, 'agent_profiles', 'display_name');
  const hasAgentRole = hasAgentProfiles && columnExists(db, 'agent_profiles', 'role');
  const agentJoin = hasAgentProfiles
    ? 'LEFT JOIN agent_profiles ON agent_profiles.agent_uid = sessions.agent_uid'
    : '';
  const agentUidSelect = hasSessionAgentUid ? 'sessions.agent_uid' : 'NULL';
  const agentNameSelect = hasAgentStableName ? 'agent_profiles.stable_name' : 'NULL';
  const agentDisplayNameSelect = hasAgentDisplayName ? 'agent_profiles.display_name' : 'NULL';
  const agentRoleSelect = hasAgentRole ? 'agent_profiles.role' : 'NULL';

  const rows = db.prepare(`
    SELECT
      sessions.session_uid,
      sessions.display_name,
      sessions.client_type,
      sessions.project,
      sessions.workspace_path,
      sessions.status,
      sessions.status_detail,
      sessions.capabilities_json,
      ${agentUidSelect} AS agent_uid,
      ${agentNameSelect} AS agent_stable_name,
      ${agentDisplayNameSelect} AS agent_display_name,
      ${agentRoleSelect} AS agent_role,
      sessions.current_handoff_uid,
      sessions.last_heartbeat_at,
      sessions.created_at,
      sessions.updated_at,
      sessions.disconnected_at
    FROM sessions
    ${agentJoin}
    ORDER BY sessions.updated_at DESC, sessions.session_uid ASC
    LIMIT ?
  `).all(scanLimit) as SessionRow[];

  return rows
    .map((row) => mapSessionRow(row, now, staleSessionAfterMs))
    .filter((session) => shouldShowSession(session, now, staleSessionVisibilityMs, closedSessionVisibilityMs))
    .sort(compareSessionsForLiveView)
    .slice(0, limit);
}

function listOpenHandoffs(db: Database.Database, limit: number): VaultCollabHandoffSnapshot[] {
  const queueKeySelect = columnExists(db, 'handoffs', 'queue_key') ? 'queue_key' : "'default'";
  const labelsSelect = columnExists(db, 'handoffs', 'labels_json') ? 'labels_json' : "'[]'";
  const queuePositionSelect = columnExists(db, 'handoffs', 'queue_position') ? 'queue_position' : 'NULL';
  const dependsOnSelect = columnExists(db, 'handoffs', 'depends_on_handoff_uid') ? 'depends_on_handoff_uid' : 'NULL';

  const rows = db.prepare(`
    SELECT
      handoff_uid,
      vault_memory_uid,
      short_prompt,
      source_project,
      target_project,
      related_projects_json,
      related_files_json,
      source_session_uid,
      suggested_session_uid,
      suggested_client_type,
      ${queueKeySelect} AS queue_key,
      ${labelsSelect} AS labels_json,
      ${queuePositionSelect} AS queue_position,
      ${dependsOnSelect} AS depends_on_handoff_uid,
      status,
      priority,
      urgent,
      claimed_by_session_uid,
      lease_expires_at,
      progress_note,
      resolution_summary,
      reopen_reason,
      created_at,
      updated_at,
      resolved_at,
      stale_at
    FROM handoffs
    WHERE status NOT IN (?, ?, ?)
    ORDER BY urgent DESC,
      queue_key ASC,
      CASE WHEN queue_position IS NULL THEN 1 ELSE 0 END ASC,
      queue_position ASC,
      created_at ASC,
      handoff_uid ASC
    LIMIT ?
  `).all(...CLOSED_HANDOFF_STATUSES, limit) as HandoffRow[];

  const discussionThreadsByHandoff = listDiscussionThreadSummaries(
    db,
    rows.map((row) => row.handoff_uid),
  );

  return rows.map((row) => ({
    ...mapHandoffRow(row),
    discussionThreads: discussionThreadsByHandoff.get(row.handoff_uid) ?? [],
  }));
}

function listRecentEvents(db: Database.Database, limit: number): VaultCollabEventSnapshot[] {
  const rows = db.prepare(`
    SELECT event_id, handoff_uid, session_uid, event_type, payload_json, created_at
    FROM events
    ORDER BY event_id DESC
    LIMIT ?
  `).all(limit) as EventRow[];

  return rows.map((row) => ({
    eventId: row.event_id,
    handoffUid: row.handoff_uid,
    sessionUid: row.session_uid,
    eventType: row.event_type,
    payload: parseJsonRecord(row.payload_json),
    createdAt: row.created_at,
  }));
}

function listLaunchRequests(db: Database.Database, limit: number): VaultCollabLaunchRequestSnapshot[] {
  if (!tableExists(db, 'launch_requests')) {
    return [];
  }

  const effortLevelSelect = columnExists(db, 'launch_requests', 'effort_level') ? 'effort_level' : 'NULL';
  const roleSelect = columnExists(db, 'launch_requests', 'role') ? 'role' : 'NULL';
  const initialInstructionsSelect = columnExists(db, 'launch_requests', 'initial_instructions') ? 'initial_instructions' : "''";
  const permissionModeSelect = columnExists(db, 'launch_requests', 'permission_mode') ? 'permission_mode' : "''";
  const commandPreviewSelect = columnExists(db, 'launch_requests', 'command_preview') ? 'command_preview' : 'NULL';
  const requestedCapabilitiesSelect = columnExists(db, 'launch_requests', 'requested_capabilities_json') ? 'requested_capabilities_json' : "'[]'";
  const approvalPolicyVersionSelect = columnExists(db, 'launch_requests', 'approval_policy_version') ? 'approval_policy_version' : 'NULL';
  const approvalSnapshotSelect = columnExists(db, 'launch_requests', 'approval_snapshot_json') ? 'approval_snapshot_json' : 'NULL';
  const statusDetailSelect = columnExists(db, 'launch_requests', 'status_detail') ? 'status_detail' : 'NULL';
  const approvedBySelect = columnExists(db, 'launch_requests', 'approved_by_session_uid') ? 'approved_by_session_uid' : 'NULL';
  const rejectedBySelect = columnExists(db, 'launch_requests', 'rejected_by_session_uid') ? 'rejected_by_session_uid' : 'NULL';
  const brokerSelect = columnExists(db, 'launch_requests', 'broker_session_uid') ? 'broker_session_uid' : 'NULL';
  const launchedSelect = columnExists(db, 'launch_requests', 'launched_session_uid') ? 'launched_session_uid' : 'NULL';
  const metadataSelect = columnExists(db, 'launch_requests', 'metadata_json') ? 'metadata_json' : "'{}'";
  const approvedAtSelect = columnExists(db, 'launch_requests', 'approved_at') ? 'approved_at' : 'NULL';
  const rejectedAtSelect = columnExists(db, 'launch_requests', 'rejected_at') ? 'rejected_at' : 'NULL';
  const startedAtSelect = columnExists(db, 'launch_requests', 'started_at') ? 'started_at' : 'NULL';
  const completedAtSelect = columnExists(db, 'launch_requests', 'completed_at') ? 'completed_at' : 'NULL';

  const rows = db.prepare(`
    SELECT
      launch_request_uid,
      provider,
      model,
      ${effortLevelSelect} AS effort_level,
      project,
      workspace_path,
      ${roleSelect} AS role,
      ${initialInstructionsSelect} AS initial_instructions,
      ${permissionModeSelect} AS permission_mode,
      ${commandPreviewSelect} AS command_preview,
      ${requestedCapabilitiesSelect} AS requested_capabilities_json,
      ${approvalPolicyVersionSelect} AS approval_policy_version,
      ${approvalSnapshotSelect} AS approval_snapshot_json,
      status,
      ${statusDetailSelect} AS status_detail,
      requested_by_session_uid,
      ${approvedBySelect} AS approved_by_session_uid,
      ${rejectedBySelect} AS rejected_by_session_uid,
      ${brokerSelect} AS broker_session_uid,
      ${launchedSelect} AS launched_session_uid,
      ${metadataSelect} AS metadata_json,
      created_at,
      updated_at,
      ${approvedAtSelect} AS approved_at,
      ${rejectedAtSelect} AS rejected_at,
      ${startedAtSelect} AS started_at,
      ${completedAtSelect} AS completed_at
    FROM launch_requests
    ORDER BY
      CASE status
        WHEN 'requested' THEN 0
        WHEN 'approved' THEN 1
        WHEN 'launching' THEN 2
        WHEN 'running' THEN 3
        WHEN 'failed' THEN 4
        WHEN 'rejected' THEN 5
        WHEN 'cancelled' THEN 6
        ELSE 7
      END ASC,
      updated_at DESC,
      created_at DESC,
      launch_request_uid ASC
    LIMIT ?
  `).all(limit) as LaunchRequestRow[];

  return rows.map(mapLaunchRequestRow);
}

function mapSessionRow(row: SessionRow, now: Date, staleSessionAfterMs: number): VaultCollabSessionSnapshot {
  const status = parseSessionStatus(row.status);
  const heartbeatAgeMs = getAgeMs(now, row.last_heartbeat_at);
  const connectionState = getSessionConnectionState(status, row.disconnected_at, heartbeatAgeMs, staleSessionAfterMs);
  const effectiveStatus = connectionState === 'disconnected' ? 'disconnected' : status;

  return {
    sessionUid: row.session_uid,
    displayName: row.display_name,
    clientType: parseClientType(row.client_type),
    project: row.project,
    workspacePath: row.workspace_path,
    status,
    effectiveStatus,
    connectionState,
    statusDetail: row.status_detail,
    capabilities: parseJsonRecord(row.capabilities_json),
    agentUid: row.agent_uid,
    agentName: row.agent_stable_name,
    agentDisplayName: row.agent_display_name,
    agentRole: row.agent_role,
    currentHandoffUid: row.current_handoff_uid,
    lastHeartbeatAt: row.last_heartbeat_at,
    heartbeatAgeMs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disconnectedAt: row.disconnected_at,
  };
}

function mapHandoffRow(row: HandoffRow): VaultCollabHandoffSnapshot {
  return {
    handoffUid: row.handoff_uid,
    vaultMemoryUid: row.vault_memory_uid,
    shortPrompt: row.short_prompt,
    sourceProject: row.source_project,
    targetProject: row.target_project,
    relatedProjects: parseStringArray(row.related_projects_json),
    relatedFiles: parseStringArray(row.related_files_json),
    sourceSessionUid: row.source_session_uid,
    suggestedSessionUid: row.suggested_session_uid,
    suggestedClientType: row.suggested_client_type ? parseClientType(row.suggested_client_type) : null,
    queueKey: row.queue_key || 'default',
    labels: parseStringArray(row.labels_json),
    queuePosition: row.queue_position,
    dependsOnHandoffUid: row.depends_on_handoff_uid,
    status: parseHandoffStatus(row.status),
    priority: parseHandoffPriority(row.priority),
    urgent: row.urgent === 1,
    claimedBySessionUid: row.claimed_by_session_uid,
    leaseExpiresAt: row.lease_expires_at,
    progressNote: row.progress_note,
    resolutionSummary: row.resolution_summary,
    reopenReason: row.reopen_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    staleAt: row.stale_at,
    discussionThreads: [],
  };
}

function mapLaunchRequestRow(row: LaunchRequestRow): VaultCollabLaunchRequestSnapshot {
  return {
    launchRequestUid: row.launch_request_uid,
    provider: parseClientType(row.provider),
    model: row.model ?? '',
    effortLevel: row.effort_level,
    project: row.project ?? '',
    workspacePath: row.workspace_path ?? '',
    role: row.role,
    initialInstructions: row.initial_instructions ?? '',
    permissionMode: row.permission_mode ?? '',
    commandPreview: row.command_preview,
    requestedCapabilities: parseStringArray(row.requested_capabilities_json ?? '[]'),
    approvalPolicyVersion: row.approval_policy_version,
    approvalSnapshot: row.approval_snapshot_json ? parseJsonRecord(row.approval_snapshot_json) : null,
    status: parseLaunchRequestStatus(row.status),
    statusDetail: row.status_detail,
    requestedBySessionUid: row.requested_by_session_uid,
    approvedBySessionUid: row.approved_by_session_uid,
    rejectedBySessionUid: row.rejected_by_session_uid,
    brokerSessionUid: row.broker_session_uid,
    launchedSessionUid: row.launched_session_uid,
    metadata: parseJsonRecord(row.metadata_json ?? '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function listDiscussionThreadSummaries(
  db: Database.Database,
  handoffUids: string[],
): Map<string, VaultCollabDiscussionThreadSummary[]> {
  const threadsByHandoff = new Map<string, VaultCollabDiscussionThreadSummary[]>();
  const uniqueHandoffUids = Array.from(new Set(handoffUids)).filter((handoffUid) => handoffUid.length > 0);
  if (uniqueHandoffUids.length === 0 || !tableExists(db, 'discussion_threads')) {
    return threadsByHandoff;
  }

  const hasMessages = tableExists(db, 'discussion_messages');
  const messageJoin = hasMessages
    ? 'LEFT JOIN discussion_messages ON discussion_messages.thread_uid = discussion_threads.thread_uid'
    : '';
  const messageCountSelect = hasMessages ? 'COUNT(discussion_messages.message_uid)' : '0';
  const lastMessageAtSelect = hasMessages ? 'MAX(discussion_messages.created_at)' : 'NULL';
  const placeholders = uniqueHandoffUids.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT
      discussion_threads.thread_uid,
      discussion_threads.handoff_uid,
      discussion_threads.project,
      discussion_threads.title,
      discussion_threads.status,
      discussion_threads.created_by_session_uid,
      discussion_threads.created_at,
      discussion_threads.updated_at,
      discussion_threads.resolved_at,
      ${messageCountSelect} AS message_count,
      ${lastMessageAtSelect} AS last_message_at
    FROM discussion_threads
    ${messageJoin}
    WHERE discussion_threads.handoff_uid IN (${placeholders})
    GROUP BY discussion_threads.thread_uid
    ORDER BY discussion_threads.created_at ASC, discussion_threads.thread_uid ASC
  `).all(...uniqueHandoffUids) as DiscussionThreadRow[];

  for (const row of rows) {
    if (!row.handoff_uid) {
      continue;
    }

    const thread = mapDiscussionThreadRow(row);
    const threads = threadsByHandoff.get(row.handoff_uid) ?? [];
    threads.push(thread);
    threadsByHandoff.set(row.handoff_uid, threads);
  }

  return threadsByHandoff;
}

function mapDiscussionThreadRow(row: DiscussionThreadRow): VaultCollabDiscussionThreadSummary {
  return {
    threadUid: row.thread_uid,
    handoffUid: row.handoff_uid,
    project: row.project,
    title: row.title,
    status: parseDiscussionThreadStatus(row.status),
    createdBySessionUid: row.created_by_session_uid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    messageCount: Number(row.message_count) || 0,
    lastMessageAt: row.last_message_at,
  };
}

function buildDashboardCounts(
  sessions: VaultCollabSessionSnapshot[],
  handoffs: VaultCollabHandoffSnapshot[],
  launchRequests: VaultCollabLaunchRequestSnapshot[],
  events: VaultCollabEventSnapshot[],
): VaultCollabDashboardCounts {
  const sessionsByStatus = emptySessionStatusCounts();
  const handoffsByStatus = emptyHandoffStatusCounts();
  const launchRequestsByStatus = emptyLaunchRequestStatusCounts();

  for (const session of sessions) {
    sessionsByStatus[session.effectiveStatus] += 1;
  }

  for (const handoff of handoffs) {
    handoffsByStatus[handoff.status] += 1;
  }

  for (const launchRequest of launchRequests) {
    launchRequestsByStatus[launchRequest.status] += 1;
  }

  const permissionNeededSessions = sessions.filter(isPermissionNeededSession).length;
  const permissionNeededHandoffs = handoffs.filter(isPermissionNeededHandoff).length;

  return {
    sessions: sessions.length,
    activeSessions: sessions.filter(isLiveSession).length,
    idleSessions: sessionsByStatus.idle,
    staleSessions: sessions.filter((session) => session.connectionState === 'stale').length,
    disconnectedSessions: sessions.filter((session) => session.connectionState === 'disconnected').length,
    openHandoffs: handoffs.length,
    availableHandoffs: handoffsByStatus.available,
    urgentHandoffs: handoffs.filter((handoff) => handoff.urgent || handoff.priority === 'urgent').length,
    permissionNeeded: permissionNeededSessions + permissionNeededHandoffs,
    permissionNeededSessions,
    permissionNeededHandoffs,
    permissionRequestEvents: events.filter(isPermissionRequestEvent).length,
    attentionPingEvents: events.filter(isAttentionPingEvent).length,
    launchRequests: launchRequests.length,
    activeLaunchRequests: launchRequests.filter(isActiveLaunchRequest).length,
    requestedLaunchRequests: launchRequestsByStatus.requested,
    approvedLaunchRequests: launchRequestsByStatus.approved,
    launchingLaunchRequests: launchRequestsByStatus.launching,
    runningLaunchRequests: launchRequestsByStatus.running,
    failedLaunchRequests: launchRequestsByStatus.failed,
    events: events.length,
    sessionsByStatus,
    handoffsByStatus,
    launchRequestsByStatus,
  };
}

function createEmptySnapshot(
  databasePath: string,
  configured: boolean,
  ready: boolean,
  message: string,
): VaultCollabDashboardSnapshot {
  return {
    configured,
    ready,
    dataReady: false,
    databasePath,
    message,
    errorMessage: null,
    sessions: [],
    handoffs: [],
    launchRequests: [],
    events: [],
    counts: {
      sessions: 0,
      activeSessions: 0,
      idleSessions: 0,
      staleSessions: 0,
      disconnectedSessions: 0,
      openHandoffs: 0,
      availableHandoffs: 0,
      urgentHandoffs: 0,
      permissionNeeded: 0,
      permissionNeededSessions: 0,
      permissionNeededHandoffs: 0,
      permissionRequestEvents: 0,
      attentionPingEvents: 0,
      launchRequests: 0,
      activeLaunchRequests: 0,
      requestedLaunchRequests: 0,
      approvedLaunchRequests: 0,
      launchingLaunchRequests: 0,
      runningLaunchRequests: 0,
      failedLaunchRequests: 0,
      events: 0,
      sessionsByStatus: emptySessionStatusCounts(),
      handoffsByStatus: emptyHandoffStatusCounts(),
      launchRequestsByStatus: emptyLaunchRequestStatusCounts(),
    },
  };
}

function emptySessionStatusCounts(): Record<VaultCollabSessionStatus, number> {
  return {
    idle: 0,
    working: 0,
    blocked: 0,
    awaiting_user: 0,
    awaiting_verification: 0,
    complete: 0,
    disconnected: 0,
  };
}

function emptyHandoffStatusCounts(): Record<VaultCollabHandoffStatus, number> {
  return {
    available: 0,
    claimed: 0,
    in_progress: 0,
    blocked: 0,
    awaiting_user: 0,
    verification_needed: 0,
    resolved: 0,
    abandoned: 0,
    stale: 0,
  };
}

function emptyLaunchRequestStatusCounts(): Record<VaultCollabLaunchRequestStatus, number> {
  return {
    requested: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
    launching: 0,
    running: 0,
    failed: 0,
  };
}

function getSessionConnectionState(
  status: VaultCollabSessionStatus,
  disconnectedAt: string | null,
  heartbeatAgeMs: number | null,
  staleSessionAfterMs: number,
): VaultCollabSessionConnectionState {
  if (status === 'disconnected' || disconnectedAt) {
    return 'disconnected';
  }

  if (heartbeatAgeMs !== null && heartbeatAgeMs > staleSessionAfterMs) {
    return 'stale';
  }

  return 'fresh';
}

function shouldShowSession(
  session: VaultCollabSessionSnapshot,
  now: Date,
  staleSessionVisibilityMs: number,
  closedSessionVisibilityMs: number,
): boolean {
  if (session.connectionState === 'fresh') {
    return true;
  }

  if (session.connectionState === 'stale') {
    return session.heartbeatAgeMs === null || session.heartbeatAgeMs <= staleSessionVisibilityMs;
  }

  if (closedSessionVisibilityMs === 0) {
    return false;
  }

  const closedAgeMs = getAgeMs(now, session.disconnectedAt ?? session.updatedAt);
  return closedAgeMs === null || closedAgeMs <= closedSessionVisibilityMs;
}

function compareSessionsForLiveView(
  left: VaultCollabSessionSnapshot,
  right: VaultCollabSessionSnapshot,
): number {
  const connectionDelta = getConnectionSortRank(left.connectionState) - getConnectionSortRank(right.connectionState);
  if (connectionDelta !== 0) {
    return connectionDelta;
  }

  const statusDelta = getSessionStatusSortRank(left.effectiveStatus) - getSessionStatusSortRank(right.effectiveStatus);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function getConnectionSortRank(state: VaultCollabSessionConnectionState): number {
  switch (state) {
    case 'fresh':
      return 0;
    case 'stale':
      return 1;
    case 'disconnected':
      return 2;
  }
}

function getSessionStatusSortRank(status: VaultCollabSessionStatus): number {
  if (isActiveSessionStatus(status)) {
    return 0;
  }

  switch (status) {
    case 'idle':
      return 1;
    case 'complete':
      return 2;
    case 'disconnected':
      return 3;
    default:
      return 4;
  }
}

function isActiveSessionStatus(status: VaultCollabSessionStatus): boolean {
  return status === 'working'
    || status === 'blocked'
    || status === 'awaiting_user'
    || status === 'awaiting_verification';
}

function isLiveSession(session: VaultCollabSessionSnapshot): boolean {
  return session.connectionState === 'fresh'
    && (session.effectiveStatus === 'idle' || isActiveSessionStatus(session.effectiveStatus));
}

function isPermissionNeededSession(session: VaultCollabSessionSnapshot): boolean {
  return session.effectiveStatus === 'awaiting_user';
}

function isPermissionNeededHandoff(handoff: VaultCollabHandoffSnapshot): boolean {
  return handoff.status === 'awaiting_user';
}

function isActiveLaunchRequest(launchRequest: VaultCollabLaunchRequestSnapshot): boolean {
  return ACTIVE_LAUNCH_REQUEST_STATUSES.includes(launchRequest.status);
}

function isPermissionRequestEvent(event: VaultCollabEventSnapshot): boolean {
  return PERMISSION_REQUEST_EVENT_TYPES.has(event.eventType);
}

function isAttentionPingEvent(event: VaultCollabEventSnapshot): boolean {
  return event.eventType === ATTENTION_PING_EVENT_TYPE;
}

function getAgeMs(now: Date, timestamp: string): number | null {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, now.getTime() - parsed);
}

function parseJsonRecord(value: string): VaultCollabJsonRecord {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as VaultCollabJsonRecord
      : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseClientType(value: string): VaultCollabClientType {
  return isAllowed(value, ['codex', 'claude-code', 'claude-desktop', 'octogent', 'gemini', 'opencode', 'other'])
    ? value
    : 'other';
}

function parseSessionStatus(value: string): VaultCollabSessionStatus {
  return isAllowed(value, ['idle', 'working', 'blocked', 'awaiting_user', 'awaiting_verification', 'complete', 'disconnected'])
    ? value
    : 'disconnected';
}

function parseHandoffStatus(value: string): VaultCollabHandoffStatus {
  return isAllowed(value, ['available', 'claimed', 'in_progress', 'blocked', 'awaiting_user', 'verification_needed', 'resolved', 'abandoned', 'stale'])
    ? value
    : 'stale';
}

function parseHandoffPriority(value: string): VaultCollabHandoffPriority {
  return isAllowed(value, ['low', 'normal', 'high', 'urgent'])
    ? value
    : 'normal';
}

function parseDiscussionThreadStatus(value: string): VaultCollabDiscussionThreadStatus {
  return isAllowed(value, ['open', 'resolved'])
    ? value
    : 'open';
}

function parseLaunchRequestStatus(value: string): VaultCollabLaunchRequestStatus {
  return isAllowed(value, ['requested', 'approved', 'rejected', 'cancelled', 'launching', 'running', 'failed'])
    ? value
    : 'failed';
}

function isAllowed<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.includes(value as T);
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { found: 1 } | undefined;
  return Boolean(row);
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  if (!tableExists(db, table)) {
    return false;
  }

  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (row) => row.name === column,
  );
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(100, Math.floor(Number(value))));
}
