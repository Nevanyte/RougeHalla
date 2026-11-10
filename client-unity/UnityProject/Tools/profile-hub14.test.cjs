'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const { attachHubProfiler, gateSnapshot, projectGpuMetrics, projectPublicOwner, projectPublicPlan, protocolCodec, sampleStats, uniqueRafIntervals, validateIdentities } = require('./profile-hub14.cjs');
const repo = path.resolve(__dirname, '../../..');
const probe = fs.readFileSync(path.join(repo, 'crates/rh-server/web/probe.html'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(repo, 'protocol/fixtures/v14.json'), 'utf8'));

function frame(name) {
  const vector = fixture.server.find(item => item.name === name);
  assert.ok(vector, `fixture contains ${name}`);
  return Buffer.from(vector.hex, 'hex');
}
function arrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test('current P14 probe codec decodes the frozen Welcome and active owner snapshot fixture', () => {
  const codec = protocolCodec(probe);
  const welcome = codec.decode(arrayBuffer(frame('welcome')));
  const snapshot = codec.decode(arrayBuffer(frame('snapshot')));
  assert.equal(welcome.t, 'welcome');
  assert.equal(welcome.protocol, 14);
  assert.equal(snapshot.t, 'snapshot');
  assert.equal(snapshot.phase, 1);
  assert.equal(snapshot.training, false);
  assert.equal(snapshot.me.id, welcome.player);
  assert.equal(snapshot.me.status, 1);
});

test('public owner and Plan projections expose only detached requested fields from applied P14 frames', () => {
  const codec = protocolCodec(probe);
  const tracker = new codec.Tracker();
  const welcome = codec.decode(arrayBuffer(frame('welcome')));
  tracker.apply(welcome);
  const snapshot = tracker.apply(codec.decode(arrayBuffer(frame('snapshot'))));
  const owner = projectPublicOwner(snapshot);
  assert.deepEqual(Object.keys(owner).sort(), ['id', 'phase', 'serverMs', 'status', 'tick', 'training', 'x', 'y']);
  assert.equal(owner.id, welcome.player);
  assert.equal(owner.phase, snapshot.phase);
  assert.equal(owner.training, snapshot.training);
  assert.equal(owner.serverMs, snapshot.serverMs);

  tracker.apply(codec.decode(arrayBuffer(frame('state_planning'))));
  const plan = projectPublicPlan(tracker);
  assert.deepEqual(plan, { pick: 1, ready: true, taken: [true, false], spawns: [12, null], endsAt: 500.5 });
  plan.taken[0] = false; plan.spawns[0] = 99;
  assert.deepEqual(projectPublicPlan(tracker), { pick: 1, ready: true, taken: [true, false], spawns: [12, null], endsAt: 500.5 });

  tracker.reset();
  assert.equal(projectPublicPlan(tracker), null);
  assert.equal(projectPublicOwner(null), null);
});

test('attached observer applies actual P14 State frames and exposes the Plan collection', async () => {
  class FakePage extends EventEmitter {
    async addInitScript() {}
    async evaluate() { throw new Error('measurement is intentionally not started in this offline test'); }
  }
  const page = new FakePage();
  const sha = 'c'.repeat(64);
  const welcome = protocolCodec(probe).decode(arrayBuffer(frame('welcome')));
  const contentHash = welcome.content.toString(16).padStart(16, '0');
  const collector = await attachHubProfiler(page, { identities: {
    build: { protocol: 14, contentHash, archiveSha256: sha },
    server: { protocol: 14, contentHash, binarySha256: sha },
  } });
  const socket = new EventEmitter();
  page.emit('websocket', socket);
  for (const name of ['welcome', 'snapshot', 'state_planning']) {
    socket.emit('framereceived', { payload: frame(name) });
  }
  assert.deepEqual(collector.publicPlan, { pick: 1, ready: true, taken: [true, false], spawns: [12, null], endsAt: 500.5 });
  assert.equal(collector.publicOwner.id, welcome.player);
  assert.equal(collector.activeGate.playerId, welcome.player);
  assert.equal(Object.hasOwn(collector.publicWelcome, 'session'), false);
  collector.detach();
  assert.equal(collector.publicPlan, null);
  assert.equal(collector.publicOwner, null);
});

