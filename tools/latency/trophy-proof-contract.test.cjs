'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EXPECTED, validateTrophyReport } = require('./trophy-proof-contract.cjs');

// Synthetic structural controls only. This fixture is not live gameplay evidence.
function syntheticReport() {
  const ownerId = 11, victimId = 12, thirdId = 13;
  const options = [
    { kind: 3, key: 0, gain: 0.125, taken: false, takenBy: null },
    { kind: 3, key: 2, gain: 0.25, taken: false, takenBy: null },
    { kind: 3, key: 8, gain: 0.5, taken: false, takenBy: null },
  ];
  const afterOptions = options.map(option => ({ ...option }));
  afterOptions[1] = { ...afterOptions[1], taken: true, takenBy: ownerId };
  return {
    fixtureKind: 'synthetic-contract-fixture-not-live-proof',
    status: 'PASS', protocol: 13, expectedContentHash: EXPECTED.contentHash,
    expectedServerSha256: EXPECTED.serverSha256, expectedSourceMapHash: EXPECTED.legacyMapHash.toString(16),
    expectedWireMapHash: EXPECTED.mapHash.toString(16), url: 'http://127.0.0.1:8097/',
    errors: [], prerequisites: [],
    identities: {
      serverBinary: { sha256: EXPECTED.serverSha256 },
      firstPlayableMap: { sourceSha256: EXPECTED.sourceMapHash, legacyMapHash: EXPECTED.legacyMapHash,
        wireLayerHash: EXPECTED.mapHash, width: 48, height: 40, tileCount: 48 * 40 },
      unity: { sourceRevision: EXPECTED.sourceRevision, protocol: 13, contentHash: EXPECTED.contentHash,
        serverBinarySha256: EXPECTED.serverSha256,
        assets: ['index.html', 'Build/Web.data', 'Build/Web.framework.js', 'Build/Web.loader.js', 'Build/Web.wasm']
          .map(path => ({ path, sha256: 'a'.repeat(64) })), assetCount: 5 },
    },
    allFiveWish: { status: 'PASS', summary: { status: 'PASS', cases: 5 },
      serverBinarySha256: EXPECTED.serverSha256, playerUrl: 'http://127.0.0.1:8097/' },
    gameplay: {
      server: { protocol: 13, contentHash: EXPECTED.contentHash, port: 7796,
        info: { protocol: 13, contentHash: EXPECTED.contentHash },
        ownership: { pid: 1001, endpoint: '127.0.0.1:7796', method: 'lsof direct child TCP LISTEN' } },
      ownerPlayerId: ownerId, victimPlayerId: victimId, thirdPlayerId: thirdId,
      seats: [
        { role: 'owner', playerId: ownerId, training: false, protocol: 13, contentHash: EXPECTED.contentHash,
          mapHash: EXPECTED.mapHash, mapWidth: 48, mapHeight: 40, welcome: true,
          welcomeFacts: { playerId: ownerId, protocol: 13, contentHash: EXPECTED.contentHash,
            mapHash: EXPECTED.mapHash, width: 48, height: 40 } },
        { role: 'victim', playerId: victimId, training: false, protocol: 13, contentHash: EXPECTED.contentHash,
          mapHash: EXPECTED.mapHash, mapWidth: 48, mapHeight: 40, welcome: true,
          welcomeFacts: { playerId: victimId, protocol: 13, contentHash: EXPECTED.contentHash,
            mapHash: EXPECTED.mapHash, width: 48, height: 40 } },
        { role: 'third', playerId: thirdId, training: false, protocol: 13, contentHash: EXPECTED.contentHash,
          mapHash: EXPECTED.mapHash, mapWidth: 48, mapHeight: 40, welcome: true,
          welcomeFacts: { playerId: thirdId, protocol: 13, contentHash: EXPECTED.contentHash,
            mapHash: EXPECTED.mapHash, width: 48, height: 40 } },
      ],
      welcome: { player: ownerId, map: { width: 48, height: 40, hash: EXPECTED.mapHash }, training: false },
      victimInvestment: { verified: true, propHandle: 21, birthRewardHandle: 31, readyRewardHandle: 32,
        optionIndex: 0, boostId: 4,
        option: { kind: 2, id: 4 }, beforeBoostCounts: [0, 0, 0, 0, 0, 0, 0, 0],
        afterBoostCounts: [0, 0, 0, 0, 1, 0, 0, 0], wireSequenceEvidence: { pickup: 5, choose: 6 } },
      ownerDeathEventObserved: true,
      deathEvent: { kind: 'death', victimId, byPlayerId: ownerId, receivedAt: 100 },
      ownerKillsBefore: 0, ownerKillsAfter: 1,
      attacks: [{ kind: 'trusted Unity left-button attack' }],
      final: { ownerStatus: 1, victimStatus: 2, thirdStatus: 1,
        driverErrors: [], victimPageErrors: [], thirdPageErrors: [], driverDecoderErrors: [], victimDecoderErrors: [], thirdDecoderErrors: [],
        victimRejects: [], thirdRejects: [], driverOverflow: false },
    },
    trophy: {
      handle: 41, owner: ownerId, killedPlayer: victimId,
      beforeRow: { handle: 41, x: 1250, y: 900, expiresAt: 30000, options, picked: false, canChoose: true },
      originalPickIndex: 1, afterHandle: 42, postChoiceHandle: 42,
      hudClick: { at: 200, pagePoint: { x: 500, y: 420 },
        pointerDown: { type: 'down', at: 190, x: 500, y: 420, button: 0, trusted: true },
        pointerUp: { type: 'up', at: 191, x: 500, y: 420, button: 0, trusted: true },
        choose: { k: 'choose', handle: 41, pick: 1 } },
      after: { handle: 42, x: 1250, y: 900, expiresAt: 30000, options: afterOptions, picked: true, canChoose: false },
      traceOverflow: false, pageErrors: [],
    },
  };
}

