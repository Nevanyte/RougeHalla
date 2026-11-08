'use strict';

// Real Unity WebGL latency proof. Inputs are Playwright keyboard events; no protocol frames or simulation state are injected/read.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(os.homedir(), '.codex/tools/rougehalla-stage2/browser/node_modules/playwright'));
const { startProxy } = require('./ws-proxy.cjs');
const { attachSummary, quantiles } = require('./report.cjs');

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith('--')) throw new Error(`unexpected argument ${item}`);
    const key = item.slice(2);
    if (key === 'headed') out.headed = true;
    else if (key === 'sweep') out.rtts = [0, 50, 100, 150];
    else if (key === 'help') out.help = true;
    else {
      const value = argv[++i]; if (value == null || value.startsWith('--')) throw new Error(`missing value for ${item}`);
      out[key] = value;
    }
  }
  return out;
}

const cli = argsOf(process.argv.slice(2));
if (cli.help) {
  console.log('Usage: node tools/latency/e2e.cjs [--url PLAYER_URL] [--server-url WS_URL] [--rtt-ms N | --sweep] [--jitter-ms N] [--trials N] [--stall-every N --stall-ms N] [--headed]');
  process.exit(0);
}
const root = path.resolve(__dirname, '../..');
const webUrl = cli.url || process.env.RH_LATENCY_PAGE_URL || 'http://127.0.0.1:8097/';
const pageAddress = new URL(webUrl);
const queryServer = pageAddress.searchParams.get('server');
const sameOriginServer = new URL('/ws', pageAddress);
sameOriginServer.protocol = pageAddress.protocol === 'https:' ? 'wss:' : 'ws:';
const serverUrl = new URL(cli['server-url'] || process.env.RH_LATENCY_SERVER_URL || queryServer ||
  (pageAddress.protocol === 'https:' ? sameOriginServer.toString() : 'ws://127.0.0.1:7797/ws'));
const credentials = process.env.RH_LATENCY_CREDENTIALS_FILE
  ? JSON.parse(fs.readFileSync(process.env.RH_LATENCY_CREDENTIALS_FILE, 'utf8')) : null;
const safePlayerUrl = new URL(webUrl);
safePlayerUrl.search = ''; // Credentials and nested endpoint query strings do not belong in saved reports.
const profileRtts = cli.rtts || [Number(cli['rtt-ms'] ?? process.env.RH_LATENCY_RTT_MS ?? 0)];
const jitterMs = Number(cli['jitter-ms'] ?? process.env.RH_LATENCY_JITTER_MS ?? 0);
const trialsPerProfile = Math.max(1, Math.min(20, Number(cli.trials ?? process.env.RH_LATENCY_TRIALS ?? 1)));
const timeoutMs = Math.max(1000, Number(process.env.RH_LATENCY_TIMEOUT_MS || 20000));
const output = process.env.RH_LATENCY_OUTPUT || path.join(root, 'tools/latency/latency-report.json');
const html = fs.readFileSync(path.join(root, 'crates/rh-server/web/probe.html'), 'utf8');
const decoderSource = html.slice(html.search(/\/\/ ---- protocol v\d+/), html.indexOf('// ---- probe state'));
const decoderBundle = `${decoderSource}\nreturn { Tracker, decode, decodeClient };`;
const keys = ['d', 'a', 's', 'w'];

function initProbe(source) {
  const { Tracker, decode, decodeClient } = new Function(source)();
  const state = window.__rhLatency = { events: [], wire: [], keyEvents: [], errors: [], overflow: false, frame: null, tracker: new Tracker() };
  const push = (list, item) => { if (list.length < 20000) list.push(item); else state.overflow = true; };
  window.__rhLatencyMark = (kind, frame, player, moveSeq, x, y) => {
    state.frame = frame;
    push(state.events, { kind, frame, player, moveSeq, x, y, at: performance.now() });
  };
  addEventListener('keydown', event => push(state.keyEvents, { code: event.code, at: performance.now() }), true);
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
        try { message = decodeClient(bytes(data).buffer); } catch (error) { push(state.errors, `send decode: ${error}`); }
        push(state.wire, { kind: 'send', at, frame: state.frame, message });
        return originalSend(data);
      };
      socket.addEventListener('message', event => {
          const at = performance.now();
          let message = null, applied = null;
          try { message = decode(bytes(event.data).buffer); applied = state.tracker.apply(message); }
          catch (error) { push(state.errors, `receive decode: ${error}`); }
          push(state.wire, { kind: 'receive', at, message: applied || message,
            me: applied?.t === 'snapshot' ? applied.me : null });
      }, true);
      return socket;
    }
  });
}

