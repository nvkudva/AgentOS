import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveState, observe, post } from './lib/api';
import { useTheme } from './lib/theme';
import { usePerf } from './lib/perf';
import { loadDesktop, saveDesktop, loadSeen, saveSeen } from './lib/desktop';
import type { Room, Agent, Inbox } from './lib/api';
import { useWindows, layout, stageArea, centreIn, SLIVER, type Win, type Rect, type AppKind, type Park } from './desktop/wm';
import { Window } from './desktop/Window';
import { Wallpaper } from './desktop/Wallpaper';
import { MenuBar } from './desktop/MenuBar';
import { Dock } from './desktop/Dock';
import { Sidebar } from './desktop/Sidebar';
import { SitDown } from './desktop/SitDown';
import { RoomWindowBody, ParkedRail } from './desktop/RoomWindow';
import { AgentApp } from './apps/AgentApp';
import { RoomApp } from './apps/RoomApp';
import { InboxApp } from './apps/InboxApp';
import { SettingsApp } from './apps/SettingsApp';
import { FloorApp } from './apps/FloorApp';
import { ListView } from './components/ListView';
import { MusicApp } from './apps/MusicApp';
import { RideApp } from './apps/RideApp';
import { MapsApp } from './apps/MapsApp';
import type { CmdCtx } from './desktop/commands';

const VIEW = 'desktop';
/**
 * A room opens where the floor plan puts it. The server already stores every room on a
 * four-column grid, so a room added today lands somewhere sensible too — and nothing
 * ever re-stacks the ones already on the desktop.
 */
const COLS = 4, PAD = 10, GAP = 12, ROW = 222;
const tile = (r: Room, st: { w: number; h: number }) => {
  const usable = st.w - PAD * 2;
  return {
    x: Math.round(PAD + (r.x / COLS) * usable),
    y: PAD + r.y * ROW,
    w: Math.round(Math.min(320, (r.w / COLS) * usable - GAP)),
    h: 210,
  };
};

const restored = loadDesktop();

