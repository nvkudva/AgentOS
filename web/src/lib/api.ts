import { useEffect, useRef, useState } from 'react';

export type Room = {
  id: string; key: string; name: string; objective: string; x: number; y: number; w: number; h: number;
  budget_cents: number; spent_cents: number; tool_grants: string[]; status: 'open' | 'halted' | 'capped';
  approval_policy: Record<string, string>; db_role: string | null;
  color: string; icon: string;
};
export type Agent = {
  id: string; room_id: string; name: string; role: string; policy_key: string;
  tier: 'manager' | 'worker';
  state: 'idle' | 'working' | 'blocked' | 'awaiting_approval' | 'failed' | 'killed';
  activity: string; spent_cents: number; cost_budget_cents: number; steps_used: number; step_budget: number;
  persona: string; color: string; avatar: string;
};
export type Inbox = {
  id: string; room_key: string; room_name: string; agent_name: string; kind: 'approval' | 'escalation';
  action: string; blast_radius: string; est_cost_cents: number; run_spent_cents: number;
  touches: string[]; created_at: string; args: any;
};
/** One sentence of human intent. Its colour is frozen server-side at route time. */
export type Mandate = {
  id: string; text: string; room_id: string | null;
  state: 'heard' | 'routed' | 'planned' | 'working' | 'blocked' | 'done' | 'recalled';
  color: string | null; quoted_cents: number; spent_cents: number;
  report: string; artifact_id: string | null; context: string[]; created_at: string;
};
export type Task = {
  id: string; mandate_id: string; agent_id: string | null; run_id: string | null;
  title: string; state: 'queued' | 'working' | 'done' | 'failed' | 'killed';
  ord: number; kill_reason: string | null;
};
export type Snapshot = {
  rooms: Room[]; agents: Agent[]; inbox: Inbox[]; config: any;
  mandates: Mandate[]; tasks: Task[];
};

/**
 * With no server behind the page there is nothing to write to, and a rejected fetch
 * would strand whatever was mid-gesture. Both calls fail quietly instead.
 */
export const post = (p: string, body: any = {}) =>
  fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => ({}));
export const get = (p: string) => fetch(p).then((r) => r.json()).catch(() => null);

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
    // No server behind this build — the hosted demo — so serve the frozen desk instead
    // of hanging on "connecting…". The windows are the point; they work either way.
    let offline = false;
    const fallback = setTimeout(async () => {
      if (ref.current) return;
      offline = true;
      const { DEMO } = await import('./demo');
      ref.current = DEMO; dirty.current = true;
    }, 2500);

    const flush = () => {
      if (dirty.current && ref.current) { dirty.current = false; setSnap({ ...ref.current }); }
      raf = requestAnimationFrame(flush);
    };
    let raf = requestAnimationFrame(flush);

    const es = new EventSource('/api/stream');
    const refetch = async () => {
      if (offline) return;
      const next = await get('/api/state');
      if (next) { ref.current = next; dirty.current = true; }
    };
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
    return () => {
      es.close(); clearInterval(poll); clearTimeout(fallback);
      cancelAnimationFrame(raf); force(0);
    };
  }, []);

  return snap;
}
