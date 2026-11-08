'use strict';

// Frozen local browser proof: run all five real Unity R cases, then earn a real
// Trophy in --first-playable and select it with the Unity HUD. The only non-Unity
// gameplay actors are ordinary protocol-13 peers using public commands.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { loadPlaywright } = require('./runtime.cjs');
const { waitOwnedServer } = require('./wish-server-readiness.cjs');
const { connectHelper } = require('./trophy-gameplay.cjs');

const root = path.resolve(__dirname, '../..');
const DEFAULT_BINARY = '/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-target/debug/rh-server';
const EXPECTED_SERVER_SHA256 = '20d5b70e9ed79863f03350fbeb9478fd7f45e0a7a644ea2a802a13c14d75b4b0';
const EXPECTED_CONTENT_HASH = '67183626db240b6a';
const EXPECTED_SOURCE_MAP_HASH = 0x0252d18b;
const EXPECTED_WIRE_MAP_HASH = 0x1c772b5b;
const CRATES = [
  { x: 240, y: 208 }, { x: 432, y: 208 }, { x: 240, y: 688 },
  { x: 1104, y: 208 }, { x: 1296, y: 208 }, { x: 1296, y: 688 },
  { x: 528, y: 1136 }, { x: 1040, y: 1136 },
];

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith('--')) throw new Error(`unexpected argument ${item}`);
    const key = item.slice(2);
    if (key === 'help' || key === 'headed') out[key] = true;
    else {
      const value = argv[++i];
      if (value == null || value.startsWith('--')) throw new Error(`missing value for ${item}`);
      out[key] = value;
    }
  }
  return out;
}
const cli = argsOf(process.argv.slice(2));
if (cli.help) {
  console.log('Usage: node tools/latency/trophy-e2e.cjs --url LOOPBACK_UNITY_WEB_URL --build-manifest UNITY_BUILD_MANIFEST.json [--wish-report ALL_FIVE_PASS.json] [--server-bin FROZEN_RH_SERVER] [--expected-server-sha256 SHA256] [--expected-content-hash HEX] [--timeout-ms N] [--headed]');
  process.exit(0);
}

const webUrl = cli.url || process.env.RH_LATENCY_PAGE_URL;
const serverBin = path.resolve(root, cli['server-bin'] || process.env.RH_TROPHY_SERVER_BIN || DEFAULT_BINARY);
const expectedServerHash = String(cli['expected-server-sha256'] || EXPECTED_SERVER_SHA256).toLowerCase();
const expectedContentHash = String(cli['expected-content-hash'] || EXPECTED_CONTENT_HASH).toLowerCase().replace(/^0x/, '');
const buildManifestPath = cli['build-manifest'] ? path.resolve(root, cli['build-manifest']) : null;
const timeoutMs = Math.max(5000, Number(cli['timeout-ms'] || process.env.RH_TROPHY_TIMEOUT_MS || 180000));
const outDir = path.resolve(root, process.env.RH_TROPHY_OUTPUT_DIR || 'docs/evidence/frozen-browser-1310');
const output = path.join(outDir, 'trophy-e2e.json');

const html = fs.readFileSync(path.join(root, 'crates/rh-server/web/probe.html'), 'utf8');
const decoderStart = html.search(/\/\/ ---- protocol v\d+/);
const decoderEnd = html.indexOf('// ---- probe state');
if (decoderStart < 0 || decoderEnd <= decoderStart) throw new Error('Could not locate v13 decoder in probe.html');
const decoderSource = `${html.slice(decoderStart, decoderEnd)}\nreturn { Tracker, decode, decodeClient, hello, input, ping };`;

