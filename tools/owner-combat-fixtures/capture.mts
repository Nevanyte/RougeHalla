// Canonical actual-source witness for OWNER_COMBAT_SOURCE_WITNESS, pinned linux/amd64 Node 22.23.4.
//
// Three corpora in one run:
//   producer.json          real createGameWorld/step lifecycles driven by enqueueClientMessage only; one frame per completed
//                          50 ms step over every transition: the canonical owner group (attackTarget, drawStartedAt, readyAt,
//                          asMult, windupMult, speedMult) before and after a real @colyseus/schema encode/decode, the source
//                          events in order, the source predicates and the original bot perceive() on the decoded state.
//   human-projection.json  the actually decoded owner fed to the ORIGINAL human methods: render/targeting.ts LockDisplay
//                          note/shown/reset (synced vs optimistic at declared UI test times), one retained
//                          FighterArt.ts DrawTrack per lifecycle with fullDrawSeconds, weaponBar.ts isExtension/nextCooldown
//                          carried through the decoded readyAt sequence, buildHud.ts statsOf (real buildGains) and
//                          ChampionCombatHud.update (the real championCombatModel call) read back from its rows.
//   boundaries.json        DECLARED probes only: PlayerState uint32 reflection/defaults and encode/decode for every declared
//                          drawStartedAt/readyAt value with the original bot u32 output, f64 mirror roundtrips and
//                          encodeMult/decodeMult, and declared LockDisplay/DrawTrack/nextCooldown boundary probes.
//
// Every probe is labelled: "actual-producer" rows come from the real sim (ordinary queued inputs, no handler calls), and
// "declared-probe" rows are declared source-schema/UI inputs. Nothing is hand-copied: the projection functions are the
// client's own exports. No Phaser rendering, DOM lifecycle, socket, Unity or native claim is made.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const IMAGE = "node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const FORMAT = "rh-owner-combat-source/1";
const OUTPUTS = ["producer.json", "human-projection.json", "boundaries.json"];
const BASE_COMMIT = "a894574f8f46938cafef7f4103877be58c602905";
const BRANCH = "deepseek/owner-combat-source";

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
const RECORD_MODE = process.env.RH_OWNER_COMBAT_RECORD === "1";
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
const { addPlayer, step } = stepMod;
const { enqueueClientMessage } = inputsMod;
const { dropWeapon } = lootMod;
const { canPlayerSee, canPlayerSeeActor } = visionMod;
const { lockable } = targetingMod;
const { combatant } = combatantMod;
const { isHidden, isUntargetable } = statusMod;
const { collisionMap } = worldMod;
const { installTraining } = trainingMod;
const { perceive } = perceptionMod;
const { LockDisplay, OPTIMISTIC_LOCK_MS } = lockDisplayMod;
const { DrawTrack, fullDrawSeconds } = fighterArtMod;
const { isExtension, nextCooldown } = weaponBarMod;
const { statsOf } = buildHudMod;
const { ChampionCombatHud } = championHudMod;
const { decodeMult, encodeMult, IDENTITY_MIRRORS, WIRE_IDENTITY_MIRRORS } = shared;

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
const SEAT_FACTIONS = { own: "fire", tgt: "holy", thr: "frost", fou: "plague" };

// --------------------------------------------------------------------------------------------------- declared placements
// Every case's seats are placed ONCE, after the raid started and before the first recorded combat input, from this table.
const PLACEMENTS: any = {
  L01: { own: [400, 320, 0], tgt: [480, 320, Math.PI], thr: [420, 400, 0], fou: [1100, 560, 0] },
  L02: { own: [400, 320, 0], tgt: [480, 320, Math.PI], thr: [200, 100, 0], fou: [1100, 560, 0] },
  L03: { own: [400, 320, 0], tgt: [480, 320, Math.PI], thr: [200, 100, 0], fou: [1100, 560, 0] },
  L04: { own: [60, 250, 0], tgt: [520, 250, Math.PI], thr: [200, 100, 0], fou: [1100, 560, 0] },
  L05: { own: [400, 320, 0], tgt: [480, 320, Math.PI], thr: [200, 100, 0], fou: [1100, 560, 0] },
  L06: { own: [300, 320, 0], tgt: [500, 320, Math.PI], thr: [200, 100, 0], fou: [1100, 560, 0] },
  D01: { own: [400, 320, 0], tgt: [480, 320, Math.PI], thr: [200, 100, 0], fou: [1100, 560, 0] },
  D03: { own: [400, 320, 0], tgt: [480, 320, Math.PI], thr: [200, 100, 0], fou: [1100, 560, 0] },
  D04: { own: [400, 320, 0], tgt: [480, 320, Math.PI], thr: [200, 100, 0], fou: [1100, 560, 0] },
  M01: { own: [400, 320, 0], tgt: [480, 320, Math.PI], thr: [200, 100, 0], fou: [1100, 560, 0] },
  M02: { own: [400, 320, 0] },
  M03: { own: [400, 320, 0] },
};
// Ground racks, through the real loot constructor dropWeapon, at tick 0 (before any player joins).
const RACKS: any = {
  wand: [{ x: 400, y: 320, def: "wand" }],
  bow: [{ x: 400, y: 320, def: "bow" }],
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
  "tools/owner-combat-fixtures/capture.mts",
  "tools/owner-combat-fixtures/capture.sh",
  "tools/owner-combat-fixtures/client-stub-loader.mjs",
  "tools/owner-combat-fixtures/compare.mjs",
  "tools/owner-combat-fixtures/apply-patch.mjs",
  "tools/owner-combat-fixtures/run-mutants.sh",
  "tools/owner-combat-fixtures/hash-of.mjs",
];
const toolHashes: Record<string, string> = {};
for (const p of TOOL_FILES) if (isFile(p)) toolHashes[p] = shaFile(p);

