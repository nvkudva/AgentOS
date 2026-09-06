import { useEffect, useState } from 'react';
import { get, post, observe } from '../lib/api';
import type { Room } from '../lib/api';

export function RoomApp({ room, view }: { room: Room; view: string }) {
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState<'log' | 'artifacts' | 'spend' | 'runs' | 'scope'>('log');

  const load = () => get(`/api/rooms/${room.id}`).then(setD);
  useEffect(() => { load(); const t = setInterval(load, 1500); return () => clearInterval(t); }, [room.id]);
  useEffect(() => { observe(view, 'room.open', { room: room.key }); }, [room.id]);

  if (!d) return null;
  return (
    <div className="roomapp">
      <div>
        <div className="sheet-head">
          <span style={{ color: (d.room as any).color }}>{(d.room as any).icon}</span>
          <strong>{d.room.name}</strong>
          <span style={{ color: 'var(--faint)' }}>{d.room.objective}</span>
          <span className="spacer" />
          {d.room.status !== 'open' && (
            <button onClick={() => post('/api/rooms/resume', { room: room.key }).then(load)}>Resume room</button>
          )}
        </div>
        <div className="sheet-head" style={{ borderTop: 0, gap: 4 }}>
          {(['log', 'artifacts', 'spend', 'runs', 'scope'] as const).map((t) => (
            <span key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t}</span>
          ))}
          <span className="spacer" />
          {d.agents.map((a: any) => (
            <button key={a.id} onClick={() => post(a.state === 'working' ? `/api/agents/${a.id}/kill` : `/api/agents/${a.id}/start`).then(load)}>
              {a.state === 'working' ? `Stop ${a.name}` : `Run ${a.name}`}
            </button>
          ))}
        </div>

        <div className="sheet-body">
          {tab === 'log' && (
            <div className="log">
              {d.events.map((e: any) => (
                <div className="row" key={e.id}>
                  <span className="t">{new Date(e.ts).toLocaleTimeString()}</span>
                  <span className="ty">{e.type}</span>
                  <span>{summarise(e)}</span>
                </div>
              ))}
            </div>
          )}
          {tab === 'artifacts' && (
            <>
              {d.queue?.length > 0 && (<><h4>content queue</h4>
                {d.queue.map((c: any) => (
                  <div key={c.id} style={{ marginBottom: 8 }}>
                    <b>{c.title}</b> <span className="tag">{c.state}</span> <span className="tag">{c.channel}</span>
                    <pre>{c.body.slice(0, 600)}</pre>
                  </div>))}</>)}
              <h4>artifacts</h4>
              {d.artifacts.map((a: any) => (
                <div key={a.id} style={{ marginBottom: 10 }}>
                  <b>{a.title}</b> <span className="tag">{a.kind}</span>{a.shared && <span className="tag">shared</span>}
                  <pre>{a.body.slice(0, 2000)}</pre>
                </div>
              ))}
            </>
          )}
          {tab === 'spend' && (
            <div className="log">
              <h4>{(d.room.spent_cents / 100).toFixed(2)} of {(d.room.budget_cents / 100).toFixed(2)} spent</h4>
              {d.ledger.map((l: any) => (
                <div className="row" key={l.id}>
                  <span className="t">{new Date(l.ts).toLocaleTimeString()}</span>
                  <span className="ty">{l.cents}¢</span><span>{l.reason}</span>
                </div>
              ))}
            </div>
          )}
          {tab === 'runs' && (
            <div className="log">
              {d.runs.map((r: any) => (
                <div className="row" key={r.id}>
                  <span className="t">{r.status}</span>
                  <span className="ty">{r.steps_used} steps · {r.spent_cents}¢</span>
                  <span>{r.goal}{r.kill_reason ? ` — ${r.kill_reason}` : ''}</span>
                </div>
              ))}
            </div>
          )}
          {tab === 'scope' && (
            <>
              <h4>this room may call</h4>
              <pre>{(d.room.tool_grants ?? []).join('\n')}</pre>
              <h4>database role</h4>
              <pre>{d.room.db_role ?? '— no database access —'}</pre>
              <h4>approval policy by blast radius</h4>
              <pre>{JSON.stringify(d.room.approval_policy, null, 2)}</pre>
              <p style={{ color: 'var(--faint)' }}>
                Anything not on these lists is refused by the runtime and logged as a scope violation.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function summarise(e: any) {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'tool.call':   return `${p.tool} → ${(p.touches ?? []).join(', ')} (${p.est_cost_cents}¢)`;
    case 'tool.result': return `${p.tool} ok in ${p.ms}ms`;
    case 'tool.error':  return `${p.tool} — ${p.error}`;
    case 'scope.violation': return `REFUSED ${p.tool}${p.attempted_room ? ` on ${p.attempted_room}` : ''}`;
    case 'approval.requested': return `${p.action} (${p.cost_cents}¢)`;
    case 'run.started': return p.goal;
    case 'agent.killed': return p.reason;
    case 'spend': return `${p.cents}¢ ${p.reason}`;
    default: return JSON.stringify(p).slice(0, 160);
  }
}
