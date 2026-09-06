import { pool, closeAll } from '../src/db.js';

const med = (xs: number[]) => xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN;
const fmt = (n: number) => (Number.isNaN(n) ? '—' : `${(n / 1000).toFixed(2)}s`);

const rows = (await pool.query(`SELECT view, action, payload, ts FROM observation_log ORDER BY ts`)).rows;

console.log(`\nAtrium — thesis report   (${rows.length} observations)\n`);

for (const view of ['floor', 'list']) {
  const glances = rows.filter((r) => r.view === view && r.action === 'glance');
  const decisions = rows.filter((r) => r.view === view && r.action.startsWith('inbox.'));
  const opens = rows.filter((r) => r.view === view && r.action === 'room.open');
  const correct = glances.filter((g) => g.payload.correct).length;
  console.log(`${view.toUpperCase()}`);
  console.log(`  glance test      n=${glances.length}  median ${fmt(med(glances.map((g) => g.payload.ms)))}` +
              `  correct ${glances.length ? Math.round((correct / glances.length) * 100) : 0}%`);
  console.log(`  inbox decisions  n=${decisions.length}  median wait ${fmt(med(decisions.map((d) => d.payload.waited_ms ?? NaN)))}`);
  console.log(`  rooms opened     n=${opens.length}`);
  console.log(`  time in view     ${rows.filter((r) => r.view === view && r.action === 'view.enter').length} entries\n`);
}

const g = (v: string) => med(rows.filter((r) => r.view === v && r.action === 'glance').map((r) => r.payload.ms));
const [f, l] = [g('floor'), g('list')];
console.log('KILL CRITERION 1 — floor must be >=2x faster on the glance test');
if (Number.isNaN(f) || Number.isNaN(l)) console.log('  not enough data yet: run the glance test in BOTH views.\n');
else console.log(`  floor ${fmt(f)} vs list ${fmt(l)}  →  ${(l / f).toFixed(2)}x  →  ${l / f >= 2 ? 'PASS' : 'FAIL'}\n`);

await closeAll();