test('synthetic gate controls accept only matching active, alive, nontraining public owner state', () => {
  const welcome = { protocol: 14, contentHash: '0102030405060708', expectedContentHash: '0102030405060708', player: 7, matchId: '001122' };
  const snapshot = { phase: 1, training: false, tick: 20, me: { id: 7, status: 1 } };
  assert.deepEqual(gateSnapshot(welcome, snapshot), { phase: 1, training: false, tick: 20, playerId: 7, matchId: '001122' });
  for (const bad of [
    { ...snapshot, phase: 0 }, { ...snapshot, phase: 2 }, { ...snapshot, training: true },
    { ...snapshot, me: { id: 8, status: 1 } }, { ...snapshot, me: { id: 7, status: 2 } },
  ]) assert.equal(gateSnapshot(welcome, bad), null);
  assert.equal(gateSnapshot({ ...welcome, contentHash: 'ffff' }, snapshot), null);
});

test('synthetic identity controls require exact P14 artifact and native binary pins', () => {
  const sha = 'a'.repeat(64);
  assert.equal(validateIdentities({
    build: { protocol: 14, contentHash: '0x0102030405060708', archiveSha256: sha },
    server: { protocol: 14, contentHash: '0102030405060708', binarySha256: sha },
  }).build.contentHash, '0102030405060708');
  assert.throws(() => validateIdentities({
    build: { protocol: 14, contentHash: '0102030405060708', archiveSha256: sha },
    server: { protocol: 14, contentHash: '1111111111111111', binarySha256: sha },
  }), /content identities must match/);
  const manifestSha = 'b'.repeat(64);
  const manifestIdentity = validateIdentities({
    build: { protocol: 14, contentHash: '0102030405060708', manifestSha256: manifestSha },
    server: { protocol: 14, contentHash: '0102030405060708', binarySha256: sha },
  });
  assert.equal(manifestIdentity.build.manifestSha256, manifestSha);
  assert.equal(Object.hasOwn(manifestIdentity.build, 'archiveSha256'), false);
  assert.throws(() => validateIdentities({
    build: { protocol: 14, contentHash: '0102030405060708', archiveSha256: sha, manifestSha256: manifestSha },
    server: { protocol: 14, contentHash: '0102030405060708', binarySha256: sha },
  }), /artifact and native binary identities/);
});

test('metric summaries sort samples and retain empty data as unavailable', () => {
  assert.deepEqual(sampleStats([9, 1, 4, NaN]), { samples: 3, p50: 4, p95: 9, p99: 9, max: 9 });
  assert.deepEqual(sampleStats([]), { samples: 0, p50: null, p95: null, p99: null, max: null });
});

test('synthetic RAF timing ignores duplicate timestamps but retains source callbacks separately', () => {
  const callbacks = [{ time: 10 }, { time: 10 }, { time: 26 }, { time: 26 }, { time: 42 }, { time: 41 }, { time: 58 }];
  assert.equal(callbacks.length, 7);
  assert.deepEqual(uniqueRafIntervals(callbacks), [16, 16, 16]);
});

test('synthetic GPU metadata omits elapsed metric without supported valid samples', () => {
  assert.deepEqual(projectGpuMetrics([], []), {
    availability: { webglContext: false, timerQuery: null, validSampleCount: 0, unavailableReason: 'webgl2_context_unavailable' }, metric: null,
  });
  assert.equal(projectGpuMetrics([{ timerQuery: false }], [1]).metric, null);
  assert.equal(projectGpuMetrics([{ timerQuery: true }], [NaN, Infinity]).availability.unavailableReason,
    'no_valid_timer_query_samples');
  const measured = projectGpuMetrics([{ timerQuery: true }], [1.25, 2.5]);
  assert.deepEqual(measured.metric.rawSamples, [1.25, 2.5]);
  assert.match(measured.metric.alignment, /UNALIGNED/);
});
