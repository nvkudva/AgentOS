import { memo } from 'react';
import type { Room, Agent, Mandate, Task } from '../lib/api';
import { hours } from '../lib/humanize';
import { roomProgress } from '../lib/progress';

const ATTN = new Set(['awaiting_approval', 'blocked', 'failed']);

/**
 * A room at a glance: what it is working on, and who is in it.
 *
 * Deliberately not a feed. A card per agent saying what each one last said is four
 * lines of chatter that change constantly and never add up to the state of the room —
 * one sentence of progress and a row of faces answers "does this need me?" faster.
 *
 * The manager's own report is deliberately not here: the card is one grid row tall and
 * the report is the one line whose length nothing bounds. The console shows all of it.
 */
function Widget({ room, agents, mandates = [], tasks = [], onOpen }: {
  room: Room; agents: Agent[]; mandates?: Mandate[]; tasks?: Task[]; onOpen: (r: Room) => void;
}) {
  const p = roomProgress(room, mandates, tasks, agents);
  const pct = Math.min(100, (room.spent_cents / Math.max(1, room.budget_cents)) * 100);
  const warn = agents.some((a) => a.state === 'failed');
  const cls = `room${room.status === 'capped' ? ' capped' : p.needs ? ' needs' : warn ? ' blocked' : ''}`;

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

      <div className="room-now">
        {p.mandate && <b>“{p.mandate.text}”</b>}
        <p>{p.where}</p>
      </div>

      <div className="room-crew">
        {agents.map((a) => (
          <span key={a.id} className={`face sm${ATTN.has(a.state) ? ' attn' : ''}`}
                style={{ ['--c' as any]: a.color }} title={`${a.name} — ${a.persona}`}>
            {a.avatar}<i className={`st ${a.state}`} />
          </span>
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
  a.room === b.room && a.mandates === b.mandates && a.tasks === b.tasks &&
  a.agents.length === b.agents.length && a.agents.every((x, i) => x === b.agents[i]));
