import { useEffect, useState } from 'react';
import { getSmartNlu, getWakeWord, setSmartNlu, setWakeWord, VOICE_SETTINGS_EVENT } from '../lib/voice/settings';
import * as llm from '../lib/voice/llm';
import { NewRoom } from './NewRoom';
import { post } from '../lib/api';
import { hours } from '../lib/humanize';
import { ListView } from '../components/ListView';
import type { Agent, Room } from '../lib/api';

export function SettingsApp({ rooms, agents, config, perf, theme, setTheme, wallpaper, setWallpaper }: {
  rooms: Room[]; agents: Agent[]; config: any;
  perf: { mode: string; setMode: (m: any) => void; measured: number | null };
  theme: string; setTheme: (t: any) => void;
  wallpaper: 'calm' | 'scene'; setWallpaper: (w: 'calm' | 'scene') => void;
}) {
  const [g, setG] = useState(config.global_budget_cents);
  const [hasToken] = useState(() => {
    try { return !!localStorage.getItem('atrium.token'); } catch { return false; }
  });
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
      <label>
        Wallpaper
        <span className="seg">
          {(['calm', 'scene'] as const).map((w) => (
            <button key={w} className={wallpaper === w ? 'primary' : ''} onClick={() => setWallpaper(w)}>{w}</button>
          ))}
        </span>
      </label>
      <p className="muted tiny">
        Glass blurs the wallpaper behind the chrome. On software rendering that halves the
        frame rate, so <b>auto</b> measures {perf.measured ? `${perf.measured}fps` : 'the first two seconds'} and
        drops to flat surfaces if it cannot hold 60.
      </p>

      <VoiceSection />

      <h4>Operator</h4>
      <label>
        Backend token
        <input type="password" placeholder={hasToken ? 'set — paste to replace' : 'none — hosted demo stays offline'}
               onKeyDown={(e) => {
                 if (e.key !== 'Enter') return;
                 const v = (e.target as HTMLInputElement).value.trim();
                 try {
                   if (v) localStorage.setItem('atrium.token', v);
                   else localStorage.removeItem('atrium.token');
                 } catch { /* ignore */ }
                 location.reload();
               }} />
      </label>
      <p className="muted">{hasToken
        ? 'Token stored on this device. Enter clears it; the desk goes back to the frozen demo.'
        : 'The live backend needs its operator token (printed once at server boot). Press Enter to save and reload.'}</p>

      <h4>Global</h4>
      <label>
        Global cap (agent-minutes)
        <input type="number" value={g} onChange={(e) => setG(Number(e.target.value))} />
        <button onClick={() => post('/api/budget', { cents: g })}>Save</button>
      </label>
      <p className="muted">Spent {hours(config.global_spent_cents)}. When a cap is hit, work halts — it never overruns.</p>
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
              <td>{hours(r.spent_cents)}</td>
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

      <h4>Activity</h4>
      <p className="muted tiny" style={{ marginTop: 0 }}>
        The raw event feed — the thesis's falsification control. It lives here so it
        stops competing with Work in the dock, and it stays measurable.
      </p>
      <ListView rooms={rooms} agents={agents} />
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

function VoiceSection() {
  const [wake, setWake] = useState(getWakeWord);
  const [smart, setSmart] = useState(getSmartNlu);
  const [deleted, setDeleted] = useState(false);
  useEffect(() => {
    const sync = () => { setWake(getWakeWord()); setSmart(getSmartNlu()); };
    window.addEventListener(VOICE_SETTINGS_EVENT, sync);
    return () => window.removeEventListener(VOICE_SETTINGS_EVENT, sync);
  }, []);
  const deleteModels = async () => {
    try {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.includes('transformers')).map((n) => caches.delete(n)));
    } catch { /* no Cache Storage: nothing to delete */ }
    setDeleted(true);
  };
  return (
    <>
      <h4>Voice</h4>
      <label>
        <input type="checkbox" checked={wake} onChange={(e) => setWakeWord(e.target.checked)} />
        Wake word — say “Atrium” hands-free (mic stays on; audio never leaves this device)
      </label>
      <label>
        <input type="checkbox" checked={smart} onChange={(e) => { setSmartNlu(e.target.checked); if (e.target.checked) llm.preload(); }} />
        Smart understanding — on-device language model, 270–390 MB one-time download
      </label>
      <p className="muted tiny">On-device models:</p>
      <ul className="muted tiny voice-models">
        <li>Speech recognition: Whisper tiny.en ~40 MB</li>
        <li>Voice: Kokoro 82M ~90 MB</li>
        <li>Language: SmolLM2 360M 270–390 MB, only with smart understanding</li>
      </ul>
      <button onClick={deleteModels}>Delete downloaded voice models</button>
      {deleted && <p className="muted tiny">Deleted — models download again on next use.</p>}
    </>
  );
}
