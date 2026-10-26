import { test, after } from 'node:test';
import assert from 'node:assert';
import { callTool } from '../src/runtime/toolbelt.js';
import { adjust } from '../src/runtime/budget.js';
import { closeAll, q, one } from '../src/db.js';
import { makeRoom, refresh } from './helpers.js';

/**
 * A10: the quote is a guess; the settle is the bill. Positive deltas respect
 * caps, refunds clamp at zero, and the ledger records both lines.
 */

test('a refund lowers spend and leaves a ledger line', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['queue.draft'], budget: 100 });
  try {
    await callTool(ctx, 'queue.draft', { channel: 'blog', title: 't', body: 'b' });
    await refresh(ctx);
    const quoted = ctx.run.spent_cents;
    assert.ok(quoted >= 1, 'the quote landed');
    await adjust(ctx, -1, 'test refund');
    await refresh(ctx);
    assert.equal(ctx.run.spent_cents, quoted - 1, 'the true-up refunded a cent');
    const [line] = await q(`SELECT cents, reason FROM ledger WHERE run_id=$1 ORDER BY id DESC LIMIT 1`, [ctx.run.id]);
    assert.equal(line.cents, -1);
    assert.match(line.reason, /refund/);
  } finally {
    await cleanup();
  }
});

test('a positive true-up still respects the cap', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['queue.draft'], budget: 1 });
  try {
    await callTool(ctx, 'queue.draft', { channel: 'blog', title: 't', body: 'b' });
    await refresh(ctx);
    const err = await adjust(ctx, 100, 'test overrun').catch((e) => e);
    assert.match(err.message, /cap/, 'the cap holds against true-ups too');
    await refresh(ctx);
    assert.ok(ctx.run.spent_cents <= 1, 'nothing squeezed past');
  } finally {
    await cleanup();
  }
});

test('refunds never drive spend negative', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'], budget: 100 });
  try {
    await adjust(ctx, -9999, 'test over-refund');
    await refresh(ctx);
    assert.equal(ctx.run.spent_cents, 0, 'clamped at zero');
    const r = await one<any>(`SELECT spent_cents FROM room WHERE id=$1`, [ctx.room.id]);
    assert.equal(r.spent_cents, 0);
  } finally {
    await cleanup();
  }
});

after(() => closeAll());
