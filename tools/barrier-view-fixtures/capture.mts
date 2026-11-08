// Canonical actual-source witness capture for P-BARRIER-VIEW-WITNESS-1, pinned linux/amd64 Node 22.23.4.
//
// Evidence only: no production, schema, protocol, observation, policy or client code is changed here. Every recorded
// value is the unmodified source's actual return value; no expected value is hand-written into a corpus.
//
// Six corpora (byte-checked with --check):
//   continuous-bars.json  actual hpBarFractions / barrierStrength / hpDisplayValue / hpText over declared inputs, plus a
//                         separately labelled numeric-domain diagnostics block (NaN, infinities, negatives, overflow).
//   owner-fighter.json    actual perceive(): selfView.barrier = f32(barrier), and a visible fighter's barrierFrac =
//                         barShare(hpBarFractions(f32(hp), f32(maxHp), f32(barrier)).barrier), over f32 boundary values.
//   schema-f32.json       the real PlayerState class and the actual @colyseus/schema Encoder.encodeAll / Decoder.decode:
//                         barrier values including signed zero, subnormal, f32 boundaries, 1e39, NaN and infinities.
//   human-ring.json       the actual PlayerView.prototype.setBarrier method called on declared recorder objects
//                         ({barrierStep, barrierRing}); records the eight-step mapping, cache skips, clears and draw calls.
//                         The human ring's actual input is barrierStrength(schema-decoded f32 barrier, ORIGINAL f64 maxHp):
//                         maxHp is not Math.fround-ed there (fighterSeen, by contrast, frounds hp/maxHp/barrier).
//   npc-forms.json        actual perceive() over declared mob/dummy/elite/quest/zombie rows, including a stray declared
//                         barrier property that must not become an NPC fact.
//   visibility.json       the same owner/fighter barrier witness for visible, EFFECT_HIDDEN, out-of-frame and
//                         canSee=false controls, plus the owner-continuous / bot-twentieths / ring distinctness matrix.
//
// Declared probes: all inputs are declared source-schema StateLike rows or declared numbers. The human ring uses an ESM
// loader that maps "phaser" and "*.css" to empty modules (see stub-loader.mjs); PlayerView is not constructed and no
// scene, DOM or renderer lifecycle runs. The recorder's graphics object only records the method's own calls.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const IMAGE = "node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const FORMAT = "rh-barrier-view-witness/1";
const OUTPUTS = [
  "continuous-bars.json",
  "owner-fighter.json",
  "schema-f32.json",
  "human-ring.json",
  "npc-forms.json",
  "visibility.json",
];

const args = process.argv.slice(2);
assert(args.length >= 2, "usage: capture.mts (--write|--check) <outDir> [--repo <root>]");
const mode = args[0];
assert(mode === "--write" || mode === "--check", "mode must be --write or --check");
const outDir = resolve(args[1]);
let repoRoot = "/repo";
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--repo") {
    assert(typeof args[i + 1] === "string", "--repo needs a path");
    repoRoot = resolve(args[++i]);
  } else assert.fail("unknown argument " + args[i]);
}

assert.equal(process.version, "v22.23.4", "this corpus is captured under Node v22.23.4");
assert.equal(process.platform, "linux", "this corpus is captured under linux");
assert.equal(process.arch, "x64", "this corpus is captured under x64");

// Canonical captures assert the witnesses they expect. Mutant runs recapture deliberately changed source, so they set
// RH_BARRIER_VIEW_RECORD=1: expectations are recorded as booleans and the separate semantic comparator is the check.
const RECORD_MODE = process.env.RH_BARRIER_VIEW_RECORD === "1";
const expectSource = (condition: unknown, message: string): void => { if (!RECORD_MODE) assert(condition, message); };

const repo = (p: string): string => join(repoRoot, p);
const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
const shaFile = (p: string): string => sha256(readFileSync(repo(p)));
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------------------------------- tagged numbers
// JSON cannot distinguish +0 from -0 and writes NaN/Infinity as null. Every declared input and every actual output number
// is therefore tagged: NaN and infinities have no JSON number, a zero carries its sign tag, and finite values carry both
// their f64 and f32 bit patterns. JSON null is never used for a valid zero.
const f64buf = new DataView(new ArrayBuffer(8));
const f32buf = new DataView(new ArrayBuffer(4));
const f64bits = (v: number): string => { f64buf.setFloat64(0, v); return f64buf.getBigUint64(0).toString(16).padStart(16, "0"); };
const f32bits = (v: number): string => { f32buf.setFloat32(0, v); return f32buf.getUint32(0).toString(16).padStart(8, "0"); };
interface TaggedNumber {
  readonly tag: "+0" | "-0" | "value" | "NaN" | "+Inf" | "-Inf";
  readonly value?: number;
  readonly f64?: string;
  readonly f32?: string;
}
function tag(v: number): TaggedNumber {
  if (Number.isNaN(v)) return { tag: "NaN" };
  if (v === Infinity) return { tag: "+Inf" };
  if (v === -Infinity) return { tag: "-Inf" };
  const zero = v === 0;
  return { tag: zero ? (Object.is(v, -0) ? "-0" : "+0") : "value", value: v, f64: f64bits(v), f32: f32bits(v) };
}
function tagValue(t: TaggedNumber): number {
  if (t.tag === "NaN") return NaN;
  if (t.tag === "+Inf") return Infinity;
  if (t.tag === "-Inf") return -Infinity;
  return t.value as number;
}
const sameNumber = (a: number, b: number): boolean => (Number.isNaN(a) && Number.isNaN(b)) || Object.is(a, b);

// ---------------------------------------------------------------------------------------------------- source modules
const load = (p: string): Promise<any> => import(repo(p));
const hpView = await load("packages/shared/src/hpView.ts");
const perceptionMod = await load("packages/server/src/bots/brain/perception.ts");
const typesMod = await load("packages/server/src/bots/brain/types.ts");
const schemaMod = await load("packages/shared/src/schema.ts");
const schemaPkg = await import(repo("node_modules/@colyseus/schema/build/index.mjs"));

const { hpBarFractions, barrierStrength, hpDisplayValue, hpText, BARRIER_FULL_SHARE } = hpView;
const { perceive } = perceptionMod;
const { HP_QUANT } = typesMod;
const { PlayerState, MobState, RaidState } = schemaMod;
const { Encoder, Reflection } = schemaPkg;
const { mapFromTiles, TILE_FLOOR } = await load("packages/shared/src/index.ts");

// The human PlayerView import needs the ESM loader (phaser -> empty module, CSS -> empty module). If it is unavailable,
// the ring witness is recorded as blocked with the exact error and the other five corpora still run.
let PlayerView: any = null;
let playerViewError: string | null = null;
try {
  const mod = await load("packages/client/src/render/PlayerView.ts");
  PlayerView = mod.PlayerView;
  if (typeof PlayerView?.prototype?.setBarrier !== "function") throw new Error("PlayerView.prototype.setBarrier is not a function");
} catch (e) {
  playerViewError = String((e as Error)?.stack ?? e).slice(0, 4000);
}

