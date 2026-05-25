# Vault Graphify Extension TDD Implementation Plan

## Status

Implementation plan only. No product code is included here.

Initial checkpoint verified before writing this plan:

- Branch: `vault-brain-graph`
- HEAD: `15af02a63c520f945af603633bf4415064d399ee`
- Starting working tree: only `docs/graphify-extension-design.md` was intentionally untracked.

This plan implements the approved direction from `docs/graphify-extension-design.md`: Graphify is a first-class optional Vault extension, Graphify owns graph extraction and artifacts, and Vault owns lifecycle, dashboard, MCP, recall routing, instruction sync, and telemetry.

## Guardrails

- Preserve existing Vault MCP connector flows for Codex, Claude Desktop, and Claude Code.
- Do not vendor the Graphify source repository into The Vault.
- Do not revive the superseded native Brain Graph or Graphify-style React clone.
- Keep Graphify optional and failure-isolated. Vault recall, save, task queue, settings, and MCP memory tools must keep working when Graphify is absent, disabled, stale, or broken.
- Do not make `packages/core` import Python, NetworkX, or Graphify modules.
- Do not write Graphify artifacts into user repositories by default.
- Do not silently install packages or overwrite `CLAUDE.md` / `AGENTS.md`.
- Agents should use Vault MCP graph tools, not raw Graphify CLI, for normal operation.

## TDD Workflow

Every implementation phase starts with failing tests that describe the public behavior, then the smallest implementation needed to pass, then refactor and integration checks.

Default verification after each phase:

```powershell
pnpm test
pnpm lint
```

For desktop phases, add:

```powershell
pnpm --filter @the-vault/desktop build
```

For MCP phases, add a manual stdio smoke test after build:

```powershell
pnpm --filter @the-vault/mcp-server dev
```

Unit and integration tests must use fake Graphify executables, fake artifact directories, and temporary Vault roots. Tests must not install Graphify, download dependencies, require network access, or require `C:\Users\Mini\Desktop\cloned-repos\graphify`.

## Proposed Module Boundaries

Core owns product state and deterministic logic:

- `packages/core/src/services/graphify-runtime.service.ts`
- `packages/core/src/services/graphify-config.service.ts`
- `packages/core/src/services/graphify-project.service.ts`
- `packages/core/src/services/graphify-corpus.service.ts`
- `packages/core/src/services/graphify-build-queue.service.ts`
- `packages/core/src/services/graphify-artifact.service.ts`
- `packages/core/src/services/graphify-query.service.ts`
- `packages/core/src/services/graphify-recall.service.ts`
- `packages/core/src/services/graphify-instruction-sync.service.ts`
- `packages/core/src/services/graphify-telemetry.service.ts`
- `packages/core/src/types/graphify.ts`

The `Vault` class in `packages/core/src/vault.ts` should expose thin methods over those services. Desktop and MCP packages should call those methods rather than duplicating Graphify state logic.

Electron owns local process execution and safe file serving:

- IPC handlers in `packages/desktop/electron/main.ts`
- Preload bindings in `packages/desktop/electron/preload.ts`
- Artifact serving constrained to Vault-managed Graphify artifact roots
- Optional installer/build process supervision when a child process is required

Renderer owns UI composition:

- Settings extension panel under `packages/desktop/src/components/SettingsView.tsx` or a dedicated `GraphifyExtensionSettings.tsx`
- Project graph panel and graph page under `packages/desktop/src/components/`
- Pure view-model helpers with tests where practical

MCP owns external agent contracts:

- Add Vault Graphify tools to `packages/mcp-server/src/index.ts`
- Keep existing memory, task, lifecycle, and connector tools unchanged

## Phase 0: Test Harness and Interfaces

Goal: establish extension contracts without enabling behavior.

Failing tests first:

