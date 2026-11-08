// Canonical actual-source witness for the OWNER_COMBAT_SOURCE_WITNESS bounded continuation, pinned linux/amd64 Node 22.23.4.
//
// Two corpora in one run:
//   producer.json          real createGameWorld/step lifecycles for L07, L08, D02, M04 and M05, one frame per completed
//                          50 ms step over every recorded window: the canonical owner group
//                          (attackTarget, drawStartedAt, readyAt, asMult, windupMult, speedMult) before and after a real
//                          @colyseus/schema encode/decode, build/mobStats, the source events, the source predicates, the
//                          original bot perceive(), and observer taps for landed damage and fighter-out transitions.
//   human-projection.json  the actually decoded owner fed to the ORIGINAL human methods: render/targeting.ts LockDisplay
//                          note/shown/reset, one retained FighterArt.ts DrawTrack per lifecycle with fullDrawSeconds,
//                          weaponBar.ts isExtension/nextCooldown carried through the decoded readyAt sequence, buildHud.ts
//                          statsOf (real buildGains) and ChampionCombatHud.update read back from its stub rows.
//
// L08 additionally records DIRECT-LIFECYCLE snapshots: the actual sim/step.ts removePlayer(world, id) is called between
// completed steps, labelled as such, never queued as ordinary client input. Every other input below is an ordinary
// enqueueClientMessage message applied by step()'s own input phase.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const IMAGE = "node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const FORMAT = "rh-owner-combat-continuation/1";
const OUTPUTS = ["producer.json", "human-projection.json"];
const BASE_COMMIT = "d061aacd61c2338d00dd51119cab4d2651f4a23d";
const BRANCH = "deepseek/owner-combat-continuation";
const FROZEN_ORIGINAL_BRANCH = "deepseek/owner-combat-source";
const FROZEN_ORIGINAL_BASE = "a894574f8f46938cafef7f4103877be58c602905";
/** The 32 frozen owner-combat slice files: recorded here by hash to prove this continuation left them byte-identical. */
const FROZEN_ORIGINAL_FILES = [
  "docs/evidence/owner-combat-source/README.md",
  "docs/evidence/owner-combat-source/mutants/01-setlock-attacktarget-omit-capture.log",
  "docs/evidence/owner-combat-source/mutants/01-setlock-attacktarget-omit-SHA256SUMS",
  "docs/evidence/owner-combat-source/mutants/02-clearlock-attacktarget-omit-capture.log",
  "docs/evidence/owner-combat-source/mutants/02-clearlock-attacktarget-omit-SHA256SUMS",
  "docs/evidence/owner-combat-source/mutants/03-perceive-u32-identity-capture.log",
  "docs/evidence/owner-combat-source/mutants/03-perceive-u32-identity-SHA256SUMS",
  "docs/evidence/owner-combat-source/mutants/04-writemirrors-windupmult-omit-capture.log",
  "docs/evidence/owner-combat-source/mutants/04-writemirrors-windupmult-omit-SHA256SUMS",
  "docs/evidence/owner-combat-source/mutants/05-nextcooldown-arithmetic-capture.log",
  "docs/evidence/owner-combat-source/mutants/05-nextcooldown-arithmetic-SHA256SUMS",
  "docs/evidence/owner-combat-source/mutants/06-provenance-only-comment-capture.log",
  "docs/evidence/owner-combat-source/mutants/06-provenance-only-comment-SHA256SUMS",
  "docs/evidence/owner-combat-source/mutants/run.log",
  "parity/policy/owner-combat/boundaries.json",
  "parity/policy/owner-combat/human-projection.json",
  "parity/policy/owner-combat/producer.json",
  "tools/owner-combat-fixtures/README.md",
  "tools/owner-combat-fixtures/apply-patch.mjs",
  "tools/owner-combat-fixtures/capture.mts",
  "tools/owner-combat-fixtures/capture.sh",
  "tools/owner-combat-fixtures/client-stub-loader.mjs",
  "tools/owner-combat-fixtures/compare.mjs",
  "tools/owner-combat-fixtures/hash-of.mjs",
  "tools/owner-combat-fixtures/mutants/01-setlock-attacktarget-omit.patch",
  "tools/owner-combat-fixtures/mutants/02-clearlock-attacktarget-omit.patch",
  "tools/owner-combat-fixtures/mutants/03-perceive-u32-identity.patch",
  "tools/owner-combat-fixtures/mutants/04-writemirrors-windupmult-omit.patch",
  "tools/owner-combat-fixtures/mutants/05-nextcooldown-arithmetic.patch",
  "tools/owner-combat-fixtures/mutants/06-provenance-only-comment.patch",
  "tools/owner-combat-fixtures/mutants/expected.txt",
  "tools/owner-combat-fixtures/run-mutants.sh",
];

const args = process.argv.slice(2);
assert(args.length >= 2, "usage: capture.mts (--write|--check) <outDir> [--repo <root>]");
const mode = args[0];
assert(mode === "--write" || mode === "--check", "mode must be --write or --check");
const outDir = resolve(args[1]);
let repoRoot = "/repo";
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--repo") { assert(typeof args[i + 1] === "string", "--repo needs a path"); repoRoot = resolve(args[++i]); }
  else assert.fail("unknown argument " + args[i]);
}
assert.equal(process.version, "v22.23.4", "this corpus is captured under Node v22.23.4");
assert.equal(process.platform, "linux", "this corpus is captured under linux");
assert.equal(process.arch, "x64", "this corpus is captured under x64");

// A mutant run recaptures deliberately changed source: the assertions that pin the expected source outcome are recorded as
// booleans instead of aborting, and the separate semantic comparator is the check.
const RECORD_MODE = process.env.RH_OWNER_COMBAT_CONTINUATION_RECORD === "1";
const expectSource = (condition: boolean, message: string): void => { if (!RECORD_MODE) assert(condition, message); };

const repo = (p: string) => join(repoRoot, p);
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const shaFile = (p: string) => sha256(readFileSync(repo(p)));
const plain = (v: any) => JSON.parse(JSON.stringify(v));
/** JSON-safe declared input: Maps become explicit entry lists instead of {} (the runtime rows keep real Maps). */
const jsonSafe = (v: any): any => {
  if (v instanceof Map) return { entries: [...v.entries()].map(([k, count]) => [k, count]) };
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") { const out: any = {}; for (const k of Object.keys(v)) out[k] = jsonSafe(v[k]); return out; }
  return v;
};
/** CardCounts/MobStatCounts are MapSchema-like (forEach), not native Maps: serialize their real entries only. */
const countsSafe = (m: any): any => {
  if (!m) return null;
  if (typeof m.forEach === "function") {
    const entries: any[] = [];
    m.forEach((value: any, key: any) => entries.push([String(key), value]));
    return { entries };
  }
  return jsonSafe(m);
};
/** Non-finite numbers become explicit typed strings so JSON can never silently turn them into null. */
const typed = (v: any): any => {
  if (typeof v === "number") {
    if (Number.isFinite(v)) return Object.is(v, -0) ? "-0" : v;
    return Number.isNaN(v) ? "NaN" : v > 0 ? "+Infinity" : "-Infinity";
  }
  if (Array.isArray(v)) return v.map(typed);
  if (v && typeof v === "object") { const out: any = {}; for (const k of Object.keys(v)) out[k] = typed(v[k]); return out; }
  return v;
};

// ------------------------------------------------------------------------------------------------- deterministic host stubs
// The client modules import CSS and touch a few DOM globals at module scope. The loader turns every *.css import and every
// "phaser" import into an empty module; these are the minimal no-op DOM-ish globals. No DOM lifecycle is exercised: the
// projection methods are called directly and their returned/rendered values are read back from the stub nodes.
function stubNode(): any {
  return {
    nodeType: 1, tagName: "DIV", className: "", textContent: "", hidden: false, title: "", value: "", disabled: false,
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ""; } },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, append() {}, appendChild() {},
    prepend() {}, replaceChildren() {}, insertBefore() {}, addEventListener() {}, removeEventListener() {},
    remove() {}, focus() {}, blur() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getContext() { return null; }, getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0 }; },
    width: 0, height: 0,
  };
}
const STUB_NODE = stubNode();
globalThis.document = {
  getElementById() { return STUB_NODE; }, createElement() { return stubNode(); }, createElementNS() { return stubNode(); },
  addEventListener() {}, removeEventListener() {}, body: STUB_NODE, documentElement: STUB_NODE, head: STUB_NODE,
} as any;
globalThis.window = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {},
  matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
  location: { href: "http://127.0.0.1/", search: "" }, localStorage: null,
} as any;
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {}, clear() {} } as any;
globalThis.sessionStorage = globalThis.localStorage;
globalThis.matchMedia = (globalThis.window as any).matchMedia;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
try { Object.defineProperty(globalThis, "navigator", { value: { userAgent: "rh-owner-combat-source" }, configurable: true }); } catch { /* Node's own navigator is fine */ }

// ------------------------------------------------------------------------------------------------------- source modules
const load = (p: string) => import(repo(p));
const shared = await load("packages/shared/src/index.ts");
const schemaMod = await load("packages/shared/src/schema.ts");
const schemaPkg = await import(repo("node_modules/@colyseus/schema/build/index.mjs"));
const perceptionMod = await load("packages/server/src/bots/brain/perception.ts");
const gameplayMod = await load("packages/server/src/sim/gameplay.ts");
const stepMod = await load("packages/server/src/sim/step.ts");
const inputsMod = await load("packages/server/src/sim/inputs.ts");
const lootMod = await load("packages/server/src/sim/loot.ts");
const visionMod = await load("packages/server/src/sim/vision.ts");
const targetingMod = await load("packages/server/src/sim/targeting.ts");
const combatantMod = await load("packages/server/src/sim/combatant.ts");
const statusMod = await load("packages/server/src/sim/status.ts");
const worldMod = await load("packages/server/src/sim/world.ts");
const trainingMod = await load("packages/server/src/sim/training.ts");
const lockDisplayMod = await load("packages/client/src/render/targeting.ts");
const fighterArtMod = await load("packages/client/src/render/FighterArt.ts");
const weaponBarMod = await load("packages/client/src/ui/weaponBar.ts");
const buildHudMod = await load("packages/client/src/ui/buildHud.ts");
const championHudMod = await load("packages/client/src/ui/championCombatHud.ts");
const buildModelMod = await load("packages/client/src/ui/buildModel.ts");

