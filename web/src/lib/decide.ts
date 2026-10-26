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
