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
const names = ['fire', 'sentenced', 'plague', 'frost', 'holy'];   // faction names (the spawn region is the server's choice, not necessarily the faction's own)
const tag = opt('tag', '');
const baseUrl = process.env.RH_SHOTS_URL || 'http://127.0.0.1:8127/';
const wsUrl = process.env.RH_SHOTS_WS || 'ws://127.0.0.1:7827/ws';
const extra = process.env.RH_SHOTS_QUERY || '';
const W = Number(opt('w', 1920)), H = Number(opt('h', 1080));
const temple = opt('temple', '');       // "name:tileX:tileY,..." walk the hero to each tile (right-click on the minimap) and take a shot there (the Holy temple tour)
const MAP_TILES = 160;

// Mirrors HudLayout.MinimapSize (user scale 1), in CSS px (same as hud-shots.cjs / vision-shots.cjs).
function legacyScale(w, h) { const stageW = w / h <= 21 / 9 ? w : Math.floor(h * 21 / 9); return Math.min(1.5, Math.max(0.8, Math.min(stageW / 1280, h / 800))); }
function minimapRect(w, h, s) {
  const uiW = Math.floor(w / s), uiH = Math.floor(h / s);
  const wanted = Math.min(312, Math.max(195, Math.round(uiH * 0.338)));
  const room = Math.floor(uiW / 2 - 12 - 152);
  const size = Math.round(Math.min(Math.min(wanted, Math.max(110, room)), uiW * 0.42, uiH * 0.6));
  return { x: w - (12 + size) * s, y: h - (12 + size) * s, size: size * s };
}
// The hero's tile from the minimap's own player marker (light blue), averaged over its pixels; null when not visible.
async function selfTile(page) {
  const mini = minimapRect(W, H, legacyScale(W, H));
  const buf = await page.screenshot({ clip: { x: mini.x, y: mini.y, width: mini.size, height: mini.size } });
  return page.evaluate(async ([b64, size]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 137) <= 14 && Math.abs(d[i + 1] - 206) <= 14 && Math.abs(d[i + 2] - 246) <= 14) { const k = i / 4; sx += k % c.width; sy += Math.floor(k / c.width); n++; }
    return n > 3 ? { tx: sx / n / c.width * 160, ty: sy / n / c.height * 160, n } : null;
  }, [buf.toString('base64'), mini.size]);
}
// Right-click the minimap at a tile (the server walks the hero there); re-issued every 8 s until the hero is within 2.5 tiles or the time is up.
async function walkTo(page, tx, ty, timeoutMs) {
  const mini = minimapRect(W, H, legacyScale(W, H));
  const click = async () => { await page.mouse.move(mini.x + mini.size * tx / MAP_TILES, mini.y + mini.size * ty / MAP_TILES); await page.waitForTimeout(150); await page.mouse.down({ button: 'right' }); await page.waitForTimeout(90); await page.mouse.up({ button: 'right' }); };
  const t0 = Date.now(); let last = Date.now(), pos = null; await click();
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(1500); pos = await selfTile(page);
    if (pos && Math.hypot(pos.tx - tx, pos.ty - ty) < 2.5) return pos;
    if (Date.now() - last > 8000) { await click(); last = Date.now(); }
  }
  return pos;
}

const lumas = []; let regionNowGlobal = () => 'unknown';
// Objective brightness check: Rec.709 luma of the sRGB pixels (0..1), computed in the page from the screenshot (downscaled to 480 wide).
async function lumaStats(page, buf) {
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const w = 480, h = Math.round(img.height * w / img.width), c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h); const d = g.getImageData(0, 0, w, h).data, ys = new Float32Array(w * h);
    for (let i = 0; i < ys.length; i++) ys[i] = (0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]) / 255;
    let sum = 0, clip = 0; for (const y of ys) { sum += y; if (y > 0.9) clip++; }
    const sorted = Array.from(ys).sort((a, b) => a - b);
    return { mean: +(sum / ys.length).toFixed(3), p95: +sorted[Math.floor(ys.length * 0.95)].toFixed(3), clipped: +(100 * clip / ys.length).toFixed(2) };
  }, buf.toString('base64'));
}

// Character separation check at full resolution: the local player is drawn at the screen centre (feet near 960,630 at 1920x1080), its hp bar
// and faction mark just above. For a sprite window and a marker window, compare the darkest and brightest 5% of the window (outline and light
// rim included) with the median of the ground ring around it; report the WCAG ratio of the better of the two.
async function contrastStats(page, buf) {
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const sx = img.width / 1920, sy = img.height / 1080;
    const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    const win = (x0, y0, x1, y1) => { const X0 = Math.round(x0 * sx), Y0 = Math.round(y0 * sy), W = Math.round((x1 - x0) * sx), H = Math.round((y1 - y0) * sy); const d = g.getImageData(X0, Y0, W, H).data, o = []; for (let i = 0; i < d.length; i += 4) o.push(lum(d[i], d[i + 1], d[i + 2])); return o; };
    const ring = (x0, y0, x1, y1, a, b) => { const o = []; const full = win(x0 - b, y0 - b, x1 + b, y1 + b), W = Math.round((x1 - x0 + 2 * b) * sx);
      for (let i = 0; i < full.length; i++) { const x = (i % W) / sx - b + x0, y = Math.floor(i / W) / sy - b + y0; if (x < x0 - a || x > x1 + a || y < y0 - a || y > y1 + a) o.push(full[i]); } return o; };
    const measure = (r) => { const inner = win(...r).sort((p, q) => p - q), ground = ring(...r, 14, 60).sort((p, q) => p - q); const med = ground[Math.floor(ground.length / 2)];
      const dark = inner[Math.floor(inner.length * 0.05)], light = inner[Math.floor(inner.length * 0.95)];
      const rd = (med + 0.05) / (dark + 0.05), rl = (light + 0.05) / (med + 0.05); return { ground: +med.toFixed(3), darkEdge: +rd.toFixed(2), lightEdge: +rl.toFixed(2), contrast: +Math.max(rd, rl).toFixed(2) }; };
    return { sprite: measure([928, 540, 992, 640]), bar: measure([922, 492, 998, 508]) };
  }, buf.toString('base64'));
}

