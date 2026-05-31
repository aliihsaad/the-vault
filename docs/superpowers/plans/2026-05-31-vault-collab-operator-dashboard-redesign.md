# Vault Collab Operator Dashboard Redesign — Implementation Plan (Sub-project #3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for the view-model (pure, highly testable). Steps use checkbox (`- [ ]`) syntax. Contract/behavior-level plan for a high-effort executor — follow existing repo patterns, keep the tree passing, do NOT push to main/origin.

**Goal:** Replace the cluttered ~1,100-line `VaultCollabView` with a clean, simple operator cockpit: a read-mostly board where agents do the work and the human acts in exactly one place. Four zones — **Needs You**, **Agents (by role)**, **Work (handoffs by state)**, **Conversation (discussion + key events)** — over a thin, pure view-model, with all deprecated push/broker jargon removed.

**Architecture:** octogent discipline — pure mapping in the view-model (`packages/desktop/src/vault-collab-view-model.ts`), presentation split into focused components under `packages/desktop/src/components/vault-collab/`. The Electron snapshot (`getVaultCollabDashboardSnapshot`) is unchanged; this is a renderer + view-model refactor. Human actions stay minimal (approve launch, verify, unblock, request agent); agent-driven lifecycle is shown, not driven, from the UI.

**Tech Stack:** React + TypeScript renderer, modular CSS (`app.css` tokens), Vitest. No new runtime deps.

**Depends on:** #1 comms core (sessions now carry `role`; ghosts auto-expire) and #2 launch-with-permission (approve returns a copy-command; `approvedLaunchCommands` already wired in the current view). Both are merged on `vault-brain-graph`.

**Out of scope:** backend/core changes, the `vault-collab` repo, removing broker *code* (only its UI). No new MCP tools.

---

## Information Architecture (target)

```
┌─ NEEDS YOU ───────────────────────────────────────────────┐  one action area; empty → "All clear ✓"
│  launch approvals · blocked/awaiting handoffs · stuck agents │
└──────────────────────────────────────────────────────────────┘
┌ AGENTS (by role) ┐ ┌ WORK (handoffs by state) ┐ ┌ CONVERSATION (msgs + key events) ┐
│ live only        │ │ Available/In-progress/    │ │ unified newest-first stream +     │
│ grouped by role  │ │ Needs-verification/Resolved│ │ compose into selected thread      │
│ [+ Request agent]│ │ click → detail drawer     │ │                                   │
└──────────────────┘ └───────────────────────────┘ └───────────────────────────────────┘
```
- Selecting an agent filters Work + Conversation to that agent. Selecting a handoff opens the detail drawer (thread, related files, lifecycle state, the few human actions).

---

## New View-Model Output Shape (contract)

Extend `buildVaultCollabDashboardViewModel(...)` to also return a `cockpit` object (keep existing fields during transition; components read `cockpit`):

