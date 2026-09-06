import { useState } from 'react';
import { post, observe } from '../lib/api';
import { money, blastWords, askTitle, touchWords, plainDetail } from '../lib/humanize';
import type { Inbox as Item } from '../lib/api';

const ago = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};

/** Ordered most expensive, then oldest. Every card states action, cost and what it touches. */
export function InboxApp({ items, view, focusId }: { items: Item[]; view: string; focusId?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (it: Item, decision: 'approve' | 'reject', remember = false) => {
    setBusy(it.id);
    await observe(view, `inbox.${decision}`, { approval_id: it.id, waited_ms: Date.now() - new Date(it.created_at).getTime() });
    await post(`/api/approvals/${it.id}/decide`, { decision, remember });
    setBusy(null);
  };

  if (!items.length) return <div className="pad calm">Calm. Nothing needs a decision.</div>;
  return (
    <div className="pad cards">
      {items.map((it) => (
        <div key={it.id} className={`card ${it.blast_radius}${focusId === it.id ? ' focus' : ''}`}>
          <div>
            <div className="what">{askTitle(it)}</div>
            {it.kind !== 'escalation' && <div className="detail">{plainDetail(it.action)}</div>}
            <div className="meta">
              {it.kind !== 'escalation' &&
                <span className={`tag ${it.blast_radius}`}>{blastWords(it.blast_radius)}</span>}{' '}
              {it.room_name} · waiting {ago(it.created_at)} ·{' '}
              <span className="cost">costs {money(it.est_cost_cents)}</span>
              {it.run_spent_cents > 0 && <> · {money(it.run_spent_cents)} spent so far</>}
            </div>
            <div className="touches">
              Touches {(it.touches ?? []).map(touchWords).map(plainDetail).join(' · ') || 'nothing outside this room'}
            </div>
          </div>
          <div className="acts">
            <button disabled={busy === it.id} className="primary" onClick={() => decide(it, 'approve')}>
              {it.kind === 'escalation' ? 'Yes' : 'Approve'}
            </button>
            {it.blast_radius !== 'high' && (
              <button disabled={busy === it.id} onClick={() => decide(it, 'approve', true)}
                      title="approve and stop asking for this kind of thing in this room">Always</button>
            )}
            <button disabled={busy === it.id} className="danger" onClick={() => decide(it, 'reject')}>
              {it.kind === 'escalation' ? 'No' : 'Reject'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
