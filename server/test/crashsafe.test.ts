import { test, after } from 'node:test';
import assert from 'node:assert';
import { handle } from '../src/api.js';
import { fold } from '../src/replay.js';
import { mintToken } from '../src/auth.js';
import { closeAll, q, one } from '../src/db.js';
import { makeRoom } from './helpers.js';
import { id } from '../src/ids.js';

const post = (path: string, body: any, token?: string | null) =>
  handle({ method: 'POST', path, body, query: new URLSearchParams(), token: token ?? null });

/**
 * PM-11: decide() is crash-safe. State changes and their events commit in one
 * transaction, so the log can never disagree with the tables: no approved row
 * without its event, no resumed run the fold never saw.
 */

async function pending(ctx: any, kind = 'approval') {
  const aid = id('apr');
  await q(`INSERT INTO approval (id, room_id, agent_id, run_id, kind, action, tool, args, blast_radius)
           VALUES ($1,$2,$3,$4,$5,'write x','artifact.write','{}','medium')`,
    [aid, ctx.room.id, ctx.agent.id, ctx.run.id, kind]);
  return aid;
}

test('approve commits state and event together; the fold agrees', async () => {
  const op = await mintToken('test pm11');
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'] });
  try {
    const aid = await pending(ctx);
    const out: any = await post(`/api/approvals/${aid}/decide`, { decision: 'approve' }, op);
    assert.ok(out.ok, 'decided');
    const [ev] = await q(`SELECT * FROM event WHERE type='approval.granted' AND run_id=$1`, [ctx.run.id]);
    assert.ok(ev, 'the grant event committed with the state');
    const f = await fold();
    assert.equal(f.runs[ctx.run.id].status, 'running', 'fold sees the resumed run');
  } finally {
    await cleanup();
  }
});

test('reject ends the run in both table and fold', async () => {
  const op = await mintToken('test pm11b');
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'] });
  try {
    const aid = await pending(ctx);
    await post(`/api/approvals/${aid}/decide`, { decision: 'reject' }, op);
    const f = await fold();
    assert.equal(f.runs[ctx.run.id].status, 'done');
    assert.equal(f.runs[ctx.run.id].kill_reason, 'rejected by operator');
    const run = await one<any>(`SELECT status FROM run WHERE id=$1`, [ctx.run.id]);
    assert.equal(run.status, 'done', 'table and fold agree');
  } finally {
    await cleanup();
  }
});

test('a racing double-decide leaves exactly one decision and no orphan', async () => {
  const op = await mintToken('test pm11c');
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'] });
  try {
    const aid = await pending(ctx);
    const [r1, r2] = await Promise.all([
      post(`/api/approvals/${aid}/decide`, { decision: 'approve' }, op),
      post(`/api/approvals/${aid}/decide`, { decision: 'approve' }, op),
    ]);
    const oks = [r1, r2].filter((r: any) => r.ok).length;
    const conflicts = [r1, r2].filter((r: any) => r.status === 409).length;
    assert.equal(oks, 1, 'one winner');
    assert.equal(conflicts, 1, 'one loser');
    const ap = await one<any>(`SELECT state FROM approval WHERE id=$1`, [aid]);
    const evs = await q(`SELECT id FROM event WHERE type='approval.granted' AND payload->>'approval_id'=$1`, [aid]);
    assert.equal(ap.state, 'approved');
    assert.equal(evs.length, 1, 'the winner logged exactly once');
  } finally {
    await cleanup();
  }
});

test('no orphaned approvals anywhere: every decided row has its event', async () => {
  const orphans = await q<any>(`
    SELECT a.id FROM approval a
     WHERE a.state IN ('approved','rejected')
       AND NOT EXISTS (SELECT 1 FROM event e
         WHERE e.type IN ('approval.granted','approval.rejected')
           AND e.payload->>'approval_id' = a.id)`);
  assert.equal(orphans.length, 0, `orphaned decisions: ${orphans.map((o) => o.id).join(',')}`);
});

after(() => closeAll());
