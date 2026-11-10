// Finite semantic control using a disposable source copy. It never patches /repo or rewrites source.json.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const mode = process.argv[2];
assert(mode === '--write' || mode === '--check');
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (p) => readFileSync(p, 'utf8');
const canonicalBytes = read('/out/source.json');
const canonical = JSON.parse(canonicalBytes);
const relative = 'packages/server/src/sim/quests.ts';
const original = read('/repo/' + relative);
const controls = [];
const run = (root, destination, mutant = false) => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', '/capture/capture.mts', '--write', destination, '--repo', root],
    {cwd: root, env: {...process.env, RH_QUEST_TOUR_MUTANT: mutant ? '1' : '0'}, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
  if (child.status !== 0) throw new Error('recapture failed; not a semantic kill: ' + child.stdout + child.stderr);
  return JSON.parse(read(destination));
};
const scratch = mkdtempSync('/tmp/rh-quest-tour-controls-');
try {
  const copy = join(scratch, 'source');
  // The entire copy is disposable. package node_modules/build outputs are not source inputs.
  cpSync('/repo', copy, {recursive: true, filter: (p) => !p.split('/').some((part) =>
    ['node_modules', '.git', 'target', 'client-unity', 'docs', 'crates', 'protocol', 'parity', 'dist', 'build'].includes(part))});
  symlinkSync('/repo/node_modules', join(copy, 'node_modules'), 'dir');
  const path = join(copy, relative);
  assert.equal(read(path), original);
  const needle = 'if (n > 0 && !seen?.has(zone)) fresh++;';
  assert.equal(original.split(needle).length, 2, 'one exact tour-supply branch');
  const replacement = 'if (n > 0 && (((seen?.size ?? 0) & (1 << ["fire", "sentenced", "plague", "frost", "holy"].indexOf(zone))) === 0)) fresh++;';
  const mutated = original.replace(needle, replacement);
  writeFileSync(path, mutated);
  const mutant = run(copy, join(scratch, 'mutant.json'), true);
  const outcomes = canonical.cases.map((base, i) => {
    const got = mutant.cases[i];
    assert.equal(got.name, base.name);
    // All earlier source frames must be exactly unchanged; the failure is the real post-step recheck outcome.
    assert.deepEqual(got.frames.slice(0, -1), base.frames.slice(0, -1));
    const source = base.frames.at(-1).quest.status;
    const observed = got.frames.at(-1).quest.status;
    assert.notEqual(observed, source, base.name + ': semantic mutant reached the wrong outcome');
    assert.equal(observed, source === 'open' ? 'expired' : 'open');
    return {case: base.name, path: 'cases[' + i + '].frames[' + (base.frames.length - 1) + '].quest.status',
      source, mutant: observed, tick: base.frames.at(-1).tick, time: base.frames.at(-1).time};
  });
  controls.push({name: 'population-count-as-region-mask', result: 'KILL', file: relative,
    originalSha256: hash(original), mutantSha256: hash(mutated), outcomes});
  // A comment-only change alters source provenance but must preserve all observed World/action/notice data.
  writeFileSync(path, original + '\n// quest-tour-supply provenance-only negative control\n');
  const comment = run(copy, join(scratch, 'comment.json'));
  assert.deepEqual(comment.cases, canonical.cases, 'comment-only control changes no source outcome');
  controls.push({name: 'comment-only', result: 'NONKILL', file: relative,
    semanticCasesEqual: true, provenanceChanged: comment.profile.sourceClosure.sha256 !== canonical.profile.sourceClosure.sha256});
  assert.equal(controls.at(-1).provenanceChanged, true);
  // An exact unmutated disposable recapture plus immutable /repo bytecheck closes the control run.
  writeFileSync(path, original);
  const restored = run(copy, join(scratch, 'restored.json'));
  assert.deepEqual(restored, canonical, 'restored copy equals the complete canonical corpus');
  const final = spawnSync(process.execPath, ['--import', 'tsx', '/capture/capture.mts', '--check', '/out/source.json'],
    {cwd: '/repo', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
  assert.equal(final.status, 0, 'immutable source restored control: ' + final.stdout + final.stderr);
  assert.equal(read('/repo/' + relative), original);
  assert.equal(read('/out/source.json'), canonicalBytes);
  const receipt = {format: 'rh-quest-tour-supply-controls/1', source: {bytes: Buffer.byteLength(canonicalBytes), sha256: hash(canonicalBytes)},
    controls, restoredCopy: 'BYTE_IDENTICAL', immutableSourceControl: 'PASS',
    safety: 'all patches and control outputs in unique disposable container directory; /repo read-only; canonical corpus unchanged'};
  const bytes = JSON.stringify(receipt, null, 1) + '\n';
  if (mode === '--write') writeFileSync('/out/controls.json', bytes);
  else assert.equal(read('/out/controls.json'), bytes, 'control receipt byte-identical');
  console.log(bytes.trim());
} finally {
  rmSync(scratch, {recursive: true, force: true});
}
