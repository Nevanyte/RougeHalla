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
const { decode, decodeClient, input, Tracker, remoteActorPresentation } = new Function(`"use strict"; ${html.slice(a, b)}; return { decode, decodeClient, input, Tracker, remoteActorPresentation };`)();
const version = /const PROTOCOL = (\d+);/.exec(html.slice(a, b))[1];
const fx = JSON.parse(readFileSync(join(root, `protocol/fixtures/v${version}.json`), "utf8"));
if (fx.protocol !== Number(version)) throw new Error(`the page speaks protocol ${version}, the vectors ${fx.protocol}`);

const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)).buffer;
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const bits = (x) => { f32[0] = x; return u32[0]; };

let checks = 0;
const castOptionalCoverage = new Set();
const castSlotCoverage = new Set();
const castVectors = new Set();
const castSlotOptionalCoverage = new Set();
const eq = (got, want, what) => {
  checks++;
  if (got !== want) throw new Error(`${what}: got ${got}, want ${want}`);
};
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
const eqJson = (got, want, what) => eq(JSON.stringify(canonical(got)), JSON.stringify(canonical(want)), what);
const exactJson = (got, want, what) => {
  const same = (a, b) => {
    // Rust JSON serializes negative zero as `0`; the raw decoder check below asserts its sign directly.
    if (typeof a === "number" || typeof b === "number") return Object.is(a, b) || (a === 0 && b === 0);
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
    if (a && b && typeof a === "object" && typeof b === "object") {
      const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
      return ak.length === bk.length && ak.every((k, i) => k === bk[i] && same(a[k], b[k]));
    }
    return a === b;
  };
  checks++;
  if (!same(got, want)) throw new Error(`${what}: exact numeric/object mismatch`);
};

for (const v of fx.client) {
  const m = decodeClient(bytes(v.hex)); checks++;
  if (m.t === "input") eq(Buffer.from(input(m.seq, m.cmds)).toString("hex"), v.hex, v.name + " input encoding");
  if (v.decoded !== undefined && v.decoded.k === "input" && Array.isArray(v.decoded.commands)) {
    const commands = m.cmds.map((c) => c.k === "cast"
      ? { k: c.k, slot: c.slot, xBits: bits(c.x), yBits: bits(c.y), actor: c.actorRef, t: c.t, seq: c.seq }
      : c);
    eqJson(commands, v.decoded.commands, v.name + " decoded client commands");
  } else if (v.decoded !== undefined) eqJson(m, v.decoded, v.name + " decoded client");
  for (const c of m.cmds ?? []) if (c.k === "cast") {
    if (v.decoded === undefined) throw new Error(`${v.name} Cast vector lacks Rust-decoded JSON`);
    castVectors.add(v.name);
    castSlotCoverage.add(c.slot);
    const optionalMask = (c.actorRef === null ? 0 : 1) | (c.t === null ? 0 : 2) | (c.seq === null ? 0 : 4);
    castOptionalCoverage.add(optionalMask);
    castSlotOptionalCoverage.add(`${c.slot}:${optionalMask}`);
  }
  for (let n = 0; n < v.hex.length / 2; n++) { let threw = false; try { decodeClient(bytes(v.hex.slice(0, n * 2))); } catch { threw = true; } eq(threw, true, v.name + " truncated client"); }
}
for (const v of fx.malformedClient) { let threw = false; try { decodeClient(bytes(v.hex)); } catch { threw = true; } eq(threw, true, v.name + " malformed client"); }
for (let i = 0; i <= 2; i++) if (!castSlotCoverage.has(i)) throw new Error(`missing Rust Cast vector for slot ${i}`);
for (let i = 0; i < 8; i++) if (!castOptionalCoverage.has(i)) throw new Error(`missing Rust Cast optional-field combination ${i}`);
for (let slot = 0; slot <= 2; slot++) for (let mask = 0; mask < 8; mask++) {
  if (!castSlotOptionalCoverage.has(`${slot}:${mask}`)) throw new Error(`missing Rust Cast slot/optional combination ${slot}:${mask}`);
}
if (![...castVectors].some((name) => name.startsWith("input_cast_matrix"))) throw new Error("missing Rust-generated input_cast_matrix vectors");
const combat = decodeClient(bytes(fx.client.find(v => v.name === "input_combat").hex));
eq(JSON.stringify(combat.cmds), JSON.stringify([{ k: "swap", slot: null }, { k: "swap", slot: 0 }, { k: "swap", slot: 1 }, { k: "pickup", handle: 42 }]), "combat command fields");
const choices=decodeClient(bytes(fx.client.find(v=>v.name==="input_choices").hex));
eq(JSON.stringify(choices.cmds),JSON.stringify([-1,0,1,2].map(pick=>({k:"choose",handle:0xffffffff,pick}))),"typed reward choices including skip");
const plans=decodeClient(bytes(fx.client.find(v=>v.name==="input_plan").hex));
eq(JSON.stringify(plans.cmds),JSON.stringify([{k:"plan",spawn:0,boon:null,ready:null},{k:"plan",spawn:null,boon:1,ready:null},{k:"plan",spawn:null,boon:null,ready:true},{k:"plan",spawn:1,boon:0,ready:false}]),"planning commands");
const chestRefusals=decode(bytes(fx.server.find(v=>v.name==="chest_refusals").hex));
eq(JSON.stringify(chestRefusals.events),JSON.stringify([1,2,3,4,5,6,7,8,9].map(reason=>({k:"chestRefused",reason}))),"owner reward refusal reasons");
const cannonNotices = decode(bytes(fx.server.find(v => v.name === "cannon_notices").hex));
eq(JSON.stringify(cannonNotices.events), JSON.stringify([{k:"cannonNotice",code:1},{k:"cannonNotice",code:2},{k:"cannonNotice",code:3},{k:"cannonNotice",code:4,seconds:74}]), "cannon notice codes");
const refusals = decode(bytes(fx.server.find(v => v.name === "pickup_refusals").hex));
eq(JSON.stringify(refusals.events), JSON.stringify([1,2,3,4,5].map(reason => ({ k: "pickupRefused", reason }))), "owner refusal reasons");

const catalogRewards = decode(bytes(fx.server.find(v => v.name === "state_full_catalog_rewards").hex));
eq(JSON.stringify(catalogRewards.items[0].value[0].options.map(o => [o.kind,o.id])), JSON.stringify([[1,3],[1,79],[2,7]]), "full card catalog reward positions");
if (version >= 13) {
  const trophyVector = fx.server.find(v => v.name === "state_trophy_reward_keys");
  if (!trophyVector?.decoded) throw new Error("missing Rust-decoded state_trophy_reward_keys vector");
  const trophyState = decode(bytes(trophyVector.hex));
  const { t, ...stateFields } = trophyState;
  eqJson({ ...stateFields, kind: t }, trophyVector.decoded, "typed Trophy reward state exact values");
  const rewards = trophyState.items.find(item => item.key === 4)?.value ?? [];
  const keys = new Set(rewards.flatMap(row => row.options.filter(option => option.kind === 3).map(option => option.key)));
  for (let key = 0; key <= 8; key++) if (!keys.has(key)) throw new Error(`missing Rust-generated Trophy key ${key}`);
  eq(keys.size, 9, "all and only nine Trophy keys");
}
const unionProps = decode(bytes(fx.server.find(v => v.name === "state_union_props").hex));
eq(JSON.stringify(unionProps.items[0].value.rows), JSON.stringify([
  {handle:1,x:80,y:160,kind:4,label:"fallen"}, {handle:2,x:81,y:161,kind:5},
  {handle:3,x:82,y:162,kind:6,readyAt:0xffffffff}
]), "corpse, wind and cannon keep distinct payloads");
const unionEvents = decode(bytes(fx.server.find(v => v.name === "events_union").hex));
eq(JSON.stringify(unionEvents.events), JSON.stringify([
  {k:"windEmblem"}, {k:"cannonNotice",code:4,seconds:75}, {k:"toast",text:"Practice ready"}, {k:"potionNotice",notice:10}
]), "wind, cannon, toast and potion events coexist");
const stateBytes = bytes(fx.server.find(v => v.name === "state_all").hex);
const collectionTracker = new Tracker();
const state = collectionTracker.decode(stateBytes);
const publicField = {kind:2,ability:3,owner:null,subject:1,x:20,y:30,x2:40,y2:50,r:12,vx:-2,vy:0,startedAt:1000.5,endsAt:6000.5};
eq(JSON.stringify(state.items), JSON.stringify([
  {key:1,value:{activeSlot:1,slots:[null,2],potionSmall:5,potionLarge:4,potionsHealing:3}},
  {key:2,value:{rows:[{handle:1,x:800,y:900,kind:1,weapon:0},{handle:2,x:801,y:902,kind:2,open:true},{handle:3,x:802,y:903,kind:3,label:"\ufeffBÖB"},{handle:4,x:803,y:904,kind:5}],focus:{handle:3,bodyHint:4}}},
  {key:3,value:[publicField,publicField]},
  {key:4,value:[{handle:0xffffffff,x:100,y:200,expiresAt:15000,options:[{kind:1,id:0,taken:false,takenBy:null},{kind:2,id:7,taken:true,takenBy:1}],picked:false,canChoose:true}]},
  {key:5,value:{cards:[...Array(80)].map((_,i)=>i===0||i===2?1:0),boosts:[0,1,2,3,0,1,2,3]}},
  {key:6,value:[{mobType:0,elite:30,alive:0,state:2,clearedAt:1000,respawnAt:181000}]},
  {key:7,value:[{kind:0,x:800,y:900,facing:12345,owner:1,height:30},{kind:0,x:800,y:900,facing:12345,owner:1,height:30}]},
  {key:8,value:null}, {key:9,value:null}, {key:10,value:null}, {key:11,value:null}
]), "all reliable public facts");
const planning = decode(bytes(fx.server.find(v => v.name === "state_planning").hex));
eq(JSON.stringify(planning.items.map(i => i.key)), JSON.stringify([8, 9]), "planning state keys");
eq(JSON.stringify(planning.items[0].value.spawns), JSON.stringify([12, null]), "plan spawn indexes");
eq(JSON.stringify(planning.items[0].value.options.map(o => o.zone)), JSON.stringify([3, 5]), "plan option zones");
eq(planning.items[0].value.options[1].walkSeconds, null, "typed absent walk");
eq(planning.items[1].value.startedWith, 7, "arena starter count");
eq(planning.items[1].value.patienceEndsAt, 601000, "arena patience deadline");
collectionTracker.decode(bytes(fx.server.find(v => v.name === "snapshot").hex));
eq(collectionTracker.collections.size, 11, "snapshot retains reliable collections");
collectionTracker.decode(new Uint8Array([0x88,1,1,1,0]).buffer);
eq(collectionTracker.collections.get(1), null, "missing inventory clears");
eq(collectionTracker.collections.get(2).rows.length, 4, "missing key retains props");
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