function isLoopback(host) { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host); }
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function identity(file) {
  const result = { path: path.relative(root, file), sha256: null, bytes: null };
  try { const s = fs.statSync(file); if (s.isFile()) { result.sha256 = hashFile(file); result.bytes = s.size; } } catch (_) { }
  return result;
}
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function until(predicate, timeout, description) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await wait(50);
  }
  throw new Error(`timed out waiting for ${description}`);
}
async function ephemeralPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
function startServer(port) {
  const child = spawn(serverBin, ['--bind', `127.0.0.1:${port}`, '--first-playable', '--min-players', '3', '--fill-bots', '0',
    '--max-rooms', '1', '--lobby-seconds', '30', '--fill-seconds', '0', '--wish-full'],
  { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = '', failure = null;
  child.on('error', error => { failure = String(error); });
  child.stderr.on('data', chunk => { logs = (logs + chunk.toString()).slice(-16000); });
  return { child, logs: () => logs, failure: () => failure };
}
async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(2500)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
function profile(prefix) { return `${prefix}${crypto.randomBytes(6).toString('hex')}`.slice(0, 15); }
function clientInit(source) {
  const { Tracker, decode, decodeClient } = new Function(source)();
  const state = window.__rhLatency = { events: [], wire: [], keyEvents: [], pointerEvents: [], errors: [], overflow: false,
    frame: null, tracker: new Tracker(), targetsRequested: false, recording: false };
  const put = (list, v) => { if (list.length < 40000) list.push(v); else state.overflow = true; };
  addEventListener('keydown', e => put(state.keyEvents, { code: e.code, at: performance.now(), trusted: e.isTrusted }), true);
  addEventListener('pointerdown', e => put(state.pointerEvents, { type: 'down', button: e.button, x: e.clientX, y: e.clientY, at: performance.now(), trusted: e.isTrusted }), true);
  addEventListener('pointerup', e => put(state.pointerEvents, { type: 'up', button: e.button, x: e.clientX, y: e.clientY, at: performance.now(), trusted: e.isTrusted }), true);
  const asBytes = v => v instanceof ArrayBuffer ? new Uint8Array(v) : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(0);
  const Native = window.WebSocket;
  window.WebSocket = new Proxy(Native, { construct(target, args) {
    const socket = Reflect.construct(target, args, target), send = socket.send.bind(socket);
    socket.send = data => {
      let message = null; try { message = decodeClient(asBytes(data).buffer); } catch (error) { put(state.errors, `send decode: ${error}`); }
      put(state.wire, { kind: 'send', at: performance.now(), frame: state.frame, message }); return send(data);
    };
    socket.addEventListener('message', event => {
      let message = null;
      try { message = state.tracker.apply(decode(asBytes(event.data).buffer)); }
      catch (error) { put(state.errors, `receive decode: ${error}`); }
      put(state.wire, { kind: 'receive', at: performance.now(), message });
    });
    return socket;
  } });
}

async function newUnityClient(browser, label, faction, serverUrl, errors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.addInitScript(clientInit, decoderSource);
  const url = new URL(webUrl); url.search = ''; url.hash = '';
  url.searchParams.set('server', serverUrl); url.searchParams.set('profile', profile(label)); url.searchParams.set('token', 'trophy-proof-local');
  url.searchParams.set('faction', String(faction)); url.searchParams.set('auto', '1');
  await page.goto(url.toString(), { waitUntil: 'load', timeout: 120000 });
  return page;
}
async function driverSnapshot(page) {
  return page.evaluate(() => {
    const state = window.__rhLatency;
    const snapshot = [...state.wire].reverse().find(e => e.kind === 'receive' && e.message?.t === 'snapshot')?.message || null;
    const welcome = state.wire.find(e => e.kind === 'receive' && e.message?.t === 'welcome')?.message || null;
    const reject = state.wire.find(e => e.kind === 'receive' && e.message?.t === 'reject')?.message || null;
    return { snapshot, welcome: welcome && { protocol: welcome.protocol, contentHex: BigInt(welcome.content).toString(16).padStart(16, '0'), player: welcome.player, map: welcome.map },
      reject: reject && { code: reject.code, reason: reject.reason }, errors: [...state.errors], overflow: state.overflow,
      collections: Object.fromEntries(state.tracker.collections) };
  });
}
async function waitDriverActive(page, expectedContent) {
  await until(async () => { const s = await driverSnapshot(page); return s.reject || (s.snapshot?.me && s.snapshot.phase === 1); }, timeoutMs, 'Unity owner active or rejected');
  const s = await driverSnapshot(page);
  if (s.reject) throw new Error(`Unity owner admission rejected: ${s.reject.code} ${s.reject.reason}`);
  if (!s.welcome || s.welcome.protocol !== 13 || s.welcome.contentHex.toLowerCase() !== expectedContent)
    throw new Error('Unity Welcome protocol/content identity differs from the pinned proof');
  if (s.welcome.map.w !== 48 || s.welcome.map.h !== 40 || s.welcome.map.hash !== EXPECTED_WIRE_MAP_HASH)
    throw new Error(`Welcome map identity mismatch: ${JSON.stringify({ w: s.welcome.map.w, h: s.welcome.map.h, hash: s.welcome.map.hash })}`);
  if (s.snapshot.training !== false || !s.snapshot.me) throw new Error('Unity owner is not an ordinary non-training active player');
  return s;
}
async function captureSnapshot(page, stage, report) {
  const file = path.join(outDir, `${stage}.png`);
  await page.screenshot({ path: file, fullPage: false });
  report.screenshots[stage] = path.relative(root, file);
}
function pointerFromScreen(canvas, viewport, point) {
  return { x: canvas.x + point.x / viewport.x * canvas.width,
    y: canvas.y + (1 - point.y / viewport.y) * canvas.height };
}
function contentHashHex(value) {
  if (typeof value === 'bigint') return value.toString(16).padStart(16, '0');
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value).toString(16).padStart(16, '0');
  const text = String(value ?? '').toLowerCase().replace(/^0x/, '');
  if (/^[0-9a-f]{1,16}$/.test(text)) return text.padStart(16, '0');
  if (/^\d+$/.test(text)) return BigInt(text).toString(16).padStart(16, '0');
  return text;
}
function seatRecord(role, playerId, snapshot, welcome, fallbackContentHash) {
  const welcomedPlayerId = welcome?.player ?? welcome?.playerId ?? null;
  const mapHash = welcome?.map?.hash ?? welcome?.mapHash ?? null;
  const width = welcome?.map?.w ?? welcome?.mapW ?? null;
  const height = welcome?.map?.h ?? welcome?.mapH ?? null;
  const protocol = welcome?.protocol ?? 13;
  const content = welcome?.contentHex ?? welcome?.content ?? fallbackContentHash;
  return { role, playerId, training: snapshot?.training, protocol, contentHash: contentHashHex(content),
    mapHash, mapWidth: width, mapHeight: height, welcome: Number.isInteger(welcomedPlayerId),
    welcomeFacts: { playerId: welcomedPlayerId, protocol, contentHash: contentHashHex(content), mapHash, width, height } };
}
async function requestTargets(page) {
  const start = await page.evaluate(() => {
    const s = window.__rhLatency; s.targetsRequested = true; return s.events.length;
  });
  await until(() => page.evaluate(n => window.__rhLatency.events.slice(n).some(e => e.kind === 'targetViewport') &&
    window.__rhLatency.events.slice(n).some(e => e.kind === 'targetSelf'), start), 5000, 'Unity target screen hooks');
  return page.evaluate(n => {
    const events = window.__rhLatency.events.slice(n);
    const viewport = events.find(e => e.kind === 'targetViewport'), self = events.find(e => e.kind === 'targetSelf');
    const actors = events.filter(e => e.kind === 'targetActor');
    window.__rhLatency.targetsRequested = false;
    return { viewport, self, actors };
  }, start);
}
async function ownerMoveTo(page, x, y, evidence) {
  const snap = await driverSnapshot(page), targetTrace = await requestTargets(page);
  if (!targetTrace.viewport || !targetTrace.self) throw new Error('Unity world cursor projection is unavailable');
  const canvas = await page.locator('#unity-canvas').boundingBox();
  if (!canvas) throw new Error('Unity canvas is missing');
  const pixelsPerWorld = targetTrace.viewport.y / (18 * 32);
  const screen = { x: targetTrace.self.x + (x - snap.snapshot.me.x) * pixelsPerWorld,
    y: targetTrace.self.y - (y - snap.snapshot.me.y) * pixelsPerWorld * 0.78 };
  const point = pointerFromScreen(canvas, targetTrace.viewport, screen);
  if (point.x < canvas.x || point.x > canvas.x + canvas.width || point.y < canvas.y || point.y > canvas.y + canvas.height)
    throw new Error('requested normal Unity movement point is outside the rendered canvas');
  const before = await page.evaluate(() => ({ wire: window.__rhLatency.wire.length, pointers: window.__rhLatency.pointerEvents.length }));
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await until(() => page.evaluate(({ n, x, y }) => window.__rhLatency.wire.slice(n).some(e => e.kind === 'send' &&
    e.message?.t === 'input' && e.message.cmds.some(c => c.k === 'move' && Math.abs(c.x - x) < 3 && Math.abs(c.y - y) < 3)),
  { n: before.wire, x, y }), 5000, 'Unity trusted right-click to queue the expected public Move');
  const send = await page.evaluate(({ n, x, y }) => [...window.__rhLatency.wire.slice(n)].reverse().filter(e => e.kind === 'send' && e.message?.t === 'input')
    .flatMap(e => e.message.cmds.map(c => ({ at: e.at, frame: e.frame, seq: e.message.seq, command: c })))
    .find(e => e.command.k === 'move' && Math.abs(e.command.x - x) < 3 && Math.abs(e.command.y - y) < 3), { n: before.wire, x, y });
  if (!send) throw new Error('Unity right-click did not queue the expected public Move');
  const pointer = await page.evaluate(n => window.__rhLatency.pointerEvents.slice(n).find(e => e.type === 'down' && e.button === 2), before.pointers);
  if (!pointer?.trusted) throw new Error('Unity movement click was not a trusted browser pointer event');
  evidence.moves.push({ source: 'Unity trusted right-click', pointer: { x: pointer.x, y: pointer.y, at: pointer.at, trusted: pointer.trusted },
    command: send.command, inputFrame: send.seq, unityFrame: send.frame });
  await until(async () => {
    const s = await driverSnapshot(page); return s.snapshot?.me && Math.hypot(s.snapshot.me.x - x, s.snapshot.me.y - y) <= 44;
  }, timeoutMs, 'Unity owner reached the public Move destination');
}

async function attackVictim(page, helper, victimId, report) {
  const deadline = Date.now() + Math.min(timeoutMs, 120000), actions = [];
  let previousHp = null;
  const ownerKillsBefore = (await driverSnapshot(page)).snapshot?.me?.kills;
  report.gameplay.ownerKillsBefore = ownerKillsBefore;
  while (Date.now() < deadline) {
    const owner = await driverSnapshot(page), victim = await helper.snapshot();
    if (victim?.snapshot?.me?.status === 2) break;
    if (!owner.snapshot?.me || owner.snapshot.me.status !== 1 || !victim?.snapshot?.me) throw new Error('killer or boosted victim left the active match');
    const actor = owner.snapshot.actors.find(a => a.kind === 0 && a.id === victimId);
    if (!actor) throw new Error('boosted victim is absent from the Unity owner delivered actor set');
    const d = Math.hypot(actor.x - owner.snapshot.me.x, actor.y - owner.snapshot.me.y);
    if (d > 55) {
      const ratio = Math.max(0, (d - 34) / d), dest = { x: actor.x - (actor.x - owner.snapshot.me.x) * ratio,
        y: actor.y - (actor.y - owner.snapshot.me.y) * ratio };
      await ownerMoveTo(page, dest.x, dest.y, report.gameplay);
      continue;
    }
    const projection = await requestTargets(page);
    const target = projection.actors.find(a => a.player === victimId);
    if (!target) throw new Error('Unity target picker did not expose the delivered victim projection');
    const canvas = await page.locator('#unity-canvas').boundingBox();
    const point = pointerFromScreen(canvas, projection.viewport, target);
    await page.mouse.move(point.x, point.y);
    const before = await helper.snapshot();
    const startTrace = await page.evaluate(() => window.__rhLatency.wire.length);
    await page.mouse.down({ button: 'left' });
    await wait(2500);
    await page.mouse.up({ button: 'left' });
    await until(() => page.evaluate(n => window.__rhLatency.wire.slice(n).some(e => e.kind === 'send' &&
      e.message?.t === 'input' && e.message.cmds.some(c => c.k === 'attack' || c.k === 'target')), startTrace), 5000,
    'trusted Unity attack input');
    const after = await helper.snapshot();
    const newHp = after?.snapshot?.me?.hp;
    actions.push({ kind: 'trusted Unity left-button attack', atDistance: d, victimHpBefore: before.snapshot.me.hp,
      victimHpAfter: newHp, victimStatusAfter: after.snapshot.me.status });
    if (newHp != null && previousHp != null && newHp < previousHp) actions.at(-1).damageObserved = true;
    previousHp = newHp;
    if (after.snapshot.me.status === 2) break;
    await wait(450);
  }
  report.gameplay.attacks = actions;
  const finalVictim = await helper.snapshot();
  if (finalVictim?.snapshot?.me?.status !== 2) throw new Error(`Unity owner did not kill boosted victim in normal gameplay (status=${finalVictim?.snapshot?.me?.status}, hp=${finalVictim?.snapshot?.me?.hp})`);
  const ownerId = (await driverSnapshot(page)).snapshot.me.id;
  const deathEvent = await page.evaluate(({ victimId, ownerId }) => {
    for (const entry of window.__rhLatency.wire) {
      if (entry.kind !== 'receive' || entry.message?.t !== 'events') continue;
      const event = entry.message.events.find(ev => ev.k === 'death' && ev.id === victimId && ev.by === ownerId);
      if (event) return { kind: event.k, victimId: event.id, byPlayerId: event.by,
        receivedAt: performance.timeOrigin + entry.at, tick: entry.message.tick };
    }
    return null;
  }, { victimId, ownerId });
  report.gameplay.deathEvent = deathEvent;
  report.gameplay.ownerDeathEventObserved = !!deathEvent;
  if (!deathEvent) throw new Error('Unity owner did not receive an authoritative Death event credited to its player id');
  await until(async () => (await driverSnapshot(page)).snapshot?.me?.kills > ownerKillsBefore,
    8000, 'authoritative Unity owner kill-count increment');
  report.gameplay.ownerKillsAfter = (await driverSnapshot(page)).snapshot.me.kills;
}

function normalizedHudPoint(box, x, y) { return { x: box.x + x * box.width, y: box.y + (1 - y) * box.height }; }
async function claimTrophy(page, driverId, victimId, report) {
  await until(async () => {
    const s = await driverSnapshot(page), rows = s.collections[4] || [];
    return rows.some(row => row.canChoose && row.options.some(o => o.kind === 3));
  }, timeoutMs, 'Unity owner delivered a ready real kind-3 Trophy row');
  const state = await driverSnapshot(page), rows = state.collections[4];
  const chestIndex = rows.findIndex(row => row.canChoose && row.options.some(o => o.kind === 3));
  let chest = rows[chestIndex];
  if (!chest || !chest.options.length || chest.options.some(o => o.kind !== 3))
    throw new Error('expected a complete all-Trophy row for the credited killer');
  const pick = chest.options.findIndex(o => o.kind === 3 && !o.taken);
  if (pick < 0 || pick > 2) throw new Error('ready Trophy has no untaken original option index');
  const optionIdentity = chest.options.map(option => ({ kind: option.kind, id: option.id, key: option.key,
    gainBits: option.kind === 3 ? new DataView(new Float64Array([option.gain]).buffer).getBigUint64(0, true).toString(16) : null }));
  const sourceX = chest.x, sourceY = chest.y;
  const matchesTrophySource = candidate => candidate && candidate.x === sourceX && candidate.y === sourceY &&
    candidate.options?.length === optionIdentity.length && candidate.options.every((option, index) => {
      const expected = optionIdentity[index];
      const gainBits = option.kind === 3 ? new DataView(new Float64Array([option.gain]).buffer).getBigUint64(0, true).toString(16) : null;
      return option.kind === expected.kind && option.id === expected.id && option.key === expected.key && gainBits === expected.gainBits;
    });
  report.trophy = { handle: chest.handle, rowIndex: chestIndex, options: chest.options, originalPickIndex: pick,
    canChoose: chest.canChoose, picked: chest.picked, expiresAt: chest.expiresAt, owner: driverId, killedPlayer: victimId,
    beforeRow: chest, sourcePositionQuantized: { x: chest.x, y: chest.y }, optionIdentity };
  const canvas = await page.locator('#unity-canvas').boundingBox();
  if (!canvas) throw new Error('Unity canvas is unavailable for the actual HUD choice');
  // MatchHud's real normalized anchors: Next chest and option[i]. This is a trusted pointer click.
  for (let i = 0; i < chestIndex; i++) {
    const p = normalizedHudPoint(canvas, .59 + .39 * .725, .34 + .52 * .12);
    await page.mouse.click(p.x, p.y);
    await wait(120);
  }
  await captureSnapshot(page, 'trophy-before-trusted-click', report);
  await until(async () => {
    const s = await driverSnapshot(page), matching = (s.collections[4] || []).filter(matchesTrophySource);
    return matching.length === 1 && matching[0].canChoose && matching[0].picked === false;
  }, 3000, 'Unity reward collection contains the same ready Trophy row after HUD navigation');
  const preClick = await driverSnapshot(page), readyRows = (preClick.collections[4] || []).filter(matchesTrophySource);
  if (readyRows.length !== 1 || !readyRows[0].canChoose || readyRows[0].picked)
    throw new Error('latest delivered Trophy row is absent, ambiguous, or no longer ready before click');
  chest = readyRows[0];
  report.trophy.handle = chest.handle;
  report.trophy.options = chest.options;
  report.trophy.beforeRow = chest;
  report.trophy.preChoiceHandle = chest.handle;
  const before = await page.evaluate(() => ({ wire: window.__rhLatency.wire.length, pointers: window.__rhLatency.pointerEvents.length }));
  const p = normalizedHudPoint(canvas, .59 + .39 * .5, .34 + .52 * (.67 - .18 * pick));
  await page.mouse.click(p.x, p.y);
  const trustedPointer = await page.evaluate(({ n, x, y }) => {
    const events = window.__rhLatency.pointerEvents.slice(n);
    const near = e => e.trusted && e.button === 0 && Math.abs(e.x - x) <= 2 && Math.abs(e.y - y) <= 2;
    return { down: events.find(e => e.type === 'down' && near(e)) || null,
      up: events.find(e => e.type === 'up' && near(e)) || null };
  }, { n: before.pointers, x: p.x, y: p.y });
  if (!trustedPointer.down || !trustedPointer.up || trustedPointer.up.at < trustedPointer.down.at)
    throw new Error('Trophy HUD option was not activated by a trusted left-button Unity canvas click');
  await until(() => page.evaluate(({ n, handle, pick }) => window.__rhLatency.wire.slice(n).some(e => e.kind === 'send' &&
    e.message?.t === 'input' && e.message.cmds.some(c => c.k === 'choose' && c.handle === handle && c.pick === pick)),
  { n: before.wire, handle: chest.handle, pick }), 5000, 'trusted Unity Trophy HUD click decoded as the original Choose handle/index');
  const sent = await page.evaluate(({ n, handle, pick }) => window.__rhLatency.wire.slice(n).find(e => e.kind === 'send' &&
    e.message?.t === 'input' && e.message.cmds.some(c => c.k === 'choose' && c.handle === handle && c.pick === pick)),
  { n: before.wire, handle: chest.handle, pick });
  report.trophy.hudClick = { at: sent.at + (await page.evaluate(() => performance.timeOrigin)), trustedPointerClick: true,
    pointerDown: trustedPointer.down, pointerUp: trustedPointer.up, pagePoint: p,
    choose: sent.message.cmds.find(c => c.k === 'choose' && c.handle === chest.handle) };
  await until(async () => {
    const latest = await driverSnapshot(page), current = (latest.collections[4] || []).filter(matchesTrophySource);
    return current.length === 1 && current[0].picked && current[0].options[pick]?.taken && current[0].options[pick]?.takenBy === driverId;
  }, 8000, 'authoritative Trophy Picked/Taken/TakenBy update');
  await captureSnapshot(page, 'trophy-after-authoritative-taken', report);
  const latest = await driverSnapshot(page), afterMatches = latest.collections[4].filter(matchesTrophySource);
  if (afterMatches.length !== 1) throw new Error('post-choice Trophy row is absent or ambiguous by its delivered source position and full option vector');
  const after = afterMatches[0];
  if (!after.picked || !after.options[pick].taken || after.options[pick].takenBy !== driverId)
    throw new Error('authoritative owner Trophy state did not mark the clicked original slot taken');
  report.trophy.after = after;
  report.trophy.afterHandle = after.handle;
  report.trophy.postChoiceHandle = after.handle;
  report.trophy.pageErrors = latest.errors;
  report.trophy.traceOverflow = latest.overflow;
}

async function buildIdentity(manifestFile, parsedUrl) {
  if (!manifestFile) throw new Error('--build-manifest is required for frozen artifact identity');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.source_revision !== '1310ae002870bf3fc674c7b65f38ff5ea55a7d75' ||
      manifest.server?.protocol !== 13 || String(manifest.server?.content_hash).toLowerCase() !== EXPECTED_CONTENT_HASH ||
      String(manifest.server?.binary_sha256).toLowerCase() !== expectedServerHash)
    throw new Error('build manifest protocol/contentHash does not match the pinned v13 build');
  const archive = manifest.build?.archive_path;
  if (!archive || !Array.isArray(manifest.build?.files) || !manifest.build.files.length)
    throw new Error('build manifest must identify the immutable archive and its file list');
  const archiveRoot = path.resolve(archive);
  const assets = [];
  for (const asset of manifest.build.files) {
    if (!asset.path || !/^[a-f0-9]{64}$/i.test(asset.archive_sha256)) throw new Error('each archived build asset needs path and archive_sha256');
    const localPath = path.resolve(archiveRoot, asset.path);
    if (!localPath.startsWith(archiveRoot + path.sep) || !fs.existsSync(localPath)) throw new Error(`archived Unity asset missing: ${asset.path}`);
    const archivedHash = hashFile(localPath);
    if (archivedHash !== asset.archive_sha256.toLowerCase()) throw new Error(`archive SHA-256 mismatch: ${asset.path}`);
    const url = new URL(asset.path, parsedUrl.origin + parsedUrl.pathname);
    if (url.origin !== parsedUrl.origin) throw new Error('build asset URL must stay on the Unity loopback origin');
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Unity asset unavailable: ${asset.path} (${response.status})`);
    const actual = crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    if (actual !== asset.archive_sha256.toLowerCase()) throw new Error(`served Unity asset SHA-256 mismatch: ${asset.path}`);
    assets.push({ path: asset.path, sha256: actual, bytes: Number(response.headers.get('content-length')) || null });
  }
  for (const essential of ['index.html', 'Build/Web.data', 'Build/Web.framework.js', 'Build/Web.loader.js', 'Build/Web.wasm'])
    if (!assets.some(asset => asset.path === essential)) throw new Error(`manifest omits required Unity asset ${essential}`);
  return { manifest: identity(manifestFile), sourceRevision: manifest.source_revision,
    unityBuildId: path.basename(archiveRoot), protocol: manifest.server.protocol, contentHash: manifest.server.content_hash,
    serverBinarySha256: manifest.server.binary_sha256, archive: archiveRoot,
    assets, assetCount: assets.length };
}

function embeddedMapIdentity() {
  const mapFile = path.join(root, 'maps/first-playable.json');
  const exportMap = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const map = exportMap.map;
  if (exportMap.legacyMapHashU32 !== EXPECTED_SOURCE_MAP_HASH || map?.w !== 48 || map?.h !== 40 ||
      !Array.isArray(map.tiles) || map.tiles.length !== map.w * map.h)
    throw new Error('embedded first-playable source map does not match its frozen source identity');
  // Match rh-protocol MapBlob's FNV-1a layer hash: width/height as u32 LE, then source tiles.
  let hash = 0x811c9dc5;
  const eat = byte => { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; };
  for (const value of [map.w, map.h]) for (let byte = 0; byte < 4; byte++) eat((value >>> (8 * byte)) & 0xff);
  for (const tile of map.tiles) eat(tile);
  if (hash !== EXPECTED_WIRE_MAP_HASH) throw new Error(`embedded map wire layer hash mismatch: ${hash.toString(16)}`);
  return { path: path.relative(root, mapFile), sourceSha256: hashFile(mapFile), legacyMapHash: EXPECTED_SOURCE_MAP_HASH,
    wireLayerHash: hash, width: map.w, height: map.h, tileCount: map.tiles.length };
}

function validateWishReport(reportPath, playerOrigin) {
  const proof = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (proof.summary?.status !== 'PASS' || proof.cases?.length !== 5 || proof.cases.some(c => c.status !== 'pass'))
    throw new Error('attached all-five Wish report is not PASS');
  if (proof.playerUrl !== playerOrigin) throw new Error('attached all-five Wish report used a different Unity build origin');
  if (proof.identities?.serverBinary?.sha256 !== expectedServerHash) throw new Error('attached all-five Wish report used a different frozen server binary');
  return { status: 'PASS', output: path.relative(root, reportPath), summary: proof.summary,
    serverBinarySha256: proof.identities.serverBinary.sha256, playerUrl: proof.playerUrl };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const report = { startedAt: new Date().toISOString(), status: 'incomplete', protocol: 13, expectedContentHash: EXPECTED_CONTENT_HASH,
    expectedServerSha256: expectedServerHash, expectedSourceMapHash: EXPECTED_SOURCE_MAP_HASH.toString(16),
    expectedWireMapHash: EXPECTED_WIRE_MAP_HASH.toString(16), url: null,
    identities: { serverBinary: identity(serverBin), buildManifest: buildManifestPath ? identity(buildManifestPath) : null },
    allFiveWish: null, gameplay: { helperRole: 'victim-and-third-seat are normal protocol-13 peers issuing public Move/Pickup/Choose only; Unity owner uses trusted MatchClient movement, pickup, attack, and HUD selection' },
    screenshots: {}, errors: [], prerequisites: [], notes: [
      'The five R cases are an independent Unity browser suite; attach its passing report with --wish-report. This runner does not duplicate that campaign.',
      'The Trophy case uses --first-playable, whose legacy source-map identity is 0252d18b and protocol MapBlob wire-layer FNV identity is 1c772b5b, 48x40, normal 50 ms steps, no bots, and three ordinary human seats.',
      'The victim stat Boost is discovered from a delivered source crate row, acquired with that seat-local prop handle, and chosen only after a real kind-2 non-Lifesteal reward is eligible; the authoritative Build boost count must increase.',
      'No Sim state, HP, stats, reward options, handles, kill outcome, or expiry is injected. Helper commands are normal public protocol input, not Unity input; final killer and Trophy HUD selection are actual trusted Unity input.',
      'Final selection requires decoded Unity Choose to match the actual delivered Trophy handle/original option index and subsequent authoritative Picked/Taken/TakenBy for the Unity owner. Screenshot evidence is retained before and after the trusted click.',
      'The Unity client view has no cumulative killStats field, so the proof does not claim a browser-visible exact stat delta; server/native exact gain is covered by the source-backed wire regression.',
    ] };
  let browser, child, driver, victim, third, serverRun;
  const driverErrors = [], victimPageErrors = [], thirdPageErrors = [];
  try {
    const parsedUrl = new URL(webUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || !isLoopback(parsedUrl.hostname) || parsedUrl.username || parsedUrl.password)
      throw new Error('Unity URL must be credential-free HTTP(S) loopback');
    report.url = parsedUrl.origin;
    if (!fs.existsSync(serverBin)) throw new Error(`frozen server binary missing: ${serverBin}`);
    const actualServerHash = hashFile(serverBin);
    if (actualServerHash !== expectedServerHash) throw new Error(`frozen server SHA-256 mismatch: ${actualServerHash}`);
    report.identities.serverBinary = identity(serverBin);
    report.identities.firstPlayableMap = embeddedMapIdentity();
    report.identities.unity = await buildIdentity(buildManifestPath, parsedUrl);
    const pageResponse = await fetch(webUrl, { cache: 'no-store' });
    if (!pageResponse.ok) throw new Error(`Unity web URL returned HTTP ${pageResponse.status}`);

    if (cli['wish-report']) {
      const wishPath = path.resolve(root, cli['wish-report']);
      report.allFiveWish = validateWishReport(wishPath, parsedUrl.origin);
    } else throw new Error('--wish-report is required; this runner does not duplicate the five-case campaign');

    browser = loadPlaywright(root).chromium.launch({ headless: !(cli.headed || process.env.RH_TROPHY_HEADED === '1') });
    browser = await browser;
    const port = await ephemeralPort();
    report.gameplay.serverBind = `127.0.0.1:${port}`;
    serverRun = startServer(port); child = serverRun.child;
    const ready = await waitOwnedServer(port, child, serverRun.logs, serverRun.failure);
    report.gameplay.server = { info: ready.info, ownership: ready.ownership, protocol: ready.info.protocol,
      contentHash: ready.info.contentHash, binary: report.identities.serverBinary, port };
    if (ready.info.protocol !== 13 || String(ready.info.contentHash).toLowerCase() !== expectedContentHash)
      throw new Error('first-playable /info identity differs from the pinned protocol/content');
    const wsUrl = `ws://127.0.0.1:${port}/ws`;

    // The victim helper joins first to retain the source path; runtime spawn order remains whatever the normal arena admits.
    victim = await connectHelper({ browser, codecSource: decoderSource, serverUrl: wsUrl, profile: profile('tv'), faction: 4,
      contentHash: ready.info.contentHash });
    victim.page.on('pageerror', error => victimPageErrors.push(String(error)));
    await victim.waitFor(s => s.welcome, timeoutMs, 'victim helper Welcome');
    report.gameplay.victimPlayerId = (await victim.snapshot()).welcome.player;
    third = await connectHelper({ browser, codecSource: decoderSource, serverUrl: wsUrl, profile: profile('th'), faction: 4,
      contentHash: ready.info.contentHash });
    third.page.on('pageerror', error => thirdPageErrors.push(String(error)));
    await third.waitFor(s => s.welcome, timeoutMs, 'third helper Welcome');
    driver = await newUnityClient(browser, 'tk', 0, wsUrl, driverErrors);
    const owner0 = await waitDriverActive(driver, expectedContentHash);
    await victim.waitFor(s => s.snapshot?.phase === 1, timeoutMs, 'victim helper active phase');
    await third.waitFor(s => s.snapshot?.phase === 1, timeoutMs, 'third helper active phase');
    report.gameplay.ownerPlayerId = owner0.snapshot.me.id;
    const victimWelcome = (await victim.snapshot()).welcome, victimActive = await victim.snapshot();
    const thirdWelcome = (await third.snapshot()).welcome, thirdActive = await third.snapshot();
    report.gameplay.thirdPlayerId = thirdWelcome.player;
    if ([report.gameplay.ownerPlayerId, report.gameplay.victimPlayerId, report.gameplay.thirdPlayerId].some(x => !x) ||
        new Set([report.gameplay.ownerPlayerId, report.gameplay.victimPlayerId, report.gameplay.thirdPlayerId]).size !== 3)
      throw new Error('expected three distinct ordinary human seats');
    if (owner0.welcome.map.hash !== EXPECTED_WIRE_MAP_HASH || owner0.welcome.map.w !== 48 || owner0.welcome.map.h !== 40)
      throw new Error('Unity Welcome map does not match embedded first-playable identity');
    report.gameplay.seats = [
      seatRecord('owner', owner0.snapshot.me.id, owner0.snapshot, owner0.welcome, ready.info.contentHash),
      seatRecord('victim', report.gameplay.victimPlayerId, victimActive.snapshot, victimWelcome, ready.info.contentHash),
      seatRecord('third', report.gameplay.thirdPlayerId, thirdActive.snapshot, thirdWelcome, ready.info.contentHash),
    ];
    for (const seat of report.gameplay.seats) {
      if (seat.training !== false || seat.protocol !== 13 || seat.contentHash !== expectedContentHash ||
          seat.mapHash !== EXPECTED_WIRE_MAP_HASH || seat.mapWidth !== 48 || seat.mapHeight !== 40 ||
          seat.welcome !== true || seat.welcomeFacts.playerId !== seat.playerId)
        throw new Error(`seat ${seat.role} Welcome/snapshot identity mismatch: ${JSON.stringify(seat)}`);
    }
    report.gameplay.welcome = { player: owner0.welcome.player, map: { width: owner0.welcome.map.w, height: owner0.welcome.map.h,
      hash: owner0.welcome.map.hash, sourceLegacyHash: EXPECTED_SOURCE_MAP_HASH }, training: owner0.snapshot.training };

    // Keep the real Unity trace/browser wire observer live; disable only high-volume frame marks until gameplay begins.
    await driver.evaluate(() => { window.__rhLatency.recording = false; });
    await captureSnapshot(driver, 'trophy-match-start', report);
    report.gameplay.victimInvestment = await victim.acquireBoostFromCrates({ cratePositions: CRATES, timeoutMs });
    const investment = report.gameplay.victimInvestment;
    const boostId = investment?.option?.id;
    const actualBoostIncrement = Number.isInteger(boostId) && boostId >= 0 && boostId < 7 &&
      investment.option.kind === 2 && Array.isArray(investment.beforeBoostCounts) && Array.isArray(investment.afterBoostCounts) &&
      investment.afterBoostCounts.length === 8 && investment.afterBoostCounts[boostId] > investment.beforeBoostCounts[boostId];
    if (!actualBoostIncrement) throw new Error('victim helper did not prove a real non-Lifesteal Boost acquisition');
    report.gameplay.victimInvestment.verified = true;

    const active = await driverSnapshot(driver);
    await driver.evaluate(() => { window.__rhLatency.recording = true; });
    report.gameplay.traceStartedAt = await driver.evaluate(() => performance.timeOrigin + performance.now());
    report.gameplay.moves = [];
    report.gameplay.weaponPickup = { status: 'using-currently-equipped-normal-weapon', weapon: active.snapshot.me.weapon,
      source: 'actual Unity owner snapshot; no weapon pickup required' };

    const victimState = await victim.snapshot();
    const ownerPosition = (await driverSnapshot(driver)).snapshot.me;
    const victimPosition = victimState.snapshot.me;
    const dx = ownerPosition.x - victimPosition.x, dy = ownerPosition.y - victimPosition.y;
    const distance = Math.hypot(dx, dy);
    // Bring the passive, non-Plague victim within the owner's delivered actor
    // range, but stop well outside weapon/signature contact. The Unity owner then
    // approaches and initiates combat with its trusted attack input.
    if (distance > 190) {
      const gap = 175;
      const target = { x: ownerPosition.x - dx / distance * gap, y: ownerPosition.y - dy / distance * gap };
      report.gameplay.victimStaging = await victim.moveTo(target.x, target.y,
        { source: 'public protocol Move; staging outside combat reach', waitWithin: 18, timeoutMs });
    }
    report.gameplay.victimFaction = 4;
    await attackVictim(driver, victim, report.gameplay.victimPlayerId, report);
    await claimTrophy(driver, report.gameplay.ownerPlayerId, report.gameplay.victimPlayerId, report);

    const final = await driverSnapshot(driver);
    const victimHealth = await victim.snapshot();
    const thirdHealth = await third.snapshot();
    report.gameplay.final = { ownerStatus: final.snapshot?.me?.status, victimStatus: victimHealth.snapshot?.me?.status,
      thirdStatus: thirdHealth.snapshot?.me?.status, driverErrors, victimPageErrors, thirdPageErrors,
      driverDecoderErrors: final.errors, driverOverflow: final.overflow,
      victimDecoderErrors: victimHealth.decodeErrors, victimRejects: victimHealth.rejects,
      thirdDecoderErrors: thirdHealth.decodeErrors, thirdRejects: thirdHealth.rejects };
    if (final.errors.length || final.overflow || driverErrors.length || victimPageErrors.length || thirdPageErrors.length ||
        victimHealth.decodeErrors.length || victimHealth.rejects.length || thirdHealth.decodeErrors.length || thirdHealth.rejects.length)
      throw new Error('Unity/helper browser errors or trace overflow invalidate proof');
    if (victimHealth.snapshot?.me?.status !== 2 || thirdHealth.snapshot?.me?.status !== 1)
      throw new Error('the PvP kill did not leave the third ordinary helper alive');
    report.status = 'PASS';
  } catch (error) {
    report.status = 'INCOMPLETE'; report.errors.push(String(error?.stack || error));
  } finally {
    try {
      if (driver) {
        const state = await driverSnapshot(driver);
        report.observations = report.observations || {};
        report.observations.owner = { snapshot: state.snapshot, collections: state.collections, errors: state.errors, overflow: state.overflow,
          inputFrames: await driver.evaluate(() => window.__rhLatency.wire.filter(e => e.kind === 'send' && e.message?.t === 'input').slice(-250),),
          decodedFrames: await driver.evaluate(() => window.__rhLatency.wire.filter(e => e.kind === 'receive' &&
            ['events', 'state', 'fx'].includes(e.message?.t)).slice(-250).map(e => ({ at: e.at, frame: e.frame, message: e.message }))) };
        if (report.status !== 'PASS') await captureSnapshot(driver, 'trophy-failure-owner', report).catch(() => {});
      }
      if (victim) report.observations = { ...report.observations, victim: await victim.snapshot() };
      if (third) report.observations = { ...report.observations, third: await third.snapshot() };
      if (serverRun) report.gameplay.serverStderrTail = serverRun.logs();
      if (report.gameplay.final) {
        report.gameplay.final.driverErrors = driverErrors;
        report.gameplay.final.victimPageErrors = victimPageErrors;
        report.gameplay.final.thirdPageErrors = thirdPageErrors;
      }
    } catch (error) { report.errors.push(`final observations: ${String(error)}`); }
    for (const helper of [victim, third]) if (helper) await helper.close().catch(error => report.errors.push(`helper close: ${error}`));
    if (driver) await driver.close().catch(error => report.errors.push(`Unity page close: ${error}`));
    if (browser) await browser.close().catch(error => report.errors.push(`browser close: ${error}`));
    await stopServer(child).catch(error => report.errors.push(`server stop: ${error}`));
    if (report.errors.length && report.status === 'PASS') report.status = 'INCOMPLETE';
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, output, allFiveWish: report.allFiveWish,
      errorCount: report.errors.length, errors: report.errors }, null, 2));
  }
  if (report.status !== 'PASS') process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
