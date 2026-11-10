#!/usr/bin/env node
// Scripted frame-time run for the Unity Web client: headed Chromium, 2560x1440, GPU (Metal ANGLE), diagnostic loopback
// join, planning (spawn + Ready), then a scripted walk-and-attack timeline while the in-client recorder (?perf=1,
// window.__rhPerf, RhPerf.jslib) logs every requestAnimationFrame delta.
//
//   node perf-run.cjs --quality ultra --region frost --seconds 60 --url http://127.0.0.1:8107/ \
//        --server ws://127.0.0.1:7807/ws --out docs/rework/evidence/perf-baseline/ultra
//   node perf-run.cjs --attribution --quality ultra     # rerun short windows with one effect off at a time
//
// Target (docs/prompts/UNITY_REWORK_FABLE.md section 4): p95 frame time <= 6.94 ms and the worst 1% of frames at or
// above 120 fps (mean of the slowest 1% <= 8.33 ms), on a verified 2560x1440 @ 144 Hz display. If the display cannot
// be verified, the run is labelled PROVISIONAL, measured vsync-off, and never claims the target.
//
// The protocol version is never hard-coded: the tool reads /info for the record and takes everything else from the page.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// ---------------------------------------------------------------------------------------------------- pure parts

const TARGET = { refreshHz: 144, width: 2560, height: 1440, p95Ms: 1000 / 144, worst1PctFps: 120 };
TARGET.p95Ms = Math.round(TARGET.p95Ms * 100) / 100;                         // 6.94 ms, the number the owner quotes
TARGET.worst1PctMs = Math.round((1000 / TARGET.worst1PctFps) * 100) / 100;   // 8.33 ms

const REGIONS = { fire: 0, sentenced: 1, plague: 2, frost: 3, holy: 4 };

/** Nearest-rank percentile (p in 0..1) of an unsorted array; null when empty. Same definition as RhPerf.jslib. */
function percentile(values, p) {
  const a = Float64Array.from(values.filter(Number.isFinite)).sort();
  if (!a.length) return null;
  const k = Math.ceil(p * a.length) - 1;
  return a[Math.max(0, Math.min(a.length - 1, k))];
}

/** Mean of the slowest 1% of frames (at least one frame). */
function worstOnePercentMean(deltas) {
  const a = Float64Array.from(deltas.filter(Number.isFinite)).sort();
  if (!a.length) return null;
  const n = Math.max(1, Math.ceil(a.length * 0.01));
  let sum = 0;
  for (let i = a.length - n; i < a.length; i++) sum += a[i];
  return sum / n;
}

/** Average of every k consecutive deltas (a sliding window): cancels rAF timestamp jitter, keeps real drops. */
function smoothDeltas(deltas, k) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < deltas.length; i++) {
    sum += deltas[i];
    if (i >= k) sum -= deltas[i - k];
    if (i >= k - 1) out.push(sum / k);
  }
  return out;
}

const SMOOTH_FRAMES = 8;

/** Frame-time statistics from rAF deltas in ms. refreshHz (when known) sets the dropped-frame threshold. */
function frameStats(deltas, refreshHz) {
  const d = deltas.filter(Number.isFinite);
  if (!d.length) return { count: 0 };
  const sum = d.reduce((x, y) => x + y, 0);
  const worstMean = worstOnePercentMean(d);
  const out = {
    count: d.length, meanMs: sum / d.length, minMs: d.reduce((x, y) => (y < x ? y : x), Infinity), maxMs: d.reduce((x, y) => (y > x ? y : x), -Infinity),
    p50Ms: percentile(d, .5), p95Ms: percentile(d, .95), p99Ms: percentile(d, .99),
    worst1PctMeanMs: worstMean, worst1PctFps: 1000 / worstMean,
    avgFps: 1000 / (sum / d.length),
  };
  const sm = smoothDeltas(d, SMOOTH_FRAMES);
  if (sm.length) out.smooth = { frames: SMOOTH_FRAMES, p50Ms: percentile(sm, .5), p95Ms: percentile(sm, .95), p99Ms: percentile(sm, .99), maxMs: percentile(sm, 1) };
  if (refreshHz > 0) {
    const limit = (1000 / refreshHz) * 1.5;
    out.refreshHz = refreshHz; out.droppedLimitMs = limit; out.droppedFrames = d.filter(x => x > limit).length;
    out.droppedPct = (100 * out.droppedFrames) / d.length;
  }
  return out;
}

