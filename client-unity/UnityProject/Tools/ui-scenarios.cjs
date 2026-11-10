#!/usr/bin/env node
'use strict';
// UI scenario harness: drives REAL matches of the Unity Web build into each state the UI passes built (remote clusters, rings, damage
// numbers, vignette, chests, quests, traders, corpses, fades, every hub panel) and captures a full frame plus a tight crop per item,
// with the console log and a JSON snapshot of what the client held at that moment.
//
//   node client-unity/UnityProject/Tools/ui-scenarios.cjs --list
//   node client-unity/UnityProject/Tools/ui-scenarios.cjs --scenario hub,fight-sentenced --out /tmp/ui4-raw [--w 1920 --h 1080]
//        [--minutes 4] [--demo hitzone]
//
// Environment (defaults match the commands in docs/rework/evidence/ui4/README.md):
//   RH_SHOTS_URL   served Web build           default http://127.0.0.1:8277/
//   RH_SHOTS_WS    full-map arena server      default ws://127.0.0.1:7977/ws
//   RH_TRAIN_WS    training server            default ws://127.0.0.1:7978/ws
// The page host is the literal 127.0.0.1 (diagnostic mode requires a loopback page). The build must contain the opt-in probe
// (`?scenario.probe=1`, Assets/Scripts/Diagnostics/ScenarioProbe.cs): it mirrors what the client already holds from the server
// (own state, delivered actors/props/chests/quests/merchants with screen positions, every active button's rectangle) as
// window.__rhProbe. The harness only reads it to aim its mouse/keys, exactly like a player looking at the screen.
//
// Training reached locally: the launch screen's Training button needs a launch target that passes the same-origin policy
// (AccountConnectionPolicy.CheckOwnedTarget), so the page is opened with `accountApi=http://127.0.0.1:<trainport>/api&trainingServer=
// ws://127.0.0.1:<trainport>/ws&diagnostic=1&auto=0`; the harness then clicks Training and Play like a player.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'));

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback; };
const W = +opt('w', 1920), H = +opt('h', 1080);
const OUT = path.resolve(opt('out', path.join(os.tmpdir(), 'ui4-raw')));
const BASE = process.env.RH_SHOTS_URL || 'http://127.0.0.1:8277/';
const WS = process.env.RH_SHOTS_WS || 'ws://127.0.0.1:7977/ws';
const TRAIN_WS = process.env.RH_TRAIN_WS || 'ws://127.0.0.1:7978/ws';
const MINUTES = +opt('minutes', 4);
const DEMO = (opt('demo', '') || '').split(',').filter(Boolean);
const FACTIONS = { fire: 0, sentenced: 1, plague: 2, frost: 3, holy: 4 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- legacy stage maths (same as hud-shots.cjs) ---------------------------------------------------------------------------------
function legacyScale(w, h) { const sw = w / h <= 21 / 9 ? w : Math.floor(h * 21 / 9); return Math.min(1.5, Math.max(0.8, Math.min(sw / 1280, h / 800))); }
function minimapRect(w, h, s) {
  const uiW = Math.floor(w / s), uiH = Math.floor(h / s);
  const wanted = Math.min(312, Math.max(195, Math.round(uiH * 0.338))), room = Math.floor(uiW / 2 - 12 - 152);
  const size = Math.round(Math.min(Math.min(wanted, Math.max(110, room)), uiW * 0.42, uiH * 0.6));
  return { x: w - (12 + size) * s, y: h - (12 + size) * s, size: size * s };
}
const PANEL = { x: 12, pad: 14 };
const PANEL_ROWS = { callsign: 32, load: 32, profile: 142, faction: 202, play: 466, guide: 562 };
function launchGeometry(w, h) {
  const s = legacyScale(w, h), uiW = w / s, uiH = h / s;
  const areaX = 354, areaTop = 120, areaW = Math.max(300, uiW - 354 - 12), areaH = Math.max(300, uiH - 120 - 12);
  const k = Math.min(1.4, Math.max(0.45, Math.min(areaW / 896, (areaH - 36) / 576)));
  const roomLeft = areaX + (areaW - 896 * k) / 2;
  const unit = (ux, uy) => ({ x: ux * s, y: uy * s });
  const panel = (px, py) => unit(PANEL.x + px, 12 + py);
  const room = (rx, ry) => unit(roomLeft + rx * k, areaTop + ry * k);
  return { s, panel, room,
    profile: panel(PANEL.pad + 74, PANEL_ROWS.profile + 16), resume: panel(PANEL.pad + 156 + 73, PANEL_ROWS.profile + 16),
    house: i => panel(PANEL.pad + 151, PANEL_ROWS.faction + i * 52 + 24), play: panel(PANEL.pad + 95, PANEL_ROWS.play + 24),
    training: panel(PANEL.pad + 198 + 52, PANEL_ROWS.play + 24), guide: panel(PANEL.pad + 80, PANEL_ROWS.guide + 16),
    signIn: panel(PANEL.pad + 168 + 67, PANEL_ROWS.guide + 16),
    station: { Counters: room(448, 288), Arena: room(448, 66), Training: room(786, 288), Shop: room(128, 96), Wardrobe: room(128, 174), Titles: room(128, 252),
      Achievements: room(128, 330), Leaderboard: room(128, 408) } };
}

// ---- session wrapper ----------------------------------------------------------------------------------------------------------------
class Run {
  constructor(name, browser, ctx, page) {
    this.name = name; this.browser = browser; this.ctx = ctx; this.page = page; this.logs = []; this.errors = []; this.n = 0; this.manifest = [];
    this.dir = path.join(OUT, name); fs.mkdirSync(this.dir, { recursive: true });
    page.on('console', m => { const t = `[${m.type()}] ${m.text()}`; this.logs.push(t); if (m.type() === 'error' && !/404|\.mp3|audio/i.test(m.text())) this.errors.push(m.text()); });
    page.on('pageerror', e => this.errors.push('pageerror: ' + e.message));
  }
  async probe() { return this.page.evaluate(() => window.__rhProbe || null).catch(() => null); }
  // CSS-px position of a probe screen point (the probe reports Unity screen pixels; the canvas may be scaled by devicePixelRatio).
  async cssScale() { return this.page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); const p = window.__rhProbe; return p && p.sw ? r.width / p.sw : 1; }); }
  async css(sx, sy) { const k = await this.cssScale(); return { x: sx * k, y: sy * k }; }
  // Full frame + optional crop (CSS px, around a centre) + a JSON of the probe. Returns the file stem.
  async snap(label, o = {}) {
    const stem = `${String(++this.n).padStart(3, '0')}-${label}`;
    const full = path.join(this.dir, stem + '.png');
    await this.page.screenshot({ path: full });
    const entry = { stem, label, note: o.note || '' };
    if (o.crop) {
      const [cx, cy, cw, ch] = o.crop;
      const clip = { x: Math.max(0, Math.min(W - cw, Math.round(cx - cw / 2))), y: Math.max(0, Math.min(H - ch, Math.round(cy - ch / 2))), width: cw, height: ch };
      await this.page.screenshot({ path: path.join(this.dir, stem + '-crop.png'), clip });
      entry.crop = clip;
    }
    const p = await this.probe(); if (p) fs.writeFileSync(path.join(this.dir, stem + '.json'), JSON.stringify(p));
    this.manifest.push(entry); console.log('   snap', stem);
    return stem;
  }
  async click(x, y, o = {}) { await this.page.mouse.click(x, y, { delay: o.delay || 60, button: o.button || 'left' }); await sleep(o.wait === undefined ? 500 : o.wait); }
  async clickUi(name, o = {}) { // by Unity object name (or text) via the probe's button list
    for (let i = 0; i < 30; i++) {
      const p = await this.probe();
      const b = p && p.ui && p.ui.find(u => (u.n === name || (o.text && u.t === o.text)) && (o.any || u.i));
      if (b) { const k = await this.cssScale(); await this.click((b.x + b.w / 2) * k, (b.y + b.h / 2) * k, o); return b; }
      await sleep(250);
    }
    console.log('   (no button)', name); return null;
  }
  async uiNames() { const p = await this.probe(); return p && p.ui ? p.ui.map(u => u.n) : []; }
  async waitFor(pred, timeout = 30000, step = 250) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { const p = await this.probe(); if (p && pred(p)) return p; await sleep(step); } return null; }
  async finish() {
    fs.writeFileSync(path.join(this.dir, 'console.log'), this.logs.join('\n') + '\n');
    fs.writeFileSync(path.join(this.dir, 'manifest.json'), JSON.stringify({ errors: this.errors, frames: this.manifest }, null, 1));
    console.log(`  ${this.name}: ${this.manifest.length} frames, ${this.errors.length} console error(s)`);
    for (const e of this.errors.slice(0, 5)) console.log('    ', e.slice(0, 160));
    await this.ctx.close();
  }
  // -- world helpers
  async walkWorld(x, y) { const s = legacyScale(W, H), m = minimapRect(W, H, s); await this.click(m.x + m.size * x / 5120, m.y + m.size * y / 5120, { button: 'right', delay: 80, wait: 100 }); }
  async rightClickAt(sx, sy) { const c = await this.css(sx, sy); await this.click(c.x, c.y, { button: 'right', delay: 80, wait: 100 }); }
  async leftClickAt(sx, sy, wait = 150) { const c = await this.css(sx, sy); await this.click(c.x, c.y, { wait }); }
  async hoverAt(sx, sy) { const c = await this.css(sx, sy); await this.page.mouse.move(c.x, c.y, { steps: 4 }); }
}

