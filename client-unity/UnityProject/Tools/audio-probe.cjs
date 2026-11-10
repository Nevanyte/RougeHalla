#!/usr/bin/env node
// Objective audio verification of the Unity Web client in headed Chromium (nobody on the project has to listen).
//   node client-unity/UnityProject/Tools/audio-probe.cjs [--out docs/rework/evidence/audio] [--only launch,region,steps,tracks,volume,full]
// Env: RH_PROBE_URL (default http://127.0.0.1:8247/), RH_PROBE_WS (default ws://127.0.0.1:7947/ws), RH_STAGE2_PREFIX (Playwright location).
// The page host must be the literal 127.0.0.1 (AudioWorklet and autoplay need a secure context). An init script (audio-probe-inject.js)
// wraps AudioContext so everything sent to the destination also feeds an AnalyserNode and an AudioWorklet tap; see audio-probe-lib.cjs
// for the maths (unit tested). Writes audio-report.json, audio-report.md and SVG plots of output level over time.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('./audio-probe-lib.cjs');
const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const repo = path.resolve(__dirname, '../../..');
const outDir = path.resolve(repo, opt('out', 'docs/rework/evidence/audio'));
const only = opt('only', 'files,launch,region,audition,steps,tracks,loops,volume,full').split(',');
const baseUrl = process.env.RH_PROBE_URL || 'http://127.0.0.1:8247/';
const wsUrl = process.env.RH_PROBE_WS || 'ws://127.0.0.1:7947/ws';
const W = Number(opt('w', 1280)), H = Number(opt('h', 720));
const extraQuery = process.env.RH_PROBE_QUERY || '';
const BOOT_MS = Number(process.env.RH_PROBE_BOOT_MS || 14000);
const injectPath = path.join(__dirname, 'audio-probe-inject.js');

const REGION_FILES = { fire: ['music_fire', 'amb_fire'], sentenced: ['music_sentenced', 'amb_sentenced'], plague: ['music_plague', 'amb_plague'], frost: ['music_frost', 'amb_frost'], holy: ['music_holy', 'amb_holy'], coliseum: ['music_coliseum'] };
const MUSIC = ['music_fire', 'music_sentenced', 'music_plague', 'music_frost', 'music_holy', 'music_coliseum'];
const AMBIENCE = ['amb_fire', 'amb_sentenced', 'amb_plague', 'amb_frost', 'amb_holy'];
const FATAL_CONSOLE = /FMOD|not loaded yet|AudioContext was not allowed/i;
const SILENCE_DB = -55, AUDIBLE_DB = -50;

let chromium; try { ({ chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'))); } catch (e) { if (true) { console.error('Playwright not found: ' + e.message); process.exit(2); } }

// ---------------- UI geometry (same maths as atmosphere-shots.cjs) ----------------
function legacyScale(w, h) { const stageW = w / h <= 21 / 9 ? w : Math.floor(h * 21 / 9); return Math.min(1.5, Math.max(0.8, Math.min(stageW / 1280, h / 800))); }
function readyClick() {
  const stageW = W / H <= 21 / 9 ? W : Math.floor(H * 21 / 9);
  const s = Math.min(1.5, Math.max(0.8, Math.min(stageW / 1280, H / 800)));
  const uiW = W / s, uiH = H / s;
  const pSide = Math.min(780, Math.max(260, Math.floor(Math.min(uiH - 44 - 12 - 124, uiW - 340 - 24 - 12 - 8))));
  const pFrame = pSide + 8, pTotal = pFrame + 12 + 340, pColH = 40 + 12 + pFrame + 12 + 52;
  const pBx = Math.floor((uiW - pTotal) / 2), pBy = Math.max(44, Math.floor((uiH - pColH) / 2 + 11));
  return { x: (pBx + pFrame + 12 + 12 + 158) * s, y: (pBy + 12 + 23) * s };
}

// Minimap walking (same maths as atmosphere-shots.cjs): the hero's tile from the minimap marker, and a right-click on the minimap walks there.
const MAP_TILES = 160;
function minimapRect(w, h, s) {
  const uiW = Math.floor(w / s), uiH = Math.floor(h / s);
  const wanted = Math.min(312, Math.max(195, Math.round(uiH * 0.338)));
  const room = Math.floor(uiW / 2 - 12 - 152);
  const size = Math.round(Math.min(Math.min(wanted, Math.max(110, room)), uiW * 0.42, uiH * 0.6));
  return { x: w - (12 + size) * s, y: h - (12 + size) * s, size: size * s };
}
async function selfTile(page) {
  const mini = minimapRect(W, H, legacyScale(W, H));
  const buf = await page.screenshot({ clip: { x: mini.x, y: mini.y, width: mini.size, height: mini.size } });
  return page.evaluate(async ([b64]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 137) <= 14 && Math.abs(d[i + 1] - 206) <= 14 && Math.abs(d[i + 2] - 246) <= 14) { const k = i / 4; sx += k % c.width; sy += Math.floor(k / c.width); n++; }
    return n > 3 ? { tx: sx / n / c.width * 160, ty: sy / n / c.height * 160, n } : null;
  }, [buf.toString('base64')]);
}
async function walkTo(page, tx, ty, timeoutMs) {
  const mini = minimapRect(W, H, legacyScale(W, H));
  const click = async () => { await page.mouse.move(mini.x + mini.size * tx / MAP_TILES, mini.y + mini.size * ty / MAP_TILES); await page.waitForTimeout(150); await page.mouse.down({ button: 'right' }); await page.waitForTimeout(90); await page.mouse.up({ button: 'right' }); };
  const t0 = Date.now(); let last = Date.now(), pos = null; await click();
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(1500); pos = await selfTile(page);
    if (pos && Math.hypot(pos.tx - tx, pos.ty - ty) < 3) return pos;
    if (Date.now() - last > 8000) { await click(); last = Date.now(); }
  }
  return pos;
}
// Region poles in tiles, from crates/rh-sim/src/mapdata/fixtures/seed1.map.json (regions[].pole / 32).
const POLES = {"fire": [28, 54], "sentenced": [136, 64], "plague": [40, 126], "frost": [104, 126], "holy": [88, 34]};

