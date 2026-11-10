#!/usr/bin/env node
// Real-browser evidence for the fog of war and the graceful exit/entry of actors (Unity Web player).
//
//   node client-unity/UnityProject/Tools/vision-shots.cjs --out docs/rework/evidence/vision --tag frost --faction 3 [--seconds 150] [--route "0.62,0.80;0.5,0.5"] [--debugRadius 9] [--fadeDemo] [--still] [--spawn 1|2] [--headless]
//
// Needs the Rust server and the served Web build (RH_SHOTS_URL default http://127.0.0.1:8167/, RH_SHOTS_WS default ws://127.0.0.1:7867/ws).
// It joins a match (planning: first spawn, Ready), walks the player around with the keyboard, takes still shots of the fog (world,
// minimap, Tab map), and records a CDP screencast ring. The client logs [vision-depart] / [vision-arrive] lines (url flag
// vision.audit=1); each one saves the frames from 400 ms before to 500 ms after it, about every 50 ms, plus a contact sheet. The
// periodic [vision-audit] line carries the agreement counters (delivered actors under client fog, covered actors, departures).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'));

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback; };
const repo = path.resolve(__dirname, '../../..');
const outDir = path.resolve(repo, opt('out', 'docs/rework/evidence/vision'));
const tag = opt('tag', 'frost');
const faction = opt('faction', '3');
const debugRadius = opt('debugRadius', '');
const seconds = Number(opt('seconds', '150'));
const route = opt('route', '').split(';').filter(Boolean).map(t => t.split(',').map(Number)); // map fractions (x,y) walked to by right-click on the Tab map
const W = Number(opt('w', '1600')), H = Number(opt('h', '900'));
const baseUrl = process.env.RH_SHOTS_URL || 'http://127.0.0.1:8167/';
const wsUrl = process.env.RH_SHOTS_WS || 'ws://127.0.0.1:7867/ws';

