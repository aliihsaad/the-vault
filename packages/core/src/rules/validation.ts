// ============================================================================
// Vault — Validation Schemas (Zod)
// Runtime validation for all inputs.
// ============================================================================

import { z } from 'zod';
import {
  MemoryTypeSchema,
  RoutineTypeSchema,
  StatusSchema,
  PrioritySchema,
  SourceAppSchema,
  TaskTypeSchema,
  TaskStatusSchema,
  TaskPrioritySchema,
  OutcomeSchema,
  ProjectTypeSchema,
  ActorKindSchema,
  LoopPrioritySchema,
  LoopBlockingScopeSchema,
  LoopTriggerKindSchema,
  LoopStateSchema,
  LoopOutcomeSchema,
  WorkIntentSchema,
  EvidenceKindSchema,
  ApprovalDecisionSchema,
} from './controlled-values.js';

export const MEMORY_CONTENT_MAX_CHARS = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Save Memory Input
// ---------------------------------------------------------------------------
export const SaveMemoryInputSchema = z.object({
  title: z.string().min(1).max(200),
  project: z.string().min(1).max(100),
  memoryType: MemoryTypeSchema,
  subject: z.string().min(1).max(300),
  summary: z.string().min(1).max(5000),
  content: z.string().max(MEMORY_CONTENT_MAX_CHARS).optional(),
  keywords: z.array(z.string().max(50)).max(20).optional().default([]),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
  routineType: RoutineTypeSchema.optional(),
  status: StatusSchema.optional().default('active'),
  priority: PrioritySchema.optional().default('normal'),
  sourceApp: SourceAppSchema.optional().default('manual'),
  sourceSessionId: z.string().max(200).optional(),
  nextSteps: z.array(z.string().max(500)).max(20).optional().default([]),
  relatedItemIds: z.array(z.string()).max(50).optional().default([]),
  relatedFiles: z.array(z.string()).max(50).optional().default([]),
});

export type ValidatedSaveInput = z.infer<typeof SaveMemoryInputSchema>;

// ---------------------------------------------------------------------------
// Find Memory Query
// ---------------------------------------------------------------------------
export const FindMemoryQuerySchema = z.object({
  project: z.string().optional(),
  memoryType: MemoryTypeSchema.optional(),
  subject: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  status: StatusSchema.optional(),
  priority: PrioritySchema.optional(),
  promoted: z.boolean().optional(),
  sourceApp: SourceAppSchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

export type ValidatedFindQuery = z.infer<typeof FindMemoryQuerySchema>;

// ---------------------------------------------------------------------------
// Recall Query
// ---------------------------------------------------------------------------
export const RecallQuerySchema = z.object({
  project: z.string().optional(),
  subject: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  queryText: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional().default(10),
});

export type ValidatedRecallQuery = z.infer<typeof RecallQuerySchema>;

// ---------------------------------------------------------------------------
// Update Memory Input
// ---------------------------------------------------------------------------
export const UpdateMemoryInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(300).optional(),
  summary: z.string().min(1).max(5000).optional(),
  content: z.string().max(MEMORY_CONTENT_MAX_CHARS).optional(),
  keywords: z.array(z.string().max(50)).max(20).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  routineType: RoutineTypeSchema.optional(),
  status: StatusSchema.optional(),
  priority: PrioritySchema.optional(),
  nextSteps: z.array(z.string().max(500)).max(20).optional(),
  relatedItemIds: z.array(z.string()).max(50).optional(),
  relatedFiles: z.array(z.string()).max(50).optional(),
});

export type ValidatedUpdateInput = z.infer<typeof UpdateMemoryInputSchema>;

// ---------------------------------------------------------------------------
// Resolve Loop Input (vault_resolve_loop)
// ---------------------------------------------------------------------------
export const ResolveLoopInputSchema = z.object({
  itemUid: z.string().min(1).max(200),
  outcome: OutcomeSchema,
  resolutionNote: z.string().max(2000).optional(),
});

export type ValidatedResolveLoopInput = z.infer<typeof ResolveLoopInputSchema>;

