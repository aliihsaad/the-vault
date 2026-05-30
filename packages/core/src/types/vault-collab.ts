import type { VaultCollabRuntimeMode } from '../rules/vault-collab.js';

export interface VaultCollabRuntimeConfig {
  runtimeMode: VaultCollabRuntimeMode;
  managedRuntimePath: string;
  localSourceCheckoutPath: string | null;
  customCliPath: string | null;
  databasePath: string;
}

export interface SaveVaultCollabRuntimeConfigInput {
  runtimeMode?: VaultCollabRuntimeMode;
  managedRuntimePath?: string;
  localSourceCheckoutPath?: string | null;
  customCliPath?: string | null;
  databasePath?: string;
}

export type VaultCollabClientType =
  | 'codex'
  | 'claude-code'
  | 'claude-desktop'
  | 'octogent'
  | 'gemini'
  | 'opencode'
  | 'other';

export type VaultCollabSessionStatus =
  | 'idle'
  | 'working'
  | 'blocked'
  | 'awaiting_user'
  | 'awaiting_verification'
  | 'complete'
  | 'disconnected';

export type VaultCollabSessionConnectionState = 'fresh' | 'stale' | 'disconnected';

export type VaultCollabHandoffStatus =
  | 'available'
  | 'claimed'
  | 'in_progress'
  | 'blocked'
  | 'awaiting_user'
  | 'verification_needed'
  | 'resolved'
  | 'abandoned'
  | 'stale';

export type VaultCollabHandoffPriority = 'low' | 'normal' | 'high' | 'urgent';

export type VaultCollabDiscussionThreadStatus = 'open' | 'resolved';

export type VaultCollabJsonRecord = Record<string, unknown>;

export type VaultCollabLaunchRequestStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'launching'
  | 'running'
  | 'failed';

export interface VaultCollabDiscussionThreadSummary {
  threadUid: string;
  handoffUid: string | null;
  project: string;
  title: string;
  status: VaultCollabDiscussionThreadStatus;
  createdBySessionUid: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  messageCount: number;
  lastMessageAt: string | null;
}

export interface VaultCollabSessionSnapshot {
  sessionUid: string;
  displayName: string;
  clientType: VaultCollabClientType;
  project: string;
  workspacePath: string;
  status: VaultCollabSessionStatus;
  effectiveStatus: VaultCollabSessionStatus;
  connectionState: VaultCollabSessionConnectionState;
  statusDetail: string | null;
  capabilities: VaultCollabJsonRecord;
  agentUid: string | null;
  agentName: string | null;
  agentDisplayName: string | null;
  agentRole: string | null;
  currentHandoffUid: string | null;
  lastHeartbeatAt: string;
  heartbeatAgeMs: number | null;
  createdAt: string;
  updatedAt: string;
  disconnectedAt: string | null;
}

export interface VaultCollabHandoffSnapshot {
  handoffUid: string;
  vaultMemoryUid: string | null;
  shortPrompt: string;
  sourceProject: string;
  targetProject: string;
  relatedProjects: string[];
  relatedFiles: string[];
  sourceSessionUid: string | null;
  suggestedSessionUid: string | null;
  suggestedClientType: VaultCollabClientType | null;
  queueKey: string;
  labels: string[];
  queuePosition: number | null;
  dependsOnHandoffUid: string | null;
  status: VaultCollabHandoffStatus;
  priority: VaultCollabHandoffPriority;
  urgent: boolean;
  claimedBySessionUid: string | null;
  leaseExpiresAt: string | null;
  progressNote: string | null;
  resolutionSummary: string | null;
  reopenReason: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  staleAt: string | null;
  discussionThreads: VaultCollabDiscussionThreadSummary[];
}

export interface VaultCollabEventSnapshot {
  eventId: number;
  handoffUid: string | null;
  sessionUid: string | null;
  eventType: string;
  payload: VaultCollabJsonRecord;
  createdAt: string;
}

