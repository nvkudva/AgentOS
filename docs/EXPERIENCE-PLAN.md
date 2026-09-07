# Atrium — Experience Plan: delegation you can pick up

## Premise

The three-tier hierarchy — supervisor orb, room manager, room workers — exists today only in
the pitch. Nothing in the schema links a sentence the operator spoke to the runs it caused,
nothing on screen distinguishes a manager from a worker, and the only object on the desk that
can be picked up is a window.

This round makes one thing true: **a piece of human intent is a first-class row on the server
and a first-class object under the pointer**, and every handoff of that object — human to
supervisor, supervisor to manager, manager to worker, and all the way back — is either a
gesture the operator performs or a motion they watch. Delegation is not narrated in a feed;
it is carried across the desk.

Three names, used consistently everywhere below and in the code:

- **Mandate** — one sentence of human intent. A server row (`mandate`), a colour, an id.
- **Task** — one decomposed unit under a mandate, owned by one worker, backed by one `run`.
- **Chit** — the draggable UI object that represents a mandate or a task. Same component,
  same shape, at every tier. `web/src/desktop/Chit.tsx`.

Two rules constrain everything that follows.

1. **A window lands where it is dropped.** No zone docking, no lanes, no auto-arrangement
   keyed to the org chart. Drop targets may highlight, absorb and animate; they may never
   relocate a window the operator did not aim at.
2. **Voice may commit a mandate. Voice may never commit an approval.** A mandate is budgeted,
   reversible and recallable. An approval is not. `commands.ts` keeps its refusal verbatim.

Mechanism is fixed too: one pointer-event carry protocol, geometry written to the DOM node in
rAF and committed to React only on release — the discipline already proven by the module-level
`flight` record in `web/src/desktop/Window.tsx`. **No HTML5 drag-and-drop. No framer-motion,
react-spring or dnd-kit.** A library would re-render mid-gesture, which is the exact failure
that record exists to prevent.

---

## Agreed features

### P0 — the spine. Nothing below it works without these.

