# Master Plan Status

This document compares the current repository against the product roadmap in [plan.md](C:/Users/Mini/Desktop/Projects/the-vault/plan.md).

Status labels:

- `done`: present in code in a usable MVP form
- `partial`: real implementation exists, but the stage is not complete enough to call finished
- `not started`: not meaningfully implemented yet
- `deferred`: intentionally not the current priority

## Current Priority

The product focus should stay on:

1. finishing the Vault memory core
2. making recall and save quality strong
3. making the desktop and MCP flows clear and easy to use
4. keeping company OS and multi-agent control-plane work deferred

## Stage Summary

| Stage | Status | Notes |
| --- | --- | --- |
| Stage 0 — Product lock | `partial` | Core spec material exists, but the product is still being clarified in the UI and planning docs. |
| Stage 1 — Core backend MVP | `done` | Vault root, SQLite registry, save/retrieve/ranking/logging core all exist. |
| Stage 2 — Protocol layer | `partial` | Protocol spec exists, but enforcement and UX guidance are not consistently surfaced across all flows. |
| Stage 3 — Skills layer | `partial` | Claude and Codex skill docs exist and now document async task/executor usage, but the workflows are still mostly guidance rather than deeply enforced product behavior. |
| Stage 4 — MCP layer | `done` | Core Vault MCP tools are implemented and wired, including queued task tools and executor lifecycle control. |
| Stage 5 — Basic UI MVP | `partial` | Desktop app exists with dashboard, memory, chat, logs, and settings, but some memory-management actions are still thin. |
| Stage 6 — AI enrichment | `partial` | Enrichment service/settings exist, but the feature path is still light and not a fully realized workflow. |
| Stage 7 — Smart recall engine | `partial` | Deterministic recall and ranking exist, but recall quality still needs sharper prioritization and better memory-pack behavior. |
| Stage 8 — Analytics and logs expansion | `partial` | Activity logs and dashboard summaries exist, but richer analytics from the master plan are not there yet. |
| Stage 9 — Memory structure upgrade | `partial` | Update/promote/archive exist in core and MCP, but the desktop UI does not yet expose a full memory-curation workflow. |
| Stage 10 — Visual map | `not started` | No graph/map UI yet. |
| Stage 11 — Automation and maintenance | `not started` | No duplicate workflow, scheduled maintenance, cleanup automation, or recall feedback loop yet. |
| Stage 12 — Company OS integration | `deferred` | Multi-agent/company integration is not the current product priority. |

## Stage Details

### Stage 0 — Product Lock

Status: `partial`

What exists:

- broad product vision in [plan.md](C:/Users/Mini/Desktop/Projects/the-vault/plan.md)
- protocol spec in [protocol-spec.md](C:/Users/Mini/Desktop/Projects/the-vault/docs/protocol-spec.md)
- skill docs in [claude-vault-skill.md](C:/Users/Mini/Desktop/Projects/the-vault/skills/claude-vault-skill.md) and [codex-vault-skill.md](C:/Users/Mini/Desktop/Projects/the-vault/skills/codex-vault-skill.md)

What is still missing:

- one clean “current product definition” document that separates:
  - Vault memory core
  - external MCP client connections
  - Vault’s internal local AI backend

### Stage 1 — Core Backend MVP

Status: `done`

Evidence:

- main entry point: [vault.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/vault.ts)
- schema and DB: [schema.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/database/schema.ts), [connection.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/database/connection.ts)
- save path and file logic: [save.service.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/services/save.service.ts), [file.service.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/services/file.service.ts)
- retrieval and ranking: [retrieve.service.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/services/retrieve.service.ts), [ranking.service.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/services/ranking.service.ts)
- logs and projects: [log.service.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/services/log.service.ts), [project.service.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/services/project.service.ts)

Assessment:

- The MVP backend described in the master plan is present and working.

### Stage 2 — Protocol Layer

Status: `partial`

Evidence:

- written protocol spec: [protocol-spec.md](C:/Users/Mini/Desktop/Projects/the-vault/docs/protocol-spec.md)
- controlled values and validation: [controlled-values.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/rules/controlled-values.ts), [validation.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/rules/validation.ts)

What is still missing:

- stronger protocol enforcement in the desktop save flow
- clearer protocol hints in memory-management UI
- more visible save-quality and anti-noise guidance for human usage

### Stage 3 — Skills Layer

Status: `partial`

Evidence:

- [claude-vault-skill.md](C:/Users/Mini/Desktop/Projects/the-vault/skills/claude-vault-skill.md)
- [codex-vault-skill.md](C:/Users/Mini/Desktop/Projects/the-vault/skills/codex-vault-skill.md)

What is still missing:

- tighter onboarding around how external clients should use the skills
- more obvious “copy and use this” client instructions in the desktop UI
- sharper examples for when to answer inline versus queue delegated work

### Stage 4 — MCP Layer

Status: `done`

Evidence:

