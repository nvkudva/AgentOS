import { useState } from 'react';
import type { Inbox as Item } from '../lib/api';
import { post, observe } from '../lib/api';

const ago = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};

/**
 * The only thing that requires the human. Ordered most expensive, then oldest —
 * so a stream of cheap new cards can never bury an expensive old one.
 * Every card states the action, the cost, and what it touches. No exceptions.
 */
export function InboxStrip({ items, view }: { items: Item[]; view: string }) {
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (it: Item, decision: 'approve' | 'reject', remember = false) => {
    setBusy(it.id);
    await observe(view, `inbox.${decision}`, { approval_id: it.id, waited_ms: Date.now() - new Date(it.created_at).getTime() });
    await post(`/api/approvals/${it.id}/decide`, { decision, remember });
    setBusy(null);
  };

  return (
    <div className="inbox">
      <div className="inbox-head">
        <strong style={{ color: 'var(--text)' }}>Inbox</strong>
        <span>{items.length ? `${items.length} waiting on you` : 'nothing waiting on you'}</span>
        <span className="spacer" />
        <span className="kbd">most expensive, then oldest</span>
      </div>
      {!items.length ? (
        <div className="calm">Calm. Nothing needs a decision.</div>
      ) : (
        <div className="inbox-body">
          {items.map((it) => (
            <div key={it.id} className={`card ${it.blast_radius}`}>
              <div>
                <div className="what">
                  {it.kind === 'escalation' ? '❓ ' : ''}{it.action}
                </div>
                <div className="meta">
                  <span className={`tag ${it.blast_radius}`}>{it.blast_radius}</span>{' '}
                  {it.room_name} · {it.agent_name} · waiting {ago(it.created_at)} ·{' '}
                  <span className="cost">{it.est_cost_cents}¢ to run</span>, {it.run_spent_cents}¢ spent so far
                </div>
                <div className="touches">touches: {(it.touches ?? []).join(' · ') || '—'}</div>
              </div>
              <div className="acts">
                <button disabled={busy === it.id} className="primary" onClick={(e) => { e.stopPropagation(); decide(it, 'approve'); }}>
                  {it.kind === 'escalation' ? 'Yes' : 'Approve'}
                </button>
                {it.blast_radius !== 'high' && (
                  <button disabled={busy === it.id} onClick={(e) => { e.stopPropagation(); decide(it, 'approve', true); }}
                          title="approve and stop asking for this blast radius in this room">
                    Always
                  </button>
                )}
                <button disabled={busy === it.id} className="danger" onClick={(e) => { e.stopPropagation(); decide(it, 'reject'); }}>
                  {it.kind === 'escalation' ? 'No' : 'Reject'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
