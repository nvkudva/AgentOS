import { useEffect, useRef, useState } from 'react';

export type Room = {
  id: string; key: string; name: string; objective: string; x: number; y: number; w: number; h: number;
  budget_cents: number; spent_cents: number; tool_grants: string[]; status: 'open' | 'halted' | 'capped';
  approval_policy: Record<string, string>; db_role: string | null;
};
export type Agent = {
  id: string; room_id: string; name: string; role: string; policy_key: string;
  state: 'idle' | 'working' | 'blocked' | 'awaiting_approval' | 'failed' | 'killed';
  activity: string; spent_cents: number; cost_budget_cents: number; steps_used: number; step_budget: number;
};
export type Inbox = {
  id: string; room_key: string; room_name: string; agent_name: string; kind: 'approval' | 'escalation';
  action: string; blast_radius: string; est_cost_cents: number; run_spent_cents: number;
  touches: string[]; created_at: string; args: any;
};
export type Snapshot = { rooms: Room[]; agents: Agent[]; inbox: Inbox[]; config: any };

export const post = (p: string, body: any = {}) =>
  fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
export const get = (p: string) => fetch(p).then((r) => r.json());

/** Records what the operator does, in whichever view. This is how the thesis gets tested. */
export const observe = (view: string, action: string, payload: any = {}) =>
  post('/api/observe', { view, action, payload });

/**
 * One SSE connection for the whole app. Activity strings arrive as deltas and are
 * applied without refetching, so a room full of chatty agents costs no round trips.
 * Renders are coalesced to one per animation frame — that is what keeps 30 live
 * widgets at 60fps on plain DOM.
 */
export function useLiveState() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const ref = useRef<Snapshot | null>(null);
  const dirty = useRef(false);
  const [, force] = useState(0);

  useEffect(() => {
    const flush = () => {
      if (dirty.current && ref.current) { dirty.current = false; setSnap({ ...ref.current }); }
      raf = requestAnimationFrame(flush);
    };
    let raf = requestAnimationFrame(flush);

    const es = new EventSource('/api/stream');
    const refetch = async () => { ref.current = await get('/api/state'); dirty.current = true; };
    es.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'snapshot') { ref.current = m; dirty.current = true; return; }
      if (m.type === 'refresh') { refetch(); return; }
      if (m.type === 'agent.activity' && ref.current) {
        const a = ref.current.agents.find((x) => x.id === m.agent_id);
        if (a) { a.activity = m.activity; dirty.current = true; }
        return;
      }
      if (m.type === 'event') {
        const t = m.event.type;
        if (t !== 'tool.result' && t !== 'spend') refetch();
        else { dirty.current = true; }
      }
    };
    const poll = setInterval(refetch, 3000);   // cheap safety net; SSE does the real work
    return () => { es.close(); clearInterval(poll); cancelAnimationFrame(raf); force(0); };
  }, []);

  return snap;
}
