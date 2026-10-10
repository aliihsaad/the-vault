# Changelog

## v0.6.7 - 2026-10-10

Stops Graphify from rebuilding graphs whenever source files are read.

- Graphify: on Windows, reading a file whose last-access time is over an hour old fires a file-watcher change event, so agents, editors, git, Vault reading memory files, and the builds themselves kept queueing full rebuilds (311 builds across 31 projects in about a day). A change event now only queues a build when the file was written after the last build started; creates, deletes and renames still do.
- Graphify: the file watcher uses the build's own exclusions, including `.graphifyignore`, instead of a shorter separate list.
- MCP: saves from Claude desktop Code-tab sessions (MCP client `local-agent-mode-<server>`) are recorded as `claude` instead of `other`.

## v0.6.6 - 2026-10-09

Follow-up fixes found while verifying v0.6.5 against a live install.

- Graphify: the multiple-checkouts warning now also detects a project inside a zip wrapper folder (`repo-main/repo-main/package.json`), which v0.6.5 missed for a real clone-plus-archive folder.
- MCP: saves from the Claude desktop app, whose MCP host client is named `custom3p-main`, are now recorded as `claude` instead of `other`. The save response now includes the recorded `source_app` and the raw `mcp_client` name.

## v0.6.5 - 2026-10-09

Memory-integrity and recall-accuracy release. Fixes saved summaries being cut off by AI enrichment, grounds recall summaries, and hardens Graphify for large graphs and secret files.

- Data loss: post-save enrichment no longer rewrites summaries. The old "polish" step replaced the author's summary with model output that was cut off at the token limit, keeping no copy of the original. Tag suggestions are unchanged.
- Breaking: `vault_save_memory` always stores the item in the requested project. Absolute `related_files` paths that point at another known project no longer re-route the save; the response returns `project_suggestion` instead. Re-routing overrode explicit choices (e.g. brain memories citing a work project's file) and wrote into projects the admission check never covered.
- MCP: when `source_app` is omitted, saves record the client from the MCP handshake (`claude`, `codex`, `openclaw`, or `other`) instead of `manual`.
- Recall: `context_summary` is built only from memories that actually match the query and is dropped when nothing matches, when the model replies that nothing is relevant, or when its reply was cut off.
- Recall: project-scoped recall with a query adds `cross_project_matches`, up to 3 phrase-level matches from other projects, without changing the project's own results.
- Search: `vault_find_memory` keywords now match when any term appears in keywords, title, subject, summary or content (previously every keyword had to be an exact keyword-array element).
- Graphify: the default graph read budget is 64 MB (was 8 MB), parsed graphs are cached while unchanged, and a `tooLarge` result states the `max_bytes` needed. `GRAPH_REPORT.md` is read in full and `max_report_bytes` now caps only the returned snippets, which removes the false "exceeds the read budget" caveat.
- Graphify security: builds exclude more credential files (`*recovery-codes*`, `credentials.json`, `secrets.*`, `*.pem`, `*.key`, `*.pfx`, SSH keys, `.npmrc`, `.netrc`, `.ssh/`, `.aws/` and similar).
- Graphify: a `.graphifyignore` file at the source root excludes extra paths per project, status warns when the source root holds several separate checkouts, and builds record the git branch and commit in the manifest and build log.

## v0.6.4 - 2026-07-24

Project-identity and Reviewer quality release. Makes project type explicit at the agent boundary, separates Work Projects from Brains in the desktop directory, and prevents low-quality project-review proposals.

- Breaking: agent memory writes require an existing project explicitly classified as `work_project` or `brain_context`; missing and legacy-unclassified projects are rejected until the agent creates or classifies them with an explicit type.
- UI: group every non-Brain project under Work Projects and render Brains in a visually distinct durable-memory section with type badges and counts.
- Reviewer: stop truncating generated project descriptions; detect provider token-limit finishes, use representative project-wide evidence, retry once, and reject incomplete, prompt-echoed, overlong, or evidence-ungrounded descriptions.
- Reviewer: replace slug-only merge suggestions with conservative multi-signal duplicate detection using repository/root identity, typo-safe names, descriptions, weighted memory topics, and related-file evidence.
- Safety: never propose a Brain/Work merge, preserve small-project typo detection, attach the actual evidence items to proposals, and test generic-name false positives.

## v0.6.3 - 2026-07-23

Corrective security release for v0.6.2. Closes five governance bypass classes and fixes a universal database-upgrade failure.

- Security: add `tasks.idempotency_key` before its unique index so every existing v0.6.2 database upgrades successfully; covered by a repeated-init regression test.
- Security: consolidate duplicate active duties on upgrade (keep the oldest, mark later duplicates `cancelled` with an auditable reason and timestamps) before enforcing the active-duty unique index.
- Security: all mutating Open-Loops MCP tools use server-derived installation identity; callers cannot supply actor, role, or provider authority.
- Security: quarantine legacy projectless/unknown-project tasks at claim time instead of running them outside project governance.
- Security: ingest external authorization decisions only through a trusted path that persists the deciding provider and binds it to the request/action/target/policy/version/scope; the evaluator authorizes external decisions only when the stored provider matches the policy provider.
- Breaking: `vault_create_task` now requires a canonical `project` and performs ordinary normal-work admission only — `work_intent`, `related_loop_uid`, `actor`, `authorization_request_uid`, `externalApproved`, and caller-selected `memory_maintenance` are removed. Use the dedicated Open-Loops v2 tools for governed evidence/closure work.
- Breaking: distinct-actor quorum cannot be satisfied through repeated ordinary MCP calls; quorum/external decisions must arrive through separately authenticated trusted channels.
- Packaging: Electron 39 / electron-builder 26; in-place `better-sqlite3` Electron rebuild with `node-pty`'s N-API prebuild preserved.

## v0.4.8 - 2026-06-15

- Added delete project support with project-card trash action and confirmation flow.
- Redesigned the Projects page with a compact searchable table and fixed the missing-projects bug.
- Fixed Overview telemetry to use a 7-day window with zero-filled empty days.
- Added deterministic handoff color-coding for Vault Collab inbox cards.
