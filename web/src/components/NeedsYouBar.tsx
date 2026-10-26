import { askTitle, blastWords, hours } from '../lib/humanize';
import { useDecide, UNDO_MS } from '../lib/decide';
import type { Inbox } from '../lib/api';

/**
 * Inline decisions where the evidence is: the card or room row that says
 * "waiting on you" offers the act, on the same decide path as the queue —
 * one path, many surfaces. First needs-item only; the rest stay one click
 * away in Details.
 */
export function NeedsYouBar({ items, view, onDecide, onDetails }: {
  items: Inbox[]; view: string;
  onDecide?: (it: Inbox, decision: 'approve' | 'reject') => void;
  onDetails: () => void;
}) {
  const { pending, decide, undo } = useDecide(view, onDecide);
  if (!items.length) return null;
  const it = items[0];
  const p = pending[it.id];

  return (
    <div className={`needs-bar ${it.blast_radius}`} onClick={(e) => e.stopPropagation()}>
      {p ? (<>
        <span><b>{p === 'approve' ? 'Approved' : 'Rejected'}</b> · {askTitle(it)}</span>
        <span className="spacer" />
        <button onClick={() => undo(it.id)}>Undo</button>
        <i className="undo-run" style={{ animationDuration: `${UNDO_MS}ms` }} />
      </>) : (<>
        <span className="needs-what">
          {askTitle(it)}{' '}
          <span className="muted">· {blastWords(it.blast_radius)} · costs {hours(it.est_cost_cents)}</span>
        </span>
        <span className="spacer" />
        <button className="primary" onClick={() => decide(it, 'approve')}>Approve</button>
        <button className="danger" onClick={() => decide(it, 'reject')}>Reject</button>
        <button onClick={onDetails}>Details</button>
      </>)}
      {items.length > 1 && <button className="more" onClick={onDetails}>+{items.length - 1} more</button>}
    </div>
  );
}
