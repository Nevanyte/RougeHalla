// Minimal passive P14 release profiler. Caller owns browser launch, Hub UI, navigation and measurement timing.
// No page URL, account data, credential, raw frame or Unity application global is read or retained.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const PROTOCOL = 14;
const ACTIVE_GATE_MAX_AGE_MS = 5000;
const DEFAULT_HOOK = path.join(__dirname, 'webgl-profile-init.js');
const CODEC_PATH = path.resolve(__dirname, '../../..', 'crates/rh-server/web/probe.html');
const HEX64 = /^[0-9a-f]{64}$/;
const HASH16 = /^[0-9a-f]{16}$/;

function normalizeHash(value) {
  const text = String(value ?? '').replace(/^0x/i, '').toLowerCase();
  return /^[0-9a-f]{1,16}$/.test(text) ? text.padStart(16, '0') : null;
}

function validateIdentities(identities) {
  const build = identities?.build, server = identities?.server;
  if (!build || !server || build.protocol !== PROTOCOL || server.protocol !== PROTOCOL ||
      !HEX64.test(String(build.archiveSha256 || '').toLowerCase()) ||
      !HEX64.test(String(server.binarySha256 || '').toLowerCase())) {
    throw new TypeError('explicit P14 build archive and native binary identities are required');
  }
  const buildHash = normalizeHash(build.contentHash), serverHash = normalizeHash(server.contentHash);
  if (!buildHash || !serverHash || buildHash !== serverHash) throw new TypeError('build/server P14 content identities must match');
  return Object.freeze({
    build: Object.freeze({ protocol: PROTOCOL, contentHash: buildHash, archiveSha256: build.archiveSha256.toLowerCase() }),
    server: Object.freeze({ protocol: PROTOCOL, contentHash: serverHash, binarySha256: server.binarySha256.toLowerCase() }),
  });
}

function protocolCodec(html) {
  const start = html.indexOf('// ---- protocol v14 ');
  const end = html.indexOf('// ---- probe state', start);
  if (start < 0 || end <= start) throw new Error('P14 probe codec block is unavailable');
  const codec = new Function(`${html.slice(start, end)}\nreturn { PROTOCOL, decode, decodeClient, Tracker };`)();
  if (codec.PROTOCOL !== PROTOCOL) throw new Error('P14 probe codec block is unavailable');
  return codec;
}

function sampleStats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
  return { samples: sorted.length, p50: at(.50), p95: at(.95), p99: at(.99), max: sorted.length ? sorted.at(-1) : null };
}

function uniqueRafIntervals(frames) {
  const intervals = [];
  let previous = null;
  for (const frame of frames) {
    const timestamp = frame?.time;
    if (!Number.isFinite(timestamp)) continue;
    if (previous === null) { previous = timestamp; continue; }
    if (timestamp === previous || timestamp < previous) continue;
    intervals.push(timestamp - previous);
    previous = timestamp;
  }
  return intervals;
}

function bytesFromFrame(payload) {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  if (ArrayBuffer.isView(payload)) return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  // Playwright reports binary WebSocket payloads as base64 strings on some versions.
  if (typeof payload === 'string') return Buffer.from(payload, 'base64');
  return null;
}

function hex(bytes) { return Buffer.from(bytes).toString('hex'); }

