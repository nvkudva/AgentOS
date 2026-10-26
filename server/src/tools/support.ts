import { withBroker } from '../db.js';
import type { ToolSpec } from '../runtime/types.js';

/** Real reads from the real support desk, through the room's own database role. */
export const ticketList: ToolSpec = {
  name: 'ticket.list',
  blast: 'low', reversible: true, external: false,
  profiles: ['support_desk'],
  summary: (a) => `look at ${a.status ?? 'open'} tickets`,
  touches: () => ['support.ticket'],
  estimate: () => 1,
  async run(ctx, args) {
    return withBroker('reader', ctx.room.key, async (c) => {
      const r = await c.query(
        `SELECT t.id, t.subject, t.body, t.priority, t.status, t.opened_at, c.name AS customer, c.plan
           FROM support.ticket t LEFT JOIN bizdata.customer c ON c.id = t.customer_id
          WHERE t.status = $1
          ORDER BY (t.priority='urgent') DESC, t.opened_at ASC
          LIMIT $2`,
        [args.status ?? 'open', Math.min(20, args.limit ?? 10)]
      );
      return { rowCount: r.rowCount, rows: r.rows };
    });
  },
};

/**
 * A reply the customer will read. Externally visible and not takeable back,
 * so the toolbelt always parks it for a human before this ever runs.
 */
export const ticketReply: ToolSpec = {
  name: 'ticket.reply',
  blast: 'high', reversible: false, external: true,
  profiles: ['support_desk'],
  summary: (a) => `send a reply to ticket #${a.id}`,
  touches: (a) => [`support.ticket #${a.id}`, 'the customer'],
  estimate: () => 3,
  async run(ctx, args) {
    return withBroker('writer', ctx.room.key, async (c) => {
      const r = await c.query(
        `UPDATE support.ticket SET reply = $2, status = 'answered', answered_at = now()
          WHERE id = $1 RETURNING id, subject, status`,
        [args.id, String(args.reply).slice(0, 2000)]
      );
      return r.rows[0] ?? null;
    });
  },
};
