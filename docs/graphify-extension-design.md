# Vault Graphify Extension Design

## Status

Draft for review. No implementation is included in this document.

## Context

The Vault is a local-first memory operating system for coding agents and humans. It already owns durable memory, projects, recall, task execution, desktop UI, and MCP tools. Graphify is a Python knowledge-graph engine that can turn a repository or corpus into graph artifacts such as `graph.json`, `GRAPH_REPORT.md`, and an interactive `graph.html`.

The chosen direction is to integrate Graphify as a first-class optional Vault extension, not to copy Graphify UI components into Vault and not to make Vault core depend directly on Python, NetworkX, or Graphify internals.

The product goal is one dashboard: Vault should detect, install, launch, monitor, and use Graphify from the Vault desktop and MCP surfaces while Graphify continues to own graph extraction, analysis, and visualization.

## Goals

- Provide one Vault dashboard for memory, recall, agents, and project graphs.
- Use Graphify's real graph artifacts and UI instead of reimplementing them in React.
- Let Vault agents call one stable Vault MCP interface for both memory and graph context.
- Reduce token usage by narrowing broad file reads through graph queries, neighbors, paths, reports, and impact summaries.
- Keep user repositories clean by default.
- Keep normal users independent from a local Graphify source clone.
- Support local Graphify source checkouts only as developer mode.
- Make Graphify optional and failure-isolated so the existing Vault app still works when the extension is absent, broken, or disabled.

## Non-Goals

- Do not vendor the full Graphify source tree into `the-vault` for the MVP.
- Do not remove or replace Vault's memory model.
- Do not make `packages/core` import Python, NetworkX, or Graphify modules.
- Do not require users to have `C:\Users\Mini\Desktop\cloned-repos\graphify` or any other local clone.
- Do not write `graphify-out` into user repositories by default.
- Do not silently install packages, mutate shell profiles, or overwrite assistant instruction files.
- Do not expose raw Graphify CLI usage as the normal agent path.

## Architecture Summary

Vault becomes the owner of extension lifecycle and agent policy. Graphify remains the graph engine.

```text
Claude / Codex / UI
        |
        v
Vault Desktop + Vault MCP
        |
        v
Vault Graphify Extension Service
        |
        v
Vault-managed Graphify runtime
        |
        v
Graphify artifacts: graph.html, graph.json, GRAPH_REPORT.md
```

The extension is split into five layers:

1. Runtime manager: install, detect, update, and execute Graphify.
2. Project graph manager: map Vault projects to source roots, corpus exports, artifact paths, build state, and freshness.
3. Build queue: debounce auto-build triggers and run Graphify jobs with logs and backoff.
4. Artifact gateway: serve/preview `graph.html`, read `graph.json`, read `GRAPH_REPORT.md`, and expose a typed metadata model.
5. MCP and agent router: expose graph tools through Vault MCP and combine Vault recall with Graphify graph context.

## Runtime Model

The default runtime is Vault-managed and isolated.

Vault should create an extension runtime under Vault app data, not inside the repository and not in the user's source project. The preferred installer is `uv` because Graphify's public docs recommend `uv tool install graphifyy`; `pipx` and ordinary Python virtual environments are fallback options.

Runtime modes:

| Mode | Audience | Behavior |
| --- | --- | --- |
| `managed` | normal users | Vault creates and owns an isolated Graphify install. |
| `path` | advanced users | Vault uses a user-selected `graphify` executable. |
| `localSource` | developers | Vault uses a local cloned Graphify checkout in editable/dev mode. |

The local clone mode is useful for developing against `C:\Users\Mini\Desktop\cloned-repos\graphify`, but it must never be assumed for general users.

Install profiles:

| Profile | Extras | Purpose |
| --- | --- | --- |
| `base` | none | Code and common text graph builds. |
| `mcp` | `mcp` | Graphify's MCP server support. |
| `documents` | `pdf`, `office`, `svg`, `sql` | Project docs, reports, SQL schemas, graph SVG export. |
| `semantic` | `openai`, `gemini`, `bedrock`, or `ollama` | Optional semantic extraction through configured providers. |
| `full` | selected `all`-like bundle | Power-user install, not default. |

Vault should show the exact command before running an install. Example commands:

```powershell
uv tool install graphifyy
uv tool install "graphifyy[mcp,pdf,office,svg,sql]"
uv tool install --editable "C:\Users\Mini\Desktop\cloned-repos\graphify[mcp,pdf,office,svg,sql]"
```