// ---------------- session ----------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function openSession(label, { faction = 3, spawn = '1', query = '', enterMatch = true } = {}) {
  const browser = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await context.addInitScript({ path: injectPath });
  const page = await context.newPage();
  const S = { label, browser, page, consoleAll: [], requests: [], pageErrors: [], t0Wall: Date.now(), timeOrigin: 0 };
  page.on('console', m => S.consoleAll.push({ wall: Date.now(), type: m.type(), text: m.text() }));
  page.on('pageerror', e => S.pageErrors.push(String(e.message)));
  page.on('request', r => { const u = r.url(); if (/StreamingAssets\/Audio\//.test(u)) S.requests.push({ wall: Date.now(), file: u.split('/').pop(), status: null }); });
  page.on('response', r => { const u = r.url(); if (/StreamingAssets\/Audio\//.test(u)) { const f = u.split('/').pop(); const q = S.requests.find(x => x.file === f && x.status === null); if (q) q.status = r.status(); } });
  const profile = `aud${Math.random().toString(36).slice(2, 8)}`.slice(0, 16);
  const url = `${baseUrl}?server=${encodeURIComponent(wsUrl)}&profile=${profile}&faction=${faction}&diagnostic=1&token=t1&surfacefx=1&audiolog=1&fx.quality=high${extraQuery}${query}`;
  await page.goto(url, { waitUntil: 'load' });
  S.timeOrigin = await page.evaluate(() => performance.timeOrigin);
  S.pageT = wall => wall - S.timeOrigin;
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForTimeout(BOOT_MS);
  S.joinedAt = await now(S);
  if (enterMatch) await enterMatchNow(S, spawn);
  return S;
}
async function now(S) { return S.page.evaluate(() => performance.now()); }
async function enterMatchNow(S, spawn) {
  const { page } = S;
  await page.keyboard.press(spawn); await page.waitForTimeout(600);
  const c = readyClick(); await page.mouse.click(c.x, c.y, { delay: 80 });
  S.readyClickedAt = await now(S);
  await page.waitForTimeout(2500);
}
async function close(S) { try { await S.browser.close(); } catch (_) {} }
async function sendUnity(S, method, arg) { return S.page.evaluate(([m, a]) => { try { window.unityInstance.SendMessage('RhAudioDebug', m, a); return true; } catch (e) { return String(e); } }, [method, String(arg)]); }
async function data(S) {
  const d = await S.page.evaluate(() => { const P = window.__rhAudioProbe; return { windows: P.windows.slice(), console: P.console.slice(), markers: P.markers.slice(), state: P.state(), errors: P.errors.slice(), started: P.sourcesStarted, ended: P.sourcesEnded, workletReady: P.workletReady, unity: P.unityAudio(), unityKeys: P.unityKeys(), now: performance.now() }; });
  // The worklet reports the audio-thread render time (ct, seconds). Map it onto the page clock with the smallest message latency seen
  // (arrival minus ct): the best estimate of the fixed offset, immune to main-thread stalls that delay individual messages.
  if (d.windows.length) { const off = Math.min(...d.windows.map(w => w.arrived - w.ct * 1000)); for (const w of d.windows) w.t = w.ct * 1000 + off; }
  return d;
}
const levelsDb = ws => ws.map(w => L.toDb(w.rms));
function logLines(D, re) { return D.console.filter(c => re.test(c.text)); }
function audioLog(D) { return D.console.filter(c => c.text.startsWith('[audio] ')).map(c => ({ t: c.t, text: c.text.replace(/^\[audio\] t=[\d.]+ /, '') })); }
function between(ws, a, b) { return ws.filter(w => w.t >= a && w.t <= b); }
function summarize(ws) {
  if (!ws.length) return { n: 0, rmsDb: L.FLOOR_DB, peakDb: L.FLOOR_DB };
  return { n: ws.length, rmsDb: +L.toDb(L.rmsOfWindows(ws.map(w => w.rms))).toFixed(2), peakDb: +L.toDb(Math.max(...ws.map(w => w.peak))).toFixed(2) };
}
// For each FMOD / not-loaded console line: the previous few page log lines (what the game had just done), to attribute the cause.
function fmodContext(D, max = 6) {
  const out = []; const lines = D.console;
  for (let i = 0; i < lines.length && out.length < max; i++) {
    if (!FATAL_CONSOLE.test(lines[i].text)) continue;
    if (out.length && lines[i].t - out[out.length - 1].t < 400) continue;
    const prev = []; for (let j = i - 1; j >= 0 && prev.length < 3; j--) if (!FATAL_CONSOLE.test(lines[j].text) && !/beat prints/.test(lines[j].text)) prev.unshift(`${Math.round(lines[j].t - lines[i].t)}ms ${lines[j].text.slice(0, 90)}`);
    out.push({ t: Math.round(lines[i].t), text: lines[i].text.slice(0, 80), prev });
  }
  return out;
}
function consoleViolations(S) { return S.consoleAll.filter(c => FATAL_CONSOLE.test(c.text)).map(c => c.text); }
function fmtReq(S) { return S.requests.map(r => ({ file: r.file, status: r.status, tMs: Math.round(S.pageT(r.wall)) })); }

// ---------------- SVG plots ----------------
function plotSvg(file, title, series, marks, { w = 900, h = 260, yMin = -90, yMax = 0 } = {}) {
  const t0 = Math.min(...series.map(s => s.t[0])), t1 = Math.max(...series.map(s => s.t[s.t.length - 1])); const px = 46, py = 22;
  const X = t => px + (t - t0) / Math.max(1, t1 - t0) * (w - px - 10), Y = d => py + (1 - (Math.max(yMin, Math.min(yMax, d)) - yMin) / (yMax - yMin)) * (h - py - 24);
  let g = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="monospace" font-size="10"><rect width="${w}" height="${h}" fill="#101418"/>`;
  g += `<text x="${px}" y="14" fill="#cfd8dc">${title}</text>`;
  for (let d = yMin; d <= yMax; d += 20) g += `<line x1="${px}" x2="${w - 10}" y1="${Y(d)}" y2="${Y(d)}" stroke="#2a3238"/><text x="4" y="${Y(d) + 3}" fill="#90a4ae">${d}</text>`;
  const sec = Math.max(1, Math.round((t1 - t0) / 1000 / 10));
  for (let s = 0; s <= (t1 - t0) / 1000; s += sec) g += `<text x="${X(t0 + s * 1000) - 6}" y="${h - 8}" fill="#90a4ae">${s}s</text>`;
  for (const m of marks || []) if (m.t >= t0 && m.t <= t1) g += `<line x1="${X(m.t)}" x2="${X(m.t)}" y1="${py}" y2="${h - 24}" stroke="${m.color || '#ffb300'}" stroke-dasharray="3 3"/><text x="${X(m.t) + 2}" y="${py + 10 + (m.row || 0) * 11}" fill="${m.color || '#ffb300'}">${m.label}</text>`;
  for (const s of series) { let d = ''; s.t.forEach((t, i) => { d += (i ? 'L' : 'M') + X(t).toFixed(1) + ' ' + Y(s.v[i]).toFixed(1); }); g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1"/>`; }
  g += '</svg>'; fs.writeFileSync(file, g);
}
function downsample(t, v, step) { const T = [], V = []; for (let i = 0; i < t.length; i += step) { T.push(t[i]); V.push(v[i]); } return { t: T, v: V }; }

// ---------------- scenarios ----------------
const report = { generatedAt: new Date().toISOString(), url: baseUrl, assertions: [], sessions: {} };
function check(name, pass, detail) { report.assertions.push({ name, pass: !!pass, detail }); console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); }

// 1. Launch and planning screens are silent; nothing is requested before the match.
async function scenarioLaunch() {
  console.log('scenario launch/planning');
  const S = await openSession('launch', { faction: 3, enterMatch: false });
  await S.page.waitForTimeout(4000);
  const D1 = await data(S); const pre = summarize(between(D1.windows, D1.now - 6000, D1.now));
  // planning screen: press spawn option but do not click Ready
  await S.page.keyboard.press('1'); await S.page.waitForTimeout(5000);
  const D2 = await data(S); const plan = summarize(between(D2.windows, D2.now - 4500, D2.now));
  const reqBefore = fmtReq(S);
  check('launch screen is silent', pre.rmsDb < SILENCE_DB && D1.windows.length > 20, { ...pre, windows: D1.windows.length, ctx: D1.state });
  check('planning screen is silent', plan.rmsDb < SILENCE_DB, plan);
  check('no audio file requested before the match', reqBefore.length === 0, reqBefore);
  check('web audio context is running', D2.state === 'running', D2.state);
  report.sessions.launch = { launch: pre, planning: plan, requestsBeforeMatch: reqBefore, unityAudio: D2.unity, unityKeys: D2.unityKeys, errors: D2.errors, consoleViolations: consoleViolations(S) };
  await close(S);
}

// 2. Region music after match start, only the right files, and a crossfade across borders.
async function scenarioRegion() {
  console.log('scenario region (walk Plague -> Frost -> Sentenced)');
  const S = await openSession('region', { faction: 2, spawn: '2', enterMatch: false });
  await S.page.keyboard.press('2'); await S.page.waitForTimeout(600); const c = readyClick(); await S.page.mouse.click(c.x, c.y, { delay: 80 });
  await S.page.waitForTimeout(9000);
  const t0 = await now(S); const route = [];
  let pos = await selfTile(S.page); route.push({ start: pos });
  const budget = Date.now() + Number(process.env.RH_PROBE_WALK_MS || 150000);
  const visited = new Set(); const regionNames = () => S.consoleAll.map(c => /\[atmosphere\] region (\w+)/.exec(c.text)).filter(Boolean).map(m => m[1].toLowerCase());
  while (pos && Date.now() < budget && regionNames().length < 4) {
    const here = regionNames().slice(-1)[0];
    const next = Object.entries(POLES).filter(([n]) => n !== here && !visited.has(n)).sort((a, b) => Math.hypot(a[1][0] - pos.tx, a[1][1] - pos.ty) - Math.hypot(b[1][0] - pos.tx, b[1][1] - pos.ty))[0];
    if (!next) break; visited.add(next[0]);
    pos = await walkTo(S.page, next[1][0], next[1][1], 70000) || pos; route.push({ to: next[0], reached: pos });
  }
  await S.page.waitForTimeout(4000);
  const D = await data(S); const log = audioLog(D);
  const regionsAll = D.console.map(x => { const m = /\[atmosphere\] region (\w+)/.exec(x.text); return m ? { t: x.t, region: m[1].toLowerCase() } : null; }).filter(Boolean);
  const NAMES = ['none', 'fire', 'sentenced', 'plague', 'frost', 'holy', 'coliseum'];
  const gateOpen = log.map(l => { const m = /^gate region=(\d)/.exec(l.text); return m && +m[1] > 0 ? { t: l.t, region: NAMES[+m[1]] } : null; }).filter(Boolean)[0];
  const matchStartT = (log.find(l => /^match-active true/i.test(l.text)) || { t: 0 }).t;
  // regions entered once the match runs (the planning-screen preview region is not a place the player is in)
  const regions = regionsAll.filter(r => r.t >= matchStartT - 300);
  const spawnRegion = regionsAll.filter(r => !gateOpen || r.t <= gateOpen.t).slice(-1)[0];
  const plays = log.map(l => { const m = /^play (\w+) deck=(\d)/.exec(l.text); return m ? { t: l.t, id: m[1] } : null; }).filter(Boolean);
  const matchActive = log.find(l => /^match-active true/i.test(l.text));
  const reqs = fmtReq(S);
  const first = gateOpen;
  const firstMusic = plays.find(p => p.id.startsWith('music_'));
  const ws = D.windows, lv = levelsDb(ws);
  const audibleAt = ws.find(w => w.t >= (firstMusic ? firstMusic.t : 1e12) && L.toDb(w.rms) > AUDIBLE_DB);
  check('region music audible within 5 s of the region audio gate opening', first && audibleAt && audibleAt.t - first.t <= 5000, { firstRegion: first, firstMusicPlay: firstMusic, audibleAfterMs: audibleAt && first ? Math.round(audibleAt.t - first.t) : null, matchActiveAt: matchActive && Math.round(matchActive.t) });
  // requested files: before the second region change only the first region's files are allowed
  const allowedFirst = first ? REGION_FILES[first.region] || [] : [];
  const secondChange = regions[1] ? regions[1].t : 1e12;
  const early = reqs.filter(r => S.pageT(0) !== null && r.tMs <= (secondChange === 1e12 ? 1e12 : secondChange)).map(r => r.file.replace('.mp3', ''));
  const wrong = early.filter(f => !allowedFirst.includes(f));
  check('only the spawn region files are requested before the first border', first && wrong.length === 0, { spawn: first && first.region, requested: reqs, wrong });
  const allowedEver = new Set(regions.concat(spawnRegion ? [spawnRegion] : []).flatMap(r => REGION_FILES[r.region] || []));
  const stray = reqs.filter(r => !allowedEver.has(r.file.replace('.mp3', '')));
  check('every requested file belongs to a region the player actually entered', stray.length === 0, { regions: regions.map(r => r.region), stray });
  check('no audio request failed', reqs.every(r => r.status === 200 || r.status === 304), reqs);
  // crossfades
  const cross = [];
  const seq = (spawnRegion ? [spawnRegion] : []).concat(regions.filter(r => !spawnRegion || r.t > spawnRegion.t));
  for (let i = 1; i < seq.length; i++) {
    const to = seq[i].region, wanted = (REGION_FILES[to] || [])[0];
    const play = plays.find(p => p.id === wanted && p.t >= seq[i].t - 50);
    if (!play) { cross.push({ from: seq[i - 1].region, to, error: 'new music never started' }); continue; }
    // smooth to 250 ms so musical dynamics do not look like a dip
    const seg = ws.map((w, k) => ({ t: w.t, db: lv[k] })); const sm = seg.map((p, k) => { const win = seg.slice(Math.max(0, k - 4), k + 1); return L.toDb(L.rmsOfWindows(win.map(x => L.fromDb(x.db)))); });
    const res = L.crossfadeCheck(seg.map(p => p.t), sm, play.t, play.t + 2200);
    const act = D.windows.length ? null : null;
    cross.push({ from: seq[i - 1].region, to, regionChangedAt: Math.round(seq[i].t), newMusicPlayAt: Math.round(play.t), loadDelayMs: Math.round(play.t - seq[i].t), ...Object.fromEntries(Object.entries(res).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v])) });
  }
  report.sessions.region = { route, audioLog: log.slice(0, 120), fmod: Array.from(new Set(S.consoleAll.filter(c => FATAL_CONSOLE.test(c.text)).map(c => c.text))).slice(0, 8), regions, plays, requests: reqs, crossfades: cross, summary: summarize(between(ws, t0, t0 + 20000)) };
  check('walk crossed at least two borders', regions.length + (spawnRegion ? 1 : 0) >= 3 && cross.length >= 2, { spawn: spawnRegion, regions });
  check('the first region audio is for the region the player spawned in', first && spawnRegion && first.region === spawnRegion.region, { gate: first, regionLogBeforeGate: spawnRegion });
  for (const x of cross) check(`crossfade ${x.from} -> ${x.to}: no silent gap, no bump, no deep dip`, !x.error && x.silentMs === 0 && x.bumpDb <= 3.5 && x.dipDb <= 4.5, x);
  // plot
  const smPlot = downsample(ws.map(w => w.t), lv, 2);
  plotSvg(path.join(outDir, 'plot-region-crossing.svg'), 'Output level (dBFS RMS, 50 ms) while walking across borders; orange = region change, green = new music starts', [{ t: smPlot.t, v: smPlot.v, color: '#4fc3f7' }],
    regions.map((r, i) => ({ t: r.t, label: r.region, row: i % 3 })).concat(plays.filter(p => p.id.startsWith('music_')).map((p, i) => ({ t: p.t, label: p.id, color: '#81c784', row: 3 + i % 3 }))));
  report.sessions.region.consoleViolations = consoleViolations(S);
  report.sessions.region.consoleAllCount = S.consoleAll.length;
  await close(S);
  return S;
}

// 3a. Per-surface spectra and SFX volume by audition in a match with music, ambience, cue sounds and other actors' steps switched off (only the audition is audible).
async function scenarioAudition() {
  console.log('scenario step audition (in a match, everything else isolated and muted)');
  const S = await openSession('audition', { faction: 3 });
  await S.page.waitForTimeout(4000);
  await sendUnity(S, 'SetMusicVolume', 0); await sendUnity(S, 'SetAmbienceVolume', 0); await sendUnity(S, 'Isolate', 1); await S.page.waitForTimeout(2500);
  const sounds = ['Snow', 'Sand', 'Grass', 'Mud', 'Water', 'Bog', 'Stone', 'Temple', 'Gritty', 'Ice'];
  const aStart = await now(S);
  for (const snd of sounds) for (let v = 0; v < 4; v++) { await sendUnity(S, 'Step', `${snd},1`); await S.page.waitForTimeout(800); }
  await S.page.waitForTimeout(800);
  let D = await data(S); const al = audioLog(D).filter(l => /^audition step/.test(l.text) && l.t >= aStart);
  const spec = {}; const lags = [];
  for (const l of al) {
    const m = /sound=(\w+) gain=([\d.]+) voice=(-?\d+)/.exec(l.text); if (!m || +m[3] < 0) continue;
    const win = D.windows.filter(w => w.t >= l.t - 100 && w.t <= l.t + 650); if (!win.length) continue;
    const best = win.reduce((a, b) => (b.rms > a.rms ? b : a)); if (best.rms > 0.0005) lags.push(best.t - l.t);
    // centroid over the loud windows (within 12 dB of the best), power weighted
    const loud = win.filter(w => w.rms > best.rms * 0.25); const cent = L.mean(loud.map(w => w.centroid));
    (spec[m[1]] = spec[m[1]] || []).push({ c: cent, p: L.toDb(Math.max(...win.map(w => w.peak))), r: L.toDb(best.rms), b: best.bands });
  }
  const table = Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, { n: v.length, centroidHz: Math.round(L.median(v.map(x => x.c))), peakDb: +L.median(v.map(x => x.p)).toFixed(1), rmsDb: +L.median(v.map(x => x.r)).toFixed(1) }]));
  report.sessions.audition = { table, medianLagMs: lags.length ? Math.round(L.median(lags)) : null };
  const cs = k => table[k] && table[k].centroidHz;
  const distinct = ['Snow', 'Sand', 'Stone', 'Water'].filter(k => cs(k));
  let minRatio = Infinity; for (let i = 0; i < distinct.length; i++) for (let j = i + 1; j < distinct.length; j++) minRatio = Math.min(minRatio, Math.max(cs(distinct[i]), cs(distinct[j])) / Math.min(cs(distinct[i]), cs(distinct[j])));
  check('snow, sand, stone and water have measurably different spectra (centroid ratio of every pair >= 1.12)', distinct.length === 4 && minRatio >= 1.12, { centroids: Object.fromEntries(distinct.map(k => [k, cs(k)])), minPairRatio: +minRatio.toFixed(2), all: Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v.centroidHz])) });
  const peaksDb = Object.values(table).map(x => x.peakDb);
  check('every footstep sound is audible in the output (peak above -50 dBFS)', Object.keys(table).length === sounds.length && Math.min(...peaksDb) > -50, { measured: Object.keys(table).length, minPeakDb: Math.min(...peaksDb) });
  const probeStep = async () => { const t = await now(S); await sendUnity(S, 'Step', 'Stone,1'); await S.page.waitForTimeout(1000); const Dn = await data(S); const w = between(Dn.windows, t, t + 900); return { peakDb: summarize(w).peakDb }; };
  await sendUnity(S, 'SetSfxVolume', 0.85); await S.page.waitForTimeout(300); const full = await probeStep();
  await sendUnity(S, 'SetSfxVolume', 0.425); await S.page.waitForTimeout(300); const half = await probeStep();
  await sendUnity(S, 'SetSfxVolume', 0); await S.page.waitForTimeout(300); const mute = await probeStep();
  report.sessions.audition.sfxVolume = { full, half, mute };
  check('SFX volume halves the step level by about 6 dB', Math.abs((full.peakDb - half.peakDb) - 6.02) < 2.0, { fullDb: full.peakDb, halfDb: half.peakDb, deltaDb: +(full.peakDb - half.peakDb).toFixed(2) });
  check('SFX volume 0 silences steps', mute.peakDb < -70, mute);
  await sendUnity(S, 'SetSfxVolume', 0.85); await S.page.waitForTimeout(300);
  const voiced = {};
  for (const [kind, dist] of [['Local', 0], ['Player', 3], ['Mob', 3]]) { voiced[kind] = []; for (let i = 0; i < 3; i++) { const t = await now(S); await sendUnity(S, 'StepAs', `Stone,${kind},${dist}`); await S.page.waitForTimeout(900); const Dn = await data(S); voiced[kind].push(summarize(between(Dn.windows, t, t + 800)).peakDb); } }
  const vm = k => +L.median(voiced[k]).toFixed(1);
  report.sessions.audition.voicing = { Local: vm('Local'), Player3tiles: vm('Player'), Mob3tiles: vm('Mob') };
  check('footsteps stay subtle: the local player\'s step (game gain, SFX 0.85) peaks below -16 dBFS (music peaks reach about -5)', vm('Local') < -16, { localStepPeakDb: vm('Local'), clipTestGain1PeakDb: Math.max(...peaksDb) });
  check('other actors step quieter than the local player, mobs quieter than players (isolated, same surface, 3 tiles away)', vm('Local') - vm('Player') >= 2 && vm('Player') - vm('Mob') >= 2, report.sessions.audition.voicing);
  D = await data(S); report.sessions.audition.fmodContext = fmodContext(D); report.sessions.audition.consoleViolations = consoleViolations(S);
  await close(S);
}

