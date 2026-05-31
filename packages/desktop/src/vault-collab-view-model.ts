import type {
  VaultCollabDashboardSnapshot,
  VaultCollabDeliveryAttemptSnapshot,
  VaultCollabEventSnapshot,
  VaultCollabHandoffSnapshot,
  VaultCollabLaunchRequestSnapshot,
  VaultCollabSessionSnapshot,
} from '@the-vault/core';

const SESSION_PERMISSION_REQUESTED_EVENT = 'session.permission_requested';
const HANDOFF_PERMISSION_REQUESTED_EVENT = 'handoff.permission_requested';
const SESSION_PINGED_EVENT = 'session.pinged';
const LAUNCH_REQUEST_EVENT_PREFIX = 'launch_request.';

export interface VaultCollabStatusItem {
  label: string;
  tone: 'neutral' | 'good' | 'attention' | 'muted';
}

export interface VaultCollabSessionRow {
  uid: string;
  shortUid: string;
  displayName: string;
  secondary: string;
  statusLabel: string;
  badgeClass: string;
  connectionLabel: string;
  connectionClass: string;
  heartbeatLabel: string;
  roleLabel: string | null;
  detail: string | null;
  deliveryLabel: string;
  deliveryDetail: string;
  lastAckLabel: string;
  lastDeliveryLabel: string | null;
  lastDeliveryDetail: string | null;
  lastDeliveryFailed: boolean;
  canRename: boolean;
  canClose: boolean;
  canPing: boolean;
  clientInitial: string;
  attention: boolean;
}

export interface VaultCollabSessionGroup {
  key: 'attention' | 'working' | 'idle' | 'stale';
  label: string;
  sessions: VaultCollabSessionRow[];
}

export interface VaultCollabHandoffRow {
  uid: string;
  shortUid: string;
  prompt: string;
  statusLabel: string;
  badgeClass: string;
  railClass: string;
  priorityLabel: string;
  routeLabel: string;
  queueLabel: string;
  ownerLabel: string;
  dependencyLabel: string | null;
  ageLabel: string;
  visibleLabels: string[];
  extraLabel: string | null;
  threadLabel: string | null;
  attention: boolean;
  urgent: boolean;
}

export interface VaultCollabLaunchRequestRow {
  uid: string;
  shortUid: string;
  title: string;
  statusLabel: string;
  badgeClass: string;
  railClass: string;
  providerLabel: string;
  routeLabel: string;
  actorLabel: string;
  ageLabel: string;
  detail: string;
  commandPreview: string | null;
  approvedLaunchCommand: string | null;
  capabilityLabel: string | null;
  actions: VaultCollabActionDescriptor[];
  attention: boolean;
}

export interface VaultCollabDetailMetaItem {
  label: string;
  value: string;
  mono?: boolean;
}

export interface VaultCollabDiscussionRow {
  uid: string;
  shortUid: string;
  title: string;
  status: string;
  badgeClass: string;
  summary: string;
}

export interface VaultCollabEventRow {
  id: number;
  type: string;
  timeLabel: string;
  summary: string;
}

export interface VaultCollabActionDescriptor {
  action:
    | 'claim'
    | 'release'
    | 'resolve'
    | 'reopen'
    | 'update_in_progress'
    | 'update_blocked'
    | 'update_awaiting_user'
    | 'update_verification_needed'
    | 'create_thread'
    | 'reply'
    | 'approve'
    | 'reject'
    | 'cancel'
    | 'mark_launching'
    | 'mark_running'
    | 'fail'
    | 'rename_session'
    | 'close_session'
    | 'ping_session';
  label: string;
  disabled: boolean;
  reason: string | null;
  tone: 'neutral' | 'primary' | 'warning' | 'danger';
}

export interface VaultCollabSelectedHandoff {
  uid: string;
  shortUid: string;
  prompt: string;
  statusLabel: string;
  badgeClass: string;
  attentionQuestion: string | null;
  progressNote: string | null;
  permissionMeta: string | null;
  meta: VaultCollabDetailMetaItem[];
  labels: string[];
  discussionThreads: VaultCollabDiscussionRow[];
  actions: VaultCollabActionDescriptor[];
  discussionAction: VaultCollabActionDescriptor;
  relatedFiles: string[];
}

export interface VaultCollabNeedsYouItem {
  kind: 'launch_approval' | 'handoff_blocked' | 'handoff_awaiting_user' | 'agent_blocked';
  id: string;
  title: string;
  subtitle?: string;
  actions: VaultCollabActionDescriptor[];
}

export interface VaultCollabRosterAgent {
  sessionUid: string;
  displayName: string;
  role: string;
  status: string;
  currentHandoffUid: string | null;
  freshness: 'fresh' | 'stale';
}

export interface VaultCollabRoleGroup {
  role: string;
  agents: VaultCollabRosterAgent[];
}

export type VaultCollabWorkColumnState =
  | 'available'
  | 'in_progress'
  | 'verification_needed'
  | 'blocked'
  | 'awaiting_user'
  | 'resolved';

export interface VaultCollabWorkCard extends VaultCollabHandoffRow {
  state: VaultCollabWorkColumnState;
}

export interface VaultCollabWorkColumn {
  state: VaultCollabWorkColumnState;
  label: string;
  cards: VaultCollabWorkCard[];
}

export interface VaultCollabConversationEntry {
  id: string;
  at: string;
  kind: 'message' | 'event';
  author?: string;
  body: string;
  handoffUid?: string;
}

export interface VaultCollabCockpitViewModel {
  needsYou: VaultCollabNeedsYouItem[];
  roster: VaultCollabRoleGroup[];
  work: VaultCollabWorkColumn[];
  conversation: VaultCollabConversationEntry[];
  selectedHandoff: VaultCollabSelectedHandoff | null;
}