| # | Feature | Files | Interaction spec |
|---|---------|-------|------------------|
| 1 | **Mandate + task rows** | `db/migrations/006_mandate.sql`, `server/src/api.ts`, `server/src/runtime/scheduler.ts`, `web/src/lib/api.ts`, `web/src/lib/demo.ts` | Not a gesture; the substrate. `mandate(id, text, room_id, state, quoted_cents, spent_cents, created_at)` where state ∈ `heard·routed·planned·working·blocked·done·recalled`. `task(id, mandate_id, agent_id, run_id, title, state, ord)`. `run` gains `mandate_id`, `task_id` (nullable, indexed). Events, approvals, artifacts and ledger lines already carry `run_id`, so they inherit the mandate free. API: `POST /api/mandates {text, room_key}` → row in `heard`; `POST /api/mandates/:id/route {room_key}`; `POST /api/mandates/:id/recall`; mandates and tasks join the `/api/state` snapshot and the SSE refresh. Every mandate carries a stable colour (its room's colour at route time, frozen) and every DOM element that belongs to it renders `data-mandate="<id>"`. |
| 2 | **Manager tier** | `server/src/provision.ts`, `server/src/policies/index.ts`, `server/src/tools/assign.ts`, `server/src/tools/index.ts`, `web/src/lib/api.ts` | `agent` gains `tier text NOT NULL DEFAULT 'worker'` (`manager`\|`worker`); exactly one manager per room, seeded in `provision.ts`. A new policy `room.manager` does no tool work. Its steps: (a) read the mandate text; (b) pick a decomposition from a deterministic table keyed on `room.key` + matched keywords → 2–4 task titles; (c) call the new `assign` tool, which writes `task` rows and calls the existing `startAgent(workerId, task.title)` — `goalOverride` in `scheduler.ts:14` already exists and is currently unreachable from the UI; (d) poll its tasks, then call `report`. Fewer workers than tasks ⇒ queue by `ord`, one active task per worker. |
| 3 | **Manager row + spine in the room window** | `web/src/desktop/RoomWindow.tsx`, `web/src/styles.css` | Static structure, and the track every later animation travels. Manager pinned first: 44px face, ring in the room colour 2px, no status-dot pulse, caption `runs this room`; row hit box is full window width × 52px. Workers stay 32px below it. A 1px hairline (`--line-soft`) drops from beneath the manager face down the left edge of the worker rows; each worker joins it with an 8px horizontal stub. The segment above a worker tints `--working` over `--t-tint` while that worker holds an open task and returns to `--line-soft` when it does not. An SVG `stroke-dasharray` ring around the manager face shows tasks done / total for its live mandates; it re-scales over 200ms when the count changes. Clicking the manager opens its workspace showing tasks, not tool calls. In `ParkedRail` the manager is the top face and carries the same arc. |
| 4 | **The Carry protocol** | `web/src/desktop/carry.ts`, `web/src/desktop/CarryLayer.tsx`, `web/src/App.tsx`, `web/src/styles.css` | One module; every other gesture is a client of it. `pointerdown` on any `[data-carry]` element captures the pointer. Under 4px of travel nothing happens and the element still receives its click (window drag stays at 3px: a title bar has nothing else to hit, a chit sits in a scrollable list). At 4px: source gets `.carrying` (opacity .35, no layout change); a purpose-built ghost node is placed in a `position:fixed` layer at z 900, `pointer-events:none`, at the source rect, and animated to `scale(1.04)` with `--e4` over 120ms `--ease`. Thereafter the ghost is positioned by `transform:translate3d()` written **once per rAF from the last pointermove**, never from React. Hit-testing runs in the same rAF: `document.elementsFromPoint`, first ancestor with `[data-drop]`, read its `data-accepts`; if the payload kind is not listed it is not a target. Payload kinds: `mandate`, `task`, `agent`. From pickup, **all** legal targets sit at full opacity with a 1.5px inset ring in their own `--c`; illegal ones drop to 55% with a 4px diagonal hatch at 12% — the operator never hovers to discover legality. Hovered target ring goes 100% + `scale(1.06)` over 100ms. `body.carrying` suppresses window hover effects exactly as `body.dragging` does. Escape, or release over nothing/illegal: ghost returns to the source rect in 180ms `--ease-out` and dissolves; nothing commits. Release over a legal target: ghost flies to the target rect centre in 240ms `--ease-settle`, fades over the last 80ms, and **React state changes only then**. No confirm dialog, ever — commit on release, undo for 8s. |
| 5 | **Chits** | `web/src/desktop/Chit.tsx`, `web/src/desktop/RoomWindow.tsx`, `web/src/apps/AgentApp.tsx`, `web/src/styles.css` | 26px tall, 8px radius, 3px left bar in the mandate colour, verb-first label on one line, agent-hours estimate right-aligned in `--dim`. Minimum hit target 26 × 120px. Appears: at the orb's mouth (uncommitted mandate), in a room's task strip, collapsed to a 4px tick beside a worker's activity line, and inside an open parked rail. Hovering a collapsed tick for 200ms expands it back to a full chit in place over 140ms so it can be aimed at. `data-carry="task"` (or `"mandate"`). Click without movement opens the owning run in `AgentApp`, as today. Right-click (or 500ms press with no movement on touch) opens a 2-item menu: `Recall`, `Open run`. |
| 6 | **Courier — the one motion primitive** | `web/src/desktop/courier.ts`, `web/src/desktop/Courier.tsx`, `web/src/App.tsx` | A fixed overlay plus a module-level bus: `send({from: DOMRect, to: DOMRect, colour, label?, kind})`. One node per hop, animated with `element.animate()` along a quadratic sampled into 24 translate keyframes, control point pushed 18% of the chord length perpendicular so the arc bows away from the desk centre. No React render during flight; the node is removed on finish. **Downward (an instruction) = an 18px capsule with a 3–6 word label. Upward (a result) = a 5px unlabelled dot.** Size and label are the entire grammar — never direction alone, since a room parked on the left inverts the arc. Capsule scales .6→1 over the first 90ms, holds, then 1→0.85 with opacity→0 over the last 100ms as it is absorbed. `--t-far` across the desk, `--t-near` inside one window. Max 3 in flight; a 4th queues 80ms behind. If the destination is offscreen/closed the flight retargets to the room's parked rail, else its dock tile, which does one wave-bounce. |
| 7 | **Confirm-then-route in the orb** | `web/src/desktop/commands.ts`, `web/src/desktop/Supervisor.tsx`, `web/src/desktop/Orb.tsx` | `run()` in `commands.ts` gains one clause immediately before the `I did not understand` fallback: an unmatched sentence becomes `{kind:'propose', room, text}`, the room chosen by scoring keywords against `room.key`, `room.name`, `room.objective` and `room.tool_grants`. If nothing scores, the orb asks `which room?` and does nothing. Nothing is dispatched on parse. The panel shows one line — the sentence, plus a room chip in the room colour — rendered as an uncommitted **chit** growing out of the orb (scale .6→1, 12px upward travel, 200ms `--ease`). Return commits; ← / → cycle rooms; Escape discards (scale .9 + fade over `--t-tint`); a second spoken `yes` commits. Dragging the chit out commits to wherever it is dropped instead. On commit the chit's `getBoundingClientRect` is handed to the courier and the DOM chit is hidden **in the same frame** — FLIP continuity, nothing pops. |
| 8 | **Arrival, bloom, and the walk down the spine** | `web/src/desktop/RoomWindow.tsx`, `web/src/desktop/Window.tsx`, `web/src/desktop/Dock.tsx`, `web/src/styles.css` | **Arrival:** the window's .5px rim brightens to the room colour (140ms in `--ease` / 260ms out `--ease-out`), the manager face rings once (scale 1→1.14→1, 320ms), and the window raises one elevation step `--e3`→`--e4` for 400ms — a `box-shadow` transition only, no transform, so nothing shifts. Parked: the rail's colour bar brightens and the rail widens 6px and returns; **it does not unpark itself**. **Bloom:** 280ms after arrival, N task chits emerge from the manager's face, scale .4→1, opacity 0→1, staggered 45ms, and settle into a task strip directly under the manager row. Cap at 5 visible plus a `+N` chit. The window's own height does not change; the strip pushes the crew list down with a 200ms height transition. **Assignment:** each chit travels from the strip down the spine as an L-path (down, then 8px right — the track is the metaphor, not a diagonal), 260ms `--ease`, 80ms stagger, then crossfades over 120ms into that worker's caption and collapses to its 4px tick. Status dot flips to working; the spine segment above it tints. Unassigned chits stay in the strip pulsing at .6 opacity, 2.8s. |
| 9 | **Drop a chit on a room, a rail, or a face** | `web/src/desktop/RoomWindow.tsx`, `web/src/App.tsx`, `web/src/desktop/Sidebar.tsx`, `server/src/api.ts` | Drop targets, all via Carry. **Room window body or manager row** (`data-accepts="mandate task"`) → route/re-route to that room's manager. **A specific worker face** (hit target padded to 40 × 40 though the face is 32px) → assign directly, bypassing the manager, and the manager is still told: a thin dashed up-thread is drawn to its face so the tier is not silently lied about. **A parked rail** → route to that room's manager. Legality is the destination room's `tool_grants` versus the work's required tools, computed client-side from the same table the server enforces; an illegal target is hatched from pickup, and on release the ghost springs back with a ±6px, 3-cycle, 220ms shake, the target rim tints red for 60ms, and the orb says one line: `Engineering cannot draft into the content queue.` A legal drop commits immediately and drops an 8s undo strip at the bottom of the source room window; nothing is killed until it lapses. A face whose agent is `killed`/`failed` is illegal. A face already holding 3+ chits shows a queue badge on hover. |
| 10 | **The return path and the result card** | `web/src/desktop/courier.ts`, `web/src/desktop/Supervisor.tsx`, `web/src/desktop/Sidebar.tsx`, `server/src/tools/index.ts` | On task completion the worker's chit collapses to a 5px dot in the mandate colour and travels **up** the spine to the manager, whose arc fills by 1/N (260ms). When the last task lands the manager's `report` writes two lines of plain English plus the artifact id; the room emits one capsule to the orb; the orb ring blooms once in the mandate colour over 600ms (amplitude on the existing canvas painter, not a new element) and shows a result card: the two lines, `Open` (opens the artifact in a window) and `Done`. If voice replies are on it speaks the first sentence only. Unread results survive a refresh and are counted on the dock's Approvals tile in a **second, quieter badge** — they are unreads, never approvals. |
| 11 | **Motion tokens** | `web/src/styles.css` | `--ease:cubic-bezier(.32,.72,0,1)` (arriving/moving), `--ease-out:cubic-bezier(.4,0,1,1)` (leaving), `--ease-settle:cubic-bezier(.2,.9,.25,1.04)` (a released drag, and nothing else). `--t-tint:110ms`, `--t-ui:180ms`, `--t-near:260ms`, `--t-far:420ms`, `--t-cascade:700ms`. Every literal duration and curve in `styles.css` (there are eleven copies of the bezier and seven distinct durations today) is replaced by a token. |
| 12 | **Reduced-motion contract** | `web/src/styles.css`, `web/src/desktop/courier.ts`, `web/src/desktop/carry.ts` | One block at the end of `styles.css` naming exactly what survives and what each removed motion is replaced by — see *UI enhancements* below. `courier.ts` checks `matchMedia('(prefers-reduced-motion: reduce)')` once at send time and takes the fade path; never a zero-duration 24-keyframe arc. |

### P1 — makes it usable at speed.

| # | Feature | Files | Interaction spec |
|---|---------|-------|------------------|
| 13 | **Escalation flies to the bell; the decision flies back** | `web/src/desktop/courier.ts`, `web/src/desktop/MenuBar.tsx`, `web/src/App.tsx` | When a worker raises an approval its chit detaches and flies worker → manager → bell as one continuous arc with a 90ms hold at the tier boundary, so the operator sees it passed *through* the manager. 520ms total, apex 80px above the chord, chit shrinks 1→0.4 along the path, lands with a 1.08 scale bump over 140ms; **the badge increments on impact, not before**. The capsule visibly decelerates over its last 120ms (a completed-work capsule does not) and then becomes a static count pip — the one thing in the system allowed to arrest and persist. Source parked or offscreen ⇒ the flight starts from the rail rect. On decide, a 300ms dot returns bell → worker face in the approve green (or `--danger`, 180ms and blunter, for reject); the worker's status dot goes amber → working. Max 3 concurrent flights, 90ms queue. |
| 14 | **Directional drag on an approval card** | `web/src/apps/InboxApp.tsx`, `web/src/desktop/Sidebar.tsx`, `web/src/styles.css` | `pointerdown` on the card body (not its buttons). Vertical intent wins if `|dy| > |dx|` at 12px — the queue must still scroll. Under 40px the card follows 1:1 and springs back in 180ms. 40–88px: armed; the revealed edge fills green (right, approve) or `--danger` (left, reject), opacity ramping 0→1 across the band, verb shown in the gutter. Past 88px release commits. Past 120px travel damps to 0.35:1 so the hand feels a wall. Commit animates the card out in that direction over 200ms and drops the existing undo strip in its place, running the **exact same** `decide()` path as the `a` / `r` keys. Escape springs back. |
| 15 | **Parked rails accept drops and scrub open mid-carry** | `web/src/desktop/RoomWindow.tsx`, `web/src/desktop/Window.tsx`, `web/src/styles.css` | Today `styles.css` kills parked hover under `body.dragging`; that rule stays for **window** drags. A new `body.carrying` rule re-enables a longer dwell for **carries**: 400ms (vs the 220ms plain hover, because a carry crosses gutters on its way elsewhere), then width 72→340px over 180ms `--ease`. Top and height do not change and the rail stack does not re-flow. Leaving re-collapses after 250ms of absence, cancelled on re-entry. Drop on a closed rail → the room's manager. Drop on an open rail's specific face → that worker. On release the rail re-parks in 180ms. The two gestures must never be conflated. |
| 16 | **Cost and consequence preview on the ghost** | `web/src/desktop/CarryLayer.tsx`, `web/src/lib/humanize.ts` | After 120ms of hovering one legal target (delay so it does not strobe across targets), a slab fades in over 100ms anchored 12px below-right of the ghost: projected agent-hours, position in that target's queue, the tools the work would touch, and whether it would trip the room's `approval_policy`. Follows the ghost; mirrors to above-left within 24px of a stage edge; `pointer-events:none`. Content swaps on target change with a 60ms crossfade and no re-entrance. If the drop would need an approval the slab shows an amber `needs you` pip **and the target ring turns amber instead of the room colour** — the operator learns the colour of "this comes back to me". |
| 17 | **Chain hover-trace** | `web/src/App.tsx`, `web/src/styles.css` | Hovering any element carrying `data-mandate` for 180ms (so it never fires while the pointer is travelling) sets `data-trace="<id>"` on `.stage`; pure CSS then rings every element with that id in the mandate colour and drops everything else to 45% opacity over 120ms. Instant fade out on leave. Holding Option pins the trace so the operator can move the pointer and read; Escape or key-up unpins. **No re-render** — one attribute, one selector. This is the only dimming mechanism in the product. |
| 18 | **Press-and-hold to peek** | `web/src/desktop/Peek.tsx`, `web/src/desktop/RoomWindow.tsx` | Hold any face for 350ms with under 4px of movement: a ring wipes around the pressed face during the hold so the arming is felt, then a popover fades in over 120ms anchored to the inward side of the face — name, role, current activity, last two steps, spend, current chits. `pointer-events:none`, mirrored near stage edges. Release, or movement past 12px, closes it in 100ms. **Exceeding 4px before 350ms converts the press into a Carry instead**, so one press serves both intents and the hand chooses by moving or not. Works identically at 72px inside an open rail. |
| 19 | **Clarify round-trip** | `server/src/tools/escalate.ts`, `web/src/desktop/Supervisor.tsx`, `web/src/desktop/commands.ts` | A manager may raise `clarify` — an escalation subtype that is cheap, reversible and not blast-radius gated — carrying a question and 2–3 canned answers. It lands in the **orb panel, not the approvals queue**; routing `last quarter — calendar or fiscal?` through the same surface as `open a real PR` devalues the queue. Keys 1/2/3 answer; voice answers by matching answer text; Escape defers. A clarify deferred 60s escalates into the Needs-you queue so it cannot be lost. |
| 20 | **Recall, with the queue's undo** | `web/src/desktop/Chit.tsx`, `server/src/api.ts`, `server/src/runtime/scheduler.ts` | Right-click (or long-press) a mandate chit → `Recall`. The chit greys with a draining 8s hairline and an `Undo` button; **nothing is killed until it lapses**. On lapse: tasks are killed with `kill_reason='recalled'`, and the mandate returns to the orb un-routed, still holding the operator's original words, ready to be dropped somewhere else. Redirect is the same machinery under a different verb: dropping a live mandate on another room kills with `kill_reason='handed_over'` and passes accumulated artifact ids to the new manager as context. |
| 21 | **Calm the resting state** | `web/src/styles.css`, `web/src/desktop/RoomWindow.tsx` | `.st.working` currently breathes forever on every working agent — fourteen perpetual pulses, about to compete with real motion. Replace with a decaying attention state: the full 2.4s breathe runs only while the row carries `.fresh` (set on state transition, cleared by a 20s timer), then a 4.8s pulse at half the opacity swing. Task captions crossfade (110ms out / 140ms in) instead of sliding — a moving caption in a list of fourteen is what makes a dashboard feel busy. |

### P2 — real, specified, deliberately later.

| # | Feature | Files | Interaction spec |
|---|---------|-------|------------------|
| 22 | **Plan preview before workers start** | `web/src/desktop/Supervisor.tsx`, `server/src/policies/index.ts` | For rooms whose `approval_policy` is `approve` on high blast, the decomposition shows for 5s before any worker starts: task rows with assignee faces and the same draining hairline as the approvals undo. `Start now` skips the wait; `Change` stops and hands the list back as editable rows; a row can be dragged onto a different face to re-assign before it starts. |
| 23 | **Live cost on the chain** | `web/src/desktop/Chit.tsx`, `web/src/lib/humanize.ts` | The mandate chit's agent-hours count up with a 400ms tween and never jump. At 50% of the figure quoted at route time the chip fills amber over 600ms (not a blink) and the orb says it once; at 100% the manager stops assigning and raises a clarify. Hover for a per-room breakdown popover. |
| 24 | **Work — mandate history** | `web/src/components/ListView.tsx`, `web/src/desktop/Dock.tsx`, `web/src/apps/SettingsApp.tsx` | The dock's Activity tile becomes **Work**: a list of mandates — the operator's own sentence, room, chain, cost, outcome — expandable to the full chain of custody and every event beneath it. `Run again` re-sends identical text through the identical route as a new mandate. ⌘F filters by words. Dragging a past mandate onto a room re-runs it there. The raw Activity feed is not deleted — it is the thesis's falsification control — but it moves to Settings, because two lists of the same events means the operator scans both. |
| 25 | **Room pairing that grants something real** | `web/src/desktop/Window.tsx`, `web/src/apps/RoomApp.tsx`, `server/src/runtime/toolbelt.ts` | Drag one room window over another's title bar and dwell **500ms** — long on purpose, so ordinary arranging never trips it. Arming: a 3px inset ring split half-and-half in the two room colours. Release before 500ms is an ordinary drop, byte-identical to today. Release after: **neither window moves**; a 2px braided seam draws between the nearest edges over 240ms and re-routes live as either window is dragged, resized or parked. The pairing grants the dragged room's manager read access to the target's shared artifacts, scoped to the current mandate and revoked when it ends; both Permissions tabs show it with a revoke button. Sever by dragging either title bar with Option held: 140ms recoil. If the grant is ever cut, cut the seam with it — as decoration it does not earn a pixel. |
| 26 | **Agent loan between rooms** | `web/src/desktop/RoomWindow.tsx`, `web/src/lib/api.ts`, `server/src/api.ts` | Carry a crew face into another room. Legality is the destination's `tool_grants` against the agent's policy `uses`, decided **at pickup**: illegal rooms are hatched and the preview slab names the missing grant. On drop the face animates into the destination crew over 260ms with an `on loan from Analytics` tag and a dotted ring; the source keeps a greyed 32px placeholder. Its work still reports up to its home manager — the up-thread crosses the desk, which is the point. Click the placeholder or drag the face back to return it. |

---

## UI enhancements — the motion language

**One easing family, one duration scale.** Declared in `:root` (feature 11) and used everywhere:

- `--ease: cubic-bezier(.32,.72,0,1)` — anything arriving or moving under its own steam.
- `--ease-out: cubic-bezier(.4,0,1,1)` — anything leaving, being dismissed, or springing back.
- `--ease-settle: cubic-bezier(.2,.9,.25,1.04)` — **only** the release of a drag or carry. That
  is the single moment the operator's hand imparted momentum, and the only overshoot allowed.
- Durations: `--t-tint 110ms` (colour and state), `--t-ui 180ms` (windows, panels, rails),
  `--t-near 260ms` (travel inside one window), `--t-far 420ms` (travel across the desk),
  `--t-cascade 700ms` (a staged multi-hop).

**What is instant, at 0ms, and must stay that way:** focus ring, z-order change, drag and carry
tracking (both write geometry to the node in rAF — a transition here is lag), the kill/panic
colour, park geometry during a window drag, and the `data-trace` attribute swap.

**What animates, and why it is allowed to:**

| Event | Motion | Duration / curve |
|---|---|---|
| Instruction leaves the orb | Labelled capsule, quadratic arc, control point 18% of chord | `--t-far` `--ease` |
| Instruction arrives at a room | Rim brightens; manager face rings; `--e3`→`--e4` for 400ms | 140ms in / 260ms out; ring 320ms |
| Decomposition | N chits bloom from the manager face, 45ms stagger, cap 5 + `+N` | `--t-near` `--ease` |
| Assignment | Chit walks the spine as an L-path, 80ms stagger, crossfades into the caption | `--t-near` `--ease`, crossfade 120ms |
| A task completes | 5px unlabelled dot up the spine; manager arc advances 1/N | `--t-near` |
| Mandate completes | One capsule room→orb; orb ring blooms once | `--t-far`; bloom 600ms |
| Escalation | Chit worker→manager→bell, 90ms hold at the tier, decelerating, then a static pip | 520ms, apex 80px |
| Approval returns | Dot bell→worker face in approve green / `--danger` | 300ms / 180ms |
| Carry lift | Ghost to `scale(1.04)` + `--e4`; source to .35 opacity | 120ms `--ease` |
| Carry drop | Ghost to target centre, fading over the last 80ms | 240ms `--ease-settle` |
| Carry refusal | Return to source, then ±6px 3-cycle shake; target rim red 60ms | 180ms `--ease-out` + 220ms |
| Rail scrub during carry | Width 72→340px after 400ms dwell; top and height unchanged | 180ms `--ease` |
| Hover-trace | Non-members to 45% opacity | 120ms in, instant out |

**Budget.** Never more than 3 courier flights concurrently; a 4th queues 80ms behind. Motion is
reserved for the four handoffs — route, assign, report, escalate. A token for every tool call
turns the desk into weather and destroys the meaning of the pip.

**Reduced motion — the substitute matters more than the removal.** One block at the end of
`styles.css`. **Survives:** state colours, opacity crossfades, the status dot, the approval pip,
hover-trace, elevation changes, all rim tints. **Removed:** courier travel, bloom stagger, spine
walks, the dock wave, window scale-in, the shake. **Substituted:** every removed travel becomes
the object appearing at its destination with a 90ms opacity fade *plus* a single rim tint on the
destination — otherwise a reduced-motion operator sees objects teleport with no attribution at
all, which is worse than no motion. `courier.ts` branches at send time; it never runs a
zero-duration 24-keyframe arc.

---

## Interaction flows

### Flow 1 — Voice to result: the full three-tier loop

1. Operator clicks the orb (or ⌘K) and says *"Atrium, run analytics on last quarter's churn."*
   The orb ring switches to live microphone amplitude — the only motion on screen.
2. `commands.ts` matches no verb clause and falls through to intent routing. `churn` and
   `analytics` score against the Analytics room's objective and its `sql.query` grant. The panel
   grows (`--t-ui`) and an uncommitted chit grows out of the orb: the sentence, an Analytics
   chip in the Analytics colour, and an agent-hours estimate. **Nothing has started.**
3. Operator presses Return (or says *yes*). `POST /api/mandates` creates the mandate in `heard`.
   The chip's rect is captured, the DOM chip is hidden in the same frame, and a courier capsule
   takes its place — no pop.
4. The capsule arcs orb → Analytics window over `--t-far`. Parked, it arcs to the rail; closed,
   to the dock tile, which bounces once. The orb says *"Analytics has it."*
5. Arrival: the window rim brightens and returns, the window lifts one elevation step for 400ms,
   and Mara's manager face rings once. Mandate state → `routed`.
6. 280ms later, the bloom: four chits emerge from Mara's face, 45ms apart, and settle into the
   task strip — *pull revenue by month*, *rank regions*, *measure churn by plan*, *write it up*.
   The crew list eases down 200ms; the window does not resize. State → `planned`.
7. Each chit walks the spine as an L-path to Kit or Ada, 80ms apart, and crossfades into that
   worker's caption as a 4px tick. Status dots go `working`; the spine segments above them tint.
   Server side this is `assign` → `startAgent(worker, task.title)`.
8. Operator drags Analytics into the left gutter. The rail shows the room icon, the manager arc
   filling, and the crew faces with their dots — enough to know it is fine without unparking.
9. Kit finishes. Its chit collapses to a 5px dot that travels up the spine; Mara's arc advances a
   quarter. Hovering the rail traces the whole mandate on the desk behind it.
10. On the last task Mara calls `report`. One capsule flies rail → orb; the orb ring blooms once
    in the mandate colour over 600ms and prints the result card: *"Churn is 4.1%, worst on the
    monthly plan (7.2%). Report written."* With voice replies on it speaks the first sentence.
11. Operator clicks `Open`; the artifact opens in a window. The mandate moves to Work history
    carrying its chain — You → Supervisor → Mara → Kit, Ada — and its cost in agent-hours.

### Flow 2 — Wrong room, and a refusal at the pointer

1. Operator says *"Atrium, write up the churn story for the blog."* Routing proposes Analytics on
   the keyword `churn`; the operator confirms without reading closely. Two tasks start.
2. They see the mandate's own sentence in the Analytics task strip and realise it is Marketing's.
3. They press the mandate chit and move 4px. It lifts to the carry layer at `scale(1.04)`; the
   source row leaves a 1px dashed placeholder and keeps its height, so nothing below it moves.
4. Every legal target lights at pickup: Marketing (holds `queue.draft`), Strategy, Support.
   Finance and Engineering drop to 55% with the diagonal hatch. No hovering required.
5. Passing over Marketing, Nia's face grows 1.06 — dropping *there* would assign her directly and
   send a dashed up-thread to Marketing's manager. After 120ms of dwell the preview slab reads
   `~2.4 agent-hours · 2nd in queue · touches content queue · no approval needed`.
6. They release on the room body instead. The ghost flies to the room centre in 240ms
   `--ease-settle`. An 8s undo strip appears at the bottom of the Analytics window. **Nothing is
   killed yet.**
7. The undo lapses. The Analytics tasks are killed with `kill_reason='handed_over'`, their partial
   artifact ids are passed to Marketing's manager as context, dots travel from the two Analytics
   faces up to Mara, one capsule crosses to Marketing's title bar, and the bloom + spine walk runs
   there. Analytics' strip animates out; Marketing's animates in at 0 of 2.
8. The orb says once: *"Marketing has it. Analytics spent 9m."*
9. Had they released over Engineering: the ring was already hatched, the ghost springs back in
   180ms `--ease-out`, shakes ±6px for 220ms, Engineering's rim tints red for 60ms, and the orb
   says *"Engineering cannot draft into the content queue."* The server refusal and the pointer
   refusal are the same rule, felt earlier.

### Flow 3 — Escalation up, decision back down

1. An Engineering worker reaches `github.pr.open`. The runtime raises `NeedsApproval`; the
   worker's state becomes `awaiting_approval`, its face takes the attention ring, and the room
   window gains its `needs` flag.
2. Its chit detaches and flies worker → Rex's manager face (90ms hold there, so the chain is
   visibly respected) → the menu-bar bell: 520ms, apex 80px, shrinking 1→0.4. It decelerates over
   the last 120ms — the tell that this one will *not* be absorbed — bumps the bell 1.08 over
   140ms, and **the badge increments on impact**. The manager's arc shows an amber notch at that
   task's position; the parked rail shows the same amber pip. Nothing else on the desk moves.
