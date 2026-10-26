import { test, after } from 'node:test';
import assert from 'node:assert';
import { handle } from '../src/api.js';
import { callTool } from '../src/runtime/toolbelt.js';
import { mintToken, mintRoomToken } from '../src/auth.js';
import { closeAll, q, one } from '../src/db.js';
import { makeRoom } from './helpers.js';
import { ScopeViolation } from '../src/errors.js';

const post = (path: string, body: any, token?: string | null) =>
  handle({ method: 'POST', path, body, query: new URLSearchParams(), token: token ?? null });

/**
 * PM-10: rooms ask each other through logged, revocable, scope-checked rows —
 * never through operator copy-paste, never across rooms they cannot see.
 */

test('a handoff travels as a shared copy, logged on both sides', async () => {
  const a = await makeRoom({ grants: ['artifact.write', 'artifact.read', 'handoff.request'] });
  const b = await makeRoom({ grants: ['handoff.fulfill'] });
  try {
    const art: any = await callTool(a.ctx, 'artifact.write', { title: 'brief', body: 'numbers' });
    const req: any = await callTool(a.ctx, 'handoff.request',
      { to_room: b.ctx.room.key, artifact_ids: [art.id], message: 'read this' });
    assert.equal(req.state, 'pending');
    const row = await one<any>(`SELECT * FROM handoff WHERE id=$1`, [req.handoff_id]);
    assert.equal(row.state, 'pending');

    const done: any = await callTool(b.ctx, 'handoff.fulfill', { handoff_id: req.handoff_id });
    assert.equal(done.state, 'accepted');
    assert.equal(done.carried, 1);
    const got = await q<any>(`SELECT title, body, shared FROM artifact WHERE room_id=$1`, [b.ctx.room.id]);
    assert.ok(got.some((r) => r.title === 'brief' && r.body === 'numbers' && r.shared),
      'the receiver holds its own shared copy');
    const src = await q<any>(`SELECT * FROM artifact WHERE id=$1`, [art.id]);
    assert.equal(src.length, 1, 'the sender keeps its original');
    const [ev] = await q(`SELECT * FROM event WHERE type='handoff.accepted' AND room_id=$1`, [b.ctx.room.id]);
    assert.ok(ev, 'acceptance is an event');
  } finally {
    await a.cleanup(); await b.cleanup();
  }
});

test('foreign artifacts do not travel; strangers cannot answer', async () => {
  const a = await makeRoom({ grants: ['handoff.request', 'handoff.fulfill'] });
  const b = await makeRoom({ grants: ['handoff.request', 'handoff.fulfill'] });
  const c = await makeRoom({ grants: ['artifact.write', 'artifact.read', 'handoff.fulfill'] });
  try {
    const art: any = await callTool(c.ctx, 'artifact.write', { title: 'secret', body: 'x' });
    await assert.rejects(
      () => callTool(a.ctx, 'handoff.request', { to_room: b.ctx.room.key, artifact_ids: [art.id] }),
      ScopeViolation, "another room's artifacts stay put");
    const req: any = await callTool(a.ctx, 'handoff.request', { to_room: b.ctx.room.key, message: 'hi' });
    await assert.rejects(
      () => callTool(a.ctx, 'handoff.fulfill', { handoff_id: req.handoff_id }),
      ScopeViolation, 'the sender cannot accept its own request');
  } finally {
    await a.cleanup(); await b.cleanup(); await c.cleanup();
  }
});

test('the sender can revoke while pending; then nobody can answer', async () => {
  const op = await mintToken('test handoff');
  const a = await makeRoom({ grants: ['handoff.request'] });
  const b = await makeRoom({ grants: ['handoff.fulfill'] });
  const rtB = await mintRoomToken(b.ctx.room.id);
  const rtA = await mintRoomToken(a.ctx.room.id);
  try {
    const req: any = await callTool(a.ctx, 'handoff.request', { to_room: b.ctx.room.key, message: 'nvm' });
    const rev: any = await post(`/api/handoffs/${req.handoff_id}/revoke`, {}, rtA);
    assert.equal(rev.state, 'revoked');
    const late: any = await post(`/api/handoffs/${req.handoff_id}/respond`, { accept: true }, rtB);
    assert.ok(late.error, 'a revoked handoff stays dead');
    const row = await one<any>(`SELECT state FROM handoff WHERE id=$1`, [req.handoff_id]);
    assert.equal(row.state, 'revoked');
  } finally {
    await a.cleanup(); await b.cleanup();
  }
});

test('room tokens move handoffs only for their own room', async () => {
  const op = await mintToken('test handoff 2');
  const a = await makeRoom({ grants: ['handoff.request'] });
  const b = await makeRoom({ grants: ['handoff.fulfill'] });
  const rtA = await mintRoomToken(a.ctx.room.id);
  try {
    // A room token cannot send as another room.
    const bad: any = await post('/api/handoffs', { from_room: b.ctx.room.key, to_room: a.ctx.room.key }, rtA);
    assert.ok(bad.error, 'cannot impersonate a sender');
    // But it can send as itself.
    const req: any = await post('/api/handoffs',
      { to_room: b.ctx.room.key, message: 'via api' }, rtA);
    assert.equal(req.state, 'pending');
    assert.equal((await post('/api/handoffs', { to_room: 'x' }, null)).status, 401);
    void op;
  } finally {
    await a.cleanup(); await b.cleanup();
  }
});

after(() => closeAll());
