import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { handle, snapshot } from './api.js';
import { bus } from './bus.js';
import { startScheduler } from './runtime/scheduler.js';
import { ensureManagers } from './provision.js';

const PORT = Number(process.env.PORT ?? 8788);
const WEB_DIST = path.resolve(process.cwd(), '../web/dist');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  if (url.pathname === '/api/stream') {
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
      const out = await handle({ method: req.method ?? 'GET', path: url.pathname, body, query: url.searchParams });
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
startScheduler();
