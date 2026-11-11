import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const EXPECTED_PROTOCOL = 17;
const EXPECTED_CONTENT_HASH = 'b35f23ed00df75b3';
const MAX_COMMANDS = 16;
const MAX_EVENT_ROWS = 512;
const PROFILE_RE = /^[A-Za-z0-9_-]{2,16}$/;
const ALLOWED_COMMANDS = new Set([
  'move', 'attackMove', 'swap', 'pickup', 'choose', 'plan', 'useConsumable',
  'target', 'huntTarget', 'consumeCorpse', 'questAccept', 'trade',
  'cast', 'stop', 'aim', 'attack', 'release',
]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const probePath = path.join(repoRoot, 'crates/rh-server/web/probe.html');

function loadCodec() {
  const html = readFileSync(probePath, 'utf8');
  const start = html.indexOf('// ---- protocol v17 ');
  const end = html.indexOf('// ---- probe state', start);
  if (start < 0 || end <= start) throw new Error('protocol v17 codec block is unavailable');
  const source = html.slice(start, end);
  const codec = new Function(`${source}\nreturn { PROTOCOL, hello, input, decode, decodeClient, Tracker, ping, leave };`)();
  if (codec.PROTOCOL !== EXPECTED_PROTOCOL) throw new Error('protocol v17 codec block is unavailable');
  return codec;
}

const CODEC = loadCodec();

function loopbackBase(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new TypeError('endpoint must be a loopback HTTP(S) origin'); }
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(host) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('endpoint must be a queryless loopback HTTP(S) origin');
  }
  return url;
}

function normalizedHash(value) {
  const s = String(value).replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{1,16}$/.test(s)) return null;
  return s.padStart(16, '0');
}

function randomProfile() {
  return `r14_${randomBytes(5).toString('hex')}`;
}

function bytesBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  throw new TypeError('server frame is not binary');
}

function detached(value) {
  return structuredClone(value);
}

function safeWelcome(message) {
  return {
    player: message.player,
    protocol: message.protocol,
    contentHash: message.content.toString(16).padStart(16, '0'),
    match: Array.from(message.match),
    tick: message.tick,
    tickRate: message.tickRate,
    map: detached(message.map),
  };
}

class NormalCompanion {
  #socket;
  #tracker;
  #expectedHash;
  #connected = false;
  #closed = false;
  #leaving = false;
  #failure = null;
  #welcome = null;
  #snapshot = null;
  #stateTick = null;
  #events = [];
  #rejects = [];
  #counters = { snapshots: 0, states: 0, eventFrames: 0, fxFrames: 0, sentInputs: 0 };
  #waiters = new Set();
  #heartbeat = null;
  #inputSeq = 0;
  #moveSeq = 0;
  #nonce = 0;
  #profile;

