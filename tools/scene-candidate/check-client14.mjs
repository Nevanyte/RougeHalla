// Focused source-backed check for the private caller-applied RHC14EXP client wrapper.
// It reuses the actual embedded v14 decoder and Tracker; it does not open a browser.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createSceneClient14} from './client14.mjs';

const root = new URL('../../', import.meta.url);
const html = readFileSync(new URL('crates/rh-server/web/probe.html', root), 'utf8');
const begin = html.search(/\/\/ ---- protocol v\d+/);
const end = html.indexOf('// ---- probe state');
assert(begin >= 0 && end > begin, 'actual embedded decoder/Tracker block exists');
const {decode, Tracker} = new Function(`"use strict";${html.slice(begin, end)};return {decode,Tracker};`)();
const legacy = JSON.parse(readFileSync(new URL('protocol/fixtures/scene-candidate/full14.json', root), 'utf8'));
const bytes = hex => Uint8Array.from(Buffer.from(hex, 'hex'));
const hex = data => Buffer.from(data).toString('hex');
const asBigintMeta = m => ({...m, epoch: BigInt(m.epoch), scene: BigInt(m.scene), cueFrom: BigInt(m.cueFrom), cueThrough: BigInt(m.cueThrough)});
const limits = legacy.limits;
let assertions = 0;
function check(condition, message) { assert(condition, message); assertions++; }
function throws(fn, pattern) { assert.throws(fn, pattern); assertions++; }

function decodeInner(frames) { return frames.map(frame => decode(bytes(frame).slice().buffer)); }
function freshClient(epoch, generation = 41n, l = limits) {
  return createSceneClient14({decode14: decode, Tracker14: Tracker, protocol: 14, generation, epoch, limits: l});
}
function feed(client, generation, recordHexes) {
  let candidate = null;
  for (let i = 0; i < recordHexes.length; i++) {
    const part = bytes(recordHexes[i]);
    const final = client.push(generation, part);
    part.fill(0); // The receiver must already own all accepted bytes.
    if (i + 1 === recordHexes.length) candidate = final;
    else check(final === null, 'candidate is emitted only after complete COMMIT');
  }
  return candidate;
}
function expectedAck(meta) {
  const out = new Uint8Array(34), view = new DataView(out.buffer);
  out.set(new TextEncoder().encode('RHC14EXP'));
  view.setUint8(8, 1); view.setUint8(9, 4);
  view.setBigUint64(10, BigInt(meta.epoch), true);
  view.setBigUint64(18, BigInt(meta.scene), true);
  view.setBigUint64(26, BigInt(meta.cueThrough), true);
  return out;
}
function applyExpected(frames) {
  const tracker = new Tracker();
  return frames.map(frame => tracker.decode(bytes(frame).slice().buffer));
}
function bitsF64(value) {
  const data = new DataView(new ArrayBuffer(8)); data.setFloat64(0, value, true);
  return data.getBigUint64(0, true).toString(16).padStart(16, '0');
}
function bitsF32(value) {
  const data = new DataView(new ArrayBuffer(4)); data.setFloat32(0, value, true);
  return data.getUint32(0, true).toString(16).padStart(8, '0');
}
function projectMessages(messages, inner14Hex) {
  let cueOccurrences = 0;
  const cueBatches = [];
  const frames = messages.map((message, index) => {
    if (message.t === 'snapshot') {
      const combat = message.ownerCombat;
      return {kind:'snapshot',tick:message.tick,serverTimeBits:bitsF64(message.serverMs),
        selfId:message.me === null ? null : String(message.me.id),
        selfHpBits:message.me === null ? null : bitsF32(message.me.hp),
        actorIds:message.actors.map(actor => String(actor.id)),training:message.training,
        ownerCombat:combat === null ? null : {
          lock:combat.lock.clear ? 'clear' : 'held',
          targetId:combat.lock.clear || combat.lock.target === null ? null : String(combat.lock.target),
          drawStartedAt:combat.drawStartedAt,readyAt:combat.readyAt,
          asMilliBits:bitsF64(combat.asMilli),windupMilliBits:bitsF64(combat.windupMilli),speedMilliBits:bitsF64(combat.speedMilli),
        }};
    }
    if (message.t === 'state') {
      const groups = message.items.map(item => {
        const value = item.value;
        const group = {1:'inventory',2:'props',3:'fields',4:'rewardChests',5:'build',6:'camps',7:'projectiles',8:'plan',9:'arena',10:'quests',11:'trade'}[item.key];
        const row = {key:item.key,group};
        if (item.key === 1 || item.key === 5 || item.key === 8 || item.key === 9) row.available = value !== null;
        else if (item.key === 2) { row.rows = value.rows.length; row.focus = value.focus !== null; }
        else if (item.key >= 3 && item.key <= 7) row.rows = value.length;
        else if (item.key === 10) { row.available=value !== null; row.rows=value?.rows.length ?? 0; row.roster=value?.roster.length ?? 0; row.objectives=value?.objectives.length ?? 0; }
        else if (item.key === 11) { row.available=value !== null; row.offers=value?.offers.length ?? 0; row.stats=value?.stats.length ?? 0; row.merchants=value?.merchants.length ?? 0; }
        return row;
      });
      return {kind:'state',tick:message.tick,groups};
    }
    if (message.t === 'events') {
      cueOccurrences += message.events.length;
      cueBatches.push({kind:'events',tick:message.tick,count:message.events.length,hex:inner14Hex[index]});
      return {kind:'events',tick:message.tick,count:message.events.length};
    }
    if (message.t === 'fx') {
      cueOccurrences += message.fx.length;
      cueBatches.push({kind:'fx',tick:message.tick,count:message.fx.length,hex:inner14Hex[index]});
      const names = {castStarted:'wishStarted',castLanded:'wishLanded',castEnded:'wishEnded'};
      return {kind:'fx',tick:message.tick,count:message.fx.length,kinds:message.fx.map(fx => names[fx.k] ?? fx.k)};
    }
    throw new Error(`unexpected full-scene message role ${message.t}`);
  });
  return {frames,cueOccurrences,cueBatches};
}
function testLegacyCase(c) {
  const meta = asBigintMeta(c.meta), client = freshClient(meta.epoch);
  const candidate = feed(client, 41n, c.recordsHex);
  check(candidate !== null, `${c.name}: accepted complete scene`);
  assert.deepStrictEqual(candidate.metadata, meta); assertions++;
  assert.deepStrictEqual(candidate.messagesCopy(), applyExpected(c.inner14Hex)); assertions++;
  assert.deepStrictEqual(candidate.messagesCopy(), decodeInner(c.inner14Hex)); assertions++;
  check(client.ownedBodyBytes === bytes(c.bodyHex).length, `${c.name}: encoded retained-body accounting`);
  const copy = candidate.bodyCopy(); check(hex(copy) === c.bodyHex, `${c.name}: body is exact`);
  copy.fill(0);
  check(hex(candidate.byteView) === c.bodyHex, `${c.name}: byteView is a fresh owned copy`);
  throws(() => { candidate.metadata.tick = -1; }, TypeError);
  const first = candidate.messagesCopy();
  if (first[0]?.me) first[0].me.hp = -987654;
  first[0].tick = -1;
  check(first[0].tick === -1, `${c.name}: returned message graph is caller-owned`);
  assert.deepStrictEqual(candidate.messagesCopy(), applyExpected(c.inner14Hex)); assertions++;
  throws(() => client.encodeAck(41n, {fake: true}), /receipt identity/);
  const receipt = client.commitApplied(41n, candidate);
  check(client.current === candidate, `${c.name}: only explicit caller commit updates current`);
  assert.deepStrictEqual(client.encodeAck(41n, receipt), expectedAck(c.meta)); assertions++;
  client.close();
  check(client.current === candidate, `${c.name}: close preserves applied candidate`);
  check(hex(candidate.bodyCopy()) === c.bodyHex, `${c.name}: candidate copies remain readable after close`);
  throws(() => client.encodeAck(41n, receipt), /closed/);
}

