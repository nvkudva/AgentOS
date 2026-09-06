import type { Win } from './wm';
import type { Agent, Inbox } from '../lib/api';

const APPS = [
  { kind: 'floor'    as const, icon: '🗺️', label: 'Floor' },
  { kind: 'list'     as const, icon: '📜', label: 'Activity' },
  { kind: 'inbox'    as const, icon: '📥', label: 'Approvals' },
  { kind: 'settings' as const, icon: '⚙️', label: 'Settings' },
];

/** A dock, in the Apple sense: a floating slab, magnified on hover, dots for what runs. */
export function Dock({ wins, agents, inbox, rooms, onLaunch, onFocus, onRoom }: {
  wins: Win[]; agents: Agent[]; inbox: Inbox[]; rooms: { id: string; icon: string; name: string; color: string }[];
  onLaunch: (k: 'floor' | 'list' | 'inbox' | 'settings') => void;
  onFocus: (id: string) => void;
  onRoom: (id: string) => void;
}) {
  const working = agents.filter((a) => a.state === 'working').length;
  const openApps = wins.filter((w) => w.kind === 'agent');
  return (
    <div className="dockwrap">
      <div className="dock">
        {APPS.map((a) => {
          const live = wins.some((w) => w.id === a.kind);
          return (
            <button key={a.kind} className="tile" onClick={() => onLaunch(a.kind)} data-label={a.label}>
              <span className="glyph">{a.icon}</span>
              {a.kind === 'inbox' && inbox.length > 0 && <i className="badge">{inbox.length}</i>}
              {live && <i className="run" />}
            </button>
          );
        })}
        <span className="dock-sep" />
        {rooms.map((r) => {
          const w = wins.find((x) => x.id === `room:${r.id}`);
          return (
            <button key={r.id} className="tile room" onClick={() => onRoom(r.id)} data-label={r.name}
                    style={{ ['--c' as any]: r.color }}>
              <span className="glyph">{r.icon}</span>
              {w && !w.min && <i className="run" />}
            </button>
          );
        })}
        {openApps.length > 0 && <span className="dock-sep" />}
        {openApps.map((w) => (
          <button key={w.id} className="tile" onClick={() => onFocus(w.id)} data-label={w.title}
                  style={{ ['--c' as any]: w.color }}>
            <span className="glyph">{w.icon}</span>
            <i className="run" />
          </button>
        ))}
      </div>
      <span className="dock-status">{working} working · {agents.length} agents</span>
    </div>
  );
}