- `packages/core/src/graphify-types.test.ts`
  - validates freshness states: `missing`, `queued`, `building`, `fresh`, `stale`, `failed`, `disabled`
  - validates runtime modes: `managed`, `path`, `localSource`
  - validates build modes: `fast`, `full`, `semantic`
  - rejects unknown runtime/build/freshness values
- `packages/core/src/graphify-paths.test.ts`
  - derives Graphify extension paths under the Vault-managed data root
  - keeps runtime, corpus, artifacts, logs, and state outside project source roots
  - normalizes Windows paths consistently

Implementation:

- Add Graphify types and controlled values.
- Export types from `packages/core/src/index.ts`.
- Add path helpers that use the Vault root as the app-managed data root shared by desktop and MCP.

Done when:

- Tests pass with no runtime execution.
- No desktop or MCP behavior changes.

## Phase 1: Split SQLite and JSON Storage

Goal: persist queryable product state in SQLite and machine-local runtime settings in JSON.

Failing tests first:

- `packages/core/src/graphify-storage.test.ts`
  - initializes idempotent SQLite tables or additive migrations for project graph state, build history, artifact pointers, graph stats, and last failure
  - stores per-project enabled state, source root, freshness, latest build id, latest artifact paths, and graph stats in SQLite
  - stores runtime mode, managed runtime path, executable path, local source path, installer preference, extras, debounce settings, and semantic flags in JSON
  - reset of JSON config does not delete SQLite project history
  - moving machine-local paths in JSON does not mutate product state rows

Implementation:

- Add Graphify SQLite schema:
  - `graphify_project_state`
  - `graphify_builds`
  - optionally `graphify_artifacts` if artifact metadata grows beyond the state row
- Add idempotent raw SQL migrations in `packages/core/src/database/connection.ts`.
- Add Drizzle table definitions in `packages/core/src/database/schema.ts`.
- Add `graphify-config.service.ts` to read/write `<vault-root>/extensions/graphify/config.json`.
- Add `graphify-project.service.ts` for project state CRUD.

Done when:

- Re-running initialization is safe.
- Existing Vault databases start normally.
- JSON config is absent-safe and machine-local.

## Phase 2: Runtime Detection and Install Planning

Goal: detect prerequisites and plan user-confirmed install commands without silently installing anything.

Failing tests first:

- `packages/core/src/graphify-runtime.test.ts`
  - parses Python, `uv`, `pipx`, and `graphify --version` results from an injected command runner
  - reports Graphify missing without throwing
  - plans managed virtual environment setup under the Vault Graphify runtime directory
  - plans `uv` first, `pipx` second, Python venv fallback third
  - uses PyPI package `graphifyy` while expecting CLI command `graphify`
  - includes extras only when selected
  - marks `localSource` as developer mode and never assumes the local clone exists
  - returns command previews without executing them

Implementation:

- Add an injected command runner abstraction.
- Add detection methods to `Vault`.
- Add install command planner.
- Keep actual execution behind explicit desktop IPC action in a later phase.

Done when:

- Core can report runtime status without Graphify installed.
- Install plans are deterministic and previewable.

## Phase 3: Project Source Roots and Build Eligibility

Goal: make source-root selection explicit and prevent accidental builds.

Failing tests first:

- `packages/core/src/graphify-project-source.test.ts`
  - uses existing `project_workspace_registry` as an initial source-root candidate when present
  - stores a user-selected Graphify source root per project
  - rejects relative or missing folders
  - does not queue or run a build when a project has no source root
  - returns a `sourceRootRequired` UI state and actionable message
  - allows per-project disablement without affecting Vault memory behavior

Implementation:

- Extend Graphify project state with source-root fields and source-root validation.
- Reuse `validateWorkspacePath` where possible.
- Add `Vault.getGraphifyProjectStatus`, `Vault.setGraphifyProjectSourceRoot`, and `Vault.setGraphifyProjectEnabled`.

Desktop TDD:

- Add a pure view-model test for a Project Graph panel:
  - missing source root shows picker state
  - disabled project shows disabled state
  - mapped root enables manual build action

