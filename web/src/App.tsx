import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveState, observe } from './lib/api';
import type { Room, Agent, Inbox } from './lib/api';
import { useWindows } from './desktop/wm';
import { Window } from './desktop/Window';
import { MenuBar } from './desktop/MenuBar';
import { TeamRail } from './desktop/TeamRail';
import { Dock } from './desktop/Dock';
import { AgentApp } from './apps/AgentApp';
import { RoomApp } from './apps/RoomApp';
import { InboxApp } from './apps/InboxApp';
import { SettingsApp } from './apps/SettingsApp';
import { FloorApp } from './apps/FloorApp';
import { ListView } from './components/ListView';

const VIEW = 'desktop';

export default function App() {
  const snap = useLiveState();
  const { wins, open, close, focus, patch } = useWindows();
  const stageRef = useRef<HTMLElement>(null);
  const [stage, setStage] = useState({ w: 900, h: 600 });
  const [focusApproval, setFocusApproval] = useState<string | undefined>();
  const fps = useFps();

  useLayoutEffect(() => {
    const el = stageRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [snap !== null]);

  useEffect(() => { observe(VIEW, 'view.enter'); }, []);

  const openAgent = (a: Agent & any) => {
    observe(VIEW, 'agent.open', { agent: a.name });
    open({ id: `agent:${a.id}`, kind: 'agent', ref: a.id, title: `${a.name} — ${a.role}`, icon: a.avatar, color: a.color, w: 700, h: 520 });
  };
  const openRoom = (r: Room & any) => {
    observe(VIEW, 'room.open', { room: r.key });
    open({ id: `room:${r.id}`, kind: 'room', ref: r.id, title: r.name, icon: r.icon, color: r.color, w: 760, h: 540 });
  };
  const launch = (k: 'floor' | 'list' | 'inbox' | 'settings') => {
    const meta = { floor: ['▦', 'Floor', '#8fa0b8'], list: ['☰', 'Activity', '#8fa0b8'],
                   inbox: ['📥', 'Approvals', '#a472e0'], settings: ['⚙', 'Settings', '#8fa0b8'] }[k];
    open({ id: k, kind: k, title: meta[1], icon: meta[0], color: meta[2],
           w: k === 'floor' ? 860 : 700, h: k === 'floor' ? 560 : 480 });
  };

  // Open the floor once on first load, the way a desktop restores its last window.
  const booted = useRef(false);
  useEffect(() => { if (snap && !booted.current) { booted.current = true; launch('floor'); } }, [snap]);

  const byId = useMemo(() => new Map((snap?.agents ?? []).map((a) => [a.id, a])), [snap?.agents]);
  if (!snap) return <div className="boot">connecting…</div>;

  const half = Math.ceil(snap.rooms.length / 2) - (snap.rooms.length > 3 ? 1 : 0);
  const left = snap.rooms.slice(0, half + 1);
  const right = snap.rooms.slice(half + 1);
  const activeId = wins.filter((w) => w.kind === 'agent' && !w.min).sort((a, b) => b.z - a.z)[0]?.ref;

  const pickApproval = (i: Inbox) => { setFocusApproval(i.id); launch('inbox'); };

  return (
    <div className="os">
      <MenuBar config={snap.config} inbox={snap.inbox} fps={fps} view={VIEW}
               needsMe={snap.inbox.length > 0 || snap.agents.some((a) => ['awaiting_approval', 'blocked', 'failed'].includes(a.state))}
               onOpen={launch} onPick={pickApproval} />

      <div className="body">
        <TeamRail side="left" rooms={left} agents={snap.agents} onRoom={openRoom} onAgent={openAgent} activeId={activeId} />

        <main className="stage" ref={stageRef}>
          {wins.map((w) => (
            <Window key={w.id} win={w} stage={stage} onFocus={() => focus(w.id)}
                    onClose={() => close(w.id)} onPatch={(p) => patch(w.id, p)}>
              {w.kind === 'agent' && <AgentApp agentId={w.ref!} />}
              {w.kind === 'room' && <RoomApp room={snap.rooms.find((r) => r.id === w.ref)!} view={VIEW} />}
              {w.kind === 'floor' && <FloorApp rooms={snap.rooms} agents={snap.agents} onOpen={openRoom} />}
              {w.kind === 'list' && <ListView rooms={snap.rooms} agents={snap.agents} />}
              {w.kind === 'inbox' && <InboxApp items={snap.inbox} view={VIEW} focusId={focusApproval} />}
              {w.kind === 'settings' && <SettingsApp rooms={snap.rooms} config={snap.config} />}
            </Window>
          ))}
          {!wins.length && (
            <div className="empty">
              <p>Pick a teammate on either side to open their work.</p>
              <p className="muted">Nothing coloured on the rails means nothing needs you.</p>
            </div>
          )}
        </main>

        <div className="rail-col">
          <TeamRail side="right" rooms={right} agents={snap.agents} onRoom={openRoom} onAgent={openAgent} activeId={activeId} />
          <section className={`needsyou${snap.inbox.length ? ' lit' : ''}`}>
            <header>Needs you <i>{snap.inbox.length}</i></header>
            {!snap.inbox.length && <p className="muted">Calm.</p>}
            {snap.inbox.slice(0, 4).map((i) => (
              <div className="mini" key={i.id} onClick={() => pickApproval(i)}>
                <b>{i.action}</b>
                <span>{i.room_name} · <span className="cost">{i.est_cost_cents}¢</span> · {(i.touches ?? [])[0] ?? ''}</span>
              </div>
            ))}
            {snap.inbox.length > 0 && <button className="wide" onClick={() => launch('inbox')}>Open approvals</button>}
          </section>
        </div>
      </div>

      <Dock wins={wins} agents={snap.agents} inbox={snap.inbox} onLaunch={launch} onFocus={focus} onClose={close} />
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
