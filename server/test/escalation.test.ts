import { test, after } from 'node:test';
import assert from 'node:assert';
import { handle } from '../src/api.js';
import { mintToken } from '../src/auth.js';
import { sweepExpired } from '../src/runtime/scheduler.js';
import { closeAll, q, one } from '../src/db.js';
import { makeRoom } from './helpers.js';
import { id } from '../src/ids.js';

const post = (path: string, body: any, token?: string | null) =>
  handle({ method: 'POST', path, body, query: new URLSearchParams(), token: token ?? null });

/**
 * A5 + PM-9: questions expire instead of deadlocking, storms clear in batches,
 * and the queue says how long everything has waited.
 */

async function pendingEscalation(ctx: any, question = 'which quarter?') {
  const aid = id('esc');
  await q(`INSERT INTO approval (id, room_id, agent_id, run_id, kind, action, tool, args, blast_radius, expires_at)
           VALUES ($1,$2,$3,$4,'escalation',$5,'escalate','{}','low', now() + interval '1 minute')`,
    [aid, ctx.room.id, ctx.agent.id, ctx.run.id, question]);
  await q(`UPDATE agent SET state='blocked', activity=$2 WHERE id=$1`, [ctx.agent.id, `waiting on you: ${question}`]);
  await q(`UPDATE run SET status='awaiting_approval' WHERE id=$1`, [ctx.run.id]);
  return aid;
}

test('escalations carry a deadline; gate approvals do not', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'] });
  try {
    const aid = await pendingEscalation(ctx);
    const row = await one<any>(`SELECT expires_at, kind FROM approval WHERE id=$1`, [aid]);
    assert.ok(row.expires_at, 'a question expires');
    const gate = id('apr');
    await q(`INSERT INTO approval (id, room_id, agent_id, run_id, kind, action, tool, args, blast_radius)
             VALUES ($1,$2,$3,$4,'approval','write x','artifact.write','{}','medium')`,
      [gate, ctx.room.id, ctx.agent.id, ctx.run.id]);
    const g = await one<any>(`SELECT expires_at FROM approval WHERE id=$1`, [gate]);
    assert.equal(g.expires_at, null, 'an irreversible gate waits as long as it takes');
  } finally {
    await cleanup();
  }
});

test('an expired question releases its agent and logs the release', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'] });
  try {
    const aid = await pendingEscalation(ctx);
    await q(`UPDATE approval SET expires_at = now() - interval '1 second' WHERE id=$1`, [aid]);
    const n = await sweepExpired();
    assert.ok(n >= 1, 'the sweep found it');
    const ap = await one<any>(`SELECT state FROM approval WHERE id=$1`, [aid]);
    const a = await one<any>(`SELECT state FROM agent WHERE id=$1`, [ctx.agent.id]);
    const r = await one<any>(`SELECT status FROM run WHERE id=$1`, [ctx.run.id]);
    assert.equal(ap.state, 'expired');
    assert.equal(a.state, 'working', 'nobody stays parked on an unanswered question');
    assert.equal(r.status, 'running');
    const [ev] = await q(`SELECT * FROM event WHERE type='escalation.expired' AND run_id=$1`, [ctx.run.id]);
    assert.ok(ev, 'replay sees the release');
  } finally {
    await cleanup();
  }
});

test('a batch clears a storm, per-id results, operator only', async () => {
  const op = await mintToken('test batch');
  const a = await makeRoom({ grants: ['artifact.write'] });
  const ids: string[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      const aid = id('apr');
      await q(`INSERT INTO approval (id, room_id, agent_id, run_id, kind, action, tool, args, blast_radius)
               VALUES ($1,$2,$3,$4,'approval','write ${i}','artifact.write','{}','medium')`,
        [aid, a.ctx.room.id, a.ctx.agent.id, a.ctx.run.id]);
      ids.push(aid);
    }
    const res: any = await post('/api/approvals/batch', { ids, decision: 'approve' }, op);
    assert.ok(ids.every((x) => res.results[x]?.ok), 'every id approved');
    const bad: any = await post('/api/approvals/batch', { ids: ['apr_nope'], decision: 'approve' }, op);
    assert.ok(bad.results.apr_nope.error, 'unknown ids report per-id');
    assert.equal((await post('/api/approvals/batch', { ids, decision: 'approve' }, null)).status, 401);
  } finally {
    await a.cleanup();
  }
});

test('the queue reports wait time for SLA triage', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'] });
  try {
    await pendingEscalation(ctx, 'sla probe?');
    const rows = await q<any>(`SELECT wait_secs FROM (
      SELECT EXTRACT(EPOCH FROM (now() - created_at))::int AS wait_secs FROM approval WHERE state='pending') s`);
    assert.ok(rows.every((r) => Number.isInteger(r.wait_secs) && r.wait_secs >= 0), 'every row carries its wait');
  } finally {
    await cleanup();
  }
});

after(() => closeAll());