function observerInitScript(webglHook) {
  return `${webglHook}\n;(() => {
    const p = window.__rhProfile;
    if (!p) throw new Error('WebGL profile hook did not initialize');
    p.rafFrames = []; p.longTasks = []; p.resourceSamples = []; p.collecting = false; p.overflow = false;
    const cap = (array, value, max) => { if (array.length < max) array.push(value); else p.overflow = true; };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function(callback) {
      return raf(function(ts) {
        if (!p.collecting) return callback(ts);
        const start = performance.now();
        try { return callback(ts); }
        finally {
          const end = performance.now();
          const wasmBytes = p.wasmMemories.length ? p.wasmMemories.reduce((n, m) => n + m.buffer.byteLength, 0) : null;
          cap(p.rafFrames, { time: ts,
            callbackMs: end - start, jsHeapBytes: performance.memory?.usedJSHeapSize ?? null, wasmBytes }, 100000);
        }
      });
    };
    try {
      const observer = new PerformanceObserver(list => {
        if (!p.collecting) return;
        for (const entry of list.getEntries()) cap(p.longTasks, { startTime: entry.startTime, duration: entry.duration }, 4096);
      });
      observer.observe({ type: 'longtask', buffered: false });
      p.longTaskAvailable = true;
    } catch { p.longTaskAvailable = false; }
    try {
      const observer = new PerformanceObserver(list => {
        if (!p.collecting) return;
        for (const e of list.getEntries()) cap(p.resourceSamples, { transferSize: e.transferSize || 0,
          encodedBodySize: e.encodedBodySize || 0, decodedBodySize: e.decodedBodySize || 0,
          duration: e.duration, initiatorType: e.initiatorType || '' }, 4096);
      });
      observer.observe({ type: 'resource', buffered: false });
      p.resourceObserverAvailable = true;
    } catch { p.resourceObserverAvailable = false; }
    p.beginMeasurement = function() {
      if (p.collecting) throw new Error('measurement already active');
      p.frames = []; p.gpuMs = []; p.gpuDisjoint = 0; p.rafFrames = []; p.longTasks = []; p.resourceSamples = [];
      p.overflow = false; p.collecting = true; p.measurementStart = performance.now();
      return p.measurementStart;
    };
    p.endMeasurement = function() {
      if (!p.collecting) throw new Error('measurement is not active');
      p.collecting = false; p.measurementEnd = performance.now();
      return { durationMs: p.measurementEnd - p.measurementStart, rafFrames: p.rafFrames, drawFrames: p.frames,
        gpuMs: p.gpuMs, gpuDisjoint: p.gpuDisjoint, contexts: p.contexts, buffersCreated: p.buffersCreated,
        buffersDeleted: p.buffersDeleted, longTasks: p.longTasks, longTaskAvailable: p.longTaskAvailable,
        resourceSamples: p.resourceSamples, resourceObserverAvailable: p.resourceObserverAvailable,
        overflow: p.overflow, visibility: document.visibilityState, devicePixelRatio: devicePixelRatio };
    };
  })();`;
}

function gateSnapshot(welcome, snapshot) {
  if (!welcome || !snapshot || snapshot.phase !== 1 || snapshot.training !== false || !snapshot.me ||
      snapshot.me.status !== 1 || snapshot.me.id !== welcome.player || welcome.protocol !== PROTOCOL ||
      welcome.contentHash !== welcome.expectedContentHash || !welcome.matchId) return null;
  return Object.freeze({ phase: snapshot.phase, training: false, tick: snapshot.tick,
    playerId: snapshot.me.id, matchId: welcome.matchId });
}

