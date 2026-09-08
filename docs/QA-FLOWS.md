# Interaction flows to test

Every interaction the desktop actually implements, as steps a tester can follow. The app
runs at http://localhost:5173 with its API on 8788.

Ground rule for judging: **direct manipulation must be real.** A drag tracks the pointer
1:1, a window lands exactly where it is released, and nothing re-arranges itself around
you. Data may be canned; gestures may not.

---

## A. Windows

1. **Drag by the title bar.** Press the bar, move slowly, release. The window follows the
   pointer exactly and stays where released. No snap-back, no offset from the grab point.
2. **Drag fast.** Same, moving quickly across the desk. The window keeps up and does not
   detach from the cursor.
3. **Drag past each edge.** Off the top, bottom, left, right. It clamps so a grabbable
   strip stays on screen; it never disappears entirely.
4. **Escape mid-drag.** Start a drag, press Escape before releasing. The window returns to
   where it started and no park is armed.
5. **Resize from all eight handles.** Each edge and each corner. The dragged side moves,
   the opposite side stays pinned, and the window cannot be pulled through the desk edges.
6. **Resize to the minimum.** Drag an edge inward past the limit; it stops rather than
   inverting or collapsing.
7. **Alignment guides.** Drag one window so an edge comes within ~6px of another window's
   edge, and separately near the desk's centre lines. It snaps and a hairline shows while
   it holds; the hairline clears on release.
8. **Hover to front.** With a large window (Overview) covering others, hover a room window
   or a parked rail. It comes above everything on the desk — but never above the menu bar
   or dock.
9. **Close.** Red light closes a room. App windows also have yellow (minimise) and green
   (zoom). Lights are grey until the window is hovered or frontmost.
10. **Double-click the title bar** of an app window: maximises and restores. Room windows
    do not zoom.
11. **Persistence.** Arrange several windows, park one, close one, reload the page.
    Positions, sizes, stacking, what was parked and what was closed all come back.

## B. Parking

12. **Park left and right.** Drag a room window into the 28px gutter at either side and
    release. It tucks to a 72px rail carrying the room's icon, its crew faces with status
    dots, and a budget hairline.
13. **Release in the gutter without pausing.** It still parks — the dwell only governs when
    the shelf preview appears.
14. **Brush the edge in passing.** Drag across the gutter without releasing there. It must
    not park.
15. **Scrub a rail.** Hover a parked rail. It widens to show the room, at the *same height*
    — the rails below it must not shift. Leaving re-tucks it.
16. **Un-park by click**, and separately **by dragging the rail away**. Both restore the
    window to the rect it had before it was parked, under the same grab point.
17. **Several rails on one edge.** Park three or four rooms on the same side. They stack
    with gaps and only overlap once the edge runs out.
18. **Park a non-room window** (Music, Maps). It gets a rail with its icon and name, not a
    blank sliver.

## C. Dock

19. **Magnification.** Move along the dock. Tiles scale on a falloff curve, neighbours
    included, and the enlarged tile rises **clear of the slab, uncropped** — including the
    first and last tiles.
20. **Labels.** Hover a tile; its name appears above it, not clipped.
21. **Launch each app**: Overview, Activity, Approvals, Settings, Music, Ride, Maps. Each
    opens centred at the same fixed size.
22. **Room tiles** reopen or focus that room's window, including one that was closed.
23. **Indicators.** The running dot under open apps and the count badge on Approvals.

## D. The supervisor orb

24. **⌘K** opens the panel with the composer focused. The panel grows out of the orb as one
    object — the orb stays put at its top.
25. **Type an instruction** ("run analytics on last quarter churn") and press Return. A
    proposal appears naming a room and a quote, then the work is dispatched.
26. **← and →** on a standing proposal change the room it is aimed at.
27. **Escape** on a standing proposal forgets it; Escape otherwise closes the panel.
28. **Click outside** the panel — anywhere on the desk — closes it. Clicking *inside* it
    does not.
29. **A result card**: one click opens it and clears it. No buttons anywhere in the panel.
30. **A clarify card** lists numbered answers; typing "2" or "two" or the answer text
    answers it.
31. **Conversation shape.** What you said sits right, what it said back sits left, and the
    newest exchange is in view.
32. **Click the orb** to start listening. The mic may be blocked in this browser — note it,
    do not treat it as a bug.

## E. Approvals

33. **⌘\\** opens and closes the queue. Escape closes it.
34. **j / k** move the selection; it holds its position when the queue re-sorts.
35. **a** approves, **A** approves-and-remembers, **r** rejects, **⏎** opens the room.
36. **Swipe a card** right to approve, left to reject. It follows the hand, the uncovered
    edge fills with the verb's colour, and only past ~88px does releasing commit.
37. **Swipe and release short** of the commit distance: it springs back and nothing happens.
38. **Scroll the queue** by dragging vertically on a card — the card must not move sideways.
39. **Undo.** After any decision an undo strip replaces the card for 8s; pressing Undo
    cancels it. Left alone, it commits and the card leaves.
40. **Long-press a card** to pick it up as a carried thing. Dropping it on the orb must be
    refused — a supervisor may carry an approval and may never make one.

## F. Rooms

41. **A room window** lists its manager first, then its crew, each with a live status dot.
42. **Click a crew member** to open that agent's workspace.
43. **Open a room console** by clicking a card in Overview. It opens with a summary box
    above the tabs: the instruction, how far along, and whether it is waiting on you.
44. **Every console tab**: Activity, Files, Spending, History, Permissions.
45. **Start / Pause** an agent from the console header.

## G. Overview

46. Each card shows the room's current instruction, one sentence of progress, and the crew
    as faces — **no per-agent chat lines**.
47. A room that is waiting on you is marked, and the face that is stuck carries a ring.
48. Clicking a card opens that room's console.

## H. The prop apps

49. **Music**: play/pause, previous/next, click the scrubber to seek, pick a track from the
    list. The progress bar advances while playing.
50. **Ride**: edit pickup and destination, pick a tier, Request, then Cancel. The countdown
    runs.
51. **Maps**: type in search to filter pins, click a pin and a list row, zoom in and out.

## I. Menu bar

52. **Overview / Activity / Settings** open their windows. **Glance** runs its test.
53. **Theme toggle** cycles light → dark → auto. Every surface follows, including the orb
    panel, the rails and the dock.
54. **The bell** opens the queue and carries the waiting count.
55. **Stop all** halts everything and becomes Resume.

## J. Keyboard

56. **⌥1–9** focuses that room, un-parking it if it is on a rail.
57. **Escape** with nothing else open closes the front window.
58. Shortcuts must not fire while typing in a field.

## K. Theme and motion

59. Check the whole desk in **light and dark**: windows, rails, dock, orb panel, cards,
    the approvals queue. Nothing illegible, nothing dark-on-dark.
60. **Reduced motion**: with it enabled, travel and spin animations stop but state colours
    and cross-fades remain.