// ---------------------------------------------------------------------------
// Exhaustive Open Loop Inputs
// ---------------------------------------------------------------------------
export const ListOpenLoopsInputSchema = z.object({
  project: z.string().min(1).max(100).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional().default([]),
  priority: PrioritySchema.optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type ValidatedListOpenLoopsInput = z.infer<typeof ListOpenLoopsInputSchema>;

export const CountOpenLoopsInputSchema = z.object({
  project: z.string().min(1).max(100).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional().default([]),
  priority: PrioritySchema.optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
  byProject: z.boolean().optional().default(false),
});

export type ValidatedCountOpenLoopsInput = z.infer<typeof CountOpenLoopsInputSchema>;

export const ResolveLoopBatchInputSchema = z.object({
  items: z.array(z.object({
    itemUid: z.string().min(1).max(200),
    outcome: OutcomeSchema,
    resolutionNote: z.string().max(2000).optional(),
  })).min(1).max(100),
});

export type ValidatedResolveLoopBatchInput = z.infer<typeof ResolveLoopBatchInputSchema>;

// ---------------------------------------------------------------------------
// Open-Loops v2 shared inputs
// ---------------------------------------------------------------------------
const NonEmptyTrimmedString = z.string().trim().min(1);
const IdempotencyKeySchema = NonEmptyTrimmedString.max(200);

export const ActorContextSchema = z.object({
  actorUid: NonEmptyTrimmedString.max(200),
  actorKind: ActorKindSchema,
  roles: z.array(NonEmptyTrimmedString.max(100)).max(50).default([]),
  externalProvider: z.string().trim().max(200).optional(),
  externalDecisionId: z.string().trim().max(500).optional(),
  externalApproved: z.boolean().optional(),
});

const ProjectTypeConfigSchema = z.object({
  description: z.string().trim().min(1).max(5000).optional(),
  canonicalRoot: z.string().trim().min(1).max(2000).optional(),
  repositoryUrl: z.string().trim().min(1).max(2000).optional(),
  defaultBranch: z.string().trim().min(1).max(200).optional(),
  ownerActorUid: z.string().trim().min(1).max(200).optional(),
  ownerRole: z.string().trim().min(1).max(100).optional(),
  memoryPurpose: z.string().trim().min(1).max(5000).optional(),
  authorizationPolicyId: z.string().trim().min(1).max(200).optional(),
  evidencePolicyId: z.string().trim().min(1).max(200).optional(),
  typeConfig: z.record(z.unknown()).optional().default({}),
});

function validateProjectTypeFields(
  projectType: 'work_project' | 'brain_context',
  config: z.infer<typeof ProjectTypeConfigSchema>,
  context: z.RefinementCtx,
): void {
  if (projectType === 'work_project') {
    if (!config.description) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['description'], message: 'Work projects require a description' });
    }
    if (!config.canonicalRoot) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['canonicalRoot'], message: 'Work projects require a canonical source or artifact root' });
    }
  } else if (!config.memoryPurpose) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['memoryPurpose'], message: 'Brain contexts require a memory purpose' });
  }
}

export const CreateProjectInputSchema = ProjectTypeConfigSchema.extend({
  name: NonEmptyTrimmedString.max(100),
  projectType: ProjectTypeSchema.refine(
    (value): value is 'work_project' | 'brain_context' => value !== 'unclassified',
    'New projects require an explicit work_project or brain_context type',
  ),
}).superRefine((input, context) => validateProjectTypeFields(input.projectType, input, context));

export const ProjectClassificationConfigSchema = ProjectTypeConfigSchema;

export const ClassifyProjectInputSchema = z.object({
  project: NonEmptyTrimmedString.max(200),
  targetType: z.enum(['work_project', 'brain_context']),
  config: ProjectClassificationConfigSchema,
  actor: ActorContextSchema,
  expectedVersion: z.number().int().min(0),
  idempotencyKey: IdempotencyKeySchema,
  authorizationRequestUid: z.string().trim().min(1).max(200).optional(),
  dryRun: z.boolean().optional().default(false),
}).superRefine((input, context) => validateProjectTypeFields(input.targetType, input.config, context));

export const ConvertProjectTypeInputSchema = ClassifyProjectInputSchema.and(z.object({
  reason: NonEmptyTrimmedString.max(2000),
}));

export const CreateOpenLoopInputSchema = z.object({
  projectUid: NonEmptyTrimmedString.max(200),
  title: NonEmptyTrimmedString.max(200),
  commitment: NonEmptyTrimmedString.max(5000),
  deferredReason: NonEmptyTrimmedString.max(2000),
  ownerKind: ActorKindSchema,
  ownerReference: NonEmptyTrimmedString.max(200),
  immediateNextAction: NonEmptyTrimmedString.max(2000),
  triggerKind: LoopTriggerKindSchema,
  triggerValue: NonEmptyTrimmedString.max(2000),
  currentEvidenceSummary: NonEmptyTrimmedString.max(5000),
  closureCriteria: NonEmptyTrimmedString.max(5000),
  priority: LoopPrioritySchema,
  blockingScope: LoopBlockingScopeSchema.optional().default('project'),
  dedupeKey: NonEmptyTrimmedString.max(300),
  sourceMemoryUid: z.string().trim().min(1).max(200).optional(),
  sourceTaskUid: z.string().trim().min(1).max(200).optional(),
  sourceSessionUid: z.string().trim().min(1).max(200).optional(),
  sourceHandoffUid: z.string().trim().min(1).max(200).optional(),
  externalReference: z.string().trim().min(1).max(2000).optional(),
  sourceContext: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, 'Source context must not be empty'),
  creatingActor: ActorContextSchema,
  idempotencyKey: IdempotencyKeySchema,
  authorizationRequestUid: z.string().trim().min(1).max(200).optional(),
  correlationUid: z.string().trim().min(1).max(200).optional(),
});

