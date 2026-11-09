// Host-only preparation for the bot-vision witness. It READS files and hashes them; it never imports,
// evaluates, transforms or compiles a source module, spawns no process and touches no network.
//   node tools/bot-vision-fixtures/prepare.mjs --repo <abs> --declared-out <abs, new file>
//   node tools/bot-vision-fixtures/prepare.mjs --repo <abs> --code-sha <40 hex> --manifest-out <abs, new file>
// Both outputs are written exclusively (refusing an existing path). Root verifies the code SHA with Git.
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { ENTRY, PACKAGE_ENTRIES, scan, sha256 } from './closure.mjs';
import { CODEC, encode } from './codec.mjs';
import { cases, SCENARIO_FORMAT } from './scenario.mjs';
import { RAW_FORMAT } from './verify.mjs';

const MAP = 'crates/rh-sim/src/mapdata/fixtures/seed1.map.json';
const TOOLS = ['closure.mjs', 'codec.mjs', 'prepare.mjs', 'runtime.mjs', 'scenario.mjs', 'verify.mjs'].map((f) => `tools/bot-vision-fixtures/${f}`);
const SCOPES = ['packages/server/package.json', 'packages/shared/package.json'];
const fail = (why) => { throw new Error(`bot-vision prepare refused: ${why}`); };

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--repo', '--code-sha', '--manifest-out', '--declared-out'].includes(argv[i]) || Object.hasOwn(out, argv[i]) || argv[i + 1] === undefined) fail(`argument ${argv[i]}`);
    out[argv[i]] = argv[i + 1];
  }
  for (const [k, v] of Object.entries(out)) if (k !== '--code-sha' && !isAbsolute(v)) fail(`${k} must be absolute`);
  if (!out['--repo'] || !!out['--declared-out'] === !!out['--manifest-out']) fail('exactly one of --declared-out / --manifest-out with --repo');
  if (out['--manifest-out'] && !/^[0-9a-f]{40}$/.test(out['--code-sha'] ?? '')) fail('--code-sha must be 40 hex');
  return out;
}

function writeExclusive(path, text) {
  const fd = openSync(path, 'wx', 0o644);
  try { writeSync(fd, text); } finally { closeSync(fd); }
}

const pin = (repo, path) => { const b = readFileSync(join(repo, path)); return { path, bytes: b.length, sha256: sha256(b) }; };

const a = args(process.argv.slice(2));
const repo = resolve(a['--repo']);
const declared = JSON.stringify(encode(cases()));
if (a['--declared-out']) {
  writeExclusive(a['--declared-out'], declared);
  process.stdout.write(`declared inputs ${sha256(declared)} (${Buffer.byteLength(declared)} bytes)\n`);
} else {
  const closure = scan(repo);
  if (closure.problems.length) fail(`closure problems:\n${closure.problems.join('\n')}`);
  const server = closure.files.map((f) => f.path).filter((p) => !p.startsWith('packages/shared/src/'));
  if (JSON.stringify(server) !== JSON.stringify([ENTRY])) fail(`closure leaves packages/shared/src: ${server.join(', ')}`);
  const doc = JSON.parse(readFileSync(join(repo, MAP), 'utf8'));
  const manifest = {
    format: 'rh-bot-vision-manifest/1',
    status: 'PREPARED, UNRUN: Root must review the literal command before the first capture',
    codeSha: a['--code-sha'],
    scenarioFormat: SCENARIO_FORMAT, codec: CODEC, rawFormat: RAW_FORMAT,
    declaredInputsSha256: sha256(declared),
    declaredInputsBytes: Buffer.byteLength(declared),
    closure: {
      entry: ENTRY,
      packageEntries: PACKAGE_ENTRIES,
      externalPackages: [],
      note: 'static scan from the entry; type-only imports are erased by Node type stripping and are not edges',
      files: closure.files, edges: closure.edges,
      totalBytes: closure.files.reduce((n, f) => n + f.bytes, 0),
    },
    scopes: SCOPES.map((p) => pin(repo, p)),
    tools: TOOLS.map((p) => pin(repo, p)),
    map: { ...pin(repo, MAP), legacyMapHashU32: doc.legacyMapHashU32, seed: doc.map.seed, w: doc.map.w, h: doc.map.h },
    runtime: {
      nodeVersion: process.version, platform: process.platform, arch: process.arch, amaro: process.versions.amaro,
      nodeSha256: sha256(readFileSync(process.execPath)), execPath: process.execPath,
      requiredFlags: ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', '--max-old-space-size=1024', '--permission'],
    },
  };
  writeExclusive(a['--manifest-out'], `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`manifest written: ${closure.files.length} closure files, ${manifest.closure.totalBytes} bytes\n`);
}
