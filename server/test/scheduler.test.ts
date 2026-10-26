import { test, after } from 'node:test';
import assert from 'node:assert';
import { claimLeases, releaseLeases, step } from '../src/runtime/scheduler.js';
import { closeAll, q, one } from '../src/db.js';
import { makeRoom } from './helpers.js';

/**
 * A2: two schedulers racing over the same agents step each agent exactly once.
 * Claims are disjoint, and a step without the lease is a no-op (fencing).
 */

test('concurrent claims are disjoint and cover every steppable agent', async () => {
  const a = await makeRoom({ grants: ['artifact.write'] });
  const b = await makeRoom({ grants: ['artifact.write'] });
  try {
    const [c1, c2] = await Promise.all([claimLeases('sched-1'), claimLeases('sched-2')]);
    const ids1 = new Set(c1.map((x) => x.id));
    const overlap = c2.filter((x) => ids1.has(x.id));
    assert.equal(overlap.length, 0, 'no agent claimed twice');
    assert.ok(ids1.has(a.ctx.agent.id) || c2.some((x) => x.id === a.ctx.agent.id), 'a claimed');
    assert.ok(ids1.has(b.ctx.agent.id) || c2.some((x) => x.id === b.ctx.agent.id), 'b claimed');
    // A third scheduler finds nothing while leases are held.
    const c3 = await claimLeases('sched-3');
    assert.ok(!c3.some((x) => x.id === a.ctx.agent.id || x.id === b.ctx.agent.id), 'held leases are not re-claimed');
  } finally {
    await releaseLeases('sched-1'); await releaseLeases('sched-2'); await releaseLeases('sched-3');
    await a.cleanup(); await b.cleanup();
  }
});

test('a step without the lease does nothing; with it, steps exactly once', async () => {
  const { ctx, cleanup } = await makeRoom({ grants: ['artifact.write'] });
  try {
    await claimLeases('sched-1');
    const before = await one<any>('SELECT steps_used FROM agent WHERE id=$1', [ctx.agent.id]);
    const stolen = await step({ ...ctx.agent } as any, 'sched-2');
    assert.equal(stolen, 'stolen', 'wrong owner refuses');
    const afterSteal = await one<any>('SELECT steps_used FROM agent WHERE id=$1', [ctx.agent.id]);
    assert.equal(afterSteal.steps_used, before.steps_used, 'no double-step');
    // The lease holder steps (analytics.weekly runs real queries against seeded bizdata).
    await step({ ...ctx.agent } as any, 'sched-1');
    const after = await one<any>('SELECT steps_used, activity FROM agent WHERE id=$1', [ctx.agent.id]);
    assert.equal(after.steps_used, before.steps_used + 1, 'exactly one step');
    assert.ok(after.activity.length > 0, 'the policy said something');
  } finally {
    await releaseLeases('sched-1');
    await cleanup();
  }
});

after(() => closeAll());
