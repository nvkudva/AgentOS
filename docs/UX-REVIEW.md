# Atrium — design review

**Reviewer:** senior product designer, Apple house standards (HIG, macOS/iPadOS window behaviour, iOS touch).
**Date:** 2026-09-12
**Builds reviewed:** local `main` working tree (Vite dev, demo snapshot) and production `https://agentos.nvkudva.workers.dev`.
**Viewports:** desktop 1440×900, mobile 375×812 (iPhone class). Light and dark.
**For:** the dev agent. Every item has an **Actions** block. Items are ordered by severity, and each is independently shippable.

---

## How this was reviewed

Cold first run (localStorage cleared) on both viewports, then the five journeys the product claims: *see what needs me*, *see what a room is doing*, *give a room work*, *approve or reject*, *add a room*. Console, network and computed styles were read alongside the pixels, so the numbers below are measured, not estimated.

## Verdict

The concept is strong and the craft in the details — the parked rails, the peek popover, the courier animations — is real. But the product currently fails the first test Apple applies to anything: **the primary path has to work, on the machine the customer actually has.** On the deployed site, two of the five journeys are dead: opening a room spins forever, and opening Activity white-screens the whole app permanently. Everything else in this document is refinement; §1 is not optional.

The second problem is that the desk shows the same seven rooms twice (rails *and* Overview cards) and answers "what needs me" third, behind an orb panel that covers the content on load. Attention is the scarcest thing an operator has, and the layout currently spends it on symmetry.

The third is density: 11px body copy, 32px controls, a 14-tile dock with three toy apps in it. It reads as a technical demo, not as a tool someone runs a company from.

---

## 1. P0 — broken on the live site

### UX-01 · Opening a room hangs forever, in production
**Severity:** blocker · **Where:** production, both viewports · `web/src/apps/RoomApp.tsx`, `web/src/lib/api.ts`
**Finding:** Click any room card on `agentos.nvkudva.workers.dev` and a full-size empty window opens with the text "One moment…" and stays that way. The desk itself is served from the frozen demo snapshot (`web/src/lib/demo.ts`), but the room console fetches `/api/rooms/:id`, which does not exist on the static Worker. The fetch fails, retries roughly every 1.5s, and never surfaces an error.
**Evidence:** prod, click "Engineering" → `One moment…` still present after 6s; locally the same path logged 28 failed requests to `/api/rooms/room_366519d8b1ca` in under a minute.
**Why it matters:** this is the second click a first-time visitor makes. The product appears broken before it has said anything about itself.
**Actions**
1. Make the demo snapshot answer drill-downs: when `useLiveState` falls back to `DEMO`, set a module-level `offline = true` and have `get()` resolve room/agent/list requests from the snapshot instead of the network.
2. Give every fetch a deadline (5s) and a terminal state. A window that cannot load shows a titled empty state — "This view needs the live server" + a *Retry* button — never an indefinite spinner.
3. Cap retries at 3 with backoff; stop the loop after that.
4. Replace the bare `One moment…` text with a skeleton that matches the room console's shape (manager row, strip, crew rows), so the window has form before it has data.
**Done when:** on the deployed site, clicking every room card shows real content within 500ms, offline or not.

### UX-02 · Activity white-screens the entire app, permanently
**Severity:** blocker · **Where:** production and local, both viewports · `web/src/components/ListView.tsx:19`, `web/src/lib/api.ts:46`
**Finding:** `get()` resolves `null` on any network failure; `ListView` does `feed.filter(...)` on that `null`, throws, and because there is no error boundary anywhere in `web/src`, React unmounts the whole tree. The screen goes blank white. The crashed window is already saved in `localStorage`, so **reloading re-opens it and crashes again** — the app is bricked for that visitor until they clear site data.
**Evidence:** prod → dock → Activity → `#root` has 0 children; reload → still 0 children. Console: `TypeError: Cannot read properties of null (reading 'filter')` in `<ListView>`.
**Why it matters:** an unrecoverable dead end reached in one click from the dock, on the live site.
**Actions**
1. Add an `<ErrorBoundary>` around each window body in `App.tsx`'s `renderWin`, so one broken app takes down one window, not the desk. Fallback: "This view stopped working" + *Reload this window* + *Close*.
2. Make `get()` type-honest: return `T | null` and have every caller handle null, or give it a `fallback` argument. Fix `ListView` to `const rows = feed ?? []`.
3. Wrap desktop restore in a try/catch that drops any window whose body threw on the previous run, so a crash can never persist across reloads.
4. Add a smoke test that mounts each app kind with a failing fetch and asserts the desk survives.
**Done when:** with the API switched off, every dock tile opens a window with a graceful empty state and the desk stays alive.