export interface VaultCollabDashboardViewModelOptions {
  dashboardSessionUid?: string | null;
  approvedLaunchCommands?: Record<string, string>;
}

export interface VaultCollabDashboardViewModel {
  configured: boolean;
  dataReady: boolean;
  message: string;
  databasePath: string;
  errorMessage: string | null;
  statusLabel: string;
  attentionLabel: string;
  attentionActive: boolean;
  statusItems: string[];
  statusItemModels: VaultCollabStatusItem[];
  sessionGroups: VaultCollabSessionGroup[];
  launchRequestRows: VaultCollabLaunchRequestRow[];
  handoffRows: VaultCollabHandoffRow[];
  selectedHandoff: VaultCollabSelectedHandoff | null;
  eventRows: VaultCollabEventRow[];
  cockpit: VaultCollabCockpitViewModel;
}

export function buildVaultCollabDashboardViewModel(
  snapshot: VaultCollabDashboardSnapshot,
  now: Date = new Date(),
  selectedHandoffUid?: string | null,
  options: VaultCollabDashboardViewModelOptions = {},
): VaultCollabDashboardViewModel {
  const statusLabel = getDashboardStatusLabel(snapshot);
  const attentionLabel = snapshot.counts.permissionNeeded > 0
    ? `${snapshot.counts.permissionNeeded} need attention`
    : snapshot.counts.permissionRequestEvents > 0
      ? `${snapshot.counts.permissionRequestEvents} recent requests`
    : snapshot.counts.attentionPingEvents > 0
      ? `${snapshot.counts.attentionPingEvents} pings`
      : 'No attention';
  const attentionActive = snapshot.counts.permissionNeeded > 0
    || snapshot.counts.permissionRequestEvents > 0
    || snapshot.counts.attentionPingEvents > 0;
  const statusItemModels: VaultCollabStatusItem[] = [
    { label: statusLabel, tone: snapshot.dataReady ? 'good' : snapshot.ready ? 'attention' : 'muted' },
    { label: `Last refreshed ${formatRelativeAge(now, now)}`, tone: 'muted' },
    { label: attentionLabel, tone: attentionActive ? 'attention' : 'muted' },
    { label: `${snapshot.counts.activeSessions} active sessions`, tone: 'neutral' },
    ...(snapshot.counts.launchRequests > 0
      ? [{
        label: `${snapshot.counts.activeLaunchRequests} active launches`,
        tone: snapshot.counts.activeLaunchRequests > 0 ? 'attention' as const : 'muted' as const,
      }]
      : []),
    { label: `${snapshot.counts.openHandoffs} open handoffs`, tone: 'neutral' },
    { label: `${snapshot.counts.staleSessions} stale`, tone: snapshot.counts.staleSessions > 0 ? 'attention' : 'muted' },
  ];
  const selectedHandoff = getSelectedHandoff(snapshot.handoffs, selectedHandoffUid);
  const latestPermissionEventBySessionUid = getLatestEventBySessionUid(snapshot.events, SESSION_PERMISSION_REQUESTED_EVENT);
  const latestDeliveryAttemptBySessionUid = getLatestDeliveryAttemptBySessionUid(snapshot.deliveryAttempts ?? []);
  const failedDeliveryAttempts = (snapshot.deliveryAttempts ?? []).filter((attempt) => attempt.status === 'failed').length;
  if (snapshot.deliveryAttempts?.length) {
    statusItemModels.splice(statusItemModels.length - 1, 0, {
      label: `${failedDeliveryAttempts}/${snapshot.deliveryAttempts.length} delivery failed`,
      tone: failedDeliveryAttempts > 0 ? 'attention' : 'muted',
    });
  }
  const selectedPermissionEvent = selectedHandoff
    ? snapshot.events.find((event) => (
      event.handoffUid === selectedHandoff.handoffUid
      && event.eventType === HANDOFF_PERMISSION_REQUESTED_EVENT
    )) ?? null
    : null;
  const launchRequestRows = snapshot.launchRequests.map((launchRequest) => buildLaunchRequestRow(
    launchRequest,
    now,
    options.approvedLaunchCommands ?? {},
  ));
  const handoffRows = snapshot.handoffs.map((handoff) => buildHandoffRow(handoff, now));
  const selectedHandoffModel = selectedHandoff
    ? buildSelectedHandoff(selectedHandoff, selectedPermissionEvent, now, options.dashboardSessionUid ?? null)
    : null;
  const eventRows = buildEventRows(snapshot.events, selectedHandoff?.handoffUid ?? null, now);

  return {
    configured: snapshot.configured,
    dataReady: snapshot.dataReady,
    message: snapshot.message,
    databasePath: snapshot.databasePath,
    errorMessage: snapshot.errorMessage,
    statusLabel,
    attentionLabel,
    attentionActive,
    statusItems: statusItemModels.map((item) => item.label),
    statusItemModels,
    sessionGroups: buildSessionGroups(
      snapshot.sessions,
      latestPermissionEventBySessionUid,
      latestDeliveryAttemptBySessionUid,
      now,
      options.dashboardSessionUid ?? null,
    ),
    launchRequestRows,
    handoffRows,
    selectedHandoff: selectedHandoffModel,
    eventRows,
    cockpit: buildCockpitViewModel(
      snapshot,
      launchRequestRows,
      handoffRows,
      selectedHandoffModel,
      selectedHandoff?.handoffUid ?? null,
      now,
    ),
  };
}

const WORK_COLUMNS: Array<{ state: VaultCollabWorkColumnState; label: string }> = [
  { state: 'available', label: 'Available' },
  { state: 'in_progress', label: 'In progress' },
  { state: 'verification_needed', label: 'Needs verification' },
  { state: 'blocked', label: 'Blocked' },
  { state: 'awaiting_user', label: 'Needs user' },
  { state: 'resolved', label: 'Resolved' },
];