Implementation recommendation: Phase 1 should use a Vault-managed virtual environment when Python is available, with `uv` as the preferred installer/runner when present. `uv tool install` remains an acceptable fallback and a user-visible recovery command, but a Vault-owned virtual environment gives the product stronger control over paths, versions, upgrades, logs, and uninstall behavior.

The UI should describe the effect in product terms, not expose unnecessary installer details.

## Data and Artifact Layout

Graphify outputs are stored under Vault-managed app data by default. User repositories stay clean unless the user explicitly exports artifacts.

Graphify extension data uses split storage:

- SQLite stores queryable Vault product state, project relationships, freshness, build history, artifact pointers, and failures.
- JSON config stores machine-local runtime configuration such as executable paths, managed runtime path, local source checkout path, installer preferences, debounce settings, and semantic mode flags.

This keeps UI queries and project status reliable while keeping environment-specific paths easy to inspect, reset, or move.

Recommended layout:

```text
<vault-app-data>/
  extensions/
    graphify/
      runtime/
      cache/
      projects/
        <project-slug>/
          corpus/
            source-manifest.json
            vault-memory-export/
              memories.ndjson
              memories/
                <item-uid>.md
          graphify-out/
            graph.html
            graph.json
            GRAPH_REPORT.md
            graph.svg
          logs/
            latest.log
            <build-id>.log
          build-state.json
```

`source-manifest.json` records the project source root, selected include/exclude patterns, build mode, memory export hash, Graphify version, runtime mode, and latest artifact paths.

`build-state.json` records:

```json
{
  "project": "the-vault",
  "sourceRoot": "C:/Users/Mini/Desktop/Projects/the-vault",
  "graphPath": ".../graphify-out/graph.json",
  "htmlPath": ".../graphify-out/graph.html",
  "reportPath": ".../graphify-out/GRAPH_REPORT.md",
  "lastBuildStartedAt": "2026-05-24T00:00:00.000Z",
  "lastBuildCompletedAt": "2026-05-24T00:01:00.000Z",
  "status": "fresh",
  "runtimeMode": "managed",
  "buildMode": "fast",
  "memoryExportIncluded": true,
  "graphifyVersion": "0.8.17",
  "failureCount": 0
}
```

## Corpus Model

Vault should let Graphify own mixed graph semantics. Vault should not hand-merge a separate memory graph and code graph in v1.

For each project, Vault prepares a corpus with two sources:

1. Source corpus: the project source folder or registered project root.
2. Vault memory export corpus: generated Markdown/NDJSON containing relevant memories.

Memory export includes:

- item UID
- title
- project
- memory type
- subject
- summary
- tags and keywords
- priority and status
- created and updated timestamps
- related file paths
- related memory IDs
- open loop state
- summary and selected content by default

Full memory content should not be exported by default in Phase 1. The default export should include frontmatter, title, subject, summary, keywords, tags, related files, related item IDs, and a short content excerpt when present. Full body export can be enabled per project once privacy and graph quality are understood.

Memory export files should have stable filenames so Graphify can connect the same memory across rebuilds:

```text
vault-memory-export/
  memories.ndjson
  memories/
    vm_abc123.md
```

Each Markdown memory file should include frontmatter with the item UID and related files. This lets Graphify connect source paths, docs, and Vault history when it can.

## Build Modes

Vault should support build modes with explicit cost and freshness behavior.

| Mode | Default | Description |
| --- | --- | --- |
| `fast` | yes | Local extraction for code/docs supported by base Graphify install. No surprise semantic provider use. |
| `full` | manual first | Includes memory export and optional document extras. May take longer. |
| `semantic` | opt-in | Allows provider-backed semantic extraction for docs, PDFs, images, or media. Must surface cost/key requirements. |

Default automatic behavior:

- Enable Graphify for projects when the runtime exists.
- Auto-build in `fast` mode.
- Include Vault memory export when it is cheap and local.
- Do not run semantic provider-backed extraction automatically until the user enables it.

Manual actions:

- Rebuild now.
- Full rebuild.
- Semantic rebuild.
- Export artifacts to repo.
- Open artifact folder.

## Auto-Build Policy

Auto-build is enabled by default after Graphify runtime setup. It must be debounced and observable.

Triggers:

- project source files changed
- Vault memories changed for that project
- related file paths changed
- project relationship changed
- user saves a decision, handoff, bugfix, plan, or open-loop memory
- optional git hook integration later

Debounce:

- wait 30-90 seconds after detected changes
- coalesce multiple events into one build
- do not run more than one build per project at a time
- allow manual rebuild to preempt queued debounce

Backoff:

