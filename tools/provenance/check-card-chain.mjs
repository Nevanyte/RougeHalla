#!/usr/bin/env node
// Fast read-only card provenance-chain auditor. Never refreshes data, never edits pins.
// Usage: node tools/provenance/check-card-chain.mjs [--root <repo-root>]
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootArg = args.includes('--root') ? args[args.indexOf('--root') + 1] : null;
const root = (rootArg || fileURLToPath(new URL('../../', import.meta.url))).replace(/\/+$/, '');
const failures = [];
const accepted = [];
const sha = (p) => createHash('sha256').update(readFileSync(join(root, p))).digest('hex');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const fail = (kind, path, expected, actual, detail) => failures.push({ kind, path, expected, actual, detail });
const eq = (kind, path, expected, actual, detail) => { if (expected !== actual) fail(kind, path, expected, actual, detail); };
const need = (p) => { if (!existsSync(join(root, p))) { fail('missing-file', p, 'exists', 'missing'); return false; } return true; };

const EXPECTED = {
  catalogSource: '2ddb8f85114ff6e8e70c2d70b8207ed3f32c71431845f3cce1007be494e39792',
  browserProof: '6aea66795ed18edd941a4bc65c62070d6a6e2fce1b57cd98d0238db134fcfd66',
  runtimeSource: '9e357ed421c876de39c004236a83563116b390fc9d75043af24047dc952fe049',
  runtimeInput: '4dd8dff0f8474e7cc312b1a9588560fe06984e42bb878ee0dd40182bd32a968e',
  runtimeCaptureTool: '508e4ed7f473dcccea774fe769756e863bd531a3abe5dca682d5df7ddda87794',
  witnessSource: '59fdc1ccabd5b15d2251272cd7a10e41e3b9858203a9a61bd877a10c28917ebe',
  witnessInput: '2e89b83e5aee298d423b320f12d419b9077edae73a3688275be3211ccc8e9249',
  witnessCaptureTool: '3faf321de92dc17af21d351078a31734293969883be63ddb68cfef45a44699e4',
  frozenPins: '7ed1086915fafd5fa129669270d6d53090f4b81052660a18318df60cab8b3023',
  frozenSource: 'c2e5d1a071f3f7a05a6c3e8bf46fbdba8f0c7ae47d4de1aea8e62a1726ecd019',
  runtimeSourceOriginal: 'c2e5d1a071f3f7a05a6c3e8bf46fbdba8f0c7ae47d4de1aea8e62a1726ecd019',
  runtimeSourcePrior: '80516466ca231b88d16cd0d187f90260f141042ba59b37322b99016ebcae33e1',
  runtimeInputOriginal: '2ea71ac15addc60e406aebbb7defedf8492c135d0a787a15808b69e4bc34d39a',
  runtimeInputPrior: '84ffcc7ff49536cc0d1d542a25f42994b68c049f28877d9375da08aa73186e79',
  toolOriginal: '24df22055a3c77b75e01b478d04a477a57690d7f71220916d0816551102fff9e',
  toolPrior: '5ca446a1934846ffa14e561a10b06230b55a73f924d7853c5c9ecec79b13857d',
  docOriginal: 'd5d3c30632494c98fb96ce4ddad76da2e716322609ccca767e52b868ec16742d',
  docAccepted: 'd0fa1b753a7016e07c9bb3b3db4ae55ef483df176c343296c80e2c8756ba5ed8',
  catalogOriginal: 'd50c03e471f9d11ff790cac0f31d4ab82b5bb45f1b963b41725d58814cc6f74e',
  catalogPrior: '9e76292b7ae74d305da2729a2ceba63965e64aa9fd670ab85568ae7909270507',
};
const overlays = [
  { path: 'parity/card-runtime/source.json', original: EXPECTED.runtimeSourceOriginal, prior: EXPECTED.runtimeSourcePrior, effective: EXPECTED.runtimeSource },
  { path: 'parity/card-runtime/INPUT_SHA256.json', original: EXPECTED.runtimeInputOriginal, prior: EXPECTED.runtimeInputPrior, effective: EXPECTED.runtimeInput },
  { path: 'tools/card-runtime-fixtures/capture.mts', original: EXPECTED.toolOriginal, prior: EXPECTED.toolPrior, effective: EXPECTED.runtimeCaptureTool },
];

