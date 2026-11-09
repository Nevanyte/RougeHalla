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
export function parseClientHello(reader) {
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
export function parseServerWelcome(reader) {
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
export function parseWireMetadata(direction, frame) {
  try {
    const max = direction === 'client' ? CLIENT_MAX : direction === 'server' ? SERVER_MAX : null;
    if (max === null) return Object.freeze({status:'unavailable',direction:'unknown',reason:'direction'});
    const reader = boundedReader(frame, max);
    return direction === 'client' ? parseClientHello(reader) : parseServerWelcome(reader);
  } catch (_) {
    return fail(direction === 'client' || direction === 'server' ? direction : 'unknown','unsupported-frame');
  }
}