// 3b. Footsteps while walking in a match (music off): cue/transient correlation, standing still, local vs other players.
async function scenarioSteps() {
  console.log('scenario footsteps (walking)');
  const S = await openSession('steps', { faction: 2, spawn: '2' });
  await S.page.waitForTimeout(6000);
  await sendUnity(S, 'SetMusicVolume', 0); await sendUnity(S, 'SetAmbienceVolume', 0); await S.page.waitForTimeout(3000);
  await S.page.mouse.move(W / 2, H / 2);
  const tIdle0 = await now(S); await S.page.waitForTimeout(5000); const tIdle1 = await now(S);
  await S.page.keyboard.down('d'); const tWalk0 = await now(S); await S.page.waitForTimeout(Number(process.env.RH_PROBE_WALK_MS || 16000)); await S.page.keyboard.up('d'); const tWalk1 = await now(S);
  await S.page.waitForTimeout(5000); const tStop1 = await now(S);
  const D = await data(S);
  const stepLines = D.console.map(x => { const m = /\[surfacefx\] step surface=(\w+) sound=(\w+) actor=(\w+) at=(-?\d+),(-?\d+) dist=([\d.]+) gain=([\d.]+) voice=(-?\d+)/.exec(x.text); return m ? { t: x.t, surface: m[1], sound: m[2], actor: m[3], dist: +m[6], gain: +m[7], voice: +m[8] } : null; }).filter(Boolean);
  const sfxLines = audioLog(D).filter(l => /^(sfx|cue) /.test(l.text)).map(l => l.t);
  const ws = D.windows, lv = levelsDb(ws);
  const local = stepLines.filter(s => s.actor === 'Local' && s.voice >= 0 && s.t >= tWalk0 && s.t <= tWalk1);
  const sel = ws.map((w, i) => ({ t: w.t, db: lv[i] })).filter(p => p.t >= tWalk0 && p.t <= tWalk1 + 1000);
  const thr = -50;
  const peaks = L.detectPeaks(sel.map(p => p.t), sel.map(p => p.db), thr, 120);
  const pair = L.pairEvents(local.map(s => s.t), peaks.map(p => p.t), 400, -80);
  const cueInterval = L.medianInterval(local.map(s => s.t)), peakInterval = L.medianInterval(pair.matched.map(m => m.peak));
  check('footstep cues appear while walking', local.length >= 8, { localCues: local.length });
  check('at least 85% of local footstep cues have an output transient near them', local.length > 0 && pair.matched.length / local.length >= 0.85, { cues: local.length, matched: pair.matched.length, medianLagMs: pair.medianLagMs, thresholdDb: thr });
  check('transient rate matches the cue rate within 15%', cueInterval && peakInterval && Math.abs(peakInterval - cueInterval) / cueInterval < 0.15, { cueIntervalMs: cueInterval && Math.round(cueInterval), peakIntervalMs: peakInterval && Math.round(peakInterval) });
  // standing still: no local footstep cue, and no output transient that no logged cue explains
  const standT = ws.filter(w => (w.t >= tIdle0 && w.t <= tIdle1) || (w.t >= tWalk1 + 1500 && w.t <= tStop1));
  const standLocalCues = stepLines.filter(s => s.actor === 'Local' && ((s.t >= tIdle0 && s.t <= tIdle1) || (s.t >= tWalk1 + 1500 && s.t <= tStop1)));
  const cueTimes = stepLines.filter(s => s.voice >= 0).map(s => s.t).concat(sfxLines);
  const standPeaks = L.detectPeaks(standT.map(w => w.t), standT.map(w => L.toDb(w.peak)), -50, 100).filter(p => !cueTimes.some(c => p.t - c >= -150 && p.t - c <= 700));
  check('no local footsteps and no unexplained transients while the player stands still', standLocalCues.length === 0 && standPeaks.length === 0, { localCuesWhileStanding: standLocalCues.length, unexplainedPeaks: standPeaks.length, windows: standT.length });
  const byActor = {};
  const allCue = stepLines.map(x => x.t).concat(sfxLines);
  for (const s of stepLines.filter(s => s.voice >= 0)) {
    if (allCue.some(c => c !== s.t && c > s.t - 400 && c < s.t + 400)) continue;          // only steps with nothing else sounding around them
    const win = ws.filter(w => w.t >= s.t - 30 && w.t <= s.t + 300); if (!win.length) continue; const pk = Math.max(...win.map(w => w.peak)); (byActor[s.actor] = byActor[s.actor] || []).push(L.toDb(pk));
  }
  const actorSummary = Object.fromEntries(Object.entries(byActor).map(([k, v]) => [k, { n: v.length, medianPeakDb: +L.median(v).toFixed(1) }]));
  report.sessions.steps = { cues: local.length, matched: pair.matched.length, medianLagMs: pair.medianLagMs, actorSummary, stepLines: stepLines.length, fmodContext: fmodContext(D) };
  const surf = {};
  for (const m of pair.matched) { const cue = local.find(s => s.t === m.event); if (!cue) continue; (surf[cue.sound] = surf[cue.sound] || []).push(m.peak); }
  report.sessions.steps.surfacesWalked = Object.fromEntries(Object.entries(surf).map(([k, v]) => [k, v.length]));
  if (pair.matched.length) plotSvg(path.join(outDir, 'plot-footsteps.svg'), 'Output level (dBFS RMS, 50 ms) while walking, music off; orange = local footstep cue', [{ t: sel.map(p => p.t), v: sel.map(p => p.db), color: '#4fc3f7' }], local.map(s => ({ t: s.t, label: '', color: '#ffb300' })));
  report.sessions.steps.consoleViolations = consoleViolations(S);
  await close(S);
}