const {
  mapFromTiles, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL, TICK_MS, mulberry32, hasLineOfSight, collisionMap: _unused, bushConceals,
} = shared;
const { RaidState, PlayerState } = schemaMod;
const { createGameWorld } = gameplayMod;
const { addPlayer, step, removePlayer } = stepMod;
const { enqueueClientMessage } = inputsMod;
const { dropWeapon } = lootMod;
const { canPlayerSee, canPlayerSeeActor } = visionMod;
const { lockable } = targetingMod;
const { combatant } = combatantMod;
const { isHidden, isUntargetable } = statusMod;
const { collisionMap } = worldMod;
const { installTraining } = trainingMod;
const { chainHook } = worldMod;
const { perceive } = perceptionMod;
const { LockDisplay, OPTIMISTIC_LOCK_MS } = lockDisplayMod;
const { DrawTrack, fullDrawSeconds } = fighterArtMod;
const { isExtension, nextCooldown } = weaponBarMod;
const { statsOf } = buildHudMod;
const { ChampionCombatHud } = championHudMod;
const {
  decodeMult, encodeMult, IDENTITY_MIRRORS, WIRE_IDENTITY_MIRRORS, swapAllowed, swapReadyAt,
  CARDS, cardDef, isInteractiveAugment, mobTypeById,
} = shared;

const DECLARED_FEATURES = {
  messageTypes: [], wishes: false, statusEffects: true, fields: false, planning: false, chests: false,
  skills: false, relics: false, camps: false, hazards: false,
};

// ------------------------------------------------------------------------------------------------------- the declared map
// One deterministic hand-built public map: a walled 40x20 arena with a sight corner (a vertical wall whose only doorway is
// far below the two actors), a declared bush and open floor. No generated map and no native map output. The bush is a real
// MapFeature (shared/map.ts FeatureKind "bush"), so bushConceals reads it exactly as it reads a generated bush.
const MAP_W = 40;
const MAP_H = 20;
const SIM_SEED = 7;
const WALL_COLUMN_X = 17;
const WALL_ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const BUSH_TILES = [[10, 4], [11, 4], [10, 5], [11, 5]];
const BUSH_CENTRE = { x: 10 * TILE + TILE / 2, y: 4 * TILE + TILE / 2 };
function buildArenaMap(): any {
  const tiles = new Uint8Array(MAP_W * MAP_H).fill(TILE_FLOOR);
  for (let x = 0; x < MAP_W; x++) { tiles[x] = TILE_WALL; tiles[(MAP_H - 1) * MAP_W + x] = TILE_WALL; }
  for (let y = 0; y < MAP_H; y++) { tiles[y * MAP_W] = TILE_WALL; tiles[y * MAP_W + MAP_W - 1] = TILE_WALL; }
  for (const y of WALL_ROWS) tiles[y * MAP_W + WALL_COLUMN_X] = TILE_WALL;
  const map = { ...mapFromTiles(MAP_W, MAP_H, tiles), seed: SIM_SEED, spawns: [] as any[] };
  const bx = Math.min(...BUSH_TILES.map((t) => t[0]));
  const by = Math.min(...BUSH_TILES.map((t) => t[1]));
  const bw = Math.max(...BUSH_TILES.map((t) => t[0])) - bx + 1;
  const bh = Math.max(...BUSH_TILES.map((t) => t[1])) - by + 1;
  map.features = [{ kind: "bush", variant: "", zone: "fire", jobs: ["cover"], ax: bx, ay: by, p: [], bbox: { x: bx, y: by, w: bw, h: bh }, tiles: BUSH_TILES.length }];
  for (const pair of BUSH_TILES) map.featureGrid[pair[1] * MAP_W + pair[0]] = 1;
  return map;
}
const ARENA_MAP = buildArenaMap();
const MAP_DESCRIPTION = {
  provenance: "declared",
  source: "packages/shared/src/map.ts mapFromTiles(40, 20, tiles, seed 7) with one declared bush MapFeature",
  widthTiles: MAP_W, heightTiles: MAP_H, tileSize: TILE, seed: SIM_SEED,
  border: "one wall tile around the edge",
  wallColumn: { x: WALL_COLUMN_X, rows: WALL_ROWS, doorwayRows: [13, 14, 15, 16, 17, 18] },
  bush: { tiles: BUSH_TILES, centre: BUSH_CENTRE, featureIndex: 0, kind: "bush" },
  spawns: [],
  note: "one sight corner: the vertical wall's only opening is far below the actors, so a target that steps behind it is out of direct line of sight while the owner's trail memory still covers its tile",
  mapTilesSha256: sha256(Buffer.from(ARENA_MAP.tiles)),
  featureGridSha256: sha256(Buffer.from(ARENA_MAP.featureGrid)),
  featuresJson: JSON.stringify(ARENA_MAP.features),
};

// ----------------------------------------------------------------------------------------------------- the run profiles
// Ordinary arena profile: four real player seats, no planning/fill wait, patience and sudden death pushed far out, and the
// weapon-only module option signatures:false (which truthfully also leaves out every faction module: Fire Roam, the Bruiser
// passives, the Plague corpses/zombies and the Sentenced hunt are not installed in these worlds).
const ARENA_CONFIG = {
  minPlayers: 4, lobbySeconds: 0, fillSeconds: 0, planSeconds: 0, patienceSeconds: 3600,
  patienceMinSeconds: 3600, suddenDeathSeconds: 3600, pvpRules: false,
};
const ARENA_MODULES = { signatures: false, walkHints: false };
// Full-module profile: the complete assembler order (every module installed) for the Swarm hidden/reappear lifecycle.
const FULL_CONFIG = { minPlayers: 4, lobbySeconds: 0, fillSeconds: 0, planSeconds: 0, patienceSeconds: 3600,
  patienceMinSeconds: 3600, suddenDeathSeconds: 3600, pvpRules: false };
const FULL_MODULES = { walkHints: false };
// Training profile: a separate corpus domain (real config.training plus the actual installTraining), one seat.
const TRAINING_CONFIG = {
  minPlayers: 1, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
  suddenDeathSeconds: 3600, pvpRules: false, dummies: true, training: true,
};
const TRAINING_MODULES = { signatures: false, walkHints: false };
const PROFILES: any = {
  "arena-weapon-only": { config: ARENA_CONFIG, modules: ARENA_MODULES, training: false, signatures: "false (faction modules not installed)" },
  "arena-full-module": { config: FULL_CONFIG, modules: FULL_MODULES, training: false, signatures: "default (the complete assembler order)" },
  "training-console": { config: TRAINING_CONFIG, modules: TRAINING_MODULES, training: true, signatures: "false (faction modules not installed)" },
};
const SEAT_FACTIONS = { own: "fire", tgt: "fire", thr: "frost", fou: "plague" };

// --------------------------------------------------------------------------------------------------- declared placements
// Every case's seats are placed ONCE, after the raid started and before the first recorded combat input, from this table.
// L07/L08 use a fire target (950 hp, 20/20 defense) so the real wand kill needs a bounded number of owner hits.
const PLACEMENTS: any = {
  L07: { own: [400, 320, 0], tgt: [480, 320, Math.PI], thr: [200, 100, 0], fou: [1100, 560, 0] },
  L08: { own: [400, 320, 0], tgt: [480, 320, Math.PI], thr: [200, 100, 0], fou: [1100, 560, 0] },
  D02: { own: [400, 320, 0], tgt: [480, 320, Math.PI], thr: [200, 100, 0], fou: [1100, 560, 0] },
  M04: { own: [400, 320, 0] },
  M05: { own: [400, 320, 0] },
};
// Ground racks, through the real loot constructor dropWeapon, at tick 0 (before any player joins).
const RACKS: any = {
  wand: [{ x: 400, y: 320, def: "wand" }],
  bow: [{ x: 400, y: 320, def: "bow" }],
  bowAndWand: [{ x: 400, y: 320, def: "bow" }, { x: 400, y: 320, def: "wand" }],
  wandAndBow: [{ x: 400, y: 320, def: "wand" }, { x: 400, y: 320, def: "bow" }],
  sword: [{ x: 400, y: 320, def: "sword" }],
};

