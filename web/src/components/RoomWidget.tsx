import { memo } from 'react';
import type { Room, Agent, Mandate, Task, Inbox } from '../lib/api';
import { friendlyActivity, hours } from '../lib/humanize';
import { roomDetail, roomProgress } from '../lib/progress';
import { peekPress } from '../desktop/Peek';
import { NeedsYouBar } from './NeedsYouBar';

const ATTN = new Set(['awaiting_approval', 'blocked', 'failed']);

/**
 * A room at a glance: what it is working on, and who is in it.
 *
 * Deliberately not a feed. A card per agent saying what each one last said is four
 * lines of chatter that change constantly and never add up to the state of the room —
 * one sentence of progress and a row of faces answers "does this need me?" faster.
 *
 * The manager's report is here but clamped to two lines: it is the one line whose length
 * nothing bounds, and a card that grows with it stops being a grid. The console has all of it.
 */
function Widget({ room, agents, mandates = [], tasks = [], onOpen, inbox = [], view, onDecide, consoleOpen = false }: {
  room: Room; agents: Agent[]; mandates?: Mandate[]; tasks?: Task[]; onOpen: (r: Room) => void;
  inbox?: Inbox[]; view?: string; onDecide?: (it: Inbox, decision: 'approve' | 'reject') => void;
  consoleOpen?: boolean;
}) {
  const needs = inbox.filter((it) => it.room_key === room.key);
  const p = roomProgress(room, mandates, tasks, agents);
  const d = roomDetail(room, mandates, tasks, agents);
  const pct = Math.min(100, (room.spent_cents / Math.max(1, room.budget_cents)) * 100);
  const warn = agents.some((a) => a.state === 'failed');
  const cls = `room${room.status === 'capped' ? ' capped' : p.needs ? ' needs' : warn ? ' blocked' : ''}`;

  return (
    <div className={cls} style={{ gridColumn: `span ${room.w}`, gridRow: `span ${room.h}`,
                                 ['--room' as any]: room.color }}
         onClick={() => onOpen(room)}>
      <div className="room-head">
        <span style={{ color: room.color }}>{room.icon}</span>
        <span className="room-name">{room.name}</span>
        {room.status !== 'open' && <span className="pill capped">{room.status}</span>}
        {consoleOpen && <span className="pill open">open</span>}
        <span className="room-obj">{room.objective}</span>
      </div>
      {view !== undefined && <NeedsYouBar items={needs} view={view} onDecide={onDecide} onDetails={() => onOpen(room)} />}

      <div className="room-now">
        {p.mandate && <b>“{p.mandate.text}”</b>}
        <p>{p.where}</p>
      </div>

      <div className="room-more">
        {p.report && <q>{p.report}</q>}
        <p>{d.crew}. {d.load}</p>
        <p className="quiet">{d.scope}</p>
      </div>

      <div className="room-crew">
        {agents.map((a) => {
          const mine = tasks.filter((t) => t.agent_id === a.id);
          return (
            <span key={a.id} className={`face sm${ATTN.has(a.state) ? ' attn' : ''}`}
                  style={{ ['--c' as any]: a.color }} title={`${a.name} — ${a.persona}`}
                  onPointerDown={(e) => peekPress(e, {
                    name: a.name, role: a.role, avatar: a.avatar, colour: a.color,
                    activity: friendlyActivity(a.activity, a.state), state: a.state,
                    steps: mine.filter((t) => t.state === 'done').slice(-2).map((t) => t.title),
                    spend: `${hours(a.spent_cents)} of ${hours(a.cost_budget_cents)}`,
                    chits: mine.filter((t) => t.state === 'queued' || t.state === 'working').map((t) => t.title),
                  })}>
              {a.avatar}<i className={`st ${a.state}`} />
            </span>
          );
        })}
      </div>

      <div className="room-foot">
        <span className={`bar${pct > 95 ? ' over' : pct > 70 ? ' warn' : ''}`} style={{ width: 64 }}>
          <i style={{ width: `${pct}%` }} />
        </span>
        <span>{hours(room.spent_cents)} of {hours(room.budget_cents)}</span>
        <span className="spacer" />
        <span>{room.tool_grants.length} tools</span>
      </div>
    </div>
  );
}

/** Memoised on the room's own slice: one chatty agent never re-renders the floor. */
const sameNeeds = (a: Inbox[] = [], b: Inbox[] = []) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id);
export const RoomWidget = memo(Widget, (a, b) =>
  a.room === b.room && a.mandates === b.mandates && a.tasks === b.tasks &&
  a.view === b.view && a.onDecide === b.onDecide && a.consoleOpen === b.consoleOpen && sameNeeds(a.inbox, b.inbox) &&
  a.agents.length === b.agents.length && a.agents.every((x, i) => x === b.agents[i]));