const PROFILE_BASE: any = {
  format: FORMAT,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  image: IMAGE,
  imageDigest: "sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292",
  imagePlatform: "linux/amd64",
  asserts: { node: "v22.23.4", platform: "linux", arch: "x64" },
  base: { commit: BASE_COMMIT, branch: BRANCH },
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
  sample(decodedState: any, decodedMe: any, serverTime: number, stepIndex: number): void {
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
      step: stepIndex, serverTime,
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
  step(opts: { record?: boolean } = {}): any[] {
    const events = step(this.world, TICK_MS);
    this.lastEvents = events;
    const pending = this.pending;
    this.pending = [];
    if (opts.record !== false) this.frames.push(this.frame(pending, events));
    this.steps += 1;
    return events;
  }
  frame(pending: any[], events: any[]): any {
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
      return {
        id,
        present: true,
        kind: s.players.has(id) ? "player" : "mob",
        x: t.x, y: t.y, hp: t.hp, maxHp: t.maxHp, status: t.status, effects: t.effects,
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
    this.rig.sample(this.clientState, decodedMe, s.serverTime, this.steps);
    const actors: any = {};
    for (const id of ["own", "tgt", "thr", "fou"]) {
      const p = s.players.get(id);
      if (p) actors[id] = actorRow(p);
    }
    return {
      step: this.steps, tick: s.tick, serverTime: s.serverTime,
      inputs: pending,
      owner: hostGroup,
      ownerDecoded: decodedGroup,
      schema: {
        patch: { bytes: patch.length, sha256: patchSha },
        fullGroup: { bytes: snapBytes.length, sha256: sha256(snapBytes), decoded: fullGroup },
      },
      bot,
      botDecoded,
      actors,
      probes,
      events: plain(events),
    };
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
  const ctx: any = { recordFrom: 0, note: spec.note, rackIds: built.rackIds };
  for (let i = 0; i < spec.steps; i++) {
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
    provenance: "actual-producer",
    note: spec.note,
    clock: spec.clock ?? null,
    seats: spec.seats ?? ["own", "tgt", "thr", "fou"],
    racks: built.rackIds.map((id: string, i: number) => ({ id, def: spec.racks[i] })),
    declaredSetup: {
      placement: PLACEMENTS[spec.id],
      racks: (spec.racks ?? []).map((def: string, i: number) => ({ id: built.rackIds[i], def, at: rackAt })),
      note: spec.setupNote ?? null,
    },
    actions: tape.actions,
    frameCount: frames.length,
    firstStep: frames.length > 0 ? frames[0].step : null,
    lastStep: frames.length > 0 ? frames[frames.length - 1].step : null,
    frames,
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
  };
  CASE_RESULTS.push(result);
  return result;
}

// ============================================================================================================ the cases
// Every input below goes through enqueueClientMessage (the real parse/queue door) and is applied by step()'s own input
// phase: no handler, action or helper is called instead of the queue.

// L01 acquire / re-click / retarget.
runCase({
  id: "L01", profile: "arena-weapon-only", title: "acquire, re-click the same target, then retarget a second player",
  note: "wand lock acquired from a real target message, re-clicked, then re-targeted at a second previously visible player",
  racks: ["wand"], steps: 26,
  script: (tape: any, i: number, ctx: any) => {
    if (i === 0) tape.send("own", "pickup", { containerId: ctx.rackIds[0] });
    else if (i === 1) tape.send("own", "target", { id: "tgt" });
    else if (i === 4) tape.send("own", "target", { id: "tgt" });
    else if (i === 8) tape.send("own", "target", { id: "thr" });
  },
  observations: {
    reclick: "the second target message names the already locked fighter: the source must not count it as a new acquisition",
    retarget: "the third names a second previously visible player and must move the canonical mirror",
  },
});

// L02 an ordinary move replaces the pending locked action.
runCase({
  id: "L02", profile: "arena-weapon-only", title: "move replaces the locked action and clears the canonical lock",
  note: "acquire, let the lock's own pending cast exist, then an ordinary move; traced past the cooldown end",
  racks: ["wand"], steps: 32,
  script: (tape: any, i: number, ctx: any) => {
    if (i === 0) tape.send("own", "pickup", { containerId: ctx.rackIds[0] });
    else if (i === 1) tape.send("own", "target", { id: "tgt" });
    else if (i === 6) tape.send("own", "move", { x: 300, y: 200, seq: 1 });
  },
  observations: {
    action: "the committed wand cast is ranged and keeps its target, so cancelLockedWindup(preserveRanged) leaves it; the lock and its mirror clear",
    cooldown: "the shared cooldown stays spent: readyAt does not go back to 0",
  },
});

// L03 an ordinary stop replaces the pending locked action, kept distinct from L02.
runCase({
  id: "L03", profile: "arena-weapon-only", title: "stop replaces the locked action and clears the canonical lock",
  note: "the same acquisition as L02 but with an ordinary stop input (no direct clearLock call)",
  racks: ["wand"], steps: 32,
  script: (tape: any, i: number, ctx: any) => {
    if (i === 0) tape.send("own", "pickup", { containerId: ctx.rackIds[0] });
    else if (i === 1) tape.send("own", "target", { id: "tgt" });
    else if (i === 6) tape.send("own", "stop", { seq: 1 });
  },
  observations: {
    action: "same committed-cast rule as L02; stop is its own ordinary order",
    cooldown: "the shared cooldown stays spent",
  },
});

// L04 walk the owner out to mark the trail, come back, acquire a seen target, then the target walks round the wall.
runCase({
  id: "L04", profile: "arena-weapon-only", title: "lost direct line of sight while the trail still entitles the lock",
  note: "the owner first walks through the doorway to mark the far side of the wall with its own vision, returns, acquires a seen target, and the target then walks round the wall",
  racks: ["wand"], steps: 300,
  script: (tape: any, i: number, ctx: any) => {
    const own = tape.world.players.get("own");
    const ownS = tape.world.state.players.get("own");
    if (i === 0) { tape.send("own", "pickup", { containerId: ctx.rackIds[0] }); return; }
    if (ctx.phase === undefined) ctx.phase = 1;
    const near = (x: number, y: number) => Math.hypot(ownS.x - x, ownS.y - y) < 30 && own.path.length === 0;
    if (ctx.phase === 1 && i >= 2) { tape.send("own", "move", { x: 620, y: 250, seq: 1 }); ctx.phase = 2; return; }
    if (ctx.phase === 2 && near(620, 250)) { ctx.markedAt = i; tape.send("own", "move", { x: 60, y: 250, seq: 2 }); ctx.phase = 3; return; }
    if (ctx.phase === 3 && near(60, 250)) {
      ctx.returnedAt = i;
      tape.send("own", "target", { id: "tgt" });
      ctx.phase = 4; ctx.lockStep = i; ctx.recordFrom = tape.steps; return;
    }
    if (ctx.phase === 4 && i === ctx.lockStep + 2) {
      tape.send("tgt", "move", { x: 620, y: 250, seq: 1 }); ctx.phase = 5; return;
    }
  },
  observations: {
    trail: "the target's destination tile was marked by the owner's own outbound walk (the VISION_TRAIL_MS entitlement)",
    grace: "the source's own TARGET_LOS_GRACE_MS branch is traced frame by frame through lockLosLostMs; whether it fires is the source's answer",
  },
});

// L05 the target walks into a declared bush and out of the visibility entitlement.
runCase({
  id: "L05", profile: "arena-weapon-only", title: "the target walks into a declared bush and the lock loses its entitlement",
  note: "acquire a seen target, then an ordinary move takes it inside the declared bush feature (a genuine bushConceals case)",
  racks: ["wand"], steps: 60,
  script: (tape: any, i: number, ctx: any) => {
    if (i === 0) tape.send("own", "pickup", { containerId: ctx.rackIds[0] });
    else if (i === 1) tape.send("own", "target", { id: "tgt" });
    else if (i === 4) tape.send("tgt", "move", { x: BUSH_CENTRE.x, y: BUSH_CENTRE.y, seq: 1 });
  },
  observations: {
    entitlement: "canPlayerSeeActor is bushConceals-aware; the canonical lock clears on the first chase tick where lockable fails",
    hiddenInterval: "the frame where the actor is already concealed but the mirror is still set is the hidden-lock interval",
  },
});

// L06 the full-module hidden-then-reappears lifecycle: Plague Swarm.
runCase({
  id: "L06", profile: "arena-full-module", title: "Plague Swarm hides the locked target, expiry, then a fresh ordinary reacquisition",
  note: "the target waits for its own natural Wish readiness (no injected hidden effect), casts Swarm as an ordinary input, and the owner re-targets it after the hide expires",
  racks: ["wand"], steps: 1150, factions: { own: "fire", tgt: "plague", thr: "frost", fou: "holy" },
  script: (tape: any, i: number, ctx: any) => {
    const w = tape.world;
    if (i === 0) { tape.send("own", "pickup", { containerId: ctx.rackIds[0] }); return; }
    const tgt = w.state.players.get("tgt");
    const ready = tgt.wishReadyAt;
    const now = w.state.serverTime + TICK_MS;
    const tC = combatant(w, "tgt");
    const hiddenNow = tC ? isHidden(w, tC) : false;
    if (hiddenNow) ctx.sawHidden = true;
    if (!ctx.locked && i > 2 && ready - now <= 100) {
      tape.send("own", "target", { id: "tgt" });
      ctx.locked = true; ctx.lockStep = i; ctx.recordFrom = tape.steps; return;
    }
    if (ctx.locked && !ctx.cast && now >= ready) {
      tape.send("tgt", "cast", { slot: "wish", x: tgt.x, y: tgt.y });
      ctx.cast = true; ctx.castStep = i; return;
    }
    if (ctx.cast && !ctx.reacquired && ctx.sawHidden && !hiddenNow) {
      tape.send("own", "target", { id: "tgt" });
      ctx.reacquired = true; ctx.reacquiredAt = i; return;
    }
    if (ctx.reacquired && !ctx.stopped && i >= (ctx.reacquiredAt || 0) + 30) ctx.stopped = true;
  },
  record: (i: number, tape: any, ctx: any) => ctx.recordFrom > 0 && tape.steps >= ctx.recordFrom && !ctx.stopped,
  observations: {
    hide: "Swarm is self-cast with castMs 250 and applies the hidden status for SWARM_MS; the effects bit and the owner's canonical lock are read every step",
    reacquire: "after the hidden status expires the owner sends one fresh ordinary target message, never an injected lock",
  },
});

// D01 the bow's natural draw, launch, spent cooldown and next legal attack.
runCase({
  id: "D01", profile: "arena-weapon-only", title: "bow draw, natural launch on release, spent ready clock, next legal attack",
  note: "a held bow attack and a queued release: drawStartedAt, the changed and cleared draw and the cooldown are recorded every step",
  racks: ["bow"], steps: 46,
  script: (tape: any, i: number, ctx: any) => {
    if (i === 0) tape.send("own", "pickup", { containerId: ctx.rackIds[0] });
    else if (i === 1) tape.send("own", "attack", { a: 0 });
    else if (i === 33) tape.send("own", "release", { a: 0 });
  },
  observations: { draw: "the bow is the only weapon that syncs drawStartedAt; the draw is fixed, so full pull is the whole windup" },
});

// D03 the fractional source clock.
runCase({
  id: "D03", profile: "arena-weapon-only", title: "fractional source clock 100000.25: raw host, schema and bot u32",
  note: "the declared initial source clock is fractional before addPlayer; the ordinary bow attack then produces fractional raw draw and ready times",
  racks: ["bow"], steps: 26, clock: 100000.25,
  script: (tape: any, i: number, ctx: any) => {
    if (i === 0) tape.send("own", "pickup", { containerId: ctx.rackIds[0] });
    else if (i === 1) tape.send("own", "attack", { a: 0 });
  },
  observations: { fraction: "the host keeps the fraction; the uint32 wire and the bot u32 path each decide their own rounding" },
});

// D04 the near-u32 wrap clock.
runCase({
  id: "D04", profile: "arena-weapon-only", title: "near-u32 wrap clock 2^32-75.25: raw host, schema owner, bot u32, UI draw and cooldown",
  note: "the declared initial source clock is 2^32-75.25 before addPlayer; the ordinary bow attack spans the boundary in a few fixed steps",
  racks: ["bow"], steps: 26, clock: 4294967220.75,
  script: (tape: any, i: number, ctx: any) => {
    if (i === 0) tape.send("own", "pickup", { containerId: ctx.rackIds[0] });
    else if (i === 1) tape.send("own", "attack", { a: 0 });
  },
  observations: { wrap: "no value is normalised: a surprising wrap or a lost draw is recorded as the source produces it" },
});

// M01 the canonical f64 mirrors at identity across a real pickup, swap and attack.
runCase({
  id: "M01", profile: "arena-weapon-only", title: "canonical f64 mirrors stay the identity through pickup, swap and attack",
  note: "two real ground pickups, two ordinary swaps and one attack; every mirror is read from the host state, the wire and the decoded row",
  racks: ["wand", "bow"], steps: 14,
  script: (tape: any, i: number, ctx: any) => {
    if (i === 0) tape.send("own", "pickup", { containerId: ctx.rackIds[0] });
    else if (i === 1) tape.send("own", "pickup", { containerId: ctx.rackIds[1] });
    else if (i === 2) tape.send("own", "swap", { slot: 1 });
    else if (i === 3) tape.send("own", "swap", { slot: 0 });
    else if (i === 4) tape.send("own", "attack", { a: 0 });
    else if (i === 5) tape.send("own", "release", { a: 0 });
  },
  observations: { mirrors: "nothing buffs this owner, so the identity must come from the source's own fold, not from a filled-in value" },
});

// M02 the attack-speed mirror producer: a real training card through the ordinary console message.
runCase({
  id: "M02", profile: "training-console", seats: ["own"], title: "haste3 is refused by the training console (recorded refusal, no direct grant)",
  note: "a real training room: the owner holds a real wand from a ground rack, attacks, then sends the ordinary train card messages for haste3; the source's own console refuses a base card",
  racks: ["wand"], steps: 28,
  script: (tape: any, i: number, ctx: any) => {
    if (i === 0) tape.send("own", "pickup", { containerId: ctx.rackIds[0] });
    else if (i === 1) tape.send("own", "attack", { a: 0 });
    else if (i === 8) tape.send("own", "release", { a: 0 });
    else if (i === 9) tape.send("own", "train", { cmd: "card", id: "haste3", count: 1 });
    else if (i === 14) tape.send("own", "attack", { a: 0 });
    else if (i === 22) tape.send("own", "release", { a: 0 });
    else if (i === 24) tape.send("own", "train", { cmd: "card", id: "haste3", count: 0 });
  },
  observations: {
    refusal: "sim/training.ts trainCard requires cardLive + isInteractiveAugment; a base card (haste3) is kind base, so the console refuses it and the build stays empty",
    consequence: "no ordinary train card message in this source moves a multiplier mirror, so the writeMirrors asMult/windupMult mutant is reported as a survivor with this exact reason",
  },
});

// M03 the windup mirror producer is BLOCKED at the source: the only windup card is not interactive.
runCase({
  id: "M03", profile: "training-console", seats: ["own"], title: "quickdraw is refused by the training console (recorded refusal, no direct grant)",
  note: "the owner acquires a real sword and sends the ordinary train card message for quickdraw, the only card with a windup row; the source's own console refuses it because it is not an interactive augment",
  racks: ["sword"], steps: 20,
  script: (tape: any, i: number, ctx: any) => {
    if (i === 0) tape.send("own", "pickup", { containerId: ctx.rackIds[0] });
    else if (i === 1) tape.send("own", "attack", { a: 0 });
    else if (i === 2) tape.send("own", "release", { a: 0 });
    else if (i === 7) tape.send("own", "train", { cmd: "card", id: "quickdraw", count: 1 });
    else if (i === 10) tape.send("own", "attack", { a: 0 });
    else if (i === 11) tape.send("own", "release", { a: 0 });
  },
  observations: {
    refusal: "sim/training.ts trainCard returns early for a card that is not cardLive + isInteractiveAugment; quickdraw (sim card effects stat windup -0.5) is an augment outside INTERACTIVE_AUGMENT_IDS",
    consequence: "no real producer in this packet changes windupMult; the writeMirrors windupMult mutant is therefore reported as a survivor, not a kill",
  },
});

// ================================================================================================= hidden-lock analysis
// The root-critical question: is there any completed step whose canonical nonempty owner lock names a fighter that the
// owner's own source perception does NOT disclose? Two criteria are computed independently, frame by frame, from the raw
// trace: (a) the original perceive() on the actually decoded client state (does frame.fighters list the named id), and
// (b) the source's own canPlayerSeeActor entitlement for the named id.
const LOCK_CRITERIA = {
  perceptionDisclosure: {
    label: "the original bot perceive() on the decoded client state does not list the named id in frame.fighters",
    holds: (f: any) => f.owner.attackTarget !== "" && !f.bot.fighters.includes(f.owner.attackTarget),
    disclosed: (f: any) => f.owner.attackTarget === "" || f.bot.fighters.includes(f.owner.attackTarget),
  },
  sourceEntitlement: {
    label: "the source's own canPlayerSeeActor(owner, named) is false (a pure probe; the sim does not read it back)",
    holds: (f: any) => f.owner.attackTarget !== "" && f.probes.target !== null && f.probes.target.present === true && f.probes.target.entitled === false,
    disclosed: (f: any) => f.owner.attackTarget === "" || !f.probes.target || f.probes.target.entitled !== false,
  },
};

function intervalsFor(caseResult: any, criterion: any): any[] {
  const frames = caseResult.frames;
  const out: any[] = [];
  let start = -1;
  const close = (end: number) => {
    const first = frames[start];
    const next = end + 1 < frames.length ? frames[end + 1] : null;
    const last = frames[end];
    const endTime = next ? next.serverTime : last.serverTime + TICK_MS;
    const clearedBy = !next ? "open at the end of the recorded trace"
      : next.owner.attackTarget === "" ? "canonical lock cleared (attackTarget \"\")"
      : "the named fighter became disclosed";
    out.push({
      startStep: first.step, startTime: first.serverTime,
      lastStep: last.step, lastTime: last.serverTime,
      endStep: next ? next.step : null, endTime,
      frames: end - start + 1,
      durationMs: endTime - first.serverTime,
      named: first.owner.attackTarget,
      clearedBy,
      firstFrame: {
        step: first.step, effects: first.probes.target ? first.probes.target.effects : null,
        hidden: first.probes.target ? first.probes.target.hidden : null,
        entitled: first.probes.target ? first.probes.target.entitled : null,
        directLos: first.probes.target ? first.probes.target.directLos : null,
        lockable: first.probes.target ? first.probes.target.lockable : null,
      },
      lastFrame: {
        step: last.step, effects: last.probes.target ? last.probes.target.effects : null,
        hidden: last.probes.target ? last.probes.target.hidden : null,
        entitled: last.probes.target ? last.probes.target.entitled : null,
        directLos: last.probes.target ? last.probes.target.directLos : null,
        lockable: last.probes.target ? last.probes.target.lockable : null,
      },
    });
    start = -1;
  };
  for (let i = 0; i < frames.length; i++) {
    const holds = criterion.holds(frames[i]);
    if (holds && start < 0) start = i;
    else if (!holds && start >= 0) close(i - 1);
  }
  if (start >= 0) close(frames.length - 1);
  return out;
}

function hiddenLockAnalysis(cases: any[]): any {
  const byCriterion: any = {};
  for (const key of Object.keys(LOCK_CRITERIA)) {
    const criterion: any = (LOCK_CRITERIA as any)[key];
    const intervals: any[] = [];
    for (const c of cases) {
      for (const iv of intervalsFor(c, criterion)) intervals.push({ case: c.id, ...iv });
    }
    byCriterion[key] = {
      label: criterion.label,
      intervalCount: intervals.length,
      anyInterval: intervals.length > 0,
      maxDurationMs: intervals.reduce((m, iv) => Math.max(m, iv.durationMs), 0),
      intervals,
    };
  }
  return {
    question: "is there any completed step with a canonical nonempty owner lock (attackTarget) while that target is NOT disclosed by the owner's source perception / human projection?",
    note: "both criteria are computed from the recorded frames; a criterion that never holds is reported as a zero interval, not as an absent answer",
    byCriterion,
  };
}

/** The per-case facts root needs: when the hide/entitlement change and the lock change happen, in the raw trace. */
function caseFacts(c: any): any {
  const frames = c.frames;
  const find = (pred: (f: any) => boolean) => {
    for (const f of frames) if (pred(f)) return { step: f.step, t: f.serverTime };
    return null;
  };
  const findAfter = (step: number, pred: (f: any) => boolean) => {
    for (const f of frames) if (f.step >= step && pred(f)) return { step: f.step, t: f.serverTime };
    return null;
  };
  const lockSet = find((f) => f.owner.attackTarget !== "");
  const lockCleared = lockSet ? findAfter(lockSet.step + 1, (f) => f.owner.attackTarget === "") : null;
  const firstLosFalse = find((f) => f.probes.target !== null && f.probes.target.directLos === false);
  const firstEntitledFalse = find((f) => f.probes.target !== null && f.probes.target.entitled === false);
  const firstHidden = find((f) => f.probes.target !== null && f.probes.target.hidden === true);
  const firstBushConcealed = find((f) => f.probes.target !== null && f.probes.target.bushConcealed === true);
  return {
    case: c.id,
    recordedFrames: frames.length,
    firstLockSet: lockSet,
    firstLockClearedAfterSet: lockCleared,
    firstDirectLosFalse: firstLosFalse,
    firstEntitlementFalse: firstEntitledFalse,
    firstHidden: firstHidden,
    firstBushConcealed: firstBushConcealed,
  };
}
// ================================================================ declared boundary probes (NOT production outcomes)
function fieldMeta(ctor: any, name: string): any {
  const md = ctor[Symbol.metadata];
  if (!md) return null;
  const entry = Object.values(md).find((e: any) => e && e.name === name);
  return entry ? { type: (entry as any).type, index: (entry as any).index, name: (entry as any).name } : null;
}
function declaredPerceiveState(p: any): any {
  return {
    phase: "active", seed: 7, serverTime: 12345, lobbyEndsAt: 0, raidStartedAt: 0, minPlayers: 1, startedWith: 1,
    patienceEndsAt: 0, inColiseum: false, gatesLocked: false, suddenDeathAt: 0, winner: "", training: false,
    players: new Map([["own", p]]), mobs: new Map(), containers: new Map(), camps: [], fields: new Map(), roster: ["own"],
  };
}
/** The real PlayerState schema in a real RaidState: encodeAll -> bytes -> fresh decode, and the original bot u32 output. */
function schemaRowProbe(field: string, value: number): any {
  const p = new PlayerState();
  let threw: any = null;
  let host: any = null;
  try { p[field] = value; host = p[field]; } catch (e: any) { threw = { name: e?.constructor?.name ?? "Error", message: String(e?.message ?? e) }; }
  let wire: any = null;
  if (threw === null) {
    try {
      const rs = new RaidState();
      rs.players.set("own", p);
      const enc = new schemaPkg.Encoder(rs);
      const it = { offset: 0 };
      enc.encodeAll(it);
      const bytes = Buffer.from(enc.sharedBuffer.subarray(0, it.offset));
      const decodedState = new RaidState();
      new schemaPkg.Decoder(decodedState).decode(bytes);
      const decodedRow = decodedState.players.get("own");
      wire = { encode: "ok", bytes: bytes.length, sha256: sha256(bytes), decoded: decodedRow ? decodedRow[field] : null };
    } catch (e: any) {
      wire = { encode: "threw", name: e?.constructor?.name ?? "Error", message: String(e?.message ?? e) };
    }
  }
  let bot: any = null;
  if (threw === null) {
    const frame = perceive({ state: declaredPerceiveState(p) }, { selfId: "own", map: ARENA_MAP, features: DECLARED_FEATURES, lastMinimap: null });
    bot = { path: "original perceive() selfView u32", value: frame.self[field] };
  }
  return { field, input: value, host, hostType: typeof host, threw, wire, bot };
}
function uint32BoundaryProbes(): any {
  const values = [0, 0.25, 1, 1.75, 4294967295, 4294967295.75, 4294967296, 4294967297.75, -1, -0.25, NaN, Infinity, -Infinity];
  const probes: any[] = [];
  for (const field of ["drawStartedAt", "readyAt"]) {
    for (const v of values) probes.push(schemaRowProbe(field, v));
  }
  const fresh = new PlayerState();
  return {
    provenance: "declared-probe",
    note: "the real PlayerState schema row inside a real RaidState, encodeAll into bytes and a fresh decode; the bot column is the original perceive() selfView (u32 = v >>> 0). Non-finite inputs and outputs are typed strings, never JSON null.",
    reflection: { drawStartedAt: fieldMeta(PlayerState, "drawStartedAt"), readyAt: fieldMeta(PlayerState, "readyAt") },
    defaults: { drawStartedAt: fresh.drawStartedAt, readyAt: fresh.readyAt },
    declaredValues: values,
    probes,
  };
}
function mirrorBoundaryProbes(): any {
  const mults = [0.05, 0.0505, 0.0499, 1, 65.535, 65.536, 1000, 1e300, Number.MAX_VALUE, -1, NaN, Infinity, -Infinity];
  const helper = mults.map((x) => ({
    input: x,
    encodeMult: encodeMult(x),
    decodeMultOfEncoded: decodeMult(encodeMult(x)),
    encodedMirrors: jsonSafe(shared.encodeMirrors({ ...IDENTITY_MIRRORS, asMult: x })),
  }));
  const schema = mults.map((x) => schemaRowProbe("asMult", encodeMult(x)));
  const rawWire = [49, 50, 55, 1000, 65535, 65536, 1e300, Number.MAX_VALUE, NaN, Infinity, -Infinity].map((wire) => {
    const p = new PlayerState();
    p.asMult = wire as any;
    p.windupMult = wire as any;
    p.speedMult = wire as any;
    const rs = new RaidState();
    rs.players.set("own", p);
    const enc = new schemaPkg.Encoder(rs);
    const it = { offset: 0 };
    enc.encodeAll(it);
    const bytes = Buffer.from(enc.sharedBuffer.subarray(0, it.offset));
    const decodedState = new RaidState();
    new schemaPkg.Decoder(decodedState).decode(bytes);
    const row = decodedState.players.get("own");
    return {
      inputWire: wire,
      decodedWire: row ? row.asMult : null,
      decodeMult: row ? decodeMult(row.asMult) : null,
      note: "raw f64 mirror field roundtrip, no helper applied",
    };
  });
  return {
    provenance: "declared-probe",
    note: "the multiplier wire carries thousandths (float64); encodeMult clamps only to MOD_MULT_MIN 0.05 and the legacy 20x ceiling is not applied. These probes do not prove any gameplay reaches huge mirrors.",
    constants: { MOD_MULT_MIN: shared.MOD_MULT_MIN, MOD_MULT_MAX: shared.MOD_MULT_MAX, MULT_WIRE_PER_UNIT: shared.MULT_WIRE_PER_UNIT },
    identityMirrors: jsonSafe(shared.encodeMirrors(IDENTITY_MIRRORS)),
    helper,
    schemaRoundtrip: schema,
    rawWireRoundtrip: rawWire,
  };
}
function uiBoundaryProbes(): any {
  const lock = new LockDisplay();
  const lockProbes: any[] = [];
  lock.note("tgt", 1000);
  for (const uiT of [999, 1000, 1249, 1499, 1500, 1501, 1600]) lockProbes.push({ action: "note(tgt,1000)", synced: "", uiT, shown: lock.shown("", uiT) });
  lock.note("", 2000);
  for (const synced of ["", "tgt"]) lockProbes.push({ action: "note(empty,2000)", synced, uiT: 2100, shown: lock.shown(synced, 2100) });
  lock.reset();
  lockProbes.push({ action: "reset()", synced: "tgt", uiT: 3000, shown: lock.shown("tgt", 3000) });
  const d = new DrawTrack();
  const drawProbes: any[] = [];
  for (const sample of [{ drawStartedAt: 1000, renderT: 900, patchT: 1050 }, { drawStartedAt: 1000, renderT: 1000, patchT: 1050 }, { drawStartedAt: 1000, renderT: 1100, patchT: 1050 }]) {
    drawProbes.push({ action: "draw", ...sample, shown: d.track(sample.drawStartedAt, sample.renderT, sample.patchT), start: d.start });
  }
  for (const sample of [{ drawStartedAt: 0, renderT: 1149, patchT: 1150 }, { drawStartedAt: 0, renderT: 1200, patchT: 1150 }, { drawStartedAt: 0, renderT: 1300, patchT: 1250 }]) {
    drawProbes.push({ action: "clear", ...sample, shown: d.track(sample.drawStartedAt, sample.renderT, sample.patchT), start: d.start });
  }
  const d2 = new DrawTrack();
  drawProbes.push({ action: "new instance after scene reset", drawStartedAt: 0, renderT: 1400, patchT: 1350, shown: d2.track(0, 1400, 1350), start: d2.start });
  const cooldownInputs = [
    { prevReadyAt: 1000, prevCooldown: 500, readyAt: 1500, patchT: 1200 },
    { prevReadyAt: 1000, prevCooldown: 500, readyAt: 1500, patchT: 900 },
    { prevReadyAt: 1000, prevCooldown: 500, readyAt: 1000, patchT: 1200 },
    { prevReadyAt: 0, prevCooldown: 1, readyAt: 500, patchT: 0 },
    { prevReadyAt: 1400, prevCooldown: 500, readyAt: 1500, patchT: 1300 },
    { prevReadyAt: 1500, prevCooldown: 500, readyAt: 1400, patchT: 1300 },
  ];
  const cooldownProbes = cooldownInputs.map((c) => ({ ...c, isExtension: isExtension(c.prevReadyAt, c.readyAt, c.patchT), nextCooldown: nextCooldown(c.prevReadyAt, c.prevCooldown, c.readyAt, c.patchT) }));
  const fullDraw = ["fire", "bow", "", "nonsense"].map((f) => ({ faction: f, asMult: WIRE_IDENTITY_MIRRORS.asMult, windupMult: WIRE_IDENTITY_MIRRORS.windupMult, seconds: fullDrawSeconds(f) }));
  return {
    provenance: "declared-probe",
    note: "declared UI method probes only: no runtime case, no reachability and no DOM/Phaser claim. The methods are the original client exports.",
    lockDisplay: { OPTIMISTIC_LOCK_MS, probes: lockProbes },
    drawTrack: { renderDelayNote: "renderT is a declared render clock; patchT is the patch arrival clock", probes: drawProbes },
    nextCooldown: { probes: cooldownProbes },
    fullDrawSeconds: { probes: fullDraw },
  };
}
// ============================================================================================================= assembly
function ownerSeriesFacts(c: any): any {
  const frames = c.frames;
  const first = (pred: (f: any) => boolean) => {
    for (const f of frames) if (pred(f)) return { step: f.step, t: f.serverTime };
    return null;
  };
  const hiddenFrame = first((f) => f.probes.focus !== null && f.probes.focus.present === true && f.probes.focus.hidden === true);
  const effectsHiddenFrame = first((f) => f.probes.focus !== null && f.probes.focus.present === true && f.probes.focus.effects !== null && (f.probes.focus.effects & 256) !== 0);
  const lockClearAfterHidden = hiddenFrame ? first((f) => f.step >= hiddenFrame.step && f.owner.attackTarget === "") : null;
  const bushFrame = first((f) => f.probes.focus !== null && f.probes.focus.present === true && f.probes.focus.bushConcealed === true);
  const entitlementFalse = first((f) => f.probes.focus !== null && f.probes.focus.present === true && f.probes.focus.entitled === false);
  const losFalse = first((f) => f.probes.focus !== null && f.probes.focus.present === true && f.probes.focus.directLos === false);
  let maxLosLostMs = 0;
  let maxLosLostStep = null;
  for (const f of frames) {
    const ms = f.probes.source ? f.probes.source.lockLosLostMs : 0;
    if (ms > maxLosLostMs) { maxLosLostMs = ms; maxLosLostStep = f.step; }
  }
  const lockSet = first((f: any) => f.owner.attackTarget !== "");
  return {
    case: c.id,
    profile: c.profile,
    recordedFrames: frames.length,
    firstStep: frames.length ? frames[0].step : null,
    lastStep: frames.length ? frames[frames.length - 1].step : null,
    firstLockSet: lockSet,
    firstHiddenFrame: hiddenFrame,
    firstEffectsHiddenBitFrame: effectsHiddenFrame,
    firstLockClearAfterHidden: lockClearAfterHidden,
    hiddenAndLockSameStep: hiddenFrame !== null && lockClearAfterHidden !== null && hiddenFrame.step === lockClearAfterHidden.step,
    firstBushConcealedFrame: bushFrame,
    firstEntitlementFalseFrame: entitlementFalse,
    firstDirectLosFalseFrame: losFalse,
    maxLockLosLostMs: maxLosLostMs,
    maxLockLosLostStep: maxLosLostStep,
    finalAttackTarget: frames.length ? frames[frames.length - 1].owner.attackTarget : null,
  };
}

const producerCases = CASE_RESULTS.map((c: any) => {
  const copy: any = { ...c };
  delete copy.human;
  return copy;
});
const facts = CASE_RESULTS.map(ownerSeriesFacts);
const hiddenLock = hiddenLockAnalysis(CASE_RESULTS);
const byId: any = Object.fromEntries(CASE_RESULTS.map((c: any) => [c.id, c]));
function lockFrames(caseId: string): any {
  const c = byId[caseId];
  if (!c) return null;
  return {
    framesWithNonEmptyLock: c.frames.filter((f: any) => f.owner.attackTarget !== "").length,
    steps: c.frames.map((f: any) => ({ step: f.step, attackTarget: f.owner.attackTarget, decodedAttackTarget: f.ownerDecoded ? f.ownerDecoded.attackTarget : null, readyAt: f.owner.readyAt, drawStartedAt: f.owner.drawStartedAt })),
  };
}

const producer = {
  format: FORMAT,
  note: "genuine complete-world ordinary input timelines: every message goes through enqueueClientMessage and every step is the source's own fixed step. Every recorded frame carries the canonical owner group before and after a real @colyseus/schema encode/decode, the source events in order, the original perceive() on the decoded client state, and labelled source probes.",
  provenance: "actual-producer",
  setup: {
    map: MAP_DESCRIPTION,
    profiles: PROFILES,
    seats: SEAT_FACTIONS,
    placements: PLACEMENTS,
    racks: RACKS,
    racksProvenance: "real loot constructor sim/loot.ts dropWeapon at tick 0, taken with an ordinary pickup message",
    placementProvenance: "declared setup applied once after the raid started and before the first recorded combat input",
    clockProvenance: "only D03/D04 declare an initial source clock before addPlayer; every later clock is the actual step increment",
  },
  cases: producerCases,
  caseFacts: facts,
  hiddenLock,
  rootAnswers: {
    question: hiddenLock.question,
    answer: {
      perceptionDisclosure: hiddenLock.byCriterion.perceptionDisclosure.anyInterval
        ? "YES: at least one completed step carries a canonical nonempty owner lock while the owner's own perceive() does not list the named fighter"
        : "NO completed step in the recorded traces carries a canonical nonempty owner lock while the owner's own perceive() on the decoded state fails to list the named fighter; every interval is zero in these cases",
      sourceEntitlement: hiddenLock.byCriterion.sourceEntitlement.anyInterval
        ? "YES: at least one completed step carries a canonical nonempty owner lock while canPlayerSeeActor(owner, named) is false"
        : "NO completed step in the recorded traces carries a canonical nonempty owner lock while canPlayerSeeActor(owner, named) is false; every interval is zero in these cases",
    },
    byCriterion: hiddenLock.byCriterion,
    swarmLifecycle: {
      case: "L06",
      facts: facts.find((f: any) => f.case === "L06"),
      sequence: byId.L06 ? byId.L06.frames.filter((f: any) => f.probes.target !== null && (f.probes.target.hidden || f.owner.attackTarget !== "" || f.probes.target.effects !== 0)).slice(0, 24).map((f: any) => ({ step: f.step, t: f.serverTime, effects: f.probes.target.effects, hidden: f.probes.target.hidden, untargetable: f.probes.target.untargetable, entitled: f.probes.target.entitled, attackTarget: f.owner.attackTarget, lockable: f.probes.target.lockable })) : null,
    },
    bushLifecycle: {
      case: "L05",
      facts: facts.find((f: any) => f.case === "L05"),
      sequence: byId.L05 ? byId.L05.frames.filter((f: any) => f.probes.target !== null && f.step > 15).slice(0, 24).map((f: any) => ({ step: f.step, t: f.serverTime, bushConcealed: f.probes.target.bushConcealed, entitled: f.probes.target.entitled, directLos: f.probes.target.directLos, lockable: f.probes.target.lockable, attackTarget: f.owner.attackTarget })) : null,
    },
    losGrace: {
      case: "L04",
      facts: facts.find((f: any) => f.case === "L04"),
      note: "lockLosLostMs is the source runtime's own now - lockLosLostAt; the TARGET_LOS_GRACE_MS branch fires only if it reaches 1500 while the lock still holds and a chase path exists",
    },
    locks: { L01: lockFrames("L01"), L02: lockFrames("L02"), L03: lockFrames("L03") },
  },
  limits: [
    "source witness only: no native/Rust parity, no Unity/DOM/rendering, no socket/Room/join/reconnect, no protocol or public-field admission",
    "the arena-weapon-only profile installs signatures:false, so every faction module (Fire Roam, Bruiser passives, Plague corpses/zombies, Sentenced hunt) is absent there; only L06 uses the complete assembler order",
    "L06 waits out the source's own WISH_LOCK_SECONDS with idle ordinary steps before acquiring the lock; those idle steps are not recorded as frames (they span no lock/draw/mirror transition)",
    "per-frame schema recording is a full encodeAll snapshot decoded into one retained client state; it is not the delta patch protocol",
    "the human projection calls the original client methods inside a Node process with stub DOM/Phaser modules; no Phaser rendering, GPU, layout or real DOM lifecycle is exercised",
    "probes read private runtime/visibility to classify WHY an outcome happened; they never mutate the world and are never fed back into the simulation",
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
  cases: CASE_RESULTS.map((c: any) => ({ id: c.id, producerCase: c.id, profile: c.profile, frames: c.human })),
};

const boundaries = {
  format: FORMAT,
  note: "DECLARED probes only. They are not runtime production, not reachability proof and not a transport decision.",
  provenance: "declared-probe",
  playerTimerSchema: uint32BoundaryProbes(),
  mirrorSchema: mirrorBoundaryProbes(),
  ui: uiBoundaryProbes(),
  limits: [
    "these values are assigned directly to schema/helper/UI inputs; no gameplay path in this packet produces them",
    "a reflected uint32 type alone is not a boundary roundtrip; the probes above do the actual encodeAll/decode",
    "the human schema's uint32 and the bot's u32 are separate observables and were measured separately",
  ],
};

const corpusTexts: Record<string, string> = {
  "producer.json": finalize(producer),
  "human-projection.json": finalize(humanCorpus),
  "boundaries.json": finalize(boundaries),
};

if (mode === "--write") {
  for (const name of OUTPUTS) writeFileSync(join(outDir, name), corpusTexts[name]!);
  console.log("captured 3 corpora: " + OUTPUTS.join(", "));
} else {
  for (const name of OUTPUTS) {
    const expected = readFileSync(join(outDir, name), "utf8");
    if (expected !== corpusTexts[name]) {
      expectSource(false, "checked-in " + name + " differs from the recaptured bytes");
      console.log("MISMATCH " + name);
    }
  }
  console.log("checked 3 corpora byte for byte: " + OUTPUTS.join(", "));
}

// A compact console index of what the run found (the corpora carry the full data).
console.log("cases: " + CASE_RESULTS.map((c: any) => c.id + "(" + c.frames.length + ")").join(" "));
for (const f of facts) {
  console.log("case " + f.case + " frames " + f.recordedFrames + " firstLock " + JSON.stringify(f.firstLockSet) + " firstLosFalse " + JSON.stringify(f.firstDirectLosFalseFrame) + " firstEntitledFalse " + JSON.stringify(f.firstEntitlementFalseFrame) + " firstBush " + JSON.stringify(f.firstBushConcealedFrame) + " firstHidden " + JSON.stringify(f.firstHiddenFrame) + " hiddenLockSameStep " + f.hiddenAndLockSameStep + " maxLosLostMs " + f.maxLockLosLostMs + " finalTarget " + JSON.stringify(f.finalAttackTarget));
}
console.log("hidden-lock intervals: perceptionDisclosure=" + hiddenLock.byCriterion.perceptionDisclosure.intervalCount + " (" + hiddenLock.byCriterion.perceptionDisclosure.intervals.map((i: any) => i.case + "@" + i.startStep + ":" + i.durationMs + "ms/" + i.named).join(",") + ") sourceEntitlement=" + hiddenLock.byCriterion.sourceEntitlement.intervalCount + " (" + hiddenLock.byCriterion.sourceEntitlement.intervals.map((i: any) => i.case + "@" + i.startStep + ":" + i.durationMs + "ms").join(",") + ")");
console.log("mirrors M01: " + JSON.stringify(byId.M01 ? byId.M01.frames.map((f: any) => [f.owner.asMult, f.owner.windupMult, f.owner.speedMult]) : null));
console.log("mirrors M03: " + JSON.stringify(byId.M03 ? byId.M03.frames.map((f: any) => [f.owner.windupMult, f.probes.source ? (f.probes.source.action ? f.probes.source.action.landsAt : null) : null]) : null));
console.log("mirrors M02 asMult+windupMult: " + JSON.stringify(byId.M02 ? byId.M02.frames.map((f: any) => [f.owner.asMult, f.owner.windupMult]) : null));
console.log("D03 raw/decoded/bot: " + JSON.stringify(byId.D03 ? byId.D03.frames.map((f: any) => [f.step, f.owner.drawStartedAt, f.owner.readyAt, f.ownerDecoded.drawStartedAt, f.ownerDecoded.readyAt, f.bot.self.drawStartedAt, f.bot.self.readyAt]) : null));
console.log("D04 raw/decoded/bot: " + JSON.stringify(byId.D04 ? byId.D04.frames.map((f: any) => [f.step, f.owner.drawStartedAt, f.owner.readyAt, f.ownerDecoded.drawStartedAt, f.ownerDecoded.readyAt, f.bot.self.drawStartedAt, f.bot.self.readyAt]) : null));


