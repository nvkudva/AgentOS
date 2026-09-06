import type { Win } from './wm';
import type { Agent, Inbox } from '../lib/api';

const APPS = [
  { kind: 'floor'    as const, icon: '▦', label: 'Floor' },
  { kind: 'list'     as const, icon: '☰', label: 'Activity' },
  { kind: 'inbox'    as const, icon: '📥', label: 'Approvals' },
  { kind: 'settings' as const, icon: '⚙',  label: 'Settings' },
];

export function Dock({ wins, agents, inbox, onLaunch, onFocus, onClose }: {
  wins: Win[]; agents: Agent[]; inbox: Inbox[];
  onLaunch: (k: 'floor' | 'list' | 'inbox' | 'settings') => void;
  onFocus: (id: string) => void; onClose: (id: string) => void;
}) {
  const working = agents.filter((a) => a.state === 'working').length;
  return (
    <div className="dock">
      {APPS.map((a) => (
        <button key={a.kind} className="dock-app" onClick={() => onLaunch(a.kind)} title={a.label}>
          <span>{a.icon}</span>
          {a.kind === 'inbox' && inbox.length > 0 && <i className="badge">{inbox.length}</i>}
        </button>
      ))}
      <span className="dock-sep" />
      {wins.map((w) => (
        <button key={w.id} className={`dock-app win${w.min ? ' min' : ''}`} onClick={() => onFocus(w.id)}
                onAuxClick={() => onClose(w.id)} title={w.title} style={{ ['--c' as any]: w.color }}>
          <span>{w.icon}</span>
          <i className="run" />
        </button>
      ))}
      <span className="spacer" />
      <span className="dock-status">{working} working · {agents.length} agents</span>
    </div>
  );
}
