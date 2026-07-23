// ============================================================================
// Vault — Controlled Values
// All enums and controlled vocabulary for the memory system.
// These are enforced by validation and UI controls.
// ============================================================================

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Memory Types
// ---------------------------------------------------------------------------
export const MEMORY_TYPES = [
  'session',
  'summary',
  'decision',
  'plan',
  'artifact',
  'handoff',
  'reference',
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];
export const MemoryTypeSchema = z.enum(MEMORY_TYPES);

// ---------------------------------------------------------------------------
// Routine Types
// ---------------------------------------------------------------------------
export const ROUTINE_TYPES = [
  'debugging',
  'planning',
  'implementation',
  'review',
  'testing',
  'brainstorming',
  'refactor',
  'deployment',
] as const;

export type RoutineType = (typeof ROUTINE_TYPES)[number];
export const RoutineTypeSchema = z.enum(ROUTINE_TYPES);

// ---------------------------------------------------------------------------
// Status Values
// ---------------------------------------------------------------------------
export const STATUS_VALUES = [
  'active',
  'resolved',
  'draft',
  'stale',
  'archived',
  'pending_delete',
  'promoted',
] as const;

export type StatusValue = (typeof STATUS_VALUES)[number];
export const StatusSchema = z.enum(STATUS_VALUES);

// ---------------------------------------------------------------------------
// Priority Values
// ---------------------------------------------------------------------------
export const PRIORITY_VALUES = [
  'low',
  'normal',
  'high',
  'critical',
  'canonical',
] as const;

export type PriorityValue = (typeof PRIORITY_VALUES)[number];
export const PrioritySchema = z.enum(PRIORITY_VALUES);

// ---------------------------------------------------------------------------
// Source Apps
// ---------------------------------------------------------------------------
export const SOURCE_APPS = [
  'claude',
  'codex',
  'openclaw',
  'manual',
  'other',
] as const;

export type SourceApp = (typeof SOURCE_APPS)[number];
export const SourceAppSchema = z.enum(SOURCE_APPS);

// ---------------------------------------------------------------------------
// Link Types (for memory_links)
// ---------------------------------------------------------------------------
export const LINK_TYPES = [
  'related',
  'informs',
  'led_to',
  'derived_from',
  'supersedes',
] as const;

export type LinkType = (typeof LINK_TYPES)[number];
export const LinkTypeSchema = z.enum(LINK_TYPES);

// ---------------------------------------------------------------------------
// Project Link Types (for project_relationships)
// ---------------------------------------------------------------------------
export const PROJECT_LINK_TYPES = [
  'predecessor_of',
  'related_to',
  'sub_project_of',
  'duplicate_of',
] as const;

export type ProjectLinkType = (typeof PROJECT_LINK_TYPES)[number];
export const ProjectLinkTypeSchema = z.enum(PROJECT_LINK_TYPES);

// ---------------------------------------------------------------------------
// Project Proposal Types and Statuses (for project_proposals)
// ---------------------------------------------------------------------------
export const PROPOSAL_TYPES = [
  'description',
  'relationship',
  'merge',
] as const;

export type ProposalType = (typeof PROPOSAL_TYPES)[number];
export const ProposalTypeSchema = z.enum(PROPOSAL_TYPES);

export const PROPOSAL_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'superseded',
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const ProposalStatusSchema = z.enum(PROPOSAL_STATUSES);

// ---------------------------------------------------------------------------
// Task Types
// ---------------------------------------------------------------------------
export const TASK_TYPES = [
  'coding',
  'image',
  'analysis',
  'summarize',
  'organize',
  'research',
  'enrich',
  'general',
] as const;

export type TaskType = (typeof TASK_TYPES)[number];
export const TaskTypeSchema = z.enum(TASK_TYPES);

// ---------------------------------------------------------------------------
// Task Statuses
// ---------------------------------------------------------------------------
export const TASK_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TaskStatusSchema = z.enum(TASK_STATUSES);

