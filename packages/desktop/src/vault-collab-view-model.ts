import type {
  VaultCollabDashboardSnapshot,
  VaultCollabDeliveryAttemptSnapshot,
  VaultCollabEventSnapshot,
  VaultCollabEventTypeSnapshot,
  VaultCollabHandoffSnapshot,
  VaultCollabLaunchRequestSnapshot,
  VaultCollabPolicyPackSnapshot,
  VaultCollabRoleProfileSnapshot,
  VaultCollabSessionAdapterType,
  VaultCollabSessionSnapshot,
  VaultCollabSessionStatus,
  VaultCollabSnapshotRiskLevel,
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
  title: string;
  prompt: string;
  promptPreview: string;
  statusLabel: string;
  badgeClass: string;
  railClass: string;
  priorityLabel: string;
  routeLabel: string;
  routeHintLabel: string | null;
  suggestedRoleProfileId: string | null;
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
  sourceProject: string;
  targetProject: string;
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
  clientType: VaultCollabSessionSnapshot['clientType'];
  rawRole: string;
  roleProfileId: string | null;
  roleDisplayName: string;
  roleLabel: string;
  status: string;
  currentHandoffUid: string | null;
  freshness: 'fresh' | 'stale';
  hud: VaultCollabSessionHudModel;
}

export interface VaultCollabSessionHudModel {
  hasSnapshot: boolean;
  adapter: {
    raw: VaultCollabSessionAdapterType;
    label: 'NATIVE' | 'ADAPTER' | 'INSTRUCTION';
    tone: 'native' | 'adapter' | 'instruction';
    title: string | null;
  };
  lifecycleStatus: {
    label: string;
    badgeClass: string;
  };
  reportedState: {
    label: string;
    badgeClass: string;
    available: boolean;
  };
  context: {
    providerLabel: string;
    modelLabel: string;
    tokenGauge: {
      available: boolean;
      used: number | null;
      remaining: number | null;
      total: number | null;
      percentUsed: number | null;
      label: string;
    };
    compactionRisk: {
      level: VaultCollabSnapshotRiskLevel;
      label: string;
      className: string;
    };
  };
  progress: {
    taskLabel: string;
    percent: number | null;
    percentLabel: string;
    blockers: string[];
    available: boolean;
  };
  cost: {
    label: string;
    available: boolean;
  };
  risk: {
    level: VaultCollabSnapshotRiskLevel;
    label: string;
    className: string;
    reasons: string[];
  };
  activeHandoffs: Array<{
    uid: string;
    shortUid: string;
    statusLabel: string;
    progressNote: string | null;
    canOpen: boolean;
  }>;
  toolGrants: Array<{
    toolName: string;
    scope: string;
    grantedLabel: string | null;
  }>;
  sync: {
    label: string;
    stale: boolean;
    source: 'snapshot' | 'snapshot_cursor' | 'heartbeat' | 'unknown';
  };
}

export interface VaultCollabRoleGroup {
  key: string;
  label: string;
  stateLabel: string;
  role: string;
  roleProfileId: string | null;
  roleDisplayName: string;
  purpose: string | null;
  mutationLabel: string | null;
  triggerLabels: string[];
  primarySkillNames: string[];
  secondarySkillNames: string[];
  capabilities: string[];
  suggestedNextRoleLabels: string[];
  handoffs: VaultCollabHandoffRow[];
  isWatchdog: boolean;
  agents: VaultCollabRosterAgent[];
}

export type VaultCollabOfficeGroup = VaultCollabRoleGroup;

export interface VaultCollabSelectedRoleProfile {
  roleProfileId: string;
  displayName: string;
  purpose: string;
  mutationLabel: string;
  capabilities: string[];
  triggerLabels: string[];
  suggestedNextRoleLabels: string[];
  primarySkillNames: string[];
  secondarySkillNames: string[];
  isWatchdog: boolean;
}

export type VaultCollabWorkColumnState =
  | 'available'
  | 'claimed'
  | 'in_progress'
  | 'verification_needed'
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

export interface VaultCollabEventFeedRow {
  id: number;
  type: string;
  timeLabel: string;
  sessionLabel: string;
  summary: string;
}

export interface VaultCollabEventFeedModel {
  prefixes: string[];
  selectedPrefix: string;
  visibleEvents: VaultCollabEventFeedRow[];
}

export interface VaultCollabPolicyPackRow {
  uid: string;
  name: string;
  active: boolean;
  builtInBadge: string | null;
  toggleAction: 'activate' | 'deactivate';
}

export interface VaultCollabPolicyPanelModel {
  packs: VaultCollabPolicyPackRow[];
  recentEvents: VaultCollabEventFeedRow[];
}

export interface VaultCollabEventRegistryRow {
  canonicalName: string;
  namespace: string;
  summary: string;
  payloadKeys: string[];
  attentionLabel: string;
  tokenSafeLabel: string;
  legacyAliasLabel: string | null;
}

export interface VaultCollabEventRegistryModel {
  rows: VaultCollabEventRegistryRow[];
  namespaces: string[];
  totalCount: number;
}

export interface VaultCollabCockpitViewModel {
  needsYou: VaultCollabNeedsYouItem[];
  officeGroups: VaultCollabOfficeGroup[];
  roster: VaultCollabRoleGroup[];
  selectedRoleProfile: VaultCollabSelectedRoleProfile | null;
  work: VaultCollabWorkColumn[];
  conversation: VaultCollabConversationEntry[];
  selectedHandoff: VaultCollabSelectedHandoff | null;
  eventFeed: VaultCollabEventFeedModel;
  policyPanel: VaultCollabPolicyPanelModel;
  eventRegistry: VaultCollabEventRegistryModel;
}

