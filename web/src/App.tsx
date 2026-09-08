import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveState, observe, post } from './lib/api';
import { useTheme } from './lib/theme';
import { usePerf } from './lib/perf';
import { loadDesktop, saveDesktop, loadSeen, saveSeen } from './lib/desktop';
import type { Room, Agent, Inbox, Task } from './lib/api';
import { useWindows, layout, SLIVER, type Win, type Rect, type AppKind, type Park } from './desktop/wm';
import { Window, dragging } from './desktop/Window';
import { Wallpaper } from './desktop/Wallpaper';
import { MenuBar } from './desktop/MenuBar';
import { Dock } from './desktop/Dock';
import { Sidebar } from './desktop/Sidebar';
import { SitDown } from './desktop/SitDown';
import { RoomWindowBody, ParkedRail } from './desktop/RoomWindow';
/**
 * Nothing below is on the path to the first paint. The desk — menu bar, dock, wallpaper,
 * room windows, the orb — is what has to arrive; a console, an agent's workspace or a
 * prop app is fetched the moment it is actually opened, and cached from then on.
 */
const AgentApp = lazy(() => import('./apps/AgentApp').then((m) => ({ default: m.AgentApp })));
const RoomApp = lazy(() => import('./apps/RoomApp').then((m) => ({ default: m.RoomApp })));
const SettingsApp = lazy(() => import('./apps/SettingsApp').then((m) => ({ default: m.SettingsApp })));
const FloorApp = lazy(() => import('./apps/FloorApp').then((m) => ({ default: m.FloorApp })));
const ListView = lazy(() => import('./components/ListView').then((m) => ({ default: m.ListView })));
const MusicApp = lazy(() => import('./apps/MusicApp').then((m) => ({ default: m.MusicApp })));
const RideApp = lazy(() => import('./apps/RideApp').then((m) => ({ default: m.RideApp })));
const MapsApp = lazy(() => import('./apps/MapsApp').then((m) => ({ default: m.MapsApp })));
import type { Skin } from './desktop/Supervisor';
import { CarryLayer } from './desktop/CarryLayer';
import { CourierLayer } from './desktop/CourierLayer';
import { wireCarry } from './desktop/carry';
import { send as courier, raise, decided, type Box } from './desktop/courier';
import { PeekLayer } from './desktop/Peek';
import { bloomOrb } from './desktop/Orb';
import { pitch, clearPitch, loadResults, saveResults, seenMandates, markSeen, type Result, type Clarify } from './desktop/intent';
import { routeRooms } from './desktop/commands';
import { requiredTools, tripsApproval, hours, toolName, askTitle } from './lib/humanize';
import type { CmdCtx } from './desktop/commands';

/** Where a thing is on screen right now, or null if it is not. */
const rectOf = (sel: string): Box | null => {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width && r.height && r.bottom > 0 && r.top < innerHeight ? r : null;
};
/** A worker's face — or, if its room is parked or shut, the rail standing in for it. */
const seatOf = (agentId: string, roomId: string) =>
  rectOf(`[data-agent="${CSS.escape(agentId)}"]`) ??
  rectOf(`.win.parked[data-win="roomwin:${CSS.escape(roomId)}"] .pk-rail`) ??
  rectOf(`[data-dock-room="${CSS.escape(roomId)}"]`);

const VIEW = 'desktop';
/**
 * A room opens where the floor plan puts it. The server already stores every room on a
 * four-column grid, so a room added today lands somewhere sensible too — and nothing
 * ever re-stacks the ones already on the desktop.
 */
const CENTRE_W = 900, CENTRE_H = 600;
const COLS = 4, PAD = 10, GAP = 12, ROOM_W = 320;
/** The room window's own furniture, in the sizes styles.css actually gives it. */
const BAR_H = 39, BODY_PAD = 18, MGR_ROW = 60, CREW_ROW = 48, ROW_GAP = 2;
/**
 * A room is as tall as its crew — a bar, a manager, a line per worker and room for the
 * strip of queued work. The floor plan gives the column; the desk decides how many rows
 * it can hold, and the rows that do not fit wrap into the next column instead of
 * falling off the bottom. Nothing ever lands where it cannot be reached.
 */
/**
 * How tall a room has to be to show its whole crew: measured against the stylesheet
 * rather than guessed — title bar, the body's own padding, the 60px manager row and a
 * 48px row per worker with a 2px gap between them. A room that opens one row short
 * slices its last worker in half at the window edge.
 */
const roomHeight = (crew: number, st: { h: number }) => {
  const need = BAR_H + BODY_PAD + MGR_ROW + Math.max(0, crew - 1) * CREW_ROW
             + Math.max(1, crew) * ROW_GAP;
  return Math.min(Math.max(190, need), Math.max(180, st.h - PAD * 2));
};

