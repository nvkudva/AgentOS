# Atrium — PRD v1

A game-style operations floor for running a company staffed by AI agents.
One human operator. Many concurrent agents. Rooms are permission scopes, not decoration.

Status: draft, milestone 1–6 in build. Owner: solo operator (nvkudva@gmail.com).

---

## 1. Thesis

**For a solo operator running many concurrent agents, a spatial floor plan beats a chat list.**

Chat forces serial attention: one thread at a time, history scrolls away, and "is anything
stuck?" costs a scan of N conversations. A floor plan gives constant peripheral awareness —
what runs, what blocks, what needs the human — in one glance.

### How we kill it

The thesis is falsifiable or it is decoration. Atrium ships **two views over one backend**:

| View | Route | What it is |
|---|---|---|
| Floor | `/` | Spatial grid of room widgets, agents inside |
| List | `/list` | Chat-list control: flat feed of agent threads, newest first |

Same data, same events, same inbox. We measure the operator on both.

**Kill criteria — the floor plan loses if, over a real operating week:**

1. **Glance test.** Median time to correctly answer "does anything need me right now?"
   is not at least **2× faster** on Floor than on List.
2. **Blocked-agent latency.** Median time from an agent entering `blocked` to the operator
   opening it is not lower on Floor.
3. **Missed escalations.** Floor does not reduce the count of escalations sitting >30 min.
4. **Actual usage.** The operator drifts back to List for real work despite Floor being default.

If any two of those fail, the README says the chat list won. That is a finding, not a failure.

### Instrumentation (built, not retrofitted)

Every view records to `observation_log`: view mode, dwell time, click target, and for
glance tests, the prompt/answer/latency triple. `npm run report:thesis` prints the table.

---

## 2. Core design decision — rooms are scopes

A room is not a container for widgets. A room is a **capability boundary**. It owns:

| Room owns | Enforced by |
|---|---|
| **Objective** | agent prompts are room-scoped; agents cannot be assigned cross-room goals |
| **Tools** | `room.tool_grants` — the toolbelt handed to an agent is built from its room, per call |
| **Budget** | `room.budget_cents` + global cap; debits are transactional with the tool call |
| **Memory** | `artifact` and `memory` rows carry `room_id`; queries are room-filtered at the DAL |
| **Escalation policy** | `room.approval_policy` — what blast radius may run unattended |
| **Data** | analytics room's DB role differs from engineering's; scoping is at the credential |

**The engineering room cannot spend the marketing room's budget or read its data.**
Not by convention — by the runtime refusing. Cross-room access raises `ScopeViolation`,
logs an event, and fails the step. There is a test suite (`test/scope.test.ts`) whose whole
job is to try the violations and assert they fail.

This is what makes the metaphor earn its place. If rooms were only visual grouping, a
chat list with tags would be strictly better and we should ship that instead.

### Rooms in v1

| Room | Objective | Real work | Tools | Blast radius |
|---|---|---|---|---|
| **analytics** | answer questions from company data | queries a real Postgres | `sql.query` (read-only role), `artifact.write` | low |
| **engineering** | ship small changes | opens a **real** GitHub PR | `repo.read`, `repo.patch`, `github.pr.open` | **high — always approval** |
| **marketing** | draft posts | writes into a **real** content queue | `queue.draft`, `artifact.write` | medium |
| **sales** | pipeline hygiene | reads/annotates CRM tables in Postgres | `sql.query`, `crm.note` | medium |
| **strategy** | synthesize across artifacts | reads the shared artifact store | `artifact.read`, `artifact.write` | low |

Sales and strategy are real but thin in v1. Analytics, engineering, marketing are the
three wired to genuine external effects, per the "make it real" requirement.

---

## 3. Data model

```
room(id, key, name, objective, x, y, w, h,
     budget_cents, spent_cents, tool_grants jsonb, approval_policy jsonb,
     db_role, status)                      -- status: open | halted | capped

agent(id, room_id, name, role, policy_key, state, activity, current_run_id,
      step_budget, cost_budget_cents, steps_used, spent_cents, created_at)
      -- state: idle | working | blocked | awaiting_approval | failed | killed

run(id, agent_id, room_id, goal, status, started_at, ended_at,
    steps_used, spent_cents, kill_reason)

event(id bigserial, ts, room_id, agent_id, run_id, seq, type, payload jsonb)
      -- append-only. THE source of truth. All state is a fold over this.

approval(id, room_id, agent_id, run_id, action, args jsonb, blast_radius,
         est_cost_cents, touches jsonb, state, created_at, decided_at, decided_note)
         -- state: pending | approved | rejected | expired

artifact(id, room_id, run_id, kind, title, body, uri, created_at)
memory(id, room_id, key, value jsonb, updated_at)
ledger(id, room_id, agent_id, run_id, cents, reason, ts)
observation_log(id, ts, view, action, payload jsonb)
content_queue(id, room_id, channel, title, body, state, scheduled_for)  -- marketing's real queue
```

**Event sourcing is a hard requirement, not a style choice.** `event` is append-only.
Room and agent tables are a materialized projection, rebuildable with
`npm run replay` — which drops projections and re-folds the log. Replay is tested:
`test/replay.test.ts` asserts fold(log) == live state after a randomized run.

---

## 4. The UI

### Floor (default view)

- A DOM grid of **room widgets**, absolutely positioned from `room.x/y/w/h`.
- Rendering target: **30 live widgets at 60fps**. Decision recorded in §7.
- Inside each widget: room name, objective, spend bar (spent/budget), status pill, and a
  row of **agent avatars**. Each avatar shows:
  - state by colour + shape: `idle` grey, `working` blue pulse, `blocked` amber,
    `awaiting_approval` violet, `failed` red, `killed` black
  - a **live one-line activity string** — the current step in plain words
    ("querying orders table", "waiting on approval to open PR #1284")