// ------------------------------------------------------------------------------------------------------- source closure
const ENTRY_SOURCES = [
  "packages/server/src/bots/brain/perception.ts",
  "packages/server/src/sim/gameplay.ts",
  "packages/server/src/sim/world.ts",
  "packages/server/src/sim/step.ts",
  "packages/server/src/sim/weapons.ts",
  "packages/server/src/sim/targeting.ts",
  "packages/server/src/sim/vision.ts",
  "packages/server/src/sim/mods.ts",
  "packages/server/src/sim/inputs.ts",
  "packages/server/src/sim/loot.ts",
  "packages/server/src/sim/status.ts",
  "packages/server/src/sim/combatant.ts",
  "packages/server/src/sim/training.ts",
  "packages/shared/src/index.ts",
  "packages/shared/src/schema.ts",
  "packages/shared/src/mods.ts",
  "packages/shared/src/vision.ts",
  "packages/shared/src/map.ts",
  "packages/shared/src/policies.ts",
  "packages/shared/src/abilities.ts",
  "packages/client/src/render/targeting.ts",
  "packages/client/src/render/FighterArt.ts",
  "packages/client/src/ui/weaponBar.ts",
  "packages/client/src/ui/buildHud.ts",
  "packages/client/src/ui/buildModel.ts",
  "packages/client/src/ui/championCombatHud.ts",
  "packages/client/src/ui/championCombatModel.ts",
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
const isFile = (p: string) => existsSync(repo(p)) && statSync(repo(p)).isFile();
const tryTs = (base: string): string | null => {
  for (const cand of [base, base + ".ts", base + ".tsx", base + ".mts", base.replace(/\.js$/, ".ts"), base + "/index.ts", base + "/index.tsx"]) {
    if (isFile(cand)) return cand;
  }
  return null;
};
function resolveSpecifier(fromRel: string, spec: string): { kind: string; path: string } {
  if (spec.charAt(0) === ".") {
    const base = join(dirname(fromRel), spec).split("\\").join("/");
    if (spec.endsWith(".css")) return { kind: "style", path: base };
    const ts = tryTs(base);
    return ts ? { kind: "ts", path: ts } : { kind: "unresolved", path: base };
  }
  if (spec === "@raid/shared") return { kind: "ts", path: "packages/shared/src/index.ts" };
  if (spec.indexOf("@raid/shared/") === 0) {
    const ts = tryTs("packages/shared/src/" + spec.slice("@raid/shared/".length));
    return ts ? { kind: "ts", path: ts } : { kind: "unresolved", path: spec };
  }
  return { kind: "external", path: spec };
}
const sourceFiles = new Set<string>();
const styleFiles = new Set<string>();
const externalImports = new Set<string>();
const unresolvedImports = new Set<string>();
{
  const stack = ENTRY_SOURCES.slice();
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
}
const sourceFileHashes: Record<string, string> = Object.fromEntries(Array.from(sourceFiles).sort().map((p) => [p, shaFile(p)]));
const styleFileHashes: Record<string, string> = Object.fromEntries(Array.from(styleFiles).sort().map((p) => [p, shaFile(p)]));
const externalVersions: Record<string, string> = {};
for (const name of ["@colyseus/schema", "tsx", "typescript"]) {
  const p = repo("node_modules/" + name + "/package.json");
  if (existsSync(p)) externalVersions[name] = String(JSON.parse(readFileSync(p, "utf8")).version);
}
const TOOL_FILES = [
  "tools/owner-combat-continuation-fixtures/capture.mts",
  "tools/owner-combat-continuation-fixtures/capture.sh",
  "tools/owner-combat-continuation-fixtures/client-stub-loader.mjs",
  "tools/owner-combat-continuation-fixtures/compare.mjs",
  "tools/owner-combat-continuation-fixtures/apply-patch.mjs",
  "tools/owner-combat-continuation-fixtures/run-mutants.sh",
  "tools/owner-combat-continuation-fixtures/hash-of.mjs",
];
const toolHashes: Record<string, string> = {};
for (const p of TOOL_FILES) if (isFile(p)) toolHashes[p] = shaFile(p);
const frozenOriginalHashes: Record<string, string> = Object.fromEntries(FROZEN_ORIGINAL_FILES.map((p) => [p, shaFile(p)]));
const frozenCorpora: any = {};
for (const name of ["producer.json", "human-projection.json", "boundaries.json"]) {
  const rel = "parity/policy/owner-combat/" + name;
  const parsed = JSON.parse(readFileSync(repo(rel), "utf8"));
  frozenCorpora[name] = { sha256: sha256(readFileSync(repo(rel))), captureSha256: parsed.profile.captureSha256, bytes: statSync(repo(rel)).size };
}

const PROFILE_BASE: any = {
  format: FORMAT,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  image: IMAGE,
  imageDigest: "sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292",
  imagePlatform: "linux/amd64",
  asserts: { node: "v22.23.4", platform: "linux", arch: "x64" },
  base: {
    commit: BASE_COMMIT,
    branch: BRANCH,
    immutableBase: true,
    frozenOriginal: {
      note: "the accepted source-only partial slice at the immutable base; these 32 files and three corpora must remain byte-identical and are not recaptured by this packet",
      branch: FROZEN_ORIGINAL_BRANCH,
      base: FROZEN_ORIGINAL_BASE,
      fileCount: FROZEN_ORIGINAL_FILES.length,
      files: frozenOriginalHashes,
      corpora: frozenCorpora,
    },
  },
  repoRoot,
  install: {
    command: "npm ci --ignore-scripts --no-audit --no-fund",
    order: ["bind the repo read-only at /repo", "tmpfs /repo/node_modules", "npm ci", "node --import tsx --experimental-loader /capture/client-stub-loader.mjs /capture/capture.mts"],
  },
  sourceClosure: "static import/export + dynamic-import graph from the entry list below, TypeScript files only",
  entrySources: ENTRY_SOURCES,
  sourceFileCount: Object.keys(sourceFileHashes).length,
  sourceFiles: sourceFileHashes,
  styleFileCount: Object.keys(styleFileHashes).length,
  styleFiles: styleFileHashes,
  externalImports: Array.from(externalImports).sort(),
  externalVersions,
  externalVersionsNote: "external package contents are not part of this hash graph; they are pinned by package-lock.json and the installed version recorded here",
  unresolvedImports: Array.from(unresolvedImports).sort(),
  manifests: {
    "package.json": shaFile("package.json"),
    "package-lock.json": shaFile("package-lock.json"),
    "tsconfig.base.json": isFile("tsconfig.base.json") ? shaFile("tsconfig.base.json") : null,
    ...Object.fromEntries(["packages/server/tsconfig.json", "packages/shared/tsconfig.json", "packages/client/tsconfig.json"].filter(isFile).map((p) => [p, shaFile(p)])),
  },
  tool: toolHashes,
  declared: {
    map: MAP_DESCRIPTION,
    profiles: PROFILES,
    placements: PLACEMENTS,
    racks: RACKS,
    seats: SEAT_FACTIONS,
    constants: {
      TICK_MS, TARGET_RANGE: shared.TARGET_RANGE, TARGET_LOS_GRACE_MS: shared.TARGET_LOS_GRACE_MS,
      WISH_LOCK_SECONDS: shared.WISH_LOCK_SECONDS, VISION_RADIUS: shared.VISION_RADIUS,
      VISION_TRAIL_MS: shared.VISION_TRAIL_MS, BUSH_REVEAL_RADIUS: shared.BUSH_REVEAL_RADIUS, OPTIMISTIC_LOCK_MS,
    },
  },
};

function finalize(corpus: any): string {
  corpus.profile = { ...PROFILE_BASE };
  corpus.profile.captureSha256 = sha256(JSON.stringify(typed(corpus)));
  return JSON.stringify(typed(corpus)) + "\n";
}

// ------------------------------------------------------------------------------------------------------- world building
/** A fresh real world for one case: declared racks at tick 0, the declared seats, the ordinary lobby step, placement. */
function makeWorld(profileName: string, opts: { clock?: number; racks?: string[]; seats?: string[]; rackAt?: any } = {}): any {
  const prof = PROFILES[profileName];
  // Every callback is explicit: the seeded stream and a declared deterministic item-uid counter (no randomUUID).
  let itemUid = 0;
  const world = createGameWorld({
    seed: SIM_SEED, map: ARENA_MAP, config: prof.config, random: mulberry32(8),
    newItemUid: () => "item-" + (++itemUid),
  }, prof.modules);
  if (opts.clock !== undefined) world.state.serverTime = opts.clock;
  const rackAt = opts.rackAt ?? { x: 400, y: 320 };
  const rackIds: string[] = [];
  for (const def of opts.racks ?? []) rackIds.push(dropWeapon(world, rackAt, def).id);
  const seats = opts.seats ?? ["own", "tgt", "thr", "fou"];
  const factions = opts.factions ?? SEAT_FACTIONS;
  for (const id of seats) addPlayer(world, id, id.toUpperCase(), { faction: factions[id] ?? SEAT_FACTIONS[id] });
  if (prof.training) installTraining(world);
  step(world, TICK_MS);
  expectSource(world.state.phase === "active", "the first step leaves the lobby and starts the raid");
  return { world, rackIds, map: ARENA_MAP };
}

function place(world: any, id: string, x: number, y: number, facing: number): void {
  const p = world.state.players.get(id);
  const rt = world.players.get(id);
  assert(p && rt, "seat " + id);
  p.x = x;
  p.y = y;
  p.facing = facing;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
}
function placeAll(world: any, caseId: string): void {
  const table = PLACEMENTS[caseId];
  for (const id of Object.keys(table)) {
    if (!world.state.players.has(id)) continue;
    const [x, y, facing] = table[id];
    place(world, id, x, y, facing);
  }
}

// --------------------------------------------------------------------------------------------------- owner group + frames
const OWNER_GROUP_FIELDS = ["attackTarget", "drawStartedAt", "readyAt", "asMult", "windupMult", "speedMult"];
const OWNER_CONTEXT_FIELDS = ["status", "faction", "slot", "weapon0", "weapon1", "hp", "effects"];
function ownerGroup(p: any): any {
  const out: any = {};
  for (const f of OWNER_GROUP_FIELDS) out[f] = p[f];
  for (const f of OWNER_CONTEXT_FIELDS) out[f] = p[f];
  return out;
}
function actorRow(p: any): any {
  return { x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, status: p.status, faction: p.faction, effects: p.effects, weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot, attackTarget: p.attackTarget, drawStartedAt: p.drawStartedAt, readyAt: p.readyAt };
}
function transitions(values: any[]): any[] {
  const out: any[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1]) out.push({ frameIndex: i, step: values[i].step, from: values[i - 1].value, to: values[i].value });
  }
  return out;
}
function fieldSeries(frames: any[], read: (f: any) => any): any[] {
  return frames.map((f) => ({ step: f.step, tick: f.tick, t: f.serverTime, value: read(f) }));
}

const RENDER_DELAY_MS = 100;
/** The original human-projection methods, carried across one case: one retained LockDisplay and one retained DrawTrack. */
class HumanRig {
  readonly lock = new LockDisplay();
  readonly draw = new DrawTrack();
  readonly hud: any;
  noteAt = 0;
  noteId: string | null = null;
  prevReadyAt = 0;
  prevCooldown = 1;
  readonly frames: any[] = [];
  constructor() {
    this.hud = new ChampionCombatHud(STUB_NODE);
  }
  note(id: string, uiNow: number): void {
    this.lock.note(id, uiNow);
    this.noteAt = uiNow;
    this.noteId = id;
  }
  sample(decodedState: any, decodedMe: any, serverTime: number, stepIndex: number, kind = "step", label: string | null = null): void {
    const decoded = decodedMe ? ownerGroup(decodedMe) : null;
    const synced = decoded ? decoded.attackTarget : null;
    const uiNow = serverTime;
    const shownNow = this.lock.shown(synced, uiNow);
    const boundary: any[] = [];
    if (this.noteId !== null) {
      for (const offset of [0, 250, 499, 500, 501, 750]) boundary.push({ offset, shown: this.lock.shown(synced, this.noteAt + offset) });
    }
    const renderT = serverTime - RENDER_DELAY_MS;
    const drawOn = decoded ? this.draw.track(decoded.drawStartedAt, renderT, serverTime) : false;
    let cooldown = null;
    if (decoded && decoded.readyAt !== this.prevReadyAt) {
      const extension = isExtension(this.prevReadyAt, decoded.readyAt, serverTime);
      const value = nextCooldown(this.prevReadyAt, this.prevCooldown, decoded.readyAt, serverTime);
      cooldown = { called: true, prevReadyAt: this.prevReadyAt, prevCooldown: this.prevCooldown, readyAt: decoded.readyAt, patchT: serverTime, isExtension: extension, nextCooldown: value };
      this.prevReadyAt = decoded.readyAt;
      this.prevCooldown = value;
    } else {
      cooldown = { called: false, prevReadyAt: this.prevReadyAt, prevCooldown: this.prevCooldown, readyAt: decoded ? decoded.readyAt : null, patchT: serverTime };
    }
    const stats = decodedMe ? statsOf(decodedMe).map((s: any) => ({ id: s.id, label: s.label, value: s.value, tip: s.tip, dim: s.dim ?? false })) : null;
    let champion: any = null;
    if (decodedState && decodedMe) {
      this.hud.update(decodedState, decodedMe, serverTime);
      champion = {
        hidden: this.hud.root.hidden === true,
        rows: (this.hud.rows ?? []).map((r: any) => ({ name: r.name.textContent, value: r.value.textContent, scaling: r.scaling.textContent, tooltip: r.tip.textContent })),
      };
    }
    const fullDraw = decoded ? fullDrawSeconds(decoded.faction, decoded.asMult, decoded.windupMult) : null;
    this.frames.push({
      step: stepIndex, serverTime, kind, label,
      decoded,
      lockDisplay: { synced, uiNow, noteAt: this.noteId === null ? null : this.noteAt, noteId: this.noteId, shownOptimisticNow: shownNow, boundary },
      drawTrack: { renderT, patchT: serverTime, start: this.draw.start, shown: drawOn, decodedDrawStartedAt: decoded ? decoded.drawStartedAt : null },
      cooldown,
      fullDrawSeconds: fullDraw,
      statsOf: stats,
      championCombat: champion,
    });
  }
}

