// Holds the JS decoder of the browser probe (crates/rh-server/web/probe.html) to the golden vectors in
// protocol/fixtures/v<PROTOCOL>.json: every server vector decodes, a Snapshot or Fx decodes to exactly the fields (floats as bit
// patterns) the vector lists, every frame in malformedServer is rejected for the documented reason, and every truncation of
// every server vector throws, and every chain of frames replays on a Tracker to the recorded snapshot at every step (a delta it
// cannot apply is refused for the recorded reason and changes nothing). The decoder block is lifted out of the page between its two marker comments.
//   node tools/protocol-js/check-vectors.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "crates/rh-server/web/probe.html"), "utf8");
const a = html.search(/\/\/ ---- protocol v\d+/);
const b = html.indexOf("// ---- probe state");
if (a < 0 || b < 0) throw new Error("probe.html markers not found");
const { decode, decodeClient, input, Tracker } = new Function(`"use strict"; ${html.slice(a, b)}; return { decode, decodeClient, input, Tracker };`)();
const version = /const PROTOCOL = (\d+);/.exec(html.slice(a, b))[1];
const fx = JSON.parse(readFileSync(join(root, `protocol/fixtures/v${version}.json`), "utf8"));
if (fx.protocol !== Number(version)) throw new Error(`the page speaks protocol ${version}, the vectors ${fx.protocol}`);

const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)).buffer;
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const bits = (x) => { f32[0] = x; return u32[0]; };

let checks = 0;
const eq = (got, want, what) => {
  checks++;
  if (got !== want) throw new Error(`${what}: got ${got}, want ${want}`);
};

for (const v of fx.client) {
  const m = decodeClient(bytes(v.hex)); checks++;
  if (m.t === "input") eq(Buffer.from(input(m.seq, m.cmds)).toString("hex"), v.hex, v.name + " input encoding");
  for (let n = 0; n < v.hex.length / 2; n++) { let threw = false; try { decodeClient(bytes(v.hex.slice(0, n * 2))); } catch { threw = true; } eq(threw, true, v.name + " truncated client"); }
}
for (const v of fx.malformedClient) { let threw = false; try { decodeClient(bytes(v.hex)); } catch { threw = true; } eq(threw, true, v.name + " malformed client"); }
const combat = decodeClient(bytes(fx.client.find(v => v.name === "input_combat").hex));
eq(JSON.stringify(combat.cmds), JSON.stringify([{ k: "swap", slot: null }, { k: "swap", slot: 0 }, { k: "swap", slot: 1 }, { k: "pickup", handle: 42 }]), "combat command fields");
const choices=decodeClient(bytes(fx.client.find(v=>v.name==="input_choices").hex));
eq(JSON.stringify(choices.cmds),JSON.stringify([-1,0,1,2].map(pick=>({k:"choose",handle:0xffffffff,pick}))),"typed reward choices including skip");
const chestRefusals=decode(bytes(fx.server.find(v=>v.name==="chest_refusals").hex));
eq(JSON.stringify(chestRefusals.events),JSON.stringify([1,2,3,4,5,6,7,8,9].map(reason=>({k:"chestRefused",reason}))),"owner reward refusal reasons");
const refusals = decode(bytes(fx.server.find(v => v.name === "pickup_refusals").hex));
eq(JSON.stringify(refusals.events), JSON.stringify([1,2,3,4,5].map(reason => ({ k: "pickupRefused", reason }))), "owner refusal reasons");