export interface VaultCollabDashboardViewModelOptions {
  dashboardSessionUid?: string | null;
  approvedLaunchCommands?: Record<string, string>;
  selectedRoleProfileId?: string | null;
  eventTypePrefix?: string | null;
  eventTypes?: VaultCollabEventTypeSnapshot[];
  showInactiveSessions?: boolean;
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
      ? `${snapshot.counts.attentionPingEvents} attention notices`
      : 'No attention';
  const attentionActive = snapshot.counts.permissionNeeded > 0
    || snapshot.counts.permissionRequestEvents > 0
    || snapshot.counts.attentionPingEvents > 0;
  const roleLookup = buildRoleProfileLookup(snapshot);
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
  const handoffRows = snapshot.handoffs.map((handoff) => buildHandoffRow(handoff, now, roleLookup));
  const selectedHandoffModel = selectedHandoff
    ? buildSelectedHandoff(selectedHandoff, selectedPermissionEvent, now, options.dashboardSessionUid ?? null, roleLookup)
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
      options.dashboardSessionUid ?? null,
      roleLookup,
      options.selectedRoleProfileId ?? null,
      options,
    ),
  };
}

const WORK_COLUMNS: Array<{ state: VaultCollabWorkColumnState; label: string }> = [
  { state: 'available', label: 'Available' },
  { state: 'claimed', label: 'Claimed' },
  { state: 'in_progress', label: 'In progress' },
  { state: 'verification_needed', label: 'Needs verification' },
  { state: 'resolved', label: 'Resolved' },
];

const EVENT_FEED_PREFIXES = [
  'session.',
  'handoff.',
  'policy.',
  'security.',
  'tool.',
  'loop.',
];

function buildCockpitViewModel(
  snapshot: VaultCollabDashboardSnapshot,
  launchRequestRows: VaultCollabLaunchRequestRow[],
  handoffRows: VaultCollabHandoffRow[],
  selectedHandoff: VaultCollabSelectedHandoff | null,
  selectedHandoffUid: string | null,
  now: Date,
  dashboardSessionUid: string | null,
  roleLookup: RoleProfileLookup,
  selectedRoleProfileId: string | null,
  options: VaultCollabDashboardViewModelOptions = {},
): VaultCollabCockpitViewModel {
  const officeGroups = buildRoleGroups(
    snapshot.sessions,
    snapshot.handoffs,
    handoffRows,
    roleLookup,
    now,
    options.showInactiveSessions === true,
  );
  const selectedHandoffRoleProfileId = selectedHandoffUid
    ? handoffRows.find((row) => row.uid === selectedHandoffUid)?.suggestedRoleProfileId ?? null
    : null;
  return {
    needsYou: buildNeedsYouItems(snapshot, launchRequestRows, handoffRows, dashboardSessionUid),
    officeGroups,
    roster: officeGroups,
    selectedRoleProfile: buildSelectedRoleProfile(
      roleLookup,
      selectedRoleProfileId
        ?? selectedHandoffRoleProfileId
        ?? firstOccupiedRoleProfileId(officeGroups),
    ),
    work: buildWorkColumns(snapshot.handoffs, handoffRows),
    conversation: buildConversationEntries(snapshot.handoffs, snapshot.events, selectedHandoffUid, now),
    selectedHandoff,
    eventFeed: buildEventFeed(snapshot.events, now, options.eventTypePrefix ?? null),
    policyPanel: buildPolicyPanel(snapshot.policyPacks ?? [], snapshot.events, now),
    eventRegistry: buildEventRegistry(options.eventTypes ?? []),
  };
}

