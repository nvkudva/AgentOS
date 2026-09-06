const base = process.env.ATRIUM_URL ?? 'http://localhost:8787';
const decision = process.argv[2] === 'reject' ? 'reject' : 'approve';
const s: any = await (await fetch(`${base}/api/state`)).json();
for (const it of s.inbox) {
  const r: any = await (await fetch(`${base}/api/approvals/${it.id}/decide`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision, note: `${decision}d from the terminal` }),
  })).json();
  console.log(String(it.room_key).padEnd(12), String(it.action).slice(0, 54).padEnd(56),
              r.approved === true ? '→ approved' : r.approved === false ? '→ rejected' : `→ ${JSON.stringify(r)}`);
}
if (!s.inbox.length) console.log('nothing waiting');
