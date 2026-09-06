import { q } from '../db.js';
import { id } from '../ids.js';
import type { ToolSpec } from '../runtime/types.js';

/** Marketing's real output: a row in the real content queue. Reversible → runs unattended. */
export const queueDraft: ToolSpec = {
  name: 'queue.draft',
  blast: 'medium', reversible: true, external: false,
  summary: (a) => `draft "${a.title}" into the ${a.channel} queue`,
  touches: (a) => [`content_queue (${a.channel})`],
  estimate: () => 1,
  async run(ctx, args) {
    const cid = id('cq');
    await q(
      `INSERT INTO content_queue (id, room_id, run_id, channel, title, body, state) VALUES ($1,$2,$3,$4,$5,$6,'draft')`,
      [cid, ctx.room.id, ctx.run.id, args.channel ?? 'blog', args.title, args.body ?? '']
    );
    return { id: cid, state: 'draft' };
  },
};

/** Publishing leaves the building. Irreversible → always the human. */
export const queuePublish: ToolSpec = {
  name: 'queue.publish',
  blast: 'high', reversible: false, external: true,
  summary: (a) => `publish queued post ${a.id} to ${a.channel ?? 'its channel'}`,
  touches: (a) => [`content_queue row ${a.id}`, 'public channel'],
  estimate: () => 5,
  async run(_ctx, args) {
    const rows = await q(`UPDATE content_queue SET state='published' WHERE id=$1 RETURNING *`, [args.id]);
    return rows[0] ?? null;
  },
};
