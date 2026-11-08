// Repeated, warmed profiling of the real first-playable Unity Web client.
// Requires the built Web player and ordinary first-playable server. No synthetic match inputs.
// Emits three live-run reports with actual wire-observed phase/actors, canvas/backbuffer size,
// the Unity presentation marker, WebGL/RAF metrics, browser memory and page resource download totals.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
let chromium, playwrightLoadError;
try { ({ chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'))); }
catch (e) { playwrightLoadError = e.message; }
const root = path.resolve(__dirname, '../../..');
const hookSource = fs.readFileSync(path.join(__dirname, 'webgl-profile-init.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'crates/rh-server/web/probe.html'), 'utf8');
const decoderSource = html.slice(html.search(/\/\/ ---- protocol v\d+/), html.indexOf('// ---- probe state'));
if (!decoderSource || !decoderSource.includes('const PROTOCOL = 11')) throw Error('probe.html protocol decoder is not v11');
const { Tracker, decode, decodeClient } = new Function(decoderSource + ';return {Tracker,decode,decodeClient}')();
const width = 2560, height = 1440;
const runsRequested = 3;
const targetSeconds = Math.max(3, Math.min(30, Number(process.env.RH_SHOWCASE_PROFILE_SECONDS || 15)));
const warmupSeconds = Math.max(1, Math.min(20, Number(process.env.RH_SHOWCASE_PROFILE_WARMUP_SECONDS || 4)));
const joinTimeoutMs = Math.max(10000, Math.min(45000, Number(process.env.RH_SHOWCASE_PROFILE_JOIN_TIMEOUT_MS || 30000)));
const output = process.env.RH_SHOWCASE_PROFILE_OUT || path.join(prefix, 'unity-showcase', 'profile');
const headed = process.env.RH_SHOWCASE_PROFILE_HEADED !== '0';
const uncappedDiagnostic = process.env.RH_SHOWCASE_PROFILE_UNCAPPED === '1';
const server = process.env.RH_SHOWCASE_PROFILE_SERVER || 'ws://127.0.0.1:18797/ws';
const baseUrl = new URL(process.env.RH_SHOWCASE_PROFILE_URL || 'http://127.0.0.1:18897/');
const buildManifestPath = process.env.RH_SHOWCASE_BUILD_MANIFEST || path.join(os.homedir(), '.codex/tools/rougehalla-unity-art/evidence/build-manifest.json');
const buildManifestRaw = fs.readFileSync(buildManifestPath);
const buildManifest = JSON.parse(buildManifestRaw.toString('utf8'));
if (!buildManifest.runtimeRevision || buildManifest.protocol !== 11) throw Error('Build manifest is missing runtime revision or protocol v11');
const runtimeIdentity = { manifestPath: buildManifestPath, manifestSha256: crypto.createHash('sha256').update(buildManifestRaw).digest('hex'),
  runtimeRevision: buildManifest.runtimeRevision, baseGameplayRevision: buildManifest.baseGameplayRevision,
  unity: buildManifest.unity, urp: buildManifest.urp, protocol: buildManifest.protocol,
  contentHash: buildManifest.contentHash, totalBytes: buildManifest.totalBytes };
fs.mkdirSync(output, { recursive: true });
const safeError = value => String(value).replace(/([?&](?:token|resume|ticket|session)=)[^&\s]+/gi, '$1[redacted]');

const readPhysicalDisplays = () => {
  if (process.platform !== 'darwin') return { status: 'unavailable', reason: 'macOS system_profiler is unavailable on this host' };
  try {
    const raw = execFileSync('system_profiler', ['SPDisplaysDataType', '-detailLevel', 'mini'], { encoding: 'utf8', timeout: 15000 });
    const displays = [];
    const chunks = raw.split(/\n(?= {8}[^ \n].+:\n)/);
    for (const chunk of chunks) {
      const name = chunk.match(/^ {8}([^\n]+):/m)?.[1];
      const mode = chunk.match(/^\s+UI Looks like: (.+)$/m)?.[1] || chunk.match(/^\s+Resolution: (.+)$/m)?.[1];
      if (!name || !mode) continue;
      const resolution = mode.match(/(\d+)\s*x\s*(\d+)/i);
      const refresh = mode.match(/@\s*([\d.]+)\s*Hz/i);
      displays.push({ name, main: /^\s+Main Display: Yes$/m.test(chunk), mode,
        width: resolution ? Number(resolution[1]) : null, height: resolution ? Number(resolution[2]) : null,
        refreshHz: refresh ? Number(refresh[1]) : null });
    }
    return { status: displays.length ? 'observed' : 'unparsed', displays };
  } catch (error) { return { status: 'unavailable', reason: safeError(error) }; }
};
const physicalDisplays = readPhysicalDisplays();
const mainDisplay = physicalDisplays.displays?.find(display => display.main) || null;
const nativeDisplayMatch = mainDisplay?.width === width && mainDisplay?.height === height && mainDisplay?.refreshHz >= 144;

const round = (value, places = 3) => Number.isFinite(value) ? Number(value.toFixed(places)) : null;
const percentile = (values, p) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)] : null;
};
const distribution = values => ({
  samples: values.filter(Number.isFinite).length,
  p50: round(percentile(values, .50)), p95: round(percentile(values, .95)),
  p99: round(percentile(values, .99)), max: round(values.filter(Number.isFinite).length ? Math.max(...values.filter(Number.isFinite)) : null),
});
const median = values => percentile(values, .5);
const bufferFromFrame = payload => {
  const bytes = typeof payload === 'string' ? Buffer.from(payload, 'base64') : Buffer.from(payload);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const safeUrl = value => {
  let safe;
  try { safe = new URL(value); } catch { return safeError(value); }
  for (const key of ['token', 'resume', 'ticket', 'session']) if (safe.searchParams.has(key)) safe.searchParams.set(key, '[redacted]');
  return safe.toString();
};
const waitUntil = async (page, predicate, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await page.waitForTimeout(100);
  }
  return !!predicate();
};
const rootPoint = (canvas, x, y) => ({
  x: canvas.x + x * canvas.width,
  y: canvas.y + (1 - y) * canvas.height,
});
const panelPoint = (canvas, panel, x, y) => rootPoint(canvas,
  panel[0] + x * (panel[2] - panel[0]), panel[1] + y * (panel[3] - panel[1]));
const clickCanvas = async (page, canvas, x, y) => {
  const point = rootPoint(canvas, x, y);
  await page.mouse.click(point.x, point.y, { delay: 60 });
  await page.waitForTimeout(180);
};

// Capture every Unity/browser RAF callback (not just callbacks that submit GL draws). The existing
// GL hook continues to record scoped synchronous callback CPU, GPU timer queries, draws, instances,
// heap and wasm memory. This wrapper adds cadence samples around that hook without touching input.
const rafHook = `
(() => {
  const p = window.__rhProfile;
  if (!p) throw new Error('WebGL profile hook did not initialize');
  p.rafFrames = []; p.backbufferChanges = [];
  let previous = null, lastSize = '';
  const wrapped = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function(callback) {
    return wrapped(function(ts) {
      const start = performance.now();
      try { return callback(ts); }
      finally {
        const canvas = document.getElementById('unity-canvas');
        const size = canvas ? canvas.width + 'x' + canvas.height : 'missing';
        if (size !== lastSize) { p.backbufferChanges.push({ at: ts, canvas: size }); lastSize = size; }
        p.rafFrames.push({ time: ts, interval: previous === null ? null : ts - previous,
          callbackMs: performance.now() - start, jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
          wasmBytes: p.wasmMemories?.length ? p.wasmMemories.reduce((n, m) => n + m.buffer.byteLength, 0) : null });
        previous = ts;
      }
    });
  };
})();`;

async function profileRun(browser, index) {
  const runId = `run-${index + 1}`;
  // Protocol profile/nickname is capped by the server; keep each run distinct and comfortably
  // under that bound so an otherwise valid profile capture cannot be rejected at join.
  const nickname = `artp${Date.now().toString(36).slice(-7)}${index + 1}`;
  const url = new URL(baseUrl);
  url.searchParams.set('server', server);
  url.searchParams.set('profile', nickname);
  url.searchParams.set('faction', '4');
  url.searchParams.set('auto', '1');
  url.searchParams.delete('preview');
  const shownUrl = safeUrl(url);
  const run = {
    id: runId, profile: nickname, url: shownUrl.toString(), requested: { width, height, targetSeconds, warmupSeconds },
    pageErrors: [], consoleErrors: [], observerErrors: [], httpErrors: [], phaseSamples: [], snapshots: 0,
    wire: { sent: 0, received: 0, welcome: null, results: 0, inputCounts: {} }, serverFx: [], status: 'INCOMPLETE',
  };
  const page = await browser.newPage({
    viewport: { width, height }, deviceScaleFactor: 1,
    ignoreHTTPSErrors: process.env.RH_SHOWCASE_PROFILE_ALLOW_SELF_SIGNED === '1',
  });
  page.on('pageerror', e => run.pageErrors.push(safeError(e)));
  page.on('console', message => { if (message.type() === 'error') run.consoleErrors.push({ text: safeError(message.text()), location: message.location() }); });
  page.on('response', response => { if (response.status() >= 400) run.httpErrors.push({ status: response.status(), url: safeUrl(response.url()) }); });
  page.on('websocket', socket => {
    const tracker = new Tracker();
    socket.on('framesent', frame => {
      run.wire.sent++;
      try {
        const message = decodeClient(bufferFromFrame(frame.payload));
        if (message.t === 'input') for (const command of message.cmds) run.wire.inputCounts[command.k] = (run.wire.inputCounts[command.k] || 0) + 1;
      } catch (e) { run.observerErrors.push(safeError(e)); }
    });
    socket.on('framereceived', frame => {
      run.wire.received++;
      try {
        const message = decode(bufferFromFrame(frame.payload));
        if (message.t === 'welcome') run.wire.welcome = { player: message.player, protocol: message.protocol, tickRate: message.tickRate,
          map: { width: message.map.w, height: message.map.h, collisionHash: message.map.hash } };
        const applied = tracker.apply(message);
        if (applied?.t === 'snapshot') {
          run.latestSnapshot = applied;
          run.snapshots++;
          const sample = { at: Date.now(), tick: applied.tick, phase: applied.phase, actorCount: applied.actors.length,
            visibleMobCount: applied.actors.filter(a => a.kind === 1).length, meAlive: applied.me?.status === 1 };
          run.phaseSamples.push(sample);
        }
        if (message.t === 'fx') for (const fx of message.fx) run.serverFx.push({ ...fx, tick: message.tick, observedAt: Date.now() });
        if (message.t === 'events') run.wire.results += message.events.filter(event => event.k === 'result').length;
      } catch (e) { run.observerErrors.push(safeError(e)); }
    });
  });

  const startedAt = Date.now();
  try {
    // Each page is a fresh Playwright context; it does not reuse the user's browser profile/storage.
    await page.addInitScript({ content: hookSource + '\n' + rafHook });
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.bringToFront();
    try {
      const cdp = await page.context().newCDPSession(page);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      // Make the future native-display gate reachable without emulating fullscreen.
      // Current 60Hz diagnostic captures did not request this mode.
      if (process.env.RH_SHOWCASE_PROFILE_FULLSCREEN === '1' || (nativeDisplayMatch && headed && !uncappedDiagnostic)) {
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
        await page.waitForTimeout(750);
      }
      const bounds = await cdp.send('Browser.getWindowBounds', { windowId });
      run.browserWindow = { windowId, ...bounds.bounds, documentHasFocus: await page.evaluate(() => document.hasFocus()) };
      await cdp.detach();
    } catch (error) { run.browserWindow = { status: 'unavailable', reason: safeError(error) }; }
    await page.locator('#unity-canvas').waitFor({ state: 'visible', timeout: 45000 });
    await page.locator('#unity-loading-bar').waitFor({ state: 'hidden', timeout: 120000 });
    run.load = { canvasReadyMs: Date.now() - startedAt };

    // Set the actual canvas CSS and backing dimensions to the requested native-size viewport.
    // Verify the WebGL drawing buffer itself (canvas attributes alone are not accepted as proof).
    run.canvasBeforeSettings = await page.evaluate(async ({ width: w, height: h }) => {
      const canvas = document.getElementById('unity-canvas');
      canvas.style.position = 'fixed'; canvas.style.left = '0'; canvas.style.top = '0';
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      canvas.style.maxWidth = 'none'; canvas.style.maxHeight = 'none';
      canvas.width = w; canvas.height = h;
      window.dispatchEvent(new Event('resize'));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const gl = canvas.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return { css: (() => { const r = canvas.getBoundingClientRect(); return { width: r.width, height: r.height }; })(),
        canvas: { width: canvas.width, height: canvas.height },
        drawingBuffer: gl ? { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight } : null,
        devicePixelRatio: window.devicePixelRatio, screen: { width: screen.width, height: screen.height,
          availWidth: screen.availWidth, availHeight: screen.availHeight },
        viewport: { width: innerWidth, height: innerHeight }, visibility: document.visibilityState,
        renderer: gl ? (debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : null };
    }, { width, height });

    const canvasBox = await page.locator('#unity-canvas').boundingBox();
    if (!canvasBox || Math.abs(canvasBox.x) > 1 || Math.abs(canvasBox.y) > 1 || canvasBox.width !== width || canvasBox.height !== height) throw Error(`${runId} canvas box ${JSON.stringify(canvasBox)}, expected origin 0,0 and size ${width}x${height}`);
    if (run.canvasBeforeSettings.drawingBuffer?.width !== width || run.canvasBeforeSettings.drawingBuffer?.height !== height) {
      throw Error(`${runId} actual WebGL drawing buffer ${JSON.stringify(run.canvasBeforeSettings.drawingBuffer)}, expected ${width}x${height}`);
    }
    if (run.canvasBeforeSettings.devicePixelRatio !== 1) throw Error(`${runId} devicePixelRatio ${run.canvasBeforeSettings.devicePixelRatio}, expected 1`);
    if (run.canvasBeforeSettings.viewport.width !== width || run.canvasBeforeSettings.viewport.height !== height) throw Error(`${runId} browser viewport ${JSON.stringify(run.canvasBeforeSettings.viewport)}, expected ${width}x${height}`);

    // Auto-join through Bootstrap's explicit normal query. Await delivered state, then select
    // Adaptive -> Manual High through the actual Settings button, using MatchHud's anchors.
    const gotWelcome = await waitUntil(page, () => !!run.wire.welcome || run.observerErrors.length > 0, joinTimeoutMs);
    if (run.observerErrors.length) throw Error(`${runId} public wire observer preflight failed: ${run.observerErrors[0]}`);
    if (!gotWelcome) throw Error(`${runId} no decoded public Welcome during observer preflight`);
    const gotActive = await waitUntil(page, () => run.phaseSamples.some(s => s.phase === 1 && s.meAlive) || run.observerErrors.length > 0, joinTimeoutMs);
    if (run.observerErrors.length) throw Error(`${runId} public snapshot observer failed: ${run.observerErrors[0]}`);
    run.load.timeToActiveMs = Date.now() - startedAt;
    if (!gotActive) throw Error(`${runId} did not receive an authoritative active/alive snapshot within ${joinTimeoutMs}ms`);
    if (run.wire.welcome?.protocol !== 11) throw Error(`${runId} expected protocol v11 Welcome, got ${JSON.stringify(run.wire.welcome)}`);
    await clickCanvas(page, canvasBox, .75, .96); // root Settings button
    await page.waitForTimeout(250);
    const settingsPanel = [.22, .20, .78, .82];
    const qualityButton = panelPoint(canvasBox, settingsPanel, .5, .74); // local quality row center
    await page.mouse.click(qualityButton.x, qualityButton.y, { delay: 60 });
    await page.waitForFunction(() => window.__rhShowcaseSettings?.mode === 'Manual' && window.__rhShowcaseSettings?.quality === 'High', undefined, { timeout: 5000 });
    // This is the Unity C#-published presentation state, not a query label or env assertion.
    let showcaseSettings = await page.evaluate(() => window.__rhShowcaseSettings || null);
    if (showcaseSettings?.reducedMotion) {
      const motionButton = panelPoint(canvasBox, settingsPanel, .5, .63);
      await page.mouse.click(motionButton.x, motionButton.y, { delay: 60 });
      await page.waitForFunction(() => window.__rhShowcaseSettings?.reducedMotion === false, undefined, { timeout: 5000 });
      showcaseSettings = await page.evaluate(() => window.__rhShowcaseSettings || null);
    }
    run.quality = { observedThroughUnityMarker: showcaseSettings,
      passed: showcaseSettings?.mode === 'Manual' && showcaseSettings?.quality === 'High' && showcaseSettings?.reducedMotion === false };
    if (!run.quality.passed) throw Error(`${runId} Unity marker did not confirm Manual High / reduced motion off`);
    const qualityImage = path.join(output, `${runId}-manual-high.png`);
    await page.screenshot({ path: qualityImage }); run.artifacts = [qualityImage];
    await clickCanvas(page, canvasBox, .75, .96); // close settings

    // Wait for warmed active play, stopping promptly if the authoritative match ends early.
    const warmStart = Date.now();
    while (Date.now() - warmStart < warmupSeconds * 1000 && run.phaseSamples.at(-1)?.phase === 1) await page.waitForTimeout(100);
    run.warmup = { requestedSeconds: warmupSeconds, actualSeconds: round((Date.now() - warmStart) / 1000),
      lastPhase: run.phaseSamples.at(-1)?.phase ?? null };
    if (run.phaseSamples.at(-1)?.phase !== 1) throw Error(`${runId} match left active phase during warm-up`);
    const unityMetrics = () => page.evaluate(() => {
      const read = window.unityInstance?.GetMetricsInfo;
      if (typeof read !== 'function') return { available: false };
      try { return { available: true, value: read.call(window.unityInstance) }; }
      catch (error) { return { available: false, error: String(error) }; }
    });
    run.unityMetricsBeforeMeasurement = await unityMetrics();

    const inputCountsAtStart = { ...run.wire.inputCounts };
    run.measurementStartedAt = Date.now();
    await page.evaluate(() => {
      const p = window.__rhProfile;
      p.frames = []; p.gpuMs = []; p.gpuDisjoint = 0; p.rafFrames = []; p.backbufferChanges = [];
      p.measurementStartedAt = performance.now();
    });
    const measureStarted = Date.now();
    let endedEarly = false;
    const combat = { actions: [], durationMs: 0, screenshot: null };
    const worldPoint = (x, y) => ({ x: x / 32, y: -y / 32 * .78 });
    const projectObserved = (point, self) => {
      const camera = worldPoint(self.x, self.y), target = worldPoint(point.x, point.y), aspect = canvasBox.width / canvasBox.height;
      return { x: canvasBox.x + (.5 + (target.x - camera.x) / (18 * aspect)) * canvasBox.width,
        y: canvasBox.y + (.5 - (target.y - (camera.y + 1.5)) / 18) * canvasBox.height };
    };
    const movePointerToClearWorld = async () => {
      const self = run.latestSnapshot?.me;
      if (!self) return;
      const center = worldPoint(self.x, self.y), desiredWorldY = center.y + 1.5 + (.5 - .55) * 18;
      const targetY = -desiredWorldY * 32 / .78;
      const point = projectObserved({ x: self.x, y: targetY }, self);
      await page.mouse.move(point.x, point.y);
    };
    const inputWindowStarted = Date.now();
    while (Date.now() - measureStarted < targetSeconds * 1000) {
      if (run.phaseSamples.at(-1)?.phase !== 1) { endedEarly = true; break; }
      const snapshot = run.latestSnapshot;
      const target = snapshot?.actors?.filter(actor => actor.kind === 1 && actor.status === 1 && Number.isFinite(actor.x) && Number.isFinite(actor.y))
        .map(actor => ({ actor, distance: Math.hypot(actor.x - snapshot.me.x, actor.y - snapshot.me.y) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (!snapshot?.me || !target) { await page.waitForTimeout(100); continue; }
      const actorPoint = projectObserved(target.actor, snapshot.me), inWorld = actorPoint.x >= canvasBox.x && actorPoint.x <= canvasBox.x + canvasBox.width &&
        actorPoint.y >= canvasBox.y && actorPoint.y < canvasBox.y + .77 * canvasBox.height;
      // Stay inside typical starter melee reach. A farther swing may be visually real but
      // never contact a mob, so use short ordinary WASD holds until the delivered mob is close.
      if (target.distance > 36 || !inWorld) {
        const dx = target.actor.x - snapshot.me.x, dy = target.actor.y - snapshot.me.y;
        const key = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'd' : 'a') : (dy >= 0 ? 's' : 'w');
        await movePointerToClearWorld(); await page.keyboard.down(key); await page.waitForTimeout(160); await page.keyboard.up(key);
        combat.actions.push({ type: 'WASD-approach', key, distance: target.distance,
          observed: { id: target.actor.id, kind: target.actor.kind, x: target.actor.x, y: target.actor.y }, tick: snapshot.tick });
      } else {
        const selfPoint = projectObserved(snapshot.me, snapshot.me), dx = actorPoint.x - selfPoint.x, dy = actorPoint.y - selfPoint.y, length = Math.hypot(dx, dy) || 1;
        const aimCandidates = [1, -1].map(direction => ({ x: actorPoint.x + dx / length * 28 * direction, y: actorPoint.y + dy / length * 28 * direction }))
          .filter(point => point.x >= canvasBox.x && point.x <= canvasBox.x + canvasBox.width && point.y >= canvasBox.y && point.y < canvasBox.y + .77 * canvasBox.height && Math.hypot(point.x - actorPoint.x, point.y - actorPoint.y) > 22);
        if (aimCandidates.length) {
          const aim = aimCandidates[0];
          await page.mouse.move(aim.x, aim.y); await page.mouse.down();
          try { await page.waitForTimeout(160); } finally { await page.mouse.up(); }
          combat.actions.push({ type: 'mouse-attack', observed: { id: target.actor.id, kind: target.actor.kind,
            x: target.actor.x, y: target.actor.y, hpPct: target.actor.hpPct }, distance: target.distance, tick: snapshot.tick });
          await movePointerToClearWorld();
        } else { await movePointerToClearWorld(); await page.waitForTimeout(100); }
      }
      if (!combat.screenshot && Date.now() - inputWindowStarted >= 2000) {
        combat.screenshot = path.join(output, `${runId}-combat.png`);
        await page.screenshot({ path: combat.screenshot }); run.artifacts.push(combat.screenshot);
      }
      await page.waitForTimeout(80);
    }
    combat.durationMs = Date.now() - inputWindowStarted;
    run.measurementEndedAt = Date.now();
    const measurementFx = run.serverFx.filter(fx => fx.observedAt >= run.measurementStartedAt && fx.observedAt <= run.measurementEndedAt);
    const playerId = run.wire.welcome?.player;
    const playerHitFx = measurementFx.filter(fx => fx.k === 'hit' && fx.by === playerId);
    const playerSwingFx = measurementFx.filter(fx => fx.k === 'swing' && fx.by === playerId);
    const measurementInputCounts = Object.fromEntries(Object.entries(run.wire.inputCounts).map(([key, value]) => [key, value - (inputCountsAtStart[key] || 0)]));
    run.combatInput = { ...combat, sentInputCounts: measurementInputCounts, publicFxCount: measurementFx.length,
      confirmedSwingFxFromSelf: playerSwingFx.length, confirmedHitFxFromSelf: playerHitFx.length,
      approachThresholdUnits: 36,
      hitFxFromSelf: playerHitFx, confirmed: playerHitFx.length > 0,
      note: 'Ordinary keyboard/mouse inputs targeted delivered visible mobs; hit/swing confirmations are server public FX by the welcomed player ID.' };
    run.liveWindow = { startedAt: new Date(measureStarted).toISOString(), observedSeconds: round((Date.now() - measureStarted) / 1000),
      requestedSeconds: targetSeconds, endedEarly, terminalPhase: run.phaseSamples.at(-1)?.phase ?? null };
    run.unityMetricsAfterMeasurement = await unityMetrics();
    const raw = await page.evaluate(() => {
      const p = window.__rhProfile;
      const canvas = document.getElementById('unity-canvas'), gl = canvas?.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return { frames: p.frames, rafFrames: p.rafFrames, gpuMs: p.gpuMs, gpuDisjoint: p.gpuDisjoint,
        contexts: p.contexts, backbufferChanges: p.backbufferChanges, buffersCreated: p.buffersCreated,
        buffersDeleted: p.buffersDeleted, wasmMemories: p.wasmMemories.map(m => m.buffer.byteLength),
        canvas: canvas ? { width: canvas.width, height: canvas.height, css: (() => { const r=canvas.getBoundingClientRect();return {width:r.width,height:r.height};})(),
          drawingBuffer: gl ? { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight } : null } : null,
        browserMemory: performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize, jsHeapSizeLimit: performance.memory.jsHeapSizeLimit } : null,
        resources: performance.getEntriesByType('resource').map(e => ({ name: e.name, initiatorType: e.initiatorType,
          durationMs: e.duration, transferSize: e.transferSize, encodedBodySize: e.encodedBodySize, decodedBodySize: e.decodedBodySize })),
        navigation: (() => { const n=performance.getEntriesByType('navigation')[0]; return n ? {
          domContentLoadedMs:n.domContentLoadedEventEnd, loadEventMs:n.loadEventEnd, responseMs:n.responseEnd,
          transferSize:n.transferSize, encodedBodySize:n.encodedBodySize, decodedBodySize:n.decodedBodySize } : null; })(),
        browser: { dpr: devicePixelRatio, visibility: document.visibilityState, innerWidth, innerHeight,
          screenWidth:screen.width, screenHeight:screen.height, outerWidth, outerHeight, hasFocus:document.hasFocus() } };
    });
    run.canvasAfterMeasurement = raw.canvas;
    const intervals = raw.rafFrames.slice(1).map(f => f.interval).filter(Number.isFinite);
    const rates = intervals.map(ms => 1000 / ms).filter(Number.isFinite);
    const submissionFrames = raw.frames || [];
    const frameDeltas = submissionFrames.slice(1).map(f => f.interval).filter(Number.isFinite);
    const elapsedWindowMs = Math.max(1, run.liveWindow.observedSeconds * 1000);
    run.metrics = {
      raf: { callbacks: raw.rafFrames.length, callbackIntervalsMs: distribution(intervals),
        callbackCpuMs: distribution(raw.rafFrames.map(f => f.callbackMs)), callbackRateHz: round(raw.rafFrames.length * 1000 / elapsedWindowMs),
        intervalRateHzP50: round(median(rates)), intervalRateHzMean: round(rates.length ? rates.reduce((a,b)=>a+b,0)/rates.length : null) },
      submittedFrames: { callbacksWithGlDraws: submissionFrames.length, intervalsMs: distribution(frameDeltas),
        drawRateHz: round(submissionFrames.length * 1000 / elapsedWindowMs),
        cpuCallbackMs: distribution(submissionFrames.map(f => f.cpuMs)), drawCalls: distribution(submissionFrames.map(f => f.draws)),
        instances: distribution(submissionFrames.map(f => f.instances)) },
      gpuTimer: { samples: raw.gpuMs.length, elapsedMs: distribution(raw.gpuMs), disjointObservations: raw.gpuDisjoint,
        extensionAvailable: !!raw.contexts?.[0]?.timerQuery },
      memory: { jsHeapUsedBytes: distribution(raw.rafFrames.map(f => f.jsHeapBytes)),
        wasmBytes: distribution(raw.rafFrames.map(f => f.wasmBytes)), browserAfter: raw.browserMemory,
        wasmMemoriesAfter: raw.wasmMemories },
      webgl: { contexts: raw.contexts, buffers: { created: raw.buffersCreated, deleted: raw.buffersDeleted },
        backbufferChanges: raw.backbufferChanges },
    };
    const resources = raw.resources || [];
    run.load = { ...run.load, navigation: raw.navigation,
      resourceCount: resources.length,
      totalTransferBytes: resources.reduce((n, r) => n + (r.transferSize || 0), 0),
      totalEncodedBytes: resources.reduce((n, r) => n + (r.encodedBodySize || 0), 0),
      largestResources: [...resources].sort((a,b) => (b.transferSize||b.encodedBodySize||0)-(a.transferSize||a.encodedBodySize||0)).slice(0, 20) };
    run.browser = raw.browser;
    const measurementSamples = run.phaseSamples.filter(s => s.at >= measureStarted);
    let activePhaseMs = 0;
    for (let i = 1; i < measurementSamples.length; i++) {
      if (measurementSamples[i - 1].phase === 1) activePhaseMs += measurementSamples[i].at - measurementSamples[i - 1].at;
    }
    if (measurementSamples.at(-1)?.phase === 1) activePhaseMs += Math.max(0, Date.now() - measurementSamples.at(-1).at);
    run.authoritative = {
      activeSnapshots: measurementSamples.filter(s => s.phase === 1).length,
      measuredPhaseSamples: measurementSamples,
      activePhaseSecondsFromWire: round(activePhaseMs / 1000),
      activeActorCount: distribution(measurementSamples.filter(s => s.phase === 1).map(s => s.actorCount)),
      activeVisibleMobCount: distribution(measurementSamples.filter(s => s.phase === 1).map(s => s.visibleMobCount)),
      final: run.phaseSamples.at(-1) || null,
      totalServerFrames: run.wire.received,
    };
    const exactBuffer = raw.canvas?.drawingBuffer?.width === width && raw.canvas?.drawingBuffer?.height === height;
    const stableBuffer = raw.backbufferChanges?.every(change => change.canvas === `${width}x${height}`);
    if (!exactBuffer || !stableBuffer) throw Error(`${runId} WebGL backbuffer changed or ended at ${JSON.stringify(raw.canvas?.drawingBuffer)}`);
    if (!raw.rafFrames.length || !submissionFrames.length) throw Error(`${runId} produced no RAF callbacks or WebGL draw submissions`);
    if (!run.authoritative.activeSnapshots) throw Error(`${runId} produced no active authoritative observations during measurement`);
    const fatalConsoleErrors = run.consoleErrors;
    const unexpectedHttpErrors = run.httpErrors;
    run.errorAssessment = { unexpectedHttpErrors, fatalConsoleErrors };
    if (run.observerErrors.length || run.pageErrors.length || fatalConsoleErrors.length || unexpectedHttpErrors.length) throw Error(`${runId} captured console/protocol/runtime/resource errors`);
    if (run.combatInput.confirmed) run.status = 'PASS';
    else { run.status = 'INCOMPLETE'; run.incompleteReason = 'No server-confirmed hit FX from ordinary combat inputs during the measured window.'; }
  } catch (e) {
    run.failure = safeError(e);
    const networkGap = /ERR_CONNECTION|Timeout[\s\S]*unity-canvas|did not receive an authoritative active/i.test(run.failure) &&
      run.wire.received === 0 && run.pageErrors.length === 0 && run.consoleErrors.length === 0;
    run.status = networkGap ? 'INCOMPLETE' : 'FAIL';
  } finally {
    run.elapsedSeconds = round((Date.now() - startedAt) / 1000);
    await page.close();
  }
  return run;
}

(async () => {
  let browser;
  const report = { createdAt: new Date().toISOString(), runtime: runtimeIdentity, browser: null, headed, uncappedDiagnostic, physicalDisplays, target: { width, height, requestedDisplayHz: 144, runs: runsRequested,
    warmupSeconds, activeSecondsPerRun: targetSeconds, server: safeUrl(server), viewport: `${width}x${height}`, deviceScaleFactor: 1 },
    notes: [
      'A fresh Playwright context is used per run; no normal user browser profile or storage is reused.',
      'Quality is accepted only from the C#-published window.__rhShowcaseSettings marker: Manual/High and reducedMotion=false.',
      'RAF callback rate comes from every requestAnimationFrame callback. Draw rate only counts callbacks with WebGL draws.',
      'RAF cadence is observed from Chromium callbacks; it does not claim the physical display scan-out rate.',
      'A measured combat exchange is confirmed only from server-delivered hit FX attributed to the welcomed player; observer actor IDs are never followed across renewals.',
      'The optional uncapped diagnostic requests --disable-frame-rate-limit and --disable-gpu-vsync. It measures submission headroom and is always ineligible as physical display/FPS proof.',
      'Synchronous callback CPU is scoped instrumentation time, not total browser CPU or Unity PlayerLoop time.',
      'GPU elapsed time uses EXT_disjoint_timer_query_webgl2 when available; absent samples mean unavailable, not zero.',
      'Browser memory exposes Chromium performance.memory where supported, plus live WebAssembly.Memory byte lengths.',
      'Native display eligibility also requires the headed Chromium window bounds to be fullscreen and cover the requested physical display; an emulated oversized page viewport is insufficient.',
      'Unity GetMetricsInfo is sampled once before and once after each window; no managed allocation counter is exposed.',
      'Actor counts and phase are decoded only from server-delivered protocol v11 snapshots; no synthetic simulation or input is used.',
      'The preview/staged-art route is not used for gameplay or full-game FPS measurements; during each live window, ordinary UI inputs target only delivered visible mobs.',
    ], runs: [] };
  const infraErrors = [];
  try {
    if (!chromium) throw Error('Playwright unavailable: ' + (playwrightLoadError || 'Chromium module did not export chromium'));
    const args = ['--window-size=2560,1440', '--window-position=0,0', '--start-fullscreen', '--force-device-scale-factor=1'];
    if (uncappedDiagnostic) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
    if (process.platform === 'darwin' && process.env.RH_SHOWCASE_PROFILE_ANGLE_METAL !== '0') args.push('--use-angle=metal', '--enable-gpu');
    if (process.env.RH_SHOWCASE_PROFILE_HEADLESS === '1') args.push('--headless=new');
    browser = await chromium.launch({ headless: !headed || process.env.RH_SHOWCASE_PROFILE_HEADLESS === '1', args });
    report.browser = { version: await browser.version(), launchArgs: args, headless: !headed || process.env.RH_SHOWCASE_PROFILE_HEADLESS === '1' };
    for (let i = 0; i < runsRequested; i++) {
      const run = await profileRun(browser, i);
      report.runs.push(run);
      console.log(JSON.stringify({ progress: `completed ${i + 1}/${runsRequested}`, run: run.id, status: run.status,
        liveSeconds: run.liveWindow?.observedSeconds, actors: run.authoritative?.activeActorCount,
        backbuffer: run.canvasAfterMeasurement?.drawingBuffer, quality: run.quality?.observedThroughUnityMarker }));
      if (run.observerErrors.length) {
        infraErrors.push(`Observer decoder failed in ${run.id}; aborted remaining repeats: ${run.observerErrors[0]}`);
        break;
      }
    }
  } catch (e) {
    infraErrors.push(safeError(e));
    report.infrastructureError = infraErrors[0];
  } finally {
    if (browser) await browser.close();
  }
  const statuses = report.runs.map(r => r.status);
  const hasFailure = statuses.includes('FAIL') || report.runs.some(r => r.pageErrors?.length || r.observerErrors?.length);
  const incomplete = infraErrors.length > 0 || statuses.length !== runsRequested || statuses.includes('INCOMPLETE') || !headed || process.env.RH_SHOWCASE_PROFILE_HEADLESS === '1';
  report.status = hasFailure ? 'FAIL' : incomplete ? 'INCOMPLETE' : 'PASS';
  report.displayProof = { eligible: !uncappedDiagnostic && report.status === 'PASS' && headed && report.runs.length === 3 && report.runs.every(r =>
    r.status === 'PASS' && r.canvasAfterMeasurement?.drawingBuffer?.width === 2560 && r.canvasAfterMeasurement?.drawingBuffer?.height === 1440 &&
    r.quality?.observedThroughUnityMarker?.quality === 'High' && r.quality?.observedThroughUnityMarker?.mode === 'Manual' &&
    r.browserWindow?.windowState === 'fullscreen' && r.browserWindow.width >= width && r.browserWindow.height >= height &&
    r.browserWindow.documentHasFocus === true && r.browser?.visibility === 'visible' && r.browser?.hasFocus === true) && nativeDisplayMatch,
    reason: uncappedDiagnostic ? 'Uncapped diagnostic flags disable normal display pacing; this run only measures submission headroom.'
      : report.browser?.headless ? 'Headless capture is diagnostic only, not display proof.' : !nativeDisplayMatch
      ? `Host-reported main display does not match the requested native ${width}x${height} at >=144Hz mode (${mainDisplay?.mode || physicalDisplays.status}).`
      : null };
  report.output = path.join(output, 'showcase-profile.json');
  fs.writeFileSync(report.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, displayProof: report.displayProof, output: report.output,
    runs: report.runs.map(run => ({ id: run.id, status: run.status, liveSeconds: run.liveWindow?.observedSeconds,
      backbuffer: run.canvasAfterMeasurement?.drawingBuffer, quality: run.quality?.observedThroughUnityMarker })) }, null, 2));
  process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2;
})().catch(e => { console.error(safeError(e)); process.exitCode = 1; });
