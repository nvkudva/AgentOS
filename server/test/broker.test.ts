import { test, after } from 'node:test';
import assert from 'node:assert';
import { callTool } from '../src/runtime/toolbelt.js';
import { withBroker, closeAll, q } from '../src/db.js';
import { ScopeViolation } from '../src/errors.js';
import { makeRoom, refresh } from './helpers.js';

/**
 * A4 + A3: live traffic goes through broker roles (no per-room pools), and a
 * tool grant never widens the room's data profile. Both layers are tested —
 * the gate refusing, and postgres refusing underneath it.
 */

test('reads flow through the reader broker', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['sql.query'] });
  try {
    const r: any = await callTool(ctx, 'sql.query', { sql: 'SELECT count(*)::int n FROM bizdata.orders' });
    assert.ok(r.rows[0].n > 0, 'the broker can read business data');
  } finally {
    await cleanup();
  }
});

test('a grant does not widen the profile: read_business cannot annotate', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['crm.note'] });
  try {
    const err = await callTool(ctx, 'crm.note', { id: 1, note: 'x' }).catch((e) => e);
    assert.ok(err instanceof ScopeViolation, 'gate refuses before the database is touched');
    assert.match(err.message, /write_pipeline/);
  } finally {
    await cleanup();
  }
});

test('support rooms work tickets through the broker; others are refused', async () => {
  // Seed creates no tickets, so stage one open ticket as the fixture.
  const staged = await q<{ id: number }>(
    `INSERT INTO support.ticket (subject, body) VALUES ('probe', 'probe') RETURNING id`);
  const s = await makeRoom({ grants: ['ticket.list'], accessProfile: 'support_desk' });
  try {
    const r: any = await callTool(s.ctx, 'ticket.list', { status: 'open' });
    assert.ok(Array.isArray(r.rows) && r.rows.length > 0, 'support reads its tickets');
  } finally {
    await s.cleanup();
    await q('DELETE FROM support.ticket WHERE id=$1', [staged[0].id]);
  }
  const o = await makeRoom({ grants: ['ticket.list'], accessProfile: 'read_business' });
  try {
    await assert.rejects(() => callTool(o.ctx, 'ticket.list', { status: 'open' }), ScopeViolation);
  } finally {
    await o.cleanup();
  }
});

test('the reader broker itself cannot write, even if the gate is bypassed', async () => {
  await assert.rejects(
    () => withBroker('reader', 'probe', (c) => c.query(`UPDATE bizdata.pipeline SET note='x' WHERE id=1`)),
    /permission denied/i, 'postgres is the second enforcement layer');
});

test('rooms without a profile touch no company data', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['sql.query'], accessProfile: 'none' });
  try {
    await refresh(ctx);
    await assert.rejects(() => callTool(ctx, 'sql.query', { sql: 'SELECT 1' }), ScopeViolation);
  } finally {
    await cleanup();
  }
});

after(() => closeAll());