// Walk with the keyboard (a right-click under the HUD bars would hit the HUD, not the world): hold the keys that point from the player to a
// screen target for `ms`. `away` walks the opposite way.
async function stepToward(run, me, tx, ty, ms = 260, away = false) {
  const dx = (tx - me.sx) * (away ? -1 : 1), dy = (ty - me.sy) * (away ? -1 : 1);
  const keys = []; if (dx > 30) keys.push('d'); else if (dx < -30) keys.push('a'); if (dy > 30) keys.push('s'); else if (dy < -30) keys.push('w');
  for (const k of keys) await run.page.keyboard.down(k);
  await sleep(ms);
  for (const k of keys) await run.page.keyboard.up(k);
}

// planning screen: the spawn is picked with the digit key and the READY button is the top of the decision column.
async function startArena(run) {
  await sleep(1500);
  await run.page.keyboard.press('1'); await sleep(600);
  const s = legacyScale(W, H), uiW = W / s, uiH = H / s;
  const pSide = Math.min(780, Math.max(260, Math.floor(Math.min(uiH - 44 - 12 - 124, uiW - 340 - 24 - 12 - 8))));
  const pFrame = pSide + 8, pTotal = pFrame + 12 + 340, pColH = 40 + 12 + pFrame + 12 + 52;
  const pBx = Math.floor((uiW - pTotal) / 2), pBy = Math.max(44, Math.floor((uiH - pColH) / 2 + 11));
  await run.click((pBx + pFrame + 12 + 12 + 158) * s, (pBy + 12 + 23) * s, { delay: 80, wait: 500 });
}

async function open(name, o = {}) {
  const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const run = new Run(name, browser, ctx, page);
  const profile = (name.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) + Math.random().toString(36).slice(2, 7)).slice(0, 16);
  const faction = o.faction === undefined ? 3 : o.faction;
  let q = `?profile=${profile}&faction=${faction}&scenario.probe=1&fx.quality=high`;
  // Training is refused in diagnostic mode by design (MatchHud.Accounts.cs `trainingReady`), so the training page is an ordinary,
  // non-diagnostic page whose account API is the in-memory account service of the training server itself.
  if (o.training) q += `&accountApi=${encodeURIComponent(new URL(TRAIN_WS).origin.replace('ws:', 'http:') + '/api')}&trainingServer=${encodeURIComponent(TRAIN_WS)}&server=${encodeURIComponent(WS)}`;
  else q += `&diagnostic=1&token=t1&server=${encodeURIComponent(WS)}&auto=${o.auto === 0 ? 0 : 1}`;
  if (o.plain) q = '?scenario.probe=1&fx.quality=high'; // the ordinary player page: no diagnostic, no server, accounts shown as unreachable
  if (DEMO.includes('hitzone')) q += '&hitzone.demo=1';
  if (o.query) q += o.query;
  await page.goto(BASE + q, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 90000 });
  await run.waitFor(p => true, 60000);
  await sleep(o.boot || 9000);
  return run;
}

async function startTraining(run) {
  const g = launchGeometry(W, H);
  await run.click(g.training.x, g.training.y, { wait: 2500 }); // the Training button itself starts the practice launch
  const p = await run.waitFor(q => q.session && q.state === 'InMatch', 30000);
  await sleep(2500);
  return p;
}

