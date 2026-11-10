#!/usr/bin/env node
// Scenario matrix and build A/B for the Unity Web client, built for a SHARED, noisy machine.
//
// One browser session per (build, quality, zone) joins a real bot match (diagnostic loopback join, ?perf=1), measures the
// planning screen, presses 1 + Ready, optionally walks to the coliseum, then records a sequence of in-match windows
// (walk = scripted walk + attack bursts, stand = no input, map = Tab map held open). Sessions of different builds are
// INTERLEAVED round by round (A B A B ...), so machine load drifts hit both sides alike, and every window records
// load-independent counts beside its frame times:
//   - Unity (PerfRecorder.Snapshot): CPU per engine phase and per owned system, managed bytes per frame, GC count, TMP and
//     uGUI rebuilds, objects created per second, render counters where the release player exposes them;
//   - WebGL (--gl, Tools/webgl-profile-init.js): draw calls per frame, rAF-callback CPU (the whole Unity frame on the main
//     thread), GPU time per frame when EXT_disjoint_timer_query_webgl2 is available;
//   - census (PerfRecorder.Census, after the first window): live particle systems (and how many play off-screen), Light2D,
//     renderers in and out of the frustum, canvases, raycast targets, textures.
//
//   node perf-matrix.cjs --builds base=http://127.0.0.1:8107/base/,cur=http://127.0.0.1:8107/cur/ --quality ultra \
//        --zones fire,sentenced --windows walk:8,stand:6,map:5 --rounds 2 --vsync off --gl --out <dir>
//
// Ports, token and loopback host are the diagnostic defaults (127.0.0.1:7807, t1). Nothing here changes game state beyond
// what a player's keyboard and mouse do.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const PR = require('./perf-run.cjs');

const ZONES = { fire: 0, sentenced: 1, plague: 2, frost: 3, holy: 4, coliseum: 4 };
const REGION_NAMES = ['none', 'fire', 'sentenced', 'plague', 'frost', 'holy', 'coliseum'];
// Walkable-floor centroid of each zone on the arena map (seed1, sim units) and its RegionId.
const ZONE_TARGET = { fire: [879, 1651, 1], sentenced: [4378, 2088, 2], plague: [1258, 3941, 3], frost: [3451, 4068, 4], holy: [2757, 967, 5], coliseum: [2560, 2560, 6] };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parse(argv) {
  const o = { builds: [], quality: ['ultra'], zones: ['fire'], windows: [['walk', 8], ['stand', 6]], rounds: 1, vsync: 'off', gl: false,
    passes: false, cpuprofile: 0, res: [2560, 1440], server: 'ws://127.0.0.1:7807/ws', out: null, flags: '', planning: 5, launch: false, shots: true, census: true, headless: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    switch (a) {
      case '--builds': o.builds = v().split(',').map(s => { const [name, url] = s.split('='); return { name, url }; }); break;
      case '--quality': o.quality = v().split(','); break;
      case '--zones': o.zones = v().split(','); break;
      // kind:seconds, kind = walk | stand | map | fight, optionally with in-match flags: stand[fx.post=0&fx.bloom=0]:6 (PerfRecorder.SetFlags)
      case '--windows': o.windows = v().split(',').map(s => { const i = s.lastIndexOf(':'); return [i > 0 ? s.slice(0, i) : s, i > 0 ? +s.slice(i + 1) || 6 : 6]; }); break;
      case '--rounds': o.rounds = +v(); break;
      case '--vsync': o.vsync = v(); break;
      case '--gl': o.gl = true; break;
      case '--passes': o.passes = true; break;
      case '--cpuprofile': o.cpuprofile = +v(); break;   // seconds of V8 sampling profile (walk input) after the first window; needs a build with embedded symbols   // per-render-pass draw counts and GPU time (exclusive with --gl)
      case '--res': o.res = v().split('x').map(Number); break;
      case '--server': o.server = v(); break;
      case '--out': o.out = v(); break;
      case '--flags': o.flags = v(); break;
      case '--planning': o.planning = +v(); break;
      case '--launch': o.launch = true; break;
      case '--no-shots': o.shots = false; break;
      case '--no-census': o.census = false; break;
      case '--headless': o.headless = true; break;
      case '--any-zone': o.anyZone = true; break;   // measure wherever the spawn lands
      default: throw new Error('unknown argument ' + a);
    }
  }
  if (!o.builds.length) throw new Error('--builds name=url[,name=url] is required');
  return o;
}

