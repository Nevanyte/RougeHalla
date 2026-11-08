// Canonical actual-source witness capture for P-PERCEPTION-WITNESS-1, pinned linux/amd64 Node 22.23.4.
//
// Three corpora are written (or byte-checked) in one run:
//   run-summary.json  the real perceive() on declared source-schema StateLike inputs: public run summary (hud), the
//                     sight-filtered fighters/self projection, the hidden-status aggregate witness, current-row versus
//                     retained-roster counts, the real RaidState uint8 boundary and the human statusLine/winnerLabel strings.
//   availability.json planningModeFor (held Tab), mapRosterRows (all synced rows) and the server LobbyStatus snapshot,
//                     plus a perceive() contrast on the same declared roster rows.
//   windup-path.json  the real sim Windup/Swing/Block/Hit emitter -> packFx -> unpackFx -> perceive, with originating
//                     batch times, hidden/out-of-frame/personal-vision redaction and one-step versus multi-step batches.
//
// Every probe is labelled: "declared-probe" inputs are declared source-schema records; "actual-producer" rows come from
// the real sim run. No value is read back from Rust and no expected value is hand-written into the corpus: the source
// answers are recorded as they are.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const IMAGE = "node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const FORMAT = "rh-percept-witness/1";
const OUTPUTS = ["run-summary.json", "availability.json", "windup-path.json"];

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
// RH_PERCEPT_WITNESS_RECORD=1: expectations are recorded as booleans and the separate semantic comparator is the check.
const RECORD_MODE = process.env.RH_PERCEPT_WITNESS_RECORD === "1";
const expectSource = (condition, message) => { if (!RECORD_MODE) assert(condition, message); };

const repo = (p) => join(repoRoot, p);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const shaFile = (p) => sha256(readFileSync(repo(p)));
const plain = (v) => JSON.parse(JSON.stringify(v));
/** JSON-safe declared input: Maps become explicit entry lists instead of {} (the runtime rows keep real Maps). */
const jsonSafe = (v) => {
  if (v instanceof Map) return { entries: [...v.entries()].map(([k, count]) => [k, count]) };
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = jsonSafe(v[k]);
    return out;
  }
  return v;
};

// ------------------------------------------------------------------------------------------------- deterministic stubs
// The client modules import CSS and (some of them) touch DOM globals at module scope. The CSS stub loader turns every
// *.css import into an empty module; these are the minimal no-op DOM-ish globals, installed before any dynamic import.
// No DOM lifecycle is exercised: only the pure exported formatter/projection functions are called.
function stubNode() {
  const node = {
    nodeType: 1, tagName: "DIV", className: "", textContent: "", hidden: false, title: "", value: "", disabled: false,
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ""; } },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, append() {}, appendChild() {},
    prepend() {}, replaceChildren() {}, insertBefore() {}, addEventListener() {}, removeEventListener() {},
    remove() {}, focus() {}, blur() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getContext() { return null; }, getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0 }; },
    width: 0, height: 0,
  };
  return node;
}
const STUB_NODE = stubNode();
globalThis.document = {
  getElementById() { return STUB_NODE; }, createElement() { return stubNode(); }, createElementNS() { return stubNode(); },
  addEventListener() {}, removeEventListener() {}, body: STUB_NODE, documentElement: STUB_NODE, head: STUB_NODE,
};
globalThis.window = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {},
  matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
  location: { href: "http://127.0.0.1/", search: "" }, localStorage: null,
};
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {}, clear() {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
try { Object.defineProperty(globalThis, "navigator", { value: { userAgent: "rh-percept-witness" }, configurable: true }); } catch { /* Node's own navigator is fine */ }

// ------------------------------------------------------------------------------------------------- source modules
const load = (p) => import(repo(p));
const shared = await load("packages/shared/src/index.ts");
const schemaMod = await load("packages/shared/src/schema.ts");
const perceptionMod = await load("packages/server/src/bots/brain/perception.ts");
const hudMod = await load("packages/client/src/ui/hud.ts");
const displayNameMod = await load("packages/client/src/render/displayName.ts");
const planningMod = await load("packages/client/src/ui/planning.ts");
const mapRosterMod = await load("packages/client/src/ui/mapRoster.ts");
const lobbyMod = await load("packages/server/src/guards/lobbyStatus.ts");
const fxCodec = await load("packages/shared/src/fxCodec.ts");
const worldMod = await load("packages/server/src/sim/world.ts");
const stepMod = await load("packages/server/src/sim/step.ts");
const inputsMod = await load("packages/server/src/sim/inputs.ts");
const gameplayMod = await load("packages/server/src/sim/gameplay.ts");
const schemaPkg = await import(repo("node_modules/@colyseus/schema/build/index.mjs"));

const perceive = perceptionMod.perceive;
const inView = perceptionMod.inView;
const { RaidState, PlayerState } = schemaMod;
const { TRAINING_BANNER, statusLine } = hudMod;
const { winnerLabel } = displayNameMod;
const { planningModeFor } = planningMod;
const { mapRosterRows } = mapRosterMod;
const { LobbyStatus } = lobbyMod;
const { packFx, unpackFx } = fxCodec;
const { createGameWorld } = gameplayMod;
const { addPlayer, step } = stepMod;
const { enqueueClientMessage } = inputsMod;
const { mulberry32, mapFromTiles, TILE, TILE_FLOOR, TILE_WALL, TICK_MS, FACTIONS } = shared;

// A small real map (from shared mapFromTiles) for declared probes that need a ctx.map; no containers are declared, so
// nothing off the box is read.
const DECLARED_MAP = mapFromTiles(8, 8, new Uint8Array(64).fill(TILE_FLOOR));
// The features a bot's room would report: only the status-effect bits are needed by these probes; every optional
// extension is off, so the frame stays the run-summary surface (and the hidden-bit branch is exercised).
const DECLARED_FEATURES = {
  messageTypes: [], wishes: false, statusEffects: true, fields: false, planning: false, chests: false,
  skills: false, relics: false, camps: false, hazards: false,
};

// ------------------------------------------------------------------------------------------------- source closure
const ENTRY_SOURCES = [
  "packages/server/src/bots/brain/perception.ts",
  "packages/shared/src/schema.ts",
  "packages/shared/src/index.ts",
  "packages/shared/src/fxCodec.ts",
  "packages/server/src/guards/lobbyStatus.ts",
  "packages/server/src/sim/gameplay.ts",
  "packages/server/src/sim/world.ts",
  "packages/server/src/sim/step.ts",
  "packages/server/src/sim/weapons.ts",
  "packages/server/src/sim/inputs.ts",
  "packages/server/src/sim/combatant.ts",
  "packages/client/src/ui/hud.ts",
  "packages/client/src/render/displayName.ts",
  "packages/client/src/ui/planning.ts",
  "packages/client/src/ui/mapRoster.ts",
];
const IMPORT_RE = /(?:^|[;\n])\s*(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g;
const DYNAMIC_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const importsOf = (text) => {
  const out = [];
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) out.push(m[1]);
  }
  return out;
};
const isFile = (p) => existsSync(repo(p)) && statSync(repo(p)).isFile();
const tryTs = (base) => {
  for (const cand of [base, base + ".ts", base + ".tsx", base + ".mts", base.replace(/\.js$/, ".ts"), base + "/index.ts", base + "/index.tsx"]) {
    if (isFile(cand)) return cand;
  }
  return null;
};
/** Resolves one specifier to a repo-relative TS file, a style file, or an external package. */
function resolveSpecifier(fromRel, spec) {
  if (spec.startsWith(".")) {
    const base = join(dirname(fromRel), spec).split("\\").join("/");
    if (spec.endsWith(".css")) return { kind: "style", path: base };
    const ts = tryTs(base);
    if (ts) return { kind: "ts", path: ts };
    return { kind: "unresolved", path: base };
  }
  if (spec === "@raid/shared") return { kind: "ts", path: "packages/shared/src/index.ts" };
  if (spec.startsWith("@raid/shared/")) {
    const sub = spec.slice("@raid/shared/".length);
    const ts = tryTs("packages/shared/src/" + sub);
    return ts ? { kind: "ts", path: ts } : { kind: "unresolved", path: spec };
  }
  return { kind: "external", path: spec };
}
const sourceFiles = new Set();
const styleFiles = new Set();
const externalImports = new Set();
const unresolvedImports = new Set();
const stack = [...ENTRY_SOURCES];
while (stack.length > 0) {
  const rel = stack.pop();
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
const PROFILE_BASE = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  image: IMAGE,
  imageDigest: "sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292",
  asserts: { node: "v22.23.4", platform: "linux", arch: "x64" },
  repoRoot,
  sourceClosure: "static import/export + dynamic-import graph from the entry list below, TypeScript files only",
  entrySources: ENTRY_SOURCES,
  sourceFileCount: Object.keys(sourceFileHashes).length,
  sourceFiles: sourceFileHashes,
  styleFileCount: Object.keys(styleFileHashes).length,
  styleFiles: styleFileHashes,
  externalImports: [...externalImports].sort(),
  unresolvedImports: [...unresolvedImports].sort(),
  tool: {
    "tools/percept-witness-fixtures/capture.mts": shaFile("tools/percept-witness-fixtures/capture.mts"),
    "tools/percept-witness-fixtures/capture.sh": shaFile("tools/percept-witness-fixtures/capture.sh"),
    "tools/percept-witness-fixtures/css-stub-loader.mjs": shaFile("tools/percept-witness-fixtures/css-stub-loader.mjs"),
  },
  declared: {
    map: "packages/shared/src/map.ts mapFromTiles(8, 8, floor) for declared probes; the sim corpus builds its own walled arena",
    features: DECLARED_FEATURES,
  },
};