function buildCockpitViewModel(
  snapshot: VaultCollabDashboardSnapshot,
  launchRequestRows: VaultCollabLaunchRequestRow[],
  handoffRows: VaultCollabHandoffRow[],
  selectedHandoff: VaultCollabSelectedHandoff | null,
  selectedHandoffUid: string | null,
  now: Date,
): VaultCollabCockpitViewModel {
  return {
    needsYou: buildNeedsYouItems(snapshot, launchRequestRows, handoffRows),
    roster: buildRoleGroups(snapshot.sessions),
    work: buildWorkColumns(snapshot.handoffs, handoffRows),
    conversation: buildConversationEntries(snapshot.handoffs, snapshot.events, selectedHandoffUid, now),
    selectedHandoff,
  };
}

function buildNeedsYouItems(
  snapshot: VaultCollabDashboardSnapshot,
  launchRequestRows: VaultCollabLaunchRequestRow[],
  handoffRows: VaultCollabHandoffRow[],
): VaultCollabNeedsYouItem[] {
  const launchRowsByUid = new Map(launchRequestRows.map((row) => [row.uid, row]));
  const handoffRowsByUid = new Map(handoffRows.map((row) => [row.uid, row]));
  const items: VaultCollabNeedsYouItem[] = [];

  for (const launchRequest of snapshot.launchRequests) {
    if (launchRequest.status !== 'requested' && launchRequest.status !== 'approved') {
      continue;
    }

    const row = launchRowsByUid.get(launchRequest.launchRequestUid);
    items.push({
      kind: 'launch_approval',
      id: launchRequest.launchRequestUid,
      title: row?.title ?? launchRequest.model,
      subtitle: `${formatStatusLabel(launchRequest.status)} / ${launchRequest.project}`,
      actions: row?.actions ?? buildLaunchRequestActions(launchRequest),
    });
  }

  for (const handoff of snapshot.handoffs) {
    if (handoff.status !== 'blocked' && handoff.status !== 'awaiting_user') {
      continue;
    }

    const row = handoffRowsByUid.get(handoff.handoffUid);
    items.push({
      kind: handoff.status === 'blocked' ? 'handoff_blocked' : 'handoff_awaiting_user',
      id: handoff.handoffUid,
      title: handoff.shortPrompt,
      subtitle: handoff.progressNote ?? row?.statusLabel,
      actions: buildHandoffActions(handoff, null),
    });
  }

  for (const session of snapshot.sessions) {
    if (session.effectiveStatus !== 'blocked' || !isLiveRosterSession(session)) {
      continue;
    }

    items.push({
      kind: 'agent_blocked',
      id: session.sessionUid,
      title: getSessionDisplayName(session),
      subtitle: session.statusDetail ?? getSessionRole(session),
      actions: [],
    });
  }

  return items;
}

function buildRoleGroups(sessions: VaultCollabSessionSnapshot[]): VaultCollabRoleGroup[] {
  const byRole = new Map<string, VaultCollabRosterAgent[]>();
  const seenSessionUids = new Set<string>();

  for (const session of sessions) {
    if (!isLiveRosterSession(session) || seenSessionUids.has(session.sessionUid)) {
      continue;
    }

    seenSessionUids.add(session.sessionUid);
    const role = getSessionRole(session);
    const agents = byRole.get(role) ?? [];
    agents.push({
      sessionUid: session.sessionUid,
      displayName: getSessionDisplayName(session),
      role,
      status: session.effectiveStatus,
      currentHandoffUid: session.currentHandoffUid,
      freshness: session.connectionState === 'fresh' ? 'fresh' : 'stale',
    });
    byRole.set(role, agents);
  }

  return Array.from(byRole.entries()).map(([role, agents]) => ({ role, agents }));
}

function buildWorkColumns(
  handoffs: VaultCollabHandoffSnapshot[],
  handoffRows: VaultCollabHandoffRow[],
): VaultCollabWorkColumn[] {
  const rowsByUid = new Map(handoffRows.map((row) => [row.uid, row]));
  const cardsByColumn = new Map<VaultCollabWorkColumnState, VaultCollabWorkCard[]>(
    WORK_COLUMNS.map((column) => [column.state, []]),
  );

  for (const handoff of handoffs) {
    const state = getWorkColumnState(handoff.status);
    if (!state) {
      continue;
    }

    const row = rowsByUid.get(handoff.handoffUid);
    if (!row) {
      continue;
    }

    cardsByColumn.get(state)?.push({ ...row, state });
  }

  return WORK_COLUMNS.map((column) => ({
    ...column,
    cards: cardsByColumn.get(column.state) ?? [],
  }));
}

function buildConversationEntries(
  handoffs: VaultCollabHandoffSnapshot[],
  events: VaultCollabEventSnapshot[],
  selectedHandoffUid: string | null,
  now: Date,
): VaultCollabConversationEntry[] {
  const entries: VaultCollabConversationEntry[] = [];

  for (const handoff of handoffs) {
    if (selectedHandoffUid && handoff.handoffUid !== selectedHandoffUid) {
      continue;
    }

    for (const thread of handoff.discussionThreads) {
      const at = thread.lastMessageAt ?? thread.updatedAt;
      entries.push({
        id: `thread:${thread.threadUid}`,
        at,
        kind: 'message',
        author: thread.createdBySessionUid ?? undefined,
        body: formatConversationThreadBody(thread, now),
        handoffUid: handoff.handoffUid,
      });
    }
  }

  for (const event of events) {
    if (selectedHandoffUid && event.handoffUid !== selectedHandoffUid) {
      continue;
    }

    entries.push({
      id: `event:${event.eventId}`,
      at: event.createdAt,
      kind: 'event',
      author: event.sessionUid ?? undefined,
      body: formatEventPayload(event),
      handoffUid: event.handoffUid ?? undefined,
    });
  }

  return entries.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}