for (const sample of legacy.cases) testLegacyCase(sample);

// Ownership, application receipt and rejection controls use one original native-provided scene.
const base = legacy.cases[0], baseMeta = asBigintMeta(base.meta);
const generation = 77n;
const maxGeneration = freshClient(baseMeta.epoch, (1n << 64n) - 1n);
check(maxGeneration.generation === (1n << 64n) - 1n, 'local generation accepts inclusive u64 maximum');
throws(() => freshClient(baseMeta.epoch, 0n), /generation/);
throws(() => freshClient(baseMeta.epoch, (1n << 64n)), /generation/);
throws(() => freshClient(baseMeta.epoch, 1), /generation/);
maxGeneration.close();
const client = freshClient(baseMeta.epoch, generation);
const first = feed(client, generation, base.recordsHex);
check(first !== null && client.current === null, 'wire COMMIT creates a candidate but does not apply it');
throws(() => client.encodeAck(generation, {}), /receipt identity/);
throws(() => client.push(generation + 1n, bytes(base.recordsHex[0])), /generation mismatch/);
check(client.closed === false && client.current === null, 'wrong generation leaves context open and current unchanged');
throws(() => client.commitApplied(generation + 1n, first), /generation mismatch/);
check(client.closed === false && client.current === null, 'wrong-generation commit preserves pending candidate');
const receipt1 = client.commitApplied(generation, first);
const ack1 = client.encodeAck(generation, receipt1);
check(ack1.length === 34, 'explicit applied receipt encodes exact ACK size');
throws(() => client.encodeAck(generation + 1n, receipt1), /generation mismatch/);
throws(() => client.commitApplied(generation, first), /candidate identity/);
assert.deepStrictEqual(client.encodeAck(generation, receipt1), ack1); assertions++;

