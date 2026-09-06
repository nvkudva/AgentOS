import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveState, observe, post } from './lib/api';
import { useTheme } from './lib/theme';
import { usePerf } from './lib/perf';
import type { Room, Agent, Inbox } from './lib/api';
import { useWindows, layout, zonePreview, type Zone, type Win } from './desktop/wm';
import { Window } from './desktop/Window';
import { Wallpaper } from './desktop/Wallpaper';
import { MenuBar } from './desktop/MenuBar';
import { Dock } from './desktop/Dock';
import { Sidebar } from './desktop/Sidebar';
import { RoomWindowBody } from './desktop/RoomWindow';
import { AgentApp } from './apps/AgentApp';
import { RoomApp } from './apps/RoomApp';
import { InboxApp } from './apps/InboxApp';
import { SettingsApp } from './apps/SettingsApp';
import { FloorApp } from './apps/FloorApp';
import { ListView } from './components/ListView';
import type { CmdCtx } from './desktop/commands';

const VIEW = 'desktop';
/** Where each room parks itself the first time you open Atrium. */
const HOME: Record<string, 'left' | 'right'> = {
  analytics: 'left', engineering: 'left', marketing: 'left', sales: 'right', strategy: 'right',
};

export default function App() {
  const snap = useLiveState();
  const { wins, open, close, focus, patch } = useWindows();
  const { theme, setTheme, resolved } = useTheme();
  const perf = usePerf();
  const stageRef = useRef<HTMLElement>(null);
  const [stage, setStage] = useState({ w: 1000, h: 640 });
  const [zone, setZone] = useState<Zone>(null);
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

  const openAgent = useCallback((a: Agent) => {
    observe(VIEW, 'agent.open', { agent: a.name });
    open({ id: `agent:${a.id}`, kind: 'agent', ref: a.id, title: `${a.name} — ${a.role}`,
           icon: a.avatar, color: a.color, w: 700, h: 520 });
  }, [open]);

  const openRoomWindow = useCallback((r: Room, side?: 'left' | 'right') => {
    open({ id: `roomwin:${r.id}`, kind: 'room', ref: r.id, title: r.name, icon: r.icon, color: r.color,
           snappable: true, snap: side ?? null, w: 300, h: 210, x: 140, y: 110 });
  }, [open]);

  const openRoomConsole = useCallback((r: Room) => {
    observe(VIEW, 'room.open', { room: r.key });
    open({ id: `room:${r.id}`, kind: 'room', ref: r.id, title: `${r.name} — console`,
           icon: r.icon, color: r.color, w: 780, h: 540 });
  }, [open]);

  const launch = useCallback((k: 'floor' | 'list' | 'inbox' | 'settings') => {
    if (k === 'inbox') { setSidebar(true); return; }
    const meta: Record<string, [string, string, string]> = {
      floor: ['🗺️', 'Floor', '#7f93b5'], list: ['📜', 'Activity', '#7f93b5'], settings: ['⚙️', 'Settings', '#7f93b5'],
    };
    open({ id: k, kind: k, title: meta[k][1], icon: meta[k][0], color: meta[k][2],
           w: k === 'floor' ? 880 : 720, h: k === 'floor' ? 560 : 500 });
  }, [open]);

  // First boot: rooms park themselves on the rails, the way a desktop restores a layout.
  const booted = useRef(false);
  useEffect(() => {
    if (!snap || booted.current) return;
    booted.current = true;
    for (const r of snap.rooms) openRoomWindow(r, HOME[r.key] ?? 'left');
  }, [snap, openRoomWindow]);

  const rects = useMemo(() => layout(wins, stage), [wins, stage]);
  const preview = zonePreview(zone, stage);
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

        {wins.map((w) => {
          const rect = rects.get(w.id)!;
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
