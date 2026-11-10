#!/usr/bin/env node
'use strict';
// Indicator gallery capture: drives the serverless UI lab (?uilab=1) of the real WebGL build in headed Chromium and saves one JPEG crop per
// gallery cell and ground (dark Sentenced flagstone, bright Holy temple floor, Frost snow) plus a JSON index. The lab feeds synthetic view data through
// the real presenters (SpriteActorPresenter, OverheadIndicators, WorldMarks, WorldIndicators), freezes time so effects are caught mid-flight,
// and publishes every cell's screen rectangle (window.__rhUiLab, Assets/Plugins/WebGL/RhUiLab.jslib). Nothing here talks to a game server.
//
//   node client-unity/UnityProject/Tools/ui-gallery.cjs --url http://127.0.0.1:8287/ --out docs/rework/evidence/uilab
//        [--grounds dark,bright,snow] [--pages all|3,4,7] [--t 0.2] [--size 1920x1080] [--quality-start 60] [--max-bytes 8200]
//        [--budget 3000000] [--rows P5,S1] [--query "uilab.hide=Authored%20character"] [--allow-software] [--list]
//
// Evidence rules (repo size is tight): JPEG only, every crop at most --max-bytes (quality is lowered per crop until it fits, never below 28), frame-wide
// shots are allowed 8x that, total size checked against --budget (exit 1 when exceeded). The index records the quality each crop ended with.
// Exit code 1 on a browser/console error, an unreadable cell, or a budget overrun.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'));

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback; };
const flag = name => args.includes('--' + name);
const URL_BASE = opt('url', process.env.RH_SHOTS_URL || 'http://127.0.0.1:8287/');
const OUT = path.resolve(opt('out', 'docs/rework/evidence/uilab'));
const [W, H] = opt('size', '1920x1080').split('x').map(Number);
const GROUNDS = opt('grounds', 'dark,bright,snow').split(',');
const GROUND_NAMES = { dark: 'sentenced-flagstone', bright: 'holy-temple-floor', snow: 'frost-snow' };
const T_OVERRIDE = opt('t', null);
const EXTRA_QUERY = opt('query', '');
const Q0 = +opt('quality-start', 60), MAX_BYTES = +opt('max-bytes', 8200), BUDGET = +opt('budget', 3000000), QMIN = 28;
const ROWS = opt('rows', '').split(',').filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitReady(page, timeout = 240000) {
  await page.waitForFunction(() => { const L = window.__rhUiLab; return !!(L && L.ready); }, null, { timeout, polling: 100 });
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__rhUiLab.state)));
}

async function jpeg(page, clip, q) { return page.screenshot({ type: 'jpeg', quality: q, clip }); }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
  const errors = []; const index = []; let total = 0; let overBudget = false;
  try {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    const url = `${URL_BASE.replace(/\/?$/, '/')}?uilab=1&quality=high${T_OVERRIDE !== null ? '&uilab.t=' + T_OVERRIDE : ''}${EXTRA_QUERY ? '&' + EXTRA_QUERY : ''}`;
    console.log('open ' + url);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 60000 });
    let state = await waitReady(page);
    const gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return 'no webgl2'; const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
    if (/swiftshader|llvmpipe|software/i.test(gpu) && !flag('allow-software')) throw new Error(`browser is using a software renderer (${gpu}); pass --allow-software to capture anyway`);
    if (state.screenW !== W || state.screenH !== H) throw new Error(`Unity renders ${state.screenW}x${state.screenH}, wanted ${W}x${H}`);
    if (state.reducedMotion) throw new Error('reduced motion is on: effects would not play');
    const pageCount = state.pageCount;
    if (flag('list')) {
      for (const p of state.pages.slice(0, pageCount)) console.log(`page ${p.index} ${p.name} (${p.shot}${p.fades ? ', vision fades' : ''})`);
      return;
    }
    const all = opt('pages', 'all');
    const wanted = all === 'all' ? null : new Set(all.split(',').map(Number));
    const meta = { url: URL_BASE, size: `${W}x${H}`, gpu, quality: state.quality, orthoSize: state.orthoSize, tOverride: T_OVERRIDE, pageCount, grounds: GROUNDS.map(g => GROUND_NAMES[g]), when: new Date().toISOString() };
    console.log(`gpu: ${gpu}; quality ${state.quality}; ${pageCount} pages x ${GROUNDS.length} grounds`);
    for (const g of GROUNDS) {
      const gi = ['dark', 'bright', 'snow'].indexOf(g);
      if (gi < 0) throw new Error('unknown ground ' + g);
      for (let p = 0; p < pageCount; p++) {
        if (wanted && !wanted.has(p)) continue;
        const global = gi * pageCount + p;
        await page.evaluate(([n, t]) => window.__rhUiLab.setPage(n, t), [global, T_OVERRIDE !== null ? +T_OVERRIDE : -2]);
        state = await waitReady(page);
        await sleep(350);                                  // a few more frames: the frame is frozen, ambient light and haze keep moving
        if (state.page !== global) throw new Error(`asked for page ${global}, got ${state.page}`);
        let n = 0;
        for (const c of state.cells) {
          if (ROWS.length && !c.row.split('+').some(r => ROWS.includes(r))) continue;
          const screen = c.shot === 'screen';
          const x = Math.max(0, Math.floor(c.x)), y = Math.max(0, Math.floor(c.y));
          const clip = { x, y, width: Math.min(W - x, Math.ceil(c.w)), height: Math.min(H - y, Math.ceil(c.h)) };
          if (clip.width < 8 || clip.height < 8) throw new Error(`cell ${c.id} has no area on page ${global}`);
          let q = screen ? 40 : Q0, buf = await jpeg(page, clip, q);
          while (buf.length > (screen ? MAX_BYTES * 8 : MAX_BYTES) && q > QMIN) { q -= 4; buf = await jpeg(page, clip, q); }
          const file = `${c.id}__${g}.jpg`;
          fs.writeFileSync(path.join(OUT, file), buf);
          total += buf.length; n++;
          index.push({ id: c.id, row: c.row, variant: c.variant, ground: g, groundName: GROUND_NAMES[g], page: global, pageName: state.pageName, file, bytes: buf.length, jpegQuality: q,
            width: clip.width, height: clip.height, caption: c.caption, legacy: c.legacy, shot: c.shot, age: c.age, freeze: state.freeze });
        }
        console.log(`  ${g} page ${p} ${state.pageName}: ${n} crops, running total ${(total / 1024).toFixed(0)} KB`);
      }
    }
    meta.totalBytes = total; meta.crops = index.length;
    fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ meta, errors: errors.slice(0, 20), cells: index }, null, 1));
    if (total > BUDGET) { overBudget = true; console.error(`BUDGET: ${total} bytes of crops exceeds ${BUDGET}`); }
  } finally {
    await browser.close();
  }
  if (errors.length) console.error(`${errors.length} browser error(s); first: ${errors[0]}`);
  console.log(`done: ${index.length} crops, ${(total / 1024).toFixed(0)} KB -> ${OUT}`);
  if (errors.length || overBudget) process.exit(1);
}

main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
