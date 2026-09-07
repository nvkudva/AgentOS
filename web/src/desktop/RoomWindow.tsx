import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Room, Agent, Mandate, Task } from '../lib/api';
import { friendlyActivity, hours, requiredTools } from '../lib/humanize';
import { calm, tok } from './carry';
import { peekPress } from './Peek';
import { send } from './courier';
import { Chit } from './Chit';

const ATTN = new Set(['awaiting_approval', 'blocked', 'failed']);
const OPEN = new Set(['queued', 'working']);
const FRESH_MS = 20000;

/**
 * A row is "fresh" for twenty seconds after its agent changes state. Only fresh rows
 * breathe; after that the status dot drops to a slow half-swing pulse. Fourteen
 * agents breathing forever is weather, and weather drowns out the real handoffs.
 */
function useFresh(agents: Agent[]) {
  const seen = useRef(new Map<string, string>());
  const [fresh, setFresh] = useState<Record<string, number>>({});
  useEffect(() => {
    const changed: string[] = [];
    for (const a of agents) {
      const was = seen.current.get(a.id);
      seen.current.set(a.id, a.state);
      if (was !== undefined && was !== a.state) changed.push(a.id);
    }
    if (!changed.length) return;
    setFresh((f) => {
      const next = { ...f };
      for (const id of changed) next[id] = Date.now();
      return next;
    });
    const t = setTimeout(() => {
      const cut = Date.now() - FRESH_MS + 50;
      setFresh((f) => Object.fromEntries(Object.entries(f).filter(([, at]) => at > cut)));
    }, FRESH_MS);
    return () => clearTimeout(t);
  }, [agents]);
  return fresh;
}

