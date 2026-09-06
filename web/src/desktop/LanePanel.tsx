import type { Win, Edge, Rect } from './wm';
import type { Room, Agent } from '../lib/api';
import { friendlyActivity } from '../lib/humanize';

const ATTN = new Set(['awaiting_approval', 'blocked', 'failed']);

/**
 * A docked edge is a column of room cards — no wrapper, no group header.
 * Each room is its own surface, the way widgets sit on a desktop.
 */
export function LanePanel({ edge, rect, wins, rooms, agents, activeId, onAgent, onConsole, onClose, onGrab }: {
  edge: Edge; rect: Rect; wins: Win[];
  rooms: Room[]; agents: Agent[]; activeId?: string;
  onAgent: (a: Agent) => void;
  onConsole: (r: Room) => void;
  onClose: (id: string) => void;
  onGrab: (w: Win, e: React.PointerEvent) => void;
}) {
  const horizontal = edge === 'top' || edge === 'bottom';
  return (
    <div className={`lane ${edge}${horizontal ? ' h' : ''}`} style={rect}>
      {wins.map((w) => {
        const room = rooms.find((r) => r.id === w.ref);
        if (!room) return null;
        const crew = agents.filter((a) => a.room_id === room.id);
        const pct = Math.min(100, (room.spent_cents / Math.max(1, room.budget_cents)) * 100);
        const needs = crew.some((a) => ATTN.has(a.state));
        return (
          <section className={`roomcard${needs ? ' needs' : ''}`} key={w.id} style={{ ['--room' as any]: room.color }}>
            <header onPointerDown={(e) => onGrab(w, e)} onClick={() => onConsole(room)}
                    title={`${room.objective} — drag to move, click to open`}>
              <span className="sec-icon">{room.icon}</span>
              <b>{room.name}</b>
              {room.status !== 'open' && <span className="chip warn">{room.status}</span>}
              <span className="spacer" />
              <span className="sec-spend">{(room.spent_cents / 100).toFixed(2)}</span>
              <button className="x" onClick={(e) => { e.stopPropagation(); onClose(w.id); }} title="hide this room">✕</button>
            </header>
            <span className="sec-bar"><i style={{ width: `${pct}%` }} /></span>
            <ul>
              {crew.map((a) => (
                <li key={a.id} className={`crew${activeId === a.id ? ' on' : ''}${ATTN.has(a.state) ? ' attn' : ''}`}
                    onClick={() => onAgent(a)} title={a.persona}>
                  <span className="face" style={{ ['--c' as any]: a.color }}>
                    {a.avatar}<i className={`st ${a.state}`} />
                  </span>
                  <span className="crew-text"><b>{a.name}</b><em>{friendlyActivity(a.activity, a.state)}</em></span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
