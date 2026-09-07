import { memo } from 'react';
import type { Room, Agent } from '../lib/api';
import { friendlyActivity, hours } from '../lib/humanize';

const NEEDS = new Set(['awaiting_approval']);
const WARN = new Set(['blocked', 'failed']);

function Widget({ room, agents, onOpen }: { room: Room; agents: Agent[]; onOpen: (r: Room) => void }) {
  const needs = agents.some((a) => NEEDS.has(a.state));
  const warn = agents.some((a) => WARN.has(a.state));
  const pct = Math.min(100, (room.spent_cents / Math.max(1, room.budget_cents)) * 100);
  const cls = `room${room.status === 'capped' ? ' capped' : needs ? ' needs' : warn ? ' blocked' : ''}`;

  return (
    <div className={cls} style={{ gridColumn: `span ${room.w}`, gridRow: `span ${room.h}`,
                                 ['--room' as any]: room.color }}
         onClick={() => onOpen(room)}>
      <div className="room-head">
        <span style={{ color: room.color }}>{room.icon}</span>
        <span className="room-name">{room.name}</span>
        {room.status !== 'open' && <span className="pill capped">{room.status}</span>}
        <span className="room-obj">{room.objective}</span>
      </div>
      <div className="agents">
        {agents.map((a) => (
          <div key={a.id} className={`agent${NEEDS.has(a.state) || WARN.has(a.state) ? ' attn' : ''}`}
               title={a.persona}>
            <span className="face sm" style={{ ['--c' as any]: a.color }}>
              {a.avatar}<i className={`st ${a.state}`} />
            </span>
            <span className="agent-name">{a.name}</span>
            <span className="activity">{friendlyActivity(a.activity, a.state)}</span>
          </div>
        ))}
      </div>
      <div className="room-foot">
        <span className={`bar${pct > 95 ? ' over' : pct > 70 ? ' warn' : ''}`} style={{ width: 64 }}>
          <i style={{ width: `${pct}%` }} />
        </span>
        <span>{hours(room.spent_cents)} of {hours(room.budget_cents)}</span>
        <span className="spacer" />
        <span>{room.tool_grants.length} tools</span>
      </div>
    </div>
  );
}

/** Memoised on the room's own slice: one chatty agent never re-renders the floor. */
export const RoomWidget = memo(Widget, (a, b) =>
  a.room === b.room && a.agents.length === b.agents.length &&
  a.agents.every((x, i) => x === b.agents[i]));