// 4. Every track alone: level, loop seam; ambience under music.
async function scenarioTracks() {
  console.log('scenario tracks (each alone)');
  const S = await openSession('tracks', { faction: 3, spawn: '1' });
  await S.page.waitForTimeout(5000);
  await sendUnity(S, 'SetMusicVolume', 1); await sendUnity(S, 'SetAmbienceVolume', 1); await sendUnity(S, 'SetSfxVolume', 0);
  const table = {};
  for (const id of MUSIC.concat(AMBIENCE)) {
    const music = id.startsWith('music_');
    await sendUnity(S, 'Force', music ? `${id},` : `,${id}`);
    const tReq = await now(S); await S.page.waitForTimeout(5200);
    const t1 = await now(S); await S.page.waitForTimeout(Number(process.env.RH_PROBE_TRACK_MS || 7000)); const t2 = await now(S);
    const D = await data(S); const w = between(D.windows, t1 + 2500, t2);
    const unityGain = D.unity && D.unity.reachable ? D.unity.rows.map(r => r.gain) : null;
    table[id] = { ...summarize(w), activeSources: await S.page.evaluate(() => window.__rhAudioProbe.activeSources()), unityGain };
    // short-term loudness spread (3 s windows) shows how dynamic the track is
    const win3 = []; for (let a = t1 + 2500; a + 3000 <= t2; a += 1500) win3.push(L.toDb(L.rmsOfWindows(between(D.windows, a, a + 3000).map(x => x.rms))));
    table[id].shortTermDb = win3.map(x => +x.toFixed(1));
    console.log('   ', id, JSON.stringify({ rmsDb: table[id].rmsDb, peakDb: table[id].peakDb }));
  }
  await sendUnity(S, 'Force', ','); await S.page.waitForTimeout(2500);
  report.sessions.tracks = { levels: table, consoleViolations: consoleViolations(S) };
  const mRms = MUSIC.map(i => table[i].rmsDb), aRms = AMBIENCE.map(i => table[i].rmsDb);
  const spread = Math.max(...mRms) - Math.min(...mRms);
  check('the six music tracks sit within 2 dB of each other (RMS, alone, volume 1)', spread <= 2.0, { spreadDb: +spread.toFixed(2), tracks: Object.fromEntries(MUSIC.map(i => [i, table[i].rmsDb])) });
  check('ambience sits clearly under music (mean music minus loudest ambience >= 6 dB)', L.mean(mRms) - Math.max(...aRms) >= 6, { musicMeanDb: +L.mean(mRms).toFixed(1), ambienceMaxDb: Math.max(...aRms), ambience: Object.fromEntries(AMBIENCE.map(i => [i, table[i].rmsDb])) });
  check('no track clips (peak below -1 dBFS) at volume 1', Math.max(...MUSIC.concat(AMBIENCE).map(i => table[i].peakDb)) <= -1, { maxPeakDb: Math.max(...MUSIC.concat(AMBIENCE).map(i => table[i].peakDb)) });
  await close(S);
}

