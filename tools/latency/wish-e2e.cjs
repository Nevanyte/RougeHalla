'use strict';

// All-five live Wish proof. Only real browser keyboard/pointer input enters Unity;
// browser WebSocket hooks observe and decode actual traffic but never send game input.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { loadPlaywright } = require('./runtime.cjs');
const { CASES, attachWishSummary } = require('./wish-proof-contract.cjs');
const { waitOwnedServer } = require('./wish-server-readiness.cjs');

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
  console.log('Usage: node tools/latency/wish-e2e.cjs [--url LOOPBACK_UNITY_WEB_URL] [--server-bin RH_SERVER_BIN] [--map MAP_JSON] [--port-base N] [--timeout-ms N] [--headed]');
  process.exit(0);
}

const root = path.resolve(__dirname, '../..');
const webUrl = cli.url || process.env.RH_LATENCY_PAGE_URL || 'http://127.0.0.1:8097/';
const serverBin = path.resolve(root, cli['server-bin'] || process.env.RH_WISH_SERVER_BIN || 'target/debug/rh-server');
const mapFile = path.resolve(root, cli.map || 'tools/latency/wish-duel.json');
const explicitPortBase = cli['port-base'] ?? process.env.RH_WISH_PORT_BASE;
const portBase = explicitPortBase == null ? null : Number(explicitPortBase);
const timeoutMs = Math.max(1000, Number(cli['timeout-ms'] || process.env.RH_WISH_TIMEOUT_MS || 90000));
const output = path.resolve(root, process.env.RH_WISH_OUTPUT || 'tools/latency/wish-report.json');
const unitAbility = new Set(CASES.filter(spec => spec.target === 'unit').map(spec => spec.ability));

const html = fs.readFileSync(path.join(root, 'crates/rh-server/web/probe.html'), 'utf8');
const decoderStart = html.search(/\/\/ ---- protocol v\d+/);
const decoderEnd = html.indexOf('// ---- probe state');
if (decoderStart < 0 || decoderEnd <= decoderStart) throw new Error('Could not locate the embedded protocol decoder in probe.html');
const decoderBundle = `${html.slice(decoderStart, decoderEnd)}\nreturn { Tracker, decode, decodeClient };`;

function initProbe(source) {
  const { Tracker, decode, decodeClient } = new Function(source)();
  const state = window.__rhLatency = { events: [], wire: [], keyEvents: [], pointerEvents: [], errors: [],
    overflow: false, frame: null, tracker: new Tracker(), targetsRequested: false, recording: false };
  const push = (list, item) => {
    if (list.length < 20000) list.push(item);
    else state.overflow = true;
  };
  addEventListener('keydown', event => push(state.keyEvents, {
    code: event.code, at: performance.now(), isTrusted: event.isTrusted, repeat: event.repeat,
  }), true);
  addEventListener('pointermove', event => push(state.pointerEvents, {
    x: event.clientX, y: event.clientY, at: performance.now(), isTrusted: event.isTrusted,
  }), true);
  const bytes = value => {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (typeof value === 'string') return Uint8Array.from(atob(value), c => c.charCodeAt(0));
    return new Uint8Array(0);
  };
  const Native = window.WebSocket;
  window.WebSocket = new Proxy(Native, {
    construct(target, args) {
      const socket = Reflect.construct(target, args, target);
      const originalSend = socket.send.bind(socket);
      socket.send = data => {
        const at = performance.now();
        let message = null;
        try { message = decodeClient(bytes(data).buffer); }
        catch (error) { push(state.errors, `send decode: ${error}`); }
        push(state.wire, { kind: 'send', at, frame: state.frame, message });
        return originalSend(data);
      };
      socket.addEventListener('message', event => {
        const at = performance.now();
        let message = null;
        try {
          message = decode(bytes(event.data).buffer);
          const applied = state.tracker.apply(message);
          if (applied) message = applied;
        } catch (error) { push(state.errors, `receive decode: ${error}`); }
        push(state.wire, { kind: 'receive', at, frame: state.frame, message });
      }, true);
      return socket;
    }
  });
}

async function waitFor(predicate, ms, description) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  if (await predicate()) return;
  throw new Error(`timed out waiting for ${description}`);
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