// ---- scenarios -----------------------------------------------------------------------------------------------------------------------
const scenarios = {};
const HOUSES = ['Fire', 'Sentenced', 'Plague', 'Frost', 'Holy'];

// Every hub station and account panel, each closed with Escape; the button list before/after proves Escape closed it.
scenarios.hub = async (variant) => {
  const run = await open(variant === 'plain' ? 'hub-plain' : 'hub', { auto: 0, plain: variant === 'plain' });
  const g = launchGeometry(W, H);
  await run.snap('hub-room');
  const steps = [['counters', g.station.Counters], ['shop', g.station.Shop], ['wardrobe', g.station.Wardrobe], ['titles', g.station.Titles],
    ['achievements', g.station.Achievements], ['leaderboard', g.station.Leaderboard], ['records', g.profile], ['guide', g.guide], ['resume', g.resume], ['signin', g.signIn]];
  const report = [];
  for (const [name, at] of steps) {
    const before = await run.uiNames();
    await run.click(at.x, at.y, { wait: 3000 });
    const open1 = await run.uiNames();
    await run.snap('panel-' + name);
    await run.page.keyboard.press('Escape'); await sleep(900);
    const after = await run.uiNames();
    const closed = JSON.stringify(after) === JSON.stringify(before);
    report.push({ name, buttonsBefore: before.length, buttonsOpen: open1.length, buttonsAfterEscape: after.length, escapeRestoredButtons: closed });
    await run.snap('after-escape-' + name);
  }
  // Guide pages (the faction buttons carry the generated pictograms).
  await run.click(g.guide.x, g.guide.y, { wait: 1500 }); await run.snap('guide-champions');
  fs.writeFileSync(path.join(run.dir, 'escape-report.json'), JSON.stringify(report, null, 1)); console.log(report);
  await run.page.keyboard.press('Escape'); await sleep(500);
  await run.finish();
};

// The full map: the player fights bots and creatures; frames are taken per feature the moment its trigger is true.
scenarios.fight = async (variant) => {
  const faction = FACTIONS[variant || 'frost'] ?? 3;
  const run = await open('fight-' + (variant || 'frost'), { faction });
  await startArena(run);
  await sleep(9000);
  const caps = { remote: 6, hover: 2, lock: 3, hurt: 3, dead: 3, nums: 6, bounty: 3, status: 6, hit: 4, results: 2, corpse: 3, huntpick: 1, huntring: 3 };
  const got = {}; const cap = k => (got[k] = (got[k] || 0) + 1) <= caps[k];
  const t0 = Date.now(); let lastHp = null; let wp = 0;
  const route = [[2560, 2560], [1500, 2500], [3600, 2500], [2560, 1500], [2560, 3600], [1400, 1400], [3700, 3700], [3700, 1400], [1400, 3700]];
  let lastWalk = 0;
  while (Date.now() - t0 < MINUTES * 60000) {
    const p = await run.probe();
    if (!p || !p.me) { await sleep(500); continue; }
    if (p.result) { if (cap('results')) await run.snap('results-card'); await sleep(2000); if (got.results > 3) break; continue; }
    const me = p.me; const at = await run.css(me.sx, me.sy);
    const hostile = (p.actors || []).filter(a => a.status === 1 && a.id !== me.id && (a.kind === 0 || a.kind === 1 || a.kind === 2)).map(a => ({ a, d: Math.hypot(a.sx - me.sx, a.sy - me.sy) })).sort((x, y) => x.d - y.d);
    if (lastHp !== null && me.hp < lastHp - 1 && me.status === 1 && cap('hurt')) await run.snap('hurt-vignette', { crop: [W / 2, H / 2, 1280, 720], note: `hp ${lastHp}->${me.hp}/${me.maxHp}` });
    lastHp = me.hp;
    if (me.status === 2 && cap('dead')) { await run.snap('death-self'); await sleep(1500); await run.snap('death-self-later'); }
    const players = hostile.filter(h => h.a.kind === 0);
    if (faction === 1 && me.status === 1) { // Sentenced: the hunt picker lists delivered rivals; choosing one gives the violet hunt ring
      const names = await run.uiNames();
      if (me.hunt < 0 && names.includes('Rival0') && cap('huntpick')) { await run.snap('hunt-picker', { crop: [220, 260, 520, 360] }); await run.clickUi('Rival0', { wait: 900 }); await run.snap('hunt-after-choice', { crop: [220, 260, 520, 360] }); }
      if (me.hunt >= 0) { const hp = p.actors.find(a => a.id === me.hunt); if (hp && cap('huntring')) { const hc = await run.css(hp.sx, hp.sy); await run.snap('hunt-ring', { crop: [hc.x, hc.y - 30, 420, 300], note: 'target ' + hp.id }); } }
    }
    for (const h of players.slice(0, 2)) if ((h.a.bounty > 0 || h.a.effects || h.a.sig) && cap('status')) {
      const c = await run.css(h.a.sx, h.a.sy);
      await run.snap('remote-status', { crop: [c.x, c.y - 40, 360, 260], note: `bounty ${h.a.bounty} effects ${h.a.effects} sig ${h.a.sig} faction ${h.a.faction}` });
    }
    if (players[0] && players[0].d < 700 && cap('remote')) {
      const c = await run.css(players[0].a.sx, players[0].a.sy);
      await run.snap('remote-cluster', { crop: [c.x, c.y - 40, 360, 260], note: `bounty ${players[0].a.bounty} effects ${players[0].a.effects}` });
    }
    if (hostile[0] && hostile[0].d < 380) {
      const h = hostile[0].a, c = await run.css(h.sx, h.sy);
      if (cap('hover')) { await run.hoverAt(h.sx, h.sy); await sleep(250); await run.snap('hover-ring', { crop: [c.x, c.y - 20, 360, 260], note: 'cursor over kind ' + h.kind }); }
      await run.leftClickAt(h.sx, h.sy, 120);
      if (cap('lock')) { await sleep(150); await run.snap('lock-ring', { crop: [c.x, c.y - 20, 360, 260], note: 'locked kind ' + h.kind }); }
      for (let k = 0; k < 6; k++) { await run.page.mouse.click(c.x, c.y, { delay: 40 }); await sleep(180); if (k === 2 && cap('nums')) await run.snap('damage-numbers', { crop: [c.x, c.y - 40, 420, 300] }); }
      if (cap('hit')) await run.snap('swing-hitzone', { crop: [at.x, at.y, 520, 380] });
    } else if (Date.now() - lastWalk > 7000) { const t = route[wp++ % route.length]; await run.walkWorld(t[0], t[1]); lastWalk = Date.now(); }
    const corpse = (p.props || []).find(q => q.kind === 4);
    if (corpse && cap('corpse')) { const c = await run.css(corpse.sx, corpse.sy); await run.snap('plague-corpse', { crop: [c.x, c.y, 360, 260] }); }
    await sleep(250);
  }
  console.log('  triggers hit:', JSON.stringify(got));
  await run.snap('final');
  await run.finish();
};