// Stateful JS contract controls: QuestHandle, roster IDs and pickup handles are distinct namespaces.
// The same numeric value is intentionally used for quest row 1, roster 1, and pickup 1.
const qcat = (...parts) => Uint8Array.from(parts.flatMap(part => Array.from(part)));
const qByte = (v) => Uint8Array.of(v);
const qVarint = (v) => { const out=[]; do { const low=v%128; v=Math.floor(v/128); out.push(low | (v ? 128 : 0)); } while(v); return Uint8Array.from(out); };
const qVarintLen = (v) => qVarint(v).length;
const qU16 = (v) => Uint8Array.of(v&255,(v>>>8)&255);
const qU32 = (v) => Uint8Array.of(v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255);
const qF64 = (v) => { const out=new Uint8Array(8); new DataView(out.buffer).setFloat64(0,v,true); return out; };
const qStr = (s) => { const b=new TextEncoder().encode(s); return qcat(qByte(b.length),b); };
const questViewBytes = (questHandle = 1) => qcat(
  qByte(1), qVarint(0), qVarint(0), qVarint(1), // available, unknown counts, owner roster
  qVarint(2), qVarint(1), qStr("same"), qVarint(2), qStr("same"), // duplicate labels are legal
  qVarint(1), qVarint(questHandle), qStr("collect_apple"), qF64(0), qF64(8191.875),
  qByte(1), qF64(0), qVarint(1), qVarint(1), qByte(1), qVarint(0), qByte(0),
  qVarint(2), qByte(1), qStr("same"), qByte(2), qVarint(0), qByte(0), // carrier, doneBy, flags, owner facts
  qStr("A name"), qStr("A giver"), qStr("A brief"), qStr("An objective"), qStr("A reward"),
  qVarint(1), qVarint(questHandle), qF64(8191.875), qF64(0), // objective
);
const questUnavailableBytes = () => qByte(0);
const tradeEmptyBytes = () => qcat(qByte(1), qByte(0), qVarint(0), qVarint(0), qByte(0), qVarint(0), qStr(""), qStr(""), qStr(""));
const tradeLabel255 = "é".repeat(127) + "a";
const tradeMaxLabelBytes = () => qcat(qByte(1), qByte(0), qVarint(0), qVarint(0), qByte(0), qVarint(0), qStr(tradeLabel255), qStr(""), qStr(""));
const tradeSignedBytes = () => qcat(qByte(1), qByte(0), qVarint(0), qVarint(2),
  qByte(1), qF64(-0), qByte(1), qF64(Number.MAX_VALUE),
  qByte(1), qF64(-0), qVarint(0), qStr(""), qStr(""), qStr(""));
const tradeInvalidOfferBytes = () => qcat(qByte(1), qByte(0), qVarint(1), qByte(1), qF64(1), qByte(1), qF64(2), qStr("bad"));
const tradeBadUsedFlagBytes = () => qcat(qByte(1), qByte(2));
const tradeBadDeadlineOptionBytes = () => qcat(qByte(1), qByte(0), qVarint(0), qVarint(0), qByte(2));
const tradeBadUtf8Bytes = () => qcat(qByte(1), qByte(0), qVarint(0), qVarint(0), qByte(0), qVarint(0), qByte(1), qByte(0xff), qStr(""), qStr(""));
const questPropBytes = (propHandle, questHandle, fetch = 0) => qcat(
  qVarint(1), qVarint(propHandle), qU16(64), qU16(72), qByte(7), qVarint(questHandle), qByte(fetch), qVarint(0),
);
const stateFrameBytes = (tick, items) => qcat(
  qByte(0x88), qVarint(tick), qVarint(items.length), ...items.flatMap(([key,payload]) => [qVarint(key),payload]),
).buffer;
const questCommand = decodeClient(input(31, [{k:"questAccept",handle:300}]).buffer);
eqJson(questCommand.cmds, [{k:"questAccept",handle:300}], "QuestAccept command handle round trip");
if (version >= 14 && !fx.client.some(v => v.name === "input_quest_accept")) throw new Error("missing Rust-generated input_quest_accept vector");
for (const name of ["quest_accept_zero", "quest_accept_truncated", "quest_accept_overlong"]) {
  if (!fx.malformedClient.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} control`);
}
let badQuestCommand;
try { input(31, [{k:"questAccept",handle:0}]); } catch (e) { badQuestCommand=e; }
eq(!!badQuestCommand, true, "QuestAccept refuses null capability");
const tradeCommand = decodeClient(input(32, [{k:"trade",kind:0,pick:2}]).buffer);
eqJson(tradeCommand.cmds, [{k:"trade",kind:0,pick:2}], "Input18 Trade command round trip");
eq(Buffer.from(input(tradeCommand.seq, tradeCommand.cmds)).toString("hex"), Buffer.from(input(32, [{k:"trade",kind:0,pick:2}])).toString("hex"), "Input18 Trade re-encoding");
for (let kind = 0; kind <= 1; kind++) for (let pick = 0; pick <= 2; pick++) {
  const decoded = decodeClient(input(32, [{k:"trade",kind,pick}]).buffer);
  eqJson(decoded.cmds, [{k:"trade",kind,pick}], `Input18 kind ${kind} pick ${pick}`);
}
if (!fx.client.some(v => v.name === "input_trade")) throw new Error("missing Rust-generated input_trade vector");
for (const name of ["input_trade_kind_unknown", "input_trade_pick_over_limit"]) {
  if (!fx.malformedClient.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} control`);
  const v = fx.malformedClient.find(v => v.name === name);
  let err = null; try { decodeClient(bytes(v.hex)); } catch (e) { err=e; }
  eq(/bad trade command/.test(String(err?.message)), true, `${name} exact refusal reason`);
}
let badTradeInputEncode, badTradeInputDecode;
try { input(32, [{k:"trade",kind:2,pick:0}]); } catch (e) { badTradeInputEncode=e; }
try { decodeClient(qcat(qByte(2),qU32(32),qU16(1),qByte(18),qByte(0),qByte(3)).buffer); } catch (e) { badTradeInputDecode=e; }
eq(!!badTradeInputEncode, true, "Trade encoder closes kind enum");
eq(!!badTradeInputDecode, true, "Trade decoder closes pick enum");
const questTracker = new Tracker();
const sameNumberNamespaces = questTracker.decode(stateFrameBytes(1, [[2, questPropBytes(1,1,1)], [10, questViewBytes()]]));
eq(sameNumberNamespaces.items[1].value.rows[0].handle, 1, "QuestItem and row share numeric quest handle");
eq(sameNumberNamespaces.items[1].value.rows[0].ownerCompleted, false, "doneBy does not imply owner completion");
eqJson([sameNumberNamespaces.items[1].value.rows[0].name, sameNumberNamespaces.items[1].value.rows[0].giverLabel,
  sameNumberNamespaces.items[1].value.rows[0].brief, sameNumberNamespaces.items[1].value.rows[0].objective,
  sameNumberNamespaces.items[1].value.rows[0].reward], ["A name","A giver","A brief","An objective","A reward"], "Quest metadata fields decode in appended order");
eq(sameNumberNamespaces.items[1].value.roster[0].label, sameNumberNamespaces.items[1].value.roster[1].label, "duplicate quest labels accepted");
eq(questTracker.collections.get(2).rows[0].handle, 1, "pickup handle remains its own namespace");
let sameFrameBadReference;
try { decode(stateFrameBytes(1, [[2, questPropBytes(1,9)], [10, questViewBytes(1)]])); } catch (e) { sameFrameBadReference=e; }
eq(!!sameFrameBadReference, true, "same-frame raw State decode validates QuestItem reference");
const oldQuestCollections = questTracker.collections;
let staleQuestView;
try { questTracker.decode(stateFrameBytes(2, [[10, questViewBytes(2)]])); } catch (e) { staleQuestView=e; }
eq(!!staleQuestView, true, "Quest replacement cannot orphan retained quest prop");
eq(questTracker.collections, oldQuestCollections, "bad retained/replacement Quest state is atomic");
let staleQuestProp;
try { questTracker.decode(stateFrameBytes(2, [[2, questPropBytes(1,2)]])); } catch (e) { staleQuestProp=e; }
eq(!!staleQuestProp, true, "prop replacement must resolve against retained Quest rows");
eq(questTracker.collections, oldQuestCollections, "bad prop replacement is atomic");
questTracker.decode(stateFrameBytes(2, [[2, questPropBytes(1,2)], [10, questViewBytes(2)]]));
eq(questTracker.collections.get(10).rows[0].handle, 2, "same-frame Quest and prop replacement validates candidate view");
let unavailableQuestWithProp;
try { questTracker.decode(stateFrameBytes(3, [[10, questUnavailableBytes()]])); } catch (e) { unavailableQuestWithProp=e; }
eq(!!unavailableQuestWithProp, true, "unavailable is distinct from empty while Quest props are retained");
eq(questTracker.collections.get(10).rows[0].handle, 2, "unavailable replacement refusal retains Quest view");
questTracker.decode(stateFrameBytes(3, [[2, qcat(qVarint(0), qVarint(0))], [10, questUnavailableBytes()]]));
eq(questTracker.collections.get(10), null, "explicit unavailable Quest view accepted after props clear");

