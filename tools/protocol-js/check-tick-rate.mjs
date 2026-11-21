// P-TICK-3 oracle (JS, ADR 0029, protocol 21): holds the browser probe's decoder (crates/rh-server/web/probe.html, lifted
// out between its marker comments as check-vectors.mjs does) to the snapshot time rule. A snapshot's server time is
// tick * (1000 / Welcome.tickRate); only 20 and 40 are rates, so a Welcome at 30 is refused. The same frame bytes stand for
// tick * 50 at 20 and tick * 25 at 40. A Tracker reads snapshots at its latest Welcome's rate (20 before any, as every
// vNN.json chain starts); a Tracker made with { awaitWelcome: true } refuses a snapshot that arrives before its Welcome.
// The 40 Hz vectors of protocol/fixtures/v21.json ("serverTickRate40") decode to tick * 25.
// The frames below are the Rust encoder's (crates/rh-protocol/tests/tick_rate_wire.rs).
//   node tools/protocol-js/check-tick-rate.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "crates/rh-server/web/probe.html"), "utf8");
const a = html.search(/\/\/ ---- protocol v\d+/);
const b = html.indexOf("// ---- probe state");
if (a < 0 || b < 0) throw new Error("probe.html markers not found");
const { decode, Tracker } = new Function(`"use strict"; ${html.slice(a, b)}; return { decode, Tracker };`)();
const PROTOCOL = Number(/const PROTOCOL = (\d+);/.exec(html.slice(a, b))[1]);

const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)).buffer;
const FULL10 = "830a0a000c01006004c00600000100a005400700000100e006c0070000010020084008000001006009c00800000100a00a400900000100e00bc00900000100200d400a00000100600ec00a00000100a00f400b00000100e010c00b000001002012400c0000";
const DELTA11 = "870b010b000103012007"; // tick 11 against FULL10, actor 3 moved
const TICK20_AT_888 = "8314038080200000000000c68b4000"; // an override of 888.75 ms: the default at neither rate
const TICK7 = "8307030000";
// Byte offset of tickRate in a Welcome: tag 1 + protocol 2 + content hash 8 + match 16 + player 4 + session 16.
const WELCOME_RATE_AT = 47;

/** The v20 golden Welcome with this page's protocol and the rate byte replaced. */
function welcome(rate) {
  const v20 = JSON.parse(readFileSync(join(root, "protocol/fixtures/v20.json"), "utf8"));
  const w = new Uint8Array(bytes(v20.server.find((v) => v.name === "welcome").hex));
  if (w[WELCOME_RATE_AT] !== 20) throw new Error("the v20 welcome vector says tick rate 20 at byte 47");
  new DataView(w.buffer).setUint16(1, PROTOCOL, true);
  w[WELCOME_RATE_AT] = rate;
  return w.buffer;
}

let checks = 0;
const failures = [];
const check = (what, fn) => {
  checks++;
  try { fn(); } catch (e) { failures.push(`${what}: ${e.message}`); }
};
const eq = (got, want, what) => { if (!Object.is(got, want)) throw new Error(`${what ?? "value"}: got ${got}, want ${want}`); };
const throws = (fn, re, what) => {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  if (!err) throw new Error(`${what}: did not throw`);
  if (re && !re.test(String(err.message))) throw new Error(`${what}: threw "${err.message}", want ${re}`);
};

check("the probe speaks protocol 22 (21 merged by P-SYNC-ORIGIN-2)", () => eq(PROTOCOL, 22, "const PROTOCOL"));

check("the same Full bytes are tick * 50 at 20 and tick * 25 at 40", () => {
  eq(decode(bytes(FULL10)).serverMs, 500, "tick 10, no rate (the 20 Hz decode)");
  eq(decode(bytes(FULL10), 20).serverMs, 500, "tick 10 at 20 Hz");
  eq(decode(bytes(FULL10), 40).serverMs, 250, "tick 10 at 40 Hz");
  eq(decode(bytes(TICK7), 40).serverMs, 175, "tick 7 at 40 Hz");
});

