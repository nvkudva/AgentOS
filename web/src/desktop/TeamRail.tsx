import { memo } from 'react';
import type { Room, Agent } from '../lib/api';

const ATTN = new Set(['awaiting_approval', 'blocked', 'failed']);

function Block({ room, agents, onRoom, onAgent, activeId }:
  { room: Room; agents: Agent[]; onRoom: (r: Room) => void; onAgent: (a: Agent) => void; activeId?: string }) {
  const pct = Math.min(100, (room.spent_cents / Math.max(1, room.budget_cents)) * 100);
  const needs = agents.some((a) => ATTN.has(a.state));
  return (
    <section className={`team${needs ? ' needs' : ''}`} style={{ ['--room' as any]: room.color }}>
      <header onClick={() => onRoom(room)} title={room.objective}>
        <span className="team-icon">{room.icon}</span>
        <span className="team-name">{room.name}</span>
        {room.status !== 'open' && <span className="chip warn">{room.status}</span>}
        <span className="team-spend">{(room.spent_cents / 100).toFixed(2)}</span>
      </header>
      <span className="team-bar"><i style={{ width: `${pct}%` }} /></span>
      <ul>
        {agents.map((a) => (
          <li key={a.id} className={`crew${activeId === a.id ? ' on' : ''}${ATTN.has(a.state) ? ' attn' : ''}`}
              onClick={() => onAgent(a)} title={a.persona}>
            <span className="face" style={{ ['--c' as any]: a.color }}>
              {a.avatar}<i className={`st ${a.state}`} />
            </span>
            <span className="crew-text">
              <b>{a.name}</b>
              <em>{a.activity || a.state}</em>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const B = memo(Block, (p, n) =>
  p.room === n.room && p.activeId === n.activeId &&
  p.agents.length === n.agents.length && p.agents.every((a, i) => a === n.agents[i]));

export function TeamRail({ rooms, agents, side, onRoom, onAgent, activeId }: {
  rooms: Room[]; agents: Agent[]; side: 'left' | 'right';
  onRoom: (r: Room) => void; onAgent: (a: Agent) => void; activeId?: string;
}) {
  return (
    <aside className={`rail ${side}`}>
      {rooms.map((r) => (
        <B key={r.id} room={r} agents={agents.filter((a) => a.room_id === r.id)}
           onRoom={onRoom} onAgent={onAgent} activeId={activeId} />
      ))}
    </aside>
  );
}
