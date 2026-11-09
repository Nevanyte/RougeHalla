// Bot-vision actual-source capture runtime. NOT YET RUN: Root must review the literal command in
// docs/evidence/bot-vision/CAPTURE-REQUEST.md before the first execution.
//
// One run: verify every pin, import the UNMODIFIED source BotVision through an allowlist module
// hook that hash-checks every loaded byte, drive the declared cases, write the raw observations
// exclusively, then (only then) verify the saved raw bytes and write a separate verdict.
// No compiler, bundler, package resolution, child process, worker, network or install is used:
// TypeScript is executed by the pinned Node's own --experimental-transform-types.
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CODEC, encode } from './codec.mjs';
import { cases, SCENARIO_FORMAT } from './scenario.mjs';
import { verify, RAW_FORMAT } from './verify.mjs';

const MAX_RAW_BYTES = 64 * 1024 * 1024;
const REQUIRED_FLAGS = ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', '--max-old-space-size=1024', '--permission'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (why) => { throw new Error(`bot-vision runtime refused: ${why}`); };

function args(argv) {
  const want = ['--root', '--manifest-sha256', '--output'];
  const out = {};
  if (argv.length !== want.length * 2) fail(`expected exactly ${want.join(' ')}`);
  for (let i = 0; i < argv.length; i += 2) {
    if (!want.includes(argv[i]) || Object.hasOwn(out, argv[i])) fail(`unexpected argument ${argv[i]}`);
    out[argv[i]] = argv[i + 1];
  }
  for (const key of ['--root', '--output']) if (!isAbsolute(out[key])) fail(`${key} must be absolute`);
  if (!/^[0-9a-f]{64}$/.test(out['--manifest-sha256'])) fail('--manifest-sha256 must be 64 hex');
  return { root: resolve(out['--root']), manifestSha: out['--manifest-sha256'], output: resolve(out['--output']) };
}

function checkProcess(manifest, root, output) {
  if (process.env.NODE_OPTIONS !== undefined) fail('NODE_OPTIONS is set');
  if (process.version !== manifest.runtime.nodeVersion) fail(`node ${process.version} != ${manifest.runtime.nodeVersion}`);
  if (process.platform !== manifest.runtime.platform || process.arch !== manifest.runtime.arch) fail('platform/arch differ');
  if (process.versions.amaro !== manifest.runtime.amaro) fail('amaro differs');
  if (sha256(readFileSync(process.execPath)) !== manifest.runtime.nodeSha256) fail('node binary hash differs');
  // Exactly: read the readonly export root and the node binary (to hash it); write only the fresh run parent.
  const reviewed = [`--allow-fs-read=${root}`, `--allow-fs-read=${process.execPath}`, `--allow-fs-write=${resolve(output, '..')}`];
  const got = [...process.execArgv].sort();
  const want = [...REQUIRED_FLAGS, ...reviewed].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`execArgv ${JSON.stringify(process.execArgv)} != reviewed ${JSON.stringify(want)}`);
  if (!process.permission?.has('fs.read', join(root, manifest.closure.entry))) fail('permission model inactive');
  if (process.permission.has('child')) fail('child processes permitted');
  if (process.permission.has('worker')) fail('workers permitted');
}

function checkFiles(manifest, root) {
  const all = [...manifest.closure.files, ...manifest.tools, ...manifest.scopes, manifest.map];
  for (const f of all) {
    const bytes = readFileSync(join(root, f.path));
    if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256) fail(`${f.path} differs from the manifest`);
  }
  const self = fileURLToPath(import.meta.url);
  if (resolve(self) !== resolve(root, 'tools/bot-vision-fixtures/runtime.mjs')) fail('runtime is not the reviewed export copy');
}

