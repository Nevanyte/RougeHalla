#!/usr/bin/env node
// Isolated disposable-copy mutation controls for check-card-chain.mjs.
// This helper never writes to the active checkout. It is intentionally not run
// by default; execute it only after the auditor and producer chain are frozen.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packetDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(packetDir, '../../..');
const auditorRel = 'tools/provenance/check-card-chain.mjs';
const catalogRel = 'parity/card-catalog/source.json';
const runtimeRel = 'parity/card-runtime/source.json';
const runtimeInputRel = 'parity/card-runtime/INPUT_SHA256.json';
const witnessRel = 'parity/card-runtime-witness/source.json';
const witnessInputRel = 'parity/card-runtime-witness/INPUT_SHA256.json';
const frozenRel = 'tools/card-runtime-witness-fixtures/FROZEN_PINS.json';
const checkerRel = 'tools/protocol-js/check-vectors.mjs';
const proofRel = 'tools/browser-proof/proof.mjs';
const expectedProtectedCount = 325;
const outputJson = resolve(process.env.RH_BROWSER_PROVENANCE14_CONTROLS_JSON ?? join(packetDir, 'auditor-controls.json'));
const outputLog = resolve(process.env.RH_BROWSER_PROVENANCE14_CONTROLS_LOG ?? join(packetDir, 'logs/auditor-controls.log'));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const safeRel = (p) => {
  assert.equal(typeof p, 'string', 'inventory path must be a string');
  assert(p.length > 0 && !p.includes('\\') && !p.startsWith('/'), `unsafe inventory path: ${p}`);
  const abs = resolve(repo, p);
  assert(abs.startsWith(repo + sep), `inventory path escapes checkout: ${p}`);
  return p;
};

function addPaths(set, paths) {
  for (const p of paths ?? []) set.add(safeRel(p));
}

// Copy the auditor's complete input closure, including both input manifests and
// every inventory/pin they name. No directory or symlink is copied wholesale.
function gatherFiles() {
  const catalog = readJson(join(repo, catalogRel));
  const runtime = readJson(join(repo, runtimeRel));
  const witness = readJson(join(repo, witnessRel));
  const frozen = readJson(join(repo, frozenRel));
  const paths = new Set([
    auditorRel, catalogRel, runtimeRel, runtimeInputRel,
    witnessRel, witnessInputRel, frozenRel,
  ]);
  addPaths(paths, Object.keys(catalog.protectedSha256 ?? {}));
  addPaths(paths, Object.keys(catalog.sourceSha256 ?? {}));
  addPaths(paths, Object.keys(catalog.harnessSha256 ?? {}));
  for (const field of ['sourceInputs', 'harnessInputs']) {
    addPaths(paths, (runtime.provenance?.[field] ?? []).map((row) => row.path));
    addPaths(paths, (witness.provenance?.[field] ?? []).map((row) => row.path));
  }
  addPaths(paths, (frozen.files ?? []).map((row) => row.path));
  assert.equal((frozen.files ?? []).length, 15, 'expected the frozen 15-file witness inventory');
  assert.equal(Object.keys(catalog.protectedSha256 ?? {}).length, expectedProtectedCount,
    'baseline protected map must contain 325 leaves before running mutation controls');
  return [...paths].sort();
}

function copyClosure(tempRoot, paths) {
  for (const rel of paths) {
    const src = resolve(repo, rel);
    const dst = resolve(tempRoot, rel);
    assert(src.startsWith(repo + sep) && dst.startsWith(tempRoot + sep));
    let cursor = repo;
    for (const part of rel.split('/')) {
      cursor = join(cursor, part);
      assert(!lstatSync(cursor).isSymbolicLink(), `refusing symlink input: ${rel}`);
    }
    const srcStat = lstatSync(src);
    assert(srcStat.isFile(), `expected regular file: ${rel}`);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    chmodSync(dst, srcStat.mode & 0o777);
    const dstStat = lstatSync(dst);
    assert(dstStat.isFile() && !dstStat.isSymbolicLink(), `copy is not a regular file: ${rel}`);
    assert.equal(dstStat.nlink, 1, `copy unexpectedly has hard links: ${rel}`);
    if (srcStat.dev === dstStat.dev) assert.notEqual(srcStat.ino, dstStat.ino, `copy reused source inode: ${rel}`);
  }
}