- **Calm is the signal.** No motion, no colour = nothing needs you. That judgment must be
  possible in **one second** without reading text. Colour and motion are reserved for
  states that need a human; `working` uses a slow low-contrast pulse, not an alarm.
- Click a room → **room detail**: full transcript, artifacts, logs, spend ledger, replay.

### Inbox strip (permanent, bottom)

The only thing that requires the human. Approvals and escalations.
**Sorted oldest and most expensive first** — `ORDER BY est_cost_cents DESC, created_at ASC`,
so cheap and new never buries expensive and old.

Each **approval card states, always:**
1. the **action** in plain words,
2. the **cost** (estimated cents, and the run's spend so far),
3. **what it touches** — repo + branch, table names, external endpoint, queue.

Approve / Reject / Approve-and-remember-for-this-room. Rejection requires no note; approval
of `high` blast radius does.

### List (control view)

Flat reverse-chronological feed of agent activity, one line per event, threads collapsible.
Deliberately a decent chat list, not a strawman. Same inbox strip.

---

## 5. Hard requirements

| # | Requirement | Implementation |
|---|---|---|
| R1 | Every agent action logged and replayable | append-only `event`; `npm run replay` rebuilds all state; tested |
| R2 | Nothing irreversible without approval | tools declare `reversible: false`; toolbelt refuses to execute one without an `approval` row in state `approved`; card states action, cost, touches |
| R3 | Per-room and global spend caps that **halt**, not overrun | cost debited in the same transaction as the tool call; over cap → room `capped`, agents suspended, work stops. Estimate charged before the call, trued up after |
| R4 | Loop-stuck agents killed by budget, not by noticing | every run carries `step_budget` and `cost_budget_cents`; the scheduler kills on breach and on a repeat-signature detector (same tool+args 3× → `killed`, reason `loop_detected`) |
| R5 | Full state survives refresh | agents run **server-side** in the Node runtime; the browser holds no agent state; refresh replays the projection and resubscribes. UI is a view |

---

## 6. Milestones

1. **Data model + scoped permissions** — schema, DAL, `ScopeViolation`, scope test suite.
2. **One room, one real agent** — analytics agent queries the real Postgres end to end.
3. **Live state streaming** — SSE from the event bus; floor renders from it.
4. **Approval + escalation inbox** — cards with action/cost/touches; decisions gate tools.
5. **Budgets and kill switches** — caps halt; step/cost/loop kills; global panic stop.
6. **Three rooms doing real work concurrently** — analytics + engineering PR + marketing queue.
7. **Run a real week through it** — collect `observation_log`, write the verdict in README.

---

## 7. Open decisions

Raised before coding, as asked. No human was reachable when the build started, so each has
a **recommendation taken as the working default** — all three are reversible and marked in
code with `DECISION:` comments.

### D1 — Build the agent runtime, or wrap an existing orchestrator?

**Default taken: build a thin runtime.** ~400 lines: a step loop, a toolbelt, a budget
meter, a kill check. The whole product claim is about *scoping and interruption* — budgets,
approvals, kills, replay. Every existing orchestrator (LangGraph, CrewAI, the Agents SDK)
owns exactly that layer and would have to be fought to enforce a per-room budget mid-step.
The reasoning inside a step is pluggable: `LlmDriver` is an interface, so an orchestrator
can be dropped in per room later without touching the scope layer.

*Cost of being wrong:* we rewrite the step loop, keep the schema. Cheap.

### D2 — How much autonomy before approval?

**Default taken: gate on blast radius, not on a fixed rule.** Every tool declares
`{reversible, external, blast_radius}`. Policy per room:

| Blast radius | Meaning | Default |
|---|---|---|
| `low` | reversible, internal, no external write | run unattended |
| `medium` | reversible but externally visible (a draft in a queue) | run unattended, notify in inbox |
| `high` | irreversible or externally published (a PR, an email, a spend >$1) | **always approve** |

The operator can raise autonomy per room ("approve-and-remember"), never lower `high`
below approval in v1. Budget breach overrides autonomy in all cases.

### D3 — Cross-room messaging in v1, or is a shared artifact store enough?

**Default taken: artifact store only, no messaging.** Direct agent-to-agent messaging is
explicitly out of scope, and it is the fastest way to dissolve the room boundary that the
whole design rests on. Rooms publish artifacts; other rooms read them through an explicit
`artifact.read` grant, which is logged and revocable. If strategy genuinely cannot work
without asking analytics a question, that is evidence for messaging in v2 — and it will
show up as strategy agents blocking, which the floor plan should make obvious. Good test.

---

## 8. Out of scope for v1

Multi-human teams. Agent-to-agent negotiation. A marketplace. Mobile. Isometric art or
animation polish. Anything decorative that does not carry state.

---

## 9. Known constraints in the build environment

- **No LLM API key is present.** Agent *reasoning* therefore runs on `ScriptedDriver`:
  deterministic policies that choose real tools and do real work. The tools, the data, the
  PR, the queue rows and the money accounting are genuine; the choice of next step is
  programmed rather than inferred. `LlmDriver` is the same interface — set `ANTHROPIC_API_KEY`
  and flip `AGENT_DRIVER=llm` to swap it. This is stated plainly rather than hidden, because
  a pretty dashboard over fake agents proves nothing, and so does a pretty runtime over a
  fake claim about what is doing the thinking.
