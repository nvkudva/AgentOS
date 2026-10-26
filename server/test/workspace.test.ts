import { test, after } from 'node:test';
import assert from 'node:assert';
import { callTool } from '../src/runtime/toolbelt.js';
import { roomTree, removeRoomTree, WORKSPACE } from '../src/tools/repo.js';
import { withRoomLock, closeAll } from '../src/db.js';
import { makeRoom } from './helpers.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * A8: one room, one tree, one lock. Concurrent patches serialize, trees
 * diverge per room, and reads see the room's own last commit.
 */

test('two rooms patch without touching each other', async () => {
  const a = await makeRoom({ grants: ['repo.read', 'repo.patch'] });
  const b = await makeRoom({ grants: ['repo.read', 'repo.patch'] });
  try {
    await callTool(a.ctx, 'repo.patch', { path: 'src/a.txt', body: 'aaa', branch: `w-a-${a.ctx.room.key}`, message: 'a' });
    await callTool(b.ctx, 'repo.patch', { path: 'src/b.txt', body: 'bbb', branch: `w-b-${b.ctx.room.key}`, message: 'b' });
    const ta = await roomTree(a.ctx.room.key);
    const tb = await roomTree(b.ctx.room.key);
    assert.notEqual(ta, tb, 'different trees');
    const ra: any = await callTool(a.ctx, 'repo.read', { path: 'src/a.txt' });
    assert.equal(ra.body, 'aaa', 'a room reads its own commit');
    const rb: any = await callTool(b.ctx, 'repo.read', { path: 'src/b.txt' });
    assert.equal(rb.body, 'bbb');
    const missing: any = await callTool(a.ctx, 'repo.read', { path: 'src/b.txt' }).catch((e) => e);
    assert.ok(missing instanceof Error, "a's tree never saw b's file");
  } finally {
    await removeRoomTree(a.ctx.room.key);
    await removeRoomTree(b.ctx.room.key);
    await a.cleanup(); await b.cleanup();
  }
});

test('the room lock serializes concurrent patches', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['repo.patch'] });
  const order: string[] = [];
  let p: Promise<unknown> = Promise.resolve();
  try {
    await withRoomLock(ctx.room.key, async () => {
      order.push('holder-in');
      p = callTool(ctx, 'repo.patch', { path: 'src/l.txt', body: 'x', branch: `w-l-${ctx.room.key}`, message: 'l' })
        .then(() => order.push('patch-done'));
      await new Promise((r) => setTimeout(r, 1500));
      assert.deepEqual(order, ['holder-in'], 'the patch waits while the lock is held');
      order.push('holder-out');
    });
    await p;
    assert.deepEqual(order, ['holder-in', 'holder-out', 'patch-done'], 'then it proceeds');
  } finally {
    await removeRoomTree(ctx.room.key);
    await cleanup();
  }
});

test('patch and test run with a timeout', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['repo.patch', 'repo.test'] });
  try {
    const r: any = await callTool(ctx, 'repo.test', { });
    assert.ok(typeof r.passed === 'boolean', 'the suite ran in the room tree');
    assert.ok((r.output ?? '').length > 0 || r.passed, 'output captured');
  } finally {
    await removeRoomTree(ctx.room.key);
    await cleanup();
  }
});

after(() => closeAll());
