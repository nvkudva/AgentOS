import { test, after } from 'node:test';
import assert from 'node:assert';
import { callTool } from '../src/runtime/toolbelt.js';
import { BudgetExceeded, NeedsApproval } from '../src/errors.js';
import { closeAll, q, one } from '../src/db.js';
import { makeRoom, refresh } from './helpers.js';

test('a room budget halts work instead of overrunning it', async () => {
  // 3¢ of budget, a 1¢ tool: the fourth call must not go through.
  const { ctx, cleanup } = await makeRoom({ grants: ['queue.draft'], budget: 3 });
  for (let i = 0; i < 3; i++) {
    await callTool(ctx, 'queue.draft', { channel: 'blog', title: `t${i}`, body: 'x' });
    await refresh(ctx);
  }
  await assert.rejects(() => callTool(ctx, 'queue.draft', { channel: 'blog', title: 't4', body: 'x' }), BudgetExceeded);
  const room = await one<any>('SELECT * FROM room WHERE id=$1', [ctx.room.id]);
  assert.strictEqual(room.spent_cents, 3, 'spent exactly the cap, never a cent more');
  assert.strictEqual(room.status, 'capped', 'the room halts rather than overruns');
  const drafts = await q(`SELECT 1 FROM content_queue WHERE room_id=$1`, [ctx.room.id]);
  assert.strictEqual(drafts.length, 3, 'the over-cap call had no side effect at all');
  await cleanup();
});

test('an irreversible tool never runs without an approval', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['queue.draft', 'queue.publish'], budget: 100 });
  const draft = await callTool(ctx, 'queue.draft', { channel: 'blog', title: 'p', body: 'x' });
  await refresh(ctx);
  await assert.rejects(() => callTool(ctx, 'queue.publish', { id: draft.id, channel: 'blog' }), NeedsApproval);
  const row = await one<any>(`SELECT * FROM content_queue WHERE id=$1`, [draft.id]);
  assert.strictEqual(row.state, 'draft', 'nothing was published');
  const ap = await one<any>(`SELECT * FROM approval WHERE run_id=$1 AND tool='queue.publish'`, [ctx.run.id]);
  assert.ok(ap, 'an approval card exists');
  assert.ok(ap.action.length > 0, 'the card states the action');
  assert.ok(ap.est_cost_cents > 0, 'the card states the cost');
  assert.ok((ap.touches as string[]).length > 0, 'the card states what it touches');
  await cleanup();
});

test('an approval is single-use and bound to its arguments', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['queue.draft', 'queue.publish'], budget: 100 });
  const d1 = await callTool(ctx, 'queue.draft', { channel: 'blog', title: 'a', body: 'x' });
  const d2 = await callTool(ctx, 'queue.draft', { channel: 'blog', title: 'b', body: 'x' });
  await refresh(ctx);
  const err = await callTool(ctx, 'queue.publish', { id: d1.id, channel: 'blog' }).catch((e) => e);
  await q(`UPDATE approval SET state='approved' WHERE id=$1`, [err.approvalId]);
  ctx.approvalId = err.approvalId;

  // the same token must not publish a DIFFERENT post
  await assert.rejects(() => callTool(ctx, 'queue.publish', { id: d2.id, channel: 'blog' }), NeedsApproval);
  // it works exactly once for what was approved
  await refresh(ctx);
  await callTool(ctx, 'queue.publish', { id: d1.id, channel: 'blog' });
  await refresh(ctx);
  await assert.rejects(() => callTool(ctx, 'queue.publish', { id: d1.id, channel: 'blog' }), NeedsApproval);
  await cleanup();
});

test('the panic stop refuses every tool call', async () => {
  // Flips a global row, so it is always restored even if the assertion throws.
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'], budget: 100 });
  await q(`UPDATE global_config SET panic_stop=true WHERE id=1`);
  try {
    await assert.rejects(() => callTool(ctx, 'artifact.write', { title: 'x', body: 'y' }), BudgetExceeded);
  } finally {
    await q(`UPDATE global_config SET panic_stop=false WHERE id=1`);
    await cleanup();
  }
});

after(() => closeAll());
