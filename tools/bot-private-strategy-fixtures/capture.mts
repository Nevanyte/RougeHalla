// Unchanged-source private method witnesses. This is a declared component seam, not a World/Brain/live policy capture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Session} from 'node:inspector/promises';
import {ROOT, mapWire} from './runtime.mts';
import {MAP} from './builders.mts';
import {encode} from './codec.mts';
import {memoryCases} from './memory-cases.mts';
import {strategyCases} from './strategy-cases.mts';
import {dependencyCases} from './dependency-cases.mts';
import {runCase} from './runner.mts';
import {reachedChecks} from './checks.mts';
const [mode, output] = process.argv.slice(2);
assert.equal(process.argv.length, 4); assert(mode === '--write' || mode === '--check');
assert.equal(process.version, 'v22.23.4'); assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const pin = (p: string) => ({bytes: statSync(p).size, sha256: hash(readFileSync(p))});
const read = (p: string) => readFileSync(p, 'utf8');
const allSpecs = [...memoryCases(), ...strategyCases(), ...dependencyCases()];
const selectedIds = process.env.RH_BOT_STRATEGY_CASES?.split(',');
const specs = selectedIds ? allSpecs.filter((c) => selectedIds.includes(c.id)) : allSpecs;
if (selectedIds) assert.equal(specs.length, selectedIds.length, 'closed case selector');
const ids = specs.map((c) => c.id); assert.equal(new Set(ids).size, ids.length);
const inspector = new Session(); inspector.connect();
const loadedSourcePaths = new Set<string>();
inspector.on('Debugger.scriptParsed', (message: any) => {
  const path = message.params.url.replace(/^file:\/\//, '');
  if (path.startsWith(ROOT + '/packages/') && path.endsWith('.ts')) loadedSourcePaths.add(path.slice(ROOT.length + 1));
});
await inspector.post('Profiler.enable');
await inspector.post('Debugger.enable');
const transformedSources: any = {};
await inspector.post('Profiler.startPreciseCoverage', {callCount: true, detailed: true});
const targetNames = ['memory.ts', 'strategy.ts', 'huntAdapter.ts', 'buildRoute.ts', 'mobHunt.ts'];
const results: any[] = [], coverage: any[] = [];
for (const spec of specs) {
  const result = runCase(spec);
  // A second independent source instance must reproduce the entire chronological transcript.
  assert.deepEqual(runCase(spec), result, spec.id + ': source recreate determinism');
  results.push(result);
  const taken = await inspector.post('Profiler.takePreciseCoverage');
  const scripts: any[] = [];
  for (const s of taken.result) {
    if (!targetNames.some((n) => s.url.endsWith('/' + n))) continue;
    const scriptPath = s.url.replace(/^file:\/\//, '').replace(ROOT + '/', '');
    if (!transformedSources[scriptPath]) {
      const fetched = await inspector.post('Debugger.getScriptSource', {scriptId: s.scriptId});
      transformedSources[scriptPath] = {sha256: hash(fetched.scriptSource), text: fetched.scriptSource};
    }
    scripts.push({path: scriptPath, functions: s.functions.map((f) => ({name: f.functionName,
      isBlockCoverage: f.isBlockCoverage, ranges: f.ranges.map((r) => ({startOffset: r.startOffset, endOffset: r.endOffset, count: r.count}))}))});
  }
  coverage.push({id: spec.id, suite: spec.suite, declaredIntent: spec.covers, scripts: scripts.sort((a, b) => a.path.localeCompare(b.path))});
}
await inspector.post('Profiler.stopPreciseCoverage'); inspector.disconnect();
function field(v: any, k: string): any { return v?.entries?.find(([key]: any) => key === k)?.[1]; }
const chosen = new Set<string>(), candidates = new Set<string>();
for (const c of results) if (c.suite === 'strategy') for (const op of c.operations) if (op.method === 'decide') {
  const goal = field(op.result, 'goal'); chosen.add(field(goal, 'kind'));
  const list = field(op.state, 'candidates');
  for (const d of list.values) candidates.add(field(field(d, 'goal'), 'kind'));
}
if (process.env.RH_BOT_STRATEGY_MUTANT !== '1') assert.deepEqual([...chosen].sort(), ['idle', 'farm', 'hunt', 'fight', 'loot', 'flee', 'roam', 'hold', 'module'].sort(), 'all nine chosen goal families reached');
const toolDir = dirname(fileURLToPath(import.meta.url));
const sourcePins: any = {};
function walk(base: string, rel: string, accept: (p: string) => boolean): string[] {
  const entries: string[] = [];
  for (const e of readdirSync(join(base, rel), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(rel, e.name); if (e.isDirectory()) entries.push(...walk(base, p, accept)); else if (accept(p)) entries.push(p);
  }
  return entries;
}
// Conservative complete source trees avoid an incomplete dynamic-loader guess. These are source pins, not runtime import claims.
for (const p of [...walk(ROOT, 'packages/shared/src', (p) => p.endsWith('.ts')), ...walk(ROOT, 'packages/server/src/bots', (p) => p.endsWith('.ts'))]) sourcePins[p] = pin(join(ROOT, p));
const configs = ['package-lock.json', 'package.json', 'tsconfig.base.json', ...['shared', 'server', 'client'].flatMap((p) => ['packages/' + p + '/package.json', 'packages/' + p + '/tsconfig.json'])];
const profile = {sourceBase: '4151b3af597cc06d1b3b77f4e3e21cc9906b6a86',
  boundary: 'Declared chronological Memory and private strategy/hunter/route source-method inputs. Actual source classes. Not World/FrameRing/perception/full Brain/live publication.',
  image: 'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
  node: process.version, platform: process.platform, arch: process.arch,
  actualRuntimeImports: {method: 'Debugger.scriptParsed reports loaded TypeScript script URLs; erased type-only files excluded',
    files: Object.fromEntries([...loadedSourcePaths].sort().map((p) => [p, pin(join(ROOT, p))]))},
  sourceInventory: {method: 'conservative complete shared/src and server/src/bots TypeScript trees, not a runtime import closure claim', files: sourcePins, sha256: hash(JSON.stringify(sourcePins))},
  configFiles: Object.fromEntries(configs.map((p) => [p, pin(join(ROOT, p))])),
  dependencyVersions: Object.fromEntries(['tsx', 'typescript', 'esbuild'].map((p) => [p, JSON.parse(read(join(ROOT, 'node_modules', p, 'package.json'))).version])),
  toolFiles: Object.fromEntries(walk(toolDir, '', (p) => !p.endsWith('.log')).map((p) => ['tools/bot-private-strategy-fixtures/' + p, pin(join(toolDir, p))]))};
const sourceBody = {format: 'rh-bot-private-strategy-source/1', methodValue: 'rh-method-value/1', profile,
  maps: [{id: 'generated7', constructor: encode({seed: 7, attempt: undefined, decor: false}), mapHashU32: mapWire.mapHashU32(MAP), value: encode(MAP)}],
  cases: results};
const assertions = process.env.RH_BOT_STRATEGY_MUTANT === '1' ? [] : reachedChecks(results);
const coverageBody = {assertions, format: 'rh-bot-private-strategy-coverage/1',
  interpretation: 'V8 precise block counts over unchanged tsx-transformed source. Two independent runs per case; offsets refer to transformed script. Declared intents are not proof of individual branch closure.',
  sourceInventorySha256: profile.sourceInventory.sha256, chosenGoalFamilies: [...chosen].sort(), candidateGoalFamilies: [...candidates].sort(),
  transformedSources, cases: coverage};
for (const [name, body] of [['source.json', sourceBody], ['coverage.json', coverageBody]] as const) {
  const bytes = JSON.stringify(body) + '\n'; const path = join(output, name);
  if (mode === '--write') writeFileSync(path, bytes); else assert.equal(hash(read(path)), hash(bytes), name + ': exact source bytes');
  console.log(JSON.stringify({mode, file: name, bytes: Buffer.byteLength(bytes), sha256: hash(bytes), cases: specs.length, operations: results.reduce((n, c) => n + c.operations.length, 0)}));
}
