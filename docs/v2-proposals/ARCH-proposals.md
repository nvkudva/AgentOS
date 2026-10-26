# AgentOS V2 — Architecture Proposals (ARCH)

Role: Architect for AgentOS V2 — supervisor hierarchies managing hundreds of agents, teams with managers, supervisor agent.
Basis: inspected `README.md`, `prd.md`, `REVIEW.md`, `package.json`, `server/`, `db/`, `scripts/`, `workspace/`.

## Where V1 stands (grounding)

- V1 is a single-operator, single-process system: bare `http.createServer` (`server/src/index.ts`), if-chain API (`server/src/api.ts`), 400ms poll scheduler with in-memory `inflight` set (`server/src/runtime/scheduler.ts`), one gate `callTool` (`server/src/runtime/toolbelt.ts`), Postgres as the only state with append-only `event` + replay fold (`server/src/replay.ts`).
- Rooms are data (`server/src/provision.ts:provisionRoom`), agents run hand-written policy step arrays (`server/src/policies/index.ts`), manager tier exists only as `agent.tier` + `mandate`/`task` tables (`db/migrations/006_mandate.sql`) with `assign`/`report` tools. No supervisor-of-supervisors, no teams table, no sharding, no auth.
- Known V1 caps that V2 must remove: single-process scheduler (double-step on 2 processes), ~8 queries/step/agent (linear cost), unbounded `rolePool` per room, one shared git tree with no locking, unauthenticated API + `access-control-allow-origin: *`, role passwords equal to role names, non-transactional `decide()` and `provisionRoom`, no migrations version table, no CI, no server typecheck.

## Proposal A1 — Hierarchical supervisor tree (supervisor → managers → workers)

Design: add `team(id, parent_team_id, manager_agent_id, room_id, objective, budget_cents, spent_cents)` table; `agent.tier ∈ {supervisor, manager, worker}`; mandates decompose recursively (supervisor mandate → team mandates → tasks). Supervisor policy routes/delegates via `assign` (already exists in `server/src/tools/assign.ts` + `pump`), managers own `task` rows, workers own `run` rows. Span of control cap (e.g. ≤8 direct reports) enforced in `provisionTeam`.
Trade-offs: + matches prd §2 room-as-scope model, reuses mandate/task chain of custody; + small schema delta. − naive recursion amplifies scheduler load (each level ticks); − needs deadlock/escalation rules (see A5).
Priority: **P0** (V2 is defined by this; without it there is no "hundreds of agents" story).

## Proposal A2 — Leased, sharded scheduler (many runners, one DB)

Design: replace in-memory `inflight` Set with `SELECT ... FOR UPDATE SKIP LOCKED` lease on `agent` (or a new `agent_lease` table with `owner, expires_at`), N scheduler replicas each claiming a shard (hash on `agent.id`). Keep `ATRIUM_TICK_MS` per-shard jitter. `npm test` gains a two-scheduler double-step regression test.
Trade-offs: + removes REVIEW P2 double-step bug; + horizontal scale to hundreds of agents. − leases add write per tick; − fencing (stale owner steps after lease loss) needs run-epoch check in `callTool`.
Priority: **P0** (scale + correctness prerequisite for everything below).

## Proposal A3 — Scope inheritance with attenuation (teams inherit room grants, never widen)

Design: team grants = subset of parent room grants; manager `assign` can only narrow `tool_grants`/`access` profile for children. Enforce in `provisionTeam` + `callTool` (check chain room→team→agent). Cross-team reads go through explicit `artifact.read` grant (extends DECISION D3 artifact-store-only messaging, prd §7).
Trade-offs: + preserves V1's best idea (dual enforcement: `tool_grants` + real PG roles); + makes "hundreds of agents" auditable. − PG role per team reintroduces `rolePool` exhaustion (see A4); − attenuation logic must stay simple or operators will misconfigure.
Priority: **P0** (security model must precede scale; also fixes REVIEW P0 auth context).

## Proposal A4 — Pooled DB identity (stop one-role-per-team)

Design: replace per-room/per-team PG `LOGIN` roles with a small pool of broker roles (e.g. `reader`, `annotator`, `support_desk`) + `SET LOCAL ROLE` / `SET CONSTRAINT` per statement via a checkout wrapper in `server/src/db.ts`; keep `room.tool_grants` as the fine-grained layer. Random per-role passwords in a secret store (fixes REVIEW P0 password==rolename). Cap + LRU-evict pool entries.
Trade-offs: + kills `max_connections` exhaustion and orphan-role drift from non-transactional `provisionRoom`; − slightly weaker per-team DB attribution (compensate with `application_name` + event log); − migration of existing per-room roles needed.
Priority: **P0** (hard blocker at hundreds of agents/teams).

## Proposal A5 — Escalation lattice (bounded, costed, auto-expiring)

