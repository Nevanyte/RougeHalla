// P-DRESS-BAKE-1 oracle: the JS decoder of the browser probe (crates/rh-server/web/probe.html) against the dressing vectors
// of protocol/fixtures/v<PROTOCOL>.json. The dressed Welcomes decode to exactly the brief's props and ground plane, and every
// dressing refusal is refused for the reason Rust names (the JS message ends with it). check-vectors.mjs already runs every
// Welcome and every malformedMap vector through the same decoder; this script fails until the vectors exist.
//   node tools/protocol-js/check-dressing.mjs
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

const W = 8, H = 6;
const prop = (kind, x, y, variant, flags) => ({ kind, x, y, variant, flags });
const goldenProps = [
  prop(41, 48, 40, 0, 1),
  prop(3, 100, 60, 2, 0),
  prop(3, 101, 60, 3, 0),
  prop(7, 101, 60, 0, 0),
  prop(33, 16, 176, 200, 2),
  prop(100, 32 * W - 1, 32 * H - 1, 1, 1),
];
const goldenGround = Array.from({ length: W * H }, (_, i) => i % 16);

const welcome = (name) => {
  const v = fx.server.find((s) => s.name === name);
  if (!v) throw new Error(`missing Rust-generated ${name} vector (P-DRESS-BAKE-1 adds it)`);
  return decode(bytes(v.hex)).map;
};
const canon = (p) => ({ kind: p.kind, x: p.x, y: p.y, variant: p.variant, flags: p.flags });

const both = welcome("welcome_dress_props_ground");
eq([both.w, both.h], [W, H], "welcome_dress_props_ground size");
eq(both.props.map(canon), goldenProps, "welcome_dress_props_ground props");
eq(Array.from(both.groundVariants ?? []), goldenGround, "welcome_dress_props_ground ground plane");
const only = welcome("welcome_dress_props_only");
eq(only.props.map(canon), goldenProps, "welcome_dress_props_only props");
eq(only.groundVariants, null, "welcome_dress_props_only ships no ground plane");

const refusals = {
  map17_dress_prop_kind_zero: "prop kind",
  map17_dress_prop_kind_over: "prop kind",
  map17_dress_legacy_kind_over: "prop kind",
  map17_dress_prop_flags: "prop flags",
  map17_dress_prop_variant: "prop variant",
  map17_dress_prop_x_outside: "prop tile",
  map17_dress_prop_y_outside: "prop tile",
  map17_dress_prop_order: "prop order",
  map17_dress_prop_duplicate: "prop order",
  map17_dress_props_truncated: "truncated",
  map17_dress_ground_over: "ground variant",
  map17_dress_ground_long: "run",
};
for (const [name, reason] of Object.entries(refusals)) {
  const v = fx.malformedMap.find((m) => m.name === name);
  if (!v) throw new Error(`missing Rust-generated malformedMap vector ${name}`);
  eq(v.reason, reason, `${name} reason`);
  let err = null;
  try { decode(bytes(v.hex)); } catch (e) { err = e; }
  eq(new RegExp(`${reason}$`).test(String(err?.message)), true, `${name} refused for "${reason}" (got ${err?.message})`);
}
console.log(`dressing vectors: ${checks} checks ok`);
