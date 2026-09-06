const base = 'http://localhost:8787';
const s: any = await (await fetch(`${base}/api/state`)).json();
const want = process.argv.slice(2);
for (const a of s.agents) {
  if (want.length && !want.includes(a.name)) continue;
  const r = await fetch(`${base}/api/agents/${a.id}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  console.log(a.name, (await r.json()).run_id ?? '-');
}
