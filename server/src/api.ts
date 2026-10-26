import { q, one, tx } from './db.js';
import { id } from './ids.js';
import { append } from './events.js';
import { bus } from './bus.js';
import { startAgent, killAgent } from './runtime/scheduler.js';
import { provisionRoom, catalog, validate, type RoomSpec } from './provision.js';
import { resolveAuth, type Auth } from './auth.js';

export type Req = {
  method: string; path: string; body: any; query: URLSearchParams;
  token?: string | null; auth?: Auth;
};

export async function snapshot() {
  const rooms = await q(`SELECT * FROM room ORDER BY y, x`);
  // Managers first, so the crew list is already in tier order everywhere it is read.
  const agents = await q(`SELECT * FROM agent ORDER BY room_id, (tier<>'manager'), name`);
  const inbox = await inboxRows();
  const config = await one(`SELECT * FROM global_config WHERE id=1`);
  const mandates = await q(`SELECT * FROM mandate ORDER BY created_at DESC LIMIT 40`);
  const tasks = mandates.length
    ? await q(`SELECT * FROM task WHERE mandate_id = ANY($1) ORDER BY mandate_id, ord`,
              [mandates.map((m: any) => m.id)])
    : [];
  return { rooms, agents, inbox, config, mandates, tasks, now: new Date().toISOString() };
}

/** Oldest and most expensive first — cheap-and-new must never bury expensive-and-old. */
export async function inboxRows() {
  return q(
    `SELECT ap.*, r.key AS room_key, r.name AS room_name, a.name AS agent_name, rn.mandate_id
       FROM approval ap JOIN room r ON r.id=ap.room_id JOIN agent a ON a.id=ap.agent_id
       LEFT JOIN run rn ON rn.id=ap.run_id
      WHERE ap.state='pending'
      ORDER BY ap.est_cost_cents DESC, ap.created_at ASC`);
}

