'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { gateSnapshot, protocolCodec, sampleStats, uniqueRafIntervals, validateIdentities } = require('./profile-hub14.cjs');
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
