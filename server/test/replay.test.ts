import { test, after } from 'node:test';
import assert from 'node:assert';
import { closeAll, q } from '../src/db.js';
import { diff } from '../src/replay.js';

/**
 * R1: every agent action is logged and replayable. If this fails, the projections
 * have drifted from the log and the log has stopped being the source of truth.
 */
test('folding the event log reproduces live state exactly', async () => {
  const n = (await q(`SELECT count(*)::int c FROM event`))[0].c;
  assert.ok(n > 0, 'there are events to replay');
  const d = await diff();
  assert.deepStrictEqual(d, [], d.join('\n'));
});

test('the event log is append-only in practice', async () => {
  const [{ c }] = await q<any>(`SELECT count(*)::int c FROM event`);
  const [{ mx }] = await q<any>(`SELECT max(id)::int mx FROM event`);
  assert.ok(mx >= c, 'ids only ever move forward');
});

after(() => closeAll());
