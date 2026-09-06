import { q, one } from './db.js';
import { append } from './events.js';
import { bus } from './bus.js';
import { startAgent, killAgent } from './runtime/scheduler.js';

export type Req = { method: string; path: string; body: any; query: URLSearchParams };

export async function snapshot() {
  const rooms = await q(`SELECT * FROM room ORDER BY y, x`);
  const agents = await q(`SELECT * FROM agent ORDER BY room_id, name`);
  const inbox = await inboxRows();
  const config = await one(`SELECT * FROM global_config WHERE id=1`);
  return { rooms, agents, inbox, config, now: new Date().toISOString() };
}

/** Oldest and most expensive first — cheap-and-new must never bury expensive-and-old. */
export async function inboxRows() {
  return q(
    `SELECT ap.*, r.key AS room_key, r.name AS room_name, a.name AS agent_name
       FROM approval ap JOIN room r ON r.id=ap.room_id JOIN agent a ON a.id=ap.agent_id
      WHERE ap.state='pending'
      ORDER BY ap.est_cost_cents DESC, ap.created_at ASC`);
}

export async function handle(req: Req): Promise<any> {
  const p = req.path;

  if (p === '/api/state') return snapshot();

  if (p === '/api/list') {
    return q(
      `SELECT e.*, r.key AS room_key, a.name AS agent_name FROM event e
         LEFT JOIN room r ON r.id=e.room_id LEFT JOIN agent a ON a.id=e.agent_id
        ORDER BY e.id DESC LIMIT $1`, [Number(req.query.get('limit') ?? 300)]);
  }

  let m: RegExpMatchArray | null;

  if ((m = p.match(/^\/api\/rooms\/([\w]+)$/))) {
    const room = await one(`SELECT * FROM room WHERE id=$1 OR key=$1`, [m[1]]);
    if (!room) return { error: 'not found', status: 404 };
    const [agents, events, artifacts, ledger, runs, queue] = await Promise.all([
      q(`SELECT * FROM agent WHERE room_id=$1 ORDER BY name`, [room.id]),
      q(`SELECT * FROM event WHERE room_id=$1 ORDER BY id DESC LIMIT 200`, [room.id]),
      q(`SELECT * FROM artifact WHERE room_id=$1 ORDER BY created_at DESC LIMIT 50`, [room.id]),
      q(`SELECT * FROM ledger WHERE room_id=$1 ORDER BY ts DESC LIMIT 100`, [room.id]),
      q(`SELECT * FROM run WHERE room_id=$1 ORDER BY started_at DESC LIMIT 20`, [room.id]),
      q(`SELECT * FROM content_queue WHERE room_id=$1 ORDER BY created_at DESC LIMIT 30`, [room.id]),
    ]);
    return { room, agents, events, artifacts, ledger, runs, queue };
  }

  if ((m = p.match(/^\/api\/agents\/([\w]+)$/)) && req.method === 'GET') {
    const agent = await one(`SELECT * FROM agent WHERE id=$1`, [m[1]]);
    if (!agent) return { error: 'not found', status: 404 };
    const [room, runs, events, artifacts] = await Promise.all([
      one(`SELECT * FROM room WHERE id=$1`, [agent.room_id]),
      q(`SELECT * FROM run WHERE agent_id=$1 ORDER BY started_at DESC LIMIT 10`, [agent.id]),
      q(`SELECT * FROM event WHERE agent_id=$1 ORDER BY id DESC LIMIT 250`, [agent.id]),
      q(`SELECT a.* FROM artifact a JOIN run r ON r.id=a.run_id WHERE r.agent_id=$1
         ORDER BY a.created_at DESC LIMIT 20`, [agent.id]),
    ]);
    return { agent, room, runs, events, artifacts };
  }

  if ((m = p.match(/^\/api\/runs\/([\w]+)$/))) {
    return {
      run: await one(`SELECT * FROM run WHERE id=$1`, [m[1]]),
      events: await q(`SELECT * FROM event WHERE run_id=$1 ORDER BY id`, [m[1]]),
    };
  }

  if ((m = p.match(/^\/api\/agents\/([\w]+)\/start$/)) && req.method === 'POST') {
    const runId = await startAgent(m[1], req.body?.goal);
    bus.publish({ type: 'refresh' });
    return { run_id: runId };
  }
  if ((m = p.match(/^\/api\/agents\/([\w]+)\/kill$/)) && req.method === 'POST') {
    await killAgent(m[1], req.body?.reason ?? 'operator');
    bus.publish({ type: 'refresh' });
    return { ok: true };
  }

  if ((m = p.match(/^\/api\/approvals\/([\w]+)\/decide$/)) && req.method === 'POST') {
    return decide(m[1], req.body);
  }

  if (p === '/api/panic' && req.method === 'POST') {
    await q(`UPDATE global_config SET panic_stop=$1 WHERE id=1`, [!!req.body?.on]);
    if (req.body?.on) await q(`UPDATE agent SET state='blocked', activity='panic stop' WHERE state='working'`);
    await append({ type: 'panic_stop', payload: { on: !!req.body?.on } });
    bus.publish({ type: 'refresh' });
    return { ok: true, panic_stop: !!req.body?.on };
  }

  if (p === '/api/rooms/resume' && req.method === 'POST') {
    await q(`UPDATE room SET status='open' WHERE id=$1 OR key=$1`, [req.body.room]);
    await q(`UPDATE agent SET state='idle', activity='' WHERE room_id IN (SELECT id FROM room WHERE id=$1 OR key=$1) AND state='blocked'`, [req.body.room]);
    bus.publish({ type: 'refresh' });
    return { ok: true };
  }

  if (p === '/api/budget' && req.method === 'POST') {
    if (req.body.room) await q(`UPDATE room SET budget_cents=$2 WHERE key=$1`, [req.body.room, req.body.cents]);
    else await q(`UPDATE global_config SET global_budget_cents=$1 WHERE id=1`, [req.body.cents]);
    bus.publish({ type: 'refresh' });
    return { ok: true };
  }

  /** Thesis instrumentation. Every view records what the operator actually did. */
  if (p === '/api/observe' && req.method === 'POST') {
    await q(`INSERT INTO observation_log (view, action, payload) VALUES ($1,$2,$3)`,
      [req.body.view, req.body.action, req.body.payload ?? {}]);
    return { ok: true };
  }

  return { error: 'not found', status: 404 };
}

