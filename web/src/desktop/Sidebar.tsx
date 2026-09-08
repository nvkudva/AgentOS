import { InboxApp } from '../apps/InboxApp';
import type { Inbox, Agent, Room, Mandate } from '../lib/api';
import { friendlyActivity, hours } from '../lib/humanize';

/**
 * A slide-over, not a column. It floats above the desktop like Notification Center,
 * and closes to nothing — the desktop underneath is never permanently narrowed.
 */
export function Sidebar({ open, inbox, agents, rooms, view, focusId, mandates = [],
                          onClose, onPick, onOpenRoom, onDecide }: {
  open: boolean; inbox: Inbox[]; agents: Agent[]; rooms: Room[];
  view: string; focusId?: string; mandates?: Mandate[];
  onClose: () => void; onPick: (a: Agent) => void;
  onOpenRoom: (roomKey: string) => void;
  onDecide?: (it: Inbox, decision: 'approve' | 'reject') => void;
}) {
  const busy = agents.filter((a) => a.state === 'working');
  const stuck = agents.filter((a) => ['blocked', 'failed', 'killed'].includes(a.state));
  return (
    <>
      <div className={`scrim${open ? ' on' : ''}`} onClick={onClose} />
      <aside className={`slideover${open ? ' on' : ''}`} aria-hidden={!open}>
        <header>
          <b>Needs you</b>
          <span className="count">{inbox.length}</span>
          <span className="spacer" />
          <button onClick={onClose} title="hide sidebar">›</button>
        </header>

        <div className="so-body">
          <InboxApp items={inbox} view={view} focusId={focusId} active={open} mandates={mandates}
                    onOpenRoom={onOpenRoom} onDecide={onDecide} />

          <h4>Running</h4>
          {!busy.length && <p className="muted pad-x">Nobody is working.</p>}
          {busy.map((a) => (
            <div className="so-row" key={a.id} onClick={() => onPick(a)}>
              <span className="face" style={{ ['--c' as any]: a.color }}>{a.avatar}<i className={`st ${a.state}`} /></span>
              <span className="crew-text"><b>{a.name}</b><em>{friendlyActivity(a.activity, a.state)}</em></span>
            </div>
          ))}

          {stuck.length > 0 && <>
            <h4>Stopped</h4>
            {stuck.map((a) => (
              <div className="so-row" key={a.id} onClick={() => onPick(a)}>
                <span className="face" style={{ ['--c' as any]: a.color }}>{a.avatar}<i className={`st ${a.state}`} /></span>
                <span className="crew-text"><b>{a.name}</b><em>{friendlyActivity(a.activity, a.state)}</em></span>
              </div>
            ))}
          </>}

          <h4>Rooms</h4>
          {rooms.map((r) => (
            <div className="so-room" key={r.id}>
              <span style={{ color: r.color }}>{r.icon}</span> {r.name}
              <span className="spacer" />
              <span className="muted">{hours(r.spent_cents)} of {hours(r.budget_cents)}</span>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
