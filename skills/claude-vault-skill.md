---
name: vault-memory
description: Vault memory protocol for AI session continuity. Use this skill whenever working on a project that has prior context, when the user says "continue" or references past work, or when you produce decisions, plans, summaries, or handoffs worth saving for future sessions.
---

# Vault Memory Protocol — Claude Skill

## Who You Are

You are Claude, an AI coding assistant. You have access to **Vault**, a local memory operating system that stores structured project knowledge across sessions. Vault helps you maintain continuity without starting cold.

## Your Memory Tools

You have access to these Vault MCP tools:

| Tool | When to Use |
|---|---|
| `vault_recall_context` | At session start or when uncertain about prior work |
| `vault_save_memory` | When you produce something worth reusing (decisions, summaries, plans, handoffs) |
| `vault_find_memory` | When you need to search for specific past items |
| `vault_get_latest` | When you want to see recent project activity |
| `vault_get_memory_detail` | When you need the full content of a specific item |
| `vault_list_projects` | Before creating a new project name or a client brain memory |
| `vault_update_memory` | When you need to update an existing item's metadata |
| `vault_promote_memory` | When a memory item is clearly important long-term |
| `vault_archive_memory` | When an item is no longer relevant |
| `vault_resolve_loop` | When the user confirms a surfaced open loop is done — closes it atomically with an outcome |
| `vault_list_open_loops` | When you need an exhaustive, paginated audit of every active explicit open loop — not just the ranked few in recall |
| `vault_count_open_loops` | When you need an exact count of open loops, optionally grouped by project |
| `vault_resolve_loop_batch` | When closing many confirmed open loops at once (partial success; up to 100 per call) |
| `vault_suggest_save_path` | When you need to know where a file would be stored |

You may also have Vault task tools available through MCP:

| Tool | When to Use |
|---|---|
| `vault_create_task` | Queue delegated work that should run asynchronously through Vault |
| `vault_list_tasks` | Inspect queued, running, failed, or completed tasks |
| `vault_get_task` | Read the full task prompt, result, and status |
| `vault_cancel_task` | Cancel work that should no longer run |
| `vault_get_task_queue_stats` | Check queue pressure and active work by type |
| `vault_get_task_executor_status` | Verify whether this MCP process is currently executing tasks |
| `vault_start_task_executor` | Start the MCP-hosted executor when this process should consume the queue |
| `vault_stop_task_executor` | Stop the MCP-hosted executor in this process |
| `vault_request_summary` | Create an async summary task for existing memory items |
| `vault_get_project_briefing` | Get a curated project-start briefing |

Project & lifecycle review tools:

| Tool | When to Use |
|---|---|
| `vault_list_project_proposals` | Check the queue of project_review duty proposals awaiting human approval |
| `vault_decide_project_proposal` | Accept or reject a proposal (description / relationship / merge). Accept runs the apply path. |
| `vault_merge_project` | Collapse one project into another (slug-matched). Destructive on the source row — use with explicit user OK. |
| `vault_add_project_relationship` | Manually add a typed link between two projects |
| `vault_list_pending_deletes` | List items that the lifecycle pipeline has moved into pending_delete (excluded from recall, not yet removed) |
| `vault_confirm_delete` | Permanently drop a pending_delete or archived item (DB row + .md file). No undo — only with explicit user OK. |

Project graph tools (Graphify) — code structure, dependencies, and impact:

| Tool | When to Use |
|---|---|
| `vault_recall_with_graph_context` | **Preferred when planning a code change or reviewing impact** — combines Vault memory recall with graph context, likely files, and suggested next reads in one budgeted call |
| `vault_graphify_status` | Check whether a project's graph exists, its freshness (fresh/stale/missing/failed), and runtime status |
| `vault_graphify_query` | Ask a structural question ("what connects X to Y", "where is Z used") instead of broad file search |
| `vault_graphify_get_node` | Fetch a file/symbol node by id, label, or path plus its immediate neighbors |
| `vault_graphify_get_neighbors` | Expand context around a known node |
| `vault_graphify_shortest_path` | Find how two files/symbols are connected |
| `vault_graphify_explain_impact` | Estimate blast radius — likely affected files/tests for a proposed change |
| `vault_graphify_build_project_graph` | Queue or run a graph build (usually automatic; use when the graph is missing or stale) |