export interface VaultCollabLaunchRequestSnapshot {
  launchRequestUid: string;
  provider: VaultCollabClientType;
  model: string;
  effortLevel: string | null;
  project: string;
  workspacePath: string;
  role: string | null;
  initialInstructions: string;
  permissionMode: string;
  commandPreview: string | null;
  requestedCapabilities: string[];
  approvalPolicyVersion: string | null;
  approvalSnapshot: VaultCollabJsonRecord | null;
  status: VaultCollabLaunchRequestStatus;
  statusDetail: string | null;
  requestedBySessionUid: string | null;
  approvedBySessionUid: string | null;
  rejectedBySessionUid: string | null;
  brokerSessionUid: string | null;
  launchedSessionUid: string | null;
  metadata: VaultCollabJsonRecord;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface VaultCollabDashboardCounts {
  sessions: number;
  activeSessions: number;
  idleSessions: number;
  staleSessions: number;
  disconnectedSessions: number;
  openHandoffs: number;
  availableHandoffs: number;
  urgentHandoffs: number;
  permissionNeeded: number;
  permissionNeededSessions: number;
  permissionNeededHandoffs: number;
  permissionRequestEvents: number;
  attentionPingEvents: number;
  launchRequests: number;
  activeLaunchRequests: number;
  requestedLaunchRequests: number;
  approvedLaunchRequests: number;
  launchingLaunchRequests: number;
  runningLaunchRequests: number;
  failedLaunchRequests: number;
  events: number;
  sessionsByStatus: Record<VaultCollabSessionStatus, number>;
  handoffsByStatus: Record<VaultCollabHandoffStatus, number>;
  launchRequestsByStatus: Record<VaultCollabLaunchRequestStatus, number>;
}

export interface VaultCollabDashboardOptions {
  sessionLimit?: number;
  handoffLimit?: number;
  launchRequestLimit?: number;
  eventLimit?: number;
  staleSessionAfterMs?: number;
  staleSessionVisibilityMs?: number;
  closedSessionVisibilityMs?: number;
  now?: Date;
}

export interface VaultCollabDashboardSnapshot {
  configured: boolean;
  ready: boolean;
  dataReady: boolean;
  databasePath: string;
  message: string;
  errorMessage: string | null;
  sessions: VaultCollabSessionSnapshot[];
  handoffs: VaultCollabHandoffSnapshot[];
  launchRequests: VaultCollabLaunchRequestSnapshot[];
  events: VaultCollabEventSnapshot[];
  counts: VaultCollabDashboardCounts;
}

export interface VaultCollabDashboardActor {
  sessionUid: string;
  sessionToken: string;
}

export type VaultCollabDashboardHandoffAction =
  | 'claim'
  | 'release'
  | 'update'
  | 'resolve'
  | 'reopen';

export type VaultCollabDashboardLaunchAction = 'approve' | 'reject' | 'cancel';

export type VaultCollabDashboardDiscussionMessageType =
  | 'note'
  | 'question'
  | 'proposal'
  | 'concern'
  | 'decision';

export type VaultCollabDashboardActionInput =
  | {
      kind: 'handoff';
      action: VaultCollabDashboardHandoffAction;
      handoffUid: string;
      status?: Extract<VaultCollabHandoffStatus, 'in_progress' | 'blocked' | 'awaiting_user' | 'verification_needed'>;
      progressNote?: string;
      summary?: string;
      reason?: string;
    }
  | {
      kind: 'discussion';
      action: 'add_message';
      threadUid: string;
      body: string;
      messageType?: VaultCollabDashboardDiscussionMessageType;
    }
  | {
      kind: 'discussion';
      action: 'create_thread';
      handoffUid: string;
      project: string;
      title: string;
    }
  | {
      kind: 'launch';
      action: VaultCollabDashboardLaunchAction;
      launchRequestUid: string;
      detail?: string;
      reason?: string;
    };

export interface VaultCollabActionInvocation {
  command: string;
  args: string[];
}

export interface VaultCollabActionResult {
  ok: boolean;
  invocation: VaultCollabActionInvocation;
  data: unknown | null;
  error: string | null;
}

export type VaultCollabHandoffActionKind =
  | 'claim'
  | 'update'
  | 'request_user_confirmation'
  | 'request_handoff_permission'
  | 'release'
  | 'resolve'
  | 'recover'
  | 'reopen';

export interface VaultCollabHandoffActionAffordance {
  kind: VaultCollabHandoffActionKind;
  enabled: boolean;
  reason: string;
  toolName: string;
  requiredCapability: string | null;
  requiresOwnerToken: boolean;
  requiresProgressNote: boolean;
  requiresQuestion: boolean;
  requiresReason: boolean;
  requiresSummary: boolean;
  requiresEvidenceVaultMemoryUid: boolean;
}

export interface VaultCollabHandoffActionSet {
  handoff: unknown;
  actingSessionUid: string;
  actions: VaultCollabHandoffActionAffordance[];
}
