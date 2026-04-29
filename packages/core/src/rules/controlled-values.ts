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
