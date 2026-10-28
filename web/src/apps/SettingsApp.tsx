import { useEffect, useState } from 'react';
import { getSmartNlu, getWakeWord, setSmartNlu, setWakeWord, VOICE_SETTINGS_EVENT } from '../lib/voice/settings';
import * as llm from '../lib/voice/llm';
import { NewRoom } from './NewRoom';
import { post } from '../lib/api';
import { hours } from '../lib/humanize';
import { ListView } from '../components/ListView';
import type { Agent, Room } from '../lib/api';
import { useGlass } from '../lib/theme';

type PaneId = 'appearance' | 'voice' | 'limits' | 'rooms' | 'activity';
const PANES: { id: PaneId; label: string; glyph: string; colour: string }[] = [
  { id: 'appearance', label: 'Appearance', glyph: '◐', colour: '#5b8cff' },
  { id: 'voice', label: 'Voice', glyph: '●', colour: '#2fb98f' },
  { id: 'limits', label: 'Limits', glyph: '◆', colour: '#e0a63a' },
  { id: 'rooms', label: 'Rooms', glyph: '▣', colour: '#8352c9' },
  { id: 'activity', label: 'Activity', glyph: '≡', colour: '#7a8494' },
];

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
  const [pane, setPane] = useState<PaneId>('appearance');
  const { glass, setGlass } = useGlass();
  if (adding) return <NewRoom onDone={() => setAdding(false)} />;
  return (
    <div className="settings-app">
      <nav className="settings-nav" aria-label="Settings">
        {PANES.map((p) => (
          <button key={p.id} className={pane === p.id ? 'on' : ''} onClick={() => setPane(p.id)}>
            <i style={{ ['--c' as any]: p.colour }}>{p.glyph}</i>{p.label}
          </button>
        ))}
      </nav>
      <div className="settings" key={pane}>
        {pane === 'appearance' && <>
          <h4>Appearance</h4>
          <div className="sgroup">
            <label>
              <span className="srow"><b>Theme</b><em>Match the system, or pin light or dark.</em></span>
              <span className="seg">
                {(['light', 'dark', 'auto'] as const).map((t) => (
                  <button key={t} className={theme === t ? 'primary' : ''} onClick={() => setTheme(t)}>{t}</button>
                ))}
              </span>
            </label>
            <label>
              <span className="srow"><b>Transparency</b><em>Blur the wallpaper behind menus and panels.</em></span>
              <span className="seg">
                {(['auto', 'glass', 'lite'] as const).map((m) => (
                  <button key={m} className={perf.mode === m ? 'primary' : ''} onClick={() => perf.setMode(m)}>{m}</button>
                ))}
              </span>
            </label>
            <label>
              <span className="srow"><b>Wallpaper</b><em>A calm gradient, or the full scene.</em></span>
              <span className="seg">
                {(['calm', 'scene'] as const).map((w) => (
                  <button key={w} className={wallpaper === w ? 'primary' : ''} onClick={() => setWallpaper(w)}>{w}</button>
                ))}
              </span>
            </label>
            <label>
              <span className="srow"><b>Glass</b><em>Ultra-clear to fully tinted, like the system.</em></span>
              <input type="range" min={30} max={95} step={1} value={glass}
                     style={{ ['--fill' as any]: `${((glass - 30) / 65) * 100}%` }}
                     onChange={(e) => setGlass(Number(e.target.value))}
                     aria-label="Glass opacity" />
            </label>
          </div>
          <p className="muted tiny sgnote">
            Glass blurs the wallpaper behind the chrome. On software rendering that halves the
            frame rate, so <b>auto</b> measures {perf.measured ? `${perf.measured}fps` : 'the first two seconds'} and
            drops to flat surfaces if it cannot hold 60.
          </p>
        </>}

        {pane === 'voice' && <VoiceSection />}

        {pane === 'limits' && <>
          <h4>Operator</h4>
          <div className="sgroup">
            <label>
              <span className="srow"><b>Backend token</b><em>{hasToken ? 'Stored on this device.' : 'Needed for the live backend.'}</em></span>
              <input type="password" placeholder={hasToken ? 'set — paste to replace' : 'none — demo stays offline'}
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
          </div>
          <p className="muted tiny sgnote">{hasToken
            ? 'Enter clears it; the desk goes back to the frozen demo.'
            : 'The live backend needs its operator token (printed once at server boot). Press Enter to save and reload.'}</p>

          <h4>Global</h4>
          <div className="sgroup">
            <label>
              <span className="srow"><b>Global cap</b><em>Agent-minutes. Spent {hours(config.global_spent_cents)}.</em></span>
              <span className="capedit">
                <input type="number" value={g} onChange={(e) => setG(Number(e.target.value))} />
                <button onClick={() => post('/api/budget', { cents: g })}>Save</button>
              </span>
            </label>
          </div>
          <p className="muted tiny sgnote">When a cap is hit, work halts — it never overruns.</p>
          <div className="sgroup">
            <label>
              <span className="srow"><b>{config.panic_stop ? 'Everything is stopped' : 'Emergency stop'}</b>
                <em>{config.panic_stop ? 'Resume to let rooms work again.' : 'Halt every room immediately.'}</em></span>
              <button className={config.panic_stop ? 'primary' : 'danger'} onClick={() => post('/api/panic', { on: !config.panic_stop })}>
                {config.panic_stop ? 'Resume everything' : 'Stop everything'}
              </button>
            </label>
          </div>
        </>}

        {pane === 'rooms' && <>
          <h4>Rooms</h4>
          <div className="sgroup">
            <label>
              <span className="srow"><b>New room</b>
                <em>A room is data, not code. It gets its own database account with exactly the access you choose.</em></span>
              <button className="primary" onClick={() => setAdding(true)}>New room…</button>
            </label>
          </div>
          <div className="sgroup flush" style={{ marginTop: 16 }}><table className="grid-table">
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
          </table></div>
          <p className="muted tiny sgnote">
            A room's tools, budget, memory and database role are its permission boundary. Anything
            outside them is refused by the runtime and logged.
          </p>
        </>}

        {pane === 'activity' && <>
          <h4>Activity</h4>
          <p className="muted tiny sgnote" style={{ marginTop: 0 }}>
            The raw event feed — the thesis's falsification control. It lives here so it
            stops competing with Work in the dock, and it stays measurable.
          </p>
          <ListView rooms={rooms} agents={agents} />
        </>}
      </div>
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
      <div className="sgroup">
        <label>
          <input type="checkbox" checked={wake} onChange={(e) => setWakeWord(e.target.checked)} />
          <span className="srow"><b>Wake word</b><em>Say “Atrium” hands-free. The mic stays on; audio never leaves this device.</em></span>
        </label>
        <label>
          <input type="checkbox" checked={smart} onChange={(e) => { setSmartNlu(e.target.checked); if (e.target.checked) llm.preload(); }} />
          <span className="srow"><b>Smart understanding</b><em>On-device language model, 270–390 MB one-time download.</em></span>
        </label>
      </div>
      <h4>On-device models</h4>
      <div className="sgroup">
        <div className="kv"><span>Speech recognition · Distil-Whisper small.en</span><em>~170–350 MB</em></div>
        <div className="kv"><span>Voice · Kokoro 82M</span><em>~90 MB</em></div>
        <div className="kv"><span>Language · SmolLM2 360M (smart understanding only)</span><em>270–390 MB</em></div>
      </div>
      <div className="sgroup" style={{ marginTop: 16 }}>
        <label>
          <span className="srow"><b>Downloaded models</b><em>{deleted ? 'Deleted — models download again on next use.' : 'Free the disk space; they download again on next use.'}</em></span>
          <button className="danger" onClick={deleteModels}>Delete</button>
        </label>
      </div>
    </>
  );
}
