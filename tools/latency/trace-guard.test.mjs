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
    assert.doesNotThrow(() => library.RhLatency_Mark('frameStart', 1, 2, 3, 4, 5));
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
  page.__rhLatency = { events: Object.freeze([]) };
  assert.doesNotThrow(() => library.RhLatency_Mark('frameStart', 2, 1, 0, 0, 0));
  assert.equal(page.__rhLatency.events.length, 0);
});
