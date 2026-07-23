# Codex plugin setup (2026-07-23)

## Plan
- [x] Verify repo: github.com/openai/codex-plugin-cc (official OpenAI marketplace, v1.0.6)
- [x] Inspect before installing — commands, hooks, scripts; hooks are benign
      (session lifecycle + stop-review gate, which is opt-in via /codex:setup)
- [x] `claude plugin marketplace add openai/codex-plugin-cc`
- [x] `claude plugin install codex@openai-codex` → user scope, enabled
- [x] Verify: `claude plugin list` shows codex 1.0.6; `codex login status` =
      logged in via ChatGPT (codex-cli 0.144.1, Node 24 — all requirements met)

## Review
Adds /codex:review, /codex:adversarial-review, /codex:rescue, /codex:transfer,
/codex:status, /codex:result, /codex:cancel, /codex:setup. Loads in new
sessions (or via /reload-plugins). No login needed — existing Codex CLI auth is
reused. Review gate deliberately left disabled.

---

# Graphify extension: update support + hardening

## Findings (root causes)
1. **"Community 226" vs named communities** — the labels live inside Graphify's own
   `graph.html` (Vault embeds it verbatim; the string "Community" appears nowhere in
   Vault's renderer). The managed runtime has **graphify 0.8.18**, which has no
   community-naming logic — its `update` path fills every unlabeled community with
   `"Community {cid}"`. Current graphify (**0.9.17**) added
   `label_communities_by_hub()`: each community is named after its highest-degree
   member node (hence "APIRouter", "SecurityBase" in the reference screenshot).
   Vault wipes its staging dir every build, so after a runtime upgrade the next
   rebuild hub-names all communities — no Vault-side label surgery needed.
2. **No update path from Settings** — `planGraphifyInstall` only produces install
   commands, the Settings panel hides them once state === 'installed', and nothing
   ever checks PyPI for a newer version. Installed 0.8.18 vs latest 0.9.17 was
   invisible.
3. **`detectedGraphifyVersion` is null everywhere** — build service only carries
   forward `status.state?.detectedGraphifyVersion ?? null`; nothing ever detects it.
4. **Stuck `building` freshness** — live DB shows freshness "building" since
   2026-07-16 23:23Z with completedAt null (app quit mid-build). No recovery exists;
   the graph card stays "building" forever (same class of bug as the task-executor
   stale-running fix).

## Plan
- [x] Core `graphify-runtime.service.ts`: export version parser; add
      `compareGraphifyVersions`, `fetchLatestGraphifyVersion` (PyPI JSON, injectable
      fetch, timeout), `checkGraphifyUpdate` (detect installed + latest → status),
      `planGraphifyUpdate` (uv / pipx / venv upgrade commands; managed mode only —
      path/localSource return supported:false with reason).
- [x] Core types + `vault.ts` facade: `planGraphifyUpdate`, `checkGraphifyUpdate`
      (persists result to settings key `graphify_update_check`),
      `getGraphifyUpdateCheck`; pass vaultRoot/isBuildActive into project status.
- [x] Core `graphify-build.service.ts`: detect graphify version via the build runner
      at build start and stamp it into build records + project state; export
      `hasActiveGraphifyBuilds()` for the update guard.
- [x] Core `graphify-project.service.ts`: reconcile interrupted builds — if freshness
      is building/queued, no fresh build lock, and started > 35 min ago → flip to
      `stale` (artifacts exist) / `failed` (building, no artifacts) / `missing`
      (queued, no artifacts) and fail the dangling build record.
- [x] MCP `graphify-tools.ts`: `vault_graphify_status` includes the persisted
      update check (installed vs latest) so agents can see runtime drift.
- [x] Desktop main: IPC `vault:checkGraphifyUpdate` + `vault:updateGraphifyRuntime`
      (executes the update plan via spawn shell:false, 10-min timeout, refuses while
      builds are active, writes `logs/update-latest.log`, re-detects, then marks
      enabled projects stale + queues auto-rebuilds with reason `runtimeUpdated`).
- [x] Desktop preload + types.d.ts: expose both new APIs.
- [x] Desktop `graphify-view-model.ts`: update-check input → `latestVersion`,
      `updateAvailable`, `actions.update` (+ updating state).
- [x] Desktop `SettingsView.tsx`: auto-check on Extensions load; installed card shows
      runtime mode · installed · latest, plus a Runtime updates card with one-click
      **Update Graphify** and a result / error surface.
- [x] Tests: runtime (plan/compare/fetch/check), build (version stamping), project
      (interrupted-build recovery ×5), view model (update action states).
- [x] Full suite (326/326) + `pnpm lint` (tsc --noEmit) + `pnpm build` all green.

## Decisions
- Update execution is **user-initiated one click** (auto-*check* is automatic).
  Install stays copy-paste; "never silently installs" principle keeps holding —
  an explicit Update click is not silent.
- Latest-version lookup uses PyPI JSON API with injectable fetch (no network in
  tests, offline degrades to "check failed" without breaking detection).
- After a successful update, graphs are marked stale + auto-rebuilt so the new
  hub-named communities appear without manual action.

## Review
- **Community naming mystery solved**: the "Community 226" labels come from Graphify's
  own graph.html; Vault renders it verbatim. Installed 0.8.18 had no naming logic;
  0.9.17 names each community after its highest-degree member node
  (`label_communities_by_hub`, deterministic, LLM-free). Verified end-to-end: ran
  0.9.17 `cluster-only` on a scratch copy of the real 5.8k-node graph — all 701
  communities got real names (`main.ts`, `Vault`, `graphify-build-queue.service.ts`,
  …), zero placeholders. Because Vault wipes its staging dir per build, no label
  cleanup is needed — the next rebuild produces named communities automatically.
- **Update support**: automatic *check* (PyPI JSON, injectable fetch, offline-safe)
  runs on Extensions load and is persisted to settings (`graphify_update_check`) so
  the MCP `vault_graphify_status` reports runtime drift without network. The actual
  upgrade is one explicit click — Vault executes the exact previewed commands
  (spawn, shell:false, 10-min timeout), logs to `extensions/graphify/logs/
  update-latest.log`, refuses while builds run, re-detects, and queues debounced
  rebuilds (`runtimeUpdated` reason) for every previously built project. PATH /
  developer-source modes return a clear "not managed by Vault" reason instead of
  guessing commands.
- **Version stamping fixed**: `detectedGraphifyVersion` was null in every build row
  since launch — the build service only carried forward a value nothing ever set. It
  now runs `--version` through the injected build runner at build start and stamps
  building/failed/fresh records (fallback to last known on flaky detect).
- **Interrupted-build recovery**: stuck `building`/`queued` freshness (app quit or
  crash mid-build) now self-heals on any status read — older than 35 min, no live
  in-process build, no fresh build.lock → `stale` when graph.json survives, `failed`
  (building) / `missing` (queued) otherwise, and the dangling build row is closed as
  failed. Validated against production data: the live DB had three wedged projects
  (the-vault queued, Ali Saad Portfolio building, IronHack queued) — healed manually
  with the same transitions the code now applies automatically.
- **Live runtime upgraded** 0.8.18 → 0.9.17 in the managed venv (same command the new
  Update button runs). 0.9.17 keeps Vault's full invocation contract (`update`,
  `cluster-only`, `GRAPHIFY_VIZ_NODE_LIMIT`).
