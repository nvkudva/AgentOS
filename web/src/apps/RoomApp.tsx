import { useEffect, useRef, useState } from 'react';
import { get, post, observe } from '../lib/api';
import type { Room, Mandate, Task, Agent } from '../lib/api';
import { describe, hours, toolName, toolGlyph } from '../lib/humanize';
import { roomProgress } from '../lib/progress';
import { DEMO_THREADS } from '../lib/demo';

const TABS = ['Chat', 'Files', 'Spending', 'History', 'Permissions'] as const;
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
  const [tab, setTab] = useState<Tab>('Chat');

  const load = () => get(`/api/rooms/${room.id}`).then(setD);
  useEffect(() => { load(); const t = setInterval(load, 1800); return () => clearInterval(t); }, [room.id]);
  useEffect(() => { observe(view, 'room.open', { room: room.key }); }, [room.id]);
  // No backend (the hosted demo) or still loading: draw the room from the desk's own
  // snapshot instead of an empty window. Detail tabs are empty until the live data lands.
  const live = !!d;
  const d_ = d ?? { room, agents: agents.filter((a) => a.room_id === room.id),
    events: [], artifacts: [], queue: [], ledger: [], runs: [] };
  const mandateIds = new Set(mandates.filter((m) => m.room_id === room.id).map((m) => m.id));
  const roomTasks = tasks.filter((t) => mandateIds.has(t.mandate_id));
  const spent = d_.room.spent_cents, cap = d_.room.budget_cents;
  const agentOf = (id: string) => d_.agents.find((a: any) => a.id === id);

  /** One chat line, whether it came down the wire or out of the frozen demo. */
  type UIMsg = {
    key: string; who: string; avatar: string; color: string; text: string; time: string;
    kind: 'say' | 'sys' | 'ask'; problem?: boolean; approvalId?: string; compact?: boolean;
  };
  let msgs: UIMsg[] = [];
  if (live) {
    let lastWho = '';
    for (const e of d_.events) {
      const a = e.agent_id ? agentOf(e.agent_id) : undefined;
      const who = a?.name ?? 'Someone';
      const said = describe(e, who);
      if (!said) continue;
      const time = new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (said.kind === 'bubble') {
        const compact = who === lastWho;
        lastWho = who;
        msgs.push({ key: String(e.id), who, avatar: a?.avatar ?? '•', color: a?.color ?? room.color,
                    text: said.text, time, kind: 'say', compact });
      } else if (said.kind === 'ask') {
        lastWho = '';
        msgs.push({ key: String(e.id), who, avatar: a?.avatar ?? '•', color: a?.color ?? room.color,
                    text: said.text, time, kind: 'ask', approvalId: (e.payload as any)?.approval_id });
      } else {
        lastWho = '';
        msgs.push({ key: String(e.id), who: '', avatar: '', color: '', text: said.text, time,
                    kind: 'sys', problem: said.kind === 'problem' });
      }
    }
  } else {
    msgs = (DEMO_THREADS[room.key] ?? []).map((m, i) => ({ ...m, key: `${room.key}-${i}` }));
  }
  const chatRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chatRef.current;
    if (el && tab === 'Chat') el.scrollTop = el.scrollHeight;
  }, [msgs.length, tab, room.id]);

  return (
    <div className="roomapp">
      <header className="app-head">
        <span className="app-icon" style={{ ['--c' as any]: (d_.room as any).color }}>{(d_.room as any).icon}</span>
        <div>
          <b>{d_.room.name}</b>
          <p className="muted">{d_.room.objective}</p>
        </div>
        <span className="spacer" />
        {d_.room.status !== 'open' &&
          <button onClick={() => post('/api/rooms/resume', { room: room.key }).then(load)}>Resume</button>}
        {d_.agents.map((a: any) => (
          <button key={a.id} className={a.state === 'working' ? '' : 'primary'}
                  onClick={() => post(a.state === 'working' ? `/api/agents/${a.id}/kill` : `/api/agents/${a.id}/start`).then(load)}>
            {a.state === 'working' ? `Pause ${a.name}` : `Start ${a.name}`}
          </button>
        ))}
      </header>

      <Summary room={d_.room} mandates={mandates} tasks={tasks}
               agents={agents.length ? agents : d_.agents} />
      {!live && <p className="rm-offline">Snapshot — not live. Details appear when the desk is connected.</p>}

      <nav className="segmented">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      <div className="app-body">
        {tab === 'Chat' && (
          <div className="chat" ref={chatRef}>
            {!msgs.length && roomTasks.map((t) => (
              <div className="chat-sys" key={t.id}>
                <span>{t.state === 'done' ? 'Done' : t.state === 'working' ? 'Working on it' : 'Queued'} — {t.title}</span>
              </div>
            ))}
            {!msgs.length && !roomTasks.length && <p className="empty">Nothing said yet.</p>}
            {msgs.map((m) =>
              m.kind === 'say' ? (
                <div className={`msg${m.compact ? ' compact' : ''}`} key={m.key}>
                  {!m.compact && (
                    <span className="face" style={{ ['--c' as any]: m.color }}>{m.avatar}</span>
                  )}
                  <div className="msg-main">
                    {!m.compact && (
                      <header><b>{m.who}</b><span className="when">{m.time}</span></header>
                    )}
                    <p>{m.text}</p>
                  </div>
                </div>
              ) : m.kind === 'ask' ? (
                <div className="chat-ask" key={m.key}>
                  <span className="face small" style={{ ['--c' as any]: m.color }}>{m.avatar}</span>
                  <div className="msg-main">
                    <header><b>{m.who}</b><span className="when">{m.time}</span></header>
                    <p>{m.text}</p>
                    {live && m.approvalId && (
                      <div className="ask-btns">
                        <button className="primary" onClick={() =>
                          post(`/api/approvals/${m.approvalId}/decide`, { decision: 'approve' }).then(load)}>
                          Approve</button>
                        <button onClick={() =>
                          post(`/api/approvals/${m.approvalId}/decide`, { decision: 'reject' }).then(load)}>
                          Reject</button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className={`chat-sys${m.problem ? ' problem' : ''}`} key={m.key}>
                  <span>{m.text}</span>
                  <span className="when">{m.time}</span>
                </div>
              ))}
          </div>
        )}

        {tab === 'Files' && (
          <>
            {d_.queue?.length > 0 && <>
              <h4>Waiting to be published</h4>
              {d_.queue.map((c: any) => (
                <article className="doc" key={c.id}>
                  <header><b>{c.title}</b><span className="pill">{c.state}</span><span className="pill">{c.channel}</span></header>
                  <p>{c.body.slice(0, 420)}{c.body.length > 420 ? '…' : ''}</p>
                </article>
              ))}
            </>}
            <h4>Written by this room</h4>
            {!d_.artifacts.length && <p className="muted">Nothing yet.</p>}
            {d_.artifacts.map((a: any) => (
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
              {!d_.ledger.length && <p className="empty">No spending recorded yet.</p>}
              {d_.ledger.map((l: any) => (
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
            {!d_.runs.length && <p className="empty">No runs yet.</p>}
            {d_.runs.map((r: any) => (
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
              {(d_.room.tool_grants ?? []).map((g: string) => (
                <li key={g}><span className="sg">{toolGlyph(g)}</span> use {toolName(g)}</li>
              ))}
            </ul>
            <h4>Data access</h4>
            <p>{d_.room.db_role
              ? 'Can read the company database through its own account. Other rooms cannot see what it reads.'
              : 'No access to the company database at all.'}</p>
            <h4>What runs without asking you</h4>
            <ul className="plain-list">
              {Object.entries(d_.room.approval_policy ?? {}).map(([k, v]) => (
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
