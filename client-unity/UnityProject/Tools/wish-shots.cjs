#!/usr/bin/env node
// Real-browser capture of one faction's Wish in the Unity Web player, with the server-driven proof that the cast was accepted.
//
//   node client-unity/UnityProject/Tools/wish-shots.cjs --faction 3 --out docs/rework/evidence/wish/frost [--quality high] [--reduced]
//
// Needs the Rust server and the served Web build:
//   RH_SHOTS_URL  default http://127.0.0.1:8157/     RH_SHOTS_WS  default ws://127.0.0.1:7857/ws
// Faction 0..4 = Fire, Sentenced, Plague, Frost, Holy. The script joins with --fill-bots enemies, plans a spawn, waits out the
// 45 s Wish lock, walks toward the nearest observed actor, aims the cursor at it and holds R down once per attempt until the
// client reports a presented Wish cue (presentWishStarted / presentWishLanded in window.__rhLatency, which MatchClient only
// records for a server-delivered Wish fx record). Then it grabs frames in a burst until the effect is over.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const faction = Number(opt('faction', '3'));
const names = ['fire', 'sentenced', 'plague', 'frost', 'holy'];
const wishes = ['Blaze Step', 'Trial', 'Swarm', 'Freeze', 'Last Stand'];
const repo = path.resolve(__dirname, '../../..');
const outDir = path.resolve(repo, opt('out', `docs/rework/evidence/wish/${names[faction]}`));
const baseUrl = process.env.RH_SHOTS_URL || 'http://127.0.0.1:8157/';
const wsUrl = process.env.RH_SHOTS_WS || 'ws://127.0.0.1:7857/ws';
const extra = (opt('quality', '') ? `&quality=${opt('quality', '')}` : '') + (args.includes('--reduced') ? '&reducedMotion=1' : '') + (process.env.RH_SHOTS_QUERY || '');
const W = 1280, H = 800, S = 1 / 32, G = 0.78, PPU = H / 18; // ortho size 9 => 18 world units over the window height
const burstMs = [7000, 9500, 12500, 5000, 8000][faction]; // fire, sentenced, plague, frost, holy
const frameGapMs = Number(opt('gap', '110'));
const lockWaitMs = Number(opt('lock', '58000'));