### UX-03 · "Add a room" is a dead end in the demo
**Severity:** high · **Where:** Settings → New room… · `web/src/apps/NewRoom.tsx:29`
**Finding:** the form blocks on `/api/catalog` and renders `One moment…` indefinitely when there is no server. The product's headline claim — "a room is data, not code" — is unreachable on the only build the public can touch.
**Actions**
1. Ship a static copy of the catalog (tools, jobs, access levels) with the bundle; use it whenever the API is unavailable.
2. In offline mode let the form run to completion and end with an honest terminal state: "Demo mode — this would create the *Legal* room with 3 tools and 2 agents", plus a summary of the room that *would* have been provisioned.
3. Never render a form's loading text where the form will be: use a skeleton of the form.
**Done when:** the New room flow can be completed end-to-end on the deployed demo.

### UX-04 · No demo-mode signal
**Severity:** high · **Where:** production, global
**Finding:** the deployed site is a frozen snapshot, but nothing says so. Buttons that write (Approve, Reject, Stop all, Save) appear fully live. The operator cannot tell whether they are looking at their company or at a mannequin.
**Actions**
1. Add a single, quiet status pill in the menubar: "Demo data — nothing here is live". One line, dismissible for the session, not a banner across the top.
2. In demo mode, write actions should not silently no-op: they should perform the optimistic UI change and then say "Demo — not saved" in the same undo strip the app already has (`.undo-strip`).
3. Mirror it on the empty desk copy so the first thing read on a bare desk explains the mode.
**Done when:** a first-time visitor knows within one glance whether the desk is live.

---

## 2. P1 — structure and click cost

### UX-05 · The same seven rooms are on screen twice
**Severity:** high · **Where:** desktop · `web/src/App.tsx` (`openRoomWindow`), `web/src/apps/FloorApp.tsx`
**Finding:** on first run every room opens as a parked rail on the left and right edges *and* appears as a card in the Overview window in the middle. Fourteen representations of seven things. The rails carry crew faces and a budget bar; the cards carry the same faces, the same budget, plus a sentence. Neither is authoritative and the eye has to check both.
**Actions**
1. Pick one home for a room at rest. Recommended: **Overview is the home**; rails are reserved for rooms the operator explicitly parks (drag to edge), starting empty.
2. On first run open Overview only, centred, at a size that fits all rooms (see UX-06). Keep the rails as a power-user affordance, discoverable through the drag the empty-desk copy already teaches.
3. When a room *is* parked, dim its Overview card's chrome slightly and show a small "parked" mark, so the two never look like two different rooms.
**Done when:** a cold start shows each room exactly once.

### UX-06 · Overview cannot show all the rooms it has
**Severity:** high · **Where:** desktop 1440×900 and mobile · `web/src/styles.css` (`.grid`, `.room`)
**Finding:** the grid is fixed `grid-auto-rows:196px`, four columns, cards spanning two — so seven rooms need four rows, and the window as opened shows three and a half. The seventh room (Research) is below the fold on a 900px-tall screen, with a lot of empty desk beneath the window.
**Actions**
1. Size the Overview window to its content on open: `min(rows × 196 + chrome, stage.h − 96)`.
2. Make the grid adaptive rather than fixed: `repeat(auto-fill, minmax(280px, 1fr))` with `grid-auto-rows: min-content`, cards sizing to their own content.
3. Add a compact density (cards at ~120px: name, one sentence, faces, bar) and let the window's own width choose between compact and comfortable. Do not add a density switch; let the layout decide.
**Done when:** at 1440×900 all seven rooms are visible without scrolling.

### UX-07 · Every window opens in exactly the same rectangle
**Severity:** high · **Where:** desktop · `web/src/App.tsx:149` (`place()`)
**Finding:** `place()` returns the identical centred rect for every window. Open Settings while Overview is open and the two are pixel-aligned; the new window is indistinguishable from a redraw of the old one, and in testing Settings appeared *behind* Overview with only its edges showing. macOS has cascaded new windows since 1984 for exactly this reason.
**Actions**
1. Cascade: offset each new window by (28, 28) from the last opened window, wrapping back to centre when it would leave the stage.
2. Guarantee front-most: a newly opened window always takes `z = ++seqZ` and focus, and if its id already exists, un-park/un-minimise it and bring it forward instead of re-placing it.
3. Give windows a short scale-and-fade in from 96% so "a new window appeared" is legible as motion, not as a repaint.
**Done when:** opening three windows in a row leaves three visibly distinct, individually clickable title bars.