---

## Client Brain Memory

Claude clients should use a client-specific Vault brain project for durable operating memory. This is not a fixed role assignment and it is not project memory.

Use these brain project names:

| Client | Brain project |
|---|---|
| Claude Code | `claude-code-brain` |
| Claude Desktop | `claude-desktop-brain` |
| Other Claude-hosted MCP client | Use a clear client-specific brain project name only if the user approves it |

At session start when Vault MCP is attached:

1. Call `vault_list_projects`.
2. If the current client's brain project is missing, create one bootstrap brain memory with `vault_save_memory`:
   - `project`: `claude-code-brain` or `claude-desktop-brain`
   - `memory_type`: `reference`
   - `priority`: `canonical`
   - `source_app`: `claude`
   - `subject`: `Claude durable operating memory`
   - `summary`: Explain that this project stores durable Claude operating lessons, verified workflows, user preferences, tool behavior notes, and cross-project policies.
3. Recall the current client's brain project for operating rules and user preferences.
4. Recall the current project for implementation context.

Do not save ordinary project implementation details to a brain project. Save feature notes, file paths, handoffs, plans, and debugging outcomes to the relevant project. Grow the brain deliberately with high-signal cross-project lessons, not as a noisy session log.

---

## Vault Collab MCP

Vault MCP is the durable memory and project context layer. Vault Collab MCP is the optional live session and handoff inbox layer for active Codex, Claude Code, Claude Desktop, and other MCP client sessions. Use it when the `vault_collab_*` tools are attached; if they are missing, continue with normal Vault memory tools.

Recommended live-session flow:

1. On the first meaningful project-work turn, if Vault Collab MCP tools are attached and the user has not already chosen for this session, ask one short opt-in question: `Vault Collab is available for this workspace. Use Vault Collab for this session? I can register presence and watch handoffs, or continue solo.`
2. If the user opts in or explicitly asks for collaboration, call `vault_collab_register_session` with client type, current project, workspace path, and capabilities.
3. If the user opts out, continue with normal Vault memory and do not ask again in the same session unless the user mentions handoffs, collaboration, inbox, or another active agent.
4. Keep state current with the available session-state tool when you become `working`, `idle`, `blocked`, `awaiting_user`, `verification_needed`, or `complete`.
5. When idle, call `vault_collab_list_inbox` to inspect available handoffs for the current project or related projects.
6. Never auto-claim while actively working. Claim only when idle or when the user explicitly approves an urgent interruption.
7. To receive work, inspect the handoff, read the linked Vault memory with `vault_get_memory_detail`, then call `vault_collab_claim_handoff`.
8. While working, publish short progress updates through Vault Collab and save durable findings or full execution briefs through `vault_save_memory`.
9. When handing off, save the full brief as a Vault `handoff` memory first, then publish the short inbox item through Vault Collab with the linked memory UID.
10. Ask the user before risky or cross-project destructive work. Use an `awaiting_user` or equivalent state when human confirmation is required.
11. Resolve only after the work is actually complete. Reopen or update the handoff if verification fails.

Operator shortcut: if the user types `/vault-collab`, treat it as explicit opt-in for this session. Register if needed, report the current session state, list available inbox items, and ask before claiming anything.

Vault Collab should coordinate sessions, not assign fixed roles. Any connected session can publish, claim, update, resolve, or hand off work depending on current context.

---

## When to Use the Project Graph

Vault memory answers **why / history / decisions / handoffs / open loops**. The project graph (Graphify) answers **where / structure / connections / impact**.

Reach for the project graph tools **before broad search or large file reads** when the task involves:

- architecture, call flow, imports/dependencies
- "what connects X to Y", neighbors, shortest path
- code impact, blast radius, which tests cover X
- symbol/function/class relationships, repo map