3. Operator presses ⌘\. The queue slides over on `--t-ui` with the newest escalation focused. The
   source room's rim stays tinted behind the scrim, so the card is attributable to a place.
4. `j` / `k` move the focus and re-tint the corresponding room rim over `--t-tint`. Each card now
   carries a chain line above the existing action, cost and touches: *"You asked: fix the rounding
   bug · Rex, Engineering."* Hovering the card traces the whole mandate on the desk behind it.
5. The operator pulls the card right past 88px — armed green from 40px, damped past 120px — and
   releases. This runs the identical `decide()` path as the `a` key, including the 8s undo.
6. The undo lapses; the decision commits; a 300ms green dot returns bell → the worker's face (or
   its rail, which flashes once); the dot goes amber → working; the PR opens.
7. Had they pulled left instead, the return dot is `--danger`, 180ms and blunter. The manager
   marks the task refused and raises a **clarify** in the orb — *"PR refused. Leave the fix on the
   branch, or drop it?"* with two numbered answers — rather than stalling silently.

### Flow 4 — Sitting back down

1. Operator returns after 40 minutes. Two rooms parked left, one window open, the orb amber with
   a count pip. The while-you-were-away strip reads *"2 need you · 1 blocked · 3 still working"*
   and dismisses on the first keystroke.