// ----------------------------------------------------------------------------------------------------- the step recorder
class Tape {
  readonly world: any;
  readonly ownerId: string;
  readonly caseId: string;
  readonly training: boolean;
  readonly rig = new HumanRig();
  readonly frames: any[] = [];
  readonly actions: any[] = [];
  readonly clientState: any;
  readonly decoder: any;
  readonly encoder: any;
  firstFrame = true;
  readonly focusId: string;
  pending: any[] = [];
  steps = 0;
  lastEvents: any[] = [];
  /** Observer taps for the current capture window: landed damage and fighter-out transitions (read-only). */
  stepObservers: any[] = [];
  readonly observers: any[] = [];
  readonly damageLog: any[] = [];
  readonly directSnapshots: any[] = [];
  constructor(world: any, caseId: string, ownerId: string, training: boolean, focusId = "tgt") {
    this.world = world;
    this.caseId = caseId;
    this.ownerId = ownerId;
    this.training = training;
    this.focusId = focusId;
    // One server encoder and one client decoder, as the Room and a joined client hold them.
    this.encoder = new schemaPkg.Encoder(world.state);
    this.clientState = new RaidState();
    this.decoder = new schemaPkg.Decoder(this.clientState);
  }
  /** Queue one ordinary client message through the actual parse/queue door, and mirror the client's own lock display note. */
  send(actorId: string, message: string, msg: any): boolean {
    const rt = this.world.players.get(actorId);
    assert(rt, "actor " + actorId);
    const accepted = enqueueClientMessage(rt.inputs, message, msg, { training: this.training });
    this.actions.push({ step: this.steps, actor: actorId, message, msg: jsonSafe(msg), accepted });
    this.pending.push({ actor: actorId, message, msg: jsonSafe(msg), accepted });
    if (actorId === this.ownerId) {
      const uiNow = this.world.state.serverTime + TICK_MS;
      if (message === "target") this.rig.note(String(msg.id), uiNow);
      else if (message === "move" || message === "stop") this.rig.note("", uiNow);
    }
    return accepted;
  }
  /**
   * Read-only observer taps used for the new rows: a landed-damage record (what actually hit whom) and a fighter-out
   * snapshot taken at the exact source transition (before trainingSettle / row deletion). They never write the world.
   */
  observe(): void {
    const w = this.world;
    const snap = (id: string): any => {
      const p = w.state.players.get(id) ?? w.state.mobs.get(id);
      const rt = w.players.get(id) ?? w.mobs.get(id);
      if (!p || !rt) return { id, present: false };
      const isPlayer = w.state.players.has(id);
      const weapon = rt.weapon;
      return {
        id, present: true, kind: isPlayer ? "player" : "mob", status: p.status, hp: p.hp, maxHp: p.maxHp,
        x: p.x, y: p.y, faction: p.faction, effects: p.effects,
        attackTarget: isPlayer ? p.attackTarget : null, drawStartedAt: isPlayer ? p.drawStartedAt : null, readyAt: isPlayer ? p.readyAt : null,
        slot: p.slot, weapon0: p.weapon0, weapon1: p.weapon1,
        down: isPlayer ? rt.down : null, resolved: isPlayer ? rt.resolved : null, killedBy: isPlayer ? rt.killedBy : null,
        build: isPlayer ? countsSafe(p.build) : null, mobStats: isPlayer ? countsSafe(p.mobStats) : null,
        lock: weapon ? weapon.lock : null, held: weapon ? weapon.held : null,
        action: weapon && weapon.action ? { kind: weapon.action.kind, weapon: weapon.action.weapon, startedAt: weapon.action.startedAt, landsAt: weapon.action.landsAt, target: weapon.action.target ?? null } : null,
      };
    };
    chainHook(w, "fighterOut", (_w, id, cause) => {
      const ev = { kind: "fighterOut", step: this.steps, serverTime: w.state.serverTime, id, cause, actor: snap(id) };
      this.stepObservers.push(ev);
      this.observers.push(ev);
    });
    chainHook(w, "hitLanded", (_w, entry, applied) => {
      const victim = entry.victim;
      const by = entry.by;
      if (!(victim === "own" || victim === "tgt" || by.id === "own" || by.id === "tgt")) return;
      const v = w.state.players.get(victim) ?? w.state.mobs.get(victim);
      const ev = {
        kind: "hitLanded", step: this.steps, serverTime: w.state.serverTime,
        by: { id: by.id, name: by.name, ownerId: by.ownerId ?? null }, victim, applied,
        weapon: entry.weapon, raw: entry.packet?.raw ?? null, crit: entry.packet?.crit === true,
        victimHpAfter: v ? v.hp : null, victimStatusAfter: v ? v.status : null,
      };
      this.stepObservers.push(ev);
      this.damageLog.push(ev);
    });
    chainHook(w, "weaponSwapped", (_w, c) => {
      this.stepObservers.push({ kind: "weaponSwapped", step: this.steps, serverTime: w.state.serverTime, id: c.id, slot: c.s.slot, weapon0: c.s.weapon0, weapon1: c.s.weapon1 });
    });
  }
  /** The direct lifecycle snapshot for removePlayer: the actual call is made by the case, between completed steps. */
  direct(label: string, events: any[]): any {
    // The callers' removePlayer/downPlayer hooks have already pushed their observer rows; keep them in this snapshot.
    const snapshot = this.capture("direct-lifecycle", label, [], events, false);
    this.stepObservers = [];
    return snapshot;
  }
  step(opts: { record?: boolean } = {}): any[] {
    this.stepObservers = [];
    const events = step(this.world, TICK_MS);
    this.lastEvents = events;
    const pending = this.pending;
    this.pending = [];
    if (opts.record !== false) this.frame(pending, events);
    this.steps += 1;
    return events;
  }
  frame(pending: any[], events: any[]): any {
    return this.capture("step", null, pending, events, true);
  }
  capture(kind: string, label: string | null, pending: any[], events: any[], store: boolean): any {
    const w = this.world;
    const s = w.state;
    const me = s.players.get(this.ownerId);
    const hostGroup = me ? ownerGroup(me) : null;
    // (a) One retained client, the SDK's own protocol: the full state once, then the step's patch, decoded into the same
    //     client state (exactly what a joined client holds). The patch bytes are hashed.
    let patch: Buffer;
    if (this.firstFrame) {
      patch = Buffer.from(this.encoder.encodeAll());
      this.encoder.discardChanges();
      this.firstFrame = false;
    } else {
      patch = Buffer.from(this.encoder.encode());
    }
    const patchSha = sha256(patch);
    this.decoder.decode(patch);
    this.encoder.discardChanges();
    const decodedMe = this.clientState.players.get(this.ownerId);
    const decodedGroup = decodedMe ? ownerGroup(decodedMe) : null;
    // (b) A full encode/decode of the canonical group: the group fields written into a fresh real PlayerState, encoded as a
    //     full RaidState snapshot and decoded into a fresh state (a full snapshot every step, not the delta protocol).
    const snapRow = new PlayerState();
    if (me) for (const f of OWNER_GROUP_FIELDS.concat(OWNER_CONTEXT_FIELDS)) snapRow[f] = me[f];
    const snapState = new RaidState();
    snapState.players.set("own", snapRow);
    const snapEnc = new schemaPkg.Encoder(snapState);
    const snapBytes = Buffer.from(snapEnc.encodeAll());
    const snapDecoded = new RaidState();
    new schemaPkg.Decoder(snapDecoded).decode(snapBytes);
    const snapDecodedRow = snapDecoded.players.get("own");
    const fullGroup = snapDecodedRow ? ownerGroup(snapDecodedRow) : null;
    const named = me ? me.attackTarget : "";
    const probes: any = { named, source: null, target: null, focus: null };
    const rt = w.players.get(this.ownerId);
    if (rt) {
      const act = rt.weapon.action;
      probes.source = {
        lock: rt.weapon.lock, lockSeen: rt.weapon.lockSeen, lockLosLostAt: rt.weapon.lockLosLostAt,
        lockLosLostMs: rt.weapon.lockLosLostAt > 0 ? s.serverTime - rt.weapon.lockLosLostAt : 0,
        held: rt.weapon.held, bufferedUntil: rt.weapon.bufferedUntil, aim: rt.weapon.aim,
        action: act ? { kind: act.kind, weapon: act.weapon, startedAt: act.startedAt, landsAt: act.landsAt, target: act.target ?? null } : null,
        pathLength: rt.path.length,
        rootUntil: rt.weapon.rootUntil,
      };
    }
    const probeActor = (id: string): any => {
      const owner = s.players.get(this.ownerId);
      const t = s.players.get(id) ?? s.mobs.get(id);
      const ownerC = combatant(w, this.ownerId);
      const tC = combatant(w, id);
      if (!t) return { id, present: false, note: "no state row for this id" };
      const playerRt = w.players.get(id);
      return {
        id,
        present: true,
        kind: s.players.has(id) ? "player" : "mob",
        x: t.x, y: t.y, hp: t.hp, maxHp: t.maxHp, status: t.status, effects: t.effects,
        down: playerRt ? playerRt.down : null, resolved: playerRt ? playerRt.resolved : null,
        killedBy: playerRt ? playerRt.killedBy : null, lastHit: playerRt ? playerRt.lastHit : null,
        standing: tC ? combatantMod.standing(tC) : false,
        hidden: tC ? isHidden(w, tC) : false,
        untargetable: tC ? isUntargetable(w, tC) : false,
        canSeePoint: canPlayerSee(w, this.ownerId, { x: t.x, y: t.y }),
        entitled: canPlayerSeeActor(w, this.ownerId, id, { x: t.x, y: t.y }),
        directLos: hasLineOfSight(collisionMap(w), owner, t),
        bushConcealed: bushConceals(w.map, owner, { x: t.x, y: t.y }, t.extra?.bushRevealUntil ?? 0, s.serverTime),
        lockable: ownerC && tC ? lockable(w, ownerC, tC) : false,
      };
    };
    probes.focus = probeActor(this.focusId);
    if (named === this.focusId) probes.target = probes.focus;
    else if (named !== "") probes.target = probeActor(named);
    // The original bot perceive, twice and on the two states the source actually has:
    //   bot        the SERVER brain's input: the live host state, whose timers keep full double precision;
    //   botDecoded the human client's input: the same state after the real schema encode/decode.
    // Both use the source's own canSee predicate.
    const perceptCtx = {
      selfId: this.ownerId, map: w.map, features: DECLARED_FEATURES, lastMinimap: null,
      canSee: (point: any) => canPlayerSee(w, this.ownerId, point),
    };
    const perceptHost = perceive({ state: s }, perceptCtx);
    const perceptDecoded = perceive({ state: this.clientState }, perceptCtx);
    const botGroup = (p: any) => ({
      attackTarget: p.self.attackTarget, drawStartedAt: p.self.drawStartedAt, readyAt: p.self.readyAt,
      asMult: p.self.asMult, windupMult: p.self.windupMult, speedMult: p.self.speedMult,
    });
    const bot = { t: perceptHost.t, self: botGroup(perceptHost), fighters: perceptHost.fighters.map((f: any) => f.id), mobs: perceptHost.mobs.map((m: any) => m.id) };
    const botDecoded = { t: perceptDecoded.t, self: botGroup(perceptDecoded), fighters: perceptDecoded.fighters.map((f: any) => f.id), mobs: perceptDecoded.mobs.map((m: any) => m.id) };
    this.rig.sample(this.clientState, decodedMe, s.serverTime, this.steps, kind, label);
    const actors: any = {};
    for (const id of ["own", "tgt", "thr", "fou"]) {
      const p = s.players.get(id);
      if (p) actors[id] = actorRow(p);
    }
    const projectiles = [...w.projectiles.values()].map((pr: any) => ({
      id: pr.id, kind: pr.kind, weapon: pr.weapon, owner: pr.owner, targetId: pr.targetId ?? null,
      x: pr.x, y: pr.y, traveled: pr.traveled, simT: pr.simT,
    }));
    const out = {
      kind, label,
      step: this.steps, tick: s.tick, serverTime: s.serverTime,
      inputs: pending,
      owner: hostGroup,
      ownerDecoded: decodedGroup,
      ownerBuild: me ? countsSafe(me.build) : null,
      ownerMobStats: me ? countsSafe(me.mobStats) : null,
      schema: {
        patch: { bytes: patch.length, sha256: patchSha },
        fullGroup: { bytes: snapBytes.length, sha256: sha256(snapBytes), decoded: fullGroup },
      },
      bot,
      botDecoded,
      actors,
      probes,
      projectiles,
      observers: plain(this.stepObservers),
      events: plain(events),
    };
    if (store) this.frames.push(out);
    else this.directSnapshots.push(out);
    return out;
  }
}

