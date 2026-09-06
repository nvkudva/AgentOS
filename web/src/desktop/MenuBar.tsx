import { post } from '../lib/api';
import type { Inbox } from '../lib/api';
import { GlanceTest } from './GlanceTest';
import { Supervisor } from './Supervisor';
import type { CmdCtx } from './commands';
import type { Theme } from '../lib/theme';

export function MenuBar({ config, inbox, fps, needsMe, view, theme, setTheme, ctx, sidebar, onSidebar, onOpen }: {
  config: any; inbox: Inbox[]; fps: number; needsMe: boolean; view: string;
  theme: Theme; setTheme: (t: Theme) => void; ctx: CmdCtx;
  sidebar: boolean; onSidebar: (b: boolean) => void;
  onOpen: (k: 'floor' | 'list' | 'inbox' | 'settings') => void;
}) {
  const gp = Math.min(100, (config.global_spent_cents / Math.max(1, config.global_budget_cents)) * 100);
  const cycle = () => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark');

  return (
    <div className="menubar">
      <span className="logo">◍</span>
      <b>Atrium</b>
      <span className="menu" onClick={() => onOpen('floor')}>Overview</span>
      <span className="menu" onClick={() => onOpen('list')}>Activity</span>
      <span className="menu" onClick={() => onOpen('settings')}>Settings</span>
      <GlanceTest view={view} truth={needsMe} />

      <span className="spacer" />
      <Supervisor ctx={ctx} alert={needsMe} speak={true} />
      <span className="spacer" />

      <span className="mb-meter" title="frames per second">{fps} fps</span>
      <span className="mb-meter" title="global spend against the global cap">
        <span className={`bar${gp > 95 ? ' over' : gp > 70 ? ' warn' : ''}`}><i style={{ width: `${gp}%` }} /></span>
        ${(config.global_spent_cents / 100).toFixed(2)}
      </span>
      <span className="menu" onClick={cycle} title={`theme: ${theme}`}>
        {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🌗'}
      </span>
      <span className={`bell${inbox.length ? ' lit' : ''}${sidebar ? ' on' : ''}`} onClick={() => onSidebar(!sidebar)}
            title="notifications and approvals">
        {inbox.length ? '🔔' : '🔕'}{inbox.length > 0 && <i>{inbox.length}</i>}
      </span>
      <button className={config.panic_stop ? 'primary' : 'danger'} onClick={() => post('/api/panic', { on: !config.panic_stop })}>
        {config.panic_stop ? 'Resume' : 'Stop all'}
      </button>
    </div>
  );
}
