// P-WIRE17-MAP-2 oracle: the JS decoder of the browser probe (crates/rh-server/web/probe.html) against the patience-plane
// and quest-carrier vectors of protocol/fixtures/v<PROTOCOL>.json, plus hand-built quest rows (layout in
// docs/backlog/packets/P-WIRE17-MAP-2.md "Wire layout"). check-vectors.mjs already runs every Welcome, every State (exact
// JSON, so `carrierActor` must sit right after `carrier`) and every malformedMap vector through the same decoder; this script
// fails until the vectors and the decoder exist. Not run by scripts/gate.sh (proposed gate line in the brief).
//   node tools/protocol-js/check-map-patience.mjs
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
  if (!v) throw new Error(`missing Rust-generated ${name} vector (P-WIRE17-MAP-2 adds it)`);
  return decode(bytes(v.hex));
};

// ---- the patience plane ---------------------------------------------------------------------------------------------
const map = server("welcome_public_patience").map;
eq(map.camps.length, 3, "welcome_public_patience camps");
eq(Array.from(map.patience ?? []), Array.from({ length: map.w * map.h }, (_, i) => i % 4), "welcome_public_patience plane");
for (const name of ["welcome_public_all", "welcome_public_shipped"]) eq(server(name).map.patience, null, `${name} carries no plane`);

const refusals = {
  map17_patience_camp_over: "patience camp",
  map17_patience_without_camps: "patience camp",
  map17_patience_length: "length",
  map17_patience_truncated: "truncated",
  map17_v3_presence_empty: "presence",
  map17_v3_presence_unknown: "presence",
};
for (const [name, reason] of Object.entries(refusals)) {
  const v = fx.malformedMap.find((m) => m.name === name);
  if (!v) throw new Error(`missing Rust-generated malformedMap vector ${name}`);
  eq(v.reason, reason, `${name} reason`);
  let err = null;
  try { decode(bytes(v.hex)); } catch (e) { err = e; }
  // check-vectors.mjs maps "presence" to /ground presence$/ and "truncated" to any RangeError-like failure.
  const want = reason === "truncated" ? /./ : reason === "presence" ? /presence$/ : new RegExp(`${reason}$`);
  eq(err !== null && want.test(String(err.message)), true, `${name} refused for "${reason}" (got ${err?.message})`);
}

// ---- the quest carrier's actor id ------------------------------------------------------------------------------------
const questRow = (m) => m.items.find((i) => i.key === 10).value.rows[0];
const visible = questRow(server("state_quests_carrier_visible"));
eq([visible.carrier, visible.carrierActor], [7, 5], "state_quests_carrier_visible carrier and actor");
const keys = Object.keys(visible);
eq(keys[keys.indexOf("carrier") + 1], "carrierActor", "carrierActor follows carrier (exact JSON order)");
const hidden = questRow(server("state_quests_carrier_hidden"));
eq([hidden.carrier, hidden.carrierActor], [7, null], "state_quests_carrier_hidden");
eq(questRow(server("state_quests_available")).carrierActor, null, "state_quests_available has no carrier actor");

// The same State frame as crates/rh-protocol/tests/quest_carrier_wire.rs `raw`.
function raw(carrier, flags, actor) {
  const out = [];
  const u8 = (v) => out.push(v & 0xff);
  const varint = (v) => { while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; } out.push(v); };
  const str = (s) => { u8(s.length); for (const c of s) out.push(c.charCodeAt(0)); };
  const f64 = (v) => { const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, v, true); for (let i = 0; i < 8; i++) out.push(d.getUint8(i)); };
  u8(0x88); varint(5); varint(1); varint(10); u8(1);
  varint(0); varint(0); varint(7);
  varint(2); varint(7); str("owner"); varint(8); str("runner");
  varint(1);
  varint(11); str("fetch"); f64(10); f64(20); u8(1); f64(100);
  varint(1); varint(8); u8(1); varint(0); u8(0);
  varint(carrier); u8(0); u8(flags);
  for (const x of actor ?? []) out.push(x);
  varint(2); u8(1);
  for (const s of ["N", "G", "B", "O", "R"]) str(s);
  varint(0);
  return Uint8Array.from(out).buffer;
}
const refused = (frame, pattern, what) => {
  let err = null;
  try { decode(frame); } catch (e) { err = e; }
  eq(err !== null && pattern.test(String(err.message)), true, `${what} (got ${err?.message ?? "no error"})`);
};
let decoded = null, error = null;
try { decoded = questRow(decode(raw(8, 0x11, [0xac, 0x02]))); } catch (e) { error = e; }
eq(error?.message ?? null, null, "flag 0x10 with actor 300 decodes");
eq([decoded?.carrierActor, decoded?.canAccept, decoded?.ownerProgress], [300, true, 2], "the actor rides after the flags byte");
eq(questRow(decode(raw(8, 0x01, null))).carrierActor, null, "no flag, no actor");
refused(raw(0, 0x11, [5]), /bad quest flags$/, "flag 0x10 without a carrier");
refused(raw(8, 0x11, [0]), /bad quest carrier actor$/, "actor 0");
refused(raw(8, 0x21, null), /bad quest flags$/, "bit 0x20 stays unknown");

console.log(`map patience and quest carrier vectors: ${checks} checks ok`);
