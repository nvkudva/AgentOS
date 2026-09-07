import { useEffect, useRef, useState } from 'react';
import { post, observe } from '../lib/api';
import { hours, blastWords, askTitle, touchWords, plainDetail } from '../lib/humanize';
import type { Inbox as Item } from '../lib/api';

const ago = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};

/** Long enough to catch the wrong key, short enough that the agent is not left hanging. */
const UNDO_MS = 8000;

/** Ordered most expensive, then oldest. Every card states action, cost and what it touches. */
export function InboxApp({ items, view, focusId, active, onOpenRoom }: {
  items: Item[]; view: string; focusId?: string;
  /** the queue only answers the keyboard while it is the thing on screen */
  active?: boolean;
  onOpenRoom?: (roomKey: string) => void;
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
             onClick={() => setSel(i)}
             className={`card ${it.blast_radius}${focusId === it.id ? ' focus' : ''}${active && i === sel ? ' sel' : ''}`}>
          <div>
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
