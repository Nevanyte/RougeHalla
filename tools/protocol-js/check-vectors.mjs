// Holds the JS decoder of the browser probe (crates/rh-server/web/probe.html) to the golden vectors in
// protocol/fixtures/v3.json: every server vector decodes, a Snapshot or Fx decodes to exactly the fields (floats as bit
// patterns) the vector lists, every frame in malformedServer is rejected for the documented reason, and every truncation of
// every server vector throws, and every chain of frames replays on a Tracker to the recorded snapshot at every step (a delta it
// cannot apply is refused for the recorded reason and changes nothing). The decoder block is lifted out of the page between its two marker comments.
//   node tools/protocol-js/check-vectors.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "crates/rh-server/web/probe.html"), "utf8");
const a = html.indexOf("// ---- protocol v3");
const b = html.indexOf("// ---- probe state");
if (a < 0 || b < 0) throw new Error("probe.html markers not found");
const { decode, Tracker } = new Function(`"use strict"; ${html.slice(a, b)}; return { decode, Tracker };`)();
const fx = JSON.parse(readFileSync(join(root, "protocol/fixtures/v3.json"), "utf8"));

const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)).buffer;
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const bits = (x) => { f32[0] = x; return u32[0]; };

let checks = 0;
const eq = (got, want, what) => {
  checks++;
  if (got !== want) throw new Error(`${what}: got ${got}, want ${want}`);
};

function checkSnapshot(m, d, n) {
    eq(m.tick, d.tick, `${n} tick`); eq(m.serverMs, d.serverMs, `${n} serverMs`); eq(m.phase, d.phase, `${n} phase`); eq(m.ack, d.ack, `${n} ack`);
    if (d.me === null) eq(m.me, null, `${n} me`);
    else {
      const e = d.me, s = m.me;
      for (const [k, jk] of [["id", "id"], ["faction", "faction"], ["status", "status"], ["weapon", "weapon"], ["readyIn", "readyInMs"], ["kills", "kills"], ["bounty", "bounty"], ["gv", "gv"], ["moveSeq", "moveSeq"]]) eq(s[k], e[jk], `${n} me.${k}`);
      for (const [k, jk] of [["x", "xBits"], ["y", "yBits"], ["facing", "facingBits"], ["hp", "hpBits"], ["maxHp", "maxHpBits"]]) eq(bits(s[k]), e[jk], `${n} me.${k}`);
    }
    eq(m.actors.length, d.actors.length, `${n} actors`);
    d.actors.forEach((e, i) => {
      const s = m.actors[i];
      for (const k of ["id", "faction", "hpPct", "status", "weapon", "bounty"]) eq(s[k], e[k], `${n} actor ${i}.${k}`);
      for (const [k, jk] of [["x", "xBits"], ["y", "yBits"], ["facing", "facingBits"]]) eq(bits(s[k]), e[jk], `${n} actor ${i}.${k}`);
    });
}

for (const v of fx.server) {
  const m = decode(bytes(v.hex));
  if (v.decoded === undefined) continue;
  const d = v.decoded, n = v.name;
  if (m.t === "snapshot") {
    checkSnapshot(m, d, n);
  } else if (m.t === "fx") {
    eq(m.tick, d.tick, `${n} tick`); eq(m.fx.length, d.fx.length, `${n} fx`);
    d.fx.forEach((e, i) => {
      const s = m.fx[i];
      eq(s.k, e.k, `${n} fx ${i}.k`);
      if (e.k === "swing") { eq(s.by, e.by, `${n} by`); eq(s.weapon, e.weapon, `${n} weapon`); eq(bits(s.x), e.xBits, `${n} x`); eq(bits(s.y), e.yBits, `${n} y`); eq(bits(s.a), e.aBits, `${n} a`); }
      else { eq(s.victim, e.victim, `${n} victim`); eq(s.by, e.by, `${n} by`); eq(bits(s.amount), e.amountBits, `${n} amount`); }
    });
  }
}