- MCP server: [packages/mcp-server/src/index.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/mcp-server/src/index.ts)

Implemented tools:

- `vault_save_memory`
- `vault_find_memory`
- `vault_recall_context`
- `vault_get_latest`
- `vault_get_memory_detail`
- `vault_update_memory`
- `vault_promote_memory`
- `vault_archive_memory`
- `vault_suggest_save_path`
- `vault_create_task`
- `vault_list_tasks`
- `vault_get_task`
- `vault_cancel_task`
- `vault_get_task_queue_stats`
- `vault_get_task_executor_status`
- `vault_start_task_executor`
- `vault_stop_task_executor`
- `vault_request_summary`
- `vault_get_project_briefing`

Assessment:

- The MCP surface now covers both memory tools and queued task execution control closely enough to count as done for MVP purposes.

### Stage 5 — Basic UI MVP

Status: `partial`

Evidence:

- dashboard: [DashboardView.tsx](C:/Users/Mini/Desktop/Projects/the-vault/packages/desktop/src/components/DashboardView.tsx)
- memory browser: [MemoryView.tsx](C:/Users/Mini/Desktop/Projects/the-vault/packages/desktop/src/components/MemoryView.tsx)
- recall/chat: [ChatView.tsx](C:/Users/Mini/Desktop/Projects/the-vault/packages/desktop/src/components/ChatView.tsx)
- logs: [ActivityLogsView.tsx](C:/Users/Mini/Desktop/Projects/the-vault/packages/desktop/src/components/ActivityLogsView.tsx)
- settings: [SettingsView.tsx](C:/Users/Mini/Desktop/Projects/the-vault/packages/desktop/src/components/SettingsView.tsx)

What is still missing:

- direct desktop UI actions for update/promote/archive on memory items
- stronger save ergonomics for human users
- clearer memory-detail editing and curation flow

### Stage 6 — AI Enrichment

Status: `partial`

Evidence:

- enrichment service placeholder and flow entry: [enrichment.service.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/services/enrichment.service.ts)
- enrichment settings in desktop UI: [SettingsView.tsx](C:/Users/Mini/Desktop/Projects/the-vault/packages/desktop/src/components/SettingsView.tsx)

What is still missing:

- fully realized enrichment jobs
- visible enrichment outputs in the desktop app
- stronger enrichment lifecycle and inspection

### Stage 7 — Smart Recall Engine

Status: `partial`

Evidence:

- recall and candidate scoring: [retrieve.service.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/services/retrieve.service.ts)
- ranking logic: [ranking.service.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/services/ranking.service.ts)

What is still missing:

- sharper type prioritization
- better promoted/canonical weighting
- stronger related-item and continuity handling
- better recall result presentation in the desktop UI

### Stage 8 — Analytics And Logs Expansion

Status: `partial`

Evidence:

- recent logs in core: [log.service.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/services/log.service.ts)
- logs UI: [ActivityLogsView.tsx](C:/Users/Mini/Desktop/Projects/the-vault/packages/desktop/src/components/ActivityLogsView.tsx)
- dashboard counters: [DashboardView.tsx](C:/Users/Mini/Desktop/Projects/the-vault/packages/desktop/src/components/DashboardView.tsx)

What is still missing:

- richer analytics screens
- more client/project trend views
- stronger error and recall-quality metrics

### Stage 9 — Memory Structure Upgrade

Status: `partial`

Evidence:

- core operations exist: [vault.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/vault.ts), [retrieve.service.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/core/src/services/retrieve.service.ts)
- MCP exposure exists: [packages/mcp-server/src/index.ts](C:/Users/Mini/Desktop/Projects/the-vault/packages/mcp-server/src/index.ts)

What is still missing:

- desktop UI for promote/archive/update
- tag normalization and stronger canonical-memory workflows
- richer metadata editing for humans

### Stage 10 — Visual Map

Status: `not started`

What is still missing:

- graph model
- map screen
- relationship exploration UI

### Stage 11 — Automation And Maintenance

Status: `not started`

What is still missing:

- cleanup routines
- duplicate detection workflow
- scheduled enrichment
- promotion suggestions
- feedback-driven recall tuning

### Stage 12 — Company OS Integration

Status: `deferred`

Reason:

- Vault now treats MCP as the integration path for Codex, Claude, and other clients. A company/multi-agent control plane should stay out of the critical path until the memory product feels complete.

## Recommended Next Stages

The next practical build order should be:

1. finish Stage 5 gaps in the desktop UI for real memory curation
2. improve Stage 7 recall quality and result presentation
3. expand Stage 8 analytics just enough to make Vault usage inspectable
4. then revisit deeper Stage 9 memory-structure controls

## Immediate Next Tasks

The highest-value tasks right now are:

- add promote/archive/update controls to the memory detail workflow
- improve save ergonomics so humans can create better structured memory without command syntax
- improve recall result quality and explain why items were returned
- keep local Claude/Codex backend support as a supporting path, not the main product roadmap