function buildNeedsYouItems(
  snapshot: VaultCollabDashboardSnapshot,
  launchRequestRows: VaultCollabLaunchRequestRow[],
  handoffRows: VaultCollabHandoffRow[],
  dashboardSessionUid: string | null,
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
      actions: buildHandoffActions(handoff, dashboardSessionUid),
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

interface RoleProfileLookup {
  profiles: VaultCollabRoleProfileSnapshot[];
  byId: Map<string, VaultCollabRoleProfileSnapshot>;
  aliasToProfileId: Map<string, string>;
}

const LEGACY_ROLE_ALIASES: Array<[string, string]> = [
  ['coordinator', 'coordinator'],
  ['implementer', 'implementer'],
  ['reviewer', 'reviewer'],
  ['qa-reviewer', 'qa-evaluator'],
  ['sweeper', 'runtime-loop-operator'],
  ['observer', 'reviewer'],
];
const OTHER_ROLE_GROUP_KEY = 'other';
const OTHER_ROLE_DISPLAY_NAME = 'Other';
const SESSION_HUD_STALE_AFTER_MS = 15 * 60 * 1000;

export const ACTIVE_OFFICE_STATUSES: VaultCollabSessionStatus[] = [
  'idle',
  'working',
  'blocked',
  'awaiting_user',
  'awaiting_verification',
];

export const INACTIVE_OFFICE_STATUSES: VaultCollabSessionStatus[] = [
  'complete',
  'disconnected',
];

export function getVaultCollabOfficeSessionStatuses(showInactiveSessions: boolean): VaultCollabSessionStatus[] {
  return showInactiveSessions
    ? [...ACTIVE_OFFICE_STATUSES, ...INACTIVE_OFFICE_STATUSES]
    : [...ACTIVE_OFFICE_STATUSES];
}

export function getVaultCollabAgentsTabCount(groups: VaultCollabOfficeGroup[]): number {
  return groups.reduce((total, group) => (
    total + group.agents.filter((agent) => isActiveOfficeSessionStatus(agent.status)).length
  ), 0);
}

function buildRoleProfileLookup(snapshot: VaultCollabDashboardSnapshot): RoleProfileLookup {
  const profiles = snapshot.roleProfiles ?? [];
  const byId = new Map(profiles.map((profile) => [normalizeRoleKey(profile.roleProfileId), profile]));
  const aliasToProfileId = new Map<string, string>();

  for (const profile of profiles) {
    aliasToProfileId.set(normalizeRoleKey(profile.roleProfileId), profile.roleProfileId);
  }

  for (const alias of snapshot.roleProfileAliases ?? []) {
    const profile = byId.get(normalizeRoleKey(alias.roleProfileId));
    if (profile) {
      aliasToProfileId.set(normalizeRoleKey(alias.alias), profile.roleProfileId);
    }
  }

  for (const [alias, roleProfileId] of LEGACY_ROLE_ALIASES) {
    if (byId.has(normalizeRoleKey(roleProfileId)) && !aliasToProfileId.has(alias)) {
      aliasToProfileId.set(alias, roleProfileId);
    }
  }

  return { profiles, byId, aliasToProfileId };
}

function buildRoleGroups(
  sessions: VaultCollabSessionSnapshot[],
  handoffs: VaultCollabHandoffSnapshot[],
  handoffRows: VaultCollabHandoffRow[],
  roleLookup: RoleProfileLookup,
  now: Date,
  showInactiveSessions: boolean,
): VaultCollabRoleGroup[] {
  const groups = new Map<string, VaultCollabRoleGroup>();
  const seenSessionUids = new Set<string>();
  const handoffRowsByUid = new Map(handoffRows.map((row) => [row.uid, row]));
  const handoffsByUid = new Map(handoffs.map((handoff) => [handoff.handoffUid, handoff]));
  const hasCanonicalProfiles = roleLookup.profiles.length > 0;

  for (const profile of roleLookup.profiles) {
    groups.set(profile.roleProfileId, buildEmptyRoleGroup(profile, roleLookup));
  }

  for (const session of sessions) {
    if (!isRosterVisibleSession(session, showInactiveSessions) || seenSessionUids.has(session.sessionUid)) {
      continue;
    }

    seenSessionUids.add(session.sessionUid);
    const rawRole = getSessionRawRole(session);
    const roleProfileId = resolveRoleProfileId(session.roleProfileId ?? null, rawRole, roleLookup);
    const roleProfile = roleProfileId ? roleLookup.byId.get(normalizeRoleKey(roleProfileId)) ?? null : null;
    const groupKey = roleProfileId ?? (hasCanonicalProfiles ? OTHER_ROLE_GROUP_KEY : rawRole);
    const group = groups.get(groupKey)
      ?? (hasCanonicalProfiles && !roleProfileId
        ? buildOtherRoleGroup()
        : buildLegacyRoleGroup(rawRole, roleProfileId, roleProfile, roleLookup));
    const roleDisplayName = roleProfileId
      ? getRoleDisplayName(roleProfileId, rawRole, roleLookup)
      : group.roleDisplayName;
    const roleLabel = roleProfileId
      ? formatSessionRoleLabel(rawRole, roleProfileId, roleLookup)
      : formatTitleLabel(rawRole);
    group.agents.push({
      sessionUid: session.sessionUid,
      displayName: getSessionDisplayName(session),
      clientType: session.clientType,
      rawRole,
      roleProfileId,
      roleDisplayName,
      roleLabel,
      status: session.effectiveStatus,
      currentHandoffUid: session.currentHandoffUid,
      freshness: session.connectionState === 'fresh' ? 'fresh' : 'stale',
      hud: buildSessionHudModel(session, handoffsByUid, now),
    });
    groups.set(groupKey, group);
  }

  for (const handoff of handoffs) {
    const row = handoffRowsByUid.get(handoff.handoffUid);
    if (!row) {
      continue;
    }

    const roleProfileId = getHandoffRoleProfileId(handoff, roleLookup);
    if (!roleProfileId) {
      continue;
    }

    const group = groups.get(roleProfileId);
    if (group) {
      group.handoffs.push(row);
    }
  }

  return Array.from(groups.values()).map(finalizeOfficeGroup);
}

export function buildSessionHudModel(
  session: VaultCollabSessionSnapshot,
  handoffsByUid: Map<string, VaultCollabHandoffSnapshot>,
  now: Date,
): VaultCollabSessionHudModel {
  const snapshot = session.lastSnapshot;
  const adapter = buildSessionAdapterModel(session.adapterType, snapshot?.capabilities?.adapterType ?? null);
  const lifecycleStatus = {
    label: formatStatusLabel(session.effectiveStatus),
    badgeClass: getSessionBadgeClass(session.effectiveStatus),
  };

  if (!snapshot) {
    return {
      hasSnapshot: false,
      adapter,
      lifecycleStatus,
      reportedState: {
        label: 'unknown',
        badgeClass: 'badge-task-pending',
        available: false,
      },
      context: {
        providerLabel: getClientLabel(session.clientType),
        modelLabel: 'model unknown',
        tokenGauge: buildTokenGauge(null, null),
        compactionRisk: buildRiskTone('unknown'),
      },
      progress: {
        taskLabel: 'No task reported',
        percent: null,
        percentLabel: 'progress unknown',
        blockers: [],
        available: false,
      },
      cost: {
        label: 'cost unknown',
        available: false,
      },
      risk: {
        ...buildRiskTone('unknown'),
        reasons: [],
      },
      activeHandoffs: [],
      toolGrants: [],
      sync: buildSyncModel(session, null, now),
    };
  }

  const progressPercent = normalizePercent(snapshot.progress.percentComplete);
  const tokenGauge = buildTokenGauge(snapshot.context.tokensUsed, snapshot.context.tokensRemaining);
  const risk = buildRiskTone(snapshot.risk.level);
  const reportedState = normalizeReportedState(snapshot.state);

  return {
    hasSnapshot: true,
    adapter,
    lifecycleStatus,
    reportedState: {
      label: formatStatusLabel(reportedState),
      badgeClass: reportedState === 'unknown' ? 'badge-task-pending' : getSessionBadgeClass(reportedState),
      available: reportedState !== 'unknown',
    },
    context: {
      providerLabel: snapshot.context.provider ?? getClientLabel(session.clientType),
      modelLabel: snapshot.context.model ?? 'model unknown',
      tokenGauge,
      compactionRisk: buildRiskTone(snapshot.context.compactionRisk),
    },
    progress: {
      taskLabel: snapshot.progress.currentTask ?? 'No task reported',
      percent: progressPercent,
      percentLabel: progressPercent === null ? 'progress unknown' : `${progressPercent}%`,
      blockers: [...snapshot.progress.blockers],
      available: Boolean(snapshot.progress.currentTask) || progressPercent !== null || snapshot.progress.blockers.length > 0,
    },
    cost: buildCostModel(snapshot.cost.estimatedUSD),
    risk: {
      ...risk,
      reasons: [...snapshot.risk.reasons],
    },
    activeHandoffs: snapshot.active_handoffs.map((reportedHandoff) => {
      const canonical = handoffsByUid.get(reportedHandoff.handoffUid) ?? null;
      const status = canonical?.status ?? reportedHandoff.status;
      return {
        uid: reportedHandoff.handoffUid,
        shortUid: formatVaultCollabShortUid(reportedHandoff.handoffUid),
        statusLabel: formatStatusLabel(status),
        progressNote: canonical?.progressNote ?? reportedHandoff.progressNote,
        canOpen: Boolean(canonical),
      };
    }),
    toolGrants: snapshot.tool_grants.map((grant) => ({
      toolName: grant.toolName,
      scope: grant.scope || 'unknown',
      grantedLabel: grant.grantedAt,
    })),
    sync: buildSyncModel(session, snapshot, now),
  };
}

function buildSessionAdapterModel(
  adapterType: VaultCollabSessionAdapterType,
  snapshotAdapterType: VaultCollabSessionAdapterType | null,
): VaultCollabSessionHudModel['adapter'] {
  const normalized = normalizeSessionAdapterType(adapterType);
  const title = snapshotAdapterType && snapshotAdapterType !== normalized
    ? `Snapshot reported ${snapshotAdapterType}`
    : null;

  switch (normalized) {
    case 'adapter_backed':
      return { raw: normalized, label: 'ADAPTER', tone: 'adapter', title };
    case 'instruction_backed':
      return { raw: normalized, label: 'INSTRUCTION', tone: 'instruction', title };
    case 'native':
    default:
      return { raw: 'native', label: 'NATIVE', tone: 'native', title };
  }
}

function normalizeSessionAdapterType(value: VaultCollabSessionAdapterType | string | null | undefined): VaultCollabSessionAdapterType {
  return value === 'adapter_backed' || value === 'instruction_backed' || value === 'native'
    ? value
    : 'native';
}

function buildTokenGauge(
  used: number | null,
  remaining: number | null,
): VaultCollabSessionHudModel['context']['tokenGauge'] {
  if (!isFiniteNumber(used) || !isFiniteNumber(remaining)) {
    return {
      available: false,
      used: null,
      remaining: null,
      total: null,
      percentUsed: null,
      label: 'tokens unavailable',
    };
  }

  const total = used + remaining;
  if (total <= 0) {
    return {
      available: false,
      used,
      remaining,
      total,
      percentUsed: null,
      label: 'tokens unavailable',
    };
  }

  const percentUsed = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
  return {
    available: true,
    used,
    remaining,
    total,
    percentUsed,
    label: `${formatNumber(used)} used / ${formatNumber(remaining)} left`,
  };
}

function buildRiskTone(level: VaultCollabSnapshotRiskLevel): {
  level: VaultCollabSnapshotRiskLevel;
  label: string;
  className: string;
} {
  const normalized = normalizeRiskLevel(level);
  return {
    level: normalized,
    label: normalized,
    className: `vault-collab-risk-${normalized}`,
  };
}

function normalizeRiskLevel(value: VaultCollabSnapshotRiskLevel | string | null | undefined): VaultCollabSnapshotRiskLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical' || value === 'unknown'
    ? value
    : 'unknown';
}

