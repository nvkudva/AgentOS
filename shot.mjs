import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox','--disable-background-networking'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(process.argv[2], { waitUntil: 'load' });
await p.waitForTimeout(Number(process.argv[4] ?? 4000));
console.log('meter:', (await p.textContent('.meter'))?.trim());
await p.screenshot({ path: process.argv[3] });
await b.close();