### UX-08 · Escape destroys work with no undo
**Severity:** high · **Where:** global · `web/src/App.tsx:575`
**Finding:** pressing Escape closes the top window. During the review it silently discarded a half-filled New room form. On Apple platforms Escape cancels a *transient* thing (a popover, a sheet, a drag) — it does not close documents.
**Actions**
1. Scope Escape to transient surfaces only: orb panel, peek, slide-over, active drag. Remove "close the top window".
2. Use ⌘W for closing the focused window, matching every other Mac app.
3. Any window with unsaved input (New room, Settings edits) confirms before closing, and closing anything at all posts the existing undo strip: "Closed Settings · Undo".
**Done when:** Escape never destroys state that took typing to create.

### UX-09 · The one thing that needs the operator is two clicks away and behind a bell
**Severity:** high · **Where:** desktop and mobile · `web/src/desktop/{MenuBar,Sidebar}.tsx`
**Finding:** approvals live only in a slide-over. Reaching them means noticing a 12px bell badge in the menubar or finding the Approvals tile in a 14-tile dock, then clicking Approve. Meanwhile the room card that *caused* the approval says "Stopped, waiting on you." and offers no way to act. The product's stated purpose is "one place where decisions queue up" — it should be the loudest thing on the desk, not the quietest.
**Actions**
1. Put the decision where the evidence is: on a room card in the *needs* state, render the pending request inline with **Approve** / **Reject** and a "Details" affordance. One click to approve, from the surface the operator is already reading.
2. Promote the queue in the menubar from a bell glyph to a labelled, coloured pill: "1 needs you". Click opens the slide-over; the pill disappears at zero.
3. Add a persistent hairline strip along the top of the stage when anything is waiting, tinted with the room's colour, so the desk itself carries the signal even when every window is closed.
4. Keep the keyboard path (`⌘\`, then `a`) and surface it in the pill's tooltip.
**Done when:** approving the single pending item from a cold desk takes one click.

### UX-10 · The dock is 14 tiles, three of which are toys
**Severity:** medium · **Where:** desktop and mobile · `web/src/desktop/Dock.tsx`
**Finding:** Overview, Activity, Approvals, Settings, **Music, Ride, Maps**, then all seven rooms. The demo apps dilute a professional product and, on mobile, they push half the dock off-screen (measured: 595px of tiles in a 350px dock).
**Actions**
1. Remove Music / Ride / Maps from the shipped dock. If they are needed to prove the window manager, put them behind a "Sample apps" section in Settings.
2. Structure the dock in two zones with a divider: *tools* (Overview, Approvals, Activity, Settings) and *rooms*. Rooms in the dock are optional once UX-05 lands — consider dropping them entirely and reaching rooms through Overview.
3. Target 6–8 tiles. Anything beyond that belongs in Overview.
**Done when:** the dock fits without scrolling at 375px.

### UX-11 · Room drill-down loses the map
**Severity:** medium · **Where:** desktop
**Finding:** clicking a room card opens a console window on top of Overview at the same rect, hiding the very grid the operator was scanning. There is no back, no breadcrumb, and no indication which card was opened.
**Actions**
1. Open the room console offset from Overview (UX-07) so the grid stays partly visible, and mark the originating card as "open" with the room's accent.
2. Add a "‹ Overview" affordance in the room console's title bar that focuses the Overview window rather than closing anything.
3. Support arrow-key travel between rooms while a console is focused, so comparing rooms costs no clicks at all.
**Done when:** moving between two rooms' consoles costs one keystroke.

### UX-12 · Keyboard power is invisible
**Severity:** medium · **Where:** global · `web/src/App.tsx` key handler
**Finding:** `⌘K`, `⌘\`, `⌥1–9` and the queue's `j/k/a/A/r/↵` exist and are good, but nothing lists them. The only hint is an 11px grey line at the top of the queue — which is also shown on touch devices where it means nothing.
**Actions**
1. Add a shortcuts sheet on `?` and a "Keyboard shortcuts" item in the menubar.
2. Show shortcut glyphs inline in the menubar and dock tooltips (Overview ⌥1, Approvals ⌘\).
3. Hide the queue's key-hint line when the primary input is coarse (`matchMedia('(pointer: coarse)')`).
**Done when:** every shortcut is discoverable from the UI.

### UX-13 · The orb panel covers the desk on arrival
**Severity:** medium · **Where:** desktop and mobile · `web/src/desktop/Supervisor.tsx`
**Finding:** on load the supervisor panel is open over the top-centre of the stage, overlapping the Overview title bar (and, on mobile, a third of the screen). It is the first thing seen and it obscures the thing the operator came for.
**Actions**
1. On cold start show the orb collapsed with a one-line summary beneath it; expand on click, `⌘K`, or a genuinely new event.
2. Anchor the expanded panel below the menubar with an 8px gap and never let it overlap a window's title bar; shift the topmost window down if space is tight.
3. Auto-collapse after ~8s of no interaction, leaving the summary line.
**Done when:** the first screen is the desk, with the orb present but subordinate.

---

## 3. P2 — visual system

### UX-14 · The type ramp is too small and has too many steps
**Severity:** high · **Where:** global · `web/src/styles.css`
**Finding:** measured sizes in daily-use surfaces: 11px (`.room-obj`, `.room-more`, queue tags, section headings, key hints), 11.5px (`.room-now > p`), 12px (`.so-room`, mandate text), 13px (buttons, names). Four steps inside a 2px range is not a hierarchy — it is noise — and 11px grey-on-glass is below what a professional tool should ask of anyone's eyes.
**Actions**
1. Adopt a five-step ramp and use nothing else: 20 / 17 / 15 / 13 / 11. Body copy is 13 minimum on desktop, 15 on mobile; 11 is reserved for numeric metadata only.
2. Express it as tokens (`--fs-title`, `--fs-body`, `--fs-meta`) and replace every hard-coded `font-size` in `styles.css`.
3. Set body line-height 1.4 and cap measure at ~68 characters on room cards.
4. Re-check every muted colour against its actual glass background for 4.5:1; `--faint` on `--tint` currently fails in several places.
**Done when:** no interface text below 13px except tabular numerics.

### UX-15 · Seven accent colours, all at full strength, all at once
**Severity:** medium · **Where:** Overview, rails, chits
**Finding:** each room owns a hue, and the hue is applied to the icon, the faces, the chits, the progress bar and the card border. With seven rooms visible the desk has no colour hierarchy left, so the one colour that should mean something — "this needs you" — has to compete with six decorative ones.
**Actions**
1. Demote room colour to an identity mark: the room glyph and a 3px rail edge. Neutralise the crew faces, budget bars and chit fills.
2. Reserve saturated colour for state: amber = needs you, red = stopped, green = finished. Nothing else in the UI may use those three hues.
3. Tune the seven room hues to one lightness/chroma band so no room shouts louder than another, and verify each on both themes.
**Done when:** on a desk with nothing wrong, the brightest thing on screen is not a room colour.

### UX-16 · Three unrelated icon languages
**Severity:** medium · **Where:** global
**Finding:** rooms use typographic marks (◈ ⌘ ✎ ⛁), agents use multi-part emoji (🧑‍💼 👩‍🔬 👨‍💻), the dock uses full-colour app icons. Emoji render differently per platform, ignore the room's colour, and glow strangely on the dark theme. Three visual grammars is two too many.
**Actions**
1. Choose one system for functional glyphs — a 20px monoline set drawn as inline SVG — for rooms, tools and dock utilities.
2. Keep human personas as *portraits*, not glyphs: a coloured disc with initials, or a small illustrated avatar set. Emoji should not be load-bearing identity.
3. If emoji stay for now, wrap them in a fixed 22px circular container with a neutral background so they sit in a consistent optical box on both themes.
**Done when:** a screenshot on Windows Chrome and on macOS Safari looks like the same product.

### UX-17 · The wallpaper competes with the content
**Severity:** medium · **Where:** desktop and mobile · `web/src/desktop/Wallpaper.tsx`
**Finding:** an illustrated mountain range with a sun, trees and horizontal striations sits behind translucent windows. Edges from the illustration cut through card text; the dark variant's glow lands behind the rails.
**Actions**
1. Reduce the default wallpaper to a calm vertical gradient with a single soft light source, no drawn objects. Keep the illustration as an option in Settings.
2. Increase window material opacity (or add a backdrop scrim behind window bodies) so no wallpaper edge is ever visible through body copy.
3. Verify body text contrast over the *lightest* and *darkest* wallpaper regions, not the average.
**Done when:** no wallpaper detail is discernible through any text.

### UX-18 · Loading and empty states are one grey sentence
**Severity:** medium · **Where:** every lazy window
**Finding:** "One moment…" in 11px grey at the top-left of an otherwise blank 500×330 window. It reads as a bug even when it is working.
**Actions**
1. Build one `<Placeholder>` component with three modes — loading (skeleton), empty (icon + one line + one action), error (line + Retry) — and use it in every window body.
2. Skeletons must mirror the real layout (room console: manager row, strip, crew rows; Activity: five thread rows).
3. Never show a spinner for under 300ms; never show one for over 5s (see UX-01).
**Done when:** no window can ever be blank.

### UX-19 · Buttons and rows are below Apple's minimum target
**Severity:** medium · **Where:** queue, dock, rails
**Finding:** measured — Approve/Reject 32.5px tall, dock tiles 36×36, room rows in the slide-over 34px, the parked rail's room glyph 22px (and it is now the peek target). HIG asks for 44pt on touch and treats 28pt as the floor for pointer targets.
**Actions**
1. Set a control size scale: 28px (compact, pointer only) / 36px (default) / 44px (touch), driven by a `pointer: coarse` media query rather than viewport width.
2. Raise Approve/Reject to 36px on pointer and 44px on touch; give them 12px of separation so the destructive one is not adjacent to the safe one.
3. Expand hit areas without changing visuals via `::after { inset: -6px }` on rail glyphs and face chips.
**Done when:** every interactive element passes a 44×44 hit test on a phone.

### UX-20 · Approve and Reject are styled as equals
**Severity:** medium · **Where:** queue card · `web/src/apps/InboxApp.tsx`
**Finding:** a filled blue Approve sits beside an outlined red Reject, with the blast-radius tag ("Leaves the company") rendered smaller than both. The most consequential fact on the card is the quietest thing on it.
**Actions**
1. Lead the card with consequence: blast radius as a full-width tinted strip at the top — "Leaves the company · public channel" — then the request, then the buttons.
2. For high-blast actions require a deliberate confirm (hold-to-approve, or a second tap on a revealed "Yes, publish"), and always offer Undo for a short window afterwards.
3. Never place Approve and Reject adjacent without separation; put Reject on the left with a gap, or behind a "More" affordance for low-risk items.
**Done when:** a mis-tap cannot publish something outside the company.

---

## 4. P3 — mobile

### UX-21 · Mobile is the desktop, shrunk
**Severity:** blocker for mobile · **Where:** 375×812
**Finding:** at 375pt the desk renders seven parked rails stacked over both edges, overlapping each other and the Overview window, which itself is wider than the viewport and scrolls horizontally. The menubar truncates. The result is unusable, and it is what anyone opening the link on a phone sees first.
**Actions**
1. Below 768px, stop simulating a desktop: no rails, no free-floating windows, no dock overflow. Render a single-column app with three tabs — **Needs you**, **Rooms**, **Activity** — and the orb as a floating action button.
2. Rooms tab = the room cards in one column, full width, tappable to a full-screen room console with a standard back button.
3. Needs you tab = today's slide-over content, promoted to a first-class screen with the decision cards at 44pt controls.
4. Respect safe areas (`env(safe-area-inset-*)`) top and bottom; the current dock sits on the home indicator.
**Done when:** a phone user can approve an item and read a room without pinching, scrolling sideways, or meeting a window chrome.

### UX-22 · Mobile Overview card copy is unreadable in place
**Severity:** high · **Where:** 375×812
**Finding:** because the window is scaled rather than laid out, the card text renders at inconsistent optical sizes and lines run edge to edge with no margin; the progress bar and "9 tools" collide with the card border.
**Actions**
1. Rebuild the card as a responsive component (not a scaled desktop one): 16px padding, 15px title, 13px body, faces at 28px, footer as a two-column row.
2. Truncate the manager's report to two lines with a "More" tap; never let it push the crew row off the card.
3. Test at 320pt (SE) as well as 375pt.

### UX-23 · Touch has no equivalent for hover-only affordances
**Severity:** high · **Where:** mobile
**Finding:** the peek popover is a press-and-hold, the rail's drag-handle appears on hover, and the window's park hint is pointer-driven. On a phone these are invisible or fight the browser's own long-press.
**Actions**
1. On coarse pointers, replace press-and-hold peek with a tap that opens a proper sheet (the same content, at sheet scale).
2. Suppress hover-only chrome entirely below 768px rather than leaving it unreachable.
3. Add `touch-action: manipulation` and cancel the native context menu on custom long-press targets.

### UX-24 · The keyboard hint line ships to phones
**Severity:** low · **Where:** mobile queue
**Finding:** "j k move · a approve · A always · r reject · ↵ open room" occupies the top of the queue on a device with no keyboard.
**Actions:** hide it under `(pointer: coarse)`; on touch, show a swipe hint instead — swipe right to approve, left to reject — and implement those gestures with an undo snackbar.

---

## 5. P4 — language

### UX-25 · The same sentence on every card
**Severity:** medium · **Where:** Overview · `web/src/lib/progress.ts` (`roomDetail`)
**Finding:** six of seven cards end with the identical line "Acts alone inside the company; the rest waits for you." Repeated text stops being read after the second card and costs a line of card height on all of them.
**Actions**
1. Show the autonomy line only when it *differs* from the workspace default; otherwise state the default once, in Settings.
2. Replace it on the card with something room-specific: the last thing finished, or the next thing due.

### UX-26 · Numbers without anchors
**Severity:** low · **Where:** cards, rails, Settings
**Finding:** "13m of 6.7h", "9 tools", "1.9h of 5.0h" — a mix of units and unlabelled counts. "9 tools" is a capability count masquerading as a status.
**Actions**
1. One unit for budget everywhere (agent-hours, one decimal) with a label: "used 0.2h of 6.7h".
2. Move the tool count out of the card footer; it belongs in the room console's header where capability is the subject.
3. Right-align and tabular-figure every numeral so columns scan.

### UX-27 · "Stop all" is a red button in the menubar with no confirmation
**Severity:** medium · **Where:** menubar
**Finding:** the most destructive control in the product sits permanently in the top-right corner, styled in alert red, one click from every other action. Settings has a second one ("Stop everything") inline with routine controls.
**Actions**
1. Require a confirm — a small popover naming what will stop ("Stop 4 running agents in 3 rooms?") — then offer Undo/Resume for 10s.
2. Neutralise it visually until something is running; red is a state, not a decoration.
3. Remove the duplicate in Settings, or make both call one confirmed action.

---

## 6. Click cost — before and after

| Task | Today | After the changes above |
|---|---|---|
| Act on the one thing waiting, from a cold desk | 2–4 (find the bell → open queue → Approve; more if the queue is closed and the badge unnoticed) | **1** (Approve inline on the room card — UX-09) |
| See what a room is doing | 2 (Overview → card), broken in production | **1** (UX-01, UX-05) |
| Compare two rooms | 4+ (open, close, open, close) | **1 keystroke** (arrow between consoles — UX-11) |
| Give a room work | 1 click + typing (orb) — good today | keep, plus a per-room "Ask" that pre-targets the room |
| Add a room | 2 clicks + a 12-field form, dead in production | **2 clicks + 4 fields**, rest defaulted (UX-03) |
| Stop a runaway agent | unclear — via Stop all, which stops everything | **1** from the agent's row, with Undo (UX-27) |

---

## 7. Suggested order

1. **Ship first (a day):** UX-02 error boundary, UX-01 offline drill-down, UX-04 demo pill, UX-08 Escape. These stop the bleeding on the live site.
2. **Then (a week):** UX-05/06/07/09 — one home per room, an Overview that fits, cascading windows, decisions where the evidence is. This is the structural refactor that makes the product feel designed.
3. **Then:** UX-14/15/16/17/18/19/20 — the visual system pass. Do them together; a half-applied type ramp looks worse than none.
4. **Then:** UX-21..24 — mobile as its own design, not a scaled desk.
5. **Last:** UX-25/26/27 — language and safety polish.

## 8. Acceptance checklist

- [ ] With the API stopped, every dock tile and every room card opens a window with real content or an honest empty state; the desk never blanks.
- [ ] A reload after any failure returns a working desk.
- [ ] Cold start at 1440×900: all rooms visible, each represented once, orb collapsed, nothing overlapping a title bar.
- [ ] Three windows opened in sequence are individually visible and clickable.
- [ ] Approving the pending item from a cold desk takes one click; a high-blast action cannot be triggered by a single mis-tap.
- [ ] No interface text below 13px except numerics; all body text ≥ 4.5:1 over its actual background.
- [ ] At 375×812: single column, no horizontal scroll, no rails, dock fits, all targets ≥ 44pt, safe areas respected.
- [ ] Light and dark verified for every screen above.