// 5. Loop seams: seek each loop 3 s before its end and compare the output across the wrap with an ordinary stretch of the same track.
async function scenarioLoops() {
  console.log('scenario loop seams');
  const S = await openSession('loops', { faction: 3, spawn: '1' });
  await S.page.waitForTimeout(5000);
  await sendUnity(S, 'SetMusicVolume', 1); await sendUnity(S, 'SetAmbienceVolume', 1); await sendUnity(S, 'SetSfxVolume', 0);
  const rows = {};
  const smooth = (ws, ms) => { const out = []; for (let i = 0; i < ws.length; i++) { const win = ws.filter(w => w.t > ws[i].t - ms && w.t <= ws[i].t); out.push({ t: ws[i].t, db: L.toDb(L.rmsOfWindows(win.map(w => w.rms))) }); } return out; };
  for (const id of MUSIC.concat(AMBIENCE)) {
    const music = id.startsWith('music_');
    await sendUnity(S, 'Force', music ? `${id},` : `,${id}`); await S.page.waitForTimeout(5500);
    const t = await now(S); await S.page.waitForTimeout(4500); await sendUnity(S, 'SeekEnd', '3'); await S.page.waitForTimeout(7000);
    const D = await data(S); const log = audioLog(D).filter(l => l.t >= t && /^seek /.test(l.text));
    const seekAt = log.length ? log[0].t : t + 4500;
    const sm = smooth(D.windows.filter(w => w.t >= t - 500 && w.t <= seekAt + 6000), 200);
    const stepsIn = (a, b) => { const seg = sm.filter(p => p.t >= a && p.t <= b); let m = 0; for (let i = 4; i < seg.length; i++) m = Math.max(m, Math.abs(seg[i].db - seg[i - 4].db)); return { step: m, min: Math.min(...seg.map(p => p.db)), max: Math.max(...seg.map(p => p.db)) }; };
    const control = stepsIn(t + 500, seekAt - 300), seam = stepsIn(seekAt + 1500, seekAt + 5000);
    rows[id] = { seek: log.map(l => l.text)[0], controlStepDb: +control.step.toFixed(2), seamStepDb: +seam.step.toFixed(2), controlMinDb: +control.min.toFixed(1), seamMinDb: +seam.min.toFixed(1), seamMaxDb: +seam.max.toFixed(1) };
    console.log('   ', id, JSON.stringify(rows[id]));
  }
  report.sessions.loops = { rows, consoleViolations: consoleViolations(S) };
  const bad = Object.entries(rows).filter(([, r]) => r.seamStepDb > Math.max(6, r.controlStepDb + 4) || r.seamMinDb < r.controlMinDb - 12).map(([k]) => k);
  check('loop seams are inaudible: no dropout and no level jump beyond the track\'s own dynamics (200 ms windows)', bad.length === 0 && Object.values(rows).every(r => r.seek), { badTracks: bad, rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, `${v.controlStepDb}/${v.seamStepDb}`])) });
  await close(S);
}

