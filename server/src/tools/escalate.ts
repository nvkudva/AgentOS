import { q } from '../db.js';
import { id } from '../ids.js';
import { append } from '../events.js';
import type { ToolSpec } from '../runtime/types.js';

/** The agent asks the human a question. Lands in the inbox next to approvals. */
export const escalate: ToolSpec = {
  name: 'escalate',
  blast: 'low', reversible: true, external: false,
  summary: (a) => a.question,
  touches: () => ['your attention'],
  estimate: () => 0,
  async run(ctx, args) {
    const aid = id('esc');
    await q(
      `INSERT INTO approval (id, room_id, agent_id, run_id, kind, action, tool, args, blast_radius,
                             est_cost_cents, run_spent_cents, touches)
       VALUES ($1,$2,$3,$4,'escalation',$5,'escalate',$6,'low',$7,$8,'["your attention"]')`,
      [aid, ctx.room.id, ctx.agent.id, ctx.run.id, args.question, args, args.est_cost_cents ?? 0, ctx.run.spent_cents]
    );
    await append({ type: 'escalation.raised', room_id: ctx.room.id, agent_id: ctx.agent.id, run_id: ctx.run.id,
                   payload: { approval_id: aid, question: args.question } });
    return { escalation_id: aid, parked: true };
  },
};