test('synthetic contract fixture validates but is explicitly not live proof', () => {
  const report = syntheticReport();
  assert.equal(report.fixtureKind, 'synthetic-contract-fixture-not-live-proof');
  assert.deepEqual(validateTrophyReport(report), { status: 'PASS', exitCode: 0, failures: [], complete: true });
});

test('dropped or incomplete run cannot pass', () => {
  const report = syntheticReport();
  report.status = 'INCOMPLETE';
  report.gameplay.deathEvent = null;
  assert.equal(validateTrophyReport(report).status, 'FAIL');
});

test('wrong owner on the authoritative death or Trophy grant is rejected', () => {
  for (const mutate of [
    report => { report.gameplay.deathEvent.byPlayerId = report.gameplay.thirdPlayerId; },
    report => { report.trophy.after.options[1].takenBy = report.gameplay.thirdPlayerId; },
  ]) {
    const report = syntheticReport();
    mutate(report);
    assert.equal(validateTrophyReport(report).status, 'FAIL');
  }
});

test('Choose must use the actual delivered pre-choice handle and original option index', () => {
  const wrongHandle = syntheticReport();
  wrongHandle.trophy.hudClick.choose.handle += 1;
  assert.ok(validateTrophyReport(wrongHandle).failures.includes('decoded_original_choose_handle_index_missing_or_mismatched'));
  const wrongIndex = syntheticReport();
  wrongIndex.trophy.hudClick.choose.pick = 0;
  assert.ok(validateTrophyReport(wrongIndex).failures.includes('decoded_original_choose_handle_index_missing_or_mismatched'));
});

test('hard-coded trusted flag cannot replace matching trusted pointer down and up evidence', () => {
  const report = syntheticReport();
  delete report.trophy.hudClick.pointerDown;
  report.trophy.hudClick.trustedPointerClick = true;
  assert.ok(validateTrophyReport(report).failures.includes('actual_trusted_hud_pointer_pair_missing_or_mismatched'));
});

test('missing injected-looking Boost facts or a delta on the wrong key cannot pass', () => {
  const injected = syntheticReport();
  injected.gameplay.victimInvestment = { verified: true, option: { kind: 2, id: 4 } };
  assert.ok(validateTrophyReport(injected).failures.includes('real_non_lifesteal_boost_delta_not_proven'));
  const wrongDelta = syntheticReport();
  wrongDelta.gameplay.victimInvestment.afterBoostCounts = [0, 0, 0, 1, 0, 0, 0, 0];
  assert.ok(validateTrophyReport(wrongDelta).failures.includes('real_non_lifesteal_boost_delta_not_proven'));
});

test('post-choice handle rotation is allowed only when source and ordered Trophy identities match', () => {
  const validRotation = syntheticReport();
  assert.equal(validateTrophyReport(validRotation).status, 'PASS');
  const wrongSource = syntheticReport();
  wrongSource.trophy.after.x += 8;
  assert.ok(validateTrophyReport(wrongSource).failures.includes('authoritative_post_choose_trophy_state_not_bound_to_source_row'));
  const reordered = syntheticReport();
  reordered.trophy.after.options.reverse();
  assert.ok(validateTrophyReport(reordered).failures.includes('authoritative_post_choose_trophy_state_not_bound_to_source_row'));
});

test('three distinct ordinary v13 first-playable seats are required', () => {
  const duplicate = syntheticReport();
  duplicate.gameplay.seats[2].playerId = duplicate.gameplay.seats[1].playerId;
  assert.ok(validateTrophyReport(duplicate).failures.includes('seat_player_ids_not_distinct'));
  const training = syntheticReport();
  training.gameplay.seats[1].training = true;
  assert.ok(validateTrophyReport(training).failures.includes('victim_seat_not_verified_normal_v13_first_playable'));
});

test('pinned identities, errors, and overflow fail closed', () => {
  const identity = syntheticReport();
  identity.identities.unity.sourceRevision = 'other';
  assert.ok(validateTrophyReport(identity).failures.includes('pinned_unity_build_identity_missing_or_mismatched'));
  const map = syntheticReport();
  map.identities.firstPlayableMap.wireLayerHash = EXPECTED.legacyMapHash;
  assert.ok(validateTrophyReport(map).failures.includes('first_playable_source_or_wire_map_identity_mismatch'));
  const errors = syntheticReport();
  errors.gameplay.final.thirdDecoderErrors = ['decode rejected'];
  assert.ok(validateTrophyReport(errors).failures.includes('run_errors_or_trace_overflow'));
  const overflow = syntheticReport();
  overflow.trophy.traceOverflow = true;
  assert.ok(validateTrophyReport(overflow).failures.includes('run_errors_or_trace_overflow'));
});