// 1. Catalog canonical corpus and every protected hash it records.
if (need('parity/card-catalog/source.json')) {
  const catalog = read('parity/card-catalog/source.json');
  eq('catalog-source-hash', 'parity/card-catalog/source.json', EXPECTED.catalogSource, sha('parity/card-catalog/source.json'));
  const protectedMap = catalog.protectedSha256 ?? {};
  eq('catalog-protected-field', 'parity/card-catalog/source.json protectedSha256/tools/browser-proof/proof.mjs', EXPECTED.browserProof, protectedMap['tools/browser-proof/proof.mjs']);
  for (const [p, expected] of Object.entries(protectedMap)) {
    if (!need(p)) continue;
    eq('catalog-protected-sha', p, expected, sha(p), 'catalog protectedSha256 map is stale vs current file');
  }

  // Fail-closed catalog source/harness inventories: required presence, exact count, shape, and per-entry actual hashes.
  for (const [inventoryName, expectedCount, failureKind] of [
    ['sourceSha256', 78, 'catalog-source-sha'],
    ['harnessSha256', 5, 'catalog-harness-sha'],
  ]) {
    const inv = catalog[inventoryName];
    if (!inv || typeof inv !== 'object' || Array.isArray(inv)) {
      fail('catalog-' + inventoryName + '-missing', 'parity/card-catalog/source.json ' + inventoryName, 'non-empty object of path->sha256', inv === undefined ? 'missing' : typeof inv);
      continue;
    }
    const entries = Object.entries(inv);
    eq('catalog-' + inventoryName + '-count', 'parity/card-catalog/source.json ' + inventoryName, expectedCount, entries.length, 'inventory must not be empty or silently shrink');
    for (const [p, expected] of entries) {
      if (typeof p !== 'string' || p.length === 0) { fail('catalog-' + inventoryName + '-shape', 'parity/card-catalog/source.json ' + inventoryName, 'non-empty path string', p, 'invalid inventory path'); continue; }
      if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) { fail('catalog-' + inventoryName + '-shape', p, '64 lowercase hex sha256', expected, 'invalid inventory hash'); continue; }
      if (!need(p)) continue;
      eq(failureKind, p, expected, sha(p), 'catalog ' + inventoryName + ' inventory is stale vs current file');
    }
  }
}

