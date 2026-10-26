# AgentOS V2 — UI proposals

Role: Senior UI Designer. Sources inspected: `README.md`, `prd.md`, `REVIEW.md`,
`docs/UX-REVIEW.md`, `docs/EXPERIENCE-PLAN.md`, `docs/QA-FLOWS.md`,
`web/src/App.tsx`, `web/src/styles.css`, `web/src/desktop/RoomWindow.tsx`,
`web/src/apps/InboxApp.tsx`.

Design constraints carried forward: rooms are permission scopes before they are
screens (`prd.md` §2); voice may commit a mandate but never an approval
(`docs/EXPERIENCE-PLAN.md`); calm is the signal — motion is rationed
(`prd.md` §4); one easing family / one duration scale (`web/src/styles.css`).

## Proposal 1 — Needs-you command bar (inline decisions where the evidence is)

- **Problem:** Approvals live only in the slide-over; reaching them costs 2–4
  clicks from a cold desk (find bell → open queue → approve), and the room card
  that caused the approval says "waiting on you" with no way to act
  (`docs/UX-REVIEW.md` UX-09; `web/src/desktop/RoomWindow.tsx` has no decision
  affordance).
- **Pattern/component:** `NeedsYouBar` — an inline Approve / Reject / Details
  strip rendered on any room card, rail, and manager row in the `needs` state.
  Same `decide()` path and 8s undo as `InboxApp.tsx`; high-blast actions use
  hold-to-approve.
- **Where it applies:** Overview cards (`FloorApp`), `RoomWindow` manager row,
  `ParkedRail` scrub-open, menubar "N needs you" pill replacing the bell glyph.
- **Priority:** P0.

## Proposal 2 — Graceful offline/demo shell (error boundaries + snapshot drill-down)

- **Problem:** On the static demo build, opening a room hangs on "One moment…"
  forever and opening Activity white-screens the whole app permanently; a crash
  persists across reload via saved desktop (`docs/UX-REVIEW.md` UX-01/UX-02;
  `web/src/lib/api.ts` swallows fetch failures; no error boundary in
  `web/src/App.tsx`).
- **Pattern/component:** `<WindowErrorBoundary>` per window body with titled
  empty/error states + Retry; offline snapshot resolver for room/agent/list
  reads; crash-safe desktop restore that drops the offending window; demo-mode
  pill ("Demo data — nothing here is live") with optimistic write + "Demo —
  not saved" undo strip.
- **Where it applies:** `App.tsx` `renderWin`, `RoomApp`, `ListView`,
  `NewRoom`, menubar, empty-desk copy.
- **Priority:** P0.

## Proposal 3 — One home per room + content-sized Overview

- **Problem:** Seven rooms render twice (parked rails AND Overview cards), and
  the fixed `grid-auto-rows:196px` Overview cannot show all seven at 1440×900
  (`docs/UX-REVIEW.md` UX-05/UX-06; `web/src/App.tsx` parks every room on boot).
- **Pattern/component:** Overview-as-home: cold start opens only a
  content-sized Overview (`rows × card + chrome`, adaptive
  `repeat(auto-fill, minmax(280px, 1fr))`, compact ~120px density chosen by
  width); rails start empty and are an explicit park affordance; parked rooms
  get a dimmed "parked" mark on their Overview card.
- **Where it applies:** `App.tsx` first-run effect, `FloorApp`, `styles.css`
  `.grid`/`.room`, `desktop/wm.ts`.
- **Priority:** P0.

## Proposal 4 — Cascading windows with guaranteed front-most + entrance motion

- **Problem:** `place()` in `web/src/App.tsx:149` returns the identical centred
  rect for every window, so a new window is indistinguishable from a repaint and
  can land hidden behind Overview.
- **Pattern/component:** Cascade placement (+28,+28 wrap-to-centre), `z = ++seqZ`
  on open, re-open focuses instead of re-placing, 96%-scale fade-in; room
  console opens offset with "‹ Overview" focus-back affordance and arrow-key
  travel between rooms.
- **Where it applies:** `App.tsx` `place()`/`launch`/`openRoomConsole`,
  `desktop/wm.ts`, `styles.css` window enter.
- **Priority:** P1.

## Proposal 5 — Mobile as its own app, not a shrunk desktop

- **Problem:** At 375px the desk renders stacked overlapping rails, a
  wider-than-viewport Overview with horizontal scroll, a 595px dock in a 350px
  space, and hover-only affordances (peek, rail handles) with no touch
  equivalent (`docs/UX-REVIEW.md` UX-21/22/23/24).
- **Pattern/component:** Below 768px: single-column three-tab shell (**Needs
  you / Rooms / Activity**) + orb as FAB; full-screen room console with back
  button; tap-to-sheet replaces press-and-hold peek; swipe-to-decide with undo
  snackbar; keyboard hints hidden under `(pointer: coarse)`; safe-area insets.
- **Where it applies:** `App.tsx` responsive shell, `Dock`, `RoomWindow`,
  `Peek`, `InboxApp`, `styles.css` breakpoints.
- **Priority:** P1 (P0 for any mobile launch claim).