function legacyScale(w, h) { const sw = w / h <= 21 / 9 ? w : Math.floor(h * 21 / 9); return Math.min(1.5, Math.max(0.8, Math.min(sw / 1280, h / 800))); }
function minimapRect(w, h, s) {
  const uiW = Math.floor(w / s), uiH = Math.floor(h / s);
  const wanted = Math.min(312, Math.max(195, Math.round(uiH * 0.338))), room = Math.floor(uiW / 2 - 12 - 152);
  const size = Math.round(Math.min(Math.min(wanted, Math.max(110, room)), uiW * 0.42, uiH * 0.6));
  return { x: w - (12 + size) * s, y: h - (12 + size) * s, size: size * s };
}
function readyPoint(W, H) { // ui-scenarios.cjs startArena: the Ready button of the planning rail
  const s = legacyScale(W, H), uiW = W / s, uiH = H / s;
  const pSide = Math.min(780, Math.max(260, Math.floor(Math.min(uiH - 44 - 12 - 124, uiW - 340 - 24 - 12 - 8))));
  const pFrame = pSide + 8, pTotal = pFrame + 12 + 340, pColH = 40 + 12 + pFrame + 12 + 52;
  const pBx = Math.floor((uiW - pTotal) / 2), pBy = Math.max(44, Math.floor((uiH - pColH) / 2 + 11));
  return { x: (pBx + pFrame + 12 + 12 + 158) * s, y: (pBy + 12 + 23) * s };
}

const median = a => PR.percentile(a, 0.5);

/** System-wide GPU "Device Utilization %" (ioreg IOAccelerator), every client on the machine included. */
function gpuUtil() {
  try { const t = execFileSync('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], { encoding: 'utf8', timeout: 5000 }); const m = /"Device Utilization %"=(\d+)/.exec(t); return m ? +m[1] : null; } catch { return null; }
}

/** CPU seconds used so far by this node process's browser, split into GPU process, renderers and the rest (ps cumulative TIME). */
function browserCpu() {
  try {
    const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,time=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').map(l => {
      const m = /^\s*(\d+)\s+(\d+)\s+([\d:.\-]+)\s+(.*)$/.exec(l); if (!m) return null;
      const t = m[3].split(/[-:]/).map(Number); let sec = 0; for (const x of t) sec = sec * 60 + x;   // [[dd-]hh:]mm:ss.ss
      return { pid: +m[1], ppid: +m[2], sec, cmd: m[4] };
    }).filter(Boolean);
    const kids = new Map(); for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r); }
    const out = { gpu: 0, renderer: 0, browser: 0, other: 0 };
    const walk = (pid, depth) => { for (const r of kids.get(pid) || []) { if (depth > 0 || /Chrom/i.test(r.cmd)) {
      const k = /--type=gpu-process/.test(r.cmd) ? 'gpu' : /--type=renderer/.test(r.cmd) ? 'renderer' : /--type=/.test(r.cmd) ? 'other' : 'browser';
      out[k] += r.sec; walk(r.pid, depth + 1); } } };
    walk(process.pid, 0);
    return out;
  } catch { return null; }
}

/** Frame statistics the owner asked for, from rAF deltas (ms). */
function budget(deltas) {
  const d = deltas.filter(Number.isFinite);
  if (!d.length) return { frames: 0 };
  const sorted = Float64Array.from(d).sort();
  const pct = p => sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1))];
  const n1 = Math.max(1, Math.ceil(sorted.length * 0.01));
  let worst = 0; for (let i = sorted.length - n1; i < sorted.length; i++) worst += sorted[i];
  const sum = d.reduce((x, y) => x + y, 0);
  return { frames: d.length, meanMs: sum / d.length, p50Ms: pct(.5), p95Ms: pct(.95), p99Ms: pct(.99), maxMs: sorted[sorted.length - 1],
    over694Pct: 100 * d.filter(x => x > 1000 / 144).length / d.length, over833Pct: 100 * d.filter(x => x > 1000 / 120).length / d.length,
    low1PctFps: 1000 / (worst / n1), avgFps: 1000 / (sum / d.length),
    dropped144Pct: 100 * d.filter(x => x > 1.5 * 1000 / 144).length / d.length };
}