// ---- training-based scenarios ----------------------------------------------------------------------------------------------------------
const MOBS = ['Ember Imp', 'Cinder Hound', 'Magma Brute', 'Flame Caller', 'Wyrmling', 'Ash Drake', 'Bailiff', 'Chain Warden', 'Inquisitor', 'Pardoner', 'Executioner', 'Gaoler',
  'Plague Rat', 'Bloatfly', 'Rot Monk', 'Miasma Witch', 'Rat Ogre', 'Pox Behemoth', 'Frost Wisp', 'Ice Golem', 'Rime Stalker', 'Frostbow Sentry', 'Glacial Warden', 'Avalanche Troll',
  'Acolyte', 'Seraph Shard', 'Penitent', 'Zealot', 'Blood Saint', 'Archon'];
async function consoleOpen(run) { if (!(await run.uiNames()).includes('Close')) await run.clickUi('ConsoleToggle', { wait: 900 }); }
async function consoleClose(run) { await run.clickUi('Close', { wait: 600 }); }
// The console scrolls: bring a button into the visible band (below the title row, above the status line) with the wheel, then click it.
async function clickConsole(run, name, o = {}) {
  for (let i = 0; i < 14; i++) {
    const p = await run.probe(); const k = await run.cssScale();
    const b = p && p.ui.find(u => u.n === name), close = p && p.ui.find(u => u.n === 'Close');
    if (b && close) {
      const top = close.y + close.h + 8, bottom = close.y + 640 * (H / 1080) * 0.78; // the scroll viewport is ~72% of the panel
      const cy = b.y + b.h / 2;
      if (cy >= top && cy <= bottom) { await run.click((b.x + b.w / 2) * k, cy * k, o); return b; }
      await run.page.mouse.move((b.x + b.w / 2) * k, (top + 80) * k); await run.page.mouse.wheel(0, cy > bottom ? 160 : -160); await sleep(250);
    } else await sleep(250);
  }
  console.log('   (console button not reachable)', name); return null;
}
async function pickMob(run, index) { // the selector starts at index 0; step with the Next button
  for (let i = 0; i < index; i++) await run.clickUi('MobNext', { wait: 80 });
}
async function spawnCamp(run, mobIndex) { await consoleOpen(run); await pickMob(run, mobIndex); await clickConsole(run, 'CampAction', { wait: 700 }); }

scenarios.training = async (variant) => {
  const faction = FACTIONS[variant || 'frost'] ?? 3;
  const run = await open('training-' + (variant || 'frost'), { training: true, auto: 0, faction });
  await run.snap('hub-training-enabled');
  const p = await startTraining(run);
  console.log('  training state', p && JSON.stringify({ state: p.state, training: p.training, practice: p.practice, me: p.me && { x: p.me.x, y: p.me.y }, actors: (p.actors || []).length }));
  await run.snap('training-start');
  await run.clickUi('ConsoleToggle', { wait: 1200 });
  await run.snap('training-console');
  console.log('  buttons', (await run.uiNames()).join(','));
  await run.finish();
};

// Walk onto a ground weapon prop and take it with F (the practice room has all five lying on the floor).
async function equipWeapon(run, want) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const p = await run.probe(); if (!p || !p.me) return false;
    if (p.me.weapon === want) return true;
    const prop = (p.props || []).filter(q => q.kind === 1 && (want < 0 || q.weapon === want)).map(q => ({ q, d: Math.hypot(q.x - p.me.x, q.y - p.me.y) })).sort((x, y) => x.d - y.d)[0];
    if (!prop) { // none delivered here: sweep the room with the keyboard until the server shows one
      console.log('   no ground weapon', want, 'in view yet; searching');
      for (const k of ['d', 'd', 's', 's', 'a', 'a', 'a', 'a', 'w', 'w', 'w', 'w', 'd', 'd']) {
        await run.page.keyboard.down(k); await sleep(900); await run.page.keyboard.up(k);
        const q = await run.probe(); if (q && (q.props || []).some(z => z.kind === 1 && (want < 0 || z.weapon === want))) break;
      }
      continue;
    }
    for (let i = 0; i < 12; i++) {
      const pp = await run.probe(); if (Math.hypot(prop.q.x - pp.me.x, prop.q.y - pp.me.y) < 48) break;
      await stepToward(run, pp.me, prop.q.sx, prop.q.sy, 320);
      const np = (await run.probe()).props.find(q => q.kind === 1 && Math.hypot(q.x - prop.q.x, q.y - prop.q.y) < 4); if (np) { prop.q.sx = np.sx; prop.q.sy = np.sy; }
    }
    await run.page.keyboard.press('f'); await sleep(700);
  }
  const p = await run.probe(); return p && p.me && p.me.weapon === want;
}