function getWorkColumnState(status: VaultCollabHandoffSnapshot['status']): VaultCollabWorkColumnState | null {
  switch (status) {
    case 'available':
      return 'available';
    case 'claimed':
    case 'in_progress':
      return 'in_progress';
    case 'verification_needed':
      return 'verification_needed';
    case 'blocked':
      return 'blocked';
    case 'awaiting_user':
      return 'awaiting_user';
    case 'resolved':
      return 'resolved';
    case 'abandoned':
    case 'stale':
    default:
      return null;
  }
}

function isLiveRosterSession(session: VaultCollabSessionSnapshot): boolean {
  return session.connectionState === 'fresh' && session.effectiveStatus !== 'disconnected';
}

function getSessionRole(session: VaultCollabSessionSnapshot): string {
  if (session.agentRole?.trim()) {
    return session.agentRole.trim();
  }

  const capabilityRole = session.capabilities.role;
  return typeof capabilityRole === 'string' && capabilityRole.trim().length > 0
    ? capabilityRole.trim()
    : 'unassigned';
}

function getSessionDisplayName(session: VaultCollabSessionSnapshot): string {
  return session.agentDisplayName || session.agentName || session.displayName;
}

function formatConversationThreadBody(
  thread: VaultCollabHandoffSnapshot['discussionThreads'][number],
  now: Date,
): string {
  const messageLabel = `${thread.messageCount} message${thread.messageCount === 1 ? '' : 's'}`;
  const lastMessageLabel = thread.lastMessageAt
    ? `last message ${formatRelativeAge(new Date(thread.lastMessageAt), now)}`
    : 'no messages yet';

  return `${thread.title} / ${messageLabel} / ${lastMessageLabel}`;
}

function buildLaunchRequestRow(
  launchRequest: VaultCollabLaunchRequestSnapshot,
  now: Date,
  approvedLaunchCommands: Record<string, string>,
): VaultCollabLaunchRequestRow {
  const role = launchRequest.role ? formatLooseLabel(launchRequest.role) : null;
  const title = role
    ? `${role} / ${launchRequest.model}`
    : launchRequest.model;
  const capabilityLabel = launchRequest.requestedCapabilities.length > 0
    ? `${launchRequest.requestedCapabilities.length} cap${launchRequest.requestedCapabilities.length === 1 ? '' : 's'}`
    : null;

  return {
    uid: launchRequest.launchRequestUid,
    shortUid: formatVaultCollabShortUid(launchRequest.launchRequestUid),
    title,
    statusLabel: formatStatusLabel(launchRequest.status),
    badgeClass: getLaunchRequestBadgeClass(launchRequest.status),
    railClass: getLaunchRequestRailClass(launchRequest.status),
    providerLabel: getClientLabel(launchRequest.provider),
    routeLabel: launchRequest.project,
    actorLabel: launchRequest.launchedSessionUid
      ? `launched ${formatVaultCollabShortUid(launchRequest.launchedSessionUid, 8)}`
      : launchRequest.brokerSessionUid
        ? `broker ${formatVaultCollabShortUid(launchRequest.brokerSessionUid, 8)}`
        : launchRequest.requestedBySessionUid
          ? `by ${formatVaultCollabShortUid(launchRequest.requestedBySessionUid, 8)}`
          : 'unassigned',
    ageLabel: formatRelativeAge(new Date(launchRequest.updatedAt), now),
    detail: launchRequest.statusDetail
      || launchRequest.commandPreview
      || launchRequest.initialInstructions,
    commandPreview: launchRequest.commandPreview,
    approvedLaunchCommand: approvedLaunchCommands[launchRequest.launchRequestUid] ?? null,
    capabilityLabel,
    actions: buildLaunchRequestActions(launchRequest),
    attention: isActiveLaunchRequestStatus(launchRequest.status),
  };
}

function buildLaunchRequestActions(
  launchRequest: VaultCollabLaunchRequestSnapshot,
): VaultCollabActionDescriptor[] {
  if (launchRequest.status === 'requested') {
    return [
      { action: 'approve', label: 'Approve', disabled: false, reason: null, tone: 'primary' },
      { action: 'reject', label: 'Reject', disabled: false, reason: null, tone: 'danger' },
      { action: 'cancel', label: 'Cancel', disabled: false, reason: null, tone: 'warning' },
    ];
  }

  if (launchRequest.status === 'approved') {
    return [
      { action: 'mark_launching', label: 'Get command', disabled: false, reason: null, tone: 'primary' },
      { action: 'cancel', label: 'Cancel', disabled: false, reason: null, tone: 'warning' },
      { action: 'fail', label: 'Fail', disabled: false, reason: null, tone: 'danger' },
    ];
  }

  if (launchRequest.status === 'launching') {
    return [
      { action: 'mark_running', label: 'Mark running', disabled: false, reason: null, tone: 'primary' },
      { action: 'fail', label: 'Fail', disabled: false, reason: null, tone: 'danger' },
    ];
  }

  return [];
}

export function formatVaultCollabShortUid(value: string, maxLength = 10): string {
  return value.length > maxLength + 3 ? `${value.slice(0, maxLength)}...` : value;
}

function getDashboardStatusLabel(snapshot: VaultCollabDashboardSnapshot): string {
  if (snapshot.dataReady) {
    return 'Ready';
  }

  return snapshot.ready ? 'Needs data' : 'Not installed';
}

