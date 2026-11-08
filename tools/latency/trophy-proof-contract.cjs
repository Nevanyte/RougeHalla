'use strict';

// Independent fail-closed schema check for the live Trophy browser report.
// This module evaluates evidence records; it does not create gameplay evidence.
const EXPECTED = Object.freeze({
  protocol: 13,
  sourceRevision: '1310ae002870bf3fc674c7b65f38ff5ea55a7d75',
  serverSha256: '20d5b70e9ed79863f03350fbeb9478fd7f45e0a7a644ea2a802a13c14d75b4b0',
  contentHash: '67183626db240b6a',
  sourceMapHash: '90bc4c8e82b7d4ba4819843001ae59da35c20ee870b5591b20192082b5bd16aa',
  legacyMapHash: 0x0252d18b,
  // Protocol map hash is computed over the wire map; this differs from the
  // source file's legacyMapHashU32.
  mapHash: 0x1c772b5b,
  mapWidth: 48,
  mapHeight: 40,
});

const finite = Number.isFinite;
const integer = Number.isInteger;
const REQUIRED_UNITY_ASSETS = Object.freeze([
  'index.html', 'Build/Web.data', 'Build/Web.framework.js', 'Build/Web.loader.js', 'Build/Web.wasm',
]);

function sameHash(value, expected) {
  if (integer(value) && value >= 0) return value === expected;
  if (typeof value !== 'string') return false;
  const normalized = value.toLowerCase().replace(/^0x/, '').replace(/^0+/, '') || '0';
  return normalized === expected.toString(16);
}

function emptyArray(value) { return Array.isArray(value) && value.length === 0; }

