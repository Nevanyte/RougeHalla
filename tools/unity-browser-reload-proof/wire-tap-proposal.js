// INERT PROPOSAL. Importing this module does not install or start anything.
// Root must review and explicitly install the returned constructor before a future game load.
import {parseWireMetadata} from './wire-metadata.js';

const SCHEMA = 'unity-browser-reload-wire/1';
const PUBLIC_HEX = /^[0-9a-f]{32}$/;
const CONTENT_HEX = /^[0-9a-f]{16}$/;

/**
 * Wrap only genuine game calls to a supplied native constructor/send method.
 * No URL, HTTP, storage, app global, frame copy, Blob conversion, raw error or raw payload log.
 * This function does NOT assign window.WebSocket and does not create a connection or send data.
 * Diagnostic overhead is unmeasured. A returned send means a call returned, not delivery.
 */
export function proposeWireTap(NativeWebSocket, documentId, clock) {
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
      if (direction === 'client' && value.kind === 'hello' && value.protocol === 18 &&
          value.status === 'metadata' && typeof value.resumePresent === 'boolean' && !hello) {
        hello = true;
        append(id, 'hello-send-returned', {protocol:18, resumePresent:value.resumePresent,
          wholeFrameValidated:false});
      } else if (direction === 'server' && value.kind === 'welcome' &&
          value.status === 'public-prefix' && value.protocol === 18 && hello && !welcome &&
          PUBLIC_HEX.test(value.matchId) && CONTENT_HEX.test(value.contentHash) &&
          Number.isInteger(value.playerId) && value.playerId > 0 && value.playerId <= 0xffffffff) {
        welcome = true;
        append(id, 'welcome-public-prefix', {protocol:18, contentHash:value.contentHash,
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
