# Atrium

A floor plan for running a company staffed by AI agents. One human. Many concurrent agents.
Rooms are permission scopes, not decoration.

Spec and reasoning: **[prd.md](./prd.md)**.

```bash
createdb atrium                     # postgres 16
npm install
npm run setup                       # migrate + seed + build the UI
npm run serve                       # http://localhost:8787
npm run agents:start                # wake every agent
npm run status                      # same state, from the terminal
npm test                            # 13 tests: scope, budget, approval, replay
```

---

## Does the spatial view actually beat a chat list?

**Not proven yet, and the honest answer today is "unknown".** Milestone 7 — running a real
operating week through it — has not happened. What exists is the apparatus to settle it,
which was built before the opinion, on purpose.

The app ships **both views over one backend**: `Floor` and `List`. `List` is a real chat
list — threads, live activity, the same inbox — not a strawman. Both record to
`observation_log`. `npm run report:thesis` prints the comparison and evaluates the
pre-registered kill criteria in prd.md §1.

### What a few hours of operating it did show

Weak evidence, n=1, one operator, short sessions. Recorded because it is what there is:

- **The calm signal works.** With seven agents running, two waiting on approval and one
  killed, the floor answers "does anything need me?" without reading a word — only rooms
  needing a human get a coloured edge. In `List` the same judgment meant scanning threads.
- **Peripheral awareness is real, but small at five rooms.** Five widgets fit in one glance;
  so does a five-thread list. The spatial claim is untested at the scale where it should
  matter. `?stress=30` renders 30 live widgets at **60fps**, so the rendering is not the
  limit — the experiment is.
- **The inbox strip, not the floor, did the most work.** Every decision the operator
  actually made came from the bottom strip. That strip would work bolted to a chat list.
  This is the strongest current argument *against* the thesis, and it is why the kill
  criteria measure the glance test and not overall satisfaction.

**Read this as a null result so far, not a win.** If the week's data says the chat list is
better, this section gets rewritten to say so.

---

## What is genuinely real

Verified in this repository, not mocked:

| Room | Real effect | Evidence |
|---|---|---|
| **analytics** | queries a real Postgres (`bizdata`: 120 customers, 900 orders, 40 deals) through its **own DB role** | `artifact` rows with real aggregates; `atrium_analytics` can `SELECT` and cannot `UPDATE` (test) |
| **engineering** | reads a real git repo, applies a real patch, runs the **real test suite**, pushes a **real branch**, opens a PR | commits in `workspace/`, branches in `workspace-remote.git`; the test suite genuinely fails before the fix and passes after |
| **marketing** | writes a real row into the real `content_queue`, publishes only after approval | `content_queue` rows moving `draft → published` |
| **sales** | reads pipeline and writes a real annotation, through a role granted `UPDATE (note)` on one column only | `bizdata.pipeline.note` |
| **strategy** | reads only *shared* artifacts from other rooms, escalates to the human | escalation card in the inbox |

Money, budgets, kills, approvals and the event log are all real. The agents' **reasoning**
is not: there is no LLM API key in this environment, so agent policies are deterministic
programs that choose real tools and do real work (`ScriptedDriver`). `LlmDriver` is the same
interface — set `ANTHROPIC_API_KEY` and `AGENT_DRIVER=llm`. This is stated rather than
hidden because a pretty runtime over a fake claim proves as little as a pretty dashboard
over fake agents.

Likewise `github.pr.open`: with `ATRIUM_GH_REPO` + `GH_TOKEN` it opens a pull request on
github.com. Without them it still **really pushes the branch** to the local bare remote and
returns `mode: "local"`. It never reports a PR that does not exist.

---

## The shell

A desktop, not a dashboard. **Team blocks on the rails**, left and right — each room with its
colour, spend and crew. **The stage in the centre** — click a teammate to open their
conversation, click a room to open its console; windows drag, zoom and minimise. **Menu bar
on top** — spend, notifications, settings, panic stop. **Dock at the bottom** — launcher,
open windows, live working count. **Needs you** hangs under the right rail: approvals and
escalations, most expensive first, then oldest.

Agents are characters, not rows: each has a name, colour, face and a one-line persona. The
ring on their face is their state; the text beside it is what they are doing right now.

The Floor — the spatial room grid — survives as one app on the stage, which is what keeps
the chat-list comparison in §Thesis honest: both views are now things you open, neither is
the whole screen.

## Rooms are permission boundaries

This is the load-bearing idea. If rooms were only visual grouping, a tagged chat list would
be strictly better and this project should not exist.

