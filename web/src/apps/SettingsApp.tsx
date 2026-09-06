import { useState } from 'react';
import { NewRoom } from './NewRoom';
import { post } from '../lib/api';
import { money } from '../lib/humanize';
import type { Room } from '../lib/api';

export function SettingsApp({ rooms, config, perf, theme, setTheme }: {
  rooms: Room[]; config: any;
  perf: { mode: string; setMode: (m: any) => void; measured: number | null };
  theme: string; setTheme: (t: any) => void;
}) {
  const [g, setG] = useState(config.global_budget_cents);
  const [adding, setAdding] = useState(false);
  if (adding) return <NewRoom onDone={() => setAdding(false)} />;
  return (
    <div className="pad settings">
      <h4>Appearance</h4>
      <label>
        Theme
        <span className="seg">
          {(['light', 'dark', 'auto'] as const).map((t) => (
            <button key={t} className={theme === t ? 'primary' : ''} onClick={() => setTheme(t)}>{t}</button>
          ))}
        </span>
      </label>
      <label>
        Transparency
        <span className="seg">
          {(['auto', 'glass', 'lite'] as const).map((m) => (
            <button key={m} className={perf.mode === m ? 'primary' : ''} onClick={() => perf.setMode(m)}>{m}</button>
          ))}
        </span>
      </label>
      <p className="muted tiny">
        Glass blurs the wallpaper behind the chrome. On software rendering that halves the
        frame rate, so <b>auto</b> measures {perf.measured ? `${perf.measured}fps` : 'the first two seconds'} and
        drops to flat surfaces if it cannot hold 60.
      </p>

      <h4>Global</h4>
      <label>
        Global cap (cents)
        <input type="number" value={g} onChange={(e) => setG(Number(e.target.value))} />
        <button onClick={() => post('/api/budget', { cents: g })}>Save</button>
      </label>
      <p className="muted">Spent {money(config.global_spent_cents)}. When a cap is hit, work halts — it never overruns.</p>
      <button className={config.panic_stop ? 'primary' : 'danger'} onClick={() => post('/api/panic', { on: !config.panic_stop })}>
        {config.panic_stop ? 'Resume everything' : 'Stop everything'}
      </button>

      <h4>Rooms</h4>
      <p className="muted tiny" style={{ marginTop: 0 }}>
        A room is data, not code. Adding one creates its own database account with exactly
        the access you choose — nothing in the app is written per room.
      </p>
      <button className="primary" style={{ marginBottom: 12 }} onClick={() => setAdding(true)}>New room…</button>
      <table className="grid-table">
        <thead><tr><th>Room</th><th>Cap</th><th>Spent</th><th>DB role</th><th>Tools</th><th>Status</th></tr></thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.id}>
              <td><span style={{ color: (r as any).color }}>{(r as any).icon}</span> {r.name}</td>
              <td><RoomCap room={r} /></td>
              <td>{money(r.spent_cents)}</td>
              <td className="mono">{r.db_role ?? '—'}</td>
              <td className="mono">{r.tool_grants.length}</td>
              <td>{r.status !== 'open'
                ? <button onClick={() => post('/api/rooms/resume', { room: r.key })}>resume {r.status}</button>
                : 'open'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        A room's tools, budget, memory and database role are its permission boundary. Anything
        outside them is refused by the runtime and logged.
      </p>
    </div>
  );
}

function RoomCap({ room }: { room: Room }) {
  const [v, setV] = useState(room.budget_cents);
  return (
    <span className="capedit">
      <input type="number" value={v} onChange={(e) => setV(Number(e.target.value))} />
      <button onClick={() => post('/api/budget', { room: room.key, cents: v })}>set</button>
    </span>
  );
}
