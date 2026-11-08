const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PublicContentCensus } = require('./public-content-census.cjs');

test('census records only finite delivered codes and keeps each socket/rejoin separate', () => {
  const census = new PublicContentCensus();
  const first = census.openConnection();
  census.hello(first, { protocol: 11, faction: 1, resume: "DO_NOT_RECORD_SECRET" });
  census.welcome(first, { player: 41 });
  census.snapshot(first, { phase: 1, me: { faction: 4, weapon: 2, status: 1, effects: 0, sig: 0, x: 100, y: 200 }, actors: [
    { faction: 0, weapon: 3, status: 1, effects: 4, sig: 7, kind: 1, mobTypeCode: 8, id: 999, x: 800, y: 900 },
  ] });
  census.state(first, { items: [
    { key: 1, value: { slots: [0, null] } },
    { key: 2, value: { rows: [{ kind: 1, weapon: 0, handle: 123, x: 400, y: 500 }] } },
    { key: 3, value: [{ ability: 0, kind: 2, x: 1, y: 2 }] },
    { key: 4, value: [{ options: [{ kind: 1, id: 78, takenBy: 22 }] }] },
    { key: 6, value: [{ mobType: 0 }, { mobType: 28 }] },
    { key: 7, value: [{ kind: 1, x: 1, y: 2 }] },
  ] });
  census.events(first, { events: [{ k: 'potionNotice', notice: 6, text: 'ignored' }] });
  census.fx(first, { fx: [{ k: 'swing', weapon: 3, x: 900, y: 901 }] });
  census.welcome(first, { player: 42 });
  census.snapshot(first, { phase: 2, me: { faction: 3 }, actors: [] });
  const rejoin = census.openConnection();
  census.welcome(rejoin, { player: 41 });
  census.snapshot(rejoin, { phase: 2, me: null, actors: [] });

  const report = census.toJSON(), [a, b] = report.connections;
  assert.equal(a.label, 'socket-1'); assert.equal(a.segments[0].welcomeOrdinal, 1);
  assert.equal(b.label, 'socket-2'); assert.equal(b.segments[0].welcomeOrdinal, 3);
  assert.equal(b.segments[0].welcomePlayerId, 41);
  assert.deepEqual(a.requestedHello, { protocol: 11, faction: 1, resumed: true });
  assert.deepEqual(a.segments[0].categories.meFactions.uniqueValues, [4]);
  assert.deepEqual(a.segments[1].categories.meFactions.uniqueValues, [3]);
  assert.equal(a.segments[1].categories.actorMobTypeCodesOneBased, undefined);
  assert.equal(a.segments[0].categories.actorMobTypeCodesOneBased.uniqueValues[0], 8);
  assert.match(report.actorMobTypeCodesOneBased, /one-based/);
  assert.deepEqual(a.segments[0].categories.campRosterMobTypesZeroBased.uniqueValues, [0, 28]);
  assert.deepEqual(a.segments[0].categories.inventorySlotWeaponsZeroBased.uniqueValues, [0]);
  assert.deepEqual(a.segments[0].categories.propWeaponCodesZeroBased.uniqueValues, [0]);
  assert.deepEqual(a.segments[0].categories.fieldAbilityIdsZeroBased.uniqueValues, [0]);
  assert.deepEqual(a.segments[0].categories.rewardOptionKindId.uniqueValues, ['1:78']);
  assert.deepEqual(a.segments[0].categories.potionNoticeCodes.uniqueValues, [6]);
  assert.deepEqual(a.segments[0].categories.fxWeaponCodes.uniqueValues, [3]);
  const serialized = JSON.stringify(report);
  for (const forbidden of ['999', '123', '900', 'DO_NOT_RECORD_SECRET', 'token', 'ignored']) assert.equal(serialized.includes(forbidden), false, forbidden);
});