// Spawn a camp, take a weapon, fight with hover / lock / damage numbers; every trigger snaps the instant the server confirms it
// (a target's hp dropped, own hp dropped, a lock was set, a creature carries a status).
scenarios['training-fight'] = async (variant) => {
  const faction = FACTIONS[variant || 'frost'] ?? 3;
  const weaponWanted = +opt('weapon', 2); // 0 sword, 1 bow, 2 wand, 3 shield, 4 axe
  const run = await open('tfight-' + (variant || 'frost') + '-w' + weaponWanted, { training: true, auto: 0, faction });
  const start = await startTraining(run); if (!start || !start.practice) { console.log('  training not confirmed'); await run.snap('not-training'); await run.finish(); return; }
  const got0 = await equipWeapon(run, weaponWanted); console.log('  weapon equipped', got0);
  await run.snap('weapon-equipped');
  await spawnCamp(run, +(opt('mob', 0))); await consoleClose(run); await sleep(1500);
  const caps = { hover: 2, lock: 3, nums: 8, status: 4, hurt: 3, corpse: 3, bounty: 2, hit: 4 }; const got = {}; const cap = k => (got[k] = (got[k] || 0) + 1) <= caps[k];
  const t0 = Date.now(); let lastHp = null; const lastTargetHp = new Map(); let lastSnap = 0;
  while (Date.now() - t0 < MINUTES * 60000) {
    const p = await run.probe(); if (!p || !p.me) { await sleep(200); continue; }
    const me = p.me; const here = await run.css(me.sx, me.sy);
    if (lastHp !== null && me.hp < lastHp - 1 && cap('hurt')) await run.snap('hurt-vignette', { note: `hp ${lastHp}->${me.hp}/${me.maxHp}` });
    lastHp = me.hp;
    if (me.bounty > 0 && cap('bounty')) await run.snap('bounty-self', { crop: [here.x, here.y - 60, 360, 260], note: 'bounty ' + me.bounty });
    if (me.status === 2) { await run.snap('death'); await sleep(1500); await run.snap('death-later'); break; }
    const corpse = (p.props || []).find(q => q.kind === 4); if (corpse && cap('corpse')) { const c = await run.css(corpse.sx, corpse.sy); await run.snap('corpse', { crop: [c.x, c.y, 360, 260] }); }
    const foes = (p.actors || []).filter(a => a.kind !== 0 && a.kind !== 4 && a.status === 1).map(a => ({ a, d: Math.hypot(a.sx - me.sx, a.sy - me.sy) })).sort((x, y) => x.d - y.d);
    for (const f of foes) { // any creature whose hp just dropped: its damage number is on screen right now
      const prev = lastTargetHp.get(f.a.id); lastTargetHp.set(f.a.id, f.a.hp);
      if (prev !== undefined && f.a.hp < prev && Date.now() - lastSnap > 350 && cap('nums')) { lastSnap = Date.now(); const fc = await run.css(f.a.sx, f.a.sy); await run.snap('damage-numbers', { crop: [fc.x, fc.y - 40, 420, 300], note: `hp ${prev}->${f.a.hp} kind ${f.a.kind}` }); }
    }
    if (!foes.length) { if (Date.now() - t0 > 60000) break; await sleep(400); continue; }
    const locked = me.lock >= 0 ? foes.find(f => f.a.id === me.lock) : null;
    const tgt = locked || foes.find(f => f.a.kind !== 3) || foes[0];
    const m = tgt.a, c = await run.css(m.sx, m.sy);
    if ((m.effects || m.sig) && cap('status')) await run.snap('mob-status', { crop: [c.x, c.y - 30, 360, 260], note: `effects ${m.effects} sig ${m.sig}` });
    const reach = [0, 3, 4, 5].includes(me.weapon) ? 120 : 520; // melee weapons must close in; the wand and bow shoot
    if (tgt.d > reach) { await stepToward(run, me, m.sx, m.sy, reach < 200 ? 220 : 400); continue; } // approach (also pulls an idle camp)
    if (got.hover < caps.hover) { cap('hover'); await run.hoverAt(m.sx, m.sy); await sleep(250); await run.snap('hover-ring', { crop: [c.x, c.y - 20, 360, 260] }); }
    await run.leftClickAt(m.sx, m.sy, 40);
    if (DEMO.includes('hitzone') && cap('hit')) { await sleep(60); await run.snap('swing-hitzone', { crop: [here.x, here.y, 560, 400] }); }
    const p2 = await run.probe();
    if (p2 && p2.me && p2.me.lock >= 0 && cap('lock')) { const lk = p2.actors.find(a => a.id === p2.me.lock); const lc = lk ? await run.css(lk.sx, lk.sy) : c; await run.snap('lock-ring', { crop: [lc.x, lc.y - 20, 360, 260], note: 'lock ' + p2.me.lock }); }
    await sleep(100);
  }
  console.log('  triggers hit:', JSON.stringify(got));
  await run.snap('final');
  await run.finish();
};

// A chest from the console: its ring and label, the choice panel, the keyboard focus, one pick.
scenarios['training-chest'] = async (variant) => {
  const faction = FACTIONS[variant || 'frost'] ?? 3;
  const run = await open('tchest', { training: true, auto: 0, faction });
  const start = await startTraining(run); if (!start || !start.practice) { console.log('  training not confirmed'); await run.snap('not-training'); await run.finish(); return; }
  await consoleOpen(run);
  await clickConsole(run, 'RandomChestAction', { wait: 1200 });
  await run.snap('console-after-chest-click');
  await consoleClose(run);
  let p = await run.waitFor(q => q.chests && q.chests.length > 0, 10000);
  console.log('  chests', p && JSON.stringify(p.chests));
  await run.snap('chest-spawned');
  for (let i = 0; i < 12 && p; i++) {
    const ch = p.chests[0]; if (!ch) break;
    const names = await run.uiNames();
    if (names.includes('Option0')) break;
    await run.rightClickAt(ch.sx, ch.sy); await sleep(1200);
    p = await run.probe();
  }
  await sleep(500);
  p = await run.probe();
  if (p && p.chests[0]) { const c = await run.css(p.chests[0].sx, p.chests[0].sy); await run.snap('chest-near-ring', { crop: [c.x, c.y, 420, 300], note: 'reward chest ring and label' }); }
  await run.snap('chest-panel');
  const side = { x: W - 360, y: 40, w: 348, h: H - 330 };
  await run.page.screenshot({ path: path.join(run.dir, 'chest-panel-crop.png'), clip: { x: W - 340, y: 50, width: 330, height: H * 0.62 } });
  await run.page.keyboard.press('c'); await sleep(500); await run.snap('chest-keyboard-focus');
  await run.page.keyboard.press('Escape'); await sleep(500); await run.snap('chest-escape-gives-focus-back');
  await run.clickUi('Option0', { wait: 1200 }); await run.snap('chest-picked');
  await sleep(3000); await run.snap('chest-after');
  await run.finish();
};

// Reconnaissance: where the quest givers, merchants, camps and bots are on the full map right after the run starts.
scenarios.recon = async () => {
  const run = await open('recon', { faction: 1 });
  await startArena(run); await sleep(8000);
  const p = await run.probe();
  console.log(JSON.stringify({ me: p.me, quests: p.quests, merchants: p.merchants, camps: p.camps, props: (p.props || []).slice(0, 12), actors: (p.actors || []).map(a => [a.id, a.kind, a.mob, a.faction, a.hp, Math.round(a.x), Math.round(a.y)]) }));
  await run.snap('recon'); await run.finish();
};

