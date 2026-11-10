#!/usr/bin/env node
// Real-browser screenshots of the region atmosphere: one match per faction (spawns in its own region), plus a walk across a border.
//   node client-unity/UnityProject/Tools/atmosphere-shots.cjs [--out docs/rework/evidence/atmosphere] [--factions 3,0,2,4,1] [--walk 3:a:8]
// Env: RH_SHOTS_URL (default http://127.0.0.1:8127/), RH_SHOTS_WS (default ws://127.0.0.1:7827/ws), RH_SHOTS_QUERY (extra query, e.g. &fx.shadows=0).
// Records every network request for audio files (with the time since the match started) and the console, so the evidence shows
// that music and ambience are fetched after the match starts and that nothing errors.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const repo = path.resolve(__dirname, '../../..');
const outDir = path.resolve(repo, opt('out', 'docs/rework/evidence/atmosphere'));
const factions = opt('factions', '3,0,2,4,1').split(',').map(Number);
const walk = opt('walk', '');           // faction:key:seconds
const names = ['fire', 'sentenced', 'plague', 'frost', 'holy'];
const baseUrl = process.env.RH_SHOTS_URL || 'http://127.0.0.1:8127/';
const wsUrl = process.env.RH_SHOTS_WS || 'ws://127.0.0.1:7827/ws';
const extra = process.env.RH_SHOTS_QUERY || '';
const W = Number(opt('w', 1920)), H = Number(opt('h', 1080));

async function session(faction, label, body) {
  const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [], logs = [], audio = [];
  let matchStart = 0;
  page.on('console', m => { logs.push(`[${m.type()}] ${m.text()}`); if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfinished', async r => {
    const u = r.url();
    if (/StreamingAssets\/Audio\//.test(u)) { const resp = await r.response(); audio.push({ url: u.split('/').slice(-3).join('/'), status: resp ? resp.status() : 0, afterMatchStartMs: matchStart ? Date.now() - matchStart : -1 }); }
  });
  const profile = `atm${faction}${Math.random().toString(36).slice(2, 7)}`.slice(0, 16);
  const url = `${baseUrl}?server=${encodeURIComponent(wsUrl)}&profile=${profile}&faction=${faction}&diagnostic=1&token=t1${extra}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(Number(process.env.RH_SHOTS_BOOT_MS || 14000));
  await page.keyboard.press('1'); await page.waitForTimeout(600);
  await page.mouse.click(W * 0.8, H * 0.66, { delay: 80 });
  matchStart = Date.now();
  await page.waitForTimeout(Number(process.env.RH_SHOTS_MATCH_MS || 12000));
  const shot = async name => { const f = path.join(outDir, `${name}.png`); await page.screenshot({ path: f }); console.log('  wrote', path.relative(repo, f)); };
  await body(page, shot);
  fs.writeFileSync(path.join(outDir, `${label}-network-audio.json`), JSON.stringify(audio, null, 1));
  fs.writeFileSync(path.join(outDir, `${label}-console.log`), logs.join('\n') + '\n');
  await browser.close();
  return { errors, audio };
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  let failed = false;
  if (args.includes('--perf')) {   // browser frame pacing (requestAnimationFrame deltas, 8 s) for the cost table; compare runs with different RH_SHOTS_QUERY
    const f = factions[0];
    await session(f, `perf-${names[f]}`, async page => {
      const r = await page.evaluate(() => new Promise(res => { const d = []; let last = performance.now(), t0 = last; const tick = n => { d.push(n - last); last = n; if (n - t0 < 8000) requestAnimationFrame(tick); else res(d); }; requestAnimationFrame(tick); }));
      r.shift(); r.sort((a, b) => a - b); const q = p => r[Math.min(r.length - 1, Math.floor(r.length * p))];
      console.log(`  perf ${names[f]} query="${extra}": frames=${r.length} mean=${(r.reduce((a, b) => a + b, 0) / r.length).toFixed(2)}ms p50=${q(.5).toFixed(2)} p95=${q(.95).toFixed(2)} p99=${q(.99).toFixed(2)}`);
    });
    process.exit(0);
  }
  if (!walk) for (const f of factions) {
    const { errors, audio } = await session(f, names[f], async (page, shot) => { await shot(`${names[f]}-1`); await page.waitForTimeout(4000); await shot(`${names[f]}-2`); });
    console.log(`  ${names[f]}: audio requests`, audio.map(a => `${a.url}@${a.afterMatchStartMs}ms`).join(', ') || 'none');
    if (errors.length) { failed = true; console.error(`  ${names[f]}: ${errors.length} console error(s):\n    ` + errors.slice(0, 6).join('\n    ')); }
  }
  if (walk) {
    const [f, key, secs] = walk.split(':'); const faction = Number(f);
    const { errors } = await session(faction, `walk-${names[faction]}`, async (page, shot) => {
      await page.mouse.move(W / 2, H / 2);
      await page.keyboard.down(key);
      const n = Number(secs) * 2;
      for (let i = 0; i < n; i++) { await page.waitForTimeout(500); if (i % 2 === 1) await shot(`border-${String(i >> 1).padStart(2, '0')}`); }
      await page.keyboard.up(key);
    });
    if (errors.length) { failed = true; console.error(errors.slice(0, 6).join('\n')); }
  }
  process.exit(failed ? 1 : 0);
})();
