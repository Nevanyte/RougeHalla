#!/usr/bin/env node
// Real-browser capture loop for the world indicators (overhead cluster, statuses, hit zones, marks). Joins a match as a diagnostic
// player, then walks the minimap targets in turn while swinging at the cursor, and writes a full-frame PNG every interval.
//   node indicator-shots.cjs --w 1920 --h 1080 --frames 30 --interval 2500 --faction 3 --out /tmp/raw --tag f3 [--hitzone-demo]
// RH_SHOTS_URL (default http://127.0.0.1:8237/) and RH_SHOTS_WS (default ws://127.0.0.1:7937/ws) point at the served build and server.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'));
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 && a[i + 1] && !a[i + 1].startsWith('--') ? a[i + 1] : d; };
const W = +opt('w', 1920), H = +opt('h', 1080), frames = +opt('frames', 30), interval = +opt('interval', 2500), faction = opt('faction', '3');
const out = opt('out', path.join(os.tmpdir(), 'ind-raw')), tag = opt('tag', 'f' + faction), demo = a.includes('--hitzone-demo');
const base = process.env.RH_SHOTS_URL || 'http://127.0.0.1:8237/', ws = process.env.RH_SHOTS_WS || 'ws://127.0.0.1:7937/ws';
const legacyScale = (w, h) => { const sw = w / h <= 21 / 9 ? w : Math.floor(h * 21 / 9); return Math.min(1.5, Math.max(0.8, Math.min(sw / 1280, h / 800))); };
const s = legacyScale(W, H);
function minimapRect() {
  const uiW = Math.floor(W / s), uiH = Math.floor(H / s);
  const wanted = Math.min(312, Math.max(195, Math.round(uiH * 0.338))), room = Math.floor(uiW / 2 - 12 - 152);
  const size = Math.round(Math.min(Math.min(wanted, Math.max(110, room)), uiW * 0.42, uiH * 0.6));
  return { x: W - (12 + size) * s, y: H - (12 + size) * s, size: size * s };
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push('pageerror ' + e.message));
  const profile = ('ind' + faction + Math.random().toString(36).slice(2, 6)).slice(0, 16);
  const url = `${base}?server=${encodeURIComponent(ws)}&profile=${profile}&faction=${faction}&diagnostic=1&token=t1&fx.quality=high${demo ? '&hitzone.demo=1&indicators.demo=1' : ''}`;
  await page.goto(url, { waitUntil: 'load' }); await page.waitForSelector('canvas', { timeout: 90000 }); await page.waitForTimeout(14000);
  await page.keyboard.press('1'); await page.waitForTimeout(600);
  const uiW = W / s, uiH = H / s;
  const pSide = Math.min(780, Math.max(260, Math.floor(Math.min(uiH - 44 - 12 - 124, uiW - 340 - 24 - 12 - 8))));
  const pFrame = pSide + 8, pTotal = pFrame + 12 + 340, pColH = 40 + 12 + pFrame + 12 + 52;
  const pBx = Math.floor((uiW - pTotal) / 2), pBy = Math.max(44, Math.floor((uiH - pColH) / 2 + 11));
  await page.mouse.click((pBx + pFrame + 12 + 12 + 158) * s, (pBy + 12 + 23) * s, { delay: 80 });
  await page.waitForTimeout(12000);
  const mm = minimapRect(); const targets = [[.5, .5], [.3, .3], [.7, .3], [.3, .7], [.7, .7], [.5, .25], [.5, .75], [.25, .5], [.75, .5]];
  for (let i = 0; i < frames; i++) {
    const t = targets[Math.floor(i / 3) % targets.length];
    if (i % 3 === 0) await page.mouse.click(mm.x + mm.size * t[0], mm.y + mm.size * t[1], { button: 'right', delay: 40 });
    // swing around the character (the camera keeps it at the centre)
    const ang = i * 1.3;
    // burst: screenshot right after a swing so the (0.3 s) hit zone is in frame
    for (let k = 0; k < 2; k++) { await page.mouse.click(W / 2 + 150 * Math.cos(ang + k), H / 2 + 110 * Math.sin(ang + k), { delay: 30 }); await page.screenshot({ path: path.join(out, `${tag}-${W}x${H}-${String(i).padStart(3, '0')}-b${k}.png`) }); }
    await page.waitForTimeout(interval);
    await page.screenshot({ path: path.join(out, `${tag}-${W}x${H}-${String(i).padStart(3, '0')}.png`) });
  }
  fs.writeFileSync(path.join(out, `${tag}-${W}x${H}-console.txt`), errors.join('\n'));
  console.log('errors', errors.length); errors.slice(0, 5).forEach(e => console.log(' ', e.slice(0, 200)));
  await browser.close();
})();