// 6. Volume setting and mute, Audio switch.
async function scenarioVolume() {
  console.log('scenario volume / mute / audio switch');
  const S = await openSession('volume', { faction: 3, spawn: '1' });
  await S.page.waitForTimeout(8000);
  await sendUnity(S, 'Isolate', 1); await sendUnity(S, 'Force', 'music_frost,amb_frost'); await S.page.waitForTimeout(5000);
  const measure = async ms => { const t = await now(S); await S.page.waitForTimeout(ms); const D = await data(S); return summarize(between(D.windows, t + 500, t + ms)); };
  await sendUnity(S, 'SetMusicVolume', 0.72); await sendUnity(S, 'SetAmbienceVolume', 0.62); await S.page.waitForTimeout(500);
  const base = await measure(4000);
  await sendUnity(S, 'SetMusicVolume', 0.36); await sendUnity(S, 'SetAmbienceVolume', 0.31); await S.page.waitForTimeout(500);
  const half = await measure(4000);
  await sendUnity(S, 'SetMusicVolume', 0); await sendUnity(S, 'SetAmbienceVolume', 0); await S.page.waitForTimeout(500);
  const mute = await measure(4000);
  await sendUnity(S, 'SetMusicVolume', 0.72); await sendUnity(S, 'SetAmbienceVolume', 0.62); await S.page.waitForTimeout(800);
  const back = await measure(3000);
  const delta = base.rmsDb - half.rmsDb;
  report.sessions.volume = { base, half, mute, back, deltaDb: +delta.toFixed(2), consoleViolations: consoleViolations(S) };
  check('halving the music and ambience volumes lowers the output by about 6 dB', Math.abs(delta - 6.02) < 1.5, { baseDb: base.rmsDb, halfDb: half.rmsDb, deltaDb: +delta.toFixed(2) });
  check('volume 0 silences the output (mute)', mute.peakDb < -70, mute);
  check('restoring the volume restores the level', Math.abs(back.rmsDb - base.rmsDb) < 1.5, { baseDb: base.rmsDb, backDb: back.rmsDb });
  await close(S);
  const S2 = await openSession('audiooff', { faction: 3, spawn: '1', query: '&fx.audio=0' });
  await S2.page.waitForTimeout(9000); await S2.page.mouse.move(W / 2, H / 2); await S2.page.keyboard.down('d'); const t = await now(S2); await S2.page.waitForTimeout(8000); await S2.page.keyboard.up('d');
  const D2 = await data(S2); const off = summarize(between(D2.windows, t - 6000, t + 8000)); const reqs = fmtReq(S2);
  report.sessions.audioOff = { off, requests: reqs, consoleViolations: consoleViolations(S2) };
  check('the Audio switch off silences everything and fetches no audio', off.peakDb < -70 && reqs.length === 0, { off, requests: reqs });
  await close(S2);
}