// ---------------------------------------------------------------------------------------------------- source closure
const ENTRY_SOURCES = [
  "packages/shared/src/hpView.ts",
  "packages/shared/src/schema.ts",
  "packages/shared/src/index.ts",
  "packages/server/src/bots/brain/perception.ts",
  "packages/server/src/bots/brain/types.ts",
  "packages/client/src/render/PlayerView.ts",
];
const IMPORT_RE = /(?:^|[;\n])\s*(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g;
const DYNAMIC_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const importsOf = (text: string): string[] => {
  const out: string[] = [];
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push(m[1]!);
  }
  return out;
};
const isFile = (p: string): boolean => existsSync(repo(p)) && statSync(repo(p)).isFile();
const tryTs = (base: string): string | null => {
  for (const cand of [base, base + ".ts", base + ".tsx", base + ".mts", base.replace(/\.js$/, ".ts"), base + "/index.ts", base + "/index.tsx"]) {
    if (isFile(cand)) return cand;
  }
  return null;
};
function resolveSpecifier(fromRel: string, spec: string): { kind: "ts" | "style" | "external" | "unresolved"; path: string } {
  if (spec.startsWith(".")) {
    const base = join(dirname(fromRel), spec).split("\\").join("/");
    if (spec.endsWith(".css")) return { kind: "style", path: base };
    const ts = tryTs(base);
    return ts ? { kind: "ts", path: ts } : { kind: "unresolved", path: base };
  }
  if (spec === "@raid/shared") return { kind: "ts", path: "packages/shared/src/index.ts" };
  if (spec.startsWith("@raid/shared/")) {
    const sub = spec.slice("@raid/shared/".length);
    const ts = tryTs("packages/shared/src/" + sub);
    return ts ? { kind: "ts", path: ts } : { kind: "unresolved", path: spec };
  }
  return { kind: "external", path: spec };
}
const sourceFiles = new Set<string>();
const styleFiles = new Set<string>();
const externalImports = new Set<string>();
const unresolvedImports = new Set<string>();
const stack = [...ENTRY_SOURCES];
while (stack.length > 0) {
  const rel = stack.pop()!;
  if (sourceFiles.has(rel)) continue;
  sourceFiles.add(rel);
  for (const spec of importsOf(readFileSync(repo(rel), "utf8"))) {
    const r = resolveSpecifier(rel, spec);
    if (r.kind === "ts") stack.push(r.path);
    else if (r.kind === "style") styleFiles.add(r.path);
    else if (r.kind === "external") externalImports.add(r.path);
    else unresolvedImports.add(spec + " (from " + rel + ")");
  }
}
const sourceFileHashes = Object.fromEntries([...sourceFiles].sort().map((p) => [p, shaFile(p)]));
const styleFileHashes = Object.fromEntries([...styleFiles].sort().map((p) => [p, shaFile(p)]));

const CONFIG_FILES = [
  "package-lock.json",
  "package.json",
  "tsconfig.base.json",
  "packages/shared/package.json",
  "packages/shared/tsconfig.json",
  "packages/server/package.json",
  "packages/server/tsconfig.json",
  "packages/client/package.json",
  "packages/client/tsconfig.json",
];
const configPins = Object.fromEntries(CONFIG_FILES.map((p) => [p, { bytes: statSync(repo(p)).size, sha256: shaFile(p) }]));
const toolPins = {
  "tools/barrier-view-fixtures/capture.mts": shaFile("tools/barrier-view-fixtures/capture.mts"),
  "tools/barrier-view-fixtures/capture.sh": shaFile("tools/barrier-view-fixtures/capture.sh"),
  "tools/barrier-view-fixtures/stub-loader.mjs": shaFile("tools/barrier-view-fixtures/stub-loader.mjs"),
};

const PROFILE_BASE = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  image: IMAGE,
  imageDigest: "sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292",
  asserts: { node: "v22.23.4", platform: "linux", arch: "x64" },
  repoRoot,
  configFiles: configPins,
  sourceClosure: {
    method: "static import/export + dynamic-import graph from the entry list below, TypeScript files only",
    entrySources: ENTRY_SOURCES,
    sourceFileCount: Object.keys(sourceFileHashes).length,
    sourceFiles: sourceFileHashes,
  },
  styleFileCount: Object.keys(styleFileHashes).length,
  styleFiles: styleFileHashes,
  externalImports: [...externalImports].sort(),
  unresolvedImports: [...unresolvedImports].sort(),
  externalPackages: {
    "@colyseus/schema": "5.0.42 (package-lock entry; imported at node_modules/@colyseus/schema/build/index.mjs)",
    phaser: "stubbed by tools/barrier-view-fixtures/stub-loader.mjs for the PlayerView import only",
  },
  tool: toolPins,
  constants: {
    HP_QUANT: tag(HP_QUANT),
    BARRIER_FULL_SHARE: tag(BARRIER_FULL_SHARE),
  },
  declared: {
    note: "All probes are declared source-schema StateLike rows or declared numbers. Every recorded output is the unmodified source's actual return value; no expected value is written into a corpus.",
    map: "mapFromTiles(8, 8, floor) for declared perceive probes; no containers are declared",
  },
};

function finalize(corpus: Record<string, any>): string {
  corpus.profile = { ...PROFILE_BASE };
  const digest = sha256(JSON.stringify(corpus));
  corpus.profile.captureSha256 = digest;
  return JSON.stringify(corpus) + "\n";
}

// ---------------------------------------------------------------------------------------------- declared state shapes
const DECLARED_MAP = mapFromTiles(8, 8, new Uint8Array(64).fill(TILE_FLOOR));
const DECLARED_FEATURES = {
  messageTypes: [], wishes: false, statusEffects: true, fields: false, planning: false, chests: false,
  skills: false, relics: false, camps: false, hazards: false,
};

function playerRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "", look: 0, bot: false, x: 0, y: 0, facing: 0, hp: 100, maxHp: 100, status: "alive",
    faction: "fire", weapon0: "", weapon1: "", slot: 0, moveSeq: 0, attackTarget: "", drawStartedAt: 0,
    readyAt: 0, kills: 0, gv: 0, bounty: 0, immuneUntil: 0, sig: 0, brand: 0, mobKills: 0,
    asMult: 1000, windupMult: 1000, speedMult: 1000, armorBonus: 0, shieldBonus: 0, adBonus: 0, apBonus: 0,
    build: new Map(), barrier: 0, planReady: false, effects: 0, wishReadyAt: 0, qReadyAt: 0, eReadyAt: 0,
    displaceSeq: 0, markTier: 0, markBy: "", markTax: 0, sentence: 0, mobStats: new Map(), frostMoveMult: 1000,
    roamCharge: 0, roamReady: false, huntTarget: "", huntStacks: 0, campClears: 0, frostEliteGuard: false,
    corpseStacks: 0, potionLarge: 0, potionSmall: 0, healingUntil: 0, potionsHealing: 0, speedBoostUntil: 0,
    tradeUsed: false, tradeOffers: [], tradeStats: new Map(), plagueZombieId: "",
    extra: { wishFullAt: 0, chestBoosts: new Map(), killStats: new Map(), bushRevealUntil: 0, walkDir: 0, walkTicks: 0 },
    ...over,
  };
}
function mobRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "dummy", name: "", type: "", x: 0, y: 0, facing: 0, hp: 100, maxHp: 100, status: "alive",
    faction: "fire", weapon0: "", weapon1: "", slot: 0, drawStartedAt: 0, readyAt: 0, sig: 0, brand: 0,
    effects: 0, ownerId: "", ...over,
  };
}
function stateOf(players: Map<string, unknown>, mobs: Map<string, unknown> = new Map()): Record<string, unknown> {
  return {
    phase: "active", seed: 7, serverTime: 12345, lobbyEndsAt: 60000, raidStartedAt: 1000,
    minPlayers: 0, startedWith: 0, patienceEndsAt: 0, inColiseum: false, gatesLocked: false, suddenDeathAt: 0,
    winner: "", training: false, players, mobs, containers: new Map(), roster: [...players.keys(), ...mobs.keys()],
  };
}
const ctxOf = (selfId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  selfId, map: DECLARED_MAP, features: DECLARED_FEATURES, lastMinimap: null, ...extra,
});