export default function App() {
  const snap = useLiveState();
  const { wins, open, close, focus, patch } = useWindows(restored);
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
  const [focusApproval, setFocusApproval] = useState<string | undefined>();

  useLayoutEffect(() => {
    const el = stageRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [snap !== null]);
  useEffect(() => { observe(VIEW, 'view.enter'); }, []);

  // Apps open in the middle of the desktop, cascading so the last one is never buried.
  const live = useRef<{ wins: Win[]; stage: { w: number; h: number } }>({ wins: [], stage });
  live.current = { wins, stage };
  const place = useCallback((w: number, h: number) => {
    const { wins: ws, stage: st } = live.current;
    const nth = ws.filter((x) => !x.plain).length;
    const r = centreIn(stageArea(st), w, h, nth);
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, []);

  const openAgent = useCallback((a: Agent) => {
    observe(VIEW, 'agent.open', { agent: a.name });
    open({ id: `agent:${a.id}`, kind: 'agent', ref: a.id, title: `${a.name} — ${a.role}`,
           icon: a.avatar, color: a.color, ...place(880, 560) });
  }, [open, place]);

  const openRoomWindow = useCallback((r: Room) => {
    open({ id: `roomwin:${r.id}`, kind: 'room', ref: r.id, title: r.name, icon: r.icon, color: r.color,
           plain: true, ...tile(r, live.current.stage) });
  }, [open]);

  const openRoomConsole = useCallback((r: Room) => {
    observe(VIEW, 'room.open', { room: r.key });
    open({ id: `room:${r.id}`, kind: 'room', ref: r.id, title: r.name,
           icon: r.icon, color: r.color, ...place(800, 560) });
  }, [open, place]);

  const launch = useCallback((k: AppKind) => {
    if (k === 'inbox') { setSidebar(true); return; }
    const meta: Record<string, [string, string, string, number, number]> = {
      floor:    ['🗺️', 'Overview', '#7f93b5', 900, 580],
      list:     ['📜', 'Activity', '#7f93b5', 740, 520],
      settings: ['⚙️', 'Settings', '#7f93b5', 740, 520],
      music:    ['🎵', 'Music',    '#fb5c74', 380, 520],
      ride:     ['🚗', 'Ride',     '#15181c', 380, 560],
      maps:     ['📍', 'Maps',     '#2f9d63', 460, 560],
    };
    const [icon, title, color, w, h] = meta[k];
    open({ id: k, kind: k, title, icon, color, ...place(w, h) });
  }, [open, place]);

  /**
   * Every room gets a window — including one created a minute ago. Nothing here knows
   * the shipped rooms from the ones the operator added; that is the whole point.
   */
  const known = useRef(new Set<string>(loadSeen()));
  useEffect(() => {
    if (!snap) return;
    snap.rooms.forEach((r) => {
      if (known.current.has(r.id)) return;
      known.current.add(r.id);
      openRoomWindow(r);
    });
    saveSeen(known.current);
  }, [snap?.rooms, openRoomWindow]);

  /**
   * A parked room is as tall as the room itself: title bar plus a row per crew member.
   * Scrubbing one open then changes only its width, and the stack never shifts.
   */
  const agentsOf = snap?.agents ?? [];
  const railHeight = useCallback((w: Win) => {
    const n = agentsOf.filter((a) => a.room_id === w.ref).length;
    return 54 + Math.max(1, n) * 44;
  }, [agentsOf]);
  const rects = useMemo(() => layout(wins, stage, railHeight), [wins, stage, railHeight]);
  useEffect(() => { saveDesktop(wins); }, [wins]);

  const activeId = wins.filter((w) => w.kind === 'agent' && !w.min).sort((a, b) => b.z - a.z)[0]?.ref;

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
      const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
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
  }), [snap, openAgent, openRoomConsole, launch, setTheme]);

  if (!snap) return <div className="boot">connecting…</div>;

  const needsMe = snap.inbox.length > 0 ||
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
              rail={room && <ParkedRail room={room} agents={crew} />}
              onFocus={() => focus(w.id)} onClose={() => shut(w.id)} onPatch={(p) => patch(w.id, p)}>
        {w.id.startsWith('roomwin:') && room &&
          <RoomWindowBody room={room} agents={crew} activeId={activeId} onAgent={openAgent} />}
        {w.id.startsWith('room:') && room && <RoomApp room={room} view={VIEW} />}
        {w.kind === 'agent' && <AgentApp agentId={w.ref!} />}
        {w.kind === 'floor' && <FloorApp rooms={snap.rooms} agents={snap.agents} onOpen={openRoomConsole} />}
        {w.kind === 'list' && <ListView rooms={snap.rooms} agents={snap.agents} />}
        {w.kind === 'settings' && <SettingsApp rooms={snap.rooms} config={snap.config} perf={perf} theme={theme} setTheme={setTheme} />}
        {w.kind === 'music' && <MusicApp />}
        {w.kind === 'ride' && <RideApp />}
        {w.kind === 'maps' && <MapsApp />}
      </Window>
    );
  };

  return (
    <div className="os">
      <Wallpaper dark={resolved === 'dark'} />

      <MenuBar config={snap.config} inbox={snap.inbox} needsMe={needsMe} view={VIEW}
               theme={theme} setTheme={setTheme} ctx={ctx}
               sidebar={sidebar} onSidebar={setSidebar} onOpen={launch} />

      <main className="stage" ref={stageRef}>
        <SitDown inbox={snap.inbox} agents={snap.agents} />
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

      <Sidebar open={sidebar} inbox={snap.inbox} agents={snap.agents} rooms={snap.rooms} view={VIEW}
               onOpenRoom={(key) => { const r = snap.rooms.find((x) => x.key === key); if (r) openRoomConsole(r); }}
               focusId={focusApproval} onClose={() => setSidebar(false)} onPick={openAgent} />

      <Dock wins={wins} agents={snap.agents} inbox={snap.inbox}
            rooms={snap.rooms.map((r) => ({ id: r.id, icon: r.icon, name: r.name, color: r.color }))}
            onLaunch={launch} onFocus={focus}
            onRoom={(id) => {
              const r = snap.rooms.find((x) => x.id === id)!;
              const w = wins.find((x) => x.id === `roomwin:${id}`);
              if (w) { patch(w.id, { min: false }); focus(w.id); } else openRoomWindow(r);
            }} />
    </div>
  );
}