2. The gutter says the rest without a click: Support's rail arc is full, Engineering's carries an
   amber pip on one face, Analytics' arc is at two thirds.
3. They hover Engineering's rail for 220ms. It scrubs open to 340px at the same top and height —
   the stack does not shift — showing the blocked worker's row and its line *"Needs you: open a
   pull request."* The hover also traces that mandate: the orb and the Approvals tile ring in the
   same colour, so they know this is last night's fix, not a stray agent.
4. They press and hold that worker's face for 350ms without moving: the peek popover gives the
   last two steps and the spend. Release closes it in 100ms. No window was opened.
5. ⌘\, then `a` and `r`. Two return dots fly back to their rooms; the queue empties.
6. Two result cards remain at the orb — Support's replies, Analytics' report. They open one,
   dismiss the other, and the orb goes calm. The desk is byte-identical to how they left it,
   which is the argument for parking over minimising.

---

## Rejected, and why

- **An org chart, hierarchy pane, or node-graph of the three tiers.** A second place where truth
  lives, needing its own layout engine and drifting from the windows. The tiers are legible in
  the objects already on screen: the orb is tier 1, the 44px manager row is tier 2, the 32px crew
  faces are tier 3, and the spine connects them.
- **A per-manager chat panel or supervisor thread.** It reintroduces the serial-attention failure
  the PRD exists to beat, and makes decomposition negotiable in free text, which kills the
  deterministic grammar. The manager's whole conversational surface is a plan preview and a
  clarify with canned answers.
