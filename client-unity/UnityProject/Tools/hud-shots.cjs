#!/usr/bin/env node
// Real-browser screenshots of the in-match HUD and the planning screen of the Unity Web player.
//
//   node client-unity/UnityProject/Tools/hud-shots.cjs [--out docs/rework/evidence/hud] [--prefix skin] [--only 1280x800@1]
//        [--steps hub,planning,match,settings,help,map,walk] [--headless]
//
// Needs the Rust server and the served Web build (see docs/rework/evidence/hud/README.md for the commands):
//   RH_SHOTS_URL    default http://127.0.0.1:8117/
//   RH_SHOTS_WS     default ws://127.0.0.1:7817/ws
// Headed Chromium (real GPU) by default; the Unity canvas needs WebGL2. Each configuration gets its own profile so every run
// is a fresh match. Exit code 1 if the page logged a console error.
//
// The click targets use the legacy stage maths (HudLayout.Viewport): a point 12 stage units from the right edge is
// 12 * scale CSS px from the right edge of the window at any size.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'));

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback; };
const repo = path.resolve(__dirname, '../../..');
const outDir = path.resolve(repo, opt('out', 'docs/rework/evidence/hud'));
const tag = opt('prefix', 'skin');
const only = opt('only', '');
const steps = new Set(opt('steps', 'hub,planning,match,settings,help,map,walk').split(','));
const baseUrl = process.env.RH_SHOTS_URL || 'http://127.0.0.1:8117/';
const wsUrl = process.env.RH_SHOTS_WS || 'ws://127.0.0.1:7817/ws';
const configs = [[1280, 800, 1], [1920, 1080, 1], [2560, 1440, 1], [1280, 800, 2]]
  .map(([w, h, dpr]) => ({ w, h, dpr, id: `${w}x${h}@${dpr}` })).filter(c => !only || only.split(',').includes(c.id));

// legacy overlay scale for a window (view/viewport.ts): clamp(min(stageW/1280, stageH/800), .8, 1.5), stage never wider than 21:9
function legacyScale(w, h) {
  const stageW = w / h <= 21 / 9 ? w : Math.floor(h * 21 / 9);
  return Math.min(1.5, Math.max(0.8, Math.min(stageW / 1280, h / 800)));
}

// Centroid (in screenshot CSS px) of the pixels near a colour inside a clip, decoded in a scratch page. null when none.
async function centroid(context, buf, clip, rgb, tol, dpr) {
  const p = await context.newPage();
  try {
    return await p.evaluate(async ([b64, clip, rgb, tol, dpr]) => {
      const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
      const x0 = Math.round(clip.x * dpr), y0 = Math.round(clip.y * dpr), w = Math.round(clip.width * dpr), h = Math.round(clip.height * dpr);
      const d = g.getImageData(x0, y0, w, h).data; let n = 0, sx = 0, sy = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - rgb[0]) <= tol && Math.abs(d[i + 1] - rgb[1]) <= tol && Math.abs(d[i + 2] - rgb[2]) <= tol) { const k = i / 4; sx += k % w; sy += Math.floor(k / w); n++; }
      }
      return n > 3 ? { x: clip.x + sx / n / dpr, y: clip.y + sy / n / dpr, n } : null;
    }, [buf.toString('base64'), clip, rgb, tol, dpr]);
  } finally { await p.close(); }
}

// Mirrors HudLayout.MinimapSize (user scale 1) and MapScreenLayout.Tab for a window, in CSS px.
function minimapRect(w, h, s) {
  const uiW = Math.floor(w / s), uiH = Math.floor(h / s);
  const wanted = Math.min(312, Math.max(195, Math.round(uiH * 0.338)));
  const room = Math.floor(uiW / 2 - 12 - 152);
  const size = Math.round(Math.min(Math.min(wanted, Math.max(110, room)), uiW * 0.42, uiH * 0.6));
  return { x: w - (12 + size) * s, y: h - (12 + size) * s, size: size * s };
}
function tabMapRect(w, h, s) {
  const uiW = w / s, uiH = h / s, col = 250, fixedH = 34 + 12 + 12 + 30 + 8;
  const side = Math.min(820, Math.max(240, Math.floor(Math.min(uiH - 44 - 12 - fixedH, uiW - 24 - col * 2 - 24 - 8))));
  const frameW = side + 8, totalW = col * 2 + 24 + frameW, colH = 34 + 12 + frameW + 12 + 30;
  const bx = Math.floor((uiW - totalW) / 2), by = Math.max(44, Math.floor(44 + (uiH - 44 - 12 - colH) / 2));
  return { x: (bx + col + 12 + 4) * s, y: (by + 34 + 12 + 4) * s, size: side * s };
}

