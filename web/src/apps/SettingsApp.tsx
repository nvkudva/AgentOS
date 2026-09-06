import { useState } from 'react';
import { post } from '../lib/api';
import type { Room } from '../lib/api';

export function SettingsApp({ rooms, config }: { rooms: Room[]; config: any }) {
  const [g, setG] = useState(config.global_budget_cents);
  return (
    <div className="pad settings">
      <h4>Global</h4>
      <label>
        Global cap (cents)
        <input type="number" value={g} onChange={(e) => setG(Number(e.target.value))} />
        <button onClick={() => post('/api/budget', { cents: g })}>Save</button>
      </label>
      <p className="muted">Spent {config.global_spent_cents}¢. When a cap is hit, work halts — it never overruns.</p>
      <button className={config.panic_stop ? 'primary' : 'danger'} onClick={() => post('/api/panic', { on: !config.panic_stop })}>
        {config.panic_stop ? 'Resume everything' : 'Stop everything'}
      </button>

      <h4>Rooms</h4>
      <table className="grid-table">
        <thead><tr><th>Room</th><th>Cap</th><th>Spent</th><th>DB role</th><th>Tools</th><th>Status</th></tr></thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.id}>
              <td><span style={{ color: (r as any).color }}>{(r as any).icon}</span> {r.name}</td>
              <td><RoomCap room={r} /></td>
              <td>{r.spent_cents}¢</td>
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