// Walk to the nearest quest giver on the full map, talk (F), accept (Enter), then open the journal; captures the marks on the way.
async function walkNear(run, wx, wy, within = 140, maxMs = 120000) {
  const t0 = Date.now(); let last = 0;
  while (Date.now() - t0 < maxMs) {
    const p = await run.probe(); if (!p || !p.me) { await sleep(300); continue; }
    if (Math.hypot(p.me.x - wx, p.me.y - wy) < within) return p;
    if (p.me.status !== 1) return p;
    if (Date.now() - last > 5000) { await run.walkWorld(wx, wy); last = Date.now(); }
    await sleep(400);
  }
  return null;
}
scenarios.quest = async (variant) => {
  const faction = FACTIONS[variant || 'sentenced'] ?? 1;
  const run = await open('quest-' + (variant || 'sentenced'), { faction });
  await startArena(run); await sleep(7000);
  let p = await run.probe();
  const me = p.me; const giver = p.quests.map(q => ({ q, d: Math.hypot(q.x - me.x, q.y - me.y) })).sort((a, b) => a.d - b.d)[0].q;
  console.log('  nearest giver', giver.def, 'at', giver.x, giver.y, 'from', me.x, me.y);
  p = await walkNear(run, giver.x, giver.y, 300);
  p = await run.probe();
  const g = p.actors && p.actors.find(a => a.kind === 4);
  const gc = g ? await run.css(g.sx, g.sy) : await run.css(960, 400);
  await run.snap('giver-offer-mark', { crop: [gc.x, gc.y - 40, 420, 300], note: 'quest giver ! mark (offer not accepted)' });
  p = await walkNear(run, giver.x, giver.y, 90);
  await run.snap('giver-near');
  // Legacy talks to a giver with F and accepts with Enter; this client accepts from the journal (J): select the offer, then Accept.
  await run.page.keyboard.press('f'); await sleep(700);
  await run.page.keyboard.press('j'); await sleep(900);
  await run.clickUi('QuestRow' + giver.id, { wait: 900 });
  const names = await run.uiNames(); console.log('  journal buttons', names.filter(n => !/^QuestRow/.test(n)).join(','));
  await run.snap('journal-offer-selected');
  const acc = names.find(n => /accept/i.test(n)); if (acc) await run.clickUi(acc, { wait: 1200 });
  await run.snap('journal-after-accept');
  await run.clickUi('TrackQuest', { wait: 800 }); await run.snap('journal-tracked');
  await run.page.keyboard.press('Escape'); await sleep(700);
  p = await run.probe(); console.log('  quest rows', JSON.stringify(p.quests.filter(q => q.accepted || q.canAccept)));
  const g2 = p.actors && p.actors.find(a => a.kind === 4); const g2c = g2 ? await run.css(g2.sx, g2.sy) : gc;
  await run.snap('giver-accepted-mark', { crop: [g2c.x, g2c.y - 40, 420, 300], note: 'quest ? mark once accepted' });
  // step away so the giver mark is seen without the player's cluster on top of it
  await run.walkWorld(giver.x - 500, giver.y + 100); await sleep(4000);
  p = await run.probe(); const g3 = p.actors && p.actors.find(a => a.kind === 4);
  if (g3) { const c3 = await run.css(g3.sx, g3.sy); await run.snap('giver-accepted-mark-clear', { crop: [c3.x, c3.y - 40, 420, 300] }); }
  await run.snap('world-after-accept');
  await run.finish();
};

// ---- vision fade: a real departure, recorded with the CDP screencast (display-rate frames) -----------------------------------------------------
class Cast {
  constructor(run, keepMs = 0) { this.run = run; this.frames = []; this.t0 = Date.now(); this.keepMs = keepMs; }
  async start() {
    this.cdp = await this.run.ctx.newCDPSession(this.run.page);
    this.cdp.on('Page.screencastFrame', async f => { const t = Date.now() - this.t0; this.frames.push({ t, data: f.data }); if (this.keepMs) while (this.frames.length && this.frames[0].t < t - this.keepMs) this.frames.shift(); try { await this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (_) { } });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1, maxWidth: 1600, maxHeight: 900 });
  }
  async stop() { try { await this.cdp.send('Page.stopScreencast'); } catch (_) { } }
  save(dir, stem, from, to, crop) { // frames within [from, to] ms on this recorder's clock
    const out = []; let k = 0;
    for (const f of this.frames) if (f.t >= from && f.t <= to) { const file = path.join(dir, `${stem}-${String(k++).padStart(2, '0')}-t${f.t}.jpg`); fs.writeFileSync(file, Buffer.from(f.data, 'base64')); out.push(file); }
    return out;
  }
}

