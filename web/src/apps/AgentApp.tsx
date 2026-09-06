import { useEffect, useRef, useState } from 'react';
import { get, post } from '../lib/api';
import { describe, money, friendlyState, type Said } from '../lib/humanize';

/** A turn: something the agent said, plus the work it did right after saying it. */
type Turn = { said: Said; at: string; steps: { glyph: string; text: string }[] };

/**
 * One teammate's work, read like a message thread.
 *
 * Runs of small steps collapse into a single line — "Worked for 2 minutes · 6 steps" —
 * because nobody wants a log. Open it and the steps are still there, in sentences.
 */
export function AgentApp({ agentId }: { agentId: string }) {
  const [d, setD] = useState<any>(null);
  const feed = useRef<HTMLDivElement>(null);

  const load = () => get(`/api/agents/${agentId}`).then(setD);
  useEffect(() => { load(); const t = setInterval(load, 1400); return () => clearInterval(t); }, [agentId]);
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' }); }, [d?.events?.[0]?.id]);

  if (!d) return <div className="pad muted">One moment…</div>;
  const a = d.agent;
  const turns = toTurns([...d.events].reverse(), a.name);
  const pct = Math.min(100, (a.steps_used / Math.max(1, a.step_budget)) * 100);

  return (
    <div className="agentapp">
      <header className="persona" style={{ ['--c' as any]: a.color }}>
        <span className="face big">{a.avatar}<i className={`st ${a.state}`} /></span>
        <div className="who-block">
          <div className="who-line"><b>{a.name}</b><span className="chip">{a.role}</span><span className="chip">{d.room.name}</span></div>
          <p className="persona-line">{a.persona}</p>
          <p className="status-line">{a.activity ? capital(a.activity) : friendlyState(a.state)}</p>
          <span className="mini-bar" title={`${a.steps_used} of ${a.step_budget} steps · ${money(a.spent_cents)} of ${money(a.cost_budget_cents)}`}>
            <i style={{ width: `${pct}%` }} />
          </span>
        </div>
        <span className="spacer" />
        <span className="spend-badge" title="spent on this task">{money(a.spent_cents)}</span>
        {a.state === 'working'
          ? <button className="danger" onClick={() => post(`/api/agents/${a.id}/kill`, { reason: 'operator' }).then(load)}>Pause</button>
          : <button className="primary" onClick={() => post(`/api/agents/${a.id}/start`).then(load)}>Start</button>}
      </header>

      <div className="feed" ref={feed}>
        {!turns.length && <p className="muted centre">Nothing yet. Press Start and {a.name} will get going.</p>}
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
const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Group the log into turns: what the agent said, then the work that followed, folded
 * away behind one line. Nobody wants a log; they want the story, with the log underneath.
 */
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
