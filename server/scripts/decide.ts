const base = 'http://localhost:8787';
const [aid, decision, ...note] = process.argv.slice(2);
const r = await fetch(`${base}/api/approvals/${aid}/decide`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ decision, note: note.join(' ') || null }),
});
console.log(await r.json());