// Staging: a creature sits in sight, the player walks directly away until it leaves what the server delivers; the screencast records
// the whole walk and the probe timestamps the moment the creature's id disappears from the delivered actors.
scenarios['fade-creature'] = async (variant) => {
  const run = await open('fade-creature', { faction: FACTIONS[variant || 'plague'] ?? 2 });
  await startArena(run); await sleep(6000);
  let p = await run.probe();
  const near = () => (p.actors || []).filter(a => a.kind === 1 && a.status === 1).sort((a, b) => Math.hypot(a.x - p.me.x, a.y - p.me.y) - Math.hypot(b.x - p.me.x, b.y - p.me.y))[0];
  let tgt = near();
  if (!tgt) { console.log('  no creature in sight at spawn'); await run.snap('no-creature'); await run.finish(); return; }
  console.log('  target', tgt.mob, 'distance', Math.round(Math.hypot(tgt.x - p.me.x, tgt.y - p.me.y)), 'me', Math.round(p.me.x), Math.round(p.me.y));
  await run.snap('before-walk-away');
  const cast = new Cast(run, 9000); await cast.start();
  const log = []; let gone = null; const t0 = Date.now(); const track = { x: tgt.x, y: tgt.y }; let lastWalk = 0;
  while (Date.now() - t0 < 60000) {
    p = await run.probe(); if (!p || !p.me) { await sleep(40); continue; }
    if (p.me.status !== 1) break;
    // creature handles are renewed every snapshot, so follow it by type and position instead of by id
    const cand = (p.actors || []).filter(x => x.kind === 1 && x.mob === tgt.mob && Math.hypot(x.x - track.x, x.y - track.y) < 160).sort((u, v) => Math.hypot(u.x - track.x, u.y - track.y) - Math.hypot(v.x - track.x, v.y - track.y))[0];
    const t = Date.now() - cast.t0; if (cand) { track.x = cand.x; track.y = cand.y; }
    log.push({ t, present: !!cand, d: cand ? Math.round(Math.hypot(cand.x - p.me.x, cand.y - p.me.y)) : null, sx: cand && Math.round(cand.sx), sy: cand && Math.round(cand.sy) });
    const seen = [...log].reverse().find(l => l.present);
    if (!cand && gone === null && seen && seen.d < 450) { // it vanished close by (died, or the track hopped): follow the nearest creature instead
      const other = (p.actors || []).filter(x => x.kind === 1 && x.status === 1).sort((u, v) => Math.hypot(u.x - p.me.x, u.y - p.me.y) - Math.hypot(v.x - p.me.x, v.y - p.me.y))[0];
      if (other) { tgt = other; track.x = other.x; track.y = other.y; log.length = 0; }
    }
    else if (!cand && gone === null) { gone = t; console.log('  creature left delivery at', t, 'ms; last distance', seen && seen.d); await sleep(1300); break; }
    if (Date.now() - lastWalk > 3500) { // straight away from the creature, as far as the map allows
      const dx = p.me.x - track.x, dy = p.me.y - track.y, n = Math.hypot(dx, dy) || 1;
      await run.walkWorld(Math.max(150, Math.min(4950, p.me.x + dx / n * 2500)), Math.max(150, Math.min(4950, p.me.y + dy / n * 2500))); lastWalk = Date.now();
    }
    await sleep(30);
  }
  await cast.stop();
  fs.writeFileSync(path.join(run.dir, 'fade-timeline.json'), JSON.stringify(log));
  if (gone !== null) {
    const files = cast.save(run.dir, 'fade', gone - 700, gone + 1200);
    const last = [...log].reverse().find(l => l.present);
    console.log('  fade frames', files.length, 'last seen at', last && [last.sx, last.sy]);
    fs.writeFileSync(path.join(run.dir, 'fade-meta.json'), JSON.stringify({ goneAtMs: gone, lastSeen: last, frames: files.map(f => path.basename(f)) }));
  } else console.log('  the creature never left delivery within the walk');
  await run.finish();
};

// The player counterpart: the harness cannot make a bot leave, so the opt-in `vision.fadeDemo=1` flag withholds the nearest remote player for
// 2.5 s every 6 s (the client then sees exactly what a real departure looks like: the actor stops being delivered).
scenarios['fade-player'] = async () => {
  const run = await open('fade-player', { faction: 3, query: '&vision.fadeDemo=1' });
  await startArena(run); await sleep(8000);
  const cast = new Cast(run, 6000); await cast.start();
  const t0 = Date.now(); let prev = new Map(); let events = 0; const deps = []; let lastWalk = 0; let wp = 0;
  const route = [[2560, 2560], [1800, 2200], [3300, 2200], [2560, 3300], [2560, 1800]];
  while (Date.now() - t0 < Math.min(MINUTES, 4) * 60000 && events < 2) {
    const p = await run.probe(); if (!p || !p.me) { await sleep(40); continue; }
    if (p.me.status !== 1) break;
    if (Date.now() - lastWalk > 9000) { const r = route[wp++ % route.length]; await run.walkWorld(r[0], r[1]); lastWalk = Date.now(); } // look for bots around the middle
    const t = Date.now() - cast.t0; const cur = new Map((p.actors || []).filter(a => a.kind === 0 && a.status === 1).map(a => [a.id, a]));
    for (const [id, a] of prev) if (!cur.has(id)) { // a living player stopped being delivered
      events++; deps.push({ id, t, sx: Math.round(a.sx), sy: Math.round(a.sy) }); await sleep(1000);
      cast.save(run.dir, 'fade' + events, t - 700, t + 1000); console.log('  departure', JSON.stringify(deps[deps.length - 1]));
      await sleep(7000); break; // let the demo cycle pass before looking for the next
    }
    prev = cur; await sleep(40);
  }
  await cast.stop();
  fs.writeFileSync(path.join(run.dir, 'fade-meta.json'), JSON.stringify(deps));
  await run.finish();
};

// The Tab map at this window size (run once per resolution): the counters block must fit its column.
scenarios.tabmap = async () => {
  const run = await open('tabmap-' + W + 'x' + H, { faction: 3 });
  await startArena(run); await sleep(7000);
  await run.page.keyboard.down('Tab'); await sleep(900);
  await run.snap('tab-map');
  await run.page.keyboard.up('Tab'); await sleep(400);
  await run.finish();
};

// Escape on every in-match panel: the button list before, with the panel open, and after Escape must match (the panel really closed).
scenarios['escape-match'] = async () => {
  const run = await open('escape-match', { faction: 3 });
  await startArena(run); await sleep(7000);
  const report = [];
  const tryPanel = async (name, open) => {
    const before = await run.uiNames(); await open(); await sleep(900);
    const during = await run.uiNames(); await run.snap('open-' + name);
    await run.page.keyboard.press('Escape'); await sleep(800);
    const after = await run.uiNames(); await run.snap('after-escape-' + name);
    report.push({ name, opened: JSON.stringify(before) !== JSON.stringify(during), closedByEscape: JSON.stringify(before.sort()) === JSON.stringify(after.sort()), before: before.length, during: during.length, after: after.length });
  };
  await tryPanel('help', () => run.page.keyboard.press('h'));
  await tryPanel('settings', () => run.clickUi('Settings', { wait: 600 }));
  await tryPanel('journal', () => run.page.keyboard.press('j'));
  await tryPanel('build', () => run.page.keyboard.press('b'));
  fs.writeFileSync(path.join(run.dir, 'escape-report.json'), JSON.stringify(report, null, 1)); console.log(report);
  await run.finish();
};

