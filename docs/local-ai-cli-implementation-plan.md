# Local AI CLI Implementation Plan

## Goal

Turn local CLIs such as Claude Code and Codex into real execution backends for Vault in staged, testable increments.

## Current Priority

The current product priority is:

- finish the Vault memory core and make it easy to use
- make local Claude/Codex backend flow understandable and reliable
- keep multi-agent control-plane work deferred until the memory and local-backend experience feels complete

The app should own:

- adapter registration
- config persistence
- model list delivery
- session persistence
- run orchestration
- UI rendering

The CLI should own:

- inference
- native session ids
- raw stdout/stderr

## Current State

Already implemented:

- static local adapter registry for `claude_local` and `codex_local`
- explicit environment test flow
- structured environment test result schema
- model list delivery for local adapters
- detect-model support for local Claude/Codex config reads
- desktop settings UI for local adapter config
- gating of adapter enablement on a successful explicit environment test
- shared adapter runtime contract
- local adapter execution path for real Claude/Codex runs inside the desktop app
- desktop chat wired to the selected local adapter backend
- runtime metadata capture for model/session/reuse state
- adapter fallback session persistence
- thread-key-based session continuity for independent local CLI conversations
- stale-session fallback behavior and manual reset controls

Not implemented yet:

- true agent/task session model keyed by company/agent/task entities
- issue ownership or execution locking
- live run model and dashboards
- transcript/history model beyond the current desktop chat surface

## Implementation Rule

Build this in phases. Do not jump to multi-agent control-plane work before local execution works end to end for one adapter-backed run.

## Phase 1: UX Cleanup And Adapter Surface

### Stage 1.1

Simplify the local adapter settings UX.

Deliverables:

- prefill working directory from the current Vault/project context where possible
- keep adapter type as the primary required field
- default command automatically from adapter type
- move `cwd`, command override, and env override into an `Advanced` section
- make env override optional and clearly expert-only

Exit criteria:

- a normal user can configure Claude or Codex without understanding shell internals
- advanced fields remain available for wrappers and custom environments

### Stage 1.2

Clarify model handling in the UI.

Deliverables:

- fetch models automatically when adapter type changes
- persist selected model in adapter config
- show source of model list
- keep detect-model pathway disabled or null for Claude/Codex until actually implemented

Exit criteria:

- model selection is explicit and stable
- UI does not imply that model is auto-detected from the local CLI

## Phase 2: Local Execution Backend

### Stage 2.1

Add adapter runtime interfaces on the server side.

Each adapter module should expose:

- `execute()`
- `testEnvironment()`
- `listModels()`
- session codec / resume metadata
- optional `detectModel()`

Deliverables:

- shared adapter runtime contract
- `claude_local.execute()`
- `codex_local.execute()`
- normalized execution result shape

Exit criteria:

- server can invoke a selected local adapter through one common execution path

### Stage 2.2

Wire Vault chat/runtime to use the selected local adapter.

Deliverables:

- app resolves saved local adapter config before execution
- app resolves secrets and env overrides before execution
- selected model is passed into CLI args
- Claude execution supports:
  - `--model`
  - `--effort`
  - `--resume <sessionId>` when supported
- Codex execution supports:
  - `codex exec`
  - `--model`
  - `--config model_reasoning_effort=...`
  - optional runtime flags such as search or sandbox controls where supported

Exit criteria:

- Vault can run a real local Claude or Codex call as the actual backend, not just test it

### Stage 2.3

Persist run metadata.

Deliverables:

- provider
- biller
- model
- token counts when available
- cost when available
- whether the session was reused or rotated
- raw stdout/stderr snapshots or structured summaries

Exit criteria:

- each local run leaves a durable execution record

## Phase 3: Session Continuity

### Stage 3.1

Add session persistence for local adapters.

Deliverables:

- adapter session metadata storage
- resume eligibility checks
- session invalidation handling
- manual session reset action in the UI

Resume rules:

- Claude:
  - session id must exist
  - cwd must match
  - prompt bundle compatibility must match
- Codex:
  - session id must exist
  - cwd must match

Exit criteria:

- repeated work on the same thread can continue through the native CLI session when valid

### Stage 3.2

Add fallback behavior for broken sessions.

Deliverables:

- detect unknown or expired native sessions
- log a warning
- retry fresh without resume
- optionally clear stale persisted session state

Exit criteria:

- resume failure does not break execution

## Phase 4: Agent And Task Session Model

This phase starts only after local execution and resume work reliably for a single adapter-backed run.

### Stage 4.1

Introduce agent/task session tables.

Important key shape:

- `companyId`
- `agentId`
- `adapterType`
- `taskKey`

`taskKey` should be derived from task context such as:

- `issueId`
- `taskId`
- wake context

Exit criteria:

- one agent can hold multiple independent session threads
- different agents never share the same persisted task session

### Stage 4.2

Add coarse runtime state per agent.

Deliverables:

- latest session fallback per agent
- agent runtime state view
- session reset controls

Exit criteria:

- agent detail can show both coarse runtime state and per-task sessions

## Phase 5: Run Ownership And Concurrency

### Stage 5.1

Add issue/task execution ownership.

Rules:

- each issue can have only one active execution owner at a time
- same agent and same execution context may coalesce into an existing run
- other agents must defer until the lock is released

Deliverables:

- active execution lock table or equivalent persistence
- lock acquisition/release logic
- wakeup coalescing rules

Exit criteria:

- no two agents execute the same issue concurrently

### Stage 5.2

Add live run records.

Deliverables:

- run lifecycle persistence
- heartbeat timestamps
- transcript preview
- current run by agent
- current run by issue

Exit criteria:

- dashboard and detail pages can render live runs as first-class objects

## Phase 6: UI Control Plane

### Stage 6.1

Agents page.

Deliverables:

- fetch all agents
- fetch live runs
- map current run and run counts by agent

### Stage 6.2

Dashboard.

Deliverables:

- fetch company live runs
- render one card per run
- show:
  - agent name
  - run id
  - issue reference
  - transcript preview

### Stage 6.3

Issue detail and agent detail.

Deliverables:

- issue detail merges active run, live runs, and historical linked runs
- agent detail shows runtime state, task sessions, and run history
- session reset and stale session cleanup actions

Exit criteria:

- UI renders agents, runs, and issue ownership as separate records, not as one shared chat thread

## Out Of Scope For Early Phases

Do not add these before Phase 2 and Phase 3 are stable:

- background passive CLI discovery
- magical install detection claims
- automatic model inference from the local CLI session
- multi-agent orchestration without persisted run/session state
- issue locking without real run records

## Recommended Next Step

Phases 1 through 3 are substantially implemented in this repository.

The correct next step is not deeper control-plane work by default.

Instead:

1. keep the local adapter flow stable and understandable
2. treat it as a supporting backend for Vault memory UX
3. prioritize the master plan stages around memory quality, recall quality, and desktop curation workflows before Phase 4+