/** Pass/fail against the owner target. claimable=false (display unverified or vsync off) can never produce a target PASS. */
function evaluate(stats, { displayVerified, vsyncOff = false } = {}) {
  const p95 = stats.p95Ms, worst = stats.worst1PctMeanMs;
  const checks = {
    p95: { value: p95, limit: TARGET.p95Ms, pass: Number.isFinite(p95) && p95 <= TARGET.p95Ms },
    worst1Pct: { valueMs: worst, valueFps: stats.worst1PctFps, limitMs: TARGET.worst1PctMs, limitFps: TARGET.worst1PctFps,
      pass: Number.isFinite(worst) && worst <= TARGET.worst1PctMs },
  };
  const meets = checks.p95.pass && checks.worst1Pct.pass;
  const claimable = !!displayVerified && !vsyncOff;
  let verdict;
  if (!stats.count) verdict = 'FAIL';
  else if (claimable) verdict = meets ? 'PASS' : 'FAIL';
  else verdict = meets ? 'PROVISIONAL (numbers meet the criteria, target not claimed)' : 'PROVISIONAL (numbers miss the criteria)';
  // rAF timestamps jitter by about +-1.5 ms around the true cadence, so with a mean of exactly one refresh interval roughly
  // half of all deltas exceed it and the literal p95 <= refresh criterion fails even with zero dropped frames. The pacing
  // read-out is therefore reported beside the literal verdict: no dropped frames, mean at the refresh interval, and the
  // 8-frame-averaged p95 within 3% of it. It never changes the verdict.
  const refreshMs = stats.refreshHz > 0 ? 1000 / stats.refreshHz : null;
  const pacing = refreshMs && stats.smooth ? {
    droppedFrames: stats.droppedFrames, meanMs: stats.meanMs, smoothP95Ms: stats.smooth.p95Ms, smoothMaxMs: stats.smooth.maxMs,
    clean: stats.droppedFrames === 0 && stats.meanMs <= refreshMs * 1.01 && stats.smooth.p95Ms <= refreshMs * 1.03,
  } : null;
  return { verdict, meetsNumbers: meets, claimable, checks, pacing };
}

/** Display line from `system_profiler SPDisplaysDataType` text -> [{name, main, width, height, refreshHz}]. */
function parseDisplays(text) {
  const out = [];
  const chunks = String(text).split(/\n(?= {8}[^ \n].+:\n)/);
  for (const chunk of chunks) {
    const name = chunk.match(/^ {8}([^\n]+):/m)?.[1];
    const mode = chunk.match(/^\s+UI Looks like: (.+)$/m)?.[1] || chunk.match(/^\s+Resolution: (.+)$/m)?.[1];
    if (!name || !mode) continue;
    const res = mode.match(/(\d+)\s*x\s*(\d+)/i), hz = mode.match(/@\s*([\d.]+)\s*Hz/i);
    out.push({ name, main: /^\s+Main Display: Yes$/m.test(chunk), mode, width: res ? +res[1] : null, height: res ? +res[2] : null,
      refreshHz: hz ? +hz[1] : null });
  }
  return out;
}

/** Is the display the target one: 2560x1440 at >= 143.5 Hz (macOS reports 144.00 or 143.99-ish). */
function displayMatchesTarget(d) {
  return !!d && d.width === TARGET.width && d.height === TARGET.height && d.refreshHz >= TARGET.refreshHz - 0.5;
}

const DEFAULTS = {
  quality: 'ultra', region: 'frost', seconds: 60, warmup: 8, url: 'http://127.0.0.1:8107/', server: 'ws://127.0.0.1:7807/ws',
  out: null, attribution: false, attribSeconds: 15, flags: '', uncapped: false, fullscreen: true, profile: 'perf1',
  token: 't1', width: TARGET.width, height: TARGET.height, headless: false, planningTimeout: 90, playwright: null,
};