  constructor(socket, profile, expectedHash) {
    this.#socket = socket;
    this.#profile = profile;
    this.#expectedHash = expectedHash;
    this.#tracker = new CODEC.Tracker();
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => { this.#connected = true; this.#notify(); });
    socket.addEventListener('message', event => this.#onMessage(event.data));
    socket.addEventListener('error', () => { if (!this.#leaving) this.#fail('websocket_error'); });
    socket.addEventListener('close', () => {
      this.#connected = false;
      this.#closed = true;
      if (!this.#failure && !this.#leaving) this.#failure = 'websocket_closed';
      this.#stopHeartbeat();
      this.#notify();
    });
  }

  get profile() { return this.#profile; }
  get connected() { return this.#connected && !this.#closed; }

  view() {
    return {
      connected: this.connected,
      welcome: this.#welcome ? detached(this.#welcome) : null,
      snapshot: this.#snapshot ? detached(this.#snapshot) : null,
      stateTick: this.#stateTick ?? null,
      collections: [...this.#tracker.collections.entries()].map(([key, value]) => [key, detached(value)]),
      events: detached(this.#events),
      rejects: detached(this.#rejects),
      errors: this.#failure ? [this.#failure] : [],
      counters: { ...this.#counters },
    };
  }

  #onMessage(data) {
    if (this.#closed || this.#failure) return;
    try {
      const message = this.#tracker.decode(bytesBuffer(data));
      if (message.t === 'welcome') {
        const hash = normalizedHash(message.content.toString(16));
        if (message.protocol !== EXPECTED_PROTOCOL || hash !== this.#expectedHash) {
          this.#fail('welcome_identity_mismatch');
          return;
        }
        this.#welcome = safeWelcome(message); // Deliberately omit the private resume session.
      } else if (message.t === 'snapshot') {
        this.#snapshot = message;
        this.#counters.snapshots++;
      } else if (message.t === 'state') {
        this.#stateTick = message.tick;
        this.#counters.states++;
      } else if (message.t === 'events') {
        this.#counters.eventFrames++;
        this.#events.push(...message.events.map(row => detached(row)));
        if (this.#events.length > MAX_EVENT_ROWS) this.#events.splice(0, this.#events.length - MAX_EVENT_ROWS);
      } else if (message.t === 'fx') {
        this.#counters.fxFrames++;
        this.#events.push(...message.fx.map(row => detached(row)));
        if (this.#events.length > MAX_EVENT_ROWS) this.#events.splice(0, this.#events.length - MAX_EVENT_ROWS);
      } else if (message.t === 'reject') {
        this.#rejects.push({ code: message.code });
        if (this.#rejects.length > MAX_EVENT_ROWS) this.#rejects.shift();
        this.#fail('server_rejected');
        return;
      }
      this.#notify();
    } catch {
      this.#fail('malformed_server_frame');
    }
  }

  #fail(code) {
    if (this.#failure || this.#leaving) return;
    this.#failure = code;
    this.#connected = false;
    this.#closed = true;
    this.#stopHeartbeat();
    try { this.#socket.close(1002, 'protocol error'); } catch { /* fixed local failure only */ }
    this.#notify();
  }

  #notify() {
    for (const waiter of [...this.#waiters]) waiter.check();
  }

  #stopHeartbeat() {
    if (this.#heartbeat !== null) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  startHeartbeat(intervalMs = 1000) {
    if (this.#heartbeat !== null || !this.connected) return;
    this.#heartbeat = setInterval(() => {
      if (!this.connected) return;
      this.#nonce = (this.#nonce + 1) >>> 0;
      try { this.#socket.send(CODEC.ping(this.#nonce)); }
      catch { this.#fail('heartbeat_send_failed'); }
    }, intervalMs);
    this.#heartbeat.unref?.();
  }

  send(commands) {
    if (!this.connected || !this.#welcome) throw new Error('companion is not admitted');
    if (!Array.isArray(commands) || commands.length < 1 || commands.length > MAX_COMMANDS ||
        commands.some(command => !command || !ALLOWED_COMMANDS.has(command.k))) {
      throw new TypeError('send accepts 1..16 ordinary public commands');
    }
    const nextSeq = (this.#inputSeq + 1) >>> 0;
    const rows = commands.map(command => {
      const row = { ...command };
      if ((row.k === 'move' || row.k === 'attackMove' || row.k === 'stop') && row.seq == null) {
        this.#moveSeq = (this.#moveSeq + 1) & 255;
        row.seq = this.#moveSeq;
      }
      return row;
    });
    const frame = CODEC.input(nextSeq, rows);
    this.#socket.send(frame);
    this.#inputSeq = nextSeq;
    this.#counters.sentInputs++;
    return { seq: nextSeq, commandCount: rows.length };
  }

  waitFor(predicate, timeoutMs = 15_000) {
    if (typeof predicate !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new TypeError('waitFor requires a predicate and positive finite timeout'));
    }
    const checkNow = () => {
      if (this.#failure) throw new Error(`companion failed: ${this.#failure}`);
      if (this.#closed) throw new Error('companion is closed');
      const snapshot = this.view();
      return predicate(snapshot) ? snapshot : null;
    };
    try { const ready = checkNow(); if (ready) return Promise.resolve(ready); }
    catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const waiter = {
        done: false,
        timer: null,
        check: () => {
          if (waiter.done) return;
          try {
            const ready = checkNow();
            if (ready) { waiter.done = true; clearTimeout(waiter.timer); this.#waiters.delete(waiter); resolve(ready); }
          } catch (error) { waiter.done = true; clearTimeout(waiter.timer); this.#waiters.delete(waiter); reject(error); }
        },
      };
      waiter.timer = setTimeout(() => {
        waiter.done = true;
        this.#waiters.delete(waiter);
        reject(new Error('companion wait timed out'));
      }, timeoutMs);
      this.#waiters.add(waiter);
      waiter.check();
    });
  }

  async leaveAndClose(timeoutMs = 1500) {
    this.#stopHeartbeat();
    if (!this.#closed && this.#connected) {
      this.#leaving = true;
      try { this.#socket.send(CODEC.leave()); } catch { /* continue with bounded close */ }
      await new Promise(resolve => {
        let done = false;
        const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
        const timer = setTimeout(finish, timeoutMs);
        this.#socket.addEventListener('close', finish, { once: true });
      });
    }
    if (!this.#closed) {
      try { this.#socket.close(1000, 'left'); } catch { /* socket already closed */ }
    }
    this.#closed = true;
    this.#connected = false;
    this.#notify();
    return this.sanitizedReport();
  }

  sanitizedReport() {
    return {
      profile: this.#profile,
      playerId: this.#welcome?.player ?? null,
      protocol: this.#welcome?.protocol ?? null,
      contentHash: this.#welcome?.contentHash ?? null,
      connected: this.connected,
      counters: { ...this.#counters },
      errorCodes: this.#failure ? [this.#failure] : [],
      rejectCodes: this.#rejects.map(row => row.code),
      lastTick: this.#snapshot?.tick ?? null,
    };
  }
}

async function openSocket(socket, timeoutMs) {
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.removeEventListener?.('open', onOpen);
      socket.removeEventListener?.('error', onError);
      socket.removeEventListener?.('close', onClose);
      error ? reject(error) : resolve();
    };
    const onOpen = () => finish();
    const onError = () => finish(new Error('companion WebSocket failed to open'));
    const onClose = () => finish(new Error('companion WebSocket closed before admission'));
    const timer = setTimeout(() => finish(new Error('companion WebSocket open timed out')), timeoutMs);
    socket.addEventListener('open', onOpen, { once: true });
    socket.addEventListener('error', onError, { once: true });
    socket.addEventListener('close', onClose, { once: true });
  });
}

export async function connectNormalCompanion({
  endpoint,
  profile = randomProfile(),
  faction = null,
  passcode,
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  timeoutMs = 15_000,
} = {}) {
  const base = loopbackBase(endpoint);
  if (typeof profile !== 'string' || !PROFILE_RE.test(profile)) throw new TypeError('profile must be 2..16 valid callsign characters');
  if (faction !== null && (!Number.isInteger(faction) || faction < 0 || faction > 4)) throw new TypeError('faction must be null or 0..4');
  if (passcode !== undefined && typeof passcode !== 'string') throw new TypeError('passcode must be a string when supplied');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 0x7fffffff) throw new TypeError('timeoutMs must be positive and finite');
  if (typeof fetchImpl !== 'function' || typeof WebSocketImpl !== 'function') throw new TypeError('fetch and WebSocket implementations are required');

  const infoUrl = new URL('/info', base);
  let infoResponse;
  try { infoResponse = await fetchImpl(infoUrl, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(Math.ceil(timeoutMs)) }); }
  catch { throw new Error('Source identity request failed'); }
  if (!infoResponse.ok) throw new Error(`Source identity request returned HTTP ${infoResponse.status}`);
  let info;
  try { info = await infoResponse.json(); } catch { throw new Error('Source identity response was invalid'); }
  const contentHash = normalizedHash(info?.contentHash);
  if (info?.protocol !== EXPECTED_PROTOCOL || contentHash !== EXPECTED_CONTENT_HASH) {
    throw new Error('Source protocol/content identity mismatch');
  }

  const claimUrl = new URL(`/api/profile/${encodeURIComponent(profile)}`, base);
  const headers = new Headers();
  if (passcode !== undefined) headers.set('x-playtest-passcode', passcode);
  let claimResponse;
  try { claimResponse = await fetchImpl(claimUrl, { method: 'GET', headers, cache: 'no-store', signal: AbortSignal.timeout(Math.ceil(timeoutMs)) }); }
  catch { throw new Error('Profile claim request failed'); }
  if (!claimResponse.ok) throw new Error(`Profile claim returned HTTP ${claimResponse.status}`);
  let claim;
  try { claim = await claimResponse.json(); } catch { throw new Error('Profile claim response was invalid'); }
  const tokenBytes = typeof claim?.token === 'string' ? new TextEncoder().encode(claim.token).byteLength : 0;
  if (claim?.created !== true || claim?.profile?.name !== profile || tokenBytes < 1 || tokenBytes > 448) {
    throw new Error('Profile claim did not return a fresh credential');
  }
  let credential = claim.token;
  claim = null;

  const wsUrl = new URL(base);
  wsUrl.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  wsUrl.pathname = '/ws';
  wsUrl.search = '';
  wsUrl.hash = '';
  const socket = new WebSocketImpl(wsUrl);
  const companion = new NormalCompanion(socket, profile, EXPECTED_CONTENT_HASH);
  try {
    await openSocket(socket, timeoutMs);
    const hello = CODEC.hello(BigInt(`0x${contentHash}`), profile, credential, faction, null);
    socket.send(hello);
    credential = null;
    await companion.waitFor(view => view.welcome !== null && view.snapshot !== null, timeoutMs);
    companion.startHeartbeat();
    return companion;
  } catch (error) {
    credential = null;
    try { socket.close(1000, 'admission failed'); } catch { /* ignored */ }
    throw error;
  }
}

export const companionProtocol = EXPECTED_PROTOCOL;
export const companionContentHash = EXPECTED_CONTENT_HASH;