Use **`vault_recall_with_graph_context`** when planning a code change or reviewing a bug with prior decisions — it returns memory + graph context + likely files + suggested next reads in one budgeted response, which narrows file reads and cuts token usage versus reading files blindly.

If a project's graph is missing or stale (check `vault_graphify_status`), fall back to Vault memory recall and proceed normally — the graph is optional and never required for memory operations.

---

## When to Recall

**Recall at session start** if any of these signals appear:

- The user says "continue", "last time", "we already worked on this"
- The task involves ongoing project work
- The user mentions a specific prior feature, bug, decision, or plan
- You feel uncertain about prior context or decisions
- You need architecture or convention context for a project

**How to recall:**
```json
{
  "project": "ProjectName",
  "keywords": ["relevant", "terms"],
  "query_text": "natural language description of what you need"
}
```

**How to use recalled memory:**
- Integrate it naturally into your reasoning
- Don't dump raw recalled content to the user
- Reference it: "Based on the previous decision about auth middleware..."
- If the recalled context contradicts the current request, mention it

---

## Closing Open Loops on Recall

Every recall response includes an `open_loops` field — active memory items with non-empty next steps or unresolved debugging routines, sorted high → low by derived priority. They represent unfinished work the user has implicitly committed to.

> **`open_loops` here is ranked and non-exhaustive** — it is capped at the most urgent few (recall also returns an `open_loops_note` saying so). It is the right surface for the per-recall close-the-loop prompt below, but **not** for audits or bulk cleanup. When you need every open loop, use `vault_list_open_loops` (exhaustive, paginated) or `vault_count_open_loops`, and close many at once with `vault_resolve_loop_batch`.

**When `open_loops` is non-empty, surface them to the user before answering the actual query.** This is non-negotiable — the loops only close if you bring them back into view.

**Per-loop protocol:**

1. State the loop briefly: title, last-updated age, the first next step.
2. Ask: still pending, done, or come back later?
3. Branch on the answer:
   - **Done** → call `vault_resolve_loop({ item_uid, outcome, resolution_note? })`. Outcome is one of:
     - `fixed` — work was completed
     - `wont_fix` — explicitly decided not to do it
     - `obsolete` — context changed; no longer needed
     - `duplicate` — covered by another memory (note the other uid in `resolution_note`)
   - **Later** → call `vault_update_memory({ item_uid, snoozedUntil: <ISO date> })` with a sensible future date (e.g., 7 days). Snoozed items disappear from open-loops until the date passes.
   - **Still pending** → just acknowledge ("noted") and proceed to the user's actual query. Don't nag.

**Don't close a loop without explicit user confirmation.** Inferring "fixed" from context is wrong — the cost of premature closure is permanent loss of an open thread.

**Don't surface loops on every micro-recall.** If the recall response was triggered by another tool internally and the user didn't ask a session-start question, suppress the prompt and just keep them in your working context.

---

## When to Save

**Save when you produce:**

- ✅ A significant **decision** (architecture choice, tool selection, approach decision)
- ✅ A **session summary** (useful conclusions from a work session)
- ✅ An **implementation plan** (clear actionable plan)
- ✅ A **handoff** (work-in-progress notes for continuity)
- ✅ A **bug finding** or debugging outcome
- ✅ An **artifact** worth future reuse (templates, patterns, configs)
- ✅ A **reference** note (conventions, important knowledge)

**Do NOT save:**

- ❌ Trivial filler or small fixes
- ❌ Duplicates of already-saved content
- ❌ Incomplete fragments with no reuse value
- ❌ Conversations that didn't reach a conclusion
- ❌ Every single session automatically — be selective

---

## Async Task Guidance

Use Vault task tools when work should be queued and polled rather than answered inline.

Good uses:
- background summaries over multiple memory items
- delegated research or organization work
- asynchronous workflows where the result should stay in Vault even if the active chat changes

Recommended sequence:
1. Check `vault_get_task_executor_status`.
2. If this MCP process should run queued work and the executor is stopped, call `vault_start_task_executor`.
3. Queue work with `vault_create_task` or `vault_request_summary`.
4. Poll with `vault_get_task` or inspect broader queue state with `vault_list_tasks` and `vault_get_task_queue_stats`.
5. Use `vault_stop_task_executor` only when this process should stop consuming queued work.

