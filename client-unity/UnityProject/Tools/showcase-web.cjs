// Functional proof of the real Unity showcase Web player. Observe wire facts; drive only canvas UI/keyboard/mouse.
// Serve Build/Web + the ordinary first-playable server before running. No synthetic socket inputs or Sim access.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { evaluateShowcaseProof } = require('./showcase-contract.cjs');
const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
let chromium, playwrightLoadError;
try { ({ chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'))); }
catch (e) { playwrightLoadError = e.message; }
const root = path.resolve(__dirname, '../../..');
const out = process.env.RH_UNITY_SHOWCASE_OUTPUT || process.env.RH_UNITY_PLAYABLE_OUTPUT || path.join(prefix, 'unity-showcase');
const buildManifestPath = process.env.RH_SHOWCASE_BUILD_MANIFEST || path.join(os.homedir(), '.codex/tools/rougehalla-unity-art/evidence/build-manifest.json');
const buildManifestRaw = fs.readFileSync(buildManifestPath);
const buildManifest = JSON.parse(buildManifestRaw.toString('utf8'));
if (!buildManifest.runtimeRevision || buildManifest.protocol !== 11) throw Error('Build manifest is missing runtime revision or protocol v11');
const runtimeIdentity = { manifestPath: buildManifestPath, manifestSha256: crypto.createHash('sha256').update(buildManifestRaw).digest('hex'),
  runtimeRevision: buildManifest.runtimeRevision, baseGameplayRevision: buildManifest.baseGameplayRevision,
  unity: buildManifest.unity, urp: buildManifest.urp, protocol: buildManifest.protocol,
  contentHash: buildManifest.contentHash, totalBytes: buildManifest.totalBytes };
const server = process.env.RH_UNITY_SHOWCASE_SERVER || process.env.RH_UNITY_PLAYABLE_SERVER || 'ws://127.0.0.1:18797/ws';
const url = new URL(process.env.RH_UNITY_SHOWCASE_URL || process.env.RH_UNITY_PLAYABLE_URL || 'http://127.0.0.1:18897/');
url.searchParams.delete('profile'); url.searchParams.delete('auto');
// A packaged staging player supplies its own same-origin WSS default; exercise an ordinary bare visit too.
if (server === 'same-origin') url.searchParams.delete('server');
else url.searchParams.set('server', server);
const nickname = process.env.RH_UNITY_SHOWCASE_NICKNAME || process.env.RH_UNITY_PLAYABLE_NICKNAME || `art${Date.now().toString(36)}`;
const resultWait = Math.min(300000, Math.max(0, Number(process.env.RH_UNITY_SHOWCASE_RESULT_WAIT_MS || process.env.RH_UNITY_PLAYABLE_RESULT_WAIT_MS || 300000)));
const displayedUrl = new URL(url); if (displayedUrl.searchParams.has('token')) displayedUrl.searchParams.set('token', '[redacted]');
const knownSecret = url.searchParams.get('token');
const redact = value => { let s = String(value); if (knownSecret) s = s.split(knownSecret).join('[redacted]'); return s.replace(/([?&](?:token|resume|ticket|session)=)[^&\s]+/gi, '$1[redacted]'); };
const html = fs.readFileSync(path.join(root, 'crates/rh-server/web/probe.html'), 'utf8');
// The typed source-map metadata hash and Welcome collision-grid hash have different domains.
// Independently derive the expected public MapBlob identity from its dimensions + collision bytes.
const mapProfile = JSON.parse(fs.readFileSync(path.join(root, 'maps/first-playable.json'), 'utf8'));
const expectedGrid = mapProfile.map;
let collisionHash = 0x811c9dc5;
for (const byte of [...[expectedGrid.w, expectedGrid.h].flatMap(v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]), ...expectedGrid.tiles]) {
  collisionHash = Math.imul(collisionHash ^ byte, 0x01000193) >>> 0;
}
const expectedMap = { sourceProfile: 'maps/first-playable.json', typedSourceMetadataHash: mapProfile.legacyMapHashU32.toString(16).padStart(8, '0'), width: expectedGrid.w, height: expectedGrid.h, collisionHash, collisionHex: collisionHash.toString(16).padStart(8, '0') };
const decoder = html.slice(html.search(/\/\/ ---- protocol v\d+/), html.indexOf('// ---- probe state'));
const { Tracker, decode, decodeClient } = new Function(decoder + ';return {Tracker,decode,decodeClient}')();
const asBuffer = payload => { const bytes = typeof payload === 'string' ? Buffer.from(payload, 'base64') : payload; return Uint8Array.from(bytes).buffer; };
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const status = (state, details = {}) => ({ status: state, ...details });
fs.mkdirSync(out, { recursive: true });

(async () => {
  let browser, page, latest = null, collections = new Map(), publicCollisionGrid = null, welcomeCount = 0, leaving = false, maxVisibleMobs = 0;
  const commands = [], events = [], hellos = [], welcomes = [], stateKeys = new Set();
  const report = { timestamp: new Date().toISOString(), url: displayedUrl.toString(), runtime: runtimeIdentity, nickname, expectedMap, protocol: 11, checks: {}, console: [], pageErrors: [], observerErrors: [], rejects: [], frames: { sent: 0, received: 0, snapshots: 0 }, artifacts: [] };
  const failures = [];
  const check = (name, passed, details) => { report.checks[name] = status(passed ? 'pass' : 'fail', details); if (!passed) failures.push(name); };
  const wait = async (test, ms = 5000) => { const until = Date.now() + ms; do { if (test()) return true; await page.waitForTimeout(50); } while (Date.now() < until); return !!test(); };
  const snapshot = () => latest ? { tick: latest.tick, phase: latest.phase, me: copy(latest.me), actors: latest.actors.length, visibleMobs: latest.actors.filter(a => a.kind === 1).length } : null;
  const collection = key => copy(collections.get(key));
  const commandCount = kind => commands.filter(c => c.k === kind).length;
  const assert = (value, reason) => { if (!value) throw Error(reason); };
  const screenshot = async name => { const file = path.join(out, name + '.png'); await page.screenshot({ path: file }); report.artifacts.push(file); };
  const worldProp = row => ({ ...copy(row), rawPosition: { x: row.x, y: row.y }, x: row.x / 8, y: row.y / 8 });
  let box;
  // uGUI anchors use bottom-left; Playwright uses top-left. Nested coordinates come from MatchHud.cs.
  const point = (x, y, panel = [0, 0, 1, 1]) => ({ x: box.x + (panel[0] + x * (panel[2] - panel[0])) * box.width, y: box.y + (1 - panel[1] - y * (panel[3] - panel[1])) * box.height });
  const panelRect = panel => ({ x: box.x + panel[0] * box.width, y: box.y + (1 - panel[3]) * box.height, width: (panel[2] - panel[0]) * box.width, height: (panel[3] - panel[1]) * box.height });
  const click = async (x, y, panel) => { const p = point(x, y, panel); await page.mouse.click(p.x, p.y, { delay: 60 }); await page.waitForTimeout(150); };
  const key = async (name, duration = 70) => { await page.keyboard.down(name); await page.waitForTimeout(duration); await page.keyboard.up(name); };
  const rewardAttempts = [];
  const worldPoint = (x, y) => ({ x: x / 32, y: -y / 32 * .78 });
  const serverUnitsPerGridCell = 32; // Same server coordinate scale as ArenaView.WorldPoint.
  const publicGridPath = (start, goal) => {
    if (!publicCollisionGrid) return { path: null, reason: 'Welcome collision grid was not observed' };
    const { width, height, tiles } = publicCollisionGrid;
    const startCell = { x: Math.floor(start.x / serverUnitsPerGridCell), y: Math.floor(start.y / serverUnitsPerGridCell) };
    const goalCell = { x: Math.floor(goal.x / serverUnitsPerGridCell), y: Math.floor(goal.y / serverUnitsPerGridCell) };
    const inBounds = cell => cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height;
    if (!inBounds(goalCell)) return { path: null, reason: 'observed crate maps outside the Welcome collision grid', startCell, goalCell, grid: { width, height } };
    if (!inBounds(startCell)) return { path: null, reason: 'delivered self position maps outside the Welcome collision grid', startCell, goalCell, grid: { width, height } };
    const index = cell => cell.y * width + cell.x;
    const floor = cell => tiles[index(cell)] === 0;
    if (!floor(goalCell)) return { path: null, reason: 'observed crate maps to a blocked cell in the Welcome collision grid', startCell, goalCell, grid: { width, height } };
    const queue = [startCell], previous = new Map([[index(startCell), null]]), directions = [[1,0],[-1,0],[0,1],[0,-1]];
    for (let head = 0; head < queue.length && !previous.has(index(goalCell)); head++) {
      const cell = queue[head];
      for (const [dx, dy] of directions) {
        const next = { x: cell.x + dx, y: cell.y + dy }, key = index(next);
        if (inBounds(next) && floor(next) && !previous.has(key)) { previous.set(key, { cell, direction: [dx,dy] }); queue.push(next); }
      }
    }
    if (!previous.has(index(goalCell))) return { path: null, reason: 'no floor route in the Welcome collision grid', startCell, goalCell, grid: { width, height } };
    const cells = [goalCell];
    let cursor = goalCell;
    while (index(cursor) !== index(startCell)) { cursor = previous.get(index(cursor)).cell; cells.push(cursor); }
    cells.reverse();
    return { path: cells, startCell, goalCell, grid: { width, height } };
  };
  // Match ArenaView + Bootstrap: the live camera follows the last server-delivered self position,
  // at world Y + 1.5, orthographic size 9. Convert an observed world point back to canvas pixels.
  const observedPointer = (x, y) => {
    assert(latest?.me && Number.isFinite(x) && Number.isFinite(y), 'No delivered actor position for world pointer');
    const camera = worldPoint(latest.me.x, latest.me.y), target = worldPoint(x, y);
    const aspect = box.width / box.height;
    const dx = target.x - camera.x, dy = target.y - (camera.y + 1.5);
    return { x: box.x + (.5 + dx / (18 * aspect)) * box.width, y: box.y + (.5 - dy / 18) * box.height };
  };
  const moveToObservedActor = async actor => { const p = observedPointer(actor.x, actor.y); await page.mouse.move(p.x, p.y); };
  const worldGroundPointer = (screenY = .55) => {
    assert(latest?.me, 'No delivered self position for a clear world aim point');
    const me = worldPoint(latest.me.x, latest.me.y), cameraY = me.y + 1.5;
    const targetWorldY = cameraY + (.5 - screenY) * 18;
    const targetServerY = -targetWorldY * 32 / .78;
    return observedPointer(latest.me.x, targetServerY);
  };
  const clearWorldPointer = async () => {
    const p = worldGroundPointer(.55);
    await page.mouse.move(p.x, p.y);
    return p;
  };
  const holdKeys = async (names, durationMs) => {
    for (const name of names) await page.keyboard.down(name);
    try { await page.waitForTimeout(durationMs); }
    finally { for (const name of names) await page.keyboard.up(name); }
  };
  const pickAvailableReward = async () => {
    const chests = collection(4) || [];
    const index = chests.findIndex(c => c.canChoose && !c.picked && c.options.some(o => !o.taken));
    if (index < 0) return false;
    const rewards = [.59, .34, .98, .86], chest = chests[index];
    const pick = chest.options.findIndex(o => !o.taken), count = commandCount('choose'), before = collection(5);
    for (let i = 0; i < index; i++) await click(.725, .12, rewards);
    await click(.5, .67 - pick * .18, rewards);
    await wait(() => commandCount('choose') > count, 2500);
    await wait(() => JSON.stringify(collection(5)) !== JSON.stringify(before), 2500);
    const sent = commands.filter(c => c.k === 'choose').slice(count);
    const passed = sent.some(c => c.handle === chest.handle && c.pick === pick) && JSON.stringify(collection(5)) !== JSON.stringify(before);
    const attempt = { issuedChest: chest, pick, before, after: collection(5), sent, passed };
    rewardAttempts.push(attempt);
    if (passed) { check('rewardChoice', true, attempt); await screenshot('showcase-reward'); }
    return passed;
  };
  const openObservedCrates = async () => {
    const startedAt = Date.now(), deadline = startedAt + 18000, opened = [], moves = [], failures = [], blockedCrates = new Set();
    const crateKey = row => `${row.x},${row.y}`;
    const unopened = () => (collection(2)?.rows || []).filter(row => row.kind === 2 && !row.open && Number.isFinite(row.x) && Number.isFinite(row.y)).map(worldProp);
    const initial = copy(unopened());
    while (Date.now() < deadline && opened.length < 3 && latest?.phase === 1 && latest?.me?.status === 1) {
      if (await pickAvailableReward()) return { initial, opened, moves, failures, durationMs: Date.now() - startedAt, rewardChosen: true };
      const candidates = unopened();
      if (!candidates.length) break;
      const props = collection(2), focused = props?.focus && props.rows?.find(row => row.handle === props.focus.handle);
      const focusCandidate = candidates.find(row => row.handle === focused?.handle) || null;
      const target = focusCandidate ? { row: focusCandidate, distance: Math.hypot(focusCandidate.x - latest.me.x, focusCandidate.y - latest.me.y) }
        : candidates.filter(row => !blockedCrates.has(crateKey(row))).map(row => ({ row, distance: Math.hypot(row.x - latest.me.x, row.y - latest.me.y) }))
          .sort((a, b) => a.distance - b.distance)[0];
      if (!target) break;
      if (focusCandidate && focusCandidate.kind === 2 && !focusCandidate.open && target?.distance <= 56) {
        const before = worldProp(focused), beforeTick = latest.tick, beforeChests = collection(4) || [], count = commandCount('pickup');
        await clearWorldPointer(); await key('f');
        await wait(() => commands.slice(count).some(command => command.k === 'pickup' && command.handle === focused.handle), 2500);
        await wait(() => latest?.tick >= beforeTick + 2 || collection(4)?.some(chest => chest.canChoose), 1800);
        // Prop handles are observer-local and can be reissued on the next state snapshot. Match
        // the same publicly observed prop by its stable world position and kind for the result.
        const afterRaw = collection(2)?.rows?.find(row => row.kind === 2 && row.x === focused.x && row.y === focused.y) || null;
        const after = afterRaw ? worldProp(afterRaw) : null;
        const sent = commands.filter(command => command.k === 'pickup').slice(count);
        const rewardChests = collection(4) || [];
        const rewardStateChanged = JSON.stringify(rewardChests) !== JSON.stringify(beforeChests);
        const openedByServer = sent.some(command => command.handle === focused.handle) && (after?.open === true || rewardStateChanged);
        opened.push({ prop: before, beforeTick, afterTick: latest?.tick, after, sent, rewardChests: copy(rewardChests), openedByServer });
        if (await pickAvailableReward()) return { initial, opened, moves, failures, durationMs: Date.now() - startedAt, rewardChosen: true };
        if (!openedByServer) failures.push({ handle: focused.handle, reason: 'ordinary focused F produced no server-observed crate-open or reward-state change' });
        continue;
      }
      if (target.distance <= 56 && focused?.handle !== target.row.handle) {
        failures.push({ handle: target.row.handle, distance: target.distance, focused: focused || null, reason: 'within 56 units but server did not focus this unopened crate (likely blocked LOS)' });
        // Try another publicly observed unopened crate; never bypass the server's focus/LOS rule.
        blockedCrates.add(crateKey(target.row));
        continue;
      }
      const route = publicGridPath(latest.me, target.row);
      if (!route.path) {
        failures.push({ prop: copy(target.row), route, reason: 'no legal route using the delivered collision grid; direct handle pickup is intentionally not attempted' });
        blockedCrates.add(crateKey(target.row));
        continue;
      }
      const nextCell = route.path[1] || route.path[0];
      const dx = nextCell.x - route.startCell.x, dy = nextCell.y - route.startCell.y;
      if (dx === 0 && dy === 0) {
        failures.push({ prop: copy(target.row), route, reason: 'self and crate share a grid cell but server focus does not permit ordinary pickup' });
        blockedCrates.add(crateKey(target.row));
        continue;
      }
      const keyName = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'd' : 'a') : (dy >= 0 ? 's' : 'w');
      const before = { tick: latest.tick, self: { x: latest.me.x, y: latest.me.y }, target: copy(target.row), distance: target.distance,
        route: { startCell: route.startCell, nextCell, goalCell: route.goalCell, totalCells: route.path.length } };
      // Keep a single step under one grid cell (32 units) so recomputing a BFS step cannot
      // overshoot a one-cell corridor and oscillate across the same cell boundary.
      await clearWorldPointer(); await holdKeys([keyName], 100); await wait(() => latest?.tick > before.tick, 1200);
      moves.push({ key: keyName, before, after: { tick: latest?.tick, self: copy(latest?.me), focus: copy(collection(2)?.focus) } });
    }
    return { initial, opened, moves, failures, durationMs: Date.now() - startedAt, rewardChosen: false,
      remainingUnopened: copy(unopened()), issuedChests: copy(collection(4) || []) };
  };
  try {
    if (!chromium) throw Error('Playwright unavailable: ' + (playwrightLoadError || 'Chromium module did not export chromium'));
    browser = await chromium.launch({ headless: (process.env.RH_UNITY_SHOWCASE_HEADED || process.env.RH_UNITY_PLAYABLE_HEADED) !== '1' });
    report.browser = await browser.version();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: process.env.RH_UNITY_SMOKE_ALLOW_SELF_SIGNED === '1' });
    page.on('console', m => { if (report.console.length < 500) report.console.push({ type: m.type(), text: redact(m.text()) }); });
    page.on('pageerror', e => report.pageErrors.push(redact(e)));
    page.on('dialog', async dialog => { report.pageErrors.push('Unexpected browser dialog: ' + redact(dialog.message())); await dialog.dismiss(); });
    // Retain actual game-created sockets solely to close one for the reconnect test. Never send from this hook.
    await page.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      window.__rhProofSockets = [];
      window.WebSocket = new Proxy(NativeWebSocket, { construct(target, args) { const socket = Reflect.construct(target, args); window.__rhProofSockets.push(socket); return socket; } });
      // Observe Unity's actual browser audio context without creating or resuming one ourselves.
      // The settings clicks/drag below are real browser input; this records whether Unity's
      // resulting audio path is unlocked by that gesture rather than inferring it from volume UI.
      window.__rhAudioContexts = []; window.__rhAudioStateChanges = [];
      const wrapAudioCtor = key => {
        const NativeAudio = window[key];
        if (!NativeAudio || NativeAudio.__rhProofWrapped) return;
        const WrappedAudio = new Proxy(NativeAudio, { construct(target, args, newTarget) {
          const context = Reflect.construct(target, args, newTarget);
          window.__rhAudioContexts.push(context);
          context.addEventListener('statechange', () => window.__rhAudioStateChanges.push({ state: context.state, at: performance.now() }));
          return context;
        }});
        Object.defineProperty(WrappedAudio, '__rhProofWrapped', { value: true });
        window[key] = WrappedAudio;
      };
      wrapAudioCtor('AudioContext');
      if (window.webkitAudioContext !== window.AudioContext) wrapAudioCtor('webkitAudioContext');
    });
    page.on('websocket', ws => {
      const tracker = new Tracker();
      ws.on('framesent', f => {
        report.frames.sent++;
        try {
          const m = decodeClient(asBuffer(f.payload));
          if (m.t === 'hello') hellos.push({ protocol: m.protocol, profile: m.profile, faction: m.faction, resumed: m.resume !== null, at: Date.now() });
          if (m.t === 'input') for (const c of m.cmds) commands.push({ ...c, inputSeq: m.seq, at: Date.now() });
        } catch (e) { report.observerErrors.push('client decoder: ' + redact(e)); }
      });
      ws.on('framereceived', f => {
        report.frames.received++;
        try {
          const m = decode(asBuffer(f.payload));
          if (m.t === 'welcome') {
            welcomeCount++;
            publicCollisionGrid = { width: m.map.w, height: m.map.h, tiles: Array.from(m.map.tiles) };
            welcomes.push({ player: m.player, protocol: m.protocol, map: { width: m.map.w, height: m.map.h, hash: m.map.hash, hex: m.map.hash.toString(16).padStart(8, '0'), exactCollisionGrid: m.map.w === expectedGrid.w && m.map.h === expectedGrid.h && m.map.tiles.length === expectedGrid.tiles.length && m.map.tiles.every((v, i) => v === expectedGrid.tiles[i]) }, at: Date.now() });
          }
          const applied = tracker.apply(m);
          if (m.t === 'state') { for (const item of m.items) stateKeys.add(item.key); collections = tracker.collections; }
          if (applied?.t === 'snapshot') { latest = applied; report.frames.snapshots++; maxVisibleMobs = Math.max(maxVisibleMobs, latest.actors.filter(a => a.kind === 1).length); }
          if (m.t === 'events') for (const event of m.events) events.push({ ...event, tick: m.tick, at: Date.now() });
          if (m.t === 'reject') { report.rejects.push({ code: m.code, reason: redact(m.reason), duringLeave: leaving, at: Date.now() }); if (!(leaving && m.reason === 'closed')) failures.push('server rejected: ' + redact(m.reason)); }
        } catch (e) { report.observerErrors.push('server decoder: ' + redact(e)); }
      });
    });
    await page.goto(url.toString());
    await page.locator('#unity-loading-bar').waitFor({ state: 'hidden', timeout: 120000 });
    // Unity hides the HTML loading bar before its mandatory splash finishes. Allow the actual menu to render.
    await page.waitForTimeout(5000);
    box = await page.locator('#unity-canvas').boundingBox(); assert(box && box.width > 0, 'Unity canvas missing');
    report.canvas = box;
    check('menuNoSocketBeforeJoin', hellos.length === 0 && report.frames.sent === 0 && await page.evaluate(() => window.__rhProofSockets.length === 0), { socketCount: await page.evaluate(() => window.__rhProofSockets.length) });
    await screenshot('showcase-menu');
    // Exercise real presentation settings while the join menu is open. A changed capture of the
    // Unity canvas panel proves that each click reached a visible setting control.
    const settings = [.22, .20, .78, .82];
    const captureSettings = async name => {
      const file = path.join(out, `settings-${name}.png`);
      const image = await page.screenshot({ path: file, clip: panelRect(settings) });
      report.artifacts.push(file); return image;
    };
    await click(.75, .96);
    let settingsBefore = await page.evaluate(() => window.__rhShowcaseSettings);
    let controlBefore = await captureSettings('quality-before');
    await click(.50, .74, settings);
    await page.waitForTimeout(250);
    let controlAfter = await captureSettings('quality-after');
    let settingsAfter = await page.evaluate(() => window.__rhShowcaseSettings);
    check('settingsQualityClickable', settingsAfter?.mode === 'Manual' && settingsAfter?.quality === 'High', { before: settingsBefore, after: settingsAfter });
    settingsBefore = settingsAfter;
    controlBefore = await captureSettings('motion-before');
    await click(.50, .63, settings);
    await page.waitForTimeout(250);
    controlAfter = await captureSettings('motion-after');
    settingsAfter = await page.evaluate(() => window.__rhShowcaseSettings);
    check('settingsReducedMotionClickable', settingsAfter?.reducedMotion !== settingsBefore?.reducedMotion && typeof settingsAfter?.reducedMotion === 'boolean', { before: settingsBefore, after: settingsAfter });
    controlBefore = await captureSettings('music-before');
    const audioBefore = await page.evaluate(() => (window.__rhAudioContexts || []).map(context => ({ state: context.state,
      currentTime: context.currentTime, sampleRate: context.sampleRate, maxChannelCount: context.destination?.maxChannelCount ?? null })));
    // Music slider spans x=.36..76 and y=.37..435 in MatchHud; select its minimum (mute).
    const sliderStart = point(.55, .4025, settings), sliderEnd = point(.33, .4025, settings);
    await page.mouse.move(sliderStart.x, sliderStart.y); await page.mouse.down();
    await page.mouse.move(sliderEnd.x, sliderEnd.y, {steps: 8}); await page.mouse.up();
    await page.waitForTimeout(250);
    controlAfter = await captureSettings('music-after');
    settingsAfter = await page.evaluate(() => window.__rhShowcaseSettings);
    check('settingsMusicMuteClickable', settingsAfter?.musicVolume === 0, { after: settingsAfter, requestedVolume: 0 });
    const audioAfter = await page.evaluate(() => ({ contexts: (window.__rhAudioContexts || []).map(context => ({ state: context.state,
      currentTime: context.currentTime, sampleRate: context.sampleRate, maxChannelCount: context.destination?.maxChannelCount ?? null })),
      stateChanges: window.__rhAudioStateChanges || [] }));
    report.audioOutput = { interaction: 'actual canvas settings clicks and music-slider drag', before: audioBefore,
      after: audioAfter.contexts, stateChanges: audioAfter.stateChanges,
      unlocked: audioAfter.contexts.some(context => context.state === 'running' && context.currentTime > 0),
      preferenceMarkerVolume: settingsAfter?.musicVolume ?? null,
      note: 'Unity AudioContext state/currentTime are observed; the harness does not synthesize audio or call resume().' };
    await click(.75, .96);
    const menu = [.22, .25, .78, .82];
    await click(.5, .56, menu); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(nickname, { delay: 35 });
    await screenshot('showcase-nickname');
    // Select Holy (faction 4) with a real canvas click, then use the visible Join button.
    await click(.88, .255, menu); await click(.5, .095, menu);
    assert(await wait(() => latest?.me && stateKeys.size === 9, 30000), 'No Unity admission/self/all-nine-State response after menu Join');
    check('menuJoin', hellos[0]?.protocol === 11 && welcomes[0]?.protocol === 11 && hellos[0]?.profile === nickname && hellos[0]?.faction === 4, { expectedProtocol: 11, hello: hellos[0], welcome: welcomes[0] });
    check('mapAndCollections', welcomes[0]?.map.hash === expectedMap.collisionHash && welcomes[0]?.map.exactCollisionGrid && stateKeys.size === 9 && [1,2,3,4,5,6,7,8,9].every(key => stateKeys.has(key)), { keys: [...stateKeys].sort((a,b)=>a-b), inventory: collection(1), props: collection(2), unopenedChestProps: (collection(2)?.rows || []).filter(row => row.kind === 2 && !row.open), typedUnopenedChestProps: (collection(2)?.rows || []).filter(row => row.kind === 2 && !row.open).map(worldProp), rewardChests: collection(4) || [], build: collection(5), camps: collection(6), plan: collection(8), arena: collection(9), snapshot: snapshot() });
    await screenshot('showcase-hud');
    assert(await wait(() => latest?.phase === 1 && latest?.me?.status === 1, 30000), 'No authoritative active/alive phase before gameplay input');
    await screenshot('showcase-active');
    // Pointer uses a position from the latest delivered server snapshot, transformed through
    // ArenaView.WorldPoint and the Bootstrap orthographic camera, never an assumed 3D pitch.
    await moveToObservedActor(latest.me);
    const focus = collection(2)?.focus;
    if (focus) {
      const before = { inventory: collection(1), props: collection(2) }, count = commandCount('pickup'), eventIndex = events.length;
      await key('f'); await wait(() => commandCount('pickup') > count); await page.waitForTimeout(800);
      const sent = commands.filter(c => c.k === 'pickup').slice(count);
      const after = { inventory: collection(1), props: collection(2) }, response = events.slice(eventIndex).filter(e => ['pickupRefused', 'potionNotice'].includes(e.k));
      check('focusedPickupInput', sent.some(c => c.handle === focus.handle), { before, after, sent, response, stateChanged: JSON.stringify(before) !== JSON.stringify(after) });
      report.checks.pickupOutcome = status(response.some(e => e.k === 'pickupRefused') ? 'server-refused' : JSON.stringify(before) !== JSON.stringify(after) ? 'changed' : 'unexercised', { note: 'Only server-observed changes/refusals are recorded; no acquisition inferred.' });
    } else report.checks.focusedPickupInput = status('unexercised', { reason: 'Server supplied no focus at initial spawn.' });
    await moveToObservedActor(latest.me);
    {
      const count = commandCount('useConsumable'), eventIndex = events.length, before = snapshot();
      await key('e'); await wait(() => commandCount('useConsumable') > count); await wait(() => events.slice(eventIndex).some(e => e.k === 'potionNotice'));
      check('potionInputAndNotice', commandCount('useConsumable') > count && events.slice(eventIndex).some(e => e.k === 'potionNotice'), { before, after: snapshot(), notices: events.slice(eventIndex).filter(e => e.k === 'potionNotice') });
      // The chest interaction may move focus onto a nearby ground weapon. Exercise that delivered
      // focus while it is current; later movement would correctly clear it.
      const props = collection(2), focus = props?.focus, focusedRow = focus && props.rows?.find(row => row.handle === focus.handle);
      if (focusedRow?.kind === 1) {
        const inventoryBefore = collection(1), pickupBefore = commandCount('pickup');
        await clearWorldPointer(); await key('f');
        await wait(() => commandCount('pickup') > pickupBefore || JSON.stringify(collection(1)) !== JSON.stringify(inventoryBefore), 2500);
        const inventoryAfter = collection(1), sent = commands.filter(c => c.k === 'pickup').slice(pickupBefore);
        report.weaponPickup = { focusedProp: focusedRow, before: inventoryBefore, after: inventoryAfter, sent,
          confirmed: sent.some(command => command.handle === focusedRow.handle) && JSON.stringify(inventoryAfter) !== JSON.stringify(inventoryBefore) };
      } else report.weaponPickup = { result: 'no server-delivered ground weapon focus after the chest pickup', focused: focus || null };
    }
    {
      const start = commands.length;
      await click(.30, .85, [.02, .02, .98, .23]); // non-button HP area on the actual HUD panel
      await page.waitForTimeout(300);
      const unintended = commands.slice(start).filter(c => ['attack', 'target', 'move', 'attackMove'].includes(c.k));
      check('hudBlocksWorldClick', unintended.length === 0, { unintended });
      // Reset the pointer into unobstructed world space before all subsequent keyboard input.
      const point = await clearWorldPointer(), worldStart = commands.length;
      await page.mouse.down(); await page.waitForTimeout(160); await page.mouse.up();
      await wait(() => commands.slice(worldStart).some(c => c.k === 'attack') && commands.slice(worldStart).some(c => c.k === 'release'), 2500);
      const sent = commands.slice(worldStart).filter(c => ['attack', 'release', 'target'].includes(c.k));
      check('worldAttackClick', sent.some(c => c.k === 'attack') && sent.some(c => c.k === 'release'),
        { source: 'empty ground point derived from latest delivered self position and live camera', pointer: point, sent });
    }
    {
      const count = commandCount('swap'), before = collection(1);
      await clearWorldPointer(); await key('2'); await wait(() => commandCount('swap') > count); await page.waitForTimeout(350);
      check('swapInput', commands.filter(c => c.k === 'swap').slice(count).some(c => c.slot === 1), { before, after: collection(1) });
      // The slot-input proof above may select an empty slot. Restore an equipped weapon through
      // the same ordinary slot keys, based on the latest authoritative inventory collection.
      const inventory = collection(1), usableSlot = inventory?.slots?.findIndex(slot => slot != null);
      if (usableSlot >= 0 && inventory.activeSlot !== usableSlot) {
        const restoreCount = commandCount('swap'); await clearWorldPointer(); await key(String(usableSlot + 1));
        await wait(() => commandCount('swap') > restoreCount && collection(1)?.activeSlot === usableSlot, 2000);
        report.weaponRestore = { selectedSlot: usableSlot, inventory: collection(1), sent: commands.filter(c => c.k === 'swap').slice(restoreCount) };
      } else report.weaponRestore = { result: 'no nonempty weapon slot available', inventory };
    }
    {
      const count = commandCount('move'), before = snapshot();
      await clearWorldPointer(); await key('d', 650); await page.waitForTimeout(500);
      if (latest?.me && latest.me.x === before.me.x && latest.me.y === before.me.y) { await clearWorldPointer(); await key('s', 650); await page.waitForTimeout(500); }
      const after = snapshot(), sent = commands.filter(c => c.k === 'move').slice(count);
      check('movement', sent.length > 0 && after?.me && after.me.moveSeq !== before.me.moveSeq && (after.me.x !== before.me.x || after.me.y !== before.me.y), { before, after, sent });
    }
    report.crateLoot = await openObservedCrates();
    {
      const combat = { durationLimitMs: 24000, startedAt: Date.now(), actions: [],
        mobHpDecreaseObservations: 0, campStateObservations: [], rewardAttempts };
      const liveWorldTop = box.y + .77 * box.height;
      const endAt = Date.now() + combat.durationLimitMs;
      while (Date.now() < endAt && latest?.phase === 1 && latest?.me?.status === 1) {
        // Choosing a reward proves that UI flow; keep exercising ordinary live combat afterward.
        // Attempt another reward only if no authoritative build change has confirmed a choice yet.
        if (report.checks.rewardChoice?.status !== 'pass') await pickAvailableReward();
        const target = (latest.actors || []).filter(actor => actor.kind === 1 && actor.status === 1 && Number.isFinite(actor.x) && Number.isFinite(actor.y))
          .reduce((best, actor) => {
            const distance = Math.hypot(actor.x - latest.me.x, actor.y - latest.me.y);
            return !best || distance < best.distance ? { actor, distance } : best;
          }, null);
        const camps = copy(collection(6) || []), lastCampState = combat.campStateObservations.at(-1)?.camps;
        if (!lastCampState || JSON.stringify(camps) !== JSON.stringify(lastCampState)) {
          combat.campStateObservations.push({ tick: latest.tick, camps });
        }
        if (!target) { await page.waitForTimeout(250); continue; }
        const actor = target.actor, actorPoint = observedPointer(actor.x, actor.y);
        const before = { tick: latest.tick, self: { x: latest.me.x, y: latest.me.y }, actor: copy(actor), distance: target.distance };
        // Approach with ordinary WASD whenever the delivered mob is distant or still under the HUD.
        if (target.distance > 36 || actorPoint.y >= liveWorldTop || actorPoint.x < box.x || actorPoint.x > box.x + box.width) {
          const dx = actor.x - latest.me.x, dy = actor.y - latest.me.y;
          const keyName = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'd' : 'a') : (dy >= 0 ? 's' : 'w');
          await clearWorldPointer(); await holdKeys([keyName], 160);
          await wait(() => latest?.tick > before.tick, 1200);
          combat.actions.push({ type: 'WASD-approach', key: keyName, before, after: snapshot() });
          continue;
        }
        const selfPoint = observedPointer(latest.me.x, latest.me.y);
        const aimDx = actorPoint.x - selfPoint.x, aimDy = actorPoint.y - selfPoint.y, aimLength = Math.hypot(aimDx, aimDy) || 1;
        // Aim 28 px beyond the delivered actor center so the Wand cursor hit-test doesn't replace
        // the ordinary attack with a target-selection click; the aim angle still points at that mob.
        const aimCandidates = [1, -1].map(direction => ({
          x: actorPoint.x + aimDx / aimLength * 28 * direction,
          y: actorPoint.y + aimDy / aimLength * 28 * direction,
        })).filter(point => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y < liveWorldTop &&
          Math.hypot(point.x - actorPoint.x, point.y - actorPoint.y) > 22);
        const aimPoint = aimCandidates[0];
        if (!aimPoint) {
          await clearWorldPointer(); await page.waitForTimeout(200); continue;
        }
        const attackStart = commands.length, oldHp = actor.hpPct;
        await page.mouse.move(aimPoint.x, aimPoint.y); await page.mouse.down();
        try { await page.waitForTimeout(160); } finally { await page.mouse.up(); }
        await wait(() => latest?.tick > before.tick, 1200);
        const afterActor = latest?.actors?.find(candidate => candidate.id === actor.id) || null;
        // Actor IDs are snapshot observer references and renew; only compare HP when the same
        // delivered reference remains present. A missing ID is not proof of death or respawn.
        if (afterActor && Number.isFinite(oldHp) && Number.isFinite(afterActor.hpPct) && afterActor.hpPct < oldHp) combat.mobHpDecreaseObservations++;
        combat.actions.push({ type: 'mouse-attack', targetObserved: { id: actor.id, x: actor.x, y: actor.y, hpPct: oldHp }, aimPoint,
          sent: commands.slice(attackStart).filter(command => ['attack', 'release', 'target'].includes(command.k)), after: afterActor });
        await clearWorldPointer();
      }
      combat.durationMs = Date.now() - combat.startedAt;
      combat.terminal = { phase: latest?.phase ?? null, status: latest?.me?.status ?? null, snapshot: snapshot(), issuedChests: collection(4) || [] };
      report.combat = combat;
      if (report.checks.rewardChoice?.status !== 'pass') {
        if (rewardAttempts.length) check('rewardChoice', false, { reason: 'A server-issued choice was clicked, but no authoritative build update confirmed the selection.',
          attempts: rewardAttempts, finalBuild: collection(5), combat });
        else report.checks.rewardChoice = status('unexercised', { reason: 'No server-issued CanChoose chest became available during the bounded ordinary-input combat window.',
          issuedChests: collection(4) || [], combat });
      }
    }
    {
      const welcomeBefore = welcomeCount, snapshotBefore = report.frames.snapshots, player = welcomes.at(-1)?.player;
      const closed = await page.evaluate(() => { const socket = window.__rhProofSockets.findLast(s => s.readyState === WebSocket.OPEN); if (!socket) return false; socket.close(1000, 'UI reconnect proof'); return true; });
      await page.waitForTimeout(200); await screenshot('showcase-reconnecting');
      await wait(() => welcomeCount > welcomeBefore && report.frames.snapshots > snapshotBefore + 1, 20000);
      check('reconnect', closed && welcomeCount > welcomeBefore && hellos.at(-1)?.resumed && welcomes.at(-1)?.player === player, { welcomeBefore, welcomeAfter: welcomeCount, latestHello: hellos.at(-1), latestWelcome: welcomes.at(-1), after: snapshot() });
      await screenshot('showcase-resumed');
    }
    if (resultWait > 0) await wait(() => events.some(e => e.k === 'result'), resultWait);
    const result = events.find(e => e.k === 'result');
    if (result) { report.checks.results = status('pass', { result }); await page.waitForTimeout(250); await screenshot('showcase-results'); }
    else report.checks.results = status('unexercised', { reason: `No authoritative result during ordinary run within ${resultWait}ms observation bound.` });
    leaving = true;
    await click(.905, .96); // top-level Leave / menu, even if a result panel is present
    await page.waitForTimeout(350); await screenshot('showcase-returned-menu');
    const joinBefore = welcomeCount; leaving = false;
    await click(.5, .095, menu);
    await wait(() => welcomeCount > joinBefore, 15000);
    check('leaveAndRejoin', welcomeCount > joinBefore && hellos.at(-1)?.resumed === false, { latestHello: hellos.at(-1), latestWelcome: welcomes.at(-1) });
    await screenshot('showcase-rejoined');
    leaving = true;
    await click(.905, .96);
  } catch (e) {
    const message = redact(e);
    const launchUnavailable = !browser && /Playwright unavailable|launch|executable|browser/i.test(message);
    const webUnavailable = /net::ERR_(?:CONNECTION_REFUSED|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE)|Timeout[\s\S]*unity-loading-bar|Unity canvas missing/i.test(message);
    const socketUnavailable = page && !welcomeCount && report.frames.received === 0 && await page.evaluate(() => (window.__rhProofSockets || []).length > 0).catch(() => false);
    if (launchUnavailable || webUnavailable || socketUnavailable) {
      report.environmentUnavailable = message;
      report.environmentStatus = 'INCOMPLETE';
    } else { report.failure = message; failures.push(message); }
    if (page) try { await screenshot('showcase-failure'); } catch {}
  }
  finally {
    // Staged art is an independent, non-game preview. Its screenshot is never used as live-game proof.
    // Run it in a distinct page with join parameters removed and assert it creates no socket.
    if (browser) {
      let previewPage;
      try {
        const previewUrl = new URL(url); previewUrl.searchParams.delete('server'); previewUrl.searchParams.delete('profile'); previewUrl.searchParams.delete('auto'); previewUrl.searchParams.delete('token'); previewUrl.searchParams.set('preview', '1');
        previewPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await previewPage.addInitScript(() => {
          const NativeWebSocket = window.WebSocket; window.__rhPreviewSockets = 0;
          window.WebSocket = new Proxy(NativeWebSocket, { construct(target, args) { window.__rhPreviewSockets++; return Reflect.construct(target, args); } });
        });
        await previewPage.goto(previewUrl.toString());
        await previewPage.locator('#unity-loading-bar').waitFor({ state: 'hidden', timeout: 120000 });
        await previewPage.waitForTimeout(5000);
        const previewFile = path.join(out, 'showcase-preview-study.png');
        await previewPage.screenshot({ path: previewFile }); report.artifacts.push(previewFile);
        const socketCount = await previewPage.evaluate(() => window.__rhPreviewSockets);
        report.previewStudy = { mode: 'staged-art-only', url: previewUrl.toString(), socketCount, screenshot: previewFile };
        check('separatePreviewScreenshot', socketCount === 0, report.previewStudy);
      } catch (e) {
        report.previewStudy = { mode: 'staged-art-only', error: redact(e) };
        report.checks.separatePreviewScreenshot = status('unexercised', report.previewStudy);
      } finally { if (previewPage) await previewPage.close(); }
    }
    report.checks.visibleMobs = status(maxVisibleMobs > 0 ? 'pass' : 'unexercised', { maximumDeliveredVisibleMobs: maxVisibleMobs });
    report.commands = commands; report.events = events; report.hellos = hellos; report.welcomes = welcomes;
    report.failures = failures;
    const verdict = evaluateShowcaseProof(report);
    report.status = verdict.status; report.ok = verdict.ok;
    report.requiredChecks = verdict.requiredChecks; report.failedChecks = verdict.failedChecks;
    report.incompleteChecks = verdict.incompleteChecks; report.failureChannels = verdict.failureChannels;
    fs.writeFileSync(path.join(out, 'showcase-web.json'), JSON.stringify(report, null, 2) + '\n');
    if (browser) await browser.close();
    console.log(JSON.stringify({ status: report.status, ok: report.ok, checks: Object.fromEntries(Object.entries(report.checks).map(([name, value]) => [name, value.status])), incompleteChecks: verdict.incompleteChecks, failedChecks: verdict.failedChecks, failures, pageErrors: report.pageErrors, observerErrors: report.observerErrors, report: path.join(out, 'showcase-web.json') }, null, 2));
    process.exitCode = verdict.exitCode;
  }
})();