/** A bar share the source reads off a bar: a multiple of one HP_QUANT step, or exactly 0. */
function isBarShare(v: number): boolean {
  if (v === 0) return true;
  const steps = 1 / HP_QUANT;
  return Number.isFinite(v) && Math.abs(v * steps - Math.round(v * steps)) < 1e-9;
}

// =================================================================================================== A. continuous bars
const CONTINUOUS_CASES = [
  { name: "zero-all", hp: 0, maxHp: 100, barrier: 0 },
  { name: "zero-maxhp", hp: 100, maxHp: 0, barrier: 0 },
  { name: "zero-maxhp-positive-barrier", hp: 0, maxHp: 0, barrier: 50 },
  { name: "zero-hp-positive-barrier", hp: 0, maxHp: 100, barrier: 75 },
  { name: "ordinary", hp: 75, maxHp: 100, barrier: 25 },
  { name: "ordinary-fractional", hp: 250.5, maxHp: 400, barrier: 25.5 },
  { name: "overheal", hp: 120, maxHp: 100, barrier: 0 },
  { name: "overheal-with-barrier", hp: 120, maxHp: 100, barrier: 40 },
  { name: "overfull-combined", hp: 100, maxHp: 100, barrier: 50 },
  { name: "tiny-barrier", hp: 100, maxHp: 100, barrier: 0.0499999 },
  { name: "half-step-below", hp: 100, maxHp: 100, barrier: 0.0249999 },
  { name: "half-step-exact", hp: 100, maxHp: 100, barrier: 0.025 },
  { name: "half-step-above", hp: 100, maxHp: 100, barrier: 0.0250001 },
  { name: "sub-point-barrier", hp: 100, maxHp: 100, barrier: 0.4 },
  { name: "display-sums-over-maxhp", hp: 10.4, maxHp: 10, barrier: 10.4 },
  { name: "maxhp-decrease", hp: 120, maxHp: 80, barrier: 20 },
  { name: "maxhp-decrease-hp-only", hp: 90, maxHp: 60, barrier: 0 },
  { name: "maxhp-decrease-overfull", hp: 90, maxHp: 60, barrier: 40 },
  { name: "hp-at-maxhp", hp: 100, maxHp: 100, barrier: 0 },
  { name: "subnormal-barrier", hp: 100, maxHp: 100, barrier: 1e-45 },
];
const CONTINUOUS_DIAGNOSTICS = [
  { name: "nan-hp", hp: NaN, maxHp: 100, barrier: 0 },
  { name: "nan-barrier", hp: 100, maxHp: 100, barrier: NaN },
  { name: "nan-maxhp", hp: 100, maxHp: NaN, barrier: 0 },
  { name: "nan-all", hp: NaN, maxHp: NaN, barrier: NaN },
  { name: "plus-infinity-hp", hp: Infinity, maxHp: 100, barrier: 0 },
  { name: "plus-infinity-barrier", hp: 100, maxHp: 100, barrier: Infinity },
  { name: "minus-infinity-barrier", hp: 100, maxHp: 100, barrier: -Infinity },
  { name: "minus-infinity-hp", hp: -Infinity, maxHp: 100, barrier: 0 },
  { name: "negative-hp", hp: -5, maxHp: 100, barrier: 0 },
  { name: "negative-barrier", hp: 100, maxHp: 100, barrier: -5 },
  { name: "negative-maxhp", hp: 100, maxHp: -50, barrier: 25 },
  { name: "overflowing-sum", hp: 1.7e308, maxHp: 1.7e308, barrier: 1.7e308 },
  { name: "minus-zero-hp-and-barrier", hp: -0, maxHp: 100, barrier: -0 },
];
function continuousProbe(c: { name: string; hp: number; maxHp: number; barrier: number }): Record<string, unknown> {
  const fractions = hpBarFractions(c.hp, c.maxHp, c.barrier);
  const strength = barrierStrength(c.barrier, c.maxHp);
  const display = {
    hp: hpDisplayValue(c.hp),
    maxHp: hpDisplayValue(c.maxHp),
    barrier: hpDisplayValue(c.barrier),
  };
  const text = hpText(c.hp, c.maxHp, c.barrier);
  const displaySum = display.hp + display.barrier;
  return {
    name: c.name,
    declared: { hp: tag(c.hp), maxHp: tag(c.maxHp), barrier: tag(c.barrier) },
    actual: {
      fractions: { hp: tag(fractions.hp), barrier: tag(fractions.barrier) },
      strength: tag(strength),
      display: { hp: tag(display.hp), maxHp: tag(display.maxHp), barrier: tag(display.barrier) },
      text,
      shareSum: tag(fractions.hp + fractions.barrier),
      displaySum: tag(displaySum),
      displaySumExceedsMaxHpDisplay: Number.isFinite(displaySum) && displaySum > display.maxHp,
    },
  };
}
const continuousCases = CONTINUOUS_CASES.map(continuousProbe);
for (const probe of continuousCases) {
  const f = probe.actual as any;
  expectSource(f.strength.tag !== "value" || f.strength.value <= 1, "barrierStrength stays within 0..1");
}
const continuous = {
  format: FORMAT,
  corpus: "continuous player-bar arithmetic: actual hpBarFractions / barrierStrength / hpDisplayValue / hpText",
  provenance: {
    hpBarFractions: "packages/shared/src/hpView.ts hpBarFractions (combined denominator max(maxHp>0?maxHp:0, positive hp + positive barrier))",
    barrierStrength: "packages/shared/src/hpView.ts barrierStrength (guard !(barrier>0) || !(maxHp>0) -> 0; else min(1, barrier/(maxHp*BARRIER_FULL_SHARE)))",
    hpDisplayValue: "packages/shared/src/hpView.ts hpDisplayValue (non-finite: Math.ceil; else epsilon-toleranced ceil with a 1-point living floor)",
    hpText: "packages/shared/src/hpView.ts hpText",
    note: "Declared inputs; the outputs below are the actual functions' return values. The source's value > 0 guards are left intact.",
  },
  notes: [
    "Half-step neighbours are neighbours of half of HP_QUANT: the continuous shares do not quantize, while the bot bar share in owner-fighter.json does.",
    "hpDisplayValue rounds hp and the barrier independently for the text; their display sum may exceed the displayed maxHp and is recorded rather than corrected.",
    "The combined denominator is max(maxHp, positive hp + positive barrier); no maximum-hp or grant-cap invariant is imposed.",
  ],
  caseCount: continuousCases.length,
  cases: continuousCases,
  diagnostics: {
    label: "numeric-domain diagnostics",
    warning: "Declared inputs outside the finite non-negative bar domain. These are source-arithmetic observations only: they are not native publication, restore, wire-admission or rejection rules and authorize no precision decision.",
    guards: "The finite-input denominator shorthand is NOT applied here: hpBarFractions is called on the declared values, so its actual value > 0 ? value : 0 guards execute and NaN, infinities, negatives and signed zero are preserved exactly as the helper returns them.",
    finiteShorthandApplied: false,
    caseCount: CONTINUOUS_DIAGNOSTICS.length,
    cases: CONTINUOUS_DIAGNOSTICS.map(continuousProbe),
  },
};

