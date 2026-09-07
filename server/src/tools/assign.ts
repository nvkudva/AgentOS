import { q, one } from '../db.js';
import { id } from '../ids.js';
import { bus } from '../bus.js';
import { startAgent } from '../runtime/scheduler.js';
import type { ToolSpec } from '../runtime/types.js';

/**
 * The manager tier's whole toolbox: hand work down, and hand the result back up.
 * Neither touches the outside world — a manager that could call a real tool would
 * be a worker with a better title.
 */

/**
 * Starts every queued task it can. Fewer workers than tasks means the rest wait
 * their turn by `ord` — one active task per worker, so a room never pretends to
 * more parallelism than it has crew for.
 */
export async function pump(mandateId: string, roomId: string) {
  // A task's state is its run's state; reconcile before deciding who is free, so a
  // run that ended while nobody was looking cannot strand its task in 'working'.
  await q(`UPDATE task t SET state=r.status FROM run r
            WHERE r.id=t.run_id AND t.mandate_id=$1 AND t.state='working'
              AND r.status IN ('done','failed','killed')`, [mandateId]);
  const workers = await q<any>(
    `SELECT * FROM agent WHERE room_id=$1 AND tier='worker' AND state='idle' ORDER BY name`, [roomId]);
  if (!workers.length) return 0;
  const queued = await q<any>(
    `SELECT * FROM task WHERE mandate_id=$1 AND state='queued' ORDER BY ord`, [mandateId]);
  let started = 0;
  for (const t of queued) {
    // a task keeps its preferred owner if that owner is free, otherwise the next hand up
    const w = workers.find((x) => x.id === t.agent_id) ?? workers[0];
    if (!w) break;
    workers.splice(workers.indexOf(w), 1);
    await q(`UPDATE task SET agent_id=$2 WHERE id=$1`, [t.id, w.id]);
    await startAgent(w.id, t.title, { mandate_id: mandateId, task_id: t.id });
    started++;
  }
  if (started) bus.publish({ type: 'refresh' });
  return started;
}

export const assign: ToolSpec = {
  name: 'assign',
  blast: 'low', reversible: true, external: false,
  summary: (a) => `assign ${(a.titles ?? []).length} tasks to this room's crew`,
  touches: () => ['this room’s crew'],
  estimate: () => 0,
  async run(ctx, args) {
    const mandateId: string | null = args.mandate_id ?? null;
    const titles: string[] = (args.titles ?? []).filter((t: any) => typeof t === 'string' && t.trim());
    if (!mandateId || !titles.length) return { tasks: [] };

    const workers = await q<any>(
      `SELECT * FROM agent WHERE room_id=$1 AND tier='worker' AND state NOT IN ('killed','failed')
        ORDER BY name`, [ctx.room.id]);
    const made: any[] = [];
    for (let i = 0; i < titles.length; i++) {
      const tid = id('task');
      const pref = workers.length ? workers[i % workers.length].id : null;
      await q(`INSERT INTO task (id, mandate_id, agent_id, title, ord) VALUES ($1,$2,$3,$4,$5)`,
        [tid, mandateId, pref, titles[i], i]);
      made.push({ id: tid, title: titles[i], agent_id: pref, ord: i });
    }
    await q(`UPDATE mandate SET state='working' WHERE id=$1`, [mandateId]);
    const started = await pump(mandateId, ctx.room.id);
    return { tasks: made, started };
  },
};

export const report: ToolSpec = {
  name: 'report',
  blast: 'low', reversible: true, external: false,
  summary: () => 'report back on the mandate',
  touches: () => ['the mandate you gave'],
  estimate: () => 0,
  async run(ctx, args) {
    const mandateId: string | null = args.mandate_id ?? null;
    if (!mandateId) return { reported: false };

    const tasks = await q<any>(
      `SELECT t.* FROM task t JOIN agent a ON a.id=t.agent_id
        WHERE t.mandate_id=$1 AND a.room_id=$2 ORDER BY t.ord`, [mandateId, ctx.room.id]);
    const done = tasks.filter((t) => t.state === 'done');
    const bad = tasks.filter((t) => t.state === 'failed' || t.state === 'killed');
    const art = await one<any>(
      `SELECT a.id, a.title FROM artifact a JOIN run r ON r.id=a.run_id
        WHERE r.mandate_id=$1 ORDER BY a.created_at DESC LIMIT 1`, [mandateId]);
    const spent = await one<any>(
      `SELECT coalesce(sum(r.spent_cents),0)::int AS cents FROM run r WHERE r.mandate_id=$1`, [mandateId]);

    // Two lines. The first says what happened, the second says what you now have.
    const first = bad.length
      ? `${ctx.room.name} finished ${done.length} of ${tasks.length} tasks; ${bad.length} did not land.`
      : `${ctx.room.name} finished all ${tasks.length} tasks.`;
    const second = art
      ? `You have “${art.title}” in ${ctx.room.name}${bad.length ? `, minus what failed` : ''}.`
      : `Nothing was written up${bad.length ? ' — the work stopped short' : ''}.`;

    await q(
      `UPDATE mandate SET state=$2, report=$3, artifact_id=$4, spent_cents=$5 WHERE id=$1`,
      [mandateId, bad.length ? 'blocked' : 'done', `${first}\n${second}`, art?.id ?? null, spent?.cents ?? 0]);
    bus.publish({ type: 'refresh' });
    return { report: `${first}\n${second}`, artifact_id: art?.id ?? null };
  },
};
