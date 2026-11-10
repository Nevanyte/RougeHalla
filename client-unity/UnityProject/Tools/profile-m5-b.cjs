'use strict';

// Offline by default. --run additionally requires the separate browser review.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { pathToFileURL } = require('node:url');
const { attachHubProfiler } = require('./profile-hub14.cjs');

const REPO = path.resolve(__dirname, '../../..');
const TOOLS = path.join(os.homedir(), '.codex/tools');
const STAGE = path.join(TOOLS, 'rougehalla-stage2');
const SOURCE_PORT = 17837, WEB_PORT = 18243;
const CONTENT = '7c6a633f68c2cc72';
const PINS = Object.freeze({
  native: 'c30fc84f9b284d0212d2bbe0d13c3b7d894f098d6d93271072df6b8ad6f1dc28',
  manifest: '89aa154216996a7df694479d3efc990ffb73521de02dae143a15fa105b4a4455',
  assets: '38739a1df4c1e76413ff0e86567a352f5e9ed37a9c3db4faafacd6214e11d713',
  map: '90bc4c8e82b7d4ba4819843001ae59da35c20ee870b5591b20192082b5bd16aa',
});
const PATHS = Object.freeze({
  native: path.join(STAGE, 'coordination/reports/demo-m5-release-wave1-01/rh-server'),
  root: path.join(TOOLS, 'rougehalla-unity-wave1-2026-11-09/native-01/web-demo-b/Web'),
  manifest: path.join(TOOLS, 'rougehalla-unity-wave1-2026-11-09/native-01/evidence/b-artifact-manifest.json'),
  assets: path.join(STAGE, 'coordination/reports/web-B-router-preflight-2026-11-10-01/router-assets.json'),
  map: path.join(STAGE, 'return-cleanup-2026-11-08/browser-c52-actual/config/source-map.json'),
  playwright: path.join(STAGE, 'browser/node_modules/playwright'),
  router: path.join(REPO, 'tools/unity-browser-reload-proof/local-router.mjs'),
  companions: path.join(REPO, 'tools/unity-browser-reload-proof/normal-companion.mjs'),
});
const ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const SOURCE = `http://127.0.0.1:${SOURCE_PORT}`;
const SOURCE_WS = `ws://127.0.0.1:${SOURCE_PORT}/ws`;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = code => { const e = new Error(code); e.fixedCode = code; throw e; };

function visitUrl() {
  const visit = new URL(ORIGIN);
  visit.searchParams.set('server', SOURCE_WS);
  visit.searchParams.set('accountApi', `${SOURCE}/api`); // Supported Bootstrap endpoint override; no credential.
  return visit.href;
}

function assetPath(method, host, target) {
  if (host !== `127.0.0.1:${WEB_PORT}` || !['GET', 'HEAD'].includes(method)) return null;
  return typeof target === 'string' ? target.split('?')[0] : null;
}

function databaseUrl(value) {
  let u; try { u = new URL(value); } catch { fail('DATABASE_PREREQUISITE'); }
  // Root's exact existing peer-socket database, or an already prepared dedicated test DB; never a password.
  const existingPeerSocket = u.pathname === '/roguehalla' &&
    u.searchParams.get('host') === '/private/tmp/rh-browser-c52-pg-65439' && u.searchParams.get('port') === '65439';
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.hostname !== 'localhost' || u.username !== 'rh_game' || u.password || u.port ||
      (!existingPeerSocket && !/^\/rh_m5_profile(?:_[a-z0-9]+)?$/.test(u.pathname)) || !u.searchParams.get('host')?.startsWith('/') ||
      u.hash || [...u.searchParams.keys()].some(k => !['host', 'port'].includes(k)) ||
      u.searchParams.getAll('host').length !== 1 || u.searchParams.getAll('port').length !== 1 ||
      !/^\d{1,5}$/.test(u.searchParams.get('port') || '')) fail('DATABASE_PREREQUISITE');
  return value;
}