async function ephemeralLoopbackPort() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fileIdentity(file) {
  const identity = { path: path.relative(root, file), sha256: null };
  try { if (fs.statSync(file).isFile()) identity.sha256 = sha256File(file); } catch (_) { /* Missing files get a null hash. */ }
  return identity;
}

function latestSnapshot(page) {
  return page.evaluate(() => {
    const state = window.__rhLatency;
    const received = state.wire.filter(e => e.kind === 'receive' && e.message?.t === 'snapshot').at(-1);
    const welcome = state.wire.find(e => e.kind === 'receive' && e.message?.t === 'welcome')?.message;
    const reject = state.wire.find(e => e.kind === 'receive' && e.message?.t === 'reject')?.message;
    return { snapshot: received?.message || null,
      welcome: welcome ? { player: welcome.player, protocol: welcome.protocol } : null,
      reject: reject ? { code: reject.code, reason: reject.reason } : null,
      errors: [...state.errors], overflow: state.overflow };
  });
}

function startServer(port) {
  const child = spawn(serverBin, [
    '--bind', `127.0.0.1:${port}`, '--map', path.relative(root, mapFile), '--min-players', '2',
    '--lobby-seconds', '2', '--fill-seconds', '1', '--fill-bots', '0', '--wish-full',
  ], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = '';
  let error = null;
  child.on('error', value => { error = String(value); });
  child.stderr.on('data', chunk => { logs = (logs + chunk.toString()).slice(-12000); });
  return { child, getLogs: () => logs, spawnFailure: () => error };
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 2500)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

function localProfile(prefix, faction) {
  return `${prefix}${faction}${crypto.randomBytes(5).toString('hex')}`.slice(0, 15);
}

async function createClient(browser, label, faction, serverUrl) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });
  await page.addInitScript(initProbe, decoderBundle);
  const url = new URL(webUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set('server', serverUrl);
  url.searchParams.set('profile', localProfile(label === 'driver' ? 'ld' : 'lo', faction));
  url.searchParams.set('token', 'wish-proof-local');
  url.searchParams.set('faction', String(faction));
  url.searchParams.set('auto', '1');
  await page.goto(url.toString(), { waitUntil: 'load', timeout: 120000 });
  return { page, runtimeErrors, label };
}

function copyOwner(wish) {
  if (!wish) return null;
  return {
    ability: wish.ability, readyAt: wish.readyAt, fullAt: wish.fullAt, maxCharges: wish.maxCharges,
    rechargeMs: wish.rechargeMs, charges: wish.charges, nextChargeAt: wish.nextChargeAt,
    cast: wish.cast ? { ability: wish.cast.ability, startedAt: wish.cast.startedAt, landsAt: wish.cast.landsAt } : null,
  };
}

