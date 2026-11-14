/*
 * Credential-blind v17 wire metadata parser. It is intentionally inert: importing or pasting
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
const MAX_MAP_RUNS = 5 * MAX_MAP_TILES;
const PROTOCOL = 17;
const MAX_ARCHETYPES = 32, MAX_ARCHETYPE_KEY = 24, MAX_WEAPONS = 32, WEAPON_ROW_LEN = 34;
// P-WIRE17-HUD-2b HUD content block (crates/rh-protocol/src/hud_content.rs).
const MAX_SCALING_ROWS = 32, SCALING_ROW_LEN = 34, MAX_HUD_TERMS = 30, HUD_TERM_ROW_LEN = 9;
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

/** Parse only the v17 Hello's public protocol and the presence bit for the private resume capability. */
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

/** Parse only the v17 Welcome's public identity prefix; session and all later bytes are skipped. */
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
    // Protocol 16 and later put public tables between this header and the map, in this order (crates/rh-protocol:
    // archetype.rs, vision.rs, weapon.rs, hud_content.rs). Only counts, key lengths and flags are read to find the map;
    // values are skipped.
    const archetypes = reader.u8();
    if (archetypes > MAX_ARCHETYPES) return fail('server','archetype-table',protocol);
    for (let i = 0; i < archetypes; i++) {
      reader.skip(1); // archetype id
      const key = reader.u8();
      if (key > MAX_ARCHETYPE_KEY) return fail('server','archetype-table',protocol);
      reader.skip(key); // appearance key bytes
      const hull = reader.u8();
      if (hull === 0) reader.skip(1); // circle radius
      else if (hull === 1) reader.skip(6); // foot and body boxes
      else return fail('server','archetype-table',protocol);
      reader.skip(1); // chest
    }
    reader.skip(34); // vision: version u8, four f64, sight mask u8
    const coliseum = reader.u8();
    if (coliseum === 1) reader.skip(8); // coliseum rectangle: four u16
    else if (coliseum !== 0) return fail('server','vision-block',protocol);
    const weapons = reader.u8();
    if (weapons > MAX_WEAPONS) return fail('server','weapon-table',protocol);
    reader.skip(weapons * WEAPON_ROW_LEN);
    // P-WIRE17-HUD-2b: the HUD content block (scaling rows, then term rows) sits between the weapon table and the map.
    const scalingRows = reader.u8();
    if (scalingRows > MAX_SCALING_ROWS) return fail('server','hud-content',protocol);
    reader.skip(scalingRows * SCALING_ROW_LEN);
    const hudTerms = reader.u8();
    if (hudTerms > MAX_HUD_TERMS) return fail('server','hud-content',protocol);
    reader.skip(hudTerms * HUD_TERM_ROW_LEN);
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
    if (version !== 2 || (flags & ~0x7f) !== 0) return fail('server','map-extension-header',protocol);
    reader.skip(4); // semantic hash
    let cumulativeRuns = collisionRuns;
    const skipPlane = () => {
      const runs = reader.u32();
      cumulativeRuns += runs;
      if (!runs || runs > tileCount || cumulativeRuns > MAX_MAP_RUNS) return false;
      reader.skip(runs * 3); // plane pairs are payload, never read.
      return true;
    };
    for (const present of [flags & 1, flags & 2]) if (present && !skipPlane()) return fail('server','map-runs',protocol);
    // Protocol 17 public sections, bounded by their counts only (crates/rh-protocol/src/map.rs); values are skipped.
    if (flags & 4) {
      const camps = reader.u8();
      if (!camps || camps > 64) return fail('server','map-sections',protocol);
      reader.skip(camps * 7);
    }
    if (flags & 8) {
      reader.skip(8); // coliseum rectangle
      const gates = reader.u8();
      if (gates > 8) return fail('server','map-sections',protocol);
      for (let g = 0; g < gates; g++) {
        reader.skip(1); // side
        const tiles = reader.u8();
        if (!tiles || tiles > 16) return fail('server','map-sections',protocol);
        reader.skip(tiles * 4);
      }
    }
    if ((flags & 16) && !skipPlane()) return fail('server','map-runs',protocol);
    if (flags & 32) {
      const props = reader.u16();
      if (!props || props > 8192) return fail('server','map-sections',protocol);
      reader.skip(props * 7);
    }
    if ((flags & 64) && !skipPlane()) return fail('server','map-runs',protocol);
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
