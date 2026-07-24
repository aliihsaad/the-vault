# Changelog

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