// 7. Everything at once: walk, fight, Wish; peak headroom and cue peaks.
async function scenarioFull() {
  console.log('scenario full session (walk + combat + wish)');
  const S = await openSession('full', { faction: 2, spawn: '2' });
  await S.page.waitForTimeout(5000);
  const tStart = await now(S);
  await S.page.mouse.move(W / 2 + 180, H / 2);
  await S.page.keyboard.down('d');
  const end = Date.now() + Number(process.env.RH_PROBE_FULL_MS || 92000); let swings = 0;
  while (Date.now() < end) {
    await S.page.waitForTimeout(2500);
    await S.page.mouse.down(); await S.page.waitForTimeout(120); await S.page.mouse.up(); swings++;
    if (Date.now() - S.t0Wall > 64000) { await S.page.keyboard.down('r'); await S.page.waitForTimeout(150); await S.page.keyboard.up('r'); }
  }
  await S.page.keyboard.up('d'); await S.page.waitForTimeout(3000);
  const D = await data(S); const ws = D.windows, log = audioLog(D);
  const cues = log.filter(l => /^cue /.test(l.text)).map(l => ({ t: l.t, cue: l.text.slice(4).split(' ')[0] }));
  const sum = summarize(between(ws, tStart + 8000, D.now));
  report.sessions.full = { summary: sum, cues: cues.length, cueKinds: cues.reduce((m, c) => (m[c.cue] = (m[c.cue] || 0) + 1, m), {}), consoleViolations: consoleViolations(S), requests: fmtReq(S) };
  check('headroom: peak with music, ambience, footsteps and combat stays below -1 dBFS', sum.peakDb <= -1, sum);
  const lv = levelsDb(ws), base = L.median(lv.filter((_, i) => ws[i].t > tStart + 8000));
  const cuePeaks = cues.map(c => { const win = between(ws, c.t, c.t + 500); const pk = win.length ? Math.max(...win.map(w => w.peak)) : 0; return { cue: c.cue, rise: +(L.toDb(win.length ? L.rmsOfWindows(win.map(w => w.rms)) : 0) - base).toFixed(1), peakDb: +L.toDb(pk).toFixed(1) }; });
  report.sessions.full.cuePeaks = cuePeaks.slice(0, 60);
  const swingCues = cues.filter(c => /combat|swing/.test(c.cue));
  check('combat cues are logged and produce output', swingCues.length > 0 && cuePeaks.filter(c => /combat/.test(c.cue)).some(c => c.peakDb > -50), { combat: swingCues.length, cueKinds: report.sessions.full.cueKinds });
  const wishCues = cues.filter(c => /wish/.test(c.cue));
  check('a Wish cue is logged and produces output', wishCues.length > 0 && cuePeaks.filter(c => /wish/.test(c.cue)).some(c => c.peakDb > -50), { wish: wishCues.length });
  const smPlot = downsample(ws.map(w => w.t), lv, 3);
  plotSvg(path.join(outDir, 'plot-full-session.svg'), 'Output level (dBFS RMS) for a full session; orange = cue', [{ t: smPlot.t, v: smPlot.v, color: '#4fc3f7' }], cues.map((c, i) => ({ t: c.t, label: i % 4 === 0 ? c.cue : '', color: '#ffb300', row: i % 4 })));
  await close(S);
}

