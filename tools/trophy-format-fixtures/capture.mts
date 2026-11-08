// Canonical actual-source P-TROPHY-NATIVE-CONSUMER-1 formatting corpus, captured in the pinned linux/amd64 Node 22.23.4
// container. EVIDENCE ONLY: every row calls the ACTUAL shared helpers (encodeKillAugment, parseKillAugment,
// killAugmentText, rollKillAugments); no arithmetic is copied. Exact decimal ties and the binary64 neighbours immediately
// above/below them are constructed by IEEE-754 bit manipulation and both the bits and the actual outputs are recorded.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {
  KILL_AUG_LABEL, KILL_AUG_OPTIONS, KILL_AUG_SECONDS, KILL_AUG_SHARE, KILL_STAT_KEYS,
  combatReadability, encodeKillAugment, killAugmentText, parseKillAugment, rollKillAugments,
} from '/repo/packages/shared/src/index.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string', 'closed capture arguments');
const [, outDir] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const sha = (v: Buffer | string): string => createHash('sha256').update(v).digest('hex');
const buffer = new ArrayBuffer(8);
const view = new DataView(buffer);
const bitsOf = (x: number): bigint => { view.setFloat64(0, x, false); return view.getBigUint64(0, false); };
const fromBits = (u: bigint): number => { view.setBigUint64(0, u, false); return view.getFloat64(0, false); };
const hex = (u: bigint): string => '0x' + u.toString(16).padStart(16, '0');
const neighbour = (x: number, delta: number): number => fromBits(bitsOf(x) + BigInt(delta));
assert.equal(fromBits(bitsOf(0.25)), 0.25, 'bit round-trip');

const FLAT = new Set(['ad', 'ap', 'armor', 'mr']);
const Pct = (key: string): boolean => !FLAT.has(key);

const textOf = (key: string, gain: number): any => {
  const parsed = parseKillAugment(encodeKillAugment(key as any, gain));
  return parsed ? killAugmentText(parsed) : null;
};

/** One raw value's actual outputs on one formatting path. */
const row = (key: string, raw: number, path: 'flat-1dp' | 'percentage-4dp' | 'percentage-text-1dp'): any => {
  const digits = path === 'percentage-4dp' ? 4 : 1;
  const fixed = path === 'percentage-text-1dp' ? (raw * 100).toFixed(1) : raw.toFixed(digits);
  const encoded = encodeKillAugment(key as any, raw);
  const parsed = parseKillAugment(encoded);
  return {
    raw, bits: hex(bitsOf(raw)), fixed, encoded, parsed,
    text: parsed ? killAugmentText(parsed) : null,
  };
};

/** A tie and its immediate binary64 neighbours (positive values, so +1/-1 bit steps are nextUp/nextDown). */
const tie = (key: string, value: number, path: 'flat-1dp' | 'percentage-4dp' | 'percentage-text-1dp'): any => {
  const prev = neighbour(value, -1);
  const next = neighbour(value, 1);
  assert.equal(fromBits(bitsOf(prev) + 1n), value, 'prev is the immediate neighbour');
  assert.equal(fromBits(bitsOf(next) - 1n), value, 'next is the immediate neighbour');
  return {
    kind: path,
    key,
    tie: value,
    tieBits: hex(bitsOf(value)),
    rows: {
      prev: row(key, prev, path),
      at: row(key, value, path),
      next: row(key, next, path),
    },
  };
};

// Exact decimal ties for each path. A 1-decimal tie is m/4 with m odd (exact in binary); a 4-decimal tie is q/32 with q
// odd (exact in binary); a percentage-text 1-decimal tie for gain*100 is q/16 (exact in binary).
const flatKeys = KILL_STAT_KEYS.filter((k: string) => FLAT.has(k));
const pctKeys = KILL_STAT_KEYS.filter((k: string) => Pct(k));
const flatTies = [0.25, 3.25];
const encodeTies = [1 / 32, 5 / 32];
const textTies = [1 / 16, 19 / 16];
assert.equal(0.25.toFixed(1), '0.3', '0.25 is a 1dp tie');
assert.equal((1 / 32).toFixed(4), '0.0313', '1/32 is a 4dp tie');
assert.equal((0.0625 * 100).toFixed(1), '6.3', '1/16 is a percentage-text tie');

const ties: any[] = [];
for (const key of flatKeys) for (const v of flatTies) ties.push(tie(key, v, 'flat-1dp'));
for (const key of pctKeys) for (const v of encodeTies) ties.push(tie(key, v, 'percentage-4dp'));
for (const key of pctKeys) for (const v of textTies) ties.push(tie(key, v, 'percentage-text-1dp'));

const keys = KILL_STAT_KEYS.map((key: string) => {
  const raw = FLAT.has(key) ? 3.14 : 0.123456;
  return {key, raw, path: FLAT.has(key) ? 'flat-1dp' : 'percentage-4dp', ...row(key, raw, FLAT.has(key) ? 'flat-1dp' : 'percentage-4dp')};
});

const tinyRaws = [0.00004, 0.00005, neighbour(0.00005, -1), neighbour(0.00005, 1), 0.04];
const tiny = KILL_STAT_KEYS.map((key: string) => ({
  key,
  rows: tinyRaws.map((raw: number) => row(key, raw, FLAT.has(key) ? 'flat-1dp' : 'percentage-4dp')),
}));