function buildSessionGroups(
  sessions: VaultCollabSessionSnapshot[],
  permissionEventsBySessionUid: Map<string, VaultCollabEventSnapshot>,
  deliveryAttemptsBySessionUid: Map<string, VaultCollabDeliveryAttemptSnapshot>,
  now: Date,
  dashboardSessionUid: string | null,
): VaultCollabSessionGroup[] {
  const groups: VaultCollabSessionGroup[] = [
    { key: 'attention', label: 'Needs attention', sessions: [] },
    { key: 'working', label: 'Working', sessions: [] },
    { key: 'idle', label: 'Idle', sessions: [] },
    { key: 'stale', label: 'Stale / closed', sessions: [] },
  ];

  for (const session of sessions) {
    const row = buildSessionRow(
      session,
      permissionEventsBySessionUid.get(session.sessionUid),
      deliveryAttemptsBySessionUid.get(session.sessionUid),
      now,
      dashboardSessionUid,
    );
    const group = row.attention
      ? groups[0]
      : session.connectionState !== 'fresh' || session.effectiveStatus === 'disconnected'
        ? groups[3]
        : session.effectiveStatus === 'idle' || session.effectiveStatus === 'complete'
          ? groups[2]
          : groups[1];

    group.sessions.push(row);
  }

  return groups.filter((group) => group.sessions.length > 0);
}

function buildSessionRow(
  session: VaultCollabSessionSnapshot,
  permissionEvent: VaultCollabEventSnapshot | undefined,
  deliveryAttempt: VaultCollabDeliveryAttemptSnapshot | undefined,
  now: Date,
  dashboardSessionUid: string | null,
): VaultCollabSessionRow {
  const displayName = session.agentDisplayName || session.agentName || session.displayName;
  const secondaryParts = [`${getClientLabel(session.clientType)} / ${session.project}`];
  const attention = session.effectiveStatus === 'awaiting_user';
  const ownSession = Boolean(dashboardSessionUid && session.sessionUid === dashboardSessionUid);
  const delivery = getSessionDelivery(session);

  if (session.displayName && session.displayName !== displayName) {
    secondaryParts.push(session.displayName);
  }

  if (session.agentUid) {
    secondaryParts.push(formatVaultCollabShortUid(session.agentUid));
  }

  return {
    uid: session.sessionUid,
    shortUid: formatVaultCollabShortUid(session.sessionUid),
    displayName,
    secondary: secondaryParts.join(' / '),
    statusLabel: formatStatusLabel(session.effectiveStatus),
    badgeClass: getSessionBadgeClass(session.effectiveStatus),
    connectionLabel: getConnectionLabel(session.connectionState),
    connectionClass: getConnectionClass(session.connectionState),
    heartbeatLabel: formatHeartbeatAge(session.heartbeatAgeMs),
    roleLabel: session.agentRole ? formatLooseLabel(session.agentRole) : null,
    detail: attention
      ? getSessionPermissionQuestion(session, permissionEvent)
      : session.statusDetail,
    deliveryLabel: getDeliveryLabel(session),
    deliveryDetail: getDeliveryDetail(session),
    lastAckLabel: formatLastAck(delivery.lastAckAt, now),
    lastDeliveryLabel: deliveryAttempt ? formatDeliveryAttemptLabel(deliveryAttempt, now) : null,
    lastDeliveryDetail: deliveryAttempt?.message ?? null,
    lastDeliveryFailed: deliveryAttempt?.status === 'failed',
    canRename: ownSession,
    canClose: !ownSession && canCloseSession(session),
    canPing: !ownSession && session.connectionState !== 'disconnected',
    clientInitial: getClientInitial(session.clientType),
    attention,
  };
}

function getLatestDeliveryAttemptBySessionUid(
  attempts: VaultCollabDeliveryAttemptSnapshot[],
): Map<string, VaultCollabDeliveryAttemptSnapshot> {
  const latest = new Map<string, VaultCollabDeliveryAttemptSnapshot>();
  for (const attempt of attempts) {
    const current = latest.get(attempt.sessionUid);
    if (!current || new Date(attempt.createdAt).getTime() > new Date(current.createdAt).getTime()) {
      latest.set(attempt.sessionUid, attempt);
    }
  }

  return latest;
}

function formatDeliveryAttemptLabel(attempt: VaultCollabDeliveryAttemptSnapshot, now: Date): string {
  const age = formatRelativeAge(new Date(attempt.createdAt), now);
  return `${attempt.status === 'delivered' ? 'delivered' : 'failed'} ${age}`;
}

function canCloseSession(session: VaultCollabSessionSnapshot): boolean {
  if (session.connectionState === 'disconnected') {
    return false;
  }

  return session.connectionState === 'stale' || session.effectiveStatus === 'idle' || session.effectiveStatus === 'complete';
}

function getDeliveryLabel(session: VaultCollabSessionSnapshot): string {
  const delivery = getSessionDelivery(session);
  if (delivery.mode === 'manual_poll') {
    return 'Manual attention';
  }

  if (delivery.mode === 'managed_process') {
    return delivery.wakeable ? 'Wakeable managed' : 'Managed manual';
  }

  if (delivery.mode === 'local_watch') {
    return delivery.wakeable ? 'Wakeable watcher' : 'Local watcher';
  }

  return delivery.wakeable ? 'Wakeable MCP' : 'MCP notification';
}

function getDeliveryDetail(session: VaultCollabSessionSnapshot): string {
  const delivery = getSessionDelivery(session);
  if (delivery.mode === 'manual_poll') {
    return 'Stores pings only; target must poll or run a watcher.';
  }

  if (delivery.wakeable) {
    return 'Ping can be picked up by the managed receiver; wait for ack.';
  }

  return 'Receiver is not verified; target must poll or enable a wakeable receiver.';
}

function getSessionDelivery(session: VaultCollabSessionSnapshot): VaultCollabSessionSnapshot['delivery'] {
  return session.delivery ?? {
    mode: 'manual_poll',
    wakeable: false,
    lastAckEventId: null,
    lastAckAt: null,
  };
}

function formatLastAck(value: string | null, now: Date): string {
  return value ? `ack ${formatRelativeAge(new Date(value), now)}` : 'no ack yet';
}