const tradeTracker = new Tracker();
eq(tradeTracker.collections.has(11), false, "Trade key absent before first replacement");
tradeTracker.decode(stateFrameBytes(1, [[11, tradeEmptyBytes()]]));
eqJson(tradeTracker.collections.get(11), {tradeUsed:false,offers:[],stats:[],barterReadyAt:null,merchants:[],barterLabels:["","",""]}, "available empty Trade differs from unavailable");
tradeTracker.decode(stateFrameBytes(2, []));
eq(tradeTracker.collections.get(11).tradeUsed, false, "omitted Trade key retains the prior collection");
tradeTracker.decode(stateFrameBytes(3, [[11, qByte(0)]]));
eq(tradeTracker.collections.get(11), null, "explicit unavailable Trade clears the prior collection");
eq(tradeTracker.collections.has(11), true, "explicit unavailable Trade is represented by null, not omission");
const signedTrade = decode(stateFrameBytes(4, [[11, tradeSignedBytes()]]));
const signedStats = signedTrade.items[0].value.stats;
eq(Object.is(signedStats[0].value,-0), true, "Trade stat keeps negative zero");
eq(Object.is(signedStats[1].value,Number.MAX_VALUE), true, "Trade stat keeps huge finite f64");
eq(Object.is(signedTrade.items[0].value.barterReadyAt,-0), true, "Trade deadline keeps negative zero");
const maxLabelTrade = decode(stateFrameBytes(4, [[11, tradeMaxLabelBytes()]]));
eq(maxLabelTrade.items[0].value.barterLabels[0], tradeLabel255, "Trade accepts exact 255 UTF-8 byte label");
tradeTracker.decode(stateFrameBytes(5, [[11, tradeEmptyBytes()]]));
const tradeBaseline = tradeTracker.collections;
let malformedTradeFrame;
try { tradeTracker.decode(stateFrameBytes(6, [[11, tradeInvalidOfferBytes()]])); } catch (e) { malformedTradeFrame=e; }
eq(!!malformedTradeFrame, true, "malformed Trade replacement is rejected");
eq(tradeTracker.collections, tradeBaseline, "malformed Trade frame leaves retained collections untouched");
for (const [name, payload, expected] of [
  ["trade used flag", tradeBadUsedFlagBytes(), /bad trade flag/],
  ["Trade deadline option", tradeBadDeadlineOptionBytes(), /bad option/],
  ["Trade text UTF-8", tradeBadUtf8Bytes(), /bad utf-8/],
]) {
  let err = null; try { decode(stateFrameBytes(7, [[11, payload]])); } catch (e) { err=e; }
  eq(expected.test(String(err?.message)), true, `${name} strict malformed control`);
}
tradeTracker.decode(bytes(fx.server.find(v => v.name === "welcome").hex));
eq(tradeTracker.collections.has(11), false, "Welcome clears Trade state at the observer epoch boundary");

const directTradeTracker = new Tracker();
const directTradeValue = {
  tradeUsed: false, offers: [{cost:1,costValue:1,gain:2,gainValue:2,label:"offer"}],
  stats: [{stat:1,value:-0},{stat:1,value:2}], barterReadyAt:null,
  merchants: [{kind:0,x:1,y:2,name:"merchant"}], barterLabels:["one","two","three"],
};
directTradeTracker.apply({t:"state",items:[{key:11,value:directTradeValue}]});
const heldDirectTrade = directTradeTracker.collections.get(11), directTradeMap = directTradeTracker.collections;
directTradeValue.offers[0].label = "mutated"; directTradeValue.stats[0].value = 99;
directTradeValue.stats.push({stat:4,value:4}); directTradeValue.merchants[0].x = 99; directTradeValue.barterLabels[0] = "mutated";
eq(heldDirectTrade.offers[0].label, "offer", "direct Tracker.apply deep-copies Trade offers");
eq(Object.is(heldDirectTrade.stats[0].value,-0), true, "direct Tracker.apply keeps copied signed zero");
eq(heldDirectTrade.stats.length, 2, "direct Tracker.apply copies Trade delta array");
eq(heldDirectTrade.merchants[0].x, 1, "direct Tracker.apply deep-copies merchants");
eq(heldDirectTrade.barterLabels[0], "one", "direct Tracker.apply copies fixed Trade labels");
const invalidDirectTrade = { ...directTradeValue, offers:[{cost:1,costValue:1,gain:1,gainValue:2,label:"bad"}] };
let invalidDirectTradeError;
try { directTradeTracker.apply({t:"state",items:[{key:1,value:null},{key:11,value:invalidDirectTrade}]}); } catch (e) { invalidDirectTradeError=e; }
eq(invalidDirectTradeError?.message, "bad trade offer", "direct Tracker.apply validates the full Trade candidate");
eq(directTradeTracker.collections, directTradeMap, "invalid later direct Trade leaves exact held collections baseline");

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
const oversizedStateFrame = new Uint8Array(262145); oversizedStateFrame[0] = 0x88;
let oversizedStateError; try { decode(oversizedStateFrame.buffer); } catch (e) { oversizedStateError = e; }
eq(oversizedStateError?.message, "frame too large", "State decoder applies unchanged 262,144-byte server frame ceiling before parsing");
const wrongWelcome = Uint8Array.from(new Uint8Array(bytes(fx.server.find(v => v.name === "welcome").hex))); wrongWelcome[1] = 4;
const welcomeTracker = new Tracker(); welcomeTracker.base = { tick: 99 };
let wrongVersion; try { welcomeTracker.decode(wrongWelcome.buffer); } catch (e) { wrongVersion = e; }
eq(wrongVersion?.protocolMismatch, true, "wrong Welcome version"); eq(welcomeTracker.base.tick, 99, "wrong Welcome retains baseline");
const oldFx = JSON.parse(readFileSync(join(root, "protocol/fixtures/v13.json"), "utf8"));
const oldWelcome = bytes(oldFx.server.find(v => v.name === "welcome").hex);
let oldVersion; try { decode(oldWelcome); } catch (e) { oldVersion = e; }
eq(oldVersion?.protocolMismatch, true, "protocol 13 Welcome refused");
if (version >= 14) {
  const malformedMap = bytes(fx.malformedServer.find(v => v.name === "map_ext_semantic_hash").hex);
  const heldMapBase = { tick: 99, actors: [] }, mapTracker = new Tracker(); mapTracker.base = heldMapBase;
  let malformedWelcome; try { mapTracker.decode(malformedMap); } catch (e) { malformedWelcome = e; }
  eq(!!malformedWelcome, true, "malformed ground Welcome refused");
  eq(mapTracker.base, heldMapBase, "malformed ground Welcome retains baseline");
}

function checkSnapshot(m, d, n) {
    eq(m.tick, d.tick, `${n} tick`); eq(m.serverMs, d.serverMs, `${n} serverMs`); eq(m.phase, d.phase, `${n} phase`); eq(m.ack, d.ack, `${n} ack`); eq(m.training, d.training, `${n} training`);
    if (d.me === null) eq(m.me, null, `${n} me`);
    else {
      const e = d.me, s = m.me;
      for (const [k, jk] of [["id", "id"], ["faction", "faction"], ["status", "status"], ["weapon", "weapon"], ["readyIn", "readyInMs"], ["kills", "kills"], ["bounty", "bounty"], ["gv", "gv"], ["moveSeq", "moveSeq"], ["effects", "effects"], ["displaceSeq", "displaceSeq"], ["sig", "sig"], ["huntTarget", "huntTarget"], ["huntStacks", "huntStacks"]]) eq(s[k], e[jk], `${n} me.${k}`);
      for (const [k, jk] of [["x", "xBits"], ["y", "yBits"], ["facing", "facingBits"], ["hp", "hpBits"], ["maxHp", "maxHpBits"]]) eq(bits(s[k]), e[jk], `${n} me.${k}`);
      eqJson(s.wish, e.wish, `${n} me.wish`);
      eq(bits(s.barrierBits), e.barrierBits, `${n} me.barrierBits`);
      eq(s.barrierRingStep, e.barrierRingStep, `${n} me.barrierRingStep`);
      eq(s.archetype, e.archetype, `${n} me.archetype`);
      // Protocol 16 (ADR0026): the self's indicator facts.
      for (const k of ["flags", "buildMarks", "markTier", "brand", "markTax"]) eq(s[k], e[k], `${n} me.${k}`);
    }
    eqJson(m.ownerCombat ?? null, d.ownerCombat ?? null, `${n} ownerCombat`);
    eq(m.actors.length, d.actors.length, `${n} actors`);
    d.actors.forEach((e, i) => {
      const s = m.actors[i];
      for (const k of ["id", "faction", "hpPct", "status", "weapon", "bounty", "kind", "effects", "displaceSeq", "mobTypeCode", "sig"]) eq(s[k], e[k], `${n} actor ${i}.${k}`);
      for (const [k, jk] of [["x", "xBits"], ["y", "yBits"], ["facing", "facingBits"]]) eq(bits(s[k]), e[jk], `${n} actor ${i}.${k}`);
      eq(s.barrierPct, e.barrierPct, `${n} actor ${i}.barrierPct`);
      eq(s.barrierRingStep, e.barrierRingStep, `${n} actor ${i}.barrierRingStep`);
      eq(s.archetype, e.archetype, `${n} actor ${i}.archetype`);
      // Protocol 16 (ADR0026): the actor's indicator facts.
      for (const k of ["flags", "offhand", "buildMarks", "markTier", "brand", "markTax"]) eq(s[k], e[k], `${n} actor ${i}.${k}`);
    });
}