A room owns its objective, tools, budget, memory, DB credential and escalation policy.
Every agent action passes one gate — `server/src/runtime/toolbelt.ts` — in this order:

1. **room status** — a capped or halted room runs nothing
2. **grant check** — the tool must be in `room.tool_grants`; violations are logged and fail hard
3. **approval gate** — by blast radius; irreversible always needs a human
4. **budget charge** — transactional, so caps halt rather than overrun
5. **execute** — only now does anything real happen

Scoping is defended twice. Above the database, by that gate. Inside it, by **per-room
Postgres roles**: `atrium_engineering` has no grant on `bizdata`, so even a bug in our code
cannot leak analytics data — postgres refuses.

`test/scope.test.ts` exists to try the violations and assert they fail:

```
✓ a room cannot call a tool it was not granted        (and the refusal is logged)
✓ a room cannot act on another room by naming it
✓ sql.query refuses anything that writes
✓ the engineering database role has no grant on business data
✓ the analytics role can read business data but not write it
✓ a room cannot read another room's private artifacts
✓ repo tools cannot escape the workspace
```

---

## Hard requirements, and what proves each

| # | Requirement | Where | Proof |
|---|---|---|---|
| R1 | every action logged and replayable | `event` is append-only; `src/replay.ts` folds it | `npm run replay:verify` → *replay matches live state exactly* |
| R2 | nothing irreversible without approval | toolbelt step 3; the card carries action, cost, touches | `test/budget.test.ts`: an approval is single-use and bound to its arguments |
| R3 | caps halt, never overrun | `runtime/budget.ts`, charged in the same transaction | test: 3¢ cap, 1¢ tool — spends exactly 3¢, room goes `capped`, the over-cap call has **no** side effect |
| R4 | loops killed by budget, not by noticing | step budget, cost budget, repeat-signature detector | the seeded `Rex` agent spins on purpose and dies `killed: loop_detected` |
| R5 | state survives refresh | agents run server-side; the browser holds none | runs keep stepping with **zero browsers connected** (verified: the log grew 463 → 479 events with no client); the UI reconnects and re-reads |

Plus a global **Stop everything** switch that refuses every tool call while engaged.

---

## Rendering: DOM won

The PRD left canvas vs DOM open, to be settled by measurement. Plain DOM with
`contain: content`, per-room memoisation and one rAF-coalesced render per frame holds
**60fps at 30 live widgets** (`http://localhost:8787/?stress=30`, fps counter in the
top bar). Canvas would have cost hit-testing, text layout and accessibility for no gain.

---

## Open decisions — defaults taken

Raised before coding, per the spec. No human was reachable when the build started, so each
was taken as a reversible default, marked `DECISION:` in code and argued in prd.md §7.

- **D1 — build the runtime, don't wrap an orchestrator.** The product claim *is* the
  scoping/interruption layer that every orchestrator owns. ~400 lines. Reasoning stays
  pluggable behind `LlmDriver`.
- **D2 — gate on blast radius, not a fixed rule.** `low` runs free, `medium` runs and
  notifies, `high` (irreversible or public) always asks. "Approve and always" can raise
  autonomy per room but never below `high`.
- **D3 — shared artifact store, no cross-room messaging in v1.** Messaging is the fastest
  way to dissolve the boundary the design rests on. If strategy genuinely stalls without it,
  that shows up as blocked agents — which is itself a test of the floor plan.

Each is cheap to reverse. If any turns out wrong, that goes here too.

---

## Layout

```
prd.md                  the spec, thesis and kill criteria
db/migrations/          schema + the real bizdata business schema
server/src/
  runtime/toolbelt.ts   the single gate every agent action passes
  runtime/budget.ts     transactional spend caps that halt
  runtime/scheduler.ts  the step loop, kills, approval parking
  tools/                real tools: postgres, git, github, content queue
  policies/             what each agent does, step by step
  replay.ts             the fold that defines what the projections mean
web/src/
  desktop/wm.ts              a small window manager
  desktop/TeamRail.tsx       team blocks: rooms and their crew, on the rails
  desktop/MenuBar.tsx        spend, notifications, settings, panic
  desktop/Dock.tsx           launcher and open windows
  apps/AgentApp.tsx          an agent's live conversation — the centre of the desktop
  apps/RoomApp.tsx           room console: log, artifacts, spend, scope
  apps/InboxApp.tsx          approvals: action, cost, what it touches
  components/ListView.tsx    the chat-list control view
workspace/              a real git repo the engineering room really edits
```

## Not in v1

Multi-human teams, agent-to-agent negotiation, a marketplace, mobile, isometric art.