- Verification: pnpm build ✓, pnpm lint ✓, 326/326 tests ✓ (34 graphify-focused, 
  incl. 5 new recovery tests, 11 new runtime/update tests, 1 new view-model test).

## Codex implementation notes (open-loops v2 A–D)

### Landed
- Phase A additive/idempotent schema migration: typed/lifecycle/versioned project
  fields; authorization/evidence policies; dedicated loops, immutable events,
  approvals, gate events, and migration ledger; pre-migration SQLite backup plus
  byte-for-byte exported Markdown backup and immutable count/hash inventory.
- Stable neutral installation actor with seeded owner-mode authorization and
  evidence defaults. No person identity is embedded in reusable logic.
- Phase B explicit Work/Brain creation, governed classification/conversion,
  dry-run reports, optimistic project versions, immutable project events, and
  legacy `unclassified` preservation without name inference.
- Phase C read-only reconciliation inventory for legacy next steps, snoozes,
  debugging routines, and resolved rows. Candidate reports always create zero
  dedicated loops.
- Phase D dedicated read/count APIs and shadow telemetry against the unchanged
  legacy `memory_items` predicate. Existing legacy MCP reads/writes remain and
  now label their source; dedicated tools use distinct v2 names.
- Full core lifecycle: strict authorized admission and dedupe, deterministic gate
  evaluation, explicit state machine, evidence and outcome-specific resolution,
  governed owner/role/quorum/external snooze decisions, exact-state resume and
  expiry, governed recovery, idempotency-conflict detection, optimistic versions,
  and transactional row/event/approval writes with rollback coverage.
- Brain invariant enforced in save/update services and SQLite triggers. Project
  merge preserves dedicated loop references and rejects unsafe type/dedupe moves.
- MCP and desktop IPC/preload/type surfaces for all dedicated operations. Minimal
  desktop UI adds explicit type-specific project creation and visible shadow
  legacy-vs-dedicated telemetry with enforcement shown as off.

### Deviations and safest additive interpretations
- Internal legacy `ensureProject` behavior remains available only for existing
  save/task compatibility and creates `unclassified`; the public new-project API
  requires an explicit type. Removing that path belongs to the enforcement/cutover.
- The Brain zero-loop rule is interpreted strictly: Work -> Brain is refused while
  any dedicated loop row, including resolved history, still references the project.
  History must first be preserved by reassigning it to an owning Work Project; no
  loop evidence or event is deleted.
- The default evidence policy is deliberately generic (one durable reference plus
  outcome-specific kinds) because the current required loop contract has no typed
  work-category field. The versioned policy table supports stricter installations.
- Gate decisions are transactional and audited, but are not coupled to real task
  admission in shadow mode. Wiring them into task admission would activate Phase E,
  which was explicitly out of scope.

### Deferred
- Phase E gate enforcement/cutover, Phase F legacy removal, focus-lock/dependency
  propagation beyond the initial project blocking scope, policy-management UI,
  evidence-policy editing UI, and the full section 16 desktop redesign.
- The full Vitest/build commands were attempted. Builds and most reruns were blocked
  by Vite/esbuild child-process `spawn EPERM`; one Vitest launch completed 310/335
  tests, with the 25 database tests blocked before assertions by the root
  `better-sqlite3` Node-ABI mismatch and two import suites unable to load after the
  failed build cleaned core output. Direct TypeScript checks across every package
  and fresh/legacy/lifecycle/merge/rollback runtime smokes using a compatible local
  binding passed; core output was restored, and the normal suite/build still needs
  one run outside this sandbox.
