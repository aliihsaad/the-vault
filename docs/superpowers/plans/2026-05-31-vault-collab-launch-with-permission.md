# Vault Collab Launch-With-Permission — Implementation Plan (Sub-project #2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every code task. Steps use checkbox (`- [ ]`) syntax. Contract/behavior-level plan for a high-effort executor — follow existing repo patterns, do NOT regress passing tests, and do NOT push to main.

**Goal:** Replace The Vault's fragile "auto-spawn a managed PTY worker and inject prompts" launch path with a robust, permission-gated **copy-command launch**: a coordinator agent (or the user) requests an agent → the user approves in the dashboard → The Vault hands back the exact terminal command to start it. Spawning is optional and never load-bearing for communication.

**Architecture:** The request/approve signal already lives in Vault Collab (`create/approve/reject/cancel_launch_request`) and is kept. The Vault stops being a process broker: on approval it produces a deterministic launch command the user runs in their own terminal. The launched agent registers with Vault Collab, adopts its role, and drains its own inbox via the pull `receive` loop (sub-project #1). The existing node-pty/conpty managed spawn is demoted behind an explicit, clearly-experimental opt-in and is no longer required for anything.

**Tech Stack:** Electron main (`packages/desktop/electron/main.ts`), preload bridge (`preload.ts`), `@the-vault/core` action/types, React renderer, Vitest.

**Depends on:** Vault Collab keeps `create/approve/reject/cancel_launch_request` (confirmed in sub-project #1, Task E). Does NOT depend on the #1 `receive` primitive, so this can run in parallel with #1.

**Out of scope:** The operator dashboard redesign (#3) — this plan adds only a *minimal* functional approve→command affordance; #3 owns the polished UI. Do not rewrite VaultCollabView's layout here. Do not touch the `vault-collab` repo.

---

## Why copy-command instead of auto-spawn

`main.ts` currently spawns `codex` through a `cmd.exe` shim under node-pty and injects the launch prompt via `ptyProcess.write(...)`. This is the source of the recurring Windows failures (`conpty.node` load failure; codex spawn exit `-1073741510` / missing DLL) and it couples *communication* to a fragile process broker. A copy-command launch has no native dependency, works on every platform, and decouples launch from comms entirely — the agent communicates by pulling, regardless of how it was started. This is the "drop the feature that can't be reliably fixed, keep the intent" decision.

---

## File Map

- Modify: `packages/desktop/electron/main.ts` — add `buildLaunchCommand(...)`; change the approve flow to return a launch command instead of auto-spawning; gate the existing managed-PTY spawn behind an explicit opt-in flag; keep but quarantine the PTY code.
- Modify: `packages/desktop/electron/preload.ts` — expose an IPC method that returns the launch command for an approved request.
- Modify: `packages/core/src/types/vault-collab.ts` — add `VaultCollabLaunchCommand` DTO.
- Modify: `packages/core/src/services/vault-collab-actions.service.ts` — add token-safe `buildLaunchCommand` helper if approval flows through the action bridge; otherwise build in main.ts.
- Modify: `packages/desktop/src/components/VaultCollabView.tsx` + `packages/desktop/src/vault-collab-view-model.ts` — **minimal** affordance only: on an approved request, show the command with a Copy button. No layout overhaul.
- Tests: `packages/core/src/vault-collab-actions.test.ts`, `packages/desktop/src/vault-collab-view-model.test.ts`.

---

## Task 0: Workspace prep (preserve WIP, branch off it)

The repo is on `vault-brain-graph` with substantial uncommitted dashboard WIP. Preserve it non-destructively before building.

- [ ] Confirm state: `git status -s` (expect ~30 modified + untracked files).
- [ ] Checkpoint the WIP so it is recoverable: `git add -A && git commit -m "chore: checkpoint vault-collab dashboard WIP before launch-with-permission"`.
- [ ] Create the working branch off this checkpoint: `git checkout -b vault-collab-launch-permission`.
- [ ] Commit this plan: `git add docs/superpowers/plans/2026-05-31-vault-collab-launch-with-permission.md && git commit -m "docs: add launch-with-permission plan"`.
- [ ] Do NOT merge to main or vault-brain-graph. Report the branch name when done.

(If `git status` reveals the WIP is unexpectedly large or contains unrelated changes, STOP and report before committing — do not discard anything.)

---

## Task A: Deterministic launch-command builder

**Files:** `packages/core/src/types/vault-collab.ts`, `packages/core/src/services/vault-collab-actions.service.ts` (or main.ts if approval is main-owned), test.

Contract:
- `VaultCollabLaunchCommand = { provider: string; role: string; workspacePath: string; command: string; args: string[]; display: string; env?: Record<string,string> }`.
- `buildLaunchCommand(launchRequest): VaultCollabLaunchCommand` produces the exact command to start the requested agent in the requested `workspacePath`, pre-seeded so that on start the agent registers with Vault Collab under the requested `role` and immediately drains attention. For provider `codex`: a plain `codex` invocation in the workspace (no cmd.exe shim, no PTY) plus an initial-instruction string the user can paste; for `claude-code`: the equivalent `claude` invocation. `display` is the copy-paste-ready one-liner shown in the UI.
- **No secrets/tokens** in `display` or `command` (reuse the existing token-redaction pattern in the action service). The launched agent registers itself and obtains its own session token; The Vault does not embed tokens in the command.

TDD expectations (failing first):
- `buildLaunchCommand` for a codex request returns a `display` containing `codex`, the workspace path, and the role; contains no token/secret substrings.
- Unknown/again-provider falls back to a documented generic command rather than throwing.

Commit: `feat: add deterministic launch-command builder`.

---

## Task B: Approve flow returns a command; demote auto-spawn

**Files:** `packages/desktop/electron/main.ts`, `packages/desktop/electron/preload.ts`, test (where feasible).

Contract:
- On launch-request **approve**, the flow calls Vault Collab `approve_launch_request` (unchanged) and then returns `buildLaunchCommand(...)` to the renderer via IPC (e.g. `vaultAPI.vaultCollab.getApprovedLaunchCommand(launchRequestUid)`), instead of spawning a PTY.
- The existing managed-PTY spawn (`spawnPty`, `ptyProcess.write(prompt)`, the conpty `requireFromMain('node-pty')` path, and the `onData/onExit` lifecycle that calls `mark_running/mark_stopped`) is **gated behind an explicit opt-in** — a config flag (default OFF), e.g. `VAULT_COLLAB_EXPERIMENTAL_MANAGED_SPAWN` or a setting. When OFF (default), approval never spawns and never touches node-pty. Keep the code; do not delete it (a future slice may remove it once copy-command is proven).
- Guarantee comms independence: nothing in the approve→command path writes to a PTY or depends on `conpty.node` loading. Approval succeeds even if node-pty is entirely absent.

TDD/verification expectations:
- With the flag OFF (default), approving a request returns a `VaultCollabLaunchCommand` and performs no spawn (assert no PTY constructor call — inject/mock the spawner, or structure `buildLaunchCommand` as a pure function tested directly and assert the approve handler calls it and not `spawnPty`).
- node-pty import is lazy/guarded so the main process boots and approval works on a machine where `conpty.node` fails to load.

Commit: `feat: approve returns launch command; gate managed PTY spawn behind opt-in`.

---

## Task C: Minimal dashboard affordance (no redesign)

**Files:** `packages/desktop/src/vault-collab-view-model.ts`, `packages/desktop/src/components/VaultCollabView.tsx`, `packages/desktop/src/vault-collab-view-model.test.ts`.

Contract (minimal, functional — #3 will redesign):
- In the existing launch-requests area, for a request the user approves, surface the returned `display` command with a **Copy** button and a one-line hint: "Run this in a new terminal to start the agent." Reject/Cancel stay as-is.
- View-model maps the IPC result into a small `approvedLaunchCommand?: string` on the launch-request view item. No new layout, no restyling.

TDD expectations:
- View-model test: given an approved launch-request with a command, the mapped view item exposes the copy string; given no command, it is undefined.

Commit: `feat: show copy-able launch command on approval (minimal)`.

---

## Verification Gates (do not report done until all pass)

```bash
# the-vault repo, on branch vault-collab-launch-permission
pnpm --filter @the-vault/core test -- vault-collab-actions
pnpm --filter @the-vault/desktop test -- vault-collab-view-model
pnpm lint
pnpm --filter @the-vault/desktop exec tsc --noEmit
pnpm --filter @the-vault/desktop build   # renderer + electron + preload
```

Acceptance:
1. Approving a launch request (flag OFF / default) returns a copy-able command and performs **no** PTY spawn; the main process and approval work even if node-pty/conpty cannot load.
2. The command, pasted into a fresh terminal, starts an agent that registers with Vault Collab under the requested role (manual confirmation acceptable; the command is correct and token-free).
3. `create/approve/reject/cancel_launch_request` coordination still works end-to-end through the dashboard.
4. Existing focused tests + lint + tsc + desktop build all green. WIP preserved on the checkpoint commit; work isolated on `vault-collab-launch-permission`; nothing merged.

---

## Self-Review (author)

- **Spec coverage:** robust permission-gated launch via copy-command (A, B), comms decoupled from spawn (B), request/approve signal preserved (relies on #1 Task E keeping those tools), minimal UI now + redesign deferred to #3 (C). Matches the approved direction: user/agent requests, user approves, no fragile injection.
- **Risk control:** WIP preserved by checkpoint commit (Task 0); managed-PTY code quarantined behind an off-by-default flag, not deleted; no main-branch writes; separate Vault Collab DB untouched.
- **Type consistency:** `VaultCollabLaunchCommand` defined in Task A and consumed by Tasks B and C; IPC method name used consistently.
- **Parallelism:** independent of #1's `receive` primitive, so the two executors run concurrently; #3 (dashboard) waits for both.