## Proposal 6 — Visual-system pass: type ramp, colour hierarchy, one icon language

- **Problem:** Four type steps inside a 2px range with 11px body copy; seven
  full-strength room hues competing with the "needs you" signal; three icon
  languages (typographic room marks, emoji agent faces, full-colour dock icons)
  that render inconsistently cross-platform (`docs/UX-REVIEW.md`
  UX-14/15/16; `web/src/styles.css` hard-coded sizes).
- **Pattern/component:** Five-step ramp tokens (20/17/15/13/11, body ≥13
  desktop / ≥15 mobile, 11 for numerics only); room colour demoted to glyph +
  3px edge, saturated hues reserved for state (amber/red/green); one 20px
  monoline SVG set for functional glyphs + portrait discs (initials) for human
  identity; calm gradient wallpaper default with contrast verified over
  extremes.
- **Where it applies:** `styles.css` tokens, Overview/rails/chits, `Dock`,
  `Wallpaper`, agent `Face` component.
- **Priority:** P1.

## Proposal 7 — Safer destructive controls (Stop-all confirm, consequence-first cards, touch targets)

- **Problem:** "Stop all" is an unconfirmed red menubar button; Approve/Reject
  are styled as equals with the blast-radius tag quietest on the card; several
  controls are below 44pt touch minimum (`docs/UX-REVIEW.md` UX-19/20/27;
  `web/src/apps/InboxApp.tsx`).
- **Pattern/component:** Confirm popover naming scope ("Stop 4 running agents
  in 3 rooms?") + 10s Undo/Resume, neutral styling until something runs;
  consequence-first card (full-width blast strip on top, separated Reject);
  28/36/44px control scale driven by `pointer: coarse`; `::after inset:-6px`
  hit expansion on rail glyphs/face chips.
- **Where it applies:** `MenuBar`, `InboxApp` card, `NeedsYouBar` (Proposal 1),
  `styles.css` control scale.
- **Priority:** P1.

## Proposal 8 — While-you-were-away + Work history (mandate-centric memory)

- **Problem:** Returning after absence costs a full desk scan; Activity is a
  raw event feed kept only as the thesis falsification control, while mandates
  (the operator's own sentences + outcomes + cost) have no browsable home
  (`docs/EXPERIENCE-PLAN.md` Flow 4 sketches the strip; feature 24 specifies
  Work history; `ListView` today).
- **Pattern/component:** `AwayStrip` ("2 need you · 1 blocked · 3 still
  working", dismisses on first keystroke) + dock **Work** view: mandates with
  sentence/room/chain/cost/outcome, expandable custody chain, ⌘F filter,
  Run-again and drag-past-mandate-onto-room to re-run; raw Activity feed moves
  to Settings.
- **Where it applies:** `Dock`, new `WorkApp`, `ListView`, `Supervisor`,
  `desktop/intent.ts` results store.
- **Priority:** P2.

## Proposal 9 — Cost-and-consequence ghost preview + live chain cost

- **Problem:** Drops commit blind: the operator cannot see agent-hour cost,
  queue position, touched tools, or whether a drop trips `approval_policy`
  before releasing (`docs/EXPERIENCE-PLAN.md` features 16/23 specify but are
  unbuilt; `App.tsx` `verdict()` already computes the data).
- **Pattern/component:** Carry ghost slab (12px below-right of ghost, 120ms
  dwell, 60ms crossfade on target change): projected hours, queue position,
  tools touched, approval pip with amber target ring; mandate chit counts up
  with 400ms tween, amber fill at 50% of quote, manager stops assigning at 100%
  with a clarify.
- **Where it applies:** `CarryLayer`, `lib/humanize.ts`, `Chit`, `RoomWindow`
  manager row.
- **Priority:** P2.

## Proposal 10 — Keyboard-first operations: shortcut sheet + scoped Escape + ⌘W

- **Problem:** `⌘K ⌘\ ⌥1–9 j/k/a/A/r/↵` exist but are undiscoverable; Escape
  closes the top window and can silently discard a half-filled New-room form
  (`docs/UX-REVIEW.md` UX-08/UX-12; `web/src/App.tsx:575`).
- **Pattern/component:** `?` shortcut sheet + menubar item + inline glyphs in
  tooltips; Escape scoped to transient surfaces (orb panel, peek, slide-over,
  active drag); ⌘W closes focused window; dirty-form confirm + "Closed X ·
  Undo" strip.
- **Where it applies:** `App.tsx` key handler, `MenuBar`, `NewRoom`,
  `SettingsApp`, queue key-hint line.
- **Priority:** P2.

## Top 5 by impact

1. Needs-you command bar — 1-click decisions from a cold desk (Proposal 1, P0).
2. Graceful offline/demo shell — stops the live site looking broken (Proposal 2, P0).
3. One home per room + content-sized Overview — ends double-rendering, fits all rooms (Proposal 3, P0).
4. Mobile as its own app — only path to a usable phone product (Proposal 5, P1).
5. Visual-system pass — legibility and signal hierarchy across every surface (Proposal 6, P1).
