/**
 * P-WISH-PUBLIC-WITNESS-1 canonical actual-source capture.
 *
 * Every recorded value below is returned by the unchanged legacy TypeScript this witness imports:
 *   A r-input.json         RaidScene.prototype.castSlot.call(declaredReceiver, "wish")
 *   B queued-stock-clocks.json    tools/ability-fixtures/engine.mts run(): real enqueueClientMessage -> ordinary 50 ms step
 *   C fx-timing.json       the real FxChannel/PackFx batches of those runs, producer time kept separately
 *   D wishfx-endpoints.json WishFx.prototype.play/update with declared graphics/host recorders
 *   E perceive-wish.json   the real perceive() over declared projection states and the real packed batches of C
 *
 * Declared: setup rows/positions/config, host recorders, the R-input receiver, projection visibility. Actual: every
 * method/function return value, every emitted event and packed tuple, every clock read off the real world.
 * No production source is modified; nothing here is a real browser, DOM, keyboard, scene or Unity claim.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const IMAGE = "node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const IMAGE_DIGEST = "sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const FORMAT = "rh-wish-public-witness/1";
const OUTPUTS = ["r-input.json", "queued-stock-clocks.json", "fx-timing.json", "wishfx-endpoints.json", "perceive-wish.json"];

const args = process.argv.slice(2);
const mode = args[0];
if (mode !== "--write" && mode !== "--check") {
  console.error("usage: capture.mts --write <out-dir> --repo <repo-root> | --check <out-dir> --repo <repo-root>");
  process.exit(2);
}
const argMap: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) argMap[args[i]!] = args[i + 1] ?? "";
const outDir = resolve(argMap["--write"] ?? argMap["--check"] ?? "");
const repoRoot = resolve(argMap["--repo"] ?? ".");
assert.equal(process.version, "v22.23.4");
assert.equal(process.platform, "linux");
assert.equal(process.arch, "x64");
const RECORD_MODE = process.env.RH_WISH_PUBLIC_RECORD === "1";
/** Canonical captures assert structural invariants; mutant captures record them instead (the comparator is the check). */
const expectSource = (condition: any, message: string): void => { if (!RECORD_MODE) assert(condition, message); };

const sha256 = (data: any): string => createHash("sha256").update(data).digest("hex");
const repo = (p: string): string => join(repoRoot, p);
const shaFile = (p: string): string => sha256(readFileSync(repo(p)));
const isFile = (p: string): boolean => existsSync(repo(p)) && statSync(repo(p)).isFile();
const load = (p: string): Promise<any> => import(repo(p));
const plain = (v: any): any => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/** A declared deterministic clock: no wall-clock value enters a corpus. */
let clockNow = 10000;
Object.defineProperty(globalThis, "performance", { value: { now: () => clockNow }, configurable: true });
Math.random = () => { throw new Error("undeclared randomness"); };

/** JSON tag for numeric specials, so null never silently stands for a valid zero and a special is unambiguous. */
function num(v: any): any {
  if (typeof v !== "number") return v === undefined ? { tag: "absent" } : v;
  if (Number.isNaN(v)) return { tag: "NaN" };
  if (v === Infinity) return { tag: "+Inf" };
  if (v === -Infinity) return { tag: "-Inf" };
  if (Object.is(v, -0)) return { tag: "-0" };
  return v;
}
function numStats(values: number[]): any {
  const specials: any[] = [];
  values.forEach((v, i) => { const t = num(v); if (typeof t !== "number") specials.push({ index: i, value: t }); });
  return specials.length === 0 ? { specials: [] } : { specials };
}
/** A map of id -> [k, v] entries, for declared/actual Map-like state. */
function entries(map: any): any[] {
  if (map === null || map === undefined) return [];
  const out: any[] = [];
  if (typeof map.forEach === "function") map.forEach((v: any, k: any) => out.push([k, plain(v)]));
  return out;
}

// ------------------------------------------------------------------------------------------------------- source modules
const engine = await load("tools/ability-fixtures/engine.mts");
const casesMod = await load("tools/ability-fixtures/cases.mts");
const S = await import(repo("packages/shared/src/index.ts"));
const FxChannelMod = await load("packages/server/src/rooms/FxChannel.ts");
const perceptionMod = await load("packages/server/src/bots/brain/perception.ts");
const localPredictionMod = await load("packages/client/src/net/localPrediction.ts");
const abilitySlotMod = await load("packages/client/src/ui/abilitySlot.ts");
const raidSceneMod = await load("packages/client/src/scenes/RaidScene.ts");
const wishFxMod = await load("packages/client/src/render/WishFx.ts");
const projectionMod = await load("packages/client/src/render/projection.ts");

const { RaidScene } = raidSceneMod;
const { WishFx } = wishFxMod;
const { LocalPrediction } = localPredictionMod;
const { CooldownTracker, abilitySlotModel } = abilitySlotMod;
const { perceive } = perceptionMod;
const { FxChannel } = FxChannelMod;
const { makeMap, plain: enginePlain } = engine;
const { BODY_LIFT } = projectionMod;
const { Y_SCALE, EFFECT_HIDDEN, EFFECT_STUNNED, EFFECT_SILENCED } = S;

