import type { Win, Edge, Rect } from './wm';
import type { Room, Agent } from '../lib/api';
import { friendlyActivity } from '../lib/humanize';

const ATTN = new Set(['awaiting_approval', 'blocked', 'failed']);
const TITLE: Record<Edge, string> = { left: 'Teams', right: 'Teams', top: 'Teams', bottom: 'Teams' };

/**
 * A docked edge is ONE panel, not a stack of windows.
 *
 * Rooms inside it are sections divided by hairlines — no title bars, no traffic
 * lights, one close affordance for the whole column. It reads as a notification
 * popover that happens to hold teams, which is what it is.
 */
export function LanePanel({ edge, rect, wins, rooms, agents, activeId, onAgent, onConsole, onClose, onGrab }: {
  edge: Edge; rect: Rect; wins: Win[];
  rooms: Room[]; agents: Agent[]; activeId?: string;
  onAgent: (a: Agent) => void;
  onConsole: (r: Room) => void;
  onClose: () => void;
  onGrab: (w: Win, e: React.PointerEvent) => void;
}) {
  const horizontal = edge === 'top' || edge === 'bottom';
  return (
    <section className={`lane ${edge}${horizontal ? ' h' : ''}`} style={rect}>
      <header className="lane-head">
        <span className="lane-title">{TITLE[edge]}</span>
        <span className="spacer" />
        <button className="x" onClick={onClose} title="hide this column">✕</button>
      </header>

      <div className="lane-body">
        {wins.map((w) => {
          const room = rooms.find((r) => r.id === w.ref);
          if (!room) return null;
          const crew = agents.filter((a) => a.room_id === room.id);
          const pct = Math.min(100, (room.spent_cents / Math.max(1, room.budget_cents)) * 100);
          const needs = crew.some((a) => ATTN.has(a.state));
          return (
            <div className={`lane-sec${needs ? ' needs' : ''}`} key={w.id} style={{ ['--room' as any]: room.color }}>
              <div className="sec-head" onPointerDown={(e) => onGrab(w, e)} onClick={() => onConsole(room)}
                   title={`${room.objective} — drag to move, click to open`}>
                <span className="sec-icon">{room.icon}</span>
                <b>{room.name}</b>
                {room.status !== 'open' && <span className="chip warn">{room.status}</span>}
                <span className="spacer" />
                <span className="sec-spend">{(room.spent_cents / 100).toFixed(2)}</span>
              </div>
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
            </div>
          );
        })}
      </div>
    </section>
  );
}


