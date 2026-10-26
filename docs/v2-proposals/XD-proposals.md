# AgentOS V2 — Experience Design Proposals

Author: ex-Apple XD. Date: 2026-10-26.
Sources read: [README.md](/Users/vijay/dev/projects/AgentOS/README.md), [prd.md](/Users/vijay/dev/projects/AgentOS/prd.md), [REVIEW.md](/Users/vijay/dev/projects/AgentOS/REVIEW.md), [docs/EXPERIENCE-PLAN.md](/Users/vijay/dev/projects/AgentOS/docs/EXPERIENCE-PLAN.md), [docs/UX-REVIEW.md](/Users/vijay/dev/projects/AgentOS/docs/UX-REVIEW.md), [docs/QA-FLOWS.md](/Users/vijay/dev/projects/AgentOS/docs/QA-FLOWS.md), skim of `web/src/desktop/` + `web/src/apps/`.

V1 truth: permission-scoped rooms over one SSE stream, orb supervisor (voice may commit a mandate, never an approval), one approvals queue with 8s undo, parked rails, courier/chit/carry grammar in EXPERIENCE-PLAN, live-site blockers in UX-REVIEW (room drill-down hangs, Activity white-screens, no demo signal).

V2 principle: the desk answers "does anything need me?" in one glance. Motion means something changed hands — nothing else moves.

---

## XD-01 · Decide where the evidence is (inline approve on room card)

