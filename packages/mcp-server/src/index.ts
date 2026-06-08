#!/usr/bin/env node
// ============================================================================
// Vault — MCP Server Entry Point
// Exposes Vault tools over MCP using StdioServerTransport.
// ============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Vault, OpenRouterClient, TaskExecutor, portableDecrypt, slugify, MEMORY_TYPES, ROUTINE_TYPES, STATUS_VALUES, PRIORITY_VALUES, SOURCE_APPS, TASK_TYPES, TASK_STATUSES, TASK_PRIORITIES, PROPOSAL_STATUSES, PROPOSAL_TYPES, PROJECT_LINK_TYPES, OUTCOME_VALUES, MEMORY_CONTENT_MAX_CHARS } from '@the-vault/core';
import { registerGraphifyMcpTools } from './graphify-tools.js';

// Initialize Vault
const vault = new Vault();
vault.initialize();

// Initialize AI enrichment from vault settings (shared with desktop app).
// Priority: env var > portable-encrypted key > plain key from settings DB
function getOpenRouterApiKey(): string {
  // 1. Env var override (highest priority)
  if (process.env.VAULT_OPENROUTER_API_KEY) {
    return process.env.VAULT_OPENROUTER_API_KEY;
  }

  // 2. Portable-encrypted blob (written by the desktop app — shared format)
  const portableBlob = vault.getSetting('openrouter_api_key_portable');
  if (portableBlob) {
    try {
      const decrypted = portableDecrypt(portableBlob, vault.getVaultRoot());
      if (decrypted) return decrypted;
    } catch (err) {
      console.error('[vault-mcp] portableDecrypt failed:', err instanceof Error ? err.message : String(err));
    }
  }

  // 3. Plain unencrypted key stored directly in settings DB.
  //    Guard against the desktop format (encrypted object) being mistaken
  //    for a plain string — the MCP has no safeStorage/DPAPI context.
  const plainKey = vault.getSetting('openrouter_api_key');
  if (typeof plainKey === 'string' && plainKey.trim()) {
    return plainKey.trim();
  }

  return '';
}

function initializeEnrichment(): void {
  // API key: env override > portable-encrypted copy from desktop
  const apiKey = getOpenRouterApiKey();

  // Model: env override > vault setting
  const model = process.env.VAULT_ENRICHMENT_MODEL
    || (vault.getSetting('enrichment_model') as string)
    || '';

  if (!apiKey || !model) {
    return;
  }

  vault.setEnrichmentClient(new OpenRouterClient(apiKey, model));
}

initializeEnrichment();

const taskExecutor = new TaskExecutor({
  vault,
  getApiKey: () => getOpenRouterApiKey(),
  emitEvent: () => {},
  pollIntervalMs: Number(process.env.VAULT_TASK_EXECUTOR_POLL_MS || 5000),
});

if (process.env.VAULT_AUTO_START_TASK_EXECUTOR === 'true') {
  taskExecutor.start();
}

// Create MCP server
const server = new McpServer({
  name: 'vault-memory',
  version: '0.1.0',
});