// 2. Runtime corpus/inputs and their explicit accepted catalog chain.
if (need('parity/card-runtime/source.json')) {
  const rt = read('parity/card-runtime/source.json');
  eq('runtime-source-hash', 'parity/card-runtime/source.json', EXPECTED.runtimeSource, sha('parity/card-runtime/source.json'));
  const refs = rt.provenance?.immutableReferences ?? [];
  eq('runtime-immutable-refs', 'parity/card-runtime/source.json immutableReferences[0].path', 'parity/card-catalog/source.json', refs[0]?.path);
  eq('runtime-ref-catalog', 'parity/card-runtime/source.json immutableReferences[0].sha256', EXPECTED.catalogSource, refs[0]?.sha256);
  const ov = rt.provenance?.acceptedProvenanceOverlay;
  if (!ov) fail('runtime-overlay-missing', 'parity/card-runtime/source.json provenance.acceptedProvenanceOverlay', 'object', 'missing');
  else {
    eq('runtime-overlay-path', 'provenance.acceptedProvenanceOverlay.path', 'parity/card-catalog/source.json', ov.path);
    eq('runtime-overlay-original', 'provenance.acceptedProvenanceOverlay.originalSha256', EXPECTED.catalogOriginal, ov.originalSha256);
    eq('runtime-overlay-prior', 'provenance.acceptedProvenanceOverlay.priorAcceptedEffectiveSha256', EXPECTED.catalogPrior, ov.priorAcceptedEffectiveSha256);
    eq('runtime-overlay-effective', 'provenance.acceptedProvenanceOverlay.effectiveSha256', EXPECTED.catalogSource, ov.effectiveSha256);
    eq('runtime-overlay-leaf-count', 'provenance.acceptedProvenanceOverlay.acceptedChanges', 2, (ov.acceptedChanges ?? []).length);
    const expectedLeaves = {
      '/protectedSha256/tools/protocol-js/check-vectors.mjs': ['775ab7cf7738c421a9b858850153a2ca1008e3f7f726520d940be20698314f27', '3c96f5b013d7ee647b4d4b67c762e5db5b38dc8fd7e669c7a4b139c9a0778a90'],
      '/protectedSha256/tools/browser-proof/proof.mjs': ['a49aa61cdb1adeef60031b3e87407233c85f3203b7a6c464c4b5119c8bd1850f', EXPECTED.browserProof],
    };
    for (const change of ov.acceptedChanges ?? []) {
      const want = expectedLeaves[change.leaf];
      if (!want) fail('runtime-overlay-unknown-leaf', 'provenance.acceptedProvenanceOverlay.acceptedChanges', Object.keys(expectedLeaves), change.leaf, 'unexpected accepted metadata leaf');
      else { eq('runtime-overlay-leaf-from', change.leaf + '.from', want[0], change.from); eq('runtime-overlay-leaf-to', change.leaf + '.to', want[1], change.to); }
    }
    for (const p of (ov.acceptedChanges ?? []).map((c) => c.leaf)) delete expectedLeaves[p];
    if (Object.keys(expectedLeaves).length) fail('runtime-overlay-leaf-missing', 'provenance.acceptedProvenanceOverlay.acceptedChanges', Object.keys(expectedLeaves), 'missing', 'recorded accepted leaves incomplete');
    accepted.push({ kind: 'runtime catalog provenance chain', path: ov.path, original: ov.originalSha256, prior: ov.priorAcceptedEffectiveSha256, effective: ov.effectiveSha256, leaves: (ov.acceptedChanges ?? []).map((c) => c.leaf) });
  }
  for (const list of ['sourceInputs', 'harnessInputs']) for (const row of (rt.provenance?.[list] ?? [])) { if (need(row.path)) eq('runtime-' + list + '-sha', row.path, row.sha256, sha(row.path)); }
  eq('runtime-tool-harness-sha', 'tools/card-runtime-fixtures/capture.mts', EXPECTED.runtimeCaptureTool, sha('tools/card-runtime-fixtures/capture.mts'));
  if (need('parity/card-runtime/INPUT_SHA256.json')) {
    const inp = read('parity/card-runtime/INPUT_SHA256.json');
    eq('runtime-input-hash', 'parity/card-runtime/INPUT_SHA256.json', EXPECTED.runtimeInput, sha('parity/card-runtime/INPUT_SHA256.json'));
    eq('runtime-input-ref-catalog', 'parity/card-runtime/INPUT_SHA256.json immutableReferences[0].sha256', EXPECTED.catalogSource, inp.immutableReferences?.[0]?.sha256);
    eq('runtime-input-overlay-effective', 'INPUT_SHA256.acceptedProvenanceOverlay.effectiveSha256', EXPECTED.catalogSource, inp.acceptedProvenanceOverlay?.effectiveSha256);
  }
}

