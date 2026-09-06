import { useEffect, useRef, useState } from 'react';
import { get, post } from '../lib/api';
import type { Agent } from '../lib/api';

/** The centre of the desktop: one agent's working conversation, live. */
export function AgentApp({ agentId }: { agentId: string }) {
  const [d, setD] = useState<any>(null);
  const feed = useRef<HTMLDivElement>(null);

  const load = () => get(`/api/agents/${agentId}`).then(setD);
  useEffect(() => { load(); const t = setInterval(load, 1200); return () => clearInterval(t); }, [agentId]);
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight }); }, [d?.events?.[0]?.id]);

  if (!d) return <div className="pad muted">loading…</div>;
  const a: Agent & any = d.agent;
  const msgs = [...d.events].reverse().filter((e: any) =>
    ['run.started', 'agent.said', 'tool.call', 'tool.result', 'tool.error', 'approval.requested',
     'approval.granted', 'approval.rejected', 'escalation.raised', 'scope.violation',
     'agent.killed', 'run.finished', 'run.failed'].includes(e.type));

  return (
    <div className="agentapp">
      <header className="persona" style={{ ['--c' as any]: a.color }}>
        <span className="face big">{a.avatar}<i className={`st ${a.state}`} /></span>
        <div>
          <b>{a.name}</b> <span className="chip">{a.role}</span> <span className="chip">{d.room.name}</span>
          <p>{a.persona}</p>
          <p className="muted">{a.activity || a.state} · {a.steps_used}/{a.step_budget} steps · {a.spent_cents}¢/{a.cost_budget_cents}¢</p>
        </div>
        <span className="spacer" />
        {a.state === 'working'
          ? <button className="danger" onClick={() => post(`/api/agents/${a.id}/kill`, { reason: 'operator' }).then(load)}>Stop</button>
          : <button className="primary" onClick={() => post(`/api/agents/${a.id}/start`).then(load)}>Run</button>}
      </header>

      <div className="feed" ref={feed}>
        {msgs.map((e: any) => <Line key={e.id} e={e} a={a} />)}
        {!msgs.length && <p className="muted pad">No history yet. Press Run.</p>}
      </div>
    </div>
  );
}

function Line({ e, a }: { e: any; a: any }) {
  const p = e.payload ?? {};
  const time = new Date(e.ts).toLocaleTimeString();
  const say = (body: any, cls = '') => (
    <div className={`msg ${cls}`} style={{ ['--c' as any]: a.color }}>
      <span className="who">{a.avatar} {a.name}</span>
      <div className="bubble">{body}</div>
      <span className="when">{time}</span>
    </div>
  );
  const sys = (body: any, cls = '') => (
    <div className={`sys ${cls}`}><span className="when">{time}</span>{body}</div>
  );

  switch (e.type) {
    case 'run.started':   return sys(<>started: <b>{p.goal}</b></>, 'start');
    case 'agent.said':    return say(p.activity);
    case 'tool.call':     return sys(<>→ <code>{p.tool}</code> · touches {(p.touches ?? []).join(', ') || '—'} · {p.est_cost_cents}¢</>, 'tool');
    case 'tool.result':   return sys(<>← <code>{p.tool}</code> ok in {p.ms}ms{p.result?.rowCount != null ? ` · ${p.result.rowCount} rows` : ''}</>, 'ok');
    case 'tool.error':    return sys(<>← <code>{p.tool}</code> failed: {p.error}</>, 'err');
    case 'scope.violation': return sys(<>⛔ refused <code>{p.tool}</code> — outside this room's scope</>, 'err');
    case 'approval.requested': return sys(<>⏸ waiting on you: <b>{p.action}</b> ({p.cost_cents}¢)</>, 'wait');
    case 'approval.granted':   return sys(<>✅ you approved: {p.action}</>, 'ok');
    case 'approval.rejected':  return sys(<>🚫 you rejected: {p.action}</>, 'err');
    case 'escalation.raised':  return say(<b>{p.question}</b>, 'ask');
    case 'agent.killed':  return sys(<>💀 killed — {p.reason}</>, 'err');
    case 'run.finished':  return sys(<>done in {p.steps} steps</>, 'ok');
    case 'run.failed':    return sys(<>run failed — {p.error}</>, 'err');
    default: return null;
  }
}
