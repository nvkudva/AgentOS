import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveState, observe, post } from './lib/api';
import { useTheme } from './lib/theme';
import { usePerf } from './lib/perf';
import type { Room, Agent, Inbox } from './lib/api';
import { useWindows, layout, lanes, freeArea, centreIn, zonePreview, zoneAt, isCorner, type Zone, type Win, type Edge } from './desktop/wm';
import { Window } from './desktop/Window';
import { Wallpaper } from './desktop/Wallpaper';
import { MenuBar } from './desktop/MenuBar';
import { Dock } from './desktop/Dock';
import { Sidebar } from './desktop/Sidebar';
import { RoomWindowBody } from './desktop/RoomWindow';
import { LanePanel } from './desktop/LanePanel';
import { AgentApp } from './apps/AgentApp';
import { RoomApp } from './apps/RoomApp';
import { InboxApp } from './apps/InboxApp';
import { SettingsApp } from './apps/SettingsApp';
import { FloorApp } from './apps/FloorApp';
import { ListView } from './components/ListView';
import type { CmdCtx } from './desktop/commands';

const VIEW = 'desktop';
/** Rooms park on alternating rails, so a room added today lands somewhere sensible too. */
const side = (i: number): 'left' | 'right' => (i % 2 === 0 ? 'left' : 'right');

