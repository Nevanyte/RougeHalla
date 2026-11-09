// PROPOSAL ONLY. Root must release actual browser execution before installing this preload.
// Execute only in the dedicated owned test page, before ordinary Unity initialization.
(() => {
  'use strict';
  if (Object.prototype.hasOwnProperty.call(window, '__unityReloadWireEvidence')) {
    if (window.__unityReloadWireEvidence.schema === 'unity-browser-reload-installation/1') return;
    throw new Error('diagnostic namespace already exists');
  }
  const parseWireMetadata = (() => {
/*
 * Credential-blind v14 wire metadata parser. It is intentionally inert: importing or pasting
 * this file does not patch WebSocket, inspect application globals, read storage, or install hooks.
 * A caller may provide an already-observed frame to parseClientHello / parseServerWelcome.
 * The Welcome result is a recognized public-prefix observation, not proof the whole frame or
 * map decoded, the client accepted it, or the game rendered it.
 */
'use strict';

const CLIENT_MAX = 1024;
const SERVER_MAX = 256 * 1024;
const MAX_TICKET = 448;
const MAX_MAP_TILES = 1024 * 1024;
const MAX_MAP_RUNS = 3 * MAX_MAP_TILES;
const PROTOCOL = 14;
const CLIENT_TAGS = new Set([1, 2, 3, 4, 5]);
const SERVER_TAGS = new Set([0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88]);

function fail(direction, reason, protocol = null) {
  return Object.freeze({status:'unavailable',direction,reason,protocol});
}

/** Construct a bounds-checked reader over the original ArrayBuffer/view; it never copies or slices it. */
function boundedReader(frame, maxBytes) {
  let buffer, offset, length;
  if (frame instanceof ArrayBuffer) { buffer = frame; offset = 0; length = frame.byteLength; }
  else if (ArrayBuffer.isView(frame) && frame.buffer instanceof ArrayBuffer) {
    buffer = frame.buffer; offset = frame.byteOffset; length = frame.byteLength;
  } else throw new TypeError('unsupported frame storage');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || length > maxBytes) throw new RangeError('frame bound');
  const view = new DataView(buffer, offset, length);
  let at = 0;
  const need = n => {
    if (!Number.isSafeInteger(n) || n < 0 || n > length - at) throw new RangeError('truncated');
    const start = at; at += n; return start;
  };
  return Object.freeze({
    get length() { return length; },
    get offset() { return at; },
    get remaining() { return length - at; },
    u8() { return view.getUint8(need(1)); },
    u16() { return view.getUint16(need(2), true); },
    u32() { return view.getUint32(need(4), true); },
    u64() { return view.getBigUint64(need(8), true); },
    skip(n) { need(n); },
    publicHex(n) {
      const start = need(n); let text = '';
      for (let i = 0; i < n; i++) text += view.getUint8(start + i).toString(16).padStart(2, '0');
      return text;
    },
    end() { if (at !== length) throw new RangeError('trailing'); },
  });
}

function checkReader(r, maxBytes) {
  if (!r || !Number.isSafeInteger(r.length) || r.length < 1 ||
      !Number.isSafeInteger(r.remaining) || typeof r.u8 !== 'function' ||
      typeof r.u16 !== 'function' || typeof r.u32 !== 'function' || typeof r.skip !== 'function' ||
      typeof r.publicHex !== 'function' || typeof r.end !== 'function')
    throw new TypeError('unsupported reader');
  if (r.length > maxBytes) throw new RangeError('frame bound');
}

/** Parse only the v14 Hello's public protocol and the presence bit for the private resume capability. */
function parseClientHello(reader) {
  let protocol = null;
  try {
    checkReader(reader, CLIENT_MAX);
    const tag = reader.u8();
    if (tag !== 1) return CLIENT_TAGS.has(tag)
      ? Object.freeze({status:'ignored',direction:'client'})
      : fail('client','unknown-tag');
    protocol = reader.u16();
    if (protocol !== PROTOCOL) return fail('client','unsupported-protocol',protocol);
    reader.skip(8); // public content hash is not part of the minimal reload metadata.
    reader.skip(reader.u8()); // build UTF-8 bytes: length only, bytes never read.
    reader.skip(reader.u8()); // profile UTF-8 bytes: length only, bytes never read.
    const ticketLength = reader.u16();
    if (ticketLength > MAX_TICKET) return fail('client','ticket-length',protocol);
    reader.skip(ticketLength); // bearer/admission credential: length only, bytes never read.
    const faction = reader.u8();
    if (faction === 1) reader.skip(1);
    else if (faction !== 0) return fail('client','optional-tag',protocol);
    const resume = reader.u8();
    if (resume === 1) reader.skip(16); // private capability: presence only, bytes never read.
    else if (resume !== 0) return fail('client','optional-tag',protocol);
    reader.end();
    return Object.freeze({status:'metadata',kind:'hello',protocol,resumePresent:resume === 1,
      structureOnly:true,wholeFrameValidated:false});
  } catch (_) {
    return fail('client','malformed-or-unsupported',protocol);
  }
}

/** Parse only the v14 Welcome's public identity prefix; session and all later bytes are skipped. */
function parseServerWelcome(reader) {
  let protocol = null;
  try {
    checkReader(reader, SERVER_MAX);
    const tag = reader.u8();
    if (tag !== 0x81) return SERVER_TAGS.has(tag)
      ? Object.freeze({status:'ignored',direction:'server'})
      : fail('server','unknown-tag');
    protocol = reader.u16();
    if (protocol !== PROTOCOL) return fail('server','unsupported-protocol',protocol);
    const contentHash = reader.u64().toString(16).padStart(16,'0');
    const matchId = reader.publicHex(16); // public fixed-width match identifier.
    const playerId = reader.u32(); // public player identifier.
    reader.skip(16); // private session capability: bytes never read.
    reader.skip(13); // tick rate, tick, and server clock; not needed for reload readiness.
    if (reader.length < 60) return fail('server','truncated-welcome-prefix',protocol);
    // Bound the map's byte layout using only dimensions, extension length, and RLE run counts.
    // Tile/terrain/region values and all hashes are skipped unread; this is not map validation.
    const width = reader.u16(), height = reader.u16();
    const tileCount = width * height;
    if (!width || !height || tileCount > MAX_MAP_TILES) return fail('server','map-size',protocol);
    reader.skip(4); // collision hash
    const collisionRuns = reader.u32();
    if (!collisionRuns || collisionRuns > tileCount || collisionRuns > MAX_MAP_RUNS) return fail('server','map-runs',protocol);
    reader.skip(collisionRuns * 3); // collision pairs are payload, never read.
    const extensionLength = reader.u32();
    if (extensionLength < 11 || extensionLength > reader.remaining) return fail('server','map-extension-length',protocol);
    const extensionStart = reader.offset;
    const version = reader.u8(), flags = reader.u8();
    if (version !== 1 || (flags & ~3) !== 0) return fail('server','map-extension-header',protocol);
    reader.skip(4); // semantic hash
    let cumulativeRuns = collisionRuns;
    for (const present of [flags & 1, flags & 2]) {
      if (!present) continue;
      const runs = reader.u32();
      cumulativeRuns += runs;
      if (!runs || runs > tileCount || cumulativeRuns > MAX_MAP_RUNS) return fail('server','map-runs',protocol);
      reader.skip(runs * 3); // plane pairs are payload, never read.
    }
    const terrainMode = reader.u8();
    if (terrainMode > 2) return fail('server','map-mode',protocol);
    reader.skip(4); // context hash
    if (reader.offset - extensionStart !== extensionLength) return fail('server','map-extension-layout',protocol);
    reader.end();
    // The map is only length-bounded here. Payload values and collision/semantic/context hashes were not validated.
    return Object.freeze({status:'public-prefix',kind:'welcome',protocol,contentHash,matchId,playerId,
      prefixBytes:60,mapLayoutBounded:true,mapPayloadValidated:false,wholeFrameValidated:false});
  } catch (_) {
    return fail('server','malformed-or-unsupported',protocol);
  }
}

/** Convenience dispatch for an already supplied original buffer; no unsupported-data fallback. */
function parseWireMetadata(direction, frame) {
  try {
    const max = direction === 'client' ? CLIENT_MAX : direction === 'server' ? SERVER_MAX : null;
    if (max === null) return Object.freeze({status:'unavailable',direction:'unknown',reason:'direction'});
    const reader = boundedReader(frame, max);
    return direction === 'client' ? parseClientHello(reader) : parseServerWelcome(reader);
  } catch (_) {
    return fail(direction === 'client' || direction === 'server' ? direction : 'unknown','unsupported-frame');
  }
}

return parseWireMetadata; })();
  const proposeWireTap = (() => {
// INERT PROPOSAL. Importing this module does not install or start anything.
// Root must review and explicitly install the returned constructor before a future game load.


const SCHEMA = 'unity-browser-reload-wire/1';
const PUBLIC_HEX = /^[0-9a-f]{32}$/;
const CONTENT_HEX = /^[0-9a-f]{16}$/;

/**
 * Wrap only genuine game calls to a supplied native constructor/send method.
 * No URL, HTTP, storage, app global, frame copy, Blob conversion, raw error or raw payload log.
 * This function does NOT assign window.WebSocket and does not create a connection or send data.
 * Diagnostic overhead is unmeasured. A returned send means a call returned, not delivery.
 */
function proposeWireTap(NativeWebSocket, documentId, clock) {
  if (typeof NativeWebSocket !== 'function' || typeof documentId !== 'string' ||
      !/^[a-zA-Z0-9-]{8,80}$/.test(documentId) || typeof clock !== 'function')
    throw new TypeError('observer configuration');
  const records = [], undo = [];
  let stopped = false, overflow = false, nextConnection = 0;
  function append(connection, event, metadata = {}) {
    try {
      if (stopped) return;
      if (records.length >= 256) { overflow = true; return; }
      const at = clock();
      if (!at || ![at.wallTimeMs, at.timeOriginMs, at.performanceNowMs].every(Number.isFinite)) {
        overflow = true; return;
      }
      records.push(Object.freeze({schema:SCHEMA, documentId, connection, event,
        wallTimeMs:at.wallTimeMs, timeOriginMs:at.timeOriginMs,
        performanceNowMs:at.performanceNowMs, ...metadata}));
    } catch (_) {
      overflow = true;
    }
  }
  function attach(socket) {
    if (stopped) return socket;
    const id = ++nextConnection;
    if (id > 16) { overflow = true; return socket; }
    let disabled = false, hello = false, welcome = false;
    const reject = () => {
      if (!disabled) { disabled = true; append(id, 'metadata-unavailable'); }
    };
    function inspect(direction, original) {
      if (stopped || disabled) return;
      const value = parseWireMetadata(direction, original);
      // Hard projection: never spread arbitrary parser output, reader errors or frame values.
      if (value.status === 'ignored' || value.status === 'unrelated') return;
      if (direction === 'client' && value.kind === 'hello' && value.protocol === 14 &&
          value.status === 'metadata' && typeof value.resumePresent === 'boolean' && !hello) {
        hello = true;
        append(id, 'hello-send-returned', {protocol:14, resumePresent:value.resumePresent,
          wholeFrameValidated:false});
      } else if (direction === 'server' && value.kind === 'welcome' &&
          value.status === 'public-prefix' && value.protocol === 14 && hello && !welcome &&
          PUBLIC_HEX.test(value.matchId) && CONTENT_HEX.test(value.contentHash) &&
          Number.isInteger(value.playerId) && value.playerId > 0 && value.playerId <= 0xffffffff) {
        welcome = true;
        append(id, 'welcome-public-prefix', {protocol:14, contentHash:value.contentHash,
          matchId:value.matchId, playerId:value.playerId, wholeFrameValidated:false});
      } else reject();
    }
    // Guard only diagnostic work. Native exceptions and return values propagate unchanged.
    const safely = fn => { try { fn(); } catch (_) { reject(); } };
    let originalSend, descriptor, wrappedSend, installed = false;
    const message = event => safely(() => inspect('server', event.data));
    const closed = () => safely(() => append(id, 'socket-closed'));
    try {
      descriptor = Object.getOwnPropertyDescriptor(socket, 'send');
      originalSend = socket.send;
      if (typeof originalSend !== 'function') { reject(); return socket; }
      wrappedSend = function (...args) {
        // Forward the EXACT this/argument list once, solely in response to the real game's call.
        const result = Reflect.apply(originalSend, this, args);
        if (this === socket) safely(() => inspect('client', args[0]));
        return result;
      };
      Object.defineProperty(socket, 'send', {value:wrappedSend, writable:true, configurable:true});
      installed = true;
      socket.addEventListener('message', message);
      socket.addEventListener('close', closed);
      append(id, 'game-socket-created');
      undo.push(() => {
        socket.removeEventListener('message', message);
        socket.removeEventListener('close', closed);
        if (socket.send === wrappedSend) {
          if (descriptor) Object.defineProperty(socket, 'send', descriptor);
          else delete socket.send;
        }
      });
    } catch (_) {
      safely(() => socket.removeEventListener('message', message));
      safely(() => socket.removeEventListener('close', closed));
      if (installed) safely(() => {
        if (socket.send === wrappedSend) {
          if (descriptor) Object.defineProperty(socket, 'send', descriptor);
          else delete socket.send;
        }
      });
      reject();
    }
    return socket;
  }
  const ProposedConstructor = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      // Arguments (including URL/protocol strings) are never inspected or retained here.
      const socket = Reflect.construct(target, args, newTarget);
      try { return attach(socket); } catch (_) { overflow = true; return socket; }
    },
  });
  return Object.freeze({
    ProposedConstructor,
    export() {
      return {schema:SCHEMA, documentId, records:records.map(row => ({...row})), overflow,
        installedByThisModule:false, scope:'wire metadata only; not codec/application/render/delivery acceptance'};
    },
    stop() {
      stopped = true;
      for (const restore of undo) { try { restore(); } catch (_) { overflow = true; } }
      undo.length = 0;
      // The caller owns any global constructor assignment and its restoration. Never close sockets.
    },
  });
}

