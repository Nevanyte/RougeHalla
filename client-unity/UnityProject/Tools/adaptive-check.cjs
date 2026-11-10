#!/usr/bin/env node
// Verifies the adaptive quality controller in a real browser match (no quality= parameter, so the default adaptive mode runs):
// logs the quality row the player publishes (window.__rhPerf.row.preset) with timestamps and the rAF cadence while the page's CPU is
// throttled (CDP Emulation.setCPUThrottlingRate) to force missed frames and then released.
//
//   node adaptive-check.cjs --url http://127.0.0.1:8107/cur/ --out <json> [--res 2560x1440] [--throttle 6] [--vsync on|off]
//        [--phases 20,25,40]    seconds: free run (probe + start row), throttled, released
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readyPoint } = require('./perf-matrix.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parse(argv) {
  const o = { url: null, out: null, res: [2560, 1440], throttle: 6, vsync: 'on', phases: [20, 25, 40], server: 'ws://127.0.0.1:7807/ws' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--url') o.url = v(); else if (a === '--out') o.out = v(); else if (a === '--res') o.res = v().split('x').map(Number);
    else if (a === '--throttle') o.throttle = +v(); else if (a === '--vsync') o.vsync = v(); else if (a === '--phases') o.phases = v().split(',').map(Number);
    else throw new Error('unknown argument ' + a);
  }
  if (!o.url) throw new Error('--url is required');
  return o;
}

async function main() {
  const o = parse(process.argv.slice(2)); const [W, H] = o.res;
  const chromium = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(os.homedir(), '.codex/tools/rougehalla-stage2/browser/node_modules/playwright')).chromium;
  const args = ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-features=Metal', '--autoplay-policy=no-user-gesture-required'];
  if (o.vsync === 'off') args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
  const browser = await chromium.launch({ headless: false, args });
  const result = { url: o.url, res: o.res, throttle: o.throttle, phases: o.phases, browserVersion: browser.version(), load: os.loadavg()[0], rows: [], windows: [], notes: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const states = []; page.on('console', m => { if (m.text().startsWith('[net]')) states.push(m.text()); });
    const u = new URL(o.url);
    for (const [k, v] of Object.entries({ server: o.server, diagnostic: '1', token: 't1', profile: 'adapt' + Date.now().toString(36).slice(-6), faction: '4', perf: '1', auto: '1' })) u.searchParams.set(k, v);
    await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.bringToFront();
    const cdp = await ctx.newCDPSession(page); const { windowId } = await cdp.send('Browser.getWindowForTarget');
    if (W >= 2560) await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
    await page.locator('#unity-loading-bar').waitFor({ state: 'hidden', timeout: 180000 });
    await page.waitForFunction(() => !!window.__rhPerf, undefined, { timeout: 60000 });
    const t0 = Date.now();
    // Poll the published row and the rAF deltas for the whole run.
    await page.evaluate(() => {
      window.__ad = { rows: [], deltas: [], last: performance.now(), t0: performance.now() };
      const tick = t => { window.__ad.deltas.push([t - window.__ad.t0, t - window.__ad.last]); window.__ad.last = t; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      window.__ad.state = []; setInterval(() => { try { window.unityInstance.SendMessage('Frame-time recorder', 'Snapshot', ''); const u = window.__rhPerf.unity; if (u && u.adaptive) window.__ad.state.push([Math.round(performance.now() - window.__ad.t0), u.adaptive.current, u.adaptive.refreshMs, u.adaptive.emaFrame, u.adaptive.emaCpu, u.adaptive.holdS, u.adaptive.probing]); } catch (e) {} }, 1000);
      let prev = null; setInterval(() => { const r = window.__rhPerf.row; const k = r ? r.preset + '/' + r.renderScale + '/' + r.dynamicLights : null; if (k !== prev) { prev = k; window.__ad.rows.push([performance.now() - window.__ad.t0, k]); } }, 100);
    });
    await sleep(4000);
    const rp = readyPoint(W, H);
    for (let k = 0; k < 8; k++) {
      await page.keyboard.press('1'); await sleep(500);
      await page.mouse.click(rp.x, rp.y, { delay: 80 }); await sleep(1500);
      if (states.some(s => /InMatch/.test(s))) break;
    }
    await page.keyboard.press('Escape');
    const mark = async name => { const t = await page.evaluate(() => performance.now() - window.__ad.t0); result.windows.push({ name, atMs: Math.round(t) }); };
    await mark('match');
    await sleep(o.phases[0] * 1000); await mark('throttle-on');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.throttle });
    await sleep(o.phases[1] * 1000); await mark('throttle-off');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await sleep(o.phases[2] * 1000); await mark('end');
    const ad = await page.evaluate(() => window.__ad);
    result.rows = ad.rows; result.state = ad.state;   // [ms, current, refreshMs, emaFrame/refresh, emaCpu/refresh, holdS, probing]
    // Frame statistics per phase from the rAF deltas.
    const bounds = result.windows;
    const stat = (a, b) => { const d = ad.deltas.filter(x => x[0] >= a && x[0] < b).map(x => x[1]).sort((x, y) => x - y); if (!d.length) return null; const p = q => d[Math.min(d.length - 1, Math.floor(q * d.length))];
      return { frames: d.length, p50: +p(.5).toFixed(2), p95: +p(.95).toFixed(2), maxMs: +d[d.length - 1].toFixed(1), over1p5x: +(100 * d.filter(x => x > 1.5 * p(.5)).length / d.length).toFixed(1) }; };
    const named = n => bounds.find(w => w.name === n).atMs;
    result.phaseStats = { free: stat(named('match'), named('throttle-on')), throttled: stat(named('throttle-on'), named('throttle-off')), released: stat(named('throttle-off'), named('end')) };
    result.inMatch = states.some(s => /InMatch/.test(s));
  } catch (e) { result.notes.push('failed: ' + (e.message || e)); }
  finally { await browser.close().catch(() => {}); }
  console.log(JSON.stringify(result, null, 1));
  if (o.out) fs.writeFileSync(o.out, JSON.stringify(result, null, 1));
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 2; });