async function attachHubProfiler(page, { identities, probeHtmlPath = CODEC_PATH, webglHookPath = DEFAULT_HOOK } = {}) {
  if (!page || typeof page.addInitScript !== 'function' || typeof page.on !== 'function' || typeof page.evaluate !== 'function') {
    throw new TypeError('attachHubProfiler requires an approved Playwright page handle');
  }
  const pinned = validateIdentities(identities);
  const codec = protocolCodec(fs.readFileSync(probeHtmlPath, 'utf8'));
  const init = observerInitScript(fs.readFileSync(webglHookPath, 'utf8'));
  await page.addInitScript({ content: init });

  const state = { welcome: null, snapshotGate: null, snapshotObservedAt: null, tracker: new codec.Tracker(), measurement: false,
    errors: [], sentBytes: 0, receivedBytes: 0, rttObserverMs: [], pings: new Map(), droppedPings: 0,
    activeSocket: null, socketOpen: false, socketWelcomeReady: false, sockets: new Map(), pageListeners: [] };
  const fail = code => { if (!state.errors.includes(code)) state.errors.push(code); };
  const onSocket = socket => {
    const onSent = frame => observeFrame('sent', frame.payload);
    const onReceived = frame => observeFrame('received', frame.payload);
    const onClose = () => {
      if (state.activeSocket === socket) state.socketOpen = false;
      if (state.measurement) fail('websocket_closed_during_measurement');
    };
    const onError = () => {
      if (state.activeSocket === socket) state.socketOpen = false;
      if (state.measurement) fail('websocket_error_during_measurement');
    };
    socket.on('framesent', onSent); socket.on('framereceived', onReceived);
    socket.on('close', onClose); socket.on('socketerror', onError);
    state.sockets.set(socket, { onSent, onReceived, onClose, onError });
    if (state.measurement) fail('websocket_replaced_during_measurement');
    state.activeSocket = socket; state.socketOpen = true; state.socketWelcomeReady = false;
    state.snapshotGate = null; state.snapshotObservedAt = null;
  };
  function observeFrame(direction, payload) {
    const bytes = bytesFromFrame(payload);
    if (!bytes || bytes.length === 0) return;
    if (state.measurement) {
      if (direction === 'sent') state.sentBytes += bytes.length;
      else state.receivedBytes += bytes.length;
    }
    const tag = bytes[0];
    if (direction === 'sent' && tag === 0x03) {
      try {
        const message = codec.decodeClient(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        if (state.measurement) {
          if (state.pings.size >= 64) { state.pings.delete(state.pings.keys().next().value); state.droppedPings++; }
          state.pings.set(message.nonce, performance.now());
        }
      } catch { fail('ping_decode'); }
      return;
    }
    if (direction !== 'received' || (tag !== 0x81 && tag !== 0x82 && tag !== 0x83 && tag !== 0x87 && tag !== 0x86)) return;
    try {
      const message = codec.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      if (message.t === 'welcome') {
        state.socketWelcomeReady = true;
        const contentHash = message.content.toString(16).padStart(16, '0');
        const matchId = hex(message.match);
        state.tracker.apply(message); // Reset baseline; session bytes are not retained.
        state.snapshotGate = null; state.snapshotObservedAt = null;
        state.welcome = { protocol: message.protocol, contentHash, player: message.player, matchId,
          tickRate: message.tickRate, map: { width: message.map.w, height: message.map.h, collisionHash: message.map.hash,
            terrainMode: message.map.terrainMode, semanticHash: message.map.semanticHash, contextHash: message.map.contextHash } };
        if (message.protocol !== pinned.server.protocol || contentHash !== pinned.server.contentHash || contentHash !== pinned.build.contentHash) {
          fail('welcome_identity_mismatch');
        }
        if (state.measurement) fail('welcome_changed_during_measurement');
      } else if (message.t === 'reject') {
        fail('server_reject');
      } else if (message.t === 'snapshot' || message.t === 'delta') {
        const applied = state.tracker.apply(message);
        if (applied?.t === 'snapshot') {
          const projected = { phase: applied.phase, training: applied.training, tick: applied.tick, me: applied.me };
          state.snapshotGate = gateSnapshot(state.welcome && { ...state.welcome, expectedContentHash: pinned.server.contentHash }, projected);
          state.snapshotObservedAt = performance.now();
          if (state.measurement && !state.snapshotGate) fail('active_gate_lost_during_measurement');
        }
      } else if (message.t === 'pong' && state.measurement) {
        const sentAt = state.pings.get(message.nonce);
        if (sentAt !== undefined) {
          state.pings.delete(message.nonce);
          state.rttObserverMs.push(performance.now() - sentAt);
        }
      }
    } catch { fail('public_frame_decode'); }
  }
  page.on('websocket', onSocket);
  const onPageError = () => fail('page_error');
  const onPageCrash = () => { state.socketOpen = false; fail('page_crash'); };
  const onPageClose = () => { state.socketOpen = false; fail('page_closed'); };
  page.on('pageerror', onPageError); page.on('crash', onPageCrash); page.on('close', onPageClose);
  state.pageListeners.push(['websocket', onSocket], ['pageerror', onPageError], ['crash', onPageCrash], ['close', onPageClose]);

  let ended = false;
  return Object.freeze({
    identities: pinned,
    get publicWelcome() { return state.welcome && { ...state.welcome, map: { ...state.welcome.map } }; },
    get activeGate() { return state.snapshotGate && { ...state.snapshotGate }; },
    begin() {
      if (ended || state.measurement) throw new Error('profile collector is closed or already measuring');
      if (state.errors.length) throw new Error(`profile collector has errors: ${state.errors[0]}`);
      if (!gateSnapshot(state.welcome && { ...state.welcome, expectedContentHash: pinned.server.contentHash },
        state.snapshotGate && { ...state.snapshotGate, me: { id: state.snapshotGate.playerId, status: 1 } })) {
        throw new Error('profile collection requires a current public P14 active, alive, nontraining owner snapshot');
      }
      if (!state.socketOpen || !state.socketWelcomeReady) throw new Error('profile collection requires the current public game socket');
      if (state.snapshotObservedAt === null || performance.now() - state.snapshotObservedAt > ACTIVE_GATE_MAX_AGE_MS) {
        throw new Error('profile collection requires a fresh public active owner snapshot');
      }
      if (state.welcome.matchId !== state.snapshotGate.matchId || state.welcome.player !== state.snapshotGate.playerId) {
        throw new Error('profile collection active snapshot does not match the current public Welcome');
      }
      state.sentBytes = state.receivedBytes = 0; state.rttObserverMs = []; state.pings.clear(); state.droppedPings = 0;
      state.measurement = true;
      return page.evaluate(() => window.__rhProfile.beginMeasurement()).catch(error => {
        state.measurement = false; ended = true;
        throw error;
      });
    },
    async end() {
      if (!state.measurement || ended) throw new Error('profile collection is not active');
      const raw = await page.evaluate(() => window.__rhProfile.endMeasurement());
      state.measurement = false; ended = true;
      state.tracker.reset(); // Discard retained actor/self collections after producing the bounded projection.
      if (!state.socketOpen) fail('websocket_not_open_at_end');
      if (!state.socketWelcomeReady) fail('welcome_missing_at_end');
      if (!state.snapshotGate || state.snapshotObservedAt === null || performance.now() - state.snapshotObservedAt > ACTIVE_GATE_MAX_AGE_MS) {
        fail('active_gate_stale_or_missing_at_end');
      }
      const intervals = uniqueRafIntervals(raw.rafFrames);
      const fps = intervals.map(ms => ms > 0 ? 1000 / ms : null).filter(Number.isFinite);
      return {
        status: state.errors.length || raw.overflow ? 'INCOMPLETE' : 'CAPTURED',
        identities: pinned,
        publicWelcome: this.publicWelcome,
        gate: this.activeGate,
        window: { durationMs: raw.durationMs, visibility: raw.visibility, devicePixelRatio: raw.devicePixelRatio },
        raf: { rawCallbacks: raw.rafFrames, uniqueTimestampFrameTimeMs: sampleStats(intervals),
          fpsFromUniqueTimestamps: sampleStats(fps), callbackCpuMs: sampleStats(raw.rafFrames.map(f => f.callbackMs)) },
        webgl: { contexts: raw.contexts, drawFrames: raw.drawFrames, drawCount: sampleStats(raw.drawFrames.map(f => f.draws)),
          instances: sampleStats(raw.drawFrames.map(f => f.instances)),
          gpuElapsedMs: { alignment: 'UNALIGNED: the unchanged hook may resolve queries issued before measurement began; not a strict measurement-window distribution.',
            rawSamples: raw.gpuMs, summary: sampleStats(raw.gpuMs) },
          gpuDisjoint: raw.gpuDisjoint, timerQueryAvailable: !!raw.contexts?.[0]?.timerQuery,
          buffers: { createdDuringPage: raw.buffersCreated, deletedDuringPage: raw.buffersDeleted } },
        memory: { jsHeapBytes: sampleStats(raw.rafFrames.map(f => f.jsHeapBytes)), wasmBytes: sampleStats(raw.rafFrames.map(f => f.wasmBytes)) },
        longTasks: { available: raw.longTaskAvailable, raw: raw.longTasks, durationMs: sampleStats(raw.longTasks.map(t => t.duration)) },
        resources: { observerAvailable: raw.resourceObserverAvailable, raw: raw.resourceSamples,
          transferBytes: raw.resourceSamples.reduce((n, r) => n + r.transferSize, 0),
          encodedBodyBytes: raw.resourceSamples.reduce((n, r) => n + r.encodedBodySize, 0) },
        websocket: { sentApplicationBytes: state.sentBytes, receivedApplicationBytes: state.receivedBytes,
          observerCallbackRttMs: { rawSamples: state.rttObserverMs, summary: sampleStats(state.rttObserverMs) }, unmatchedPings: state.pings.size,
          droppedPingMatches: state.droppedPings },
        observerErrors: state.errors.slice(), overflow: raw.overflow,
        notes: ['Observer callback RTT is measured between Playwright frame callbacks; it is not the Unity Session RttSample.',
          'WebSocket byte counts are application payload bytes, not TLS, TCP, retransmission or network-interface bytes.',
          'RAF intervals include browser pacing. callbackMs is observer-wrapped synchronous callback time, not Unity PlayerLoop or total browser CPU.',
          'GPU timer values are retained raw but unaligned because the unchanged WebGL hook can resolve pre-window queries; they are not a strict measurement-window statistic. Missing/disjoint values are not zero.',
          'WebGL buffer counters are page-lifetime counts because the unchanged shared hook does not expose resettable baselines.'],
      };
    },
    detach() {
      for (const [event, listener] of state.pageListeners) page.off?.(event, listener);
      for (const [socket, listeners] of state.sockets) {
        socket.off?.('framesent', listeners.onSent); socket.off?.('framereceived', listeners.onReceived);
        socket.off?.('close', listeners.onClose); socket.off?.('socketerror', listeners.onError);
      }
      state.sockets.clear(); state.pings.clear(); state.tracker.reset(); ended = true;
    },
  });
}

module.exports = { attachHubProfiler, sampleStats, uniqueRafIntervals, validateIdentities, gateSnapshot, protocolCodec };
