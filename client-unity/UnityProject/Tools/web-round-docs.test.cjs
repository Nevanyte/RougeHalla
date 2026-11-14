'use strict';
// P-UNITY-WEB-DRIVE-2 oracle: docs/unity/WEB_ROUND.md carries every correction from the round-11 reports and a "find a landmark"
// step using the driver's new commands. Phrases are listed in docs/backlog/packets/P-UNITY-WEB-DRIVE-2.md; matched case-insensitively.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const md = fs.readFileSync(path.resolve(__dirname, '../../../docs/unity/WEB_ROUND.md'), 'utf8');
const has = (s) => md.toLowerCase().includes(s.toLowerCase());

const CORRECTIONS = [
  [1, "other sessions' servers"],
  [2, 'run it in the background'], [2, 'poll unity-build.out'], [2, 'one tool call times out'],
  [3, 'ShaderGraphSettings.asset'],
  [4, 'first server build is cold'],
  [5, 'start both arenas before the build'],
  [6, 'give the 7819 page URL explicitly'],
  [7, 'take a Tab-map shot after joining'],
  [8, '250 to 500 ms taps'],
  [9, 'no such process'],
  [10, 'shell functions do not persist'],
  [11, '10 minutes per session'],
  [12, 'clear the target first'],
  [13, 'aim beside it'],
];

for (const [n, phrase] of CORRECTIONS) {
  test('WEB_ROUND.md correction ' + n + ' says: "' + phrase + '"', () => assert.ok(has(phrase), 'missing the phrase: ' + phrase));
}

test('WEB_ROUND.md restores ShaderGraphSettings.asset with git checkout --', () => {
  assert.match(md, /git checkout -- [^\n]*ShaderGraphSettings\.asset/);
});

test('WEB_ROUND.md has a "find a landmark" step that uses scenario.probe=1 and the commands anchors, where, goto', () => {
  const m = /^#{2,3} [^\n]*find a landmark[^\n]*$/im.exec(md);
  assert.ok(m, 'a heading containing "Find a landmark"');
  const rest = md.slice(m.index + m[0].length), next = rest.search(/^#{2,3} /m);
  const step = (next < 0 ? rest : rest.slice(0, next)).replace(/\s/g, '').toLowerCase();
  for (const w of ['scenario.probe=1', '"cmd":"anchors"', '"cmd":"where"', '"cmd":"goto"', 'cave', 'volcano', 'church', 'bogtree', 'hall'])
    assert.ok(step.includes(w), 'the step mentions ' + w);
});

test('WEB_ROUND.md lists the new driver commands and the page URL carries scenario.probe=1', () => {
  assert.match(md, /`eval \{js\}`/); assert.match(md, /`anchors`/); assert.match(md, /`where`/); assert.match(md, /`goto \{x,y,within,timeoutMs\}`/);
  assert.match(md, /&scenario\.probe=1/);
});

test('WEB_ROUND.md states what goto does when blocked', () => {
  assert.match(md, /reason `blocked`|"reason":\s*"blocked"/);
});
