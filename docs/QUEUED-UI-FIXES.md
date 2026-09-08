# Queued UI fixes

Raised while the experience workflow (WS3 + QA + fix) was still in flight, so they are
recorded here rather than built into a file two writers were already touching. Build these
once that run has landed and the tree compiles.

---

## 1. Dock icons crop on hover

The magnification wave scales a tile up, but something above it is clipping the result —
the enlarged icon is cut off rather than lifting cleanly out of the slab.

Likely `contain:paint` on `.dock` plus the slab's own `overflow`, which together make the
dock a containment box that a scaled child cannot escape. Fix the containment, not the
scale: the tile must be able to rise above the dock's top edge, and its hover label must
sit above that again. Check the first and last tiles too — they scale toward the slab's
rounded corners.

Files: `web/src/styles.css` (`.dock`, `.tile`, `.tile:hover::after`), `web/src/desktop/Dock.tsx`.

## 2. A room's console opens with a summary box

When a room opens into its chat/console window, the top of that window carries a summary
box: what this room is working on right now, stated in a sentence or two, not a feed.

It should answer, without scrolling: what the current mandate is, who is on it, how far
along it is, and whether anything is waiting on the operator. Written the way the rest of
the product writes — plain English, no jargon, no raw state names. It sits above the
existing content and stays put while the content below scrolls.

Files: `web/src/apps/RoomApp.tsx`, `web/src/styles.css`.

## 3. The orb should match the app

The orb currently reads as a separate artefact dropped onto the desktop. It should belong
to the same visual system as the windows, dock and rails: the same material, the same rim
and shadow vocabulary, the same restraint, and it must work in both themes.

Files: `web/src/desktop/Orb.tsx`, `web/src/desktop/Supervisor.tsx`, `web/src/styles.css`.

## 4. Orb and its panel are ONE object

The panel currently appears next to the orb as a separate surface. It must instead read as
the orb *expanding* — one continuous entity that grows into a panel and collapses back into
a sphere. The orb should feel like the panel's origin, not its neighbour: shared material,
a single transform, motion that starts at the sphere and unfolds outward.

Collapsing runs the same motion in reverse. Honour `prefers-reduced-motion`.

Files: `web/src/desktop/Supervisor.tsx`, `web/src/desktop/Orb.tsx`, `web/src/styles.css`.

## 5. The panel is a chat window, not a notification tray

Reframe the panel as the conversation with the supervisor: what you said, what it said
back, and what it is doing about it. It may *mention* notifications ("you have 3 waiting on
you") as something it says, but it is not a list of them — the approvals queue already
exists for that.

Files: `web/src/desktop/Supervisor.tsx`, `web/src/styles.css`.

## 6. Four styles for the orb + panel

Build four distinct treatments of the orb and its expanded panel, switchable so they can be
compared side by side, with a way to pick one. Four genuinely different directions, not one
design in four colours — they should differ in form, material and how the expansion moves.

Files: `web/src/desktop/Orb.tsx`, `web/src/desktop/Supervisor.tsx`, `web/src/styles.css`,
plus wherever the choice is persisted and switched.

## 7. A room expanding to a full window opens dead centre, at a fixed size

Every app and every expanded room opens at the same fixed dimensions, centred on the stage.
No cascade offset for these, no size derived from content — one canonical centre-window
size for now, applied uniformly.

This replaces the current `centreIn` cascade for that class of window; leave the small room
widgets and their parked rails alone.

Files: `web/src/App.tsx`, `web/src/desktop/wm.ts`.