/** Captions cross-fade in place. A caption that slides makes a still list look busy. */
function Caption({ text }: { text: string }) {
  const [prev, setPrev] = useState<string | null>(null);
  const last = useRef(text);
  useEffect(() => {
    if (last.current === text) return;
    setPrev(last.current);
    last.current = text;
    const t = setTimeout(() => setPrev(null), 140);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <em className="cap">
      <i key={text} className="cap-in">{text}</i>
      {prev !== null && <i className="cap-out">{prev}</i>}
    </em>
  );
}

/**
 * How much of this mandate the room has finished, drawn around the manager's face.
 * A task that has stopped for the human puts an amber notch at its own position — the
 * manager's arc is where an escalation is visible without opening anything.
 */
function Arc({ done, total, notch }: { done: number; total: number; notch?: number | null }) {
  const R = 24, C = 2 * Math.PI * R;
  const p = total ? Math.min(1, done / total) : 0;
  return (
    <svg className="arc" viewBox="0 0 52 52" aria-hidden="true">
      <circle cx="26" cy="26" r={R} style={{ strokeDasharray: `${(C * p).toFixed(1)} ${C.toFixed(1)}` }} />
      {notch != null && (
        <circle className="notch" cx="26" cy="26" r={R}
                style={{ strokeDasharray: `4 ${(C - 4).toFixed(1)}`,
                         strokeDashoffset: `${(-C * notch).toFixed(1)}` }} />
      )}
    </svg>
  );
}

/**
 * A chit handed down the spine: straight down, then one 8px step right into the row.
 * Never a diagonal — the L is what makes it read as travelling along the hierarchy
 * rather than flying across it, which is the courier's job and the courier's grammar.
 */
function walkDown(from: DOMRect, to: DOMRect, label: string, colour: string, delay: number, done: () => void) {
  if (calm()) { setTimeout(done, 90); return; }
  const n = document.createElement('span');
  n.className = 'chit walker';
  n.style.cssText = `left:${from.left}px;top:${from.top}px;height:${from.height}px`;
  n.style.setProperty('--c', colour);
  const b = document.createElement('b');
  b.textContent = label;
  n.appendChild(b);
  document.body.appendChild(n);
  const dx = to.left - from.left, dy = to.top + to.height / 2 - from.top - from.height / 2;
  n.animate([
    { transform: 'translate3d(0,0,0)', opacity: 1 },
    { transform: `translate3d(0,${dy}px,0)`, offset: 0.66 },
    { transform: `translate3d(${dx}px,${dy}px,0)`, opacity: 1, offset: 260 / 380 },
    { transform: `translate3d(${dx}px,${dy}px,0)`, opacity: 0 },
  ], { duration: 380, delay, easing: tok('--ease'), fill: 'backwards' })
   .onfinish = () => { n.remove(); done(); };
}

type BodyP = {
  room: Room; agents: Agent[]; mandates: Mandate[]; tasks: Task[];
  onAgent: (a: Agent) => void; activeId?: string;
  onOpenTask: (t: Task) => void; onRecall: (m: Mandate) => void;
  undo?: { text: string; run: () => void } | null;
};

function Body({ room, agents, mandates, tasks, onAgent, activeId, onOpenTask, onRecall, undo }: BodyP) {
  const fresh = useFresh(agents);
  const host = useRef<HTMLDivElement>(null);
  const seats = useRef(new Map<string, DOMRect>());   // where each strip chit sat last frame
  const states = useRef(new Map<string, string>());
  const [walking, setWalking] = useState<Record<string, true>>({});
  const [bloom, setBloom] = useState<Record<string, number>>({});

  // A room shows the work it is holding: what it finished is in its notes, not on its face.
  const live = mandates.filter((m) => m.room_id === room.id && !['recalled', 'done'].includes(m.state));
  const mine = tasks.filter((t) => live.some((m) => m.id === t.mandate_id));
  const colourOf = (t: Task) => live.find((m) => m.id === t.mandate_id)?.color || room.color;
  const costOf = (t: Task) => {
    const m = live.find((x) => x.id === t.mandate_id);
    const n = m ? Math.max(1, mine.filter((x) => x.mandate_id === m.id).length) : 1;
    return hours(Math.round((m?.quoted_cents ?? 0) / n));
  };
  // Queued is the strip; working is on a worker's line. The walk between the two is
  // the assignment, whether the manager made it or the operator's hand did.
  const strip = mine.filter((t) => t.state === 'queued');
  const done = mine.filter((t) => t.state === 'done').length;

  const manager = agents.find((a) => a.tier === 'manager');
  const workers = agents.filter((a) => a.tier !== 'manager');

  // The seat a chit occupied is recorded every frame, because the render that assigns it
  // is the same render that removes it from the strip.
  useLayoutEffect(() => {
    for (const el of Array.from(host.current?.querySelectorAll<HTMLElement>('.strip .chit') ?? []))
      if (el.dataset.task) seats.current.set(el.dataset.task, el.getBoundingClientRect());
  });

  /** Chits bloom out of the manager 280ms after the tasks land. */
  useEffect(() => {
    const born = strip.filter((t) => !seats.current.has(t.id) && bloom[t.id] === undefined);
    if (!born.length) return;
    setBloom((b) => ({ ...b, ...Object.fromEntries(born.map((t, i) => [t.id, i])) }));
    const to = setTimeout(() => setBloom({}), 280 + born.length * 45 + 500);
    return () => clearTimeout(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.map((t) => t.id).join()]);

  /** Assignment walks down the spine; completion sends a 5px dot back up it. */
  useEffect(() => {
    let n = 0;
    for (const t of mine) {
      const wasState = states.current.get(t.id);
      states.current.set(t.id, t.state);
      const row = t.agent_id
        ? host.current?.querySelector<HTMLElement>(`[data-agent="${CSS.escape(t.agent_id)}"] .ticks`)
        : null;

      if (t.state === 'working' && wasState === 'queued' && row) {
        const from = seats.current.get(t.id);
        if (from) {
          setWalking((w) => ({ ...w, [t.id]: true }));
          walkDown(from, row.getBoundingClientRect(), t.title, colourOf(t), n++ * 80,
                   () => setWalking((w) => { const x = { ...w }; delete x[t.id]; return x; }));
        }
      }
      if (t.state === 'done' && wasState && wasState !== 'done' && row && manager) {
        const face = host.current?.querySelector<HTMLElement>('.crew.mgr .face');
        if (face) send({ from: row.getBoundingClientRect(), to: face.getBoundingClientRect(),
                         colour: colourOf(t), kind: 'result', near: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.map((t) => `${t.id}:${t.agent_id}:${t.state}`).join()]);

  const notch = (() => {
    const stuck = mine.findIndex((t) => {
      const who = agents.find((x) => x.id === t.agent_id);
      return !!who && ATTN.has(who.state);
    });
    return stuck < 0 || !mine.length ? null : (stuck + 0.5) / mine.length;
  })();

  const row = (a: Agent) => {
    const ticks = mine.filter((t) => t.agent_id === a.id && t.state === 'working');
    const mgr = a.tier === 'manager';
    const held = mgr ? live[0]?.id : mine.find((t) => t.agent_id === a.id)?.mandate_id;
    const info = {
      name: a.name, role: a.role, avatar: a.avatar, colour: a.color,
      activity: friendlyActivity(a.activity, a.state), state: a.state,
      steps: mine.filter((t) => t.agent_id === a.id && t.state === 'done').slice(-2).map((t) => t.title),
      spend: `${hours(a.spent_cents)} of ${hours(a.cost_budget_cents)}`,
      chits: ticks.map((t) => t.title),
    };
    return (
      <li key={a.id}
          className={`crew${mgr ? ' mgr' : ''}${activeId === a.id ? ' on' : ''}${ATTN.has(a.state) ? ' attn' : ''}`
                     + (fresh[a.id] ? ' fresh' : '') + (ticks.length ? ' busy' : '')
                     + (ticks.length >= 3 ? ' full' : '')}
          data-agent={a.id} data-room={room.id} data-mandate={held}
          style={{ ['--c' as any]: live.find((m) => m.id === held)?.color || room.color }}
          data-drop="" data-accepts={mgr ? 'mandate task' : 'task agent'}
          data-queue={ticks.length}
          onClick={() => onAgent(a)} title={a.persona}>
        <span className="face" style={{ ['--c' as any]: a.color }} data-carry="agent"
              onPointerDown={(e) => peekPress(e, info, { kind: 'agent', id: a.id, label: a.name,
                                                         colour: a.color, roomId: room.id })}>
          {a.avatar}<i className={`st ${a.state}`} />
          {mgr && <Arc done={done} total={mine.length} notch={notch} />}
        </span>
        <span className="crew-text">
          <b>{a.name}</b>
          <Caption text={mgr ? 'runs this room' : friendlyActivity(a.activity, a.state)} />
        </span>
        {ticks.length >= 3 && <i className="qbadge">{ticks.length}</i>}
        <span className="ticks">
          {!mgr && ticks.map((t) => (
            <Chit key={t.id} kind="task" id={t.id} taskId={t.id} tick label={t.title}
                  colour={colourOf(t)} cost={costOf(t)} roomId={room.id} tools={requiredTools(t.title)}
                  className={walking[t.id] ? 'pending' : undefined}
                  onOpen={() => onOpenTask(t)}
                  onRecall={() => { const m = live.find((x) => x.id === t.mandate_id); if (m) onRecall(m); }} />
          ))}
        </span>
      </li>
    );
  };

  return (
    <div className="roomwin" ref={host} style={{ ['--room' as any]: room.color }}
         data-room={room.id} data-drop="" data-accepts="mandate task">
      <ul>
        {manager && row(manager)}
        <li className={`strip${strip.length ? ' open' : ''}`}>
          <div>
            {strip.slice(0, 5).map((t) => (
              <Chit key={t.id} kind="task" id={t.id} taskId={t.id} label={t.title}
                    colour={colourOf(t)} cost={costOf(t)} roomId={room.id} waiting tools={requiredTools(t.title)}
                    accepts="agent"
                    className={bloom[t.id] !== undefined ? 'bloom' : undefined}
                    onOpen={() => onOpenTask(t)}
                    onRecall={() => { const m = live.find((x) => x.id === t.mandate_id); if (m) onRecall(m); }} />
            ))}
            {strip.length > 5 && <span className="chit more"><b>+{strip.length - 5}</b></span>}
          </div>
        </li>
        {workers.map(row)}
      </ul>
      {undo && (
        <div className="undo-strip">
          <span>{undo.text}</span>
          <button onClick={undo.run}>Undo</button>
          <i className="undo-run" style={{ animationDuration: '8s' }} />
        </div>
      )}
    </div>
  );
}

export const RoomWindowBody = memo(Body, (p, n) =>
  p.room === n.room && p.activeId === n.activeId && p.undo === n.undo &&
  p.mandates === n.mandates && p.tasks === n.tasks &&
  p.agents.length === n.agents.length && p.agents.every((a, i) => a === n.agents[i]));


/**
 * The 72px a parked room keeps on screen: its own icon in its own colour, the manager
 * on top wearing the same arc, and the crew as live faces with their status dots.
 * Enough to know whether it needs you without unparking it — which is the whole reason
 * parking is not a minimise.
 */
export function ParkedRail({ room, agents, mandates, tasks }: {
  room: Room; agents: Agent[]; mandates: Mandate[]; tasks: Task[];
}) {
  const pct = Math.min(100, (room.spent_cents / Math.max(1, room.budget_cents)) * 100);
  // A room shows the work it is holding: what it finished is in its notes, not on its face.
  const live = mandates.filter((m) => m.room_id === room.id && !['recalled', 'done'].includes(m.state));
  const mine = tasks.filter((t) => live.some((m) => m.id === t.mandate_id));
  const order = [...agents].sort((a, b) => (a.tier === 'manager' ? -1 : 0) - (b.tier === 'manager' ? -1 : 0));
  const shown = order.slice(0, 5);
  const stuck = mine.findIndex((t) => {
    const who = agents.find((x) => x.id === t.agent_id);
    return !!who && ATTN.has(who.state);
  });
  const notch = stuck < 0 || !mine.length ? null : (stuck + 0.5) / mine.length;
  return (
    <div className="pk-rail" style={{ ['--room' as any]: room.color }}
         data-room={room.id} data-drop="" data-accepts="mandate task">
      <span className="pk-icon" title={room.name}>{room.icon}</span>
      <span className="pk-faces">
        {shown.map((a) => (
          <span key={a.id} className={`face${a.tier === 'manager' ? ' mgr' : ''}`}
                style={{ ['--c' as any]: a.color }} title={`${a.name} — ${a.state}`}
                data-carry="agent"
                onPointerDown={(e) => peekPress(e, {
                  name: a.name, role: a.role, avatar: a.avatar, colour: a.color,
                  activity: friendlyActivity(a.activity, a.state), state: a.state,
                  steps: mine.filter((t) => t.agent_id === a.id && t.state === 'done').slice(-2).map((t) => t.title),
                  spend: `${hours(a.spent_cents)} of ${hours(a.cost_budget_cents)}`,
                  chits: mine.filter((t) => t.agent_id === a.id && t.state === 'working').map((t) => t.title),
                }, { kind: 'agent', id: a.id, label: a.name, colour: a.color, roomId: room.id })}>
            {a.avatar}<i className={`st ${a.state}`} />
            {a.tier === 'manager' && <Arc done={mine.filter((t) => t.state === 'done').length} total={mine.length}
                                          notch={notch} />}
          </span>
        ))}
        {agents.length > shown.length && <em>+{agents.length - shown.length}</em>}
      </span>
      {mine.filter((t) => OPEN.has(t.state)).slice(0, 3).map((t) => {
        const who = agents.find((x) => x.id === t.agent_id);
        return (
          <i key={t.id} className={`pk-tick${who && ATTN.has(who.state) ? ' needs' : ''}`}
             data-mandate={t.mandate_id}
             style={{ ['--c' as any]: live.find((m) => m.id === t.mandate_id)?.color || room.color }} />
        );
      })}
      <span className="pk-bar"><i style={{ width: `${pct}%` }} /></span>
    </div>
  );
}