// ================================================================================================== B. owner/fighter
// The owner's own barrier is copied exactly through Math.fround (selfView.barrier). Another visible player's barrier is a
// bar share: f32 inputs -> hpBarFractions (combined denominator) -> barShare twentieths with a one-step positive sliver.
const OWNER_CASES: Array<{ name: string; barrier: number }> = [
  { name: "plus-zero", barrier: 0 },
  { name: "minus-zero", barrier: -0 },
  { name: "f32-subnormal-min", barrier: 1.401298464324817e-45 },
  { name: "f32-underflow-zero", barrier: 1e-46 },
  { name: "f32-subnormal-rounded", barrier: 1e-45 },
  { name: "half-hp-quant", barrier: 0.025 },
  { name: "below-2x-hp-quant", barrier: 0.0499999 },
  { name: "hp-quant-2x", barrier: 0.05 },
  { name: "above-2x-hp-quant", barrier: 0.0500001 },
  { name: "three-quarter-hp-quant", barrier: 0.075 },
  { name: "f32-integer-limit", barrier: 16777216 },
  { name: "f32-integer-limit-plus-one", barrier: 16777217 },
  { name: "f32-2^25", barrier: 33554432 },
  { name: "f32-max", barrier: 3.4028234663852886e38 },
  { name: "above-f32-max", barrier: 1e39 },
  { name: "ordinary-75", barrier: 75 },
  { name: "ordinary-100", barrier: 100 },
  { name: "ordinary-250.5", barrier: 250.5 },
  { name: "negative-minus-one", barrier: -1 },
  { name: "negative-minus-half", barrier: -0.5 },
  { name: "negative-underflow", barrier: -1e-46 },
];
const OWNER_HP = 100;
const OWNER_MAXHP = 100;
function ownerFighterProbe(c: { name: string; barrier: number }): Record<string, unknown> {
  const owner = playerRow({ name: "Owner", x: 0, y: 0, hp: OWNER_HP, maxHp: OWNER_MAXHP, barrier: c.barrier });
  const fighter = playerRow({ name: "Fighter", x: 100, y: 100, hp: OWNER_HP, maxHp: OWNER_MAXHP, barrier: c.barrier });
  const state = stateOf(new Map<string, unknown>([["p-owner", owner], ["p-fighter", fighter]]));
  const frame = perceive({ state }, ctxOf("p-owner"));
  const seen = frame.fighters.find((f: any) => f.id === "p-fighter");
  const f32hp = Math.fround(OWNER_HP);
  const f32maxHp = Math.fround(OWNER_MAXHP);
  const f32barrier = Math.fround(c.barrier);
  const helper = hpBarFractions(f32hp, f32maxHp, f32barrier);
  return {
    name: c.name,
    declared: {
      owner: { hp: tag(OWNER_HP), maxHp: tag(OWNER_MAXHP), barrier: tag(c.barrier) },
      fighter: { hp: tag(OWNER_HP), maxHp: tag(OWNER_MAXHP), barrier: tag(c.barrier) },
      positions: { owner: { x: 0, y: 0 }, fighter: { x: 100, y: 100 } },
      note: "declared source-schema StateLike player rows; both rows carry the same barrier value",
    },
    actual: {
      selfBarrier: tag(frame.self.barrier),
      selfBarrierDiffersFromDeclared: !sameNumber(frame.self.barrier, c.barrier),
      fighterCount: frame.fighters.length,
      fighter: seen === undefined ? null : {
        id: seen.id,
        hpFrac: tag(seen.hpFrac),
        barrierFrac: tag(seen.barrierFrac),
        independentlyRoundedShareSum: tag(seen.hpFrac + seen.barrierFrac),
        shareSumExceedsOne: seen.hpFrac + seen.barrierFrac > 1,
        barSharesAreTwentiethSteps: isBarShare(seen.hpFrac) && isBarShare(seen.barrierFrac),
      },
    },
    f32Inputs: { hp: tag(f32hp), maxHp: tag(f32maxHp), barrier: tag(f32barrier) },
    helperOnF32Inputs: { hp: tag(helper.hp), barrier: tag(helper.barrier) },
  };
}
const ownerCases = OWNER_CASES.map(ownerFighterProbe);
for (const probe of ownerCases) {
  const declared = probe.declared as any;
  const actual = probe.actual as any;
  expectSource(sameNumber(tagValue(actual.selfBarrier), Math.fround(tagValue(declared.owner.barrier))), "selfView.barrier is f32(barrier)");
  expectSource(actual.fighterCount === 1, "exactly one visible fighter row");
  expectSource(actual.fighter !== null && actual.fighter.barSharesAreTwentiethSteps, "fighter shares are twentieth steps");
}
const ownerFighter = {
  format: FORMAT,
  corpus: "actual perceive(): owner self barrier through Math.fround and a visible fighter barrier share",
  provenance: {
    perceive: "packages/server/src/bots/brain/perception.ts perceive (selfView, fighterSeen)",
    selfBarrier: "selfView(): barrier: f32(p.barrier), f32 = Math.fround",
    fighterBarrier: "fighterSeen(): hpBarFractions(f32(hp), f32(maxHp), f32(barrier)) then barShare(): max(1, round(share*HP_STEPS))/HP_STEPS, 0 for a non-positive share",
    HP_QUANT: "packages/server/src/bots/brain/types.ts HP_QUANT",
    note: "Declared-probe inputs are plain source-schema StateLike rows. Both outputs are the actual perceive() fields.",
  },
  positiveSliverNote: "A positive share below half an HP_QUANT step still reads one step (0.05); independently rounded hp and barrier shares can sum above 1.",
  caseCount: ownerCases.length,
  cases: ownerCases,
};

// ===================================================================================================== C. schema f32
const playerMetaEntries = Object.keys((PlayerState as any)[Symbol.metadata] ?? {})
  .map((k) => (PlayerState as any)[Symbol.metadata][k])
  .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
const barrierMeta = playerMetaEntries.find((m: any) => m.name === "barrier") ?? null;
const freshBarrier = new PlayerState().barrier;
const mobMetaEntries = Object.keys((MobState as any)[Symbol.metadata] ?? {})
  .map((k) => (MobState as any)[Symbol.metadata][k])
  .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
