#!/usr/bin/env node
// Real-browser screenshots of the in-match HUD and the planning screen of the Unity Web player.
//
//   node client-unity/UnityProject/Tools/hud-shots.cjs [--out docs/rework/evidence/hud] [--prefix skin] [--only 1280x800@1]
//        [--steps hub,planning,match,settings,help,map] [--headless]
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
const steps = new Set(opt('steps', 'hub,planning,match,settings,help,map').split(','));
const baseUrl = process.env.RH_SHOTS_URL || 'http://127.0.0.1:8117/';
const wsUrl = process.env.RH_SHOTS_WS || 'ws://127.0.0.1:7817/ws';
const configs = [[1280, 800, 1], [1920, 1080, 1], [2560, 1440, 1], [1280, 800, 2]]
  .map(([w, h, dpr]) => ({ w, h, dpr, id: `${w}x${h}@${dpr}` })).filter(c => !only || only.split(',').includes(c.id));

// legacy overlay scale for a window (view/viewport.ts): clamp(min(stageW/1280, stageH/800), .8, 1.5), stage never wider than 21:9
function legacyScale(w, h) {
  const stageW = w / h <= 21 / 9 ? w : Math.floor(h * 21 / 9);
  return Math.min(1.5, Math.max(0.8, Math.min(stageW / 1280, h / 800)));
}

async function run(cfg) {
  const browser = await chromium.launch({ headless: args.includes('--headless'), args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: cfg.w, height: cfg.h }, deviceScaleFactor: cfg.dpr });
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
  const ready = { x: cfg.w * Number(process.env.RH_SHOTS_READY_X || 0.8), y: cfg.h * Number(process.env.RH_SHOTS_READY_Y || 0.66) };
  await page.mouse.click(ready.x, ready.y, { delay: 80 });
  await page.waitForTimeout(Number(process.env.RH_SHOTS_MATCH_MS || 12000));
  if (steps.has('match')) await shot('match');
  if (steps.has('settings')) { await clickStage(12 + 36, 10, 30, 30); await shot('settings'); await clickStage(12 + 36, 10, 30, 30); }
  if (steps.has('help')) { await page.keyboard.press('h'); await page.waitForTimeout(500); await shot('help'); await page.keyboard.press('h'); await page.waitForTimeout(300); }
  if (steps.has('map')) { await page.keyboard.down('Tab'); await page.waitForTimeout(700); await shot('map'); await page.keyboard.up('Tab'); await page.waitForTimeout(300); }
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
