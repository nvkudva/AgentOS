import { useRef } from 'react';
import type { Win, AppKind } from './wm';
import type { Agent, Inbox } from '../lib/api';
import { AppIcon, type IconName } from './AppIcon';

const APPS: { kind: AppKind; icon: IconName; label: string }[] = [
  { kind: 'floor',    icon: 'overview', label: 'Overview' },
  { kind: 'list',     icon: 'activity', label: 'Activity' },
  { kind: 'inbox',    icon: 'inbox',    label: 'Approvals' },
  { kind: 'settings', icon: 'settings', label: 'Settings' },
];

/** The rest of the desk: props, so the OS is not the only thing on it. */
const EXTRAS: { kind: AppKind; icon: IconName; label: string }[] = [
  { kind: 'music', icon: 'music', label: 'Music' },
  { kind: 'ride',  icon: 'ride',  label: 'Ride' },
  { kind: 'maps',  icon: 'maps',  label: 'Maps' },
];

/** A dock, in the Apple sense: a floating slab, magnified on hover, dots for what runs. */
export function Dock({ wins, agents, inbox, unread = 0, rooms, onLaunch, onFocus, onRoom }: {
  wins: Win[]; agents: Agent[]; inbox: Inbox[];
  /** results nobody has read — never approvals, and counted separately so they cannot be mistaken for them */
  unread?: number; rooms: { id: string; icon: string; name: string; color: string }[];
  onLaunch: (k: AppKind) => void;
  onFocus: (id: string) => void;
  onRoom: (id: string) => void;
}) {
  const working = agents.filter((a) => a.state === 'working').length;
  const openApps = wins.filter((w) => w.kind === 'agent');
  const bar = useRef<HTMLDivElement>(null);

  /**
   * The Dock's signature is the wave, not the pop: the pointer lifts its neighbours on
   * a falloff curve. Written to the nodes directly — this runs on every mouse move.
   */
  const wave = (px: number | null) => {
    const tiles = bar.current?.querySelectorAll<HTMLElement>('.tile');
    if (!tiles) return;
    for (const t of Array.from(tiles)) {
      if (px === null) { t.style.transform = ''; continue; }
      const c = t.offsetLeft - bar.current!.scrollLeft + t.offsetWidth / 2;
      const f = Math.exp(-(((c - px) / 78) ** 2));
      t.style.transform = `translateY(${(-16 * f).toFixed(2)}px) scale(${(1 + 0.55 * f).toFixed(3)})`;
    }
  };

  return (
    <div className="dockwrap">
      <div className="dock" ref={bar}
           onPointerMove={(e) => wave(e.clientX - bar.current!.getBoundingClientRect().left)}
           onPointerLeave={() => wave(null)}>
        {[...APPS, ...EXTRAS].map((a) => {
          const live = wins.some((w) => w.id === a.kind);
          return (
            <button key={a.kind} className="tile" onClick={() => onLaunch(a.kind)} data-label={a.label}
                    aria-label={a.label} title={a.label}>
              <AppIcon name={a.icon} />
              {a.kind === 'inbox' && inbox.length > 0 && <i className="badge">{inbox.length}</i>}
              {a.kind === 'inbox' && unread > 0 && <i className="badge quiet">{unread}</i>}
              {live && <i className="run" />}
            </button>
          );
        })}
        <span className="dock-sep" />
        {rooms.map((r) => {
          const w = wins.find((x) => x.id === `room:${r.id}`);
          return (
            <button key={r.id} className="tile" onClick={() => onRoom(r.id)} data-label={r.name}
                    aria-label={r.name} title={r.name}
                    data-dock-room={r.id} style={{ ['--c' as any]: r.color }}>
              <span className="face big" style={{ ['--c' as any]: r.color }}>{r.icon}</span>
              {w && !w.min && <i className="run" />}
            </button>
          );
        })}
        {openApps.length > 0 && <span className="dock-sep" />}
        {openApps.map((w) => (
          <button key={w.id} className="tile" onClick={() => onFocus(w.id)} data-label={w.title}
                  aria-label={w.title} title={w.title}
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