// 0. File facts without ffmpeg: decode every streamed MP3 in the browser (decodeAudioData) and measure it.
async function scenarioFiles() {
  console.log('scenario file analysis (browser decode)');
  const browser = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext()).newPage();
  await page.goto(baseUrl + 'StreamingAssets/Audio/music_fire.mp3');
  const ids = MUSIC.concat(AMBIENCE); const rows = {};
  for (const id of ids) {
    const r = await page.evaluate(async (url) => {
      const resp = await fetch(url); const bytes = new Uint8Array(await resp.arrayBuffer()); const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(bytes.buffer.slice(0)); const ch = []; for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
      let peak = 0, sum = 0, n = 0; for (const d of ch) for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += d[i] * d[i]; n++; }
      const d0 = ch[0], seam = Array.from(d0.subarray(d0.length - 1024)).concat(Array.from(d0.subarray(0, 1024)));
      const edge = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += d0[i] * d0[i]; return Math.sqrt(s / (b - a)); };
      const hop = Math.round(buf.sampleRate * 0.05), levels = []; for (let i = 0; i + hop <= d0.length; i += hop) { let q = 0; for (let j = i; j < i + hop; j++) q += d0[j] * d0[j]; levels.push(10 * Math.log10(q / hop + 1e-12)); }
      const k = Math.round(buf.sampleRate * 0.1);
      return { bytes: bytes.length, duration: buf.duration, sampleRate: buf.sampleRate, channels: buf.numberOfChannels, peak, rms: Math.sqrt(sum / n), seam, headRms: edge(0, k), tailRms: edge(d0.length - k, d0.length), headSample: d0[0], tailSample: d0[d0.length - 1], levels };
    }, baseUrl + 'StreamingAssets/Audio/' + id + '.mp3');
    const click = L.seamClick(r.seam, 1024, 64); const loop = L.suggestLoop(r.levels, 0.05);
    rows[id] = { bytes: r.bytes, durationS: +r.duration.toFixed(2), sampleRate: r.sampleRate, channels: r.channels, bitrateKbps: Math.round(r.bytes * 8 / r.duration / 1000), peakDb: +L.toDb(r.peak).toFixed(2), rmsDb: +L.toDb(r.rms).toFixed(2), headRmsDb: +L.toDb(r.headRms).toFixed(1), tailRmsDb: +L.toDb(r.tailRms).toFixed(1), seamJump: +Math.abs(r.tailSample - r.headSample).toFixed(4), seamClickRatio: +click.ratio.toFixed(1), suggestedLoop: loop };
  }
  await browser.close();
  report.sessions.files = rows;
  console.log(Object.entries(rows).map(([k, v]) => `    ${k} ${v.durationS}s ${v.sampleRate}Hz ${v.channels}ch ${v.bitrateKbps}kbps peak ${v.peakDb} rms ${v.rmsDb} seamJump ${v.seamJump} click ${v.seamClickRatio} loop ${v.suggestedLoop.startSec}-${v.suggestedLoop.endSec}`).join('\n'));
  const over = Object.entries(rows).filter(([, v]) => v.peakDb > -1).map(([k]) => k);
  check('decoded peak of every file is below -1 dBFS', over.length === 0, { over });
  const clicks = Object.entries(rows).filter(([, v]) => v.seamJump > 0.05 && v.seamClickRatio > 12).map(([k, v]) => [k, v.seamJump, v.seamClickRatio]);
  check('no file has a sample discontinuity at its loop point (jump > 0.05 and click ratio > 12)', clicks.length === 0, { clicks });
}

(async () => {
  if (!chromium) { console.error('Playwright missing'); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });
  const all = { files: scenarioFiles, launch: scenarioLaunch, region: scenarioRegion, audition: scenarioAudition, steps: scenarioSteps, tracks: scenarioTracks, loops: scenarioLoops, volume: scenarioVolume, full: scenarioFull };
  for (const k of Object.keys(all)) if (only.includes(k)) { try { await all[k](); } catch (e) { check(`scenario ${k} ran`, false, String(e && e.stack || e)); } }
  const viol = Object.entries(report.sessions).flatMap(([k, v]) => (v.consoleViolations || []).map(x => `${k}: ${x}`));
  check('no console line matching FMOD | not loaded yet | AudioContext was not allowed in any session', viol.length === 0, { count: viol.length, first: viol.slice(0, 4) });
  report.passed = report.assertions.every(a => a.pass);
  fs.writeFileSync(path.join(outDir, 'audio-report.json'), JSON.stringify(report, null, 1));
  const md = ['| Assertion | Result | Detail |', '|---|---|---|'].concat(report.assertions.map(a => `| ${a.name} | ${a.pass ? 'PASS' : 'FAIL'} | \`${JSON.stringify(a.detail).replace(/\|/g, '/').slice(0, 220)}\` |`));
  fs.writeFileSync(path.join(outDir, 'audio-report.md'), md.join('\n') + '\n');
  console.log(report.passed ? 'ALL PASS' : 'FAILURES: ' + report.assertions.filter(a => !a.pass).map(a => a.name).join(' | '));
  process.exit(report.passed ? 0 : 1);
})();
