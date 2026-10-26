import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { handle, snapshot } from './api.js';
import { bus } from './bus.js';
import { startScheduler } from './runtime/scheduler.js';
import { ensurePolicies } from './provision.js';
import { ensureOperatorToken, resolveAuth } from './auth.js';
import { ensureManagers, ensurePolicies } from './provision.js';

const PORT = Number(process.env.PORT ?? 8788);
const WEB_DIST = path.resolve(process.cwd(), '../web/dist');

// CORS is an allowlist, not '*'. Empty (the default) means same-origin only —
// the desk served from this server needs no CORS headers at all.
const CORS = (process.env.ATRIUM_CORS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const origin = req.headers.origin;
  if (origin && CORS.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'content-type, x-atrium-token');
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  // Tokens ride the query string (EventSource cannot set headers) or a header.
  const raw = url.searchParams.get('token') ?? req.headers['x-atrium-token'] ?? null;
  const token = Array.isArray(raw) ? raw[0] : (raw as string | null);

  if (url.pathname === '/api/stream') {
    // The stream carries every room's args and customer data: operator token only.
    const auth = await resolveAuth(token).catch(() => ({ scope: 'none' as const }));
    if (auth.scope !== 'operator') return res.writeHead(401).end();
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (m: any) => res.write(`data: ${JSON.stringify(m)}\n\n`);
    send({ type: 'snapshot', ...(await snapshot()) });
    const off = bus.subscribe(send);
    const hb = setInterval(() => res.write(': hb\n\n'), 15000);
    req.on('close', () => { off(); clearInterval(hb); });
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    let body: any = {};
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { body = {}; }
    }
    try {
      const out = await handle({
        method: req.method ?? 'GET', path: url.pathname, body, query: url.searchParams, token,
      });
      const status = out?.status ?? 200;
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    } catch (e: any) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  // static (production build); in dev, vite serves the UI and proxies /api
  try {
    const file = url.pathname === '/' || !path.extname(url.pathname) ? 'index.html' : url.pathname.slice(1);
    const buf = await readFile(path.join(WEB_DIST, file));
    const ct = ({ '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2',
                  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
                  '.ico': 'image/x-icon' } as Record<string, string>)[path.extname(file)] ?? 'text/html';
    res.writeHead(200, { 'content-type': ct }).end(buf);
  } catch {
    res.writeHead(404).end('not built — run `npm -w web run dev`');
  }
});

server.listen(PORT, () => console.log(`[atrium] http://localhost:${PORT}`));
ensureManagers().catch((e) => console.error('[managers]', e));
ensurePolicies().catch((e) => console.error('[policies]', e));
ensureOperatorToken().then((s) => {
  if (s) console.log(`[atrium] OPERATOR TOKEN (keep it; shown once): ${s}`);
}).catch((e) => console.error('[auth]', e));
startScheduler();