async function runCase(browser, spec, index, report) {
  const port = portBase == null ? await ephemeralLoopbackPort() : portBase + index;
  const result = { faction: spec.faction, ability: spec.ability, name: spec.name, targetKind: spec.target,
    serverBindAttempt: `127.0.0.1:${port}`, status: 'incomplete' };
  let child, driver, observer;
  try {
    const startedServer = startServer(port);
    child = startedServer.child;
    const { info, ownership } = await waitOwnedServer(port, child, startedServer.getLogs, startedServer.spawnFailure);
    result.server = { protocol: info.protocol, contentHash: info.contentHash, info, port,
      bind: `127.0.0.1:${port}`, ownership, binary: report.identities.serverBinary, map: report.identities.map };
    const serverUrl = `ws://127.0.0.1:${port}/ws`;
    driver = await createClient(browser, 'driver', spec.faction, serverUrl);
    observer = await createClient(browser, 'observer', (spec.faction + 1) % 5, serverUrl);
    result.driverRuntimeErrors = driver.runtimeErrors;
    result.observerRuntimeErrors = observer.runtimeErrors;

    await waitFor(async () => {
      const a = await latestSnapshot(driver.page), b = await latestSnapshot(observer.page);
      return a.reject || b.reject || (a.snapshot?.me && b.snapshot?.me && a.snapshot.phase === 1 && b.snapshot.phase === 1);
    }, timeoutMs, 'two Unity clients active or admission rejection');
    const driverState = await latestSnapshot(driver.page), observerState = await latestSnapshot(observer.page);
    if (driverState.reject || observerState.reject) {
      const rejection = driverState.reject || observerState.reject;
      if (rejection.code === 1 || rejection.code === 2)
        throw new MissingHookError(`Unity build does not match the live server protocol/content (${rejection.code})`);
      throw new Error(`server rejected client admission: ${rejection.reason || 'unknown'}`);
    }
    if (driverState.welcome?.protocol !== 13 || observerState.welcome?.protocol !== 13)
      throw new MissingHookError('Unity Web build did not complete protocol-13 admission');
    if (!driverState.snapshot?.me || !observerState.snapshot?.me) throw new Error('Unity client did not publish a self snapshot');
    if (driverState.snapshot.training !== false || observerState.snapshot.training !== false)
      throw new Error('proof requires a non-training ordinary match');
    result.training = driverState.snapshot.training;
    const driverId = driverState.snapshot.me.id;
    const remoteHumans = driverState.snapshot.actors.filter(actor => actor.kind === 0);
    if (remoteHumans.length !== 1) throw new Error(`driver must observe one remote human; saw ${remoteHumans.length}`);
    const observerRemoteHumans = observerState.snapshot.actors.filter(actor => actor.kind === 0);
    if (observerRemoteHumans.length !== 1) throw new Error(`observer must observe one remote human; saw ${observerRemoteHumans.length}`);
    result.players = { driver: driverId, observer: observerState.snapshot.me.id, remoteActor: remoteHumans[0].id };
    const distance = Math.hypot(remoteHumans[0].x - driverState.snapshot.me.x, remoteHumans[0].y - driverState.snapshot.me.y);
    result.spawnDistance = distance;
    if (!(distance > 0 && distance <= 256)) throw new Error(`controlled duel spawns are not nearby (${distance})`);

    await waitFor(async () => {
      const current = await latestSnapshot(driver.page);
      const owner = current.snapshot?.me?.wish;
      return current.snapshot?.training === false && owner?.ability === spec.ability && owner.charges > 0 &&
        !owner.cast && current.snapshot.serverMs >= owner.readyAt;
    }, timeoutMs, `${spec.name} server-published ready_at after the opening lock`);
    const readyState = await latestSnapshot(driver.page);
    const beforeOwner = copyOwner(readyState.snapshot.me.wish);
    if (!beforeOwner || beforeOwner.ability !== spec.ability || beforeOwner.charges < 1 || beforeOwner.cast ||
        readyState.snapshot.serverMs < beforeOwner.readyAt)
      throw new Error(`authoritative owner baseline is not ready for ${spec.name}`);
    result.ownerBaseline = beforeOwner;
    const readyObservedAt = await driver.page.evaluate(() => performance.timeOrigin + performance.now());

    const gateDriver = await driver.page.evaluate(() => {
      const state = window.__rhLatency;
      if (state.errors.length || state.overflow) return { errors: [...state.errors], overflow: state.overflow };
      state.recording = true;
      state.targetsRequested = true;
      return { errors: [...state.errors], overflow: state.overflow, at: performance.timeOrigin + performance.now() };
    });
    const gateObserver = await observer.page.evaluate(() => {
      const state = window.__rhLatency;
      if (state.errors.length || state.overflow) return { errors: [...state.errors], overflow: state.overflow };
      state.recording = true;
      return { errors: [...state.errors], overflow: state.overflow, at: performance.timeOrigin + performance.now() };
    });
    if (gateDriver.errors.length || gateObserver.errors.length) throw new Error('decoder errors occurred during server and owner warm-up');
    if (gateDriver.overflow || gateObserver.overflow) throw new MissingHookError('trace overflow occurred during warm-up');
    const driverPageStart = await driver.page.evaluate(() => performance.timeOrigin);
    const observerPageStart = await observer.page.evaluate(() => performance.timeOrigin);
    result.traceGate = { warmupRecording: false, driverPageStartedAt: driverPageStart, observerPageStartedAt: observerPageStart,
      ownerReadyObservedAt: readyObservedAt, ownerReadyServerMs: readyState.snapshot.serverMs,
      driverRecordingAt: gateDriver.at, observerRecordingAt: gateObserver.at, errorsRetained: true, wireRetained: true };

    // Ask Unity's opt-in trace to expose the actual input viewport and current delivered actor projections.
    try {
      await waitFor(() => driver.page.evaluate(() => window.__rhLatency.events.some(e => e.kind === 'targetViewport') &&
        window.__rhLatency.events.some(e => e.kind === 'targetSelf') && window.__rhLatency.events.some(e => e.kind === 'targetActor')),
      Math.min(timeoutMs, 5000), 'Unity target projection trace hooks');
    } catch (_) { throw new MissingHookError('targetViewport/targetSelf/targetActor hooks are absent in this Unity build'); }
    const targets = await driver.page.evaluate(() => {
      const events = window.__rhLatency.events;
      return { viewport: events.find(e => e.kind === 'targetViewport'),
        self: events.find(e => e.kind === 'targetSelf'), actors: events.filter(e => e.kind === 'targetActor') };
    });
    await driver.page.evaluate(() => { window.__rhLatency.targetsRequested = false; });
    if (!targets.viewport || !targets.self || !Number.isFinite(targets.viewport.x) || !Number.isFinite(targets.viewport.y) ||
        targets.viewport.x <= 0 || targets.viewport.y <= 0 || targets.self.player !== driverId)
      throw new MissingHookError('invalid target projection trace');

    const canvas = await driver.page.locator('#unity-canvas').boundingBox();
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) throw new MissingHookError('Unity canvas bounding box unavailable');
    let unityPoint;
    let deliveredTarget = null;
    if (unitAbility.has(spec.ability)) {
      const projected = targets.actors.filter(e => e.moveSeq === 0 && e.player === remoteHumans[0].id);
      if (projected.length !== 1) throw new MissingHookError(`remote human screen projection missing or ambiguous (${projected.length})`);
      deliveredTarget = projected[0].player;
      unityPoint = { x: projected[0].x, y: projected[0].y };
    } else {
      const offset = targets.self.x + 56 < targets.viewport.x - 8 ? 56 : -56;
      unityPoint = { x: targets.self.x + offset, y: targets.self.y };
      if (unityPoint.x < 4 || unityPoint.x > targets.viewport.x - 4 || unityPoint.y < 4 || unityPoint.y > targets.viewport.y - 4)
        throw new MissingHookError('no nearby empty ground cursor point inside the Unity viewport');
    }
    const cursor = { x: canvas.x + unityPoint.x / targets.viewport.x * canvas.width,
      y: canvas.y + (1 - unityPoint.y / targets.viewport.y) * canvas.height };
    if (cursor.x < canvas.x || cursor.x > canvas.x + canvas.width || cursor.y < canvas.y || cursor.y > canvas.y + canvas.height)
      throw new MissingHookError('projected cursor did not map into the actual Unity canvas');
    result.cursor = { unityX: unityPoint.x, unityYBottomUp: unityPoint.y, pageX: cursor.x, pageY: cursor.y,
      targetActor: deliveredTarget, coordinateBasis: { unityWidth: targets.viewport.x, unityHeight: targets.viewport.y,
        canvasWidthCss: canvas.width, canvasHeightCss: canvas.height } };

    const before = await driver.page.evaluate(() => ({ events: window.__rhLatency.events.length,
      keyEvents: window.__rhLatency.keyEvents.length, pointerEvents: window.__rhLatency.pointerEvents.length,
      wire: window.__rhLatency.wire.length }));
    await driver.page.mouse.move(cursor.x, cursor.y, { steps: 2 });
    await driver.page.locator('#unity-canvas').focus();
    await waitFor(() => driver.page.evaluate(({ n, x, y }) => window.__rhLatency.pointerEvents.slice(n).some(e =>
      e.isTrusted && Math.abs(e.x - x) <= 1.5 && Math.abs(e.y - y) <= 1.5),
    { n: before.pointerEvents, x: cursor.x, y: cursor.y }),
      3000, 'actual browser pointer move over Unity canvas');
    await driver.page.keyboard.down('r');
    try {
      await waitFor(() => driver.page.evaluate(n => window.__rhLatency.events.slice(n).some(e => e.kind === 'sampleWish'), before.events),
        Math.min(timeoutMs, 6000), 'Unity ReadInput sampleWish hook');
    } catch (error) {
      const trace = await driver.page.evaluate(n => ({ targetHooks: window.__rhLatency.events.some(e => e.kind === 'targetViewport'),
        samples: window.__rhLatency.events.slice(n).filter(e => e.kind === 'sampleWish') }), before.events);
      if (!trace.targetHooks) throw new MissingHookError('sampleWish/target trace hooks are absent in this Unity build');
      throw error;
    } finally { await driver.page.keyboard.up('r'); }

    const sample = await driver.page.evaluate(n => window.__rhLatency.events.slice(n).find(e => e.kind === 'sampleWish'), before.events);
    const keyEvent = await driver.page.evaluate(n => window.__rhLatency.keyEvents.slice(n).find(e => e.code === 'KeyR'), before.keyEvents);
    const pointerEvent = await driver.page.evaluate(({ n, x, y }) => window.__rhLatency.pointerEvents.slice(n)
      .filter(e => e.isTrusted && Math.abs(e.x - x) <= 1.5 && Math.abs(e.y - y) <= 1.5).at(-1),
    { n: before.pointerEvents, x: cursor.x, y: cursor.y });
    if (!pointerEvent || Math.abs(pointerEvent.x - cursor.x) > 1.5 || Math.abs(pointerEvent.y - cursor.y) > 1.5)
      throw new Error('trusted browser pointer event did not reach the selected Unity screen point');
    const epoch = await driver.page.evaluate(() => performance.timeOrigin);
    const absoluteAt = at => epoch + at;
    result.browserKey = keyEvent ? { code: keyEvent.code, at: absoluteAt(keyEvent.at), isTrusted: keyEvent.isTrusted } : null;
    result.cursorGesture = pointerEvent ? { at: absoluteAt(pointerEvent.at), isTrusted: pointerEvent.isTrusted,
      x: pointerEvent.x, y: pointerEvent.y, expectedX: cursor.x, expectedY: cursor.y } : null;
    result.inputSample = sample ? { at: absoluteAt(sample.at), frame: sample.frame, player: sample.player,
      seq: sample.moveSeq, x: sample.x, y: sample.y } : null;

    await waitFor(() => driver.page.evaluate(({ n, seq }) => window.__rhLatency.wire.slice(n).some(e =>
      e.kind === 'send' && e.message?.t === 'input' && e.message.cmds.some(c => c.k === 'cast' && c.slot === 0 && c.seq === seq)),
    { n: before.wire, seq: sample.moveSeq }), timeoutMs, 'actual Unity Cast command on WebSocket');
    const sent = await driver.page.evaluate(({ n, seq }) => window.__rhLatency.wire.slice(n).find(e =>
      e.kind === 'send' && e.message?.t === 'input' && e.message.cmds.some(c => c.k === 'cast' && c.slot === 0 && c.seq === seq)),
    { n: before.wire, seq: sample.moveSeq });
    const cast = sent.message.cmds.find(c => c.k === 'cast' && c.slot === 0 && c.seq === sample.moveSeq);
    result.castSent = { at: absoluteAt(sent.at), frame: sent.frame, slot: cast.slot, seq: cast.seq,
      inputFrameSeq: sent.message.seq,
      x: cast.x, y: cast.y, actorRef: cast.actorRef, sameUnityFrame: sent.frame === sample.frame };
    result.deliveredTarget = deliveredTarget;

    await waitFor(() => driver.page.evaluate(({ n, ability, player, sendAt }) =>
      window.__rhLatency.wire.slice(n).some(e => e.kind === 'receive' && e.message?.t === 'fx' &&
        e.at + performance.timeOrigin >= sendAt && e.message.fx?.some(f =>
          ['castLanded', 'castEnded'].includes(f.k) && f.ability === ability && f.caster === player)),
    { n: before.wire, ability: spec.ability, player: driverId, sendAt: absoluteAt(sent.at) }), timeoutMs, `${spec.name} server-confirmed FX`);
    await waitFor(() => driver.page.evaluate(({ n, ability, sendAt, beforeCharges }) => window.__rhLatency.wire.slice(n).some(e =>
      e.kind === 'receive' && e.message?.t === 'snapshot' && e.at + performance.timeOrigin >= sendAt &&
      e.message.me?.wish?.ability === ability && e.message.me.wish.charges < beforeCharges),
    { n: before.wire, ability: spec.ability, sendAt: absoluteAt(sent.at), beforeCharges: beforeOwner.charges }),
    timeoutMs, `${spec.name} authoritative Wish owner spend`);

    const observations = await driver.page.evaluate(({ n, ability, player, sendAt }) => {
      const wire = window.__rhLatency.wire.slice(n);
      const candidates = [];
      for (const entry of wire) {
        if (entry.kind !== 'receive' || entry.message?.t !== 'fx' || entry.at + performance.timeOrigin < sendAt) continue;
        for (let i = 0; i < (entry.message.fx || []).length; i++) {
          const fx = entry.message.fx[i];
          if (['castStarted', 'castLanded', 'castEnded'].includes(fx.k) && fx.ability === ability) candidates.push({ kind: fx.k, ability: fx.ability,
            tick: entry.message.tick, eventTime: fx.eventTime, caster: fx.caster, target: fx.target, frameIndex: wire.indexOf(entry), fxIndex: i,
            receivedAt: performance.timeOrigin + entry.at });
        }
      }
      const snaps = wire.filter(e => e.kind === 'receive' && e.message?.t === 'snapshot').map(e => ({
        at: performance.timeOrigin + e.at, tick: e.message.tick, serverMs: e.message.serverMs, ack: e.message.ack,
        me: e.message.me ? { id: e.message.me.id, wish: e.message.me.wish } : null,
      }));
      const events = window.__rhLatency.events.slice().filter(e => e.at + performance.timeOrigin >= sendAt);
      const presentation = events.filter(e => ['presentWishStarted', 'presentWishLanded', 'presentWishEnded'].includes(e.kind) && e.ability === ability)
        .map((e, occurrence) => ({ kind: e.kind, ability: e.ability, sourceTime: e.sourceTime,
          at: performance.timeOrigin + e.at, frame: e.frame, player: e.player, occurrence }));
      return { candidates, snaps, presentation, overflow: window.__rhLatency.overflow,
        errors: [...window.__rhLatency.errors], epoch: performance.timeOrigin };
    }, { n: before.wire, ability: spec.ability, player: driverId, sendAt: absoluteAt(sent.at) });
    const observerHealth = await observer.page.evaluate(() => ({ overflow: window.__rhLatency.overflow, errors: [...window.__rhLatency.errors] }));
    const fx = observations.candidates.find(event => event.kind === 'castLanded' && event.caster === driverId);
    if (!fx) {
      const ended = observations.candidates.find(event => event.kind === 'castEnded' && event.caster === driverId);
      if (ended) throw new Error(`${spec.name} ended without a confirmed landing`);
      throw new Error(`no own-caster confirmed ${spec.name} landing after the actual Cast send`);
    }
    // Keep every confirmed event in wire receive order. Same-tick same-ability
    // events remain separate occurrences in evidence; selection below links the
    // presentation marker to one exact producer timestamp and kind.
    result.confirmedFxEvents = observations.candidates.map((event, occurrence) => ({ ...event, occurrence }));
    result.confirmedFx = { ...fx, presentationKind: `presentWish${fx.kind.slice('cast'.length)}` };

    await waitFor(() => driver.page.evaluate(({ ability, eventTime, player, receivedAt }) => window.__rhLatency.events.some(e =>
        e.kind === 'presentWishLanded' && e.ability === ability && e.player === player &&
        e.sourceTime === eventTime && e.at + performance.timeOrigin > receivedAt),
      { ability: spec.ability, eventTime: fx.eventTime, player: driverId, receivedAt: fx.receivedAt }), timeoutMs, `${spec.name} landed Unity presentation hook`)
      .catch(() => {});
    const presentationEvidence = await driver.page.evaluate(({ ability, eventTime, kind, player, receivedAt, sendAt }) => {
      const events = window.__rhLatency.events.filter(e => ['presentWishStarted', 'presentWishLanded', 'presentWishEnded'].includes(e.kind) &&
        e.ability === ability && e.at + performance.timeOrigin >= sendAt)
        .map((e, occurrence) => ({ kind: e.kind, ability: e.ability, sourceTime: e.sourceTime,
          at: performance.timeOrigin + e.at, frame: e.frame, player: e.player, occurrence }));
      const selected = events.find(e => e.sourceTime === eventTime && e.kind === kind && e.player === player && e.at > receivedAt);
      const forSourceEvent = selected || events.find(e => e.sourceTime === eventTime);
      return { events, selected: forSourceEvent };
    }, { ability: spec.ability, eventTime: fx.eventTime, kind: result.confirmedFx.presentationKind, player: driverId,
      receivedAt: fx.receivedAt, sendAt: absoluteAt(sent.at) });
    const shown = presentationEvidence.selected;
    result.wishPresented = shown;
    result.wishPresentationEvents = presentationEvidence.events;
    if (!shown || shown.kind !== 'presentWishLanded' || shown.player !== driverId || shown.at <= fx.receivedAt)
      throw new MissingHookError('confirmed own-caster landing lacks its exact own-caster Unity presentation marker');

    const ownerObs = observations.snaps.find(s => s.me?.wish?.ability === spec.ability && s.me.wish.charges < beforeOwner.charges);
    if (!ownerObs) throw new Error(`${spec.name} confirmed FX arrived without an authoritative owner charge update`);
    result.ownerUpdate = { ability: spec.ability, receivedAt: ownerObs.at,
      before: beforeOwner, after: copyOwner(ownerObs.me.wish), tick: ownerObs.tick, serverMs: ownerObs.serverMs };
    result.inputAcks = observations.snaps.map(({ at, tick, ack }) => ({ at, tick, ack }));

    const evidenceDir = path.join(root, 'tools/latency/wish-evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const screenshot = path.join(evidenceDir, `${spec.name.toLowerCase()}-unity-web.png`);
    await driver.page.screenshot({ path: screenshot });
    result.screenshot = path.relative(root, screenshot);

    const finalDriverHealth = await driver.page.evaluate(() => ({ overflow: window.__rhLatency.overflow, errors: [...window.__rhLatency.errors] }));
    const finalObserverHealth = await observer.page.evaluate(() => ({ overflow: window.__rhLatency.overflow, errors: [...window.__rhLatency.errors] }));
    result.traceOverflow = observations.overflow || observerHealth.overflow || finalDriverHealth.overflow || finalObserverHealth.overflow;
    result.traceErrors = [...observations.errors, ...observerHealth.errors, ...finalDriverHealth.errors, ...finalObserverHealth.errors];
    result.pageErrors = [...driver.runtimeErrors, ...observer.runtimeErrors];
    if (result.pageErrors.length) throw new Error('Unity browser page emitted runtime/console errors');
    result.status = 'pass';
    return result;
  } catch (error) {
    if (error instanceof MissingHookError) {
      result.status = 'incomplete'; result.incompleteReason = error.message;
    } else {
      result.status = 'fail'; result.failureReason = String(error?.message || error);
      result.error = String(error?.stack || error);
    }
    if (driver) result.driverRuntimeErrors = [...driver.runtimeErrors];
    if (observer) result.observerRuntimeErrors = [...observer.runtimeErrors];
    result.pageErrors = [...(driver?.runtimeErrors || []), ...(observer?.runtimeErrors || [])];
    const health = await Promise.all([driver, observer].filter(Boolean).map(async client => {
      try { return await client.page.evaluate(() => ({ errors: [...window.__rhLatency.errors], overflow: window.__rhLatency.overflow })); }
      catch (_) { return { errors: [], overflow: false }; }
    }));
    result.traceErrors = health.flatMap(item => item.errors);
    result.traceOverflow = health.some(item => item.overflow);
    return result;
  } finally {
    await Promise.all([driver?.page.close().catch(() => {}), observer?.page.close().catch(() => {})]);
    await stopServer(child);
  }
}