Design: generalize `approval` with `escalates_to_team_id`, `ttl`, `auto_policy` (approve-hint, never auto-approve `high` blast radius per D2). Manager can resolve low/medium in its subtree; `high`/cross-team/external always surfaces to the single operator queue. `remember:true` (currently `api.ts:157` rewrites room policy from an unauthenticated call) becomes scoped, expiring, and auditable. Add `escalation.created → decided/expired` events so replay covers them.
Trade-offs: + prevents supervisor-queue collapse under hundreds of agents; + keeps R2 (nothing irreversible without approval). − more states to test; − risk of approval fatigue → mitigate with batching + cost-ordered queue (already the sidebar order).
Priority: **P0** (operator throughput is the V2 thesis bottleneck).

## Proposal A6 — Declarative policies replace step-array code (rooms become data again)

Design: policies move from TS arrays (`server/src/policies/index.ts`) to versioned rows (`policy(key, version, uses, steps jsonb, goal)`) executed by a small interpreter; `provision.ts:84` check becomes a data validation. Add first-class `end_run(status)` result so the `s.__done` burn-a-step hack (REVIEW) disappears. Keep `LlmDriver` interface as one step kind (`reason` step) per prd §9.
Trade-offs: + new *kinds* of work no longer require editing code + redeploy (completes the "room is a form" claim); + versioned policies are replayable. − interpreter is new attack surface (validate + sandbox step args); − migration of 9 existing policies.
Priority: **P1** (unblocks non-engineer room authors; not needed for first scale test).

## Proposal A7 — Event log partitioning + snapshotting (replay must survive 100× events)

Design: partition `event` by month (or hash on `room_id`), add `snapshot(id, room_id/team_id, seq, projection jsonb)` written every N events; `replay.ts:fold()` starts from snapshot + tail. Keep `fold == live` invariant test. Archive cold partitions.
Trade-offs: + replay/seed/CI stay fast at V2 volumes; − partitioning changes migration story (needs the version table from REVIEW P1 first); − snapshot trust requires checksum test.
Priority: **P1** (needed before a "real operating month", not before first 100-agent test).

## Proposal A8 — Per-team workspaces (end the one-shared-git-tree corruption)

Design: `repo.patch` gets per-team clones (or `git worktree`) + advisory lock + `timeout` on every `execFile` (fixes REVIEW P1). Supervisor's redirect carries artifact ids (`mandate.context`, already in 006) across workspaces instead of sharing a tree.
Trade-offs: + removes silent cross-agent file corruption; + enables concurrent engineering teams. − disk/time cost per team (mitigate with shallow/shared-object clones); − PR flow (`github.pr.open --force-with-lease`) needs per-workspace branch naming.
Priority: **P1** (required as soon as ≥2 engineering teams run concurrently).

## Proposal A9 — Auth + scoped API tokens (close the open port before adding surface)

Design: token auth on every `/api/*` (operator token + per-room/per-team scoped tokens for tooling), allowlisted CORS replacing `*`, validation on `/api/budget` (reject negative/NaN) and size/rate caps on `/api/observe`, transactional `decide()`. SSE per-token subscription filter (also stops leaking tool args/customer data to every subscriber — REVIEW secrets note).
Trade-offs: + fixes all three REVIEW P0/P1 security items in one pass; − modest UX cost (login/token bootstrap, PWA token storage); − must not break the frozen demo build (serve demo from a read-only snapshot with no API).
Priority: **P0** — listed after A1–A5 only in build order, but it is a release gate: no V2 milestone ships without it.

## Proposal A10 — Cost ledger with true-up + hierarchical budgets

Design: implement the promised true-up (`types.ts:39`): charge estimate before, refund/charge delta after `spec.run` returns (needs actual-cost hooks per tool, starting with measured `ms` + row counts already logged in `tool.result`). Budgets roll up team→room→global; breach halts subtree only (`haltRoom` generalized to `haltTeam`), supervisor gets a re-budget action. Rename `estimate`→`quote` + `settle` so budgets become spend, not call counters (REVIEW P2).
Trade-offs: + makes "hundreds of agents × real spend" operable; − per-tool cost functions are judgment calls (start with measured + constant blends, document them); − ledger writes add ~1 txn per tool call (batch where possible).
Priority: **P1** (P0-adjacent: run the first scale test on call counters, but don't bill a real month on them).

## Top-5 by leverage

1. A2 — Leased, sharded scheduler: unblocks all horizontal scale; fixes double-step correctness.
2. A3 — Scope inheritance with attenuation: keeps the room-as-scope guarantee at team scale.
3. A5 — Escalation lattice: keeps one operator effective over hundreds of agents.
4. A4 — Pooled DB identity: removes the connection/role ceiling that caps team count.
5. A9 — Auth + scoped API tokens: release gate; every other proposal widens the blast radius of the current open port.
