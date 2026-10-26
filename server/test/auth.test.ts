import { test, after } from 'node:test';
import assert from 'node:assert';
import { handle } from '../src/api.js';
import { mintToken, mintRoomToken } from '../src/auth.js';
import { closeAll, q, one } from '../src/db.js';
import { makeRoom } from './helpers.js';
import { id } from '../src/ids.js';

const get = (path: string, token?: string | null) =>
  handle({ method: 'GET', path, body: {}, query: new URLSearchParams(), token: token ?? null });
const post = (path: string, body: any, token?: string | null) =>
  handle({ method: 'POST', path, body, query: new URLSearchParams(), token: token ?? null });

/**
 * A9: the open port closes. Every /api/* needs a token; room tokens see only
 * their room; deciding is atomic so a crash cannot orphan an approval.
 */

test('no token or a bogus token gets nothing', async () => {
  assert.equal((await get('/api/state')).status, 401);
  assert.equal((await get('/api/state', 'nope')).status, 401);
  assert.equal((await post('/api/panic', { on: true }, 'nope')).status, 401);
});

test('operator token opens the desk, room token opens only its room', async () => {
  const op = await mintToken('test operator');
  const s = await get('/api/state', op);
  assert.ok(Array.isArray(s.rooms) && s.rooms.length > 0, 'operator sees rooms');

  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'] });
  const rt = await mintRoomToken(ctx.room.id);
  try {
    assert.equal((await get('/api/state', rt)).status, 403, 'no global snapshot for rooms');
    const own = await get(`/api/rooms/${ctx.room.key}`, rt);
    assert.ok(own.room && own.room.id === ctx.room.id, 'own room detail ok');
    const other = s.rooms.find((r: any) => r.id !== ctx.room.id);
    if (other) {
      assert.equal((await get(`/api/rooms/${other.key}`, rt)).status, 403, 'never another room');
    }
    assert.equal((await post('/api/budget', { cents: 10 }, rt)).status, 403, 'rooms cannot move money');
    assert.equal((await post('/api/panic', { on: true }, rt)).status, 403, 'rooms cannot panic');
    const ob = await post('/api/observe', { view: 'floor', action: 'x' }, rt);
    assert.ok(ob.ok, 'rooms can report instrumentation');
    assert.equal((await post('/api/observe', { view: '', action: 'x' }, rt)).status, 400, 'observe validates');
  } finally {
    await cleanup();
  }
});

test('budget input is validated', async () => {
  const op = await mintToken('test operator 2');
  for (const cents of [-5, 0, 1.5, 'x', NaN]) {
    assert.equal((await post('/api/budget', { cents }, op)).status, 400, `rejects ${String(cents)}`);
  }
  assert.equal((await post('/api/budget', { room: 'no_such_room', cents: 10 }, op)).status, 404);
});

test('decide is atomic: one winner, no orphaned approval', async () => {
  const op = await mintToken('test operator 3');
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'] });
  const aid = id('apr');
  try {
    await q(`INSERT INTO approval (id, room_id, agent_id, run_id, kind, action, tool, args, blast_radius)
             VALUES ($1,$2,$3,$4,'approval','write x','artifact.write','{}','medium')`,
      [aid, ctx.room.id, ctx.agent.id, ctx.run.id]);
    const first = await post(`/api/approvals/${aid}/decide`, { decision: 'approve' }, op);
    assert.ok(first.ok, 'first decide wins');
    const again = await post(`/api/approvals/${aid}/decide`, { decision: 'approve' }, op);
    assert.equal(again.status, 409, 'second decide loses');
    const ap = await one<any>(`SELECT state FROM approval WHERE id=$1`, [aid]);
    const run = await one<any>(`SELECT status, scratch FROM run WHERE id=$1`, [ctx.run.id]);
    assert.equal(ap.state, 'approved');
    assert.equal(run.status, 'running', 'approved row always has its resumed run');
    assert.equal(run.scratch.__approval_granted, aid, 'the grant token is on the run');
  } finally {
    await cleanup();
  }
});

test('a room token cannot decide another room\'s approval', async () => {
  const op = await mintToken('test operator 4');
  const a = await makeRoom({ grants: ['artifact.write'] });
  const b = await makeRoom({ grants: ['artifact.write'] });
  const aid = id('apr');
  const rtB = await mintRoomToken(b.ctx.room.id);
  try {
    await q(`INSERT INTO approval (id, room_id, agent_id, run_id, kind, action, tool, args, blast_radius)
             VALUES ($1,$2,$3,$4,'approval','write x','artifact.write','{}','medium')`,
      [aid, a.ctx.room.id, a.ctx.agent.id, a.ctx.run.id]);
    assert.equal(
      (await post(`/api/approvals/${aid}/decide`, { decision: 'approve' }, rtB)).status, 403);
  } finally {
    await a.cleanup(); await b.cleanup();
  }
});

after(() => closeAll());
