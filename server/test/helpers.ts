import { pool, q, one } from '../src/db.js';
import { id } from '../src/ids.js';
import type { Ctx } from '../src/runtime/types.js';

export async function makeRoom(opts: {
  key?: string; grants: string[]; budget?: number; db_role?: string | null;
  policy?: Record<string, string>;
}) {
  const key = opts.key ?? `t_${id('r').slice(-8)}`;
  const rid = id('room');
  await q(
    `INSERT INTO room (id,key,name,objective,x,y,w,h,budget_cents,tool_grants,approval_policy,db_role)
     VALUES ($1,$2,$3,'test',0,0,1,1,$4,$5,$6,$7)`,
    [rid, key, key, opts.budget ?? 100, JSON.stringify(opts.grants),
     JSON.stringify(opts.policy ?? { low: 'auto', medium: 'auto', high: 'approve' }), opts.db_role ?? null]);
  const aid = id('agt');
  await q(`INSERT INTO agent (id,room_id,name,role,policy_key,state,cost_budget_cents)
           VALUES ($1,$2,'T','tester','analytics.weekly','working',$3)`, [aid, rid, opts.budget ?? 100]);
  const runId = id('run');
  await q(`INSERT INTO run (id,agent_id,room_id,goal) VALUES ($1,$2,$3,'test')`, [runId, aid, rid]);
  await q(`UPDATE agent SET current_run_id=$2 WHERE id=$1`, [aid, runId]);

  const ctx: Ctx = {
    room: await one<any>('SELECT * FROM room WHERE id=$1', [rid]),
    agent: await one<any>('SELECT * FROM agent WHERE id=$1', [aid]),
    run: await one<any>('SELECT * FROM run WHERE id=$1', [runId]),
    say: async () => {},
  };
  return { ctx, rid, aid, runId, cleanup: () => q('DELETE FROM room WHERE id=$1', [rid]) };
}

export const refresh = async (ctx: Ctx) => {
  ctx.room = await one<any>('SELECT * FROM room WHERE id=$1', [ctx.room.id]);
  ctx.run = await one<any>('SELECT * FROM run WHERE id=$1', [ctx.run.id]);
  return ctx;
};
export { pool, q, one };