return proposeWireTap; })();
  /*
 * Paste into the DevTools console of a top-level Unity browser page.
 * Read-only, per-document browser facts only. It does not inspect application globals,
 * storage, DOM text/values, cookies, network traffic, or WebSocket frames.
 *
 * Export with: window.__unityReloadReadinessObserver.export()
 * The returned record is this document's local observation only. It does not identify a
 * match/player or prove resume versus fresh join; record those separately from approved
 * public evidence. A new document must install the observer again.
 */
(() => {
  'use strict';
  if (window.top !== window) throw new Error('reload observer must run in the top-level document');
  const name = '__unityReloadReadinessObserver';
  if (Object.prototype.hasOwnProperty.call(window, name)) {
    if (window[name]?.schema === 'unity-browser-reload-observer/1') return window[name];
    throw new Error('observer namespace already exists');
  }

  const maxEvents = 512;
  const safeCodes = new Set([
    'F5', 'Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight',
  ]);
  const listeners = [];
  const state = {
    schema: 'unity-browser-reload-observer/1',
    documentId: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() :
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    page: {
      timeOriginMs: performance.timeOrigin,
      wallTimeMs: Date.now(),
      performanceNowMs: performance.now(),
      origin: location.origin,
      visibility: document.visibilityState,
      online: navigator.onLine,
      userAgent: navigator.userAgent,
      viewport: {width: innerWidth, height: innerHeight, devicePixelRatio},
      topLevel: true,
      navigationType: performance.getEntriesByType('navigation')[0]?.type ?? 'unknown',
    },
    events: [],
    overflow: false,
    stopped: false,
  };
  const append = event => {
    if (state.stopped) return;
    if (state.events.length >= maxEvents) { state.overflow = true; return; }
    state.events.push({
      ...event,
      wallTimeMs: Date.now(),
      timeOriginMs: performance.timeOrigin,
      performanceNowMs: performance.now(),
    });
  };
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push([target, type, handler, options]);
  };

  listen(document, 'visibilitychange', () => append({kind:'visibilitychange', visibility:document.visibilityState}));
  listen(window, 'focus', () => append({kind:'focus'}));
  listen(window, 'blur', () => append({kind:'blur'}));
  listen(window, 'pageshow', event => append({kind:'pageshow', persisted:!!event.persisted, trusted:!!event.isTrusted}));
  listen(window, 'pagehide', event => append({kind:'pagehide', persisted:!!event.persisted, trusted:!!event.isTrusted}));
  listen(document, 'pointerdown', event => append({kind:'pointerdown', trusted:!!event.isTrusted,
    button:event.button, pointerType:['mouse','pen','touch'].includes(event.pointerType)?event.pointerType:'unknown', clientX:event.clientX, clientY:event.clientY} ), true);
  listen(document, 'pointerup', event => append({kind:'pointerup', trusted:!!event.isTrusted,
    button:event.button, pointerType:['mouse','pen','touch'].includes(event.pointerType)?event.pointerType:'unknown', clientX:event.clientX, clientY:event.clientY} ), true);
  listen(document, 'keydown', event => {
    if (!safeCodes.has(event.code)) return;
    append({kind:'keydown', trusted:!!event.isTrusted, code:event.code,
      ctrl:event.ctrlKey, meta:event.metaKey, shift:event.shiftKey, alt:event.altKey});
  }, true);
  listen(document, 'keyup', event => {
    if (!safeCodes.has(event.code)) return;
    append({kind:'keyup', trusted:!!event.isTrusted, code:event.code,
      ctrl:event.ctrlKey, meta:event.metaKey, shift:event.shiftKey, alt:event.altKey});
  }, true);

  const api = Object.freeze({
    schema:state.schema,
    export() {
      return JSON.parse(JSON.stringify({
        schema:state.schema, documentId:state.documentId,
        page:{...state.page, navigationType:performance.getEntriesByType('navigation')[0]?.type ?? 'unknown'},
        capturedAt:{wallTimeMs:Date.now(),timeOriginMs:performance.timeOrigin,performanceNowMs:performance.now()},
        events:state.events, overflow:state.overflow, stopped:state.stopped,
        scope:'per-document timing/lifecycle/trusted input metadata only; no application or network identity',
      }));
    },
    stop() {
      if (!state.stopped) {
        state.stopped = true;
        for (const [target, type, handler, options] of listeners) target.removeEventListener(type, handler, options);
        listeners.length = 0;
      }
      return this.export();
    },
  });
  Object.defineProperty(window, name, {value:api, enumerable:false, writable:false, configurable:false});
  append({kind:'observer-installed'});
  return api;
})();

  const documentObserver = window.__unityReloadReadinessObserver;
  const originalConstructor = window.WebSocket;
  const tap = proposeWireTap(originalConstructor, documentObserver.export().documentId, () => ({
    wallTimeMs:Date.now(), timeOriginMs:performance.timeOrigin, performanceNowMs:performance.now()
  }));
  Object.defineProperty(window, '__unityReloadWireEvidence', {value:Object.freeze({
    schema:'unity-browser-reload-installation/1',
    export:() => tap.export(),
    stopAndRestore() {
      tap.stop();
      if (window.WebSocket === tap.ProposedConstructor) window.WebSocket = originalConstructor;
      documentObserver.stop();
    }
  }), enumerable:false, writable:false, configurable:false});
  window.WebSocket = tap.ProposedConstructor;
})();
