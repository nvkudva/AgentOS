import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';

const ICONS = ['◈', '⌘', '✎', '◎', '◇', '☎', '⛁', '◍', '✦', '❖', '⌬', '⏣'];
const COLORS = ['#4bb3d4', '#6f8ef5', '#e0794b', '#3fb27f', '#a472e0', '#e05b8f', '#c9a227', '#7f8cd6'];
const FACES = ['🙂', '🔭', '🔧', '✒️', '📇', '🧭', '🎧', '🧾', '🔎', '📊', '🗂️', '🛠️'];

/**
 * Adding a function to the company is a form.
 *
 * This posts a room description; the server creates the room, its own database role,
 * exactly the grants that role should have, and its agents. No shell code changes, which
 * is the test of whether "room" is really the unit of the system.
 */
export function NewRoom({ onDone }: { onDone: () => void }) {
  const [cat, setCat] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [icon, setIcon] = useState(ICONS[8]);
  const [color, setColor] = useState(COLORS[0]);
  const [budget, setBudget] = useState(200);
  const [access, setAccess] = useState('none');
  const [tools, setTools] = useState<string[]>(['artifact.write', 'escalate']);
  const [agents, setAgents] = useState([{ name: '', role: 'specialist', policy: '', persona: '', avatar: FACES[0] }]);

  useEffect(() => { get('/api/catalog').then(setCat); }, []);
  if (!cat) return <div className="pad muted">One moment…</div>;

  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 22);
  const toggle = (t: string) => setTools((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]));
  const label = (t: string) => cat.tools.find((x: any) => x.name === t)?.label ?? t;
  /** What each chosen job still needs granted, so the gap is visible before you create. */
  const missingFor = (policy: string) =>
    (cat.jobs.find((j: any) => j.key === policy)?.uses ?? []).filter((t: string) => !tools.includes(t));
  const grantAll = (policy: string) =>
    setTools((xs) => [...new Set([...xs, ...missingFor(policy)])]);

  const create = async () => {
    setBusy(true); setErr(null);
    const res = await post('/api/rooms', {
      key, name, objective, color, icon, budget_cents: Math.round(budget), access, tools,
      agents: agents.filter((a) => a.name.trim() && a.policy)
        .map((a) => ({ ...a, color, persona: a.persona || 'No description yet.' })),
    });
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    onDone();
  };

  return (
    <div className="pad newroom">
      <h4>What does this room do?</h4>
      <div className="field"><label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Legal" style={{ width: 180 }} /></div>
      <div className="field"><label>Objective</label>
        <input value={objective} onChange={(e) => setObjective(e.target.value)}
               placeholder="Review contracts before they are signed" style={{ width: 360 }} /></div>
      <div className="field"><label>Look</label>
        <span className="picks">
          {ICONS.map((i) => <button key={i} className={icon === i ? 'primary' : ''} onClick={() => setIcon(i)}>{i}</button>)}
        </span>
      </div>
      <div className="field"><label></label>
        <span className="picks">
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} title={c}
                    style={{ background: c, width: 24, height: 24, padding: 0,
                             outline: color === c ? '2px solid var(--text)' : 'none', outlineOffset: 2 }} />
          ))}
        </span>
      </div>
      <div className="field"><label>Spending limit</label>
        <input type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
        <span className="muted tiny">agent-minutes. Work halts here rather than going over.</span></div>

      <h4>What may it reach?</h4>
      {cat.access.map((a: any) => (
        <label className="radio" key={a.key}>
          <input type="radio" checked={access === a.key} onChange={() => setAccess(a.key)} />
          <span><b>{a.label}</b><em>{a.note}</em></span>
        </label>
      ))}

      <h4>What may it do?</h4>
      <div className="toolgrid">
        {cat.tools.map((t: any) => (
          <label key={t.name} className={`toolpick${tools.includes(t.name) ? ' on' : ''}`}>
            <input type="checkbox" checked={tools.includes(t.name)} onChange={() => toggle(t.name)} />
            <span>{t.label}</span>
            {!t.reversible && <span className="tag high">always asks you</span>}
          </label>
        ))}
      </div>

      <h4>Who works here?</h4>
      {agents.map((a, i) => (
        <div className="agentrow" key={i}>
          <select value={a.avatar} onChange={(e) => edit(i, { avatar: e.target.value })}>
            {FACES.map((f) => <option key={f}>{f}</option>)}
          </select>
          <input placeholder="Name" value={a.name} onChange={(e) => edit(i, { name: e.target.value })} style={{ width: 110 }} />
          <input placeholder="Role" value={a.role} onChange={(e) => edit(i, { role: e.target.value })} style={{ width: 110 }} />
          <select value={a.policy} onChange={(e) => edit(i, { policy: e.target.value })}>
            <option value="">Pick a job…</option>
            {cat.jobs.filter((j: any) => j.key !== 'demo.loop').map((j: any) =>
              <option key={j.key} value={j.key}>{j.goal}</option>)}
          </select>
          <input placeholder="How do they work?" value={a.persona}
                 onChange={(e) => edit(i, { persona: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
          {a.policy && missingFor(a.policy).length > 0 && (
            <span className="needs-grant">
              This job also needs {missingFor(a.policy).map(label).join(', ').toLowerCase()}
              <button onClick={() => grantAll(a.policy)}>Allow it</button>
            </span>
          )}
        </div>
      ))}
      <button onClick={() => setAgents((xs) => [...xs, { name: '', role: 'specialist', policy: '', persona: '', avatar: FACES[0] }])}>
        Add another
      </button>

      {err && <p className="problem-line">{err}</p>}
      <div className="field" style={{ marginTop: 16 }}>
        <button className="primary"
                disabled={busy || !name || !objective || !agents.some((a) => a.name && a.policy) ||
                          agents.some((a) => a.policy && missingFor(a.policy).length > 0)}
                onClick={create}>{busy ? 'Creating…' : 'Create room'}</button>
        <button onClick={onDone}>Cancel</button>
        <span className="muted tiny">Creates the room, its own database account and its agents.</span>
      </div>
    </div>
  );

  function edit(i: number, patch: any) {
    setAgents((xs) => xs.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  }
}