- after repeated failures, stop automatic attempts for that project until user action or a longer cooldown
- keep last good graph available with a stale warning

Freshness states:

| State | Meaning |
| --- | --- |
| `missing` | no graph has been built |
| `queued` | build requested but not started |
| `building` | Graphify process running |
| `fresh` | artifacts match known inputs |
| `stale` | source or memory changed since last graph |
| `failed` | latest build failed |
| `disabled` | project opted out |

## Desktop Experience

Vault should expose one dashboard, not one source tree.

Graphify appears in:

1. Settings -> Extensions -> Graphify
2. Projects -> selected project -> Graph
3. Graph page
4. Agent/Recall context views

Settings -> Extensions -> Graphify:

- runtime status
- installed version
- install/update/detect controls
- extras status
- runtime mode switch
- managed runtime location
- developer local source path
- logs

Project Graph panel:

- graph status
- last build time
- build mode
- source root
- source root picker when a project has no mapped folder
- memory export included
- node/edge/community counts
- rebuild controls
- open graph
- open report
- export artifacts

Graph page:

- embed Graphify's real `graph.html` from the latest artifact
- show status/freshness banner
- show `GRAPH_REPORT.md` alongside or as a tab
- show build log if failed
- do not recreate Graphify's graph UI in React

Embedding should use a local, controlled file-serving path instead of direct arbitrary `file://` when possible. The app must only serve artifacts from Vault's managed Graphify artifact directories.

## MCP Tools

Vault MCP remains the stable agent interface. Agents should call Vault tools, not raw Graphify CLI, by default.

Proposed tools:

| Tool | Purpose |
| --- | --- |
| `vault_graphify_status` | report runtime and per-project graph status |
| `vault_graphify_build_project_graph` | queue or run a graph build |
| `vault_graphify_query` | ask a graph question for a project |
| `vault_graphify_get_node` | fetch node detail by ID/label |
| `vault_graphify_get_neighbors` | fetch neighbor context |
| `vault_graphify_shortest_path` | find path between two nodes |
| `vault_graphify_explain_impact` | summarize impacted files/modules/tests for a proposed change |
| `vault_recall_with_graph_context` | combine Vault memory recall with Graphify graph context |

The implementation can either call Graphify's CLI query path or run Graphify's MCP server behind Vault. The outside contract stays Vault MCP either way.

Implementation recommendation: Phase 1 should use Graphify CLI/query and artifact reads first because it is simpler to supervise and easier to make robust. A persistent Graphify MCP sidecar should be added after basic build/query flows work, or when repeated query latency demands it.

`vault_recall_with_graph_context` is the most important agent-facing tool. It should return:

- top Vault memories
- graph query result
- likely relevant files
- central nodes or communities
- shortest paths when useful
- report snippets
- freshness warning if applicable
- suggested next file reads

## Agent Instruction Sync

Vault should maintain platform-specific instruction snippets. It should never overwrite whole instruction files.

Supported files for MVP:

- `CLAUDE.md` for Claude Code
- `AGENTS.md` for Codex and OpenAI agents

Vault-owned section markers:

```md
<!-- vault-graphify:start -->
...
<!-- vault-graphify:end -->
```

Instruction content:

```md
## Vault Graphify Extension

For project architecture, code impact, symbol/file relationships, and "what connects X to Y" questions, call Vault Graphify MCP tools before broad search or large file reads.

Use Vault memory recall for decisions, handoffs, open loops, and historical project context.

Combine both when planning code changes, reviewing impact, or preparing implementation handoffs.
```

UI actions:

- Preview Claude instruction sync.
- Apply Claude instruction sync.
- Preview Codex instruction sync.
- Apply Codex instruction sync.
- Remove Vault Graphify section.

All instruction sync should be user-confirmed.

## Agent Routing Policy

Vault should teach agents this routing model:

- Vault recall answers why/history/decisions/handoffs/open loops.
- Graphify answers where/structure/connections/impact.
- Combined context is required for implementation planning and risky code edits.

Use Graphify when the query includes:

- architecture
- call flow
- import/dependency
- impact
- connected to
- neighbors
- shortest path
- central files
- tests related to
- symbol/function/class relationships
- repo map

Use Vault memory first when the query includes:

- previous decision
- handoff
- why did we
- user preference
- open loop
- last session
- plan
- bug history

Use both when:

- planning code changes
- reviewing a bug with prior decisions
- explaining why a module exists
- estimating blast radius
- preparing implementation context for Claude/Codex

## Token Usage Strategy

Graphify should reduce repeated token spend by replacing broad file reads with graph-guided narrowing.