async function session(o, build, quality, zone, round) {
  const chromium = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(os.homedir(), '.codex/tools/rougehalla-stage2/browser/node_modules/playwright')).chromium;
  const [W, H] = o.res;
  const args = ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-features=Metal', '--autoplay-policy=no-user-gesture-required'];
  if (o.vsync === 'off') args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
  const browser = await chromium.launch({ headless: o.headless, args });
  const rec = { build: build.name, quality, zone, round, vsync: o.vsync, res: `${W}x${H}`, windows: [], notes: [], errors: [], netStates: [], load: [os.loadavg()[0]] };
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    if (o.passes) await ctx.addInitScript({ path: path.join(__dirname, 'webgl-pass-capture.js') });
    else if (o.gl) await ctx.addInitScript({ path: path.join(__dirname, 'webgl-profile-init.js') });
    const page = await ctx.newPage();
    page.on('pageerror', e => rec.errors.push(String(e).slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/\.mp3|audio|404/i.test(t)) rec.errors.push(t.slice(0, 200)); if (t.startsWith('[net]')) rec.netStates.push(t.slice(0, 120)); });
    const u = new URL(build.url);
    const profile = ('pm' + build.name.slice(0, 4) + Date.now().toString(36).slice(-5) + round).slice(0, 16);
    const params = { server: o.server, diagnostic: '1', token: 't1', profile, faction: String(ZONES[zone] ?? 0), perf: '1', quality, auto: o.launch ? '0' : '1' };
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    for (const part of o.flags.split('&').filter(Boolean)) { const [k, v] = part.split('='); u.searchParams.set(k, v); }
    await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.bringToFront();
    if (!o.headless) {
      try {
        const cdp = await ctx.newCDPSession(page); const { windowId } = await cdp.send('Browser.getWindowForTarget');
        if (W >= 2560) await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
        await sleep(800); rec.window = (await cdp.send('Browser.getWindowBounds', { windowId })).bounds; await cdp.detach();
      } catch (e) { rec.notes.push('window: ' + e.message); }
    }
    await page.locator('#unity-loading-bar').waitFor({ state: 'hidden', timeout: 180000 });
    await page.waitForFunction(() => !!window.__rhPerf, undefined, { timeout: 60000 });
    rec.gpu = await page.evaluate(() => { const c = document.getElementById('unity-canvas'); return { canvas: [c.width, c.height], dpr: devicePixelRatio, screen: [screen.width, screen.height], timer: !!(window.__rhProfile && window.__rhProfile.contexts[0] && window.__rhProfile.contexts[0].timerQuery) }; });
    const measure = async (kind, seconds, input) => {
      await page.evaluate(() => { window.unityInstance.SendMessage('Frame-time recorder', 'ResetCounters', ''); window.__rhPerf.reset(); const p = window.__rhProfile; if (p) { p.mark = performance.now(); p.callsAt = Object.assign({}, p.calls || {}); p.u4Floats = 0; p.u4Hist = {}; } });
      const loadBefore = os.loadavg()[0]; const gpuBusyBefore = gpuUtil(); const cpu0 = browserCpu(), wall0 = Date.now();
      if (input) await input(seconds); else await sleep(seconds * 1000);
      const data = await page.evaluate(() => {
        const P = window.__rhPerf; const t = P.timestamps(); window.unityInstance.SendMessage('Frame-time recorder', 'Snapshot', '');
        let gl = null; const p = window.__rhProfile;
        if (p) { const fr = p.frames.filter(f => f.time >= p.mark); const g = p.gpuMs.slice(-fr.length);
          const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
          gl = { frames: fr.length, drawsMean: mean(fr.map(f => f.draws)), drawsMax: fr.reduce((m, f) => Math.max(m, f.draws), 0), rafCpuMean: mean(fr.map(f => f.cpuMs)),
            rafCpuP95: (() => { const a = fr.map(f => f.cpuMs).sort((x, y) => x - y); return a.length ? a[Math.ceil(a.length * .95) - 1] : null; })(),
            gpuMean: mean(g), gpuP95: (() => { const a = g.slice().sort((x, y) => x - y); return a.length ? a[Math.ceil(a.length * .95) - 1] : null; })(), gpuSamples: g.length, disjoint: p.gpuDisjoint,
            wasmBytes: fr.length ? fr[fr.length - 1].wasmBytes : null, buffersCreated: p.buffersCreated,
            uniform4fvFloatsPerFrame: (p.u4Floats || 0) / Math.max(1, fr.length), uniform4fvLengths: Object.fromEntries(Object.entries(p.u4Hist || {}).map(([k, v]) => [k, +(v / Math.max(1, fr.length)).toFixed(1)])),
            callsPerFrame: p.calls ? Object.fromEntries(Object.entries(p.calls).map(([k, v]) => [k, +((v - ((p.callsAt || {})[k] || 0)) / Math.max(1, fr.length)).toFixed(2)])) : null };
          p.frames.length = 0; p.gpuMs.length = 0; }
        return { t, gl, actors: P.actors, region: P.region, x: P.x, y: P.y, row: P.row ? P.row.preset : null };
      });
      await sleep(150);
      const unity = await page.evaluate(() => window.__rhPerf.unity || null);
      const deltas = []; for (let i = 1; i < data.t.length; i++) deltas.push(data.t[i] - data.t[i - 1]);
      const cpu1 = browserCpu(), wall = (Date.now() - wall0) / 1000;
      const procCpu = cpu0 && cpu1 ? Object.fromEntries(Object.keys(cpu1).map(k => [k, +((cpu1[k] - cpu0[k]) / wall).toFixed(3)])) : null;   // cores busy during the window
      const w = { kind, seconds, procCpu, gpuBusyBefore, stats: budget(deltas), unity, gl: data.gl, actors: data.actors, region: REGION_NAMES[data.region] || data.region, row: data.row, at: [data.x, data.y], load: [loadBefore, os.loadavg()[0]] };
      rec.windows.push(w);
      const c = w.unity && w.unity.cpu;
      console.log(`  [${build.name} ${quality} ${zone} r${round}] ${kind.padEnd(8)} ${w.region || '-'} ${w.row || ''} actors ${w.actors} p50 ${f(w.stats.p50Ms)} p95 ${f(w.stats.p95Ms)} p99 ${f(w.stats.p99Ms)} >6.94 ${f(w.stats.over694Pct)}% | unity frame ${c ? f(c.frame.mean) : '-'} scripts ${c ? f(c.scripts.mean) : '-'} render ${c ? f(c.render.mean) : '-'} | gc ${w.unity ? w.unity.gcBytesPerFrame : '-'} B/f | draws ${w.gl ? f(w.gl.drawsMean) : '-'} gpu ${w.gl && w.gl.gpuMean != null ? f(w.gl.gpuMean) : '-'} | gpuProc ${w.procCpu ? f(w.procCpu.gpu) : '-'} rend ${w.procCpu ? f(w.procCpu.renderer) : '-'} | load ${f(loadBefore)}`);
      return w;
    };
    const hold = key => async seconds => { await page.keyboard.down(key); await sleep(seconds * 1000); await page.keyboard.up(key); };
    const walk = async seconds => {
      const ev = PR.buildTimeline(seconds); const t0 = Date.now(); let i = 0; const held = new Set(); let md = false;
      while ((Date.now() - t0) / 1000 < seconds) {
        const now = (Date.now() - t0) / 1000;
        while (i < ev.length && ev[i].t <= now) {
          const e = ev[i++];
          if (e.kind === 'down') { held.add(e.key); await page.keyboard.down(e.key); } else if (e.kind === 'up') { held.delete(e.key); await page.keyboard.up(e.key); }
          else if (e.kind === 'move') await page.mouse.move(e.fx * W, e.fy * H); else if (e.kind === 'mdown') { md = true; await page.mouse.down(); } else if (e.kind === 'mup') { md = false; await page.mouse.up(); }
        }
        await sleep(15);
      }
      for (const k of held) await page.keyboard.up(k); if (md) await page.mouse.up();
    };

    if (o.launch) {   // the launch screen (no auto join)
      await sleep(4000);
      await measure('launch', o.planning);
      return rec;
    }
    // planning screen: the map opens when the server starts planning
    await sleep(4000);
    if (o.planning > 0) await measure('planning', o.planning);
    const inMatch = () => rec.netStates.some(s => /InMatch/.test(s));
    const rp = readyPoint(W, H);
    for (let k = 0; k < 8; k++) {
      await page.keyboard.press('1'); await sleep(500);
      await page.mouse.click(rp.x, rp.y, { delay: 80 }); await sleep(1500);
      const a = await page.evaluate(() => window.__rhPerf.actors);
      if (inMatch() && a > 0) break;
    }
    if (!inMatch()) rec.notes.push('never reached InMatch');
    await page.keyboard.press('Escape'); await sleep(500);
    if (ZONE_TARGET[zone] && !o.anyZone) {   // walk there with the keyboard (the minimap is a local view): steer toward the zone centroid until the local region is the zone
      const [tx, ty, rid] = ZONE_TARGET[zone]; const t0 = Date.now(); let reached = false, last = null, stuckAt = Date.now(), detour = null;
      const trace = []; let nextTrace = 0; const held = new Set(); const setKeys = async keys => { for (const k of [...held]) if (!keys.includes(k)) { await page.keyboard.up(k); held.delete(k); } for (const k of keys) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); } };
      while (Date.now() - t0 < 120000) {
        const p = await page.evaluate(() => ({ r: window.__rhPerf.region, x: window.__rhPerf.x, y: window.__rhPerf.y }));
        if (Date.now() >= nextTrace) { trace.push([Math.round((Date.now() - t0) / 1000), Math.round(p.x), Math.round(p.y), p.r]); nextTrace = Date.now() + 5000; }
        if (p.r === rid) { reached = true; break; }
        if (last && Math.hypot(p.x - last.x, p.y - last.y) > 24) { last = p; stuckAt = Date.now(); } else if (!last) last = p;
        if (Date.now() - stuckAt > 1200 && !detour) { detour = { until: Date.now() + 1500, keys: Math.random() < .5 ? ['w', 'a'] : ['s', 'd'] }; stuckAt = Date.now(); }
        let keys = [];
        if (detour && Date.now() < detour.until) keys = detour.keys; else {
          detour = null; const dx = tx - p.x, dy = ty - p.y;
          if (dx > 40) keys.push('d'); else if (dx < -40) keys.push('a'); if (dy > 40) keys.push('s'); else if (dy < -40) keys.push('w');
        }
        await setKeys(keys); await sleep(250);
      }
      if (reached) await sleep(1200);   // a little further in
      await setKeys([]);
      rec.walkTrace = trace; if (!reached) rec.notes.push('did not reach ' + zone + ' (trace s,x,y,region: ' + JSON.stringify(trace) + ')');
    }
    await sleep(2500);
    let first = true;
    for (const [kind, seconds] of o.windows) {
      if (rec.netStates.some(s => /Ended|Closed|Rejected/.test(s))) { rec.notes.push('match ended before ' + kind); break; }
      const m = /^(\w+)(?:\[(.*)\])?$/.exec(kind) || [kind, kind, ''];
      const base = m[1], flags = m[2] || '';
      const input = base === 'walk' || base === 'fight' ? walk : base === 'map' ? hold('Tab') : null;
      if (flags) { await page.evaluate(q => window.unityInstance.SendMessage('Frame-time recorder', 'SetFlags', q), flags); await sleep(500); }
      await measure(kind, seconds, input);
      if (flags) { await page.evaluate(() => window.unityInstance.SendMessage('Frame-time recorder', 'SetFlags', '')); await sleep(400); }
      if (first && o.shots && o.out) {
        try { await page.screenshot({ path: path.join(o.out, `${build.name}-${quality}-${zone}-r${round}.jpg`), type: 'jpeg', quality: 55 }); } catch (e) { rec.notes.push('shot: ' + e.message); }
      }
      if (first && o.passes) {
        await page.evaluate(() => window.__rhPasses.capture(40)); await sleep(1500);
        rec.passes = await page.evaluate(() => window.__rhPasses.result());
        if (rec.passes) console.log(`   passes: ${rec.passes.passCount}, draws ${rec.passes.draws}, gpu ${f(rec.passes.gpuTotalMs)} ms: ` + rec.passes.passes.map(p => `${p.w}x${p.h}:${p.draws}d/${p.progSwitches}p/${f(p.gpuMs)}`).join(' '));
      }
      if (first && o.cpuprofile > 0) {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start');
        await walk(o.cpuprofile);
        const { profile } = await cdp.send('Profiler.stop'); await cdp.detach();
        rec.cpuProfile = aggregateProfile(profile);
        if (o.out) fs.writeFileSync(path.join(o.out, `${build.name}-${quality}-${zone}-r${round}.cpuprofile.json`), JSON.stringify(rec.cpuProfile, null, 1));
      }
      if (first && o.census) {
        await page.evaluate(() => window.unityInstance.SendMessage('Frame-time recorder', 'Census', '')); await sleep(400);
        rec.census = await page.evaluate(() => window.__rhPerf.census || null);
      }
      first = false;
    }
    return rec;
  } catch (e) { rec.notes.push('session failed: ' + (e.message || e)); return rec; }
  finally { rec.load.push(os.loadavg()[0]); await browser.close().catch(() => {}); }
}

