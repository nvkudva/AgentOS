import { q, one } from '../db.js';
import { append } from '../events.js';
import { id } from '../ids.js';
import { ScopeViolation, NeedsApproval, BudgetExceeded } from '../errors.js';
import { charge, haltRoom } from './budget.js';
import type { Ctx, ToolSpec, Blast } from './types.js';
import { TOOLS } from '../tools/index.js';

const stable = (o: any) => JSON.stringify(o, Object.keys(o ?? {}).sort());

/**
 * The one gate every agent action passes through.
 *
 * Order matters and is deliberate:
 *   1. panic stop / room status   — a halted room runs nothing
 *   2. GRANT check                — the room's scope. Violations are logged and fail hard.
 *   3. approval gate              — blast radius decides; irreversible always needs a human
 *   4. budget charge              — transactional, so caps halt rather than overrun
 *   5. execute                    — only now does anything real happen
 */
export async function callTool(ctx: Ctx, name: string, args: any): Promise<any> {
  const spec: ToolSpec | undefined = TOOLS[name];
  if (!spec) throw new ScopeViolation(ctx.room.key, name, `unknown tool "${name}"`);

  // 1. room status
  const room = await one<any>('SELECT * FROM room WHERE id=$1', [ctx.room.id]);
  const cfg = await one<any>('SELECT * FROM global_config WHERE id=1');
  if (cfg.panic_stop) throw new BudgetExceeded('global', 'panic stop engaged');
  if (room.status !== 'open') throw new BudgetExceeded('room', `room ${room.key} is ${room.status}`);

  // 2. SCOPE. The room's tool_grants are the whole permission surface.
  const grants: string[] = room.tool_grants ?? [];
  if (!grants.includes(name)) {
    await append({
      type: 'scope.violation', room_id: ctx.room.id, agent_id: ctx.agent.id, run_id: ctx.run.id,
      payload: { tool: name, args, grants },
    });
    throw new ScopeViolation(room.key, name);
  }
  // Tools that name a room in their args may only ever name their own.
  if (args && typeof args === 'object' && 'room_key' in args && args.room_key !== room.key) {
    await append({
      type: 'scope.violation', room_id: ctx.room.id, agent_id: ctx.agent.id, run_id: ctx.run.id,
      payload: { tool: name, attempted_room: args.room_key },
    });
    throw new ScopeViolation(room.key, `${name} on room "${args.room_key}"`);
  }

  // 3. approval gate — blast radius, not a fixed rule (DECISION D2)
  const policy = (room.approval_policy ?? {}) as Record<Blast, 'auto' | 'approve'>;
  const needs = !spec.reversible || policy[spec.blast] === 'approve';
  if (needs) {
    const granted = ctx.approvalId
      ? await one<any>(`SELECT * FROM approval WHERE id=$1 AND state='approved' AND consumed_at IS NULL`, [ctx.approvalId])
      : null;
    const matches = granted && granted.tool === name && stable(granted.args) === stable(args);
    if (!matches) {
      const existing = await one<any>(
        `SELECT * FROM approval WHERE run_id=$1 AND tool=$2 AND state='pending'`, [ctx.run.id, name]
      );
      const aid = existing?.id ?? id('apr');
      if (!existing) {
        await q(
          `INSERT INTO approval (id, room_id, agent_id, run_id, action, tool, args, blast_radius,
                                 est_cost_cents, run_spent_cents, touches)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [aid, ctx.room.id, ctx.agent.id, ctx.run.id, spec.summary(args), name, args, spec.blast,
           spec.estimate(args), ctx.run.spent_cents, JSON.stringify(spec.touches(args))]
        );
        await append({
          type: 'approval.requested', room_id: ctx.room.id, agent_id: ctx.agent.id, run_id: ctx.run.id,
          payload: { approval_id: aid, action: spec.summary(args), cost_cents: spec.estimate(args), touches: spec.touches(args) },
        });
      }
      throw new NeedsApproval(aid, spec.summary(args));
    }
    await q(`UPDATE approval SET consumed_at=now() WHERE id=$1`, [granted.id]);
  }

  // 4. budget
  const est = spec.estimate(args);
  try {
    await charge(ctx, est, `${name} (est)`);
  } catch (e) {
    if (e instanceof BudgetExceeded) await haltRoom(ctx.room.id, e.message);
    throw e;
  }

  // 5. execute
  await append({
    type: 'tool.call', room_id: ctx.room.id, agent_id: ctx.agent.id, run_id: ctx.run.id,
    payload: { tool: name, args, est_cost_cents: est, touches: spec.touches(args) },
  });
  const started = Date.now();
  try {
    const result = await spec.run(ctx, args);
    await append({
      type: 'tool.result', room_id: ctx.room.id, agent_id: ctx.agent.id, run_id: ctx.run.id,
      payload: { tool: name, ms: Date.now() - started, result: truncate(result) },
    });
    return result;
  } catch (err: any) {
    await append({
      type: 'tool.error', room_id: ctx.room.id, agent_id: ctx.agent.id, run_id: ctx.run.id,
      payload: { tool: name, error: String(err?.message ?? err) },
    });
    throw err;
  }
}

function truncate(v: any) {
  const s = JSON.stringify(v ?? null);
  return s && s.length > 4000 ? JSON.parse(JSON.stringify(String(s).slice(0, 4000) + '…')) : v;
}