function legacyScale(w, h) { const stageW = w / h <= 21 / 9 ? w : Math.floor(h * 21 / 9); return Math.min(1.5, Math.max(0.8, Math.min(stageW / 1280, h / 800))); }

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: args.includes('--headless'), args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await context.addInitScript(() => { window.__rhLatency = { events: [], recording: true }; });
  const page = await context.newPage();
  const errors = [], logs = [];
  page.on('console', m => { logs.push(`[${m.type()}] ${m.text()}`); if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const profile = `w${faction}${Math.random().toString(36).slice(2, 7)}`;
  const url = `${baseUrl}?server=${encodeURIComponent(wsUrl)}&profile=${profile}&faction=${faction}&diagnostic=1&token=t1${extra}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(Number(process.env.RH_SHOTS_BOOT_MS || 14000));
  const s = legacyScale(W, H);
  await page.keyboard.press('1'); await page.waitForTimeout(600);
  const uiW = W / s, uiH = H / s;
  const pSide = Math.min(780, Math.max(260, Math.floor(Math.min(uiH - 44 - 12 - 124, uiW - 340 - 24 - 12 - 8))));
  const pFrame = pSide + 8, pTotal = pFrame + 12 + 340, pColH = 40 + 12 + pFrame + 12 + 52;
  const pBx = Math.floor((uiW - pTotal) / 2), pBy = Math.max(44, Math.floor((uiH - pColH) / 2 + 11));
  await page.mouse.click((pBx + pFrame + 12 + 12 + 158) * s, (pBy + 12 + 23) * s, { delay: 80 });
  const t0 = Date.now();

  // Latest observed positions (server units), drained from the trace so it never overflows.
  const seen = { self: null, actors: new Map(), wishEvents: [], selfId: 0 };
  const drain = async () => {
    const evs = await page.evaluate(() => { const e = window.__rhLatency.events.splice(0, window.__rhLatency.events.length); return e; });
    const now = Date.now();
    for (const e of evs) {
      if (e.kind === 'presentSelf') { seen.self = { x: e.x, y: e.y, at: now }; seen.selfId = e.player; }
      else if (e.kind === 'presentActor') seen.actors.set(e.player, { x: e.x, y: e.y, at: now });
      else if (e.kind.startsWith('presentWish') || e.kind === 'sampleWish') seen.wishEvents.push({ ...e, wall: now - t0 });
    }
    for (const [id, a] of seen.actors) if (now - a.at > 600) seen.actors.delete(id);
  };
  const own = () => seen.wishEvents.filter(x => x.kind.startsWith('presentWish') && x.player === seen.selfId);
  const toScreen = (p) => seen.self ? { x: W / 2 + (p.x - seen.self.x) * S * PPU, y: H / 2 + 1.5 * PPU + (p.y - seen.self.y) * S * G * PPU } : null;
  const nearest = () => {
    if (!seen.self) return null; let best = null, bd = 1e12;
    for (const [id, a] of seen.actors) { if (id === seen.selfId) continue; const dx = a.x - seen.self.x, dy = a.y - seen.self.y, d = dx * dx + dy * dy; if (d > 40 * 40 && d < bd) { bd = d; best = { id, ...a, dist: Math.sqrt(d), dx, dy }; } }
    return best;
  };

  // Wait out planning and the 45 s lock, then close in on the nearest enemy.
  while (Date.now() - t0 < lockWaitMs) { await drain(); await page.waitForTimeout(500); }
  console.log(`faction ${faction} ${wishes[faction]}: lock waited, self`, seen.self, 'actors', seen.actors.size);
  const held = new Set();
  const setKeys = async (want) => {
    for (const k of ['w', 'a', 's', 'd']) {
      if (want.has(k) && !held.has(k)) { await page.keyboard.down(k); held.add(k); }
      else if (!want.has(k) && held.has(k)) { await page.keyboard.up(k); held.delete(k); }
    }
  };
  const standoff = [320, 150, 150, 330, 170][faction];
  let accepted = false, attempts = 0, castAt = 0;
  const shots = [];
  let frameNo = 0;
  const clip = { x: 140, y: 110, width: 1000, height: 660 };
  const grab = async (tag) => {
    const file = path.join(outDir, `f${String(frameNo).padStart(3, '0')}.jpg`);
    const before = Date.now();
    await page.screenshot({ path: file, type: 'jpeg', quality: 62, clip });
    shots.push({ file: path.basename(file), tMs: before - (castAt || before), tag }); frameNo++;
  };
  const deadline = Date.now() + 60000;
  while (!accepted && Date.now() < deadline) {
    await drain();
    const e = nearest();
    if (e && e.dist > standoff) {
      const want = new Set();
      if (e.dy < -40) want.add('w'); if (e.dy > 40) want.add('s'); if (e.dx < -40) want.add('a'); if (e.dx > 40) want.add('d');
      await setKeys(want);
    } else await setKeys(new Set());
    const noTarget = faction === 2 || faction === 4;
    if (((e && e.dist <= standoff + 60) || (noTarget && Date.now() - t0 > lockWaitMs + 2000)) && !own().length) {
      let aim = e ? toScreen(e) : { x: W / 2 + 120, y: H / 2 };
      if (faction === 0 && aim) aim = { x: W / 2 + (aim.x - W / 2) * 0.55, y: H / 2 + 100 + (aim.y - H / 2 - 100) * 0.55 };
      if (aim) await page.mouse.move(Math.max(5, Math.min(W - 5, aim.x)), Math.max(5, Math.min(H - 5, aim.y)));
      await page.waitForTimeout(80);
      await setKeys(new Set());
      await page.keyboard.down('r'); await page.waitForTimeout(140); await page.keyboard.up('r');
      attempts++;
      castAt = Date.now();
      // Frames from the keypress on: the first ones show the telegraph, the rest the effect.
      const probeUntil = Date.now() + 1300;
      const stop = Date.now() + burstMs;
      while (Date.now() < stop) {
        if (Date.now() > probeUntil && !own().length) break;
        await grab(attempts + ':' + (Date.now() - castAt));
        await drain();
        await page.waitForTimeout(frameGapMs);
      }
      accepted = own().length > 0;
      if (!accepted) { for (const f of shots.splice(0)) try { fs.unlinkSync(path.join(outDir, f.file)); } catch (_) {} frameNo = 0; await page.waitForTimeout(1500); }
    } else await page.waitForTimeout(250);
  }
  await setKeys(new Set());
  await drain();
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
    faction, wish: wishes[faction], url: url.replace(/profile=[^&]+/, 'profile=redacted'), attempts, accepted, castWallMsSinceLaunch: castAt - t0,
    serverDrivenEvidence: seen.wishEvents, frames: shots, consoleErrors: errors,
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'console.log'), logs.join('\n') + '\n');
  console.log(`${wishes[faction]}: accepted=${accepted} attempts=${attempts} frames=${shots.length} wishEvents=${seen.wishEvents.length} consoleErrors=${errors.length}`);
  await browser.close();
  process.exit(accepted && errors.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
