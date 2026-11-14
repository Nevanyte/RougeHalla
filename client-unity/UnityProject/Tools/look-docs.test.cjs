'use strict';
// P-UNITY-LOOK-TOOLS-1 oracle: the look-check and Web-round documents quote commands that name real files, and the dials index
// names only scenes the capture has. Contract: docs/backlog/packets/P-UNITY-LOOK-TOOLS-1.md, Established facts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel) => { const f = path.join(ROOT, rel); assert.ok(fs.existsSync(f), rel + ' must exist'); return fs.readFileSync(f, 'utf8'); };

const ZONES = ['fire', 'plague', 'sentenced', 'holy', 'frost'];
const PINNED = [];
for (const z of ZONES) PINNED.push(z + '-scene', z + '-scene-dressed');
for (const k of ['cave', 'volcano', 'church', 'bog', 'hall']) {
  PINNED.push(k + '-wide', k + '-close');
  if (['cave', 'church', 'hall'].includes(k)) PINNED.push(k + '-inside');
  if (k === 'bog') PINNED.push(k + '-under');
  PINNED.push(k + '-rot-wide');
}
PINNED.push('volcano-edge-wide', 'volcano-edge-close', 'volcano-edge-rot-wide');
PINNED.push('frost-wall', 'frost-wall-vertical', 'frost-wall-cracking', 'frost-wall-preview', 'frost-wall-preview-invalid');   // P-UNITY-LOOK-WALL-1