Done when:

- No Graphify build can start until the project has an approved source root.

## Phase 4: Corpus Export Pipeline

Goal: prepare a managed Graphify corpus from project source plus safe Vault memory export.

Failing tests first:

- `packages/core/src/graphify-corpus.test.ts`
  - writes `source-manifest.json`
  - writes stable `vault-memory-export/memories.ndjson`
  - writes stable `vault-memory-export/memories/<item-uid>.md`
  - exports UID, title, project, type, subject, summary, tags, keywords, priority, status, timestamps, related files, related item IDs, open-loop state, and short content excerpt
  - does not export full memory bodies by default
  - redacts or omits ignored paths and obvious secret-like values from manifests/logs
  - computes stable input hashes for freshness checks

Implementation:

- Add corpus export service using existing memory retrieval APIs.
- Add source manifest creation under `<vault-root>/extensions/graphify/projects/<project-slug>/corpus`.
- Include memory export in `fast` builds when local and cheap.

Done when:

- A project corpus can be built without running Graphify.
- User repositories remain untouched.

## Phase 5: Manual Build Pipeline and Artifact Gateway

Goal: run Graphify manually, capture logs, discover artifacts, and serve only managed artifacts.

Failing tests first:

- `packages/core/src/graphify-build.test.ts`
  - state transitions `missing -> building -> fresh`
  - failure transitions `building -> failed`
  - failed builds preserve last good artifact pointers
  - build logs are stored under the project Graphify logs directory
  - artifact discovery requires `graph.json`, accepts optional `graph.html`, `GRAPH_REPORT.md`, and `graph.svg`
  - graph stats are read from `graph.json` without trusting arbitrary paths
- `packages/core/src/graphify-artifacts.test.ts`
  - safe artifact path validation rejects traversal and paths outside the managed artifact root
  - report and JSON reads are size-budgeted
  - missing `graph.html` returns a typed fallback

Implementation:

- Add build job runner with injected process execution.
- Add artifact reader/gateway service.
- Add Electron IPC wrappers for user-confirmed install and manual build.
- Add safe local artifact serving in Electron, constrained to Vault Graphify artifact directories.

Done when:

- Fake Graphify executable success and failure are covered.
- The desktop can ask core for artifact status without direct filesystem trust.

## Phase 6: Auto-Build Queue

Goal: debounce graph rebuilds from source, memory, and project changes while protecting the app.

Failing tests first:

- `packages/core/src/graphify-build-queue.test.ts`
  - coalesces multiple triggers into one queued build
  - enforces one active build per project
  - manual rebuild preempts a debounced queued build
  - repeated failures activate backoff and stop automatic retries
  - stale state keeps last good graph available
  - disabled projects ignore triggers
  - memory saves of `decision`, `handoff`, `plan`, `summary`, `session`, and open-loop changes can mark the graph stale

Implementation:

- Add build queue service with injectable timers for tests.
- Hook memory/project events conservatively after manual build works.
- Log state changes through existing activity logging.
- Keep queue in-process for MVP; do not depend on the Vault task executor.

Done when:

- Auto-build is observable, debounced, and failure-isolated.
- A Graphify failure cannot block memory save or recall.

## Phase 7: Desktop Dashboard and Real `graph.html` Embedding

Goal: replace the current sampled memory relationship preview with a Graphify-aware dashboard while preserving Vault visibility.

Failing tests first:

- `packages/desktop/src/graphify-view-model.test.ts`
  - settings panel states: missing runtime, detected runtime, install failed, installed, developer mode
  - project graph states: source root required, queued, building, fresh, stale, failed, disabled
  - action availability for install, rebuild, full rebuild, semantic rebuild, export artifacts, open report, and open folder
  - failed build shows last error and log pointer
  - stale graph shows warning while keeping open graph action
- `packages/desktop/src/graphify-artifact-url.test.ts`
  - renderer requests artifact URLs through IPC only
  - arbitrary `file://` and traversal paths are rejected