// --------------------------------------------------------------------------------------------------------- the case runner
const CASE_RESULTS: any[] = [];
function runCase(spec: any): any {
  const rackAt = spec.rackAt ?? { x: PLACEMENTS[spec.id].own[0], y: PLACEMENTS[spec.id].own[1] };
  const built = makeWorld(spec.profile, { clock: spec.clock, racks: spec.racks, seats: spec.seats, rackAt, factions: spec.factions });
  const world = built.world;
  placeAll(world, spec.id);
  if (spec.setup) spec.setup(world, built, spec);
  const tape = new Tape(world, spec.id, spec.ownerId ?? "own", PROFILES[spec.profile].training);
  tape.observe();
  const ctx: any = { recordFrom: 0, recordFrom2: 0, note: spec.note, rackIds: built.rackIds };
  for (let i = 0; i < spec.steps; i++) {
    if (spec.before) spec.before(tape, i, ctx);
    spec.script(tape, i, ctx);
    const record = spec.record ? spec.record(i, tape, ctx) : i >= ctx.recordFrom;
    tape.step({ record });
    if (spec.after) spec.after(tape, i, ctx);
  }
  const frames = tape.frames;
  const result = {
    id: spec.id,
    title: spec.title,
    profile: spec.profile,
    provenance: spec.provenance ?? "actual-producer",
    labels: spec.labels ?? { inputs: "ordinary enqueueClientMessage inputs only", lifecycle: [] },
    result: spec.result ?? "RECORDED",
    blockedReason: spec.blockedReason ?? null,
    note: spec.note,
    clock: spec.clock ?? null,
    seats: spec.seats ?? ["own", "tgt", "thr", "fou"],
    racks: built.rackIds.map((id: string, i: number) => ({ id, def: spec.racks[i] })),
    declaredSetup: {
      placement: PLACEMENTS[spec.id],
      racks: (spec.racks ?? []).map((def: string, i: number) => ({ id: built.rackIds[i], def, at: rackAt })),
      note: spec.setupNote ?? null,
    },
    frames,
    actions: tape.actions,
    frameCount: frames.length,
    firstStep: frames.length > 0 ? frames[0].step : null,
    lastStep: frames.length > 0 ? frames[frames.length - 1].step : null,
    directSnapshots: tape.directSnapshots,
    damageLog: tape.damageLog,
    observerLog: tape.observers,
    transitions: {
      attackTarget: transitions(fieldSeries(frames, (f) => f.owner.attackTarget)),
      drawStartedAt: transitions(fieldSeries(frames, (f) => f.owner.drawStartedAt)),
      readyAt: transitions(fieldSeries(frames, (f) => f.owner.readyAt)),
      asMult: transitions(fieldSeries(frames, (f) => f.owner.asMult)),
      windupMult: transitions(fieldSeries(frames, (f) => f.owner.windupMult)),
      speedMult: transitions(fieldSeries(frames, (f) => f.owner.speedMult)),
      effectsNamedTarget: transitions(fieldSeries(frames, (f) => (f.probes.target ? f.probes.target.effects : null))),
      targetEntitled: transitions(fieldSeries(frames, (f) => (f.probes.target ? f.probes.target.entitled : null))),
      directLos: transitions(fieldSeries(frames, (f) => (f.probes.target ? f.probes.target.directLos : null))),
      lockable: transitions(fieldSeries(frames, (f) => (f.probes.target ? f.probes.target.lockable : null))),
    },
    human: tape.rig.frames,
    observations: spec.observations ?? null,
    facts: spec.facts ? spec.facts(tape, built, ctx) : null,
  };
  CASE_RESULTS.push(result);
  return result;
}

// ============================================================================================================ the cases
// Every ordinary input below goes through enqueueClientMessage (the real parse/queue door) and is applied by step()'s own
// input phase. The only direct lifecycle call is L08's labelled removePlayer(world, id); it is never counted as ordinary input.

const mobIdOfType = (w: any, type: string, kind?: string): string | null => {
  for (const [id, m] of w.state.mobs) if (m.type === type && (!kind || m.kind === kind) && m.status === "alive") return id;
  return null;
};
const containerOfDef = (w: any, def: string): string | null => {
  for (const [id, c] of w.state.containers) if (c.items && c.items.length > 0 && c.items[0].def === def) return id;
  return null;
};
const frameAt = (tape: any, step: number): any => tape.frames.find((f: any) => f.step === step) ?? null;