function buildHandoffRow(handoff: VaultCollabHandoffSnapshot, now: Date): VaultCollabHandoffRow {
  const queueLabel = formatQueueSummary(handoff);
  const attention = handoff.status === 'awaiting_user';
  const visibleLabels = handoff.labels.slice(0, 3);
  const extraCount = handoff.labels.length - visibleLabels.length;

  return {
    uid: handoff.handoffUid,
    shortUid: formatVaultCollabShortUid(handoff.handoffUid),
    prompt: handoff.shortPrompt,
    statusLabel: formatStatusLabel(handoff.status),
    badgeClass: getHandoffBadgeClass(handoff.status),
    railClass: getHandoffRailClass(handoff.status),
    priorityLabel: handoff.urgent ? 'urgent' : handoff.priority,
    routeLabel: `${handoff.sourceProject} -> ${handoff.targetProject}`,
    queueLabel,
    ownerLabel: handoff.claimedBySessionUid
      ? formatVaultCollabShortUid(handoff.claimedBySessionUid)
      : handoff.suggestedClientType
        ? getClientLabel(handoff.suggestedClientType)
        : 'unclaimed',
    dependencyLabel: handoff.dependsOnHandoffUid
      ? `blocked by ${formatVaultCollabShortUid(handoff.dependsOnHandoffUid, 8)}`
      : null,
    ageLabel: formatRelativeAge(new Date(handoff.updatedAt), now),
    visibleLabels,
    extraLabel: extraCount > 0 ? `+${extraCount} label${extraCount === 1 ? '' : 's'}` : null,
    threadLabel: handoff.discussionThreads.length > 0
      ? `${handoff.discussionThreads.length} thread${handoff.discussionThreads.length === 1 ? '' : 's'}`
      : null,
    attention,
    urgent: handoff.urgent,
  };
}

function buildSelectedHandoff(
  handoff: VaultCollabHandoffSnapshot,
  permissionEvent: VaultCollabEventSnapshot | null,
  now: Date,
  dashboardSessionUid: string | null,
): VaultCollabSelectedHandoff {
  const attentionQuestion = handoff.status === 'awaiting_user'
    ? handoff.progressNote || getPermissionQuestionFromEvent(permissionEvent)
    : null;

  return {
    uid: handoff.handoffUid,
    shortUid: formatVaultCollabShortUid(handoff.handoffUid),
    prompt: handoff.shortPrompt,
    statusLabel: formatStatusLabel(handoff.status),
    badgeClass: getHandoffBadgeClass(handoff.status),
    attentionQuestion,
    progressNote: attentionQuestion ? null : handoff.progressNote,
    permissionMeta: permissionEvent && attentionQuestion ? formatPermissionRequestMeta(permissionEvent, now) : null,
    meta: [
      { label: 'Priority', value: handoff.urgent ? 'urgent' : handoff.priority },
      { label: 'Route', value: `${handoff.sourceProject} -> ${handoff.targetProject}` },
      { label: 'Queue', value: formatQueueSummary(handoff), mono: true },
      { label: 'Claimed by', value: handoff.claimedBySessionUid || 'none', mono: Boolean(handoff.claimedBySessionUid) },
      { label: 'Dependency', value: handoff.dependsOnHandoffUid || 'none', mono: Boolean(handoff.dependsOnHandoffUid) },
      { label: 'Updated', value: formatTimestamp(handoff.updatedAt) },
      { label: 'Vault memory', value: handoff.vaultMemoryUid || 'not linked', mono: Boolean(handoff.vaultMemoryUid) },
    ],
    labels: handoff.labels,
    discussionThreads: handoff.discussionThreads.map((thread) => ({
      uid: thread.threadUid,
      shortUid: formatVaultCollabShortUid(thread.threadUid),
      title: thread.title,
      status: thread.status,
      badgeClass: thread.status === 'resolved' ? 'badge-task-complete' : 'badge-plan',
      summary: formatDiscussionThreadSummary(thread, now),
    })),
    actions: buildHandoffActions(handoff, dashboardSessionUid),
    discussionAction: buildDiscussionAction(handoff),
    relatedFiles: handoff.relatedFiles,
  };
}

function buildHandoffActions(
  handoff: VaultCollabHandoffSnapshot,
  dashboardSessionUid: string | null,
): VaultCollabActionDescriptor[] {
  if (handoff.status === 'available') {
    return [
      {
        action: 'claim',
        label: 'Claim',
        disabled: false,
        reason: null,
        tone: 'primary',
      },
    ];
  }

  const ownedByDashboard = Boolean(dashboardSessionUid && handoff.claimedBySessionUid === dashboardSessionUid);
  const ownerReason = ownedByDashboard
    ? null
    : handoff.claimedBySessionUid
      ? `Claimed by ${formatVaultCollabShortUid(handoff.claimedBySessionUid)}`
      : 'Claim this handoff before updating it.';

  if (handoff.status === 'resolved' || handoff.status === 'abandoned' || handoff.status === 'stale') {
    return [
      {
        action: 'reopen',
        label: 'Reopen',
        disabled: false,
        reason: null,
        tone: 'warning',
      },
    ];
  }

  return [
    {
      action: 'update_in_progress',
      label: 'In progress',
      disabled: !ownedByDashboard,
      reason: ownerReason,
      tone: 'primary',
    },
    {
      action: 'update_blocked',
      label: 'Block',
      disabled: !ownedByDashboard,
      reason: ownerReason,
      tone: 'warning',
    },
    {
      action: 'update_verification_needed',
      label: 'Needs verification',
      disabled: !ownedByDashboard,
      reason: ownerReason,
      tone: 'neutral',
    },
    {
      action: 'release',
      label: 'Release',
      disabled: !ownedByDashboard,
      reason: ownerReason,
      tone: 'neutral',
    },
    {
      action: 'resolve',
      label: 'Resolve',
      disabled: !ownedByDashboard,
      reason: ownerReason,
      tone: 'primary',
    },
  ];
}