const refusalIds = [
  '', 'kill:', 'kill:nope:1', 'kill:ad', 'kill:ad:', 'kill:ad:-1', 'kill:ad:0', 'kill:ad:NaN',
  'kill:ad:Infinity', 'kill:damage:1e999', 'nope:ad:1', 'kill:ad:1e-324', 'kill:ad:5e-324',
  'kill:ad:6.0:junk', 'kill:ad:+1', 'kill:ad:0.0', 'kill:damage:0.0000',
  encodeKillAugment('ad', 0.00004), encodeKillAugment('damage', 0.00004),
];
const refusals = refusalIds.map((id: string) => ({id, parsed: parseKillAugment(id)}));

const ZERO_MIRRORS = {asMult: 1000, windupMult: 1000, speedMult: 1000, armorBonus: 0, shieldBonus: 0, adBonus: 0, apBonus: 0};
const fighter = (over: any = {}): any => ({
  faction: 'holy', weapon0: 'sword', weapon1: '', slot: 0, hp: 800, maxHp: 1145,
  build: over.build ?? {}, mobStats: new Map(Object.entries(over.mobStats ?? {})), campClears: 0,
  extra: {
    killStats: new Map(Object.entries(over.extra?.killStats ?? {})),
    chestBoosts: new Map(Object.entries(over.extra?.chestBoosts ?? {})),
  },
  asMult: over.asMult ?? ZERO_MIRRORS.asMult, windupMult: over.windupMult ?? ZERO_MIRRORS.windupMult,
  speedMult: over.speedMult ?? ZERO_MIRRORS.speedMult, armorBonus: over.armorBonus ?? 0,
  shieldBonus: over.shieldBonus ?? 0, adBonus: over.adBonus ?? 0, apBonus: over.apBonus ?? 0,
});
const rollSpecs = [
  {name: 'flat-tie-order', spec: {adBonus: 240, armorBonus: 300}},
  {name: 'tiny-scores-filtered', spec: {adBonus: 0.1, apBonus: 0.1}},
  {name: 'percentage-rounding', spec: {extra: {killStats: {damage: 0.0001, lifesteal: 0.0025}, chestBoosts: {}}}},
];
const rolls = rollSpecs.map((c: any) => {
  const f = fighter(c.spec);
  const options = rollKillAugments(f);
  return {
    name: c.name, spec: c.spec,
    readability: combatReadability(f, {lasting: true}).investedStats,
    options,
    parsed: options.map((id: string) => parseKillAugment(id)),
    text: options.map((id: string) => { const a = parseKillAugment(id); return a ? killAugmentText(a) : null; }),
  };
});

const CONFIG = {
  keys: KILL_STAT_KEYS,
  flatKeys,
  percentageKeys: pctKeys,
  flatTies,
  encodeTies,
  textTies,
  tinyRaws,
  refusalIds,
  paths: ['flat-1dp', 'percentage-4dp', 'percentage-text-1dp'],
  neighbourRule: 'IEEE-754 binary64 nextUp/nextDown via DataView BigUint64 bits',
};

function closure(entries: string[]): string[] {
  const seen = new Set<string>();
  const walk = (p: string): void => {
    if (seen.has(p)) return;
    seen.add(p);
    const text = readFileSync('/repo/' + p, 'utf8');
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      let q = resolve(dirname('/repo/' + p), spec).replace('/repo/', '');
      if (!q.endsWith('.ts')) q += '.ts';
      if (existsSync('/repo/' + q)) walk(q);
    }
  };
  entries.forEach(walk);
  return [...seen].sort();
}
const closureFiles = closure(['packages/shared/src/index.ts']);
const sourceSha256 = Object.fromEntries(closureFiles.map((p: string) => [p, sha(readFileSync('/repo/' + p))]));
const sourceClosureSha256 = sha(closureFiles.map((p: string) => p + '\0' + sourceSha256[p]).join('\n'));

const provenance = {
  image: 'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
  platform: 'linux/amd64',
  node: process.version,
  tools: {
    captureMts: sha(readFileSync('/repo/tools/trophy-format-fixtures/capture.mts')),
    captureSh: sha(readFileSync('/repo/tools/trophy-format-fixtures/capture.sh')),
    packageLock: sha(readFileSync('/repo/package-lock.json')),
    packageJson: sha(readFileSync('/repo/package.json')),
    tsconfigBase: sha(readFileSync('/repo/tsconfig.base.json')),
  },
  sourceClosure: {
    entry: 'packages/shared/src/index.ts',
    files: closureFiles,
    sha256: sourceSha256,
    digest: sourceClosureSha256,
  },
  config: CONFIG,
  configSha256: sha(JSON.stringify(CONFIG)),
};

const body = {
  format: 'rh-trophy-format-source/1',
  evidence: 'actual shared-helper outputs for declared formatting inputs; NOT runtime lifecycle state',
  provenance,
  cases: {keys, ties, tiny, refusals, rolls},
};
const captureSha256 = sha(JSON.stringify(body) + '\n');
const text = JSON.stringify({...body, captureSha256}) + '\n';

if (args[0] === '--write') {
  mkdirSync(outDir, {recursive: true});
  writeFileSync(join(outDir, 'format.json'), text);
  console.log(JSON.stringify({written: outDir, bytes: text.length, sha256: sha(text), captureSha256, ties: ties.length, keys: keys.length, tiny: tiny.length, refusals: refusals.length, rolls: rolls.length}));
} else {
  const existing = readFileSync(join(outDir, 'format.json'), 'utf8');
  assert.equal(text, existing, '--check requires identical bytes');
  const parsed = JSON.parse(existing);
  assert.equal(parsed.captureSha256, captureSha256, 'captureSha256 covers the canonical body');
  console.log(JSON.stringify({checked: outDir, bytes: text.length, sha256: sha(text), captureSha256, ties: ties.length, keys: keys.length, tiny: tiny.length, refusals: refusals.length, rolls: rolls.length}));
}