const stateBytes = bytes(fx.server.find(v => v.name === "state_all").hex);
const collectionTracker = new Tracker();
const state = collectionTracker.decode(stateBytes);
const publicField = {kind:2,ability:3,owner:null,subject:1,x:20,y:30,x2:40,y2:50,r:12,vx:-2,vy:0,startedAt:1000.5,endsAt:6000.5};
eq(JSON.stringify(state.items), JSON.stringify([
  {key:1,value:{activeSlot:1,slots:[null,2],potionSmall:5,potionLarge:4,potionsHealing:3}},
  {key:2,value:{rows:[{handle:1,x:800,y:900,kind:1,weapon:0},{handle:2,x:801,y:902,kind:2,open:true},{handle:3,x:802,y:903,kind:3,label:"\ufeffBÖB"}],focus:{handle:3,bodyHint:4}}},
  {key:3,value:[publicField,publicField]},
  {key:4,value:[{handle:0xffffffff,x:100,y:200,expiresAt:15000,options:[{kind:1,id:0,taken:false,takenBy:null},{kind:2,id:7,taken:true,takenBy:1}],picked:false,canChoose:true}]},
  {key:5,value:{cards:[1,0,1],boosts:[0,1,2,3,0,1,2,3]}},
  {key:6,value:[{mobType:0,elite:30,alive:0,state:2,clearedAt:1000,respawnAt:181000}]},
  {key:7,value:[{kind:0,x:800,y:900,facing:12345,owner:1},{kind:0,x:800,y:900,facing:12345,owner:1}]}
]), "all reliable public facts");
collectionTracker.decode(bytes(fx.server.find(v => v.name === "snapshot").hex));
eq(collectionTracker.collections.size, 7, "snapshot retains reliable collections");
collectionTracker.decode(new Uint8Array([0x88,1,1,1,0]).buffer);
eq(collectionTracker.collections.get(1), null, "missing inventory clears");
eq(collectionTracker.collections.get(2).rows.length, 3, "missing key retains props");
const heldProps = JSON.stringify(collectionTracker.collections.get(2));
let badState; try { collectionTracker.decode(new Uint8Array([0x88,2,2,2,0,0,6]).buffer); } catch(e) {badState=e;}
eq(!!badState, true, "malformed later key is refused");
eq(JSON.stringify(collectionTracker.collections.get(2)), heldProps, "malformed state applies no earlier key");
collectionTracker.decode(bytes(fx.server.find(v => v.name === "welcome").hex));
eq(collectionTracker.collections.size, 0, "welcome clears observer epoch");
collectionTracker.decode(stateBytes);
collectionTracker.decode(bytes(fx.server.find(v => v.name === "state_clear").hex));
eq(collectionTracker.collections.get(2).rows.length, 0, "empty replacement clears props");
eq(collectionTracker.collections.get(3).length, 0, "empty replacement clears fields");
eq(collectionTracker.collections.get(4).length, 0, "empty replacement clears reward offers");
eq(collectionTracker.collections.get(5), null, "build clear");
eq(collectionTracker.collections.get(6).length,0,"camp clear");
eq(collectionTracker.collections.get(7).length,0,"projectiles clear");

const bomReject = decode(bytes(fx.server.find(v => v.name === "reject_unknown_bom").hex));
eq(bomReject.code, 300, "unknown Reject code"); eq(bomReject.reason, "\uFEFFa", "unknown Reject BOM reason");
const maxFx = new Uint8Array(262144); maxFx.set([0x85, 0, 0x80, 0x80, 2]);
for (let i = 0; i < 32767; i++) maxFx.set([3, 1, 255, 255, 255, 255, 15, 1], 5 + i * 8);
maxFx.set([4, 128, 1], 262141);
eq(decode(maxFx.buffer).fx.length, 32768, "exact maximum server frame");
for (const size of [262145, 262149]) {
  const oversized = new Uint8Array(size); oversized.set(maxFx.subarray(0, 262141));
  oversized.set(size === 262145 ? [4, 128, 128, 1] : [3, 1, 255, 255, 255, 255, 15, 1], 262141);
  let err; try { decode(oversized.buffer); } catch (e) { err = e; }
  eq(err?.message, "frame too large", "server frame cap " + size);
}
const wrongWelcome = Uint8Array.from(new Uint8Array(bytes(fx.server.find(v => v.name === "welcome").hex))); wrongWelcome[1] = 4;
const welcomeTracker = new Tracker(); welcomeTracker.base = { tick: 99 };
let wrongVersion; try { welcomeTracker.decode(wrongWelcome.buffer); } catch (e) { wrongVersion = e; }
eq(wrongVersion?.protocolMismatch, true, "wrong Welcome version"); eq(welcomeTracker.base.tick, 99, "wrong Welcome retains baseline");

function checkSnapshot(m, d, n) {
    eq(m.tick, d.tick, `${n} tick`); eq(m.serverMs, d.serverMs, `${n} serverMs`); eq(m.phase, d.phase, `${n} phase`); eq(m.ack, d.ack, `${n} ack`);
    if (d.me === null) eq(m.me, null, `${n} me`);
    else {
      const e = d.me, s = m.me;
      for (const [k, jk] of [["id", "id"], ["faction", "faction"], ["status", "status"], ["weapon", "weapon"], ["readyIn", "readyInMs"], ["kills", "kills"], ["bounty", "bounty"], ["gv", "gv"], ["moveSeq", "moveSeq"], ["effects", "effects"], ["displaceSeq", "displaceSeq"], ["sig", "sig"], ["huntTarget", "huntTarget"], ["huntStacks", "huntStacks"]]) eq(s[k], e[jk], `${n} me.${k}`);
      for (const [k, jk] of [["x", "xBits"], ["y", "yBits"], ["facing", "facingBits"], ["hp", "hpBits"], ["maxHp", "maxHpBits"]]) eq(bits(s[k]), e[jk], `${n} me.${k}`);
    }
    eq(m.actors.length, d.actors.length, `${n} actors`);
    d.actors.forEach((e, i) => {
      const s = m.actors[i];
      for (const k of ["id", "faction", "hpPct", "status", "weapon", "bounty", "kind", "effects", "displaceSeq", "mobTypeCode", "sig"]) eq(s[k], e[k], `${n} actor ${i}.${k}`);
      for (const [k, jk] of [["x", "xBits"], ["y", "yBits"], ["facing", "facingBits"]]) eq(bits(s[k]), e[jk], `${n} actor ${i}.${k}`);
    });
}

