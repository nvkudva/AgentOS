import { pool, closeAll } from '../src/db.js';
import { fold, diff } from '../src/replay.js';

const verifyOnly = process.argv.includes('--verify');
const d = await diff();
if (verifyOnly) {
  console.log(d.length ? '✗ replay disagrees with live state:\n' + d.join('\n') : '✓ replay matches live state exactly');
  await closeAll();
  process.exit(d.length ? 1 : 0);
}
const p = await fold();
for (const [id, a] of Object.entries(p.agents))
  await pool.query(`UPDATE agent SET state=$2, activity=$3, spent_cents=$4, current_run_id=$5 WHERE id=$1`,
    [id, a.state, a.activity, a.spent_cents, a.current_run_id]);
for (const [id, r] of Object.entries(p.rooms))
  await pool.query(`UPDATE room SET spent_cents=$2, status=$3 WHERE id=$1`, [id, r.spent_cents, r.status]);
for (const [id, r] of Object.entries(p.runs))
  await pool.query(`UPDATE run SET status=$2, spent_cents=$3, kill_reason=$4 WHERE id=$1`, [id, r.status, r.spent_cents, r.kill_reason]);
await pool.query(`UPDATE global_config SET global_spent_cents=$1, panic_stop=$2 WHERE id=1`, [p.global.spent_cents, p.global.panic_stop]);
console.log(`rebuilt ${Object.keys(p.agents).length} agents, ${Object.keys(p.rooms).length} rooms, ${Object.keys(p.runs).length} runs from the event log`);
await closeAll();
