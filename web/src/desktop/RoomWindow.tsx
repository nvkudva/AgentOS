import { memo } from 'react';
import type { Room, Agent } from '../lib/api';
import { friendlyActivity } from '../lib/humanize';

const ATTN = new Set(['awaiting_approval', 'blocked', 'failed']);

function Body({ room, agents, onAgent, activeId }: {
  room: Room; agents: Agent[];
  onAgent: (a: Agent) => void; activeId?: string;
}) {
  return (
    <div className="roomwin" style={{ ['--room' as any]: room.color }}>
      <ul>
        {agents.map((a) => (
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
}

export const RoomWindowBody = memo(Body, (p, n) =>
  p.room === n.room && p.activeId === n.activeId &&
  p.agents.length === n.agents.length && p.agents.every((a, i) => a === n.agents[i]));

/**
 * The 72px a parked room keeps on screen: its own icon in its own colour, and the crew
 * as live faces with their status dots. Enough to know whether it needs you without
 * unparking it — which is the whole reason parking is not a minimise. No name: at this
 * width a label is a smear, and the colour already says which room this is.
 */
export function ParkedRail({ room, agents }: { room: Room; agents: Agent[] }) {
  const pct = Math.min(100, (room.spent_cents / Math.max(1, room.budget_cents)) * 100);
  const shown = agents.slice(0, 5);
  return (
    <div className="pk-rail" style={{ ['--room' as any]: room.color }}>
      <span className="pk-icon" title={room.name}>{room.icon}</span>
      <span className="pk-faces">
        {shown.map((a) => (
          <span key={a.id} className="face" style={{ ['--c' as any]: a.color }} title={`${a.name} — ${a.state}`}>
            {a.avatar}<i className={`st ${a.state}`} />
          </span>
        ))}
        {agents.length > shown.length && <em>+{agents.length - shown.length}</em>}
      </span>
      <span className="pk-bar"><i style={{ width: `${pct}%` }} /></span>
    </div>
  );
}
