import { test, after } from 'node:test';
import assert from 'node:assert';
import { provisionRoom, validate, catalog } from '../src/provision.js';
import { callTool } from '../src/runtime/toolbelt.js';
import { ScopeViolation } from '../src/errors.js';
import { pool, rolePool, closeAll, q, one } from '../src/db.js';
import { id } from '../src/ids.js';
import type { Ctx } from '../src/runtime/types.js';

/**
 * Milestone 8: a room is data.
 *
 * If adding a function to the company ever needs a code change, "room" was never the
 * unit of the system — it was five hard-coded panels in a costume. These tests create a
 * brand new room the way the New room form does and hold it to exactly the same rules
 * as the rooms that shipped.
 */

const KEY = `legal_${Math.random().toString(16).slice(2, 8)}`;

async function ctxFor(roomKey: string): Promise<Ctx> {
  const room = await one<any>('SELECT * FROM room WHERE key=$1', [roomKey]);
  const agent = await one<any>('SELECT * FROM agent WHERE room_id=$1 LIMIT 1', [room.id]);
  const runId = id('run');
  await q(`INSERT INTO run (id, agent_id, room_id, goal) VALUES ($1,$2,$3,'test')`, [runId, agent.id, room.id]);
  await q(`UPDATE agent SET current_run_id=$2, state='working' WHERE id=$1`, [agent.id, runId]);
  return { room, agent, run: await one<any>('SELECT * FROM run WHERE id=$1', [runId]), say: async () => {} };
}

test('a room created at runtime is a real room', async () => {
  const room = await provisionRoom({
    key: KEY, name: 'Legal', objective: 'Review contracts before they are signed',
    color: '#8a8f98', icon: '⚖', budget_cents: 120, access: 'none',
    tools: ['artifact.read', 'artifact.write', 'escalate'],
    agents: [{ name: 'Lex', role: 'counsel', policy: 'strategy.synth', avatar: '⚖',
               color: '#8a8f98', persona: 'Reads the whole thing. Twice.' }],
  });
  assert.ok(room, 'the room exists');
  assert.strictEqual((room as any).key, KEY);
  const agents = await q('SELECT * FROM agent WHERE room_id=$1', [(room as any).id]);
  assert.strictEqual(agents.length, 1, 'its agent was created with it');
  const role = await q(`SELECT 1 FROM pg_roles WHERE rolname=$1`, [`atrium_${KEY}`]);
  assert.strictEqual(role.length, 1, 'it got its own database account');
});

test('the new room is scoped exactly like the ones that shipped', async () => {
  const ctx = await ctxFor(KEY);
  // granted
  const wrote = await callTool(ctx, 'artifact.write', { title: 'Contract review', body: 'ok' });
  assert.ok(wrote.id, 'it can use what it was granted');
  // not granted
  await assert.rejects(() => callTool(ctx, 'sql.query', { sql: 'SELECT 1' }), ScopeViolation,
    'and is refused what it was not');
  const [v] = await q(`SELECT 1 FROM event WHERE room_id=$1 AND type='scope.violation'`, [ctx.room.id]);
  assert.ok(v, 'the refusal is logged like any other');
});

test('"no company data" means the database itself says no', async () => {
  const p = rolePool(`atrium_${KEY}`);
  await assert.rejects(() => p.query('SELECT * FROM bizdata.orders LIMIT 1'), /permission denied|does not exist/i);
  await assert.rejects(() => p.query('SELECT * FROM support.ticket LIMIT 1'), /permission denied|does not exist/i);
});

test('a room with the support profile gets that access and no more', async () => {
  const p = rolePool('atrium_support');
  const r = await p.query('SELECT count(*)::int n FROM support.ticket');
  assert.ok(r.rows[0].n > 0, 'it can read the tickets it is meant to answer');
  await assert.rejects(() => p.query(`UPDATE bizdata.pipeline SET note='x'`), /permission denied/i,
    'and cannot touch the sales room\'s data');
});

test('the creator refuses a room that would not make sense', () => {
  const base = { name: 'X', objective: 'y', color: '#fff', icon: '◍', budget_cents: 10,
                 access: 'none' as const, tools: [], agents: [] };
  assert.ok(validate({ ...base, key: 'Bad Key' } as any).some((m) => m.includes('key')));
  assert.ok(validate({ ...base, key: 'ok', tools: ['not.a.tool'] } as any).some((m) => m.includes('unknown tool')));
  assert.ok(validate({ ...base, key: 'ok' } as any).some((m) => m.includes('at least one agent')));
  assert.ok(validate({ ...base, key: 'ok', budget_cents: 0,
                       agents: [{ name: 'A', role: 'r', policy: 'strategy.synth', persona: '', color: '#fff', avatar: '🙂' }] } as any)
    .some((m) => m.includes('budget')));
});

test('the catalog offers real tools, real access profiles and real jobs', () => {
  const c = catalog();
  assert.ok(c.tools.length >= 10 && c.tools.every((t) => t.label && t.blast));
  assert.ok(c.access.length >= 3 && c.access.every((a) => a.label && a.note));
  assert.ok(c.jobs.length >= 5 && c.jobs.every((j) => j.goal));
});

after(async () => {
  await pool.query('DELETE FROM room WHERE key=$1', [KEY]).catch(() => {});
  await pool.query(`REVOKE ALL ON DATABASE atrium FROM atrium_${KEY}`).catch(() => {});
  await pool.query(`DROP ROLE IF EXISTS atrium_${KEY}`).catch(() => {});
  await closeAll();
});

test('a room cannot hire for work it is not equipped to do', async () => {
  const problems = validate({
    key: 'paralegal', name: 'Paralegal', objective: 'x', color: '#fff', icon: '◍',
    budget_cents: 100, access: 'none',
    tools: ['artifact.write'],                       // no sql.query, no artifact.read
    agents: [{ name: 'Pat', role: 'analyst', policy: 'research.brief',
               persona: '', color: '#fff', avatar: '🙂' }],
  } as any);
  assert.ok(problems.some((p) => p.includes('the room also needs')),
    'the gap is named before the room exists, not logged as a violation after');
});