async function session(faction, label, body) {
  const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [], logs = [], audio = [];
  let matchStart = 0;
  let regionNow = 'unknown'; regionNowGlobal = () => regionNow;
  page.on('console', m => { const t = m.text(); logs.push(`[${m.type()}] ${t}`); const r = /\[atmosphere\] region (\w+)/.exec(t); if (r) regionNow = r[1].toLowerCase(); if (m.type() === 'error') errors.push(t); });
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
  await page.keyboard.press(opt('spawn', '1')); await page.waitForTimeout(600);
  // The Ready button is the top of the planning decision column (MapScreenLayout.Planning); same maths as hud-shots.cjs.
  {
    const stageW = W / H <= 21 / 9 ? W : Math.floor(H * 21 / 9);
    const s = Math.min(1.5, Math.max(0.8, Math.min(stageW / 1280, H / 800)));
    const uiW = W / s, uiH = H / s;
    const pSide = Math.min(780, Math.max(260, Math.floor(Math.min(uiH - 44 - 12 - 124, uiW - 340 - 24 - 12 - 8))));
    const pFrame = pSide + 8, pTotal = pFrame + 12 + 340, pColH = 40 + 12 + pFrame + 12 + 52;
    const pBx = Math.floor((uiW - pTotal) / 2), pBy = Math.max(44, Math.floor((uiH - pColH) / 2 + 11));
    await page.mouse.click((pBx + pFrame + 12 + 12 + 158) * s, (pBy + 12 + 23) * s, { delay: 80 });
  }
  matchStart = Date.now();
  await page.waitForTimeout(Number(process.env.RH_SHOTS_MATCH_MS || 12000));
  const shot = async name => {
    const f = path.join(outDir, `${tag}${regionNow}-${name}.png`); const buf = await page.screenshot({ path: f });
    const st = await lumaStats(page, buf); const ct = await contrastStats(page, buf); st.contrast = ct; lumas.push({ shot: `${tag}${regionNow}-${name}`, region: regionNow, ...st });
    console.log('  wrote', path.relative(repo, f), `luma mean=${st.mean} p95=${st.p95} clipped(>0.9)=${st.clipped}% sprite-contrast=${ct.sprite.contrast} bar-contrast=${ct.bar.contrast}`);
  };
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
  if (!walk && !temple) for (const f of factions) {
    const { errors, audio } = await session(f, names[f], async (page, shot) => { await shot(`${names[f]}-1`); await page.waitForTimeout(4000); await shot(`${names[f]}-2`); });
    console.log(`  ${names[f]}: audio requests`, audio.map(a => `${a.url}@${a.afterMatchStartMs}ms`).join(', ') || 'none');
    if (errors.length) { failed = true; console.error(`  ${names[f]}: ${errors.length} console error(s):\n    ` + errors.slice(0, 6).join('\n    ')); }
  }
  if (temple) {
    // The server picks the spawn at random among the options, so retry fresh matches until the hero starts near where the tour begins (RH_SHOTS_NEAR="x,y,radius" in tiles).
    const faction = factions[0]; const near = (process.env.RH_SHOTS_NEAR || '').split(',').map(Number);
    let done = false, errs = [];
    for (let attempt = 0; attempt < Number(process.env.RH_SHOTS_ATTEMPTS || 8) && !done; attempt++) {
      const { errors } = await session(faction, `temple-${names[faction]}`, async (page, shot) => {
        const start = await selfTile(page); console.log(`  attempt ${attempt}: hero starts at`, start ? `${start.tx.toFixed(1)},${start.ty.toFixed(1)} (region ${regionNowGlobal()})` : 'unknown');
        if (near.length === 3 && (!start || Math.hypot(start.tx - near[0], start.ty - near[1]) > near[2])) { console.log('  too far from the tour start, new match'); return; }
        done = true; if (process.env.RH_SHOTS_PROBE) return;
        const t0 = Date.now(); const budgetMs = Number(process.env.RH_SHOTS_BUDGET_MS || 200000);      // the raid ends about four minutes after it starts
        for (const spec of temple.split(',')) {
          if (Date.now() - t0 > budgetMs) { console.log('  out of time, skipping', spec); continue; }
          const [name, x, y] = spec.split(':'); const tx = Number(x), ty = Number(y);
          const pos = await walkTo(page, tx, ty, Number(process.env.RH_SHOTS_WALK_MS || 60000));
          console.log(`  ${name}: wanted ${tx},${ty} hero at`, pos ? `${pos.tx.toFixed(1)},${pos.ty.toFixed(1)}` : 'unknown');
          await page.mouse.move(W / 2, H / 3); await page.waitForTimeout(1200);
          await shot(name);
        }
      });
      errs = errs.concat(errors);
    }
    if (errs.length) { failed = true; console.error(errs.slice(0, 6).join('\n')); }
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
  if (lumas.length) fs.writeFileSync(path.join(outDir, `luma-${tag || 'run'}.json`), JSON.stringify(lumas, null, 1));
  process.exit(failed ? 1 : 0);
})();