// The JS decoder reports a reason as an Error message (RangeError for a read past the end).
const reason = {
  empty: /./, truncated_snapshot: /./, self_truncated: /./, actor_count_without_actors: /./,
  unknown_tag: /unknown tag/, client_tag_from_server: /unknown tag/, trailing_byte: /trailing/,
  overlong_varint: /varint/, varint_past_u32: /varint/, varint_too_long: /varint/,
  head_self_bit_without_present_bit: /head/, head_reserved_bit: /head/, self_max_hp_over_u16: /max_hp/,
  too_many_actors: /too many actors/, actor_reserved_mask_bit: /actor mask/, actor_id_gap_zero: /actor order/, actor_id_overflow: /actor order/,
  actor_hp_over_100: /hp_pct/, actor_bounty_over_u16: /bounty/, fx_too_many: /too many fx/, fx_bad_tag: /bad fx/,
  delta_age_zero: /base age/, delta_age_over_max: /base age/, delta_age_past_tick: /base age/, delta_head_field_without_present_bit: /head/,
  delta_self_status_over_3: /status/, delta_actor_id_gap_zero: /actor order/, delta_actor_hp_over_100: /hp_pct/,
  delta_actor_bounty_over_u16: /bounty/, delta_too_many_actors: /too many actors/, delta_departed_empty: /departed/,
  delta_departed_id_gap_zero: /departed order/, delta_departed_too_many: /too many actors/, delta_truncated: /./, delta_trailing_byte: /trailing/,
  reject_code_zero: /reject code/, reject_code_unknown: /reject code/, server_bad_utf8: /utf-8/,
  map_zero_size: /map size/, map_too_large: /map size/, map_bad_tile: /map run/, map_zero_run: /map run/,
  map_run_past_size: /map run/, map_short: /map length/, map_hash_mismatch: /map hash/,
};
for (const v of fx.malformedServer) {
  const want = reason[v.name];
  if (!want) throw new Error(`no expectation for malformed vector ${v.name}`);
  let err = null;
  try { decode(bytes(v.hex)); } catch (e) { err = e; }
  checks++;
  if (!err) throw new Error(`${v.name} was accepted`);
  if (!want.test(String(err.message))) throw new Error(`${v.name}: rejected for "${err.message}", expected ${want}`);
}

for (const v of fx.server) {
  const full = bytes(v.hex);
  for (let cut = 0; cut < full.byteLength; cut++) {
    let threw = false;
    try { decode(full.slice(0, cut)); } catch { threw = true; }
    checks++;
    if (!threw) throw new Error(`${v.name} cut to ${cut} bytes was accepted`);
  }
}

// Chains: a fresh Tracker per chain; every step is applied, reset by a Welcome, or refused for the recorded reason with the held state kept.
for (const c of fx.chains) {
  const t = new Tracker();
  c.steps.forEach((st, i) => {
    const at = `chain ${c.name} step ${i}`;
    if (st.refused !== undefined) {
      const held = t.base && { tick: t.base.tick, n: t.base.actors.length };
      let err = null;
      try { t.decode(bytes(st.hex)); } catch (e) { err = e; }
      checks++;
      if (!err) throw new Error(`${at}: the delta was applied, want refused ${st.refused}`);
      eq(err.code, st.refused, `${at} reason`);
      eq(JSON.stringify(t.base && { tick: t.base.tick, n: t.base.actors.length }), JSON.stringify(held), `${at} state kept`);
      return;
    }
    const m = t.decode(bytes(st.hex));
    if (st.reset) { eq(m.t, "welcome", `${at} welcome`); eq(t.base, null, `${at} reset`); }
    else if (st.held) { eq(t.base.tick, st.held.tick, `${at} held tick`); eq(t.base.actors.length, st.held.actors, `${at} held actors`); }
    else checkSnapshot(m, st.decoded, at);
  });
}

console.log(`JS decoder agrees with protocol/fixtures/v3.json: ${fx.server.length} server vectors, ${fx.malformedServer.length} malformed, ${fx.chains.length} chains, ${checks} checks`);