// ---------------------------------------------------------------------------
// Task Priorities
// ---------------------------------------------------------------------------
export const TASK_PRIORITIES = [
  'low',
  'normal',
  'high',
  'urgent',
] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES);

// ---------------------------------------------------------------------------
// Outcome Values — set by vault_resolve_loop when closing an open loop.
// Stored on memory_items.outcome (nullable). Only meaningful when status
// is 'resolved'. See plan vm_-wkwx67j33XDx2aE Step 3.
// ---------------------------------------------------------------------------
export const OUTCOME_VALUES = [
  'fixed',
  'wont_fix',
  'obsolete',
  'duplicate',
] as const;

export type OutcomeValue = (typeof OUTCOME_VALUES)[number];
export const OutcomeSchema = z.enum(OUTCOME_VALUES);

// ---------------------------------------------------------------------------
// Open-Loops v2 — project typing, lifecycle, governance, and loop controls
// ---------------------------------------------------------------------------
export const PROJECT_TYPES = [
  'work_project',
  'brain_context',
  'unclassified',
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];
export const ProjectTypeSchema = z.enum(PROJECT_TYPES);

export const PROJECT_LIFECYCLE_STATES = [
  'legacy_cleanup',
  'shadow',
  'gate_ready',
  'gate_active',
  'suspended',
] as const;

export type ProjectLifecycleState = (typeof PROJECT_LIFECYCLE_STATES)[number];
export const ProjectLifecycleStateSchema = z.enum(PROJECT_LIFECYCLE_STATES);

export const AUTHORIZATION_POLICY_MODES = [
  'owner',
  'role',
  'quorum',
  'external',
] as const;

export type AuthorizationPolicyMode = (typeof AUTHORIZATION_POLICY_MODES)[number];
export const AuthorizationPolicyModeSchema = z.enum(AUTHORIZATION_POLICY_MODES);

export const AUTHORIZATION_ACTIONS = [
  'classify_project',
  'convert_project_type',
  'create_open_loop',
  'request_loop_snooze',
  'decide_loop_snooze',
  'recover_open_loop',
  'urgent_safety_bypass',
] as const;

export type AuthorizationAction = (typeof AUTHORIZATION_ACTIONS)[number];
export const AuthorizationActionSchema = z.enum(AUTHORIZATION_ACTIONS);

export const ACTOR_KINDS = [
  'installation',
  'user',
  'agent',
  'service',
  'external',
] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];
export const ActorKindSchema = z.enum(ACTOR_KINDS);

export const LOOP_STATES = [
  'open',
  'verification_needed',
  'awaiting_approval',
  'awaiting_user',
  'externally_blocked',
  'snoozed',
  'resolved',
] as const;

export type LoopState = (typeof LOOP_STATES)[number];
export const LoopStateSchema = z.enum(LOOP_STATES);

export const NONTERMINAL_LOOP_STATES = LOOP_STATES.filter(
  (state): state is Exclude<LoopState, 'resolved'> => state !== 'resolved',
);

export const LOOP_OUTCOMES = [
  'fixed',
  'obsolete',
  'duplicate',
  'wont_fix',
] as const;

export type LoopOutcome = (typeof LOOP_OUTCOMES)[number];
export const LoopOutcomeSchema = z.enum(LOOP_OUTCOMES);

export const LOOP_PRIORITIES = [
  'low',
  'normal',
  'high',
  'critical',
] as const;

export type LoopPriority = (typeof LOOP_PRIORITIES)[number];
export const LoopPrioritySchema = z.enum(LOOP_PRIORITIES);

export const LOOP_BLOCKING_SCOPES = ['project'] as const;
export type LoopBlockingScope = (typeof LOOP_BLOCKING_SCOPES)[number];
export const LoopBlockingScopeSchema = z.enum(LOOP_BLOCKING_SCOPES);

