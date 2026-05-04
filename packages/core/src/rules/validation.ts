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
} from './controlled-values.js';

// ---------------------------------------------------------------------------
// Save Memory Input
// ---------------------------------------------------------------------------
export const SaveMemoryInputSchema = z.object({
  title: z.string().min(1).max(200),
  project: z.string().min(1).max(100),
  memoryType: MemoryTypeSchema,
  subject: z.string().min(1).max(300),
  summary: z.string().min(1).max(5000),
  content: z.string().optional(),
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
  content: z.string().optional(),
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