/** argv (without node and script) -> options. Throws on unknown or malformed arguments. */
function parseArgs(argv) {
  const o = { ...DEFAULTS };
  o.profileExplicit = false;
  const num = (name, v, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number from ${min} to ${max}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i], inline = null;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0) { inline = a.slice(eq + 1); a = a.slice(0, eq); }
    const next = () => { if (inline !== null) return inline; if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    switch (a) {
      case '--quality': {
        const q = next().toLowerCase();
        if (!['low', 'medium', 'high', 'ultra', 'adaptive'].includes(q)) throw new Error('--quality must be low, medium, high, ultra or adaptive');
        o.quality = q; break;
      }
      case '--region': case '--faction': {
        const v = next().toLowerCase();
        if (v in REGIONS) o.region = v;
        else if (/^[0-4]$/.test(v)) o.region = Object.keys(REGIONS).find(k => REGIONS[k] === +v);
        else throw new Error('--region must be fire, sentenced, plague, frost, holy or 0-4');
        break;
      }
      case '--seconds': o.seconds = num('--seconds', next(), 1, 3600); break;
      case '--warmup': o.warmup = num('--warmup', next(), 0, 600); break;
      case '--url': o.url = next(); break;
      case '--server': o.server = next(); break;
      case '--out': o.out = next(); break;
      case '--flags': o.flags = next().replace(/^[?&]/, ''); break;
      case '--attribution': o.attribution = true; break;
      case '--attrib-seconds': o.attribSeconds = num('--attrib-seconds', next(), 3, 600); break;
      case '--uncapped': o.uncapped = true; break;
      case '--no-fullscreen': o.fullscreen = false; break;
      case '--headless': o.headless = true; break;
      case '--profile': o.profile = next(); o.profileExplicit = true; break;
      case '--planning-timeout': o.planningTimeout = num('--planning-timeout', next(), 5, 600); break;
      case '--playwright': o.playwright = next(); break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Error(`unknown argument ${a}`);
    }
  }
  try { new URL(o.url); } catch { throw new Error('--url must be an absolute URL'); }
  if (!/^wss?:\/\//.test(o.server)) throw new Error('--server must be a ws:// or wss:// URL');
  return o;
}

/** The server keeps a seat after the browser closes, so each run needs its own callsign: perf1 plus a short suffix. */
const runSuffix = Date.now().toString(36).slice(-4);
let runCounter = 0;
function profileFor(o) {
  if (o.profileExplicit) return o.profile;
  if (!o._profile) o._profile = `${o.profile}${runSuffix}${(runCounter++).toString(36)}`.slice(0, 16);
  return o._profile;
}

/** The page URL for one run. Never contains secrets beyond the throwaway loopback diagnostic token. */
function buildPageUrl(o, extraFlags = '') {
  const u = new URL(o.url);
  const set = (k, v) => u.searchParams.set(k, v);
  set('server', o.server); set('diagnostic', '1'); set('token', o.token); set('profile', profileFor(o));
  set('faction', String(REGIONS[o.region])); set('perf', '1'); set('quality', o.quality);
  for (const part of [o.flags, extraFlags].join('&').split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0) set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1)));
  }
  return u.toString();
}

/**
 * Scripted input timeline: steady walking in a square with periodic strafe changes, cursor sweeping around the
 * character, and left-button attack bursts. Deterministic. Times are seconds from the start of the window.
 * Events: {t, kind: 'down'|'up'|'move'|'mdown'|'mup', key?, fx?, fy?} where fx, fy are canvas fractions (0..1).
 */
function buildTimeline(totalSeconds) {
  const ev = [];
  const legs = ['w', 'd', 's', 'a'];            // walk a loop so the character keeps moving through the region
  const LEG = 2.0, ATTACK_PERIOD = 3.0, ATTACK_HOLD = 1.2;
  let held = null;
  for (let t = 0, i = 0; t < totalSeconds; t += LEG, i++) {
    if (held) ev.push({ t, kind: 'up', key: held });
    held = legs[i % legs.length];
    ev.push({ t, kind: 'down', key: held });
  }
  if (held) ev.push({ t: totalSeconds, kind: 'up', key: held });
  // Cursor circles the character at ~0.28 of the screen height so aim, facing and the walk direction keep disagreeing.
  for (let t = 0; t < totalSeconds; t += 0.25) {
    const a = (t / 4) * Math.PI * 2;
    ev.push({ t, kind: 'move', fx: 0.5 + 0.2 * Math.cos(a), fy: 0.45 + 0.28 * Math.sin(a) });
  }
  for (let t = 0.5; t < totalSeconds; t += ATTACK_PERIOD) {
    ev.push({ t, kind: 'mdown' });
    ev.push({ t: Math.min(totalSeconds, t + ATTACK_HOLD), kind: 'mup' });
  }
  return ev.sort((x, y) => x.t - y.t || order(x.kind) - order(y.kind));
  function order(kind) { return { up: 0, mup: 0, move: 1, down: 2, mdown: 3 }[kind]; }
}

/** Frame log CSV: index, rAF timestamp (ms), delta from the previous frame (ms). */
function toCsv(timestamps) {
  const lines = ['frame,timestamp_ms,delta_ms'];
  for (let i = 0; i < timestamps.length; i++) {
    lines.push(`${i},${timestamps[i].toFixed(3)},${i ? (timestamps[i] - timestamps[i - 1]).toFixed(3) : ''}`);
  }
  return lines.join('\n') + '\n';
}