// L07: a real target dies while the owner's canonical wand lock is nonempty. The owner's ordinary target message locks the
// target; the lock's own trigger lands real wand balls until the target's hp reaches 0 in the ledger. No death is forged and
// no hp is written: every point comes from a recorded hitLanded entry.
runCase({
  id: "L07", profile: "arena-weapon-only", title: "real target death under a nonempty canonical wand lock",
  note: "own locks tgt with an ordinary target message and lets the lock's own wand trigger kill it; the leading fight is unrecorded and the recorded window starts three to four hits before the death",
  racks: ["wand"], steps: 1800, factions: { own: "fire", tgt: "fire", thr: "frost", fou: "plague" },
  script: (tape: any, i: number, ctx: any) => {
    const w = tape.world;
    const p = w.state.players.get("tgt");
    const me = w.state.players.get("own");
    if (i === 0) { tape.send("own", "pickup", { containerId: ctx.rackIds[0] }); return; }
    if (i === 2) { tape.send("own", "target", { id: "tgt" }); return; }
    if (ctx.recordFrom === 0 && p && me && me.attackTarget === "tgt" && p.hp <= 120) ctx.recordFrom = tape.steps;
  },
  record: (i: number, tape: any, ctx: any) => ctx.recordFrom > 0 && (ctx.deathStep === undefined || tape.steps <= ctx.deathStep + 10),
  result: "PASS",
  after: (tape: any, i: number, ctx: any) => {
    const p = tape.world.state.players.get("tgt");
    if (ctx.deathStep === undefined && p && p.status !== "alive") ctx.deathStep = tape.steps;
  },
  facts: (tape: any) => {
    const frames = tape.frames;
    const death = frames.find((f: any) => f.actors.tgt && f.actors.tgt.status === "dead") ?? null;
    const deathIdx = death ? frames.indexOf(death) : -1;
    const pre = deathIdx > 0 ? frames[deathIdx - 1] : null;
    const clear = death ? frames.slice(deathIdx).find((f: any) => f.owner.attackTarget === "") ?? null : null;
    const targetDeathObserver = tape.observers.find((o: any) => o.kind === "fighterOut" && o.id === "tgt") ?? null;
    const hits = tape.damageLog.filter((h: any) => h.victim === "tgt");
    const lethal = hits.length > 0 ? hits[hits.length - 1] : null;
    return {
      firstRecordedStep: frames.length ? frames[0].step : null,
      lastRecordedStep: frames.length ? frames[frames.length - 1].step : null,
      firstRecordedLockFrame: frames.find((f: any) => f.owner.attackTarget !== "") ?? null,
      deathFrame: death ? { step: death.step, t: death.serverTime, status: death.actors.tgt.status, hp: death.actors.tgt.hp, attackTarget: death.owner.attackTarget, decodedAttackTarget: death.ownerDecoded.attackTarget, targetProbe: death.probes.target, action: death.probes.source.action, projectiles: death.projectiles, events: death.events } : null,
      preDeathFrame: pre ? { step: pre.step, t: pre.serverTime, hp: pre.actors.tgt.hp, attackTarget: pre.owner.attackTarget, readyAt: pre.owner.readyAt, action: pre.probes.source.action, projectiles: pre.projectiles } : null,
      clearFrame: clear ? { step: clear.step, t: clear.serverTime, attackTarget: clear.owner.attackTarget, decodedAttackTarget: clear.ownerDecoded.attackTarget, targetPresent: clear.actors.tgt !== undefined, status: clear.actors.tgt ? clear.actors.tgt.status : null, action: clear.probes.source.action, projectiles: clear.projectiles } : null,
      lockFramesNonEmpty: frames.filter((f: any) => f.owner.attackTarget !== "").length,
      lockSteps: frames.map((f: any) => ({ step: f.step, t: f.serverTime, attackTarget: f.owner.attackTarget, decoded: f.ownerDecoded.attackTarget, targetStatus: f.actors.tgt ? f.actors.tgt.status : null, targetHp: f.actors.tgt ? f.actors.tgt.hp : null, readyAt: f.owner.readyAt, action: f.probes.source.action ? f.probes.source.action.kind : null, projectiles: f.projectiles.length })),
      targetDeathObserver,
      lethalHit: lethal,
      lastFiveHits: hits.slice(-5),
      hitsOnTarget: hits.length,
      deathEvents: death ? death.events : [],
      anythingSurvives: death ? {
        lockAfterDeathBeforeClear: frames.filter((f: any) => f.step >= death.step && f.owner.attackTarget !== "").length,
        actionAfterDeath: frames.filter((f: any) => f.step >= death.step && f.probes.source.action !== null).map((f: any) => ({ step: f.step, action: f.probes.source.action })),
        projectilesAfterDeath: frames.filter((f: any) => f.step >= death.step && f.projectiles.length > 0).map((f: any) => ({ step: f.step, projectiles: f.projectiles })),
      } : null,
    };
  },
  observations: {
    death: "the target is a real fire player in the arena; the owner's locked wand balls are the only damage source and the death is the ledger's applyHits -> downPlayer, not a written hp",
    lock: "the canonical mirror is expected to clear in the next completed step's targeting phase (lockable false -> resumeAttackMove -> dropLock), while a committed cast may survive",
  },
});

// L08: the actual sim/step.ts removePlayer(world, id) is called between completed steps and labelled direct lifecycle. It is
// not an ordinary client message and is not mixed into the ordinary reachability claims.
runCase({
  id: "L08", profile: "arena-weapon-only", title: "actual removePlayer over a nonempty canonical lock (labelled direct lifecycle)",
  note: "own locks tgt with the ordinary target message, then the case calls the real step.ts removePlayer(world, 'tgt') between steps; the removal, its result event and the next-step lock clear are recorded",
  racks: ["wand"], steps: 24, factions: { own: "fire", tgt: "fire", thr: "frost", fou: "plague" },
  provenance: "actual-producer ordinary inputs + labelled direct-lifecycle removePlayer call",
  labels: { inputs: "ordinary enqueueClientMessage inputs; removePlayer is a direct lifecycle API call", lifecycle: ["removePlayer(world,'tgt') at the labelled direct snapshot"], ordinaryReachability: false },
  script: (tape: any, i: number, ctx: any) => {
    if (i === 0) tape.send("own", "pickup", { containerId: ctx.rackIds[0] });
    else if (i === 2) tape.send("own", "target", { id: "tgt" });
  },
  after: (tape: any, i: number, ctx: any) => {
    if (i !== 7 || ctx.removed) return;
    ctx.removed = true;
    const before = tape.world.state.players.get("tgt");
    ctx.beforeRemoval = before ? { x: before.x, y: before.y, hp: before.hp, status: before.status, attackTarget: before.attackTarget } : null;
    removePlayer(tape.world, "tgt");
    const events = tape.world.events;
    tape.world.events = [];
    ctx.removalEvents = plain(events);
    ctx.direct = tape.direct("removePlayer(world,'tgt') direct lifecycle call", events);
  },
  record: () => true,
  result: "PASS",
  facts: (tape: any, _built: any, ctx: any) => {
    const direct = tape.directSnapshots[0] ?? null;
    const clearAfter = direct ? tape.frames.find((f: any) => f.step >= direct.step && f.owner.attackTarget === "") ?? null : null;
    return {
      directLabel: direct ? direct.label : null,
      beforeRemoval: ctx.beforeRemoval,
      atRemoval: direct ? {
        step: direct.step, t: direct.serverTime, ownerAttackTarget: direct.owner.attackTarget, ownerDecodedAttackTarget: direct.ownerDecoded.attackTarget,
        targetPresent: direct.actors.tgt !== undefined, targetProbe: direct.probes.target, targetRowDecoded: direct.ownerDecoded ? null : null,
        botFighters: direct.bot.fighters, botDecodedFighters: direct.botDecoded.fighters, projectiles: direct.projectiles,
      } : null,
      removalEvents: ctx.removalEvents ?? [],
      removalObservers: direct ? direct.observers : [],
      firstClearAfter: clearAfter ? { step: clearAfter.step, t: clearAfter.serverTime, attackTarget: clearAfter.owner.attackTarget, decodedAttackTarget: clearAfter.ownerDecoded.attackTarget, targetPresent: clearAfter.actors.tgt !== undefined, botFighters: clearAfter.bot.fighters } : null,
      lockFrames: tape.frames.map((f: any) => ({ step: f.step, attackTarget: f.owner.attackTarget, targetPresent: f.actors.tgt !== undefined, botFighters: f.bot.fighters })),
    };
  },
  observations: {
    direct: "removePlayer is a direct lifecycle API (MIA, result event, row deletion) and is labelled; it is not ordinary client input",
    lock: "the owner's canonical lock is expected to persist through the direct removal snapshot and clear in the next completed step, because the target runtime and row are gone",
  },
});

// D02: a real bow draw, then a legal ordinary swap that passes the shared swapAllowed rule with a real second-slot weapon.
runCase({
  id: "D02", profile: "arena-weapon-only", title: "real bow draw vs a legal ordinary swap",
  note: "own picks a real bow and a real wand (slot 0 bow, slot 1 wand), starts a real bow draw, then swaps to slot 1 while the draw is pending; the swap passes swapAllowed; a release stops the held trigger afterwards",
  racks: ["bow", "wand"], steps: 30,
  script: (tape: any, i: number, ctx: any) => {
    if (i === 0) tape.send("own", "pickup", { containerId: ctx.rackIds[0] });
    else if (i === 1) tape.send("own", "pickup", { containerId: ctx.rackIds[1] });
    else if (i === 4) { ctx.drawStartStep = tape.steps; tape.send("own", "attack", { a: 0 }); }
    else if (i === 8) {
      const me = tape.world.state.players.get("own");
      ctx.swap = { allowed: swapAllowed(me, 1, false), slotBefore: me.slot, weapon0: me.weapon0, weapon1: me.weapon1, readyBefore: me.readyAt, drawBefore: me.drawStartedAt };
      tape.send("own", "swap", { slot: 1 });
    } else if (i === 9) tape.send("own", "release", { a: 0 });
    else if (i === 20) tape.send("own", "attack", { a: 0 });
    else if (i === 24) tape.send("own", "release", { a: 0 });
  },
  record: () => true,
  result: "PASS",
  facts: (tape: any, _built: any, ctx: any) => {
    const frames = tape.frames;
    const drawFrame = frames.find((f: any) => f.owner.drawStartedAt > 0) ?? null;
    const swapFrame = frames.find((f: any) => f.inputs.some((x: any) => x.message === "swap")) ?? null;
    const drawStarts = frames.filter((f: any) => f.owner.drawStartedAt > 0).map((f: any) => ({ step: f.step, drawStartedAt: f.owner.drawStartedAt, readyAt: f.owner.readyAt, action: f.probes.source.action, slot: f.owner.slot }));
    const bowProjectiles = frames.flatMap((f: any) => f.projectiles.filter((pr: any) => pr.owner === "own" && pr.weapon === "bow").map((pr: any) => ({ step: f.step, ...pr })));
    const swapHuman = tape.rig.frames.filter((h: any) => swapFrame && h.step >= swapFrame.step - 2 && h.step <= swapFrame.step + 2).map((h: any) => ({ step: h.step, drawTrack: h.drawTrack, cooldown: h.cooldown }));
    return {
      drawStart: ctx.drawStartStep ?? null,
      swapInput: ctx.swap ?? null,
      drawFrame: drawFrame ? { step: drawFrame.step, t: drawFrame.serverTime, owner: drawFrame.owner, action: drawFrame.probes.source.action, projectiles: drawFrame.projectiles } : null,
      swapFrame: swapFrame ? { step: swapFrame.step, t: swapFrame.serverTime, owner: swapFrame.owner, action: swapFrame.probes.source.action, inputs: swapFrame.inputs, projectiles: swapFrame.projectiles } : null,
      drawStarts,
      bowProjectiles,
      targetHpFrames: frames.map((f: any) => ({ step: f.step, hp: f.actors.tgt ? f.actors.tgt.hp : null })).filter((x: any) => x.hp !== null),
      humanAroundSwap: swapHuman,
      postSwapFrames: frames.filter((f: any) => swapFrame && f.step > swapFrame.step).slice(0, 8).map((f: any) => ({ step: f.step, slot: f.owner.slot, drawStartedAt: f.owner.drawStartedAt, readyAt: f.owner.readyAt, action: f.probes.source.action, projectiles: f.projectiles })),
    };
  },
  observations: {
    cancellation: "weaponChanged cancels the current action (cancelAction) before the cooldown gets SWAP_SECONDS; a bow draw is cancelled by the swap, not by the release that follows",
    noOverclaim: "the release in this case is only a trigger release after the swap; no draw-cancel is claimed from it",
  },
});