Expected savings:

- fewer full-file reads during orientation
- fewer repeated architecture rediscovery sessions
- smaller context packs through graph neighbors and paths
- reusable graph reports and community summaries
- better file prioritization before implementation

Cost controls:

- fast local auto-build by default
- semantic extraction opt-in
- stale graph fallback with warning
- context budgets on MCP responses
- return file candidates and summaries before content dumps

Telemetry:

- graph queries per recall
- files avoided estimate
- context pack token estimate
- graph freshness at query time
- fallback reason when Graphify was not used

## Security and Privacy

The extension must treat project source, memory exports, and graph artifacts as local sensitive data.

Rules:

- Do not send data to external semantic providers unless the user enables semantic mode and configures the provider.
- Do not expose arbitrary file paths through artifact serving.
- Serve only files under the managed Graphify artifact root.
- Do not include secrets or ignored paths in memory export or source manifests.
- Respect project ignore patterns and Graphify's own sensitive-file filters.
- Show when a build mode may use external providers.
- Keep logs useful but avoid dumping large secrets or full file contents.

## Failure Modes

| Failure | Product behavior |
| --- | --- |
| Graphify not installed | show install options; Vault continues normally |
| Python/uv missing | show prerequisite detection and install guidance |
| install fails | show command, exit code, log, retry action |
| build fails | preserve last good graph; mark failed; show log |
| graph missing | queue build; recall falls back to Vault-only |
| graph stale | use last graph with warning; queue rebuild |
| MCP bridge fails | use CLI fallback when possible; otherwise return clear error |
| graph.html missing | show report/JSON status and rebuild action |
| local clone missing | disable developer mode; recommend managed runtime |
| project has no source root | prompt user to choose a folder before graph build; allow disabling Graphify for that project |

## Phased Delivery

### Phase 1: Runtime and Project Model

- Add Graphify extension settings model.
- Detect Python, uv, Graphify CLI, version, and extras.
- Define managed runtime directories.
- Add per-project Graphify config and state types.
- Add no-op UI status panel.

### Phase 2: Install and Build Pipeline

- Implement user-confirmed install commands.
- Export Vault memories for a project into managed corpus.
- Run Graphify build jobs.
- Capture logs and state.
- Read graph artifact metadata.
- Support manual rebuild.

### Phase 3: Auto-Build

- Add file/memory change triggers.
- Add debounce queue.
- Add freshness state.
- Add backoff and last-good-graph behavior.

### Phase 4: Desktop Graph Dashboard

- Add Settings -> Extensions -> Graphify.
- Add Project Graph status.
- Embed Graphify `graph.html`.
- Add `GRAPH_REPORT.md` viewer.
- Add export artifact controls.

### Phase 5: MCP and Agent Routing

- Add Vault Graphify MCP tools.
- Add `vault_recall_with_graph_context`.
- Add instruction sync for `CLAUDE.md` and `AGENTS.md`.
- Add context budgets and freshness warnings.

### Phase 6: Token and Quality Optimization

- Add token-saving telemetry.
- Add impact summaries.
- Add graph report highlights to project briefing.
- Add optional semantic build mode.
- Add scheduled full rebuild policy.

## Testing Strategy

Core unit tests:

- runtime detection parser
- install command planner
- artifact path validation
- project graph state transitions
- memory export formatting
- freshness calculation
- debounce queue behavior
- instruction section insertion/removal

Integration tests:

- fake Graphify executable success/failure
- build log capture
- graph artifact discovery
- MCP tool response formatting
- recall-with-graph context pack assembly

Desktop tests:

- extension settings status rendering
- install button disabled/enabled states
- project graph status rendering
- embedded graph safe path validation
- failed build log display

Manual verification:

- managed install on Windows
- local clone developer mode
- graph build for `the-vault`
- graph page embeds real Graphify UI
- Claude/Codex instruction sync previews
- MCP query from an agent client

## Acceptance Criteria

The feature is successful when:

- a normal user can install Graphify from Vault without a local clone
- Vault can build a graph for a registered project into managed app data
- Vault asks for a source folder when a project has no mapped root before attempting a graph build
- Vault can display Graphify's real `graph.html`
- Vault can show graph freshness and build logs
- Vault MCP can answer graph queries through Vault tools
- `vault_recall_with_graph_context` combines memories and graph context
- Claude and Codex instruction sync can be previewed and applied safely
- missing or broken Graphify never breaks core Vault recall/save/MCP behavior
- user repositories stay clean unless the user explicitly exports artifacts

## Open Questions

None. The current design is ready for implementation planning after user review.