const ATTRIBUTION_TOGGLES = [
  { name: 'post-processing (all)', flag: 'fx.post=0' },
  { name: 'bloom', flag: 'fx.bloom=0' },
  { name: 'colour grading + tonemapping', flag: 'fx.grading=0' },
  { name: 'vignette', flag: 'fx.vignette=0' },
  { name: 'shadows', flag: 'fx.shadows=0' },
  { name: 'dynamic lights', flag: 'fx.lights=0' },
  { name: 'ambient screen particles', flag: 'fx.ambient=0' },
  { name: 'particles', flag: 'fx.particles=0' },
  { name: 'render scale 0.75', flag: 'fx.scale=0.75' },
];

/** Cost of each effect: the baseline minus the same window with that effect off (positive = the effect costs time). */
function attributionTable(baseline, variants) {
  const rows = variants.map(v => ({
    effect: v.name, flag: v.flag,
    meanMsSaved: baseline.meanMs - v.stats.meanMs, p50MsSaved: baseline.p50Ms - v.stats.p50Ms, p95MsSaved: baseline.p95Ms - v.stats.p95Ms,
    meanMs: v.stats.meanMs, p95Ms: v.stats.p95Ms, frames: v.stats.count,
  }));
  return rows.sort((a, b) => b.meanMsSaved - a.meanMsSaved);
}

// ----------------------------------------------------------------------------------------------- browser driving

const sleep = ms => new Promise(r => setTimeout(r, ms));
const redact = s => String(s).replace(/([?&](?:token|resume|ticket|session)=)[^&\s]+/gi, '$1[redacted]');

function loadPlaywright(o) {
  const candidates = [o.playwright, process.env.RH_PLAYWRIGHT_MODULE,
    path.join(os.homedir(), '.codex/tools/rougehalla-stage2/browser/node_modules/playwright'), 'playwright'].filter(Boolean);
  let last;
  for (const c of candidates) { try { return require(c).chromium; } catch (e) { last = e; } }
  throw new Error(`Playwright not found (${last && last.message}); pass --playwright <module path>`);
}

function readDisplays() {
  if (process.platform !== 'darwin') return { status: 'unavailable', reason: 'system_profiler is macOS only', displays: [] };
  try {
    const text = execFileSync('system_profiler', ['SPDisplaysDataType', '-detailLevel', 'mini'], { encoding: 'utf8', timeout: 20000 });
    const displays = parseDisplays(text);
    return { status: displays.length ? 'observed' : 'unparsed', displays };
  } catch (e) { return { status: 'unavailable', reason: String(e.message || e), displays: [] }; }
}

async function fetchInfo(server) {
  const u = new URL(server); u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'; u.pathname = '/info'; u.search = '';
  try { const r = await fetch(u, { signal: AbortSignal.timeout(5000) }); return { url: u.toString(), ...(await r.json()) }; }
  catch (e) { return { url: u.toString(), error: String(e.message || e) }; }
}