check("a delta without override is tick * the rate's ms", () => {
  eq(decode(bytes(DELTA11), 20).serverMs, 550, "tick 11 at 20 Hz");
  eq(decode(bytes(DELTA11), 40).serverMs, 275, "tick 11 at 40 Hz");
});

check("an override is read as written at both rates", () => {
  eq(decode(bytes(TICK20_AT_888), 20).serverMs, 888.75, "at 20 Hz");
  eq(decode(bytes(TICK20_AT_888), 40).serverMs, 888.75, "at 40 Hz");
});

check("a Welcome at 30 is refused, 20 and 40 accepted", () => {
  eq(decode(welcome(20)).tickRate, 20, "a 20 Hz Welcome");
  eq(decode(welcome(40)).tickRate, 40, "a 40 Hz Welcome");
  for (const rate of [30, 0, 60]) throws(() => decode(welcome(rate)), /tick rate/, `a Welcome at ${rate} Hz`);
  throws(() => decode(bytes(TICK7), 30), /tick rate/, "a snapshot read at 30 Hz");
});

check("a Tracker reads snapshots at its latest Welcome's rate", () => {
  const t = new Tracker();
  eq(t.decode(bytes(FULL10)).serverMs, 500, "no Welcome yet: 20 Hz, as every vNN.json chain starts");
  t.decode(welcome(40));
  eq(t.decode(bytes(FULL10)).serverMs, 250, "a Full frame after a 40 Hz Welcome");
  eq(t.decode(bytes(DELTA11)).serverMs, 275, "the delta resolves at 40 Hz");
  eq(t.base.serverMs, 275, "the held snapshot too");
  throws(() => t.decode(welcome(30)), /tick rate/, "a 30 Hz Welcome");
  eq(t.base.tick, 11, "a refused Welcome resets nothing");
  eq(t.decode(bytes(TICK7)).serverMs, 175, "still at 40 Hz");
  t.decode(welcome(20));
  eq(t.decode(bytes(FULL10)).serverMs, 500, "back at 20 Hz");
  eq(t.decode(bytes(DELTA11)).serverMs, 550, "the delta at 20 Hz");
});

check("a Tracker awaiting its Welcome refuses a snapshot that arrives first", () => {
  const t = new Tracker({ awaitWelcome: true });
  throws(() => t.decode(bytes(FULL10)), /welcome/i, "a Full frame before the Welcome");
  throws(() => t.decode(bytes(DELTA11)), /welcome/i, "a delta before the Welcome");
  eq(t.base, null, "nothing is held");
  throws(() => t.decode(welcome(30)), /tick rate/, "a 30 Hz Welcome");
  throws(() => t.decode(bytes(FULL10)), /welcome/i, "a refused Welcome gives no rate");
  t.decode(welcome(40));
  eq(t.decode(bytes(FULL10)).serverMs, 250, "a Full frame after a 40 Hz Welcome");
  eq(t.decode(bytes(DELTA11)).serverMs, 275, "the delta at 40 Hz");
});

check("v21.json 40 Hz vectors decode to tick * 25", () => {
  const path = join(root, "protocol/fixtures/v21.json");
  if (!existsSync(path)) throw new Error("protocol/fixtures/v21.json is missing (cargo run -p rh-protocol --bin protocol-fixtures)");
  const fx = JSON.parse(readFileSync(path, "utf8"));
  eq(fx.protocol, 21, "v21.json protocol");
  const section = fx.serverTickRate40 ?? [];
  if (section.length < 3) throw new Error(`v21.json has a serverTickRate40 section with at least three vectors, got ${section.length}`);
  for (const v of section) {
    const m = decode(bytes(v.hex), 40);
    eq(m.tick, v.decoded.tick, `${v.name} tick`);
    eq(m.serverMs, v.decoded.serverMs, `${v.name} serverMs`);
  }
});

if (failures.length) {
  for (const f of failures) console.error("FAIL " + f);
  console.error(`check-tick-rate: ${failures.length} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`JS decoder reads snapshot time from the Welcome's tick rate: ${checks} checks`);