export async function handle(req: Req): Promise<any> {
  const p = req.path;
  const auth: Auth = await resolveAuth(req.token).catch(() => ({ scope: 'none' }));
  if (auth.scope === 'none') return { error: 'unauthorized — operator or room token required', status: 401 };
  // Room tokens see their room's detail, runs and queue — never another room,
  // never the global snapshot, never other rooms' approvals.
  const roomOk = (roomId: string | null | undefined) =>
    auth.scope === 'operator' || (auth.scope === 'room' && roomId != null && auth.roomId === roomId);
  if (auth.scope === 'room' && !(
    p === '/api/catalog' || p === '/api/observe' || p === '/api/mandates' ||
    /^\/api\/(rooms|agents|runs)\/([\w-]+)$/.test(p) ||
    /^\/api\/mandates\/([\w-]+)\/(route|recall)$/.test(p) ||
    /^\/api\/agents\/([\w-]+)\/(start|kill)$/.test(p) ||
    /^\/api\/approvals\/([\w-]+)\/decide$/.test(p)
  )) return { error: 'forbidden for a room-scoped token', status: 403 };
  req.auth = auth;

  if (p === '/api/state') {
    if (auth.scope !== 'operator') return { error: 'forbidden for a room-scoped token', status: 403 };
    return snapshot();
  }

  /** Everything the room creator can offer, in words rather than schema. */
  if (p === '/api/catalog') return catalog();

  /**
   * Milestone 8: a new function of the company is a form, not a deploy. This creates
   * the room, its Postgres role, that role's grants and its agents — and nothing in
   * the shell knows the difference between it and the rooms that shipped.
   */
  if (p === '/api/rooms' && req.method === 'POST') {
    if (auth.scope !== 'operator') return { error: 'forbidden for a room-scoped token', status: 403 };
    const spec = req.body as RoomSpec;
    const problems = validate(spec);
    if (problems.length) return { error: problems.join('; '), problems, status: 400 };
    try {
      const room = await provisionRoom(spec);
      bus.publish({ type: 'refresh' });
      return { room };
    } catch (e: any) {
      return { error: String(e?.message ?? e), status: e?.status ?? 500 };
    }
  }

  if (p === '/api/list') {
    if (auth.scope !== 'operator') return { error: 'forbidden for a room-scoped token', status: 403 };
    return q(
      `SELECT e.*, r.key AS room_key, a.name AS agent_name FROM event e
         LEFT JOIN room r ON r.id=e.room_id LEFT JOIN agent a ON a.id=e.agent_id
        ORDER BY e.id DESC LIMIT $1`, [Number(req.query.get('limit') ?? 300)]);
  }

  let m: RegExpMatchArray | null;

  if ((m = p.match(/^\/api\/rooms\/([\w-]+)$/))) {
    const room = await one(`SELECT * FROM room WHERE id=$1 OR key=$1`, [m[1]]);
    if (!room) return { error: 'not found', status: 404 };
    if (!roomOk(room.id)) return { error: 'forbidden for a room-scoped token', status: 403 };
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

  if ((m = p.match(/^\/api\/agents\/([\w-]+)$/)) && req.method === 'GET') {
    const agent = await one(`SELECT * FROM agent WHERE id=$1`, [m[1]]);
    if (!agent) return { error: 'not found', status: 404 };
    if (!roomOk(agent.room_id)) return { error: 'forbidden for a room-scoped token', status: 403 };
    const [room, runs, events, artifacts] = await Promise.all([
      one(`SELECT * FROM room WHERE id=$1`, [agent.room_id]),
      q(`SELECT * FROM run WHERE agent_id=$1 ORDER BY started_at DESC LIMIT 10`, [agent.id]),
      q(`SELECT * FROM event WHERE agent_id=$1 ORDER BY id DESC LIMIT 250`, [agent.id]),
      q(`SELECT a.* FROM artifact a JOIN run r ON r.id=a.run_id WHERE r.agent_id=$1
         ORDER BY a.created_at DESC LIMIT 20`, [agent.id]),
    ]);
    return { agent, room, runs, events, artifacts };
  }

  if ((m = p.match(/^\/api\/runs\/([\w-]+)$/))) {
    const run = await one<any>(`SELECT * FROM run WHERE id=$1`, [m[1]]);
    if (!run) return { error: 'not found', status: 404 };
    if (!roomOk(run.room_id)) return { error: 'forbidden for a room-scoped token', status: 403 };
    return { run, events: await q(`SELECT * FROM event WHERE run_id=$1 ORDER BY id`, [m[1]]) };
  }

  if (p === '/api/mandates' && req.method === 'POST') return heard(req.body, auth);
  if ((m = p.match(/^\/api\/mandates\/([\w-]+)\/route$/)) && req.method === 'POST') {
    return route(m[1], req.body?.room_key, auth);
  }
  if ((m = p.match(/^\/api\/mandates\/([\w-]+)\/recall$/)) && req.method === 'POST') {
    return recall(m[1], auth);
  }

  if ((m = p.match(/^\/api\/agents\/([\w-]+)\/start$/)) && req.method === 'POST') {
    const agent = await one<any>(`SELECT * FROM agent WHERE id=$1`, [m[1]]);
    if (!agent) return { error: 'not found', status: 404 };
    if (!roomOk(agent.room_id)) return { error: 'forbidden for a room-scoped token', status: 403 };
    const runId = await startAgent(m[1], req.body?.goal);
    bus.publish({ type: 'refresh' });
    return { run_id: runId };
  }
  if ((m = p.match(/^\/api\/agents\/([\w-]+)\/kill$/)) && req.method === 'POST') {
    const agent = await one<any>(`SELECT * FROM agent WHERE id=$1`, [m[1]]);
    if (!agent) return { error: 'not found', status: 404 };
    if (!roomOk(agent.room_id)) return { error: 'forbidden for a room-scoped token', status: 403 };
    await killAgent(m[1], req.body?.reason ?? 'operator');
    bus.publish({ type: 'refresh' });
    return { ok: true };
  }

  if ((m = p.match(/^\/api\/approvals\/([\w-]+)\/decide$/)) && req.method === 'POST') {
    const ap = await one<any>(`SELECT * FROM approval WHERE id=$1`, [m[1]]);
    if (!ap) return { error: 'not found', status: 404 };
    if (!roomOk(ap.room_id)) return { error: 'forbidden for a room-scoped token', status: 403 };
    return decide(m[1], req.body);
  }

  if (p === '/api/panic' && req.method === 'POST') {
    if (auth.scope !== 'operator') return { error: 'forbidden for a room-scoped token', status: 403 };
    await q(`UPDATE global_config SET panic_stop=$1 WHERE id=1`, [!!req.body?.on]);
    if (req.body?.on) await q(`UPDATE agent SET state='blocked', activity='panic stop' WHERE state='working'`);
    await append({ type: 'panic_stop', payload: { on: !!req.body?.on } });
    bus.publish({ type: 'refresh' });
    return { ok: true, panic_stop: !!req.body?.on };
  }

  if (p === '/api/rooms/resume' && req.method === 'POST') {
    if (auth.scope !== 'operator') return { error: 'forbidden for a room-scoped token', status: 403 };
    await q(`UPDATE room SET status='open' WHERE id=$1 OR key=$1`, [req.body.room]);
    await q(`UPDATE agent SET state='idle', activity='' WHERE room_id IN (SELECT id FROM room WHERE id=$1 OR key=$1) AND state='blocked'`, [req.body.room]);
    bus.publish({ type: 'refresh' });
    return { ok: true };
  }

  if (p === '/api/budget' && req.method === 'POST') {
    if (auth.scope !== 'operator') return { error: 'forbidden for a room-scoped token', status: 403 };
    const cents = req.body?.cents;
    if (!Number.isInteger(cents) || cents <= 0 || cents > 1_000_000_000) {
      return { error: 'cents must be a positive integer number of cents', status: 400 };
    }
    if (req.body.room) {
      const r = await q(`UPDATE room SET budget_cents=$2 WHERE key=$1 RETURNING id`, [req.body.room, cents]);
      if (!r.length) return { error: 'no such room', status: 404 };
    } else await q(`UPDATE global_config SET global_budget_cents=$1 WHERE id=1`, [cents]);
    bus.publish({ type: 'refresh' });
    return { ok: true };
  }

  /** Thesis instrumentation. Every view records what the operator actually did. */
  if (p === '/api/observe' && req.method === 'POST') {
    const view = String(req.body?.view ?? ''), action = String(req.body?.action ?? '');
    const payload = JSON.stringify(req.body?.payload ?? {});
    if (!view || !action || view.length > 64 || action.length > 64 || payload.length > 4096) {
      return { error: 'view/action required (≤64 chars), payload ≤4KB', status: 400 };
    }
    await q(`INSERT INTO observation_log (view, action, payload) VALUES ($1,$2,$3)`,
      [view, action, req.body.payload ?? {}]);
    return { ok: true };
  }

  return { error: 'not found', status: 404 };
}

/**
 * A MANDATE — one sentence of human intent, as a row. It is heard before it is
 * routed, so the operator can hold it on the desk and aim it, and it keeps its own
 * words through recall and redirect: those change where it is, never what was asked.
 */
async function heard(body: any, auth?: Auth) {
  const text = String(body?.text ?? '').trim();
  if (!text) return { error: 'a mandate needs words', status: 400 };
  const room = body?.room_key
    ? await one<any>(`SELECT * FROM room WHERE key=$1 OR id=$1`, [body.room_key])
    : null;
  // A room token may only drop mandates on its own desk; unrouted words are the operator's.
  if (auth?.scope === 'room' && (!room || room.id !== auth.roomId)) {
    return { error: 'forbidden for a room-scoped token', status: 403 };
  }
  const mid = id('mnd');
  await q(`INSERT INTO mandate (id, text, room_id, state) VALUES ($1,$2,$3,'heard')`,
    [mid, text, room?.id ?? null]);
  await append({ type: 'mandate.heard', room_id: room?.id ?? null, payload: { mandate_id: mid, text } });
  bus.publish({ type: 'refresh' });
  return { mandate: await one(`SELECT * FROM mandate WHERE id=$1`, [mid]) };
}

/**
 * Routing hands the mandate to a room's manager. The colour is frozen here, from
 * the room it went to — recolouring a room later must not recolour work already
 * done under it, and the client must never compute a mandate colour itself.
 * Routing an already-working mandate is a REDIRECT: its work stands down with
 * kill_reason 'handed_over' and its artifacts travel to the new manager as context.
 */
async function route(mandateId: string, roomKey: string, auth?: Auth) {
  const md = await one<any>(`SELECT * FROM mandate WHERE id=$1`, [mandateId]);
  if (!md) return { error: 'no such mandate', status: 404 };
  const room = await one<any>(`SELECT * FROM room WHERE key=$1 OR id=$1`, [roomKey]);
  if (!room) return { error: 'no such room', status: 404 };
  if (auth?.scope === 'room' && (room.id !== auth.roomId || (md.room_id && md.room_id !== auth.roomId))) {
    return { error: 'forbidden for a room-scoped token', status: 403 };
  }

  // Handing work to the room that already holds it is not a hand-over. Standing its
  // crew down and re-planning would kill the very manager driving the tasks and leave
  // the mandate headless, so the room simply keeps it.
  if (md.room_id === room.id && !['recalled', 'done'].includes(md.state))
    return { mandate: md, unchanged: true };

  const carried = md.room_id ? await standDown(mandateId, 'handed_over') : [];

  const manager = await one<any>(
    `SELECT * FROM agent WHERE room_id=$1 AND tier='manager' LIMIT 1`, [room.id]);
  if (!manager) return { error: `${room.name} has no manager`, status: 409 };
  if (manager.state === 'working' || manager.state === 'awaiting_approval') {
    return { error: `${manager.name} is still on the last one`, status: 409 };
  }

  // What this is likely to cost, quoted before anything runs: what the room's crew
  // is allowed to spend, capped by what the room has left.
  const crew = await q<any>(
    `SELECT cost_budget_cents FROM agent WHERE room_id=$1 AND tier='worker'`, [room.id]);
  const quoted = Math.min(
    crew.reduce((a, c) => a + c.cost_budget_cents, 0),
    Math.max(0, room.budget_cents - room.spent_cents));

  await q(`UPDATE mandate SET room_id=$2, state='routed', color=$3, quoted_cents=$4,
                              context=$5, report='', artifact_id=NULL WHERE id=$1`,
    [mandateId, room.id, room.color, quoted, JSON.stringify([...(md.context ?? []), ...carried])]);
  const runId = await startAgent(manager.id, md.text, { mandate_id: mandateId });
  await append({ type: 'mandate.routed', room_id: room.id, agent_id: manager.id, run_id: runId,
    payload: { mandate_id: mandateId, text: md.text, carried } });
  bus.publish({ type: 'refresh' });
  return { mandate: await one(`SELECT * FROM mandate WHERE id=$1`, [mandateId]), run_id: runId };
}

/** Recall returns the mandate to the operator's hand: un-routed, still their words. */
async function recall(mandateId: string, auth?: Auth) {
  const md = await one<any>(`SELECT * FROM mandate WHERE id=$1`, [mandateId]);
  if (!md) return { error: 'no such mandate', status: 404 };
  if (auth?.scope === 'room' && md.room_id !== auth.roomId) {
    return { error: 'forbidden for a room-scoped token', status: 403 };
  }
  await standDown(mandateId, 'recalled');
  await q(`UPDATE mandate SET state='recalled', room_id=NULL, color=NULL WHERE id=$1`, [mandateId]);
  await append({ type: 'mandate.recalled', room_id: md.room_id, payload: { mandate_id: mandateId } });
  bus.publish({ type: 'refresh' });
  return { mandate: await one(`SELECT * FROM mandate WHERE id=$1`, [mandateId]) };
}

/**
 * Stops everything running under a mandate and returns the artifact ids it produced.
 * The crew stands down rather than dying: a recalled worker did nothing wrong, and a
 * killed agent never works again.
 */
async function standDown(mandateId: string, reason: string): Promise<string[]> {
  const runs = await q<any>(
    `SELECT * FROM run WHERE mandate_id=$1 AND status IN ('running','awaiting_approval')`, [mandateId]);
  for (const r of runs) {
    await q(`UPDATE run SET status='killed', kill_reason=$2, ended_at=now() WHERE id=$1`, [r.id, reason]);
    await q(`UPDATE approval SET state='expired', decided_at=now() WHERE run_id=$1 AND state='pending'`, [r.id]);
    await q(`UPDATE agent SET state='idle', activity=$2, current_run_id=NULL WHERE id=$1`,
      [r.agent_id, reason === 'recalled' ? 'recalled by you' : 'handed over']);
    await append({ type: 'run.stood_down', room_id: r.room_id, agent_id: r.agent_id, run_id: r.id,
      payload: { mandate_id: mandateId, reason } });
  }
  await q(`UPDATE task SET state='killed', kill_reason=$2
            WHERE mandate_id=$1 AND state IN ('queued','working')`, [mandateId, reason]);
  const arts = await q<any>(
    `SELECT a.id FROM artifact a JOIN run r ON r.id=a.run_id WHERE r.mandate_id=$1`, [mandateId]);
  return arts.map((a) => a.id);
}

async function decide(approvalId: string, body: any) {
  const approved = body?.decision === 'approve';

  // "approve and remember for this room" raises autonomy for that blast radius —
  // never below 'high', which always needs a human in v1. Everything runs inside
  // ONE transaction (row locks on approval + run): a crash can never leave
  // an approved row with an un-resumed run, and two racing decides cannot both win.
  const note = body?.note ?? null;
  const out = await tx(async (c) => {
    const r = await c.query(`SELECT * FROM approval WHERE id=$1 FOR UPDATE`, [approvalId]);
    const row = r.rows[0];
    if (!row || row.state !== 'pending') return { error: 'not pending', status: 409 };
    await c.query(`UPDATE approval SET state=$2, decided_at=now(), decided_note=$3 WHERE id=$1`,
      [approvalId, approved ? 'approved' : 'rejected', note]);
    const rq = await c.query(`SELECT * FROM run WHERE id=$1 FOR UPDATE`, [row.run_id]);
    const scratch = rq.rows[0]?.scratch ?? {};
    if (approved && body?.remember && row.blast_radius !== 'high') {
      await c.query(`UPDATE room SET approval_policy = approval_policy || jsonb_build_object($2::text,'auto') WHERE id=$1`,
        [row.room_id, row.blast_radius]);
    }
    if (approved) {
      scratch.__approval_granted = approvalId;
      await c.query(`UPDATE run SET status='running', scratch=$2 WHERE id=$1`, [row.run_id, scratch]);
      await c.query(`UPDATE agent SET state='working', activity='resuming' WHERE id=$1`, [row.agent_id]);
    } else if (row.kind === 'escalation' || row.kind === 'clarify') {
      await c.query(`UPDATE agent SET state='working', activity='answered, continuing' WHERE id=$1`, [row.agent_id]);
      await c.query(`UPDATE run SET status='running' WHERE id=$1`, [row.run_id]);
    } else {
      await c.query(`UPDATE run SET status='done', ended_at=now(), kill_reason='rejected by operator' WHERE id=$1`, [row.run_id]);
      await c.query(`UPDATE agent SET state='idle', activity='rejected by you', current_run_id=NULL WHERE id=$1`, [row.agent_id]);
    }
    return { row };
  });
  if ('error' in out) return out;
  await append({ type: approved ? 'approval.granted' : 'approval.rejected',
    room_id: out.row.room_id, agent_id: out.row.agent_id, run_id: out.row.run_id,
    // kind matters on replay: rejecting an escalation resumes the run, rejecting an
    // approval ends it. Without it the fold cannot tell the two apart.
    payload: { approval_id: approvalId, action: out.row.action, kind: out.row.kind, note } });
  bus.publish({ type: 'refresh' });
  return { ok: true, approved };
}