/** One browser session: launch, join, plan, warm up, record `seconds`. Returns everything measured. */
async function session(o, { seconds, uncapped, extraFlags = '', label, outDir, screenshots, refreshHz = 0 }) {
  const chromium = loadPlaywright(o);
  o._profile = null; // a fresh callsign per browser session
  const args = ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-features=Metal',
    '--autoplay-policy=no-user-gesture-required'];
  if (uncapped) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
  const browser = await chromium.launch({ headless: o.headless, args });
  const rec = { label, uncapped, extraFlags, pageUrl: redact(buildPageUrl(o, extraFlags)), errors: [], httpErrors: [], netStates: [],
    wire: { framesReceived: 0, bytesReceived: 0, framesSent: 0 }, actorSamples: [], notes: [] };
  try {
    const context = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', e => rec.errors.push(redact(e)));
    page.on('console', m => {
      const t = m.text();
      if (m.type() === 'error') rec.errors.push(redact(t));
      if (t.startsWith('[net]')) rec.netStates.push({ at: Date.now(), text: redact(t).slice(0, 160) });
    });
    page.on('response', r => { if (r.status() >= 400) rec.httpErrors.push({ status: r.status(), url: redact(r.url()) }); });
    page.on('websocket', ws => {
      ws.on('framereceived', f => { rec.wire.framesReceived++; rec.wire.bytesReceived += typeof f.payload === 'string' ? f.payload.length : f.payload.length; });
      ws.on('framesent', () => { rec.wire.framesSent++; });
    });
    const t0 = Date.now();
    await page.goto(buildPageUrl(o, extraFlags), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.bringToFront();
    if (o.fullscreen && !o.headless) {
      try {
        const cdp = await context.newCDPSession(page);
        const { windowId } = await cdp.send('Browser.getWindowForTarget');
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
        await sleep(800);
        rec.window = (await cdp.send('Browser.getWindowBounds', { windowId })).bounds;
        await cdp.detach();
      } catch (e) { rec.notes.push('fullscreen request failed: ' + e.message); }
    }
    await page.locator('#unity-canvas').waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('#unity-loading-bar').waitFor({ state: 'hidden', timeout: 180000 });
    await page.waitForFunction(() => !!window.__rhPerf, undefined, { timeout: 60000 });
    rec.loadMs = Date.now() - t0;

    rec.gpu = await page.evaluate(() => {
      const c = document.getElementById('unity-canvas'), gl = c.getContext('webgl2');
      const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: gl ? (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : null,
        canvas: { width: c.width, height: c.height }, drawingBuffer: gl ? { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight } : null,
        devicePixelRatio: devicePixelRatio, inner: { width: innerWidth, height: innerHeight },
        screen: { width: screen.width, height: screen.height }, visibility: document.visibilityState, userAgent: navigator.userAgent };
    });

    // Join -> planning -> Ready -> match.
    await planThenReady(page, o, rec, outDir, screenshots);

    // Measure the browser's real frame cadence for a moment (is the compositor really delivering 144 Hz?).
    rec.cadence = await page.evaluate(async () => {
      const P = window.__rhPerf; P.reset(); await new Promise(r => setTimeout(r, 2500)); P.stop();
      const s = P.stats(); P.reset(); P.resume();
      return { medianMs: s.p50Ms, p05Ms: null, hz: s.p50Ms ? 1000 / s.p50Ms : null, frames: s.count };
    });
    rec.measuredHz = rec.cadence.hz;

    rec.loadAvgBefore = os.loadavg();
    await sleep(Math.max(0, o.warmup) * 1000);
    if (screenshots) await shot(page, outDir, `${label}-before.png`, rec);

    await page.evaluate(hz => { if (hz) window.__rhPerf.setRefreshHz(hz); window.__rhPerf.reset(); }, refreshHz);
    const startedAt = Date.now();
    await runTimeline(page, o, seconds, rec);
    rec.recordedSeconds = (Date.now() - startedAt) / 1000;
    rec.loadAvgAfter = os.loadavg();
    const data = await page.evaluate(() => { const P = window.__rhPerf; P.stop(); return { stats: P.stats(), timestamps: P.timestamps(), row: P.row }; });
    if (screenshots) await shot(page, outDir, `${label}-after.png`, rec);
    rec.pageStats = data.stats; rec.timestamps = data.timestamps; rec.row = data.row;
    rec.showcaseSettings = await page.evaluate(() => window.__rhShowcaseSettings || null);
    rec.userAgent = rec.gpu.userAgent; rec.browserVersion = browser.version();
    return rec;
  } finally { await browser.close().catch(() => {}); }
}

async function shot(page, outDir, name, rec) {
  try { await page.screenshot({ path: path.join(outDir, name) }); (rec.screenshots ||= []).push(name); }
  catch (e) { rec.notes.push(`screenshot ${name} failed: ${e.message}`); }
}

// Panel anchors from TacticalMapController (fractions of the canvas, y up): panel (.025,.155)-(.975,.915); planning
// rail (.715,.18)-(.98,.89) of the panel; Spawn0 (0,.77)-(1,.94), Boon0 (0,.36)-(1,.49), Ready (0,0)-(1,.17) of the rail.
function planningPoint(rx, ry) {
  const panel = { x0: .025, y0: .155, w: .95, h: .76 }, rail = { x0: .715, y0: .18, w: .265, h: .71 };
  const px = rail.x0 + rx * rail.w, py = rail.y0 + ry * rail.h;
  return { fx: panel.x0 + px * panel.w, fy: 1 - (panel.y0 + py * panel.h) }; // fy from the top, as the mouse wants
}

async function click(page, fx, fy, o) {
  await page.mouse.click(fx * o.width, fy * o.height, { delay: 80 });
  await sleep(250);
}