/** Allowlist resolution from the reviewed static edges; every load is hash-checked again. */
function installHooks(manifest, root) {
  const url = (rel) => pathToFileURL(join(root, rel)).href;
  const files = new Map(manifest.closure.files.map((f) => [url(f.path), f]));
  const edges = new Map(manifest.closure.edges.map((e) => [`${url(e.from)}\n${e.spec}`, url(e.to)]));
  const entry = url(manifest.closure.entry);
  const loaded = [];
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === entry && context.parentURL === import.meta.url) return { url: entry, shortCircuit: true, format: 'module-typescript' };
      const to = edges.get(`${context.parentURL}\n${specifier}`);
      if (!to) fail(`unreviewed import ${JSON.stringify(specifier)} from ${context.parentURL}`);
      return { url: to, shortCircuit: true, format: 'module-typescript' };
    },
    load(href, context, next) {
      const pin = files.get(href);
      if (!pin) fail(`unreviewed load ${href}`);
      const result = next(href, { ...context, format: 'module-typescript' });
      const bytes = Buffer.from(result.source);
      if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) fail(`${pin.path}: loaded bytes differ`);
      loaded.push(pin.path);
      return { ...result, format: 'module-typescript', shortCircuit: true };
    },
  });
  return { entry, loaded };
}

/** GameMap from the captured rh-map/2 export: the five Uint8Array grids restored, nothing else changed. */
function gameMap(manifest, root) {
  const doc = JSON.parse(readFileSync(join(root, manifest.map.path), 'utf8'));
  if (doc.format !== 'rh-map/2' || doc.legacyMapHashU32 !== manifest.map.legacyMapHashU32) fail('map document');
  const map = { ...doc.map };
  for (const key of ['tiles', 'terrain', 'regionGrid', 'territoryGrid', 'featureGrid']) map[key] = Uint8Array.from(map[key]);
  return map;
}

// ------------------------------------------------------------------- actual private diagnostic read
// A read of the actual instance AFTER the call (TypeScript `private` is not a runtime boundary). It
// is recorded for comparison only and is never an input to the source or to the native component.
function diagnostic(vision) {
  const identity = (m) => (m === null ? null : m === vision.map ? 'open' : m === vision.locked ? 'locked' : 'other');
  const grid = (memory) => {
    const cells = [];
    memory.expiresAt.forEach((e, i) => { if (!Object.is(e, 0)) cells.push([i, e]); });
    return {
      cells, lastMap: identity(memory.lastMap), lastUpdate: memory.lastUpdate, lastRadius: memory.lastRadius,
      lastTtl: memory.lastTtl, lastX: memory.lastX, lastY: memory.lastY, visibleCount: memory.visibleCount,
    };
  };
  return encode({
    enabled: vision.enabled, now: vision.now, memory: grid(vision.memory),
    wards: [...vision.wards].map(([index, w]) => ({ index, end: w.end, map: identity(w.map), memory: grid(w.memory) })),
    bushReveal: [...vision.bushReveal],
  });
}

/** Every point BotVision.filter hands canSee, in filter order, with the actual canSee answer. */
function filterProbes(vision, p) {
  const out = [];
  const add = (family, i, point) => {
    let seen;
    try { seen = vision.canSee(point); } catch (error) { seen = { threw: String(error?.name) }; }
    out.push({ family, i, point: encode(point), seen });
  };
  const each = (family, rows) => Array.isArray(rows) && rows.forEach((r, i) => add(family, i, r));
  each('fighter', p.fighters); each('mob', p.mobs); each('container', p.containers); each('projectile', p.projectiles);
  each('minimapMob', p.minimap?.mobs);
  if (Array.isArray(p.events)) p.events.forEach((e, i) => { if (e?.at !== null) add('eventAt', i, e?.at); });
  if (Array.isArray(p.extras?.fields)) p.extras.fields.forEach((f, i) => { add('field', i, f); add('fieldEnd', i, { x: f.x2, y: f.y2 }); });
  each('chest', p.extras?.chests);
  return out;
}

