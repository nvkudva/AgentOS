import { useEffect, useRef, useState } from 'react';
import { post, observe } from '../lib/api';
import { hours, blastWords, askTitle, touchWords, plainDetail } from '../lib/humanize';
import { startCarry } from '../desktop/carry';
import type { Inbox as Item, Mandate } from '../lib/api';

/** How far the card travels before it means anything, and where it stops meaning more. */
const ARM = 40, COMMIT = 88, DAMP = 120;

const ago = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};

/** Long enough to catch the wrong key, short enough that the agent is not left hanging. */
const UNDO_MS = 8000;

/** Ordered most expensive, then oldest. Every card states action, cost and what it touches. */
export function InboxApp({ items, view, focusId, active, mandates = [], onOpenRoom, onDecide }: {
  items: Item[]; view: string; focusId?: string;
  /** the queue only answers the keyboard while it is the thing on screen */
  active?: boolean;
  /** so a card can name the sentence it descends from */
  mandates?: Mandate[];
  onOpenRoom?: (roomKey: string) => void;
  /** the decision, the moment it is made, so it can be flown back to the worker */
  onDecide?: (it: Item, decision: 'approve' | 'reject') => void;
}) {
  const [pending, setPending] = useState<Record<string, 'approve' | 'reject'>>({});
  const [sel, setSel] = useState(0);
  const timers = useRef<Record<string, any>>({});
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // The queue re-sorts on every decision. Holding an index rather than an id keeps the
  // cursor where the hand left it instead of chasing the card that just left.
  useEffect(() => { setSel((n) => Math.max(0, Math.min(n, items.length - 1))); }, [items.length]);

  const decide = (it: Item, decision: 'approve' | 'reject', remember = false) => {
    if (pending[it.id]) return;
    setPending((p) => ({ ...p, [it.id]: decision }));
    onDecide?.(it, decision);
    timers.current[it.id] = setTimeout(async () => {
      delete timers.current[it.id];
      await observe(view, `inbox.${decision}`,
        { approval_id: it.id, waited_ms: Date.now() - new Date(it.created_at).getTime() });
      await post(`/api/approvals/${it.id}/decide`, { decision, remember });
      if (alive.current) setPending((p) => { const n = { ...p }; delete n[it.id]; return n; });
    }, UNDO_MS);
  };

  const undo = (id: string) => {
    clearTimeout(timers.current[id]); delete timers.current[id];
    setPending((p) => { const n = { ...p }; delete n[id]; return n; });
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const it = items[sel];
      const step = (d: number) => { e.preventDefault(); setSel((n) => Math.max(0, Math.min(items.length - 1, n + d))); };
      if (e.key === 'j' || e.key === 'ArrowDown') return step(1);
      if (e.key === 'k' || e.key === 'ArrowUp') return step(-1);
      if (!it) return;
      if (e.key === 'a') { e.preventDefault(); decide(it, 'approve'); }
      else if (e.key === 'A') { e.preventDefault(); decide(it, 'approve', true); }
      else if (e.key === 'r') { e.preventDefault(); decide(it, 'reject'); }
      else if (e.key === 'Enter') { e.preventDefault(); onOpenRoom?.(it.room_key); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [active, items, sel, pending]);

  /**
   * One press on the card body, three possible intents, resolved by where it goes.
   *
   * Down or up is the queue scrolling and the card never moves. Sideways is a decision
   * being weighed: the card follows the hand exactly, the edge it uncovers fills with
   * the colour of the verb, and only past 88px does releasing mean it. Held still, the
   * card comes off the queue as a thing in your hand — which the orb will refuse,
   * because a supervisor may carry an approval and may never make one.
   */
  const grab = (e: React.PointerEvent, it: Item) => {
    if (e.button !== 0 || pending[it.id]) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const card = e.currentTarget as HTMLElement;
    const x0 = e.clientX, y0 = e.clientY, pid = e.pointerId;
    let own = false, armed: 'approve' | 'reject' | null = null;

    const hold = window.setTimeout(() => {
      if (own) return;
      stop();
      startCarry({ button: 0, currentTarget: card, clientX: x0, clientY: y0, pointerId: pid } as unknown as React.PointerEvent,
                 { kind: 'approval', id: it.id, label: askTitle(it), colour: 'var(--blocked)' });
    }, 500);

    const paint = (dx: number) => {
      const t = Math.abs(dx) > DAMP ? Math.sign(dx) * (DAMP + (Math.abs(dx) - DAMP) * 0.35) : dx;
      const mag = Math.abs(t);
      card.style.transform = `translate3d(${t.toFixed(1)}px,0,0)`;
      card.style.setProperty('--reveal', String(Math.max(0, Math.min(1, (mag - ARM) / (COMMIT - ARM)))));
      card.dataset.arm = mag >= ARM ? (t > 0 ? 'approve' : 'reject') : '';
      armed = mag >= COMMIT ? (t > 0 ? 'approve' : 'reject') : null;
    };

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!own) {
        if (Math.hypot(dx, dy) < 12) return;
        // Vertical intent wins the tie, so a queue that is longer than the panel still scrolls.
        if (Math.abs(dy) > Math.abs(dx)) { stop(); return; }
        own = true; clearTimeout(hold);
        card.classList.add('swiping');
        try { card.setPointerCapture(pid); } catch {}
      }
      paint(dx);
    };

    const back = () => {
      card.classList.remove('swiping');
      card.classList.add('springing');
      card.style.transform = '';
      card.style.setProperty('--reveal', '0');
      card.dataset.arm = '';
      setTimeout(() => card.classList.remove('springing'), 180);
    };

    const up = () => {
      const verb = armed;
      stop();
      if (!verb) return back();
      card.classList.remove('swiping');
      card.classList.add('leaving');
      // The card leaves and the undo strip lands in the hole it left, running the very
      // same decide() the a and r keys run — one path, two ways of reaching it.
      setTimeout(() => decide(it, verb), 200);
    };

    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { stop(); back(); } };

    function stop() {
      clearTimeout(hold);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      removeEventListener('keydown', key);
    }
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('keydown', key);
  };

  if (!items.length) return <div className="pad calm">Calm. Nothing needs a decision.</div>;
  return (
    <div className="pad cards">
      {active && <p className="keyhint">j k move · a approve · A always · r reject · ⏎ open room</p>}
      {items.map((it, i) => pending[it.id] ? (
        <div key={it.id} className="card undone">
          <span><b>{pending[it.id] === 'approve' ? 'Approved' : 'Rejected'}</b> · {askTitle(it)}</span>
          <span className="spacer" />
          <button onClick={() => undo(it.id)}>Undo</button>
          <i className="undo-run" style={{ animationDuration: `${UNDO_MS}ms` }} />
        </div>
      ) : (
        <div key={it.id} ref={(n) => { if (active && i === sel) n?.scrollIntoView({ block: 'nearest' }); }}
             onClick={() => setSel(i)} onPointerDown={(e) => grab(e, it)}
             data-mandate={it.mandate_id ?? undefined}
             className={`card ${it.blast_radius}${focusId === it.id ? ' focus' : ''}${active && i === sel ? ' sel' : ''}`}>
          <i className="swipe-verb yes" aria-hidden="true">Approve</i>
          <i className="swipe-verb no" aria-hidden="true">Reject</i>
          <div>
            {(() => {
              const m = mandates.find((x) => x.id === it.mandate_id);
              return m ? <div className="chain">You asked: “{m.text}” · {it.agent_name}, {it.room_name}</div> : null;
            })()}
            <div className="what">{askTitle(it)}</div>
            {it.kind !== 'escalation' && <div className="detail">{plainDetail(it.action)}</div>}
            <div className="meta">
              {it.kind !== 'escalation' &&
                <span className={`tag ${it.blast_radius}`}>{blastWords(it.blast_radius)}</span>}{' '}
              {it.room_name} · waiting {ago(it.created_at)} ·{' '}
              <span className="cost">costs {hours(it.est_cost_cents)}</span>
              {it.run_spent_cents > 0 && <> · {hours(it.run_spent_cents)} spent so far</>}
            </div>
            <div className="touches">
              Touches {(it.touches ?? []).map(touchWords).map(plainDetail).join(' · ') || 'nothing outside this room'}
            </div>
          </div>
          <div className="acts">
            <button className="primary" onClick={() => decide(it, 'approve')}>
              {it.kind === 'escalation' ? 'Yes' : 'Approve'}
            </button>
            {it.blast_radius !== 'high' && (
              <button onClick={() => decide(it, 'approve', true)}
                      title="approve and stop asking for this kind of thing in this room">Always</button>
            )}
            <button className="danger" onClick={() => decide(it, 'reject')}>
              {it.kind === 'escalation' ? 'No' : 'Reject'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
