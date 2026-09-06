# Atrium — PRD v1

**An operating system for a company staffed by AI agents.**
One human operator. Many rooms, one per business function. Several agents in every room.
Rooms are permission scopes, not decoration.

Status: draft, milestones 1–6 built. Owner: solo operator (nvkudva@gmail.com).

---

## 1. What Atrium is

A desktop OS whose applications are your company's functions.

- **Rooms are the units of the system.** Analytics, engineering, marketing, sales, strategy —
  and any function you add later: finance, support, legal, recruiting, research. A room owns
  an objective, a budget, a set of tools, a memory, a database identity and an escalation
  policy. It is a scope before it is a screen.
- **Every room is staffed by several agents**, each with a name, a role, a persona and its
  own step and cost budget. Agents are the workers; rooms are the departments they work in.
- **The shell is an operating system**, not a dashboard: room panels dock to the screen
  edges, work opens in windows on a stage, a dock holds apps and rooms, a supervisor orb
  takes spoken instructions, and one queue holds everything that needs a human.

**The only thing inherited from games is the face.** Each agent is a **circular persona
avatar** — an emoji face on its own colour, with a state ring that breathes while it works.
That single affordance is what makes twenty concurrent agents legible as *people doing
things* rather than rows in a table. There is no board, no map, no isometric art, no score,
no animation beyond that ring. Everything else is Mac-grade application UI.

## 1a. Thesis

**For a solo operator running many concurrent agents, an operating system beats a chat list.**

Chat forces serial attention: one thread at a time, history scrolls away, and "is anything
stuck?" costs a scan of N conversations. An OS gives scoped workspaces, parallel windows,
peripheral awareness of every room at once, and one place where decisions queue up.

### How we kill it

The thesis is falsifiable or it is decoration. Atrium ships **two surfaces over one backend**:

| Surface | What it is |
|---|---|
| **The desktop** | rooms docked at the edges, work in windows, approvals in one queue |
| **Activity** | chat-list control: a flat feed of agent threads, newest first |

Same data, same events, same approvals queue. We measure the operator on both.

**Kill criteria — the OS loses if, over a real operating week:**

1. **Glance test.** Median time to correctly answer "does anything need me right now?"
   is not at least **2× faster** on the desktop than in Activity.
2. **Blocked-agent latency.** Median time from an agent entering `blocked` to the operator
   opening it is not lower on the desktop.
3. **Missed escalations.** The desktop does not reduce the count of escalations sitting
   >30 min.
4. **Actual usage.** The operator drifts back to Activity for real work despite the desktop
   being default.

If any two of those fail, the README says the chat list won. That is a finding, not a failure.

### Instrumentation (built, not retrofitted)

Every surface records to `observation_log`: which view, dwell time, what was clicked, and for
glance tests the prompt/answer/latency triple. `npm run report:thesis` prints the table and
evaluates the criteria above.

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

### Rooms shipped in v1

Five functions, each staffed by two agents. The set is a starting point, not the model —
adding a room is a row plus a tool grant plus a database role.

| Room | Objective | Real work | Tools | Blast radius |
|---|---|---|---|---|
| **analytics** | answer questions from company data | queries a real Postgres | `sql.query` (read-only role), `artifact.write` | low |
| **engineering** | ship small changes | opens a **real** GitHub PR | `repo.read`, `repo.patch`, `github.pr.open` | **high — always approval** |
| **marketing** | draft posts | writes into a **real** content queue | `queue.draft`, `artifact.write` | medium |
| **sales** | pipeline hygiene | reads/annotates CRM tables in Postgres | `sql.query`, `crm.note` | medium |
| **strategy** | synthesize across artifacts | reads the shared artifact store | `artifact.read`, `artifact.write` | low |

Analytics, engineering and marketing are wired to genuine external effects; sales and
strategy are real but narrower. **A new room is three things**: a row in `room` with its
tool grants and budget, a Postgres role with exactly the grants that room should have, and
one or more agents pointed at a policy. Nothing in the shell is per-room code.

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

## 4. The UI — an operating system

Atrium is a desktop OS, because that is what running a company of agents is: many things
alive at once, one of them in front of you, the rest parked where you left them.

