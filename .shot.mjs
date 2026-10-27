import { chromium } from 'playwright';

const B = 'http://localhost:5173';
const shot = async (page, name, clip) => {
  await page.screenshot({ path: `docs/${name}.png`, ...(clip ? { clip } : {}) });
  console.log('docs/' + name + '.png');
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

await page.goto(B, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  localStorage.setItem('atrium.theme', 'light');
  localStorage.setItem('atrium.orbSkin', 'well');
  localStorage.removeItem('atrium.desktop');
  localStorage.removeItem('atrium.seenRooms');
  localStorage.setItem('atrium.lastSeen', String(Date.now()));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.win', { timeout: 25000 });
await page.waitForTimeout(3000);

// 1. the desk, with two rooms parked on the left rail
await page.evaluate(async () => {
  const tick = (n) => new Promise((r) => setTimeout(r, n));
  const park = async (title) => {
    const win = [...document.querySelectorAll('.win')].find((w) => w.textContent.includes(title));
    if (!win) return;
    const bar = win.querySelector('.win-bar');
    const r = win.getBoundingClientRect();
    const sx = r.left + 60, sy = r.top + 12;
    bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: sx, clientY: sy, pointerId: 1, isPrimary: true, buttons: 1 }));
    const mv = (x, y) => dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, buttons: 1 }));
    mv(sx + 20, sy + 20); await tick(40);
    for (let i = 0; i < 4; i++) { mv(4, 150 + i); await tick(60); }
    dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 4, clientY: 153, pointerId: 1, buttons: 0 }));
    await tick(200);
  };
  await park('Research');
  await park('Support');
});
await page.mouse.move(700, 500);
await page.waitForTimeout(900);
await shot(page, 'desktop');

// 2. the supervisor, mid-conversation
await page.keyboard.press('Meta+k');
await page.waitForTimeout(400);
await page.keyboard.type('run analytics on last quarter churn');
await page.waitForTimeout(500);
await shot(page, 'orb', { x: 900, y: 0, width: 540, height: 420 });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 3. the approvals queue
await page.keyboard.press('Meta+\\');
await page.waitForTimeout(900);
await shot(page, 'approvals', { x: 940, y: 0, width: 500, height: 900 });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 4. Overview
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.dock .tile')].find((b) => b.dataset.label === 'Overview');
  t?.click();
});
await page.waitForTimeout(1600);
await shot(page, 'overview');

// 5. a room console, with its summary box
await page.evaluate(() => {
  const card = [...document.querySelectorAll('.floor .room')].find((c) => c.textContent.includes('Analytics'));
  card?.click();
});
await page.waitForTimeout(1800);
await shot(page, 'room');

await browser.close();