const SCHEMA_CASES: Array<{ name: string; steps: number[] }> = [
  { name: "default", steps: [] },
  { name: "plus-zero", steps: [0] },
  { name: "minus-zero-direct", steps: [-0] },
  { name: "minus-zero-after-nonzero", steps: [1, -0] },
  { name: "plus-zero-after-minus-zero", steps: [1, -0, 0] },
  { name: "subnormal-min", steps: [1.401298464324817e-45] },
  { name: "underflow-zero", steps: [1e-46] },
  { name: "f32-integer-limit", steps: [16777216] },
  { name: "f32-integer-limit-plus-one", steps: [16777217] },
  { name: "f32-max", steps: [3.4028234663852886e38] },
  { name: "above-f32-max", steps: [1e39] },
  { name: "nan", steps: [NaN] },
  { name: "plus-infinity", steps: [Infinity] },
  { name: "minus-infinity", steps: [-Infinity] },
  { name: "point-one", steps: [0.1] },
  { name: "ordinary-75", steps: [75] },
];
function schemaProbe(c: { name: string; steps: number[] }): Record<string, unknown> {
  const state = new RaidState();
  const row = new PlayerState();
  row.name = "p";
  row.hp = 1;
  row.maxHp = 1;
  for (const step of c.steps) row.barrier = step;
  state.players.set("p", row);
  const host = row.barrier;
  const encoder = new Encoder(state);
  const bytes = encoder.encodeAll();
  const decoder = Reflection.decode(Reflection.encode(encoder)) as any;
  decoder.decode(bytes);
  const decoded = decoder.state.players.get("p").barrier;
  const last = c.steps.length > 0 ? c.steps[c.steps.length - 1]! : 0;
  const f32OfLast = Math.fround(last);
  return {
    name: c.name,
    declared: {
      assignSteps: c.steps.map(tag),
      note: c.steps.length === 0 ? "fresh PlayerState, no assignment" : "assignments to PlayerState.barrier on a fresh schema instance, in order",
    },
    host: {
      afterAssignments: tag(host),
      defaultInstanceValue: tag(freshBarrier),
      hostMatchesF32OfLastStep: sameNumber(host, f32OfLast),
    },
    wire: {
      encoderPath: "new Encoder(state).encodeAll()",
      decoderPath: "Reflection.decode(Reflection.encode(encoder)); decoder.decode(bytes)",
      encodedBytes: bytes.length,
      decoded: tag(decoded),
      f32OfLastDeclaredStep: tag(f32OfLast),
      decodedMatchesF32OfLastStep: sameNumber(decoded, f32OfLast),
      decodedSignedZero: Object.is(decoded, -0) ? "-0" : Object.is(decoded, 0) ? "+0" : null,
      decodedNaNAndInfinity: Number.isNaN(decoded) ? "NaN" : decoded === Infinity ? "+Inf" : decoded === -Infinity ? "-Inf" : null,
    },
    bits: {
      host: tag(host).f32 ?? null,
      f32OfLastStep: tag(f32OfLast).f32 ?? null,
      decoded: tag(decoded).f32 ?? null,
    },
  };
}
const schemaCases = SCHEMA_CASES.map(schemaProbe);
const schemaF32 = {
  format: FORMAT,
  corpus: "actual PlayerState float32 barrier encode/decode through @colyseus/schema Encoder/Decoder",
  provenance: {
    schema: "packages/shared/src/schema.ts PlayerState.barrier: t.float32().default(0)",
    codec: "node_modules/@colyseus/schema/build/index.mjs (5.0.42): Encoder.encodeAll + Reflection.decode + Decoder.decode",
    note: "Each case builds a fresh RaidState and PlayerState, assigns barrier in the listed order, encodes the full state and decodes it with the actual codec. The decoded value is the wire result, not a reflection guess.",
  },
  reflection: {
    secondaryMetadata: "PlayerState[Symbol.metadata] entry named barrier (secondary metadata only; the encode/decode rows above are the value witness).",
    barrierEntry: barrierMeta,
    defaultHostValue: tag(freshBarrier),
    mobStateFieldNames: mobMetaEntries.map((m: any) => m.name),
    mobStateHasBarrierField: mobMetaEntries.some((m: any) => m.name === "barrier"),
    playerStateHasBarrierField: playerMetaEntries.some((m: any) => m.name === "barrier"),
  },
  signedZeroNote: "The schema field setter's change tree treats 0 and -0 as equal: assigning -0 to a fresh default-0 field does not store it. A non-zero -> -0 assignment stores -0 and the float32 wire preserves it; +0 assigned after -0 does not replace it.",
  caseCount: schemaCases.length,
  cases: schemaCases,
};

// ==================================================================================================== D. human ring
interface RingCall { readonly stepBefore: number; readonly stepAfter: number; readonly strength: TaggedNumber; readonly calls: unknown[][] }
function makeRingRecorder(): { recorder: any; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const graphics: any = {
    clear(...a: unknown[]) { calls.push(["clear", ...a]); return graphics; },
    fillStyle(...a: unknown[]) { calls.push(["fillStyle", ...a]); return graphics; },
    fillCircle(...a: unknown[]) { calls.push(["fillCircle", ...a]); return graphics; },
    lineStyle(...a: unknown[]) { calls.push(["lineStyle", ...a]); return graphics; },
    strokeCircle(...a: unknown[]) { calls.push(["strokeCircle", ...a]); return graphics; },
  };
  return { recorder: { barrierStep: 0, barrierRing: graphics }, calls };
}
function ringCall(recorder: any, calls: unknown[][], strength: number): RingCall {
  const stepBefore = recorder.barrierStep;
  const at = calls.length;
  PlayerView.prototype.setBarrier.call(recorder, strength);
  return { stepBefore, stepAfter: recorder.barrierStep, strength: tag(strength), calls: calls.slice(at) };
}
const RING_MAPPING: Array<{ label: string; strength: number }> = [
  { label: "zero", strength: 0 },
  { label: "tiny-positive-sliver", strength: 1e-9 },
  { label: "below-tie-1of16", strength: 0.06249 },
  { label: "tie-1of16", strength: 1 / 16 },
  { label: "above-tie-1of16", strength: 0.06251 },
  { label: "below-boundary-1of8", strength: 0.12499 },
  { label: "boundary-1of8", strength: 0.125 },
  { label: "above-boundary-1of8", strength: 0.12501 },
  { label: "below-tie-3of16", strength: 0.18749 },
  { label: "tie-3of16", strength: 0.1875 },
  { label: "above-tie-3of16", strength: 0.18751 },
  { label: "below-boundary-1of4", strength: 0.24999 },
  { label: "boundary-1of4", strength: 0.25 },
  { label: "above-boundary-1of4", strength: 0.25001 },
  { label: "below-tie-5of16", strength: 0.31249 },
  { label: "tie-5of16", strength: 0.3125 },
  { label: "above-tie-5of16", strength: 0.31251 },
  { label: "below-tie-7of16", strength: 0.43749 },
  { label: "tie-7of16", strength: 0.4375 },
  { label: "above-tie-7of16", strength: 0.43751 },
  { label: "below-tie-9of16", strength: 0.56249 },
  { label: "tie-9of16", strength: 0.5625 },
  { label: "above-tie-9of16", strength: 0.56251 },
  { label: "below-tie-11of16", strength: 0.68749 },
  { label: "tie-11of16", strength: 0.6875 },
  { label: "above-tie-11of16", strength: 0.68751 },
  { label: "below-tie-13of16", strength: 0.81249 },
  { label: "tie-13of16", strength: 0.8125 },
  { label: "above-tie-13of16", strength: 0.81251 },
  { label: "below-tie-15of16", strength: 0.93749 },
  { label: "tie-15of16", strength: 0.9375 },
  { label: "above-tie-15of16", strength: 0.93751 },
  { label: "declared-strength-0.3", strength: 0.3 },
  { label: "declared-strength-0.5", strength: 0.5 },
  { label: "near-full-0.99", strength: 0.99 },
  { label: "full-1.0", strength: 1 },
];
const RING_NORMALIZED: Array<{ label: string; barrier: number; maxHp: number }> = [
  { label: "barrier-0.06", barrier: 0.06, maxHp: 100 },
  { label: "barrier-0.075", barrier: 0.075, maxHp: 100 },
  { label: "below-tie-1of16", barrier: 1.874999, maxHp: 100 },
  { label: "tie-1of16", barrier: 1.875, maxHp: 100 },
  { label: "above-tie-1of16", barrier: 1.875001, maxHp: 100 },
  { label: "boundary-1of8", barrier: 3.75, maxHp: 100 },
  { label: "below-tie-3of16", barrier: 5.624999, maxHp: 100 },
  { label: "tie-3of16", barrier: 5.625, maxHp: 100 },
  { label: "above-tie-3of16", barrier: 5.625001, maxHp: 100 },
  { label: "strength-0.3-not-full", barrier: 9, maxHp: 100 },
  { label: "strength-0.5", barrier: 15, maxHp: 100 },
  { label: "above-strength-0.5", barrier: 15.000001, maxHp: 100 },
  { label: "near-full", barrier: 29.999999, maxHp: 100 },
  { label: "full-0.3-of-maxhp", barrier: 30, maxHp: 100 },
  { label: "above-full-clamped", barrier: 30.000001, maxHp: 100 },
  { label: "clamped-75", barrier: 75, maxHp: 100 },
];
function ringMappingProbes(): unknown[] {
  return RING_MAPPING.map((c) => {
    const { recorder, calls } = makeRingRecorder();
    const r = ringCall(recorder, calls, c.strength);
    return { label: c.label, ...r };
  });
}
function ringNormalizedProbes(): unknown[] {
  return RING_NORMALIZED.map((c) => {
    // The human ring's actual barrier input is the schema-decoded float32 (PlayerState.barrier); maxHp is the original
    // f64 number field and is NOT fround-ed here (fighterSeen, by contrast, frounds hp/maxHp/barrier).
    const schemaBarrier = Math.fround(c.barrier);
    const strength = barrierStrength(schemaBarrier, c.maxHp);
    const { recorder, calls } = makeRingRecorder();
    const r = ringCall(recorder, calls, strength);
    return {
      label: c.label,
      declaredBarrier: tag(c.barrier),
      schemaBarrier: tag(schemaBarrier),
      maxHp: tag(c.maxHp),
      barrierShareOfMaxHp: tag(schemaBarrier / c.maxHp),
      strength: tag(strength),
      ...r,
    };
  });
}