function observerState(page, label) {
  const state = { page, label, latest: null, player: null, rejects: [], errors: [], sockets: 0 };
  page.on('pageerror', error => state.errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') state.errors.push(message.text()); });
  page.on('websocket', socket => {
    state.sockets++;
    const { Tracker, decode } = new Function(decoderBundle)();
    const tracker = new Tracker();
    socket.on('framereceived', frame => {
      try {
        const payload = frame.payload;
        const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        const message = decode(Uint8Array.from(bytes).buffer);
        if (message.t === 'welcome') state.player = message.player;
        if (message.t === 'reject') state.rejects.push({ at: Date.now(), code: message.code, reason: message.reason });
        const applied = tracker.apply(message);
        if (applied?.t === 'snapshot') state.latest = JSON.parse(JSON.stringify(applied));
      } catch (error) { state.errors.push(`network observer: ${error}`); }
    });
  });
  return state;
}

async function waitFor(predicate, ms, description) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  if (!(await predicate())) throw new Error(`timed out waiting for ${description}`);
}

const epochMs = (timeOrigin, at) => timeOrigin + at;

// A snapshot can be stationary while the observer is still drawing an earlier segment.
// Require both the received pose and the actual presented pose to agree and remain still.
async function settledBaseline(driver, observer, remoteId, settleMs, timeout) {
  let previous = null, stableSince = Date.now();
  let result = null;
  await waitFor(async () => {
    const actor = observer.latest?.actors.find(a => a.id === remoteId);
    const me = driver.latest?.me;
    if (!actor || !me) return false;
    const pose = `${actor.x},${actor.y},${me.x},${me.y},${me.moveSeq}`;
    if (pose !== previous) { previous = pose; stableSince = Date.now(); }
    const drawn = await observer.page.evaluate(id => {
      const e = window.__rhLatency.events.findLast(e => e.kind === 'presentActor' && e.player === id);
      return e ? { ...e, epoch: performance.timeOrigin + e.at } : null;
    }, remoteId);
    if (!drawn || Math.abs(drawn.x - actor.x) > .001 || Math.abs(drawn.y - actor.y) > .001) {
      stableSince = Date.now(); return false;
    }
    result = { at: drawn.epoch, actor: remoteId, kind: actor.kind, x: drawn.x, y: drawn.y,
      tick: observer.latest.tick, stableMs: Date.now() - stableSince };
    return result.stableMs >= settleMs;
  }, timeout, 'stationary received and rendered opponent baseline after Stop');
  return result;
}

