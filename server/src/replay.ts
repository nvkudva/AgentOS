import { q } from './db.js';

export type Projected = {
  agents: Record<string, { state: string; activity: string; spent_cents: number; current_run_id: string | null }>;
  rooms: Record<string, { spent_cents: number; status: string }>;
  runs: Record<string, { status: string; spent_cents: number; kill_reason: string | null }>;
  global: { spent_cents: number; panic_stop: boolean };
};

/**
 * R1: state is a fold over the append-only event log. This function IS the definition
 * of what the projections mean; `npm run replay` rewrites them from it, and
 * test/replay.test.ts asserts the fold equals the live tables after a randomised run.
 */
export async function fold(): Promise<Projected> {
  const p: Projected = { agents: {}, rooms: {}, runs: {}, global: { spent_cents: 0, panic_stop: false } };
  const agent = (id: string) => (p.agents[id] ??= { state: 'idle', activity: '', spent_cents: 0, current_run_id: null });
  const room = (id: string) => (p.rooms[id] ??= { spent_cents: 0, status: 'open' });
  const run = (id: string) => (p.runs[id] ??= { status: 'running', spent_cents: 0, kill_reason: null });

  for (const e of await q<any>(`SELECT * FROM event ORDER BY id`)) {
    const pay = e.payload ?? {};
    switch (e.type) {
      case 'run.started':
        if (e.run_id) { run(e.run_id).status = 'running'; }
        if (e.agent_id) { const a = agent(e.agent_id); a.state = 'working'; a.current_run_id = e.run_id; a.spent_cents = 0; a.activity = 'starting'; }
        break;
      case 'agent.said': if (e.agent_id) agent(e.agent_id).activity = pay.activity ?? ''; break;
      case 'spend':
        p.global.spent_cents += pay.cents ?? 0;
        if (e.room_id) room(e.room_id).spent_cents += pay.cents ?? 0;
        if (e.agent_id) agent(e.agent_id).spent_cents += pay.cents ?? 0;
        if (e.run_id) run(e.run_id).spent_cents += pay.cents ?? 0;
        break;
      case 'approval.requested':
        if (e.agent_id) { const a = agent(e.agent_id); a.state = 'awaiting_approval'; a.activity = `waiting on you: ${pay.action}`; }
        if (e.run_id) run(e.run_id).status = 'awaiting_approval';
        break;
      case 'escalation.raised':
        if (e.agent_id) { const a = agent(e.agent_id); a.state = 'blocked'; a.activity = `waiting on you: ${pay.question}`; }
        break;
      case 'approval.granted':
        if (e.agent_id) { const a = agent(e.agent_id); a.state = 'working'; a.activity = 'resuming'; }
        if (e.run_id) run(e.run_id).status = 'running';
        break;
      case 'approval.rejected':
        if (pay.kind === 'escalation') {
          // The human answered "no" to a question; the agent carries on.
          if (e.agent_id) { const a = agent(e.agent_id); a.state = 'working'; a.activity = 'answered, continuing'; }
          if (e.run_id) run(e.run_id).status = 'running';
        } else {
          // The human refused the action; the run is over.
          if (e.agent_id) { const a = agent(e.agent_id); a.state = 'idle'; a.activity = 'rejected by you'; a.current_run_id = null; }
          if (e.run_id) { run(e.run_id).status = 'done'; run(e.run_id).kill_reason = 'rejected by operator'; }
        }
        break;
      case 'run.finished':
        if (e.agent_id) { const a = agent(e.agent_id); a.state = 'idle'; a.activity = 'done'; a.current_run_id = null; }
        if (e.run_id) run(e.run_id).status = 'done';
        break;
      case 'run.failed':
        if (e.agent_id) { const a = agent(e.agent_id); a.state = 'failed'; a.activity = String(pay.error ?? '').slice(0, 200); }
        if (e.run_id) { run(e.run_id).status = 'failed'; run(e.run_id).kill_reason = String(pay.error ?? '').slice(0, 300); }
        break;
      case 'run.stood_down':
        // A recalled or handed-over run ends, but the worker did nothing wrong:
        // it goes back to idle rather than to killed.
        if (e.agent_id) { const a = agent(e.agent_id); a.state = 'idle'; a.current_run_id = null;
                          a.activity = pay.reason === 'recalled' ? 'recalled by you' : 'handed over'; }
        if (e.run_id) { run(e.run_id).status = 'killed'; run(e.run_id).kill_reason = pay.reason; }
        break;
      case 'agent.killed':
        if (e.agent_id) { const a = agent(e.agent_id); a.state = 'killed'; a.activity = `killed: ${pay.reason}`; }
        if (e.run_id) { run(e.run_id).status = 'killed'; run(e.run_id).kill_reason = pay.reason; }
        break;
      case 'room.capped': if (e.room_id) room(e.room_id).status = 'capped'; break;
      case 'admin.reset':
        for (const a of Object.values(p.agents)) { a.state = 'idle'; a.activity = ''; a.spent_cents = 0; a.current_run_id = null; }
        for (const r of Object.values(p.rooms)) r.status = 'open';
        break;
      case 'panic_stop': p.global.panic_stop = !!pay.on; break;
    }
  }
  return p;
}

/** Where the fold disagrees with the live tables. Empty array = replay is faithful. */
export async function diff(): Promise<string[]> {
  const p = await fold();
  const out: string[] = [];
  for (const a of await q<any>(`SELECT id, state, spent_cents FROM agent`)) {
    const f = p.agents[a.id];
    if (!f) continue;
    if (f.state !== a.state) out.push(`agent ${a.id}: log says ${f.state}, table says ${a.state}`);
    if (f.spent_cents !== a.spent_cents) out.push(`agent ${a.id}: log says ${f.spent_cents}¢, table says ${a.spent_cents}¢`);
  }
  for (const r of await q<any>(`SELECT id, spent_cents, status FROM room`)) {
    const f = p.rooms[r.id];
    if (!f) continue;
    if (f.spent_cents !== r.spent_cents) out.push(`room ${r.id}: log says ${f.spent_cents}¢, table says ${r.spent_cents}¢`);
    if (f.status !== r.status) out.push(`room ${r.id}: log says ${f.status}, table says ${r.status}`);
  }
  return out;
}
