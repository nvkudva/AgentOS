import { useEffect, useRef, useState } from 'react';
import { observe, post } from './api';
import type { Inbox } from './api';

/** Long enough to catch the wrong key, short enough that the agent is not left hanging. */
export const UNDO_MS = 8000;

/**
 * The one decision path: pending state, courier-animation hook, 8s undo, then
 * the POST. The queue and the inline room bars share it — one path, many
 * surfaces. A second decide on the same id is a no-op here and a 409 on the
 * server, so two surfaces can never double-execute.
 */
export function useDecide(view: string, onDecide?: (it: Inbox, decision: 'approve' | 'reject') => void) {
  const [pending, setPending] = useState<Record<string, 'approve' | 'reject'>>({});
  const timers = useRef<Record<string, any>>({});
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const decide = (it: Inbox, decision: 'approve' | 'reject', remember = false) => {
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

  return { pending, decide, undo };
}

export type DecideRequest = { id: string; decision: 'approve' | 'reject' };
const DECIDE_EVENT = 'atrium:decide';
const UNDO_EVENT = 'atrium:undo-decide';

/**
 * Voice has no card of its own, so it asks the mounted queue to decide: the card shows
 * its pending state and undo exactly as if the hand had done it. False when no queue
 * took the request.
 */
export function requestDecide(id: string, decision: DecideRequest['decision']): boolean {
  return !dispatchEvent(new CustomEvent<DecideRequest>(DECIDE_EVENT, { detail: { id, decision }, cancelable: true }));
}

export function requestUndo(id: string): void {
  dispatchEvent(new CustomEvent<{ id: string }>(UNDO_EVENT, { detail: { id } }));
}

/** The queue side: take requests for items it holds. */
export function useDecideRequests(items: Inbox[], decide: (it: Inbox, d: DecideRequest['decision']) => void,
                                  undo: (id: string) => void) {
  useEffect(() => {
    const onDecide = (e: Event) => {
      const { id, decision } = (e as CustomEvent<DecideRequest>).detail;
      const it = items.find((x) => x.id === id);
      if (!it) return;
      e.preventDefault();
      decide(it, decision);
    };
    const onUndo = (e: Event) => undo((e as CustomEvent<{ id: string }>).detail.id);
    addEventListener(DECIDE_EVENT, onDecide);
    addEventListener(UNDO_EVENT, onUndo);
    return () => { removeEventListener(DECIDE_EVENT, onDecide); removeEventListener(UNDO_EVENT, onUndo); };
  }, [items, decide, undo]);
}
