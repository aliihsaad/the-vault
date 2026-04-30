# The Vault

The Vault is a local-first memory operating system for engineering teams, coding agents, and long-running AI workflows. It captures durable project context, recalls the right memories at the right time, and exposes the same core memory layer through a CLI, an MCP server, and a desktop console.

The project is built for a practical problem: modern AI-assisted work loses context between sessions. The Vault keeps implementation decisions, handoffs, task results, project relationships, and lifecycle state in a structured local store so agents can continue work without rediscovering the same facts.

## What It Does

- Stores structured memory items with project, type, subject, summary, tags, keywords, related files, and related item links.
- Retrieves ranked context using project-aware recall, related-memory expansion, promoted decisions, and proactive same-project surfacing.
- Tracks project identity, descriptions, relationships, merge proposals, and naming drift.
- Runs lifecycle maintenance for low-signal memories with reversible states: `active -> stale -> archived -> pending_delete`.
- Supports delegated task records with model routing, task results, retry metadata, and reusable saved summaries.
- Provides multiple interfaces over one core: TypeScript API, command-line tool, MCP server, and Electron desktop app.

## Architecture

This repository is a `pnpm` workspace.

```text
packages/
  core/          Shared Vault engine, database, ranking, services, task system
  cli/           Command-line entry point over core APIs
  mcp-server/    MCP stdio server for agent integrations
  desktop/       Electron and React desktop console
docs/            Protocol notes, implementation plans, project status
skills/          Agent-facing Vault memory operating guides
scripts/         Deployment and one-off maintenance scripts
```

The core package owns persistence, rules, services, and public APIs. CLI, MCP, and desktop packages are intentionally thin wrappers over `@the-vault/core`.

## Current Status

The Vault is an active local-first engineering project. The core memory system, task delegation records, MCP integration, project maintenance, lifecycle controls, and desktop surfaces are in place. Some packaging paths are still being hardened, especially Electron native module rebuild behavior on Windows.

The repository is private by default. Do not commit local vault data, API keys, environment files, generated builds, or machine-specific adapter state.

## Requirements

- Node.js 22 or newer recommended
- `pnpm`
- SQLite native dependency support through `better-sqlite3`
- GitHub CLI only if you are publishing or pushing checkpoints

On Windows, Electron packaging can lock `better_sqlite3.node` if another process is using it. Stop running Vault/Electron/MCP processes before packaging release builds.

## Installation

```powershell
pnpm install
```

## Development

Run the desktop app:

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

## Quality Checks

Run the test suite:

```powershell
pnpm test
```

Run the TypeScript check:

```powershell
pnpm lint
```

Build all workspace packages:

```powershell
pnpm build
```

The root build also deploys a standalone MCP bundle into `mcp-standalone/`. That folder is generated and intentionally ignored by Git.

## Key Concepts

### Memory Items

Memory items are structured records. Common memory types include `session`, `summary`, `decision`, `plan`, `artifact`, `handoff`, and `reference`.

High-quality memories should include:

- A specific project name
- A concise subject
- A durable summary
- Searchable keywords and tags
- Related file paths when implementation work is involved
- Next steps when work is incomplete

### Project Hygiene

The Vault treats project names as first-class data. It can list known projects, maintain descriptions, detect naming drift, propose relationships, and merge duplicate project identities through an explicit review path.

### Task Delegation

Tasks are persisted as records with type, priority, model route, prompt, context, result text, metadata, and retry state. Text task execution is intentionally bounded: task results are stored as analysis unless a separate tool path applies a mutation.

### Lifecycle Management

Low-signal memories are not deleted immediately. They move through reversible lifecycle states before any destructive deletion can happen. Final deletion requires explicit confirmation.

## MCP Usage

The MCP server exposes Vault operations to coding agents and other MCP clients. Typical capabilities include saving memories, recalling context, inspecting projects, reading task results, and reviewing project/lifecycle proposals.

For a new machine or a new client setup, use the one-command installer:

```powershell
pnpm setup:mcp
```

That command builds the core and MCP server, deploys the standalone MCP runtime, writes `vault-memory` entries for Claude Desktop, Claude Code, and Codex, backs up existing config files before changing them, and verifies the MCP initialize handshake.

To configure only one client:

```powershell
pnpm setup:mcp -- --client codex
pnpm setup:mcp -- --client claude-desktop
pnpm setup:mcp -- --client claude-code
```

After setup, restart the client app or start a new CLI session so it launches the updated server.

After building, the standalone MCP entry point is:

```text
mcp-standalone/dist/index.js
```

For development, use:

```powershell
pnpm --filter @the-vault/mcp-server dev
```

## Repository Discipline

- Keep domain logic in `packages/core`.
- Keep generated folders out of commits: `dist/`, `dist-electron/`, `mcp-standalone/`, `node_modules/`, and coverage output.
- Keep local state out of commits: `.env*`, `.agent/`, `.claude/settings.local.json`, and local vault data.
- Use focused checkpoint commits with concise imperative messages.
- Do not add `Co-authored-by` trailers unless explicitly requested.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