export const ListDedicatedOpenLoopsInputSchema = z.object({
  projectUid: z.string().trim().min(1).max(200).optional(),
  states: z.array(LoopStateSchema).max(20).optional(),
  includeResolved: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(1000).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const CountDedicatedOpenLoopsInputSchema = ListDedicatedOpenLoopsInputSchema.pick({
  projectUid: true,
  states: true,
  includeResolved: true,
}).extend({
  byProject: z.boolean().optional().default(false),
});

export const TransitionOpenLoopInputSchema = z.object({
  loopUid: NonEmptyTrimmedString.max(200),
  nextState: z.enum(['open', 'verification_needed', 'awaiting_approval', 'awaiting_user', 'externally_blocked']),
  reason: NonEmptyTrimmedString.max(2000),
  actor: ActorContextSchema,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: IdempotencyKeySchema,
  correlationUid: z.string().trim().min(1).max(200).optional(),
});

export const AddLoopEvidenceReferenceInputSchema = z.object({
  kind: EvidenceKindSchema,
  reference: NonEmptyTrimmedString.max(4000),
  description: NonEmptyTrimmedString.max(2000),
  immutableHash: z.string().trim().min(8).max(256).optional(),
});

export const AddLoopEvidenceInputSchema = z.object({
  loopUid: NonEmptyTrimmedString.max(200),
  evidence: z.array(AddLoopEvidenceReferenceInputSchema).min(1).max(50),
  currentEvidenceSummary: NonEmptyTrimmedString.max(5000),
  actor: ActorContextSchema,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: IdempotencyKeySchema,
  transitionToVerification: z.boolean().optional().default(false),
  correlationUid: z.string().trim().min(1).max(200).optional(),
});

export const ResolveOpenLoopInputSchema = z.object({
  loopUid: NonEmptyTrimmedString.max(200),
  outcome: LoopOutcomeSchema,
  resolutionNote: NonEmptyTrimmedString.max(5000),
  verifier: ActorContextSchema,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: IdempotencyKeySchema,
  duplicateOfLoopUid: z.string().trim().min(1).max(200).optional(),
  correlationUid: z.string().trim().min(1).max(200).optional(),
}).superRefine((input, context) => {
  if (input.outcome === 'duplicate' && !input.duplicateOfLoopUid) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['duplicateOfLoopUid'], message: 'Duplicate resolution requires a canonical replacement loop UID' });
  }
});

export const RecoverOpenLoopInputSchema = z.object({
  loopUid: NonEmptyTrimmedString.max(200),
  reason: NonEmptyTrimmedString.max(5000),
  actor: ActorContextSchema,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: IdempotencyKeySchema,
  authorizationRequestUid: z.string().trim().min(1).max(200).optional(),
  recoveryState: z.enum(['open', 'verification_needed', 'awaiting_approval', 'awaiting_user', 'externally_blocked']).optional().default('open'),
  correlationUid: z.string().trim().min(1).max(200).optional(),
});

export const RequestLoopSnoozeInputSchema = z.object({
  loopUid: NonEmptyTrimmedString.max(200),
  reason: NonEmptyTrimmedString.max(2000),
  snoozedUntil: z.string().datetime({ offset: true }).optional(),
  dependencyTrigger: z.string().trim().min(1).max(2000).optional(),
  requester: ActorContextSchema,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: IdempotencyKeySchema,
}).superRefine((input, context) => {
  if (Boolean(input.snoozedUntil) === Boolean(input.dependencyTrigger)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide exactly one snooze expiry or dependency trigger' });
  }
});

export const DecideLoopSnoozeInputSchema = z.object({
  requestUid: NonEmptyTrimmedString.max(200),
  loopUid: NonEmptyTrimmedString.max(200),
  decision: ApprovalDecisionSchema,
  reason: NonEmptyTrimmedString.max(2000),
  approver: ActorContextSchema,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: IdempotencyKeySchema,
});

export const EvaluateProjectGateInputSchema = z.object({
  projectUid: NonEmptyTrimmedString.max(200),
  workIntent: WorkIntentSchema,
  relatedLoopUid: z.string().trim().min(1).max(200).optional(),
  actor: ActorContextSchema,
  idempotencyKey: IdempotencyKeySchema,
  authorizationRequestUid: z.string().trim().min(1).max(200).optional(),
});

// ---------------------------------------------------------------------------
// Create Task Input
// ---------------------------------------------------------------------------
export const CreateTaskInputSchema = z.object({
  title: z.string().min(1).max(200),
  taskType: TaskTypeSchema,
  prompt: z.string().min(1).max(50000),
  priority: TaskPrioritySchema.optional().default('normal'),
  project: z.string().max(100).optional(),
  context: z.record(z.unknown()).optional().default({}),
  maxRetries: z.number().int().min(0).max(10).optional().default(2),
  parentTaskUid: z.string().optional(),
  sourceMemoryUid: z.string().optional(),
  targetMemoryUid: z.string().optional(),
  createdBy: z.string().max(50).optional().default('system'),
});

export type ValidatedCreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

// ---------------------------------------------------------------------------
// Find Task Query
// ---------------------------------------------------------------------------
export const FindTaskQuerySchema = z.object({
  status: TaskStatusSchema.optional(),
  taskType: TaskTypeSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  project: z.string().optional(),
  createdBy: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

export type ValidatedFindTaskQuery = z.infer<typeof FindTaskQuerySchema>;
