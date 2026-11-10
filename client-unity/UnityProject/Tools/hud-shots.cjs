#!/usr/bin/env node
// Real-browser screenshots of the in-match HUD and the planning screen of the Unity Web player.
//
//   node client-unity/UnityProject/Tools/hud-shots.cjs [--out docs/rework/evidence/hud] [--prefix skin] [--only 1280x800@1]
//        [--steps hub,planning,match,settings,help,map,walk] [--headless]
//   Launch flow (the opening screen, hub, faction picks, stations, sign-in, connecting, failure, play-to-planning, return to menu):
//   node client-unity/UnityProject/Tools/hud-shots.cjs --steps launch --out docs/rework/evidence/launch --prefix launch
//   It also needs an unreachable-port check and the Playwright WebSocket router (Playwright >= 1.48).
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


// ---- launch flow ---------------------------------------------------------------------------------------------------------------
// Click targets for the launch screen come from the same unit maths as LaunchScreenView: a 330 unit panel docked at (12, 12), the
// hub room (896 x 576 legacy px) centred in the area right of it and below the wordmark, scaled to fit (HubAtriumView.ApplyArea).
const PANEL = { x: 12, y: 12, w: 330, pad: 14 };
const PANEL_ROWS = { callsign: 32, load: 32, profile: 142, faction: 202, play: 466, guide: 562 };
const KIOSKS = ['Shop', 'Wardrobe', 'Titles', 'Achievements', 'Leaderboard'];
const HOUSES = ['Fire', 'Sentenced', 'Plague', 'Frost', 'Holy'];
function launchGeometry(cfg) {
  const s = legacyScale(cfg.w, cfg.h);
  const uiW = cfg.w / s, uiH = cfg.h / s;
  const areaX = 354, areaTop = 120, areaW = Math.max(300, uiW - 354 - 12), areaH = Math.max(300, uiH - 120 - 12);
  const k = Math.min(1.4, Math.max(0.45, Math.min(areaW / 896, (areaH - 36) / 576)));
  const roomLeft = areaX + (areaW - 896 * k) / 2;
  const unit = (ux, uy) => ({ x: ux * s, y: uy * s });
  const panel = (px, py) => unit(PANEL.x + px, PANEL.y + py);
  const room = (rx, ry) => unit(roomLeft + rx * k, areaTop + ry * k);
  return {
    s, k, panel, room,
    callsign: panel(PANEL.pad + 116, PANEL_ROWS.callsign + 18),
    load: panel(PANEL.pad + 240 + 36, PANEL_ROWS.load + 18),
    profile: panel(PANEL.pad + 74, PANEL_ROWS.profile + 16),
    resume: panel(PANEL.pad + 156 + 73, PANEL_ROWS.profile + 16),
    house: i => panel(PANEL.pad + 151, PANEL_ROWS.faction + i * 52 + 24),
    play: panel(PANEL.pad + 95, PANEL_ROWS.play + 24),
    training: panel(PANEL.pad + 198 + 52, PANEL_ROWS.play + 24),
    guide: panel(PANEL.pad + 80, PANEL_ROWS.guide + 16),
    signIn: panel(PANEL.pad + 168 + 67, PANEL_ROWS.guide + 16),
    station: { Counters: room(448, 288), Arena: room(448, 66), Training: room(786, 288), Shop: room(128, 96), Wardrobe: room(128, 174), Titles: room(128, 252),
      Achievements: room(128, 330), Leaderboard: room(128, 408), Fire: room(248, 456), Sentenced: room(348, 492), Plague: room(448, 504), Frost: room(548, 492), Holy: room(648, 456) },
  };
}