- **A timeline, Gantt, swimlane or kanban view of tasks.** The operator's question is "is anything
  stuck", not "what is the critical path across four rooms". The manager arc answers it in a
  fraction of the space, and a board detaches work from the faces doing it — which is exactly the
  adjacency that makes drag-to-assign obvious.
- **A second dimming mechanism (Option-held "tier fog") alongside hover-trace.** One `data-trace`
  attribute, one selector, one mental model. Tier fog answers a question the manager row's size
  already answers.
- **HTML5 drag-and-drop.** The browser owns the drag image, so it cannot be animated or reshaped
  mid-gesture; `dragover` is coalesced unpredictably; Escape semantics differ per browser; it is
  dead on touch and pen; and it cannot coexist with the pointer-capture drag in `Window.tsx`.
- **framer-motion / react-spring / dnd-kit.** Everything here is rAF and transforms against nodes
  we already own. A library re-renders mid-gesture — the precise failure the module-level flight
  record was written to prevent.
- **A modal confirm on drop.** It converts a gesture back into a form. Commit on release, show the
  result, undo for 8s in the strip the Sidebar already established.
- **Any reintroduction of zone docking**, under any name — delegation lanes, manager columns,
  auto-tiling the room stack, auto-layout keyed to the org chart. It teleported windows once
  already. A window lands where it is dropped.
