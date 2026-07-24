# Repository Guidelines

## Project Structure & Module Organization
This repository is a `pnpm` workspace for a local-first memory system. Core logic lives in `packages/core/src` and is organized by `config/`, `database/`, `rules/`, `services/`, `types/`, and the main `vault.ts` entry point. The CLI lives in `packages/cli/src/index.ts`, the MCP server in `packages/mcp-server/src/index.ts`, and the Electron/React desktop app in `packages/desktop/src` with Electron bootstrap files under `packages/desktop/electron`. Reference material belongs in `docs/`, reusable skill files in `skills/`. Treat `dist/` and `dist-electron/` as generated output.

## Build, Test, and Development Commands
- `pnpm install`: install workspace dependencies.
- `pnpm build`: build every package in the workspace.
- `pnpm test`: run Vitest once from the repo root.
- `pnpm test:watch`: run Vitest in watch mode while developing.
- `pnpm lint`: run the TypeScript type check defined at the root.
- `pnpm --filter @the-vault/desktop dev`: start the desktop UI with Vite.
- `pnpm --filter @the-vault/cli dev -- status`: run the CLI entry point directly.
- `pnpm --filter @the-vault/mcp-server dev`: start the MCP server over stdio.

## Coding Style & Naming Conventions
Use TypeScript with strict mode enabled. Follow the existing style: 2-space indentation, semicolons, single quotes, and ESM imports with explicit `.js` extensions in local imports. Use `PascalCase` for React components (`DashboardView.tsx`), `camelCase` for variables/functions, and `kebab-case` for utility filenames and config paths (`vault-root.ts`). Keep domain logic in `packages/core`; CLI, MCP, and desktop packages should stay thin wrappers over shared core APIs.

## Testing Guidelines
Vitest is configured in `vitest.config.ts` with `node` environment and a `10s` timeout. Place tests in `packages/*/src/**/*.test.ts` or `tests/**/*.test.ts`. No coverage threshold is enforced yet, so add focused unit tests for new rules, services, and public package entry points. Run `pnpm test` before opening a PR.

## Commit & Pull Request Guidelines
Git history is not available in this workspace snapshot, so no repository-specific commit convention could be verified. Use concise, imperative commit subjects such as `Add recall ranking filters` and keep unrelated changes separate. PRs should explain the user-visible change, note affected packages, list verification steps (`pnpm test`, manual desktop smoke test), and include screenshots for UI work.

## Configuration Tips
The desktop package builds with Electron and Vite, while persistence in `packages/core` depends on SQLite via `better-sqlite3`. Avoid committing local vault data or environment-specific artifacts; keep secrets and machine-specific paths out of source files and docs.

## Vault Memory Skill
Codex should also use the Vault memory skill at [skills/codex-vault-skill.md](/C:/Users/Mini/Desktop/Projects/the-vault/skills/codex-vault-skill.md) when working in this repository.

Use Vault memory before restarting discovery:
- Recall prior implementation context before continuing feature work, bug fixes, or handoffs.
- Save only significant outcomes, decisions, summaries, and incomplete handoffs.
- Include real file paths, concrete keywords, and next steps when saving implementation work.

Use Vault MCP when the `vault-memory` server is attached in Codex. If MCP is not attached, keep following the same memory discipline and use the skill file as the operating guide.

## Imported Claude Cowork project instructions
