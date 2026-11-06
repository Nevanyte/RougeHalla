// Functional proof of the real Unity Web player. Observe wire facts; drive only canvas UI/keyboard/mouse.
// Serve Build/Web + the ordinary first-playable server before running. No synthetic socket inputs or Sim access.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'));
const root = path.resolve(__dirname, '../../..');
const out = process.env.RH_UNITY_PLAYABLE_OUTPUT || path.join(prefix, 'unity-mvp');
const server = process.env.RH_UNITY_PLAYABLE_SERVER || 'ws://127.0.0.1:7787/ws';
const url = new URL(process.env.RH_UNITY_PLAYABLE_URL || 'http://127.0.0.1:8087/');
url.searchParams.delete('profile'); url.searchParams.delete('auto');
// A packaged staging player supplies its own same-origin WSS default; exercise an ordinary bare visit too.
if (server === 'same-origin') url.searchParams.delete('server');
else url.searchParams.set('server', server);
const nickname = process.env.RH_UNITY_PLAYABLE_NICKNAME || `unityUI${Date.now().toString(36)}`;
const resultWait = Math.min(90000, Math.max(0, Number(process.env.RH_UNITY_PLAYABLE_RESULT_WAIT_MS || 60000)));
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
  let browser, page, latest = null, collections = new Map(), welcomeCount = 0, leaving = false, maxVisibleMobs = 0;
  const commands = [], events = [], hellos = [], welcomes = [], stateKeys = new Set();
  const report = { timestamp: new Date().toISOString(), url: displayedUrl.toString(), nickname, expectedMap, checks: {}, console: [], pageErrors: [], observerErrors: [], rejects: [], frames: { sent: 0, received: 0, snapshots: 0 }, artifacts: [] };
  const failures = [];
  const check = (name, passed, details) => { report.checks[name] = status(passed ? 'pass' : 'fail', details); if (!passed) failures.push(name); };
  const wait = async (test, ms = 5000) => { const until = Date.now() + ms; do { if (test()) return true; await page.waitForTimeout(50); } while (Date.now() < until); return !!test(); };
  const snapshot = () => latest ? { tick: latest.tick, phase: latest.phase, me: copy(latest.me), actors: latest.actors.length, visibleMobs: latest.actors.filter(a => a.kind === 1).length } : null;
  const collection = key => copy(collections.get(key));
  const commandCount = kind => commands.filter(c => c.k === kind).length;
  const assert = (value, reason) => { if (!value) throw Error(reason); };
  const screenshot = async name => { const file = path.join(out, name + '.png'); await page.screenshot({ path: file }); report.artifacts.push(file); };
  let box;
  // uGUI anchors use bottom-left; Playwright uses top-left. Nested coordinates come from MatchHud.cs.
  const point = (x, y, panel = [0, 0, 1, 1]) => ({ x: box.x + (panel[0] + x * (panel[2] - panel[0])) * box.width, y: box.y + (1 - panel[1] - y * (panel[3] - panel[1])) * box.height });
  const click = async (x, y, panel) => { const p = point(x, y, panel); await page.mouse.click(p.x, p.y, { delay: 60 }); await page.waitForTimeout(150); };
  const key = async (name, duration = 70) => { await page.keyboard.down(name); await page.waitForTimeout(duration); await page.keyboard.up(name); };
  try {
    browser = await chromium.launch({ headless: process.env.RH_UNITY_PLAYABLE_HEADED !== '1' });
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
    await screenshot('playable-menu');
    const menu = [.22, .25, .78, .82];
    await click(.5, .56, menu); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(nickname, { delay: 35 });
    await screenshot('playable-nickname');
    // Unity Web text input may use an HTML overlay: blur via the actual faction button.
    await click(.21, .255, menu); await click(.5, .095, menu);
    assert(await wait(() => latest?.me && stateKeys.size === 7, 30000), 'No Unity admission/self/all-seven-State response after menu Join');
    check('menuJoin', hellos[0]?.profile === nickname && hellos[0]?.faction === 4, { hello: hellos[0], welcome: welcomes[0] });
    check('mapAndCollections', welcomes[0]?.map.hash === expectedMap.collisionHash && welcomes[0]?.map.exactCollisionGrid && stateKeys.size === 7, { keys: [...stateKeys].sort(), inventory: collection(1), props: collection(2), camps: collection(6), snapshot: snapshot() });
    await screenshot('playable-hud');
    assert(await wait(() => latest?.phase === 1 && latest?.me?.status === 1, 30000), 'No authoritative active/alive phase before gameplay input');
    await screenshot('playable-active');
    // Keep pointer in world space; UI pointer-blocking must not swallow the actual key actions.
    await page.mouse.move(...Object.values(point(.35, .50)));
    const focus = collection(2)?.focus;
    if (focus) {
      const before = { inventory: collection(1), props: collection(2) }, count = commandCount('pickup'), eventIndex = events.length;
      await key('f'); await wait(() => commandCount('pickup') > count); await page.waitForTimeout(800);
      const sent = commands.filter(c => c.k === 'pickup').slice(count);
      const after = { inventory: collection(1), props: collection(2) }, response = events.slice(eventIndex).filter(e => ['pickupRefused', 'potionNotice'].includes(e.k));
      check('focusedPickupInput', sent.some(c => c.handle === focus.handle), { before, after, sent, response, stateChanged: JSON.stringify(before) !== JSON.stringify(after) });
      report.checks.pickupOutcome = status(response.some(e => e.k === 'pickupRefused') ? 'server-refused' : JSON.stringify(before) !== JSON.stringify(after) ? 'changed' : 'unexercised', { note: 'Only server-observed changes/refusals are recorded; no acquisition inferred.' });
    } else report.checks.focusedPickupInput = status('unexercised', { reason: 'Server supplied no focus at initial spawn.' });
    {
      const chests = collection(4) || [], index = chests.findIndex(c => c.canChoose && !c.picked && c.options.some(o => !o.taken));
      if (index < 0) report.checks.rewardChoice = status('unexercised', { reason: 'No issued chest with CanChoose and an available option.', issuedChests: chests });
      else {
        const rewards = [.59, .34, .98, .86], chest = chests[index], pick = chest.options.findIndex(o => !o.taken), count = commandCount('choose'), before = collection(5);
        for (let i = 0; i < index; i++) await click(.725, .12, rewards);
        await click(.5, .67 - pick * .18, rewards);
        await wait(() => commandCount('choose') > count); await wait(() => JSON.stringify(collection(5)) !== JSON.stringify(before));
        const sent = commands.filter(c => c.k === 'choose').slice(count);
        check('rewardChoice', sent.some(c => c.handle === chest.handle && c.pick === pick) && JSON.stringify(collection(5)) !== JSON.stringify(before), { issuedChest: chest, pick, before, after: collection(5), sent });
        await screenshot('playable-reward');
      }
    }
    await page.mouse.move(...Object.values(point(.35, .50)));
    {
      const count = commandCount('useConsumable'), eventIndex = events.length, before = snapshot();
      await key('e'); await wait(() => commandCount('useConsumable') > count); await wait(() => events.slice(eventIndex).some(e => e.k === 'potionNotice'));
      check('potionInputAndNotice', commandCount('useConsumable') > count && events.slice(eventIndex).some(e => e.k === 'potionNotice'), { before, after: snapshot(), notices: events.slice(eventIndex).filter(e => e.k === 'potionNotice') });
    }
    {
      const start = commands.length;
      await click(.30, .85, [.02, .02, .98, .23]); // non-button HP area on the actual HUD panel
      await page.waitForTimeout(300);
      const unintended = commands.slice(start).filter(c => ['attack', 'target', 'move', 'attackMove'].includes(c.k));
      check('hudBlocksWorldClick', unintended.length === 0, { unintended });
      const worldStart = commands.length;
      await click(.35, .50); await page.waitForTimeout(300);
      const sent = commands.slice(worldStart).filter(c => ['attack', 'release', 'target'].includes(c.k));
      check('worldAttackClick', sent.some(c => c.k === 'target') || sent.some(c => c.k === 'attack') && sent.some(c => c.k === 'release'), { sent });
    }
    {
      const count = commandCount('swap'), before = collection(1);
      await key('2'); await wait(() => commandCount('swap') > count); await page.waitForTimeout(350);
      check('swapInput', commands.filter(c => c.k === 'swap').slice(count).some(c => c.slot === 1), { before, after: collection(1) });
    }
    {
      const count = commandCount('move'), before = snapshot();
      await key('d', 650); await page.waitForTimeout(700);
      if (latest?.me && latest.me.x === before.me.x && latest.me.y === before.me.y) { await key('w', 650); await page.waitForTimeout(700); }
      const after = snapshot(), sent = commands.filter(c => c.k === 'move').slice(count);
      check('movement', sent.length > 0 && after?.me && after.me.moveSeq !== before.me.moveSeq && (after.me.x !== before.me.x || after.me.y !== before.me.y), { before, after, sent });
    }
    {
      const welcomeBefore = welcomeCount, snapshotBefore = report.frames.snapshots, player = welcomes.at(-1)?.player;
      const closed = await page.evaluate(() => { const socket = window.__rhProofSockets.findLast(s => s.readyState === WebSocket.OPEN); if (!socket) return false; socket.close(1000, 'UI reconnect proof'); return true; });
      await page.waitForTimeout(200); await screenshot('playable-reconnecting');
      await wait(() => welcomeCount > welcomeBefore && report.frames.snapshots > snapshotBefore + 1, 20000);
      check('reconnect', closed && welcomeCount > welcomeBefore && hellos.at(-1)?.resumed && welcomes.at(-1)?.player === player, { welcomeBefore, welcomeAfter: welcomeCount, latestHello: hellos.at(-1), latestWelcome: welcomes.at(-1), after: snapshot() });
      await screenshot('playable-resumed');
    }
    if (resultWait > 0) await wait(() => events.some(e => e.k === 'result'), resultWait);
    const result = events.find(e => e.k === 'result');
    if (result) { report.checks.results = status('pass', { result }); await page.waitForTimeout(250); await screenshot('playable-results'); }
    else report.checks.results = status('unexercised', { reason: `No authoritative result during ordinary run within ${resultWait}ms observation bound.` });
    leaving = true;
    await click(.905, .96); // top-level Leave / menu, even if a result panel is present
    await page.waitForTimeout(350); await screenshot('playable-returned-menu');
    const joinBefore = welcomeCount; leaving = false;
    await click(.5, .095, menu);
    await wait(() => welcomeCount > joinBefore, 15000);
    check('leaveAndRejoin', welcomeCount > joinBefore && hellos.at(-1)?.resumed === false, { latestHello: hellos.at(-1), latestWelcome: welcomes.at(-1) });
    await screenshot('playable-rejoined');
    leaving = true;
    await click(.905, .96);
  } catch (e) { report.failure = redact(e); failures.push(report.failure); if (page) try { await screenshot('playable-failure'); } catch {} }
  finally {
    report.checks.visibleMobs = status(maxVisibleMobs > 0 ? 'pass' : 'unexercised', { maximumDeliveredVisibleMobs: maxVisibleMobs });
    report.commands = commands; report.events = events; report.hellos = hellos; report.welcomes = welcomes;
    report.failures = failures; report.ok = failures.length === 0 && report.pageErrors.length === 0 && report.observerErrors.length === 0;
    fs.writeFileSync(path.join(out, 'playable-web.json'), JSON.stringify(report, null, 2) + '\n');
    if (browser) await browser.close();
    console.log(JSON.stringify({ ok: report.ok, checks: Object.fromEntries(Object.entries(report.checks).map(([name, value]) => [name, value.status])), failures, pageErrors: report.pageErrors, observerErrors: report.observerErrors, report: path.join(out, 'playable-web.json') }, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  }
})();