/** V8 sampling profile -> self and total time per function (ms over the profile), plus self time grouped by a coarse owner. */
function aggregateProfile(profile) {
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const dt = new Map(); // node id -> sampled ms
  for (let i = 0; i < profile.samples.length; i++) { const id = profile.samples[i]; dt.set(id, (dt.get(id) || 0) + (profile.timeDeltas[i] || 0) / 1000); }
  const total = [...dt.values()].reduce((a, b) => a + b, 0);
  const self = new Map(), incl = new Map();
  const name = n => n.callFrame.functionName || ('(' + (n.callFrame.url || 'anonymous').split('/').pop() + ')');
  for (const [id, ms] of dt) {
    const n = nodes.get(id); self.set(name(n), (self.get(name(n)) || 0) + ms);
    const seen = new Set(); let cur = id;
    while (cur !== undefined) { const nm = name(nodes.get(cur)); if (!seen.has(nm)) { seen.add(nm); incl.set(nm, (incl.get(nm) || 0) + ms); } cur = parent.get(cur); }
  }
  const group = nm => /^_?gl[A-Z]|^emscriptenWebGL|GLctx|^_emscripten_gl/.test(nm) ? 'webgl glue (JS)' : /\(program\)|\(idle\)|\(garbage collector\)|\(root\)/.test(nm) ? nm : /^(UnityEngine_Rendering_Universal|UnityEngine_Rendering_|RenderGraph|ScriptableRenderer|Renderer2D|UniversalRender|Light2D|LightUtility|RendererLighting|PostProcess|Bloom)/.test(nm) ? 'URP/SRP C#' : /^Roguehalla|^Rh|^ArenaView|^SpriteActorPresenter|^Overhead|^MatchHud|^Showcase/.test(nm) ? 'game C#' : /^TMPro|^TMP_/.test(nm) ? 'TextMeshPro' : /^UnityEngine_UI|^UnityEngine_EventSystems/.test(nm) ? 'uGUI' : /_m[0-9A-F]{8,}$|_m[0-9A-F]{6,}/.test(nm) ? 'other C# (IL2CPP)' : 'engine / runtime (native)';
  const groups = {}; for (const [nm, ms] of self) groups[group(nm)] = (groups[group(nm)] || 0) + ms;
  const top = m => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([n, ms]) => ({ n, ms: +ms.toFixed(1), pct: +(100 * ms / total).toFixed(2) }));
  return { totalMs: +total.toFixed(1), groups: Object.fromEntries(Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { ms: +v.toFixed(1), pct: +(100 * v / total).toFixed(2) }])), self: top(self), inclusive: top(incl) };
}