Implementation:

- Add Settings -> Extensions -> Graphify, likely by adding an `extensions` settings tab.
- Add a Project Graph panel that surfaces source-root picker, build state, counts, controls, logs, and report links.
- Update the Graph page to embed the real managed `graph.html` when present.
- Show `GRAPH_REPORT.md` as a tab or side panel.
- Keep the previous memory relationship preview only as a fallback or secondary Vault-memory view.

Manual verification:

- Launch desktop dev server.
- Verify missing Graphify does not break the app.
- Verify fake artifact embedding uses the controlled serving path.
- Later, after product code is approved, verify a real graph build for `the-vault`.

Done when:

- The Graph page displays Graphify's real artifact when available.
- Missing or broken Graphify gives clear UI without breaking the rest of the desktop app.

## Phase 8: Vault MCP Graph Tools

Goal: expose Graphify through stable Vault MCP tools while preserving all existing MCP connector behavior.

Failing tests first:

- `packages/mcp-server/src/graphify-tools.test.ts` or core-level tool formatter tests
  - `vault_graphify_status` returns runtime and project state
  - `vault_graphify_build_project_graph` queues or runs a build and returns build status
  - `vault_graphify_query` returns graph answers with freshness warnings
  - `vault_graphify_get_node`, `vault_graphify_get_neighbors`, and `vault_graphify_shortest_path` return budgeted typed context
  - `vault_graphify_explain_impact` returns likely files, central nodes, tests, and caveats
  - disabled/missing/stale/failed states return typed fallbacks, not server crashes
  - existing memory tools still register and work

Implementation:

- Add core methods for graph status, build, query, node, neighbors, path, and impact.
- For MVP, implement query through Graphify CLI/artifact reads first.
- Keep persistent Graphify MCP sidecar as a later optimization behind the same Vault MCP contract.
- Add tools to `packages/mcp-server/src/index.ts` with clear schemas and budget parameters.

Done when:

- External agents can call only Vault MCP for graph context.
- MCP memory connector setup in `ConnectPanel` and Electron connection handlers remains untouched except for additive tool availability.

## Phase 9: `vault_recall_with_graph_context`

Goal: combine Vault memory recall with Graphify graph context in one budgeted agent-facing response.

Failing tests first:

- `packages/core/src/graphify-recall.test.ts`
  - returns Vault recall results plus graph query results
  - includes likely relevant files, central nodes, communities, shortest paths when useful, and report snippets
  - returns suggested next file reads rather than dumping full files
  - respects max token/context budgets
  - includes graph freshness warnings
  - falls back to Vault-only recall when Graphify is missing, disabled, stale without usable artifacts, or failed
  - logs fallback reason

Implementation:

- Add `buildRecallWithGraphContext` service that composes existing `recallContext` with Graphify artifact/query services.
- Add `Vault.recallWithGraphContext`.
- Add `vault_recall_with_graph_context` MCP tool.
- Update compact context formatting only after the new service is passing tests.

Done when:

- Agents get one combined context pack for planning and risky code edits.
- The response narrows file reads instead of increasing context by default.

## Phase 10: CLAUDE.md and AGENTS.md Instruction Sync

Goal: add user-confirmed Graphify routing instructions without disturbing existing Vault Memory Skill setup.

Failing tests first:

- `packages/core/src/graphify-instruction-sync.test.ts`
  - inserts only between `<!-- vault-graphify:start -->` and `<!-- vault-graphify:end -->`
  - updates an existing marked section idempotently
  - removes only the marked section
  - preserves all unrelated content
  - produces preview diffs before writes
  - handles missing files by previewing creation
  - rejects paths outside the selected instruction targets

Implementation:

- Add instruction sync service in core for pure string operations and path planning.
- Add desktop IPC actions for preview, apply, and remove.
- Add UI actions:
  - Preview Claude instruction sync
  - Apply Claude instruction sync
  - Preview Codex instruction sync
  - Apply Codex instruction sync
  - Remove Vault Graphify section