async function planThenReady(page, o, rec, outDir, screenshots) {
  const deadline = Date.now() + o.planningTimeout * 1000;
  // The planning map opens by itself when the server starts planning; try the spawn, boon and Ready buttons repeatedly
  // until the console reports the match has begun or the deadline passes.
  const inMatch = () => rec.netStates.some(s => /InMatch/.test(s.text));
  let attempts = 0;
  await sleep(2000);
  while (Date.now() < deadline) {
    attempts++;
    await page.mouse.move(o.width * .5, o.height * .5);
    for (const [rx, ry] of [[.5, .855], [.5, .42], [.5, .085]]) {
      const p = planningPoint(rx, ry);
      await click(page, p.fx, p.fy, o);
    }
    await sleep(1500);
    if (attempts === 2 && screenshots) await shot(page, outDir, `${rec.label}-planning.png`, rec);
    // The recorder's actor count only moves once the arena renders observers; combine with the console signal.
    const actors = await page.evaluate(() => window.__rhPerf.actors);
    if (inMatch() && actors > 0 && attempts >= 3) break;
    await sleep(1500);
  }
  rec.planning = { attempts, inMatchSeen: inMatch(), seconds: o.planningTimeout - Math.max(0, (deadline - Date.now()) / 1000) };
  if (!rec.planning.inMatchSeen) rec.notes.push('console never reported InMatch; the run may have measured the planning screen');
  // Planning panel may still be open; a Tab press toggles the map closed if so (harmless if closed in the arena HUD).
  await page.keyboard.press('Escape');
  await sleep(500);
}

async function runTimeline(page, o, seconds, rec) {
  const events = buildTimeline(seconds);
  const start = Date.now();
  let idx = 0, nextSample = 0;
  const held = new Set();
  let mouseDown = false;
  while (true) {
    const now = (Date.now() - start) / 1000;
    if (now >= seconds) break;
    while (idx < events.length && events[idx].t <= now) {
      const e = events[idx++];
      if (e.kind === 'down') { held.add(e.key); await page.keyboard.down(e.key); }
      else if (e.kind === 'up') { held.delete(e.key); await page.keyboard.up(e.key); }
      else if (e.kind === 'move') await page.mouse.move(e.fx * o.width, e.fy * o.height);
      else if (e.kind === 'mdown') { mouseDown = true; await page.mouse.down(); }
      else if (e.kind === 'mup') { mouseDown = false; await page.mouse.up(); }
    }
    if (now >= nextSample) {
      nextSample += 1;
      rec.actorSamples.push(await page.evaluate(() => window.__rhPerf.actors));
    }
    await sleep(15);
  }
  for (const k of held) await page.keyboard.up(k);
  if (mouseDown) await page.mouse.up();
}

// ------------------------------------------------------------------------------------------------------ orchestration

/** A run only counts if the client actually reached an active match with other actors and live wire traffic. */
function validateRun(rec, sum) {
  const problems = [];
  if (!rec.planning || !rec.planning.inMatchSeen) problems.push('the client never reported InMatch');
  if (rec.netStates.some(s => /Rejected/.test(s.text))) problems.push('the server rejected the join: ' + rec.netStates.find(s => /Rejected/.test(s.text)).text.trim());
  if (!(sum.actors.max > 0)) problems.push('no actors were ever presented on screen');
  if (rec.wire.framesReceived < 100) problems.push(`only ${rec.wire.framesReceived} server frames arrived`);
  if (rec.errors.length) problems.push(`${rec.errors.length} console/page errors (first: ${rec.errors[0].slice(0, 120)})`);
  return { valid: problems.filter(p => !/console\/page errors/.test(p)).length === 0, problems };
}

