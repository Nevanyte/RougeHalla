#!/usr/bin/env node
// Real-browser proofs for the ADR0024 client (P-HB-7/8): wall approach, reconciliation, chest aim and overlay screenshots.
//   node client-unity/UnityProject/Tools/hitbox-proof.cjs --step probe|wall|walk|aim|looks [--ws ws://127.0.0.1:7897/ws] [--url http://127.0.0.1:8197/]
//        [--faction 0..4] [--tag archetypes] [--out /tmp/dir] [--seconds 30] [--overlay 1]
// The page is driven like a player (keyboard and mouse). Positions come from the opt-in latency trace (window.__rhLatency) that the
// client already fills for test harnesses; the sim-to-screen mapping is calibrated from the client's own target marks.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const repo = path.resolve(__dirname, '../../..');
const step = opt('step', 'probe');
const tag = opt('tag', 'archetypes');
const out = path.resolve(opt('out', '/tmp/hitbox-proof'));
const base = opt('url', 'http://127.0.0.1:8197/');
const ws = opt('ws', 'ws://127.0.0.1:7897/ws');
const faction = Number(opt('faction', 0));
const overlay = opt('overlay', '1');
const W = 1600, H = 900, ORTHO = 9, SQUASH = 0.78;
fs.mkdirSync(out, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const map = (() => { const m = JSON.parse(fs.readFileSync(path.join(repo, 'crates/rh-sim/src/mapdata/fixtures/seed1.map.json'), 'utf8')).map; return m; })();
const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) ? 1 : map.tiles[ty * map.w + tx];