function safeBrowserArguments(args) {
  return args.map(arg => {
    if (arg.startsWith('--user-data-dir=')) return '--user-data-dir=<fresh temporary profile; path omitted>';
    if (/^--remote-debugging-port=/.test(arg)) return '--remote-debugging-port=<owned ephemeral port>';
    if (/^[a-z]+:\/\//i.test(arg)) return arg === 'about:blank' ? arg : '<browser-start URL omitted>';
    return arg;
  });
}

function sameRoom(owner, peers) {
  return !!owner && peers.length === 2 && peers.every(peer => {
    const v = peer.view();
    return v.connected && v.welcome?.protocol === 14 && v.welcome.contentHash === CONTENT &&
      Buffer.from(v.welcome.match).toString('hex') === owner.matchId &&
      !v.errors.length && !v.rejects.length;
  });
}

async function prepare() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.version !== 'v22.23.4') fail('PINNED_MAC_NODE_REQUIRED');
  for (const [name, expected] of Object.entries(PINS)) {
    if (sha(await fsp.readFile(PATHS[name])) !== expected) fail('FROZEN_ARTIFACT_MISMATCH');
  }
  const { loadSealedAssets } = await import(pathToFileURL(PATHS.router));
  const assets = await loadSealedAssets(PATHS.assets, PATHS.root); // Actual offline 15-entry integrity load; no listener.
  const pkg = JSON.parse(await fsp.readFile(path.join(PATHS.playwright, 'package.json'), 'utf8'));
  const { chromium } = require(PATHS.playwright); // Reading API/executable metadata does not launch a browser.
  await fsp.access(chromium.executablePath(), fs.constants.X_OK);
  return { assets, chromium, plan: {
    status: 'OFFLINE_PREPARED_NOT_EXECUTED', sourcePort: SOURCE_PORT, webPort: WEB_PORT,
    transport: 'HTTP/WS loopback; no WSS or Calgary RTT claim',
    paths: PATHS, pins: PINS, protocol: 14, contentHash: CONTENT,
    buildId: 'build_81371688fcdf', buildSource: '77a92e715809a6a1aa0686299ccc68dc2c6e2300',
    node: { version: process.version, sha256: sha(await fsp.readFile(process.execPath)) },
    playwright: { version: pkg.version, executable: chromium.executablePath(), executableSha256: sha(await fsp.readFile(chromium.executablePath())) },
    capture: { requestedMs: 30000, warmupMs: 10000, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
      headed: true, suppliedChromiumArgs: [], ignoreDefaultArgs: false, privateNonpersistentContext: true },
    prerequisites: ['Root must resolve the separate Playwright Computer Use review before --run.',
      'RH_M5_DATABASE_URL must name Root\'s exact existing peer-socket DB or an already prepared rh_m5_profile[_suffix] DB with the normal rh_game role; no password or new grants.',
      'Ports17837/18243 must be free. Collision aborts; existing services are never stopped.',
      'No installs/builds, no TLS/control endpoint, no connection to public demo or existing user browser.'],
  } };
}