function runAuditor(tempRoot) {
  const result = spawnSync(process.execPath, [join(tempRoot, auditorRel), '--root', tempRoot], {
    cwd: tempRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  assert.ifError(result.error);
  let parsed;
  try { parsed = JSON.parse(result.stdout); }
  catch (error) { throw new Error(`auditor did not emit JSON (exit ${result.status}): ${result.stdout}\n${result.stderr}`, { cause: error }); }
  // Keep results portable: the random temp path is not useful evidence.
  parsed.root = '<isolated-copy>';
  return { exitCode: result.status, stderr: result.stderr, report: parsed };
}

function hasFailure(result, kind, path = undefined) {
  return result.report.failures.some((f) => f.kind === kind && (path === undefined || f.path === path));
}

const runs = [];
function record(name, result, expected = null) {
  runs.push({ name, ...result, expected });
}

function mutateFile(tempRoot, rel, mutate) {
  const path = resolve(tempRoot, rel);
  const before = existsSync(path) ? readFileSync(path) : null;
  mutate(path, before);
  return () => {
    if (before === null) rmSync(path, { force: true });
    else writeFileSync(path, before);
  };
}

function mutateJson(tempRoot, rel, mutate) {
  return mutateFile(tempRoot, rel, (path, before) => {
    assert(before !== null, `missing mutation target: ${rel}`);
    const value = JSON.parse(before.toString('utf8'));
    mutate(value);
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
  });
}

function isolatedNegative(tempRoot, name, mutate, requirements) {
  const restore = mutate(tempRoot);
  try {
    const result = runAuditor(tempRoot);
    assert.notEqual(result.exitCode, 0, `${name}: auditor unexpectedly accepted mutation`);
    for (const [kind, path] of requirements) {
      assert(hasFailure(result, kind, path), `${name}: expected named failure ${kind}${path ? ` at ${path}` : ''}; got ${JSON.stringify(result.report.failures)}`);
    }
    record(name, result, requirements.map(([kind, path]) => ({ kind, ...(path ? { path } : {}) })));
  } finally { restore(); }
  const restored = runAuditor(tempRoot);
  assert.equal(restored.exitCode, 0, `${name}: pristine auditor copy did not recover: ${JSON.stringify(restored.report.failures)}`);
}

let tempRoot;
let fatal = null;
try {
  const paths = gatherFiles();
  tempRoot = mkdtempSync(join(os.tmpdir(), 'rh-browser-provenance14-audit-'));
  copyClosure(tempRoot, paths);

  const baseline = runAuditor(tempRoot);
  assert.equal(baseline.exitCode, 0, `pristine auditor copy failed: ${JSON.stringify(baseline.report.failures)}`);
  assert.equal(baseline.report.ok, true);
  record('pristine', baseline, []);

  for (const [name, rel] of [['protected-checker', checkerRel], ['protected-browser-proof', proofRel]]) {
    isolatedNegative(tempRoot, name, () => mutateFile(tempRoot, rel, (path, before) => {
      assert(before !== null); writeFileSync(path, Buffer.concat([before, Buffer.from('\n// isolated mutation\n')]));
    }), [['catalog-protected-sha', rel]]);
  }

  isolatedNegative(tempRoot, 'protected-map-extra-leaf', () => mutateJson(tempRoot, catalogRel, (c) => {
    c.protectedSha256['tools/provenance/isolated-extra.mjs'] = '0'.repeat(64);
  }), [['catalog-protected-count', `${catalogRel} protectedSha256`]]);

  isolatedNegative(tempRoot, 'required-checker-omitted', () => mutateJson(tempRoot, catalogRel, (c) => {
    delete c.protectedSha256[checkerRel];
  }), [['catalog-protected-field', `${catalogRel} protectedSha256/${checkerRel}`]]);

  isolatedNegative(tempRoot, 'runtime-overlay-unknown-leaf', () => mutateJson(tempRoot, runtimeRel, (r) => {
    r.provenance.acceptedProvenanceOverlay.acceptedChanges.push({
      leaf: '/protectedSha256/tools/forbidden-extra.mjs', from: '0'.repeat(64), to: '1'.repeat(64), evidence: 'isolated control',
    });
  }), [['runtime-overlay-unknown-leaf', 'provenance.acceptedProvenanceOverlay.acceptedChanges']]);

  isolatedNegative(tempRoot, 'runtime-overlay-missing-leaf', () => mutateJson(tempRoot, runtimeRel, (r) => {
    r.provenance.acceptedProvenanceOverlay.acceptedChanges.pop();
  }), [
    ['runtime-overlay-leaf-count', 'provenance.acceptedProvenanceOverlay.acceptedChanges'],
    ['runtime-overlay-leaf-missing', 'provenance.acceptedProvenanceOverlay.acceptedChanges'],
  ]);

  isolatedNegative(tempRoot, 'runtime-overlay-extra-leaf', () => mutateJson(tempRoot, runtimeRel, (r) => {
    r.provenance.acceptedProvenanceOverlay.acceptedChanges.push({
      ...r.provenance.acceptedProvenanceOverlay.acceptedChanges[0],
    });
  }), [['runtime-overlay-leaf-count', 'provenance.acceptedProvenanceOverlay.acceptedChanges']]);

  isolatedNegative(tempRoot, 'witness-overlay-unknown-path', () => mutateJson(tempRoot, witnessRel, (w) => {
    w.provenance.acceptedProvenanceOverlay.push({
      path: 'tools/forbidden/extra.mjs', originalSha256: '0'.repeat(64),
      priorAcceptedEffectiveSha256: '1'.repeat(64), effectiveSha256: '2'.repeat(64),
    });
  }), [
    ['witness-overlay-count', 'witness acceptedProvenanceOverlay'],
    ['witness-overlay-unknown-path', 'witness acceptedProvenanceOverlay.path'],
  ]);

  isolatedNegative(tempRoot, 'runtime-overlay-stale-effective', () => mutateJson(tempRoot, runtimeRel, (r) => {
    r.provenance.acceptedProvenanceOverlay.effectiveSha256 = 'f'.repeat(64);
  }), [['runtime-overlay-effective', 'provenance.acceptedProvenanceOverlay.effectiveSha256']]);

  isolatedNegative(tempRoot, 'catalog-source-inventory-missing', () => mutateJson(tempRoot, catalogRel, (c) => {
    delete c.sourceSha256;
  }), [['catalog-sourceSha256-missing', `${catalogRel} sourceSha256`]]);

  isolatedNegative(tempRoot, 'catalog-harness-inventory-empty', () => mutateJson(tempRoot, catalogRel, (c) => {
    c.harnessSha256 = {};
  }), [['catalog-harnessSha256-count', `${catalogRel} harnessSha256`]]);

  const catalog = readJson(join(tempRoot, catalogRel));
  const sourcePath = Object.keys(catalog.sourceSha256).sort()[0];
  const harnessPath = Object.keys(catalog.harnessSha256).sort()[0];
  for (const [name, rel, failureKind] of [
    ['catalog-source-actual-pin', sourcePath, 'catalog-source-sha'],
    ['catalog-harness-actual-pin', harnessPath, 'catalog-harness-sha'],
  ]) isolatedNegative(tempRoot, name, () => mutateFile(tempRoot, rel, (path, before) => {
    assert(before !== null, `listed ${rel} missing in isolated copy`);
    writeFileSync(path, Buffer.concat([before, Buffer.from('\n// isolated mutation\n')]));
  }), [[failureKind, rel]]);

  isolatedNegative(tempRoot, 'frozen-pins-byte-mutation', () => mutateFile(tempRoot, frozenRel, (path, before) => {
    assert(before !== null); writeFileSync(path, Buffer.concat([before, Buffer.from(' ')]));
  }), [['frozen-pins-hash', frozenRel]]);

  isolatedNegative(tempRoot, 'frozen-pins-count-mutation', () => mutateJson(tempRoot, frozenRel, (f) => {
    f.files.pop();
  }), [['frozen-file-count', 'FROZEN_PINS.files']]);

  const finalBaseline = runAuditor(tempRoot);
  assert.equal(finalBaseline.exitCode, 0, `final pristine auditor copy failed: ${JSON.stringify(finalBaseline.report.failures)}`);
  record('final-pristine', finalBaseline, []);
} catch (error) {
  fatal = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
} finally {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
}

const result = {
  format: 'rh-browser-provenance14-auditor-controls/1',
  executed: true,
  baseRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  auditorSha256: sha256(readFileSync(join(repo, auditorRel))),
  helperSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  isolatedCopyFiles: (() => { try { return gatherFiles().length; } catch { return null; } })(),
  status: fatal ? 'FAIL' : 'PASS',
  fatal,
  runs,
};
const serialized = JSON.stringify(result, null, 2) + '\n';
mkdirSync(dirname(outputJson), { recursive: true });
mkdirSync(dirname(outputLog), { recursive: true });
writeFileSync(outputJson, serialized);
const log = [
  `format=${result.format}`,
  `baseRevision=${result.baseRevision}`,
  `auditorSha256=${result.auditorSha256}`,
  `helperSha256=${result.helperSha256}`,
  `status=${result.status}`,
  ...(fatal ? [`fatal=${fatal}`] : []),
  ...runs.map((r) => `${r.name}: exit=${r.exitCode} failures=${r.report.failureCount}`),
].join('\n') + '\n';
writeFileSync(outputLog, log);
process.stdout.write(log);
if (fatal) process.exitCode = 1;
