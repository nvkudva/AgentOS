import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveState, post, observe } from './lib/api';
import type { Room } from './lib/api';
import { RoomWidget } from './components/RoomWidget';
import { InboxStrip } from './components/Inbox';
import { RoomDetail } from './components/RoomDetail';
import { ListView } from './components/ListView';
import { GlanceTest } from './components/GlanceTest';

const params = new URLSearchParams(location.search);
const STRESS = Number(params.get('stress') ?? 0);   // ?stress=30 clones widgets to measure fps

export default function App() {
  const snap = useLiveState();
  const [view, setView] = useState<'floor' | 'list'>(
    (localStorage.getItem('atrium.view') as any) ?? 'floor');
  const [open, setOpen] = useState<Room | null>(null);
  const fps = useFps();

  useEffect(() => { localStorage.setItem('atrium.view', view); observe(view, 'view.enter'); }, [view]);

  const byRoom = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const a of snap?.agents ?? []) { (m.get(a.room_id) ?? m.set(a.room_id, []).get(a.room_id)!).push(a); }
    return m;
  }, [snap?.agents]);

  if (!snap) return <div className="calm" style={{ padding: 24 }}>connecting…</div>;

  const rooms = STRESS
    ? Array.from({ length: STRESS }, (_, i) => ({ ...snap.rooms[i % snap.rooms.length],
        id: `${snap.rooms[i % snap.rooms.length].id}#${i}`, w: 1, h: 1, name: `${snap.rooms[i % snap.rooms.length].name} ${i}` }))
    : snap.rooms;

  const cfg = snap.config;
  const gp = Math.min(100, (cfg.global_spent_cents / Math.max(1, cfg.global_budget_cents)) * 100);
  const needsMe = snap.inbox.length > 0 ||
    snap.agents.some((a) => a.state === 'awaiting_approval' || a.state === 'blocked' || a.state === 'failed');

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">Atrium</span>
        <div className="tabs">
          <span className={`tab ${view === 'floor' ? 'on' : ''}`} onClick={() => setView('floor')}>Floor</span>
          <span className={`tab ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}>List</span>
        </div>
        <span className="spacer" />
        <span className="meter" title="frames per second">{fps} fps · {rooms.length} rooms</span>
        <span className="meter">
          global
          <span className={`bar${gp > 95 ? ' over' : gp > 70 ? ' warn' : ''}`}><i style={{ width: `${gp}%` }} /></span>
          ${(cfg.global_spent_cents / 100).toFixed(2)} / ${(cfg.global_budget_cents / 100).toFixed(2)}
        </span>
        <GlanceTest view={view} truth={needsMe} />
        <button className={cfg.panic_stop ? 'primary' : 'danger'}
                onClick={() => post('/api/panic', { on: !cfg.panic_stop })}>
          {cfg.panic_stop ? 'Resume all' : 'Stop everything'}
        </button>
      </div>

      {view === 'floor' ? (
        <div className="floor">
          <div className="grid" style={{ ['--cols' as any]: STRESS ? 6 : 4 }}>
            {rooms.map((r) => (
              <RoomWidget key={r.id} room={r} agents={byRoom.get(r.id.split('#')[0]) ?? []} onOpen={setOpen} />
            ))}
          </div>
        </div>
      ) : (
        <ListView rooms={snap.rooms} agents={snap.agents} />
      )}

      <InboxStrip items={snap.inbox} view={view} />
      {open && <RoomDetail room={snap.rooms.find((r) => r.id === open.id.split('#')[0])!} view={view} onClose={() => setOpen(null)} />}
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
