#!/usr/bin/env node
'use strict';
// Real-browser measurement of the attack pause mirror (docs/rework/RANGED_PAUSE_PREDICTION.md): the local player walks and shoots with a
// bow or a wand, and the pull-back the server forces on the predicted walk is read from the opt-in latency trace (window.__rhLatency).
//
//   node client-unity/UnityProject/Tools/pause-proof.cjs --weapon 2 --predict 1 --shots 24 [--runtime arena|fp|training]   (fp: the --first-playable server, Holy only, weapons on the floor)
//        [--url http://127.0.0.1:8297/] [--ws ws://127.0.0.1:7997/ws] [--faction 0..4] [--out /tmp/pause-proof] [--rtt 0]
//
// weapon: 1 bow, 2 wand. predict: 1 is the build's default, 0 loads the page with ?pausepredict=0 (loopback diagnostics only), which is the
// "before" the mirror removes. The trace's presentRecon mark carries the reconciliation counters each frame; the error a snapshot sample
// found between the predicted walk and the server (the distance the model was pulled back) is the counter's step. Every shot is a press of
// the left mouse button (a real click, like a player) while a movement key is held; the report sums the pull-back in [press, press + 1.2 s]
// per shot, against walking windows with no shot as the baseline.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const weaponWanted = Number(opt('weapon', 2));
const predict = opt('predict', '1') !== '0';
const shotsWanted = Number(opt('shots', 24));
const runtime = opt('runtime', 'arena');
const base = opt('url', 'http://127.0.0.1:8297/');
const ws = opt('ws', 'ws://127.0.0.1:7997/ws');
const faction = Number(opt('faction', 3));
const out = path.resolve(opt('out', '/tmp/pause-proof'));
const W = 1600, H = 900;
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WEAPON = ['sword', 'bow', 'wand', 'shield', 'axe', 'fists'];

