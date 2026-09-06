import { useState } from 'react';
import { post } from '../lib/api';
import type { Inbox } from '../lib/api';
import { GlanceTest } from './GlanceTest';

export function MenuBar({ config, inbox, fps, needsMe, view, onOpen, onPick }: {
  config: any; inbox: Inbox[]; fps: number; needsMe: boolean; view: string;
  onOpen: (k: 'inbox' | 'settings' | 'floor' | 'list') => void;
  onPick: (i: Inbox) => void;
}) {
  const [bell, setBell] = useState(false);
  const gp = Math.min(100, (config.global_spent_cents / Math.max(1, config.global_budget_cents)) * 100);

  return (
    <div className="menubar">
      <span className="logo">◍</span>
      <b>Atrium</b>
      <span className="menu" onClick={() => onOpen('floor')}>Floor</span>
      <span className="menu" onClick={() => onOpen('list')}>Activity</span>
      <span className="menu" onClick={() => onOpen('inbox')}>Approvals</span>
      <GlanceTest view={view} truth={needsMe} />
      <span className="spacer" />
      <span className="mb-meter" title="frames per second">{fps} fps</span>
      <span className="mb-meter">
        <span className={`bar${gp > 95 ? ' over' : gp > 70 ? ' warn' : ''}`}><i style={{ width: `${gp}%` }} /></span>
        ${(config.global_spent_cents / 100).toFixed(2)} / ${(config.global_budget_cents / 100).toFixed(2)}
      </span>
      <span className={`bell${inbox.length ? ' lit' : ''}`} onClick={() => setBell((b) => !b)}>
        {inbox.length ? '🔔' : '🔕'}{inbox.length > 0 && <i>{inbox.length}</i>}
      </span>
      <span className="menu" onClick={() => onOpen('settings')}>⚙</span>
      <button className={config.panic_stop ? 'primary' : 'danger'} onClick={() => post('/api/panic', { on: !config.panic_stop })}>
        {config.panic_stop ? 'Resume all' : 'Stop all'}
      </button>

      {bell && (
        <div className="dropdown" onMouseLeave={() => setBell(false)}>
          <h5>Notifications</h5>
          {!inbox.length && <p className="muted">Nothing needs you.</p>}
          {inbox.map((i) => (
            <div className="note" key={i.id} onClick={() => { setBell(false); onPick(i); }}>
              <b>{i.action}</b>
              <span>{i.room_name} · {i.agent_name} · <span className="cost">{i.est_cost_cents}¢</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
