// Walks every V3 voice command through the real desktop (typed into the orb, the same
// path a transcript takes) and prints what the screen did. Needs `npm -w web run dev`.
// Usage: node scripts/voice-e2e.mjs [baseUrl]
//        node scripts/voice-e2e.mjs --audio <wav>   (real mic path: wake word + Whisper, wav loops as the mic)
//        e.g. say -o /tmp/wake.wav --data-format=LEI16@16000 "[[slnc 1500]] Hey Atrium, open music. [[slnc 3000]]"
import { chromium } from 'playwright';

const audioAt = process.argv.indexOf('--audio');
const wav = audioAt > 0 ? process.argv[audioAt + 1] : null;
const BASE = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:5173';
const mic = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
if (wav) mic.push(`--use-file-for-fake-audio-capture=${wav}`);
const browser = await chromium.launch({ channel: 'chrome', args: mic });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|\/api\/|onnxruntime/.test(m.text())) errors.push(m.text()); });

await page.goto(BASE);
await page.evaluate(() => { localStorage.clear(); });
await page.reload();
await page.waitForSelector('.win', { timeout: 30000 });
await page.waitForTimeout(1500);

const state = () => page.evaluate(() => ({
  wins: [...document.querySelectorAll('.win[data-win]')]
    .filter((w) => !w.classList.contains('parked') && getComputedStyle(w).display !== 'none' && !w.classList.contains('min'))
    .map((w) => w.getAttribute('data-win')),
  sidebar: !!document.querySelector('.slideover.on'),
  orb: document.querySelector('.orb-btn')?.className ?? '',
  reply: [...document.querySelectorAll('.sup-turn.orb')].at(-1)?.textContent ?? '',
  prop: document.querySelector('.sup-prop b')?.textContent ?? null,
  pending: [...document.querySelectorAll('.slideover .undo, .slideover [class*="pending"], .slideover .decided')].map((e) => e.textContent.trim()).slice(0, 2),
}));

async function say(text) {
  if (!(await page.$('.sup-input'))) {
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.sup-input', { timeout: 3000 });
  }
  await page.fill('.sup-input', text);
  await page.press('.sup-input', 'Enter');
  await page.waitForTimeout(450);
  return state();
}

if (wav) {
  await page.evaluate(() => localStorage.setItem('atrium.wakeWord', '1'));
  await page.reload();
  await page.waitForSelector('.win', { timeout: 30000 });
  await page.mouse.click(700, 860);
  const started = Date.now();
  const opened = await page.waitForFunction(() => !!document.querySelector('.win[data-win="music"]'), null, { timeout: 180000 })
    .then(() => true, () => false);
  const turns = await page.evaluate(() => [...document.querySelectorAll('.sup-turn')].map((t) => t.textContent));
  console.log(`${opened ? 'PASS' : 'FAIL'}  wake word + Whisper opened music in ${Math.round((Date.now() - started) / 1000)}s\n      turns=${JSON.stringify(turns)}`);
  if (errors.length) console.log('page errors:\n  ' + [...new Set(errors)].join('\n  '));
  await browser.close();
  process.exit(opened ? 0 : 1);
}

const results = [];
async function check(text, expect) {
  const s = await say(text);
  const ok = expect(s);
  results.push({ ok, text, reply: s.reply, wins: s.wins.join(','), sidebar: s.sidebar, prop: s.prop, pending: s.pending.join(' | ') });
}

await check("what's going on with the engineering team", (s) => /Engineering/.test(s.reply) && !s.prop);
await check('what is the latest update', (s) => /waiting|blocked|working/.test(s.reply) && !s.prop);
await check('open sales team dashboard', (s) => s.wins.some((w) => /^room:/.test(w)));
await check('open music', (s) => s.wins.includes('music'));
await check('close music', (s) => !s.wins.includes('music') && !s.prop);
await check('open maps', (s) => s.wins.includes('maps'));
await check('close this', (s) => !s.wins.includes('maps') && s.wins.some((w) => /^room:/.test(w)));
await check('tell engineering to fix the failing pricing test', (s) => s.prop !== null);
await check('what needs me', (s) => s.prop === null && /waiting/.test(s.reply));
await check('approve this', (s) => /Say yes/.test(s.reply) && s.sidebar);
await check('yes', (s) => /Approved/.test(s.reply));
await check('undo', (s) => /Undone/.test(s.reply));
await check('decline', (s) => /Say yes/.test(s.reply));
await check('no', (s) => /Left it/.test(s.reply));
await check('stop', (s) => /Stopped/.test(s.reply));
await check('open overview', (s) => s.wins.includes('floor'));
await check('close all', (s) => s.wins.length === 0);
await check('turn on wake word', (s) => /Wake word on/.test(s.reply));
await page.waitForTimeout(1500);
results.push({ ok: (await state()).orb.includes('armed'), text: '(orb shows armed ring)', reply: (await state()).orb, wins: '', pending: '' });
await check('turn off wake word', (s) => /Wake word off/.test(s.reply));
await check('help', (s) => s.reply.length > 20);

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.text}\n      reply="${r.reply}" wins=[${r.wins}] sidebar=${r.sidebar} prop=${r.prop} ${r.pending}`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
if (errors.length) console.log('page errors:\n  ' + [...new Set(errors)].join('\n  '));
await browser.close();
process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
