// P-FROST-WALL-2 oracle: the JS decoder of the browser probe (crates/rh-server/web/probe.html) reads a standing Frost Wall
// (State key 3, field kind 3, then `count u8 | count x tile u32 LE`) and the Welcome HUD terms 23-29, from the vectors of
// protocol/fixtures/v<PROTOCOL>.json and from frames built here (layout: docs/backlog/packets/P-FROST-WALL-2.md F4, F5).
// check-vectors.mjs runs every malformedServer vector generically; this script fails until the decoder and the vectors
// exist. Not run by scripts/gate.sh (proposed gate line in the brief).
//   node tools/protocol-js/check-frost-wall.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "crates/rh-server/web/probe.html"), "utf8");
const a = html.search(/\/\/ ---- protocol v\d+/);
const b = html.indexOf("// ---- probe state");
if (a < 0 || b < 0) throw new Error("probe.html markers not found");
const { decode } = new Function(`"use strict"; ${html.slice(a, b)}; return { decode };`)();
const version = /const PROTOCOL = (\d+);/.exec(html.slice(a, b))[1];
const fx = JSON.parse(readFileSync(join(root, `protocol/fixtures/v${version}.json`), "utf8"));

const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)).buffer;
let checks = 0;
const eq = (got, want, what) => {
  checks++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error(`${what}: got ${g}, want ${w}`);
};
const vector = (group, name) => {
  const v = fx[group].find((s) => s.name === name);
  if (!v) throw new Error(`missing Rust-generated ${group} vector ${name} (P-FROST-WALL-2 adds it)`);
  return bytes(v.hex);
};

// ---- frames built here (the spec) -------------------------------------------------------------------------------------
const MAP_TILES = 1024 * 1024;
const frame = (kind, after) => {
  const out = [0x88, 0xac, 0x02, 1, 3, 1, kind, 0, 1, 5, 0];
  const dv = new DataView(new ArrayBuffer(36));
  [400, 1408, 400, 1184, 0, 0, 0].forEach((v, i) => dv.setFloat32(i * 4, v, true));
  dv.setFloat64(28, 10000, true);
  out.push(...new Uint8Array(dv.buffer));
  const end = new DataView(new ArrayBuffer(8)); end.setFloat64(0, 14000, true);
  out.push(...new Uint8Array(end.buffer), ...after);
  return Uint8Array.from(out).buffer;
};
const list = (count, tiles) => {
  const dv = new DataView(new ArrayBuffer(tiles.length * 4));
  tiles.forEach((t, i) => dv.setUint32(i * 4, t, true));
  return [count, ...new Uint8Array(dv.buffer)];
};
const tiles = [37, 38, 39, 40, 41, 42, 43].map((y) => y * 40 + 12);
// The decoded row: today's keys in today's order, then `tiles` (a wall only; other kinds have no `tiles` key).
const wallRow = (t) => ({ kind: 3, ability: 0, owner: 5, subject: null, x: 400, y: 1408, x2: 400, y2: 1184, r: 0, vx: 0, vy: 0, startedAt: 10000, endsAt: 14000, tiles: t });
const fieldsOf = (m) => m.items.find((i) => i.key === 3).value;

let decoded;
try { decoded = decode(frame(3, list(7, tiles))); } catch (e) { throw new Error(`a wall row is refused: ${e.message}`); }
eq(fieldsOf(decoded), [wallRow(tiles)], "a wall row decodes with its tiles");

const refused = (buf) => { try { decode(buf); } catch (e) { return String(e.message); } return "accepted"; };
const over = [...Array(65).keys()];
const cases = [
  ["kind 4", frame(4, []), /bad field$/],
  ["count 0", frame(3, list(0, [])), /bad wall tiles$/],
  ["count 65", frame(3, list(65, over)), /bad wall tiles$/],
  ["count 3, two tiles", frame(3, list(3, [1, 2])), /./],
  ["a tile off every map", frame(3, list(2, [5, MAP_TILES])), /bad wall tile$/],
  ["a repeated tile", frame(3, list(2, [5, 5])), /bad wall order$/],
  ["descending tiles", frame(3, list(2, [6, 5])), /bad wall order$/],
];
for (const [what, buf, want] of cases) {
  const got = refused(buf);
  eq(got !== "accepted" && want.test(got), true, `${what} refused for ${want} (got "${got}")`);
}

// ---- the Rust vectors ---------------------------------------------------------------------------------------------------
const trailRow = { kind: 2, ability: 3, owner: null, subject: 1, x: 20, y: 30, x2: 40, y2: 50, r: 12, vx: -2, vy: 0, startedAt: 1000.5, endsAt: 6000.5 };
eq(fieldsOf(decode(vector("server", "state_frost_wall"))), [wallRow(tiles), trailRow], "state_frost_wall");
const max = [...Array(64).keys()].map((i) => MAP_TILES - 64 + i);
eq(fieldsOf(decode(vector("server", "state_frost_wall_max"))), [wallRow(max)], "state_frost_wall_max");

const term = (hud, code) => hud.terms.find((t) => t.code === code)?.value ?? null;
const freeze = decode(vector("server", "welcome")).hud, wall = decode(vector("server", "welcome_frost_wall")).hud;
eq(freeze.terms.map((t) => t.code), [...Array(30).keys()], "welcome carries codes 0..29");
eq([term(freeze, 23), term(wall, 23)], [0, 1], "code 23: Frost's Wish (0 Freeze, 1 Wall)");
for (const h of [freeze, wall]) eq([24, 25, 26, 27, 28, 29].map((c) => term(h, c)), [450, 64, 224, 4000, 24, 8], "the wall's numbers");

const malformed = {
  state_field_kind_unknown: /bad field$/, state_wall_tiles_zero: /bad wall tiles$/, state_wall_tiles_over: /bad wall tiles$/,
  state_wall_tiles_truncated: /./, state_wall_tile_off_map: /bad wall tile$/, state_wall_tile_order: /bad wall order$/,
};
for (const [name, want] of Object.entries(malformed)) {
  const got = refused(vector("malformedServer", name));
  eq(got !== "accepted" && want.test(got), true, `${name} refused for ${want} (got "${got}")`);
}
console.log(`frost wall: ${checks} checks passed`);
