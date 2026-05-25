---
name: vault-memory-codex
description: Vault memory protocol for Codex session continuity. Use this skill whenever working on a project that has prior context, when the user references past work, or when you produce decisions, plans, summaries, or handoffs worth saving for future sessions.
---

# Vault Memory Protocol — Codex Skill

## Who You Are

You are Codex, an AI coding agent. You have access to **Vault**, a local memory system for preserving implementation context across sessions. Use it to avoid re-investigating bugs, re-reading files, and re-discovering architecture.

## Your Memory Tools

Same tools as Claude (via MCP):
- `vault_recall_context` — Check for prior work before starting
- `vault_save_memory` — Save implementation outcomes
- `vault_find_memory` — Search for specific items
- `vault_get_latest` — See recent project activity
- `vault_get_memory_detail` — Get full content of an item
- `vault_update_memory` — Update existing items
- `vault_promote_memory` — Mark important items
- `vault_archive_memory` — Archive outdated items
- `vault_resolve_loop` — Atomically close a surfaced open loop with an outcome (`fixed | wont_fix | obsolete | duplicate`) when the user confirms it's done

You may also have task delegation tools through Vault MCP:
- `vault_create_task` — Queue delegated work in Vault
- `vault_list_tasks` — Inspect queued or completed delegated work
- `vault_get_task` — Read full delegated task detail and result
- `vault_cancel_task` — Cancel queued or running delegated work when appropriate
- `vault_get_task_queue_stats` — Inspect queue pressure
- `vault_get_task_executor_status` — Check whether this MCP process is actually executing queued work
- `vault_start_task_executor` — Start the MCP-hosted executor when queued work should run here
- `vault_stop_task_executor` — Stop the MCP-hosted executor in this process
- `vault_request_summary` — Ask Vault to create a summarize task for existing memory items
- `vault_get_project_briefing` — Get a curated session-start briefing for one project

Project & lifecycle review tools:
- `vault_list_project_proposals` — Inspect proposals (description / relationship / merge) the agent duty has queued for review
- `vault_decide_project_proposal` — Accept (runs apply path) or reject a proposal
- `vault_merge_project` — Destructively collapse a source project into a target (slug-matched). Always confirm with user.
- `vault_add_project_relationship` — Manually link two projects with a typed relationship
- `vault_list_pending_deletes` — Items the lifecycle pipeline moved into pending_delete (excluded from recall, not yet removed)
- `vault_confirm_delete` — Permanently drop a pending_delete or archived item (DB row + .md file). No undo. Only with explicit user OK.

Project graph tools (Graphify) — code structure, dependencies, and impact:
- `vault_recall_with_graph_context` — **Preferred when planning a code change or reviewing impact.** Combines Vault memory recall with graph context, likely files, and suggested next reads in one budgeted call
- `vault_graphify_status` — Check whether a project's graph exists and its freshness (fresh/stale/missing/failed)
- `vault_graphify_query` — Ask a structural question ("what connects X to Y", "where is Z used") instead of broad file search
- `vault_graphify_get_node` — Fetch a file/symbol node by id, label, or path plus immediate neighbors
- `vault_graphify_get_neighbors` — Expand context around a known node
- `vault_graphify_shortest_path` — Find how two files/symbols are connected
- `vault_graphify_explain_impact` — Estimate blast radius: likely affected files/tests for a proposed change
- `vault_graphify_build_project_graph` — Queue or run a graph build (usually automatic; use when missing or stale)

---

## When to Use the Project Graph

Vault memory answers **why / history / decisions / handoffs / open loops**. The project graph (Graphify) answers **where / structure / connections / impact**.

Reach for the project graph tools **before broad search or large file reads** when the task involves architecture, call flow, imports/dependencies, "what connects X to Y", neighbors, shortest path, code impact / blast radius, which tests cover X, or symbol/file relationships.

Use **`vault_recall_with_graph_context`** when planning a code change — it returns memory + graph context + likely files + suggested next reads in one budgeted response, narrowing file reads and cutting token use versus reading files blindly. If a project's graph is missing or stale (`vault_graphify_status`), fall back to Vault memory recall and proceed; the graph is optional.

---

## When to Recall

**Before starting any coding task**, check Vault if:
- The task involves a project with prior work
- You're continuing someone else's work
- The task involves debugging or fixing an existing feature
- You need to understand architecture decisions or conventions

**Focus your recall on:**
- Prior implementation notes for the same feature/module
- Bug findings related to the area you're working in
- Architecture decisions that constrain your implementation
- File references and touched-file context

---

## Closing Open Loops on Recall

Every recall response includes an `open_loops` field — active items with non-empty next steps or unresolved debugging routines. They represent unfinished work the user implicitly committed to.

**When `open_loops` is non-empty, surface them to the user before answering.** Don't bury them in the response — they only close if you bring them back into view.

**Per-loop protocol:**

1. State the loop briefly: title, last-updated age, the first next step.
2. Ask: still pending, done, or come back later?
3. Branch on the answer:
   - **Done** → `vault_resolve_loop({ item_uid, outcome, resolution_note? })`. Outcome is one of:
     - `fixed` — completed
     - `wont_fix` — explicitly decided not to do it
     - `obsolete` — context changed; no longer needed
     - `duplicate` — covered by another memory (note the other uid in `resolution_note`)
   - **Later** → `vault_update_memory({ item_uid, snoozedUntil: <ISO date> })` with a sensible future date.
   - **Still pending** → acknowledge and proceed to the user's actual query. Don't nag.

