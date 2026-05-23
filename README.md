# The Vault

<img src="assets/screenshots/readme-header.png" alt="The Vault - Operational Memory OS for AI Agents" width="100%" />

[![Windows Installer Release](https://github.com/aliihsaad/the-vault/actions/workflows/release-windows.yml/badge.svg)](https://github.com/aliihsaad/the-vault/actions/workflows/release-windows.yml)
![Node](https://img.shields.io/badge/node-22%2B-339933)
![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220)
![Electron](https://img.shields.io/badge/desktop-Electron-47848F)
![MCP](https://img.shields.io/badge/MCP-vault--memory-6D5EFc)
![License](https://img.shields.io/badge/license-MIT-green)

The Vault is a local-first memory operating system for AI-assisted work. It gives coding agents and human operators a durable project memory layer: decisions, handoffs, implementation summaries, task results, project relationships, and recallable context survive across sessions instead of being lost in chat history.

It ships as a TypeScript workspace with a shared core engine, command-line interface, MCP server, and Electron desktop console. Windows releases also bundle their own `vault-memory` MCP runtime, so installed users can connect Codex, Claude Desktop, or Claude Code without keeping the source repo on disk.

## The 60-Second Version

- AI agents forget between sessions, even when the project has a long history.
- The Vault stores project memory outside the model, on your machine.
- Agents ask the Vault MCP server for relevant context instead of reading the whole memory store.
- Work can continue later from Codex, Claude Desktop, Claude Code, or another MCP client.
- Vault does not launch local Codex or Claude terminal agents; those clients stay external and connect through MCP.
- You stay in control because memory is local, inspectable, and important cleanup changes are reviewable.

## How It Feels To Use

| Without The Vault | With The Vault |
| --- | --- |
| Start a new AI session. | Start a new AI session. |
| Re-explain the project state. | The agent recalls the current project state. |
| Rediscover decisions and old bug causes. | The agent sees recent decisions, files touched, and next steps. |
| Repeat handoff work manually. | The agent saves a new handoff for the next session. |

The result is not magic memory. It is a practical continuity layer: the important project facts are saved, ranked, reviewed, and reused when they are relevant.

## Visual Overview

### System Topology

```text
Codex / Claude / Agent
        |
        v
Vault MCP Server
        |
        v
Vault Core
        |
        +--> Memory Store
        +--> Task Executor
        +--> Desktop Console
```

### Cross-Agent Continuity

```text
Codex implements change
        |
        v
Vault saves files touched, intent, decisions, next steps
        |
        v
Claude recalls context later
        |
        v
Claude reviews, debugs, or continues the work
```

### Recall Funnel

```text
Stored memories
        |
        v
Candidate search
        |
        v
Ranking and pruning
        |
        v
Recall pack
        |
        v
Injected into agent context
```

### Project Hygiene

```text
Naming drift / duplicate projects
        |
        v
Vault detects related records
        |
        v
Proposal generated
        |
        v
Human review
        |
        v
Canonical project memory
```

## Why It Exists

AI coding sessions are productive but forgetful. The next agent often has to rediscover architecture decisions, bug causes, deployment notes, naming decisions, and unfinished work. The Vault turns that context into structured local memory that can be saved, ranked, recalled, curated, and reused by multiple clients.

The goal is not to replace a repo, issue tracker, or documentation site. The Vault fills the space between them: high-signal operational memory for ongoing work.

## Who This Is For

- Developers using Codex, Claude Code, Claude Desktop, or other MCP-aware tools.
- People juggling multiple projects where decisions and handoffs get scattered.
- AI-assisted workflows that need continuity across sessions and agents.
- Local-first users who do not want memory locked inside one chat product.
- Small teams that want durable implementation context without adopting a heavy knowledge system.

## Real-World Scenarios

### Resume a project after days or weeks

Ask an agent to recall the project before it starts work. The Vault can surface the current phase, latest decisions, open issues, files touched, and saved next steps so the session starts from the real project state.

### Switch between Codex and Claude

One agent can implement a change and save the handoff. Later, another client can recall the same project context through MCP and continue from the saved intent, decisions, and file references.

### Debug with historical context

Before debugging, an agent can recall recent changes, related bug notes, prior fixes, and implementation files. That reduces time spent rediscovering what changed and why.

### Keep project identity clean

Long-running AI work can create naming drift: old project names, duplicate records, or inconsistent casing. The Vault tracks canonical project decisions, detects related records, and supports reviewable merge workflows.

### Use Vault while juggling multiple projects

Inactive projects stay warm. When you return, their decisions, handoffs, and next steps are still available without keeping every detail in your head or in a single chat thread.

## Use Cases

- Continue feature work across Codex, Claude, and desktop sessions without re-explaining the project.
- Save implementation handoffs with exact files touched, decisions made, and next steps.
- Record canonical project decisions such as naming, architecture, release strategy, and integration rules.
- Recall relevant prior context before debugging or changing a feature.
- Maintain project identity when names drift or duplicate project records appear.
- Keep local task results, summaries, and delegated research attached to the right project.
- Inspect and curate memory through a desktop dashboard instead of raw files.
- Connect MCP clients to one shared local memory source.

## What Makes It Different

The Vault is not:

- a chat history archive
- a generic notes app
- a replacement for GitHub issues or documentation
- memory locked inside one model provider
- a dump of every saved note into every prompt
- a local Codex or Claude terminal launcher

The Vault is:

- an external project memory layer
- local-first by default
- MCP-accessible from multiple clients
- ranked and pruned recall for agent context
- cross-agent continuity for AI-assisted work
- project lifecycle hygiene for naming drift, duplicates, and cleanup

## Trust And Control

- Storage is local-first: memory files and SQLite state live on your machine.
- MCP clients receive recall packs, not the entire memory store.
- Destructive cleanup uses lifecycle states and review before final deletion.
- Client setup backs up existing config files before changing them.
- The desktop setup flow edits only the Vault-specific MCP entry and leaves other client config intact.
- The desktop UI lets you inspect saved memory, file placement, activity logs, project proposals, and pending-delete flows.

## Core Concepts

| Concept | Meaning |
| --- | --- |
| Project memory | Structured records tied to a project: decisions, sessions, plans, handoffs, artifacts, references, and summaries. |
| Recall packs | Ranked, compact sets of relevant memories returned for a task or session. |
| MCP clients | Tools such as Codex, Claude Desktop, and Claude Code that connect to Vault through the `vault-memory` MCP server. |
| Agent skills | Client-facing guide files that teach agents when to recall, when to save, and how to structure memory. |
| Task executor | A Vault runtime that can process queued tasks, store results, and expose task status through MCP and desktop surfaces. |
| Project hygiene | Naming, relationship, duplicate, and canonical-decision workflows that keep project memory organized. |
| Lifecycle states | Reversible memory states such as `active`, `stale`, `archived`, and `pending_delete` before final deletion. |

## Feature Overview

| Area | What The Vault Provides |
| --- | --- |
| Structured memory | Saves typed records with project, subject, summary, tags, keywords, priority, status, related files, and next steps. |
| Smart recall | Returns ranked memory packs using project match, keywords, tags, memory type, recency, promoted decisions, and related context. |
| Desktop console | Electron app with overview, memory browser, recall, loops, graph, analytics, Vault task runtime, settings, and client setup. |
| MCP integration | `vault-memory` MCP server for external agents and clients. |
| One-click client setup | Desktop Settings -> Client setup can connect Codex, Claude Desktop, and Claude Code to the bundled runtime. |
| CLI access | Command-line entry point over the same core APIs. |
| Project hygiene | Project descriptions, project listing, naming drift handling, duplicate project merging, and relationship tracking. |
| Lifecycle controls | Reversible memory states such as `active`, `stale`, `archived`, and `pending_delete` before deletion. |
| Task records | Queued task metadata, model routing, executor status, task results, retries, and saved summaries. |
| Project momentum | Per-project week-over-week activity delta (↑/↓/inactive) shown on the Overview to make stagnating projects visible. |
| Open loops panel | Aggregated unfinished work — items with non-empty `next_steps` plus stale debugging routines — bucketed by derived priority (high/medium/low) with snooze support via `snoozed_until`. |
| Close-the-loop on recall | `vault_recall_context` returns an `open_loops` field so agents surface unfinished work back to the user. The dedicated `vault_resolve_loop` MCP tool atomically closes a loop with an outcome (`fixed`/`wont_fix`/`obsolete`/`duplicate`). |
| Local privacy | SQLite database and memory files stay on the user's machine unless the user explicitly pushes or exports them. |

## Interfaces

The Vault is built around one shared core package and several thin interfaces:

- **Desktop app**: the primary operator UI for installed users.
- **MCP server**: exposes memory tools to Codex, Claude Desktop, Claude Code, and other MCP clients.
- **CLI**: useful for quick local checks and scripts.
- **TypeScript core**: reusable services for saving, recalling, ranking, project maintenance, tasks, and settings.

## Screens And Workflows

The desktop app currently includes:

- **Overview**: local memory status, activity, recall, open loops, relationship graph, and project radar in one cockpit.
- **Recall**: inspect recall activity, candidate pruning, prompt packing efficiency, and compact recall logs.
- **Memory Bank**: browse and inspect saved memory items.
- **Agent Runtime**: inspect Vault's built-in task runtime, delegated task queue, and executor events. External Codex and Claude clients stay connected through MCP.
- **Agent Review**: review project proposals and pending-delete flows.
- **Activity**: inspect operational logs.
- **Vault Files**: browse saved memory files on disk.
- **Settings**: configure runtime behavior, lifecycle policy, prompt guides, model routing, and client setup.
- **Client setup**: connect/disconnect Codex, Claude Desktop, Claude Code, install agent guide references, and troubleshoot MCP.

### Operations Overview

The Overview is the daily operator surface: live local status, activity, project radar, recent relationship graph, open loops, recall trends, telemetry, and review queues.

![The Vault Operations Overview showing local runtime status, activity, relationship graph, project radar, open loops, recall trend, and telemetry](assets/screenshots/operations-overview.png)

### Open Loops

The Loops page turns unfinished work into an explicit queue. Operators can filter by project, routine, and tag, inspect the selected loop, then open, snooze, or resolve it.

![The Vault Open Loops page showing priority metrics, filters, ranked loop queue, selected loop detail, and resolve/snooze actions](assets/screenshots/open-loops.png)

### Recall Efficiency

Recall shows how much prompt context Vault avoided sending to the agent window: estimated tokens saved, candidate pruning, recall volume, signal strength, and a compact signal log.

![The Vault Recall page showing estimated tokens saved, candidate reduction, recall volume, signal strength, a pruning trend chart, and compact recall log](assets/screenshots/recall-efficiency.png)

### Relationship Graph

The Graph page previews loaded relationships between projects, memories, files, and related memory IDs so operators can see whether the memory store is connected or drifting.

![The Vault Graph page showing a relationship map and linked memory records](assets/screenshots/relationship-graph.png)

### Memory Bank

The Memory Bank is the main inspection surface for saved project context: search, filter, select a record, inspect metadata, and review the full saved summary without leaving the desktop console.

## Install For Normal Use

For Windows users, use the GitHub Release installer:

1. Open the repository's **Releases** page.
2. Download `The-Vault-<version>-win-x64.exe`.
3. Run the installer.
4. Open **The Vault**.
5. Go to **Settings -> Client setup**.
6. Connect Codex, Claude Desktop, or Claude Code.
7. Restart the client so it launches the updated `vault-memory` server.

Do not download the `.blockmap` file unless you are debugging release assets. It is used by updater tooling, not manual installation.

Installed builds store user data separately from the app installation. Updating the app should not delete an existing vault database or memory files.

Upgrading from a 0.2.x build auto-migrates existing Vault MCP entries and the Claude Code skill install path on app startup when a previous Vault connection is detected.

## Install From Source

Requirements:

- Node.js 22 or newer
- pnpm 10 or newer
- Git
- Windows if you want to build the NSIS installer locally

Install dependencies:

```powershell
pnpm install
```

Run the desktop app in development:

```powershell
pnpm --filter @the-vault/desktop dev
```

Run the CLI directly:

```powershell
pnpm --filter @the-vault/cli dev -- status
```

Run the MCP server over stdio:

```powershell
pnpm --filter @the-vault/mcp-server dev
```

## MCP Setup

### Installed Desktop App

Installed releases include a bundled MCP sidecar runtime:

```text
resources/mcp/node.exe
resources/mcp/dist/index.js
```

Use **Settings -> Client setup** in the desktop app. The UI writes only the Vault-specific MCP entry and keeps other client config entries intact. It also shows connection status and includes a troubleshooting panel.

![The Vault Client setup screen showing the bundled MCP runtime, all-client connection status, and troubleshooting details](assets/screenshots/client-setup.png)

### Source Checkout

For development machines using the repo directly:

```powershell
pnpm setup:mcp
```

That command:

- builds `@the-vault/core` and `@the-vault/mcp-server`
- deploys a standalone MCP runtime to `mcp-standalone/`
- verifies an MCP initialize handshake
- backs up existing client config files before editing
- writes `vault-memory` entries for supported clients

Configure only one client:

```powershell
pnpm setup:mcp -- --client codex
pnpm setup:mcp -- --client claude-desktop
pnpm setup:mcp -- --client claude-code
```

Dry-run the setup without changing files:

```powershell
pnpm setup:mcp:dry-run
```

## Agent Skill Guides

The repo includes agent-facing operating guides:

- `skills/claude-vault-skill.md`
- `skills/codex-vault-skill.md`

Installed releases package these guide files under app resources. The desktop **Client setup** page can install or reference them at:

- Claude Code: `%USERPROFILE%\.claude\skills\vault-memory\SKILL.md`
- Codex: `%USERPROFILE%\.codex\AGENTS.md`

The guides teach agents when to recall, when to save, how to structure memory, and how to use queued Vault tasks.

## Memory Model

Common memory types:

- `session`
- `summary`
- `decision`
- `plan`
- `artifact`
- `handoff`
- `reference`

## Memory Quality Principles

A good memory is specific enough to help a future agent act without re-reading the whole repo. Include:

- exact project name
- precise subject
- what changed
- why it changed
- files touched
- decisions made
- next steps
- tags and keywords

High-quality memory improves future recall. Vague saves create vague recall packs; specific saves give agents concrete project state, file context, and next actions.

## Recall Model

Recall is designed to return useful context, not every matching record. Ranking uses signals such as:

- exact project match
- subject and keyword overlap
- tag overlap
- memory type
- priority
- promoted or canonical status
- recency
- relationship expansion
- lifecycle status

Promoted and canonical memories are intentionally boosted because they represent durable project truths.

## Project Hygiene

The Vault treats project identity as data, not just a folder name. It supports:

- project listing
- project descriptions
- project relationship records
- duplicate and old-name cleanup
- canonical naming decisions
- merge workflows for duplicated project entries

This matters because long-running AI work often creates naming drift across sessions and clients.

## Lifecycle Management

The Vault avoids immediate destructive cleanup. Low-signal records can move through reversible states:

```text
active -> stale -> archived -> pending_delete -> deleted
```

Deletion requires explicit confirmation. This keeps recall quality manageable without silently losing useful history.

## Workspace Layout

```text
packages/
  core/          Shared Vault engine, database, ranking, services, task system
  cli/           Command-line entry point over core APIs
  mcp-server/    MCP stdio server for agent integrations
  desktop/       Electron and React desktop console

docs/            Protocol notes, roadmap status, implementation plans
skills/          Agent-facing Vault memory guides
scripts/         MCP setup, deployment, and maintenance scripts
.github/         Release workflow for Windows installer builds
```

Core logic belongs in `packages/core`. The CLI, MCP server, and desktop app should stay thin wrappers around shared core APIs.

## Common Commands

```powershell
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm --filter @the-vault/desktop dev
pnpm --filter @the-vault/cli dev -- status
pnpm --filter @the-vault/mcp-server dev
pnpm setup:mcp
```

## Build And Release

Build everything locally:

```powershell
pnpm build
```

The root build:

1. builds core, CLI, and MCP packages
2. deploys the standalone MCP runtime
3. builds the Electron desktop app
4. creates a Windows installer under `packages/desktop/dist/`

Release builds are created by GitHub Actions when a version tag is pushed:

```powershell
git tag -a v0.2.9 -m "v0.2.9"
git push origin v0.2.9
```

The workflow typechecks the repo, builds the installer, verifies the bundled MCP sidecar, uploads artifacts, and publishes a GitHub Release.

## Data And Privacy

The Vault is local-first:

- memory data is stored locally
- SQLite is used for registry and operational state
- memory files live under the configured Vault root
- client config writes are local machine changes
- generated build output and local vault data should not be committed

Secrets and machine-specific files should stay out of Git:

- `.env*`
- local Vault data
- generated `dist/` folders
- generated `mcp-standalone/`
- client-local settings
- API keys and runtime state

## Troubleshooting

### Desktop Opens But MCP Client Does Not See Vault

Use **Settings -> Client setup -> Troubleshoot MCP**. Check that the configured client points to the bundled runtime for installed builds or `mcp-standalone/dist/index.js` for source checkouts.

Restart Codex, Claude Desktop, or Claude Code after changing MCP config.

### Codex Skill Shows Not Configured

Open **Settings -> Client setup** and click **Install guide** under Codex skill. Installed builds write the guide reference to:

```text
%USERPROFILE%\.codex\AGENTS.md
```

Then refresh the connection status.

### Windows Build Fails Around Native Modules

`better-sqlite3` is a native dependency. Stop running desktop, MCP, and Node processes that may be holding `better_sqlite3.node`, then rebuild.

### Installed App Uses Existing Dev Data

That is expected when the installed app and source checkout resolve the same Vault root. App updates should not delete existing Vault data.

## Current Maturity

The Vault is usable today for:

- local memory
- MCP integration
- desktop workflows
- client setup
- recall and save flows
- task records
- Windows installer releases

It is still evolving in these areas:

- recall explainability
- richer graph and project relationship views
- analytics for usage, recall quality, and project activity
- onboarding polish
- release hardening
- deeper memory curation

See `docs/master-plan-status.md` for a more detailed implementation status map.

## Project Tags

`local-first` `ai-memory` `agent-memory` `mcp-server` `codex` `claude` `electron` `sqlite` `typescript` `developer-tools` `workflow-continuity` `knowledge-management` `task-delegation` `project-context`

## Repository Discipline

- Keep domain behavior in `packages/core`.
- Keep interface packages thin.
- Do not commit generated build output.
- Do not commit local vault data or secrets.
- Prefer focused commits with imperative subjects.
- Do not add `Co-authored-by` trailers unless explicitly requested.

## License

The Vault is licensed under the MIT License. See [LICENSE](LICENSE).