- **Voice approval, even with a confirmation phrase.** A misheard sentence that opens a real PR is
  unrecoverable. *"I never approve by voice. Here is the card."* is the strongest trust signal in
  the product. Voice may commit a mandate, because a mandate is budgeted, reversible, recallable.
- **Auto-routing with no confirm step.** The beat is where a misrouted sentence is caught for
  free; without it the recovery cost is the entire redirect flow. It is also the shared element
  the whole dispatch animation is built on.
- **Toasts, banners, or a notification stack for progress.** Only escalation persists and demands.
  If completions badge too, the pip stops meaning "a human is needed".
- **Ambient particle flow between rooms to signal liveness.** Motion that never stops carries no
  information. The baseline gets quieter (feature 21) by as much as the system gains motion.
- **A token for every agent event.** Motion is reserved for route, assign, report, escalate,
  precisely so motion keeps meaning "something changed hands".
- **Dragging rows out of the ⌘K box.** A second lift source that must close its own container
  mid-gesture, for a capability the orb chit already provides.
- **Deleting the Activity feed.** It is the thesis's falsification control. It moves to Settings so
  it stops competing with Work history in the dock, and it stays measurable.
- **A joint task strip that "splits a chit across two rooms".** Without a server-side split it is a
  picture of collaboration. Room pairing survives only as the revocable, mandate-scoped artifact
  grant in feature 25.

---

## Build order

Three workstreams, sequential, sharing only `styles.css` (each appends its own delimited section;
nobody edits another's) and `App.tsx` between streams 2 and 3 (stream 2 mounts the layers, stream 3
touches only keyboard and sidebar wiring).

1. **Substrate** — mandate and task rows, the manager tier and the `assign`/`report` tools, the
   motion tokens and the reduced-motion contract, the calmer resting state. Features 1, 2, 11, 12, 21.
2. **Hands** — the Carry protocol, chits, the manager row and spine, the courier, arrival, bloom,
   assignment, drop targets, the return path. Features 3, 4, 5, 6, 8, 9, 10 (client half), 16.
3. **The loop closes** — orb routing and confirm, result cards, escalation flight and the returning
   decision, directional approval drag, parked rails as drop targets, hover-trace, peek, clarify,
   recall. Features 7, 10 (orb half), 13, 14, 15, 17, 18, 19, 20.
