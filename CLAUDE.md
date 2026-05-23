# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Vault is a local-first AI memory operating system. It stores structured project memory (decisions, plans, sessions, handoffs, etc.) in a SQLite registry + Markdown files, and surfaces relevant past context when a new AI session starts. It exposes memory operations via MCP tools, a CLI, and an Electron desktop app.

## Commands

```bash
pnpm install                              # Install all workspace dependencies
pnpm build                                # Build every package (tsup for core/cli/mcp, vite+electron for desktop)
pnpm test                                 # Run Vitest once from repo root
pnpm test:watch                           # Run Vitest in watch mode
pnpm lint                                 # TypeScript type-check (tsc --noEmit)

# Per-package dev
pnpm --filter @the-vault/desktop dev      # Start desktop app (Vite + Electron)
pnpm --filter @the-vault/cli dev -- <cmd> # Run CLI directly (e.g. `-- status`, `-- save ...`)
pnpm --filter @the-vault/mcp-server dev   # Start MCP server over stdio
```

Tests go in `packages/*/src/**/*.test.ts` or `tests/**/*.test.ts`. No tests exist yet.

## Architecture

### Monorepo layout (pnpm workspace)

- **`packages/core`** (`@the-vault/core`) — The engine. All domain logic lives here. Other packages are thin wrappers.
- **`packages/cli`** (`@the-vault/cli`) — Commander-based CLI test harness. Single file.
- **`packages/mcp-server`** (`@the-vault/mcp-server`) — MCP server exposing 9 tools over stdio. Single file.
- **`packages/desktop`** (`@the-vault/desktop`) — Electron + React desktop app (Vite build).
- **`skills/`** — Claude and Codex skill Markdown files (behavioral instructions for how agents should use Vault).
- **`docs/`** — Planning and status docs. `plan.md` at root is the full master plan.

### Core package internals (`packages/core/src/`)

```
vault.ts              — Vault class, main entry point. Must call initialize() before use.
database/
  schema.ts           — Drizzle ORM table definitions (memory_items, projects, tags, memory_links, activity_logs, settings)
  connection.ts       — SQLite via better-sqlite3 + Drizzle. Singleton pattern. WAL mode.
services/
  save.service.ts     — Full save protocol: validate -> generate UID -> normalize tags -> write .md file -> insert DB -> register tags -> log
  retrieve.service.ts — findMemory (filter), recallContext (ranked recall), getLatest, getMemoryDetail, updateMemory, promoteMemory, archiveMemory
  ranking.service.ts  — Deterministic scoring engine for recall. Weighted signals: project match, subject/title match, keyword/tag overlap, promoted boost, recency, type priority, etc.
  file.service.ts     — Write/move/read Markdown memory files with frontmatter
  project.service.ts  — Project CRUD, auto-create project on first save
  log.service.ts      — Activity logging to DB + JSON log files
  enrichment.service.ts — Duplicate detection (text similarity)
rules/
  controlled-values.ts — All enums: MEMORY_TYPES, ROUTINE_TYPES, STATUS_VALUES, PRIORITY_VALUES, SOURCE_APPS, LINK_TYPES, ACTION_TYPES + ranking weight maps
  validation.ts       — Zod schemas for save/find/recall/update inputs
  naming.ts           — Slug generation, vault path construction
config/
  vault-root.ts       — Default root: C:\Users\Mini\Vault. Directory structure initialization.
  settings.ts         — Key-value settings in SQLite
types/index.ts        — All TypeScript interfaces (MemoryItem, SaveMemoryInput, RecallQuery, MemoryPack, etc.)
utils/                — UID generation (nanoid), datetime helpers
```

### Desktop app architecture

- **Electron main** (`packages/desktop/electron/main.ts`): Creates Vault instance, registers IPC handlers for vault operations, manages encrypted settings (Electron safeStorage or AES-256-GCM fallback), integrates OpenRouter API for enrichment models, and manages MCP client setup for external Codex/Claude clients.
- **Preload** (`electron/preload.ts`): Exposes `window.vaultAPI` bridge via contextBridge.
- **React renderer** (`src/`): Tab-based UI — Dashboard, Memory Bank, Recall Console (chat), Activity Logs, Settings. Uses lucide-react for icons.
- External agents should connect through the `vault-memory` MCP server; Vault does not launch Codex or Claude CLI sessions itself.

### Data flow

1. Agent/user invokes MCP tool, CLI command, or desktop UI action
2. All roads lead to `Vault` class methods
3. `Vault` delegates to services (save, retrieve, ranking, file, log, project)
4. Services read/write SQLite via Drizzle ORM and Markdown files under `C:\Users\Mini\Vault/`
5. Every operation is logged to `activity_logs` table

### Key design decisions

- **Registry is source of truth**, not the filesystem. DB for fast retrieval, Markdown files for portability.
- **Deterministic ranking** — recall scoring uses weighted signals (see `ranking.service.ts` WEIGHTS object), no vector DB.
- **Controlled vocabulary** — memory types, statuses, priorities, etc. are enforced enums, not free-form.
- **Memory layers**: raw sessions -> structured summaries/decisions -> promoted long-term -> canonical project knowledge.
- **Skills decide, MCP executes** — agent behavior is defined in skill files; MCP tools are pure execution.

## Coding Conventions

- TypeScript strict mode, ESM throughout. Use `.js` extensions in local imports.
- 2-space indent, semicolons, single quotes.
- `PascalCase` for React components, `camelCase` for functions/variables, `kebab-case` for utility filenames.
- All packages build with `tsup` (ESM + dts). Desktop uses Vite + electron-builder.
- JSON columns in SQLite stored as `*Json` fields (e.g. `keywordsJson`, `tagsJson`). Parsed to arrays in the type layer.