// Lead-review clarification witness: the human ring uses the schema-f32 barrier and the original f64 maxHp. One case is
// chosen so an erroneous fround(maxHp) would change the eight-step rounding result (2 vs 3); the
// diagnosticIfMaxHpFrounded block is explicitly NOT source behaviour and is recorded only to prove the distinction.
const RING_F64_MAXHP: Array<{ label: string; barrier: number; maxHp: number }> = [
  { label: "f64-maxhp-below-tie", barrier: 9.375, maxHp: 100.000001 },
  { label: "f64-maxhp-fraction", barrier: 0.06, maxHp: 99.999999 },
  { label: "f64-maxhp-near-full", barrier: 29.999999, maxHp: 100.00001 },
  { label: "f64-maxhp-ordinary", barrier: 15, maxHp: 150.0000001 },
];
function ringF64MaxHpProbes(): unknown[] {
  return RING_F64_MAXHP.map((c) => {
    const schemaBarrier = Math.fround(c.barrier);
    const strength = barrierStrength(schemaBarrier, c.maxHp);
    const { recorder, calls } = makeRingRecorder();
    const r = ringCall(recorder, calls, strength);
    const strengthIfMaxHpFrounded = barrierStrength(schemaBarrier, Math.fround(c.maxHp));
    const stepIfMaxHpFrounded = strengthIfMaxHpFrounded > 0 ? Math.max(1, Math.round(strengthIfMaxHpFrounded * 8)) : 0;
    return {
      label: c.label,
      declaredBarrier: tag(c.barrier),
      schemaBarrier: tag(schemaBarrier),
      maxHpF64: tag(c.maxHp),
      strength: tag(strength),
      ...r,
      diagnosticIfMaxHpFrounded: {
        label: "diagnostic only, NOT source behaviour: the step if maxHp were erroneously Math.fround-ed",
        maxHpF32: tag(Math.fround(c.maxHp)),
        strength: tag(strengthIfMaxHpFrounded),
        step: stepIfMaxHpFrounded,
      },
    };
  });
}
function ringSequence(strengths: number[]): unknown {
  const { recorder, calls } = makeRingRecorder();
  const results: unknown[] = [];
  const transitions: number[] = [recorder.barrierStep];
  for (const s of strengths) {
    const r = ringCall(recorder, calls, s);
    results.push(r);
    transitions.push(recorder.barrierStep);
  }
  return { strengths: strengths.map(tag), calls: results, transitions, totalCalls: calls.length };
}
let humanRing: Record<string, any>;
if (PlayerView === null) {
  humanRing = {
    format: FORMAT,
    corpus: "BLOCKED: actual PlayerView.prototype.setBarrier eight-step ring",
    accessible: false,
    blocker: {
      error: playerViewError,
      prerequisite: "The client render module graph must import under the ESM loader with the phaser and CSS empty-module stubs, and PlayerView.prototype.setBarrier must exist.",
    },
    cases: [],
  };
} else {
  humanRing = {
    format: FORMAT,
    corpus: "actual PlayerView.prototype.setBarrier eight-step human ring with declared recorder objects",
    accessible: true,
    provenance: {
      module: "packages/client/src/render/PlayerView.ts",
      method: "PlayerView.prototype.setBarrier.call(recorder, strength) (the real private method, called by its runtime name)",
      recorder: "declared { barrierStep, barrierRing } object; barrierRing records clear/fillStyle/fillCircle/lineStyle/strokeCircle and the arguments the method passes",
      stubs: "tools/barrier-view-fixtures/stub-loader.mjs maps phaser and every *.css to empty ESM modules; no scene, DOM or graphics lifecycle runs. The method itself is not copied or reimplemented.",
      note: "A fresh recorder starts at barrierStep 0, so a 0 call from that state changes nothing; a positive -> 0 transition clears and draws nothing.",
      inputs: "The caller passes barrierStrength(p.barrier, p.maxHp): p.barrier is the schema-decoded float32 barrier, p.maxHp is the original f64 maxHp (NOT Math.fround-ed). This differs from fighterSeen, whose hp/maxHp/barrier are all Math.fround-ed before hpBarFractions.",
    },
    importSetup: {
      phaser: "empty module (default {})",
      css: "empty module for every *.css",
      PlayerViewConstructed: false,
      sceneObjectsSupplied: false,
      recorderOnly: true,
    },
    sequences: {
      cacheRepeat: ringSequence([0.5, 0.5, 0.5001, 0.625, 0.6250001, 0, 0.5]),
      stepToZero: ringSequence([0.875, 0, 0, -1, -0, 0.0625]),
      fullAndAboveCallerDomain: ringSequence([1, 1.5]),
    },
    mapping: {
      label: "declared strengths across the eight-step mapping; each call uses a fresh recorder",
      probes: ringMappingProbes(),
    },
    normalized: {
      label: "actual barrierStrength(schema-f32 barrier, f64 maxHp) feeds the same actual method; BARRIER_FULL_SHARE = 0.3; maxHp is NOT Math.fround-ed for the human ring",
      BARRIER_FULL_SHARE: tag(BARRIER_FULL_SHARE),
      probes: ringNormalizedProbes(),
    },
    schemaF32BarrierF64MaxHp: {
      label: "lead-review clarification witness: ring input is the schema-decoded f32 barrier with the original f64 maxHp (fighterSeen instead frounds hp/maxHp/barrier); the fround(maxHp) block is a labelled diagnostic only",
      probes: ringF64MaxHpProbes(),
    },
  };
  const mapping = humanRing.mapping.probes as any[];
  const observedAtFull = mapping.find((p: any) => p.label === "full-1.0");
  humanRing.observedFullStep = observedAtFull === undefined ? null : observedAtFull.stepAfter;
  expectSource(observedAtFull !== undefined && observedAtFull.stepAfter === 8, "a full strength draws the eight-step ring");
  expectSource(mapping.find((p: any) => p.label === "tiny-positive-sliver").stepAfter === 1, "a tiny positive strength still draws step 1");
  const f64MaxHpProbes = humanRing.schemaF32BarrierF64MaxHp.probes as any[];
  expectSource(
    f64MaxHpProbes.some((p: any) => p.stepAfter !== p.diagnosticIfMaxHpFrounded.step),
    "a schema-f32-barrier/f64-maxHp threshold case must differ from the erroneous fround(maxHp) step",
  );
  expectSource(
    f64MaxHpProbes.every((p: any) => Number.isFinite(p.maxHpF64.value ?? NaN)),
    "the f64 maxHp values are finite",
  );
}

