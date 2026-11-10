'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, measureFile, summarise, walk } = require('./build-size.cjs');

test('parseArgs defaults and overrides', () => {
  const d = parseArgs([]);
  assert.equal(d.budgetMb, 150); assert.equal(d.brotliQuality, 11);
  const o = parseArgs(['--budget-mb', '10', '--brotli-quality', '5', '--label', 'x', '--out', '/tmp/a.json']);
  assert.equal(o.budgetMb, 10); assert.equal(o.brotliQuality, 5); assert.equal(o.label, 'x'); assert.equal(o.out, '/tmp/a.json');
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
  assert.throws(() => parseArgs(['--budget-mb']), /needs a value/);
  assert.throws(() => parseArgs(['--budget-mb', '0']), /positive/);
  assert.throws(() => parseArgs(['--brotli-quality', '12']), /0\.\.11/);
});

test('measureFile compresses text and leaves precompressed files alone', () => {
  const text = Buffer.from('abc'.repeat(10000));
  const m = measureFile(text, 'a.js', 5);
  assert.equal(m.raw, 30000); assert.ok(m.gzip < 1000); assert.ok(m.brotli < 1000); assert.equal(m.precompressed, false);
  const p = measureFile(Buffer.alloc(500, 1), 'game.wasm.br', 5);
  assert.deepEqual([p.raw, p.gzip, p.brotli, p.precompressed], [500, 500, 500, true]);
});

test('summarise judges the budget on the larger compressed total', () => {
  const MB = 1024 * 1024;
  const files = [{ raw: 100 * MB, gzip: 60 * MB, brotli: 50 * MB }, { raw: 90 * MB, gzip: 70 * MB, brotli: 55 * MB }];
  const s = summarise(files, 150);
  assert.equal(s.totals.gzip, 130 * MB); assert.equal(s.judgedBytes, 130 * MB); assert.equal(s.overBudget, false);
  assert.equal(s.headroomBytes, 20 * MB);
  assert.equal(summarise(files, 120).overBudget, true);
  assert.equal(summarise(files, 130).overBudget, false, 'exactly at budget passes');
});

test('walk lists nested files with forward-slash relative paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-'));
  try {
    fs.mkdirSync(path.join(dir, 'Build')); fs.writeFileSync(path.join(dir, 'Build', 'x.js'), 'x'); fs.writeFileSync(path.join(dir, 'index.html'), 'y');
    assert.deepEqual([...walk(dir)].map(f => f.rel), ['Build/x.js', 'index.html']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
