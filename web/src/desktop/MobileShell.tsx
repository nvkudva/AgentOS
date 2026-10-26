import { Suspense, lazy } from 'react';
import { Sidebar } from './Sidebar';
import { AwayStrip } from '../components/AwayStrip';
import type { Agent, Inbox, Mandate, Room, Task } from '../lib/api';
import type { Theme } from '../lib/theme';

const FloorApp = lazy(() => import('../apps/FloorApp').then((m) => ({ default: m.FloorApp })));
const WorkApp = lazy(() => import('../apps/WorkApp').then((m) => ({ default: m.WorkApp })));
const RoomApp = lazy(() => import('../apps/RoomApp').then((m) => ({ default: m.RoomApp })));
const SettingsApp = lazy(() => import('../apps/SettingsApp').then((m) => ({ default: m.SettingsApp })));
const AgentApp = lazy(() => import('../apps/AgentApp').then((m) => ({ default: m.AgentApp })));

export type MTab = 'needs' | 'rooms' | 'work';

const FALLBACK = <div className="pad muted">One moment…</div>;

/**
 * The phone stops pretending to be a desk: three tabs (Needs you / Rooms /
 * Work), a fullscreen console with a back button, the orb as a FAB. Same
 * snapshot, same decide path — the tabs rearrange existing views, and the
 * desktop keeps every window it had when the viewport widens again.
 */
export function MobileShell({ tab, setTab, mroom, magent, mset, rooms, agents,
                              mandates, tasks, inbox, view, focusId, config, perf,
                              theme, setTheme, onDecide, onOpenRoom, onPick, onConsole,
                              onRunAgain, onCloseOverlays, strip, stripNeed,
                              stripBlocked, stripWorking, onStripDone }: {
  tab: MTab; setTab: (t: MTab) => void;
  mroom: string | null; magent: string | null; mset: boolean;
  rooms: Room[]; agents: Agent[]; mandates: Mandate[]; tasks: Task[];
  inbox: Inbox[]; view: string; focusId?: string; config: any;
  perf: { mode: string; setMode: (m: any) => void; measured: number | null };
  theme: Theme; setTheme: (t: Theme) => void;
  onDecide: (it: Inbox, decision: 'approve' | 'reject') => void;
  onOpenRoom: (roomKey: string) => void;
  onPick: (a: Agent) => void;
  onConsole: (roomId: string) => void;
  onRunAgain: (text: string, room: Room, from: DOMRect) => void;
  onCloseOverlays: () => void;
  strip: boolean; stripNeed: number; stripBlocked: number; stripWorking: number;
  onStripDone: () => void;
}) {
  const room = mroom ? rooms.find((r) => r.id === mroom) : undefined;
  return (
    <div className="mshell">
      {(mroom && room) ? (
        <div className="mconsole">
          <div className="mconsole-bar">
            <button onClick={onCloseOverlays} aria-label="Back to rooms">‹</button>
            <b>{room.icon} {room.name}</b>
          </div>
          <Suspense fallback={FALLBACK}>
            <RoomApp room={room} view={view} mandates={mandates} tasks={tasks} agents={agents} />
          </Suspense>
        </div>
      ) : magent ? (
        <div className="mconsole">
          <div className="mconsole-bar">
            <button onClick={onCloseOverlays} aria-label="Back">‹</button>
            <b>Agent</b>
          </div>
          <Suspense fallback={FALLBACK}>
            <AgentApp agentId={magent} />
          </Suspense>
        </div>
      ) : mset ? (
        <div className="mconsole">
          <div className="mconsole-bar">
            <button onClick={onCloseOverlays} aria-label="Back">‹</button>
            <b>⚙️ Settings</b>
          </div>
          <Suspense fallback={FALLBACK}>
            <SettingsApp rooms={rooms} agents={agents} config={config} perf={perf}
                         theme={theme} setTheme={setTheme} />
          </Suspense>
        </div>
      ) : (
        <>
          <div className="mtabs-body">
            <Suspense fallback={FALLBACK}>
              {tab === 'needs' && (
                <Sidebar open inbox={inbox} agents={agents} rooms={rooms} view={view}
                         focusId={focusId} mandates={mandates} onClose={() => setTab('rooms')}
                         onPick={onPick} onOpenRoom={onOpenRoom} onDecide={onDecide} />
              )}
              {tab === 'rooms' && (
                <FloorApp rooms={rooms} agents={agents} mandates={mandates} tasks={tasks}
                          onOpen={(r) => onConsole(r.id)} inbox={inbox} view={view}
                          onDecide={onDecide} consoles={mroom ? [mroom] : []} />
              )}
              {tab === 'work' && (
                <WorkApp mandates={mandates} tasks={tasks} rooms={rooms} agents={agents}
                         active={true} onRunAgain={onRunAgain} />
              )}
            </Suspense>
          </div>
          <nav className="mtabs" aria-label="Sections">
            <button className={tab === 'needs' ? 'on' : ''} onClick={() => setTab('needs')}>
              Needs you{inbox.length > 0 && <i className="badge">{inbox.length}</i>}
            </button>
            <button className={tab === 'rooms' ? 'on' : ''} onClick={() => setTab('rooms')}>Rooms</button>
            <button className={tab === 'work' ? 'on' : ''} onClick={() => setTab('work')}>Work</button>
          </nav>
        </>
      )}
      {strip && <AwayStrip need={stripNeed} blocked={stripBlocked} working={stripWorking}
                           onDone={onStripDone} />}
    </div>
  );
}