// ===================================================================================================== E. NPC forms
const MOB_FORMS: Array<{ id: string; kind: string; name: string; type: string; faction: string; x: number; y: number; ownerId?: string }> = [
  { id: "m-mob", kind: "mob", name: "Ember Imp", type: "emberImp", faction: "fire", x: 50, y: 50 },
  { id: "m-elite", kind: "elite", name: "Ember Tyrant", type: "emberTyrant", faction: "fire", x: 120, y: 60 },
  { id: "m-dummy", kind: "dummy", name: "Dummy", type: "", faction: "", x: -50, y: 80 },
  { id: "m-quest", kind: "quest", name: "Quest Giver", type: "", faction: "holy", x: 80, y: -60 },
  { id: "m-zombie", kind: "zombie", name: "Plague Companion", type: "", faction: "plague", x: 150, y: 120, ownerId: "p-owner" },
];
function npcState(strayBarrier: number | "absent"): Record<string, unknown> {
  const owner = playerRow({ name: "Owner", x: 0, y: 0 });
  const mobs = new Map<string, unknown>(MOB_FORMS.map((f) => [f.id, mobRow({
    kind: f.kind, name: f.name, type: f.type, faction: f.faction, x: f.x, y: f.y, hp: 100, maxHp: 100,
    ownerId: f.ownerId ?? "",
    ...(strayBarrier === "absent" ? {} : { barrier: strayBarrier }),
  })]));
  return stateOf(new Map<string, unknown>([["p-owner", owner]]), mobs);
}
const npcFrameWithStray = perceive({ state: npcState(50) }, ctxOf("p-owner"));
const npcFrameWithoutStray = perceive({ state: npcState("absent") }, ctxOf("p-owner"));
const npcFrameWithHuge = perceive({ state: npcState(1e39) }, ctxOf("p-owner"));
const npcFrameWithNaN = perceive({ state: npcState(NaN) }, ctxOf("p-owner"));
const npcForms = {
  format: FORMAT,
  corpus: "actual perceive(): NPC forms (mob/elite/dummy/quest/companion) and a declared stray barrier property",
  provenance: {
    perceive: "packages/server/src/bots/brain/perception.ts perceive (mobSeen)",
    mobSeen: "mobSeen(): hpFrac = barShare(hpBarFractions(f32(hp), f32(maxHp), 0).hp); no barrier leaf is built",
    mobSchema: "packages/shared/src/schema.ts MobState: field names are listed from the actual schema metadata",
    note: "Declared-probe mob rows are plain source-schema StateLike rows; the stray barrier property is declared input, not a schema field.",
  },
  declared: {
    rows: MOB_FORMS.map((f) => ({ ...f, hp: 100, maxHp: 100, strayBarrier: tag(50) })),
    positions: "all rows are inside the frame box around the owner at (0,0)",
  },
  supported: {
    note: "state.mobs rows of every declared kind are read through actual perceive; the frame.mobs list and the minimap dots below are the actual outputs.",
    frameMobs: npcFrameWithStray.mobs.map((m: any) => ({
      id: m.id, kind: m.kind, name: m.name, type: m.type ?? null, faction: m.faction, x: m.x, y: m.y,
      status: m.status, hpFrac: tag(m.hpFrac), hasBarrierLeaf: Object.prototype.hasOwnProperty.call(m, "barrier"),
      hasBarrierFracLeaf: Object.prototype.hasOwnProperty.call(m, "barrierFrac"), keys: Object.keys(m).sort(),
      hpFracIsTwentiethStep: isBarShare(m.hpFrac),
    })),
    frameMobCount: npcFrameWithStray.mobs.length,
    minimapDots: npcFrameWithStray.minimap.mobs.map((m: any) => ({ id: m.id, x: m.x, y: m.y, elite: m.elite })),
    effectsIds: Object.keys(npcFrameWithStray.extras.effects ?? {}).sort(),
  },
  unsupported: {
    note: "MobSeen has no barrier or barrierFrac leaf and MobState has no barrier field; no NPC barrier fact exists in the actual projection.",
    mobSeenBarrierLeaf: npcFrameWithStray.mobs.some((m: any) => "barrier" in m),
    mobSeenBarrierFracLeaf: npcFrameWithStray.mobs.some((m: any) => "barrierFrac" in m),
    mobStateFieldNames: mobMetaEntries.map((m: any) => m.name),
    mobStateHasBarrierField: mobMetaEntries.some((m: any) => m.name === "barrier"),
    minimapSupports: "only living mob and elite rows get a minimap dot (dummy/quest/zombie do not), as recorded above",
  },
  strayBarrierControls: {
    label: "the same declared mob rows with a stray barrier property (50 / 1e39 / NaN) and without it",
    mobsWithStray50: plain(npcFrameWithStray.mobs),
    mobsWithoutStray: plain(npcFrameWithoutStray.mobs),
    mobsWithStrayHuge: plain(npcFrameWithHuge.mobs),
    mobsWithStrayNaN: plain(npcFrameWithNaN.mobs),
    identicalWithoutStray: JSON.stringify(npcFrameWithStray.mobs) === JSON.stringify(npcFrameWithoutStray.mobs),
    identicalWithHugeAndNaN: JSON.stringify(npcFrameWithStray.mobs) === JSON.stringify(npcFrameWithHuge.mobs)
      && JSON.stringify(npcFrameWithStray.mobs) === JSON.stringify(npcFrameWithNaN.mobs),
  },
};
expectSource(npcFrameWithStray.mobs.every((m: any) => !("barrier" in m) && !("barrierFrac" in m)), "MobSeen has no barrier leaf");
expectSource(!mobMetaEntries.some((m: any) => m.name === "barrier"), "MobState has no barrier field");