/** Build outputs a command may name although they are not in the tree. */
const GENERATED = [/^target\//, /^client-unity\/UnityProject\/(Build|Logs|Library|Temp)\//, /^(Build|Logs)\//];

/** Lines of fenced code blocks (``` ... ```), comments and blank lines dropped, a leading "$ " removed, "\" continuations joined. */
function commandLines(md) {
  const out = []; let inFence = false, pending = '';
  for (const raw of md.split('\n')) {
    if (/^\s*```/.test(raw)) { inFence = !inFence; pending = ''; continue; }
    if (!inFence) continue;
    let l = raw.trim().replace(/^\$\s+/, '');
    if (!l || l.startsWith('#')) continue;
    if (l.endsWith('\\')) { pending += l.slice(0, -1) + ' '; continue; }
    out.push(pending + l); pending = '';
  }
  return out;
}

/** Tokens that name a repository path: relative, with a slash, no placeholder, variable, glob, URL or host:port. */
function repoPaths(line) {
  const out = [];
  for (let t of line.split(/\s+/)) {
    t = t.replace(/^["'(]+|["'),;]+$/g, '').replace(/^\.\//, '');
    if (!t.includes('/') || /[<>$*{}:=|]/.test(t) || t.startsWith('-') || t.startsWith('/') || t.startsWith('~')) continue;
    if (!/^[A-Za-z0-9_.][A-Za-z0-9_.\-/]*$/.test(t)) continue;
    out.push(t);
  }
  return out;
}

function assertCommandsNameRealFiles(rel, lines) {
  const missing = [];
  for (const line of lines) for (const p of repoPaths(line)) {
    if (GENERATED.some((re) => re.test(p))) continue;
    if (!fs.existsSync(path.join(ROOT, p))) missing.push(p + '   (in: ' + line.slice(0, 100) + ')');
  }
  assert.deepEqual(missing, [], rel + ' quotes commands naming files that are not in the tree');
}

function section(md, heading) {   // from "## <heading...>" to the next "## "
  const start = md.search(new RegExp('^## ' + heading, 'm'));
  assert.ok(start >= 0, 'section "## ' + heading + '" exists');
  const rest = md.slice(start + 3), next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

test('LOOK_CHECK.md section 1 quotes the capture, list and compare commands, each naming a file that exists', () => {
  const s1 = section(read('docs/unity/LOOK_CHECK.md'), '1\\.');
  const lines = commandLines(s1);
  assert.ok(lines.some((l) => /client-unity\/UnityProject\/Tools\/look-capture\.sh .*--out /.test(l)), 'a capture command with --out');
  assert.ok(lines.some((l) => /client-unity\/UnityProject\/Tools\/look-capture\.sh --list/.test(l)), 'the --list command');
  assert.ok(lines.some((l) => /client-unity\/UnityProject\/Tools\/look-compare\.py /.test(l) && !/--noise/.test(l)), 'a before/after compare command');
  assert.ok(lines.some((l) => /look-compare\.py .*--noise /.test(l)), 'a noise compare command');
  assertCommandsNameRealFiles('LOOK_CHECK.md section 1', lines);
  assert.ok(!/Until that packet has landed|is being committed by P-UNITY-LOOK-TOOLS-1/.test(s1), 'the "not yet landed" status text is gone');
});

test('LOOK_CHECK.md names every scene in the list, and no other scene-shaped name', () => {
  const md = read('docs/unity/LOOK_CHECK.md');
  const ticked = new Set([...md.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)].map((m) => m[1]));
  const missing = PINNED.filter((n) => !ticked.has(n));
  assert.deepEqual(missing, [], 'scene names absent from LOOK_CHECK.md (write each as `name`)');
  const shaped = /^(fire|plague|sentenced|holy|frost|cave|volcano|church|bog|hall)-/;
  const stray = [...ticked].filter((n) => shaped.test(n) && !PINNED.includes(n));
  assert.deepEqual(stray, [], 'scene-shaped names that are not in the list');
});

test('LOOK_CHECK.md states the limits: the noise figure, no frame-identical renders, and points at WEB_ROUND.md', () => {
  const md = read('docs/unity/LOOK_CHECK.md');
  assert.match(md, /noise/i); assert.match(md, /frame-identical|identical frames|bit-identical/i);
  assert.match(md, /WEB_ROUND\.md/);
  assert.match(md, /-nographics|with graphics/i, 'says the capture needs graphics (EditMode runs without)');
});

test('WEB_ROUND.md exists, quotes commands naming real files, and covers the recipe', () => {
  const md = read('docs/unity/WEB_ROUND.md');
  const lines = commandLines(md);
  assert.ok(lines.length >= 8, 'at least eight quoted command lines, got ' + lines.length);
  assertCommandsNameRealFiles('WEB_ROUND.md', lines);
  const all = lines.join('\n');
  for (const [re, what] of [
    [/cargo build --release -p rh-server/, 'building rh-server'],
    [/--runtime source-arena/, 'the arena runtime'],
    [/--map-pool/, 'the map pool switch'],
    [/--signature-landmarks/, 'pooled landmark maps'],
    [/--fill-bots 0/, 'a solo room'],
    [/RH_SERVER_INFO_URL=\S+ .*Tools\/build-web\.sh|RH_SERVER_INFO_URL=\S+\s+bash .*build-web\.sh/, 'the Web build with the server info URL'],
    [/http\.server/, 'serving the build'],
    [/node client-unity\/UnityProject\/Tools\/web-drive\.cjs/, 'starting the browser driver (Tools/web-drive.cjs)'],
  ]) assert.match(all, re, 'WEB_ROUND.md should quote: ' + what);
  for (const [re, what] of [
    [/BakedContent\.cs/, 'restoring BakedContent.cs'],
    [/diagnostic=1/, 'the diagnostic URL and what it disables'],
    [/Training|practice/i, 'how practice is entered'],
    [/only your own|your own process/i, 'the rule: stop only your own processes'],
    [/shader failed to compile|Shader error/i, 'what a failing build prints'],
    [/Audio check: all streamed files present/, 'what a clean run prints'],
    [/darker/i, 'the capture is darker than the Web client'],
  ]) assert.match(md, re, 'WEB_ROUND.md should say: ' + what);
});

test('the Web driver exists as a repository tool and takes its Playwright module from RH_PLAYWRIGHT_MODULE', () => {
  const f = path.join(__dirname, 'web-drive.cjs');
  assert.ok(fs.existsSync(f), 'client-unity/UnityProject/Tools/web-drive.cjs (from the session driver drv.cjs)');
  const src = fs.readFileSync(f, 'utf8');
  assert.match(src, /RH_PLAYWRIGHT_MODULE/); assert.ok(!/\.codex/.test(src), 'no machine-specific path');
  for (const cmd of ['goto', 'click', 'down', 'up', 'press', 'wait', 'shot', 'errs', 'quit']) assert.ok(src.includes("'" + cmd + "'"), 'driver command ' + cmd);
});

test('DIALS.md: every row of the Scene column names only scenes in the list', () => {
  const md = read('docs/unity/DIALS.md');
  const rows = md.split('\n').filter((l) => l.startsWith('|'));
  const head = rows[0].split('|').slice(1, -1).map((c) => c.trim());
  const col = head.indexOf('Scene'); assert.ok(col >= 0, 'a Scene column');
  const body = rows.slice(2);
  assert.ok(body.length >= 3);
  for (const r of body) {
    const cell = r.split('|').slice(1, -1)[col] || '';
    const names = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    assert.ok(names.length > 0, 'a scene name in: ' + cell);
    for (const n of names) assert.ok(PINNED.includes(n), n + ' is not a scene of the capture');
  }
});
