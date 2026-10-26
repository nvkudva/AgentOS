# AgentOS V2 — PM Proposals

Owner: Product Manager. Sources inspected: `README.md`, `prd.md`, `REVIEW.md`, `package.json`, `docs/` (EXPERIENCE-PLAN, QA-FLOWS, UX-REVIEW), `web/`, `server/src`, `server/test`, `server/scripts`.
Status of V1 (per README/PRD): milestones 1–6 + runtime room creation built; milestone 7 (real operating week, thesis verdict) unmeasured; no auth; no CI; server has no typecheck; tests are integration-only requiring a hand-seeded Postgres.

## Proposal 1 — Close the P0 trust gap: auth + room credential hygiene (P0)
- **Problem:** Every `/api/*` route is unauthenticated with `access-control-allow-origin: *` (`server/src/index.ts`), and room DB roles use password = role name (`server/src/provision.ts:114`). Anyone reaching the port can approve high-blast actions, raise budgets, and rewrite approval policy. V2 cannot have external users, a hosted demo with a live backend, or multi-device operators until this is fixed.
- **User value:** Solo operator can expose the desktop beyond localhost without handing every visitor the approval queue and budget controls.
- **Metric:** Zero unauthenticated mutating API calls in a security probe; room-role credential entropy ≥ 128 bits; pass on `server/test/scope.test.ts` + new auth tests.
- **Priority:** P0

## Proposal 2 — Run the operating week and decide the thesis (P0)
- **Problem:** The core thesis (desktop beats chat list: 2× faster glance, lower blocked-agent latency, fewer >30-min escalations) has kill criteria in `prd.md` §1a but `npm run report:thesis` has no data — milestone 7 never ran. All V2 UX resourcing is guesswork until measured.
- **User value:** Operator learns whether to double down on the spatial desktop or pivot to Activity feed; kills roadmap waste.
- **Metric:** One real operating week logged to `observation_log`; verdict printed by `report:thesis` against all 4 kill criteria; README updated with result.
- **Priority:** P0

## Proposal 3 — Fix approval integrity: arg-bound approvals (P0)
- **Problem:** `stable()` replacer-array bug strips nested args before approval comparison, and pending-approval lookup keys on `(run_id, tool)` only (`server/src/runtime/toolbelt.ts:9,58`). Operator can approve the text of call A while call B resumes — an integrity failure in the system's flagship control.
- **User value:** Every approval card describes exactly the action that executes; high-blast trust (PRs, ticket replies) becomes defensible.
- **Metric:** Zero mismatched approval→execution pairs in replay audit; new regression tests with nested-arg tools pass.
- **Priority:** P0

## Proposal 4 — Real money accounting: true-up cost model (P0)
- **Problem:** Cost model is estimate-only: `toolbelt.ts:81-83` charges hard-coded constants, no true-up exists despite `runtime/types.ts:39` promising one. Budgets are call counters, so spend caps and "agent hours" mislead the operator.
- **User value:** Budget halts and spend views reflect reality; operator can set per-room caps with confidence.
- **Metric:** Ledger cents reconcile with measured cost within ±5% on sampled runs; `server/test/budget.test.ts` extended with true-up cases green.
- **Priority:** P0 (P1 if thesis week shows budgets rarely bind)

## Proposal 5 — Make rooms truly data-defined: policy registry (P1)
- **Problem:** `provision.ts:84` refuses rooms whose policies need ungranted tools, and policies live in `policies/index.ts` code — new *kinds* of work need a code change + redeploy. "A room is a form, not a deploy" holds only for recombinations of 9 policies (per REVIEW.md).
- **User value:** Operator creates genuinely new functions (legal, recruiting, research) from Settings without engineering help.
- **Metric:** Time-to-new-room-kind without deploy: <10 min via form; `newroom.test.ts` covers a custom-policy room.
- **Priority:** P1

