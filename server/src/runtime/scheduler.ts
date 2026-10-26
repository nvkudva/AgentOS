import { q, one } from '../db.js';
import { append } from '../events.js';
import { bus } from '../bus.js';
import { id } from '../ids.js';
import { NeedsApproval, BudgetExceeded, ScopeViolation } from '../errors.js';
import { haltRoom } from './budget.js';
import { POLICIES } from '../policies/index.js';
import type { Ctx, Room, Agent, Run } from './types.js';

const TICK_MS = Number(process.env.ATRIUM_TICK_MS ?? 400);
const LEASE_MS = Number(process.env.ATRIUM_LEASE_MS ?? 30_000);
let timer: NodeJS.Timeout | null = null;
// One id per scheduler process: a second process (or a second tick that overlaps
// the first) cannot step an agent it did not claim.
const INSTANCE = id('sch');

/**
 * Claim every steppable agent whose lease is free or expired, skipping rows a
 * concurrent scheduler already locked. Two schedulers racing here get disjoint
 * sets — that is the whole double-step fix.
 */
export async function claimLeases(owner: string = INSTANCE, leaseMs: number = LEASE_MS): Promise<Agent[]> {
  return q<Agent>(
    `UPDATE agent SET lease_owner=$1, lease_expires=now()+($2||' milliseconds')::interval
      WHERE id IN (
        SELECT a.id FROM agent a JOIN room r ON r.id=a.room_id
         WHERE a.state='working' AND a.current_run_id IS NOT NULL AND r.status='open'
           AND (a.lease_expires IS NULL OR a.lease_expires < now())
         ORDER BY a.id FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [owner, String(leaseMs)]);
}

export async function releaseLeases(owner: string = INSTANCE): Promise<void> {
  await q(`UPDATE agent SET lease_owner=NULL, lease_expires=NULL WHERE lease_owner=$1`, [owner]);
}

/**
 * A5: questions expire, gate approvals don't. An expired escalation/clarify
 * releases its agent back to work and logs the expiry — a question can delay
 * work, never deadlock it, and replay sees the release.
 */
export async function sweepExpired(): Promise<number> {
  const dead = await q<any>(
    `UPDATE approval SET state='expired', decided_at=now()
      WHERE state='pending' AND kind IN ('escalation','clarify')
        AND expires_at IS NOT NULL AND expires_at < now()
      RETURNING id, room_id, agent_id, run_id, kind, action`);
  for (const d of dead) {
    await q(`UPDATE run SET status='running' WHERE id=$1`, [d.run_id]);
    await q(`UPDATE agent SET state='working', activity='unanswered — continuing' WHERE id=$1`, [d.agent_id]);
    await append({ type: 'escalation.expired', room_id: d.room_id, agent_id: d.agent_id, run_id: d.run_id,
      payload: { approval_id: d.id, kind: d.kind, action: d.action } });
  }
  return dead.length;
}

/** The chain of custody a run belongs to. Set when a manager assigns, absent otherwise. */
export type RunLink = { mandate_id?: string | null; task_id?: string | null };

export async function startAgent(agentId: string, goalOverride?: string, link?: RunLink) {
  const agent = await one<Agent>('SELECT * FROM agent WHERE id=$1', [agentId]);
  if (!agent) throw new Error('no such agent');
  if (agent.state === 'working' || agent.state === 'awaiting_approval') return agent.current_run_id;
  const policy = POLICIES[agent.policy_key];
  if (!policy) throw new Error(`no policy ${agent.policy_key}`);
  const runId = id('run');
  await q(`INSERT INTO run (id, agent_id, room_id, goal, status, scratch, mandate_id, task_id)
           VALUES ($1,$2,$3,$4,'running','{}',$5,$6)`,
    [runId, agent.id, agent.room_id, goalOverride ?? policy.goal, link?.mandate_id ?? null, link?.task_id ?? null]);
  if (link?.task_id) await q(`UPDATE task SET run_id=$2, state='working' WHERE id=$1`, [link.task_id, runId]);
  await q(`UPDATE agent SET state='working', current_run_id=$2, activity=$3, steps_used=0, spent_cents=0 WHERE id=$1`,
    [agent.id, runId, 'starting']);
  await append({ type: 'run.started', room_id: agent.room_id, agent_id: agent.id, run_id: runId,
    payload: { goal: goalOverride ?? policy.goal, policy: agent.policy_key } });
  return runId;
}

export async function killAgent(agentId: string, reason: string) {
  const a = await one<Agent>('SELECT * FROM agent WHERE id=$1', [agentId]);
  if (!a) return;
  await q(`UPDATE agent SET state='killed', activity=$2 WHERE id=$1`, [agentId, `killed: ${reason}`]);
  if (a.current_run_id) {
    await q(`UPDATE run SET status='killed', kill_reason=$2, ended_at=now() WHERE id=$1`, [a.current_run_id, reason]);
  }
  await q(`UPDATE approval SET state='expired', decided_at=now() WHERE run_id=$1 AND state='pending'`, [a.current_run_id]);
  await settleTask(a.current_run_id, 'killed', reason);
  await append({ type: 'agent.killed', room_id: a.room_id, agent_id: agentId, run_id: a.current_run_id, payload: { reason } });
}

/** A task's state is its run's state. One write, so the two can never disagree. */
export async function settleTask(runId: string | null | undefined, state: string, reason?: string) {
  if (!runId) return;
  await q(`UPDATE task SET state=$2, kill_reason=$3 WHERE run_id=$1`, [runId, state, reason ?? null]);
}

async function say(a: Agent, activity: string) {
  await q('UPDATE agent SET activity=$2 WHERE id=$1', [a.id, activity]);
  // Logged, not just broadcast: the activity string has to survive replay too (R1).
  await append({ type: 'agent.said', room_id: a.room_id, agent_id: a.id, run_id: a.current_run_id, payload: { activity } });
  bus.publish({ type: 'agent.activity', agent_id: a.id, room_id: a.room_id, activity });
}

export async function step(agentRow: Agent, owner: string = INSTANCE) {
  // Fencing: a tick that lost its lease (crashed past TTL, superseded) must not
  // step. The lease is checked at step time, not just claim time.
  const lease = await one<any>('SELECT lease_owner, lease_expires FROM agent WHERE id=$1', [agentRow.id]);
  if (!lease || lease.lease_owner !== owner || (lease.lease_expires && new Date(lease.lease_expires) < new Date())) {
    return 'stolen';
  }
  const room = await one<Room>('SELECT * FROM room WHERE id=$1', [agentRow.room_id]);
  const run = await one<Run>('SELECT * FROM run WHERE id=$1', [agentRow.current_run_id!]);
  if (!room || !run) return;
  if (room.status !== 'open') return;

  const policy = POLICIES[agentRow.policy_key];
  const scratch: Record<string, any> = run.scratch ?? {};
  const idx: number = scratch.__step ?? 0;

  // R4: killed by budget, not by the operator noticing.
  if (agentRow.steps_used >= agentRow.step_budget) return killAgent(agentRow.id, 'step_budget_exhausted');
  if (agentRow.spent_cents >= agentRow.cost_budget_cents) return killAgent(agentRow.id, 'cost_budget_exhausted');
  if ((scratch.__sameStep ?? 0) >= 3) return killAgent(agentRow.id, 'loop_detected');

  if (idx >= policy.steps.length) {
    await q(`UPDATE run SET status='done', ended_at=now() WHERE id=$1`, [run.id]);
    await q(`UPDATE agent SET state='idle', activity='done', current_run_id=NULL WHERE id=$1`, [agentRow.id]);
    await settleTask(run.id, 'done');
    await append({ type: 'run.finished', room_id: room.id, agent_id: agentRow.id, run_id: run.id, payload: { steps: agentRow.steps_used } });
    bus.publish({ type: 'refresh' });
    return;
  }

  const s = policy.steps[idx];
  await say(agentRow, s.activity);
  const ctx: Ctx = { room, agent: agentRow, run: { ...run, scratch }, approvalId: scratch.__approval_granted,
                     say: (t) => say(agentRow, t) };

  let advance = true;
  try {
    await s.run(ctx, scratch);
    if (scratch.__repeat) { delete scratch.__repeat; advance = false; }
    delete scratch.__approval_granted;
    delete scratch.__pending;
  } catch (e: any) {
    advance = false;
    if (e instanceof NeedsApproval) {
      scratch.__pending = e.approvalId;
      await q(`UPDATE agent SET state='awaiting_approval', activity=$2 WHERE id=$1`,
        [agentRow.id, `waiting on you: ${e.action}`]);
      await q(`UPDATE run SET status='awaiting_approval' WHERE id=$1`, [run.id]);
    } else if (e instanceof BudgetExceeded) {
      await haltRoom(room.id, e.message);
      await q(`UPDATE agent SET state='blocked', activity=$2 WHERE id=$1`, [agentRow.id, e.message]);
    } else if (e instanceof ScopeViolation) {
      await q(`UPDATE agent SET state='failed', activity=$2 WHERE id=$1`, [agentRow.id, `scope violation: ${e.message}`]);
      await q(`UPDATE run SET status='failed', ended_at=now(), kill_reason=$2 WHERE id=$1`, [run.id, e.message]);
      await settleTask(run.id, 'failed', e.message);
      await append({ type: 'run.failed', room_id: room.id, agent_id: agentRow.id, run_id: run.id, payload: { error: e.message } });
    } else {
      await q(`UPDATE agent SET state='failed', activity=$2 WHERE id=$1`, [agentRow.id, String(e?.message ?? e).slice(0, 200)]);
      await q(`UPDATE run SET status='failed', ended_at=now(), kill_reason=$2 WHERE id=$1`, [run.id, String(e?.message ?? e).slice(0, 300)]);
      await settleTask(run.id, 'failed', String(e?.message ?? e).slice(0, 300));
      await append({ type: 'run.failed', room_id: room.id, agent_id: agentRow.id, run_id: run.id, payload: { error: String(e?.message ?? e) } });
    }
  }

  scratch.__step = advance ? idx + 1 : idx;
  scratch.__sameStep = advance ? 0 : (scratch.__sameStep ?? 0) + 1;
  await q('UPDATE run SET scratch=$2, steps_used=steps_used+1 WHERE id=$1', [run.id, scratch]);
  await q('UPDATE agent SET steps_used=steps_used+1 WHERE id=$1', [agentRow.id]);

  // An unanswered escalation parks the agent next to the human, not in a retry loop.
  const esc = await one(
    `SELECT id, action FROM approval WHERE run_id=$1 AND kind='escalation' AND state='pending' LIMIT 1`, [run.id]);
  if (esc) {
    await q(`UPDATE agent SET state='blocked', activity=$2 WHERE id=$1 AND state='working'`,
      [agentRow.id, `waiting on you: ${esc.action}`]);
  }
}

async function tick() {
  const cfg = await one<any>('SELECT * FROM global_config WHERE id=1');
  if (cfg?.panic_stop) return;
  await sweepExpired().catch((e) => console.error('[sweep]', e));
  const agents = await claimLeases();
  await Promise.all(agents.map(async (a) => {
    try { await step(a, INSTANCE); } catch (e) { console.error('[tick]', a.id, e); }
  }));
  await releaseLeases();
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => { tick().catch((e) => console.error('[scheduler]', e)); }, TICK_MS);
  console.log(`[atrium] scheduler running, tick ${TICK_MS}ms`);
}
export function stopScheduler() { if (timer) clearInterval(timer); timer = null; }
