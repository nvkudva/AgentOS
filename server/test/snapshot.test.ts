import { test, after } from 'node:test';
import assert from 'node:assert';
import { fold, foldRoom, writeRoomSnapshot } from '../src/replay.js';
import { adjust } from '../src/runtime/budget.js';
import { closeAll, q, one } from '../src/db.js';
import { makeRoom, refresh } from './helpers.js';

/**
 * A7: snapshots are checkpoints, not a second source of truth.
 * snapshot + tail == full fold, and both agree with the live tables.
 */

test('snapshot then tail equals the full fold and the live tables', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['queue.draft'], budget: 1000 });
  try {
    await adjust(ctx, 7, 'test spend one');
    const upto1 = await writeRoomSnapshot(ctx.room.id);
    assert.ok(upto1 > 0, 'the checkpoint has a watermark');
    await adjust(ctx, 5, 'test spend two');
    await refresh(ctx);

    const { slice, upto } = await foldRoom(ctx.room.id);
    assert.ok(upto >= upto1, 'the watermark only moves forward');

    const full = await fold();
    assert.deepEqual(slice.agents[ctx.agent.id], full.agents[ctx.agent.id], 'agent slice == fold');
    assert.deepEqual(slice.runs[ctx.run.id], full.runs[ctx.run.id], 'run slice == fold');
    assert.deepEqual(slice.room, full.rooms[ctx.room.id] ?? null, 'room slice == fold');

    const live = await one<any>(`SELECT spent_cents FROM room WHERE id=$1`, [ctx.room.id]);
    assert.equal(slice.room?.spent_cents, live.spent_cents, 'slice == live room spend');
    assert.equal(slice.room?.spent_cents, ctx.room.spent_cents, 'slice == ctx room spend');

    const snaps = await q(`SELECT upto_event_id FROM snapshot WHERE room_id=$1`, [ctx.room.id]);
    assert.ok(snaps.length >= 1, 'a checkpoint row exists');
  } finally {
    await cleanup();
  }
});

test('a room with no snapshot folds from genesis', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'], budget: 100 });
  try {
    await q(`DELETE FROM snapshot WHERE room_id=$1`, [ctx.room.id]);
    const { slice, upto } = await foldRoom(ctx.room.id);
    assert.equal(upto, 0, 'no watermark');
    const full = await fold();
    assert.deepEqual(slice.agents, {}, 'nothing folded, nothing stored');
    assert.equal(full.agents[ctx.agent.id], undefined, 'genesis agrees: no events, no projection');
  } finally {
    await cleanup();
  }
});

after(() => closeAll());
