import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import type { Agent, Room } from '../lib/api';

/**
 * The control view for the thesis: a competent chat list over the same backend.
 * Deliberately not a strawman — threads, live activity, the same inbox strip.
 * If this wins, the README says so.
 */
export function ListView({ rooms, agents }: { rooms: Room[]; agents: Agent[] }) {
  const [feed, setFeed] = useState<any[]>([]);
  useEffect(() => { const f = () => get('/api/list?limit=250').then(setFeed); f(); const t = setInterval(f, 1500); return () => clearInterval(t); }, []);
  const roomOf = Object.fromEntries(rooms.map((r) => [r.id, r]));

  return (
    <div className="list">
      {agents.map((a) => {
        const mine = feed.filter((e) => e.agent_id === a.id).slice(0, 40);
        return (
          <details className="thread" key={a.id}>
            <summary>
              <span className={`dot ${a.state}`} />
              <b>{a.name}</b>
              <span style={{ color: 'var(--faint)' }}>{roomOf[a.room_id]?.name}</span>
              <span className="activity">{a.activity || a.state}</span>
              <span className="spacer" />
              <span className="tag">{a.spent_cents}¢</span>
            </summary>
            <div className="body log">
              {mine.map((e) => (
                <div className="row" key={e.id}>
                  <span className="t">{new Date(e.ts).toLocaleTimeString()}</span>
                  <span className="ty">{e.type}</span>
                  <span>{JSON.stringify(e.payload).slice(0, 140)}</span>
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