function legacyScale(w, h) {
  const stageW = w / h <= 21 / 9 ? w : Math.floor(h * 21 / 9);
  return Math.min(1.5, Math.max(0.8, Math.min(stageW / 1280, h / 800)));
}
function tabMapRect(w, h, s) {
  const uiW = w / s, uiH = h / s, col = 250, fixedH = 34 + 12 + 12 + 30 + 8;
  const side = Math.min(820, Math.max(240, Math.floor(Math.min(uiH - 44 - 12 - fixedH, uiW - 24 - col * 2 - 24 - 8))));
  const frameW = side + 8, totalW = col * 2 + 24 + frameW, colH = 34 + 12 + frameW + 12 + 30;
  const bx = Math.floor((uiW - totalW) / 2), by = Math.max(44, Math.floor(44 + (uiH - 44 - 12 - colH) / 2));
  return { x: (bx + col + 12 + 4) * s, y: (by + 34 + 12 + 4) * s, size: side * s };
}
function minimapRect(w, h, s) {
  const uiW = Math.floor(w / s), uiH = Math.floor(h / s);
  const wanted = Math.min(312, Math.max(195, Math.round(uiH * 0.338)));
  const room = Math.floor(uiW / 2 - 12 - 152);
  const size = Math.round(Math.min(Math.min(wanted, Math.max(110, room)), uiW * 0.42, uiH * 0.6));
  return { x: w - (12 + size) * s, y: h - (12 + size) * s, size: size * s };
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: args.includes('--headless'), args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [], logs = [], events = [];
  const ring = [];
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', async f => {
    ring.push({ t: f.metadata.timestamp * 1000, data: f.data });
    while (ring.length && ring[0].t < Date.now() - 15000) ring.shift();
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (_) {}
  });
  page.on('console', m => {
    const t = m.text(); logs.push(`${Date.now()} [${m.type()}] ${t}`);
    if (m.type() === 'error') errors.push(t);
    if (t.startsWith('[vision-depart]') || t.startsWith('[vision-arrive]')) events.push({ at: Date.now(), text: t, kind: t.startsWith('[vision-depart]') ? 'leave' : 'enter' });
  });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const profile = `vis${tag.replace(/[^A-Za-z0-9]/g, '').slice(0, 5)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 16);
  const url = `${baseUrl}?server=${encodeURIComponent(wsUrl)}&profile=${profile}&faction=${faction}&diagnostic=1&token=t1&vision.audit=1${debugRadius ? '&vision.debugRadius=' + debugRadius : ''}${args.includes('--fadeDemo') ? '&vision.fadeDemo=1' : ''}`;
  const s = legacyScale(W, H);
  const shot = async name => { const f = path.join(outDir, `${tag}-${name}.png`); await page.screenshot({ path: f }); console.log('  wrote', path.relative(repo, f)); };
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(Number(process.env.RH_SHOTS_BOOT_MS || 14000));
  await shot('planning');
  await page.keyboard.press(opt('spawn', '1')); await page.waitForTimeout(600);
  await shot('planning-spawn');
  const uiW = W / s, uiH = H / s;
  const pSide = Math.min(780, Math.max(260, Math.floor(Math.min(uiH - 44 - 12 - 124, uiW - 340 - 24 - 12 - 8))));
  const pFrame = pSide + 8, pTotal = pFrame + 12 + 340, pColH = 40 + 12 + pFrame + 12 + 52;
  const pBx = Math.floor((uiW - pTotal) / 2), pBy = Math.max(44, Math.floor((uiH - pColH) / 2 + 11));
  await page.mouse.click((pBx + pFrame + 12 + 12 + 158) * s, (pBy + 12 + 23) * s, { delay: 80 });
  await page.waitForTimeout(Number(process.env.RH_SHOTS_MATCH_MS || 12000));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 72, everyNthFrame: 1 });
  await shot('match-start');

  // Walk to the route targets first (right-click on the Tab map), with a still every 2.5 s on the way.
  let r = 0;
  for (const [fx, fy] of route) {
    await page.keyboard.down('Tab'); await page.waitForTimeout(500);
    const rect = tabMapRect(W, H, s);
    await page.mouse.move(rect.x + rect.size * fx, rect.y + rect.size * fy); await page.waitForTimeout(150);
    await page.mouse.down({ button: 'right' }); await page.waitForTimeout(90); await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(300); await page.keyboard.up('Tab'); await page.waitForTimeout(400);
    for (let k = 0; k < Number(opt('routeShots', '24')); k++) { await page.waitForTimeout(1200); await shot(`route${r}-${k}`); }
    r++;
  }
  // Walk with the keyboard, taking stills now and then.
  const keys = ['d', 'a', 's', 'w'];
  const t0 = Date.now(); let stills = 0, nextStill = 0;
  const saved = { leave: 0, enter: 0 }; let lastSaved = 0; const handled = new Set();
  while ((Date.now() - t0) / 1000 < seconds) {
    if (args.includes('--still')) await page.waitForTimeout(1500); // stand at the spawn and watch
    else {
      const key = keys[Math.floor(Math.random() * 4)];
      await page.keyboard.down(key); await page.waitForTimeout(900 + Math.random() * 1400); await page.keyboard.up(key);
      await page.waitForTimeout(250);
    }
    if ((Date.now() - t0) / 1000 >= nextStill && stills < 8) { await shot(`walk-${stills++}`); nextStill += 14; }
    // Save sequences for events that have settled for 600 ms.
    for (const ev of events) {
      if (handled.has(ev) || Date.now() - ev.at < 600 || saved[ev.kind] >= (ev.kind === 'leave' ? 4 : 3) || Date.now() - lastSaved < 800) continue;
      handled.add(ev);
      const frames = ring.filter(f => f.t >= ev.at - 500 && f.t <= ev.at + 500);
      if (frames.length < 4) { console.log('  too few frames', frames.length, 'ring', ring.length); continue; }
      const picks = []; let nextT = ev.at - 400;
      for (const f of frames) if (f.t >= nextT) { picks.push(f); nextT = f.t + 48; }
      const name = `${ev.kind}-${saved[ev.kind] + 1}`;
      const dir = path.join(outDir, `${tag}-${name}`); fs.mkdirSync(dir, { recursive: true });
      picks.forEach((f, i) => fs.writeFileSync(path.join(dir, `f${String(i).padStart(2, '0')}_${Math.round(f.t - ev.at)}ms.jpg`), Buffer.from(f.data, 'base64')));
      fs.writeFileSync(path.join(dir, 'event.txt'), ev.text + `\nframes ${picks.length}, spacing ~48 ms, t=0 is when the client logged the event\n`);
      saved[ev.kind]++; lastSaved = Date.now();
      console.log('  saved', name, picks.length, 'frames', ev.text);
    }
  }
  // Tab map and minimap.
  await page.keyboard.down('Tab'); await page.waitForTimeout(800); await shot('tab-map'); await page.keyboard.up('Tab'); await page.waitForTimeout(500);
  const mini = minimapRect(W, H, s);
  await page.screenshot({ path: path.join(outDir, `${tag}-minimap.png`), clip: { x: mini.x - 6, y: mini.y - 6, width: mini.size + 12, height: mini.size + 12 } });
  await shot('final');
  await cdp.send('Page.stopScreencast');
  fs.writeFileSync(path.join(outDir, `${tag}-console.log`), logs.join('\n') + '\n');
  const audit = logs.filter(l => l.includes('[vision-audit]')).pop();
  console.log('last audit:', audit || '(none)');
  console.log('events', events.length, 'saved', JSON.stringify(saved), 'console errors', errors.length);
  if (errors.length) console.error(errors.slice(0, 8).join('\n'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
