# AgentOS V2 — Meeting Record & Execution Plan

Attendees: PM agent, Senior UI Designer, Experience Designer (ex-Apple), Architect agent. Chair: supervisor (this session). Date: 2026-10-26. Branch: `V2-features`.

## Project goal

AgentOS V1 is a single-operator desktop where permission-scoped rooms run agent teams over one SSE stream, with an approvals queue as the flagship control. V2 scales that to hundreds of agents via a supervisor → manager → worker hierarchy while keeping one operator effective and every irreversible action approval-gated.

## Decisions

1. Trust before scale: auth + scoped tokens (ARCH A9, PM-1) is the release gate for every later milestone. No new surface ships without it.
2. Correctness before scale: leased sharded scheduler (ARCH A2) and arg-bound approvals (PM-3) precede any scale test.
3. Deduplicate overlapping proposals and build once:
   - Inline approve: UI-1 + XD-01 → one `NeedsYouBar`.
   - One home per room: UI-3 + XD-02 → Overview-as-home, rails start empty.
   - Demo/offline shell: UI-2 + XD-03 + XD-04 → error boundaries first, then demo pill + snapshot reads.
   - Mobile: UI-5 + XD-05 → one responsive shell track.
   - Visual pass: UI-6 + XD-10 → one token pass, applied whole or not at all.
   - Data-defined rooms: PM-5 + ARCH A6 → policy registry.
   - Scheduler: PM-7 + ARCH A2 → leased scheduler.
   - Cost ledger: PM-4 + ARCH A10 → quote/settle true-up.
4. Priority tensions resolved: scheduler treated as P0 (ARCH-A2 wins over PM-7 P1) because double-step is a correctness bug; cost true-up stays P0-conditional on thesis week; mobile stays P1 unless a mobile launch is claimed.

## Phased plan

- Phase 1 — Desk survives contact (frontend resilience, no backend change):
  - 1A: per-window error boundaries + crash-safe desktop restore + null-honest feed reads (XD-04/UI-02 slice). Depends on: nothing. Parallel-safe: yes (web-only).
  - 1B: demo-mode pill + fetch deadlines + titled empty states (XD-03/UI-02 slice). Depends on: 1A. Parallel-safe: yes after 1A (different files: MenuBar/api vs App).
- Phase 2 — Decide at the evidence (needs-you):
  - 2A: `NeedsYouBar` inline approve on card/rail/manager row (UI-1/XD-01). Depends on: PM-3 arg-bound approvals (backend) for integrity.
  - 2B: arg-bound approvals + approval regression tests (PM-3). Depends on: nothing backend. Parallel with 2A layout work, joint QA on decide path.
- Phase 3 — Trust gate + scale spine (backend):
  - 3A: auth + scoped API tokens + CORS allowlist (ARCH A9/PM-1). Release gate. Depends on: Phase 2.
  - 3B: leased sharded scheduler + double-step regression test (ARCH A2/PM-7). Depends on: 3A for multi-server story; testable single-process first.
  - 3C: pooled DB identity + scope attenuation (ARCH A4/A3). Depends on: 3A.
  - 3D: escalation lattice (ARCH A5) + approvals triage SLA/batching (PM-9). Depends on: 3A, 2B.
- Phase 4 — Platform + money:
  - 4A: policy registry / declarative policies (PM-5/ARCH A6). Depends on: 3A.
  - 4B: cost ledger true-up + hierarchical budgets (PM-4/ARCH A10). Depends on: operating-week data (PM-2).
  - 4C: per-team workspaces + advisory locks (ARCH A8/PM-6). Depends on: 3B.
  - 4D: event partitioning + snapshots (ARCH A7). Depends on: measured volume.
- Phase 5 — Reach: mobile shell (UI-5/XD-05), visual-system pass (UI-6/XD-10), away-strip + Work history (UI-8), ghost preview (UI-9), keyboard sheet (UI-10), cross-room handoff (PM-10), observability views (PM-11).

Parallel tracks: 1A‖1B(file-split) after 1A lands; 2A-layout‖2B-backend with joint QA; 3B‖3C after 3A; 4A‖4B‖4C after Phase 3.

## Conventions

- Logging: each phase lands as its own commit on `V2-features` with `Phase <n><letter>: <what> (<proposal ids>)`.
- Docs: proposal files stay frozen as input; this plan is the only sequencing authority; per-phase notes append under `## Revisions`.
- QA: web `npm -w web run build` for frontend phases; server suites requiring Postgres noted explicitly; new regression tests ride with the fix.

## Revisions

- 2026-10-26: Phase 1A implemented (per-window error boundary + poisoned-window restore guard + null-honest list reads).
- 2026-10-26: Phase 1B implemented (demo-mode pill on offline snapshot, 5s fetch deadline in get/post, titled empty states + Retry in AgentApp/RoomApp/ListView; AgentApp null-runner crash fixed as found in browser QA). Verified in headless Chromium with screenshots.
- 2026-10-26: Blocker recorded — no Postgres server or Docker daemon in this environment, so server suites (all DB-backed) cannot run here. Backend phases 2B/3/4 are specified with file:line targets below but stay unimplemented until a DB-backed QA lane exists; no unverified backend surgery ships on this branch.