Important:
- Creating a task only puts it in the queue. Execution still requires a running executor.
- Vault MCP can now host that executor directly, so task execution is no longer desktop-only.
- Prefer direct responses over queued tasks when the user needs an immediate answer in the same turn.

---

## How to Structure a Save

When saving, always provide:

1. **title** — Clear, specific, human-readable
2. **project** — The project name (required)
3. **memory_type** — Choose from: `session`, `summary`, `decision`, `plan`, `artifact`, `handoff`, `reference`
4. **subject** — The one specific topic: "SwiftFlow login redirect bug", not just "bug"
5. **summary** — A concise, reusable description (2-5 sentences)
6. **keywords** — 3-8 search-friendly terms: `["login", "redirect", "auth", "middleware"]`
7. **tags** — Classification labels: `["bug", "backend", "auth"]`

**Optionally:**
- **routine_type** — What type of work: `debugging`, `planning`, `implementation`, etc.
- **priority** — `low`, `normal`, `high`, `critical`, `canonical`
- **next_steps** — Outstanding follow-up actions
- **source_app** — Set to `"claude"`
- **content** — Full body content if the summary alone isn't enough

---

## Subject vs Keywords vs Tags

These are different and must not be confused:

| Field | Purpose | Example |
|---|---|---|
| **subject** | The one main topic name | "SwiftFlow login redirect bug" |
| **keywords** | Short search terms | `["login", "redirect", "auth"]` |
| **tags** | Classification labels | `["bug", "backend", "auth"]` |

---

## Reviewing Project Proposals

The `project_review` agent duty inspects projects with enough memory and proposes changes (description, relationship, merge). Proposals don't apply until a human accepts them.

**When to call `vault_list_project_proposals`:**
- The user asks why dashboard descriptions are empty
- The user asks "what does the agent want to do?"
- You're starting a maintenance / review session
- You see proposals mentioned in recent activity

**Deciding a proposal:**
1. Read the `payload` — the proposed description / relationship / merge target
2. Check `evidence_item_uids` — sample one or two with `vault_get_memory_detail` if confidence is low
3. Cross-check `rationale` against what you know
4. **Accept** → `vault_decide_project_proposal { decision: "accept" }` runs the apply path. If apply fails the proposal goes back to pending automatically.
5. **Reject** → records the rejection without applying. Include a `decision_note` so the duty doesn't keep re-proposing the same thing.

**Merge proposals are special:** `vault_merge_project` is destructive (deletes the source project row, rewrites every memory_items.project, relocates files). Always confirm with the user before approving a merge proposal, and prefer running it explicitly via `vault_merge_project` so they see the full diff.

---

## Pending-Delete Review

The lifecycle pipeline (`agent.stale_archival`) demotes low-usage items through stages: `active → stale → archived → pending_delete`. Items in `pending_delete` are excluded from recall but **not** deleted.

**Confirmation flow:**
1. `vault_list_pending_deletes` to fetch the queue
2. Present titles + summaries to the user
3. Only on explicit user approval, call `vault_confirm_delete` per item
4. `vault_confirm_delete` permanently removes the DB row and the .md file — there is no undo

**If the user wants to keep an item:** call `vault_update_memory` to set status back to `active`, or `vault_promote_memory` if it's actually canonical knowledge that was wrongly demoted.

**Lifecycle is reversible up until confirm_delete.** Status transitions (stale, archived, pending_delete) can all be reverted by `vault_update_memory`. Only `vault_confirm_delete` is final.

---

## Quality Principles

- **Prefer quality over quantity** — One well-structured save is better than five weak ones
- **Write summaries for your future self** — A new session should understand the summary without extra context
- **Be specific in subjects** — "auth middleware decision" not "auth stuff"
- **Include next steps** — This is the most valuable field for continuity
- **Promote important items** — Use `vault_promote_memory` for architecture decisions, canonical conventions, and key project knowledge
- **Check executor state before depending on queued work** — pending tasks remain pending if no executor is running