// M04: the ordinary training console is asked for the real fleet3 speed card. trainCard admits only INTERACTIVE_AUGMENT_IDS,
// so the expected source answer is a silent refusal (no toast, build unchanged, no mirror movement); clear is recorded too.
runCase({
  id: "M04", profile: "training-console", seats: ["own"], title: "fleet3 speed card refused by the real training console (BLOCKED speed producer)",
  note: "the training player sends the ordinary train card fleet3 message, then the ordinary train clear message and an attack; the source's trainCard refuses the base card silently",
  racks: ["wand"], steps: 26,
  script: (tape: any, i: number, ctx: any) => {
    if (i === 0) tape.send("own", "pickup", { containerId: ctx.rackIds[0] });
    else if (i === 3) tape.send("own", "train", { cmd: "card", id: "fleet3", count: 1 });
    else if (i === 6) tape.send("own", "train", { cmd: "clear" });
    else if (i === 9) tape.send("own", "attack", { a: 0 });
    else if (i === 13) tape.send("own", "release", { a: 0 });
  },
  record: () => true,
  result: "BLOCKED",
  blockedReason: "sim/training.ts trainCard returns immediately unless cardLive(def) && isInteractiveAugment(def); fleet3 is a base card (kind base) and is not one of the 14 INTERACTIVE_AUGMENT_IDS, so the ordinary train card message is accepted and has no effect. The refusal is silent: the source emits no toast, the build stays empty and asMult/windupMult/speedMult stay 1000.",
  facts: (tape: any) => {
    const fleet = cardDef("fleet3");
    const trainActions = tape.actions.filter((a: any) => a.message === "train");
    const toasts = tape.frames.flatMap((f: any) => f.events.filter((e: any) => e.type === "toast").map((e: any) => ({ step: f.step, to: e.to, text: e.text })));
    return {
      fleetDef: fleet ? { id: fleet.id, kind: fleet.kind, title: fleet.title, text: fleet.text } : null,
      isInteractiveAugment: isInteractiveAugment("fleet3"),
      interactiveIds: CARDS.filter((c: any) => isInteractiveAugment(c)).map((c: any) => c.id),
      trainActions, toasts,
      buildSeries: tape.frames.map((f: any) => ({ step: f.step, build: f.ownerBuild, asMult: f.owner.asMult, windupMult: f.owner.windupMult, speedMult: f.owner.speedMult, events: f.events })),
      finalBuild: tape.frames.length ? tape.frames[tape.frames.length - 1].ownerBuild : null,
      finalMirrors: tape.frames.length ? { asMult: tape.frames[tape.frames.length - 1].owner.asMult, windupMult: tape.frames[tape.frames.length - 1].owner.windupMult, speedMult: tape.frames[tape.frames.length - 1].owner.speedMult } : null,
      refusal: "silent return in sim/training.ts trainCard (no toast, no build write); no admissible interactive augment in INTERACTIVE_AUGMENT_IDS writes the speedMult mirror",
    };
  },
  observations: {
    refusal: "trainCard's first guard rejects a card that is not cardLive + isInteractiveAugment; fleet3 is kind base, so the console does not even toast",
    clear: "train clear is a separate ordinary message; it clears cards/mobs/chests and toasts, but fleet3 was never in the build so no speed mirror can clear",
  },
});

// M05: a real admissible interactive augment (overkill) through train card, then a real practice-elite kill attempt against
// the training player. The elite's own damage downs the player; trainingSettle revives it in the same completed step.
runCase({
  id: "M05", profile: "training-console", seats: ["own"], title: "real training down and trainingSettle revival with an admissible interactive card",
  note: "own picks a real wand and bow, receives overkill through the ordinary train card path, spawns one practice elite through the ordinary train camp path, locks it and lets its real damage down the player; after the first revival it starts a real bow draw and is downed again, so both trainingSettle revivals are recorded (the second with a live draw)",
  racks: ["wand", "bow"], steps: 1800,
  script: (tape: any, i: number, ctx: any) => {
    const w = tape.world;
    const me = w.state.players.get("own");
    if (i === 0) { tape.send("own", "pickup", { containerId: ctx.rackIds[0] }); return; }
    if (i === 1) { tape.send("own", "pickup", { containerId: ctx.rackIds[1] }); return; }
    if (i === 2) { tape.send("own", "train", { cmd: "card", id: "overkill", count: 1 }); return; }
    if (i === 4) { tape.send("own", "train", { cmd: "camp", id: "executioner" }); return; }
    if (i === 6 && !ctx.elite) {
      const elite = mobIdOfType(w, "executioner", "elite");
      if (elite) { ctx.elite = elite; ctx.lockStep = tape.steps; tape.send("own", "target", { id: elite }); }
      return;
    }
    // After the first training revival, swap to the real bow and start a real draw so the second down records a live
    // drawStartedAt being cancelled by downPlayer and readyAt being reset by trainingSettle.
    if (ctx.downStep !== undefined && !ctx.secondPhase && tape.steps >= ctx.downStep + 12) {
      ctx.secondPhase = true;
      ctx.secondPhaseStart = tape.steps;
      // Re-engage the same real elite with the wand after the first revival (it may have leashed/healed while the player was
      // down); the bow swap waits until it has actually hurt the player again.
      if (ctx.elite && w.state.mobs.has(ctx.elite)) tape.send("own", "target", { id: ctx.elite });
      return;
    }
    if (ctx.secondPhase && !ctx.swapped && me && me.hp < 300 && me.slot === 0) {
      ctx.swapped = true;
      tape.send("own", "swap", { slot: 1 });
      return;
    }
    if (ctx.swapped && !ctx.drawStarted && me && me.slot === 1 && tape.steps >= ctx.secondPhaseStart + 2) {
      ctx.drawStarted = tape.steps;
      tape.send("own", "attack", { a: 0 });
      return;
    }
  },
  record: (i: number, tape: any, ctx: any) => i <= 9
    || (ctx.recordFrom > 0 && (ctx.stopAt === undefined || i < ctx.stopAt))
    || (ctx.recordFrom2 > 0 && (ctx.stopAt2 === undefined || i < ctx.stopAt2)),
  result: "PASS",
  after: (tape: any, i: number, ctx: any) => {
    const me = tape.world.state.players.get("own");
    if (!me) return;
    const downs = tape.observers.filter((o: any) => o.kind === "fighterOut" && o.id === "own" && o.cause === "down");
    if (ctx.recordFrom === 0 && me.hp <= 100 && downs.length === 0) ctx.recordFrom = tape.steps;
    if (ctx.downStep === undefined && downs.length >= 1) {
      ctx.downStep = downs[0].step;
      ctx.stopAt = ctx.downStep + 10;
    }
    if (ctx.secondPhase && ctx.recordFrom2 === 0 && ctx.swapped && me.hp <= 250) ctx.recordFrom2 = tape.steps;
    if (ctx.secondDown === undefined && downs.length >= 2) {
      ctx.secondDown = downs[1].step;
      ctx.stopAt2 = ctx.secondDown + 10;
    }
  },
  facts: (tape: any, _built: any, ctx: any) => {
    const downs = tape.observers.filter((o: any) => o.kind === "fighterOut" && o.id === "own" && o.cause === "down");
    expectSource(downs.length >= 2, "M05 should record two real training downs (the second while a bow draw is active)");
    const d1 = downs[0] ?? null;
    const d2 = downs[1] ?? null;
    const cardFrame = tape.frames.find((f: any) => f.ownerBuild && f.ownerBuild.entries && f.ownerBuild.entries.some((e: any) => e[0] === "overkill")) ?? null;
    const frameBefore = (step: number) => tape.frames.filter((f: any) => f.step < step).slice(-1)[0] ?? null;
    const frameAt = (step: number) => tape.frames.find((f: any) => f.step === step) ?? null;
    const summarise = (f: any) => f ? { step: f.step, t: f.serverTime, hp: f.actors.own.hp, maxHp: f.actors.own.maxHp, status: f.actors.own.status, x: f.actors.own.x, y: f.actors.own.y, attackTarget: f.owner.attackTarget, readyAt: f.owner.readyAt, drawStartedAt: f.owner.drawStartedAt, slot: f.owner.slot, build: f.ownerBuild, mobStats: f.ownerMobStats, mirrors: { asMult: f.owner.asMult, windupMult: f.owner.windupMult, speedMult: f.owner.speedMult }, action: f.probes.source.action, events: f.events } : null;
    const pre1 = d1 ? frameBefore(d1.step) : null;
    const rev1 = d1 ? frameAt(d1.step) : null;
    const pre2 = d2 ? frameBefore(d2.step) : null;
    const rev2 = d2 ? frameAt(d2.step) : null;
    const lastDrawBefore2 = d2 ? tape.frames.filter((f: any) => f.step < d2.step && f.owner.drawStartedAt > 0).slice(-1)[0] ?? null : null;
    const hitsOnOwn = tape.damageLog.filter((h: any) => h.victim === "own");
    return {
      grantedCard: cardFrame ? { step: cardFrame.step, build: cardFrame.ownerBuild, events: cardFrame.events } : null,
      eliteId: ctx.elite ?? null,
      lockFrame: ctx.lockStep !== undefined ? frameAt(ctx.lockStep) : null,
      downTap: d1,
      preDown: summarise(pre1),
      reviveFrame: summarise(rev1),
      secondDownTap: d2,
      secondPreDown: summarise(pre2),
      secondReviveFrame: summarise(rev2),
      secondPhase: { startedAt: ctx.secondPhaseStart ?? null, drawStartedAt: ctx.drawStarted ?? null },
      drawAtSecondDown: d2 ? d2.actor.drawStartedAt : null,
      readyAtAtSecondDown: d2 ? d2.actor.readyAt : null,
      drawBeforeSecondDown: lastDrawBefore2 ? lastDrawBefore2.owner.drawStartedAt : null,
      lastDrawFrameBeforeSecondDown: summarise(lastDrawBefore2),
      drawCancelledByDown: !!(lastDrawBefore2 && d2 && d2.actor.drawStartedAt === 0),
      drawAfterSecondRevival: rev2 ? rev2.owner.drawStartedAt : null,
      readyAtAfterSecondRevival: rev2 ? rev2.owner.readyAt : null,
      downHits: hitsOnOwn.slice(-8),
      totalHitsOnOwn: hitsOnOwn.length,
      buildPersists: !!(cardFrame && rev1 && rev2 && rev2.ownerBuild && rev2.ownerBuild.entries && rev2.ownerBuild.entries.some((e: any) => e[0] === "overkill")),
      trainingSettleSource: "sim/step.ts calls trainingSettle(world) at the end of an active training tick; it sets down/resolved/killedBy/lastHit null, path/ history reset, status alive, hp maxHp and resetWeapons (readyAt 0, drawStartedAt 0, attackTarget '', fresh weapon runtime). It does not clear build, mobStats or the mirrors.",
    };
  },
  observations: {
    revival: "the down tap is the exact fighterOut('down') transition, before trainingSettle; the next completed frame is the revived state. The second down happens with a live bow draw: downPlayer's releaseTrigger clears it, and trainingSettle resets readyAt to 0.",
    cards: "overkill is one of the 14 INTERACTIVE_AUGMENT_IDS and is granted through sim/training.ts trainCard, not by a direct build write",
  },
});