## Proposal 6 — Concurrent engineering without corruption: workspace isolation (P1)
- **Problem:** `repo.patch` uses one shared git tree (`git checkout -B`, `git add -A`, force-push with no timeout); two engineering agents interleave branches and commit each other's files (REVIEW.md).
- **User value:** Multiple engineering agents can work in parallel without corrupting PRs.
- **Metric:** Zero cross-branch file leaks in a 2-agent concurrent patch test; git ops time-bounded (timeout) with scheduler slot released on hang.
- **Priority:** P1

## Proposal 7 — Multi-process-safe scheduler + bounded step cost (P1)
- **Problem:** Scheduler is single-process (`inflight` Set, 400 ms poll, ~8+ queries/step/agent); two servers double-step agents; no lease, no batching (REVIEW.md). Caps concurrent-agent scale and hosted deployment.
- **User value:** Operator can run 20+ agents and (later) redundant servers without double-execution or tick collapse.
- **Metric:** 20 concurrent working agents at 400 ms tick with p95 step latency < 2 s; two-server run shows zero double-steps (lease via `FOR UPDATE SKIP LOCKED`).
- **Priority:** P1

## Proposal 8 — CI + hermetic tests + server typecheck (P1)
- **Problem:** No CI; 4 suites need a hand-migrated/seeded Postgres; no coverage of `api.ts:handle`/`decide()` or web; server has no tsconfig/typecheck so types are documentation (README + REVIEW.md).
- **User value:** Contributors land changes without "works on my seeded DB"; regressions in approvals/decide caught before the operator's money is at stake.
- **Metric:** `npm test` bootstraps its own schema+seed and passes from clean checkout; CI green on every push; `tsc --noEmit` clean for server and web.
- **Priority:** P1

## Proposal 9 — Approvals triage that scales: SLA, batching, delegation rules (P1)
- **Problem:** Queue is one hand-ordered list (most-expensive-first) with per-card j/k/a/r keys and 8-s undo. At 20 agents the operator faces approval storms with no SLA surfacing, no batch approve of similars, no per-room auto-rules below `high`.
- **User value:** Operator clears storms in minutes; nothing >30 min sits unseen (ties directly to kill criterion #3).
- **Metric:** Median blocked→opened latency down vs. V1 baseline; zero escalations >30 min unseen in operating week; approval actions/operator-hour up.
- **Priority:** P1

## Proposal 10 — Cross-room handoff without breaking scope (P2)
- **Problem:** V1 default (D3) is artifact-store-only, no messaging; strategy↔analytics questions show up as silent blocks. PRD says persistent blocking is the signal for v2 messaging.
- **User value:** Rooms can request data/compute from each other through logged, revocable, scope-checked handoffs instead of operator copy-paste.
- **Metric:** Cross-room request fulfilled without `ScopeViolation` bypass; every handoff logged + replayable; blocked-time for strategy agents down.
- **Priority:** P2

## Proposal 11 — Operator observability: spend, replay, and incident views (P2)
- **Problem:** Spend reads as "agent hours" but ledger is estimate-only; `decide()` is non-transactional (6 statements, crash leaves approved-but-unresumed runs); SSE fans out full `/api/state` per refresh with no cap. Operator cannot answer "what did it spend, what broke, what resumed."
- **User value:** One Spending + History view the operator trusts; incidents (killed/loop/capped) explain themselves in plain language.
- **Metric:** 100% of killed/capped runs carry a plain-language reason visible in-room; `decide()` crash test leaves zero orphaned approvals.
- **Priority:** P2

## Top-5 by value
1. Close the P0 trust gap: auth + room credential hygiene — unlocks every external/hosted/multi-device future; without it V2 cannot ship to anyone.
2. Run the operating week and decide the thesis — the only finding that tells us whether the desktop (all other UX spend) is worth it.
3. Fix approval integrity: arg-bound approvals — the flagship control must describe what it executes or nothing else is trustworthy.
4. Real money accounting: true-up cost model — budgets and "agent hours" become real constraints the operator can steer by.
5. Make rooms truly data-defined: policy registry — turns the room model from demo set into a platform the operator extends alone.