for (const v of fx.server) {
  const m = decode(bytes(v.hex));
  if (v.name === "reject_code_unknown") { eq(m.code, 12, `${v.name} code`); eq(m.reason, "", `${v.name} reason`); }
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
      else if (e.k === "block") { eq(s.id, e.id, `${n} id`); eq(s.by, e.by, `${n} by`); eq(s.weapon, e.weapon, `${n} weapon`); }
      else if (e.k === "stagger") eq(s.id, e.id, `${n} id`);
      else { eq(s.passive, e.passive, `${n} passive`); eq(s.victim, e.victim, `${n} victim`); eq(s.by, e.by, `${n} by`); eq(bits(s.amount), e.amountBits, `${n} amount`); }
    });
  }
}

// The JS decoder reports a reason as an Error message (RangeError for a read past the end).
const reason = {
  state_too_many_projectiles:/too many/,projectile_kind:/projectile/,projectile_owner_zero:/handle/,projectile_owner_flag:/option/,projectile_owner_overlong:/varint/,
  potion_notice_zero:/potion notice/,potion_notice_unknown:/potion notice/,state_too_many_camps:/too many/,
  camp_mob_type:/camp/,camp_elite:/camp/,camp_alive:/camp/,camp_state:/camp/,camp_negative_time:/camp/,camp_nonfinite_time:/field/,camp_time_order:/camp/,
  actor_mob_type_over_30:/mob type/,delta_actor_mob_type_over_30:/mob type/,
  chest_bad_reason_zero: /chest reason/, chest_bad_reason_unknown: /chest reason/,
  hit_bad_passive: /bad option/, pickup_bad_reason_zero: /bad field/, pickup_bad_reason_unknown: /bad field/,
  empty: /./, truncated_snapshot: /./, self_truncated: /./, actor_count_without_actors: /./,
  unknown_tag: /unknown tag/, client_tag_from_server: /unknown tag/, trailing_byte: /trailing/,
  overlong_varint: /varint/, varint_past_u32: /varint/, varint_too_long: /varint/,
  head_self_bit_without_present_bit: /head/, head_unknown_bit: /head/, head_overlong_varint: /varint/, self_status_over_3: /status/, phase_over_3: /phase/,
  self_max_hp_over_u16: /max_hp/, actor_status_over_3: /status/, actor_mask_overlong_varint: /varint/, actor_unknown_mask_bit_after_kind: /actor mask/,
  state_duplicate_key: /state key/, state_key_order: /state key/, state_too_many_keys: /too many/, state_too_many_props: /too many/, state_too_many_fields: /too many/, state_too_many_rewards: /too many/, state_bad_potion_count: /potion count/, state_zero_prop_handle: /handle/, state_missing_focus: /prop focus/,
  state_unknown_key: /state key/, state_trailing_byte: /trailing/, state_truncated: /./,
  delta_head_unknown_bit: /head/, delta_head_overlong_varint: /varint/, delta_phase_over_3: /phase/, delta_actor_mask_unknown_bit: /actor mask/,
  delta_actor_status_over_3: /status/,
  too_many_actors: /too many actors/, actor_reserved_mask_bit: /actor mask/, actor_id_gap_zero: /actor order/, actor_id_overflow: /actor order/,
  actor_hp_over_100: /hp_pct/, actor_bounty_over_u16: /bounty/, fx_too_many: /too many fx/, fx_bad_tag: /bad fx/,
  delta_age_zero: /base age/, delta_age_over_max: /base age/, delta_age_past_tick: /base age/, delta_head_field_without_present_bit: /head/,
  delta_self_status_over_3: /status/, delta_actor_id_gap_zero: /actor order/, delta_actor_hp_over_100: /hp_pct/,
  delta_actor_bounty_over_u16: /bounty/, delta_too_many_actors: /too many actors/, delta_departed_empty: /departed/,
  delta_departed_id_gap_zero: /departed order/, delta_departed_too_many: /too many actors/, delta_truncated: /./, delta_trailing_byte: /trailing/,
  reject_code_zero: /reject code/, server_bad_utf8: /utf-8/,
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

console.log(`JS decoder agrees with protocol/fixtures/v${version}.json: ${fx.server.length} server vectors, ${fx.malformedServer.length} malformed, ${fx.chains.length} chains, ${checks} checks`);