function normalizeReportedState(value: string | null | undefined): VaultCollabSessionStatus | 'unknown' {
  return value === 'idle'
    || value === 'working'
    || value === 'blocked'
    || value === 'awaiting_user'
    || value === 'awaiting_verification'
    || value === 'complete'
    || value === 'disconnected'
    || value === 'unknown'
    ? value
    : 'unknown';
}

function normalizePercent(value: number | null): number | null {
  if (!isFiniteNumber(value)) {
    return null;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function buildCostModel(estimatedUSD: number | null): VaultCollabSessionHudModel['cost'] {
  if (!isFiniteNumber(estimatedUSD)) {
    return {
      label: 'cost unknown',
      available: false,
    };
  }

  return {
    label: `$${estimatedUSD.toFixed(2)} est.`,
    available: true,
  };
}

function buildSyncModel(
  session: VaultCollabSessionSnapshot,
  snapshot: VaultCollabSessionSnapshot['lastSnapshot'],
  now: Date,
): VaultCollabSessionHudModel['sync'] {
  if (session.snapshotReportedAt) {
    return {
      label: `snapshot ${formatRelativeAge(new Date(session.snapshotReportedAt), now)}`,
      stale: isTimestampStale(session.snapshotReportedAt, now),
      source: 'snapshot',
    };
  }

  if (snapshot?.sync_cursor.lastHeartbeatAt) {
    return {
      label: `heartbeat ${formatRelativeAge(new Date(snapshot.sync_cursor.lastHeartbeatAt), now)}`,
      stale: isTimestampStale(snapshot.sync_cursor.lastHeartbeatAt, now),
      source: 'snapshot_cursor',
    };
  }

  if (session.lastHeartbeatAt) {
    return {
      label: `heartbeat ${formatRelativeAge(new Date(session.lastHeartbeatAt), now)}`,
      stale: isTimestampStale(session.lastHeartbeatAt, now),
      source: 'heartbeat',
    };
  }

  return {
    label: 'sync unknown',
    stale: true,
    source: 'unknown',
  };
}

function isTimestampStale(value: string, now: Date): boolean {
  const parsed = Date.parse(value);
  return !Number.isFinite(parsed) || now.getTime() - parsed > SESSION_HUD_STALE_AFTER_MS;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function buildOtherRoleGroup(): VaultCollabRoleGroup {
  return {
    key: OTHER_ROLE_GROUP_KEY,
    label: OTHER_ROLE_DISPLAY_NAME,
    stateLabel: 'idle',
    role: OTHER_ROLE_GROUP_KEY,
    roleProfileId: null,
    roleDisplayName: OTHER_ROLE_DISPLAY_NAME,
    purpose: null,
    mutationLabel: null,
    triggerLabels: [],
    primarySkillNames: [],
    secondarySkillNames: [],
    capabilities: [],
    suggestedNextRoleLabels: [],
    handoffs: [],
    isWatchdog: false,
    agents: [],
  };
}

function buildEmptyRoleGroup(
  profile: VaultCollabRoleProfileSnapshot,
  roleLookup: RoleProfileLookup,
): VaultCollabRoleGroup {
  return {
    key: profile.roleProfileId,
    label: profile.displayName,
    stateLabel: 'idle',
    role: profile.roleProfileId,
    roleProfileId: profile.roleProfileId,
    roleDisplayName: profile.displayName,
    purpose: profile.purpose,
    mutationLabel: formatStatusLabel(profile.defaultMutation),
    triggerLabels: [...profile.triggerLabels],
    primarySkillNames: [...profile.skills.primary],
    secondarySkillNames: [...profile.skills.secondary],
    capabilities: profile.capabilitySet.map(formatStatusLabel),
    suggestedNextRoleLabels: profile.suggestedNextRoleProfileIds.map((roleProfileId) => (
      getRoleDisplayName(roleProfileId, roleProfileId, roleLookup)
    )),
    handoffs: [],
    isWatchdog: profile.roleProfileId === 'loop-resolver',
    agents: [],
  };
}

function buildLegacyRoleGroup(
  rawRole: string,
  roleProfileId: string | null,
  roleProfile: VaultCollabRoleProfileSnapshot | null,
  roleLookup: RoleProfileLookup,
): VaultCollabRoleGroup {
  if (roleProfile) {
    return buildEmptyRoleGroup(roleProfile, roleLookup);
  }

  const roleDisplayName = getRoleDisplayName(roleProfileId, rawRole, roleLookup);
  return {
    key: roleProfileId ?? rawRole,
    label: roleDisplayName,
    stateLabel: 'idle',
    role: roleProfileId ?? rawRole,
    roleProfileId,
    roleDisplayName,
    purpose: null,
    mutationLabel: null,
    triggerLabels: [],
    primarySkillNames: [],
    secondarySkillNames: [],
    capabilities: [],
    suggestedNextRoleLabels: [],
    handoffs: [],
    isWatchdog: roleProfileId === 'loop-resolver',
    agents: [],
  };
}

function finalizeOfficeGroup(group: VaultCollabRoleGroup): VaultCollabRoleGroup {
  return {
    ...group,
    label: group.roleDisplayName,
    stateLabel: group.agents.length > 0
      ? `${group.agents.length} live`
      : group.handoffs.length > 0
        ? `${group.handoffs.length} routed`
        : 'idle',
  };
}

function buildSelectedRoleProfile(
  roleLookup: RoleProfileLookup,
  requestedRoleProfileId: string | null,
): VaultCollabSelectedRoleProfile | null {
  const requestedProfile = requestedRoleProfileId
    ? roleLookup.byId.get(normalizeRoleKey(requestedRoleProfileId))
    : null;
  const profile = requestedProfile ?? roleLookup.profiles[0] ?? null;

  if (!profile) {
    return null;
  }

  return {
    roleProfileId: profile.roleProfileId,
    displayName: profile.displayName,
    purpose: profile.purpose,
    mutationLabel: formatStatusLabel(profile.defaultMutation),
    capabilities: profile.capabilitySet.map(formatStatusLabel),
    triggerLabels: [...profile.triggerLabels],
    suggestedNextRoleLabels: profile.suggestedNextRoleProfileIds.map((roleProfileId) => (
      getRoleDisplayName(roleProfileId, roleProfileId, roleLookup)
    )),
    primarySkillNames: [...profile.skills.primary],
    secondarySkillNames: [...profile.skills.secondary],
    isWatchdog: profile.roleProfileId === 'loop-resolver',
  };
}

function firstOccupiedRoleProfileId(groups: VaultCollabRoleGroup[]): string | null {
  return groups.find((group) => (
    group.roleProfileId && (group.agents.length > 0 || group.handoffs.length > 0)
  ))?.roleProfileId ?? groups.find((group) => group.roleProfileId)?.roleProfileId ?? null;
}

function getHandoffRoleProfileId(
  handoff: VaultCollabHandoffSnapshot,
  roleLookup: RoleProfileLookup,
): string | null {
  const explicit = resolveRoleProfileId(handoff.suggestedRoleProfileId ?? null, null, roleLookup);
  if (explicit) {
    return explicit;
  }

  const queueRole = resolveRoleProfileId(null, handoff.queueKey, roleLookup);
  if (queueRole) {
    return queueRole;
  }

  for (const label of handoff.labels) {
    const labelRole = resolveRoleProfileId(null, label, roleLookup) ?? resolveRoleProfileIdFromTriggers(label, roleLookup);
    if (labelRole) {
      return labelRole;
    }
  }

  return resolveRoleProfileIdFromTriggers(handoff.queueKey, roleLookup);
}

function resolveRoleProfileId(
  explicitRoleProfileId: string | null,
  rawRole: string | null,
  roleLookup: RoleProfileLookup,
): string | null {
  const explicit = explicitRoleProfileId?.trim();
  if (explicit) {
    return resolveExactRoleProfileId(explicit, roleLookup)
      ?? resolveRoleProfileIdFromProfileSignals(explicit, roleLookup)
      ?? null;
  }

  const raw = rawRole?.trim();
  if (!raw) {
    return null;
  }

  return resolveExactRoleProfileId(raw, roleLookup)
    ?? resolveRoleProfileIdFromProfileSignals(raw, roleLookup);
}

function resolveExactRoleProfileId(
  value: string,
  roleLookup: RoleProfileLookup,
): string | null {
  const normalized = normalizeRoleKey(value);
  if (!normalized) {
    return null;
  }

  return roleLookup.byId.get(normalized)?.roleProfileId
    ?? roleLookup.aliasToProfileId.get(normalized)
    ?? null;
}

function resolveRoleProfileIdFromProfileSignals(
  value: string,
  roleLookup: RoleProfileLookup,
): string | null {
  const normalizedValue = normalizeRoleKey(value);
  const valueTokens = tokenizeRoleKey(normalizedValue);
  if (!normalizedValue || valueTokens.length === 0) {
    return null;
  }

  let bestRoleProfileId: string | null = null;
  let bestScore = 0;
  let ambiguous = false;
  for (const profile of roleLookup.profiles) {
    const score = scoreRoleProfileSignalMatch(normalizedValue, valueTokens, profile);
    if (score > bestScore) {
      bestRoleProfileId = profile.roleProfileId;
      bestScore = score;
      ambiguous = false;
    } else if (score > 0 && score === bestScore) {
      ambiguous = true;
    }
  }

  return ambiguous ? null : bestRoleProfileId;
}

function scoreRoleProfileSignalMatch(
  normalizedValue: string,
  valueTokens: string[],
  profile: VaultCollabRoleProfileSnapshot,
): number {
  const strongSignals = [
    profile.roleProfileId,
    profile.displayName,
  ].map(normalizeRoleKey).filter(Boolean);
  const triggerSignals = [
    profile.lifecycleStage,
    ...profile.triggerLabels,
  ].map(normalizeRoleKey).filter(Boolean);
  let score = 0;

  for (const signal of strongSignals) {
    if (containsRoleSignal(normalizedValue, signal)) {
      score += 100 + tokenizeRoleKey(signal).length;
    }
  }

  for (const signal of triggerSignals) {
    if (containsRoleSignal(normalizedValue, signal)) {
      score += 45 + tokenizeRoleKey(signal).length;
    }
  }

  const signalTokens = new Set<string>();
  for (const signal of [...strongSignals, ...triggerSignals]) {
    for (const token of tokenizeRoleKey(signal)) {
      signalTokens.add(token);
      const stem = stemRoleToken(token);
      if (stem && stem !== token) {
        signalTokens.add(stem);
      }
    }
  }

  let tokenMatches = 0;
  for (const valueToken of valueTokens) {
    const stem = stemRoleToken(valueToken);
    if (signalTokens.has(valueToken) || (stem ? signalTokens.has(stem) : false)) {
      tokenMatches += 1;
    }
  }

  if (tokenMatches > 0) {
    score += tokenMatches * 8;
  }

  return score;
}

function resolveRoleProfileIdFromTriggers(value: string, roleLookup: RoleProfileLookup): string | null {
  const normalized = normalizeRoleKey(value);
  if (!normalized) {
    return null;
  }

  return roleLookup.profiles.find((profile) => (
    profile.triggerLabels.some((label) => normalizeRoleKey(label) === normalized)
  ))?.roleProfileId ?? null;
}

function getRoleDisplayName(
  roleProfileId: string | null,
  fallbackRole: string,
  roleLookup: RoleProfileLookup,
): string {
  if (roleProfileId) {
    return roleLookup.byId.get(normalizeRoleKey(roleProfileId))?.displayName ?? formatTitleLabel(roleProfileId);
  }

  return formatTitleLabel(fallbackRole);
}

function formatSessionRoleLabel(
  rawRole: string,
  roleProfileId: string | null,
  roleLookup: RoleProfileLookup,
): string {
  const displayName = getRoleDisplayName(roleProfileId, rawRole, roleLookup);
  return normalizeRoleKey(displayName) === normalizeRoleKey(rawRole)
    ? displayName
    : `${displayName} / ${rawRole}`;
}

function normalizeRoleKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tokenizeRoleKey(value: string): string[] {
  return normalizeRoleKey(value)
    .split('-')
    .filter((token) => token.length >= 3 && !ROLE_SIGNAL_STOP_WORDS.has(token));
}

function containsRoleSignal(normalizedValue: string, normalizedSignal: string): boolean {
  if (!normalizedSignal) {
    return false;
  }

  return normalizedValue === normalizedSignal
    || normalizedValue.startsWith(`${normalizedSignal}-`)
    || normalizedValue.endsWith(`-${normalizedSignal}`)
    || normalizedValue.includes(`-${normalizedSignal}-`);
}

function stemRoleToken(token: string): string | null {
  if (token.endsWith('ation') && token.length > 7) {
    return token.slice(0, -5);
  }

  if (token.endsWith('ing') && token.length > 6) {
    return token.slice(0, -3);
  }

  if (token.endsWith('er') && token.length > 5) {
    return token.slice(0, -2);
  }

  return token;
}

const ROLE_SIGNAL_STOP_WORDS = new Set(['agent', 'worker', 'office', 'role']);

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
      const latestMessages = thread.latestMessages ?? [];
      if (latestMessages.length > 0) {
        for (const message of latestMessages) {
          entries.push({
            id: `message:${message.messageUid}`,
            at: message.createdAt,
            kind: 'message',
            author: message.sessionUid ?? message.agentUid ?? undefined,
            body: formatConversationMessageBody(thread, message),
            handoffUid: handoff.handoffUid,
          });
        }
        continue;
      }

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

    if (!isConversationEvent(event)) {
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
    case 'in_progress':
      return 'in_progress';
    case 'claimed':
      return 'claimed';
    case 'verification_needed':
      return 'verification_needed';
    case 'blocked':
    case 'awaiting_user':
      return null;
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

function isRosterVisibleSession(session: VaultCollabSessionSnapshot, showInactiveSessions = false): boolean {
  if (hasEnabledCapability(session.capabilities.dashboardActions)) {
    return false;
  }

  if (showInactiveSessions && INACTIVE_OFFICE_STATUSES.includes(session.effectiveStatus)) {
    return true;
  }

  return isLiveRosterSession(session) && isActiveOfficeSessionStatus(session.effectiveStatus);
}

function isActiveOfficeSessionStatus(status: string): boolean {
  return ACTIVE_OFFICE_STATUSES.includes(status as VaultCollabSessionStatus);
}

function hasEnabledCapability(value: unknown): boolean {
  return Boolean(value) && value !== 'false';
}

function getSessionRole(session: VaultCollabSessionSnapshot): string {
  return getSessionRawRole(session);
}

function getSessionRawRole(session: VaultCollabSessionSnapshot): string {
  if (session.role?.trim()) {
    return session.role.trim();
  }

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

function formatConversationMessageBody(
  thread: VaultCollabHandoffSnapshot['discussionThreads'][number],
  message: VaultCollabHandoffSnapshot['discussionThreads'][number]['latestMessages'][number],
): string {
  const typeLabel = message.messageType === 'note' ? '' : ` (${formatLooseLabel(message.messageType)})`;
  return `${thread.title}${typeLabel}: ${formatPreviewText(message.body, 500)}`;
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
        ? `handled by ${formatVaultCollabShortUid(launchRequest.brokerSessionUid, 8)}`
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

function buildHandoffRow(
  handoff: VaultCollabHandoffSnapshot,
  now: Date,
  roleLookup: RoleProfileLookup,
): VaultCollabHandoffRow {
  const queueLabel = formatQueueSummary(handoff);
  const attention = handoff.status === 'awaiting_user';
  const visibleLabels = handoff.labels.slice(0, 3);
  const extraCount = handoff.labels.length - visibleLabels.length;
  const suggestedRoleProfileId = getHandoffRoleProfileId(handoff, roleLookup);
  const routeHintLabel = suggestedRoleProfileId
    ? `${getRoleDisplayName(suggestedRoleProfileId, suggestedRoleProfileId, roleLookup)} office`
    : null;

  return {
    uid: handoff.handoffUid,
    shortUid: formatVaultCollabShortUid(handoff.handoffUid),
    title: formatHandoffCardTitle(handoff.shortPrompt, handoff.handoffUid),
    prompt: handoff.shortPrompt,
    promptPreview: formatPreviewText(handoff.shortPrompt, 260),
    statusLabel: formatStatusLabel(handoff.status),
    badgeClass: getHandoffBadgeClass(handoff.status),
    railClass: getHandoffRailClass(handoff.status),
    priorityLabel: handoff.urgent ? 'urgent' : handoff.priority,
    routeLabel: `${handoff.sourceProject} -> ${handoff.targetProject}`,
    routeHintLabel,
    suggestedRoleProfileId,
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

function formatHandoffCardTitle(prompt: string, handoffUid: string): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return formatVaultCollabShortUid(handoffUid);
  }

  const colonIndex = normalized.indexOf(':');
  if (colonIndex >= 8 && colonIndex <= 72) {
    return normalized.slice(0, colonIndex).trim();
  }

  return formatPreviewText(normalized, 72) || formatVaultCollabShortUid(handoffUid);
}

function buildSelectedHandoff(
  handoff: VaultCollabHandoffSnapshot,
  permissionEvent: VaultCollabEventSnapshot | null,
  now: Date,
  dashboardSessionUid: string | null,
  roleLookup: RoleProfileLookup,
): VaultCollabSelectedHandoff {
  const attentionQuestion = handoff.status === 'awaiting_user'
    ? handoff.progressNote || getPermissionQuestionFromEvent(permissionEvent)
    : null;
  const suggestedRoleProfileId = getHandoffRoleProfileId(handoff, roleLookup);
  const suggestedOffice = suggestedRoleProfileId
    ? getRoleDisplayName(suggestedRoleProfileId, suggestedRoleProfileId, roleLookup)
    : null;

  return {
    uid: handoff.handoffUid,
    shortUid: formatVaultCollabShortUid(handoff.handoffUid),
    sourceProject: handoff.sourceProject,
    targetProject: handoff.targetProject,
    prompt: handoff.shortPrompt,
    statusLabel: formatStatusLabel(handoff.status),
    badgeClass: getHandoffBadgeClass(handoff.status),
    attentionQuestion,
    progressNote: attentionQuestion ? null : handoff.progressNote,
    permissionMeta: permissionEvent && attentionQuestion ? formatPermissionRequestMeta(permissionEvent, now) : null,
    meta: [
      { label: 'Priority', value: handoff.urgent ? 'urgent' : handoff.priority },
      { label: 'Route', value: `${handoff.sourceProject} -> ${handoff.targetProject}` },
      ...(suggestedOffice ? [{ label: 'Suggested office', value: suggestedOffice }] : []),
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

function buildEventFeed(
  events: VaultCollabEventSnapshot[],
  now: Date,
  selectedPrefix: string | null,
): VaultCollabEventFeedModel {
  const safePrefix = selectedPrefix && EVENT_FEED_PREFIXES.includes(selectedPrefix)
    ? selectedPrefix
    : EVENT_FEED_PREFIXES[0];
  const visibleEvents = events
    .filter((event) => event.eventType.startsWith(safePrefix))
    .sort(compareEventsNewestFirst)
    .slice(0, 30)
    .map((event) => buildEventFeedRow(event, now));

  return {
    prefixes: [...EVENT_FEED_PREFIXES],
    selectedPrefix: safePrefix,
    visibleEvents,
  };
}

function buildPolicyPanel(
  policyPacks: VaultCollabPolicyPackSnapshot[],
  events: VaultCollabEventSnapshot[],
  now: Date,
): VaultCollabPolicyPanelModel {
  return {
    packs: policyPacks.map((pack) => ({
      uid: pack.uid,
      name: pack.name,
      active: pack.active,
      builtInBadge: pack.builtIn ? 'built in' : null,
      toggleAction: pack.active ? 'deactivate' : 'activate',
    })),
    recentEvents: events
      .filter((event) => event.eventType.startsWith('policy.'))
      .sort(compareEventsNewestFirst)
      .slice(0, 8)
      .map((event) => buildEventFeedRow(event, now)),
  };
}

function buildEventRegistry(eventTypes: VaultCollabEventTypeSnapshot[]): VaultCollabEventRegistryModel {
  const rows = eventTypes
    .map((eventType) => ({
      canonicalName: eventType.canonicalName,
      namespace: eventType.namespace,
      summary: eventType.summary,
      payloadKeys: Object.keys(eventType.payloadShape ?? {}),
      attentionLabel: formatEventAttentionLabel(eventType.attention),
      tokenSafeLabel: eventType.tokenSafety.forbiddenPayloadKeys.length > 0 ? 'token-safe' : 'no token rules',
      legacyAliasLabel: eventType.legacyAliases.length > 0
        ? eventType.legacyAliases.join(', ')
        : null,
    }))
    .sort((left, right) => left.canonicalName.localeCompare(right.canonicalName));

  return {
    rows,
    namespaces: Array.from(new Set(rows.map((row) => row.namespace))).sort(),
    totalCount: rows.length,
  };
}

function buildEventFeedRow(event: VaultCollabEventSnapshot, now: Date): VaultCollabEventFeedRow {
  return {
    id: event.eventId,
    type: event.eventType,
    timeLabel: formatRelativeAge(new Date(event.createdAt), now),
    sessionLabel: event.sessionUid
      ? formatVaultCollabShortUid(event.sessionUid)
      : event.handoffUid
        ? formatVaultCollabShortUid(event.handoffUid)
        : 'system',
    summary: event.eventType.startsWith('policy.')
      ? formatPolicyEventSummary(event)
      : formatEventPayload(event),
  };
}

function compareEventsNewestFirst(
  left: VaultCollabEventSnapshot,
  right: VaultCollabEventSnapshot,
): number {
  const timeDelta = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  return timeDelta !== 0 ? timeDelta : right.eventId - left.eventId;
}

function formatPolicyEventSummary(event: VaultCollabEventSnapshot): string {
  const packName = getStringPayloadValue(event.payload, 'policyPackName')
    ?? getStringPayloadValue(event.payload, 'policyPackUid')
    ?? 'policy';
  const action = getStringPayloadValue(event.payload, 'action')
    ?? getStringPayloadValue(event.payload, 'trigger')
    ?? getStringPayloadValue(event.payload, 'actionType')
    ?? getStringPayloadValue(event.payload, 'eventType');
  const reason = getStringPayloadValue(event.payload, 'reason');

  return [packName, action, reason].filter((part): part is string => Boolean(part)).join(' / ');
}

function getStringPayloadValue(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function formatEventAttentionLabel(attention: VaultCollabEventTypeSnapshot['attention']): string {
  if (attention.scope === 'none') {
    return 'none';
  }

  const roles = attention.roleProfileIds.length > 0
    ? ` / ${attention.roleProfileIds.join(', ')}`
    : '';
  return `${formatStatusLabel(attention.scope)}${roles}`;
}

function getSelectedHandoff(
  handoffs: VaultCollabHandoffSnapshot[],
  selectedHandoffUid?: string | null,
): VaultCollabHandoffSnapshot | null {
  if (!selectedHandoffUid || handoffs.length === 0) {
    return null;
  }

  return handoffs.find((handoff) => handoff.handoffUid === selectedHandoffUid) ?? null;
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
  const latestMessages = thread.latestMessages ?? [];
  const latestMessage = latestMessages[latestMessages.length - 1];
  const parts = [
    thread.lastMessageAt ? `last message ${formatRelativeAge(new Date(thread.lastMessageAt), now)}` : 'no messages yet',
  ];

  if (latestMessage) {
    parts.push(`latest: ${formatPreviewText(latestMessage.body, 120)}`);
  }

  if (thread.createdBySessionUid) {
    parts.push(`created by ${formatVaultCollabShortUid(thread.createdBySessionUid)}`);
  }

  if (thread.resolvedAt) {
    parts.push(`resolved ${formatRelativeAge(new Date(thread.resolvedAt), now)}`);
  }

  parts.push(`${thread.messageCount} message${thread.messageCount === 1 ? '' : 's'}`);

  return parts.join(' / ');
}

function formatPreviewText(value: unknown, maxLength: number): string {
  const text = typeof value === 'string' ? value : '';
  return text.length > maxLength + 3 ? `${text.slice(0, maxLength)}...` : text;
}

function isConversationEvent(event: VaultCollabEventSnapshot): boolean {
  return event.eventType !== SESSION_PINGED_EVENT;
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
    default:
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
    default:
      return 'closed';
  }
}

function formatLooseLabel(value: string): string {
  return value.replace(/[_-]/g, ' ');
}

function formatTitleLabel(value: string): string {
  return formatLooseLabel(value)
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
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
