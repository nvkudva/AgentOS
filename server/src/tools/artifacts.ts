import { q } from '../db.js';
import { id } from '../ids.js';
import { ScopeViolation } from '../errors.js';
import type { ToolSpec } from '../runtime/types.js';

export const artifactWrite: ToolSpec = {
  name: 'artifact.write',
  blast: 'low', reversible: true, external: false,
  summary: (a) => `save an artifact: "${a.title}"`,
  touches: () => ['artifact store (this room)'],
  estimate: () => 0,
  async run(ctx, args) {
    const aid = id('art');
    await q(
      `INSERT INTO artifact (id, room_id, run_id, kind, title, body, shared) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [aid, ctx.room.id, ctx.run.id, args.kind ?? 'note', args.title, args.body ?? '', !!args.shared]
    );
    return { id: aid };
  },
};

/**
 * DECISION D3: rooms share through artifacts, not messages. Cross-room reads are
 * possible only for artifacts explicitly published as shared, and only for rooms
 * granted artifact.read. Every such read is logged.
 */
export const artifactRead: ToolSpec = {
  name: 'artifact.read',
  blast: 'low', reversible: true, external: false,
  summary: (a) => `read shared artifacts${a.room_key_source ? ` from ${a.room_key_source}` : ''}`,
  touches: (a) => [a.room_key_source ? `${a.room_key_source} shared artifacts` : 'shared artifact store'],
  estimate: () => 0,
  async run(ctx, args) {
    const own = await q(`SELECT id, room_id, kind, title, body FROM artifact WHERE room_id=$1 ORDER BY created_at DESC LIMIT 20`, [ctx.room.id]);
    const shared = await q(
      `SELECT a.id, r.key AS room, a.kind, a.title, a.body FROM artifact a
       JOIN room r ON r.id = a.room_id
       WHERE a.shared = true AND a.room_id <> $1 ORDER BY a.created_at DESC LIMIT 20`, [ctx.room.id]
    );
    if (args?.room_key_source) {
      const hit = shared.filter((s) => s.room === args.room_key_source);
      if (!hit.length) {
        const any = await q(`SELECT 1 FROM artifact a JOIN room r ON r.id=a.room_id WHERE r.key=$1 LIMIT 1`, [args.room_key_source]);
        if (any.length) throw new ScopeViolation(ctx.room.key, `private artifacts of "${args.room_key_source}"`);
      }
      return { own: [], shared: hit };
    }
    return { own, shared };
  },
};