const f = x => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : '-');

/** Pools windows by (build, quality, zone, kind): median of the window statistics (robust to one noisy window). */
function summarise(records) {
  const groups = new Map();
  for (const r of records) for (const w of r.windows) {
    const key = [r.build, r.quality, r.zone, w.kind, r.res, r.vsync].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ w, r });
  }
  const rows = [];
  for (const [key, list] of groups) {
    const [build, quality, zone, kind, res, vsync] = key.split('|');
    const m = sel => median(list.map(x => sel(x.w)).filter(Number.isFinite));
    const cpu = name => m(w => w.unity && w.unity.cpu && w.unity.cpu[name] ? w.unity.cpu[name].mean : NaN);
    const ctr = name => m(w => w.unity && w.unity.counters && w.unity.counters[name] ? w.unity.counters[name].mean : NaN);
    rows.push({ build, quality, zone, kind, res, vsync, windows: list.length, regions: [...new Set(list.map(x => x.w.region))].join('/'),
      actors: m(w => w.actors), p50Ms: m(w => w.stats.p50Ms), p95Ms: m(w => w.stats.p95Ms), p99Ms: m(w => w.stats.p99Ms), meanMs: m(w => w.stats.meanMs),
      over694Pct: m(w => w.stats.over694Pct), over833Pct: m(w => w.stats.over833Pct), low1PctFps: m(w => w.stats.low1PctFps), dropped144Pct: m(w => w.stats.dropped144Pct),
      unityFrameMs: cpu('frame'), scriptsMs: cpu('scripts'), renderMs: cpu('render'), uiRebuildMs: cpu('uiRebuild'), preUpdateMs: cpu('preUpdate'),
      systems: Object.fromEntries(['netPoll', 'hud', 'camera', 'atmosphere', 'present', 'actors', 'collections', 'surfaceFx', 'vision', 'props', 'effects', 'wishFx', 'soundscape'].map(n => [n, cpu(n)])),
      gcBytesPerFrame: m(w => w.unity ? w.unity.gcBytesPerFrame : NaN), tmpRebuildsPerSecond: m(w => w.unity ? w.unity.tmpRebuildsPerSecond : NaN),
      uiGraphicQueue: m(w => w.unity ? w.unity.uiGraphicQueueMean : NaN), uiLayoutQueue: m(w => w.unity ? w.unity.uiLayoutQueueMean : NaN),
      objectsPerSecond: m(w => w.unity ? w.unity.instanceIdDeltaPerSecond : NaN),
      drawCalls: ctr('Draw Calls Count'), setPass: ctr('SetPass Calls Count'), batches: ctr('Batches Count'), triangles: ctr('Triangles Count'),
      glDraws: m(w => w.gl ? w.gl.drawsMean : NaN), rafCpuMs: m(w => w.gl ? w.gl.rafCpuMean : NaN), gpuMs: m(w => w.gl && w.gl.gpuMean != null ? w.gl.gpuMean : NaN),
      gpuP95Ms: m(w => w.gl && w.gl.gpuP95 != null ? w.gl.gpuP95 : NaN), gpuProcessCores: m(w => w.procCpu ? w.procCpu.gpu : NaN), rendererCores: m(w => w.procCpu ? w.procCpu.renderer : NaN), gpuBusyBefore: m(w => w.gpuBusyBefore != null ? w.gpuBusyBefore : NaN), load: m(w => w.load[0]) });
  }
  return rows.sort((a, b) => (a.quality + a.zone + a.kind + a.build).localeCompare(b.quality + b.zone + b.kind + b.build));
}