async function run() {
  const httpInfoUrl = new URL('/info', serverUrl);
  httpInfoUrl.protocol = serverUrl.protocol === 'wss:' ? 'https:' : 'http:';
  httpInfoUrl.port = serverUrl.port;
  const allowSelfSigned = process.env.RH_LATENCY_ALLOW_SELF_SIGNED === '1';
  if (allowSelfSigned && !['localhost', '127.0.0.1', '[::1]'].includes(serverUrl.hostname))
    throw new Error('Self-signed TLS test mode is restricted to loopback endpoints.');
  let serverInfo;
  if (allowSelfSigned && httpInfoUrl.protocol === 'https:') {
    serverInfo = await new Promise((resolve, reject) => {
      require('node:https').get(httpInfoUrl, { rejectUnauthorized: false }, response => {
        let body = ''; response.on('data', chunk => { body += chunk; });
        response.on('end', () => {
          try { if (response.statusCode !== 200) throw new Error(`/info HTTP ${response.statusCode}`); resolve(JSON.parse(body)); }
          catch (error) { reject(error); }
        });
      }).on('error', reject);
    });
  } else {
    const info = await fetch(httpInfoUrl);
    if (!info.ok) throw new Error(`/info returned HTTP ${info.status}`);
    serverInfo = await info.json();
  }
  const direct = process.env.RH_LATENCY_DIRECT === '1' || serverUrl.protocol === 'wss:' || pageAddress.protocol === 'https:';
  if (direct && !['localhost', '127.0.0.1', '[::1]'].includes(serverUrl.hostname) && !credentials)
    throw new Error('An external endpoint requires RH_LATENCY_CREDENTIALS_FILE with authorized driver and observer test profiles/tokens.');
  if (direct && profileRtts.length !== 1) throw new Error('direct mode supports one measured profile per run; RTT sweep requires local ws://');
  if (direct && (Number(profileRtts[0]) !== 0 || jitterMs !== 0))
    throw new Error('Direct mode measures the actual endpoint; RTT/jitter injection requires a local ws:// proxy.');
  let proxy = null;
  if (!direct) {
    const baseHost = serverUrl.hostname;
    const targetPort = Number(serverUrl.port || 80);
    proxy = await startProxy({ targetHost: baseHost, targetPort, oneWayMs: Number(profileRtts[0]) / 2, jitterMs: jitterMs / 2,
      seed: Number(process.env.RH_LATENCY_SEED || 72617), stallEvery: Number(cli['stall-every'] ?? process.env.RH_LATENCY_STALL_EVERY ?? 0),
      stallMs: Number(cli['stall-ms'] ?? process.env.RH_LATENCY_STALL_MS ?? 0) });
  }
  let browser;
  let pages = [];
  const report = { startedAt: new Date().toISOString(), playerUrl: safePlayerUrl.toString(), direct,
    tls: allowSelfSigned ? 'loopback self-signed fixture; certificate validation skipped explicitly' : 'normal certificate validation',
    serverIdentity: { protocol: serverInfo.protocol, contentHash: serverInfo.contentHash },
    serverUrl: `${serverUrl.protocol}//${serverUrl.host}${serverUrl.pathname}`,
    profiles: profileRtts.map((rttMs, index) => ({ rttMs, jitterMs, injected: !direct, meaning: 'added delay, not total measured RTT', seed: 72617 + index })),
    trials: [], errors: [], notes: [
      'sampleMove is emitted by Unity ReadInput after sampling the browser keyboard input and includes the actual order sequence.',
      'WebSocket send/receive times are captured inside the browser with performance.now and use the page timeOrigin for correlation.',
      'Self echo is an accepted decoded snapshot whose me.moveSeq matches the sent order; ack_input is deliberately not used.',
      'Self/opponent presentation endpoints are post-Present Unity traces, not photon emission or confirmed display scanout.',
      'The proxy delays ordered TCP byte-stream chunks. It preserves reliability/order; configured stalls are head-of-line delays, not packet loss.'
    ] };
  report.expectedTrials = profileRtts.length * trialsPerProfile;
  try {
    browser = await chromium.launch({ headless: !(cli.headed || process.env.RH_LATENCY_HEADED === '1') });
    const navigation = [];
    for (const label of ['driver', 'observer']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: allowSelfSigned });
      await page.addInitScript(initProbe, decoderBundle);
      const state = observerState(page, label); pages.push(state);
      const url = new URL(webUrl);
      if (proxy) url.searchParams.set('server', proxy.url);
      else if (!url.searchParams.has('server')) url.searchParams.set('server', serverUrl.toString());
      const profilePrefix = label === 'driver' ? 'ld' : 'lo';
      const profile = `${profilePrefix}${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 6)}`;
      const credential = credentials?.[label];
      if (credentials && (!credential || !/^[A-Za-z0-9_-]{2,16}$/.test(credential.profile) || typeof credential.token !== 'string' || !credential.token))
        throw new Error(`Missing or invalid ${label} test credential (values are not logged).`);
      url.searchParams.set('profile', credential?.profile || profile.slice(0, 15));
      url.searchParams.set('token', credential?.token || 'latency-local'); url.searchParams.set('faction', '4'); url.searchParams.set('auto', '1');
      navigation.push(page.goto(url.toString(), { waitUntil: 'load', timeout: 120000 }));
    }
    await Promise.all(navigation);
    const [driver, observer] = pages;
    await waitFor(() => driver.rejects.length || observer.rejects.length ||
      (driver.latest?.me && observer.latest?.me && driver.latest.phase === 1 && observer.latest.phase === 1), timeoutMs, 'both Unity clients active or an admission reject');
    if (driver.rejects.length || observer.rejects.length)
      throw new Error(`Unity admission rejected: ${JSON.stringify({ driver: driver.rejects, observer: observer.rejects })}`);
    // Observer-local actor references are not compared with the driver's Welcome ID. A duel has exactly one remote human.
    const remotePlayers = observer.latest.actors.filter(actor => actor.kind === 0);
    if (remotePlayers.length !== 1) throw new Error(`required opponent observation needs exactly one remote human actor; saw ${remotePlayers.length}`);
    const remote = remotePlayers[0];
    const observerEpoch = await observer.page.evaluate(() => performance.timeOrigin);
    report.players = { driver: driver.latest.me.id, observerSelf: observer.latest.me.id, observerRemoteHumanCount: remotePlayers.length };

    for (let profileIndex = 0; profileIndex < profileRtts.length; profileIndex++) {
      const rttMs = Number(profileRtts[profileIndex]);
      if (!Number.isFinite(rttMs) || rttMs < 0) throw new Error(`invalid RTT ${rttMs}`);
      if (proxy) proxy.setProfile({ rttMs, jitterMs, stallEvery: Number(cli['stall-every'] ?? process.env.RH_LATENCY_STALL_EVERY ?? 0),
        stallMs: Number(cli['stall-ms'] ?? process.env.RH_LATENCY_STALL_MS ?? 0) });
      report.currentProfile = { rttMs, jitterMs };
      for (let trialIndex = 0; trialIndex < trialsPerProfile; trialIndex++) {
        const baselineActor = await settledBaseline(driver, observer, remote.id, Math.max(350, rttMs + jitterMs + 200), timeoutMs);
        const driverBefore = driver.latest.me;
        const traceBefore = await driver.page.evaluate(() => ({ events: window.__rhLatency.events.length, keyEvents: window.__rhLatency.keyEvents.length, wire: window.__rhLatency.wire.length }));
        const observerTraceBefore = await observer.page.evaluate(() => window.__rhLatency.events.length);
        const key = driverBefore.x < 190 ? 'd' : 'a';
        await driver.page.locator('#unity-canvas').focus();
        await driver.page.keyboard.down(key);
        await waitFor(() => driver.page.evaluate(count => window.__rhLatency.events.slice(count).some(e => e.kind === 'sampleMove'), traceBefore.events),
          timeoutMs, 'Unity sampleMove hook');
        await waitFor(() => driver.page.evaluate(count => window.__rhLatency.wire.slice(count).some(e => e.kind === 'send' && e.message?.t === 'input' && e.message.cmds.some(c => c.k === 'move')),
          traceBefore.wire),
          timeoutMs, 'real Unity websocket Move frame');

        const data = await driver.page.evaluate((counts, base) => ({
          timeOrigin: performance.timeOrigin,
          overflow: window.__rhLatency.overflow,
          errors: [...window.__rhLatency.errors],
          events: window.__rhLatency.events.slice(counts.events),
          keyEvents: window.__rhLatency.keyEvents.slice(counts.keyEvents),
          wire: window.__rhLatency.wire.slice(counts.wire),
          baseline: base
        }), traceBefore, { x: driverBefore.x, y: driverBefore.y });
        const trialKeyEvent = data.keyEvents.find(e => e.code === `Key${key.toUpperCase()}`);
        const sample = data.events.find(e => e.kind === 'sampleMove' && e.moveSeq !== 0);
        if (!sample) throw new Error('no nonzero sampleMove sequence observed');
        const sampleAt = epochMs(data.timeOrigin, sample.at);
        const sendRecord = data.wire.find(e => e.kind === 'send' && e.message?.t === 'input' && e.frame === sample.frame &&
          e.message.cmds.some(c => c.k === 'move' && c.seq === sample.moveSeq));
        const sendAnyFrame = data.wire.find(e => e.kind === 'send' && e.message?.t === 'input' &&
          e.message.cmds.some(c => c.k === 'move' && c.seq === sample.moveSeq));
        const actualSend = sendRecord || sendAnyFrame;
        const sentCommand = actualSend?.message.cmds.find(c => c.k === 'move' && c.seq === sample.moveSeq);
        const sendAt = actualSend ? epochMs(data.timeOrigin, actualSend.at) : null;
        await waitFor(() => driver.page.evaluate(({seq, since}) => window.__rhLatency.wire.some(e => e.at >= since && e.kind === 'receive' &&
          e.message?.t === 'snapshot' && e.me?.moveSeq === seq), {seq: sample.moveSeq, since: sample.at}), timeoutMs, `accepted self move_seq echo ${sample.moveSeq}`);
        await waitFor(() => driver.page.evaluate(({seq, since}) => window.__rhLatency.events.some(e => e.at >= since && e.kind === 'presentSelf' && e.moveSeq === seq), {seq: sample.moveSeq, since: sample.at}),
          timeoutMs, `post-Present local move_seq ${sample.moveSeq}`);
        const final = await driver.page.evaluate(({seq, since}) => ({
          timeOrigin: performance.timeOrigin,
          echo: window.__rhLatency.wire.find(e => e.at >= since && e.kind === 'receive' && e.message?.t === 'snapshot' && e.me?.moveSeq === seq),
          presented: window.__rhLatency.events.find(e => e.at >= since && e.kind === 'presentSelf' && e.moveSeq === seq),
          overflow: window.__rhLatency.overflow,
          errors: [...window.__rhLatency.errors]
        }), {seq: sample.moveSeq, since: sample.at});
        const echoAt = final.echo ? epochMs(final.timeOrigin, final.echo.at) : null;
        const presentAt = final.presented ? epochMs(final.timeOrigin, final.presented.at) : null;
        await driver.page.keyboard.up(key);
        const trial = {
          profile: { rttMs, jitterMs, injected: !direct }, index: trialIndex + 1, key,
          keyboardEvent: trialKeyEvent ? { at: epochMs(data.timeOrigin, trialKeyEvent.at) } : null,
          inputSample: { at: sampleAt, frame: sample.frame, player: sample.player, seq: sample.moveSeq, x: sample.x, y: sample.y },
          moveSent: sentCommand && actualSend ? { at: sendAt, frame: actualSend.frame, seq: sentCommand.seq, x: sentCommand.x, y: sentCommand.y,
            sameUnityFrame: !!sendRecord } : null,
          selfEcho: final.echo?.me ? { at: echoAt, seq: final.echo.me.moveSeq, x: final.echo.me.x, y: final.echo.me.y,
            tick: final.echo.message.tick } : null,
          selfPresented: final.presented ? { at: presentAt, seq: final.presented.moveSeq, x: final.presented.x, y: final.presented.y,
            frame: final.presented.frame } : null,
          opponentBaseline: baselineActor
        };
        if (trialKeyEvent) trial.keyboardToSendMs = sendAt - trial.keyboardEvent.at;
        trial.sampleToSendMs = sendAt - sampleAt;
        trial.sendToEchoMs = echoAt - sendAt;
        trial.echoToPresentMs = presentAt - echoAt;
        trial.sampleToPresentMs = presentAt - sampleAt;
        const moved = () => observer.latest?.actors.find(actor => actor.id === remote.id);
        await waitFor(() => {
          const actor = moved(); return actor && (actor.x !== baselineActor.x || actor.y !== baselineActor.y);
        }, timeoutMs, 'observer received opponent movement');
        await waitFor(() => observer.page.evaluate(({ actorId, count, x, y, since }) => window.__rhLatency.events.slice(count).some(e =>
          performance.timeOrigin + e.at >= since && e.kind === 'presentActor' && e.player === actorId && (Math.abs(e.x - x) > .001 || Math.abs(e.y - y) > .001)),
        { actorId: remote.id, count: observerTraceBefore, x: baselineActor.x, y: baselineActor.y, since: sendAt }), timeoutMs, 'post-Present opponent movement');
        const observerData = await observer.page.evaluate(({ actorId, count }) => ({
          timeOrigin: performance.timeOrigin,
          overflow: window.__rhLatency.overflow,
          errors: [...window.__rhLatency.errors],
          events: window.__rhLatency.events.slice(count).filter(e => e.kind === 'presentActor' && e.player === actorId)
        }), { actorId: remote.id, count: observerTraceBefore });
        const presentedActor = observerData.events.find(e => epochMs(observerData.timeOrigin, e.at) >= sendAt &&
          (Math.abs(e.x - baselineActor.x) > .001 || Math.abs(e.y - baselineActor.y) > .001));
        trial.opponentPresented = presentedActor ? { at: epochMs(observerData.timeOrigin, presentedActor.at), actor: presentedActor.player,
          x: presentedActor.x, y: presentedActor.y, frame: presentedActor.frame } : null;
        trial.sampleToOpponentMs = trial.opponentPresented ? trial.opponentPresented.at - sampleAt : null;
        trial.traceOverflow = data.overflow || final.overflow || observerData.overflow;
        trial.traceErrors = [...data.errors, ...final.errors, ...observerData.errors];
        report.trials.push(trial);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    report.proxyRun = proxy?.report() || { direct, note: 'Direct endpoint observation; no impairment proxy.' };
  } catch (error) {
    report.errors.push(String(error?.stack || error));
  } finally {
    report.pageErrors = pages.flatMap(page => page.errors.map(error => `${page.label}: ${error}`));
    report.transportObservations = [];
    for (const state of pages) {
      try {
        const observed = await state.page.evaluate(() => {
          const trace = window.__rhLatency;
          const pings = new Map(), rtts = [], snapshots = [], frames = [];
          for (const event of trace.wire) {
            if (event.kind === 'send' && event.message?.t === 'ping') pings.set(event.message.nonce, event.at);
            if (event.kind === 'receive' && event.message?.t === 'pong' && pings.has(event.message.nonce))
              rtts.push(event.at - pings.get(event.message.nonce));
            if (event.kind === 'receive' && event.message?.t === 'snapshot') snapshots.push(event.at);
          }
          for (const event of trace.events) if (event.kind === 'frameStart') frames.push(event.at);
          const gaps = list => list.slice(1).map((at, index) => at - list[index]);
          return { rtts, snapshotGaps: gaps(snapshots), frameGaps: gaps(frames) };
        });
        report.transportObservations.push({ client: state.label, socketRtt: quantiles(observed.rtts),
          snapshotDeliveryGap: quantiles(observed.snapshotGaps), unityFrameGap: quantiles(observed.frameGaps) });
      } catch (error) { report.errors.push(`transport observer ${state.label}: ${error}`); }
    }
    if (browser) await browser.close();
    report.proxyRun = proxy?.report() || { direct, note: 'Direct endpoint observation; no impairment proxy.' };
    if (proxy) await proxy.close();
    attachSummary(report);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    let serialized = JSON.stringify(report, null, 2);
    for (const credential of Object.values(credentials || {})) {
      if (credential?.token) serialized = serialized.split(credential.token).join('[redacted]');
    }
    serialized = serialized.replace(/([?&](?:token|ticket|resume)=)[^&\s"\\]+/gi, '$1[redacted]');
    fs.writeFileSync(output, serialized + '\n');
    const saved = JSON.parse(serialized);
    console.log(JSON.stringify({ status: report.summary.status, profiles: profileRtts, trials: report.trials.length,
      summary: report.summary, errors: saved.errors, report: output }, null, 2));
    process.exitCode = report.summary.verdict.exitCode;
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