// ============================================================================
// Tool: vault_save_memory
// ============================================================================
server.tool(
  'vault_save_memory',
  'Save a structured memory item to Vault. Use this to persist decisions, sessions, plans, summaries, handoffs, artifacts, or references.',
  {
    title: z.string().describe('Human-readable title for the memory item'),
    project: z.string().describe('Project name this memory belongs to'),
    memory_type: z.enum(MEMORY_TYPES).describe('Category of memory: session, summary, decision, plan, artifact, handoff, reference'),
    subject: z.string().describe('Specific main topic name'),
    summary: z.string().describe('Concise reusable description of what the item contains'),
    content: z.string().max(MEMORY_CONTENT_MAX_CHARS).optional().describe('Full content body (optional, max 2 MiB)'),
    keywords: z.array(z.string()).optional().describe('3-8 search-friendly terms'),
    tags: z.array(z.string()).optional().describe('Classification labels'),
    routine_type: z.enum(ROUTINE_TYPES).optional().describe('Type of work: debugging, planning, implementation, etc.'),
    status: z.enum(STATUS_VALUES).optional().describe('Lifecycle state (default: active)'),
    priority: z.enum(PRIORITY_VALUES).optional().describe('Importance level (default: normal)'),
    source_app: z.enum(SOURCE_APPS).optional().describe('Which client created this (auto-detected if omitted)'),
    source_session_id: z.string().optional().describe('Originating session ID'),
    next_steps: z.array(z.string()).optional().describe('Outstanding follow-up actions'),
    related_item_ids: z.array(z.string()).optional().describe('UIDs of related memory items'),
    related_files: z.array(z.string()).optional().describe('File paths related to this memory'),
  },
  async (args) => {
    try {
      const result = vault.saveMemory({
        title: args.title,
        project: args.project,
        memoryType: args.memory_type,
        subject: args.subject,
        summary: args.summary,
        content: args.content,
        keywords: args.keywords,
        tags: args.tags,
        routineType: args.routine_type,
        status: args.status,
        priority: args.priority,
        sourceApp: args.source_app,
        sourceSessionId: args.source_session_id,
        nextSteps: args.next_steps,
        relatedItemIds: args.related_item_ids,
        relatedFiles: args.related_files,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            item_uid: result.item.itemUid,
            vault_path: result.vaultPath,
            message: result.message,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_find_memory
// ============================================================================
server.tool(
  'vault_find_memory',
  'Search and filter memory items by project, type, subject, keywords, tags, status, or date range.',
  {
    project: z.string().optional().describe('Filter by project name'),
    memory_type: z.enum(MEMORY_TYPES).optional().describe('Filter by memory type'),
    subject: z.string().optional().describe('Filter by subject (partial match)'),
    keywords: z.array(z.string()).optional().describe('Filter by keywords'),
    tags: z.array(z.string()).optional().describe('Filter by tags'),
    status: z.enum(STATUS_VALUES).optional().describe('Filter by status'),
    priority: z.enum(PRIORITY_VALUES).optional().describe('Filter by priority'),
    promoted: z.boolean().optional().describe('Filter by promoted status'),
    source_app: z.enum(SOURCE_APPS).optional().describe('Filter by source app'),
    limit: z.number().optional().describe('Max results (default: 20)'),
  },
  async (args) => {
    try {
      const results = vault.findMemory({
        project: args.project,
        memoryType: args.memory_type,
        subject: args.subject,
        keywords: args.keywords,
        tags: args.tags,
        status: args.status,
        priority: args.priority,
        promoted: args.promoted,
        sourceApp: args.source_app,
        limit: args.limit,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: results.length,
            items: results.map((item) => ({
              item_uid: item.itemUid,
              title: item.title,
              project: item.project,
              memory_type: item.memoryType,
              subject: item.subject,
              summary: item.summary,
              status: item.status,
              priority: item.priority,
              promoted: item.promoted,
              tags: item.tags,
              created_at: item.createdAt,
            })),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_recall_context
// ============================================================================
server.tool(
  'vault_recall_context',
  'Smart recall: retrieve the most relevant memory for a given context. Returns a ranked memory pack with summaries, decisions, plans, and other items. Use this at session start or when you need continuity.',
  {
    project: z.string().optional().describe('Project to search within'),
    subject: z.string().optional().describe('Subject to match against'),
    keywords: z.array(z.string()).optional().describe('Keywords to match'),
    tags: z.array(z.string()).optional().describe('Tags to match'),
    query_text: z.string().optional().describe('Natural language query text'),
    limit: z.number().optional().describe('Max results (default: 10)'),
  },
  async (args) => {
    try {
      const pack = await vault.recallContext({
        project: args.project,
        subject: args.subject,
        keywords: args.keywords,
        tags: args.tags,
        queryText: args.query_text,
        limit: args.limit,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total_candidates: pack.totalCandidates,
            top_score: pack.topScore,
            context_summary: pack.contextSummary ?? null,
            open_loops_note: 'Ranked/non-exhaustive: vault_recall_context.open_loops is capped and pressure-ranked. Use vault_list_open_loops or vault_count_open_loops for exhaustive loop audits.',
            top_matches: pack.topMatches.map((match) => ({
              ...briefItem(match.item),
              score: match.score,
              reasons: match.reasons,
            })),
            related: pack.related.map(briefItem),
            proactive: pack.proactive.map(briefItem),
            summaries: pack.summaries.map(briefItem),
            decisions: pack.decisions.map(briefItem),
            plans: pack.plans.map(briefItem),
            other: pack.other.map(briefItem),
            open_loops: (pack.openLoops || []).map((loop) => ({
              uid: loop.itemUid,
              title: loop.title,
              project: loop.project,
              next_steps: loop.nextSteps,
              last_updated: loop.lastUpdated,
              days_open: loop.daysOpen,
              bucket: loop.bucket,
              score: loop.score,
            })),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_get_latest
// ============================================================================
server.tool(
  'vault_get_latest',
  'Get the N most recent memory items, optionally filtered by project.',
  {
    project: z.string().optional().describe('Filter by project'),
    limit: z.number().optional().describe('Number of items (default: 10)'),
  },
  async (args) => {
    try {
      const results = vault.getLatest(args.project, args.limit, {
        logActivity: true,
        sourceClient: 'mcp',
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: results.length,
            items: results.map(briefItem),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_get_memory_detail
// ============================================================================
server.tool(
  'vault_get_memory_detail',
  'Get the full detail of a memory item by its UID, including file content and all metadata.',
  {
    item_uid: z.string().describe('The unique ID of the memory item'),
  },
  async (args) => {
    try {
      const detail = vault.getMemoryDetail(args.item_uid, {
        logActivity: true,
        sourceClient: 'mcp',
      });
      if (!detail) {
        return {
          content: [{ type: 'text' as const, text: `Memory item not found: ${args.item_uid}` }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(detail, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_update_memory
// ============================================================================
server.tool(
  'vault_update_memory',
  'Update metadata of an existing memory item.',
  {
    item_uid: z.string().describe('The unique ID of the memory item to update'),
    title: z.string().optional().describe('New title'),
    subject: z.string().optional().describe('New subject'),
    summary: z.string().optional().describe('New summary'),
    status: z.enum(STATUS_VALUES).optional().describe('New status'),
    priority: z.enum(PRIORITY_VALUES).optional().describe('New priority'),
    tags: z.array(z.string()).optional().describe('New tags'),
    keywords: z.array(z.string()).optional().describe('New keywords'),
    next_steps: z.array(z.string()).optional().describe('New next steps'),
  },
  async (args) => {
    try {
      const updated = vault.updateMemory(args.item_uid, {
        title: args.title,
        subject: args.subject,
        summary: args.summary,
        status: args.status,
        priority: args.priority,
        tags: args.tags,
        keywords: args.keywords,
        nextSteps: args.next_steps,
      });
      if (!updated) {
        return {
          content: [{ type: 'text' as const, text: `Memory item not found: ${args.item_uid}` }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: true, item_uid: updated.itemUid, message: `Updated: ${updated.title}` }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_promote_memory
// ============================================================================
server.tool(
  'vault_promote_memory',
  'Promote a memory item to long-term/canonical memory. Promoted items get a strong boost in recall ranking.',
  {
    item_uid: z.string().describe('The unique ID of the memory item to promote'),
  },
  async (args) => {
    try {
      const promoted = vault.promoteMemory(args.item_uid);
      if (!promoted) {
        return {
          content: [{ type: 'text' as const, text: `Memory item not found: ${args.item_uid}` }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: true, item_uid: promoted.itemUid, message: `Promoted: ${promoted.title}` }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_archive_memory
// ============================================================================
server.tool(
  'vault_archive_memory',
  'Archive a memory item. Archived items receive a penalty in recall ranking but are not deleted.',
  {
    item_uid: z.string().describe('The unique ID of the memory item to archive'),
  },
  async (args) => {
    try {
      const archived = vault.archiveMemory(args.item_uid);
      if (!archived) {
        return {
          content: [{ type: 'text' as const, text: `Memory item not found: ${args.item_uid}` }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: true, item_uid: archived.itemUid, message: `Archived: ${archived.title}` }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_list_open_loops
// ============================================================================
server.tool(
  'vault_list_open_loops',
  'Exhaustively list active memory items with explicit non-empty next steps. Paginated and unranked; use this for bulk open-loop audits instead of vault_recall_context.open_loops.',
  {
    project: z.string().optional().describe('Filter by project'),
    tags: z.array(z.string()).optional().describe('Require all listed tags, case-insensitive'),
    priority: z.enum(PRIORITY_VALUES).optional().describe('Filter by priority'),
    created_from: z.string().optional().describe('Only include items created at or after this ISO timestamp'),
    created_to: z.string().optional().describe('Only include items created at or before this ISO timestamp'),
    limit: z.number().int().min(1).max(1000).optional().describe('Max results (default: 50, max: 1000)'),
    offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
  },
  async (args) => {
    try {
      const result = vault.listOpenLoops({
        project: args.project,
        tags: args.tags,
        priority: args.priority,
        createdFrom: args.created_from,
        createdTo: args.created_to,
        limit: args.limit,
        offset: args.offset,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total: result.total,
            limit: result.limit,
            offset: result.offset,
            has_more: result.hasMore,
            generated_at: result.generatedAt,
            items: result.items.map((item) => ({
              item_uid: item.itemUid,
              title: item.title,
              project: item.project,
              memory_type: item.memoryType,
              subject: item.subject,
              priority: item.priority,
              tags: item.tags,
              next_steps: item.nextSteps,
              last_accessed_at: item.lastAccessedAt,
              created_at: item.createdAt,
              updated_at: item.updatedAt,
            })),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_count_open_loops
// ============================================================================
server.tool(
  'vault_count_open_loops',
  'Count active memory items with explicit non-empty next steps using the same predicate as vault_list_open_loops. Optionally group by project.',
  {
    project: z.string().optional().describe('Filter by project'),
    tags: z.array(z.string()).optional().describe('Require all listed tags, case-insensitive'),
    priority: z.enum(PRIORITY_VALUES).optional().describe('Filter by priority'),
    created_from: z.string().optional().describe('Only include items created at or after this ISO timestamp'),
    created_to: z.string().optional().describe('Only include items created at or before this ISO timestamp'),
    by_project: z.boolean().optional().describe('Include counts grouped by project'),
  },
  async (args) => {
    try {
      const result = vault.countOpenLoops({
        project: args.project,
        tags: args.tags,
        priority: args.priority,
        createdFrom: args.created_from,
        createdTo: args.created_to,
        byProject: args.by_project,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total: result.total,
            by_project: result.byProject,
            generated_at: result.generatedAt,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_resolve_loop_batch
// ============================================================================
server.tool(
  'vault_resolve_loop_batch',
  'Resolve up to 100 active explicit open loops in one call. Partial success is allowed; each successful item uses the same path as vault_resolve_loop.',
  {
    items: z.array(z.object({
      item_uid: z.string().min(1).max(200).describe('Memory item UID to resolve'),
      outcome: z.enum(OUTCOME_VALUES).describe('Resolution outcome: fixed, wont_fix, obsolete, or duplicate'),
      resolution_note: z.string().max(2000).optional().describe('Optional note appended to the memory describing how it was closed'),
    })).min(1).max(100).describe('Batch items to resolve (max 100)'),
  },
  async (args) => {
    try {
      const result = vault.resolveLoopBatch({
        items: args.items.map((item) => ({
          itemUid: item.item_uid,
          outcome: item.outcome,
          resolutionNote: item.resolution_note,
        })),
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            requested: result.requested,
            resolved: result.resolved,
            failed: result.failed.map((failure) => ({
              item_uid: failure.itemUid,
              reason: failure.reason,
              message: failure.message,
            })),
            generated_at: result.generatedAt,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_resolve_loop
// Atomic close for an open loop. Sets status='resolved', records the outcome
// enum, optionally appends a resolution note. Logs a `resolve_loop` activity
// row so close-rate is observable. See plan vm_-wkwx67j33XDx2aE Step 3.
// ============================================================================
server.tool(
  'vault_resolve_loop',
  'Close an open loop on a memory item. Sets status=resolved with an outcome (fixed | wont_fix | obsolete | duplicate) and optionally records a resolution note. Use when the user confirms a surfaced open loop is done. For "come back later" use vault_update_memory with snoozed_until instead.',
  {
    item_uid: z.string().describe('The unique ID of the memory item to resolve'),
    outcome: z.enum(OUTCOME_VALUES).describe('Resolution outcome: fixed, wont_fix, obsolete, or duplicate'),
    resolution_note: z.string().max(2000).optional().describe('Optional short note appended to the memory describing how it was closed'),
  },
  async (args) => {
    try {
      const resolved = vault.resolveLoop({
        itemUid: args.item_uid,
        outcome: args.outcome,
        resolutionNote: args.resolution_note,
      });
      if (!resolved) {
        return {
          content: [{ type: 'text' as const, text: `Memory item not found: ${args.item_uid}` }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            item_uid: resolved.itemUid,
            status: resolved.status,
            outcome: resolved.outcome,
            message: `Resolved (${resolved.outcome}): ${resolved.title}`,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_suggest_save_path
// ============================================================================
server.tool(
  'vault_suggest_save_path',
  'Get the recommended file path for saving a new memory item.',
  {
    project: z.string().describe('Project name'),
    memory_type: z.enum(MEMORY_TYPES).describe('Memory type'),
    title: z.string().describe('Title of the memory item'),
  },
  async (args) => {
    try {
      const path = vault.suggestSavePath(args.project, args.memory_type, args.title);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ suggested_path: path }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_list_projects
// ============================================================================
server.tool(
  'vault_list_projects',
  'List all known Vault projects with slug, description, and memory count. Call this BEFORE creating a memory under a new project name to verify the canonical name and avoid casing/slug drift (e.g. "Whisphry" vs "whisphry").',
  {},
  async () => {
    try {
      const items = vault.listProjects();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: items.length,
            projects: items.map((p) => ({
              name: p.name,
              slug: slugify(p.name),
              description: p.description,
              memory_count: p.memoryCount ?? 0,
              relationships: (p.relationships ?? []).map((r) => ({
                id: r.id,
                source_project: r.sourceProject,
                target_project: r.targetProject,
                link_type: r.linkType,
                note: r.note,
                confidence: r.confidence,
                created_by: r.createdBy,
                created_at: r.createdAt,
              })),
              created_at: p.createdAt,
              updated_at: p.updatedAt,
            })),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_create_task
// ============================================================================
server.tool(
  'vault_create_task',
  'Create a new task in the Vault task queue. The task will be routed to an appropriate AI model based on its type and executed by the Vault agent.',
  {
    title: z.string().describe('Human-readable task title'),
    task_type: z.enum(TASK_TYPES).describe('Type of work: coding, image, analysis, summarize, organize, research, enrich, general'),
    prompt: z.string().describe('The instruction/prompt for the AI model'),
    priority: z.enum(TASK_PRIORITIES).optional().describe('Execution priority (default: normal)'),
    project: z.string().optional().describe('Project scope'),
    context: z.record(z.unknown()).optional().describe('Additional context: related memory UIDs, file paths, etc.'),
    max_retries: z.number().optional().describe('Max retry attempts (default: 2)'),
    source_memory_uid: z.string().optional().describe('Memory item that triggered this task'),
    target_memory_uid: z.string().optional().describe('Memory item this task should update'),
  },
  async (args) => {
    try {
      const task = vault.createTask({
        title: args.title,
        taskType: args.task_type,
        prompt: args.prompt,
        priority: args.priority,
        project: args.project,
        context: args.context,
        maxRetries: args.max_retries,
        sourceMemoryUid: args.source_memory_uid,
        targetMemoryUid: args.target_memory_uid,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            task_uid: task.taskUid,
            title: task.title,
            task_type: task.taskType,
            status: task.status,
            routed_model: task.routedModel,
            message: `Created task: ${task.title}`,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_list_tasks
// ============================================================================
server.tool(
  'vault_list_tasks',
  'List tasks in the Vault task queue, optionally filtered by status, type, priority, or project.',
  {
    status: z.enum(TASK_STATUSES).optional().describe('Filter by status'),
    task_type: z.enum(TASK_TYPES).optional().describe('Filter by task type'),
    priority: z.enum(TASK_PRIORITIES).optional().describe('Filter by priority'),
    project: z.string().optional().describe('Filter by project'),
    limit: z.number().optional().describe('Max results (default: 20)'),
  },
  async (args) => {
    try {
      const tasks = vault.findTasks({
        status: args.status,
        taskType: args.task_type,
        priority: args.priority,
        project: args.project,
        limit: args.limit,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: tasks.length,
            tasks: tasks.map(briefTask),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_get_task
// ============================================================================
server.tool(
  'vault_get_task',
  'Get full detail of a task by its UID, including prompt, result, metadata, and retry info.',
  {
    task_uid: z.string().describe('The unique ID of the task'),
  },
  async (args) => {
    try {
      const task = vault.getTask(args.task_uid);
      if (!task) {
        return {
          content: [{ type: 'text' as const, text: `Task not found: ${args.task_uid}` }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            task_uid: task.taskUid,
            title: task.title,
            task_type: task.taskType,
            status: task.status,
            priority: task.priority,
            project: task.project,
            prompt: task.prompt,
            context: task.context,
            routed_model: task.routedModel,
            result_text: task.resultText,
            result_metadata: task.resultMetadata,
            error_message: task.errorMessage,
            retry_count: task.retryCount,
            max_retries: task.maxRetries,
            parent_task_uid: task.parentTaskUid,
            source_memory_uid: task.sourceMemoryUid,
            target_memory_uid: task.targetMemoryUid,
            created_by: task.createdBy,
            created_at: task.createdAt,
            started_at: task.startedAt,
            completed_at: task.completedAt,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_cancel_task
// ============================================================================
server.tool(
  'vault_cancel_task',
  'Cancel a pending or running task.',
  {
    task_uid: z.string().describe('The unique ID of the task to cancel'),
  },
  async (args) => {
    try {
      const task = vault.cancelTask(args.task_uid);
      if (!task) {
        return {
          content: [{ type: 'text' as const, text: `Task not found or not cancellable: ${args.task_uid}` }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: true, task_uid: task.taskUid, message: `Cancelled: ${task.title}` }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_get_task_queue_stats
// ============================================================================
server.tool(
  'vault_get_task_queue_stats',
  'Get a summary of the current task queue: counts by status and by type.',
  {},
  async () => {
    try {
      const stats = vault.getTaskQueueStats();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            pending: stats.pending,
            running: stats.running,
            completed: stats.completed,
            failed: stats.failed,
            cancelled: stats.cancelled,
            active_by_type: stats.byType,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_get_task_executor_status
// ============================================================================
server.tool(
  'vault_get_task_executor_status',
  'Get the current MCP task executor status and queue counts. Use this before starting work or polling an async task queue.',
  {},
  async () => {
    try {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ...taskExecutor.getStatus(),
            queue: vault.getTaskQueueStats(),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_start_task_executor
// ============================================================================
server.tool(
  'vault_start_task_executor',
  'Start the MCP-hosted Vault task executor so queued tasks can be claimed and executed in this process.',
  {},
  async () => {
    try {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ...taskExecutor.start(),
            queue: vault.getTaskQueueStats(),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_stop_task_executor
// ============================================================================
server.tool(
  'vault_stop_task_executor',
  'Stop the MCP-hosted Vault task executor in this process.',
  {},
  async () => {
    try {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ...taskExecutor.stop(),
            queue: vault.getTaskQueueStats(),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_get_project_briefing
// ============================================================================
server.tool(
  'vault_get_project_briefing',
  'Get a curated briefing for a project: promoted decisions, active plans, recent summaries, and proactive context. Ideal for session start.',
  {
    project: z.string().describe('Project name'),
    keywords: z.array(z.string()).optional().describe('Session keywords for proactive context surfacing'),
    limit: z.number().optional().describe('Max items per category (default: 5)'),
  },
  async (args) => {
    try {
      const briefing = vault.getProjectBriefing(args.project, args.keywords, args.limit || 5, {
        logActivity: true,
        sourceClient: 'mcp',
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            project: briefing.project,
            promoted_decisions: briefing.promotedDecisions.map(briefItem),
            active_plans: briefing.activePlans.map(briefItem),
            recent_summaries: briefing.recentSummaries.map(briefItem),
            recent_handoffs: briefing.recentHandoffs.map(briefItem),
            promoted_items: briefing.promotedItems.map(briefItem),
            proactive_context: briefing.proactiveContext.map(briefItem),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_request_summary
// ============================================================================
server.tool(
  'vault_request_summary',
  'Request an AI-generated summary of specific memory items. Creates an async summarize task — poll the task UID for the result.',
  {
    item_uids: z.array(z.string()).min(1).max(20).describe('Memory item UIDs to summarize'),
    query_context: z.string().optional().describe('What the summary should focus on'),
    project: z.string().optional().describe('Project scope for the task'),
  },
  async (args) => {
    try {
      const task = vault.requestClusterSummary(args.item_uids, args.query_context, args.project);
      if (!task) {
        return {
          content: [{ type: 'text' as const, text: 'No valid memory items found for the given UIDs.' }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            task_uid: task.taskUid,
            message: `Created summarize task for ${args.item_uids.length} items. Poll vault_get_task with this UID for the result.`,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_list_project_proposals
// ============================================================================
server.tool(
  'vault_list_project_proposals',
  'List project proposals (description / relationship / merge) created by the project_review duty. Default returns pending proposals only — these are awaiting human approval before being applied.',
  {
    project: z.string().optional().describe('Filter by project name'),
    status: z.enum(PROPOSAL_STATUSES).optional().describe('Filter by status (default: pending)'),
    proposal_type: z.enum(PROPOSAL_TYPES).optional().describe('Filter by proposal type'),
    limit: z.number().optional().describe('Max results'),
  },
  async (args) => {
    try {
      const proposals = vault.listProjectProposals({
        project: args.project,
        status: args.status ?? 'pending',
        proposalType: args.proposal_type,
        limit: args.limit,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: proposals.length,
            proposals: proposals.map(briefProposal),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_decide_project_proposal
// ============================================================================
server.tool(
  'vault_decide_project_proposal',
  'Accept or reject a pending project proposal. On accept, the apply path runs (e.g. set project description, add relationship, merge projects). If apply fails the proposal is reverted to pending.',
  {
    proposal_uid: z.string().describe('The proposal UID (from vault_list_project_proposals)'),
    decision: z.enum(['accept', 'reject']).describe('accept = run the apply path; reject = mark rejected without applying'),
    decided_by: z.string().optional().describe('Who decided (default: current source app)'),
    decision_note: z.string().optional().describe('Free-text note on the decision'),
  },
  async (args) => {
    try {
      const result = vault.decideProjectProposal({
        proposalUid: args.proposal_uid,
        decision: args.decision,
        decidedBy: args.decided_by,
        decisionNote: args.decision_note,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            applied: result.applied,
            error: result.error ?? null,
            proposal: briefProposal(result.proposal),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_merge_project
// ============================================================================
server.tool(
  'vault_merge_project',
  'Merge sourceProject into targetProject. Rewrites memory_items.project, relocates Markdown files on disk, rewires relationships, and rewrites task/proposal references. Slug-matched on both sides — collapses casing variants like "Whisphry" into "whisphry". Destructive on the source project row.',
  {
    source_project: z.string().describe('Project to merge FROM (will be deleted)'),
    target_project: z.string().describe('Project to merge INTO (will absorb everything)'),
    relocate_files: z.boolean().optional().describe('Whether to physically relocate .md files (default: true)'),
    decided_by: z.string().optional().describe('Who initiated the merge (logged)'),
  },
  async (args) => {
    try {
      const result = vault.mergeProject(args.source_project, args.target_project, {
        relocateFiles: args.relocate_files,
        decidedBy: args.decided_by,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            source_project: result.sourceProject,
            target_project: result.targetProject,
            moved_item_count: result.movedItemUids.length,
            files_relocated: result.filesRelocated,
            files_missing: result.filesMissing,
            rewritten_relationship_ids: result.rewrittenRelationshipIds,
            removed_relationship_ids: result.removedRelationshipIds,
            rewritten_task_uids: result.rewrittenTaskUids,
            rewritten_proposal_uids: result.rewrittenProposalUids,
            source_project_deleted: result.sourceProjectDeleted,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_add_project_relationship
// ============================================================================
server.tool(
  'vault_add_project_relationship',
  'Add a typed relationship between two projects (e.g. depends_on, related_to, parent_of). Slug-resolved on both sides. Idempotent on (source, target, link_type).',
  {
    source_project: z.string().describe('Source project name'),
    target_project: z.string().describe('Target project name'),
    link_type: z.enum(PROJECT_LINK_TYPES).describe('Relationship type'),
    note: z.string().optional().describe('Free-text note describing the relationship'),
    confidence: z.number().optional().describe('Confidence score (0–1) for proposal provenance'),
    created_by: z.string().optional().describe('Who created (default: current source app)'),
  },
  async (args) => {
    try {
      const rel = vault.addProjectRelationship({
        sourceProject: args.source_project,
        targetProject: args.target_project,
        linkType: args.link_type,
        note: args.note,
        confidence: args.confidence,
        createdBy: args.created_by,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            relationship: {
              id: rel.id,
              source_project: rel.sourceProject,
              target_project: rel.targetProject,
              link_type: rel.linkType,
              note: rel.note,
              confidence: rel.confidence,
              created_by: rel.createdBy,
              created_at: rel.createdAt,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_list_pending_deletes
// ============================================================================
server.tool(
  'vault_list_pending_deletes',
  'List memory items in the pending_delete tier of the lifecycle pipeline. These items are excluded from recall but not yet removed — review them and confirm with vault_confirm_delete to drop the DB row + .md file.',
  {
    project: z.string().optional().describe('Filter by project'),
    limit: z.number().optional().describe('Max results (default: 50)'),
  },
  async (args) => {
    try {
      const results = vault.findMemory({
        project: args.project,
        status: 'pending_delete',
        limit: args.limit ?? 50,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: results.length,
            items: results.map(briefItem),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

// ============================================================================
// Tool: vault_confirm_delete
// ============================================================================
server.tool(
  'vault_confirm_delete',
  'PERMANENTLY delete a memory item. Only succeeds if the item is in pending_delete or archived status. Removes the DB row and the .md file from disk. Use only with explicit user approval — there is no undo.',
  {
    item_uid: z.string().describe('UID of the memory item to permanently delete'),
  },
  async (args) => {
    try {
      const ok = vault.confirmMemoryDelete(args.item_uid);
      if (!ok) {
        return {
          content: [{ type: 'text' as const, text: `Cannot delete ${args.item_uid}: item not found or not in pending_delete/archived status.` }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: true, item_uid: args.item_uid, message: `Permanently deleted: ${args.item_uid}` }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

registerGraphifyMcpTools(server, vault);

// ============================================================================
// Helpers
// ============================================================================
function briefItem(item: { itemUid: string; title: string; project: string; memoryType: string; subject: string; summary: string; status: string; priority: string; promoted: boolean; tags: string[]; createdAt: string }) {
  return {
    item_uid: item.itemUid,
    title: item.title,
    project: item.project,
    memory_type: item.memoryType,
    subject: item.subject,
    summary: item.summary,
    status: item.status,
    priority: item.priority,
    promoted: item.promoted,
    tags: item.tags,
    created_at: item.createdAt,
  };
}

function briefTask(task: { taskUid: string; title: string; taskType: string; status: string; priority: string; project: string | null; routedModel: string | null; createdBy: string; createdAt: string; startedAt: string | null; completedAt: string | null }) {
  return {
    task_uid: task.taskUid,
    title: task.title,
    task_type: task.taskType,
    status: task.status,
    priority: task.priority,
    project: task.project,
    routed_model: task.routedModel,
    created_by: task.createdBy,
    created_at: task.createdAt,
    started_at: task.startedAt,
    completed_at: task.completedAt,
  };
}

function briefProposal(p: { id: number; proposalUid: string; project: string; proposalType: string; payload: unknown; rationale: string | null; confidence: number | null; status: string; sourceTaskUid: string | null; evidenceItemUids: string[]; createdBy: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; createdAt: string }) {
  return {
    id: p.id,
    proposal_uid: p.proposalUid,
    project: p.project,
    proposal_type: p.proposalType,
    payload: p.payload,
    rationale: p.rationale,
    confidence: p.confidence,
    status: p.status,
    source_task_uid: p.sourceTaskUid,
    evidence_item_uids: p.evidenceItemUids,
    created_by: p.createdBy,
    decided_by: p.decidedBy,
    decided_at: p.decidedAt,
    decision_note: p.decisionNote,
    created_at: p.createdAt,
  };
}

// ============================================================================
// Start server
// ============================================================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

process.once('SIGINT', () => {
  taskExecutor.stop();
});

process.once('SIGTERM', () => {
  taskExecutor.stop();
});

main().catch((error) => {
  console.error('Fatal MCP server error:', error);
  process.exit(1);
});