export const LOOP_TRIGGER_KINDS = [
  'deadline',
  'review_date',
  'dependency',
  'checkpoint',
] as const;

export type LoopTriggerKind = (typeof LOOP_TRIGGER_KINDS)[number];
export const LoopTriggerKindSchema = z.enum(LOOP_TRIGGER_KINDS);

export const LOOP_EVENT_TYPES = [
  'created',
  'state_changed',
  'evidence_added',
  'snooze_requested',
  'snooze_decided',
  'snooze_expired',
  'resolved',
  'recovered',
  'migrated',
] as const;

export type LoopEventType = (typeof LOOP_EVENT_TYPES)[number];
export const LoopEventTypeSchema = z.enum(LOOP_EVENT_TYPES);

export const WORK_INTENTS = [
  'normal_work',
  'close_loop',
  'gather_evidence',
  'request_decision',
  'request_snooze',
  'urgent_safety',
  'memory_maintenance',
] as const;

export type WorkIntent = (typeof WORK_INTENTS)[number];
export const WorkIntentSchema = z.enum(WORK_INTENTS);

export const EVIDENCE_KINDS = [
  'source',
  'commit',
  'test',
  'deployment',
  'reproduction',
  'artifact',
  'url',
  'read_back',
  'approval',
  'decision',
  'canonical_loop',
  'hash',
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS);

export const APPROVAL_DECISIONS = [
  'approved',
  'denied',
] as const;

export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
export const ApprovalDecisionSchema = z.enum(APPROVAL_DECISIONS);

// ---------------------------------------------------------------------------
// Action Types (for activity_logs)
// ---------------------------------------------------------------------------
export const ACTION_TYPES = [
  'save',
  'recall',
  'update',
  'archive',
  'enrich',
  'promote',
  'error',
  'delete',
  'task_create',
  'task_complete',
  'task_fail',
  'proposal_create',
  'proposal_accept',
  'proposal_reject',
  'resolve_loop',
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
export const ActionTypeSchema = z.enum(ACTION_TYPES);

// ---------------------------------------------------------------------------
// Memory Type Priority (for ranking — higher = more important)
// ---------------------------------------------------------------------------
export const MEMORY_TYPE_PRIORITY: Record<MemoryType, number> = {
  decision: 20,
  plan: 15,
  summary: 12,
  handoff: 10,
  artifact: 8,
  reference: 6,
  session: 5,
};

// ---------------------------------------------------------------------------
// Priority Boost (for ranking)
// ---------------------------------------------------------------------------
export const PRIORITY_BOOST: Record<PriorityValue, number> = {
  canonical: 30,
  critical: 20,
  high: 10,
  normal: 0,
  low: -5,
};

// ---------------------------------------------------------------------------
// Open-Loops scoring weights — derived priority bucket assignment for the
// Overview "Open loops" panel. See plan vm_-wkwx67j33XDx2aE and addendum
// vm_aoMAWT1zG56tt9M0. Pure query-side; not stored.
// ---------------------------------------------------------------------------
export const OPEN_LOOP_PRIORITY_WEIGHT: Record<PriorityValue, number> = {
  critical: 20,
  canonical: 20,
  high: 10,
  normal: 5,
  low: 2,
};

export const OPEN_LOOP_ROUTINE_WEIGHT: Record<RoutineType, number> = {
  debugging: 5,
  deployment: 8,
  review: 3,
  implementation: 2,
  refactor: 2,
  testing: 2,
  planning: 0,
  brainstorming: -3,
};

export const OPEN_LOOP_RECENT_REFERENCE_BOOST = 5;
export const OPEN_LOOP_RECENT_REFERENCE_DAYS = 3;
export const OPEN_LOOP_BUCKET_HIGH_THRESHOLD = 15;
export const OPEN_LOOP_BUCKET_MEDIUM_THRESHOLD = 5;