class MissingHookError extends Error {}

async function main() {
  let parsedPlayerUrl = null;
  try { parsedPlayerUrl = new URL(webUrl); } catch (_) { /* Report a bounded prerequisite below. */ }
  const report = { startedAt: new Date().toISOString(), playerUrl: parsedPlayerUrl?.origin || null,
    serverMode: 'one fresh local two-human duel server per faction/ability case, loopback only', protocol: 13,
    training: false, map: path.relative(root, mapFile),
    identities: { serverBinary: fileIdentity(serverBin), map: fileIdentity(mapFile) },
    expectedCases: CASES.length, cases: [], prerequisites: [], errors: [],
    notes: [
      'Only Playwright keyboard and pointer input is used. The probe decoder observes actual WebSocket frames; no protocol input is synthesized.',
      'R is sampled by Unity MatchClient.ReadInput; the Cast command must carry the same real order sequence and Unity frame.',
      'FX source eventTime is retained as a server-clock fact and is never subtracted from browser-local timings.',
      'Unity presentation hooks indicate managed presentation/update completion; they do not claim photon emission or display scanout.',
      'Each faction runs against a fresh server started with --wish-full, two legal duel-map human spawns, zero bot fill, and no training.',
      'Each case uses fresh browser pages and a fresh server process. High-volume Unity trace recording stays disabled during the opening-lock warm-up; browser and decoder errors and wire records remain active and are retained.',
      'Confirmed FX and Unity presentation occurrences are retained in receive/presentation order, including multiple same-tick events; the required own-caster landed pair is linked by exact kind and original eventTime.',
      'All endpoints are loopback-only. Server ports are dynamically selected by a short bind-zero probe; lsof verifies the direct child PID owns the exact loopback TCP listener before and after /info, before opening clients. A bind race fails without stopping another listener.',
      'Evidence records the actual server port, complete /info response, and SHA-256 identities for the server binary and duel map.',
    ] };

  if (!parsedPlayerUrl || !['http:', 'https:'].includes(parsedPlayerUrl.protocol) || !isLoopbackHost(parsedPlayerUrl.hostname))
    report.prerequisites.push('unity_web_url_must_be_http_or_https_loopback');
  if (parsedPlayerUrl && (parsedPlayerUrl.username || parsedPlayerUrl.password))
    report.prerequisites.push('unity_web_url_must_not_embed_credentials');
  if (portBase != null && (!Number.isInteger(portBase) || portBase < 1024 || portBase + CASES.length - 1 > 65535))
    report.prerequisites.push('explicit_port_base_must_fit_five_valid_ports');
  if (!fs.existsSync(serverBin)) report.prerequisites.push(`server_binary_missing:${path.relative(root, serverBin)}`);
  if (!fs.existsSync(mapFile)) report.prerequisites.push(`map_missing:${path.relative(root, mapFile)}`);
  else {
    try {
      const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      const spawns = map.spawns;
      const distance = Array.isArray(spawns) && spawns.length === 2 ? Math.hypot(spawns[0][0] - spawns[1][0], spawns[0][1] - spawns[1][1]) : Infinity;
      report.mapSpawns = spawns;
      report.mapSpawnDistance = distance;
      if (map.format !== 'rh-map/1' || !Array.isArray(spawns) || spawns.length !== 2 || !Number.isFinite(distance) || distance <= 0 || distance > 256)
        report.prerequisites.push('map_must_be_rh_map_1_with_two_nearby_legal_human_spawns');
    } catch (error) { report.prerequisites.push(`map_unreadable:${error.message}`); }
  }
  if (!report.prerequisites.some(item => item.startsWith('unity_web_url_must_be_'))) {
    try {
      const response = await fetch(webUrl);
      if (!response.ok) report.prerequisites.push(`unity_web_url_http_${response.status}`);
    } catch (_) { report.prerequisites.push('unity_web_url_unavailable'); }
  }

  let browser;
  if (!report.prerequisites.length) {
    try { browser = await loadPlaywright(root).chromium.launch({ headless: !(cli.headed || process.env.RH_WISH_HEADED === '1') }); }
    catch (error) { report.prerequisites.push(`playwright_unavailable:${error.message}`); }
  }
  if (browser) {
    try {
      for (let i = 0; i < CASES.length; i++) {
        const result = await runCase(browser, CASES[i], i, report);
        report.cases.push(result);
      }
    } catch (error) { report.errors.push(String(error?.stack || error)); }
    finally { await browser.close().catch(error => report.errors.push(`browser_close:${error}`)); }
  }
  if (report.cases.length < CASES.length) {
    for (const spec of CASES.slice(report.cases.length)) report.cases.push({ faction: spec.faction, ability: spec.ability,
      name: spec.name, status: 'incomplete', incompleteReason: 'not_run_due_to_missing_prerequisite_or_prior_harness_error' });
  }
  attachWishSummary(report);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.summary.status, output, prerequisites: report.prerequisites,
    errors: report.errors, caseStatuses: report.cases.map(c => ({ name: c.name, status: c.status,
      incompleteReason: c.incompleteReason, failureReason: c.failureReason })) }, null, 2));
  process.exitCode = report.summary.verdict.exitCode;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