async function decide(approvalId: string, body: any) {
  const ap = await one<any>(`SELECT * FROM approval WHERE id=$1`, [approvalId]);
  if (!ap || ap.state !== 'pending') return { error: 'not pending', status: 409 };
  const approved = body?.decision === 'approve';

  await q(`UPDATE approval SET state=$2, decided_at=now(), decided_note=$3 WHERE id=$1`,
    [approvalId, approved ? 'approved' : 'rejected', body?.note ?? null]);
  await append({ type: approved ? 'approval.granted' : 'approval.rejected',
    room_id: ap.room_id, agent_id: ap.agent_id, run_id: ap.run_id,
    // kind matters on replay: rejecting an escalation resumes the run, rejecting an
    // approval ends it. Without it the fold cannot tell the two apart.
    payload: { approval_id: approvalId, action: ap.action, kind: ap.kind, note: body?.note ?? null } });

  // "approve and remember for this room" raises autonomy for that blast radius —
  // never below 'high', which always needs a human in v1.
  if (approved && body?.remember && ap.blast_radius !== 'high') {
    await q(`UPDATE room SET approval_policy = approval_policy || jsonb_build_object($2::text,'auto') WHERE id=$1`,
      [ap.room_id, ap.blast_radius]);
  }

  const run = await one<any>(`SELECT * FROM run WHERE id=$1`, [ap.run_id]);
  const scratch = run?.scratch ?? {};
  if (approved) {
    scratch.__approval_granted = approvalId;
    await q(`UPDATE run SET status='running', scratch=$2 WHERE id=$1`, [ap.run_id, scratch]);
    await q(`UPDATE agent SET state='working', activity='resuming' WHERE id=$1`, [ap.agent_id]);
  } else if (ap.kind === 'escalation') {
    await q(`UPDATE agent SET state='working', activity='answered, continuing' WHERE id=$1`, [ap.agent_id]);
    await q(`UPDATE run SET status='running' WHERE id=$1`, [ap.run_id]);
  } else {
    await q(`UPDATE run SET status='done', ended_at=now(), kill_reason='rejected by operator' WHERE id=$1`, [ap.run_id]);
    await q(`UPDATE agent SET state='idle', activity='rejected by you', current_run_id=NULL WHERE id=$1`, [ap.agent_id]);
  }
  bus.publish({ type: 'refresh' });
  return { ok: true, approved };
}