// Right-click on the minimap and on the Tab map; verify the move order that went out and that the character really walked.
async function walk(cfg, page, s, shot) {
  const context = page.context();
  const tag2 = cfg.id.replace('@', '-dpr');
  const moves = () => page.evaluate(() => window.__rhLatency.events.filter(e => e.kind === 'sampleMove').map(e => ({ x: e.x, y: e.y, seq: e.moveSeq })));
  const self = async (clip) => { const b = await page.screenshot(); return centroid(context, b, clip, [137, 206, 246], 10, cfg.dpr); };
  const result = {};
  const mini = minimapRect(cfg.w, cfg.h, s);
  const miniClip = { x: mini.x, y: mini.y, width: mini.size, height: mini.size };
  const worldOf = c => c ? { x: (c.x - mini.x) / mini.size * 5120, y: (c.y - mini.y) / mini.size * 5120 } : null;
  for (const where of ['minimap', 'tab']) {
    const fx = where === 'minimap' ? 0.30 : 0.70, fy = where === 'minimap' ? 0.60 : 0.30;
    const target = { x: fx * 5120, y: fy * 5120 };
    // The player's world position is read back from the minimap's own player marker before and after (Tab released both times).
    const before = worldOf(await self(miniClip));
    const sentBefore = (await moves()).length;
    const ctxBefore = await page.evaluate(() => ({ ...window.__ctxmenu }));
    let rect = mini;
    if (where === 'tab') { await page.keyboard.down('Tab'); await page.waitForTimeout(600); rect = tabMapRect(cfg.w, cfg.h, s); }
    const x = rect.x + rect.size * fx, y = rect.y + rect.size * fy;
    await page.mouse.move(x, y); await page.waitForTimeout(150);
    await page.mouse.down({ button: 'right' }); await page.waitForTimeout(90); await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(250);
    await shot(`walk-${where}-ping`);
    await page.waitForTimeout(2300);
    if (where === 'tab') { await shot('walk-tab-after'); await page.keyboard.up('Tab'); await page.waitForTimeout(500); }
    const after = worldOf(await self(miniClip));
    const sent = (await moves()).slice(sentBefore);
    const ctxAfter = await page.evaluate(() => ({ ...window.__ctxmenu }));
    const dist = p => p ? Math.hypot(p.x - target.x, p.y - target.y) : null;
    result[where] = { clickedAtCssPx: { x: Math.round(x), y: Math.round(y) }, targetWorld: target, playerBeforeWorld: before, playerAfterWorld: after,
      distToTargetBefore: dist(before), distToTargetAfter: dist(after),
      walkedTowardTarget: !!before && !!after && dist(after) < dist(before) - 100,
      orderTraceEvents: sent.length, lastTracedOrder: sent[sent.length - 1] || null,
      contextMenuEvents: ctxAfter.count - ctxBefore.count, contextMenuNotPrevented: ctxAfter.count - ctxBefore.count - (ctxAfter.prevented - ctxBefore.prevented) };
    await shot(`walk-${where}-done`);
  }
  console.log('  walk', JSON.stringify(result));
  fs.writeFileSync(path.join(outDir, `${tag}-${tag2}-walk.json`), JSON.stringify(result, null, 2) + '\n');
}

