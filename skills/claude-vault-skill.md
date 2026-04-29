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
| `vault_update_memory` | When you need to update an existing item's metadata |
| `vault_promote_memory` | When a memory item is clearly important long-term |
| `vault_archive_memory` | When an item is no longer relevant |
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
