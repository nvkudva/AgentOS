import { useEffect, useState } from 'react';
import { get, post, observe } from '../lib/api';
import type { Room, Mandate, Task, Agent } from '../lib/api';
import { describe, hours, toolName, toolGlyph } from '../lib/humanize';
import { roomProgress } from '../lib/progress';

const TABS = ['Activity', 'Files', 'Spending', 'History', 'Permissions'] as const;
type Tab = typeof TABS[number];

/**
 * What this room is doing, before any of the detail below it. The tabs answer "what
 * happened"; an operator opening a room first wants "what is happening". Same sentence
 * the Overview card shows, from the same helper, so the two never disagree.
 */
function Summary({ room, mandates, tasks, agents }: {
  room: Room; mandates: Mandate[]; tasks: Task[]; agents: Agent[];
}) {
  const crew = agents.filter((a) => a.room_id === room.id);
  const p = roomProgress(room, mandates, tasks, crew);
  return (
    <div className={`rm-sum${p.mandate ? '' : ' quiet'}${p.needs ? ' needs' : ''}`}
         style={{ ['--c' as any]: p.mandate?.color ?? room.color }}>
      <b>{p.mandate ? `“${p.mandate.text}”` : 'Nothing on the go.'}</b>
      <p>{p.mandate ? p.where : `${room.objective}. ${p.where}`}</p>
      {p.report && <p className="rm-report">{p.report}</p>}
    </div>
  );
}

/** A room, as an ordinary app: what happened, what it made, what it cost, what it may touch. */
export function RoomApp({ room, view, mandates = [], tasks = [], agents = [] }: {
  room: Room; view: string; mandates?: Mandate[]; tasks?: Task[]; agents?: Agent[];
}) {
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('Activity');

  const load = () => get(`/api/rooms/${room.id}`).then(setD);
  useEffect(() => { load(); const t = setInterval(load, 1800); return () => clearInterval(t); }, [room.id]);
  useEffect(() => { observe(view, 'room.open', { room: room.key }); }, [room.id]);
  if (!d) return <div className="pad muted">One moment…</div>;

  const spent = d.room.spent_cents, cap = d.room.budget_cents;
  const nameOf = (id: string) => d.agents.find((a: any) => a.id === id)?.name ?? 'Someone';

  return (
    <div className="roomapp">
      <header className="app-head">
        <span className="app-icon" style={{ color: (d.room as any).color }}>{(d.room as any).icon}</span>
        <div>
          <b>{d.room.name}</b>
          <p className="muted">{d.room.objective}</p>
        </div>
        <span className="spacer" />
        {d.room.status !== 'open' &&
          <button onClick={() => post('/api/rooms/resume', { room: room.key }).then(load)}>Resume</button>}
        {d.agents.map((a: any) => (
          <button key={a.id} className={a.state === 'working' ? '' : 'primary'}
                  onClick={() => post(a.state === 'working' ? `/api/agents/${a.id}/kill` : `/api/agents/${a.id}/start`).then(load)}>
            {a.state === 'working' ? `Pause ${a.name}` : `Start ${a.name}`}
          </button>
        ))}
      </header>

      <Summary room={d.room} mandates={mandates} tasks={tasks}
               agents={agents.length ? agents : d.agents} />

      <nav className="segmented">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      <div className="app-body">
        {tab === 'Activity' && (
          <div className="rows">
            {d.events.map((e: any) => {
              const said = describe(e, nameOf(e.agent_id));
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
        )}

        {tab === 'Files' && (
          <>
            {d.queue?.length > 0 && <>
              <h4>Waiting to be published</h4>
              {d.queue.map((c: any) => (
                <article className="doc" key={c.id}>
                  <header><b>{c.title}</b><span className="pill">{c.state}</span><span className="pill">{c.channel}</span></header>
                  <p>{c.body.slice(0, 420)}{c.body.length > 420 ? '…' : ''}</p>
                </article>
              ))}
            </>}
            <h4>Written by this room</h4>
            {!d.artifacts.length && <p className="muted">Nothing yet.</p>}
            {d.artifacts.map((a: any) => (
              <article className="doc" key={a.id}>
                <header>
                  <b>{a.title}</b>
                  <span className="pill">{a.kind}</span>
                  {a.shared && <span className="pill">shared with other rooms</span>}
                  <span className="spacer" />
                  <span className="when">{new Date(a.created_at).toLocaleDateString()}</span>
                </header>
                <p>{a.body.slice(0, 900)}{a.body.length > 900 ? '…' : ''}</p>
              </article>
            ))}
          </>
        )}

        {tab === 'Spending' && (
          <>
            <div className="big-stat">
              <b>{hours(spent)}</b>
              <span className="muted">of {hours(cap)} allowed this room</span>
              <span className="mini-bar wide"><i style={{ width: `${Math.min(100, (spent / Math.max(1, cap)) * 100)}%` }} /></span>
              <p className="muted tiny">When the limit is reached the room stops. It never goes over.</p>
            </div>
            <h4>Where it went</h4>
            <div className="rows">
              {d.ledger.map((l: any) => (
                <div className="row" key={l.id}>
                  <span className="sg">{toolGlyph(String(l.reason).split(' ')[0])}</span>
                  <span className="rtext">{toolName(String(l.reason).split(' ')[0])}</span>
                  <span className="when">{hours(l.cents)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'History' && (
          <div className="rows">
            {d.runs.map((r: any) => (
              <div className="row" key={r.id}>
                <span className="sg">{r.status === 'done' ? '✅' : r.status === 'running' ? '⏳' : '⚠️'}</span>
                <span className="rtext">
                  {r.goal}
                  <em className="muted"> · {r.steps_used} steps · {hours(r.spent_cents)}
                    {r.kill_reason ? ` · ${r.kill_reason}` : ''}</em>
                </span>
                <span className="when">{new Date(r.started_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'Permissions' && (
          <>
            <h4>This room may</h4>
            <ul className="plain-list">
              {(d.room.tool_grants ?? []).map((g: string) => (
                <li key={g}><span className="sg">{toolGlyph(g)}</span> use {toolName(g)}</li>
              ))}
            </ul>
            <h4>Data access</h4>
            <p>{d.room.db_role
              ? 'Can read the company database through its own account. Other rooms cannot see what it reads.'
              : 'No access to the company database at all.'}</p>
            <h4>What runs without asking you</h4>
            <ul className="plain-list">
              {Object.entries(d.room.approval_policy ?? {}).map(([k, v]) => (
                <li key={k}>
                  <span className="sg">{v === 'auto' ? '🟢' : '🟣'}</span>
                  {k === 'low' ? 'Read-only work' : k === 'medium' ? 'Work visible inside the company' : 'Anything that leaves the company'}
                  {' — '}{v === 'auto' ? 'runs on its own' : 'always asks you first'}
                </li>
              ))}
            </ul>
            <p className="muted tiny">Anything outside this list is refused and recorded.</p>
          </>
        )}
      </div>
    </div>
  );
}