export default function App() {
  const snap = useLiveState();
  const { wins, open, close, focus, patch } = useWindows();
  const { theme, setTheme, resolved } = useTheme();
  const perf = usePerf();
  const stageRef = useRef<HTMLElement>(null);
  const [stage, setStage] = useState({ w: 1000, h: 640 });
  const [zone, setZone] = useState<Zone>(null);
  const [ghost, setGhost] = useState<{ win: Win; x: number; y: number } | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const [focusApproval, setFocusApproval] = useState<string | undefined>();
  const fps = useFps();

  useLayoutEffect(() => {
    const el = stageRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [snap !== null]);
  useEffect(() => { observe(VIEW, 'view.enter'); }, []);

  // Apps open in the middle of whatever desktop is free, never under a docked rail.
  const live = useRef<{ wins: Win[]; stage: { w: number; h: number } }>({ wins: [], stage });
  live.current = { wins, stage };
  const place = useCallback((w: number, h: number) => {
    const { wins: ws, stage: st } = live.current;
    const nth = ws.filter((x) => !x.snappable).length;
    const r = centreIn(freeArea(ws, st), w, h, nth);
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, []);

  const openAgent = useCallback((a: Agent) => {
    observe(VIEW, 'agent.open', { agent: a.name });
    open({ id: `agent:${a.id}`, kind: 'agent', ref: a.id, title: `${a.name} — ${a.role}`,
           icon: a.avatar, color: a.color, ...place(880, 560) });
  }, [open, place]);

  const openRoomWindow = useCallback((r: Room, side?: 'left' | 'right') => {
    open({ id: `roomwin:${r.id}`, kind: 'room', ref: r.id, title: r.name, icon: r.icon, color: r.color,
           snappable: true, snap: side ?? null, w: 300, h: 210, x: 140, y: 110 });
  }, [open]);

  const openRoomConsole = useCallback((r: Room) => {
    observe(VIEW, 'room.open', { room: r.key });
    open({ id: `room:${r.id}`, kind: 'room', ref: r.id, title: r.name,
           icon: r.icon, color: r.color, ...place(800, 560) });
  }, [open, place]);

  const launch = useCallback((k: 'floor' | 'list' | 'inbox' | 'settings') => {
    if (k === 'inbox') { setSidebar(true); return; }
    const meta: Record<string, [string, string, string]> = {
      floor: ['🗺️', 'Overview', '#7f93b5'], list: ['📜', 'Activity', '#7f93b5'], settings: ['⚙️', 'Settings', '#7f93b5'],
    };
    open({ id: k, kind: k, title: meta[k][1], icon: meta[k][0], color: meta[k][2],
           ...place(k === 'floor' ? 900 : 740, k === 'floor' ? 580 : 520) });
  }, [open, place]);

  /**
   * Every room gets a card on a rail — including one created a minute ago. Nothing here
   * knows the shipped rooms from the ones the operator added; that is the whole point.
   */
  const known = useRef(new Set<string>());
  useEffect(() => {
    if (!snap) return;
    snap.rooms.forEach((r, i) => {
      if (known.current.has(r.id)) return;
      known.current.add(r.id);
      openRoomWindow(r, side(i));
    });
  }, [snap?.rooms, openRoomWindow]);

  const rects = useMemo(() => layout(wins, stage), [wins, stage]);
  const ln = useMemo(() => lanes(wins, stage), [wins, stage]);
  const preview = zonePreview(zone, stage);

  /**
   * Dragging a room out of a lane. The section stays put and a ghost follows the
   * pointer, so the element under the cursor never unmounts mid-gesture.
   */
  const grab = useCallback((w: Win, e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const host = stageRef.current!.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      moved = true;
      setGhost({ win: w, x: ev.clientX, y: ev.clientY });
      setZone(zoneAt(ev.clientX - host.left, ev.clientY - host.top, stage));
    };
    const onUp = (ev: PointerEvent) => {
      removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp);
      setGhost(null); setZone(null);
      if (!moved) return;
      const z = zoneAt(ev.clientX - host.left, ev.clientY - host.top, stage);
      if (!z) patch(w.id, { snap: null, peek: null, x: ev.clientX - host.left - 90, y: ev.clientY - host.top - 12, w: 300, h: 210 });
      else if (isCorner(z)) patch(w.id, { peek: z, snap: null });
      else patch(w.id, { snap: z, peek: null });
      focus(w.id);
    };
    addEventListener('pointermove', onMove); addEventListener('pointerup', onUp);
  }, [stage, patch, focus]);
  const activeId = wins.filter((w) => w.kind === 'agent' && !w.min).sort((a, b) => b.z - a.z)[0]?.ref;

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

  return (
    <div className="os">
      <Wallpaper dark={resolved === 'dark'} />

      <MenuBar config={snap.config} inbox={snap.inbox} fps={fps} needsMe={needsMe} view={VIEW}
               theme={theme} setTheme={setTheme} ctx={ctx}
               sidebar={sidebar} onSidebar={setSidebar} onOpen={launch} />

      <main className="stage" ref={stageRef}>
        {preview && <div className="snap-preview" style={preview} />}

        {(['left', 'right', 'top', 'bottom'] as Edge[]).map((e) => {
          const l = ln[e]; if (!l) return null;
          return (
            <LanePanel key={e} edge={e} rect={l.rect} wins={l.wins} rooms={snap.rooms} agents={snap.agents}
                       activeId={activeId} onAgent={openAgent} onConsole={openRoomConsole} onGrab={grab}
                       onClose={close} />
          );
        })}

        {wins.map((w) => {
          const rect = rects.get(w.id);
          if (!rect) return null;              // it lives inside a lane panel
          const room = w.ref ? snap.rooms.find((r) => r.id === w.ref) : undefined;
          const horizontal = w.snap === 'top' || w.snap === 'bottom';
          return (
            <Window key={w.id} win={w} rect={rect} stage={stage} onZone={setZone}
                    onFocus={() => focus(w.id)} onClose={() => close(w.id)} onPatch={(p) => patch(w.id, p)}>
              {w.id.startsWith('roomwin:') && room &&
                <RoomWindowBody room={room} agents={snap.agents.filter((a) => a.room_id === room.id)}
                                horizontal={horizontal} activeId={activeId}
                                onConsole={openRoomConsole} onAgent={openAgent} />}
              {w.id.startsWith('room:') && room && <RoomApp room={room} view={VIEW} />}
              {w.kind === 'agent' && <AgentApp agentId={w.ref!} />}
              {w.kind === 'floor' && <FloorApp rooms={snap.rooms} agents={snap.agents} onOpen={openRoomConsole} />}
              {w.kind === 'list' && <ListView rooms={snap.rooms} agents={snap.agents} />}
              {w.kind === 'settings' && <SettingsApp rooms={snap.rooms} config={snap.config} perf={perf} theme={theme} setTheme={setTheme} />}
            </Window>
          );
        })}

        {ghost && (
          <div className="ghost" style={{ left: ghost.x - 90, top: ghost.y - 50, ['--c' as any]: ghost.win.color }}>
            <span>{ghost.win.icon}</span> {ghost.win.title}
          </div>
        )}

        {!wins.length && (
          <div className="empty">
            <p>Drag a room to any edge to dock it. Drop one in a corner to tuck it away.</p>
            <p className="muted">Ask the orb: “Atrium, what needs me?”</p>
          </div>
        )}
      </main>

      <Sidebar open={sidebar} inbox={snap.inbox} agents={snap.agents} rooms={snap.rooms} view={VIEW}
               focusId={focusApproval} onClose={() => setSidebar(false)} onPick={openAgent} />

      <Dock wins={wins} agents={snap.agents} inbox={snap.inbox}
            rooms={snap.rooms.map((r) => ({ id: r.id, icon: r.icon, name: r.name, color: r.color }))}
            onLaunch={launch} onFocus={focus}
            onRoom={(id) => {
              const r = snap.rooms.find((x) => x.id === id)!;
              const w = wins.find((x) => x.id === `roomwin:${id}`);
              if (w) { patch(w.id, { peek: null, min: false }); focus(w.id); } else openRoomWindow(r);
            }} />
    </div>
  );
}

function useFps() {
  const [fps, setFps] = useState(60);
  const n = useRef(0), t = useRef(performance.now());
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      n.current++;
      const now = performance.now();
      if (now - t.current >= 1000) { setFps(Math.round((n.current * 1000) / (now - t.current))); n.current = 0; t.current = now; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}