// 3. Witness corpus/inputs: original FROZEN pins preserved, only explicit accepted overlays for changed pins.
if (need('parity/card-runtime-witness/source.json')) {
  const wit = read('parity/card-runtime-witness/source.json');
  eq('witness-source-hash', 'parity/card-runtime-witness/source.json', EXPECTED.witnessSource, sha('parity/card-runtime-witness/source.json'));
  eq('witness-input-hash', 'parity/card-runtime-witness/INPUT_SHA256.json', EXPECTED.witnessInput, sha('parity/card-runtime-witness/INPUT_SHA256.json'));
  eq('frozen-pins-hash', 'tools/card-runtime-witness-fixtures/FROZEN_PINS.json', EXPECTED.frozenPins, sha('tools/card-runtime-witness-fixtures/FROZEN_PINS.json'));
  eq('witness-tool-harness-sha', 'tools/card-runtime-witness-fixtures/capture.mts', EXPECTED.witnessCaptureTool, sha('tools/card-runtime-witness-fixtures/capture.mts'));
  const frozen = read('tools/card-runtime-witness-fixtures/FROZEN_PINS.json');
  eq('frozen-source', 'FROZEN_PINS.frozenSourceSha256', EXPECTED.frozenSource, frozen.frozenSourceSha256);
  eq('frozen-file-count', 'FROZEN_PINS.files', 15, (frozen.files ?? []).length);
  eq('frozen-tool-count', 'FROZEN_PINS tools files', 11, (frozen.files ?? []).filter((f) => f.path.startsWith('tools/card-runtime-fixtures/')).length);
  const frozenByPath = new Map((frozen.files ?? []).map((f) => [f.path, f.sha256]));
  const overlayByPath = new Map(overlays.map((o) => [o.path, o]));
  for (const f of frozen.files ?? []) {
    if (!need(f.path)) continue;
    const actual = sha(f.path);
    if (f.path === 'parity/card-runtime/README.md') { eq('doc-overlay-sha', f.path, EXPECTED.docAccepted, actual); accepted.push({ kind: 'documentation overlay', path: f.path, original: f.sha256, effective: actual }); continue; }
    const ov = overlayByPath.get(f.path);
    if (ov) {
      eq('frozen-original-sha', f.path + ' frozen original', ov.original, f.sha256);
      eq('witness-overlay-effective', f.path + ' current effective', ov.effective, actual);
      accepted.push({ kind: 'witness provenance chain', path: f.path, original: f.sha256, prior: ov.prior, effective: actual });
    } else eq('frozen-file-sha', f.path, f.sha256, actual);
  }
  const witnessOverlays = wit.provenance?.acceptedProvenanceOverlay ?? [];
  eq('witness-overlay-count', 'witness acceptedProvenanceOverlay', 3, witnessOverlays.length);
  const expectedByPath = new Map(overlays.map((o) => [o.path, o]));
  for (const ov of witnessOverlays) {
    const want = expectedByPath.get(ov.path);
    if (!want) { fail('witness-overlay-unknown-path', 'witness acceptedProvenanceOverlay.path', [...expectedByPath.keys()], ov.path, 'unknown overlay path'); continue; }
    eq('witness-overlay-original', ov.path + ' original', want.original, ov.originalSha256);
    eq('witness-overlay-prior', ov.path + ' prior', want.prior, ov.priorAcceptedEffectiveSha256);
    eq('witness-overlay-effective', ov.path + ' effective', want.effective, ov.effectiveSha256);
    expectedByPath.delete(ov.path);
  }
  for (const p of expectedByPath.keys()) fail('witness-overlay-missing', 'witness acceptedProvenanceOverlay.path', p, 'missing', 'expected accepted overlay entry absent');
  for (const row of (wit.provenance?.sourceInputs ?? [])) { if (need(row.path)) eq('witness-source-input-sha', row.path, row.sha256, sha(row.path)); }
  for (const row of (wit.provenance?.harnessInputs ?? [])) { if (need(row.path)) eq('witness-harness-input-sha', row.path, row.sha256, sha(row.path)); }
  if (need('parity/card-runtime-witness/INPUT_SHA256.json')) {
    const wi = read('parity/card-runtime-witness/INPUT_SHA256.json');
    const wo = wi.acceptedProvenanceOverlay ?? [];
    eq('witness-input-overlay-count', 'witness INPUT acceptedProvenanceOverlay', 3, wo.length);
    if (!wi.frozenPins) fail('witness-input-frozen-pins', 'witness INPUT frozenPins', 'object', 'missing');
    else eq('witness-input-frozen-pins', 'witness INPUT frozenPins (deep-equal to FROZEN_PINS)', JSON.stringify(frozen), JSON.stringify(wi.frozenPins));
  }
}

const ok = failures.length === 0;
console.log(JSON.stringify({ ok, root, acceptedOverlays: accepted, failureCount: failures.length, failures }, null, 2));
process.exit(ok ? 0 : 1);

