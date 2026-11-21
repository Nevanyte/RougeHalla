// P-COLISEUM-HEALS-2 oracle (JS): the browser probe's decoder (crates/rh-server/web/probe.html, the JS decoder of
// crates/rh-protocol/AGENTS.md) reads a coliseum heal pickup, State key 2 prop kind 8 with the cannon's layout
// (`handle varint | x u16 | y u16 | 8 | readyAt varint`), as `{ kind: 8, readyAt }` at protocol 20, decodes the golden
// vector state_heal_props and refuses a hand-built kind 9. Run by the gate's reload-proof step (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../crates/rh-server/web/probe.html', import.meta.url), 'utf8');
const start = html.search(/\/\/ ---- protocol v\d+ /), end = html.indexOf('// ---- probe state', start);
const probe = new Function(`${html.slice(start, end)}\nreturn { PROTOCOL, decode };`)();
const fromHex = hex => Uint8Array.from(hex.match(/../g), b => Number.parseInt(b, 16));
const fixture = new URL(`../../protocol/fixtures/v${probe.PROTOCOL}.json`, import.meta.url);

// The four pickups in 1/8 units (NW, NE, SW, SE) and the vector's clocks (the brief, section 4).
const ROWS = [
  { handle: 1, x: 20352, y: 20352, kind: 8, readyAt: 0 },
  { handle: 2, x: 20608, y: 20352, kind: 8, readyAt: 30000 },
  { handle: 3, x: 20352, y: 20608, kind: 8, readyAt: 0xffffffff },
  { handle: 4, x: 20608, y: 20608, kind: 8, readyAt: 0 },
];

const varint = v => { const out = []; while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); } out.push(v); return out; };
const u16 = v => [v & 0xff, v >> 8];
// State tick 202, one item (key 2), the rows, no focus.
const stateFrame = rows => new Uint8Array([0x88, ...varint(202), 1, 2, ...varint(rows.length),
  ...rows.flatMap(r => [...varint(r.handle), ...u16(r.x), ...u16(r.y), r.kind, ...varint(r.readyAt)]), 0]).buffer;
const propsOf = msg => msg.items.find(i => i.key === 2).value;

test('the probe speaks protocol 22', () => {
  assert.equal(probe.PROTOCOL, 22, 'a new prop kind is an incompatible wire change: 19 -> 20 (origin); P-SYNC-ORIGIN-2 carries it as 22');
  assert.notEqual(html.indexOf('// ---- protocol v22 '), -1, 'the codec block marker names v22');
});

test('the probe reads a hand-built kind 8 row as a heal with its clock', () => {
  let msg;
  assert.doesNotThrow(() => { msg = probe.decode(stateFrame(ROWS)); }, 'kind 8 decodes');
  assert.deepEqual(propsOf(msg).rows, ROWS);
  assert.equal(propsOf(msg).focus, null);
});

test('the probe still refuses an unknown prop kind', () => {
  assert.throws(() => probe.decode(stateFrame([{ ...ROWS[0], kind: 9 }])), /prop kind/);
});

test('the golden vectors: state_heal_props decodes to the four pickups, kind 9 is refused', () => {
  assert.equal(existsSync(fixture), true, `protocol/fixtures/v${probe.PROTOCOL}.json is missing`);
  const fx = JSON.parse(readFileSync(fixture, 'utf8'));
  const good = fx.server.find(v => v.name === 'state_heal_props');
  assert.ok(good, 'the server vector state_heal_props');
  const msg = probe.decode(fromHex(good.hex).buffer);
  assert.deepEqual(propsOf(msg).rows, ROWS);
  // Hand-built (not a shared malformed vector: check-vectors.mjs is provenance-pinned): kind 9 after the heal's place.
  const bad = Uint8Array.from([0x88, 0xca, 0x01, 1, 2, 1, 1, 0x50, 0, 0xa0, 0, 9, 0, 0]);
  assert.throws(() => probe.decode(bad.buffer), /prop kind/);
});
