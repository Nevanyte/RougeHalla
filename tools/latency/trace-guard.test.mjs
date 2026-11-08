// CPU submission milestones only. This tests the optional collector, not browser/display latency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(process.argv[2] || fileURLToPath(new URL('../../client-unity/UnityProject/Assets/Plugins/WebGL/RhLatency.jslib', import.meta.url)), 'utf8');
function plugin() {
  const library = {}, page = {};
  vm.runInNewContext(source, {
    LibraryManager: { library }, mergeInto: Object.assign, window: page,
    UTF8ToString: value => value, performance: { now: () => 123.5 }
  });
  return { library, page };
}

test('absent, false and malformed opt-ins neither enable nor throw', () => {
  const { library, page } = plugin();
  for (const value of [undefined, null, false, 0, '', true, {}, { events: null }, { events: {} }, { events: '' }]) {
    page.__rhLatency = value;
    assert.equal(library.RhLatency_Enabled(), 0);
    assert.equal(library.RhLatency_TakeTargetRequest(), 0);
    assert.doesNotThrow(() => library.RhLatency_Mark('frameStart', 1, 2, 3, 4, 5));
    assert.doesNotThrow(() => library.RhLatency_WishPresented('presentWishLanded', 1, 2, 3, 50));
    if (value && typeof value === 'object') assert.equal(Object.hasOwn(value, 'frame'), false);
  }
});

test('valid opt-in records exactly the public CPU milestone payload', () => {
  const { library, page } = plugin();
  const collector = page.__rhLatency = { events: [] };
  assert.equal(library.RhLatency_Enabled(), 1);
  library.RhLatency_Mark('sampleMove', 10, 11, 12, 13, 14);
  assert.deepEqual(JSON.parse(JSON.stringify(collector.events)), [
    { kind: 'sampleMove', frame: 10, player: 11, moveSeq: 12, x: 13, y: 14, at: 123.5 }
  ]);
  assert.equal(collector.frame, 10);
  assert.deepEqual(Object.keys(page), ['__rhLatency'], 'no export or additional browser globals');
  delete page.__rhLatency;
  assert.equal(library.RhLatency_Enabled(), 0);
  library.RhLatency_Mark('presentSelf', 11, 11, 12, 13, 14);
  assert.equal(collector.events.length, 1, 'turning off opt-in stops recording');
});

test('valid collector caps at 20000 while preserving frame correlation and overflow', () => {
  const { library, page } = plugin();
  const collector = page.__rhLatency = { events: [] };
  for (let frame = 1; frame <= 20001; frame++) library.RhLatency_Mark('frameStart', frame, 1, 0, 0, 0);
  assert.equal(collector.events.length, 20000);
  assert.equal(collector.events[19999].frame, 20000);
  assert.equal(collector.frame, 20001);
  assert.equal(collector.overflow, true);
});

test('broken collector access or writes cannot interrupt the game frame', () => {
  const { library, page } = plugin();
  page.__rhLatency = { get events() { throw new Error('collector access failed'); } };
  assert.equal(library.RhLatency_Enabled(), 0);
  assert.doesNotThrow(() => library.RhLatency_Mark('frameStart', 1, 1, 0, 0, 0));
  assert.doesNotThrow(() => library.RhLatency_WishPresented('presentWishLanded', 1, 0, 1, 123.25));
  assert.equal(library.RhLatency_TakeTargetRequest(), 0);
  page.__rhLatency = { events: Object.freeze([]) };
  assert.doesNotThrow(() => library.RhLatency_Mark('frameStart', 2, 1, 0, 0, 0));
  assert.doesNotThrow(() => library.RhLatency_WishPresented('presentWishLanded', 2, 0, 1, 123.25));
  assert.equal(page.__rhLatency.events.length, 0);
});

test('target observations require an explicit one-shot request under a valid opt-in', () => {
  const { library, page } = plugin();
  const collector = page.__rhLatency = { events: [], targetsRequested: 'true' };
  assert.equal(library.RhLatency_TakeTargetRequest(), 0);
  collector.targetsRequested = true;
  assert.equal(library.RhLatency_TakeTargetRequest(), 1);
  assert.equal(collector.targetsRequested, false);
  assert.equal(library.RhLatency_TakeTargetRequest(), 0);
  assert.equal(collector.events.length, 0, 'request alone does not manufacture a target observation');
});

test('Wish application records retain every occurrence and original fractional source time', () => {
  const { library, page } = plugin();
  const collector = page.__rhLatency = { events: [] };
  library.RhLatency_WishPresented('presentWishLanded', 10, 0, 1, 123.25);
  library.RhLatency_WishPresented('presentWishLanded', 10, 0, 1, 123.25);
  assert.equal(collector.events.length, 2, 'same-frame/ability/time occurrences are not deduplicated');
  assert.deepEqual(JSON.parse(JSON.stringify(collector.events[0])), {
    kind: 'presentWishLanded', frame: 10, player: 0, ability: 1, sourceTime: 123.25, at: 123.5
  });
  assert.equal(collector.frame, 10);
  collector.events.length = 20000;
  library.RhLatency_WishPresented('presentWishEnded', 11, 4, 0, 150);
  assert.equal(collector.events.length, 20000);
  assert.equal(collector.frame, 11);
  assert.equal(collector.overflow, true);
});

test('explicit warm-up recording gate prevents frame collection until the measured trial begins', () => {
  const { library, page } = plugin();
  const collector = page.__rhLatency = { events: [], recording: false, targetsRequested: true };
  assert.equal(library.RhLatency_Enabled(), 0);
  for (let i = 0; i < 20001; i++) library.RhLatency_Mark('frameStart', i, 1, 0, 0, 0);
  library.RhLatency_WishPresented('presentWishLanded', 1, 1, 0, 50);
  assert.equal(library.RhLatency_TakeTargetRequest(), 0);
  assert.equal(collector.events.length, 0);
  assert.equal(collector.overflow, undefined);
  collector.recording = true;
  assert.equal(library.RhLatency_Enabled(), 1);
  assert.equal(library.RhLatency_TakeTargetRequest(), 1);
  library.RhLatency_Mark('sampleWish', 30000, 1, 7, 4, 5);
  assert.equal(collector.events.length, 1);
  assert.equal(collector.events[0].frame, 30000);
});