// Foreign, stale, refused and pending transitions never publish a candidate or ACK.
const other = freshClient(baseMeta.epoch, generation);
throws(() => other.commitApplied(generation, first), /candidate identity/);
throws(() => other.encodeAck(generation, receipt1), /receipt identity/);
const pendingClient = freshClient(baseMeta.epoch, generation);
const pending = feed(pendingClient, generation, base.recordsHex);
throws(() => pendingClient.push(generation, bytes(base.recordsHex[0])), /candidate pending/);
check(pendingClient.closed && pendingClient.current === null, 'wire push during unresolved candidate closes without applying');
check(hex(pending.bodyCopy()) === base.bodyHex, 'pending candidate remains copy-readable after context close');
throws(() => pendingClient.commitApplied(generation, pending), /closed/);
const refusedClient = freshClient(baseMeta.epoch, generation);
const refused = feed(refusedClient, generation, base.recordsHex);
refusedClient.refuse(generation, refused);
check(refusedClient.closed && refusedClient.current === null, 'explicit refusal closes and retains prior public state');

const candidateFixtureUrl = new URL('protocol/fixtures/scene-candidate/client14.json', root);
const fixture = JSON.parse(readFileSync(candidateFixtureUrl, 'utf8'));
if (typeof fixture.schema !== 'string' || fixture.protocol !== 14 || !Array.isArray(fixture.scenes) || !Array.isArray(fixture.negatives)) throw new Error('fixture contract mismatch');
const fixtureGeneration = BigInt(fixture.generation), fixtureEpoch = BigInt(fixture.epoch);
const chain = freshClient(fixtureEpoch, fixtureGeneration, fixture.limits);
let priorReceipt = null, priorCandidate = null, totalRetained = 0;
for (const scene of fixture.scenes) {
  const sceneCandidate = feed(chain, fixtureGeneration, scene.recordsHex);
  check(sceneCandidate !== null, `${scene.name}: Rust-recorded COMMIT emits candidate`);
  check(hex(sceneCandidate.bodyCopy()) === scene.bodyHex, `${scene.name}: body matches Rust fixture`);
  const tracked = sceneCandidate.messagesCopy();
  assert.deepStrictEqual(tracked, decodeInner(scene.inner14Hex)); assertions++;
  assert.deepStrictEqual(projectMessages(tracked, scene.inner14Hex), scene.publicData); assertions++;
  totalRetained += bytes(scene.bodyHex).length;
  check(chain.ownedBodyBytes === totalRetained, `${scene.name}: cumulative retained encoded-body budget`);
  throws(() => chain.encodeAck(fixtureGeneration, {}), /receipt identity/);
  if (priorReceipt) {
    const previousScene = fixture.scenes[fixture.scenes.indexOf(scene)-1];
    assert.deepStrictEqual(chain.encodeAck(fixtureGeneration, priorReceipt), bytes(previousScene.ackHex)); assertions++;
  }
  const receipt = chain.commitApplied(fixtureGeneration, sceneCandidate);
  assert.deepStrictEqual(chain.encodeAck(fixtureGeneration, receipt), bytes(scene.ackHex)); assertions++;
  if (priorCandidate) throws(() => chain.commitApplied(fixtureGeneration, priorCandidate), /candidate identity/);
  priorCandidate = sceneCandidate; priorReceipt = receipt;
}
check(fixture.scenes.length === 2, 'fixture contains the intended two-scene chain');
check(fixture.scenes[1].publicData.cueOccurrences === 4, 'second scene preserves all four ordered FX occurrences');

let rejected = 0;
for (const negative of fixture.negatives) {
  const isolated = freshClient(fixtureEpoch, fixtureGeneration, negative.limitsOverride ?? fixture.limits);
  const baseScene = fixture.scenes[0];
  const baseCandidate = feed(isolated, fixtureGeneration, baseScene.recordsHex);
  isolated.commitApplied(fixtureGeneration, baseCandidate);
  const oldBody = hex(isolated.current.bodyCopy());
  check(negative.previousViewPreserved === true, `${negative.name}: Rust receiver preserved baseline`);
  check(oldBody === negative.previousBodyHex, `${negative.name}: Rust previous body identity`);
  let actualRejectAt = -1, actualError = null;
  for (let index = 0; index < negative.recordsHex.length; index++) {
    try {
      const result = isolated.push(fixtureGeneration, bytes(negative.recordsHex[index]));
      check(result === null, `${negative.name}: malformed chain never publishes candidate`);
    } catch (error) { actualRejectAt = index; actualError = error; break; }
  }
  check(actualRejectAt === negative.rejectAt, `${negative.name}: JS and Rust reject at same record index`);
  check(actualError !== null && typeof negative.reason === 'string' && negative.reason.length > 0, `${negative.name}: preserves Rust refusal reason`);
  check(isolated.closed && isolated.current === baseCandidate, `${negative.name}: rejection closes only context and retains applied view`);
  check(hex(isolated.current.bodyCopy()) === oldBody, `${negative.name}: prior applied bytes remain unchanged`);
  rejected++;
}
const fixtureResult = {available:true,schema:fixture.schema,scenes:fixture.scenes.length,negatives:rejected,
  generation:fixture.generation,epoch:fixture.epoch};

console.log(JSON.stringify({result:'PASS',legacyCases:legacy.cases.length,assertions,
  fixture:fixtureResult,profile:legacy.profile,
  boundary:'actual embedded JS decoder/Tracker with isolated byte transport; no socket, scene policy or gameplay authority'}));
