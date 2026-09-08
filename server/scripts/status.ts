const base = process.env.ATRIUM_URL ?? 'http://localhost:8788';
const s: any = await (await fetch(`${base}/api/state`)).json();
for (const r of s.rooms) console.log(`[room] ${r.key.padEnd(12)} ${r.status.padEnd(7)} ${r.spent_cents}/${r.budget_cents}c`);
for (const a of s.agents) console.log(`${a.name.padEnd(6)} ${a.state.padEnd(18)} ${(a.spent_cents + 'c').padStart(4)}  ${a.activity.slice(0, 70)}`);
console.log('INBOX (dearest, then oldest):');
for (const i of s.inbox) console.log(`  ${i.room_key.padEnd(12)} ${i.blast_radius.padEnd(6)} ${(i.est_cost_cents + 'c').padStart(4)} ${String(i.action).slice(0, 60)} | ${JSON.stringify(i.touches)} | ${i.id}`);
console.log('global:', s.config.global_spent_cents + '/' + s.config.global_budget_cents + 'c', 'panic:', s.config.panic_stop);
