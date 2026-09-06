import { q, one, tx } from '../db.js';
import { append } from '../events.js';
import { BudgetExceeded } from '../errors.js';
import type { Ctx } from './types.js';

/**
 * R3: caps HALT work, they do not overrun. The charge happens in the same
 * transaction as the decision to allow the call, so two concurrent agents in the
 * same room cannot both squeeze past the last cent.
 */
export async function charge(ctx: Ctx, cents: number, reason: string) {
  if (cents <= 0) return;
  await tx(async (c) => {
    const g = (await c.query('SELECT * FROM global_config WHERE id=1 FOR UPDATE')).rows[0];
    if (g.panic_stop) throw new BudgetExceeded('global', 'panic stop engaged');
    if (g.global_spent_cents + cents > g.global_budget_cents) {
      throw new BudgetExceeded('global', `${g.global_spent_cents}+${cents} > ${g.global_budget_cents}`);
    }
    const r = (await c.query('SELECT * FROM room WHERE id=$1 FOR UPDATE', [ctx.room.id])).rows[0];
    if (r.status !== 'open') throw new BudgetExceeded('room', `room ${r.key} is ${r.status}`);
    if (r.spent_cents + cents > r.budget_cents) {
      throw new BudgetExceeded('room', `${r.key}: ${r.spent_cents}+${cents} > ${r.budget_cents}`);
    }
    const run = (await c.query('SELECT * FROM run WHERE id=$1 FOR UPDATE', [ctx.run.id])).rows[0];
    if (run.spent_cents + cents > ctx.agent.cost_budget_cents) {
      throw new BudgetExceeded('run', `run ${run.id}: ${run.spent_cents}+${cents} > ${ctx.agent.cost_budget_cents}`);
    }
    await c.query('UPDATE global_config SET global_spent_cents = global_spent_cents + $1 WHERE id=1', [cents]);
    await c.query('UPDATE room SET spent_cents = spent_cents + $1 WHERE id=$2', [cents, ctx.room.id]);
    await c.query('UPDATE run  SET spent_cents = spent_cents + $1 WHERE id=$2', [cents, ctx.run.id]);
    await c.query('UPDATE agent SET spent_cents = spent_cents + $1 WHERE id=$2', [cents, ctx.agent.id]);
    await c.query(
      'INSERT INTO ledger (room_id, agent_id, run_id, cents, reason) VALUES ($1,$2,$3,$4,$5)',
      [ctx.room.id, ctx.agent.id, ctx.run.id, cents, reason]
    );
    ctx.room.spent_cents = r.spent_cents + cents;
    ctx.run.spent_cents = run.spent_cents + cents;
  });
  await append({ type: 'spend', room_id: ctx.room.id, agent_id: ctx.agent.id, run_id: ctx.run.id, payload: { cents, reason } });
}

/** Called when a cap is hit: the room stops taking work instead of overrunning it. */
export async function haltRoom(roomId: string, why: string) {
  await q(`UPDATE room SET status='capped' WHERE id=$1 AND status='open'`, [roomId]);
  await q(`UPDATE agent SET state='blocked', activity=$2 WHERE room_id=$1 AND state IN ('working','idle')`, [roomId, `halted: ${why}`]);
  await append({ type: 'room.capped', room_id: roomId, payload: { why } });
}

export async function globalConfig() {
  return await one('SELECT * FROM global_config WHERE id=1');
}