function legacyScale(w, h) { const sw = w / h <= 21 / 9 ? w : Math.floor(h * 21 / 9); return Math.min(1.5, Math.max(0.8, Math.min(sw / 1280, h / 800))); }
function launchGeometry(w, h) {
  const s = legacyScale(w, h);
  const panel = (px, py) => ({ x: (12 + px) * s, y: (12 + py) * s });
  return { s, play: panel(14 + 95, 466 + 24), training: panel(14 + 198 + 52, 466 + 24) };
}

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = [], errors = [];
  page.on('console', m => { logs.push(`[${m.type()}] ${m.text()}`); if (m.type() === 'error' && !/404|\.mp3|audio/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.__rhLatency = { events: [], recording: true }; });
  const profile = `pz${weaponWanted}${predict ? 'p' : 'n'}${Math.random().toString(36).slice(2, 8)}`.slice(0, 16);
  let q = `?profile=${profile}&faction=${faction}&scenario.probe=1&fx.quality=low&pausepredict=${predict ? 1 : 0}`;
  if (runtime === 'training') q += `&accountApi=${encodeURIComponent(new URL(ws).origin.replace('ws:', 'http:') + '/api')}&trainingServer=${encodeURIComponent(ws)}&server=${encodeURIComponent(ws)}&auto=0`; // the practice page is an ordinary page (training is refused in diagnostic mode)
  else q += `&diagnostic=1&token=t1&server=${encodeURIComponent(ws)}&auto=1`;
  await page.goto(base + q, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 120000 });
  await sleep(10000);

  const probe = () => page.evaluate(() => window.__rhProbe || null).catch(() => null);
  const events = [];
  const timer = setInterval(async () => {
    try { const e = await page.evaluate(() => { const t = window.__rhLatency; return t ? t.events.splice(0, t.events.length) : []; }); for (const x of e) events.push(x); } catch (_) { /* page closing */ }
  }, 100);

  if (runtime === 'training') {
    const g = launchGeometry(W, H);
    await page.mouse.click(g.training.x, g.training.y, { delay: 80 });
  } else if (runtime === 'arena') {
    await page.keyboard.press('1'); await sleep(600);
    const s = legacyScale(W, H), uiW = W / s, uiH = H / s;
    const pSide = Math.min(780, Math.max(260, Math.floor(Math.min(uiH - 44 - 12 - 124, uiW - 340 - 24 - 12 - 8))));
    const pFrame = pSide + 8, pTotal = pFrame + 12 + 340, pColH = 40 + 12 + pFrame + 12 + 52;
    const pBx = Math.floor((uiW - pTotal) / 2), pBy = Math.max(44, Math.floor((uiH - pColH) / 2 + 11));
    await page.mouse.click((pBx + pFrame + 12 + 12 + 158) * s, (pBy + 12 + 23) * s, { delay: 80 });
  }
  let p = null;
  for (let i = 0; i < 360 && !(p && p.me && p.session !== false && p.state === 'InMatch'); i++) { await sleep(250); p = await probe(); }
  if (!p || !p.me) await page.screenshot({ path: path.join(out, 'not-in-match.png') });
  if (!p || !p.me) throw new Error('never reached the match: ' + JSON.stringify(p && { state: p.state, session: p.session, training: p.training, ui: (p.ui || []).map(u => u.n).slice(0, 20) }));
  console.log(`in match: state ${p.state} me ${JSON.stringify({ x: p.me.x, y: p.me.y, weapon: p.me.weapon })} props ${(p.props || []).filter(z => z.kind === 1).length} weapon props`);
  await sleep(2500);

  const keyWalk = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await sleep(ms); for (const k of keys) await page.keyboard.up(k); };
  const stepToward = async (me, tx, ty, ms = 300) => {
    const dx = tx - me.sx, dy = ty - me.sy, keys = [];
    if (dx > 30) keys.push('d'); else if (dx < -30) keys.push('a');
    if (dy > 30) keys.push('s'); else if (dy < -30) keys.push('w');
    await keyWalk(keys, ms);
  };
  // Equip: walk onto a ground weapon of the wanted kind and take it with F.
  let equipped = false;
  for (let attempt = 0; attempt < 60 && !equipped; attempt++) {
    p = await probe(); if (!p || !p.me) { await sleep(300); continue; }
    if (p.me.weapon === weaponWanted) { equipped = true; break; }
    const prop = (p.props || []).filter(z => z.kind === 1 && z.weapon === weaponWanted).map(z => ({ z, d: Math.hypot(z.x - p.me.x, z.y - p.me.y) })).sort((a, b) => a.d - b.d)[0];
    if (!prop) { if (attempt % 5 === 0) console.log(`  searching: me (${p.me.x.toFixed(0)}, ${p.me.y.toFixed(0)}) weapon props in view ${JSON.stringify((p.props || []).filter(z => z.kind === 1).map(z => z.weapon))}`); await keyWalk([['d', 'd', 's', 's', 'a', 'a', 'a', 'a', 'w', 'w', 'w', 'w', 'd', 'd'][attempt % 14]], 1500); continue; }
    console.log(`  going for ${WEAPON[weaponWanted]} at (${prop.z.x}, ${prop.z.y}), ${prop.d.toFixed(0)} u away`);
    for (let i = 0; i < 14; i++) {
      const pp = await probe(); const near = (pp.props || []).find(z => z.kind === 1 && Math.hypot(z.x - prop.z.x, z.y - prop.z.y) < 6);
      if (!near || Math.hypot(near.x - pp.me.x, near.y - pp.me.y) < 44) break;
      await stepToward(pp.me, near.sx, near.sy, 320);
    }
    await page.keyboard.press('f'); await sleep(800);
  }
  p = await probe();
  if (!p || !p.me || p.me.weapon !== weaponWanted) {
    fs.writeFileSync(path.join(out, 'no-weapon.json'), JSON.stringify(p));
    console.log(`COULD NOT EQUIP ${WEAPON[weaponWanted]}: me.weapon ${p && p.me && p.me.weapon}; props ${JSON.stringify((p && p.props || []).filter(z => z.kind === 1).map(z => z.weapon))}`);
    clearInterval(timer); await browser.close(); process.exit(2);
  }
  console.log(`equipped ${WEAPON[weaponWanted]}; predict ${predict}`);

  // Let the page settle, then measure: baseline walking windows first (no shots), then shots while walking.
  const cssScale = async () => page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); const pr = window.__rhProbe; return pr && pr.sw ? r.width / pr.sw : 1; });
  const now = () => page.evaluate(() => performance.now());
  const presses = [], walkWindows = [];
  let dir = ['d', 'a'], di = 0, lastPos = null, stuck = 0;
  async function walkAndMaybeShoot(shoot) {
    const k = dir[di % 2];
    await page.keyboard.down(k);
    const t0 = await now();
    await sleep(500);
    let pressAt = null;
    if (shoot) {
      const pr = await probe(); const sc = await cssScale();
      // Aim ahead along the walk, a screen-space distance away from the player.
      const tx = pr.me.sx + (k === 'd' ? 260 : -260), ty = pr.me.sy;
      await page.mouse.move(tx * sc, ty * sc);
      pressAt = await now();
      await page.mouse.down();
      await sleep(90);
      await page.mouse.up();
      presses.push(pressAt);
    } else walkWindows.push(t0 + 300);
    await sleep(1300);
    await page.keyboard.up(k);
    const pr = await probe();
    if (pr && pr.me) {
      if (lastPos && Math.hypot(pr.me.x - lastPos.x, pr.me.y - lastPos.y) < 60) stuck++; else stuck = 0;
      lastPos = { x: pr.me.x, y: pr.me.y };
      if (stuck >= 1) { di++; stuck = 0; }
    }
    await sleep(150);
  }
  // baseline: 8 walking windows with no shot
  for (let i = 0; i < 8; i++) await walkAndMaybeShoot(false);
  let guard = 0;
  while (presses.length < shotsWanted && guard++ < shotsWanted * 3) await walkAndMaybeShoot(true);
  await sleep(1500);
  clearInterval(timer);
  try { const e = await page.evaluate(() => { const t = window.__rhLatency; return t ? t.events.splice(0, t.events.length) : []; }); for (const x of e) events.push(x); } catch (_) { /* ignore */ }

  // ---- analysis --------------------------------------------------------------------------------------------------------------------
  const recon = events.filter(e => e.kind === 'presentRecon').map(e => ({ at: e.at, snaps: e.moveSeq, n: e.x, sum: e.y }));
  const errAt = []; // one entry per reconciliation sample: time and error
  for (let i = 1; i < recon.length; i++) {
    const dn = recon[i].n - recon[i - 1].n, ds = recon[i].sum - recon[i - 1].sum;
    if (dn === 1 && ds >= 0) errAt.push({ at: recon[i].at, err: ds });
    else if (dn > 1) errAt.push({ at: recon[i].at, err: ds / dn, multi: dn });
  }
  const snaps = recon.length ? recon[recon.length - 1].snaps - recon[0].snaps : 0;
  const windup = events.filter(e => e.kind === 'ownWindup').map(e => ({ at: e.at, ms: e.x, weapon: e.moveSeq }));
  const stagger = events.filter(e => e.kind === 'ownStagger').length, cancel = events.filter(e => e.kind === 'ownCancel').length;
  const windowStats = (t0, len) => {
    const xs = errAt.filter(e => e.at >= t0 && e.at < t0 + len);
    return { sum: xs.reduce((a, e) => a + e.err, 0), max: xs.reduce((a, e) => Math.max(a, e.err), 0), n: xs.length };
  };
  const per = presses.map(t => ({ t, ...windowStats(t, 1200) }));
  const base0 = walkWindows.map(t => windowStats(t, 1200));
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const report = {
    weapon: WEAPON[weaponWanted], predict, runtime, shots: presses.length, ownWindupFx: windup.length, windupMs: windup.map(w => w.ms).slice(0, 5), staggerFx: stagger, cancelFx: cancel,
    reconSamples: errAt.length, snaps,
    shotWindow: { pullBackSumMean: +mean(per.map(x => x.sum)).toFixed(2), pullBackSumMedian: +median(per.map(x => x.sum)).toFixed(2), pullBackSumMax: +Math.max(...per.map(x => x.sum)).toFixed(2),
      maxSingleSampleMean: +mean(per.map(x => x.max)).toFixed(2), maxSingleSampleMax: +Math.max(...per.map(x => x.max)).toFixed(2), samplesPerShot: +mean(per.map(x => x.n)).toFixed(1) },
    walkOnlyBaseline: { windows: base0.length, pullBackSumMean: +mean(base0.map(x => x.sum)).toFixed(2), pullBackSumMedian: +median(base0.map(x => x.sum)).toFixed(2), maxSingleSampleMax: +Math.max(...base0.map(x => x.max)).toFixed(2) },
    perShotSums: per.map(x => +x.sum.toFixed(1)),
    consoleErrors: errors.length,
  };
  fs.writeFileSync(path.join(out, `pause-${WEAPON[weaponWanted]}-${predict ? 'on' : 'off'}.json`), JSON.stringify({ report, per, base0, errAt }, null, 1));
  fs.writeFileSync(path.join(out, `pause-${WEAPON[weaponWanted]}-${predict ? 'on' : 'off'}-console.log`), logs.join('\n') + '\n');
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