```ts
interface VaultCollabCockpitViewModel {
  needsYou: NeedsYouItem[];          // derived: pending launch approvals, blocked/awaiting_user handoffs, blocked agents
  roster: RoleGroup[];               // live sessions only, grouped by role
  work: WorkColumn[];                // handoffs grouped by lifecycle state, in a fixed display order
  conversation: ConversationEntry[]; // discussion messages + key events, merged, newest-first
  selectedHandoff: HandoffDetailViewModel | null;
}
interface NeedsYouItem { kind: 'launch_approval' | 'handoff_blocked' | 'handoff_awaiting_user' | 'agent_blocked'; id: string; title: string; subtitle?: string; actions: NeedsYouAction[]; }
interface RoleGroup { role: string; agents: RosterAgent[]; }
interface RosterAgent { sessionUid: string; displayName: string; role: string; status: string; currentHandoffUid: string | null; freshness: 'fresh' | 'stale'; }
interface WorkColumn { state: 'available' | 'in_progress' | 'verification_needed' | 'blocked' | 'awaiting_user' | 'resolved'; label: string; cards: WorkCard[]; }
interface ConversationEntry { id: string; at: string; kind: 'message' | 'event'; author?: string; body: string; handoffUid?: string; }
```
- "Live only" roster: exclude `disconnected` and sessions past the staleness threshold (lease/heartbeat from #1). No duplicate rows.
- `needsYou` is the single source for the top strip; if empty, the strip renders "All clear".

---

## File Map

- Modify: `packages/desktop/src/vault-collab-view-model.ts` — add the `cockpit` mapping (pure). Keep existing exports until components migrate, then trim.
- Modify: `packages/desktop/src/vault-collab-view-model.test.ts` — tests for the new mapping.
- Create: `packages/desktop/src/components/vault-collab/NeedsYou.tsx`
- Create: `packages/desktop/src/components/vault-collab/Roster.tsx`
- Create: `packages/desktop/src/components/vault-collab/WorkBoard.tsx`
- Create: `packages/desktop/src/components/vault-collab/ConversationStream.tsx`
- Create: `packages/desktop/src/components/vault-collab/HandoffDetail.tsx`
- Modify: `packages/desktop/src/components/VaultCollabView.tsx` — becomes a thin orchestrator: loads snapshot, builds the cockpit model, wires the 4 zones + detail drawer and action handlers. Target well under 300 lines.
- Modify: `packages/desktop/src/app.css` — cockpit layout + zone styles, reuse existing design tokens; remove styles for deleted widgets.

---

## Task 0: Branch
- [ ] `git checkout -b vault-collab-dashboard-redesign` (off `vault-brain-graph`).
- [ ] Commit this plan: `git add docs/superpowers/plans/2026-05-31-vault-collab-operator-dashboard-redesign.md && git commit -m "docs: add operator dashboard redesign plan"`.
- [ ] Do not push; do not merge.

## Task 1: View-model cockpit mapping (pure, TDD)
**Files:** `vault-collab-view-model.ts`, `vault-collab-view-model.test.ts`.
- [ ] Write failing tests first for each derivation:
  - `needsYou` includes a pending (approved-but-not-launched / requested) launch request as a `launch_approval`, a `blocked`/`awaiting_user` handoff, and a `blocked` agent; excludes healthy items; empty array when all clear.
  - `roster` groups live sessions by `role`, excludes `disconnected`/stale, dedupes.
  - `work` groups handoffs into the fixed column order with correct labels/counts.
  - `conversation` merges discussion messages + key events (claimed/resolved/joined/left/launch approved) sorted newest-first.
- [ ] Implement the pure mapping to satisfy the tests. No React, no IPC in the view-model.
- [ ] Run: `pnpm --filter @the-vault/desktop test -- vault-collab-view-model` → PASS.
- [ ] Commit: `feat: add cockpit view-model mapping`.

## Task 2: Component split
**Files:** the five new components + `VaultCollabView.tsx`.
- [ ] Build each zone component as a pure presentation component taking its slice of the cockpit model + action callbacks (no data fetching inside). `HandoffDetail` renders the selected handoff's thread, related files, lifecycle state, and the human-action buttons.
- [ ] Reduce `VaultCollabView` to orchestration: state (selected agent/handoff, drafts), snapshot load/refresh (existing logic), build cockpit model, render zones, pass handlers. Keep all existing IPC calls (`getVaultCollabHandoffActions`, `approveVaultCollabLaunchRequest`, discussion compose/reply, copy launch command) — only relocate them.
- [ ] Run desktop tsc + existing tests green.
- [ ] Commit: `feat: split Vault Collab dashboard into cockpit zone components`.

## Task 3: Remove deprecated UI + jargon
- [ ] Delete UI for: delivery mode / `wakeable` / `manual_poll` labels, ping-as-wake controls, managed-process launch lifecycle widgets (`mark_running/stopped`), attention-delivery-attempts views, and duplicate/stale session rows.
- [ ] Remove now-dead handlers/state and their CSS. Do NOT remove the underlying IPC/core (backend stays; only the UI surface is cut).
- [ ] Run tsc + tests; fix fallout.
- [ ] Commit: `refactor: remove deprecated push/broker UI and jargon`.

## Task 4: Human actions wired, agent lifecycle read-only
- [ ] Needs-You actions: launch **Approve** → reveals/copies the command (reuse `approvedLaunchCommands` + `copyLaunchCommand`), **Reject**; handoff **verify**/**unblock** where applicable; Roster **Request agent** → `create_launch_request` (via existing path) landing back in Needs You.
- [ ] Claim/release/resolve/reopen remain visible as state but are not primary human buttons (agents drive them); keep a minimal override in HandoffDetail only if an action already exists in the current view.
- [ ] Commit: `feat: wire minimal human actions in cockpit`.

## Task 5: Styling pass (clean + simple)
- [ ] Apply a single consistent visual language using existing `app.css` tokens: calm empty states, clear state colors, no badge soup. Responsive: zones stack on narrow widths.
- [ ] Commit: `style: cockpit layout and visual polish`.

---

## Verification Gates (do not report done until all pass)
```bash
# the-vault, branch vault-collab-dashboard-redesign
pnpm --filter @the-vault/desktop test -- vault-collab-view-model
pnpm lint
pnpm --filter @the-vault/desktop exec tsc --noEmit
pnpm --filter @the-vault/desktop build
```
Acceptance:
1. Board shows the four zones; **Needs You** is the only place with action buttons and reads "All clear" when empty.
2. Agents are grouped by role, live-only (no ghosts/dupes); Request agent works.
3. Handoffs grouped by state; selecting one opens a detail drawer with its thread + related files.
4. Conversation shows discussion + key events newest-first; compose posts into the selected thread.
5. No delivery-mode / wakeable / managed-process / attention-attempt UI remains.
6. `VaultCollabView` is a thin orchestrator (<~300 lines); zones are separate components; view-model is pure and tested. Lint + tsc + build green. Nothing pushed.

---

## Self-Review (author)
- **Spec coverage:** four-zone IA (Tasks 1–2), de-jargon/de-clutter (Task 3), minimal human actions incl. #2 copy-command (Task 4), clean styling (Task 5). Matches the approved design.
- **Risk control:** snapshot/core untouched; backend IPC retained (only UI relocated/removed); branch off `vault-brain-graph`, no push; reversible.
- **Type consistency:** `cockpit` shape defined here is produced in Task 1 and consumed by Task 2 components; names stable across tasks.
- **Decomposition:** pure view-model isolated from presentation; each zone is an independently understandable, testable unit — fixes the 1,100-line monolith.