function finalize(corpus) {
  corpus.profile = { ...PROFILE_BASE, sourceFiles: sourceFileHashes, tool: { ...PROFILE_BASE.tool } };
  corpus.profile.captureSha256 = sha256(JSON.stringify(corpus));
  return JSON.stringify(corpus) + "\n";
}

// ================================================================================================= A. run-summary
// A declared source-schema player row: every wire field perception can read, set to the schema's identity values. The
// fields perception never reads (look, planReady, ...) are present too, so the row is a source-schema shape rather than
// a minimal mock.
function playerRow(over = {}) {
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
function row(id, over) { return { id, player: playerRow({ name: over?.name ?? id, ...over }) }; }

const PLAYER_CASES = {
  mixed: {
    selfId: "p-alpha",
    rows: [
      row("p-alpha", { name: "Alpha", x: 0, y: 0, hp: 80, maxHp: 100, faction: "fire", weapon0: "sword" }),
      row("p-human", { name: "Human Two", x: 120, y: 80, hp: 60, maxHp: 100, faction: "holy", weapon0: "wand" }),
      row("p-bot", { name: "Bot One", x: 60, y: -40, bot: true, faction: "frost" }),
      row("p-dead", { name: "Dead Four", x: -80, y: 90, status: "dead", hp: 0, faction: "plague" }),
      row("p-far", { name: "Far Five", x: 5000, y: 5000, faction: "sentenced" }),
      row("p-hidden", { name: "Hidden Six", x: 40, y: 40, effects: 256, faction: "sentenced" }),
    ],
    roster: ["p-alpha", "p-human", "p-gone-1", "p-bot", "p-dead", "p-far", "p-gone-2", "p-hidden"],
  },
  "bots-only": {
    selfId: "p-alpha",
    rows: [
      row("p-alpha", { name: "Bot Alpha", x: 0, y: 0, bot: true, faction: "fire" }),
      row("p-bot1", { name: "Bot One", x: 70, y: 70, bot: true, faction: "holy" }),
      row("p-bot2", { name: "Bot Two", x: 90, y: -30, bot: true, status: "dead", hp: 0, faction: "frost" }),
    ],
    roster: ["p-alpha", "p-bot1", "p-bot2"],
  },
  "dead-self": {
    selfId: "p-alpha",
    rows: [
      row("p-alpha", { name: "Dead Alpha", x: 0, y: 0, status: "dead", hp: 0, faction: "fire" }),
      row("p-human", { name: "Human Two", x: 100, y: 0, faction: "holy" }),
      row("p-bot", { name: "Bot One", x: 60, y: 60, bot: true, status: "dead", hp: 0, faction: "frost" }),
    ],
    roster: ["p-alpha", "p-human", "p-bot"],
  },
  "removed-row": {
    selfId: "p-alpha",
    rows: [
      row("p-alpha", { name: "Alpha", x: 0, y: 0, faction: "fire" }),
      row("p-human", { name: "Human Two", x: 100, y: 50, faction: "holy" }),
    ],
    roster: ["p-alpha", "p-gone-1", "p-human", "p-gone-2"],
  },
};

function declaredState(caseName, { phase, training, minPlayers, startedWith, winner }) {
  const c = PLAYER_CASES[caseName];
  assert(c, "unknown players case " + caseName);
  return {
    phase, seed: 7, serverTime: 12345, lobbyEndsAt: 60000, raidStartedAt: 1000,
    minPlayers, startedWith, patienceEndsAt: 0, inColiseum: false, gatesLocked: false, suddenDeathAt: 0,
    winner, training,
    players: new Map(c.rows.map((r) => [r.id, r.player])),
    mobs: new Map(),
    containers: new Map(),
    roster: [...c.roster],
  };
}
const LONG_WINNER = "W".repeat(64);
const WINNERS = [
  { label: "empty", value: "" },
  { label: "unique", value: "Alice" },
  { label: "long-64", value: LONG_WINNER },
];
const THRESHOLDS = [
  { label: "schema-defaults", minPlayers: 0, startedWith: 0, provenance: "new RaidState() defaults" },
  { label: "fixed", minPlayers: 3, startedWith: 5, provenance: "declared fixed values" },
];
function frameSummary(frame) {
  return {
    t: frame.t,
    hud: frame.hud,
    self: {
      id: frame.self.id, name: frame.self.name, status: frame.self.status,
      x: frame.self.x, y: frame.self.y, hp: frame.self.hp, maxHp: frame.self.maxHp,
    },
    fighters: frame.fighters.map((f) => ({ id: f.id, name: f.name, bot: f.bot, status: f.status, x: f.x, y: f.y })),
    eventCount: frame.events.length,
    events: frame.events,
    immediate: frame.immediate,
    mobIds: frame.mobs.map((m) => m.id),
    containerIds: frame.containers.map((c) => c.id),
    extrasKeys: Object.keys(frame.extras).sort(),
    projectileCount: frame.projectiles.length,
  };
}
const PHASES = ["lobby", "planning", "active", "ended"];
const CASES = ["mixed", "bots-only", "dead-self", "removed-row"];
const runProbes = [];
for (const phase of PHASES) {
  for (const training of [false, true]) {
    for (const caseName of CASES) {
      for (const threshold of THRESHOLDS) {
        for (const winner of WINNERS) {
          const state = declaredState(caseName, {
            phase, training, minPlayers: threshold.minPlayers, startedWith: threshold.startedWith, winner: winner.value,
          });
          const ctx = { selfId: PLAYER_CASES[caseName].selfId, map: DECLARED_MAP, features: DECLARED_FEATURES, lastMinimap: null };
          const frame = perceive({ state }, ctx);
          runProbes.push({
            name: "phase=" + phase + ";training=" + training + ";players=" + caseName + ";threshold=" + threshold.label + ";winner=" + winner.label,
            provenance: "declared-probe",
            input: {
              phase, training, minPlayers: threshold.minPlayers, startedWith: threshold.startedWith, winner: winner.value,
              playersCase: caseName, selfId: ctx.selfId,
              players: [...state.players.keys()], roster: [...state.roster],
              features: DECLARED_FEATURES, lastMinimap: null, canSee: null,
            },
            frame: frameSummary(frame),
          });
        }
      }
    }
  }
}

// The hidden-status witness: two otherwise identical states differ only in one hidden player's Alive -> Dead. The source
// counts every stored row before sight filtering, so the public aggregate changes while the fighters list does not.
function hiddenStatusCase(hiddenStatus) {
  const state = declaredState("mixed", { phase: "active", training: false, minPlayers: 0, startedWith: 0, winner: "" });
  const hidden = state.players.get("p-hidden");
  assert(hidden, "the mixed case has the hidden row");
  // Copy the row: the declared case is shared, and the two probes must differ only in this one status field.
  state.players.set("p-hidden", { ...hidden, status: hiddenStatus });
  const frame = perceive({ state }, { selfId: "p-alpha", map: DECLARED_MAP, features: DECLARED_FEATURES, lastMinimap: null });
  return { state, frame };
}
const hiddenAlive = hiddenStatusCase("alive");
const hiddenDead = hiddenStatusCase("dead");
const hiddenRowsAlive = hiddenAlive.frame.fighters.map((f) => f.id).join(",");
const hiddenRowsDead = hiddenDead.frame.fighters.map((f) => f.id).join(",");
const hiddenStatus = {
  provenance: "declared-probe",
  note: "identical declared states except p-hidden.status; the hidden row has effects=256 (EFFECT_HIDDEN) and sits inside the view box",
  changedField: "players.p-hidden.status",
  hiddenId: "p-hidden",
  hiddenEffects: 256,
  hiddenPosition: { x: 40, y: 40 },
  alive: {
    input: { phase: "active", training: false, minPlayers: 0, startedWith: 0, winner: "", selfId: "p-alpha" },
    frame: frameSummary(hiddenAlive.frame),
  },
  dead: {
    input: { phase: "active", training: false, minPlayers: 0, startedWith: 0, winner: "", selfId: "p-alpha" },
    frame: frameSummary(hiddenDead.frame),
  },
  witness: {
    aliveBefore: hiddenAlive.frame.hud.alive,
    aliveAfter: hiddenDead.frame.hud.alive,
    aliveChanged: hiddenAlive.frame.hud.alive !== hiddenDead.frame.hud.alive,
    fightersBefore: hiddenRowsAlive,
    fightersAfter: hiddenRowsDead,
    fightersUnchanged: hiddenRowsAlive === hiddenRowsDead,
    hiddenRowInFighters: hiddenAlive.frame.fighters.some((f) => f.id === "p-hidden"),
    hiddenRowStillStored: [...hiddenDead.state.players.keys()].includes("p-hidden"),
    playerCountUnchanged: hiddenAlive.frame.hud.playerCount === hiddenDead.frame.hud.playerCount,
  },
};

// Current rows versus the retained roster id list, and the aggregate over each.
function countsCase(caseName, opts) {
  const state = declaredState(caseName, opts);
  const frame = perceive({ state }, { selfId: PLAYER_CASES[caseName].selfId, map: DECLARED_MAP, features: DECLARED_FEATURES, lastMinimap: null });
  return {
    name: caseName + ";phase=" + opts.phase,
    playersSize: state.players.size,
    rosterLength: state.roster.length,
    rosterIds: [...state.roster],
    currentRowIds: [...state.players.keys()],
    removedRosterIds: [...state.roster].filter((id) => !state.players.has(id)),
    hudPlayerCount: frame.hud.playerCount,
    hudAlive: frame.hud.alive,
    hudStartedWith: frame.hud.startedWith,
    hudMinPlayers: frame.hud.minPlayers,
  };
}
const counts = {
  note: "state.players are the current rows; state.roster is the retained, never-shortened id list (removed ids stay). hud.playerCount is players.size and hud.alive counts every stored row whose status is Alive, before sight filtering.",
  cases: [
    countsCase("mixed", { phase: "active", training: false, minPlayers: 0, startedWith: 0, winner: "" }),
    countsCase("removed-row", { phase: "ended", training: false, minPlayers: 3, startedWith: 5, winner: "Alice" }),
  ],
};

// The real RaidState schema: defaults, reflected types, and what a host integer does at the uint8 boundary.
const fieldMeta = (ctor, name) => {
  const md = ctor[Symbol.metadata];
  if (!md) return null;
  const entry = Object.values(md).find((e) => e && e.name === name);
  return entry ? { type: entry.type, index: entry.index, name: entry.name } : null;
};
function schemaBoundary() {
  const fresh = new RaidState();
  const defaults = { minPlayers: fresh.minPlayers, startedWith: fresh.startedWith, winner: fresh.winner, phase: fresh.phase };
  const reflection = {
    minPlayers: fieldMeta(RaidState, "minPlayers"),
    startedWith: fieldMeta(RaidState, "startedWith"),
    winner: fieldMeta(RaidState, "winner"),
    serverTime: fieldMeta(RaidState, "serverTime"),
  };
  const cases = [];
  for (const input of [0, 1, 254, 255, 256, 257, -1]) {
    const s = new RaidState();
    let thrown = null;
    let hostValue = null;
    try {
      s.minPlayers = input;
      hostValue = s.minPlayers;
    } catch (e) {
      thrown = { name: e?.constructor?.name ?? "Error", message: String(e?.message ?? e) };
    }
    let wire = null;
    if (thrown === null) {
      try {
        const encoder = new schemaPkg.Encoder(s);
        const it = { offset: 0 };
        encoder.encodeAll(it);
        const bytes = encoder.sharedBuffer.subarray(0, it.offset);
        const decodedState = new RaidState();
        const decoder = new schemaPkg.Decoder(decodedState);
        decoder.decode(bytes);
        wire = { encode: "ok", bytes: bytes.length, decodedMinPlayers: decodedState.minPlayers };
      } catch (e) {
        wire = { encode: "threw", name: e?.constructor?.name ?? "Error", message: String(e?.message ?? e) };
      }
    }
    cases.push({
      input,
      hostValue,
      hostType: typeof hostValue,
      threw: thrown,
      wire,
      hostInUint8Range: typeof hostValue === "number" && hostValue >= 0 && hostValue <= 255,
    });
  }
  return {
    provenance: "actual-source",
    source: "packages/shared/src/schema.ts RaidState (minPlayers/startedWith uint8, winner string) with @colyseus/schema Encoder.encodeAll/Decoder.decode",
    defaults,
    reflection,
    cases,
    note: "The in-process schema instance accepts any host number without a range check; the uint8 wire encoding truncates modulo 256 and the decoder returns the truncated value. There is no silent refusal at capture time.",
  };
}
const boundary = schemaBoundary();

const statusLineProbes = [];
function statusProbe(name, input, now = 5000, note = "") {
  return { name, provenance: "declared-probe", input, now, result: statusLine(input, now), note };
}
const baseStatus = { training: false, phase: "lobby", playerCount: 2, minPlayers: 4, lobbyEndsAt: 65000, alive: 1, startedWith: 3, winner: "", gv: null };
for (const phase of ["lobby", "planning", "active", "ended", "unknown"]) {
  for (const training of [false, true]) {
    statusLineProbes.push(statusProbe("phase=" + phase + ";training=" + training + ";base", { ...baseStatus, phase, training }));
  }
}
statusLineProbes.push(
  statusProbe("lobby;playerCount=0;minPlayers=0", { ...baseStatus, playerCount: 0, minPlayers: 0 }),
  statusProbe("lobby;playerCount=5;minPlayers=4", { ...baseStatus, playerCount: 5, minPlayers: 4 }),
  statusProbe("lobby;lobbyEndsAt=now", { ...baseStatus, lobbyEndsAt: 5000 }),
  statusProbe("lobby;lobbyEndsAt=past", { ...baseStatus, lobbyEndsAt: 4000 }),
  statusProbe("planning;planEndsAt=undefined", { ...baseStatus, phase: "planning" }),
  statusProbe("planning;planEndsAt=0", { ...baseStatus, phase: "planning", planEndsAt: 0 }),
  statusProbe("planning;planEndsAt=95000", { ...baseStatus, phase: "planning", planEndsAt: 95000 }),
  statusProbe("planning;planEndsAt=now", { ...baseStatus, phase: "planning", planEndsAt: 5000 }),
  statusProbe("active;gv=null;alive=1;startedWith=3", { ...baseStatus, phase: "active" }),
  statusProbe("active;gv=0", { ...baseStatus, phase: "active", gv: 0 }),
  statusProbe("active;gv=1234", { ...baseStatus, phase: "active", gv: 1234 }),
  statusProbe("active;alive=0", { ...baseStatus, phase: "active", alive: 0 }),
  statusProbe("active;startedWith=0", { ...baseStatus, phase: "active", startedWith: 0 }),
  statusProbe("active;alive=5;startedWith=5", { ...baseStatus, phase: "active", alive: 5, startedWith: 5 }),
  statusProbe("ended;winner=empty", { ...baseStatus, phase: "ended" }),
  statusProbe("ended;winner=Alice", { ...baseStatus, phase: "ended", winner: "Alice" }),
  statusProbe("ended;winner=long-64", { ...baseStatus, phase: "ended", winner: LONG_WINNER }),
  statusProbe("ended;winner=[BOT] Bob", { ...baseStatus, phase: "ended", winner: "[BOT] Bob" }),
  statusProbe("unknown;winner=Alice", { ...baseStatus, phase: "unknown", winner: "Alice" }),
);
const winnerLabelProbes = [];
function winnerLabelled(name, winner, people) {
  const walk = { forEach(cb) { for (const p of people) cb(p); } };
  return { name, provenance: "declared-probe", input: { winner, players: people }, result: winnerLabel(winner, walk) };
}
winnerLabelProbes.push(
  winnerLabelled("empty", "", [{ name: "Alice", bot: false }]),
  winnerLabelled("human-winner", "Alice", [{ name: "Alice", bot: false }]),
  winnerLabelled("bot-winner", "Bob", [{ name: "Bob", bot: true }]),
  winnerLabelled("bot-winner-human-lookalike", "Bob", [{ name: "Bob", bot: false }]),
  winnerLabelled("absent-name", "Zed", [{ name: "Alice", bot: false }]),
  winnerLabelled("no-players", "Zed", []),
);

const runSummary = {
  format: FORMAT,
  corpus: "actual legacy public run-summary + perceive() probes",
  provenance: {
    perceive: "packages/server/src/bots/brain/perception.ts perceive()",
    state: "declared source-schema StateLike records (schema.ts field shapes)",
    statusLine: "packages/client/src/ui/hud.ts statusLine (human HUD first line formatter)",
    winnerLabel: "packages/client/src/render/displayName.ts winnerLabel",
    schema: "packages/shared/src/schema.ts RaidState, encoded/decoded with @colyseus/schema",
  },
  matrix: {
    phases: PHASES, training: [false, true], playersCases: CASES,
    thresholds: THRESHOLDS.map((t) => ({ label: t.label, minPlayers: t.minPlayers, startedWith: t.startedWith, provenance: t.provenance })),
    winners: WINNERS.map((w) => ({ label: w.label, value: w.value })),
    probeCount: runProbes.length,
  },
  probes: runProbes,
  hiddenStatus,
  counts,
  schemaBoundary: boundary,
  statusLine: {
    provenance: "declared-probe",
    source: "packages/client/src/ui/hud.ts statusLine",
    trainingBanner: TRAINING_BANNER,
    probeCount: statusLineProbes.length,
    probes: statusLineProbes,
  },
  winnerLabel: {
    provenance: "declared-probe",
    source: "packages/client/src/render/displayName.ts winnerLabel",
    probeCount: winnerLabelProbes.length,
    probes: winnerLabelProbes,
  },
};

// =================================================================================================== B. availability
const planningModes = [];
for (const phase of ["lobby", "planning", "active", "ended", "other"]) {
  for (const training of [false, true]) {
    for (const held of [false, true]) {
      planningModes.push({
        name: "phase=" + phase + ";training=" + training + ";held=" + held,
        provenance: "declared-probe",
        input: { phase, training, heldTab: held },
        result: planningModeFor(phase, { training, held }),
      });
    }
  }
}

function rosterInput(id, over = {}) {
  const p = playerRow({
    name: id, x: 0, y: 0, faction: "sentenced", status: "alive", hp: 1000, maxHp: 1000,
    build: new Map(), mobStats: new Map(), ...over,
  });
  return { id, player: p };
}
const ROSTER_ROWS = [
  rosterInput("r-observer", { name: "Observer Eve", x: 0, y: 0, faction: "sentenced" }),
  rosterInput("r-human", {
    name: "Alice", x: 100, y: 50, faction: "fire", hp: 800, maxHp: 1000, weapon0: "sword", weapon1: "shield", slot: 0,
    build: new Map([["ad2", 2]]), mobStats: new Map([["brute", 3]]),
  }),
  rosterInput("r-bot", {
    name: "Bot Bob", x: 5000, y: 5000, bot: true, faction: "holy", weapon0: "wand", build: new Map([["ap2", 1]]),
  }),
  rosterInput("r-dead", { name: "Cara", x: 150, y: -50, status: "dead", hp: 0, faction: "frost", weapon0: "axe" }),
  rosterInput("r-hidden", { name: "Dan", x: 80, y: 80, effects: 256, faction: "plague", weapon0: "bow" }),
];
const rosterResult = mapRosterRows(ROSTER_ROWS, "r-observer");
const rosterRows = rosterResult.map((row) => ({
  id: row.id, name: row.name, champion: row.champion, alive: row.alive, local: row.local, strength: row.strength,
  weapons: row.weapons.map((w) => ({ id: w.id, name: w.name, active: w.active })),
  stats: row.stats.map((s) => ({ key: s.key, label: s.label, short: s.short, value: s.value })),
}));
const sightChecks = ROSTER_ROWS.map((r) => ({
  id: r.id, x: r.player.x, y: r.player.y, inObserverViewBox: inView(0, 0, r.player.x, r.player.y, 0),
}));
// The same declared rows through perceive: the sight-filtered fighter list is a smaller population than the Tab roster.
const contrastState = {
  phase: "active", seed: 7, serverTime: 20000, lobbyEndsAt: 0, raidStartedAt: 1000, minPlayers: 2, startedWith: 5,
  patienceEndsAt: 0, inColiseum: false, gatesLocked: false, suddenDeathAt: 0, winner: "", training: false,
  players: new Map(ROSTER_ROWS.map((r) => [r.id, r.player])), mobs: new Map(), containers: new Map(),
  roster: ROSTER_ROWS.map((r) => r.id),
};
const contrastFrame = perceive({ state: contrastState }, { selfId: "r-observer", map: DECLARED_MAP, features: DECLARED_FEATURES, lastMinimap: null });
const perceiveContrast = {
  provenance: "declared-probe",
  note: "same declared rows, selfId r-observer: mapRosterRows shows every synced row, while perceive drops the far row (outside the view box) and the hidden row (EFFECT_HIDDEN) from fighters",
  rosterIds: rosterRows.map((r) => r.id),
  rosterAlive: Object.fromEntries(rosterRows.map((r) => [r.id, r.alive])),
  perceiveFighterIds: contrastFrame.fighters.map((f) => f.id),
  perceiveFighterStatus: Object.fromEntries(contrastFrame.fighters.map((f) => [f.id, f.status])),
  perceiveHudAlive: contrastFrame.hud.alive,
  perceiveHudPlayerCount: contrastFrame.hud.playerCount,
  sightChecks,
};

function lobbyRoom(training, joinable, phase, startedAt, players, joinedNames) {
  return { training, joinable, phase, startedAt, players: players.map((p) => ({ ...p })), joinedNames: [...joinedNames] };
}
const TRAINING_ROOM = lobbyRoom(true, true, "lobby", null,
  [{ name: "Alice", kind: "human", alive: true }, { name: "Bot1", kind: "bot", alive: true }], ["Alice", "Bot1"]);
const NON_TRAINING_A = lobbyRoom(false, false, "active", 1700000000000,
  [{ name: "Alice", kind: "human", alive: true }, { name: "Bot Bob", kind: "bot", alive: true }, { name: "Cara", kind: "human", alive: false }],
  ["Alice", "Bot Bob", "Cara"]);
const NON_TRAINING_B = lobbyRoom(false, true, "lobby", null, [], []);
function lobbyScenario(name, spec) {
  const status = new LobbyStatus();
  for (const [id, room] of spec.rooms) status.updateRoom(id, room);
  for (const lease of spec.leases) status.touch(lease.name, lease.tabId, spec.now);
  const snapshot = status.snapshot(spec.arenaLimit, spec.arenaRoomCount, spec.now);
  return {
    name, provenance: "declared-probe",
    input: {
      rooms: spec.rooms.map(([id, r]) => ({ id, ...r })),
      leases: spec.leases, arenaLimit: spec.arenaLimit, arenaRoomCount: spec.arenaRoomCount, now: spec.now,
    },
    snapshot,
    witnesses: {
      activeGameRoom: (() => {
        const training = spec.rooms.filter(([, r]) => r.training).map(([id]) => id);
        const nonTraining = spec.rooms.filter(([, r]) => !r.training).map(([id]) => id);
        return { trainingRoomIds: training, nonTrainingRoomIds: nonTraining, activeGameIsFirstNonTraining: nonTraining.length === 0 ? snapshot.activeGame === null : snapshot.activeGame !== null };
      })(),
      humanSeatNames: snapshot.activeGame ? snapshot.activeGame.players.filter((p) => p.kind === "human").map((p) => p.name) : [],
      botSeatNames: snapshot.activeGame ? snapshot.activeGame.players.filter((p) => p.kind === "bot").map((p) => p.name) : [],
      waitingNames: snapshot.waiting.map((p) => p.name),
      onlineCount: snapshot.onlineCount,
      arenaAvailable: snapshot.arenaAvailable,
      arenaLimit: snapshot.arenaLimit,
    },
  };
}
const lobbyScenarios = [
  lobbyScenario("training-only", { rooms: [["room-t", TRAINING_ROOM]], leases: [{ name: "Zed", tabId: "t1" }, { name: "Alice", tabId: "t2" }], arenaLimit: 2, arenaRoomCount: 0, now: 1000 }),
  lobbyScenario("non-training-present", { rooms: [["room-t", TRAINING_ROOM], ["room-a", NON_TRAINING_A], ["room-b", NON_TRAINING_B]], leases: [{ name: "Zed", tabId: "t1" }, { name: "Alice", tabId: "t2" }], arenaLimit: 2, arenaRoomCount: 1, now: 1000 }),
  lobbyScenario("full-arena", { rooms: [["room-t", TRAINING_ROOM], ["room-a", NON_TRAINING_A]], leases: [{ name: "Zed", tabId: "t1" }], arenaLimit: 2, arenaRoomCount: 2, now: 1000 }),
  lobbyScenario("limit-0", { rooms: [], leases: [{ name: "Alice", tabId: "t1" }, { name: "Bob", tabId: "t2" }], arenaLimit: 0, arenaRoomCount: 0, now: 1000 }),
  lobbyScenario("full-arena-joinable", { rooms: [["room-t", TRAINING_ROOM], ["room-a", NON_TRAINING_A], ["room-b", NON_TRAINING_B]], leases: [{ name: "Zed", tabId: "t1" }], arenaLimit: 2, arenaRoomCount: 2, now: 1000 }),
];

const availability = {
  format: FORMAT,
  corpus: "actual human projection/availability + server lobby projection",
  provenance: {
    planningMode: "packages/client/src/ui/planning.ts planningModeFor",
    mapRoster: "packages/client/src/ui/mapRoster.ts mapRosterRows",
    lobbyStatus: "packages/server/src/guards/lobbyStatus.ts LobbyStatus.snapshot",
    perceiveContrast: "packages/server/src/bots/brain/perception.ts perceive",
  },
  clientImports: {
    loader: "tools/percept-witness-fixtures/css-stub-loader.mjs resolves every *.css to an empty module",
    stubs: ["document", "window", "localStorage", "sessionStorage", "navigator", "matchMedia", "requestAnimationFrame", "performance"],
    modules: {
      "packages/client/src/ui/hud.ts": "ok", "packages/client/src/render/displayName.ts": "ok",
      "packages/client/src/ui/planning.ts": "ok", "packages/client/src/ui/mapRoster.ts": "ok",
      "packages/server/src/guards/lobbyStatus.ts": "ok",
    },
    blocker: null,
  },
  planningMode: { matrix: { phases: ["lobby", "planning", "active", "ended", "other"], training: [false, true], heldTab: [false, true] }, probeCount: planningModes.length, probes: planningModes },
  mapRoster: {
    provenance: "declared-probe",
    input: { rows: ROSTER_ROWS.map((r) => ({ id: r.id, player: jsonSafe(r.player) })), localId: "r-observer" },
    note: "declared synced rows: a dead player, a far player the observer cannot see, a bot and an EFFECT_HIDDEN player all stay in the roster rows",
    rows: rosterRows,
    order: rosterRows.map((r) => r.id),
    sightChecks,
    perceiveContrast,
  },
  lobbyStatus: {
    provenance: "declared-probe",
    note: "declared RoomPresence registrations and leases through updateRoom/touch, then snapshot(arenaLimit, arenaRoomCount, now); snapshot output is recorded verbatim",
    scenarioCount: lobbyScenarios.length,
    scenarios: lobbyScenarios,
  },
};

// =================================================================================================== C. windup path
function arenaMap() {
  const w = 40;
  const h = 20;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
  return { ...mapFromTiles(w, h, tiles), spawns: [{ x: 3 * TILE + 16, y: 10 * TILE + 16 }, { x: 36 * TILE + 16, y: 10 * TILE + 16 }] };
}
const SIM_SEED = 7;
const SIM_CONFIG = {
  minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
  suddenDeathSeconds: 60, pvpRules: false,
};
function newArenaWorld() {
  const map = { ...arenaMap(), seed: SIM_SEED };
  return createGameWorld({ seed: SIM_SEED, map, config: SIM_CONFIG, random: mulberry32(8) });
}
function nameOfPlayer(world, id) { return world.state.players.get(id); }
function runtimeOf(world, id) { return world.players.get(id); }
function place(world, id, x, y, facing) {
  const p = world.state.players.get(id);
  assert(p, "player " + id);
  p.x = x;
  p.y = y;
  p.facing = facing;
  const rt = runtimeOf(world, id);
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
}
function arm(world, id, faction, weapon, hp = FACTIONS[faction].hp) {
  const p = world.state.players.get(id);
  p.faction = faction;
  p.hp = p.maxHp = hp;
  p.weapon0 = weapon;
  p.weapon1 = "";
  p.slot = 0;
}
const ROSTER = ["p0", "p1", "p2"];
const ROSTER_INDEX = new Map(ROSTER.map((id, i) => [id, i]));
function packAndDecode(fxEvents, t) {
  const batch = packFx(fxEvents, t, { roster: ROSTER_INDEX });
  const decoded = unpackFx(batch, ROSTER);
  return { batch, decoded, tupleKinds: decoded.map((f) => f.kind) };
}
function captureRun(world, maxSteps, onStep) {
  const steps = [];
  const actions = [];
  for (let i = 0; i < maxSteps; i++) {
    const requested = onStep ? onStep(i, world, actions) : undefined;
    if (requested === false) break;
    const events = step(world, TICK_MS);
    const t = world.state.serverTime;
    const fxEvents = events.filter((e) => e.type === "fx").map((e) => e.fx);
    if (fxEvents.length > 0) {
      const packed = packAndDecode(fxEvents, t);
      steps.push({
        stepIndex: i,
        t,
        simEvents: plain(events),
        fxEvents: plain(fxEvents),
        packed: plain(packed.batch),
        tupleKinds: packed.tupleKinds,
        decoded: plain(packed.decoded),
      });
    }
  }
  return { steps, actions };
}

// World A: the melee controls. A fire sword swing into a holy shield: windup(ms 0) + swing + block + hits in one step,
// exactly the source's real producer path (createGameWorld installs every gameplay module as the repo's tests do).
const worldA = newArenaWorld();
const a0 = addPlayer(worldA, "p0", "Alice");
const a1 = addPlayer(worldA, "p1", "Bob", { faction: "holy" });
step(worldA, TICK_MS);
assert.equal(worldA.state.phase, "active");
arm(worldA, "p0", "fire", "sword");
arm(worldA, "p1", "holy", "shield");
place(worldA, "p0", 400, 300, 0);
place(worldA, "p1", 450, 300, Math.PI);
const runA = captureRun(worldA, 40, (i, world, actions) => {
  if (i === 0) {
    const q = runtimeOf(world, "p0").inputs;
    assert.equal(enqueueClientMessage(q, "attack", { a: 0 }), true);
    assert.equal(enqueueClientMessage(q, "release", { a: 0 }), true);
    actions.push({ stepIndex: i, actor: "p0", message: "attack", msg: { a: 0 } }, { stepIndex: i, actor: "p0", message: "release", msg: { a: 0 } });
  }
});
assert.equal(runA.steps.length > 0, true, "World A produced fx");

// World B: wand windups at distinct steps, then one step with two sources. p0's first two attacks are separated by a
// cooldown; the pair is fired on the first step both are ready.
const worldB = newArenaWorld();
const b0 = addPlayer(worldB, "p0", "Alice");
const b1 = addPlayer(worldB, "p1", "Bob", { faction: "holy" });
step(worldB, TICK_MS);
assert.equal(worldB.state.phase, "active");
arm(worldB, "p0", "fire", "wand");
arm(worldB, "p1", "holy", "wand");
place(worldB, "p0", 400, 300, 0);
place(worldB, "p1", 900, 300, Math.PI);
const bScript = { single2: false, pair: false, pairAt: -1 };
const runB = captureRun(worldB, 120, (i, world, actions) => {
  const now = world.state.serverTime;
  const p0 = nameOfPlayer(world, "p0");
  const p1 = nameOfPlayer(world, "p1");
  const send = (id, message, msg) => {
    assert.equal(enqueueClientMessage(runtimeOf(world, id).inputs, message, msg), true);
    actions.push({ stepIndex: i, actor: id, message, msg });
  };
  if (i === 0) {
    send("p0", "attack", { a: 0 });
    send("p0", "release", { a: 0 });
    return;
  }
  if (!bScript.single2 && i > 25 && p0.readyAt <= now + TICK_MS) {
    send("p0", "attack", { a: 0 });
    send("p0", "release", { a: 0 });
    bScript.single2 = true;
    return;
  }
  if (bScript.single2 && !bScript.pair && p0.readyAt <= now + TICK_MS && p1.readyAt <= now + TICK_MS) {
    send("p0", "attack", { a: 0 });
    send("p0", "release", { a: 0 });
    send("p1", "attack", { a: Math.PI });
    send("p1", "release", { a: Math.PI });
    bScript.pair = true;
    bScript.pairAt = i;
    return;
  }
  if (bScript.pair && i > bScript.pairAt + 20) return false;
});
assert.equal(bScript.single2, true, "World B fired the second single windup");
assert.equal(bScript.pair, true, "World B fired the two-source step");

const windupSteps = runB.steps.filter((s) => s.tupleKinds.filter((k) => k === "windup").length === 1 && s.fxEvents.some((fx) => fx.kind === "windup" && fx.by === "p0"));
assert(windupSteps.length >= 2, "at least two distinct single-source windup steps");
const windupStepA = windupSteps[0];
const windupStepB = windupSteps[1];
assert.notEqual(windupStepA.t, windupStepB.t);
const pairStep = runB.steps.find((s) => s.fxEvents.filter((fx) => fx.kind === "windup").length >= 2);
assert(pairStep, "one step emitted windups from two sources");

// The declared observation state carries the actors at the producer's own positions and the same roster mapping the
// batch was packed with.
function declaredActorRow(statePlayer, over = {}) {
  const p = statePlayer;
  const build = new Map();
  p.build?.forEach((count, id) => { if (count > 0) build.set(id, count); });
  const mobStats = new Map();
  p.mobStats?.forEach((count, id) => { if (count > 0) mobStats.set(id, count); });
  return playerRow({
    name: p.name, bot: p.bot, x: p.x, y: p.y, facing: p.facing, hp: p.hp, maxHp: p.maxHp, status: p.status,
    faction: p.faction, weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot, barrier: p.barrier,
    effects: p.effects, drawStartedAt: p.drawStartedAt, readyAt: p.readyAt, immuneUntil: p.immuneUntil,
    sig: p.sig, brand: p.brand, kills: p.kills, gv: p.gv, bounty: p.bounty, moveSeq: p.moveSeq,
    asMult: p.asMult, windupMult: p.windupMult, speedMult: p.speedMult, build, mobStats, campClears: p.campClears,
    ...over,
  });
}
const OBSERVER_ID = "p2";
const observerRow = playerRow({
  name: "Observer", bot: true, x: 650, y: 300, hp: 1000, maxHp: 1000, status: "alive", faction: "fire",
});
const aP0 = nameOfPlayer(worldA, "p0");
const aP1 = nameOfPlayer(worldA, "p1");
const bP0 = nameOfPlayer(worldB, "p0");
const bP1 = nameOfPlayer(worldB, "p1");
const observedP0 = declaredActorRow(bP0);
const observedP1 = declaredActorRow(bP1);
const OBSERVED_MAP = DECLARED_MAP;
function observationState(p0Row, p1Row, over = {}) {
  return {
    phase: "active", seed: SIM_SEED, serverTime: 999999, lobbyEndsAt: 0, raidStartedAt: 1000, minPlayers: 2,
    startedWith: 2, patienceEndsAt: 0, inColiseum: false, gatesLocked: false, suddenDeathAt: 0, winner: "",
    training: false,
    players: new Map([["p0", p0Row], ["p1", p1Row], [OBSERVER_ID, observerRow]]),
    mobs: new Map(), containers: new Map(), roster: [...ROSTER],
    ...over,
  };
}
const OBSERVATION_BASE = { serverTime: 999999, declaredSelfId: OBSERVER_ID, stateTimeNote: "the declared state clock is later than every batch t, so an originating event time cannot come from the final observation clock" };
const observationCtx = (canSee) => ({ selfId: OBSERVER_ID, map: OBSERVED_MAP, features: DECLARED_FEATURES, lastMinimap: null, ...(canSee ? { canSee } : {}) });
function observation(name, batches, state, ctx, extra = {}) {
  const frame = perceive({ state, fxs: batches }, ctx);
  return {
    name,
    provenance: "actual-producer vector + declared-state probe",
    declared: { selfId: ctx.selfId, canSeePredicateSupplied: ctx.canSee !== undefined, serverTime: state.serverTime, players: [...state.players.keys()], roster: [...state.roster] },
    batches: plain(batches),
    decodedPerBatch: batches.map((b) => plain(unpackFx(b, ROSTER))),
    frame: {
      t: frame.t,
      hud: frame.hud,
      self: { id: frame.self.id, status: frame.self.status, x: frame.self.x, y: frame.self.y },
      fighters: frame.fighters.map((f) => ({ id: f.id, name: f.name, bot: f.bot, status: f.status, x: f.x, y: f.y })),
      events: frame.events,
    },
    ...extra,
  };
}
function producerRef(step) {
  return { t: step.t, stepIndex: step.stepIndex, rawFx: step.fxEvents, packed: step.packed, tupleKinds: step.tupleKinds, decoded: step.decoded };
}
function windupEvents(frame) { return frame.events.filter((e) => e.kind === "windup"); }
function noEvents(frame, kind) { return frame.events.every((e) => e.kind !== kind); }

const visibleObs = observation("visible-attacker-origin-time", [windupStepA.packed], observationState(observedP0, observedP1), observationCtx(), { producer: [producerRef(windupStepA)] });
const visibleWindup = windupEvents(visibleObs.frame).find((e) => e.by === "p0");
expectSource(visibleWindup !== undefined, "a visible attacker's windup is observed");
if (visibleWindup !== undefined) expectSource(visibleWindup.t === windupStepA.t, "the observed windup keeps the originating batch t");
visibleObs.assertions = visibleWindup === undefined
  ? { windupPresent: false, originatingBatchT: windupStepA.t }
  : {
    windupPresent: true,
    windupT: visibleWindup.t,
    originatingBatchT: windupStepA.t,
    keepsOriginatingTime: visibleWindup.t === windupStepA.t,
    differsFromFinalStateClock: visibleWindup.t !== 999999,
  };

const hiddenP0 = declaredActorRow(bP0, { effects: (bP0.effects ?? 0) | 256 });
const hiddenObs = observation("hidden-attacker-redacted", [windupStepA.packed], observationState(hiddenP0, observedP1), observationCtx(), { producer: [producerRef(windupStepA)] });
expectSource(noEvents(hiddenObs.frame, "windup"), "a hidden attacker's windup is redacted");
hiddenObs.assertions = {
  windupAbsent: noEvents(hiddenObs.frame, "windup"),
  observedWindupTimes: windupEvents(hiddenObs.frame).map((e) => e.t),
  hiddenRowInFighters: hiddenObs.frame.fighters.some((f) => f.id === "p0"),
  hudAliveStillCountsHidden: hiddenObs.frame.hud.alive,
  hiddenEffects: hiddenP0.effects,
};

const farP0 = declaredActorRow(bP0, { x: 5000, y: 5000 });
const outOfFrameObs = observation("out-of-frame-attacker-redacted", [windupStepA.packed], observationState(farP0, observedP1), observationCtx(), { producer: [producerRef(windupStepA)] });
expectSource(noEvents(outOfFrameObs.frame, "windup"), "an attacker outside the frame box is redacted");
outOfFrameObs.assertions = {
  windupAbsent: noEvents(outOfFrameObs.frame, "windup"),
  observedWindupTimes: windupEvents(outOfFrameObs.frame).map((e) => e.t),
  attackerInFighters: outOfFrameObs.frame.fighters.some((f) => f.id === "p0"),
  inView: inView(650, 300, 5000, 5000, 64),
};

const visionObs = observation("personal-vision-denied-redacted", [windupStepA.packed], observationState(observedP0, observedP1), observationCtx(() => false), { producer: [producerRef(windupStepA)] });
expectSource(noEvents(visionObs.frame, "windup"), "canSee=false redacts the windup");
visionObs.assertions = {
  windupAbsent: noEvents(visionObs.frame, "windup"),
  observedWindupTimes: windupEvents(visionObs.frame).map((e) => e.t),
  canSee: false,
  fighterCount: visionObs.frame.fighters.length,
};

const multiObs = observation("two-batches-own-originating-times", [windupStepA.packed, windupStepB.packed], observationState(observedP0, observedP1), observationCtx(), { producer: [producerRef(windupStepA), producerRef(windupStepB)] });
const multiWindups = multiObs.frame.events.filter((e) => e.kind === "windup" && e.by === "p0");
expectSource(multiWindups.length === 2, "both batches' windups are observed");
multiObs.assertions = {
  observedTimes: multiWindups.map((e) => e.t),
  batchTimes: [windupStepA.packed.t, windupStepB.packed.t],
  eachKeepsOwnBatchTime: multiWindups.length === 2 && multiWindups[0].t === windupStepA.packed.t && multiWindups[1].t === windupStepB.packed.t,
};

const pairObs = observation("same-step-two-sources-share-time", [pairStep.packed], observationState(observedP0, observedP1), observationCtx(), { producer: [producerRef(pairStep)] });
const pairWindups = pairObs.frame.events.filter((e) => e.kind === "windup");
expectSource(pairWindups.length === 2, "both sources' windups are observed");
pairObs.assertions = {
  observedTimes: pairWindups.map((e) => e.t),
  observedBy: pairWindups.map((e) => e.by),
  batchTime: pairStep.packed.t,
  bothShareBatchTime: pairWindups.length === 2 && pairWindups.every((e) => e.t === pairStep.packed.t),
};

const controlStep = runA.steps.find((s) => s.fxEvents.some((fx) => fx.kind === "swing") && s.fxEvents.some((fx) => fx.kind === "block") && s.fxEvents.some((fx) => fx.kind === "hit"));
const SWING_HIT_BLOCK = { present: controlStep !== undefined, step: controlStep ? { t: controlStep.t, tupleKinds: controlStep.tupleKinds } : null };
let controlsObs = null;
if (controlStep) {
  const aP0Row = declaredActorRow(aP0);
  const aP1Row = declaredActorRow(aP1);
  controlsObs = observation("controls-swing-hit-block", [controlStep.packed], observationState(aP0Row, aP1Row), observationCtx(), { producer: [producerRef(controlStep)] });
  SWING_HIT_BLOCK.observedKinds = controlsObs.frame.events.map((e) => e.kind);
  SWING_HIT_BLOCK.swingObserved = controlsObs.frame.events.some((e) => e.kind === "swing");
  SWING_HIT_BLOCK.hitObserved = controlsObs.frame.events.some((e) => e.kind === "hit");
  SWING_HIT_BLOCK.blockObserved = controlsObs.frame.events.some((e) => e.kind === "block");
  SWING_HIT_BLOCK.batchT = controlStep.packed.t;
  SWING_HIT_BLOCK.observedTimes = controlsObs.frame.events.map((e) => e.t);
  SWING_HIT_BLOCK.outcome = "captured";
} else {
  SWING_HIT_BLOCK.outcome = "incomplete";
  SWING_HIT_BLOCK.missingPrerequisite = "the scripted melee fight did not emit swing+block+hit in one step; the real producer path is sim/melee.ts resolveMelee -> ledger.applyLedger, which needs an in-range arc swing into a shield-facing target";
}

function rawProducerCapture(world, label, steps) {
  return {
    world: label,
    seed: SIM_SEED,
    config: SIM_CONFIG,
    map: { width: world.map.width, height: world.map.height, tile: TILE, spawns: plain(world.map.spawns), camps: world.map.camps?.length ?? 0 },
    rosterMapping: Object.fromEntries(ROSTER.map((rid, i) => [rid, i])),
    finalPhase: world.state.phase,
    finalServerTime: world.state.serverTime,
    finalPlayers: [...world.state.players.entries()].map(([pid, p]) => ({
      id: pid, name: p.name, status: p.status, x: p.x, y: p.y, faction: p.faction, weapon0: p.weapon0, hp: p.hp, maxHp: p.maxHp,
    })),
    steps,
  };
}
const windupPath = {
  format: FORMAT,
  corpus: "actual Windup emission -> packFx -> unpackFx -> perceive",
  provenance: {
    producer: "createGameWorld (packages/server/src/sim/gameplay.ts -> createWorld, packages/server/src/sim/world.ts) with the real step loop; weapons/press/release through enqueueClientMessage exactly as packages/server/test/weapons.test.ts does",
    codec: "packages/shared/src/fxCodec.ts packFx/unpackFx",
    observer: "packages/server/src/bots/brain/perception.ts perceive",
    classification: "the sim emission and the packed/decoded fx are actual-producer data; the observation states are declared projections of the actual fighters plus a declared observer",
  },
  idMapping: { roster: ROSTER, indexes: Object.fromEntries(ROSTER.map((rid, i) => [rid, i])), note: "explicit mapping used for packFx opts.roster; unpackFx reads the same array" },
  observationBase: OBSERVATION_BASE,
  producerRuns: {
    controlsMelee: rawProducerCapture(worldA, "World A (sword vs shield)", runA.steps),
    windupsWand: rawProducerCapture(worldB, "World B (wand windups)", runB.steps),
  },
  windupSteps: {
    firstSingleSource: { t: windupStepA.t, stepIndex: windupStepA.stepIndex, rawFx: windupStepA.fxEvents, packed: windupStepA.packed, decoded: windupStepA.decoded },
    secondSingleSource: { t: windupStepB.t, stepIndex: windupStepB.stepIndex, rawFx: windupStepB.fxEvents, packed: windupStepB.packed, decoded: windupStepB.decoded },
    sameStepTwoSources: { t: pairStep.t, stepIndex: pairStep.stepIndex, rawFx: pairStep.fxEvents, packed: pairStep.packed, decoded: pairStep.decoded },
  },
  observations: [visibleObs, hiddenObs, outOfFrameObs, visionObs, multiObs, pairObs, ...(controlsObs ? [controlsObs] : [])],
  controls: SWING_HIT_BLOCK,
  swingHitBlockOutcome: SWING_HIT_BLOCK.present
    ? { outcome: "captured", note: "the actual sword-into-shield step emitted windup, swing, block and hit; all appear in the observed frame for a visible observer" }
    : { outcome: "incomplete", missingPrerequisite: SWING_HIT_BLOCK.missingPrerequisite },
};

// ========================================================================================================= write/check
const corpora = [
  ["run-summary.json", runSummary],
  ["availability.json", availability],
  ["windup-path.json", windupPath],
];
assert.deepEqual(corpora.map(([name]) => name), OUTPUTS);
const serialized = corpora.map(([name, corpus]) => [name, finalize(corpus)]);
if (mode === "--write") {
  for (const [name, text] of serialized) writeFileSync(join(outDir, name), text);
  console.log("captured " + serialized.length + " corpora: " + serialized.map(([name]) => name).join(", "));
  console.log("run-summary: " + runProbes.length + " perceive probes, " + boundary.cases.length + " schema boundary cases, " + statusLineProbes.length + " statusLine probes");
  console.log("availability: " + planningModes.length + " planning modes, " + rosterRows.length + " roster rows, " + lobbyScenarios.length + " lobby scenarios");
  console.log("windup-path: " + (runA.steps.length + runB.steps.length) + " fx steps, " + windupPath.observations.length + " observations; controls=" + SWING_HIT_BLOCK.outcome);
} else {
  for (const [name, text] of serialized) {
    const expectedPath = join(outDir, name);
    assert.equal(readFileSync(expectedPath, "utf8"), text, "the checked-in corpus " + name + " differs from the source capture");
  }
  console.log("percept-witness corpora match: " + serialized.map(([name]) => name).join(", "));
}
