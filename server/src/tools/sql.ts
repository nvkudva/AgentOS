import { rolePool } from '../db.js';
import { ScopeViolation } from '../errors.js';
import type { ToolSpec } from '../runtime/types.js';

const READ_ONLY = /^\s*(select|with)\b/i;
const BANNED = /\b(insert|update|delete|drop|alter|create|grant|revoke|copy|truncate)\b/i;

/**
 * Real query against the real Postgres, through the ROOM'S OWN database role.
 * Scoping here is at the credential: the engineering role has no grant on bizdata,
 * so even a bug in our gate cannot leak the data — postgres refuses.
 */
export const sqlQuery: ToolSpec = {
  name: 'sql.query',
  blast: 'low', reversible: true, external: false,
  summary: (a) => `run a read-only query: ${String(a.sql).replace(/\s+/g, ' ').slice(0, 120)}`,
  touches: (a) => (String(a.sql).match(/\b(?:from|join)\s+([a-z_][\w.]*)/gi) ?? []).map((s) => s.split(/\s+/)[1]),
  estimate: () => 1,
  async run(ctx, args) {
    const sql = String(args.sql ?? '');
    if (!READ_ONLY.test(sql) || BANNED.test(sql)) {
      throw new ScopeViolation(ctx.room.key, 'sql.query', 'only read-only SELECT/WITH statements are permitted');
    }
    if (!ctx.room.db_role) throw new ScopeViolation(ctx.room.key, 'sql.query', 'room has no database role');
    const p = rolePool(ctx.room.db_role);
    const r = await p.query({ text: sql, rowMode: undefined });
    return { rowCount: r.rowCount, rows: r.rows.slice(0, 200), fields: r.fields.map((f) => f.name) };
  },
};

/** Real write, narrow blast radius: annotate one CRM row. Reversible (previous note kept). */
export const crmNote: ToolSpec = {
  name: 'crm.note',
  blast: 'medium', reversible: true, external: false,
  summary: (a) => `add a pipeline note to deal #${a.id}`,
  touches: () => ['bizdata.pipeline'],
  estimate: () => 1,
  async run(ctx, args) {
    if (!ctx.room.db_role) throw new ScopeViolation(ctx.room.key, 'crm.note', 'room has no database role');
    const p = rolePool(ctx.room.db_role);
    const r = await p.query(
      `UPDATE bizdata.pipeline SET note = $2 WHERE id = $1 RETURNING id, account, stage, note`,
      [args.id, String(args.note).slice(0, 500)]
    );
    return r.rows[0] ?? null;
  },
};
