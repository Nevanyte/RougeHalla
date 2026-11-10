#!/usr/bin/env node
// Build-size tracking for the Unity Web player: raw, gzip and brotli size of every file under Build/Web, and the total
// against the first-load budget (docs/prompts/UNITY_REWORK_FABLE.md section 4: about 150 MB compressed).
//
//   node build-size.cjs [--dir <Build/Web>] [--out <json>] [--budget-mb 150] [--brotli-quality 11] [--label <text>]
//
// Exit codes: 0 within budget, 1 over budget, 2 usage or missing build. The budget is judged on the larger of the
// gzip and brotli totals (the worst case a host can serve). Files that are already compressed (.br, .gz, .unityweb) are
// counted at their stored size for both columns.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const MB = 1024 * 1024;
const PRECOMPRESSED = new Set(['.br', '.gz', '.unityweb']);

function parseArgs(argv) {
  const root = path.resolve(__dirname, '../../..');
  const o = { dir: path.join(__dirname, '..', 'Build', 'Web'), out: path.join(root, 'docs/rework/evidence/build-size.json'),
    budgetMb: 150, brotliQuality: 11, label: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--dir') o.dir = path.resolve(next());
    else if (a === '--out') o.out = path.resolve(next());
    else if (a === '--budget-mb') o.budgetMb = Number(next());
    else if (a === '--brotli-quality') o.brotliQuality = Number(next());
    else if (a === '--label') o.label = next();
    else throw new Error(`unknown argument ${a}`);
  }
  if (!(o.budgetMb > 0)) throw new Error('--budget-mb must be positive');
  if (!Number.isInteger(o.brotliQuality) || o.brotliQuality < 0 || o.brotliQuality > 11) throw new Error('--brotli-quality must be an integer 0..11');
  return o;
}

function* walk(dir, base = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full, base);
    else if (e.isFile()) yield { full, rel: path.relative(base, full).split(path.sep).join('/') };
  }
}

function measureFile(buffer, name, brotliQuality) {
  const raw = buffer.length;
  if (PRECOMPRESSED.has(path.extname(name).toLowerCase())) return { raw, gzip: raw, brotli: raw, precompressed: true };
  return {
    raw,
    gzip: zlib.gzipSync(buffer, { level: 9 }).length,
    brotli: zlib.brotliCompressSync(buffer, { params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw,
      [zlib.constants.BROTLI_PARAM_LGWIN]: 24 } }).length,
    precompressed: false,
  };
}

function summarise(files, budgetMb) {
  const totals = files.reduce((t, f) => ({ raw: t.raw + f.raw, gzip: t.gzip + f.gzip, brotli: t.brotli + f.brotli }),
    { raw: 0, gzip: 0, brotli: 0 });
  const budgetBytes = Math.round(budgetMb * MB);
  const judged = Math.max(totals.gzip, totals.brotli);
  return { totals, budgetBytes, judgedBytes: judged, overBudget: judged > budgetBytes, headroomBytes: budgetBytes - judged };
}

const mb = n => (n / MB).toFixed(2);

function run(opts) {
  if (!fs.existsSync(opts.dir) || !fs.statSync(opts.dir).isDirectory()) throw Object.assign(new Error(`no build directory at ${opts.dir}`), { exitCode: 2 });
  const files = [];
  for (const f of walk(opts.dir)) files.push({ path: f.rel, ...measureFile(fs.readFileSync(f.full), f.rel, opts.brotliQuality) });
  if (!files.length) throw Object.assign(new Error(`${opts.dir} is empty`), { exitCode: 2 });
  const summary = summarise(files, opts.budgetMb);
  const report = { generatedAt: new Date().toISOString(), label: opts.label, dir: path.relative(path.resolve(__dirname, '../../..'), opts.dir),
    budgetMb: opts.budgetMb, brotliQuality: opts.brotliQuality, judgedOn: 'larger of gzip and brotli totals',
    fileCount: files.length, ...summary,
    files: files.slice().sort((a, b) => b.raw - a.raw) };
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
  return report;
}

function print(report) {
  const w = Math.min(60, Math.max(...report.files.map(f => f.path.length)));
  console.log(`${'file'.padEnd(w)}  ${'raw MB'.padStart(9)} ${'gzip MB'.padStart(9)} ${'brotli MB'.padStart(10)}`);
  for (const f of report.files.slice(0, 25)) console.log(`${f.path.slice(-w).padEnd(w)}  ${mb(f.raw).padStart(9)} ${mb(f.gzip).padStart(9)} ${mb(f.brotli).padStart(10)}${f.precompressed ? '  (precompressed)' : ''}`);
  if (report.files.length > 25) console.log(`... ${report.files.length - 25} smaller files in the JSON`);
  console.log(`${'TOTAL'.padEnd(w)}  ${mb(report.totals.raw).padStart(9)} ${mb(report.totals.gzip).padStart(9)} ${mb(report.totals.brotli).padStart(10)}`);
  console.log(`${report.overBudget ? 'OVER BUDGET' : 'WITHIN BUDGET'}: ${mb(report.judgedBytes)} MB compressed (worst of gzip/brotli) vs ${report.budgetMb} MB; headroom ${mb(report.headroomBytes)} MB`);
}

module.exports = { parseArgs, measureFile, summarise, walk };

if (require.main === module) {
  try {
    const report = run(parseArgs(process.argv.slice(2)));
    print(report);
    process.exitCode = report.overBudget ? 1 : 0;
  } catch (e) {
    console.error(e.message);
    process.exitCode = e.exitCode || 2;
  }
}