- Journey / friction: "see what needs me → act" today costs 2–4 clicks (find bell → open queue → Approve). The card that says "Stopped, waiting on you" offers no way to act (UX-09).
- Flow / interaction: room card in `needs` state renders the pending request inline — consequence strip first ("Leaves the company"), then Approve / Details. One click approves via the same `decide()` + 8s undo path as `a` key and swipe. High-blast requires hold-to-confirm. Menubar bell becomes a labelled pill ("1 needs you"); a hairline strip in the room colour spans the stage top while anything waits.
- Accessibility: buttons 36px pointer / 44px touch, 12px separation; focus-visible ring instant (0ms); full keyboard parity (`⌘\` then `a`); screen-reader label includes consequence, cost, room name.
- Priority: **P0** — the product's stated purpose is one place where decisions queue up.

## XD-02 · One home per room (cold start shows each room once)

- Journey / friction: first run shows seven rooms twice — parked rails plus Overview cards (UX-05). Overview grid (fixed 196px rows) hides the 7th room below the fold (UX-06).
- Flow / interaction: Overview is the home; rails start empty, reserved for explicit park (drag to edge). Overview window sizes to content (`min(rows + chrome, stage − 96)`), adaptive grid `repeat(auto-fill, minmax(280px,1fr))`, compact card ~120px. Parked room dims its Overview card with a "parked" mark. New windows cascade (28,28) and always take front `z` (fixes UX-07 identical-rect stacking).
- Accessibility: no information carried by position alone — parked state is text + mark, not just dimming; card order is stable and arrow-navigable (see XD-08).
- Priority: **P0** — attention is the scarcest resource; duplication spends it on symmetry.

## XD-03 · Honest demo mode (quiet pill + optimistic undo)

- Journey / friction: deployed site is a frozen snapshot with fully live-looking Approve/Reject/Stop buttons; nothing says so (UX-04). Room drill-down hangs on "One moment…" (UX-01); New room form dead-ends (UX-03).
- Flow / interaction: menubar pill "Demo data — nothing here is live", dismissible per session. Snapshot answers drill-downs locally (`offline=true` in `api.ts`); catalog ships static. Writes perform the optimistic UI change then say "Demo — not saved" in the existing undo strip. Every fetch gets a 5s deadline, max 3 retries, then a titled empty state + Retry — never an indefinite spinner; skeletons mirror the target layout (manager row, strip, crew rows).
- Accessibility: pill is text, not colour-only; status exposed via `aria-live` on mode change; skeleton uses `aria-busy` + reduced-motion-safe shimmer (opacity only).
- Priority: **P0** — the public build currently reads as broken.

## XD-04 · One window can never kill the desk (error boundaries + restore guard)

- Journey / friction: `get()` resolves `null` on failure → `ListView` throws → no boundary → whole tree unmounts; crashed window persists in localStorage so reload re-bricks the app (UX-02).
- Flow / interaction: `<ErrorBoundary>` around each window body in `App.tsx` renderWin — fallback "This view stopped working" + Reload this window + Close. `get()` becomes `T | null`-honest (`feed ?? []`). Restore wrapped in try/catch that drops the poisoned window. Smoke test mounts every app kind with failing fetch.
- Accessibility: error fallback is a real heading + buttons with focus moved into it on capture; Retry announces result via live region.
- Priority: **P0** — unrecoverable dead end one click from the dock.

## XD-05 · Needs-you-first mobile (not a shrunk desktop)

- Journey / friction: at 375pt, seven rails overlap each other and an over-wide Overview; 595px of dock in a 350px space; hover-only peek/park unreachable; keyboard hint line ships to phones (UX-21–24).
- Flow / interaction: below 768px, no rails/windows/dock-overflow — three tabs: Needs you / Rooms / Activity, orb as FAB. Room card rebuilt responsive (16px padding, 15/13px type, 28px faces, 2-line report + More). Peek becomes a tap sheet on coarse pointers; swipe card to decide + undo snackbar; `touch-action: manipulation`; safe-area insets respected.
- Accessibility: all targets ≥44pt via `pointer:coarse` size scale (28/36/44); no hover-dependent meaning; swipe has button equivalents; hint lines swap (keys on fine pointers, swipe hint on touch).
- Priority: **P1** — V1 is desktop-claim; V2 must not ship the link phones see first as unusable.

## XD-06 · Chain hover-trace (one dimming mechanism)

- Journey / friction: mandates scatter across rooms/rails/orb — "is this card part of last night's fix?" costs opening windows (Flow 4 in EXPERIENCE-PLAN).
- Flow / interaction: hover any `[data-mandate]` 180ms → `data-trace=id` on `.stage`; pure CSS rings every same-id element in mandate colour, others to 45% over 120ms; instant out on leave; Option pins the trace, Escape/key-up unpins. No re-render. Only dimming mechanism in the product.
- Accessibility: trace never the sole signal — ring + label retained; pin/unpin keyboard-operable; disabled under `prefers-reduced-motion`? No — hover-trace survives (opacity only), per the reduced-motion contract; dwell threshold adjustable in Settings.
- Priority: **P1** — makes delegation legible without a second org-chart view (explicitly rejected in EXPERIENCE-PLAN).

## XD-07 · Press-and-hold peek (one press, two intents)

- Journey / friction: checking a worker costs opening its window; rails show faces but not state (QA flows F42, B15).
- Flow / interaction: hold face 350ms (<4px move) → ring wipes during arming → popover 120ms on the inward side: name, role, activity, last two steps, spend, chits; `pointer-events:none`; release or >12px move closes in 100ms. Move >4px before 350ms converts to Carry — hand chooses by moving or not. Works at 72px inside open rail (400ms dwell scrub first).
- Accessibility: peek content also available via keyboard focus (Focus + `?` shortcut) and tap-sheet on touch; arming ring has non-motion equivalent (opacity fill); popover mirrored near stage edges, never clipped.
- Priority: **P1** — answers "what is it doing" at zero window cost.

## XD-08 · Room-to-room arrow travel + ‹ Overview back

- Journey / friction: drill-down covers the grid it came from at the same rect; no back, no breadcrumb; comparing two rooms costs 4+ open/close cycles (UX-11).
- Flow / interaction: console opens offset (cascade, XD-02); origin card marked "open" in room accent; title bar gets "‹ Overview" that focuses Overview. Arrow keys move between room consoles with focus held; rim tint follows focus (`--t-tint`).
- Accessibility: arrow travel announced (room name + state); focus trap stays inside console; Escape closes only transient layers, never the window (UX-08: ⌘W closes, dirty forms confirm + undo strip).
- Priority: **P1** — turns compare-two-rooms from 4 clicks into 1 keystroke.

## XD-09 · Plan preview + clarify in the orb (negotiable decomposition, cheap questions)

- Journey / friction: manager decomposition is invisible until workers move; cheap questions ("calendar or fiscal?") route through the same queue as "open a real PR", devaluing it (EXPERIENCE-PLAN 19, 22).
- Flow / interaction: for approve-on-high rooms, decomposition shows 5s before workers start — task rows + assignee faces + draining hairline; Start now / Change (editable rows, drag row to another face to reassign). Manager `clarify` (question + 2–3 canned answers) lands in orb panel, keys 1/2/3 or voice-text match; Escape defers; 60s deferral escalates to Needs-you.
- Accessibility: preview is a list with real buttons, full keyboard; 5s timer pauses on focus/hover; clarify answers are numbered buttons, never voice-only; canned answers localizable plain language via `humanize.ts`.
- Priority: **P2** — the confirm beat is where misroutes are caught free.

## XD-10 · Calm baseline + colour with meaning (type ramp, state hues, quiet wallpaper)

- Journey / friction: 11px body, 4 sizes in a 2px range; seven full-strength room hues compete with the one that means "needs you"; wallpaper edges cut through card text; `.st.working` breathes forever ×14 (UX-14/15/17, EXP-21).
- Flow / interaction: five-step ramp 20/17/15/13/11 (body ≥13 desktop, ≥15 mobile; 11 = numerics only; tabular figures); room colour demoted to glyph + 3px edge, crew/chits neutralised; saturated hues reserved for state (amber needs-you, red stopped, green finished); seven room hues to one lightness/chroma band; wallpaper defaults to calm gradient (illustration optional); breathe decays (2.4s full while `.fresh` ≤20s, then 4.8s half-swing); captions crossfade, never slide.
- Accessibility: body ≥4.5:1 over actual glass backgrounds (recheck `--faint` on `--tint`); state never colour-only (label + icon + colour); full reduced-motion contract — travel/bloom/spine-walks/shake become 90ms fade + destination rim tint.
- Priority: **P2** — do together as one visual-system pass; half-applied looks worse than none.

---

## Top-5 by delight

1. **Decide where the evidence is (XD-01)** — one click on the card that already told you the story; the queue comes to the work.
2. **Chain hover-trace (XD-06)** — hover one chit and the whole mandate lights up across the desk; delegation becomes visible.
3. **Press-and-hold peek (XD-07)** — the hand learns to ask "what are you doing?" without opening anything.
4. **Plan preview + clarify in the orb (XD-09)** — catch the misroute in the 5s beat instead of paying for the redirect flow.
5. **Needs-you-first mobile (XD-05)** — the phone stops pretending to be a desk and becomes the triage tool it should be.
