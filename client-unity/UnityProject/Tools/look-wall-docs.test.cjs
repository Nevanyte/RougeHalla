'use strict';
// P-UNITY-LOOK-WALL-1 oracle: DIALS.md sends each frost-wall dial to a scene that shows a wall, and LOOK_CHECK.md describes the five
// new scenes and the fourth reflection target. (The scene-list pins live in look-docs.test.cjs and look-compare.test.cjs.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NEW = ['frost-wall', 'frost-wall-vertical', 'frost-wall-cracking', 'frost-wall-preview', 'frost-wall-preview-invalid'];

function dialRows() {
  const out = {};
  for (const l of read('docs/unity/DIALS.md').split('\n')) {
    if (!l.startsWith('|')) continue;
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    const m = /^`(frost-wall-[a-z]+)`$/.exec(cells[0]);
    if (m) out[m[1]] = cells[cells.length - 1];
  }
  return out;
}
const names = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

test('DIALS.md has the six frost-wall rows', () => {
  assert.deepEqual(Object.keys(dialRows()).sort(), ['frost-wall-alpha', 'frost-wall-crack', 'frost-wall-ice', 'frost-wall-lift', 'frost-wall-preview', 'frost-wall-telegraph']);
});

test('the frost-wall dials name a scene that shows a wall, and nothing says no capture scene has one', () => {
  const rows = dialRows();
  for (const d of ['frost-wall-ice', 'frost-wall-alpha', 'frost-wall-lift']) assert.ok(names(rows[d]).includes('frost-wall'), d + ' -> `frost-wall`: ' + rows[d]);
  assert.ok(names(rows['frost-wall-crack']).includes('frost-wall-cracking'), 'frost-wall-crack -> `frost-wall-cracking`: ' + rows['frost-wall-crack']);
  assert.ok(names(rows['frost-wall-preview']).includes('frost-wall-preview'), 'frost-wall-preview -> `frost-wall-preview`: ' + rows['frost-wall-preview']);
  // the telegraph has no scene of its own: it stays on a wall scene with a plain note
  assert.ok(names(rows['frost-wall-telegraph']).some((n) => NEW.includes(n)), 'frost-wall-telegraph names one of the new scenes: ' + rows['frost-wall-telegraph']);
  assert.ok(rows['frost-wall-telegraph'].replace(/`[^`]+`/g, '').trim().length > 0, 'the telegraph row says in plain words that no scene shows the cast line');
  for (const d of Object.keys(rows)) {
    assert.ok(!names(rows[d]).includes('frost-scene'), d + ' no longer points at frost-scene');
    assert.ok(!/no capture scene has a wall|P-UNITY-LOOK-WALL-1|judge these in a Web round/.test(rows[d]), d + ' no longer carries the "until this packet" note: ' + rows[d]);
  }
  assert.ok(!/no capture scene has a wall/.test(read('docs/unity/DIALS.md')));
});

test('LOOK_CHECK.md counts 37 names, lists the frost-wall scenes under a wall heading and counts four reflected members', () => {
  const md = read('docs/unity/LOOK_CHECK.md');
  assert.match(md, /37 names print/); assert.ok(!/32 names/.test(md), 'the old count is gone');
  for (const n of NEW) assert.ok(md.includes('`' + n + '`'), n + ' is listed');
  assert.match(md, /four non-public client members/); assert.match(md, /ArenaView\._frostWall/);
  assert.ok(!/three non-public client members/.test(md));
});