/**
 * `tallest` is the crew of the biggest room on the floor, and it — not this room —
 * sets the row pitch. Letting each room derive its own pitch from its own height puts
 * a three-person room and a two-person room on different grids, and they land on top
 * of each other.
 */
const tile = (r: Room, st: { w: number; h: number }, crew: number, tallest = crew) => {
  const usable = st.w - PAD * 2;
  // Below tablet width the floor plan's four columns would give every room 110px. One
  // column, full width, is the only honest thing to do with a desk that narrow.
  if (st.w < 720) {
    const h = roomHeight(crew, st);
    const pitch = roomHeight(Math.max(crew, tallest), st) + GAP;
    return { x: PAD, y: PAD + r.y * pitch, w: Math.max(240, usable), h };
  }
  const w = Math.round(Math.min(ROOM_W, Math.max(240, usable)));
  const h = roomHeight(crew, st);
  const pitch = roomHeight(Math.max(crew, tallest), st) + GAP;
  const perCol = Math.max(1, Math.floor((st.h - PAD) / pitch));
  const x = Math.round(PAD + (r.x / COLS) * usable) + Math.floor(r.y / perCol) * (w + GAP);
  const y = PAD + (r.y % perCol) * pitch;
  return {
    x: Math.max(PAD, Math.min(x, Math.max(PAD, st.w - w - PAD))),
    y: Math.max(0, Math.min(y, Math.max(0, st.h - h - PAD))),
    w, h,
  };
};

const restored = loadDesktop();