class Game {
  constructor() { this.self = null; this.selfTrace = []; this.actors = new Map(); this.marks = {}; this.logs = []; this.errors = []; this.recon = []; this.hb = []; this.timer = null; }
  async start() {
    this.browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
    const context = await this.browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    this.page = await context.newPage();
    this.page.on('console', m => {
      const t = m.text(); this.logs.push(`[${m.type()}] ${t}`);
      if (m.type() === 'error') this.errors.push(t);
      if (t.startsWith('[recon]')) this.recon.push({ at: Date.now(), line: t });
      if (t.startsWith('[hitboxes]')) this.hb.push({ at: Date.now(), line: t });
    });
    this.page.on('pageerror', e => this.errors.push('pageerror: ' + e.message));
    await this.page.addInitScript(() => { window.__rhLatency = { events: [], recording: true }; });
    const profile = `hb${tag[0]}${Math.random().toString(36).slice(2, 7)}`.slice(0, 16);
    const url = `${base}?server=${encodeURIComponent(ws)}&profile=${profile}&faction=${faction}&diagnostic=1&token=t1&hitboxes=${overlay}&inputlat=1`;
    await this.page.goto(url, { waitUntil: 'load' });
    await this.page.waitForSelector('canvas', { timeout: 60000 });
    await sleep(Number(process.env.RH_HB_BOOT_MS || 14000));
    await this.page.keyboard.press('1'); await sleep(600);
    {   // planning: the Ready button (same maths as atmosphere-shots.cjs)
      const stageW = W / H <= 21 / 9 ? W : Math.floor(H * 21 / 9);
      const s = Math.min(1.5, Math.max(0.8, Math.min(stageW / 1280, H / 800)));
      const uiW = W / s, uiH = H / s;
      const pSide = Math.min(780, Math.max(260, Math.floor(Math.min(uiH - 44 - 12 - 124, uiW - 340 - 24 - 12 - 8))));
      const pFrame = pSide + 8, pTotal = pFrame + 12 + 340, pColH = 40 + 12 + pFrame + 12 + 52;
      const pBx = Math.floor((uiW - pTotal) / 2), pBy = Math.max(44, Math.floor((uiH - pColH) / 2 + 11));
      await this.page.mouse.click((pBx + pFrame + 12 + 12 + 158) * s, (pBy + 12 + 23) * s, { delay: 80 });
    }
    this.timer = setInterval(() => this.drain().catch(() => {}), 120);
    const t0 = Date.now();
    while (!this.self && Date.now() - t0 < 90000) await sleep(300);
    if (!this.self) throw new Error('no presentSelf mark: the match never started');
    await sleep(2500);
    await this.calibrate();
  }
  async drain() {
    const evs = await this.page.evaluate(() => { const t = window.__rhLatency; if (!t) return []; const e = t.events.splice(0, t.events.length); return e; });
    for (const e of evs) {
      if (e.kind === 'presentSelf') { this.self = { x: e.x, y: e.y, at: e.at }; this.selfTrace.push({ x: e.x, y: e.y, at: e.at }); if (this.selfTrace.length > 20000) this.selfTrace.splice(0, 5000); }
      else if (e.kind === 'presentActor') this.actors.set(e.player, { x: e.x, y: e.y, at: e.at });
      else if (e.kind.startsWith('target')) { this.marks[e.kind] = this.marks[e.kind] || []; this.marks[e.kind].push(e); }
    }
  }
  async calibrate() {
    this.marks = {};
    await this.page.evaluate(() => { window.__rhLatency.targetsRequested = true; });
    await sleep(700); await this.drain();
    const vp = (this.marks.targetViewport || []).pop(), me = (this.marks.targetSelf || []).pop();
    if (!vp || !me) throw new Error('no target marks');
    // Unity screen space has y up; the page has y down. The canvas fills the page 1:1.
    const sw = vp.x, sh = vp.y, scale = Math.min(W / sw, H / sh);
    const ppu = sh / (2 * ORTHO);
    this.cal = { kx: ppu / 32 / (sw / W), ky: ppu * SQUASH / 32 / (sh / H), ox: me.x / (sw / W), oy: H - me.y / (sh / H), sx: this.self.x, sy: this.self.y, ppu, sw, sh };
    this.selfAtCal = { x: me.x, y: me.y };
    return this.cal;
  }
  // The self mark carries the drawn position at that frame; calibration used the server position, which agrees at rest.
  css(x, y) { const c = this.cal; return [c.ox + (x - c.sx) * c.kx, c.oy + (y - c.sy) * c.ky]; }
  sim(px, py) { const c = this.cal; return [c.sx + (px - c.ox) / c.kx, c.sy + (py - c.oy) / c.ky]; }
  async settle(ms = 900, timeout = 25000) {   // wait until the drawn position has not moved for `ms`
    const t0 = Date.now(); let last = null, since = Date.now();
    while (Date.now() - t0 < timeout) {
      const s = this.self; if (s && last && Math.hypot(s.x - last.x, s.y - last.y) < 0.05) { if (Date.now() - since >= ms) return s; } else { last = s && { x: s.x, y: s.y }; since = Date.now(); }
      await sleep(100);
    }
    return this.self;
  }
  async moveTo(x, y) { await this.recentre(x, y); }
  async rightClickSim(x, y) { const [px, py] = this.css(x, y); await this.page.mouse.move(px, py); await this.page.mouse.click(px, py, { button: 'right', delay: 40 }); }
  async shot(name, clip, quality = 78) {
    const file = path.join(out, `${tag}-${name}.png`);
    await this.page.screenshot({ path: file, clip });
    return file;
  }
  async stop() { clearInterval(this.timer); await this.browser.close(); }
  save() {
    fs.writeFileSync(path.join(out, `${tag}-${step}-console.log`), this.logs.join('\n') + '\n');
  }
}

async function recalibrate(g) {  // the camera follows the player: re-anchor the mapping at the current position
  await g.settle(600); await sleep(300); await g.calibrate();
}

(async () => {
  const g = new Game();
  let failed = false;
  try {
    await g.start();
    console.log(`[${tag}] joined; self at (${g.self.x.toFixed(1)}, ${g.self.y.toFixed(1)}); calibration`, JSON.stringify(g.cal));
    const R = require('./hitbox-proof-steps.cjs');
    if (R[step]) await R[step](g, { out, tag, path, fs, sleep, map, tileAt, recalibrate, W, H, SQUASH, opt, args });
    else console.log('unknown step', step);
  } catch (e) { failed = true; console.error('FAILED:', e && e.stack || e); }
  try { g.save(); await g.stop(); } catch (_) {}
  if (g.errors.length) { failed = true; console.error(`${g.errors.length} console error(s):\n  ` + g.errors.slice(0, 8).join('\n  ')); }
  else console.log('console errors: 0');
  process.exit(process.exitCode === 3 ? 3 : failed ? 1 : 0);
})();