```
┌───────────────────────────────────────────────────────────────────┐
│ ◍ Atrium  Overview Activity Settings Glance  ◉orb  fps $ 🌙 🔔 Stop│  menu bar
├──────────┬──────────────────────────────────────────┬─────────────┤
│ Analytics│                                          │ Sales       │
│  Ada Bo  │                                          │  Sam        │
├──────────┤          THE STAGE                       ├─────────────┤
│ Engineer │   agent workspaces · room consoles       │ Strategy    │
│  Kit Rex │   the overview · the activity feed       │  Iris       │
├──────────┤   free-floating, dragged, resized        │             │
│ Marketing│                                          │        ┌──┐ │
│  Mel     │                                          │        │◇ │ │ tucked
├──────────┴──────────────────────────────────────────┴─────────────┤
│              🗺️ 📜 📥 ⚙️ │ ◈ ⌘ ✎ ◎ ◇ │ 🔭 🔧          dock        │
└───────────────────────────────────────────────────────────────────┘
```

### Rooms are windows

A room is not furniture bolted to a rail. It is a **window** — draggable anywhere on the
desktop, resizable, closable, relaunchable from the dock. What makes rooms special is that
**only rooms snap**:

| Drop it | What happens |
|---|---|
| Left or right edge | joins that edge's **lane**; the lane's rooms split its height, so three rooms on the left read as a rail |
| Top or bottom edge | joins a full-width **strip**; rooms in a strip lay their crew out horizontally |
| Any corner | **tucks away**: 90% slides off screen, a 10% handle stays behind, carrying the room's colour and icon. Click it to bring the room back |
| Anywhere else | stays floating, like any other window |

App windows — agent workspaces, room consoles, the overview, the activity feed — never
snap. They float. The distinction is deliberate: rooms are the furniture of the workspace
and want to live at the edges; the work itself belongs in the middle.

A docked edge is a **column of room cards**, not a grouped panel: each room is its own
surface with its own rounded edge, no wrapper and no group header, the way widgets sit on a
desktop.

Rooms park themselves on the rails on first boot, so Atrium opens looking arranged rather
than empty. Everything after that is the operator's layout.

### The supervisor orb

A 38px orb in the middle of the menu bar — the visual centre of the app. It is a layered
sphere, not a disc: two counter-rotating plasma fields under spherical shading, a glass dome
highlight and a rim light, wrapped in a canvas ring of 36 bars. **While it listens those bars
are driven by the actual microphone** through an `AnalyserNode`, so the ring is the operator's
own voice rather than a loop; without mic access it falls back to three offset sines. At rest
it is completely still and the ring collapses to a hairline — motion on the orb means the
assistant is doing something, never decoration. It watches the
company and takes instructions, **spoken** where the browser will listen (continuous
recognition, wake word "Atrium") and **typed** where it will not (⌘K). Its ring is a status
light of its own: quiet when calm, violet when something needs a human, green while
listening.

Its panel is not a window. It grows out of the orb — same glass, top edge tucked under the
orb's centre, scaled up from the orb as its transform origin — and holds exactly three
things: **the last instruction**, **what you are saying right now**, and **five bars that
move while it listens**. Nothing else. Anything more and it stops being an assistant and
becomes another window to manage.

It can run and stop agents, open rooms and teammates, switch theme, show the sidebar, and
answer *"what needs me?"* out loud. **It cannot approve anything.** Speech recognition is
the wrong place for an irreversible decision, so "approve the PR" surfaces the card and
waits for a click — R2 holds even when the operator is talking rather than clicking.

The brain is deterministic in v1 (see §9): a half-parsed sentence must never become an
action nobody asked for. `LlmDriver` replaces it the moment a key exists.

### Chrome

Nothing on screen is styled twice. One scale governs the whole app:

| Tier | Radius | Where |
|---|---|---|
| Shell | 26px | dock, docked rail, supervisor panel, slide-over |
| Window | 18px | floating windows |
| Card | 12px | approval cards, room tiles, dock icons, folded steps |
| Control | 9px | buttons, inputs |
| Pill | full | chips, tags, badges, segmented controls |

Type is **Google Sans**, self-hosted rather than linked, so the interface reads identically
offline and on a machine with no Apple or Google fonts installed — falling through to the
system stack was what made it look like a Linux desktop. Numerals are tabular, tracking is
slightly tight, and nothing is monospace.

Spacing is 4-point throughout; elevation is four tokens, not one. Glass is one recipe —
sheen gradient, 62% tint, `blur(28px) saturate(180%)`, a half-pixel light-catching rim and
an inner top specular — spent on exactly four surfaces, because each one is a full-viewport
readback.