export default function App() {
  const snap = useLiveState();
  const { wins, open, close, focus, patch, patchAll } = useWindows(restored);
  const { theme, setTheme, resolved } = useTheme();
  const perf = usePerf();
  const stageRef = useRef<HTMLElement>(null);
  const [stage, setStage] = useState({ w: 1000, h: 640 });
  const [hint, setHint] = useState<Park | null>(null);
  const [guide, setGuide] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  // A closed window animates out before it stops existing, so it goes somewhere
  // rather than blinking off the desk.
  const [closing, setClosing] = useState<string[]>([]);
  const shut = useCallback((id: string) => {
    setClosing((c) => [...c, id]);
    setTimeout(() => { close(id); setClosing((c) => c.filter((x) => x !== id)); }, 150);
  }, [close]);
  const [sidebar, setSidebar] = useState(false);
  const [skin, setSkin] = useState<Skin>(() => {
    try { return (localStorage.getItem('atrium.orbSkin') as Skin) || 'well'; } catch { return 'well'; }
  });
  const [focusApproval, setFocusApproval] = useState<string | undefined>();
  /**
   * What the operator has not read yet. Results are not approvals and never become
   * them — they outlive a refresh, sit on the orb, and are counted in a second,
   * quieter badge that nothing on this desk treats as a decision.
   */
  const [results, setResults] = useState<Result[]>(loadResults);
  /** The badge lags the queue: it may only say what has already landed. */
  const [bell, setBell] = useState(0);
  /** Clarifies the operator pushed away, or let go quiet for a minute. */
  const [defer, setDefer] = useState<Set<string>>(() => new Set());
  /**
   * Who holds what, once the operator has aimed a task at a worker with their own hand.
   * The server has no reassign route, so the seat lives here — the gesture, the walk
   * down the spine and the eight seconds to take it back are all real either way.
   */
  const [seat, setSeat] = useState<Record<string, string>>({});
  const [undo, setUndo] = useState<{ room: string; text: string; run: () => void } | null>(null);
  const offer = useCallback((room: string, text: string, back: () => void) => {
    const it = { room, text, run: () => { back(); setUndo(null); } };
    setUndo(it);
    setTimeout(() => setUndo((u) => (u === it ? null : u)), 8000);
  }, []);

  /** False until the desk has been measured. Placing anything before that centres it in
   *  the assumed 1000x640, which on a real screen is up in the top-left corner. */
  const [measured, setMeasured] = useState(false);
  useLayoutEffect(() => {
    const el = stageRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setStage({ w: e.contentRect.width, h: e.contentRect.height });
      if (e.contentRect.width) setMeasured(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [snap !== null]);
  useEffect(() => { observe(VIEW, 'view.enter'); }, []);

  /**
   * Every app and every room opened to full size gets the same window, dead centre.
   * One canonical size means the operator's eye learns exactly one place to look, and a
   * second app does not arrive 22px down and to the right of the first.
   */
  const live = useRef<{ wins: Win[]; stage: { w: number; h: number }; agents: Agent[] }>(
    { wins: [], stage, agents: [] });
  live.current = { wins, stage, agents: snap?.agents ?? [] };
  const place = useCallback(() => {
    const { stage: st } = live.current;
    const w = Math.min(CENTRE_W, st.w - 32);
    const h = Math.min(CENTRE_H, st.h - 32);
    return { x: Math.round((st.w - w) / 2), y: Math.round((st.h - h) / 2), w, h };
  }, []);

  const openAgent = useCallback((a: Agent) => {
    observe(VIEW, 'agent.open', { agent: a.name });
    open({ id: `agent:${a.id}`, kind: 'agent', ref: a.id, title: `${a.name} — ${a.role}`,
           icon: a.avatar, color: a.color, ...place() });
  }, [open, place]);

  /**
   * A room arrives parked, on the side the floor plan already puts it. The desk you sit
   * down to is the rails and whatever you opened — not eight windows you have to clear
   * before you can see anything. It still carries the rect it would have tiled to, so
   * un-parking one puts it somewhere sensible rather than at the origin.
   */
  const openRoomWindow = useCallback((r: Room, parked = true) => {
    const by = new Map<string, number>();
    for (const a of live.current.agents) by.set(a.room_id, (by.get(a.room_id) ?? 0) + 1);
    const crew = by.get(r.id) ?? 0;
    const tallest = Math.max(1, ...by.values());
    const at = tile(r, live.current.stage, crew, tallest);
    open({ id: `roomwin:${r.id}`, kind: 'room', ref: r.id, title: r.name, icon: r.icon, color: r.color,
           plain: true, ...at,
           // the floor plan's own left and right columns, so seven rooms fit two rails
           ...(parked ? { park: (r.x < COLS / 2 ? 'left' : 'right') as Park,
                          home: { left: at.x, top: at.y, width: at.w, height: at.h } } : {}) });
  }, [open]);

  const openRoomConsole = useCallback((r: Room) => {
    observe(VIEW, 'room.open', { room: r.key });
    open({ id: `room:${r.id}`, kind: 'room', ref: r.id, title: r.name,
           icon: r.icon, color: r.color, ...place() });
  }, [open, place]);

  const launch = useCallback((k: AppKind) => {
    if (k === 'inbox') { setSidebar(true); return; }
    const meta: Record<string, [string, string, string]> = {
      floor:    ['🗺️', 'Overview', '#7f93b5'],
      list:     ['📜', 'Activity', '#7f93b5'],
      settings: ['⚙️', 'Settings', '#7f93b5'],
      music:    ['🎵', 'Music',    '#fb5c74'],
      ride:     ['🚗', 'Ride',     '#15181c'],
      maps:     ['📍', 'Maps',     '#2f9d63'],
    };
    const [icon, title, color] = meta[k];
    open({ id: k, kind: k, title, icon, color, ...place() });
  }, [open, place]);

  /**
   * Every room gets a window — including one created a minute ago. Nothing here knows
   * the shipped rooms from the ones the operator added; that is the whole point.
   */
  const known = useRef(new Set<string>(loadSeen()));
  const firstRun = useRef(restored.length === 0);
  useEffect(() => {
    if (!snap) return;
    snap.rooms.forEach((r) => {
      if (known.current.has(r.id)) return;
      known.current.add(r.id);
      openRoomWindow(r);
    });
    saveSeen(known.current);
    // Nothing saved means nobody has arranged this desk yet: give it the middle it is
    // missing. Once anything is saved, the arrangement is theirs and this stays out.
    if (firstRun.current && snap.rooms.length && measured) { firstRun.current = false; launch('floor'); }
  }, [snap?.rooms, openRoomWindow, launch, measured]);

  /**
   * A parked room is as tall as the room itself: title bar plus a row per crew member.
   * Scrubbing one open then changes only its width, and the stack never shifts.
   */
  const agentsOf = snap?.agents ?? [];
  const railHeight = useCallback((w: Win) => {
    const n = agentsOf.filter((a) => a.room_id === w.ref).length;
    return 54 + Math.max(1, n) * 44;
  }, [agentsOf]);
  /**
   * The desk is the boundary, at every size. A window restored from last week, or left
   * where a wider viewport used to be, is nudged back inside rather than stranded with
   * its title bar off the screen — the same rule a live drag already obeys.
   */
  useEffect(() => {
    if (stage.w < 200 || stage.h < 120) return;
    patchAll((w) => {
      if (w.park || w.max || w.min) return null;
      const width = Math.max(160, Math.min(w.w, stage.w - PAD * 2));
      const height = Math.max(120, Math.min(w.h, stage.h - PAD * 2));
      const x = Math.min(Math.max(0, w.x), Math.max(0, stage.w - width));
      const y = Math.min(Math.max(0, w.y), Math.max(0, stage.h - height));
      return x === w.x && y === w.y && width === w.w && height === w.h
        ? null : { x, y, w: width, h: height };
    });
  }, [stage.w, stage.h, patchAll]);

  const rects = useMemo(() => layout(wins, stage, railHeight), [wins, stage, railHeight]);
  useEffect(() => { saveDesktop(wins); }, [wins]);

  /**
   * A desk that changed size keeps its arrangement, but not at the cost of losing a
   * window off the edge of it. Saved geometry comes from whatever screen it was saved
   * on — a phone opening a layout arranged on a 1280px desktop would otherwise find
   * most of its windows past the right edge, unreachable and unfindable.
   *
   * Only on an actual change of stage size, so it never fights a drag.
   */
  const lastStage = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const prev = lastStage.current;
    lastStage.current = stage;
    if (!prev || (prev.w === stage.w && prev.h === stage.h) || !stage.w) return;
    for (const w of live.current.wins) {
      if (w.park || w.min || w.max) continue;
      const width = Math.min(w.w, Math.max(240, stage.w - 16));
      const height = Math.min(w.h, Math.max(150, stage.h - 16));
      const x = Math.max(-width + 130, Math.min(w.x, stage.w - 130));
      const y = Math.max(0, Math.min(w.y, stage.h - 36));
      if (width !== w.w || height !== w.h || x !== w.x || y !== w.y)
        patch(w.id, { x, y, w: width, h: height });
    }
  }, [stage.w, stage.h, patch]);

  const activeId = wins.filter((w) => w.kind === 'agent' && !w.min).sort((a, b) => b.z - a.z)[0]?.ref;

  const rooms = snap?.rooms ?? [];
  const tasks = useMemo(
    () => (snap?.tasks ?? []).map((t) => (seat[t.id] ? { ...t, agent_id: seat[t.id], state: 'working' as const } : t)),
    [snap?.tasks, seat]);
  const mandates = snap?.mandates ?? [];
  const openTask = useCallback((t: Task) => {
    const a = agentsOf.find((x) => x.id === t.agent_id);
    if (a) openAgent(a);
  }, [agentsOf, openAgent]);
  const recall = useCallback((id: string) => post(`/api/mandates/${id}/recall`), []);

  /**
   * A manager's question is not an approval and does not join the queue for one. It
   * lands in the orb's panel where one keystroke answers it — and if it is left to go
   * quiet for a minute it escalates itself into Needs-you, so it can be ignored but
   * never lost.
   */
  const inboxAll = snap?.inbox ?? [];
  const queue = useMemo(() => inboxAll.filter((i) => i.kind !== 'clarify' || defer.has(i.id)),
                        [inboxAll, defer]);
  const clarifies = useMemo<Clarify[]>(() => inboxAll
    .filter((i) => i.kind === 'clarify' && !defer.has(i.id))
    .map((i) => ({ id: i.id, question: i.action,
                   answers: (i.args?.answers ?? ['Yes', 'No']).map(String),
                   colour: rooms.find((r) => r.key === i.room_key)?.color ?? 'var(--blocked)',
                   at: new Date(i.created_at).getTime() })),
    [inboxAll, defer, rooms]);

  useEffect(() => {
    const live = clarifies.map((c) => c.id);
    if (!live.length) return;
    const ts = live.map((id) => setTimeout(() => setDefer((d) => new Set(d).add(id)), 60_000));
    return () => ts.forEach(clearTimeout);
  }, [clarifies.map((c) => c.id).join()]);

  const answerClarify = useCallback((c: Clarify, answer: string | null) => {
    if (answer === null) { setDefer((d) => new Set(d).add(c.id)); return; }
    post(`/api/approvals/${c.id}/decide`, { decision: 'approve', note: answer });
  }, []);

  /**
   * The sentence becoming a row. The capsule leaves the orb before the fetch resolves —
   * the operator committed, so the motion is already true; the route follows it.
   */
  const dispatch = useCallback(async (text: string, room: Room, from: DOMRect, mandate?: string) => {
    // The destination becomes visible before the work arrives: routing into a room the
    // operator cannot see is the same as losing it.
    const w = live.current.wins.find((x) => x.id === `roomwin:${room.id}`);
    if (!w) openRoomWindow(room);
    else if (w.min) patch(w.id, { min: false });
    courier({ from, room: room.id, colour: room.color, label: text, kind: 'instruction' });
    if (mandate) { post(`/api/mandates/${mandate}/route`, { room_key: room.key }); return; }
    const made = await post('/api/mandates', { text });
    const id = made?.mandate?.id;
    if (id) post(`/api/mandates/${id}/route`, { room_key: room.key });
  }, [openRoomWindow, patch]);

  /**
   * A raised approval is one flight, not two hops: the worker's chit goes up through
   * the manager's face — held there for a moment, because that is where accountability
   * changes hands — and lands on the bell. The badge counts it on impact.
   */
  const raisedIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!snap) return;
    const ids = new Set(queue.map((i) => i.id));
    if (raisedIds.current === null) { raisedIds.current = ids; setBell(ids.size); return; }
    const gone = [...raisedIds.current].filter((x) => !ids.has(x));
    const fresh = queue.filter((i) => !raisedIds.current!.has(i.id));
    raisedIds.current = ids;
    if (gone.length) setBell((b) => Math.max(0, b - gone.length));
    const to = rectOf('[data-bell]');
    for (const it of fresh) {
      const room = rooms.find((r) => r.key === it.room_key);
      const worker = agentsOf.find((a) => a.name === it.agent_name && a.room_id === room?.id);
      const mgr = agentsOf.find((a) => a.room_id === room?.id && a.tier === 'manager');
      const from = worker && room ? seatOf(worker.id, room.id) : null;
      if (!to || !from) { setBell((b) => b + 1); continue; }
      raise({ from, to, colour: room?.color ?? 'var(--blocked)', label: askTitle(it),
              via: mgr && room && mgr.id !== worker?.id ? seatOf(mgr.id, room.id) : null,
              onLand: () => setBell((b) => b + 1) });
    }
  }, [queue, rooms, agentsOf, snap !== null]);

  /**
   * A report landing. One capsule comes back up from the room, the orb's own ring
   * blooms once in the mandate's colour, and the sentence the operator spoke finally
   * has an answer attached to it.
   */
  const read = useRef<Set<string> | null>(null);
  useEffect(() => {
    const done = mandates.filter((m) => m.state === 'done' && m.report);
    if (read.current === null) {
      // First paint of a fresh browser: everything already finished is history, not news.
      read.current = new Set([...seenMandates(), ...done.map((m) => m.id)]);
      markSeen(read.current);
      return;
    }
    const fresh = done.filter((m) => !read.current!.has(m.id));
    if (!fresh.length) return;
    fresh.forEach((m) => read.current!.add(m.id));
    markSeen(read.current);
    setResults((rs) => {
      const n = [...fresh.map((m) => ({ id: m.id, mandate: m.text, text: m.report,
        colour: m.color ?? 'var(--working)', roomId: m.room_id, artifact: m.artifact_id, at: Date.now() })),
        ...rs].slice(0, 12);
      saveResults(n); return n;
    });
    const orb = rectOf('[data-orb]');
    fresh.forEach((m) => {
      const colour = m.color ?? 'var(--working)';
      const from = m.room_id
        ? rectOf(`[data-drop][data-room="${CSS.escape(m.room_id)}"]`)
          ?? rectOf(`.win.parked[data-win="roomwin:${CSS.escape(m.room_id)}"] .pk-rail`)
        : null;
      if (from && orb) courier({ from, to: orb, colour, kind: 'result' });
      setTimeout(() => bloomOrb(colour), from && orb ? 320 : 0);
    });
  }, [mandates]);

  /**
   * The chain, on hover. Every element that belongs to one mandate rings itself and
   * the rest of the desk steps back — one generated rule, no React render, and the
   * only place in this product where anything is dimmed.
   */
  useEffect(() => {
    const sheet = document.createElement('style');
    document.head.appendChild(sheet);
    let t = 0, pinned = false, at: string | null = null;
    const set = (id: string | null) => {
      const stg = stageRef.current;
      if (!stg || id === at) return;
      at = id;
      if (!id) { delete stg.dataset.trace; sheet.textContent = ''; return; }
      stg.dataset.trace = id;
      const q = `[data-mandate="${CSS.escape(id)}"]`;
      sheet.textContent =
        `.stage[data-trace] .win:has(${q}), .stage[data-trace] ${q} { opacity:1; }`
        + `.stage[data-trace] ${q} { box-shadow:0 0 0 1.5px var(--c, var(--working)); border-radius:8px; }`;
    };
    const over = (e: PointerEvent) => {
      if (pinned) return;
      const el = (e.target as HTMLElement)?.closest?.('[data-mandate]') as HTMLElement | null;
      clearTimeout(t);
      const id = el?.dataset.mandate;
      if (!id) { set(null); return; }
      t = window.setTimeout(() => set(id), 180);
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && at) pinned = true;
      if (e.key === 'Escape' && at) { pinned = false; set(null); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') { pinned = false; } };
    addEventListener('pointermove', over, { passive: true });
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => {
      clearTimeout(t);
      removeEventListener('pointermove', over);
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      sheet.remove();
    };
  }, []);

  /**
   * What the desk will and will not take, and what happens when it does.
   *
   * Legality is the room's tool grants against the work's required tools — the same
   * comparison the server enforces when the tool is actually called. Nothing here asks
   * for confirmation: the drop commits, and the room offers eight seconds to undo it.
   */
  useEffect(() => {
    const openOf = (t: Task) => t.state === 'queued' || t.state === 'working';
    wireCarry({
      verdict: (c, el) => {
        // The orb takes work and finds it a room. It refuses an approval out loud,
        // because the one thing the supervisor may never do is decide for you.
        if (el.dataset.orb !== undefined) {
          if (c.kind === 'approval') return { ok: false };
          const to = routeRooms(c.label, rooms)[0];
          return to ? { ok: true, slab: { cost: c.cost ?? '—', queue: `${to.name}, probably`,
                                          tools: (c.tools ?? []).map(toolName), approval: false } }
                    : { ok: false };
        }
        const room = rooms.find((r) => r.id === el.dataset.room);
        const agent = agentsOf.find((a) => a.id === el.dataset.agent);
        const onTask = tasks.find((t) => t.id === el.dataset.task);
        if (c.kind === 'agent') {
          // A worker onto a task: same room, and not one that has already stopped.
          const holder = agentsOf.find((a) => a.id === c.id);
          const home = el.closest<HTMLElement>('[data-room]')?.dataset.room;
          if (!onTask || !holder || onTask.agent_id === c.id) return { ok: false };
          // A worker only takes work in their own room: the tier moves, the scope does not.
          if (home !== holder.room_id) return { ok: false };
          if (holder && ['killed', 'failed'].includes(holder.state)) return { ok: false };
          const q = tasks.filter((t) => t.agent_id === c.id && openOf(t)).length;
          return { ok: true, slab: { cost: c.cost ?? '—', tools: requiredTools(onTask.title).map(toolName),
                                     queue: `${q + 1} in ${holder?.name ?? 'their'} queue`, approval: false } };
        }
        if (!room || room.status !== 'open') return { ok: false };
        if (agent && ['killed', 'failed'].includes(agent.state)) return { ok: false };
        // Handing work to the room that already owns it is not a destination: the grants
        // question only arises when the work would cross a permission boundary.
        const away = room.id !== c.roomId;
        if (agent?.tier === 'manager' && !away) return { ok: false };
        const tools = c.tools ?? [];
        if (away && !tools.every((t) => room.tool_grants.includes(t))) return { ok: false };
        const q = agent
          ? tasks.filter((t) => t.agent_id === agent.id && openOf(t)).length
          : tasks.filter((t) => openOf(t) && mandates.some((m) => m.id === t.mandate_id && m.room_id === room.id)).length;
        const approval = tripsApproval(room.approval_policy, tools);
        return { ok: true, approval, slab: {
          cost: c.cost ?? hours(Math.round(room.budget_cents - room.spent_cents) / 4),
          queue: `${q + 1} in ${agent ? agent.name : room.name}'s queue`,
          tools: tools.map(toolName), approval } };
      },

      commit: (c, el) => {
        const box = el.getBoundingClientRect();
        if (el.dataset.orb !== undefined) {
          const ranked = routeRooms(c.label, rooms);
          if (!ranked.length) return;
          pitch({ room: ranked[0], rooms: ranked, text: c.label, auto: 3000,
                  mandate: c.kind === 'mandate' ? c.id : tasks.find((t) => t.id === c.id)?.mandate_id });
          return;
        }
        const room = rooms.find((r) => r.id === el.dataset.room);
        const agent = agentsOf.find((a) => a.id === el.dataset.agent);
        const onTask = tasks.find((t) => t.id === el.dataset.task);

        const sit = (taskId: string, agentId: string, where: string) => {
          const was = tasks.find((t) => t.id === taskId)?.agent_id ?? null;
          setSeat((s) => ({ ...s, [taskId]: agentId }));
          offer(where, 'Handed to ' + (agentsOf.find((a) => a.id === agentId)?.name ?? 'a worker'),
                () => setSeat((s) => { const n = { ...s }; if (was) n[taskId] = was; else delete n[taskId]; return n; }));
        };

        if (c.kind === 'agent' && onTask) return sit(onTask.id, c.id, el.closest<HTMLElement>('[data-room]')?.dataset.room ?? '');

        // Dropped on a worker's face: the tier is not bypassed silently — the row draws
        // a dashed thread back up to the manager who is still accountable for it.
        if (c.kind === 'task' && agent && agent.tier !== 'manager' && room) {
          el.classList.add('threaded');
          setTimeout(() => el.classList.remove('threaded'), 900);
          return sit(c.id, agent.id, room.id);
        }

        // A mandate — or a task standing in for its mandate — handed to a room's manager.
        if (!room) return;
        const mid = c.kind === 'mandate' ? c.id : tasks.find((t) => t.id === c.id)?.mandate_id;
        const m = mandates.find((x) => x.id === mid);
        // The orb's uncommitted proposal, taken out of its mouth by hand: there is no
        // row yet, so the drop is what creates it.
        if (!m) {
          if (c.kind !== 'mandate') return;
          clearPitch();
          dispatch(c.label, room, box);
          return;
        }
        const from = m.room_id;
        courier({ from: box, room: room.id, colour: m.color || room.color, label: c.label, kind: 'instruction' });
        post(`/api/mandates/${m.id}/route`, { room_key: room.key });
        offer(from ?? room.id, `Handed to ${room.name}`, () => {
          const back = rooms.find((r) => r.id === from);
          if (back) post(`/api/mandates/${m.id}/route`, { room_key: back.key });
          else recall(m.id);
        });
      },
    });
  }, [rooms, agentsOf, tasks, mandates, offer, recall, dispatch]);

  /**
   * The shortcuts an operator's hands expect. Everything here is reachable by mouse
   * too — this is muscle memory, not a hidden second interface.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable);
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key === '\\') { e.preventDefault(); setSidebar((v) => !v); return; }
      // ⌥ and not ⌘: the browser owns ⌘1-9 for its tabs and will not give them up.
      // Read the physical key, because Option rewrites e.key into a symbol on macOS.
      const digit = /^Digit([1-9])$/.exec(e.code)?.[1] ?? /^[1-9]$/.exec(e.key)?.[0];
      if (digit && e.altKey && !cmd) {
        const r = (snap?.rooms ?? [])[Number(digit) - 1];
        if (!r) return;
        e.preventDefault();
        const w = wins.find((x) => x.id === `roomwin:${r.id}`);
        if (w) { patch(w.id, { park: null, min: false, ...(w.home && { x: w.home.left, y: w.home.top }) }); focus(w.id); }
        else openRoomWindow(r);
        return;
      }
      if (e.key === 'Escape' && !typing) {
        // Escape during a drag belongs to the drag — it cancels the gesture and nothing else.
        if (dragging()) return;
        // The orb's panel is the topmost surface and dismisses itself; the desk must not
        // also throw away the window the operator was watching underneath it.
        if (document.querySelector('.sup.open')) return;
        if (sidebar) { setSidebar(false); return; }
        const top = wins.filter((w) => !w.min && !w.park).sort((x, y) => y.z - x.z)[0];
        if (top) shut(top.id);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [snap?.rooms, wins, sidebar, patch, focus, shut, openRoomWindow]);

  const ctx: CmdCtx = useMemo(() => ({
    agents: snap?.agents ?? [], rooms: snap?.rooms ?? [], inbox: snap?.inbox ?? [],
    panic: !!snap?.config?.panic_stop,
    startAgent: (a) => post(`/api/agents/${a.id}/start`),
    killAgent: (a) => post(`/api/agents/${a.id}/kill`, { reason: 'supervisor' }),
    openAgent,
    openRoom: (r) => openRoomConsole(r),
    launch,
    setPanic: (on) => post('/api/panic', { on }),
    setTheme,
    setSidebar,
    focusApproval: setFocusApproval,
    dispatch,
  }), [snap, openAgent, openRoomConsole, launch, setTheme, dispatch]);

  /**
   * A decision going back down. The worker learns it from a dot that arrives, not from
   * a row that changes underneath it — and a parked room flashes its own colour so a
   * rail you cannot read still tells you something happened inside it.
   */
  const onDecide = useCallback((it: Inbox, decision: 'approve' | 'reject') => {
    const room = rooms.find((r) => r.key === it.room_key);
    const worker = agentsOf.find((a) => a.name === it.agent_name && a.room_id === room?.id);
    const from = rectOf('[data-bell]');
    const to = worker && room ? seatOf(worker.id, room.id) : null;
    if (!from || !to || !room) return;
    const el = document.querySelector<HTMLElement>(`[data-agent="${CSS.escape(worker!.id)}"]`)
      ?? document.querySelector<HTMLElement>(`.win.parked[data-win="roomwin:${CSS.escape(room.id)}"] .pk-rail`);
    decided(from, to, decision === 'approve', el);
  }, [rooms, agentsOf]);

  const onResult = useCallback((r: Result, what: 'open' | 'done') => {
    setResults((rs) => { const n = rs.filter((x) => x.id !== r.id); saveResults(n); return n; });
    if (what !== 'open') return;
    const room = rooms.find((x) => x.id === r.roomId);
    if (room) openRoomConsole(room);
  }, [rooms, openRoomConsole]);

  if (!snap) return <div className="boot">connecting…</div>;

  const needsMe = queue.length > 0 ||
    snap.agents.some((a) => ['awaiting_approval', 'blocked', 'failed'].includes(a.state));
  const roomOf = (w: Win) => snap.rooms.find((r) => r.id === w.ref)!;

  const topZ = Math.max(0, ...wins.filter((x) => !x.min).map((x) => x.z));
  const renderWin = (w: Win, rect: Rect | null) => {
    const peers = wins
      .filter((x) => x.id !== w.id && !x.min && !x.park && !x.max)
      .map((x) => rects.get(x.id))
      .filter(Boolean) as Rect[];
    const room = w.ref ? snap.rooms.find((r) => r.id === w.ref) : undefined;
    const crew = room ? snap.agents.filter((a) => a.room_id === room.id) : [];
    const attn = crew.some((a) => ['awaiting_approval', 'blocked', 'failed'].includes(a.state));
    return (
      <Window key={w.id} win={w} rect={rect} stage={stage} flag={`${attn ? 'needs ' : ''}${w.z === topZ ? '' : 'back'}${closing.includes(w.id) ? ' closing' : ''}`}
              onHint={setHint} peers={peers} onGuide={setGuide}
              rail={room
                ? <ParkedRail room={room} agents={crew} mandates={mandates} tasks={tasks} />
                : <div className="pk-rail plain" style={{ ['--room' as any]: w.color }} title={w.title}>
                    <span className="pk-icon">{w.icon}</span>
                    <span className="pk-name">{w.title}</span>
                  </div>}
              onFocus={() => focus(w.id)} onClose={() => shut(w.id)} onPatch={(p) => patch(w.id, p)}>
        {w.id.startsWith('roomwin:') && room &&
          <RoomWindowBody room={room} agents={crew} activeId={activeId} onAgent={openAgent}
                          mandates={mandates} tasks={tasks} onOpenTask={openTask}
                          onRecall={(m) => recall(m.id)}
                          undo={undo && undo.room === room.id ? undo : null} />}
        {/* One boundary per window, so a chunk still arriving never blanks the desk —
            only the inside of the window that is waiting for it. */}
        <Suspense fallback={<div className="pad muted">One moment…</div>}>
          {w.id.startsWith('room:') && room &&
            <RoomApp room={room} view={VIEW} mandates={snap.mandates ?? []}
                     tasks={snap.tasks ?? []} agents={snap.agents} />}
          {w.kind === 'agent' && <AgentApp agentId={w.ref!} />}
          {w.kind === 'floor' && <FloorApp rooms={snap.rooms} agents={snap.agents} mandates={snap.mandates ?? []}
                       tasks={snap.tasks ?? []} onOpen={openRoomConsole} />}
          {w.kind === 'list' && <ListView rooms={snap.rooms} agents={snap.agents} />}
          {w.kind === 'settings' && <SettingsApp rooms={snap.rooms} config={snap.config} perf={perf} theme={theme} setTheme={setTheme} />}
          {w.kind === 'music' && <MusicApp />}
          {w.kind === 'ride' && <RideApp />}
          {w.kind === 'maps' && <MapsApp />}
        </Suspense>
      </Window>
    );
  };

  return (
    <div className="os">
      <Wallpaper dark={resolved === 'dark'} />

      <MenuBar config={snap.config} inbox={queue} needsMe={needsMe} view={VIEW} skin={skin}
               theme={theme} setTheme={setTheme} ctx={ctx}
               sidebar={sidebar} onSidebar={setSidebar} onOpen={launch}
               bell={bell} results={results} clarifies={clarifies}
               onResult={onResult} onClarify={answerClarify} />

      <main className="stage" ref={stageRef}>
        <SitDown inbox={queue} agents={snap.agents} />
        {hint && <div className={`park-shelf ${hint}`} style={{ width: SLIVER }} />}
        {guide.x.map((x) => <i key={`gx${x}`} className="guide v" style={{ left: x }} />)}
        {guide.y.map((y) => <i key={`gy${y}`} className="guide h" style={{ top: y }} />)}
        {wins.map((w) => {
          const rect = rects.get(w.id);
          return rect ? renderWin(w, rect) : null;
        })}

        {!wins.length && (
          <div className="empty">
            <p>Drag a room anywhere; it stays where you drop it. Push one into a side gutter to park it.</p>
            <p className="muted">Ask the orb: “Atrium, what needs me?”</p>
          </div>
        )}
      </main>

      <Sidebar open={sidebar} inbox={queue} agents={snap.agents} rooms={snap.rooms} view={VIEW}
               mandates={mandates} onDecide={onDecide}
               onOpenRoom={(key) => { const r = snap.rooms.find((x) => x.key === key); if (r) openRoomConsole(r); }}
               focusId={focusApproval} onClose={() => setSidebar(false)} onPick={openAgent} />

      <CourierLayer />
      <CarryLayer />
      <PeekLayer />

      <Dock wins={wins} agents={snap.agents} inbox={queue} unread={results.length}
            rooms={snap.rooms.map((r) => ({ id: r.id, icon: r.icon, name: r.name, color: r.color }))}
            onLaunch={launch} onFocus={focus}
            onRoom={(id) => {
              const r = snap.rooms.find((x) => x.id === id)!;
              const w = wins.find((x) => x.id === `roomwin:${id}`);
              // Same as ⌥N: a tile click un-parks and gives the room back its own desk,
              // rather than raising a 72px sliver that still reads as nothing happening.
              if (w) { patch(w.id, { park: null, min: false, ...(w.home && { x: w.home.left, y: w.home.top, w: w.home.width, h: w.home.height }) }); focus(w.id); }
              else openRoomWindow(r);
            }} />
    </div>
  );
}
