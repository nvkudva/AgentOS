import { test, after } from 'node:test';
import assert from 'node:assert';
import { callTool, stable } from '../src/runtime/toolbelt.js';
import { closeAll, q, one } from '../src/db.js';
import { NeedsApproval } from '../src/errors.js';
import { makeRoom, refresh } from './helpers.js';

/**
 * PM-3: an approval describes EXACTLY the call it unlocks — including nested
 * args. Two different calls to the same tool must surface two different cards,
 * and key order must never matter.
 */

test('stable() is order-insensitive at every depth, order-sensitive in arrays', () => {
  const a = { z: 1, n: { y: [1, 2, { b: 2, a: 1 }], x: 's' } };
  const b = { n: { x: 's', y: [1, 2, { a: 1, b: 2 }] }, z: 1 };
  assert.equal(stable(a), stable(b), 'key order never matters');
  assert.notEqual(stable(a), stable({ ...b, z: 2 }), 'values still matter');
  assert.notEqual(stable(a), stable({ n: { x: 's', y: [2, 1, { a: 1, b: 2 }] }, z: 1 }),
    'array order is argument order');
});

test('different nested args to one tool raise two different approvals', async () => {
  const { ctx, cleanup } = await makeRoom({
    grants: ['assign'],
    policy: { low: 'approve', medium: 'auto', high: 'approve' },
  });
  await q(`INSERT INTO mandate (id, text, room_id, state) VALUES ('mnd_arg','x',$1,'routed')`, [ctx.room.id]);
  try {
    const e1 = await callTool(ctx, 'assign', { mandate_id: 'mnd_arg', titles: ['one', 'two'] }).catch((e) => e);
    assert.ok(e1 instanceof NeedsApproval, 'first call parks');
    const e2 = await callTool(ctx, 'assign', { mandate_id: 'mnd_arg', titles: ['three'] }).catch((e) => e);
    assert.ok(e2 instanceof NeedsApproval, 'second call parks');
    assert.notEqual(e1.approvalId, e2.approvalId, 'different args, different cards');

    // Approving words A runs words A — and only words A.
    await q(`UPDATE approval SET state='approved' WHERE id=$1`, [e1.approvalId]);
    ctx.approvalId = e1.approvalId;
    await callTool(ctx, 'assign', { mandate_id: 'mnd_arg', titles: ['one', 'two'] });
    await assert.rejects(
      () => callTool(ctx, 'assign', { mandate_id: 'mnd_arg', titles: ['three'] }),
      NeedsApproval, 'the same token never runs different args');
  } finally {
    await q(`DELETE FROM mandate WHERE id='mnd_arg'`).catch(() => {});
    await cleanup();
  }
});

test('reordered keys on the same call reuse the one pending card', async () => {
  const { ctx, cleanup } = await makeRoom({
    grants: ['assign'],
    policy: { low: 'approve', medium: 'auto', high: 'approve' },
  });
  await q(`INSERT INTO mandate (id, text, room_id, state) VALUES ('mnd_arg2','x',$1,'routed')`, [ctx.room.id]);
  try {
    const e1 = await callTool(ctx, 'assign', { titles: ['a'], mandate_id: 'mnd_arg2' }).catch((e) => e);
    const e2 = await callTool(ctx, 'assign', { mandate_id: 'mnd_arg2', titles: ['a'] }).catch((e) => e);
    assert.equal(e1.approvalId, e2.approvalId, 'same args, same card');
  } finally {
    await q(`DELETE FROM mandate WHERE id='mnd_arg2'`).catch(() => {});
    await cleanup();
  }
});

after(() => closeAll());
