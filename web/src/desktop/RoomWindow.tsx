import { memo } from 'react';
import type { Room, Agent } from '../lib/api';

const ATTN = new Set(['awaiting_approval', 'blocked', 'failed']);

function Body({ room, agents, horizontal, onConsole, onAgent, activeId }: {
  room: Room; agents: Agent[]; horizontal: boolean;
  onConsole: (r: Room) => void; onAgent: (a: Agent) => void; activeId?: string;
}) {
  const pct = Math.min(100, (room.spent_cents / Math.max(1, room.budget_cents)) * 100);
  return (
    <div className={`roomwin${horizontal ? ' h' : ''}`} style={{ ['--room' as any]: room.color }}>
      <div className="rw-head" onClick={() => onConsole(room)} title={room.objective}>
        <span className="rw-icon">{room.icon}</span>
        <b>{room.name}</b>
        {room.status !== 'open' && <span className="chip warn">{room.status}</span>}
        <span className="spacer" />
        <span className="rw-spend">{(room.spent_cents / 100).toFixed(2)}</span>
      </div>
      <span className="rw-bar"><i style={{ width: `${pct}%` }} /></span>
      <ul>
        {agents.map((a) => (
          <li key={a.id} className={`crew${activeId === a.id ? ' on' : ''}${ATTN.has(a.state) ? ' attn' : ''}`}
              onClick={() => onAgent(a)} title={a.persona}>
            <span className="face" style={{ ['--c' as any]: a.color }}>
              {a.avatar}<i className={`st ${a.state}`} />
            </span>
            <span className="crew-text"><b>{a.name}</b><em>{a.activity || a.state}</em></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const RoomWindowBody = memo(Body, (p, n) =>
  p.room === n.room && p.horizontal === n.horizontal && p.activeId === n.activeId &&
  p.agents.length === n.agents.length && p.agents.every((a, i) => a === n.agents[i]));