function validateTrophyReport(report) {
  const failures = [];
  const fail = code => failures.push(code);
  const gameplay = report?.gameplay;
  const identity = report?.identities;
  const unity = identity?.unity;
  const server = gameplay?.server;
  const final = gameplay?.final;

  if (report?.status !== 'PASS') fail('run_not_pass');
  if (report?.protocol !== EXPECTED.protocol || report?.expectedContentHash?.toLowerCase() !== EXPECTED.contentHash)
    fail('report_protocol_or_content_mismatch');
  if (report?.expectedServerSha256?.toLowerCase() !== EXPECTED.serverSha256 ||
      identity?.serverBinary?.sha256?.toLowerCase() !== EXPECTED.serverSha256)
    fail('pinned_server_binary_mismatch');
  const sourceMap = identity?.firstPlayableMap;
  if (report?.expectedSourceMapHash?.toLowerCase() !== EXPECTED.legacyMapHash.toString(16) ||
      report?.expectedWireMapHash?.toLowerCase() !== EXPECTED.mapHash.toString(16) ||
      sourceMap?.sourceSha256?.toLowerCase() !== EXPECTED.sourceMapHash ||
      sourceMap?.legacyMapHash !== EXPECTED.legacyMapHash || sourceMap?.wireLayerHash !== EXPECTED.mapHash ||
      sourceMap?.width !== EXPECTED.mapWidth || sourceMap?.height !== EXPECTED.mapHeight ||
      sourceMap?.tileCount !== EXPECTED.mapWidth * EXPECTED.mapHeight)
    fail('first_playable_source_or_wire_map_identity_mismatch');
  if (!unity || unity.sourceRevision !== EXPECTED.sourceRevision || unity.protocol !== EXPECTED.protocol ||
      String(unity.contentHash).toLowerCase().replace(/^0x/, '') !== EXPECTED.contentHash ||
      String(unity.serverBinarySha256).toLowerCase() !== EXPECTED.serverSha256 ||
      !Array.isArray(unity.assets) || unity.assets.length < REQUIRED_UNITY_ASSETS.length ||
      unity.assetCount !== unity.assets.length ||
      unity.assets.some(asset => !asset || typeof asset.path !== 'string' || !/^[a-f0-9]{64}$/i.test(asset.sha256 || '')) ||
      REQUIRED_UNITY_ASSETS.some(required => !unity.assets.some(asset => asset.path === required)))
    fail('pinned_unity_build_identity_missing_or_mismatched');
  if (!server || server.protocol !== EXPECTED.protocol ||
      String(server.contentHash).toLowerCase().replace(/^0x/, '') !== EXPECTED.contentHash ||
      server.info?.protocol !== EXPECTED.protocol ||
      String(server.info?.contentHash).toLowerCase().replace(/^0x/, '') !== EXPECTED.contentHash ||
      !integer(server.port) || server.port < 1 || server.port > 65535 ||
      !integer(server.ownership?.pid) || server.ownership.pid < 1 ||
      server.ownership?.endpoint !== `127.0.0.1:${server.port}` ||
      !String(server.ownership?.method || '').includes('lsof'))
    fail('owned_loopback_server_identity_missing_or_mismatched');

  const allFive = report?.allFiveWish;
  if (!allFive || allFive.status !== 'PASS' || allFive.summary?.status !== 'PASS' || allFive.summary?.cases !== 5 ||
      String(allFive.serverBinarySha256).toLowerCase() !== EXPECTED.serverSha256 || allFive.playerUrl !== report?.url)
    fail('all_five_wish_prerequisite_missing_or_mismatched');

  const seats = gameplay?.seats;
  const roles = ['owner', 'victim', 'third'];
  const seatsByRole = new Map();
  if (!Array.isArray(seats) || seats.length !== roles.length) {
    fail('three_seat_evidence_missing');
  } else {
    for (const seat of seats) {
      if (seat && roles.includes(seat.role) && !seatsByRole.has(seat.role)) seatsByRole.set(seat.role, seat);
      else fail('duplicate_or_unknown_seat_role');
    }
    for (const role of roles) {
      const seat = seatsByRole.get(role);
      if (!seat || !integer(seat.playerId) || seat.playerId < 1 || seat.training !== false ||
          seat.protocol !== EXPECTED.protocol ||
          String(seat.contentHash).toLowerCase().replace(/^0x/, '') !== EXPECTED.contentHash ||
          !sameHash(seat.mapHash, EXPECTED.mapHash) || seat.mapWidth !== EXPECTED.mapWidth ||
          seat.mapHeight !== EXPECTED.mapHeight || seat.welcome !== true ||
          seat.welcomeFacts?.playerId !== seat.playerId || seat.welcomeFacts?.protocol !== EXPECTED.protocol ||
          String(seat.welcomeFacts?.contentHash).toLowerCase().replace(/^0x/, '') !== EXPECTED.contentHash ||
          !sameHash(seat.welcomeFacts?.mapHash, EXPECTED.mapHash) || seat.welcomeFacts?.width !== EXPECTED.mapWidth ||
          seat.welcomeFacts?.height !== EXPECTED.mapHeight)
        fail(`${role}_seat_not_verified_normal_v13_first_playable`);
    }
    const ids = roles.map(role => seatsByRole.get(role)?.playerId);
    if (ids.some(id => !integer(id) || id < 1) || new Set(ids).size !== roles.length)
      fail('seat_player_ids_not_distinct');
    if (gameplay?.ownerPlayerId !== seatsByRole.get('owner')?.playerId ||
        gameplay?.victimPlayerId !== seatsByRole.get('victim')?.playerId ||
        gameplay?.thirdPlayerId !== seatsByRole.get('third')?.playerId)
      fail('reported_seat_ids_do_not_match_roles');
    const ownerWelcome = gameplay?.welcome;
    if (!ownerWelcome || ownerWelcome.player !== seatsByRole.get('owner')?.playerId || ownerWelcome.training !== false ||
        ownerWelcome.map?.width !== EXPECTED.mapWidth || ownerWelcome.map?.height !== EXPECTED.mapHeight ||
        !sameHash(ownerWelcome.map?.hash, EXPECTED.mapHash))
      fail('unity_owner_welcome_not_bound_to_owner_seat');
  }

  const investment = gameplay?.victimInvestment;
  const boostId = investment?.option?.id;
  const beforeCounts = investment?.beforeBoostCounts;
  const afterCounts = investment?.afterBoostCounts;
  const validCounts = counts => Array.isArray(counts) && counts.length === 8 &&
    counts.every(value => integer(value) && value >= 0);
  if (!investment || investment.verified !== true || !integer(investment.propHandle) || investment.propHandle < 1 ||
      !integer(investment.birthRewardHandle) || investment.birthRewardHandle < 1 ||
      !integer(investment.readyRewardHandle) || investment.readyRewardHandle < 1 ||
      !integer(investment.optionIndex) || investment.optionIndex < 0 ||
      investment.option?.kind !== 2 || !integer(boostId) || boostId < 0 || boostId > 6 || investment.boostId !== boostId ||
      !validCounts(beforeCounts) || !validCounts(afterCounts) ||
      afterCounts[boostId] !== beforeCounts[boostId] + 1 ||
      afterCounts.some((value, index) => index !== boostId && value !== beforeCounts[index]) ||
      !integer(investment.wireSequenceEvidence?.pickup) || investment.wireSequenceEvidence.pickup < 1 ||
      !integer(investment.wireSequenceEvidence?.choose) || investment.wireSequenceEvidence.choose < 1)
    fail('real_non_lifesteal_boost_delta_not_proven');

  const death = gameplay?.deathEvent;
  const ownerId = seatsByRole.get('owner')?.playerId;
  const victimId = seatsByRole.get('victim')?.playerId;
  if (gameplay?.ownerDeathEventObserved !== true || !death || death.kind !== 'death' ||
      death.victimId !== victimId || death.byPlayerId !== ownerId || !finite(death.receivedAt) || death.receivedAt < 0 ||
      !integer(gameplay.ownerKillsBefore) || gameplay.ownerKillsBefore < 0 ||
      !integer(gameplay.ownerKillsAfter) || gameplay.ownerKillsAfter <= gameplay.ownerKillsBefore)
    fail('credited_owner_death_and_kill_increment_not_proven');

  if (!Array.isArray(gameplay?.attacks) || gameplay.attacks.length < 1 ||
      !gameplay.attacks.some(action => action?.kind === 'trusted Unity left-button attack'))
    fail('unity_attack_input_evidence_missing');

  const trophy = report?.trophy;
  const beforeRow = trophy?.beforeRow;
  const afterRow = trophy?.after;
  const pick = trophy?.originalPickIndex;
  const sameOptionIdentity = (a, b) => a?.kind === b?.kind && a?.key === b?.key && a?.gain === b?.gain;
  const preOptions = beforeRow?.options;
  const afterOptions = afterRow?.options;
  if (!beforeRow || !integer(beforeRow.handle) || beforeRow.handle < 1 || !integer(beforeRow.x) || !integer(beforeRow.y) ||
      beforeRow.canChoose !== true || beforeRow.picked !== false || !Array.isArray(preOptions) || preOptions.length < 1 ||
      preOptions.some(option => option?.kind !== 3 || !integer(option.key) || option.key < 0 || option.key > 8 ||
        !finite(option.gain) || option.gain <= 0) ||
      !integer(pick) || pick < 0 || pick >= preOptions.length || pick > 2 ||
      preOptions[pick]?.taken !== false || (preOptions[pick]?.takenBy !== null && preOptions[pick]?.takenBy !== 0))
    fail('ready_original_trophy_row_missing_or_invalid');
  if (trophy?.handle !== beforeRow?.handle || trophy?.owner !== ownerId || trophy?.killedPlayer !== victimId)
    fail('trophy_prechoice_identity_not_bound_to_seats');

  const click = trophy?.hudClick;
  const point = click?.pagePoint;
  const down = click?.pointerDown;
  const up = click?.pointerUp;
  const pointerMatches = event => !!event && event.trusted === true && event.button === 0 &&
    finite(event.x) && finite(event.y) && finite(point?.x) && finite(point?.y) &&
    Math.abs(event.x - point.x) <= 2 && Math.abs(event.y - point.y) <= 2;
  if (!pointerMatches(down) || down.type !== 'down' || !finite(down.at) || down.at < 0 ||
      !pointerMatches(up) || up.type !== 'up' || !finite(up.at) || up.at < down.at)
    fail('actual_trusted_hud_pointer_pair_missing_or_mismatched');
  const choose = click?.choose;
  if (!choose || choose.k !== 'choose' || choose.handle !== beforeRow?.handle || choose.pick !== pick ||
      !finite(click.at) || click.at < 0)
    fail('decoded_original_choose_handle_index_missing_or_mismatched');

  // A successful Trophy choice may rotate its public handle. Match the post-choice
  // row by source point and unchanged ordered Trophy identities, then check state.
  if (!afterRow || !integer(afterRow.handle) || afterRow.handle < 1 || !integer(afterRow.x) || !integer(afterRow.y) ||
      afterRow.x !== beforeRow?.x || afterRow.y !== beforeRow?.y || !Array.isArray(afterOptions) ||
      !Array.isArray(preOptions) || afterOptions.length !== preOptions.length ||
      afterOptions.some((option, index) => !sameOptionIdentity(option, preOptions[index])) ||
      afterRow.picked !== true || afterOptions[pick]?.taken !== true || afterOptions[pick]?.takenBy !== ownerId)
    fail('authoritative_post_choose_trophy_state_not_bound_to_source_row');
  if (trophy?.postChoiceHandle !== afterRow?.handle || trophy?.afterHandle !== afterRow?.handle)
    fail('post_choice_rotated_handle_not_preserved');

  if (!final || final.ownerStatus !== 1 || final.victimStatus !== 2 || final.thirdStatus !== 1)
    fail('final_seat_statuses_invalid');
  if (!emptyArray(report?.errors) || !emptyArray(report?.prerequisites) ||
      !emptyArray(final?.driverErrors) || !emptyArray(final?.victimPageErrors) || !emptyArray(final?.thirdPageErrors) ||
      !emptyArray(final?.driverDecoderErrors) || !emptyArray(final?.victimDecoderErrors) || !emptyArray(final?.thirdDecoderErrors) ||
      !emptyArray(final?.victimRejects) || !emptyArray(final?.thirdRejects) || final?.driverOverflow !== false ||
      trophy?.traceOverflow !== false || !emptyArray(trophy?.pageErrors))
    fail('run_errors_or_trace_overflow');

  const unique = [...new Set(failures)];
  return { status: unique.length ? 'FAIL' : 'PASS', exitCode: unique.length ? 1 : 0,
    failures: unique, complete: unique.length === 0 };
}

module.exports = { EXPECTED, validateTrophyReport };