async function serveAssets(assets) {
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    const reject = code => { res.writeHead(code, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end('Unavailable\n'); };
    const target = assetPath(req.method, req.headers.host, req.url);
    if (target === null) return reject(421);
    const asset = assets.get(target);
    if (!asset) return reject(404); // No API, proxy, probe, control, directory listing or fallback.
    let file;
    try {
      file = await fsp.open(path.join(asset.root, asset.file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const now = await file.stat({ bigint: true }), before = asset.identity;
      if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(k => now[k] !== before[k])) throw new Error();
      const headers = { 'content-type': asset.contentType, 'content-length': asset.bytes, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };
      if (asset.encoding) headers['content-encoding'] = asset.encoding;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') { res.end(); await file.close(); return; }
      const stream = file.createReadStream({ autoClose: true }); file = null;
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch { await file?.close().catch(() => {}); if (!res.headersSent) reject(503); else res.destroy(); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(WEB_PORT, '127.0.0.1', resolve); });
  return { close: async () => { for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); } };
}

async function reserveThenReleaseSourcePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(SOURCE_PORT, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}

async function ownsSourceListener(pid) {
  return new Promise(resolve => execFile('/usr/sbin/lsof', ['-nP', '-t', '-a', '-p', String(pid),
    `-iTCP:${SOURCE_PORT}`, '-sTCP:LISTEN'], { timeout: 2000 }, (error, stdout) => {
    resolve(!error && stdout.trim().split(/\s+/).every(value => value === String(pid)) && stdout.trim().length > 0);
  }));
}

async function run(prepared, env = process.env) {
  if (env.RH_M5_BROWSER_REVIEW !== 'approved') fail('BROWSER_REVIEW_REQUIRED');
  const db = databaseUrl(env.RH_M5_DATABASE_URL);
  const output = path.resolve(env.RH_M5_OUT || path.join(STAGE, 'coordination/reports', `m5-profile-${Date.now()}`));
  await fsp.mkdir(output, { mode: 0o700 }); // Refuse an existing output directory.
  const write = (name, value) => fsp.writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  const controller = new AbortController(), endAt = performance.now() + 8 * 60000;
  const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  const watchdog = setTimeout(abort, 8 * 60000);
  let web, native, browser, context, page, collector, measuring = false, nativeExited = false;
  const peers = [], cleanup = {}, movements = [];
  const report = { ...prepared.plan, status: 'INCOMPLETE', output, host: { platform: os.platform(), arch: os.arch(),
    release: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, physicalMemoryBytes: os.totalmem() },
    metricLimits: ['This is a single 30s loopback client scenario, not a sustained60s/144FPS/legacy comparison.',
      'WS application payload bytes and observer callback RTT do not establish WSS/TLS/network/Calgary latency.',
      'Callbacks are not Unity PlayerLoop or total CPU. Heap/Wasm are not total browser/RSS/GPU memory.',
      'GPU elapsed values, when available, retain the existing UNALIGNED warm-up-query limitation.',
      'No native control metrics or hidden state are used. The existing small48x40 map and three normal seats define this workload.'] };
  async function wait(predicate, timeoutMs = 30000) {
    const until = Math.min(endAt, performance.now() + timeoutMs);
    while (performance.now() < until) { if (controller.signal.aborted) fail('RUN_ABORTED'); if (predicate()) return; await sleep(50); }
    fail('PUBLIC_OR_UI_GATE_TIMEOUT');
  }
  async function click(x, y) {
    const box = await page.locator('#unity-canvas').boundingBox(); if (!box) fail('CANVAS_MISSING');
    await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
  }
  async function key(name, ms = 80) {
    await page.keyboard.down(name); try { await sleep(ms); } finally { await page.keyboard.up(name); }
  }
  async function geometry() {
    return page.evaluate(() => { const c = document.querySelector('#unity-canvas'), r = c?.getBoundingClientRect();
      return { viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio, canvas: c ? { width: c.width, height: c.height, cssWidth: r.width, cssHeight: r.height } : null,
        visible: document.visibilityState, focused: document.hasFocus() }; });
  }
  async function publicInfo() {
    const r = await fetch(`${SOURCE}/info`, { signal: AbortSignal.timeout(2000) }); if (!r.ok) return null;
    const v = await r.json(); return { protocol: v.protocol, contentHash: v.contentHash, rooms: v.rooms, lobbies: v.lobbies, players: v.players };
  }
  try {
    web = await serveAssets(prepared.assets); // A collision fails without touching its owner.
    await reserveThenReleaseSourcePort();
    // Never inherit passcodes, auth material, cloud environment or control options.
    const args = ['--runtime', 'source-arena', '--map', PATHS.map, '--bind', `127.0.0.1:${SOURCE_PORT}`,
      '--instance-id', `m5-profile-${Date.now()}`, '--result-spool', path.join(output, 'spool'), '--min-players', '2',
      '--fill-bots', '0', '--max-rooms', '1', '--lobby-seconds', '30', '--fill-seconds', '5', '--database-url', db,
      '--bot-learning', 'off', '--api-cors-origins', ORIGIN];
    native = spawn(PATHS.native, args, { env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore' });
    native.once('error', () => { nativeExited = true; abort(); });
    native.once('exit', () => { nativeExited = true; if (!cleanup.started) abort(); });
    report.processOwnership = { driverPid: process.pid, nativePid: native.pid, nativeBinary: PATHS.native,
      nativeArgumentsSha256: sha(JSON.stringify(args)), database: 'Root-supplied local Unix-socket database; fresh normal profile claims only; URI omitted',
      webPort: WEB_PORT, sourcePort: SOURCE_PORT, control: 'disabled', postgresOwnership: 'external prerequisite; never started/stopped here' };
    await write('ownership.json', report.processOwnership);
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      if (nativeExited || controller.signal.aborted) fail('NATIVE_START_FAILED');
      try { const r = await fetch(`${SOURCE}/readyz`, { signal: AbortSignal.timeout(1000) }); ready = r.ok; } catch {}
      if (!ready) await sleep(100);
    }
    if (!ready) fail('NATIVE_READINESS_TIMEOUT');
    if (nativeExited || !await ownsSourceListener(native.pid)) fail('NATIVE_LISTENER_OWNERSHIP_REQUIRED');
    const info = await publicInfo(); if (info?.protocol !== 14 || info.contentHash !== CONTENT || info.rooms || info.players) fail('SOURCE_IDENTITY_OR_EMPTY_GATE');
    browser = await prepared.chromium.launch({ headless: false, args: [] });
    report.browser = { version: browser.version(), headed: true, suppliedArgs: [], defaultArgsRetained: true };
    const cdp = await browser.newBrowserCDPSession();
    try { report.browser.commandLine = safeBrowserArguments((await cdp.send('Browser.getBrowserCommandLine')).arguments); }
    catch { fail('BROWSER_DEFAULT_FLAGS_UNAVAILABLE'); } finally { await cdp.detach(); }
    context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, acceptDownloads: false });
    // Only this fresh context is accessed. No userDataDir, persistent profile, storageState, HAR or trace.
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      return [ORIGIN, SOURCE].includes(u.origin) && !u.username && !u.password ? route.continue() : route.abort();
    });
    page = await context.newPage();
    page.setDefaultTimeout(5000);
    collector = await attachHubProfiler(page, { identities: { build: { protocol: 14, contentHash: CONTENT, manifestSha256: PINS.manifest },
      server: { protocol: 14, contentHash: CONTENT, binarySha256: PINS.native } } });
    await page.goto(visitUrl()); await page.bringToFront();
    await page.locator('#unity-loading-bar').waitFor({ state: 'hidden', timeout: 120000 }); await sleep(5000);
    await page.screenshot({ path: path.join(output, '01-hub.png') });
    const suffix = crypto.randomBytes(4).toString('hex'), profile = `m5h_${suffix}`;
    await click(.139, .264); await page.keyboard.press('Meta+A'); await page.keyboard.type(profile);
    const loaded = page.waitForResponse(r => r.url() === `${SOURCE}/api/profile/${profile}` && r.status() === 200, { timeout: 15000 });
    await click(.291, .264); await loaded; await sleep(500); // HTTP status only; private profile body/headers are never read.
    await click(.105, .660); // Holy; no rules or values installed.
    await page.screenshot({ path: path.join(output, '02-owned-hub.png') });
    await click(.105, .747); await wait(() => !!collector.publicWelcome, 15000);
    const { connectNormalCompanion } = await import(pathToFileURL(PATHS.companions));
    const admitted = await Promise.allSettled([1, 2].map(async (faction, i) => {
      const peer = await connectNormalCompanion({ endpoint: SOURCE, profile: `m5${i}_${suffix}`, faction }); peers.push(peer); return peer;
    }));
    if (admitted.some(r => r.status === 'rejected') || !sameRoom(collector.publicWelcome, peers)) fail('COMPANION_ADMISSION_OR_ROOM_GATE');
    report.publicRoom = { matchId: collector.publicWelcome.matchId, map: collector.publicWelcome.map, peers: peers.map(p => p.sanitizedReport()) };
    await wait(() => collector.publicOwner?.phase === 3 && collector.publicPlan !== null, 45000); await sleep(200);
    await page.screenshot({ path: path.join(output, '03-planning.png') });
    const pick = collector.publicPlan.taken[0] ? 1 : 0;
    await key(pick ? '2' : '1'); await wait(() => collector.publicPlan?.pick === pick, 5000);
    await click(.8301, .6623); // Actual READY button; no handler call.
    await wait(() => collector.publicPlan?.ready === true || !!collector.activeGate, 5000);
    for (const peer of peers) {
      const p = new Map(peer.view().collections).get(8); if (!p) fail('HELPER_PLAN_MISSING');
      const choice = p.taken[0] ? 1 : 0;
      peer.send([{ k: 'plan', spawn: choice, ready: false }]);
      await peer.waitFor(v => new Map(v.collections).get(8)?.pick === choice, 5000);
      peer.send([{ k: 'plan', ready: true }]);
    }
    await wait(() => !!collector.activeGate, 90000);
    await wait(() => peers.every(p => p.view().snapshot?.phase === 1), 5000);
    await page.mouse.move(640, 400); // World focus only, no attack click.
    await page.screenshot({ path: path.join(output, '04-active-before-warmup.png') });
    const before = collector.publicOwner;
    await key('d', 160); await sleep(250);
    if (collector.publicOwner?.x === before.x && collector.publicOwner?.y === before.y) { await key('w', 160); await sleep(250); }
    if (collector.publicOwner?.x === before.x && collector.publicOwner?.y === before.y) fail('ORDINARY_MOVEMENT_NOT_CONFIRMED');
    report.movementPreflight = { before, after: collector.publicOwner };
    await sleep(10000); if (!sameRoom(collector.publicWelcome, peers)) fail('ROOM_LOST_IN_WARMUP');
    report.presentationBefore = await geometry();
    if (report.presentationBefore.visible !== 'visible' || !report.presentationBefore.focused) fail('FOREGROUND_REQUIRED');
    await collector.begin(); measuring = true;
    const start = performance.now(), deadline = start + 30000;
    let i = 0;
    while (performance.now() < deadline) {
      if (controller.signal.aborted || !collector.activeGate || !sameRoom(collector.publicWelcome, peers)) fail('ACTIVE_WINDOW_LOST');
      const k = i++ % 2 ? 'd' : 'a'; const at = performance.now() - start;
      await key(k, Math.min(160, Math.max(1, deadline - performance.now())));
      movements.push({ atMs: at, key: k, publicOwner: collector.publicOwner });
      await sleep(Math.min(1340, Math.max(0, deadline - performance.now())));
    }
    report.capture = await collector.end(); measuring = false;
    report.presentationAfter = await geometry(); report.movementSchedule = movements;
    if (report.capture.status !== 'CAPTURED' || report.capture.window.durationMs < 29500 || report.capture.window.durationMs > 31500) fail('CAPTURE_INCOMPLETE');
    report.status = 'CAPTURED_SINGLE_30S_LOCAL_WS_WINDOW';
    await page.screenshot({ path: path.join(output, '05-after-capture.png') });
  } catch (e) {
    report.status = 'INCOMPLETE';
    report.failure = typeof e.fixedCode === 'string' ? e.fixedCode : 'RUNTIME_STEP_FAILED';
    // Never emit arbitrary Playwright/server errors, headers, bodies, raw frames or credentials.
    if (measuring) { try { report.capture = await collector.end(); } catch { report.captureEndFailed = true; } measuring = false; }
  } finally {
    cleanup.started = true;
    if (page && !page.isClosed()) {
      for (const k of ['a', 'd', 'w', 's']) await page.keyboard.up(k).catch(() => {});
      if (collector?.publicWelcome) await click(.964, .04).catch(() => {}); // Normal Leave before closing the private context.
    }
    cleanup.peers = (await Promise.allSettled(peers.map(p => p.leaveAndClose()))).map(r => ({ status: r.status, report: r.status === 'fulfilled' ? r.value : null }));
    collector?.detach();
    await context?.close().catch(() => {}); await browser?.close().catch(() => {});
    cleanup.privateBrowserClosed = !browser || !browser.isConnected();
    if (native && !nativeExited) {
      native.kill('SIGTERM'); for (let i = 0; i < 100 && !nativeExited; i++) await sleep(100);
      if (!nativeExited) { cleanup.forcedOwnedNativeStop = true; native.kill('SIGKILL'); await new Promise(resolve => native.once('exit', resolve)); }
    }
    cleanup.nativePid = native?.pid ?? null; cleanup.nativeExited = !native || nativeExited;
    if (web) await web.close(); cleanup.ownedStaticListenerClosed = true;
    if (!cleanup.privateBrowserClosed || !cleanup.nativeExited) {
      report.status = 'INCOMPLETE'; report.failure ||= 'OWNED_CLEANUP_INCOMPLETE';
    }
    clearTimeout(watchdog); process.off('SIGINT', abort); process.off('SIGTERM', abort);
    report.cleanup = cleanup; await write('profile.json', report);
  }
  return { status: report.status, report: path.join(output, 'profile.json'), failure: report.failure || null };
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2); if (args.length !== 1 || !['--check', '--run'].includes(args[0])) fail('USE_CHECK_OR_REVIEWED_RUN');
    const prepared = await prepare();
    const result = args[0] === '--check' ? prepared.plan : await run(prepared);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.failure) process.exitCode = 1;
  })().catch(e => { process.stderr.write(JSON.stringify({ status: 'NOT_RUN_OR_INCOMPLETE', code: e.fixedCode || 'PREPARATION_OR_RUNTIME_FAILED' }) + '\n'); process.exitCode = 1; });
}

module.exports = { databaseUrl, safeBrowserArguments, sameRoom, visitUrl, assetPath, prepare, run, PINS, PATHS, SOURCE_PORT, WEB_PORT };