async function run(cfg) {
  const browser = await chromium.launch({ headless: args.includes('--headless'), args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: cfg.w, height: cfg.h }, deviceScaleFactor: cfg.dpr });
  // Opt-in diagnostic collector (MatchClient LatencyTrace): every move order the client sends is recorded with its destination.
  await context.addInitScript(() => {
    window.__rhLatency = { events: [], recording: true };
    window.__ctxmenu = { count: 0, prevented: 0 };
    window.addEventListener('contextmenu', e => { window.__ctxmenu.count++; if (e.defaultPrevented) window.__ctxmenu.prevented++; });
  });
  const page = await context.newPage();
  const errors = [], logs = [];
  page.on('console', m => { const t = m.text(); logs.push(`[${m.type()}] ${t}`); if (m.type() === 'error') errors.push(t); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // The callsign must be 2-16 of A-Z a-z 0-9 _ -
  const profile = `${tag.replace(/[^A-Za-z0-9]/g, '').slice(0, 4)}${cfg.w}d${cfg.dpr}${Math.random().toString(36).slice(2, 5)}`.slice(0, 16);
  const url = `${baseUrl}?server=${encodeURIComponent(wsUrl)}&profile=${profile}&faction=3&diagnostic=1&token=t1`;
  const s = legacyScale(cfg.w, cfg.h);
  const shot = async name => {
    const file = path.join(outDir, `${tag}-${cfg.id.replace('@', '-dpr')}-${name}.png`);
    await page.screenshot({ path: file }); console.log('  wrote', path.relative(repo, file));
  };
  const clickStage = async (fromRight, fromTop, w = 0, h = 0) => { await page.mouse.click(cfg.w - (fromRight + w / 2) * s, (fromTop + h / 2) * s, { delay: 60 }); await page.waitForTimeout(500); };
  fs.mkdirSync(outDir, { recursive: true });
  console.log(cfg.id, 'scale', s.toFixed(3));
  if (steps.has('hub')) {
    // The hub and menu (not auto-joined): they share the theme, so check they are not broken by it.
    const hub = await context.newPage();
    hub.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await hub.goto(url + '&auto=0', { waitUntil: 'load' });
    await hub.waitForSelector('canvas', { timeout: 60000 });
    await hub.waitForTimeout(Number(process.env.RH_SHOTS_BOOT_MS || 14000));
    await hub.screenshot({ path: path.join(outDir, `${tag}-${cfg.id.replace('@', '-dpr')}-hub.png`) });
    console.log('  wrote hub');
    await hub.close();
  }
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(Number(process.env.RH_SHOTS_BOOT_MS || 14000));
  if (steps.has('planning')) await shot('planning');
  // Planning: pick the first spawn with its key, then press the READY button (bottom of the right rail).
  await page.keyboard.press('1'); await page.waitForTimeout(600);
  if (steps.has('planning')) await shot('planning-spawn');
  // The Ready button is the top of the planning decision column (MapScreenLayout.Planning).
  const uiW = cfg.w / s, uiH = cfg.h / s;
  const pSide = Math.min(780, Math.max(260, Math.floor(Math.min(uiH - 44 - 12 - 124, uiW - 340 - 24 - 12 - 8))));
  const pFrame = pSide + 8, pTotal = pFrame + 12 + 340, pColH = 40 + 12 + pFrame + 12 + 52;
  const pBx = Math.floor((uiW - pTotal) / 2), pBy = Math.max(44, Math.floor((uiH - pColH) / 2 + 11));
  const ready = { x: (pBx + pFrame + 12 + 12 + 158) * s, y: (pBy + 12 + 23) * s };
  await page.mouse.click(ready.x, ready.y, { delay: 80 });
  await page.waitForTimeout(Number(process.env.RH_SHOTS_MATCH_MS || 12000));
  if (steps.has('match')) await shot('match');
  if (steps.has('settings')) { await clickStage(12 + 36, 10, 30, 30); await shot('settings'); await clickStage(12 + 36, 10, 30, 30); }
  if (steps.has('help')) { await page.keyboard.press('h'); await page.waitForTimeout(500); await shot('help'); await page.keyboard.press('h'); await page.waitForTimeout(300); }
  if (steps.has('map')) { await page.keyboard.down('Tab'); await page.waitForTimeout(700); await shot('map'); await page.keyboard.up('Tab'); await page.waitForTimeout(300); }
  if (steps.has('walk')) await walk(cfg, page, s, shot);
  fs.writeFileSync(path.join(outDir, `${tag}-${cfg.id.replace('@', '-dpr')}-console.log`), logs.join('\n') + '\n');
  await browser.close();
  return errors;
}

(async () => {
  let failed = false;
  for (const cfg of configs) {
    const errors = await run(cfg);
    if (errors.length) { failed = true; console.error(`  ${cfg.id}: ${errors.length} console error(s):\n    ` + errors.slice(0, 8).join('\n    ')); }
  }
  process.exit(failed ? 1 : 0);
})();