// ================================================================================================== F. visibility
const VIS_BARRIER = 75;
function visibilityState(overrides: { hiddenBarrier?: number; farBarrier?: number } = {}): Record<string, unknown> {
  const players = new Map<string, unknown>([
    ["p-owner", playerRow({ name: "Owner", x: 0, y: 0, barrier: VIS_BARRIER })],
    ["p-visible", playerRow({ name: "Visible", x: 100, y: 100, barrier: VIS_BARRIER })],
    ["p-hidden", playerRow({ name: "Hidden", x: 40, y: 40, effects: 256, barrier: overrides.hiddenBarrier ?? VIS_BARRIER })],
    ["p-far", playerRow({ name: "Far", x: 5000, y: 5000, barrier: overrides.farBarrier ?? VIS_BARRIER })],
  ]);
  return stateOf(players);
}
const visState = visibilityState();
const visFrame = perceive({ state: visState }, ctxOf("p-owner"));
const visFrameHiddenHuge = perceive({ state: visibilityState({ hiddenBarrier: 1e39 }) }, ctxOf("p-owner"));
const visFrameFarHuge = perceive({ state: visibilityState({ farBarrier: 1e39 }) }, ctxOf("p-owner"));
const visFrameNoSight = perceive({ state: visState }, ctxOf("p-owner", { canSee: () => false }));
const visIds = visFrame.fighters.map((f: any) => f.id);
const hiddenIdMentions = (JSON.stringify(visFrame).match(/p-hidden/g) ?? []).length;
const farIdMentions = (JSON.stringify(visFrame).match(/p-far/g) ?? []).length;
function fighterWitness(frame: any): unknown {
  return frame.fighters.map((f: any) => ({ id: f.id, hpFrac: tag(f.hpFrac), barrierFrac: tag(f.barrierFrac) }));
}
const visibility = {
  format: FORMAT,
  corpus: "actual perceive() barrier visibility controls and the owner/bot/ring distinctness matrix",
  provenance: {
    perceive: "packages/server/src/bots/brain/perception.ts perceive",
    visibility: "the player loop skips self, rows outside inView(...FRAME_MARGIN) and rows with EFFECT_HIDDEN (256); the owner self row is always projected",
    note: "Declared source-schema StateLike rows; every listed output is the actual frame value.",
  },
  declared: {
    ownerBarrier: tag(VIS_BARRIER),
    visibleBarrier: tag(VIS_BARRIER),
    hiddenBarrier: tag(VIS_BARRIER),
    farBarrier: tag(VIS_BARRIER),
    hiddenEffects: 256,
    farPosition: { x: 5000, y: 5000 },
    ownerPosition: { x: 0, y: 0 },
  },
  controls: {
    visible: {
      selfBarrier: tag(visFrame.self.barrier),
      fighterIds: visIds,
      fighters: fighterWitness(visFrame),
      effectsIds: Object.keys(visFrame.extras.effects ?? {}).sort(),
    },
    hidden: {
      id: "p-hidden",
      inFighters: visIds.includes("p-hidden"),
      inExtrasEffects: Object.keys(visFrame.extras.effects ?? {}).includes("p-hidden"),
      idMentionsInFrameJson: hiddenIdMentions,
      actorBarrierFact: visFrame.fighters.some((f: any) => f.id === "p-hidden" && "barrierFrac" in f),
      stillStoredInState: tag((visState.players as Map<string, any>).get("p-hidden").barrier),
      sameFrameWhenHiddenBarrierIs1e39: JSON.stringify(visFrame) === JSON.stringify(visFrameHiddenHuge),
      hudAliveStillCounts: visFrame.hud.alive,
    },
    outOfFrame: {
      id: "p-far",
      inFighters: visIds.includes("p-far"),
      inExtrasEffects: Object.keys(visFrame.extras.effects ?? {}).includes("p-far"),
      idMentionsInFrameJson: farIdMentions,
      actorBarrierFact: visFrame.fighters.some((f: any) => f.id === "p-far" && "barrierFrac" in f),
      stillStoredInState: tag((visState.players as Map<string, any>).get("p-far").barrier),
      sameFrameWhenFarBarrierIs1e39: JSON.stringify(visFrame) === JSON.stringify(visFrameFarHuge),
      hudAliveStillCounts: visFrame.hud.alive,
    },
    personalVisionDenied: {
      canSee: false,
      fighterIds: visFrameNoSight.fighters.map((f: any) => f.id),
      selfBarrier: tag(visFrameNoSight.self.barrier),
      note: "the owner self barrier is still projected; other fighters require sight",
    },
  },
  distinctness: {
    label: "owner continuous shares vs source bot quantized twentieths vs the human ring",
    note: "These are three different outputs: the owner bar uses hpBarFractions with the barrier as decoded f32 and no quantization; the bot share adds Math.fround on all three inputs and quantizes each share to twentieths with a positive sliver; the ring normalizes the barrier by 0.3 x maxHp, caps at 1 and rounds to eight steps. They are not interchangeable.",
    cases: ([
      { name: "ordinary-75", hp: 100, maxHp: 100, barrier: 75 },
      { name: "tiny-0.075", hp: 100, maxHp: 100, barrier: 0.075 },
      { name: "half-quant-0.025", hp: 100, maxHp: 100, barrier: 0.025 },
      { name: "ordinary-5", hp: 100, maxHp: 100, barrier: 5 },
      { name: "overfull-50", hp: 100, maxHp: 100, barrier: 50 },
      { name: "owner-overheal", hp: 120, maxHp: 100, barrier: 30 },
    ] as Array<{ name: string; hp: number; maxHp: number; barrier: number }>).map((c) => {
      const owner = hpBarFractions(c.hp, c.maxHp, Math.fround(c.barrier));
      const state = stateOf(new Map<string, unknown>([
        ["p-owner", playerRow({ name: "Owner", x: 0, y: 0, hp: c.hp, maxHp: c.maxHp, barrier: c.barrier })],
        ["p-fighter", playerRow({ name: "Fighter", x: 100, y: 100, hp: c.hp, maxHp: c.maxHp, barrier: c.barrier })],
      ]));
      const frame = perceive({ state }, ctxOf("p-owner"));
      const bot = frame.fighters[0];
      const strength = barrierStrength(Math.fround(c.barrier), c.maxHp);
      let ringStep: number | null = null;
      let ringCalls: unknown[][] | null = null;
      if (PlayerView !== null) {
        const { recorder, calls } = makeRingRecorder();
        ringCall(recorder, calls, strength);
        ringStep = recorder.barrierStep;
        ringCalls = calls;
      }
      const botSum = bot.hpFrac + bot.barrierFrac;
      return {
        name: c.name,
        declared: { hp: tag(c.hp), maxHp: tag(c.maxHp), barrier: tag(c.barrier) },
        ownerContinuous: {
          source: "hpBarFractions(hp, maxHp, Math.fround(barrier)) (the inputs HpBar.draw receives)",
          fractions: { hp: tag(owner.hp), barrier: tag(owner.barrier) },
        },
        botTwentieths: {
          source: "actual perceive fighterSeen: f32 inputs -> hpBarFractions -> barShare",
          hpFrac: tag(bot.hpFrac),
          barrierFrac: tag(bot.barrierFrac),
          independentlyRoundedSum: tag(botSum),
          sumExceedsOne: botSum > 1,
        },
        ring: PlayerView === null
          ? { blocked: playerViewError }
          : {
            source: "actual barrierStrength -> actual PlayerView.prototype.setBarrier",
            strength: tag(strength),
            step: tag(ringStep as number),
            calls: ringCalls,
          },
      };
    }),
  },
};
expectSource(visIds.includes("p-visible") && !visIds.includes("p-hidden") && !visIds.includes("p-far"), "only the visible fighter row is projected");

// =================================================================================================== write / check
const corpora: Record<string, Record<string, any>> = {
  "continuous-bars.json": continuous,
  "owner-fighter.json": ownerFighter,
  "schema-f32.json": schemaF32,
  "human-ring.json": humanRing,
  "npc-forms.json": npcForms,
  "visibility.json": visibility,
};
for (const name of OUTPUTS) assert(corpora[name], "corpus " + name);
const rendered = Object.fromEntries(OUTPUTS.map((name) => [name, finalize(corpora[name]!)]));
if (mode === "--write") {
  mkdirSync(outDir, { recursive: true });
  for (const name of OUTPUTS) writeFileSync(join(outDir, name), rendered[name]!);
  console.log("captured " + OUTPUTS.length + " corpora in " + outDir);
} else {
  let failed = 0;
  for (const name of OUTPUTS) {
    let actual: string;
    try {
      actual = readFileSync(join(outDir, name), "utf8");
    } catch (e) {
      console.error("MISSING " + name + ": " + String(e));
      failed++;
      continue;
    }
    if (actual === rendered[name]) {
      console.log("OK " + name + " " + Buffer.byteLength(actual) + " bytes " + sha256(actual));
    } else {
      failed++;
      const expected = rendered[name]!;
      let at = 0;
      while (at < expected.length && at < actual.length && expected[at] === actual[at]) at++;
      console.error("MISMATCH " + name + " at byte " + at + " expected=" + JSON.stringify(expected.slice(at, at + 80)) + " actual=" + JSON.stringify(actual.slice(at, at + 80)));
    }
  }
  if (failed > 0) process.exit(1);
  console.log("checked " + OUTPUTS.length + " corpora byte for byte");
}