function summariseRun(rec, displayInfo) {
  const deltas = [];
  for (let i = 1; i < rec.timestamps.length; i++) deltas.push(rec.timestamps[i] - rec.timestamps[i - 1]);
  const refreshHz = displayInfo.verified ? displayInfo.refreshHz : (rec.uncapped ? 0 : rec.measuredHz || 0);
  const stats = frameStats(deltas, refreshHz || undefined);
  const actors = rec.actorSamples.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    stats, deltas,
    actors: { samples: actors.length, p50: percentile(actors, .5), max: actors.length ? actors[actors.length - 1] : null, min: actors[0] ?? null },
  };
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 16).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); return 0; }
  const repo = path.resolve(__dirname, '../../..');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.resolve(o.out || path.join(repo, 'docs/rework/evidence/perf', `${o.quality}-${o.region}-${stamp}`));
  fs.mkdirSync(outDir, { recursive: true });

  const info = await fetchInfo(o.server);
  const sys = readDisplays();
  const main_ = sys.displays.find(d => d.main) || sys.displays[0] || null;
  const sysMatches = displayMatchesTarget(main_);
  console.log(`display (system_profiler): ${main_ ? `${main_.name} ${main_.width}x${main_.height} @ ${main_.refreshHz} Hz` : sys.status}`);
  console.log(`server /info: ${info.error ? 'unreachable: ' + info.error : `protocol ${info.protocol}, state ${info.state}`}`);

  // Pass 1: normal vsync-paced run on the real display. If the display is not the target, go straight to vsync-off.
  let uncapped = o.uncapped || !sysMatches;
  let displayInfo = { verified: false, refreshHz: main_ ? main_.refreshHz : null, reason: sysMatches ? null : 'system display is not 2560x1440 @ 144 Hz' };
  const common = { outDir, screenshots: true, refreshHz: sysMatches ? main_.refreshHz : 0 };
  let result;
  if (o.attribution) {
    result = await attribution(o, outDir, info, main_);
  } else {
    let rec = await session(o, { ...common, seconds: o.seconds, uncapped, label: o.quality });
    let sum = summariseRun(rec, { verified: false });
    if (!uncapped) {
      // Verify what the browser actually delivered, not just what the OS says.
      const hz = rec.measuredHz;
      const sizeOk = rec.gpu.drawingBuffer && rec.gpu.drawingBuffer.width === TARGET.width && rec.gpu.drawingBuffer.height === TARGET.height;
      const cadenceOk = hz && Math.abs(hz - (main_.refreshHz || 0)) / main_.refreshHz < 0.06;
      displayInfo = { verified: !!(sizeOk && cadenceOk), refreshHz: main_.refreshHz, measuredHz: hz, backbufferOk: !!sizeOk,
        reason: sizeOk ? (cadenceOk ? null : `browser rAF cadence ${hz && hz.toFixed(1)} Hz is not the display's ${main_.refreshHz} Hz`)
          : `drawing buffer ${JSON.stringify(rec.gpu.drawingBuffer)} is not ${TARGET.width}x${TARGET.height}` };
      if (!displayInfo.verified) {
        console.log(`display NOT verified (${displayInfo.reason}); falling back to a vsync-off measurement`);
        uncapped = true;
        rec = await session(o, { ...common, seconds: o.seconds, uncapped, label: o.quality + '-uncapped' });
      }
    }
    if (uncapped && !displayInfo.reason) displayInfo.reason = 'vsync-off run requested';
    const finalDisplay = { ...displayInfo, verified: displayInfo.verified && !uncapped };
    sum = summariseRun(rec, finalDisplay);
    const validity = validateRun(rec, sum);
    const verdict = evaluate(sum.stats, { displayVerified: finalDisplay.verified, vsyncOff: uncapped });
    if (!validity.valid) verdict.verdict = 'INVALID RUN: ' + validity.problems.join('; ');
    result = { kind: 'run', rec, sum, verdict, validity, displayInfo: finalDisplay, vsyncOff: uncapped };
  }
  writeOutputs(o, outDir, info, sys, result);
  if (/^INVALID/.test(result.verdict.verdict)) return 2;
  return result.verdict && result.verdict.verdict === 'FAIL' ? 1 : 0;
}

async function attribution(o, outDir, info, main_) {
  const base = await session(o, { outDir, screenshots: true, seconds: o.attribSeconds, uncapped: true, label: 'attrib-baseline' });
  const baseSum = summariseRun(base, { verified: false });
  const variants = [];
  for (const t of ATTRIBUTION_TOGGLES) {
    console.log(`attribution: ${t.name} off (${t.flag})`);
    const rec = await session(o, { outDir, screenshots: false, seconds: o.attribSeconds, uncapped: true, extraFlags: t.flag,
      label: 'attrib-' + t.flag.replace(/[^a-z0-9]+/gi, '_') });
    variants.push({ ...t, stats: summariseRun(rec, { verified: false }).stats, errors: rec.errors.length });
  }
  const baseValidity = validateRun(base, baseSum);
  if (!baseValidity.valid) throw new Error('attribution baseline is not a valid run: ' + baseValidity.problems.join('; '));
  return { kind: 'attribution', rec: base, sum: baseSum, vsyncOff: true,
    table: attributionTable(baseSum.stats, variants), variants,
    verdict: { verdict: 'ATTRIBUTION (vsync off; costs are frame-time differences, not a target claim)' } };
}

const r3 = v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

