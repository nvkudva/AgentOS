import { post } from '../lib/api';
import type { Inbox } from '../lib/api';
import { GlanceTest } from './GlanceTest';
import { Supervisor } from './Supervisor';
import type { CmdCtx } from './commands';
import type { Theme } from '../lib/theme';

export function MenuBar({ config, inbox, needsMe, view, theme, setTheme, ctx, sidebar, onSidebar, onOpen }: {
  config: any; inbox: Inbox[]; needsMe: boolean; view: string;
  theme: Theme; setTheme: (t: Theme) => void; ctx: CmdCtx;
  sidebar: boolean; onSidebar: (b: boolean) => void;
  onOpen: (k: 'floor' | 'list' | 'inbox' | 'settings') => void;
}) {
  const cycle = () => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark');

  return (
    <div className="menubar">
      <Logo />
      <b>Atrium</b>
      <span className="menu" onClick={() => onOpen('floor')}>Overview</span>
      <span className="menu" onClick={() => onOpen('list')}>Activity</span>
      <span className="menu" onClick={() => onOpen('settings')}>Settings</span>
      <GlanceTest view={view} truth={needsMe} />

      <span className="spacer" />
      <Supervisor ctx={ctx} alert={needsMe} speak={true} />
      <span className="spacer" />

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

/**
 * The system mark, in the seat the Apple logo occupies: an agent — a ring of attention
 * with a core — rather than a letterform, so it reads at 16px and in either theme.
 */
function Logo() {
  return (
    <svg className="logo" viewBox="0 0 24 24" aria-label="AgentOS" role="img">
      <defs>
        <linearGradient id="agentos-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".95" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".55" />
        </linearGradient>
      </defs>
      <path fill="url(#agentos-mark)"
            d="M12 1.6a10.4 10.4 0 1 0 0 20.8 10.4 10.4 0 0 0 0-20.8Zm0 2.9a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Z" />
      <circle cx="12" cy="12" r="4.1" fill="url(#agentos-mark)" />
      <circle cx="18.6" cy="5.4" r="2.5" fill="currentColor" />
    </svg>
  );
}