function buildDiscussionAction(handoff: VaultCollabHandoffSnapshot): VaultCollabActionDescriptor {
  if (handoff.discussionThreads.length === 0) {
    return {
      action: 'create_thread',
      label: 'Start thread',
      disabled: false,
      reason: null,
      tone: 'primary',
    };
  }

  return {
    action: 'reply',
    label: 'Reply',
    disabled: false,
    reason: null,
    tone: 'primary',
  };
}

function buildEventRows(
  events: VaultCollabEventSnapshot[],
  selectedHandoffUid: string | null,
  now: Date,
): VaultCollabEventRow[] {
  return events
    .filter((event) => !selectedHandoffUid || event.handoffUid === selectedHandoffUid)
    .slice(0, 8)
    .map((event) => ({
      id: event.eventId,
      type: event.eventType,
      timeLabel: formatRelativeAge(new Date(event.createdAt), now),
      summary: formatEventPayload(event),
    }));
}

function getSelectedHandoff(
  handoffs: VaultCollabHandoffSnapshot[],
  selectedHandoffUid?: string | null,
): VaultCollabHandoffSnapshot | null {
  if (handoffs.length === 0) {
    return null;
  }

  return handoffs.find((handoff) => handoff.handoffUid === selectedHandoffUid) ?? handoffs[0];
}

function getLatestEventBySessionUid(
  events: VaultCollabEventSnapshot[],
  eventType: string,
): Map<string, VaultCollabEventSnapshot> {
  const bySessionUid = new Map<string, VaultCollabEventSnapshot>();

  for (const event of events) {
    if (event.eventType === eventType && event.sessionUid && !bySessionUid.has(event.sessionUid)) {
      bySessionUid.set(event.sessionUid, event);
    }
  }

  return bySessionUid;
}

function formatQueueSummary(handoff: VaultCollabHandoffSnapshot): string {
  return handoff.queuePosition === null
    ? handoff.queueKey
    : `${handoff.queueKey} #${handoff.queuePosition}`;
}

function getSessionPermissionQuestion(
  session: VaultCollabSessionSnapshot,
  event: VaultCollabEventSnapshot | undefined,
): string | null {
  return session.statusDetail || getPermissionQuestionFromEvent(event ?? null);
}

function getPermissionQuestionFromEvent(event: VaultCollabEventSnapshot | null): string | null {
  const request = getPermissionRequestPayload(event);
  return typeof request?.question === 'string' && request.question.trim().length > 0
    ? request.question
    : null;
}

function getPermissionRequestPayload(event: VaultCollabEventSnapshot | null): Record<string, unknown> | null {
  if (!event || !isPermissionRequestEvent(event)) {
    return null;
  }

  const permissionRequest = event.payload.permissionRequest;
  return isJsonRecord(permissionRequest) ? permissionRequest : null;
}

function formatPermissionRequestMeta(event: VaultCollabEventSnapshot, now: Date): string {
  const request = getPermissionRequestPayload(event);
  if (!request) {
    return `${event.eventType} / ${formatRelativeAge(new Date(event.createdAt), now)}`;
  }

  const parts = [event.eventType, formatRelativeAge(new Date(event.createdAt), now)];

  if (typeof request.requestedCapability === 'string' && request.requestedCapability.trim().length > 0) {
    parts.push(request.requestedCapability);
  }

  if (typeof request.source === 'string' && request.source.trim().length > 0) {
    parts.push(`source: ${request.source}`);
  }

  return parts.join(' / ');
}

function formatDiscussionThreadSummary(
  thread: VaultCollabHandoffSnapshot['discussionThreads'][number],
  now: Date,
): string {
  const parts = [
    thread.lastMessageAt ? `last message ${formatRelativeAge(new Date(thread.lastMessageAt), now)}` : 'no messages yet',
  ];

  if (thread.createdBySessionUid) {
    parts.push(`created by ${formatVaultCollabShortUid(thread.createdBySessionUid)}`);
  }

  if (thread.resolvedAt) {
    parts.push(`resolved ${formatRelativeAge(new Date(thread.resolvedAt), now)}`);
  }

  parts.push(`${thread.messageCount} message${thread.messageCount === 1 ? '' : 's'}`);

  return parts.join(' / ');
}