// Big hits and death: the Archon camp hits hard, so the hurt vignette is strong; the rolling screencast keeps the last 3 s so the frames
// around the first hits, the death and the death line are dumped after the fact.
scenarios.vignette = async (variant) => {
  const run = await open('vignette', { training: true, auto: 0, faction: FACTIONS[variant || 'frost'] ?? 3 });
  const start = await startTraining(run); if (!start || !start.practice) { console.log('  training not confirmed'); await run.finish(); return; }
  await spawnCamp(run, +(opt('mob', 29))); await consoleClose(run); await sleep(1200);
  const cast = new Cast(run, 3000); await cast.start();
  const t0 = Date.now(); let lastHp = null, dumps = 0, deadDumped = false, peaks = 0, lastPeak = -9999; const hits = [];
  while (Date.now() - t0 < Math.min(MINUTES, 3) * 60000) {
    const p = await run.probe(); if (!p || !p.me) { await sleep(50); continue; }
    const me = p.me, now = Date.now() - cast.t0;
    if (p.vignette > 0.05 && peaks < 3 && now - lastPeak > 1500) { peaks++; lastPeak = now; await run.snap('hurt-vignette-peak', { note: `vignette ${p.vignette} hitFxOnMe ${p.hitFxOnMe} last ${p.lastAmountOnMe}` }); }
    if (lastHp !== null && me.hp < lastHp - 1 && me.status === 1 && dumps < 3) { dumps++; hits.push({ t: now, from: lastHp, to: me.hp, max: me.maxHp }); await sleep(380); cast.save(run.dir, 'hit' + dumps, now - 150, now + 380); console.log('  hit', lastHp, '->', me.hp); }
    lastHp = me.hp;
    if (me.status === 2 && !deadDumped) { deadDumped = true; await sleep(300); cast.save(run.dir, 'dead-a', now - 400, now + 300); await sleep(1500); await run.snap('death-line-1500ms'); await sleep(2500); await run.snap('death-later'); break; }
    const foes = (p.actors || []).filter(a => a.kind === 1 && a.status === 1).sort((a, b) => Math.hypot(a.sx - me.sx, a.sy - me.sy) - Math.hypot(b.sx - me.sx, b.sy - me.sy));
    if (foes[0]) { const d = Math.hypot(foes[0].sx - me.sx, foes[0].sy - me.sy); if (d > 110) await stepToward(run, me, foes[0].sx, foes[0].sy, 250); else await run.leftClickAt(foes[0].sx, foes[0].sy - 10, 30); } // walk in, then provoke it (camps only fight when disturbed)
    await sleep(120);
  }
  await cast.stop(); fs.writeFileSync(path.join(run.dir, 'hits.json'), JSON.stringify(hits));
  await run.snap('final'); await run.finish();
};

// Death in the full map: the rolling screencast keeps the last 4 s, so the frames before and after the fall (death X, the dead body,
// the death line, then the results card) are dumped after the fact.
scenarios.death = async (variant) => {
  const faction = FACTIONS[variant || 'sentenced'] ?? 1;
  const run = await open('death-' + (variant || 'sentenced'), { faction });
  await startArena(run); await sleep(6000);
  const cast = new Cast(run, 5000); await cast.start();
  const t0 = Date.now(); let fell = null;
  while (Date.now() - t0 < MINUTES * 60000) {
    const p = await run.probe(); if (!p || !p.me) { await sleep(50); continue; }
    const now = Date.now() - cast.t0;
    if (p.me.status !== 1 || p.result) { fell = { t: now, status: p.me.status, result: p.result, x: p.me.sx, y: p.me.sy }; break; }
    const foes = (p.actors || []).filter(a => (a.kind === 1 || a.kind === 0) && a.status === 1).sort((a, b) => Math.hypot(a.sx - p.me.sx, a.sy - p.me.sy) - Math.hypot(b.sx - p.me.sx, b.sy - p.me.sy));
    if (foes[0]) { const d = Math.hypot(foes[0].sx - p.me.sx, foes[0].sy - p.me.sy); if (d > 110) await stepToward(run, p.me, foes[0].sx, foes[0].sy, 250); else await run.leftClickAt(foes[0].sx, foes[0].sy - 10, 30); }
    else await stepToward(run, p.me, 960 + 400, 540, 250);
    await sleep(60);
  }
  if (fell) {
    console.log('  fell', JSON.stringify(fell));
    await sleep(2500); cast.save(run.dir, 'death', Math.max(0, fell.t - 3500), fell.t + 2200);
    await run.snap('death-after-2s5');
  }
  await cast.stop(); await run.finish();
};

// Traders: walk to the nearest delivered merchant (the Tab map shows them), open the journal's Traders page and take a look at both kinds.
scenarios.trader = async (variant) => {
  const faction = FACTIONS[variant || 'plague'] ?? 2;
  const run = await open('trader-' + (variant || 'plague'), { faction });
  await startArena(run); await sleep(6000);
  let p = await run.probe();
  // the spawn is random: if no merchant is delivered, wander a little (merchants appear in the trade state once in sight)
  for (let i = 0; i < 12 && !(p.merchants && p.merchants.length); i++) { await run.walkWorld(1500 + (i % 4) * 700, 1500 + Math.floor(i / 4) * 900); await sleep(5000); p = await run.probe(); }
  console.log('  merchants', JSON.stringify(p.merchants));
  if (p.merchants && p.merchants.length) {
    const m = p.merchants[0]; await walkNear(run, m.x, m.y, 100, 60000);
    p = await run.probe(); const mm = p.merchants && p.merchants[0]; if (mm) { const c = await run.css(mm.sx, mm.sy); await run.snap('trader-in-world', { crop: [c.x, c.y - 40, 420, 300], note: JSON.stringify(mm) }); }
  }
  await run.page.keyboard.press('j'); await sleep(900);
  await run.clickUi('TradersTab', { wait: 900 }); await run.snap('traders-page');
  const names = await run.uiNames(); console.log('  buttons', names.filter(n => /Merchant|Choice/.test(n)).join(','));
  await run.clickUi('Merchant_0', { wait: 800 }); await run.snap('traders-merchant-selected');
  await run.page.keyboard.press('Escape'); await sleep(700);
  await run.finish();
};

const names = process.argv.slice(2).filter((a, i, all) => all[i - 1] === '--scenario').join(',').split(',').filter(Boolean);
if (args.includes('--list')) { console.log(Object.keys(scenarios).join('\n')); process.exit(0); }
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let failed = false;
  for (const n of names) {
    const [base, variant] = n.split(':');
    if (!scenarios[base]) { console.error('unknown scenario', n); failed = true; continue; }
    console.log('scenario', n, `${W}x${H}`);
    try { await scenarios[base](variant); } catch (e) { console.error('scenario failed:', n, e && e.stack || e); failed = true; }
  }
  process.exit(failed ? 1 : 0);
})();
