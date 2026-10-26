import { useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../lib/api';
import { describe, hours } from '../lib/humanize';
import { startCarry } from '../desktop/carry';
import type { Agent, Mandate, Room, Task } from '../lib/api';

const STATE_WORD: Record<string, string> = {
  heard: 'Heard', routed: 'Routed', planned: 'Planned', working: 'Working',
  blocked: 'Blocked', done: 'Done', recalled: 'Recalled',
};

/**
 * Dock Work view: the operator's mandates — their own sentences — with room,
 * chain of custody, cost and outcome. A row drags onto any room to re-run it
 * there; Run again re-sends the same sentence through the same route.
 * The raw event feed this replaces lives in Settings now.
 */
export function WorkApp({ mandates, tasks, rooms, agents, active, onRunAgain }: {
  mandates: Mandate[]; tasks: Task[]; rooms: Room[]; agents: Agent[];
  /** front-most: the only time ⌘F is ours to take */
  active: boolean;
  onRunAgain: (text: string, room: Room, from: DOMRect) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [feed, setFeed] = useState<any[]>([]);
  const filterRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const f = () => get('/api/list?limit=250').then((next) => setFeed(next ?? []));
    f(); const t = setInterval(f, 5000); return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault(); filterRef.current?.focus(); filterRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const roomOf = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r])), [rooms]);
  const nameOf = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name])), [agents]);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return [...mandates]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .filter((m) => {
        if (!words.length) return true;
        const hay = `${m.text} ${roomOf[m.room_id ?? '']?.name ?? ''} ${m.state} ${m.report ?? ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
  }, [mandates, q, roomOf]);

  if (!mandates.length) return (
    <div className="pad">
      <h3>No mandates yet</h3>
      <p className="muted">Sentences you speak to the orb become mandates — they will land here with their chain, cost and outcome.</p>
    </div>
  );

  return (
    <div className="work">
      <div className="work-filter">
        <input ref={filterRef} value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Filter (⌘F)" aria-label="Filter mandates" />
        {q && <button onClick={() => setQ('')} aria-label="Clear filter">×</button>}
      </div>
      {!shown.length && (
        <div className="pad">
          <h3>Nothing matches</h3>
          <p className="muted">No mandate contains every word in “{q}”.</p>
        </div>
      )}
      {shown.map((m) => (
        <WorkRow key={m.id} m={m} room={m.room_id ? roomOf[m.room_id] : undefined}
                 tasks={tasks.filter((t) => t.mandate_id === m.id)} agents={agents} nameOf={nameOf}
                 feed={feed} expanded={open === m.id} onToggle={() => setOpen((o) => (o === m.id ? null : m.id))}
                 onRunAgain={onRunAgain} />
      ))}
    </div>
  );
}

function WorkRow({ m, room, tasks, agents, nameOf, feed, expanded, onToggle, onRunAgain }: {
  m: Mandate; room: Room | undefined; tasks: Task[]; agents: Agent[];
  nameOf: Record<string, string>; feed: any[];
  expanded: boolean; onToggle: () => void;
  onRunAgain: (text: string, room: Room, from: DOMRect) => void;
}) {
  const colour = m.color ?? room?.color ?? '#8b7cf5';
  const mgr = agents.find((a) => a.room_id === m.room_id && a.tier === 'manager');
  const workers = [...new Set(tasks.map((t) => t.agent_id).filter(Boolean)
    .map((id) => nameOf[id!]).filter(Boolean))];
  const chain = ['You', mgr?.name ?? room?.name ?? '—', ...workers].join(' → ');
  const doneCount = tasks.filter((t) => t.state === 'done').length;
  const agentIds = new Set(tasks.map((t) => t.agent_id).filter(Boolean));
  const events = feed.filter((e) => agentIds.has(e.agent_id)).slice(0, 30);
  return (
    <div className="work-row" data-mandate={m.id}
         onPointerDown={(e) => startCarry(e, {
           kind: 'mandate', id: m.id, label: m.text, colour, roomId: m.room_id,
         })}>
      <button className="work-main" onClick={onToggle} aria-expanded={expanded} title="Chain of custody">
        <span className="work-bar" style={{ background: colour }} />
        <span className="work-text">
          <b>{m.text}</b>
          <span className="work-sub">{room?.name ?? 'No room'} · {chain}</span>
          <span className="work-sub">
            {hours(m.spent_cents)}{m.quoted_cents ? ` of ${hours(m.quoted_cents)} quoted` : ''}
            {tasks.length ? ` · ${doneCount}/${tasks.length} tasks` : ''} · {STATE_WORD[m.state] ?? m.state}
          </span>
          {m.report
            ? <span className="work-out">{m.report.split('\n')[0]}</span>
            : <span className="work-out muted">{m.state === 'done' ? 'Finished with no report.' : 'No outcome yet.'}</span>}
        </span>
        <span className="work-chev" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="work-detail">
          {tasks.length ? tasks.map((t) => (
            <div className="work-task" key={t.id}>
              <span className={`st ${t.state}`} />
              <span>{t.title}</span>
              <span className="spacer" />
              <span className="muted">{t.agent_id ? nameOf[t.agent_id] ?? '—' : 'unassigned'}</span>
            </div>
          )) : <p className="muted tiny">No tasks decomposed yet.</p>}
          {events.length > 0 && (
            <div className="rows">
              {events.map((e) => {
                const said = describe(e, nameOf[e.agent_id] ?? 'someone');
                if (!said) return null;
                return (
                  <div className={`row ${said.kind}`} key={e.id}>
                    <span className="rtext">{said.text}</span>
                    <span className="when">{new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                );
              })}
            </div>
          )}
          {room && (
            <button className="work-rerun" onClick={(e) => onRunAgain(m.text, room,
                      (e.currentTarget as HTMLElement).getBoundingClientRect())}>
              Run again in {room.name}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