- Prefer project-root `CLAUDE.md` and `AGENTS.md` when a project source root is selected.
- Keep existing Vault Memory Skill install/uninstall flows in `ConnectPanel` separate.

Done when:

- Instruction sync is explicit, previewable, reversible, and marker-scoped.

## Phase 11: Token-Savings Telemetry

Goal: prove whether Graphify reduces repeated token spend without claiming savings blindly.

Failing tests first:

- `packages/core/src/graphify-telemetry.test.ts`
  - records graph queries per recall
  - records graph freshness at query time
  - records fallback reasons
  - estimates files avoided from graph-guided candidates versus broad search baseline
  - estimates context-pack tokens from returned summaries/snippets
  - keeps telemetry local in activity logs or Graphify project tables
  - avoids logging full source content or secrets
- `packages/desktop/src/graphify-telemetry-view-model.test.ts`
  - aggregates saved query count, fallback count, freshness mix, estimated tokens saved, and files avoided

Implementation:

- Extend controlled activity action types with Graphify events or use existing `recall` with Graphify metadata where appropriate.
- Add telemetry helpers that mirror the existing recall analytics style in `packages/desktop/src/cockpit-metrics.ts`.
- Add dashboard tiles in Recall or Graph pages for:
  - graph queries per recall
  - graph fallback reasons
  - estimated files avoided
  - estimated context tokens saved
  - freshness at query time

Done when:

- Token-savings claims are traceable to local telemetry and visible in the desktop.

## Phase 12: Optional Semantic Mode and Quality Optimization

Goal: add cost-aware quality improvements after local fast mode is stable.

Failing tests first:

- semantic mode remains disabled by default
- semantic build requires explicit opt-in and configured provider
- semantic mode warnings mention external provider use
- scheduled full rebuild policy does not run semantic extraction automatically
- impact summaries respect budgets and stale graph warnings

Implementation:

- Add semantic profile controls.
- Add scheduled full rebuild policy after manual and auto-build are reliable.
- Add richer impact summaries using report snippets and graph neighborhoods.

Done when:

- Semantic extraction is opt-in, visible, and budgeted.

## End-to-End Acceptance Tests

Use a temporary Vault root and fake Graphify first:

- Runtime missing: Vault starts, MCP memory tools work, desktop shows install guidance.
- Runtime detected: status shows version and selected runtime mode.
- No source root: project graph panel asks for folder and does not build.
- Manual build success: artifacts land under Vault-managed Graphify app data.
- Manual build failure: last good graph remains visible and failure log is surfaced.
- Graph page: controlled local artifact route embeds `graph.html`.
- MCP graph query: `vault_graphify_query` returns graph result and freshness metadata.
- Recall with graph: `vault_recall_with_graph_context` returns memory and graph context with suggested next file reads.
- Instruction sync: preview, apply, update, and remove marker-scoped sections in `CLAUDE.md` and `AGENTS.md`.
- Existing connector flows: Codex, Claude Desktop, and Claude Code connection status and setup actions still behave as before.

Then use real Graphify manually:

- Managed runtime install on Windows.
- Build graph for `C:\Users\Mini\Desktop\Projects\the-vault`.
- Confirm `graph.html`, `graph.json`, and `GRAPH_REPORT.md` are displayed from managed artifact storage.
- Confirm user repository remains clean unless export is explicitly requested.

## Rollout Order

1. Core contracts, storage, and runtime detection.
2. Source-root selection and corpus export.
3. Manual build and artifact gateway.
4. Desktop status panels and real `graph.html` embedding.
5. Auto-build queue.
6. MCP graph tools.
7. Recall-with-graph context.
8. Instruction sync.
9. Telemetry and quality optimization.

This ordering keeps every visible feature behind a working, testable core boundary and keeps Graphify optional until the graph build and query path is reliable.