function formatEventPayload(event: VaultCollabEventSnapshot): string {
  if (isPermissionRequestEvent(event)) {
    const request = getPermissionRequestPayload(event);
    if (request) {
      const parts = [
        typeof request.question === 'string' && request.question.trim().length > 0
          ? request.question
          : 'Permission requested',
      ];

      if (typeof request.requestedCapability === 'string' && request.requestedCapability.trim().length > 0) {
        parts.push(request.requestedCapability);
      }

      if (typeof request.source === 'string' && request.source.trim().length > 0) {
        parts.push(`source: ${request.source}`);
      }

      return parts.join(' / ');
    }
  }

  if (event.eventType === SESSION_PINGED_EVENT) {
    const message = typeof event.payload.message === 'string' && event.payload.message.trim().length > 0
      ? event.payload.message
      : 'Attention ping';
    const actor = typeof event.payload.actorSessionUid === 'string' && event.payload.actorSessionUid.trim().length > 0
      ? `from ${formatVaultCollabShortUid(event.payload.actorSessionUid)}`
      : null;

    return actor ? `${message} / ${actor}` : message;
  }

  if (event.eventType.startsWith(LAUNCH_REQUEST_EVENT_PREFIX)) {
    const launchRequestUid = typeof event.payload.launchRequestUid === 'string'
      ? formatVaultCollabShortUid(event.payload.launchRequestUid)
      : 'launch request';
    const detail = typeof event.payload.detail === 'string' && event.payload.detail.trim().length > 0
      ? event.payload.detail
      : typeof event.payload.reason === 'string' && event.payload.reason.trim().length > 0
        ? event.payload.reason
        : typeof event.payload.model === 'string' && event.payload.model.trim().length > 0
          ? event.payload.model
          : null;

    return detail ? `${launchRequestUid} / ${detail}` : launchRequestUid;
  }

  const entries = Object.entries(event.payload);
  if (entries.length === 0) {
    return event.handoffUid || event.sessionUid || 'No event payload.';
  }

  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${formatPayloadValue(value)}`)
    .join(' / ');
}

function formatPayloadValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value === null || value === undefined) {
    return 'none';
  }

  if (Array.isArray(value)) {
    return `${value.length} item(s)`;
  }

  return 'details';
}

function isPermissionRequestEvent(event: VaultCollabEventSnapshot): boolean {
  return event.eventType === SESSION_PERMISSION_REQUESTED_EVENT
    || event.eventType === HANDOFF_PERMISSION_REQUESTED_EVENT;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getClientInitial(clientType: VaultCollabSessionSnapshot['clientType']): string {
  switch (clientType) {
    case 'codex':
      return 'C';
    case 'claude-code':
    case 'claude-desktop':
      return 'Cl';
    case 'gemini':
      return 'G';
    case 'opencode':
      return 'O';
    default:
      return 'A';
  }
}

function getClientLabel(clientType: VaultCollabSessionSnapshot['clientType']): string {
  switch (clientType) {
    case 'codex':
      return 'Codex';
    case 'claude-code':
      return 'Claude Code';
    case 'claude-desktop':
      return 'Claude Desktop';
    case 'octogent':
      return 'Octogent';
    case 'gemini':
      return 'Gemini';
    case 'opencode':
      return 'OpenCode';
    case 'other':
    default:
      return 'Other client';
  }
}

function getSessionBadgeClass(status: VaultCollabSessionSnapshot['effectiveStatus']): string {
  switch (status) {
    case 'working':
      return 'badge-task-running';
    case 'idle':
      return 'badge-task-pending';
    case 'blocked':
    case 'disconnected':
      return 'badge-task-fail';
    case 'awaiting_user':
    case 'awaiting_verification':
      return 'badge-plan';
    case 'complete':
    default:
      return 'badge-task-complete';
  }
}

function getHandoffBadgeClass(status: VaultCollabHandoffSnapshot['status']): string {
  switch (status) {
    case 'resolved':
      return 'badge-task-complete';
    case 'blocked':
    case 'abandoned':
    case 'stale':
      return 'badge-task-fail';
    case 'in_progress':
    case 'claimed':
      return 'badge-task-running';
    case 'awaiting_user':
    case 'verification_needed':
      return 'badge-plan';
    case 'available':
    default:
      return 'badge-task-pending';
  }
}

function getHandoffRailClass(status: VaultCollabHandoffSnapshot['status']): string {
  switch (status) {
    case 'in_progress':
    case 'claimed':
      return 'queue-status-rail-running';
    case 'blocked':
    case 'abandoned':
    case 'stale':
      return 'queue-status-rail-failed';
    case 'resolved':
      return 'queue-status-rail-completed';
    case 'awaiting_user':
      return 'queue-status-rail-attention';
    case 'verification_needed':
    case 'available':
    default:
      return 'queue-status-rail-pending';
  }
}

function getLaunchRequestBadgeClass(status: VaultCollabLaunchRequestSnapshot['status']): string {
  switch (status) {
    case 'launching':
    case 'running':
      return 'badge-task-running';
    case 'failed':
      return 'badge-task-fail';
    case 'rejected':
    case 'cancelled':
    case 'stopped':
      return 'badge-task-complete';
    case 'approved':
      return 'badge-plan';
    case 'requested':
    default:
      return 'badge-task-pending';
  }
}

function getLaunchRequestRailClass(status: VaultCollabLaunchRequestSnapshot['status']): string {
  switch (status) {
    case 'launching':
    case 'running':
      return 'queue-status-rail-running';
    case 'failed':
      return 'queue-status-rail-failed';
    case 'rejected':
    case 'cancelled':
    case 'stopped':
      return 'queue-status-rail-completed';
    case 'approved':
      return 'queue-status-rail-attention';
    case 'requested':
    default:
      return 'queue-status-rail-pending';
  }
}

function isActiveLaunchRequestStatus(status: VaultCollabLaunchRequestSnapshot['status']): boolean {
  return status === 'approved'
    || status === 'launching'
    || status === 'running';
}

function getConnectionClass(state: VaultCollabSessionSnapshot['connectionState']): string {
  switch (state) {
    case 'fresh':
      return 'vault-collab-connection-fresh';
    case 'stale':
      return 'vault-collab-connection-stale';
    case 'disconnected':
      return 'vault-collab-connection-disconnected';
  }
}

function getConnectionLabel(state: VaultCollabSessionSnapshot['connectionState']): string {
  switch (state) {
    case 'fresh':
      return 'fresh';
    case 'stale':
      return 'stale';
    case 'disconnected':
      return 'closed';
  }
}

function formatLooseLabel(value: string): string {
  return value.replace(/[_-]/g, ' ');
}

function formatStatusLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

function formatHeartbeatAge(value: number | null): string {
  if (value === null) {
    return 'heartbeat unknown';
  }

  if (value < 60_000) {
    return 'heartbeat just now';
  }

  return `heartbeat ${Math.round(value / 60_000)}m ago`;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatRelativeAge(value: Date, now: Date): string {
  const elapsedMs = Math.max(0, now.getTime() - value.getTime());
  if (elapsedMs < 60_000) {
    return 'just now';
  }

  const elapsedMinutes = Math.round(elapsedMs / 60_000);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.round(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}
