import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { describe, friendlyActivity, money } from '../lib/humanize';
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
              <span className="face sm" style={{ ['--c' as any]: a.color }}>{a.avatar}<i className={`st ${a.state}`} /></span>
              <b>{a.name}</b>
              <span style={{ color: 'var(--faint)' }}>{roomOf[a.room_id]?.name}</span>
              <span className="activity">{friendlyActivity(a.activity, a.state)}</span>
              <span className="spacer" />
              <span className="tag">{money(a.spent_cents)}</span>
            </summary>
            <div className="body rows">
              {mine.map((e) => {
                const said = describe(e, a.name);
                if (!said) return null;
                return (
                  <div className={`row ${said.kind}`} key={e.id}>
                    <span className="sg">{said.kind === 'step' ? (said as any).glyph : said.kind === 'problem' ? '⚠️' : '•'}</span>
                    <span className="rtext">{said.text}</span>
                    <span className="when">{new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
