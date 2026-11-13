// P-WIRE17-MAP-3 oracle: the JS decoder of the browser probe (crates/rh-server/web/probe.html) against the landmark-anchor
// vectors of protocol/fixtures/v<PROTOCOL>.json (layout in docs/backlog/packets/P-WIRE17-MAP-3.md "Wire layout").
// check-vectors.mjs already runs every Welcome and every malformedMap vector through the same decoder; this script fails
// until the vectors and the decoder exist. Not run by scripts/gate.sh (proposed gate line in the brief).
//   node tools/protocol-js/check-map-anchors.mjs
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
const server = (name) => {
  const v = fx.server.find((s) => s.name === name);
  if (!v) throw new Error(`missing Rust-generated ${name} vector (P-WIRE17-MAP-3 adds it)`);
  return decode(bytes(v.hex));
};

// The decoded shape (key order included): { zone, kind, centre: { x, y }, footprint: { x, y, w, h }, front, entrance: [{ x, y }] }.
const t = (x, y) => ({ x, y });
const anchor = (zone, kind, [cx, cy], [x, y, w, h], front, entrance = []) =>
  ({ zone, kind, centre: t(cx, cy), footprint: { x, y, w, h }, front, entrance: entrance.map(([ex, ey]) => t(ex, ey)) });
// The same five anchors as crates/rh-protocol/tests/map_anchors.rs `five()`; kind codes 1 volcano, 2 church, 3 bog tree,
// 4 cave, 5 hall.
const five = [
  anchor(1, 1, [1, 1], [0, 0, 3, 3], 0),
  anchor(2, 2, [7, 2], [4, 0, 4, 3], 4, [[4, 0], [4, 1], [4, 2]]),
  anchor(3, 3, [1, 4], [0, 3, 3, 3], 8),
  anchor(4, 4, [5, 4], [4, 3, 4, 3], 12, [[5, 3], [6, 3], [7, 3]]),
  anchor(5, 5, [3, 2], [0, 0, 8, 6], 15),
];

// ---- the anchors ----------------------------------------------------------------------------------------------------
const all = server("welcome_public_anchors").map;
eq(all.camps.length, 3, "welcome_public_anchors camps");
eq(all.patience, null, "welcome_public_anchors carries no patience plane");
eq(all.anchors, five, "welcome_public_anchors anchors");
eq(server("welcome_public_anchor_one").map.anchors, [five[3]], "welcome_public_anchor_one anchors");
for (const name of ["welcome_public_all", "welcome_public_shipped", "welcome_public_patience"]) {
  eq(server(name).map.anchors, [], `${name} carries no anchors (an empty list, as camps)`);
}

const refusals = {
  map17_anchor_count_zero: "anchor count",
  map17_anchor_count_over: "anchor count",
  map17_anchor_zone: "anchor zone",
  map17_anchor_order: "anchor order",
  map17_anchor_duplicate: "anchor order",
  map17_anchor_kind: "anchor kind",
  map17_anchor_footprint: "anchor footprint",
  map17_anchor_centre: "anchor centre",
  map17_anchor_front: "anchor front",
  map17_anchor_entrance_over: "anchor entrance",
  map17_anchor_entrance_tile: "anchor entrance",
  map17_anchor_truncated: "truncated",
  map17_v3_presence_unknown: "presence",
};
for (const [name, reason] of Object.entries(refusals)) {
  const v = fx.malformedMap.find((m) => m.name === name);
  if (!v) throw new Error(`missing Rust-generated malformedMap vector ${name}`);
  eq(v.reason, reason, `${name} reason`);
  let err = null;
  try { decode(bytes(v.hex)); } catch (e) { err = e; }
  // check-vectors.mjs maps "presence" to /ground presence$/, "truncated" to any failure, every other reason to /<reason>$/.
  const want = reason === "truncated" ? /./ : reason === "presence" ? /ground presence$/ : new RegExp(`${reason}$`);
  eq(err !== null && want.test(String(err.message)), true, `${name} refused for "${reason}" (got ${err?.message})`);
}

console.log(`map anchors: ${checks} checks passed`);