if (version >= 14) {
  // The public apply API is also used by in-page callers that already hold decoded objects.
  // Keep its validation transactional, independent of the raw-frame decoder's checks.
  const baselineVector = fx.server.find(v => v.decoded && Array.isArray(v.decoded.actors) && v.decoded.me != null);
  if (!baselineVector) throw new Error("missing owner-combat direct-apply baseline snapshot");
  const directTracker = new Tracker();
  const directBaseline = decode(bytes(baselineVector.hex));
  directTracker.apply(directBaseline);
  const heldBase = directTracker.base;
  const invalidDirectFull = { ...directBaseline, tick: directBaseline.tick + 1,
    ownerCombat: { lock: { held: true, target: null }, drawStartedAt: 0, readyAt: 0,
      asMilli: 49, windupMilli: 100, speedMilli: 100 } };
  let directError = null;
  try { directTracker.apply(invalidDirectFull); } catch (error) { directError = error; }
  eq(directError?.code, "owner_combat", "direct apply rejects invalid Full owner combat");
  eq(directTracker.base, heldBase, "direct apply invalid Full preserves exact baseline");
  const callerGroup = { lock: { clear: true }, drawStartedAt: 1, readyAt: 2,
    asMilli: 50, windupMilli: 50, speedMilli: 50 };
  directTracker.apply({ ...directBaseline, tick: directBaseline.tick + 1, ownerCombat: callerGroup });
  eq(directTracker.base.ownerCombat === callerGroup, false, "direct apply copies owner-combat group");
  eq(directTracker.base.ownerCombat.lock === callerGroup.lock, false, "direct apply copies nested owner lock");
  callerGroup.readyAt = 999;
  eq(directTracker.base.ownerCombat.readyAt, 2, "caller mutation cannot change held owner-combat group");
  const ownerBaseline = directTracker.base;
  let directDeltaError = null;
  try {
    directTracker.apply({ t: "delta", tick: ownerBaseline.tick + 1, baseTick: ownerBaseline.tick,
      serverMs: (ownerBaseline.tick + 1) * 50, phase: null, ack: 0, training: false,
      me: { mask: 0 }, changed: [], departed: [],
      ownerCombat: { lock: { unknown: true }, drawStartedAt: 1, readyAt: 2, asMilli: 50, windupMilli: 50, speedMilli: 50 } });
  } catch (error) { directDeltaError = error; }
  eq(directDeltaError?.code, "owner_combat", "direct apply rejects malformed Delta group");
  eq(directTracker.base, ownerBaseline, "direct apply invalid Delta preserves exact baseline");
  directTracker.apply({ t: "delta", tick: ownerBaseline.tick + 1, baseTick: ownerBaseline.tick,
    serverMs: (ownerBaseline.tick + 1) * 50, phase: null, ack: 0, training: false,
    me: null, changed: [], departed: [], ownerCombat: null });
  eq(directTracker.base.ownerCombat, null, "explicit unavailable Delta is accepted with owner loss");
  directTracker.apply({ ...directBaseline, tick: ownerBaseline.tick + 2, ownerCombat: callerGroup });
  directTracker.apply({ t: "welcome" });
  eq(directTracker.base, null, "Welcome reset clears owner-combat group baseline");
}

const wishFxCoverage = new Set();
const fxIndicatorCoverage = new Set();
const groundMapCoverage = { modes: new Set(), presence: new Set(), names: new Set(), presentZero: false };
const wishBarrierCoverage = {
  fullDefault: false, fullReset: false, deltaWishClear: false, deltaSelfBarrierClear: false,
  deltaActorBarrierClear: false, newActorBarrierDefault: false, sourceOverride: false, sourceDefaultAfterOverride: false,
};
const ownerCombatCoverage = {
  clear: false, heldNone: false, heldActor: false, mirrorMin: false, mirrorMaxFinite: false,
  retainedOmitted: false, explicitUnavailable: false, ownerLossClears: false,
  redundantUnavailableWithoutSelf: false, danglingDeltaRefused: false,
};

for (const v of fx.server) {
  const m = decode(bytes(v.hex));
  if (v.name === "reject_code_unknown") { eq(m.code, 12, `${v.name} code`); eq(m.reason, "", `${v.name} reason`); }
  if (v.decoded === undefined) continue;
  const d = v.decoded, n = v.name;
  if (m.t === "snapshot") {
    checkSnapshot(m, d, n);
    if (n === "owner_combat_clear") ownerCombatCoverage.clear = m.ownerCombat?.lock?.clear === true;
    if (n === "owner_combat_held_none") ownerCombatCoverage.heldNone = m.ownerCombat?.lock?.held === true && m.ownerCombat.lock.target === null;
    if (n === "owner_combat_held_player") ownerCombatCoverage.heldActor = m.ownerCombat?.lock?.held === true && Number.isInteger(m.ownerCombat.lock.target);
    if (n === "owner_combat_mirror_min") ownerCombatCoverage.mirrorMin = [m.ownerCombat?.asMilli, m.ownerCombat?.windupMilli, m.ownerCombat?.speedMilli].every(v => v === 50);
    if (n === "owner_combat_mirror_max_finite") ownerCombatCoverage.mirrorMaxFinite = [m.ownerCombat?.asMilli, m.ownerCombat?.windupMilli, m.ownerCombat?.speedMilli].some(v => v === Number.MAX_VALUE);
  } else if (m.t === "fx") {
    eq(m.tick, d.tick, `${n} tick`); eq(m.fx.length, d.fx.length, `${n} fx`);
    d.fx.forEach((e, i) => {
      const s = m.fx[i];
      if (e.k === "castStarted" || e.k === "castLanded" || e.k === "castEnded") wishFxCoverage.add(e.k);
      eq(s.k, e.k, `${n} fx ${i}.k`);
      if (e.k === "swing") { eq(s.by, e.by, `${n} by`); eq(s.weapon, e.weapon, `${n} weapon`); eq(bits(s.x), e.xBits, `${n} x`); eq(bits(s.y), e.yBits, `${n} y`); eq(bits(s.a), e.aBits, `${n} a`); }
      else if (e.k === "block") { eq(s.id, e.id, `${n} id`); eq(s.by, e.by, `${n} by`); eq(s.weapon, e.weapon, `${n} weapon`); }
      else if (e.k === "stagger") eq(s.id, e.id, `${n} id`);
      else if (e.k === "teleport") { /* no fields */ }
      else if (e.k === "castStarted") {
        for (const k of ["eventTime", "caster", "ability", "duration", "target"]) eq(s[k], e[k], `${n} fx ${i}.${k}`);
        for (const k of ["anchor"]) {
          if (e[k] === null) eq(s[k], null, `${n} fx ${i}.${k}`);
          else { eq(bits(s[k].x), e[k].xBits, `${n} fx ${i}.${k}.x`); eq(bits(s[k].y), e[k].yBits, `${n} fx ${i}.${k}.y`); }
        }
      }
      else if (e.k === "castLanded") {
        for (const k of ["eventTime", "ability", "caster", "target"]) eq(s[k], e[k], `${n} fx ${i}.${k}`);
        for (const k of ["anchor", "destination"]) {
          if (e[k] === null) eq(s[k], null, `${n} fx ${i}.${k}`);
          else { eq(bits(s[k].x), e[k].xBits, `${n} fx ${i}.${k}.x`); eq(bits(s[k].y), e[k].yBits, `${n} fx ${i}.${k}.y`); }
        }
      }
      else if (e.k === "castEnded") for (const k of ["eventTime", "caster", "ability", "reason"]) eq(s[k], e[k], `${n} fx ${i}.${k}`);
      // Protocol 16 (ADR0026): windup, cancel, signature/ability hit and heal.
      else if (e.k === "windup") { eq(s.by, e.by, `${n} fx ${i}.by`); eq(s.weapon, e.weapon, `${n} fx ${i}.weapon`); eq(bits(s.a), e.aBits, `${n} fx ${i}.a`); eq(s.ms, e.ms, `${n} fx ${i}.ms`); }
      else if (e.k === "cancel") eq(s.id, e.id, `${n} fx ${i}.id`);
      else if (e.k === "sigHit") { for (const k of ["victim", "by", "kind"]) eq(s[k], e[k], `${n} fx ${i}.${k}`); eq(bits(s.amount), e.amountBits, `${n} fx ${i}.amount`); }
      else if (e.k === "heal") { eq(s.id, e.id, `${n} fx ${i}.id`); eq(bits(s.amount), e.amountBits, `${n} fx ${i}.amount`); }
      else if (e.k === "hit") { eq(s.passive, e.passive, `${n} passive`); eq(s.critical, e.critical, `${n} critical`); eq(s.victim, e.victim, `${n} victim`); eq(s.by, e.by, `${n} by`); eq(bits(s.amount), e.amountBits, `${n} amount`); }
      else throw new Error(`${n} fx ${i}: no JS check for Rust fx kind ${e.k}`);
      fxIndicatorCoverage.add(e.k);
    });
  } else if (m.t === "welcome") {
    if (!d.map) throw new Error(`${n} missing Rust-decoded map`);
    // Protocol 16: the hitbox archetype table decodes to exactly the Rust rows.
    eqJson(m.archetypes, d.archetypes, `${n} archetype table`);
    // Protocol 16: the vision block decodes to exactly the Rust values.
    eqJson(m.vision, d.vision, `${n} vision block`);
    if (m.vision.coliseum) groundMapCoverage.visionColiseum = true;
    // Protocol 16: the weapon table decodes to exactly the Rust rows (doubles compared exactly).
    exactJson(m.weapons, d.weapons, `${n} weapon table`);
    for (const w of m.weapons) groundMapCoverage.weaponKinds = (groundMapCoverage.weaponKinds ?? new Set()).add(w.kind);
    if (m.archetypes.length) groundMapCoverage.archetypeTables = (groundMapCoverage.archetypeTables ?? 0) + 1;
    const e = d.map, s = m.map;
    eq(s.w, e.w, `${n} map.w`); eq(s.h, e.h, `${n} map.h`);
    eq(s.hash, e.layerHash, `${n} collision layer hash`);
    eqJson(Array.from(s.tiles), e.tiles, `${n} collision cells`);
    eqJson(s.terrain === null ? null : Array.from(s.terrain), e.terrain, `${n} terrain plane`);
    eqJson(s.regions === null ? null : Array.from(s.regions), e.regions, `${n} region plane`);
    eq(s.terrainMode, e.terrainMode, `${n} terrain mode`);
    eq(s.semanticHash, e.semanticHash, `${n} semantic hash`);
    eq(s.contextHash, e.contextHash, `${n} context hash`);
    groundMapCoverage.modes.add(s.terrainMode);
    groundMapCoverage.presence.add(`${s.terrain === null ? 0 : 1}${s.regions === null ? 0 : 1}`);
    groundMapCoverage.names.add(n);
    if (s.terrain !== null && s.terrain.every(x => x === 0)) groundMapCoverage.presentZero = true;
  } else if (m.t === "state") {
    const {t, ...fields} = m;
    const expectedItems = d.items.map(item => {
      const decodedItem = fields.items.find(candidate => candidate.key === item.key);
      if (!decodedItem) throw new Error(`${n} decoded State references absent key ${item.key}`);
      return decodedItem;
    });
    eqJson({...fields, items:expectedItems, kind:t}, d, `${n} exact decoded State items`);
    for (const item of d.items) if (item.key === 11 && item.value !== null) {
      const actual = fields.items.find(candidate => candidate.key === 11)?.value;
      exactJson(actual, item.value, `${n} exact Trade f64 values (including signed zero)`);
    }
  }
}