async function launchFlow(cfg, browser, errors, logs) {
  const tag2 = cfg.id.replace('@', '-dpr');
  const geo = launchGeometry(cfg);
  const boot = Number(process.env.RH_SHOTS_BOOT_MS || 12000);
  const contexts = [];
  const open = async (query, setup) => {
    const context = await browser.newContext({ viewport: { width: cfg.w, height: cfg.h }, deviceScaleFactor: cfg.dpr });
    contexts.push(context);
    const page = await context.newPage();
    page.on('console', m => { const t = m.text(); logs.push(`[${m.type()}] ${t}`); if (m.type() === 'error') errors.push(t); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    if (setup) await setup(page);
    await page.goto(baseUrl + query, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 60000 });
    await page.waitForTimeout(boot);
    return page;
  };
  const shot = async (page, name) => {
    const file = path.join(outDir, `${tag}-${tag2}-${name}.png`);
    await page.screenshot({ path: file }); console.log('  wrote', path.relative(repo, file));
  };
  const click = async (page, p, wait = 700) => { await page.mouse.click(p.x, p.y, { delay: 60 }); await page.waitForTimeout(wait); };
  const profile = () => `${tag.replace(/[^A-Za-z0-9]/g, '').slice(0, 4)}${cfg.w}d${cfg.dpr}${Math.random().toString(36).slice(2, 5)}`.slice(0, 16);
  const diag = (extra = '') => `?server=${encodeURIComponent(wsUrl)}&profile=${profile()}&faction=3&diagnostic=1&token=t1&auto=0${extra}`;
  console.log(cfg.id, 'launch flow, scale', geo.s.toFixed(3), 'room scale', geo.k.toFixed(3));

  // 1. The normal player path: no query at all, then the same with a custom server (the owner-reported "unavailable" wording).
  let page = await open('');
  if (steps.has('launch-plain') || steps.has('launch')) await shot(page, 'first-visit');
  await click(page, geo.station.Fire); await page.waitForTimeout(1500);
  // Stations in the plain case need the account API, which the static test server does not serve: the panels still open.
  for (const name of ['Counters', ...KIOSKS]) {
    await click(page, geo.station[name], 3200);
    await shot(page, 'station-' + name.toLowerCase());
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  }
  await click(page, geo.profile, 900); await shot(page, 'profile-records'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await click(page, geo.guide, 900); await shot(page, 'champions-guide'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await click(page, geo.resume, 900); await shot(page, 'resume'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await click(page, geo.signIn, 900); await shot(page, 'signin'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await click(page, geo.callsign, 300); await page.keyboard.type('Ash_Warden', { delay: 40 }); await page.waitForTimeout(400);
  await shot(page, 'callsign-typed');
  await click(page, geo.training, 900); await shot(page, 'training-unavailable');
  await page.context().close();

  page = await open(`?server=${encodeURIComponent(wsUrl)}`);
  await shot(page, 'custom-server-link');
  await click(page, geo.play, 900); await shot(page, 'custom-server-play-blocked');
  await page.context().close();

  // 2. Diagnostic (loopback) hub: faction picks, keyboard focus, then play.
  page = await open(diag());
  await shot(page, 'hub');
  for (let i = 0; i < 5; i++) { await click(page, geo.house(i), 1800); await shot(page, 'faction-' + HOUSES[i].toLowerCase()); }
  await click(page, geo.house(3), 1500);
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.waitForTimeout(500);
  await shot(page, 'keyboard-focus');
  for (let i = 0; i < 9; i++) await page.keyboard.press('Tab');
  await page.waitForTimeout(500); await shot(page, 'keyboard-focus-actions');
  await page.mouse.click(geo.room(448, 400).x, geo.room(448, 400).y); // neutral floor click, clears focus
  // Walk with the keyboard and press E at a station.
  await page.keyboard.press('Escape');
  await page.keyboard.down('w'); await page.waitForTimeout(1100); await page.keyboard.up('w'); await page.waitForTimeout(400);
  await shot(page, 'walking-near-counters');
  await page.keyboard.press('e'); await page.waitForTimeout(1200); await shot(page, 'e-opens-station');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await click(page, geo.training, 900); await shot(page, 'training-disabled-reason');
  await page.context().close();

  // 3. Connecting: the socket opens but the server never answers, so the launch stays pending.
  page = await open(diag(), async p => { await p.routeWebSocket(/\/ws$/, () => { /* never forwarded: the server stays silent */ }); });
  await click(page, geo.play, 1800); await shot(page, 'connecting');
  await click(page, geo.training, 1200); await shot(page, 'cancelled');
  await page.context().close();

  // 4. A server that cannot be reached.
  const dead = baseUrl + `?server=${encodeURIComponent('ws://127.0.0.1:9/ws')}&profile=${profile()}&faction=1&diagnostic=1&token=t1&auto=0`;
  const ctx = await browser.newContext({ viewport: { width: cfg.w, height: cfg.h }, deviceScaleFactor: cfg.dpr }); contexts.push(ctx);
  page = await ctx.newPage();
  page.on('console', m => { const t = m.text(); logs.push(`[${m.type()}] ${t}`); if (m.type() === 'error' && !/WebSocket|ws:\/\/127\.0\.0\.1:9|ERR_CONNECTION/i.test(t)) errors.push(t); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(dead, { waitUntil: 'load' }); await page.waitForSelector('canvas', { timeout: 60000 }); await page.waitForTimeout(boot);
  await click(page, geo.play, 4500); await shot(page, 'connection-failed');
  await ctx.close();

  // 5. The primary action reaches planning and a match, then Leave returns to the menu.
  page = await open(diag());
  await click(page, geo.play, Number(process.env.RH_SHOTS_PLAN_MS || 9000)); await shot(page, 'play-planning');
  const s = geo.s, uiW = cfg.w / s, uiH = cfg.h / s;
  await page.keyboard.press('1'); await page.waitForTimeout(600);
  const pSide = Math.min(780, Math.max(260, Math.floor(Math.min(uiH - 44 - 12 - 124, uiW - 340 - 24 - 12 - 8))));
  const pFrame = pSide + 8, pTotal = pFrame + 12 + 340, pColH = 40 + 12 + pFrame + 12 + 52;
  const pBx = Math.floor((uiW - pTotal) / 2), pBy = Math.max(44, Math.floor((uiH - pColH) / 2 + 11));
  await page.mouse.click((pBx + pFrame + 12 + 12 + 158) * s, (pBy + 12 + 23) * s, { delay: 80 });
  await page.waitForTimeout(Number(process.env.RH_SHOTS_MATCH_MS || 9000)); await shot(page, 'play-match');
  await page.mouse.click(cfg.w - (12 + 36 + 15) * s, (10 + 15) * s, { delay: 60 }); await page.waitForTimeout(700); // settings gear
  await page.mouse.click(cfg.w - 258.5 * s, 676 * s, { delay: 60 }); await page.waitForTimeout(2500);               // Leave match
  await shot(page, 'return-to-menu');
  await click(page, geo.play, Number(process.env.RH_SHOTS_PLAN_MS || 9000)); await shot(page, 'play-again-planning');
  await page.context().close();
  fs.writeFileSync(path.join(outDir, `${tag}-${tag2}-console.log`), logs.join('\n') + '\n');
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
  const url = `${baseUrl}?server=${encodeURIComponent(wsUrl)}&profile=${profile}&faction=${process.env.RH_SHOTS_FACTION || 3}&diagnostic=1&token=t1${process.env.RH_SHOTS_QUERY || ''}`;
  const s = legacyScale(cfg.w, cfg.h);
  const shot = async name => {
    const file = path.join(outDir, `${tag}-${cfg.id.replace('@', '-dpr')}-${name}.png`);
    await page.screenshot({ path: file }); console.log('  wrote', path.relative(repo, file));
  };
  const clickStage = async (fromRight, fromTop, w = 0, h = 0) => { await page.mouse.click(cfg.w - (fromRight + w / 2) * s, (fromTop + h / 2) * s, { delay: 60 }); await page.waitForTimeout(500); };
  fs.mkdirSync(outDir, { recursive: true });
  if (steps.has('launch')) { await context.close(); await launchFlow(cfg, browser, errors, logs); await browser.close(); return errors; }
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
  if (steps.has('settings')) { await clickStage(12 + 36, 10, 30, 30); await shot('settings'); await clickStage(12 + 36, 10, 30, 30); await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  if (steps.has('help')) { await page.keyboard.press('h'); await page.waitForTimeout(500); await shot('help'); await page.keyboard.press('h'); await page.waitForTimeout(300); }
  if (steps.has('map')) { await page.keyboard.down('Tab'); await page.waitForTimeout(700); await shot('map'); await page.keyboard.up('Tab'); await page.waitForTimeout(300); }
  if (steps.has('walk')) await walk(cfg, page, s, shot);
  // Third UI pass: real-match captures. `fight` takes a burst of frames while the bots fight around the player (remote clusters, statuses,
  // damage numbers); `mobaudit` prints the creature art create/destroy rate the page logged (?mob.audit=1, ?mob.continuity=0 for the old
  // behaviour); `panels` opens the journal (J), Traders and Notices pages; `results` waits idle until the run ends and the results screen shows.
  if (steps.has('fight')) {
    const frames = Number(process.env.RH_SHOTS_FIGHT_FRAMES || 12);
    for (let i = 0; i < frames; i++) { await page.waitForTimeout(Number(process.env.RH_SHOTS_FIGHT_GAP_MS || 2500)); await shot(`fight-${String(i).padStart(2, '0')}`); }
  }
  if (steps.has('panels')) {
    await page.keyboard.press('j'); await page.waitForTimeout(900); await shot('panel-quests');
    const pageTab = (i) => ({ x: cfg.w * (0.12 + 0.76 * (0.025 + i * 0.32 + 0.155)), y: cfg.h * (0.12 + 0.795 * (1 - 0.8625)) });
    await page.mouse.click(pageTab(1).x, pageTab(1).y, { delay: 60 }); await page.waitForTimeout(700); await shot('panel-traders');
    await page.mouse.click(pageTab(2).x, pageTab(2).y, { delay: 60 }); await page.waitForTimeout(700); await shot('panel-notices');
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  }
  if (steps.has('results')) {
    const waits = Number(process.env.RH_SHOTS_RESULT_POLLS || 24);
    for (let i = 0; i < waits; i++) { await page.waitForTimeout(Number(process.env.RH_SHOTS_RESULT_GAP_MS || 10000)); await shot(`results-wait-${String(i).padStart(2, '0')}`); }
  }
  if (steps.has('mobaudit')) {
    const lines = logs.filter(l => l.includes('[mob.audit]'));
    fs.writeFileSync(path.join(outDir, `${tag}-${cfg.id.replace('@', '-dpr')}-mob-audit.log`), lines.join('\n') + '\n');
    console.log('  mob.audit lines', lines.length, lines.slice(-3).join(' | '));
  }
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
