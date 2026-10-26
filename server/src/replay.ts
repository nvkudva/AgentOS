import { q } from './db.js';

export type Projected = {
  agents: Record<string, { state: string; activity: string; spent_cents: number; current_run_id: string | null }>;
  rooms: Record<string, { spent_cents: number; status: string }>;
  runs: Record<string, { status: string; spent_cents: number; kill_reason: string | null }>;
  global: { spent_cents: number; panic_stop: boolean };
};

export type RoomSlice = {
  agents: Projected['agents']; runs: Projected['runs'];
  room: { spent_cents: number; status: string } | null;
};

/**
 * R1: state is a fold over the append-only event log. This function IS the definition
 * of what the projections mean; `npm run replay` rewrites them from it, and
 * test/replay.test.ts asserts the fold equals the live tables after a randomised run.
 */
export async function fold(): Promise<Projected> {
  const p: Projected = { agents: {}, rooms: {}, runs: {}, global: { spent_cents: 0, panic_stop: false } };
  for (const e of await q<any>(`SELECT * FROM event ORDER BY id`)) applyEvent(p, e);
  return p;
}

/** One event folded in. Shared by the full fold and the per-room resume below. */
export function applyEvent(p: Projected, e: any) {
  const agent = (id: string) => (p.agents[id] ??= { state: 'idle', activity: '', spent_cents: 0, current_run_id: null });
  const room = (id: string) => (p.rooms[id] ??= { spent_cents: 0, status: 'open' });
  const run = (id: string) => (p.runs[id] ??= { status: 'running', spent_cents: 0, kill_reason: null });
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
      case 'escalation.expired':
        if (e.agent_id) { const a = agent(e.agent_id); a.state = 'working'; a.activity = 'unanswered — continuing'; }
        if (e.run_id) run(e.run_id).status = 'running';
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

/** A7: start a room's fold from its latest snapshot instead of genesis.
 *  Snapshots store exactly what the fold would have produced; the tail replays
 *  on top with the same kernel, so snapshot+tail == full fold by construction. */
export async function foldRoom(roomId: string): Promise<{ slice: RoomSlice; upto: number }> {
  const snap = (await q<any>(`SELECT upto_event_id, projection FROM snapshot
                              WHERE room_id=$1 ORDER BY id DESC LIMIT 1`, [roomId]))[0];
  const slice: RoomSlice = snap?.projection
    ? JSON.parse(JSON.stringify(snap.projection))
    : { agents: {}, runs: {}, room: null };
  const upto: number = snap?.upto_event_id ?? 0;
  const p: Projected = {
    agents: slice.agents, runs: slice.runs,
    rooms: {}, global: { spent_cents: 0, panic_stop: false },
  };
  // The snapshot is the base; the tail adds to it. Without this the checkpoint
  // is discarded and only post-snapshot events count.
  if (slice.room) p.rooms[roomId] = { ...slice.room };
  for (const e of await q<any>(`SELECT * FROM event WHERE id>$1 AND room_id=$2 ORDER BY id`, [upto, roomId])) {
    applyEvent(p, e);
  }
  const r = await q<any>(`SELECT spent_cents, status FROM room WHERE id=$1`, [roomId]);
  slice.room = p.rooms[roomId] ?? (r[0] ? { spent_cents: 0, status: r[0].status } : null);
  return { slice: { agents: p.agents, runs: p.runs, room: slice.room }, upto: upto };
}

/** Checkpoint a room: fold it fully once, store the slice with its watermark. */
export async function writeRoomSnapshot(roomId: string): Promise<number> {
  const full = await fold();
  const agents: Projected['agents'] = {};
  const runs: Projected['runs'] = {};
  for (const a of await q<any>(`SELECT id FROM agent WHERE room_id=$1`, [roomId])) {
    if (full.agents[a.id]) agents[a.id] = full.agents[a.id];
  }
  for (const r of await q<any>(`SELECT id FROM run WHERE room_id=$1`, [roomId])) {
    if (full.runs[r.id]) runs[r.id] = full.runs[r.id];
  }
  const maxId = await q<any>(`SELECT coalesce(max(id),0)::int AS m FROM event WHERE room_id=$1`, [roomId]);
  const room = full.rooms[roomId] ?? null;
  await q(`INSERT INTO snapshot (room_id, upto_event_id, projection) VALUES ($1,$2,$3)`,
    [roomId, maxId[0].m, JSON.stringify({ agents, runs, room })]);
  return maxId[0].m;
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