function displays() {
  try { return PR.parseDisplays(execFileSync('system_profiler', ['SPDisplaysDataType', '-detailLevel', 'mini'], { encoding: 'utf8', timeout: 20000 })); } catch { return []; }
}

async function main() {
  const o = parse(process.argv.slice(2));
  const out = o.out = path.resolve(o.out || path.join(os.tmpdir(), 'perf-matrix-' + Date.now()));
  fs.mkdirSync(out, { recursive: true });
  const records = [];
  const meta = { started: new Date().toISOString(), options: o, displays: displays(), host: { cpus: os.cpus().length, model: os.cpus()[0] && os.cpus()[0].model } };
  for (let round = 0; round < o.rounds; round++)
    for (const quality of o.quality) for (const zone of o.zones) {
      const order = round % 2 ? [...o.builds].reverse() : o.builds;   // alternate which build goes first
      for (const b of order) {
        const r = await session(o, b, quality, zone, round);
        records.push(r);
        if (r.notes.length) console.log('   notes:', r.notes.join('; '));
        fs.writeFileSync(path.join(out, 'records.json'), JSON.stringify({ meta, records }, null, 1));
      }
    }
  const rows = summarise(records);
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ meta, rows }, null, 1));
  console.log('\nbuild      quality zone       kind     n  region            act  p50   p95   p99  >6.94%  1%low  unityF scripts render  gc B/f  draws  gpu   load');
  for (const r of rows) console.log(`${r.build.padEnd(10)} ${r.quality.padEnd(7)} ${r.zone.padEnd(10)} ${r.kind.padEnd(8)} ${String(r.windows).padStart(2)}  ${String(r.regions).padEnd(16)} ${f(r.actors).padStart(5)} ${f(r.p50Ms)} ${f(r.p95Ms)} ${f(r.p99Ms)} ${f(r.over694Pct).padStart(6)} ${f(r.low1PctFps).padStart(6)} ${f(r.unityFrameMs)} ${f(r.scriptsMs)} ${f(r.renderMs)} ${String(Math.round(r.gcBytesPerFrame)).padStart(6)} ${f(r.glDraws)} ${f(r.gpuMs)} ${f(r.load)}`);
  console.log('\n' + path.join(out, 'summary.json'));
}

module.exports = { budget, summarise, readyPoint, minimapRect, legacyScale };
if (require.main === module) main().catch(e => { console.error(e.stack || e); process.exitCode = 2; });
