import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from '../lib/api';
import { describe, hours, friendlyActivity, plainDetail, type Said } from '../lib/humanize';

type Turn = { said: Said; at: string; steps: { glyph: string; text: string }[] };

/**
 * A teammate's workspace: their past tasks down the left, the chosen conversation
 * on the right. Each run of an agent is a session, so history is browsable instead
 * of being one endless scroll.
 */
export function AgentApp({ agentId }: { agentId: string }) {
  const [d, setD] = useState<any>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [thread, setThread] = useState<any>(null);
  const feed = useRef<HTMLDivElement>(null);

  const load = () => get(`/api/agents/${agentId}`).then((x) => {
    setD(x);
    setRunId((cur) => cur ?? x.runs[0]?.id ?? null);
  });
  useEffect(() => { setRunId(null); load(); }, [agentId]);
  useEffect(() => { const t = setInterval(load, 1600); return () => clearInterval(t); }, [agentId]);
  useEffect(() => {
    if (!runId) { setThread(null); return; }
    const f = () => get(`/api/runs/${runId}`).then(setThread);
    f(); const t = setInterval(f, 1400); return () => clearInterval(t);
  }, [runId]);
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' }); },
            [thread?.events?.length]);

  const a = d?.agent;
  const turns = useMemo(() => (thread && a ? toTurns(thread.events, a.name) : []), [thread, a?.name]);
  if (!d) return <div className="pad muted">One moment…</div>;

  const start = () => post(`/api/agents/${a.id}/start`).then(() => { setRunId(null); load(); });

  return (
    <div className="chatapp">
      <aside className="threads">
        <header>
          <span className="threads-title">Tasks</span>
          <button className="x plus" onClick={start} title="give them a new task">+</button>
        </header>
        <div className="thread-list">
          {!d.runs.length && <p className="muted pad">No tasks yet.</p>}
          {byDay(d.runs).map(([day, runs]) => (
            <div key={day}>
              <h5 className="day">{day}</h5>
              {runs.map((r: any) => (
                <button key={r.id} className={`thread-item${r.id === runId ? ' on' : ''}`} onClick={() => setRunId(r.id)}>
                  <span className={`tdot ${r.status}`} />
                  <span className="titem-text">
                    <b>{plainDetail(r.goal)}</b>
                    <em>{time(r.started_at)} · {hours(r.spent_cents)}</em>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <section className="chat">
        <header className="persona" style={{ ['--c' as any]: a.color }}>
          <span className="face big">{a.avatar}<i className={`st ${a.state}`} /></span>
          <div className="who-block">
            <div className="who-line"><b>{a.name}</b><span className="chip">{a.role}</span><span className="chip">{d.room.name}</span></div>
            <p className="persona-line">{a.persona}</p>
            <p className="status-line">{friendlyActivity(a.activity, a.state)}</p>
          </div>
          <span className="spacer" />
          <span className="spend-badge" title="spent on this task">{hours(a.spent_cents)}</span>
          {a.state === 'working'
            ? <button className="danger" onClick={() => post(`/api/agents/${a.id}/kill`, { reason: 'operator' }).then(load)}>Pause</button>
            : <button className="primary" onClick={start}>New task</button>}
        </header>

        <div className="feed" ref={feed}>
          {!turns.length && (
            <p className="muted centre">
              {d.runs.length ? 'Nothing in this task yet.' : `Press New task and ${a.name} will get going.`}
            </p>
          )}
          {turns.map((t, i) => (
            <div className="turn" key={i}>
              <Line said={t.said} at={t.at} a={a} />
              {t.steps.length > 0 && (
                <details className="steps">
                  <summary>
                    <span className="chev">›</span>
                    {t.steps.length === 1 ? t.steps[0].text : `${t.steps.length} steps`}
                  </summary>
                  <div className="step-list">
                    {t.steps.map((s, j) => (
                      <div className="step" key={j}><span className="sg">{s.glyph}</span>{s.text}</div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Line({ said, at, a }: { said: Said; at: string; a: any }) {
  if (!said) return null;
  if (said.kind === 'bubble' || said.kind === 'ask')
    return (
      <div className={`msg${said.kind === 'ask' ? ' ask' : ''}`} style={{ ['--c' as any]: a.color }}>
        <span className="face sm">{a.avatar}</span>
        <div className="bubble">{said.text}</div>
        <span className="when">{at}</span>
      </div>
    );
  if (said.kind === 'problem') return <div className="note problem">{said.text}<span className="when">{at}</span></div>;
  return <div className="note">{said.text}<span className="when">{at}</span></div>;
}

const time = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/** Tasks read better under Today / Yesterday / a date, the way any thread list does. */
function byDay(runs: any[]): [string, any[]][] {
  const now = new Date(), y = new Date(now); y.setDate(y.getDate() - 1);
  const label = (ts: string) => {
    const d = new Date(ts);
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'long', day: 'numeric' });
  };
  const out: [string, any[]][] = [];
  for (const r of runs) {
    const l = label(r.started_at);
    const last = out[out.length - 1];
    if (last && last[0] === l) last[1].push(r); else out.push([l, [r]]);
  }
  return out;
}

/** What the agent said, with the work that followed folded underneath it. */
function toTurns(events: any[], who: string): Turn[] {
  const out: Turn[] = [];
  for (const e of events) {
    const said = describe(e, who);
    if (!said) continue;
    if (said.kind === 'step') {
      const last = out[out.length - 1];
      if (last) { last.steps.push({ glyph: said.glyph, text: said.text }); continue; }
    }
    out.push({ said, at: time(e.ts), steps: [] });
  }
  return out;
}