- **Menu bar** — apps, the glance test, the orb, spend against the global cap, theme, the
  notification bell, **Stop all**.
- **Docked rail** — inset 8px from the screen edge so it reads as a floating popover, not a
  welded sidebar. One header, one close button, no traffic lights.
- **Sidebar** — approvals as a slide-over that floats above the desktop and closes to
  nothing. Ordered most expensive first, then oldest.
- **Dock** — a floating slab: apps, then every room, then open conversations. 48px tiles,
  magnified on hover, running dots, a badge for pending approvals.
- **Wallpaper** — a generated landscape whose every colour is a theme token.
- **Agent avatars** — the one game-derived element: a coloured disc, an emoji face, a state
  ring. Used identically in the room cards, the dock, the approvals queue and the agent's
  own window, so the same person is recognisable everywhere.

### Windows people can actually read

The operator is an office worker running a team of agents, not an engineer reading a log.
Nothing in the interface says `tool.call`, `sql.query`, `blast_radius: high`, `240ms` or
`3¢`. One module owns the translation:

| The system knows | The person reads |
|---|---|
| `sql.query · touches bizdata.orders · 1¢` | "Looked something up in the company database" |
| `tool.result ok in 25ms · 6 rows` | "Found 6 records" |
| `scope.violation sql.query` | "Stopped — Kit isn't allowed to touch the company database" |
| `agent.killed loop_detected` | "Stopped — it was going in circles" |
| `blast_radius: high` | "Leaves the company" |
| `est_cost_cents: 10` | "costs $0.10" |
| an approval's raw action string | "**Kit wants to open a pull request**", detail underneath |

An agent's window reads as a message thread: what the agent said, and beneath it a single
folded line — "2 steps" — that opens into sentences. Room windows are ordinary apps with
tabs called **Activity, Files, Spending, History, Permissions**. Monospace appears nowhere.

### Themes and honesty about frames

Light, dark and auto, on `data-theme`. Both are first-class; neither is a filter over the
other.

Effects cost frames. A full-width `backdrop-filter` is free on a GPU and halves the frame
rate in software rendering; so does a rotating gradient inside a clipped circle. Atrium
therefore **watches its own frame rate for as long as it runs** — not once at boot — and
trades effects for frames whenever it starts to struggle: glass becomes flat surfaces, the
orb's core stops turning, and both come back with hysteresis once the machine recovers.
macOS calls this Reduce Transparency; Settings exposes it as auto / glass / lite.

### Calm is still the signal

If the rails are grey and the sidebar says *Calm*, nothing needs you. Motion is rationed:
the orb only spins while listening or alerting, and an agent avatar only pulses while it
works. Being able to tell in one second whether you are needed is still the whole goal.

**Activity** remains the chat-list control view, kept deliberately decent, so the spatial
claim can still be measured against it (§1).

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
3. **Live state streaming** — SSE from the event bus; the desktop renders from it.
4. **Approval + escalation inbox** — cards with action/cost/touches; decisions gate tools.
5. **Budgets and kill switches** — caps halt; step/cost/loop kills; global panic stop.
6. **Three rooms doing real work concurrently** — analytics + engineering PR + marketing queue.
7. **Run a real week through it** — collect `observation_log`, write the verdict in README.
8. **Add a sixth room without touching the shell** — the test of whether "room" is really the
   unit of the system, or just five hard-coded panels wearing a costume.

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
show up as strategy agents blocking, which the desktop should make obvious. Good test.

---

## 8. Out of scope for v1

Multi-human teams. Agent-to-agent negotiation. A marketplace. Mobile. Any game surface
beyond the circular persona avatar — no board, no map, no isometric art, no score, no
animation that is not a state. Anything decorative that does not carry state.

---

## 9. Known constraints in the build environment

- **No LLM API key is present.** Agent *reasoning* therefore runs on `ScriptedDriver`:
  deterministic policies that choose real tools and do real work. The tools, the data, the
  PR, the queue rows and the money accounting are genuine; the choice of next step is
  programmed rather than inferred. `LlmDriver` is the same interface — set `ANTHROPIC_API_KEY`
  and flip `AGENT_DRIVER=llm` to swap it. This is stated plainly rather than hidden, because
  a pretty dashboard over fake agents proves nothing, and so does a pretty runtime over a
  fake claim about what is doing the thinking.