for (const name of ["state_quests_available", "state_quests_empty", "state_quests_unavailable", "state_quests_max_24576", "state_eleven_keys"]) {
  if (!fx.server.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} vector`);
}
const questEmptyVector = decode(bytes(fx.server.find(v => v.name === "state_quests_empty").hex));
eq(questEmptyVector.items[0].value.rows.length, 0, "available empty Quest view remains distinct from unavailable");
const maxQuestVector = fx.server.find(v => v.name === "state_quests_max_24576");
const maxQuestFrame = bytes(maxQuestVector.hex);
eq(maxQuestFrame.byteLength, 1 + qVarintLen(maxQuestVector.decoded.tick) + 1 + 1 + 24576,
  "maximum complete Quest replacement is exactly 24,576 bytes inside the State frame");
const maxQuestDecoded = decode(maxQuestFrame).items.find(item => item.key === 10)?.value;
for (const row of maxQuestDecoded.rows) for (const field of ["name","giverLabel","brief","objective","reward"]) {
  eq(new TextEncoder().encode(row[field]).length <= 255, true, `Quest ${field} remains within the u8 UTF-8 string bound`);
}
for (const name of ["state_trade_available", "state_trade_empty", "state_trade_unavailable", "state_trade_max_2213", "state_trade_duplicate_delta_stats", "state_eleven_keys"]) {
  if (!fx.server.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} vector`);
}
const elevenStateKeys = decode(bytes(fx.server.find(v => v.name === "state_eleven_keys").hex));
eqJson(elevenStateKeys.items.map(item => item.key), [1,2,3,4,5,6,7,8,9,10,11], "all eleven State keys accepted");
eq(elevenStateKeys.items[10].value, null, "State key11 explicit unavailable Trade is distinct");
const allMaxStateVector = fx.server.find(v => v.name === "state_all_max_budget");
if (!allMaxStateVector) throw new Error("missing all-key maximum State budget vector");
const allMaxStateFrame = bytes(allMaxStateVector.hex);
eq(allMaxStateFrame.byteLength, 247696, "all eleven maximum collections remain within the exact aggregate byte bound");
eq(allMaxStateFrame.byteLength < 262144, true, "all-key maximum State remains below MAX_SERVER_FRAME");
eqJson(decode(allMaxStateFrame).items.map(item => item.key), [1,2,3,4,5,6,7,8,9,10,11], "max aggregate State decodes every replacement collection");
const emptyTradeVector = decode(bytes(fx.server.find(v => v.name === "state_trade_empty").hex));
eqJson(emptyTradeVector.items.find(item => item.key === 11)?.value?.offers, [], "available empty Trade preserves empty offers");
const unavailableTradeVector = decode(bytes(fx.server.find(v => v.name === "state_trade_unavailable").hex));
eq(unavailableTradeVector.items.find(item => item.key === 11)?.value, null, "explicit unavailable Trade remains null");
const duplicateDeltaTrade = decode(bytes(fx.server.find(v => v.name === "state_trade_duplicate_delta_stats").hex));
const duplicateStats = duplicateDeltaTrade.items.find(item => item.key === 11)?.value?.stats;
eq(duplicateStats?.length, 2, "duplicate applied Trade stat rows are accepted");
eq(duplicateStats?.[0].stat, duplicateStats?.[1].stat, "duplicate applied Trade stat rows retain their repeated code");
const maxTradeHex = fx.server.find(v => v.name === "state_trade_max_2213").hex;
const maxTradeFrame = bytes(maxTradeHex);
eq(maxTradeFrame.byteLength, 1 + qVarintLen(fx.server.find(v => v.name === "state_trade_max_2213").decoded.tick) + 1 + 1 + 2213,
  "maximum Trade replacement is exactly 2,213 bytes inside the server State frame");
