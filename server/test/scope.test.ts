import { test, after } from 'node:test';
import assert from 'node:assert';
import { callTool } from '../src/runtime/toolbelt.js';
import { rolePool, closeAll, q } from '../src/db.js';
import { ScopeViolation } from '../src/errors.js';
import { makeRoom } from './helpers.js';

/**
 * The whole point of the room metaphor. Each of these SHOULD fail; if any starts
 * passing, rooms have stopped being permission boundaries and the design is dead.
 */

test('a room cannot call a tool it was not granted', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'] });
  await assert.rejects(() => callTool(ctx, 'sql.query', { sql: 'SELECT 1' }), ScopeViolation);
  const [v] = await q(`SELECT * FROM event WHERE room_id=$1 AND type='scope.violation'`, [ctx.room.id]);
  assert.ok(v, 'the refusal is logged, not just thrown');
  await cleanup();
});

test('a room cannot act on another room by naming it', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'] });
  await assert.rejects(
    () => callTool(ctx, 'artifact.write', { room_key: 'analytics', title: 'x', body: 'y' }),
    ScopeViolation);
  await cleanup();
});

test('sql.query refuses anything that writes', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['sql.query'], db_role: 'atrium_analytics' });
  for (const sql of ['DELETE FROM bizdata.orders', 'UPDATE bizdata.customer SET plan=$1',
                     'DROP TABLE bizdata.orders', 'SELECT 1; DROP TABLE bizdata.orders']) {
    await assert.rejects(() => callTool(ctx, 'sql.query', { sql }), ScopeViolation, sql);
  }
  await cleanup();
});

test('the engineering database role has no grant on business data', async () => {
  // Not our gate — postgres itself refuses. Belt and braces.
  const p = rolePool('atrium_engineering');
  await assert.rejects(() => p.query('SELECT * FROM bizdata.orders LIMIT 1'), /permission denied|does not exist/i);
});

test('the analytics role can read business data but not write it', async () => {
  const p = rolePool('atrium_analytics');
  const r = await p.query('SELECT count(*)::int n FROM bizdata.orders');
  assert.ok(r.rows[0].n > 0, 'analytics really can read the real table');
  await assert.rejects(() => p.query(`UPDATE bizdata.orders SET status='paid'`), /permission denied/i);
});

test('a room cannot read another room\'s private artifacts', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.read', 'artifact.write'] });
  await callTool(ctx, 'artifact.write', { title: 'private', body: 'mine', shared: false });
  const { ctx: other, cleanup: c2 } = await makeRoom({ grants: ['artifact.read'] });
  await assert.rejects(() => callTool(other, 'artifact.read', { room_key_source: ctx.room.key }), ScopeViolation);
  await cleanup(); await c2();
});

test('repo tools cannot escape the workspace', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['repo.read'] });
  await assert.rejects(() => callTool(ctx, 'repo.read', { path: '../../etc/passwd' }), ScopeViolation);
  await cleanup();
});

after(() => closeAll());