// ---------------------------------------------------------------------------------------------- internal source closure
const ENTRY_SOURCES = [
  "tools/wish-public-fixtures/capture.mts",
  "tools/ability-fixtures/engine.mts",
  "tools/ability-fixtures/cases.mts",
];
const IMPORT_RE = /(?:^|[;\n])\s*(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g;
const DYNAMIC_RE = /\b(?:import|load)\s*\(\s*["']([^"']+)["']/g;
const importsOf = (text: string): string[] => {
  const out: string[] = [];
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push(m[1]!);
  }
  return out;
};
const tryTs = (base: string): string | null => {
  for (const cand of [base, base + ".ts", base + ".tsx", base + ".mts", base.replace(/\.js$/, ".ts"), base + "/index.ts", base + "/index.tsx"]) {
    if (isFile(cand)) return cand;
  }
  return null;
};
function resolveSpecifier(fromRel: string, spec: string): { kind: "ts" | "style" | "external" | "unresolved" | "node" | "ignore"; path: string } {
  if (spec.startsWith("node:")) return { kind: "node", path: spec };
  if (spec === "../../packages/server/src/sim/") return { kind: "ignore", path: spec };
  if ((spec.endsWith(".ts") || spec.endsWith(".mts")) && isFile(spec)) return { kind: "ts", path: spec };
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
const nodeBuiltins = new Set<string>();
const unresolvedImports = new Set<string>();
const stack = [...ENTRY_SOURCES];
// engine.mts imports every installer named by any profile through a dynamic template, at module load: pin those actual files.
for (const name of new Set<string>([...Object.values(engine.profiles).flat() as string[]])) stack.push("packages/server/src/sim/" + name + ".ts");
stack.push("packages/server/src/sim/training.ts");
while (stack.length > 0) {
  const rel = stack.pop()!;
  if (!isFile(rel) || sourceFiles.has(rel)) continue;
  sourceFiles.add(rel);
  for (const spec of importsOf(readFileSync(repo(rel), "utf8"))) {
    const r = resolveSpecifier(rel, spec);
    if (r.kind === "ts") stack.push(r.path);
    else if (r.kind === "style") styleFiles.add(r.path);
    else if (r.kind === "node") nodeBuiltins.add(r.path);
    else if (r.kind === "external") externalImports.add(r.path);
    else if (r.kind === "ignore") continue;
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
function walk(dirRel: string): string[] {
  return readdirSync(repo(dirRel), { withFileTypes: true }).flatMap((d: any) => d.isDirectory() ? walk(dirRel + "/" + d.name) : [dirRel + "/" + d.name]);
}
const TOOL_DIR = "tools/wish-public-fixtures";
const toolFiles = walk(TOOL_DIR).filter((p) => !p.endsWith("/node_modules")).sort();
const toolPins = Object.fromEntries(toolFiles.filter((p) => p !== TOOL_DIR + "/capture.mts").map((p) => [p, shaFile(p)]));
toolPins[TOOL_DIR + "/capture.mts"] = shaFile(TOOL_DIR + "/capture.mts");
const toolSpecial: Record<string, string> = {};
for (const p of [TOOL_DIR + "/stub-loader.mjs", TOOL_DIR + "/compare.mjs", TOOL_DIR + "/apply-patch.mjs", TOOL_DIR + "/run-mutants.sh", TOOL_DIR + "/capture.sh"]) {
  if (isFile(p)) toolSpecial[p] = shaFile(p);
}
const dataPins = Object.fromEntries([
  "tools/ability-fixtures/engine.mts", "tools/ability-fixtures/cases.mts",
  "tools/ability-fixtures/seed1-input.json", "tools/ability-fixtures/born-input.json",
].map((p) => [p, { bytes: statSync(repo(p)).size, sha256: shaFile(p) }]));
const dependencyVersion = (name: string): any => {
  const p = "node_modules/" + name + "/package.json";
  return isFile(p) ? { version: JSON.parse(readFileSync(repo(p), "utf8")).version, packageLockSha256: shaFile("package-lock.json") } : { unavailable: true };
};
const profileBase: any = {
  format: FORMAT,
  runtime: "Node.js " + process.version + " linux/x64 (pinned container)",
  image: IMAGE,
  imageDigest: IMAGE_DIGEST,
  asserts: { node: "v22.23.4", platform: "linux", arch: "x64" },
  canonicalSerialization: "JSON.stringify(corpus) + \"\\n\"",
  configFiles: configPins,
  sourceClosure: {
    method: "static import/export + dynamic load/import literal graph from the entry list plus engine.mts profile installers",
    entrySources: ENTRY_SOURCES,
    sourceFileCount: Object.keys(sourceFileHashes).length,
    sourceFiles: sourceFileHashes,
  },
  styleFileCount: Object.keys(styleFileHashes).length,
  styleFiles: styleFileHashes,
  externalImports: [...externalImports].sort(),
  nodeBuiltins: [...nodeBuiltins].sort(),
  unresolvedImports: [...unresolvedImports].sort(),
  dependencies: {
    tsx: dependencyVersion("tsx"),
    esbuild: dependencyVersion("esbuild"),
    "@colyseus/schema": dependencyVersion("@colyseus/schema"),
    "@colyseus/sdk": dependencyVersion("@colyseus/sdk"),
    phaser: dependencyVersion("phaser"),
  },
  externalPackages: {
    phaser: "replaced by tools/wish-public-fixtures/stub-loader.mjs: a declared base class only (RaidScene declares extends Phaser.Scene at module evaluation); no game, scene, renderer, DOM or keyboard runs",
    "@colyseus/sdk": "imported by packages/client/src/net/connection.ts; only sendInput's room.send recorder path is exercised",
  },
  reusedHarness: dataPins,
  tool: toolPins,
  toolSpecial,
  declared: {
    note: "Inputs/projection/host recorders are declared. Actual outputs are the unchanged source's return values, emitted events, emitted clocks and packed batches. No expected post-cast state is injected.",
    clocks: "performance.now() is a declared deterministic clock; no wall-clock value is captured.",
    specials: "Numeric specials are tagged ({tag:'NaN'|'+Inf'|'-Inf'|'-0'|'absent'}); a plain null is only a genuinely optional/absent field, never a valid zero.",
    rInput: "RaidScene.prototype.castSlot is called on a plain declared receiver; no keyboard, DOM, scene, camera or pointer proof is claimed.",
    wishFx: "WishFx.prototype.play/update are called with declared graphics/host recorders; method-level only, not a scene render.",
    perceive: "perceive() runs over declared source-schema-shaped projection rows and real packed batches; human WishFx output is a separate corpus and is not claimed to equal perceive.",
  },
};
function finalize(corpus: any): string {
  corpus.profile = JSON.parse(JSON.stringify(profileBase));
  corpus.profile.captureSha256 = sha256(JSON.stringify(corpus));
  return JSON.stringify(corpus) + "\n";
}

// ============================================================================================= B/C: actual world runs
const wishFxKind = (e: any): boolean => e && typeof e === "object" && typeof e.kind === "string" && ["cast", "castLand", "castEnd", "status", "teleport"].includes(e.kind);
let batchSink: any[] | null = null;
const originalBatch = FxChannel.prototype.batch;
FxChannel.prototype.batch = function (fxs: any, t: number, projectiles: any): any {
  const out = originalBatch.call(this, fxs, t, projectiles);
  if (batchSink !== null) {
    batchSink.push({
      t,
      fxs: JSON.parse(JSON.stringify([...fxs])),
      batch: out === null || out === undefined ? null : JSON.parse(JSON.stringify(out)),
      roster: [...(this as any).sent.entries()],
    });
  }
  return out;
};
function runCase(input: any): any {
  const sink: any[] = [];
  batchSink = sink;
  let trace: any;
  try {
    trace = engine.run(input);
  } finally {
    batchSink = null;
  }
  return { input, trace, batches: sink };
}

const P = (faction: string, x = 300, y = 320, extra: any = {}): any => ({ faction, at: { x, y }, ...extra });
const C = (actor: string, point: any = { x: 0, y: 0 }, id?: string, extra: any = {}): any => ({ actor, type: "cast", payload: { slot: "wish", point, ...(id ? { id } : {}), ...extra } });
const step = (...inputs: any[]): any => ({ kind: "step", inputs });
const span = (count: number, snapshots: number[] = []): any => ({ kind: "span", count, snapshots });
const caseByName = (name: string): any => casesMod.cases.find((c: any) => c.name === name);

// Declared scenarios (same closed declarative action shape as the reused actual corpus; no expected poststate).
const teleportRefundInput: any = {
  name: "wish-teleport-refunds-pending-freeze", map: "room", profile: "core", mainSeed: 12, rewardSalt: [1, 2, 3, 4],
  players: [P("frost", 300, 320), P("fire", 450, 320), P("holy", 1100, 600)],
  config: { firstPatienceSeconds: 0.25 },
  actions: [step(C("p0", { x: 450, y: 320 }, "p1")), span(8, [1, 2, 3, 4, 5, 6, 7, 8])],
};
const betweenStepRemoveInput: any = {
  name: "wish-between-step-leave-cancels-pending-freeze", map: "room", profile: "core", mainSeed: 12, rewardSalt: [1, 2, 3, 4],
  players: [P("frost", 300, 320), P("fire", 450, 320), P("holy", 1100, 600)],
  actions: [step(C("p0", { x: 450, y: 320 }, "p1")), { kind: "remove", actor: "p0" }, span(3, [1, 2, 3])],
};
const trainingBlazeInput: any = {
  name: "wish-training-blaze-two-charge-clock-cut", map: "room", profile: "training", mainSeed: 12, rewardSalt: [1, 2, 3, 4],
  config: { training: true, dummies: true },
  players: [P("fire", 300, 320)],
  actions: [step(C("p0", { x: 400, y: 320 })), span(99, [1, 98, 99]), step(C("p0", { x: 800, y: 320 })), span(101, [1, 2, 100, 101])],
};

const RUN_CASES: any[] = [
  { id: "opening-lock", provenance: "reused actual case", input: caseByName("normal-45s-lock-ready-boundary") },
  { id: "all-five", provenance: "reused actual case", input: caseByName("all-five-normal-cooldowns-and-blaze-stocks") },
  { id: "interruption", provenance: "reused actual case", input: caseByName("freeze-interrupt-spends-without-refund") },
  { id: "fizzle", provenance: "reused actual case", input: caseByName("freeze-moving-target-fizzle") },
  { id: "reciprocal", provenance: "reused actual case", input: caseByName("atomic-reciprocal-freezes-12") },
  { id: "training-swarm", provenance: "reused actual case", input: caseByName("training-swarm-real-five-second-recast-replacement") },
  { id: "teleport-refund", provenance: "declared scenario, actual ordinary 50 ms execution", input: teleportRefundInput },
  { id: "between-step-remove", provenance: "declared scenario (room leave call), actual ordinary 50 ms execution", input: betweenStepRemoveInput },
  { id: "training-blaze", provenance: "declared scenario, actual ordinary 50 ms execution", input: trainingBlazeInput },
];
const runs: Record<string, any> = {};
for (const c of RUN_CASES) {
  if (!c.input) throw new Error("missing reused case " + c.id);
  runs[c.id] = runCase(c.input);
  runs[c.id].id = c.id;
  runs[c.id].provenance = c.provenance;
}

// ----------------------------------------------------------------------------------------------- stock-clock projection
const ABILITY_BY_CAST: Record<string, string> = { freeze: "freeze", swarm: "swarm", trial: "trial", blaze: "blaze", lastStand: "lastStand" };
function abilityOf(pub: any): any {
  const entry = S.abilityInSlot(pub, "wish");
  return entry ? entry.def : null;
}
function cooldownOf(def: any, training: boolean): number {
  return S.abilityCooldownMs(def, 1, { training, wishCooldownMult: 1 });
}
function projectPlayer(pub: any, priv: any, time: number, training: boolean): any {
  const def = abilityOf(pub);
  if (!def) return { present: true, faction: pub.faction, status: pub.status, effects: num(pub.effects), ability: null, wishReadyAt: num(pub.wishReadyAt), slotReadyAt: num(S.slotReadyAt(pub, "wish")), wishFullAt: num(pub.extra?.wishFullAt), maxCharges: 1, rechargeMs: 0, chargesAt: 0, nextChargeAt: 0, cast: priv?.cast ? projectCast(priv.cast) : null };
  const max = S.maxCharges(def, 1);
  const rechargeMs = cooldownOf(def, training);
  const fullAt = pub.extra?.wishFullAt ?? 0;
  return {
    present: true,
    faction: pub.faction,
    status: pub.status,
    effects: num(pub.effects),
    ability: def.id,
    wishReadyAt: num(pub.wishReadyAt),
    slotReadyAt: num(S.slotReadyAt(pub, "wish")),
    wishFullAt: num(fullAt),
    maxCharges: max,
    rechargeMs,
    chargesAt: num(S.chargesAt(fullAt, time, max, rechargeMs)),
    nextChargeAt: num(S.nextChargeAt(fullAt, time, max, rechargeMs)),
    cast: priv?.cast ? projectCast(priv.cast) : null,
    castState: priv?.cast ? "pending" : "none",
  };
}
function projectCast(cast: any): any {
  return {
    ability: cast.ability,
    rank: cast.rank,
    slot: cast.slot,
    startedAt: num(cast.startedAt),
    landsAt: num(cast.landsAt),
    target: cast.target,
    point: { x: num(cast.point?.x), y: num(cast.point?.y) },
    landing: cast.landing ? { x: num(cast.landing.x), y: num(cast.landing.y) } : null,
    prevReadyAt: num(cast.prevReadyAt),
    prevFullAt: num(cast.prevFullAt),
    lagMs: num(cast.lagMs),
  };
}
function traceFrames(run: any): any[] {
  const out: any[] = [];
  const push = (f: any) => {
    out.push({
      label: f.label,
      time: num(f.time),
      tick: f.tick,
      phase: f.phase,
      reason: f.reason ?? null,
      relativeStep: f.relativeStep ?? null,
      events: (f.events ?? []).filter((e: any) => e.type === "fx").map((e: any) => e.fx),
      otherEvents: (f.events ?? []).filter((e: any) => e.type !== "fx").map((e: any) => e.type),
      public: f.public,
      private: f.private,
    });
  };
  push(run.trace.birth);
  for (const t of run.trace.timeline) {
    if (t && Array.isArray(t.frames)) t.frames.forEach(push);
    else push(t);
  }
  return out;
}
function framePlayers(run: any, frame: any): any[] {
  const ids = [...new Set([...frame.public.players.map((p: any) => p.id)])];
  return ids.map((id: string) => {
    const pub = frame.public.players.find((p: any) => p.id === id)?.state;
    const priv = frame.private.players.find((p: any) => p.id === id);
    return { id, ...projectPlayer(pub, priv, frame.time, run.input.config?.training === true || run.input.profile === "training") };
  });
}
function stockCase(run: any): any {
  const frames = traceFrames(run);
  const frameRows = frames.map((f: any) => ({
    label: f.label, time: f.time, tick: f.tick, phase: f.phase, reason: f.reason, relativeStep: f.relativeStep,
    events: f.events, otherEvents: f.otherEvents,
    players: framePlayers(run, f),
  }));
  const hooks = run.trace.completeOrdinaryHookTape
    .flatMap((tape: any) => tape.hooks.map((h: any) => ({ ...h, tapeTick: tape.tick, tapeTime: tape.time })))
    .filter((h: any) => h.hook === "castAccepted" || h.hook === "castEnded")
    .map((h: any) => ({
      hook: h.hook, time: num(h.time), tick: h.tick, actor: h.actor ?? null, ability: h.ability ?? null, reason: typeof h.reason === "string" ? h.reason : null,
      wishReadyAt: num(h.wishReadyAt), wishFullAt: num(h.wishFullAt), cast: h.cast ? projectCast(h.cast) : null,
    }));
  const events = run.trace.completeNonemptyEventTape
    .filter((e: any) => e.events.some((x: any) => x.type === "fx" && ["cast", "castLand", "castEnd", "teleport"].includes(x.fx.kind)))
    .map((e: any) => ({ tick: e.tick, time: num(e.time), betweenSteps: e.betweenSteps === true, fxs: e.events.filter((x: any) => x.type === "fx" && ["cast", "castLand", "castEnd", "teleport"].includes(x.fx.kind)).map((x: any) => x.fx) }));
  return {
    id: run.id,
    provenance: run.provenance,
    input: run.input,
    ordinarySteps: run.trace.ordinarySteps,
    settledAt: { tick: run.trace.final.tick, time: num(run.trace.final.time) },
    frames: frameRows,
    hooks,
    wishEvents: events,
    batchCount: run.batches.length,
    wishBatchCount: run.batches.filter((b: any) => b.batch && b.batch.l.some((tuple: any) => tuple[0] === 14 || tuple[0] === 15 || tuple[0] === 16)).length,
  };
}
const stockCases = RUN_CASES.map((c) => stockCase(runs[c.id]));

// ------------------------------------------------------------------------------------------------------------ B facts
const findFrame = (run: any, label: string): any => traceFrames(run).find((f: any) => f.label === label);
const findFrameAt = (run: any, time: number): any => traceFrames(run).filter((f: any) => f.time === time).at(-1);
const playerRow = (run: any, frame: any, id: string): any => {
  if (!frame) return null;
  return framePlayers(run, frame).find((p: any) => p.id === id) ?? { id, removedFromState: true };
};
const hookRows = (run: any, actor: string): any[] => runs[run].trace.completeOrdinaryHookTape
  .flatMap((tape: any) => tape.hooks.map((h: any) => ({ ...h, tapeTick: tape.tick, tapeTime: tape.time })))
  .filter((h: any) => h.actor === actor)
  .map((h: any) => ({
  hook: h.hook, time: num(h.time), tick: h.tick, ability: h.ability ?? null, reason: typeof h.reason === "string" ? h.reason : null, tapeTime: num(h.tapeTime),
  wishReadyAt: num(h.wishReadyAt), wishFullAt: num(h.wishFullAt), cast: h.cast ? projectCast(h.cast) : null,
}));
const facts: any = {};
{
  const run = runs["opening-lock"];
  const birth = findFrame(run, "raid-and-birth-before-bootstrap");
  const p0 = playerRow(run, birth, "p0");
  const lock = run.input.config?.wishLockSeconds;
  facts.openingLock = {
    provenance: "actual birth snapshot + declared config, relation derived",
    raidStartedAt: num(birth.public.raidStartedAt),
    wishLockSeconds: lock,
    observedWishReadyAt: p0.wishReadyAt,
    observedMinusRaidStartedAt: typeof p0.wishReadyAt === "number" && typeof birth.public.raidStartedAt === "number" ? p0.wishReadyAt - birth.public.raidStartedAt : null,
    derivedLockMs: lock * 1000,
    matches: typeof p0.wishReadyAt === "number" ? p0.wishReadyAt === birth.public.raidStartedAt + lock * 1000 : false,
    refusalDoesNotSpend: (() => { const before = findFrameAt(run, 45000); const after = findFrameAt(run, 45050); const b = playerRow(run, before, "p0"); const a = playerRow(run, after, "p0"); return b && a ? b.wishReadyAt === p0.wishReadyAt && a.wishReadyAt !== p0.wishReadyAt : null; })(),
    boundary: {
      beforeAcceptedAt: num(findFrameAt(run, 45000)?.time ?? null),
      acceptedAt: num(findFrameAt(run, 45050)?.time ?? null),
      beforeAcceptedReadyAt: playerRow(run, findFrameAt(run, 45000), "p0")?.wishReadyAt ?? null,
      acceptedReadyAt: playerRow(run, findFrameAt(run, 45050), "p0")?.wishReadyAt ?? null,
    },
    hooks: hookRows("opening-lock", "p0"),
  };
}
{
  const run = runs["all-five"];
  const times = [30050, 30100, 60050, 60100, 120050, 120100, 180500];
  const rows = times.map((t) => {
    const f = findFrameAt(run, t);
    const p3 = playerRow(run, f, "p3");
    return { label: f?.label ?? null, time: num(t), tick: f?.tick ?? null, raw: p3, helper: p3 && typeof p3.wishFullAt === "number" ? { chargesAt: p3.chargesAt, nextChargeAt: p3.nextChargeAt, rechargeMs: p3.rechargeMs, maxCharges: p3.maxCharges } : null };
  });
  facts.blazeStock = {
    provenance: "actual all-five frames + accepted-cast hook arguments; helpers are actual chargesAt/nextChargeAt over the observed clocks",
    acceptedCasts: hookRows("all-five", "p3").filter((h: any) => h.hook === "castAccepted"),
    boundaryRows: rows,
    preThirdCastBoundary: rows[0] ? { observedAt: rows[0].time, wishFullAt: rows[0].raw?.wishFullAt, wishReadyAt: rows[0].raw?.wishReadyAt } : null,
  };
}
{
  const run = runs["interruption"];
  const iHooks = hookRows("interruption", "p1");
  const iAccept = iHooks.find((h: any) => h.hook === "castAccepted");
  const iEnd = iHooks.find((h: any) => h.hook === "castEnded");
  facts.interruption = {
    provenance: "actual interruption case",
    p0: { hooks: hookRows("interruption", "p0") },
    p1: { hooks: iHooks, at100: playerRow(run, findFrameAt(run, 100), "p1"), at150: playerRow(run, findFrameAt(run, 150), "p1"), at350: playerRow(run, findFrameAt(run, 350), "p1") },
    derived: {
      reason: iEnd?.reason ?? null,
      cooldownSpent: iAccept && iEnd ? iAccept.wishReadyAt !== iAccept.cast?.prevReadyAt : null,
      refunded: iAccept && iEnd ? iEnd.wishReadyAt !== iAccept.wishReadyAt : null,
      spentWithoutRefund: iAccept && iEnd ? iEnd.wishReadyAt === iAccept.wishReadyAt && iAccept.cast?.prevReadyAt !== iAccept.wishReadyAt : null,
    },
  };
  const fr = runs["fizzle"];
  const fHooks = hookRows("fizzle", "p0");
  const fAccept = fHooks.find((h: any) => h.hook === "castAccepted");
  const fEnd = fHooks.find((h: any) => h.hook === "castEnded");
  facts.fizzle = {
    provenance: "actual freeze-moving-target-fizzle case",
    p0: { hooks: fHooks, at100: playerRow(fr, findFrameAt(fr, 100), "p0"), at350: playerRow(fr, findFrameAt(fr, 350), "p0") },
    derived: {
      reason: fEnd?.reason ?? null,
      spentWithoutRefund: fAccept && fEnd ? fEnd.wishReadyAt === fAccept.wishReadyAt && fAccept.cast?.prevReadyAt !== fAccept.wishReadyAt : null,
    },
  };
}
{
  const run = runs["teleport-refund"];
  const t100 = playerRow(run, findFrameAt(run, 100), "p0");
  const t300 = playerRow(run, findFrameAt(run, 300), "p0");
  facts.teleportRefund = {
    provenance: "actual run: pending freeze is refunded by the arena teleport hook (clearAll)",
    at100: t100,
    at300: t300,
    at350: playerRow(run, findFrameAt(run, 350), "p0"),
    p0Hooks: hookRows("teleport-refund", "p0"),
    derived: { refundRestoredReadyClock: t100 && t300 && t100.cast ? t300.wishReadyAt === t100.cast.prevReadyAt : null, refundRestoredStockClock: t100 && t300 && t100.cast ? t300.wishFullAt === t100.cast.prevFullAt : null, cancelledCastEnd: stockCase(run).wishEvents.some((e: any) => e.fxs.some((fx: any) => fx.kind === "castEnd" && fx.reason === "cancelled")) },
    teleportEvents: stockCase(run).wishEvents.filter((e: any) => e.fxs.some((fx: any) => fx.kind === "teleport") || e.fxs.some((fx: any) => fx.kind === "castEnd")),
  };
}
{
  const run = runs["between-step-remove"];
  facts.betweenStepCancellation = {
    provenance: "actual removePlayer/clearFighter/cancelCast path called between ordinary steps by the room-leave call",
    eventTape: stockCase(run).wishEvents.filter((e: any) => e.fxs.some((fx: any) => fx.kind === "castEnd")),
    hooks: hookRows("between-step-remove", "p0"),
  };
}
{
  const run = runs["training-swarm"];
  const birth = findFrame(run, "raid-and-birth-before-bootstrap");
  facts.training = {
    provenance: "actual training profile: training flag cuts the Wish cooldown to TRAINING_WISH_COOLDOWN_SECONDS",
    swarm: {
      raidStartedAt: num(birth.public.raidStartedAt),
      wishReadyAtAtBirth: playerRow(run, birth, "p0")?.wishReadyAt ?? null,
      accepted: hookRows("training-swarm", "p0"),
      at5100: playerRow(run, findFrameAt(run, 5100), "p0"),
      derived: { trainingRechargeMs: playerRow(run, findFrameAt(run, 5100), "p0")?.rechargeMs ?? null, acceptedGapMs: (() => { const a = hookRows("training-swarm", "p0").filter((h: any) => h.hook === "castAccepted"); return a.length >= 2 ? a[1].time - a[0].time : null; })() },
    },
    blaze: (() => {
      const b = runs["training-blaze"];
      const bb = findFrame(b, "raid-and-birth-before-bootstrap");
      return {
        raidStartedAt: num(bb.public.raidStartedAt),
        wishReadyAtAtBirth: playerRow(b, bb, "p0")?.wishReadyAt ?? null,
        accepted: hookRows("training-blaze", "p0"),
        at100: playerRow(b, findFrameAt(b, 100), "p0"),
        at5100: playerRow(b, findFrameAt(b, 5100), "p0"),
        at10100: playerRow(b, findFrameAt(b, 10100), "p0"),
        derived: { trainingRechargeMs: playerRow(b, findFrameAt(b, 100), "p0")?.rechargeMs ?? null, acceptedGapMs: (() => { const a = hookRows("training-blaze", "p0").filter((h: any) => h.hook === "castAccepted"); return a.length >= 2 ? a[1].time - a[0].time : null; })() },
      };
    })(),
  };
}
const stockCorpus: any = {
  format: FORMAT,
  role: "B. ordinary queued execution and owner Wish stock clocks from actual runs (all-five player-only worlds, no mobs; training is its own actual profile)",
  declared: {
    setup: "Player factions/positions/config and the closed declarative action arrays are declared. Existing cases are reused by name from tools/ability-fixtures/cases.mts; the three custom scenarios are declared with the same action shape.",
    helpers: "chargesAt/nextChargeAt/abilityCooldownMs/maxCharges/slotReadyAt are the actual shared helpers called over the clock values the actual world emitted; they are labelled as helper output next to the raw s.wishReadyAt/s.extra.wishFullAt.",
    noInjection: "No expected post-cast state is written: frames/hooks/events are copies of the actual run.",
  },
  cases: stockCases,
  facts,
};

// ================================================================================================== C: FX timing
function pairBatches(run: any): any[] {
  const out: any[] = [];
  const used = new Set<number>();
  for (const entry of run.trace.completeNonemptyEventTape) {
    const fxs = entry.events.filter((e: any) => e.type === "fx").map((e: any) => e.fx);
    if (!fxs.some(wishFxKind)) continue;
    const key = JSON.stringify(fxs);
    const index = run.batches.findIndex((b: any, i: number) => !used.has(i) && b.t === entry.time && JSON.stringify(b.fxs) === key);
    if (index < 0) continue;
    used.add(index);
    const b = run.batches[index];
    out.push({ entry, batch: b, index });
  }
  return out;
}
const C_BATCHES: any[] = [];
for (const c of RUN_CASES) {
  const run = runs[c.id];
  for (const pair of pairBatches(run)) {
    const id = c.id + "-" + (C_BATCHES.filter((x: any) => x.case === c.id).length + 1);
    const roster = pair.batch.roster;
    const rosterArray = roster.map((r: any) => r[0]);
    const unpacked = pair.batch.batch ? S.unpackFx(pair.batch.batch, rosterArray) : [];
    C_BATCHES.push({
      id,
      case: c.id,
      provenance: c.provenance,
      producer: {
        tick: pair.entry.tick,
        time: num(pair.entry.time),
        betweenSteps: pair.entry.betweenSteps === true,
        events: pair.entry.events.filter((e: any) => e.type === "fx").map((e: any) => ({ producerTime: num(pair.entry.time), fx: e.fx })),
      },
      batchTime: num(pair.batch.batch?.t ?? null),
      batchTimeEqualsProducerTime: pair.batch.batch?.t === pair.entry.time,
      roster,
      batch: pair.batch.batch,
      unpacked,
      tupleKinds: pair.batch.batch ? pair.batch.batch.l.map((tuple: any) => tuple[0]) : [],
    });
  }
}
const batchById = (id: string): any => C_BATCHES.find((b: any) => b.id === id);
function eventOf(batchId: string, kind: string, ability?: string): any {
  const b = batchById(batchId);
  if (!b) throw new Error("unknown batch " + batchId);
  const index = b.unpacked.findIndex((e: any) => e.kind === kind && (ability === undefined || e.ability === ability));
  if (index < 0) throw new Error("no " + kind + "/" + (ability ?? "*") + " in " + batchId);
  return { batch: b, index, event: b.unpacked[index] };
}
const instantAbilities = ["blaze", "lastStand"];
const instantStarted = C_BATCHES.flatMap((b: any) => b.producer.events.filter((e: any) => e.fx.kind === "cast" && instantAbilities.includes(e.fx.ability)).map((e: any) => ({ batch: b.id, fx: e.fx })));
const sameTickLands = C_BATCHES.map((b: any) => ({ id: b.id, castLand: b.producer.events.filter((e: any) => e.fx.kind === "castLand").length, kinds: b.producer.events.map((e: any) => e.fx.kind + ":" + (e.fx.ability ?? "")) })).filter((x: any) => x.castLand >= 2);
const betweenStepBatches = C_BATCHES.filter((b: any) => b.producer.betweenSteps);
const fxCorpus: any = {
  format: FORMAT,
  role: "C. actual FxChannel pack/batch timing of Wish events, producer emission world time kept separately",
  declared: {
    batches: "Each entry pairs the actual nonempty event tape entry of an actual run with the actual FxChannel.batch call that the harness made at that presentation point (roster/patch order as the room does), and decodes it with the actual unpackFx and roster.",
    time: "producerTime is world.state.serverTime when the events were captured; batchTime is the t of the actual packed FxBatch. They are recorded separately and not forced equal.",
    instant: "An instant Wish (castMs 0) emits no cast/started event; only its landing is emitted.",
  },
  batches: C_BATCHES,
  findings: {
    derivedFromActual: true,
    instantWishStartedEvents: instantStarted,
    instantWishStartedEventCount: instantStarted.length,
    sameTickMultiLandBatches: sameTickLands,
    betweenStepBatches: betweenStepBatches.map((b: any) => b.id),
    producerEqualsBatchTimeEverywhere: C_BATCHES.every((b: any) => b.batchTimeEqualsProducerTime),
    batchTimeNote: "In this legacy room path the harness presents after step(), so world.state.serverTime is both the producer capture time and the packed batch t. A real difference is not prevented by the witness; none occurred here.",
    betweenStepPath: betweenStepBatches.length > 0
      ? { available: true, batches: betweenStepBatches.map((b: any) => b.id), path: "removePlayer (room leave) between ordinary steps -> downPlayer -> clearFighter -> cancelCast", note: "The declared removal call is the room's leave path; no synthetic between-step producer was invented." }
      : { available: false, note: "No actual between-step cancellation path was reachable in this legacy fixture profile." },
  },
};

// ================================================================================================== A: R-input
const ROW_TEMPLATE = (over: any): any => ({
  id: over.id, name: over.name ?? over.id, faction: over.faction, x: over.x, y: over.y, facing: over.facing ?? 0,
  status: over.status ?? "alive", hp: over.hp ?? 100, maxHp: over.maxHp ?? 100, barrier: 0, effects: over.effects ?? 0,
  wishReadyAt: over.wishReadyAt ?? 0, qReadyAt: 0, eReadyAt: 0, build: over.build ?? new Map(), slot: 0,
  weapon0: "sword", weapon1: "", immuneUntil: over.immuneUntil ?? 0, moveSeq: 0,
  extra: { wishFullAt: over.wishFullAt ?? 0 },
});
const R_MAP_CACHE: Record<string, any> = {};
function rMap(walls: any[]): any {
  const key = JSON.stringify(walls ?? []);
  if (!R_MAP_CACHE[key]) R_MAP_CACHE[key] = makeMap({ map: "room", room: { w: 40, h: 24, walls: walls ?? [] } });
  return R_MAP_CACHE[key];
}
function localClockAt(serverTime: number, drift: number): number { return serverTime + drift; }

function runRProbe(decl: any): any {
  clockNow = decl.now ?? 10000;
  const serverTime = decl.serverTime;
  const me = ROW_TEMPLATE(decl.me);
  const target = decl.target ? ROW_TEMPLATE(decl.target) : null;
  const players = new Map<string, any>([["p0", me]]);
  if (target) players.set(target.id, target);
  const rendered = new Map<string, any>([["p0", decl.self ?? { x: me.x, y: me.y }]]);
  if (target) rendered.set(target.id, { x: target.x, y: target.y });
  const state = {
    phase: decl.phase ?? "active", training: decl.training ?? false, serverTime, gatesLocked: false,
    players, mobs: new Map(),
  };
  const map = rMap(decl.walls);
  const sent: any[] = [];
  const record: any = {
    slotInput: [], noteCast: [], predictCast: [], afterCast: [], deny: [], cooldownObserve: [], slotViewCalls: 0, seqs: [],
  };
  const predict = new LocalPrediction();
  const originalNoteCast = predict.noteCast.bind(predict);
  predict.noteCast = (c: number, cast: any) => {
    record.noteCast.push(plain({ c: num(c), cast }));
    originalNoteCast(c, cast);
  };
  const pointer = {
    x: decl.pointer ? decl.pointer.x : 0,
    y: decl.pointer ? decl.pointer.y * Y_SCALE - BODY_LIFT : 0,
    worldX: decl.pointer ? decl.pointer.x : 0,
    worldY: decl.pointer ? decl.pointer.y * Y_SCALE : 0,
    updateWorldPoint(): void {},
  };
  const tracker = new CooldownTracker();
  const view = { deny: (text: string, now: number) => record.deny.push({ text, now: num(now) }) };
  const receiver: any = {
    room: {
      state, sessionId: "p0", reconnection: { isReconnecting: decl.reconnecting === true },
      send: (type: string, payload: any) => sent.push({ type, payload: JSON.parse(JSON.stringify(payload)) }),
    },
    predict,
    rendered,
    candidates: [],
    mapView: { map },
    input: { isOver: decl.isOver !== false, activePointer: pointer },
    cameras: { main: { scrollX: 0, scrollY: 0, width: 1280, height: 800, zoom: 1 } },
    interp: { clock: { synced: decl.clockSynced === true, now: () => localClockAt(serverTime, decl.clockDrift ?? 0) } },
    clockSynced: decl.clockSynced === true,
    renderT: decl.renderT ?? serverTime,
    teleportAt: decl.teleportAt ?? 0,
    peek: decl.peek ?? null,
    aimKnown: decl.aimKnown !== false,
    pendingCast: decl.pendingCast ? { ...decl.pendingCast } : null,
    slotCooldown: () => ({ observe: (readyAt: number, patchT: number) => { const v = tracker.observe(readyAt, patchT); record.cooldownObserve.push({ readyAt: num(readyAt), patchT: num(patchT), value: num(v) }); return v; } }),
    slotView: () => { record.slotViewCalls++; return decl.view === false ? undefined : view; },
    afterCast: (...a: any[]) => record.afterCast.push({ def: a[0]?.id ?? null, castMs: num(a[1]), c: num(a[2]), now: num(a[3]) }),
    wishFx: { predictCast: (spec: any, now: number) => record.predictCast.push({ spec: plain(spec), now: num(now) }) },
  };
  const actualSlotInput = RaidScene.prototype.slotInput;
  receiver.slotInput = function (...a: any[]): any {
    const out = actualSlotInput.apply(this, a);
    record.slotInput.push({
      phase: out.phase, training: out.training, alive: out.alive, ability: out.ability?.id ?? null, rank: out.rank ?? null,
      readyAt: num(out.readyAt), fullAt: num(out.fullAt), cooldownLen: num(out.cooldownLen), effects: num(out.effects),
      blockedBy: [...(out.blockedBy ?? [])], castUntil: num(out.castUntil), wishCooldownMult: num(out.wishCooldownMult),
    });
    return out;
  };
  receiver.cursorGround = RaidScene.prototype.cursorGround;
  receiver.targetCandidates = RaidScene.prototype.targetCandidates;
  receiver.planMap = RaidScene.prototype.planMap;
  receiver.localClock = RaidScene.prototype.localClock;
  receiver.beforeTeleport = RaidScene.prototype.beforeTeleport;
  const frozenGetter = Object.getOwnPropertyDescriptor(RaidScene.prototype, "frozenWorld")?.get;
  if (frozenGetter) Object.defineProperty(receiver, "frozenWorld", { get: () => frozenGetter.call(receiver) });
  if (decl.pendingCast) predict.motion.orderPending = () => decl.pendingCast.orderPending === true;
  let thrown: any = null;
  try {
    RaidScene.prototype.castSlot.call(receiver, "wish");
  } catch (e: any) {
    thrown = String(e?.stack ?? e).slice(0, 2000);
  }
  const slotInput = record.slotInput[0] ?? null;
  const model = slotInput ? abilitySlotModel({ ...slotInput, ability: S.abilityInSlot(me, "wish")?.def ?? null, rank: 1 }, decl.clockSynced ? localClockAt(serverTime, decl.clockDrift ?? 0) : serverTime) : null;
  const actualAim = decl.pointer ?? (decl.me && (decl.me.faction === "plague" || decl.me.faction === "holy") ? { x: me.x, y: me.y } : null);
  const graceProbe = decl.teleportAt > 0 ? localPredictionMod.inTeleportGrace(decl.teleportAt, decl.clockSynced ? localClockAt(serverTime, decl.clockDrift ?? 0) : serverTime) : false;
  return {
    id: decl.id,
    declared: plain({
      note: decl.note,
      phase: decl.phase ?? "active", serverTime, training: decl.training ?? false, clockSynced: decl.clockSynced === true, clockDrift: decl.clockDrift ?? 0,
      me: { faction: me.faction, status: me.status, effects: me.effects, wishReadyAt: me.wishReadyAt, wishFullAt: me.extra.wishFullAt, x: me.x, y: me.y, immuneUntil: me.immuneUntil },
      target: target ? { id: target.id, faction: target.faction, x: target.x, y: target.y, effects: target.effects, immuneUntil: target.immuneUntil } : null,
      aim: decl.pointer ?? null, aimKnown: decl.aimKnown !== false, pointerOver: decl.isOver !== false,
      peek: decl.peek ?? null, renderT: decl.renderT ?? serverTime, teleportAt: decl.teleportAt ?? 0,
      pendingCast: decl.pendingCast ? { slot: decl.pendingCast.slot, seq: num(decl.pendingCast.seq), readyAt: num(decl.pendingCast.readyAt), until: num(decl.pendingCast.until), orderPending: decl.pendingCast.orderPending === true } : null, view: decl.view !== false, reconnecting: decl.reconnecting === true,
      walls: decl.walls ?? [], now: decl.now,
    }),
    actual: {
      method: "RaidScene.prototype.castSlot.call(receiver, 'wish')",
      thrown,
      sentMessages: sent,
      pendingCast: receiver.pendingCast ? { slot: receiver.pendingCast.slot, seq: num(receiver.pendingCast.seq), readyAt: num(receiver.pendingCast.readyAt), until: num(receiver.pendingCast.until), orderPending: receiver.pendingCast.orderPending === true } : null,
      slotViewCalls: record.slotViewCalls,
      slotInputCalls: record.slotInput,
      model: model ? { state: model.state, name: model.name, blocked: model.blocked, secondsLeft: num(model.secondsLeft), sweep: num(model.sweep), cast: num(model.cast), charges: model.charges, maxCharges: model.maxCharges, icon: model.icon, color: model.color } : null,
      denies: record.deny,
      cooldownObserve: record.cooldownObserve,
      seqAfter: num(predict.seq),
      noteCast: record.noteCast,
      predictCast: record.predictCast,
      afterCast: record.afterCast,
      derivedProbe: { aim: actualAim, inTeleportGrace: graceProbe },
    },
  };
}

const rProbesDecl: any[] = [
  { id: "freeze-ready-visible-unit", note: "point-targeted cast at a visible enemy: the actual unit branch", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000 },
  { id: "freeze-ready-boundary-readyAt-equals-now", note: "slot ready exactly at serverNow", me: { id: "p0", faction: "frost", x: 300, y: 320, wishReadyAt: 1000 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000 },
  { id: "freeze-not-ready-by-1ms", note: "slot readyAt one ms in the future is a cooldown denial", me: { id: "p0", faction: "frost", x: 300, y: 320, wishReadyAt: 1001 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000 },
  { id: "freeze-ready-los-blocked", note: "declared wall column blocks line of sight (actual unitCastDenial/hasLineOfSight)", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, walls: Array.from({ length: 24 }, (_, i) => [11, i]), serverTime: 1000 },
  { id: "freeze-ready-out-of-range", note: "target beyond range + CAST_RANGE_SLACK", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 800, y: 320 }, pointer: { x: 800, y: 320 }, serverTime: 1000 },
  { id: "freeze-ready-target-immune", note: "declared teleport immunity on the target", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320, immuneUntil: 2000 }, pointer: { x: 450, y: 320 }, serverTime: 1000 },
  { id: "trial-ready-visible-unit", note: "Trial unit cast, telegraph 350 ms", me: { id: "p0", faction: "sentenced", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 600, y: 320 }, pointer: { x: 600, y: 320 }, serverTime: 1000 },
  { id: "swarm-ready-self-no-aim", note: "self-targeted cast with no cursor: aim falls back to the drawn self", me: { id: "p0", faction: "plague", x: 300, y: 320 }, aimKnown: false, isOver: false, serverTime: 1000 },
  { id: "swarm-ready-self-with-aim", note: "self-targeted cast with the cursor over a ground point: the cursor point is sent", me: { id: "p0", faction: "plague", x: 300, y: 320 }, pointer: { x: 340, y: 360 }, serverTime: 1000 },
  { id: "lastStand-ready-self", note: "self-targeted instant Wish", me: { id: "p0", faction: "holy", x: 300, y: 320 }, pointer: { x: 320, y: 340 }, serverTime: 1000 },
  { id: "blaze-ready-blink", note: "point-targeted instant blink: actual blinkLanding and a longer pending wait", me: { id: "p0", faction: "fire", x: 300, y: 320 }, pointer: { x: 500, y: 320 }, serverTime: 1000 },
  { id: "blaze-ready-no-direction", note: "cursor on the caster: blinkLanding returns null -> Can't blink there", me: { id: "p0", faction: "fire", x: 300, y: 320 }, pointer: { x: 300, y: 320 }, serverTime: 1000 },
  { id: "freeze-dead", note: "dead local fighter: slot model hidden, no send and no denial", me: { id: "p0", faction: "frost", x: 300, y: 320, status: "dead", hp: 0 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000 },
  { id: "freeze-stunned", note: "stunned local fighter: blocked by the actual def.blockedBy rule", me: { id: "p0", faction: "frost", x: 300, y: 320, effects: EFFECT_STUNNED }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000 },
  { id: "freeze-silenced", note: "silenced local fighter", me: { id: "p0", faction: "frost", x: 300, y: 320, effects: EFFECT_SILENCED }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000 },
  { id: "freeze-pending-unanswered", note: "a previous cast with the same readyAt is still unanswered (actual castUnanswered)", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000, pendingCast: { slot: "wish", seq: 7, readyAt: 0, until: 10600, orderPending: true }, now: 10000 },
  { id: "freeze-pending-answered", note: "the pending wait expired: the press is sent", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000, pendingCast: { slot: "wish", seq: 7, readyAt: 0, until: 9000, orderPending: true }, now: 10000 },
  { id: "freeze-planning-frozen", note: "planning phase freezes every order path", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, phase: "planning", serverTime: 1000 },
  { id: "freeze-minimap-peek", note: "minimap peek with a non-self cast is suppressed", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, peek: { x: 200, y: 200 }, serverTime: 1000 },
  { id: "swarm-minimap-peek-self-allowed", note: "self cast still stands while peeking", me: { id: "p0", faction: "plague", x: 300, y: 320 }, pointer: { x: 340, y: 360 }, peek: { x: 200, y: 200 }, serverTime: 1000 },
  { id: "freeze-ready-no-target-picked", note: "unit cast with the cursor over empty ground: No target", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 350, y: 500 }, serverTime: 1000 },
  { id: "freeze-ready-no-aim-unit", note: "unit cast with no cursor seen yet: No target", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, aimKnown: false, isOver: false, serverTime: 1000 },
  { id: "blaze-ready-no-aim-point", note: "point cast with no cursor seen yet: Aim with the cursor", me: { id: "p0", faction: "fire", x: 300, y: 320 }, aimKnown: false, isOver: false, serverTime: 1000 },
  { id: "freeze-ready-teleport-grace", note: "recent arena teleport: the actual inTeleportGrace check suppresses the press", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000, teleportAt: 900, renderT: 2000 },
  { id: "freeze-ready-teleport-grace-over", note: "a teleport well before the press does not suppress it", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 5000, teleportAt: 1000, renderT: 6000 },
  { id: "freeze-ready-clock-synced", note: "synced client clock: castSlot uses interp.clock.now for the server-time gates", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000, clockSynced: true, clockDrift: 37 },
  { id: "freeze-ready-training", note: "training state is carried into the actual slot model", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000, training: true },
  { id: "freeze-ready-no-view", note: "no slot view: castSlot returns before reading the cursor", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000, view: false },
  { id: "freeze-ready-reconnecting", note: "reconnecting: the message is still produced; only the predicted telegraph is suppressed", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000, reconnecting: true },
  { id: "dummy-ready-empty-slot", note: "the local fighter has no Wish for its faction: empty slot, no send", me: { id: "p0", faction: "none", x: 300, y: 320 }, pointer: { x: 450, y: 320 }, serverTime: 1000 },
  { id: "freeze-ready-hidden-target-not-offered", note: "an EFFECT_HIDDEN target is not in the client candidate list: No target", me: { id: "p0", faction: "frost", x: 300, y: 320 }, target: { id: "p1", faction: "fire", x: 450, y: 320, effects: EFFECT_HIDDEN }, pointer: { x: 450, y: 320 }, serverTime: 1000 },
];
const rProbes = rProbesDecl.map(runRProbe);
const rCorpus: any = {
  format: FORMAT,
  role: "A. actual RaidScene R-input method with declared receiver/state/host recorders",
  method: {
    module: "packages/client/src/scenes/RaidScene.ts",
    export: "RaidScene",
    invocation: "RaidScene.prototype.castSlot.call(declaredReceiver, \"wish\")",
    actualSourceBodies: ["castSlot", "slotInput", "cursorGround", "targetCandidates", "planMap", "localClock", "beforeTeleport", "frozenWorld getter"],
    declaredReceiver: "room (state/sessionId/reconnection/send recorder), predict (actual LocalPrediction; noteCast recorded; motion.orderPending overridden per declared pending state), rendered, input (declared pointer), cameras (declared camera), interp/clockSynced, slotView recorder, afterCast recorder, wishFx.predictCast recorder, slotCooldown (actual CooldownTracker), peek/frozenWorld/teleportAt/aimKnown",
    stubs: "tools/wish-public-fixtures/stub-loader.mjs maps phaser to a declared minimal base-class module and every *.css to an empty module. No scene, DOM, keyboard, camera or renderer lifecycle runs.",
  },
  probes: rProbes,
  findings: {
    sentFields: [...new Set(rProbes.flatMap((p: any) => p.actual.sentMessages.map((m: any) => Object.keys(m.payload).join(","))))],
    sentMessageCount: rProbes.reduce((a: number, p: any) => a + p.actual.sentMessages.length, 0),
    denialTexts: [...new Set(rProbes.flatMap((p: any) => p.actual.denies.map((d: any) => d.text)))].sort(),
    probeCount: rProbes.length,
  },
};

// ================================================================================================== D: WishFx
let gid = 0;
function makeGraphics(records: any[]): any {
  const rec: any = { id: "g" + (++gid), calls: [] };
  records.push(rec);
  const g: any = {};
  const methods = ["clear", "setVisible", "setPosition", "setScale", "setRotation", "setAlpha", "setDepth", "lineStyle", "lineBetween", "fillStyle", "fillCircle", "fillEllipse", "strokeCircle", "strokeEllipse", "destroy"];
  for (const m of methods) g[m] = (...a: any[]) => { rec.calls.push({ call: m, args: a.map(num) }); return g; };
  Object.defineProperty(g, "__rec", { value: rec, enumerable: false });
  return g;
}
function activeOf(fx: any): any[] {
  return (fx.active ?? []).map((e: any) => ({
    kind: e.kind, start: num(e.start), duration: num(e.duration), id: e.id, target: e.target,
    x: num(e.x), y: num(e.y), x2: num(e.x2), y2: num(e.y2), color: e.color, radius: num(e.radius), telegraph: e.telegraph,
    hold: e.hold === undefined ? null : num(e.hold), seq: e.seq === undefined ? null : e.seq, ability: e.ability ?? null,
    confirmed: e.confirmed === undefined ? null : e.confirmed, graphics: e.g?.__rec?.id ?? null,
  }));
}
const D_CASE_DEFS: any[] = [];
function addD(id: string, note: string, source: any, opts: any): void {
  const base: any = source.event ? source.event : source;
  const event = JSON.parse(JSON.stringify(base));
  if (opts.mutate) opts.mutate(event);
  D_CASE_DEFS.push({ id, note, source: source.batch ? { batch: source.batch.id, tupleIndex: source.index, kind: source.event.kind } : { declaredEvent: true, kind: event.kind }, event, opts });
}
const bAll100 = batchById("all-five-1");
const bAll150 = batchById("all-five-2");
const bAll350 = batchById("all-five-3");
const bInterrupt = batchById("interruption-3");
const bFizzle = batchById("fizzle-2");
const bTeleport = batchById("teleport-refund-2");
const bBetween = batchById("between-step-remove-2");
addD("freeze-cast-visible-caster-visible-unit", "Freeze telegraph, caster and unit target drawn", eventOf(bAll100.id, "cast", "freeze"), { localId: "local", positions: { p0: { x: 200, y: 320 }, p1: { x: 350, y: 320 } }, hidden: [], hiddenPoints: [], now: 100, updateNow: 140 });
addD("freeze-cast-hidden-unit-target", "visible caster, hidden unit target: WishFx.cast drops the telegraph", eventOf(bAll100.id, "cast", "freeze"), { localId: "local", positions: { p0: { x: 200, y: 320 } }, hidden: ["p1"], hiddenPoints: [], now: 100, updateNow: 140 });
addD("freeze-cast-hidden-caster", "hidden caster: nothing may point at it", eventOf(bAll100.id, "cast", "freeze"), { localId: "local", positions: { p1: { x: 350, y: 320 } }, hidden: ["p0"], hiddenPoints: [], now: 100, updateNow: 140 });
addD("freeze-castLand-visible", "Freeze landing impact at the visible unit target", eventOf(bAll350.id, "castLand", "freeze"), { localId: "local", positions: { p0: { x: 200, y: 320 }, p1: { x: 350, y: 320 } }, hidden: [], hiddenPoints: [], now: 350, updateNow: 390 });
addD("freeze-castLand-hidden-unit-target", "visible caster, hidden unit target: the spatial landing is still drawn at the target coordinates", eventOf(bAll350.id, "castLand", "freeze"), { localId: "local", positions: { p0: { x: 200, y: 320 } }, hidden: ["p1"], hiddenPoints: [], now: 350, updateNow: 390 });
addD("freeze-castLand-hidden-caster", "hidden caster, visible target: the landing is spatial and survives", eventOf(bAll350.id, "castLand", "freeze"), { localId: "local", positions: { p1: { x: 350, y: 320 } }, hidden: ["p0"], hiddenPoints: [], now: 350, updateNow: 390 });
addD("swarm-cast-visible", "Swarm swirl telegraph on the caster", eventOf(bAll100.id, "cast", "swarm"), { localId: "local", positions: { p1: { x: 350, y: 320 } }, hidden: [], hiddenPoints: [], now: 100, updateNow: 140 });
addD("trial-cast-visible", "Trial ring telegraph follows the unit target", eventOf(bAll100.id, "cast", "trial"), { localId: "local", positions: { p0: { x: 200, y: 320 }, p2: { x: 500, y: 320 } }, hidden: [], hiddenPoints: [], now: 100, updateNow: 140 });
addD("blaze-castLand-both-visible", "Blaze draws both endpoints and the connecting streak", eventOf(bAll100.id, "castLand", "blaze"), { localId: "local", positions: { p3: { x: 700, y: 320 } }, hidden: [], hiddenPoints: [], now: 100, updateNow: 140 });
addD("blaze-castLand-hidden-caster", "hidden caster, both endpoints spatially visible: land() is spatial and draws", eventOf(bAll100.id, "castLand", "blaze"), { localId: "local", positions: {}, hidden: ["p3"], hiddenPoints: [], now: 100, updateNow: 140 });
addD("blaze-castLand-origin-point-hidden", "origin point not spatially visible: the play guard drops the whole effect", eventOf(bAll100.id, "castLand", "blaze"), { localId: "local", positions: { p3: { x: 700, y: 320 } }, hidden: [], hiddenPoints: [{ x: 700, y: 320 }], now: 100, updateNow: 140 });
addD("blaze-castLand-destination-point-hidden", "destination point not spatially visible: update releases before drawing (both endpoints required)", eventOf(bAll100.id, "castLand", "blaze"), { localId: "local", positions: { p3: { x: 700, y: 320 } }, hidden: [], hiddenPoints: [{ x: 1000, y: 320 }], now: 100, updateNow: 140 });
addD("blaze-castLand-destination-missing-declared-malformed", "declared malformed event with no x2/y2: the actual land() fallback makes a one-point effect", eventOf(bAll100.id, "castLand", "blaze"), { localId: "local", positions: { p3: { x: 700, y: 320 } }, hidden: [], hiddenPoints: [], now: 100, updateNow: 140, mutate: (e: any) => { delete e.x2; delete e.y2; } });
addD("own-blink-visible", "own authoritative blink: localId owns the event", eventOf(bAll150.id, "castLand", "blaze"), { localId: "p3", positions: { p3: { x: 1000, y: 320 } }, hidden: [], hiddenPoints: [], now: 150, updateNow: 190 });
addD("castEnd-interrupted-visible", "interrupted cast puff where the telegraph was", eventOf(bInterrupt.id, "castEnd", "freeze"), { localId: "local", positions: { p1: { x: 450, y: 320 } }, hidden: [], hiddenPoints: [], now: 350, updateNow: 390 });
addD("castEnd-interrupted-hidden-caster", "hidden caster's castEnd draws no puff", eventOf(bInterrupt.id, "castEnd", "freeze"), { localId: "local", positions: {}, hidden: ["p1"], hiddenPoints: [], now: 350, updateNow: 390 });
addD("castEnd-fizzle-visible", "fizzle puff, actual reason", eventOf(bFizzle.id, "castEnd", "freeze"), { localId: "local", positions: { p0: { x: 300, y: 320 } }, hidden: [], hiddenPoints: [], now: 350, updateNow: 390 });
addD("castEnd-cancelled-teleport", "arena teleport refund path's actual castEnd", eventOf(bTeleport.id, "castEnd", "freeze"), { localId: "local", positions: { p0: { x: 300, y: 320 } }, hidden: [], hiddenPoints: [], now: 300, updateNow: 340 });
addD("castEnd-cancelled-between-step", "between-step room-leave cancellation's actual castEnd", eventOf(bBetween.id, "castEnd", "freeze"), { localId: "local", positions: { p0: { x: 300, y: 320 } }, hidden: [], hiddenPoints: [], now: 100, updateNow: 140 });
addD("caster-absent-removed-cast", "caster not drawn: the telegraph is dropped", eventOf(bAll100.id, "cast", "freeze"), { localId: "local", positions: { p1: { x: 350, y: 320 } }, hidden: ["p0"], hiddenPoints: [], now: 100, updateNow: 140 });
addD("caster-absent-removed-castEnd", "caster not drawn and no telegraph up: no puff", eventOf(bFizzle.id, "castEnd", "freeze"), { localId: "local", positions: {}, hidden: ["p0"], hiddenPoints: [], now: 350, updateNow: 390 });
addD("target-absent-removed-castLand", "unit target not drawn: the landing is spatial and still drawn", eventOf(bAll350.id, "castLand", "freeze"), { localId: "local", positions: { p0: { x: 200, y: 320 } }, hidden: ["p1"], hiddenPoints: [], now: 350, updateNow: 390 });
addD("historical-cast-start", "an old cast batch played at a much later render now: actual play uses the passed now", eventOf(bAll100.id, "cast", "freeze"), { localId: "local", positions: { p0: { x: 200, y: 320 }, p1: { x: 350, y: 320 } }, hidden: [], hiddenPoints: [], now: 1000, updateNow: 1040 });
addD("historical-cast-end", "an old castEnd played at a later render now", eventOf(bInterrupt.id, "castEnd", "freeze"), { localId: "local", positions: { p1: { x: 450, y: 320 } }, hidden: [], hiddenPoints: [], now: 1000, updateNow: 1040 });
addD("status-stun-visible", "stun stars on a visible fighter", { event: { kind: "status", t: 350, id: "p1", status: "stun", ms: 1250, by: "p0" } }, { localId: "local", positions: { p1: { x: 350, y: 320 } }, hidden: [], hiddenPoints: [], now: 350, updateNow: 390 });
addD("status-stun-hidden", "stun stars on a hidden fighter are not drawn", { event: { kind: "status", t: 350, id: "p1", status: "stun", ms: 1250, by: "p0" } }, { localId: "local", positions: {}, hidden: ["p1"], hiddenPoints: [], now: 350, updateNow: 390 });

function runDCase(def: any): any {
  gid = 0;
  const graphics: any[] = [];
  const hostCalls = { canSee: [] as any[], position: [] as any[], hidden: [] as any[] };
  const positions = def.opts.positions ?? {};
  const hidden = new Set<string>(def.opts.hidden ?? []);
  const hiddenPoints = def.opts.hiddenPoints ?? [];
  const visible = (p: any): boolean => !hiddenPoints.some((q: any) => Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5);
  const scene = { add: { graphics: () => makeGraphics(graphics) } };
  const host = {
    localId: def.opts.localId ?? "local",
    canSee: (p: any) => { hostCalls.canSee.push({ x: num(p.x), y: num(p.y) }); return visible(p); },
    position: (id: string) => { hostCalls.position.push(id); return hidden.has(id) ? undefined : positions[id]; },
    hidden: (id: string) => { hostCalls.hidden.push(id); return hidden.has(id); },
  };
  const fx = new WishFx(scene, host);
  let thrown: any = null;
  let afterPlay: any[] = [];
  try {
    fx.play(def.event, def.opts.now ?? 100);
    afterPlay = activeOf(fx);
    fx.update(def.opts.updateNow ?? (def.opts.now ?? 100) + 40);
  } catch (e: any) {
    thrown = String(e?.stack ?? e).slice(0, 2000);
  }
  return {
    id: def.id,
    declared: {
      note: def.note,
      source: def.source,
      event: def.event,
      localId: host.localId,
      positions,
      hidden: [...hidden],
      hiddenPoints,
      now: num(def.opts.now ?? 100),
      updateNow: num(def.opts.updateNow ?? (def.opts.now ?? 100) + 40),
      graphicsStub: "declared scene.add.graphics() recorder exposing clear/setVisible/setPosition/setScale/setRotation/setAlpha/setDepth/lineStyle/lineBetween/fillStyle/fillCircle/fillEllipse/strokeCircle/strokeEllipse/destroy",
    },
    actual: { thrown, hostCalls, activeAfterPlay: afterPlay, graphics, activeAfterUpdate: activeOf(fx), graphicsCount: graphics.length },
  };
}
const dCases = D_CASE_DEFS.map(runDCase);
const dFindings: any = { derivedFromActual: true, caseCount: dCases.length };
{
  const both = dCases.find((c: any) => c.id === "blaze-castLand-both-visible");
  const originHidden = dCases.find((c: any) => c.id === "blaze-castLand-origin-point-hidden");
  const destHidden = dCases.find((c: any) => c.id === "blaze-castLand-destination-point-hidden");
  const malformed = dCases.find((c: any) => c.id === "blaze-castLand-destination-missing-declared-malformed");
  const hiddenTargetCast = dCases.find((c: any) => c.id === "freeze-cast-hidden-unit-target");
  const hiddenTargetLand = dCases.find((c: any) => c.id === "freeze-castLand-hidden-unit-target");
  const hiddenCasterLand = dCases.find((c: any) => c.id === "freeze-castLand-hidden-caster");
  dFindings.blaze = {
    bothEndpointsVisible: { activeAfterPlay: both.actual.activeAfterPlay.length, drawCalls: both.actual.graphics.flatMap((g: any) => g.calls).length },
    originPointHidden: { activeAfterPlay: originHidden.actual.activeAfterPlay.length, activeAfterUpdate: originHidden.actual.activeAfterUpdate.length },
    destinationPointHidden: { activeAfterPlay: destHidden.actual.activeAfterPlay.length, activeAfterUpdate: destHidden.actual.activeAfterUpdate.length },
    destinationFieldMissingDeclaredMalformed: { activeAfterPlay: malformed.actual.activeAfterPlay.length, activeAfterUpdate: malformed.actual.activeAfterUpdate.length, coordinateFallback: malformed.actual.activeAfterUpdate[0] ? { x2equalsX: malformed.actual.activeAfterUpdate[0].x2 === malformed.actual.activeAfterUpdate[0].x, y2equalsY: malformed.actual.activeAfterUpdate[0].y2 === malformed.actual.activeAfterUpdate[0].y } : null },
    bothEndpointsRequired: destHidden.actual.activeAfterUpdate.length === 0 && originHidden.actual.activeAfterUpdate.length === 0,
  };
  dFindings.unitTarget = {
    hiddenTargetCastActive: hiddenTargetCast.actual.activeAfterPlay.length,
    hiddenTargetLandingActive: hiddenTargetLand.actual.activeAfterUpdate.length,
    hiddenCasterLandingActive: hiddenCasterLand.actual.activeAfterUpdate.length,
    note: "WishFx.cast suppresses a hidden target's telegraph; land() is spatial and draws without a visible caster.",
  };
}
const dCorpus: any = {
  format: FORMAT,
  role: "D. actual human WishFx play/update methods with declared graphics and host recorders (method-level only)",
  declared: {
    host: "canSee(point), position(id), hidden(id), localId are declared recorders. No Phaser scene, graphics driver, renderer, DOM or pixel is used; graphics calls are recorder method calls.",
    events: "Every event is a real TimedFx unpacked from the real FxChannel batches of C, except the one labelled declared-malformed event (a declared x2/y2 removal) and the two declared status events.",
    not: "This is not a scene/keyboard/browser claim and does not claim source art equals native publication.",
  },
  cases: dCases,
  findings: dFindings,
};

// ================================================================================================== E: perceive
const E_FEATURES = { messageTypes: [], wishes: true, statusEffects: true, fields: false, planning: false, chests: false, skills: false, relics: false, camps: false, hazards: false };
function eRow(over: any): any {
  return {
    id: over.id, name: over.name ?? over.id, x: over.x ?? 0, y: over.y ?? 0, facing: over.facing ?? 0,
    status: over.status ?? "alive", hp: over.hp ?? 100, maxHp: over.maxHp ?? 100, barrier: over.barrier ?? 0,
    faction: over.faction ?? null, weapons: [null, null], weapon0: over.weapon0 ?? "sword", weapon1: over.weapon1 ?? "", slot: 0,
    effects: over.effects ?? 0, bot: false, attackTarget: "", drawStartedAt: 0, readyAt: 0, immuneUntil: over.immuneUntil ?? 0,
    sig: 0, brand: 0, power: 0, asMult: 1000, windupMult: 1000, speedMult: 1000, kills: 0, mobKills: 0,
    build: new Map(), mobStats: new Map(), gv: 0, bounty: 0, moveSeq: 0,
    wishReadyAt: over.wishReadyAt ?? 0, qReadyAt: 0, eReadyAt: 0, extra: { wishFullAt: over.wishFullAt ?? 0 },
  };
}
function eBaseRows(batchId: string): any {
  const b = batchById(batchId);
  const run = runs[b.case];
  const frame = traceFrames(run).find((f: any) => f.time === b.producer.time) ?? traceFrames(run).at(-1);
  const rows: Record<string, any> = {};
  for (const p of frame.public.players) rows[p.id] = eRow({ ...p.state, id: p.id });
  rows["obs"] = eRow({ id: "obs", name: "observer", x: 500, y: 320, faction: "holy" });
  return { frame, rows };
}
function buildEState(base: any, over: any): any {
  const rows = structuredClone(base.rows);
  for (const [id, patch] of Object.entries(over.patch ?? {})) if (rows[id]) Object.assign(rows[id], patch as any);
  for (const id of over.remove ?? []) delete rows[id];
  const players = new Map(Object.entries(rows));
  return {
    state: {
      phase: "active", seed: 7, serverTime: over.serverTime ?? 1000, tick: Math.round((over.serverTime ?? 1000) / 50),
      raidStartedAt: 50, lobbyEndsAt: 0, minPlayers: 0, startedWith: 5, patienceEndsAt: 0, inColiseum: false,
      gatesLocked: false, suddenDeathAt: 0, winner: "", training: false, startedWithHumans: 5,
      players, mobs: new Map(), containers: new Map(), roster: over.roster,
    },
    rows,
  };
}
const E_CASES: any[] = [];
function addE(id: string, note: string, baseBatch: string, opts: any): void {
  const base = eBaseRows(baseBatch);
  E_CASES.push({ id, note, baseBatch, opts, base });
}
addE("visible-caster-visible-target", "all Wish events visible to the declared observer", "all-five-1", { batchIds: ["all-five-1", "all-five-3"], selfId: "obs", serverTime: 1000 });
addE("hidden-caster", "EFFECT_HIDDEN caster: its cues are dropped", "all-five-1", { batchIds: ["all-five-1", "all-five-3"], selfId: "obs", serverTime: 1000, patch: { p0: { effects: EFFECT_HIDDEN } } });
addE("hidden-unit-target", "EFFECT_HIDDEN unit target: identity masked, numeric endpoint coordinates retained", "all-five-1", { batchIds: ["all-five-1", "all-five-3"], selfId: "obs", serverTime: 1000, patch: { p1: { effects: EFFECT_HIDDEN } } });
addE("hidden-caster-and-target", "both the caster and the unit target hidden", "all-five-1", { batchIds: ["all-five-1", "all-five-3"], selfId: "obs", serverTime: 1000, patch: { p0: { effects: EFFECT_HIDDEN }, p1: { effects: EFFECT_HIDDEN } } });
addE("blaze-destination-point-hidden", "Blaze landing with the destination point not spatially visible: the declared drawn caster is at the origin, so the subject stays visible and ext data retains x2/y2", "all-five-1", { batchIds: ["all-five-1"], selfId: "obs", serverTime: 1000, hiddenPoints: [{ x: 1000, y: 320 }], patch: { p3: { x: 700, y: 320 } } });
addE("blaze-origin-point-hidden", "Blaze landing with the origin point not spatially visible: the declared drawn caster is at the destination, so the subject stays visible and ext data retains x/x2", "all-five-1", { batchIds: ["all-five-1"], selfId: "obs", serverTime: 1000, hiddenPoints: [{ x: 700, y: 320 }], patch: { p3: { x: 1000, y: 320 } } });
addE("own-blink", "the observer is the blinking caster: perceive's subject rule resolves it as self", "all-five-1", { batchIds: ["all-five-1"], selfId: "p3", serverTime: 1000 });
addE("caster-removed", "caster removed from state.players but still in roster: subject rule falls to the numeric point", "all-five-1", { batchIds: ["all-five-1"], selfId: "obs", serverTime: 1000, remove: ["p0"] });
addE("target-removed", "unit target removed from state.players but still in roster", "all-five-1", { batchIds: ["all-five-1"], selfId: "obs", serverTime: 1000, remove: ["p1"] });
addE("historical-batch", "an old batch delivered to a later perceive frame: event t stays the batch time", "all-five-1", { batchIds: ["all-five-1"], selfId: "obs", serverTime: 10000 });
addE("interruption-visible", "stun/castEnd/castLand batch", "interruption-3", { batchIds: ["interruption-3"], selfId: "obs", serverTime: 1000 });
addE("interruption-hidden-caster", "interrupted cast of a hidden caster", "interruption-3", { batchIds: ["interruption-3"], selfId: "obs", serverTime: 1000, patch: { p1: { effects: EFFECT_HIDDEN } } });
addE("teleport-cancelled-visible", "actual terminal teleport-refund batch: castEnd cancelled + teleport, with declared projection rows", "teleport-refund-2", { batchIds: ["teleport-refund-2"], selfId: "obs", serverTime: 1000 });
addE("between-step-cancelled", "actual terminal room-leave batch: castEnd cancelled, with declared projection rows (not room lifecycle proof)", "between-step-remove-2", { batchIds: ["between-step-remove-2"], selfId: "obs", serverTime: 1000 });
const eResults: any[] = [];
for (const c of E_CASES) {
  const b = batchById(c.baseBatch);
  const stateBuilt = buildEState(c.base, { ...c.opts, roster: b.roster.map((r: any) => r[0]) });
  const canSee = c.opts.hiddenPoints ? (p: any) => !c.opts.hiddenPoints.some((q: any) => Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5) : undefined;
  const ctx: any = { selfId: c.opts.selfId, map: makeMap({ map: "room" }), features: E_FEATURES, lastMinimap: null };
  if (canSee) ctx.canSee = canSee;
  const batches = c.opts.batchIds.map((id: string) => batchById(id).batch);
  let frame: any = null;
  let thrown: any = null;
  try {
    frame = perceive({ state: stateBuilt.state, fxs: batches }, ctx);
  } catch (e: any) {
    thrown = String(e?.stack ?? e).slice(0, 2000);
  }
  eResults.push({
    id: c.id,
    declared: {
      note: c.note,
      baseBatch: c.baseBatch,
      batchIds: c.opts.batchIds,
      selfId: c.opts.selfId,
      serverTime: c.opts.serverTime,
      patch: c.opts.patch ?? null,
      removed: c.opts.remove ?? [],
      hiddenPoints: c.opts.hiddenPoints ?? [],
      roster: b.roster.map((r: any) => r[0]),
      statePlayers: [...stateBuilt.state.players.keys()],
      canSeePredicateSupplied: canSee !== undefined,
      features: E_FEATURES,
    },
    actual: {
      thrown,
      alive: frame?.hud?.alive ?? null,
      playerCount: frame?.hud?.playerCount ?? null,
      selfId: frame?.self?.id ?? null,
      selfX: frame ? num(frame.self.x) : null,
      selfY: frame ? num(frame.self.y) : null,
      fighters: (frame?.fighters ?? []).map((f: any) => ({ id: f.id, status: f.status, x: num(f.x), y: num(f.y), effects: stateBuilt.rows[f.id]?.effects ?? null })),
      mobs: (frame?.mobs ?? []).map((m: any) => m.id),
      events: frame?.events ?? [],
      extrasKeys: Object.keys(frame?.extras ?? {}).sort(),
    },
  });
}
function findExt(result: any, fxKind: string, ability?: string): any {
  const events = result.actual.events ?? [];
  return events.find((e: any) => e.kind === "ext" && e.fx === fxKind && (ability === undefined || (e.data && e.data.ability === ability))) ?? null;
}
const eFindings: any = { derivedFromActual: true, caseCount: eResults.length };
{
  const visible = eResults.find((r: any) => r.id === "visible-caster-visible-target");
  const hiddenCaster = eResults.find((r: any) => r.id === "hidden-caster");
  const hiddenTarget = eResults.find((r: any) => r.id === "hidden-unit-target");
  const casterRemoved = eResults.find((r: any) => r.id === "caster-removed");
  const targetRemoved = eResults.find((r: any) => r.id === "target-removed");
  const blazeDest = eResults.find((r: any) => r.id === "blaze-destination-point-hidden");
  const blazeOrigin = eResults.find((r: any) => r.id === "blaze-origin-point-hidden");
  const visibleFreezeCast = findExt(visible, "cast", "freeze");
  const hiddenTargetCast = findExt(hiddenTarget, "cast", "freeze");
  const hiddenTargetLand = findExt(hiddenTarget, "castLand", "freeze");
  const hiddenCasterFreezeCast = findExt(hiddenCaster, "cast", "freeze");
  const removedCasterCast = findExt(casterRemoved, "cast", "freeze");
  const removedTargetCast = findExt(targetRemoved, "cast", "freeze");
  const blazeDestLand = findExt(blazeDest, "castLand", "blaze");
  const blazeOriginLand = findExt(blazeOrigin, "castLand", "blaze");
  eFindings.hiddenTargetCoordinateLeak = {
    label: "SOURCE FINDING (not rewritten): perceive retains the hidden unit target's delivered coordinates in ext.data.x/y.",
    hiddenTargetCast: hiddenTargetCast ? { data: hiddenTargetCast.data, at: hiddenTargetCast.at } : null,
    hiddenTargetLanding: hiddenTargetLand ? { data: hiddenTargetLand.data, at: hiddenTargetLand.at } : null,
    identityMasked: hiddenTargetCast ? hiddenTargetCast.data.target === null : null,
    coordinatesRetained: hiddenTargetCast ? typeof hiddenTargetCast.data.x === "number" && typeof hiddenTargetCast.data.y === "number" : null,
  };
  eFindings.hiddenCaster = {
    visibleCasterEvent: visibleFreezeCast ? { fx: visibleFreezeCast.fx, at: visibleFreezeCast.at } : null,
    hiddenCasterEvent: hiddenCasterFreezeCast,
    dropped: hiddenCasterFreezeCast === null,
  };
  eFindings.removedActors = {
    label: "SOURCE retained-ID disclosure (not anonymity): a removed caster falls back to the numeric point, but data.by still retains the removed id; a removed target id is also copied. Native mapping/redaction remains a separate correction.",
    casterRemovedPointWithRetainedId: removedCasterCast ? { at: removedCasterCast.at, data: removedCasterCast.data } : null,
    removedCasterIdRetained: removedCasterCast ? removedCasterCast.data.by : null,
    removedTargetIdRetained: removedTargetCast ? removedTargetCast.data.target : null,
    removedTargetIdIsString: removedTargetCast ? typeof removedTargetCast.data.target === "string" : null,
  };
  eFindings.blazeEndpoints = {
    destinationPointHidden: blazeDestLand ? { at: blazeDestLand.at, data: blazeDestLand.data } : null,
    originPointHidden: blazeOriginLand ? { at: blazeOriginLand.at, data: blazeOriginLand.data } : null,
    note: "With a visible subject, observeExt copies numeric x/x2 regardless of the point's sight; with a hidden subject the whole cue is dropped.",
  };
}
// Bind each named terminal projection to its actual terminal producer/packed batch. A start-only batch with a
// misleading case name is not a cancellation witness. These inspect source outputs; they install no expected state.
eFindings.terminalBatches = [
  { caseId: "teleport-cancelled-visible", batchId: "teleport-refund-2", teleport: true, betweenSteps: false },
  { caseId: "between-step-cancelled", batchId: "between-step-remove-2", teleport: false, betweenSteps: true },
].map((spec) => {
  const result = eResults.find((c: any) => c.id === spec.caseId);
  const selected = result.declared.batchIds;
  const batch = batchById(spec.batchId);
  const terminal = (fx: any): boolean => fx.kind === "castEnd" && fx.ability === "freeze" && fx.reason === "cancelled";
  const output = {
    caseId: spec.caseId,
    selectedBatchIds: selected,
    producerTime: batch.producer.time,
    batchTime: batch.batchTime,
    betweenSteps: batch.producer.betweenSteps,
    producerCancelledCount: batch.producer.events.filter((e: any) => terminal(e.fx)).length,
    decodedCancelledCount: batch.unpacked.filter(terminal).length,
    observedCancelledCount: result.actual.events.filter((e: any) => e.kind === "ext" && e.fx === "castEnd" && e.data.ability === "freeze" && e.data.reason === "cancelled").length,
    observedTeleportCount: result.actual.events.filter((e: any) => e.kind === "teleport").length,
    observedStartedCount: result.actual.events.filter((e: any) => e.kind === "ext" && e.fx === "cast").length,
  };
  expectSource(result.actual.thrown === null, spec.caseId + " actual perceive must execute");
  expectSource(result.declared.baseBatch === spec.batchId && selected.length === 1 && selected[0] === spec.batchId, spec.caseId + " must select the exact terminal batch");
  expectSource(output.betweenSteps === spec.betweenSteps, spec.caseId + " must preserve the producer phase");
  expectSource(output.producerCancelledCount === 1 && output.decodedCancelledCount === 1 && output.observedCancelledCount === 1, spec.caseId + " must preserve one actual cancelled castEnd through pack/unpack/perceive");
  expectSource(output.observedStartedCount === 0 && output.observedTeleportCount === Number(spec.teleport), spec.caseId + " must contain the terminal phase, not Started");
  return output;
});
const eCorpus: any = {
  format: FORMAT,
  role: "E. actual narrower perceive() over declared projection states and the real packed batches of C",
  declared: {
    state: "Declared source-schema-shaped rows built from the actual all-five public player states at the batch time, plus a declared observer row; visibility (EFFECT_HIDDEN, removed rows, hidden points) is declared.",
    batches: "The real packed FxBatch objects of C are passed to perceive, which decodes them with the declared roster through its own actual unpackFx call.",
    distinctness: "This is the narrower bot observeExt path, not the human WishFx output of D. Its coordinate disclosures are labelled source findings and are not rewritten.",
  },
  cases: eResults,
  findings: eFindings,
};

// ================================================================================================== write / check
const corpora: Record<string, any> = {
  "r-input.json": rCorpus,
  "queued-stock-clocks.json": stockCorpus,
  "fx-timing.json": fxCorpus,
  "wishfx-endpoints.json": dCorpus,
  "perceive-wish.json": eCorpus,
};
const bytes: Record<string, string> = {};
for (const name of OUTPUTS) bytes[name] = finalize(corpora[name]!);
const manifest: any = {
  format: FORMAT,
  image: IMAGE,
  canonicalSerialization: "JSON.stringify(corpus) + \"\\n\"",
  files: OUTPUTS.map((name) => {
    const corpus = corpora[name];
    return {
      file: name,
      bytes: Buffer.byteLength(bytes[name]!, "utf8"),
      sha256: sha256(bytes[name]!),
      captureSha256: corpus.profile.captureSha256,
      counts: name === "r-input.json" ? { probes: corpus.probes.length }
        : name === "queued-stock-clocks.json" ? { cases: corpus.cases.length, frames: corpus.cases.reduce((a: number, c: any) => a + c.frames.length, 0), hooks: corpus.cases.reduce((a: number, c: any) => a + c.hooks.length, 0) }
        : name === "fx-timing.json" ? { batches: corpus.batches.length }
        : name === "wishfx-endpoints.json" ? { cases: corpus.cases.length }
        : { cases: corpus.cases.length },
    };
  }),
  sourceClosureFiles: Object.keys(sourceFileHashes).length,
  styleFiles: Object.keys(styleFileHashes).length,
  toolFiles: Object.keys(toolPins).length,
};
const manifestBytes = JSON.stringify(manifest) + "\n";
const allFiles: Record<string, string> = { ...bytes, "manifest.json": manifestBytes };

if (mode === "--write") {
  for (const name of Object.keys(allFiles)) writeFileSync(join(outDir, name), allFiles[name]!, "utf8");
} else {
  for (const name of Object.keys(allFiles)) {
    const path = join(outDir, name);
    if (!existsSync(path)) throw new Error("missing corpus " + path);
    assert.equal(readFileSync(path, "utf8"), allFiles[name]!, name + " canonical bytes");
  }
}
// Structural invariants of the canonical witness (recorded, not asserted, under a mutant capture).
expectSource(rProbes.some((p: any) => p.actual.sentMessages.length > 0), "at least one actual R input message");
expectSource(rProbes.some((p: any) => p.actual.denies.length > 0), "at least one actual denial");
expectSource(stockCases.every((c: any) => c.frames.length > 0), "every stock case has actual frames");
expectSource(C_BATCHES.length > 0, "actual Wish fx batches");
expectSource(dCases.length > 0 && eResults.length > 0, "human and perceive corpora");
console.log(JSON.stringify({
  mode,
  files: Object.fromEntries(OUTPUTS.map((n) => [n, { bytes: Buffer.byteLength(bytes[n]!, "utf8"), sha256: sha256(bytes[n]!), captureSha256: corpora[n]!.profile.captureSha256 }])),
  probes: rProbes.length,
  stockCases: stockCases.length,
  batches: C_BATCHES.length,
  wishfxCases: dCases.length,
  perceiveCases: eResults.length,
  sourceFiles: Object.keys(sourceFileHashes).length,
  instantWishStartedEvents: instantStarted.length,
  producerEqualsBatchTimeEverywhere: fxCorpus.findings.producerEqualsBatchTimeEverywhere,
}));