function drive(BotVision, map) {
  const out = [];
  for (const declared of cases()) {
    const vision = new BotVision(map);
    const steps = [];
    for (const step of declared.steps) {
      const record = { op: step.op };
      try {
        if (step.op === 'update') {
          record.input = encode(step.input);
          record.selfId = step.selfId;
          const returned = vision.update(step.input, step.selfId);
          record.returned = encode(returned);
          record.inputUnchanged = JSON.stringify(encode(step.input)) === JSON.stringify(record.input);
          record.diagnostic = diagnostic(vision);
        } else if (step.op === 'canSee') {
          record.points = encode(step.points);
          record.results = step.points.map((p) => vision.canSee(p));
        } else if (step.op === 'filter') {
          record.input = encode(step.percept);
          const before = JSON.stringify(diagnostic(vision));
          record.probes = filterProbes(vision, step.percept);
          const output = vision.filter(step.percept);
          record.sameObject = output === step.percept;
          record.output = encode(output);
          record.inputUnchanged = JSON.stringify(encode(step.percept)) === JSON.stringify(record.input);
          record.stateUnchanged = JSON.stringify(diagnostic(vision)) === before;
        } else fail(`unknown op ${step.op}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('bot-vision runtime refused')) throw error;
        record.threw = { name: String(error?.name), message: String(error?.message) };
        steps.push(record);
        break; // a throwing source step ends its case: partial state is never reused
      }
      steps.push(record);
    }
    out.push({ id: declared.id, purpose: declared.purpose, steps });
  }
  return out;
}

function writeExclusive(path, text) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > MAX_RAW_BYTES) fail(`${path}: ${bytes.length} bytes exceeds the bound`);
  const fd = openSync(path, 'wx', 0o600);
  try { writeSync(fd, bytes); } finally { closeSync(fd); }
  return bytes;
}

async function main() {
  const { root, manifestSha, output } = args(process.argv.slice(2));
  const manifestPath = join(root, 'docs/evidence/bot-vision/prepared/MANIFEST.json');
  const manifestBytes = readFileSync(manifestPath);
  if (sha256(manifestBytes) !== manifestSha) fail('manifest hash differs from the Root-supplied pin');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.scenarioFormat !== SCENARIO_FORMAT || manifest.codec !== CODEC || manifest.rawFormat !== RAW_FORMAT) fail('format pins');
  checkProcess(manifest, root, output);
  checkFiles(manifest, root);
  const declared = JSON.stringify(encode(cases()));
  if (sha256(declared) !== manifest.declaredInputsSha256) fail('declared inputs differ from the manifest');
  mkdirSync(output, { mode: 0o700 }); // must not exist: a fresh run directory only
  const hooks = installHooks(manifest, root);
  const { BotVision } = await import(hooks.entry);
  if (typeof BotVision !== 'function') fail('BotVision export');
  const loaded = [...hooks.loaded].sort();
  const pinned = manifest.closure.files.map((f) => f.path).sort();
  if (JSON.stringify(loaded) !== JSON.stringify(pinned)) fail(`loaded closure ${loaded.length} != manifest ${pinned.length}`);
  const raw = {
    format: RAW_FORMAT, codec: CODEC, scenarioFormat: SCENARIO_FORMAT, manifestSha256: manifestSha,
    codeSha: manifest.codeSha, context: 'declared method context: actual unmodified source BotVision; no World, perceive or compose',
    runtime: { node: process.version, platform: process.platform, arch: process.arch, amaro: process.versions.amaro, execArgv: process.execArgv },
    map: { path: manifest.map.path, sha256: manifest.map.sha256, legacyMapHashU32: manifest.map.legacyMapHashU32 },
    loaded,
    cases: drive(BotVision, gameMap(manifest, root)),
  };
  const rawPath = join(output, 'raw-observations.json');
  writeExclusive(rawPath, `${JSON.stringify(raw)}\n`);
  // Raw is on disk before any verdict: the verifier reads the saved bytes, not the in-memory value.
  const saved = readFileSync(rawPath);
  const verdict = verify(JSON.parse(saved.toString('utf8')), { manifestSha, declared: JSON.parse(declared) });
  writeExclusive(join(output, 'verdict.json'), `${JSON.stringify({ rawSha256: sha256(saved), rawBytes: saved.length, ...verdict }, null, 1)}\n`);
  process.stdout.write(`bot-vision raw ${sha256(saved)} (${saved.length} bytes): ${verdict.status}\n`);
  if (verdict.status !== 'PASS') process.exitCode = 1;
}

await main();