const maxTrade = decode(maxTradeFrame);
eq(maxTrade.items[0].value.offers.length, 3, "max Trade preserves all three offers");
eq(maxTrade.items[0].value.stats.length, 7, "max Trade preserves all seven stat deltas");
eq(maxTrade.items[0].value.merchants.length, 2, "max Trade preserves both merchants");
for (const offer of maxTrade.items[0].value.offers) eq(new TextEncoder().encode(offer.label).length, 255, "max Trade offer label uses full u8 string bound");
for (const merchant of maxTrade.items[0].value.merchants) eq(new TextEncoder().encode(merchant.name).length, 255, "max Trade merchant name uses full u8 string bound");
for (const label of maxTrade.items[0].value.barterLabels) eq(new TextEncoder().encode(label).length, 255, "max Trade barter label uses full u8 string bound");
const availableTrade = decode(bytes(fx.server.find(v => v.name === "state_trade_available").hex)).items[0].value;
eq(Object.is(availableTrade.stats[0].value,-0), true, "Rust Trade vector preserves signed-zero stat despite JSON normalization");
eq(Object.is(availableTrade.barterReadyAt,-0), true, "Rust Trade vector preserves signed-zero barter deadline despite JSON normalization");
eq(Object.is(availableTrade.merchants[1].x, 1.0000000000000002), true, "Trade merchant coordinate preserves neighboring f64 bit pattern");
eq(Object.is(maxTrade.items[0].value.stats[0].value,-0), true, "maximum Trade vector preserves signed-zero stat");
for (const name of ["state_trade_availability_flag", "state_trade_kind_unknown", "state_trade_stat_unknown",
  "state_trade_offer_same_stat", "state_trade_offer_nonpositive", "state_trade_offer_nonfinite", "state_trade_delta_nonfinite", "state_trade_deadline_negative",
  "state_trade_deadline_nonfinite", "state_trade_used_flag", "state_trade_deadline_option_unknown",
  "state_trade_merchant_nonfinite", "state_trade_merchant_out_of_range",
  "state_trade_offers_over_limit", "state_trade_stats_over_limit", "state_trade_merchants_over_limit"]) {
  if (!fx.malformedServer.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} control`);
}

for (const name of ["wish_fx_started", "wish_fx_landed", "wish_fx_ended"]) {
  if (!fx.server.some((v) => v.name === name)) throw new Error(`missing Rust-generated ${name} vector`);
}
for (const name of ["welcome_ground_both", "welcome_ground_terrain_only", "welcome_ground_regions_only", "welcome_ground_present_zero", "welcome_ground_mode_all"]) {
  if (!groundMapCoverage.names.has(name)) throw new Error(`missing Rust-generated ${name} vector`);
}
for (const mode of [0, 1, 2]) if (!groundMapCoverage.modes.has(mode)) throw new Error(`missing Rust Welcome terrain mode ${mode}`);
for (const presence of ["00", "10", "01", "11"]) if (!groundMapCoverage.presence.has(presence)) throw new Error(`missing Rust Welcome map plane presence ${presence}`);
if (!groundMapCoverage.presentZero) throw new Error("missing Rust Welcome present all-zero map plane");

// The JS decoder reports a reason as an Error message (RangeError for a read past the end).
const reason = {
  welcome_archetype_order:/archetype order/,welcome_archetype_hull:/archetype hull/,welcome_archetype_zero_box:/bad archetype/,
  welcome_archetype_count:/archetype count/,welcome_archetype_key_long:/bad archetype$/,welcome_archetype_key_ascii:/bad archetype$/,welcome_archetype_truncated:/./,
  delta_head_archetype_without_present_bit:/head/,
  welcome_vision_version_zero:/bad vision/,welcome_vision_tile_zero:/bad vision/,welcome_vision_radius_nan:/bad vision/,
  welcome_vision_radius_negative:/bad vision/,welcome_vision_trail_negative:/bad vision/,welcome_vision_update_infinite:/bad vision/,
  welcome_vision_mask_zero:/bad vision/,welcome_vision_coliseum_flag:/bad vision/,welcome_vision_coliseum_empty:/bad vision/,
  welcome_vision_coliseum_outside:/bad vision/,welcome_vision_truncated:/./,
  welcome_weapon_count:/bad weapon count/,welcome_weapon_truncated:/./,welcome_weapon_kind:/bad weapon kind/,
  welcome_weapon_order:/bad weapon order/,welcome_weapon_duplicate_id:/bad weapon order/,welcome_weapon_reach_nan:/bad weapon$/,
  welcome_weapon_speed_infinite:/bad weapon$/,welcome_weapon_radius_negative:/bad weapon$/,welcome_weapon_reach_over_max:/bad weapon$/,
  welcome_weapon_arc_half_arc_over_pi:/bad weapon$/,welcome_weapon_arc_half_arc_zero:/bad weapon$/,welcome_weapon_arc_reach_zero:/bad weapon$/,
  welcome_weapon_arc_speed:/bad weapon$/,welcome_weapon_projectile_speed_zero:/bad weapon$/,welcome_weapon_projectile_half_arc:/bad weapon$/,
  welcome_weapon_none_values:/bad weapon$/,
  state_too_many_projectiles:/too many/,projectile_kind:/projectile/,projectile_owner_zero:/handle/,projectile_owner_flag:/option/,projectile_owner_overlong:/varint/,
  potion_notice_zero:/potion notice/,potion_notice_unknown:/potion notice/,state_too_many_camps:/too many/,
  cannon_notice_zero:/cannon notice/,cannon_notice_unknown:/cannon notice/,cannon_notice_bad_seconds:/cannon notice/,cannon_notice_seconds_over:/cannon notice/,cannon_notice_missing_seconds:/./,
  camp_mob_type:/camp/,camp_elite:/camp/,camp_alive:/camp/,camp_state:/camp/,camp_negative_time:/camp/,camp_nonfinite_time:/field/,camp_time_order:/camp/,
  actor_mob_type_over_30:/mob type/,delta_actor_mob_type_over_30:/mob type/,
  chest_bad_reason_zero: /chest reason/, chest_bad_reason_unknown: /chest reason/,
  hit_flags_unknown_bit: /hit flags/, pickup_bad_reason_zero: /bad field/, pickup_bad_reason_unknown: /bad field/,
  empty: /./, truncated_snapshot: /./, self_truncated: /./, actor_count_without_actors: /./,
  unknown_tag: /unknown tag/, client_tag_from_server: /unknown tag/, trailing_byte: /trailing/,
  overlong_varint: /varint/, varint_past_u32: /varint/, varint_too_long: /varint/,
  head_self_bit_without_present_bit: /head/, head_unknown_bit: /head/, head_overlong_varint: /varint/, self_status_over_3: /status/, phase_over_3: /phase/,
  self_max_hp_over_u16: /max_hp/, actor_status_over_3: /status/, actor_mask_overlong_varint: /varint/, actor_unknown_mask_bit_after_kind: /actor mask/,
  state_duplicate_key: /state key/, state_key_order: /state key/, state_too_many_keys: /too many/, state_too_many_props: /too many/, state_too_many_fields: /too many/, state_too_many_rewards: /too many/, state_bad_potion_count: /potion count/, state_zero_prop_handle: /handle/, state_missing_focus: /prop focus/,
  state_reward_card_id_80: /reward id/, state_reward_kill_key_unknown: /Trophy key/,
  state_reward_kind_unknown: /bad reward kind/,
  state_reward_kill_gain_zero: /Trophy gain/, state_reward_kill_gain_negative: /Trophy gain/,
  state_reward_kill_gain_nan: /Trophy gain/, state_reward_kill_gain_infinity: /Trophy gain/,
  state_reward_kill_truncated_key: /./, state_reward_kill_truncated_gain: /./,
  state_reward_options_too_many: /reward options/,
  state_quest_status_unknown: /bad quest status/, state_quest_flags_unknown: /bad quest flags/,
  state_quest_visited_unknown: /bad quest visited mask/, state_quest_ref_missing: /unknown objective quest handle/,
  state_quest_prop_missing_view: /quest prop references unavailable quest/,
  state_quest_row_handle_zero: /bad handle/, state_quest_roster_id_zero: /bad handle/,
  state_quest_objective_handle_zero: /bad handle/, state_quest_prop_handle_zero: /bad handle/,
  state_quest_availability_flag: /bad quest availability/, state_quest_participant_accepted_flag: /bad quest accepted flag/,
  state_quest_done_by_flag: /bad quest done-by presence/, state_quest_prop_fetch_flag: /bad quest fetch flag/,
  state_quest_duplicate_row_handle: /duplicate quest handle/, state_quest_duplicate_roster_id: /duplicate quest roster id/,
  state_quest_duplicate_participant_id: /duplicate quest participant id/,
  state_quest_owner_roster_missing: /unknown owner quest roster id/, state_quest_carrier_missing: /unknown quest carrier roster id/,
  state_quest_participant_missing: /unknown quest participant roster id/,
  state_quest_unknown_count: /bad quest unknown counts/, state_quest_display_count_over_unknown: /bad quest unknown counts/,
  state_quest_def_empty: /bad quest definition/, state_quest_def_over_16: /bad quest definition/,
  state_quest_giver_nonfinite: /bad field/, state_quest_giver_out_of_range: /bad quest giver position/,
  state_quest_objective_nonfinite: /bad field/, state_quest_objective_out_of_range: /bad quest objective position/,
  state_quest_expiry_negative: /bad quest deadline/, state_quest_expiry_nonfinite: /bad field/,
  state_quest_owner_visited_unknown: /bad quest visited mask/,
  state_quest_roster_over_limit: /too many quest roster/, state_quest_rows_over_limit: /too many quest rows/,
  state_quest_participants_over_limit: /too many quest participants/,
  state_quest_objectives_over_limit: /too many quest objectives/,
  state_quest_objectives_per_row_over_limit: /too many objectives per quest/,
  state_trade_availability_flag: /bad trade flag/, state_trade_kind_unknown: /bad trade kind/,
  state_trade_used_flag: /bad trade flag/, state_trade_deadline_option_unknown: /bad option/,
  state_trade_stat_unknown: /bad trade stat/, state_trade_offer_same_stat: /bad trade offer/,
  state_trade_offer_nonpositive: /bad trade offer/, state_trade_offer_nonfinite: /bad trade offer/,
  state_trade_delta_nonfinite: /bad trade delta/, state_trade_deadline_negative: /bad trade deadline/,
  state_trade_deadline_nonfinite: /bad trade deadline/,
  state_trade_merchant_nonfinite: /bad trade merchant/, state_trade_merchant_out_of_range: /bad trade merchant/,
  state_trade_label_bad_utf8: /utf-8/,
  state_trade_offers_over_limit: /too many/, state_trade_stats_over_limit: /too many/, state_trade_merchants_over_limit: /too many/,
  state_quests_over_24576: /quest payload too large/,
  owner_combat_bad_lock: /owner combat/, owner_combat_zero_target: /owner combat/,
  owner_combat_missing_self: /owner combat/, owner_combat_dangling_target: /owner combat/,
  owner_combat_nonfinite_mirror: /owner combat/, owner_combat_fractional_mirror: /owner combat/,
  owner_combat_below_min_mirror: /owner combat/, delta_owner_combat_option_unknown: /owner combat/,
  delta_owner_combat_bad_lock: /owner combat/, delta_owner_combat_zero_target: /owner combat/,
  delta_owner_combat_nonfinite_mirror: /owner combat/, delta_owner_combat_available_without_self: /owner combat/,
  state_plan_negative_deadline: /plan/, state_unknown_key: /state key/, state_trailing_byte: /trailing/, state_truncated: /./,
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
  map_ext_short: /map extension/, map_ext_version: /ground version/, map_ext_presence: /presence/,
  map_ext_run_zero: /terrain|region|map.*run/, map_ext_terrain_value: /terrain/, map_ext_region_value: /region/,
  map_ext_plane_length: /terrain|region.*length/, map_ext_terrain_collision: /terrain collision/,
  map_ext_semantic_hash: /semantic hash/, map_ext_mode: /terrain mode/, map_ext_context_hash: /context hash/,
  map_ext_trailing: /extension|trailing/, welcome_trailing: /trailing/,
  snapshot_giver_kit_default: /giver actor/, snapshot_giver_kit_half: /giver actor/, snapshot_giver_kit_half_weapon: /giver actor/,
  snapshot_giver_mob_type: /giver actor/,
  quest_accept_zero: /bad quest handle/, quest_accept_truncated: /./, quest_accept_overlong: /varint/,
  wish_ability_over_4: /bad ability/, wish_charge_count_invalid: /bad Wish charges/, wish_time_nonfinite: /bad Wish clock/,
  wish_option_over_1: /bad option/, wish_cast_time_order: /bad Wish cast order/,
  wish_fx_caster_zero: /bad actor reference/, wish_fx_ability_over_4: /bad ability/, wish_fx_time_nonfinite: /bad Wish event time/,
  wish_fx_option_over_1: /bad option/, wish_fx_blaze_one_point: /bad Wish landing geometry/,
  wish_fx_nonblaze_destination: /bad Wish landing geometry/, wish_fx_anonymous_landed_target: /bad anonymous Wish landing/,
  wish_fx_anonymous_landed_no_target: /bad anonymous Wish landing/, wish_fx_end_reason_over_2: /bad Wish end reason/,
  // Protocol 16 (ADR0026) indicator facts.
  self_flags_unknown_bit: /bad flags/, self_build_marks_repeated: /bad build marks/, self_mark_tier_over_4: /bad mark$/,
  actor_flags_unknown_bit: /bad flags/, actor_offhand_over_16: /bad offhand/, actor_build_marks_key_over_9: /bad build marks/,
  actor_build_marks_second_without_first: /bad build marks/, actor_build_marks_repeated: /bad build marks/,
  actor_mark_tier_over_4: /bad mark$/, actor_mark_brand_over_100: /bad mark$/, actor_mark_tax_over_100: /bad mark$/, actor_mark_truncated: /./,
  delta_head_flags_without_present_bit: /head/, delta_self_flags_unknown_bit: /bad flags/, delta_self_build_marks_key_over_9: /bad build marks/,
  delta_self_mark_brand_over_100: /bad mark$/, delta_actor_flags_unknown_bit: /bad flags/, delta_actor_offhand_over_16: /bad offhand/,
  delta_actor_build_marks_repeated: /bad build marks/, delta_actor_mark_tier_over_4: /bad mark$/,
  fx_windup_weapon_over_15: /windup weapon/, fx_sig_hit_kind_zero: /hit kind/, fx_sig_hit_kind_6: /hit kind/, fx_sig_hit_kind_21: /hit kind/,
  fx_windup_truncated: /./, fx_heal_truncated: /./, camp_cleared_truncated: /./,
  state_roster_count_over_32: /roster count/, state_roster_id_zero: /roster id/, state_roster_order: /roster order/,
  state_roster_flags_unknown: /roster flags/, state_roster_name_empty: /roster name/, state_roster_name_long: /roster name/,
  state_roster_name_control: /roster name/, state_roster_name_utf8: /utf-8/, state_roster_truncated: /./,
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
for (const name of ["state_quest_status_unknown", "state_quest_flags_unknown", "state_quest_visited_unknown", "state_quest_ref_missing", "state_quest_prop_missing_view"]) {
  if (!fx.malformedServer.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} control`);
}
if (version >= 14) {
  for (const name of ["snapshot_quest_giver_actor", "snapshot_unknown_kind_max_kit", "snapshot_zero_hp"]) {
    if (!fx.server.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} control`);
  }
  for (const name of ["owner_combat_clear", "owner_combat_held_none", "owner_combat_held_player",
    "owner_combat_mirror_min", "owner_combat_mirror_max_finite"]) {
    if (!fx.server.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} control`);
  }
  if (!fx.server.some(v => v.name === "delta_owner_combat_redundant_clear_owner_loss")) {
    throw new Error("missing Rust-generated delta_owner_combat_redundant_clear_owner_loss control");
  }
  for (const name of ["owner_combat_bad_lock", "owner_combat_zero_target", "owner_combat_missing_self",
    "owner_combat_dangling_target", "owner_combat_nonfinite_mirror", "owner_combat_fractional_mirror",
    "owner_combat_below_min_mirror", "delta_owner_combat_option_unknown", "delta_owner_combat_bad_lock",
    "delta_owner_combat_zero_target", "delta_owner_combat_nonfinite_mirror", "delta_owner_combat_available_without_self"]) {
    if (!fx.malformedServer.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} control`);
  }
  const giver = decode(bytes(fx.server.find(v => v.name === "snapshot_quest_giver_actor").hex)).actors[0];
  eq(giver.kind, 4, "QuestGiver raw kind"); eq(giver.faction, 15, "QuestGiver raw faction sentinel");
  eq(giver.weapon, 15, "QuestGiver raw weapon sentinel"); eq(giver.mobTypeCode, 0, "QuestGiver raw mob type");
  eqJson(remoteActorPresentation(giver), { faction: null, weapon: null, neutral: true }, "QuestGiver presentation adapter");
  const future = decode(bytes(fx.server.find(v => v.name === "snapshot_unknown_kind_max_kit").hex)).actors[0];
  eq(future.kind, 255, "future actor kind remains open"); eq(future.faction, 15, "future actor raw faction remains open");
  eq(future.weapon, 15, "future actor raw weapon remains open"); eq(future.mobTypeCode, 15, "future actor raw mob type remains open");
  eqJson(remoteActorPresentation(future), { faction: 15, weapon: 15, neutral: false }, "future actor presentation remains raw");
  const extremeSelf = decode(bytes(fx.server.find(v => v.name === "snapshot_zero_hp").hex)).me;
  eq(extremeSelf.faction, 15, "Self raw faction 15 remains unchanged"); eq(extremeSelf.weapon, 15, "Self raw weapon 15 remains unchanged");
  const directTracker = new Tracker(), heldDirect = { tick: 17, actors: [{ id: 1 }] };
  directTracker.base = heldDirect;
  let directBadFull;
  try {
    directTracker.apply({ t: "snapshot", tick: 18, serverMs: 900, phase: 1, training: false, me: null,
      actors: [{ id: 2, kind: 4, faction: 15, weapon: 0, mobTypeCode: 0 }] });
  } catch (e) { directBadFull = e; }
  eq(directBadFull?.message, "bad giver actor", "direct Tracker.apply validates a Full candidate");
  eq(directTracker.base, heldDirect, "invalid direct Full retains exact baseline");
  for (const name of ["snapshot_giver_kit_default", "snapshot_giver_kit_half", "snapshot_giver_kit_half_weapon", "snapshot_giver_mob_type"]) {
    if (!fx.malformedServer.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} control`);
  }
}
for (const name of [
  "state_quest_row_handle_zero", "state_quest_roster_id_zero", "state_quest_objective_handle_zero", "state_quest_prop_handle_zero",
  "state_quest_availability_flag", "state_quest_participant_accepted_flag", "state_quest_done_by_flag", "state_quest_prop_fetch_flag",
  "state_quest_duplicate_row_handle", "state_quest_duplicate_roster_id", "state_quest_duplicate_participant_id",
  "state_quest_owner_roster_missing", "state_quest_carrier_missing", "state_quest_participant_missing",
  "state_quest_unknown_count", "state_quest_display_count_over_unknown", "state_quest_def_empty", "state_quest_def_over_16",
  "state_quest_giver_nonfinite", "state_quest_giver_out_of_range", "state_quest_objective_nonfinite", "state_quest_objective_out_of_range",
  "state_quest_expiry_negative", "state_quest_expiry_nonfinite", "state_quest_owner_visited_unknown",
  "state_quest_roster_over_limit", "state_quest_rows_over_limit", "state_quest_participants_over_limit",
  "state_quest_objectives_over_limit", "state_quest_objectives_per_row_over_limit",
]) {
  if (!fx.malformedServer.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} control`);
}
if (!fx.malformedServer.some(v => v.name === "state_quests_over_24576")) {
  throw new Error("missing structurally valid Quest payload over the 24,576-byte bound");
}
for (const name of ["state_reward_kind_unknown", "state_reward_kill_key_unknown", "state_reward_kill_gain_zero",
  "state_reward_kill_gain_negative", "state_reward_kill_gain_nan", "state_reward_kill_gain_infinity",
  "state_reward_kill_truncated_key", "state_reward_kill_truncated_gain", "state_reward_options_too_many"]) {
  if (!fx.malformedServer.some((v) => v.name === name)) throw new Error(`missing Rust-generated ${name} control`);
}
for (const name of ["map_ext_short", "map_ext_version", "map_ext_presence", "map_ext_run_zero", "map_ext_terrain_value",
  "map_ext_region_value", "map_ext_plane_length", "map_ext_terrain_collision", "map_ext_semantic_hash", "map_ext_mode",
  "map_ext_context_hash", "map_ext_trailing", "welcome_trailing"]) {
  if (!fx.malformedServer.some((v) => v.name === name)) throw new Error(`missing Rust-generated ${name} map control`);
}

for (const v of fx.server) {
  const full = bytes(v.hex);
  // Every existing vector keeps exhaustive prefix coverage. The all-collections budget witness is intentionally large;
  // sample all first/last 512 cuts plus every 1 KiB boundary so this one does not make the suite quadratic in ~248 KiB.
  const cuts = v.name === "state_all_max_budget"
    ? [...new Set([
      ...Array.from({length: Math.min(512, full.byteLength)}, (_, i) => i),
      ...Array.from({length: Math.min(512, full.byteLength)}, (_, i) => Math.max(0, full.byteLength - 512 + i)),
      ...Array.from({length: Math.floor(full.byteLength / 1024) + 1}, (_, i) => Math.min(full.byteLength - 1, i * 1024)),
      full.byteLength - 1,
    ])].sort((a,b) => a-b)
    : Array.from({length: full.byteLength}, (_, i) => i);
  if (v.name === "state_all_max_budget") eq(cuts.length < 1800, true, "bounded prefix sample stays under 1,800 cuts");
  for (const cut of cuts) {
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
      const previousBase = t.base;
      const held = t.base && { tick: t.base.tick, n: t.base.actors.length };
      let err = null;
      try { t.decode(bytes(st.hex)); } catch (e) { err = e; }
      checks++;
      if (!err) throw new Error(`${at}: the delta was applied, want refused ${st.refused}`);
      eq(err.code, st.refused, `${at} reason`);
      eq(JSON.stringify(t.base && { tick: t.base.tick, n: t.base.actors.length }), JSON.stringify(held), `${at} state kept`);
      if (c.name.startsWith("quest_giver_") || c.name.startsWith("owner_combat_")) eq(t.base, previousBase, `${at} exact snapshot baseline kept`);
      if (c.name === "owner_combat_dangling_delta_refused" && st.refused === "owner_combat") ownerCombatCoverage.danglingDeltaRefused = true;
      return;
    }
    const frame = bytes(st.hex), tag = new Uint8Array(frame)[0], previous = t.base;
    const raw = decode(frame), m = t.apply(raw);
    if (st.reset) { eq(m.t, "welcome", `${at} welcome`); eq(t.base, null, `${at} reset`); }
    else if (st.held) { eq(t.base.tick, st.held.tick, `${at} held tick`); eq(t.base.actors.length, st.held.actors, `${at} held actors`); }
    else {
      checkSnapshot(m, st.decoded, at);
      if (c.name === "wish_barrier_lifecycle") {
        const zeroSelf = m.me === null || (m.me.wish === null && bits(m.me.barrierBits) === 0 && m.me.barrierRingStep === 0);
        const zeroActors = m.actors.every((a) => a.barrierPct === 0 && a.barrierRingStep === 0);
        if (tag === 0x83 && !previous && zeroSelf && zeroActors) wishBarrierCoverage.fullDefault = true;
        if (tag === 0x83 && previous) {
          const hadData = (previous.me?.wish != null) || (previous.me && (previous.me.barrierBits !== 0 || previous.me.barrierRingStep !== 0))
            || previous.actors.some((a) => a.barrierPct !== 0 || a.barrierRingStep !== 0);
          if (hadData && zeroSelf && zeroActors) wishBarrierCoverage.fullReset = true;
        }
        if (tag === 0x87 && previous?.me?.wish != null && m.me?.wish === null) wishBarrierCoverage.deltaWishClear = true;
        if (tag === 0x87 && previous?.me && (previous.me.barrierBits !== 0 || previous.me.barrierRingStep !== 0)
          && m.me && bits(m.me.barrierBits) === 0 && m.me.barrierRingStep === 0) wishBarrierCoverage.deltaSelfBarrierClear = true;
        if (tag === 0x87 && previous) {
          const oldActors = new Set(previous.actors.map((a) => a.id));
          if (m.actors.some((a) => !oldActors.has(a.id) && a.barrierPct === 0 && a.barrierRingStep === 0)) wishBarrierCoverage.newActorBarrierDefault = true;
          if (previous.actors.some((a) => {
            const now = m.actors.find((n) => n.id === a.id);
            return (a.barrierPct !== 0 || a.barrierRingStep !== 0) && now?.barrierPct === 0 && now?.barrierRingStep === 0;
          })) wishBarrierCoverage.deltaActorBarrierClear = true;
        }
      }
      if (c.name === "wish_source_time_per_frame" && tag === 0x87 && previous
        && previous.serverMs !== previous.tick * 50 && m.serverMs === m.tick * 50) wishBarrierCoverage.sourceDefaultAfterOverride = true;
      if (c.name === "owner_combat_retain_and_clear" && raw.t === "delta" && previous?.ownerCombat
        && !Object.prototype.hasOwnProperty.call(raw, "ownerCombat") && JSON.stringify(m.ownerCombat) === JSON.stringify(previous.ownerCombat)) {
        ownerCombatCoverage.retainedOmitted = true;
      }
      if (c.name === "owner_combat_retain_and_clear" && raw.t === "delta"
        && Object.prototype.hasOwnProperty.call(raw, "ownerCombat") && raw.ownerCombat === null && m.ownerCombat === null) {
        ownerCombatCoverage.explicitUnavailable = true;
      }
      if (c.name === "owner_combat_owner_loss_clears" && previous?.ownerCombat && m.me === null && m.ownerCombat === null) {
        ownerCombatCoverage.ownerLossClears = true;
      }
      if (c.name === "owner_combat_redundant_unavailable_without_self" && raw.t === "delta"
        && Object.prototype.hasOwnProperty.call(raw, "ownerCombat") && raw.ownerCombat === null && raw.me === null
        && m.me === null && m.ownerCombat === null) ownerCombatCoverage.redundantUnavailableWithoutSelf = true;
    }
    if (c.name === "wish_source_time_per_frame" && m.t === "snapshot" && m.serverMs !== m.tick * 50) wishBarrierCoverage.sourceOverride = true;
  });
}

if (version >= 14) {
  for (const name of ["quest_giver_retained_delta_reset", "quest_giver_identity_edges", "quest_giver_kind_transition_missing_kit",
    "quest_giver_kit_transition_missing_kind", "quest_giver_kind_transition_retained_mob_type", "quest_giver_non4_kit_sentinel"]) {
    if (!fx.chains.some(c => c.name === name)) throw new Error(`missing Rust-generated ${name} chain`);
  }
  for (const name of ["quest_giver_kind_transition_missing_kit", "quest_giver_kit_transition_missing_kind", "quest_giver_kind_transition_retained_mob_type"]) {
    if (!fx.chains.find(c => c.name === name).steps.some(s => s.refused === "giver_actor")) {
      throw new Error(`${name} lacks a Tracker refusal for the invalid reconstructed actor`);
    }
  }
}

for (const name of ["wish_barrier_lifecycle", "wish_source_time_per_frame"]) {
  if (!fx.chains.some((c) => c.name === name)) throw new Error(`missing Rust-generated ${name} chain`);
}
for (const [name, ok] of Object.entries(wishBarrierCoverage)) if (!ok) throw new Error(`missing protocol12 tracker coverage: ${name}`);
for (const kind of ["castStarted", "castLanded", "castEnded"]) if (!wishFxCoverage.has(kind)) throw new Error(`missing Rust-generated Wish Fx ${kind}`);
if (version >= 14) {
  for (const [name, ok] of Object.entries(ownerCombatCoverage)) if (!ok) throw new Error(`missing owner-combat Tracker coverage: ${name}`);
  for (const name of ["owner_combat_retain_and_clear", "owner_combat_owner_loss_clears",
    "owner_combat_redundant_unavailable_without_self", "owner_combat_dangling_delta_refused"]) {
    if (!fx.chains.some(c => c.name === name)) throw new Error(`missing Rust-generated ${name} chain`);
  }
}

if (version >= 16) {
  // ADR0024 review finding 6: a delta that sets the self archetype (head bit 25), and the Welcome table refusals.
  if (!fx.chains.some(c => c.name === "self_archetype_delta")) throw new Error("missing Rust-generated self_archetype_delta chain");
  if (!groundMapCoverage.visionColiseum) throw new Error("missing a Rust Welcome with a coliseum vision rectangle");
  for (const name of ["welcome_archetype_count", "welcome_archetype_key_long", "welcome_archetype_key_ascii",
    "welcome_archetype_truncated", "delta_head_archetype_without_present_bit", "welcome_vision_version_zero",
    "welcome_vision_coliseum_outside", "welcome_vision_truncated", "welcome_weapon_count", "welcome_weapon_truncated",
    "welcome_weapon_kind", "welcome_weapon_order", "welcome_weapon_reach_nan", "welcome_weapon_arc_half_arc_over_pi",
    "welcome_weapon_arc_reach_zero", "welcome_weapon_projectile_speed_zero"]) {
    if (!fx.malformedServer.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} control`);
  }
  // The Rust Welcomes put every weapon kind (none, arc, projectile) on the wire.
  for (const kind of [0, 1, 2]) if (!groundMapCoverage.weaponKinds?.has(kind)) throw new Error(`missing a Rust Welcome weapon row of kind ${kind}`);

  // ADR0026: the indicator facts. The Full snapshot, the delta chain and the fx vector were compared field by field above;
  // here they must exist and carry every new field nonzero somewhere.
  const factsChain = fx.chains.find(c => c.name === "indicator_facts_delta");
  if (!factsChain) throw new Error("missing Rust-generated indicator_facts_delta chain");
  // Review: actor 2 departs, then returns inside a delta as a new actor with every fact set (delta bits 14..=17).
  const factSteps = factsChain.steps.map(step => step.decoded?.actors ?? []);
  const gone = factSteps.findIndex(actors => !actors.some(a => a.id === 2));
  const back = factSteps.findIndex((actors, i) => i > gone && actors.some(a => a.id === 2 && a.flags === 15 && a.offhand === 16 && a.buildMarks === 0x98 && a.markTier === 4 && a.brand === 100 && a.markTax === 100));
  if (gone < 1 || back < 0) throw new Error("indicator_facts_delta lacks the departure and the all-facts return");
  for (const name of ["snapshot_indicator_facts", "fx_indicators", "events_camp_cleared", "state_roster"]) {
    if (!fx.server.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} vector`);
  }
  const facts = decode(bytes(fx.server.find(v => v.name === "snapshot_indicator_facts").hex));
  for (const k of ["flags", "buildMarks", "markTier", "brand", "markTax"]) if (!facts.me?.[k]) throw new Error(`snapshot_indicator_facts lacks a nonzero me.${k}`);
  for (const k of ["flags", "offhand", "buildMarks", "markTier", "brand", "markTax"]) {
    if (!facts.actors.some(a => a[k])) throw new Error(`snapshot_indicator_facts lacks a nonzero actor ${k}`);
  }
  for (const k of ["windup", "cancel", "hit", "sigHit", "heal"]) if (!fxIndicatorCoverage.has(k)) throw new Error(`missing Rust-generated ${k} fx`);
  const fxFacts = decode(bytes(fx.server.find(v => v.name === "fx_indicators").hex)).fx;
  if (!fxFacts.some(f => f.k === "hit" && f.critical)) throw new Error("fx_indicators lacks a critical hit");
  const campEvents = decode(bytes(fx.server.find(v => v.name === "events_camp_cleared").hex)).events;
  eqJson(campEvents, [{ k: "campCleared", camp: 0 }, { k: "campCleared", camp: 511 }], "events_camp_cleared camps");
  const roster = decode(bytes(fx.server.find(v => v.name === "state_roster").hex)).items.find(item => item.key === 12)?.value;
  eqJson(roster, [{ id: 1, bot: false, name: "Wren" }, { id: 2, bot: true, name: "bot-Ashen_7" },
    { id: 300, bot: false, name: "x".repeat(24) }, { id: 301, bot: true, name: "Søren" }], "state_roster rows");
  if (!fx.server.some(v => v.name === "state_roster_empty")) throw new Error("missing Rust-generated state_roster_empty vector");
  eqJson(decode(bytes(fx.server.find(v => v.name === "state_roster_empty").hex)).items.find(item => item.key === 12)?.value, [], "state_roster_empty rows");
  for (const name of Object.keys(reason).filter(k => /^(self|actor|delta_self|delta_actor)_(flags|offhand|build_marks|mark)|^delta_head_flags|^hit_flags|^fx_(windup|sig_hit|heal)|^camp_cleared|^state_roster/.test(k))) {
    if (!fx.malformedServer.some(v => v.name === name)) throw new Error(`missing Rust-generated ${name} control`);
  }
}

console.log(`JS decoder agrees with protocol/fixtures/v${version}.json: ${fx.server.length} server vectors, ${fx.malformedServer.length} malformed, ${fx.chains.length} chains, ${checks} checks`);