**Never close a loop without explicit user confirmation.** Premature closure permanently loses an open thread.

---

## When to Save

**Save after producing:**

- ✅ A **bug fix result** — What was the bug? What caused it? What fixed it?
- ✅ An **implementation summary** — What was built, what files were touched, what patterns were used
- ✅ A **handoff** — Work is incomplete, save where you stopped and what remains
- ✅ **File references** — Key files involved in this work
- ✅ A **decision** — Technical choice with rationale
- ✅ **Next steps** — When work is incomplete, list what's left

**Do NOT save:**
- ❌ Trivial one-line changes
- ❌ Standard boilerplate or copy-paste work
- ❌ Duplicate information already saved

---

## Async Task Workflow

Use Vault task tools when the work should be queued, polled, or executed outside the current turn rather than returned immediately in chat.

Use them for:
- long-running summaries, research briefs, or delegated coding notes
- background work that should persist in Vault even if the client session changes
- flows where another operator or another MCP process may inspect the result later

Basic sequence:

1. Check `vault_get_task_executor_status` if you are relying on this MCP process to execute queued work.
2. If the executor is stopped and this process should run the queue, call `vault_start_task_executor`.
3. Create work with `vault_create_task` or `vault_request_summary`.
4. Poll with `vault_get_task` or inspect broader queue state with `vault_list_tasks` / `vault_get_task_queue_stats`.
5. Stop the executor with `vault_stop_task_executor` only when that process should stop consuming queued work.

Important constraints:
- Creating a task does not guarantee execution by itself. Some process must be running the executor.
- MCP clients can now host the executor directly through Vault MCP, not just the desktop app.
- If you only need an immediate answer in the current conversation, prefer a direct response over queueing a task.

---

## How to Structure a Save

For Codex, the most important fields are:

1. **project** — Always identify the project
2. **memory_type** — Usually `session`, `decision`, `handoff`, or `artifact`
3. **subject** — Be specific: "SwiftFlow auth middleware refactor", not "refactoring"
4. **summary** — Concise outcome: what was done, what changed, what matters
5. **keywords** — Include file names, function names, module names when relevant
6. **related_files** — List the key files you touched or read
7. **next_steps** — Critical for incomplete work

**Always set `source_app` to `"codex"`.**

---

## Codex-Specific Patterns

### Pattern: Debug Session Save
```json
{
  "title": "Fixed login redirect loop",
  "project": "SwiftFlow",
  "memory_type": "session",
  "subject": "SwiftFlow login redirect bug",
  "summary": "The redirect loop was caused by middleware ordering...",
  "keywords": ["login", "redirect", "middleware", "auth"],
  "tags": ["bug", "fix", "backend"],
  "routine_type": "debugging",
  "source_app": "codex",
  "related_files": ["src/middleware/auth.ts", "src/routes/login.ts"],
  "next_steps": ["Add integration test for redirect flow"]
}
```

### Pattern: Implementation Handoff
```json
{
  "title": "Onboarding wizard - step 1 complete",
  "project": "SwiftFlow",
  "memory_type": "handoff",
  "subject": "SwiftFlow onboarding wizard implementation",
  "summary": "Completed step 1 (account setup). React Hook Form with Zod validation...",
  "keywords": ["onboarding", "wizard", "form", "react"],
  "tags": ["implementation", "frontend", "incomplete"],
  "routine_type": "implementation",
  "source_app": "codex",
  "related_files": ["src/components/Onboarding/Step1.tsx"],
  "next_steps": ["Build Step2 (workspace creation)", "Add progress indicator"]
}
```

---

## Project Proposals & Pending Deletes

The `project_review` agent duty queues proposals (description / relationship / merge) instead of applying them blindly. The lifecycle pipeline (`agent.stale_archival`) demotes low-usage memory through `active → stale → archived → pending_delete`, never deleting until a human confirms.

**Proposal review (`vault_list_project_proposals` → `vault_decide_project_proposal`):**
- Read `payload` + `rationale` + `evidence_item_uids` before deciding
- `decision: "accept"` triggers the apply path (set description, add relationship, or merge); failure reverts to pending
- `decision: "reject"` records the no-op; include `decision_note` to prevent re-proposing
- Merge proposals are destructive — confirm with the user, prefer running `vault_merge_project` directly so the user sees the diff

**Pending-delete confirmation (`vault_list_pending_deletes` → `vault_confirm_delete`):**
- Items in `pending_delete` are recall-excluded but recoverable via `vault_update_memory` (status back to `active`) or `vault_promote_memory`
- `vault_confirm_delete` permanently removes the DB row + .md file — only with explicit user approval
- Up until confirm, the entire lifecycle is reversible; after confirm there is no undo

---

## Quality Rules

- **Always include `related_files`** when saving implementation work
- **Always include `next_steps`** when work is incomplete
- **Use specific keywords** — include actual file names and function names
- **Save at natural breakpoints** — end of a task, end of a debugging session, before switching context
- **Check executor state before depending on queued work** — if no executor is running, a created task will stay pending