function writeOutputs(o, outDir, info, sys, result) {
  const { rec, sum } = result;
  const stripStats = s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, r3(v)]));
  const report = {
    tool: 'perf-run.cjs', generatedAt: new Date().toISOString(), options: { ...o, token: '[redacted]' },
    target: TARGET, server: { info }, host: { platform: process.platform, release: os.release(), cpus: os.cpus()[0] && os.cpus()[0].model, cpuCount: os.cpus().length,
      loadAvgBeforeWindow: rec.loadAvgBefore, loadAvgAfterWindow: rec.loadAvgAfter },
    displaySystem: sys, display: result.displayInfo || null, vsyncOff: result.vsyncOff,
    browser: { version: rec.browserVersion, userAgent: rec.userAgent, gpu: rec.gpu, window: rec.window, uncapped: rec.uncapped },
    run: {
      pageUrl: rec.pageUrl, loadMs: rec.loadMs, planning: rec.planning, recordedSeconds: r3(rec.recordedSeconds), quality: rec.row,
      showcaseSettings: rec.showcaseSettings, cadenceCheck: rec.cadence, frameStats: stripStats(sum.stats), pageReportedStats: rec.pageStats,
      actors: sum.actors, wire: rec.wire, netStates: rec.netStates.slice(-12), errors: rec.errors, httpErrors: rec.httpErrors, notes: rec.notes,
      screenshots: rec.screenshots || [],
    },
    verdict: result.verdict, validity: result.validity || null,
    caveats: [
      'Frame time is the delta between consecutive requestAnimationFrame timestamps in the page (presented cadence as the browser reports it), not GPU time.',
      'Under vsync a frame cannot be faster than the refresh interval, so headroom is invisible; the attribution mode therefore runs vsync-off.',
      'Playwright input events and screenshots run in the same browser; screenshots are taken outside the recorded window.',
      'Other processes on the machine (other Unity editors, browsers) share the GPU and CPU; host.loadAvg* is recorded so a noisy run can be recognised. Runs differ because bot fights are not deterministic.',
      'A scripted walk-and-attack loop against server bots is representative of a fight only to the extent bots engage; see run.actors and run.wire for activity evidence.',
    ],
  };
  if (result.kind === 'attribution') { report.attribution = { baseline: stripStats(sum.stats), rows: result.table.map(stripStats2) }; }
  function stripStats2(r) { return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, r3(v)])); }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'frames.csv'), toCsv(rec.timestamps));
  printSummary(report, result, outDir);
}

function printSummary(report, result, outDir) {
  const s = result.sum.stats, f = x => (typeof x === 'number' ? x.toFixed(2) : String(x));
  console.log('');
  console.log(`frames ${s.count}  p50 ${f(s.p50Ms)} ms  p95 ${f(s.p95Ms)} ms  p99 ${f(s.p99Ms)} ms  worst-1% mean ${f(s.worst1PctMeanMs)} ms (${f(s.worst1PctFps)} fps)  max ${f(s.maxMs)} ms`);
  if (s.droppedFrames !== undefined) console.log(`dropped frames (> 1.5 x ${f(1000 / s.refreshHz)} ms): ${s.droppedFrames} (${f(s.droppedPct)}%)`);
  console.log(`actors on screen p50 ${result.sum.actors.p50} max ${result.sum.actors.max}; wire frames ${report.run.wire.framesReceived}`);
  if (result.kind === 'attribution') {
    console.log('\nEffect cost (baseline minus effect-off, vsync off; positive = the effect costs this much per frame)');
    for (const r of result.table) console.log(`  ${r.effect.padEnd(32)} mean ${f(r.meanMsSaved).padStart(7)} ms   p95 ${f(r.p95MsSaved).padStart(7)} ms   (${r.flag})`);
  } else {
    const c = result.verdict.checks;
    console.log(`p95 <= ${TARGET.p95Ms} ms: ${c.p95.pass ? 'yes' : 'NO'}   worst 1% >= ${TARGET.worst1PctFps} fps (<= ${TARGET.worst1PctMs} ms): ${c.worst1Pct.pass ? 'yes' : 'NO'}`);
    if (result.verdict.pacing) { const pc = result.verdict.pacing; console.log(`pacing (jitter-robust, informational): ${pc.clean ? 'clean' : 'NOT clean'} - dropped ${pc.droppedFrames}, mean ${f(pc.meanMs)} ms, 8-frame-average p95 ${f(pc.smoothP95Ms)} ms, max ${f(pc.smoothMaxMs)} ms`); }
    console.log(`display verified (2560x1440 @ 144 Hz): ${result.displayInfo.verified ? 'yes' : 'NO - ' + result.displayInfo.reason}${result.vsyncOff ? '; vsync off' : ''}`);
  }
  console.log(`\n${result.verdict.verdict}`);
  if (report.run.errors.length) console.log(`console/page errors: ${report.run.errors.length} (first: ${report.run.errors[0].slice(0, 200)})`);
  console.log(`report: ${path.join(outDir, 'report.json')}`);
}

module.exports = { validateRun, profileFor, smoothDeltas, TARGET, REGIONS, percentile, worstOnePercentMean, frameStats, evaluate, parseDisplays, displayMatchesTarget, parseArgs,
  buildPageUrl, buildTimeline, toCsv, attributionTable, ATTRIBUTION_TOGGLES, planningPoint };

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => { console.error(e.stack || e.message); process.exitCode = 2; });
}