// ============================================================================================================= assembly
function caseHuman(c: any): any {
  return { id: c.id, producerCase: c.id, profile: c.profile, frames: c.human };
}
const producerCases = CASE_RESULTS.map((c: any) => { const copy: any = { ...c }; delete copy.human; return copy; });
const byId: any = Object.fromEntries(CASE_RESULTS.map((c: any) => [c.id, c]));
const caseMatrix = CASE_RESULTS.map((c: any) => ({ id: c.id, profile: c.profile, result: c.result, provenance: c.provenance, labels: c.labels, frameCount: c.frameCount, firstStep: c.firstStep, lastStep: c.lastStep, directSnapshots: c.directSnapshots.length, blockedReason: c.blockedReason }));

const producer = {
  format: FORMAT,
  note: "genuine complete-world ordinary input timelines for the bounded continuation rows. Every ordinary message goes through enqueueClientMessage and every recorded step is the source's own fixed step; L08's removePlayer is a labelled direct lifecycle call between steps. Every frame carries the canonical owner group and build/mobStats before and after a real @colyseus/schema encode/decode, the source events, the original perceive() on the live and decoded states, source probes and observer taps for landed damage and fighter-out transitions.",
  provenance: "actual-producer ordinary inputs + labelled direct-lifecycle L08",
  setup: {
    map: MAP_DESCRIPTION,
    profiles: PROFILES,
    seats: SEAT_FACTIONS,
    placements: PLACEMENTS,
    racks: RACKS,
    racksProvenance: "real loot constructor sim/loot.ts dropWeapon at tick 0, taken with ordinary pickup messages",
    placementProvenance: "declared setup applied once after the raid started and before the first recorded combat input",
  },
  cases: producerCases,
  caseMatrix,
  continuationAnswers: {
    l07: byId.L07 ? byId.L07.facts : null,
    l08: byId.L08 ? byId.L08.facts : null,
    d02: byId.D02 ? byId.D02.facts : null,
    m04: byId.M04 ? byId.M04.facts : null,
    m05: byId.M05 ? byId.M05.facts : null,
  },
  fourthMirrorAudit: {
    question: "can an ordinary, allowed training-camp kill write the attack-speed asMult mirror?",
    source: "packages/server/src/sim/mobLife.ts payMobKill starts with `if (world.config.training) return;` (line 252), before creditMobKill and before `grantMobStat(..., MOB_KILL_STACKS)` (line 265).",
    reward: "shared/mobStats.ts gives plagueRat and frostbowSentry `stat attackSpeed v 0.01`; MOB_KILL_STACKS is 3, so one credited ordinary kill would be +3% attack speed (wire +30).",
    observedBlocker: "A real training camp kill never reaches grantMobStat, so mobStats stays empty and asMult stays the identity 1000. `train stat` is a direct console set and was not used; no base card or fake stat was granted.",
    conclusion: "Only an arena/ordinary non-training credited kill of plagueRat or frostbowSentry (or a practice kill in a non-training world) can write that mirror; this continuation records the bounded refusal, not a produced mirror.",
  },
  limits: [
    "source and projection witness only: no native/Rust parity, no Unity/DOM/rendering, no socket/Room/join/reconnect, no protocol or public-field admission",
    "L08 is a direct lifecycle API call (removePlayer), explicitly labelled; it is not ordinary client input and is not part of the ordinary-reachability claim",
    "M05 runs in the real training profile with one declared seat; its practice elite is spawned by the real train camp handler, never injected",
    "recorded frames cover declared windows; unrecorded steps in L07/M05 are completed ordinary steps and are listed in the action log where they queue inputs",
    "observer taps (hitLanded/fighterOut/weaponSwapped) read state and never mutate the world; the only direct lifecycle call is L08's removePlayer",
    "per-frame schema recording is the real full encodeAll at the first recorded frame plus the real per-step patch decoded into one retained client state; it is not a delta-stream benchmark",
    "the human projection calls the original client methods inside a Node process with stub DOM/Phaser modules; no Phaser rendering, GPU, layout or real DOM lifecycle is exercised",
  ],
};

const humanCorpus = {
  format: FORMAT,
  note: "the actually decoded owner row, one retained client decode per case, fed to the original human projection methods. synced and optimistic lock values are recorded separately at declared UI test clocks; the draw track is one retained instance per lifecycle with a declared render delay; the cooldown helper carries the prior actual helper state; statsOf and ChampionCombatHud.update are the client's own code paths.",
  provenance: "actual-producer decoded owner + original client methods",
  rig: {
    lockDisplay: "packages/client/src/render/targeting.ts class LockDisplay: note() on the frame whose ordinary target/move/stop message was queued by the owner, shown() every frame with the decoded attackTarget at the declared UI clock, boundary samples at the declared offsets",
    drawTrack: "packages/client/src/render/FighterArt.ts class DrawTrack: one retained instance per case, track(decoded drawStartedAt, declared renderT, patchT)",
    renderDelayMs: RENDER_DELAY_MS,
    cooldown: "packages/client/src/ui/weaponBar.ts isExtension/nextCooldown, called only on a decoded readyAt change and carrying the prior helper state",
    statsOf: "packages/client/src/ui/buildHud.ts statsOf (which calls the original buildGains) over the decoded row",
    championCombat: "packages/client/src/ui/championCombatHud.ts ChampionCombatHud.update (which calls the original championCombatModel) with the decoded state and row; the rendered row text is read back from the stub nodes",
    stubs: ["document", "window", "localStorage", "sessionStorage", "navigator", "matchMedia", "requestAnimationFrame", "phaser (empty module)", "*.css (empty module)"],
    noDomClaim: "no real DOM, layout, painting, Phaser or GPU work happens here",
  },
  cases: CASE_RESULTS.map(caseHuman),
};

const corpusTexts: Record<string, string> = {
  "producer.json": finalize(producer),
  "human-projection.json": finalize(humanCorpus),
};

if (mode === "--write") {
  for (const name of OUTPUTS) writeFileSync(join(outDir, name), corpusTexts[name]!);
  console.log("captured 2 corpora: " + OUTPUTS.join(", "));
} else {
  for (const name of OUTPUTS) {
    const expected = readFileSync(join(outDir, name), "utf8");
    if (expected !== corpusTexts[name]) {
      expectSource(false, "checked-in " + name + " differs from the recaptured bytes");
      console.log("MISMATCH " + name);
    }
  }
  console.log("checked 2 corpora byte for byte: " + OUTPUTS.join(", "));
}

console.log("cases: " + CASE_RESULTS.map((c: any) => c.id + "(" + c.frameCount + ")").join(" "));
for (const c of CASE_RESULTS) {
  const f = c.facts;
  if (!f) { console.log("case " + c.id + " no facts"); continue; }
  console.log("case " + c.id + " result " + c.result + " frames " + c.frameCount + " direct " + c.directSnapshots.length + " actions " + c.actions.length);
  if (c.id === "L07") console.log("L07 death=" + JSON.stringify(f.deathFrame && { step: f.deathFrame.step, t: f.deathFrame.t, hp: f.deathFrame.hp, attackTarget: f.deathFrame.attackTarget, probe: f.deathFrame.targetProbe }) + " clear=" + JSON.stringify(f.clearFrame && { step: f.clearFrame.step, t: f.clearFrame.t, attackTarget: f.clearFrame.attackTarget }) + " lethal=" + JSON.stringify(f.lethalHit));
  if (c.id === "L08") console.log("L08 direct=" + JSON.stringify(f.atRemoval) + " events=" + JSON.stringify(f.removalEvents) + " clear=" + JSON.stringify(f.firstClearAfter));
  if (c.id === "D02") console.log("D02 swap=" + JSON.stringify(f.swapInput) + " drawStarts=" + JSON.stringify(f.drawStarts) + " swap=" + JSON.stringify(f.swapFrame && { step: f.swapFrame.step, owner: f.swapFrame.owner, action: f.swapFrame.action }) + " bowProjectiles=" + f.bowProjectiles.length);
  if (c.id === "M04") console.log("M04 interactive=" + f.isInteractiveAugment + " build=" + JSON.stringify(f.finalBuild) + " mirrors=" + JSON.stringify(f.finalMirrors) + " toasts=" + JSON.stringify(f.toasts));
  if (c.id === "M05") console.log("M05 card=" + JSON.stringify(f.grantedCard && f.grantedCard.build) + " down1=" + JSON.stringify(f.downTap && f.downTap.actor) + " pre1=" + JSON.stringify(f.preDown && { hp: f.preDown.hp, readyAt: f.preDown.readyAt, attackTarget: f.preDown.attackTarget }) + " revive1=" + JSON.stringify(f.reviveFrame && { hp: f.reviveFrame.hp, status: f.reviveFrame.status, readyAt: f.reviveFrame.readyAt, attackTarget: f.reviveFrame.attackTarget, build: f.reviveFrame.build }) + " down2=" + JSON.stringify(f.secondDownTap && f.secondDownTap.actor) + " pre2=" + JSON.stringify(f.secondPreDown && { hp: f.secondPreDown.hp, readyAt: f.secondPreDown.readyAt, drawStartedAt: f.secondPreDown.drawStartedAt, attackTarget: f.secondPreDown.attackTarget }) + " revive2=" + JSON.stringify(f.secondReviveFrame && { hp: f.secondReviveFrame.hp, status: f.secondReviveFrame.status, readyAt: f.secondReviveFrame.readyAt, drawStartedAt: f.secondReviveFrame.drawStartedAt, build: f.secondReviveFrame.build }));
}
