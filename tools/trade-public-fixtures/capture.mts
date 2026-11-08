/**
 * P-QUEST-TRADE-PUBLIC-WITNESSES — trade family canonical actual-source capture.
 *
 * Every recorded value is returned by the unchanged legacy TypeScript this witness imports:
 *   A doors.json             the real TraderPanel (constructor/update/click path) with the scene's real
 *                            (trader, pick) => sendInput(room,"trade",{trader,pick}) wiring, on a declared minimal DOM; the
 *                            real enqueueClientMessage trade parse/queue table; the real handleTrade through ordinary 50 ms steps.
 *   B schema-receivers.json  the real TraderState/PlayerState/RaidState schema metadata and a real Colyseus encode/decode;
 *                            the actual public actor vs owner offer/cooldown boundary (including the source's public
 *                            PlayerState.tradeOffers/tradeStats disclosure, recorded as a labelled finding); the real
 *                            TraderPanel text and TraderView figure receiver over actual state.
 *   C wording.json           the actual shared barter/stat label declarations, the panel's real rendered wording, and the
 *                            real handler toast text/recipients, with helper declarations kept distinct from runtime toasts.
 *
 * Declared: the DOM stub, the Phaser scene recorder, player positions/weapons/potions/status, one forced wall tile for the
 * LOS probe, the end-phase nudge, and the client frame wrapper. Actual: every method/function return value, every queued
 * command, every emitted toast and every schema byte. No production source is modified; nothing here is a real browser,
 * DOM, socket/Room session, renderer or Unity claim.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { installFakeDom } from "./fake-dom.mts";

const IMAGE = "node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const IMAGE_DIGEST = "sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const FORMAT = "rh-trade-public-witness/1";
const OUTPUTS = ["doors.json", "schema-receivers.json", "wording.json"];

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
const RECORD_MODE = process.env.RH_TRADE_PUBLIC_RECORD === "1";
const sourceIssues: string[] = [];
const expectSource = (condition: any, message: string): void => {
  if (!condition) { if (RECORD_MODE) sourceIssues.push(message); else assert(condition, message); }
};

const sha256 = (data: any): string => createHash("sha256").update(data).digest("hex");
const repo = (p: string): string => join(repoRoot, p);
const shaFile = (p: string): string => sha256(readFileSync(repo(p)));
const isFile = (p: string): boolean => existsSync(repo(p)) && statSync(repo(p)).isFile();
const load = (p: string): Promise<any> => import(pathToFileURL(repo(p)).href);
const plain = (v: any): any => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const keySorted = (a: any, b: any): number => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const entriesOf = (m: any): any[] => {
  const out: any[] = [];
  if (m && typeof m.forEach === "function") m.forEach((v: any, k: any) => out.push([k, v]));
  else if (m && typeof m[Symbol.iterator] === "function") for (const pair of m) out.push(pair);
  return out;
};
const pairs = (m: any): any[] => m === undefined || m === null ? [] : entriesOf(m).map(([k, v]: any) => [k, plain(v)]).sort((a: any, b: any) => keySorted(a[0], b[0]));

let clockNow = 10000;
Object.defineProperty(globalThis, "performance", { value: { now: () => clockNow }, configurable: true });
const { doc, win, ui } = installFakeDom();

// ------------------------------------------------------------------------------------------------------- source modules
const S = await load("packages/shared/src/index.ts");
const schemaMod = await load("packages/shared/src/schema.ts");
const mapgen = await load("packages/shared/src/mapgen.ts");
const mapWire = await load("packages/shared/src/mapWire.ts");
const gameplay = await load("packages/server/src/sim/gameplay.ts");
const stepMod = await load("packages/server/src/sim/step.ts");
const inputsMod = await load("packages/server/src/sim/inputs.ts");
const combatantMod = await load("packages/server/src/sim/combatant.ts");
const statusMod = await load("packages/server/src/sim/status.ts");
const worldMod = await load("packages/server/src/sim/world.ts");
const tradersMod = await load("packages/server/src/sim/traders.ts");
const chestsMod = await load("packages/server/src/sim/chests.ts");
const repoRequire = createRequire(join(repoRoot, "package.json"));
const schemaLib = await import(pathToFileURL(repoRequire.resolve("@colyseus/schema")).href);
const settingsMod = await load("packages/client/src/settings.ts");
const connectionMod = await load("packages/client/src/net/connection.ts");
const traderPanelMod = await load("packages/client/src/ui/traderPanel.ts");
const traderViewMod = await load("packages/client/src/render/TraderView.ts");

const { TraderPanel } = traderPanelMod;
const { TraderView } = traderViewMod;
const { sendInput } = connectionMod;
const { InputQueue, enqueueClientMessage } = inputsMod;
const { addPlayer, step } = stepMod;
const { createGameWorld } = gameplay;
const { generateMap } = mapgen;
const { mapHashU32 } = mapWire;
const { addStatus } = statusMod;
const { combatant } = combatantMod;
const { collisionMap } = worldMod;
const { handleTrade } = tradersMod;
const { grantCard } = chestsMod;
const { Encoder, Reflection, getEncodeDescriptor } = schemaLib;

// ---------------------------------------------------------------------------------------------- internal source closure
const ENTRY_SOURCES = [
  "tools/trade-public-fixtures/capture.mts",
  "tools/trade-public-fixtures/fake-dom.mts",
  "packages/shared/src/index.ts",
  "packages/shared/src/schema.ts",
  "packages/shared/src/mapgen.ts",
  "packages/shared/src/mapWire.ts",
  "packages/server/src/sim/gameplay.ts",
  "packages/server/src/sim/step.ts",
  "packages/server/src/sim/inputs.ts",
  "packages/server/src/sim/combatant.ts",
  "packages/server/src/sim/status.ts",
  "packages/server/src/sim/world.ts",
  "packages/server/src/sim/traders.ts",
  "packages/server/src/sim/chests.ts",
  "packages/client/src/settings.ts",
  "packages/client/src/net/connection.ts",
  "packages/client/src/ui/traderPanel.ts",
  "packages/client/src/render/TraderView.ts",
  "packages/client/src/render/projection.ts",
];
const IMPORT_RE = /(?:^|[;\n])\s*(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g;
const LOAD_RE = /\b(?:import|load)\s*\(\s*["']([^"']+)["']/g;
const importsOf = (text: string): string[] => {
  const out: string[] = [];
  for (const re of [IMPORT_RE, LOAD_RE]) {
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
function resolveSpecifier(fromRel: string, spec: string): { kind: "ts" | "style" | "external" | "node" | "unresolved"; path: string } {
  if (spec.startsWith("node:")) return { kind: "node", path: spec };
  if (spec.startsWith(".")) {
    const base = join(dirname(fromRel), spec).split("\\").join("/");
    if (spec.endsWith(".css")) return { kind: "style", path: base };
    const ts = tryTs(base);
    return ts ? { kind: "ts", path: ts } : { kind: "unresolved", path: base };
  }
  if (spec === "@raid/shared") return { kind: "ts", path: "packages/shared/src/index.ts" };
  if (spec.startsWith("@raid/shared/")) {
    const ts = tryTs("packages/shared/src/" + spec.slice("@raid/shared/".length));
    return ts ? { kind: "ts", path: ts } : { kind: "unresolved", path: spec };
  }
  return { kind: "external", path: spec };
}
const sourceFiles = new Set<string>();
const styleFiles = new Set<string>();
const externalImports = new Set<string>();
const nodeBuiltins = new Set<string>();
const unresolvedImports = new Set<string>();
const sourceStack = [...ENTRY_SOURCES];
while (sourceStack.length > 0) {
  const rel = sourceStack.pop()!;
  if (!isFile(rel) || sourceFiles.has(rel)) continue;
  sourceFiles.add(rel);
  for (const spec of importsOf(readFileSync(repo(rel), "utf8"))) {
    const r = resolveSpecifier(rel, spec);
    if (r.kind === "ts") sourceStack.push(r.path);
    else if (r.kind === "style") styleFiles.add(r.path);
    else if (r.kind === "node") nodeBuiltins.add(r.path);
    else if (r.kind === "external") externalImports.add(r.path);
    else unresolvedImports.add(spec + " (from " + rel + ")");
  }
}
const sourceFileHashes = Object.fromEntries([...sourceFiles].sort().map((p) => [p, shaFile(p)]));
const styleFileHashes = Object.fromEntries([...styleFiles].sort().map((p) => [p, shaFile(p)]));

const CONFIG_FILES = [
  "package-lock.json", "package.json", "tsconfig.base.json",
  "packages/shared/package.json", "packages/shared/tsconfig.json",
  "packages/server/package.json", "packages/server/tsconfig.json",
  "packages/client/package.json", "packages/client/tsconfig.json",
];
const configPins = Object.fromEntries(CONFIG_FILES.map((p) => [p, { bytes: statSync(repo(p)).size, sha256: shaFile(p) }]));
function walk(dirRel: string): string[] {
  return readdirSync(repo(dirRel), { withFileTypes: true }).flatMap((d: any) => d.isDirectory() ? walk(dirRel + "/" + d.name) : [dirRel + "/" + d.name]);
}
const TOOL_DIR = "tools/trade-public-fixtures";
const toolFiles = walk(TOOL_DIR).filter((p) => !p.includes("/node_modules") && !p.endsWith("README.md")).sort();
const toolPins = Object.fromEntries(toolFiles.map((p) => [p, shaFile(p)]));
const dataPins = Object.fromEntries([
  "tools/trade-fixtures/capture.mts", "parity/trade/runtime.json",
].map((p) => [p, { bytes: statSync(repo(p)).size, sha256: shaFile(p) }]));
const dependencyVersion = (name: string): any => {
  const p = "node_modules/" + name + "/package.json";
  return isFile(p) ? { version: JSON.parse(readFileSync(repo(p), "utf8")).version, packageLockSha256: shaFile("package-lock.json") } : { unavailable: true };
};

function lineOf(rel: string, needle: string, occurrence = 0): any {
  try {
    const lines = readFileSync(repo(rel), "utf8").split("\n");
    const hits: number[] = [];
    lines.forEach((text, i) => { if (text.includes(needle)) hits.push(i + 1); });
    const line = hits[occurrence];
    if (line === undefined) return { path: rel, line: null, needle };
    return { path: rel, line, needle, source: lines[line - 1]!.trim() };
  } catch { return { path: rel, line: null, needle }; }
}
const SOURCE_INVENTORY = {
  humanDoors: [
    lineOf("packages/client/src/scenes/RaidScene.ts", 'new TraderPanel((trader, pick) => sendInput(this.room, "trade", { trader, pick }))'),
    lineOf("packages/client/src/scenes/RaidScene.ts", "this.traderPanel.update("),
    lineOf("packages/client/src/scenes/RaidScene.ts", "this.traderView.update("),
    lineOf("packages/client/src/ui/traderPanel.ts", "constructor(private readonly onTrade: (trader: string, pick: number) => void)"),
    lineOf("packages/client/src/ui/traderPanel.ts", "update(frame: TraderPanelFrame): void"),
    lineOf("packages/client/src/ui/traderPanel.ts", "this.onTrade(trader.id, i)"),
    lineOf("packages/client/src/render/TraderView.ts", "update(frame: TraderViewFrame): void"),
  ],
  roomRegistration: [
    lineOf("packages/server/src/rooms/RaidRoom.ts", "for (const type of CLIENT_MESSAGE_TYPES)"),
    lineOf("packages/server/src/rooms/RaidRoom.ts", "this.onMessage(type, (client: Client, msg: unknown) =>"),
    lineOf("packages/server/src/rooms/RaidRoom.ts", "if (!FREE_MESSAGE_TYPES.has(type) && !this.orderAllowed(client.sessionId)) return;"),
    lineOf("packages/server/src/rooms/RaidRoom.ts", "enqueueClientMessage(rt.inputs, type, msg, { training: this.training })"),
  ],
  intake: [
    lineOf("packages/server/src/sim/inputs.ts", 'case "trade": {'),
    lineOf("packages/server/src/sim/inputs.ts", "export function enqueueClientMessage(q: InputQueue"),
    lineOf("packages/server/src/sim/inputs.ts", "export function parseId(v: unknown)"),
  ],
  actionHandlers: [
    lineOf("packages/server/src/sim/traders.ts", "export const handleTrade"),
    lineOf("packages/server/src/sim/traders.ts", "if (w.state.phase !== \"active\" || p.status !== \"alive\" || !npc || actionBlocked(w, c)) return;"),
    lineOf("packages/server/src/sim/traders.ts", "if (Math.hypot(p.x - npc.x, p.y - npc.y) > TRADER_RANGE"),
    lineOf("packages/server/src/sim/traders.ts", "if (p.tradeUsed) { notify(w, c.id, \"You already made your stat trade this run\"); return; }"),
    lineOf("packages/server/src/sim/traders.ts", "if (w.state.serverTime < readyAt) { notify(w, c.id, \"The villager is packing your last trade\"); return; }"),
    lineOf("packages/server/src/sim/traders.ts", "w.traders?.barterAt.set(c.id, w.state.serverTime + 5000)"),
    lineOf("packages/server/src/sim/traders.ts", "p.tradeOffers.push(JSON.stringify(offer))"),
    lineOf("packages/server/src/sim/traders.ts", "export function spawnTraders"),
  ],
  schemaReceivers: [
    lineOf("packages/shared/src/schema.ts", "export const TraderState = schema({"),
    lineOf("packages/shared/src/schema.ts", "tradeUsed: t.boolean().default(false),"),
    lineOf("packages/shared/src/schema.ts", 'tradeOffers: t.array("string"),'),
    lineOf("packages/shared/src/schema.ts", 'tradeStats: t.map("float64"),'),
    lineOf("packages/shared/src/schema.ts", "traders: t.map(TraderState),"),
    lineOf("packages/shared/src/messages.ts", "trade: { trader: string; pick: number };"),
    lineOf("packages/client/src/ui/traderPanel.ts", "const offers = [0, 1, 2].map(i => parseStatTrade(p.tradeOffers?.at(i) ?? \"\"));"),
    lineOf("packages/client/src/render/TraderView.ts", "export class TraderView"),
  ],
  wording: [
    lineOf("packages/shared/src/traders.ts", "export const TRADE_STAT_NAMES"),
    lineOf("packages/shared/src/traders.ts", "export function parseStatTrade"),
    lineOf("packages/shared/src/traders.ts", "export function barterWeapons"),
    lineOf("packages/shared/src/traders.ts", "export function barterLabels"),
    lineOf("packages/client/src/ui/traderPanel.ts", "Choose one permanent exchange for this run."),
    lineOf("packages/client/src/ui/traderPanel.ts", "Your stat trade is complete for this run."),
    lineOf("packages/client/src/ui/traderPanel.ts", "Trade the weapon in your hand, or exchange a small potion for a weapon."),
  ],
};
for (const group of Object.values(SOURCE_INVENTORY)) for (const row of group as any[]) expectSource(row.line !== null, "source inventory anchor not found: " + row.path + " :: " + row.needle);
expectSource(unresolvedImports.size === 0, "unresolved internal imports: " + [...unresolvedImports].join(", "));

const profileBase: any = {
  format: FORMAT,
  runtime: "Node.js " + process.version + " linux/x64 (pinned container)",
  image: IMAGE,
  imageDigest: IMAGE_DIGEST,
  asserts: { node: "v22.23.4", platform: "linux", arch: "x64" },
  canonicalSerialization: "JSON.stringify(corpus) + \"\\n\"",
  configFiles: configPins,
  sourceClosure: {
    method: "static import/export + dynamic load/import literal graph from the entry list",
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
    phaser: "replaced by tools/trade-public-fixtures/stub-loader.mjs with a declared minimal module; TraderView is called with a declared scene recorder, no real renderer",
    "@colyseus/sdk": "imported by packages/client/src/net/connection.ts; only sendInput's room.send recorder path is exercised",
    "@colyseus/schema": "the actual Encoder/Reflection/getEncodeDescriptor of the installed dependency",
  },
  tool: toolPins,
  reusedOrCited: dataPins,
  sourceInventory: SOURCE_INVENTORY,
  declared: {
    map: "real generateMap(1, 0, {decor:false}); mapHashU32 recorded; no map is installed by hand",
    world: "createGameWorld production module order, quests on, mobs on, signatures off; players added with addPlayer; ordinary 50 ms step()",
    clock: "performance.now() is a declared deterministic clock; no wall-clock value is captured",
    clientDoor: "TraderPanel is the real imported class; the frame values come from the actual RaidState/RaidPlayerState; the DOM is declared fake-dom.mts; no browser, renderer, real mouse or scene is claimed",
    clientPayload: "the scene wiring is re-expressed as (trader, pick) => sendInput(declaredRoom, 'trade', {trader, pick}); sendInput and room.send are the real client function and a declared room recorder",
    positions: "player x/y/status/weapons/potions, the Committed card grant and one forced wall tile are declared and recorded in each case; the handler reads them as the server position",
    events: "all toasts are the real SimEvent objects returned by step()",
    schema: "Colyseus Encoder.BUFFER_SIZE is raised to the server's 64 KiB setting before a full encodeAll; the decoded state is the actual decoder's state",
    traderView: "TraderView.update is called with a declared Phaser-like scene recorder (graphics/text/container) and a declared canSee; method-level only, not a render",
  },
};

function finalize(corpus: any): string {
  corpus.profile = JSON.parse(JSON.stringify(profileBase));
  corpus.profile.captureSha256 = sha256(JSON.stringify(corpus));
  return JSON.stringify(corpus) + "\n";
}

// ===================================================================================================== world harness
const TICK_MS = 50;
const SEED = 1;
const ATTEMPT = 0;
const RANDOM_SEED = 12;
const REWARD_SALT = [1, 2, 3, 4];
const PLAYERS = [
  { faction: "holy", name: "name0" },
  { faction: "fire", name: "name1" },
  { faction: "plague", name: "name2" },
];
const CONFIG = {
  minPlayers: 2, lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
  suddenDeathSeconds: 3600, mobs: true, signatures: false, quests: true, training: false, dummies: false, planSeconds: 0,
  pvpRules: false,
};

function open(): any {
  const map = generateMap(SEED, ATTEMPT, { decor: false });
  let uid = 0;
  const world = createGameWorld({
    seed: SEED, map, config: CONFIG, random: S.mulberry32(RANDOM_SEED), rewardSalt: REWARD_SALT,
    newItemUid: () => "U" + ++uid,
  }, { signatures: false, walkHints: false });
  for (let i = 0; i < PLAYERS.length; i++) addPlayer(world, "p" + i, PLAYERS[i]!.name, { faction: PLAYERS[i]!.faction as any });
  const initEvents = step(world, TICK_MS);
  expectSource(world.state.phase === "active", "raid did not start");
  expectSource(typeof world.actions.trade === "function" && world.actions.trade === handleTrade, "the real handleTrade is not installed");
  expectSource(!!world.traders, "traders runtime missing at raid start");
  expectSource(world.state.traders.size === 2, "expected the real two traders");
  expectSource(world.state.traders.get("trader-barter")?.kind === "barter" && world.state.traders.get("trader-stats")?.kind === "stats", "the two real trader kinds are missing");
  return { world, map, initEvents };
}

function place(world: any, id: string, x: number, y: number): any {
  const p = world.state.players.get(id)!;
  p.x = x; p.y = y; p.facing = 0;
  const rt = world.players.get(id)!;
  rt.history = [{ t: world.state.serverTime, x, y }];
  return { actor: id, x, y };
}
function playerView(world: any, id: string): any {
  const p = world.state.players.get(id)!;
  return {
    id, name: p.name, faction: p.faction, status: p.status, x: p.x, y: p.y,
    weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot, potionSmall: p.potionSmall, hp: p.hp, maxHp: p.maxHp,
    tradeUsed: p.tradeUsed, tradeOffers: p.tradeOffers === undefined ? [] : [...p.tradeOffers], tradeStats: pairs(p.tradeStats),
    mirrors: { asMult: p.asMult, windupMult: p.windupMult, speedMult: p.speedMult, armorBonus: p.armorBonus, shieldBonus: p.shieldBonus, adBonus: p.adBonus, apBonus: p.apBonus },
    effects: p.effects,
  };
}
function traderPublic(world: any): any[] {
  return entriesOf(world.state.traders).map(([id, t]: any) => ({ id, kind: t.kind, x: t.x, y: t.y, name: t.name }))
    .sort((a: any, b: any) => keySorted(a.id, b.id));
}
function barterAt(world: any): any[] {
  return entriesOf(world.traders?.barterAt ?? new Map()).map(([id, at]: any) => [id, at]).sort((a: any, b: any) => keySorted(a[0], b[0]));
}
function offerViews(world: any): any[] {
  return [...world.state.players.get("p0")!.tradeOffers].map((raw: string) => {
    const parsed = S.parseStatTrade(raw);
    return { raw, parsed: parsed ? { cost: parsed.cost, costValue: parsed.costValue, gain: parsed.gain, gainValue: parsed.gainValue, label: parsed.label } : null };
  });
}
function eventsPlain(events: any[]): any[] { return events.map((e) => plain(e)); }
function toastsOf(events: any[]): any[] {
  return events.filter((e: any) => e.type === "toast").map((e: any) => ({ to: e.to, text: e.text }));
}
function worldFacts(world: any, map: any): any {
  return {
    phase: world.state.phase, serverTime: world.state.serverTime, tick: world.state.tick,
    seed: SEED, attempt: ATTEMPT, mapHashU32: mapHashU32(map), map: { w: map.w, h: map.h, decor: false },
    config: CONFIG, players: PLAYERS, random: { seed: RANDOM_SEED, rewardSalt: REWARD_SALT },
    traders: traderPublic(world), barterAt: barterAt(world), destinations: world.traders?.destinations?.length ?? 0,
    playersState: PLAYERS.map((_p, i) => playerView(world, "p" + i)),
  };
}

// ============================================================================================ A. client door (real class)
function makeRoom(): any {
  const sent: any[] = [];
  const room = { send(type: string, payload: any): void { sent.push({ type, payload: plain(payload) }); } };
  return { room, sent };
}
function makePanel(room: any): any {
  return new TraderPanel((trader: string, pick: number) => sendInput(room, "trade", { trader, pick }));
}
function panelRoot(): any {
  const all = ui.byClass("trader-panel");
  return all[all.length - 1]!;
}
function panelView(): any {
  const root = panelRoot();
  const title = root.children.find((c: any) => c.tagName === "H3");
  const description = root.children.find((c: any) => c.tagName === "P");
  return {
    hidden: root.hidden,
    title: title ? title.textContent : null,
    description: description ? description.textContent : null,
    choices: root.byClass("trader-choice").map((b: any) => ({ text: b.textContent, disabled: b.disabled })),
  };
}
function panelFrame(world: any, map: any, canSee = (_t: any) => true): any {
  return { traders: world.state.traders, me: world.state.players.get("p0"), map, serverNow: world.state.serverTime, canSee };
}
function placeAtTrader(world: any, id: string): any {
  const t = world.state.traders.get(id)!;
  return place(world, "p0", t.x, t.y);
}
/** A declared far point on the real map, kept outside every quest giver's reveal radius and every trader's range. */
function safeFarPoint(world: any): any {
  const map = world.map;
  for (let ty = 2; ty < map.h - 2; ty += 2) for (let tx = 2; tx < map.w - 2; tx += 2) {
    const x = tx * S.TILE + S.TILE / 2, y = ty * S.TILE + S.TILE / 2;
    if (!S.circleClear(map, { x, y }, S.PLAYER_RADIUS, S.MASK_MOVE)) continue;
    let ok = true;
    for (const pair of world.quests?.quests ?? []) { const qt = pair[1]; if (Math.hypot(x - qt.s.x, y - qt.s.y) <= 500) { ok = false; break; } }
    if (ok) for (const pair of world.state.traders) { const t = pair[1]; if (Math.hypot(x - t.x, y - t.y) < 200) { ok = false; break; } }
    if (ok) return { x, y };
  }
  return { x: 160, y: 160 };
}
function setWeapon(world: any, slot: 0 | 1, weapon: string): any {
  combatantMod.setSlot(world.state.players.get("p0")!, slot, weapon as any);
  return { slot, weapon };
}

const doorCases: any[] = [];
function doorSetup(traderId: string, setup: any = {}): any {
  const { world, map } = open();
  const trader = world.state.traders.get(traderId)!;
  const stand = placeAtTrader(world, traderId);
  if (setup.weapon0 !== undefined) setWeapon(world, 0, setup.weapon0);
  if (setup.weapon1 !== undefined) setWeapon(world, 1, setup.weapon1);
  if (setup.potionSmall !== undefined) world.state.players.get("p0")!.potionSmall = setup.potionSmall;
  if (setup.committed) grantCard(world, combatant(world, "p0"), "committed");
  if (setup.steps) for (let i = 0; i < setup.steps; i++) step(world, TICK_MS);
  const { room, sent } = makeRoom();
  const panel = makePanel(room);
  panel.update(panelFrame(world, map));
  return { world, map, trader, stand, room, sent, panel };
}

// 1. The broker's actual rolled offers in the real panel; one click sends the exact {trader,pick} payload.
{
  const h = doorSetup("trader-stats", { steps: 1 });
  const view = panelView();
  const offers = offerViews(h.world);
  const buttons = panelRoot().byClass("trader-choice");
  buttons[1]!.click();
  buttons[1]!.click();
  const binding = freshQueue(h.sent[0]?.payload);
  doorCases.push({
    id: "stats-options-and-click",
    declared: { stand: h.stand, dom: "declared fake-dom.mts", frame: "actual RaidState.traders, actual p0 PlayerState, actual map", wiring: "(trader, pick) => sendInput(declaredRoom, 'trade', {trader, pick})" },
    actual: { view, offers, sent: h.sent, binding },
  });
  h.panel.destroy();
}

// 2. The barter panel's three labels and one weapon-trade click.
{
  const h = doorSetup("trader-barter", { weapon0: "sword", potionSmall: 1, steps: 1 });
  const view = panelView();
  panelRoot().byClass("trader-choice")[0]!.click();
  doorCases.push({
    id: "barter-options-and-click",
    declared: { stand: h.stand, setup: "sword in slot 0, potionSmall 1", dom: "declared fake-dom.mts" },
    actual: { view, sent: h.sent, binding: freshQueue(h.sent[0]?.payload) },
  });
  h.panel.destroy();
}

// 3. The panel's own disabled gates for pick 2 (no potion, or both weapon slots full).
{
  const noPotion = doorSetup("trader-barter", { weapon0: "sword", potionSmall: 0 });
  const noPotionView = panelView();
  const noPotionButtons = panelRoot().byClass("trader-choice");
  noPotionButtons[2]!.click();
  const noPotionSent = noPotion.sent;
  noPotion.panel.destroy();
  const both = doorSetup("trader-barter", { weapon0: "sword", weapon1: "bow", potionSmall: 1 });
  const bothView = panelView();
  panelRoot().byClass("trader-choice")[2]!.click();
  const bothSent = both.sent;
  both.panel.destroy();
  doorCases.push({
    id: "pick2-disabled-gates",
    declared: { noPotion: "sword, potion 0", both: "sword+bow, potion 1" },
    actual: { noPotion: { view: noPotionView, sent: noPotionSent }, both: { view: bothView, sent: bothSent } },
  });
}

// 4. After a real stat trade the panel says complete and every choice is disabled.
{
  const h = doorSetup("trader-stats", { steps: 1 });
  enqueueClientMessage(h.world.players.get("p0")!.inputs, "trade", { trader: "trader-stats", pick: 0 });
  step(h.world, TICK_MS);
  h.panel.update(panelFrame(h.world, h.map));
  const view = panelView();
  panelRoot().byClass("trader-choice")[0]!.click();
  doorCases.push({
    id: "stats-used-panel",
    declared: { setup: "one real stat trade already applied through intake/step" },
    actual: { view, sent: h.sent, player: playerView(h.world, "p0") },
  });
  h.panel.destroy();
}

// 5. Committed: the panel offers pick 2 (its gate only sees the potion and empty slot); the server refuses.
{
  const h = doorSetup("trader-barter", { weapon0: "sword", potionSmall: 1, committed: true, steps: 1 });
  const view = panelView();
  panelRoot().byClass("trader-choice")[2]!.click();
  const sent = h.sent;
  const binding = freshQueue(sent[0]?.payload);
  enqueueClientMessage(h.world.players.get("p0")!.inputs, "trade", sent[0]!.payload);
  const events = step(h.world, TICK_MS);
  doorCases.push({
    id: "committed-second-slot",
    declared: { setup: "Committed granted by the real grantCard producer; sword in slot 0; potion 1; slot 1 empty" },
    actual: {
      view, sent, binding, events: eventsPlain(events), toasts: toastsOf(events),
      player: playerView(h.world, "p0"), cooldownAfter: barterAt(h.world),
    },
  });
  h.panel.destroy();
}

// 6. The panel's visibility gates: range, dead, canSee false and a forced-wall LOS.
{
  const far = doorSetup("trader-barter", { weapon0: "sword", potionSmall: 1 });
  place(far.world, "p0", far.trader.x + 1000, far.trader.y);
  far.panel.update(panelFrame(far.world, far.map));
  const farView = panelView();
  far.panel.destroy();
  const dead = doorSetup("trader-barter", { weapon0: "sword", potionSmall: 1 });
  dead.world.state.players.get("p0")!.status = "dead";
  dead.panel.update(panelFrame(dead.world, dead.map));
  const deadView = panelView();
  dead.panel.destroy();
  const hidden = doorSetup("trader-barter", { weapon0: "sword", potionSmall: 1 });
  hidden.panel.update(panelFrame(hidden.world, hidden.map, () => false));
  const hiddenView = panelView();
  hidden.panel.destroy();
  const blocked = doorSetup("trader-barter", { weapon0: "sword", potionSmall: 1 });
  const bt = blocked.trader;
  const tx = Math.floor(bt.x / S.TILE), ty = Math.floor(bt.y / S.TILE);
  const idx = S.tileIndex(blocked.map, tx + 1, ty);
  blocked.map.tiles[idx] = S.TILE_WALL;
  const px = (tx + 2) * S.TILE + S.TILE / 2, py = ty * S.TILE + S.TILE / 2;
  place(blocked.world, "p0", px, py);
  blocked.panel.update(panelFrame(blocked.world, blocked.map));
  const blockedView = panelView();
  const los = S.hasLineOfSight(collisionMap(blocked.world), { x: px, y: py }, { x: bt.x, y: bt.y }, S.MASK_MOVE);
  blocked.panel.destroy();
  doorCases.push({
    id: "panel-visibility-gates",
    declared: { far: "p0 at trader + 1000", dead: "p0.status='dead'", hidden: "canSee returns false", blocked: "one forced wall tile; p0 at trader + 64" },
    actual: { far: farView, dead: deadView, hidden: hiddenView, blocked: blockedView, los, distance: Math.hypot(px - bt.x, py - bt.y), traderRange: S.TRADER_RANGE },
  });
}

// 7. The training room: the trade message parses/queues at the edge, but the trader handler is not installed.
{
  const map = generateMap(SEED, ATTEMPT, { decor: false });
  let uid = 0;
  const training = createGameWorld({
    seed: SEED, map, config: { ...CONFIG, training: true, dummies: true, minPlayers: 1 }, random: S.mulberry32(RANDOM_SEED),
    rewardSalt: REWARD_SALT, newItemUid: () => "T" + ++uid,
  }, { signatures: false, walkHints: false });
  addPlayer(training, "t0", "trainer", { faction: "holy" });
  step(training, TICK_MS);
  const q = new InputQueue();
  const parsedTrade = enqueueClientMessage(q, "trade", { trader: "trader-stats", pick: 0 }, { training: true });
  const queued = q.drain();
  const events = step(training, TICK_MS);
  doorCases.push({
    id: "training-room-edge",
    declared: { config: { ...CONFIG, training: true, dummies: true, minPlayers: 1 }, world: "createGameWorld training" },
    actual: { phase: training.state.phase, traders: training.state.traders.size, tradeHandler: typeof training.actions.trade, parsedTrade, queued: plain(queued.actions), events: eventsPlain(events) },
  });
}

// 8. The real TraderView.update on a declared Phaser-like scene recorder (visible, hidden, dead).
function makeScene(): any {
  const calls: any[] = [];
  const graphics = (): any => {
    const g: any = {
      fillStyle: (...a: any[]) => { calls.push(["graphics.fillStyle", ...a]); return g; },
      fillEllipse: (...a: any[]) => { calls.push(["graphics.fillEllipse", ...a]); return g; },
      fillRoundedRect: (...a: any[]) => { calls.push(["graphics.fillRoundedRect", ...a]); return g; },
      fillCircle: (...a: any[]) => { calls.push(["graphics.fillCircle", ...a]); return g; },
      lineStyle: (...a: any[]) => { calls.push(["graphics.lineStyle", ...a]); return g; },
      lineBetween: (...a: any[]) => { calls.push(["graphics.lineBetween", ...a]); return g; },
    };
    return g;
  };
  const text = (x: number, y: number, content: string, style: any): any => {
    const t: any = {
      x, y, content, style, visible: true,
      setOrigin: () => t, setVisible: (v: boolean) => { t.visible = v; return t; },
      setDepth: () => t, setPosition: (px: number, py: number) => { t.x = px; t.y = py; return t; },
    };
    return t;
  };
  const container = (x: number, y: number, children: any[]): any => {
    const c: any = {
      x, y, children, destroyed: false,
      setPosition: (px: number, py: number) => { c.x = px; c.y = py; return c; },
      setDepth: () => c, destroy: () => { c.destroyed = true; },
    };
    return c;
  };
  return { calls, scene: { add: { graphics, text, container } } };
}
function figureView(view: any): any[] {
  return [...view.figures].map(([id, f]: any) => ({
    id, x: f.root.x, y: f.root.y, children: f.root.children.length, destroyed: !!f.root.destroyed,
    hint: { text: f.hint.content, visible: f.hint.visible, x: f.hint.x, y: f.hint.y },
  })).sort((a: any, b: any) => keySorted(a.id, b.id));
}
{
  const h = doorSetup("trader-barter", { steps: 1 });
  const s = makeScene();
  const tv = new TraderView(s.scene);
  tv.update({ traders: h.world.state.traders, me: h.world.state.players.get("p0"), canSee: () => true });
  const visible = figureView(tv);
  tv.update({ traders: h.world.state.traders, me: h.world.state.players.get("p0"), canSee: () => false });
  const hidden = figureView(tv);
  const s2 = makeScene();
  const dead = new TraderView(s2.scene);
  h.world.state.players.get("p0")!.status = "dead";
  dead.update({ traders: h.world.state.traders, me: h.world.state.players.get("p0"), canSee: () => true });
  const deadView = figureView(dead);
  doorCases.push({
    id: "trader-view-receiver",
    declared: { scene: "declared graphics/text/container recorder; no renderer or pixel output", canSee: "declared true/false" },
    actual: { visible, hidden, dead: deadView, calls: s.calls.length, calls2: s2.calls.length },
  });
  tv.destroy();
  dead.destroy();
}

// ---------------------------------------------------------------------------------------------- intake / parse / queue
function freshQueue(message: any, type = "trade", opts: any = {}): any {
  const q = new InputQueue();
  const returned = enqueueClientMessage(q, type, message, opts);
  const drained = q.drain();
  return { type, message: plain(message), returned, actions: plain(drained.actions), dropped: q.dropped, opts };
}
const intakeCases = [
  { id: "valid-pick0", msg: { trader: "trader-barter", pick: 0 } },
  { id: "valid-pick1", msg: { trader: "trader-stats", pick: 1 } },
  { id: "valid-pick2", msg: { trader: "trader-barter", pick: 2 } },
  { id: "extra-field-ignored", msg: { trader: "trader-barter", pick: 0, extra: true } },
  { id: "unknown-trader-parses", msg: { trader: "no-such-trader", pick: 0 } },
  { id: "malformed-null", msg: null },
  { id: "malformed-empty-object", msg: {} },
  { id: "empty-trader", msg: { trader: "", pick: 0 } },
  { id: "non-string-trader", msg: { trader: 7, pick: 0 } },
  { id: "over-64-trader", msg: { trader: "x".repeat(65), pick: 0 } },
  { id: "string-pick", msg: { trader: "trader-barter", pick: "0" } },
  { id: "fractional-pick", msg: { trader: "trader-barter", pick: 1.5 } },
  { id: "out-of-range-neg", msg: { trader: "trader-barter", pick: -1 } },
  { id: "out-of-range-three", msg: { trader: "trader-barter", pick: 3 } },
  { id: "unknown-message-type", type: "tradee", msg: { trader: "trader-barter", pick: 0 } },
  { id: "training-option", msg: { trader: "trader-barter", pick: 0 }, opts: { training: true } },
].map((c: any) => ({ id: c.id, ...freshQueue(c.msg, c.type ?? "trade", c.opts ?? {}) }));
{
  const q = new InputQueue();
  const returns: boolean[] = [];
  for (let i = 0; i < 8; i++) returns.push(enqueueClientMessage(q, "trade", { trader: "trader-barter", pick: 0 }));
  const drained = q.drain();
  intakeCases.push({ id: "per-tick-queue-cap", message: { trader: "trader-barter", pick: 0 }, returns, actions: plain(drained.actions), dropped: q.dropped, note: "MAX_ACTIONS_PER_TICK = 6" });
}
const intakeCorpus = {
  format: FORMAT,
  role: "A2. the real enqueueClientMessage inline trade parser and InputQueue table; no Room, socket or session is constructed",
  methodRig: "The generic RaidRoom registration is source-anchored (sourceInventory.roomRegistration): the Room instance, its onMessage loop, liveness and order budget are not executed. What is executed is the exact function RaidRoom calls: enqueueClientMessage(rt.inputs, type, msg, { training: this.training }).",
  cases: intakeCases,
  parseSource: "The trade branch is inline in inputs.ts: parseId(msg.trader) and an integer pick 0..2; a trade naming an unknown trader still parses and is refused/ignored later by handleTrade.",
};

// --------------------------------------------------------------------------------------------- action cases (real steps)
function actionHarness(id: string): any {
  const { world, map } = open();
  const declared: any[] = [];
  const allEvents: any[] = [];
  const api: any = {
    id, world, map, declared, allEvents,
    place(actor: string, x: number, y: number): any { const note = place(world, actor, x, y); declared.push({ kind: "place", ...note }); return note; },
    atTrader(traderId: string): any { const note = placeAtTrader(world, traderId); declared.push({ kind: "place-at-trader", trader: traderId, ...note }); return note; },
    setWeapon(slot: 0 | 1, weapon: string): any { const note = setWeapon(world, slot, weapon); declared.push({ kind: "weapon", ...note }); return note; },
    potion(n: number): any { world.state.players.get("p0")!.potionSmall = n; declared.push({ kind: "potion", small: n }); return { small: n }; },
    committed(): any {
      const count = grantCard(world, combatant(world, "p0"), "committed");
      declared.push({ kind: "grantCard", id: "committed", returned: count });
      return count;
    },
    message(actor: string, payload: any, type = "trade"): any {
      const ok = enqueueClientMessage(world.players.get(actor)!.inputs, type, payload);
      return { actor, type, payload: plain(payload), enqueued: ok };
    },
    runSteps(n: number): any[] { const out: any[] = []; for (let i = 0; i < n; i++) { const e = step(world, TICK_MS); allEvents.push(...e); out.push(...e); } return out; },
    snapshot(label: string): any {
      return {
        label, tick: world.state.tick, serverTime: world.state.serverTime, phase: world.state.phase,
        traders: traderPublic(world), barterAt: barterAt(world), players: PLAYERS.map((_p, i) => playerView(world, "p" + i)),
      };
    },
    record(extra: any): any {
      return {
        id,
        declared: api.declared,
        actual: { events: eventsPlain(api.allEvents), toasts: toastsOf(api.allEvents), ...extra, final: api.snapshot("final") },
      };
    },
  };
  return api;
}

const actionCases: any[] = [];

// 1. First contact rolls the broker's three offers; no expected offer is installed.
{
  const h = actionHarness("stat-offer-roll");
  h.atTrader("trader-stats");
  h.runSteps(1);
  actionCases.push(h.record({ offers: offerViews(h.world), offeredBeforeContact: false, player: playerView(h.world, "p0") }));
}

// 2. One legal stat trade: cost/gain, tradeUsed, the fold/max-hp consequences, and the private toast.
{
  const h = actionHarness("stat-trade");
  h.atTrader("trader-stats");
  h.runSteps(1);
  const message = h.message("p0", { trader: "trader-stats", pick: 0 });
  h.runSteps(1);
  actionCases.push(h.record({ message, offers: offerViews(h.world), player: playerView(h.world, "p0") }));
}

// 3. A second stat trade is refused as used.
{
  const h = actionHarness("stat-repeat");
  h.atTrader("trader-stats");
  h.runSteps(1);
  h.message("p0", { trader: "trader-stats", pick: 0 });
  h.runSteps(1);
  const message = h.message("p0", { trader: "trader-stats", pick: 1 });
  h.runSteps(1);
  actionCases.push(h.record({ message, player: playerView(h.world, "p0") }));
}

// 4. Actions run before systems: a pick in the same tick as first contact sees no offers yet.
{
  const h = actionHarness("stat-no-offers-yet");
  h.atTrader("trader-stats");
  const message = h.message("p0", { trader: "trader-stats", pick: 0 });
  const firstEvents = h.runSteps(1);
  const offersAfterFirstStep = offerViews(h.world);
  const secondEvents = h.runSteps(1);
  actionCases.push(h.record({ message, firstEvents: eventsPlain(firstEvents), offersAfterFirstStep, secondEvents: eventsPlain(secondEvents), player: playerView(h.world, "p0") }));
}

// 5. The barter cycle: weapon -> cycle weapon, cooldown refusal, weapon -> potion, potion -> second weapon.
{
  const h = actionHarness("barter-cycle");
  h.atTrader("trader-barter");
  h.setWeapon(0, "sword");
  h.potion(1);
  h.runSteps(1);
  const first = h.message("p0", { trader: "trader-barter", pick: 0 });
  h.runSteps(1);
  const immediate = h.message("p0", { trader: "trader-barter", pick: 0 });
  h.runSteps(1);
  h.runSteps(100);
  const second = h.message("p0", { trader: "trader-barter", pick: 1 });
  h.runSteps(1);
  h.runSteps(100);
  const third = h.message("p0", { trader: "trader-barter", pick: 2 });
  h.runSteps(1);
  actionCases.push(h.record({ first, immediate, second, third, player: playerView(h.world, "p0") }));
}

// 6. Barter refusals: no weapon, full pouch, no potion, both slots full, Committed second slot.
{
  const noWeapon = actionHarness("barter-no-weapon");
  noWeapon.atTrader("trader-barter");
  noWeapon.runSteps(1);
  const noWeaponMessage = noWeapon.message("p0", { trader: "trader-barter", pick: 0 });
  noWeapon.runSteps(1);
  actionCases.push(noWeapon.record({ message: noWeaponMessage, player: playerView(noWeapon.world, "p0") }));
}
{
  const full = actionHarness("barter-full-pouch");
  full.atTrader("trader-barter");
  full.setWeapon(0, "sword");
  full.potion(5);
  full.runSteps(1);
  const message = full.message("p0", { trader: "trader-barter", pick: 1 });
  full.runSteps(1);
  actionCases.push(full.record({ message, player: playerView(full.world, "p0") }));
}
{
  const noPotion = actionHarness("barter-no-potion");
  noPotion.atTrader("trader-barter");
  noPotion.setWeapon(0, "sword");
  noPotion.potion(0);
  noPotion.runSteps(1);
  const message = noPotion.message("p0", { trader: "trader-barter", pick: 2 });
  noPotion.runSteps(1);
  actionCases.push(noPotion.record({ message, player: playerView(noPotion.world, "p0") }));
}
{
  const both = actionHarness("barter-both-slots");
  both.atTrader("trader-barter");
  both.setWeapon(0, "sword");
  both.setWeapon(1, "bow");
  both.potion(1);
  both.runSteps(1);
  const message = both.message("p0", { trader: "trader-barter", pick: 2 });
  both.runSteps(1);
  actionCases.push(both.record({ message, player: playerView(both.world, "p0") }));
}
{
  const committed = actionHarness("barter-committed");
  committed.atTrader("trader-barter");
  committed.setWeapon(0, "sword");
  committed.potion(1);
  committed.committed();
  committed.runSteps(1);
  const message = committed.message("p0", { trader: "trader-barter", pick: 2 });
  committed.runSteps(1);
  actionCases.push(committed.record({ message, player: playerView(committed.world, "p0"), cooldownAfter: barterAt(committed.world) }));
}

// 7. Range, LOS, dead, unknown trader and busy: the source order's silent/answering branches.
{
  const h = actionHarness("range-refusal");
  const bt = h.world.state.traders.get("trader-barter")!;
  const far = safeFarPoint(h.world);
  h.place("p0", far.x, far.y);
  h.declared.push({ kind: "safe-far-point", why: "outside every quest giver reveal radius and every trader range", point: far });
  const message = h.message("p0", { trader: "trader-barter", pick: 0 });
  h.runSteps(1);
  actionCases.push(h.record({ message, distance: Math.hypot(far.x - bt.x, far.y - bt.y), traderRange: S.TRADER_RANGE }));
}
{
  const h = actionHarness("los-refusal");
  const bt = h.world.state.traders.get("trader-barter")!;
  const tx = Math.floor(bt.x / S.TILE), ty = Math.floor(bt.y / S.TILE);
  const idx = S.tileIndex(h.map, tx + 1, ty);
  h.map.tiles[idx] = S.TILE_WALL;
  const px = (tx + 2) * S.TILE + S.TILE / 2, py = ty * S.TILE + S.TILE / 2;
  h.place("p0", px, py);
  h.declared.push({ kind: "forced-wall", tile: { tx: tx + 1, ty }, index: idx, to: S.TILE_WALL, why: "one-tile declared wall for the LOS probe only" });
  const los = S.hasLineOfSight(collisionMap(h.world), { x: px, y: py }, { x: bt.x, y: bt.y }, S.MASK_MOVE);
  const message = h.message("p0", { trader: "trader-barter", pick: 0 });
  h.runSteps(1);
  actionCases.push(h.record({ message, los, distance: Math.hypot(px - bt.x, py - bt.y), traderRange: S.TRADER_RANGE }));
}
{
  const h = actionHarness("dead-silent");
  h.atTrader("trader-barter");
  h.world.state.players.get("p0")!.status = "dead";
  h.declared.push({ kind: "status", actor: "p0", to: "dead" });
  const message = h.message("p0", { trader: "trader-barter", pick: 0 });
  const events = h.runSteps(1);
  actionCases.push(h.record({ message, eventsThisStep: eventsPlain(events), queueAfter: h.world.players.get("p0")!.inputs.actions.length }));
}
{
  const h = actionHarness("unknown-trader-silent");
  const message = h.message("p0", { trader: "no-such-trader", pick: 0 });
  h.runSteps(1);
  actionCases.push(h.record({ message }));
}
{
  const h = actionHarness("stunned-silent");
  h.atTrader("trader-barter");
  addStatus(h.world, combatant(h.world, "p0"), { kind: "stun", source: { id: "" }, ms: 1000 }, { quiet: true });
  h.declared.push({ kind: "status", actor: "p0", status: "stun" });
  const message = h.message("p0", { trader: "trader-barter", pick: 0 });
  const events = h.runSteps(1);
  actionCases.push(h.record({ message, eventsThisStep: eventsPlain(events), effects: h.world.state.players.get("p0")!.effects }));
}

// 8. Order probe: the barter cooldown is checked before the held-weapon branch.
{
  const h = actionHarness("order-cooldown-before-held");
  h.atTrader("trader-barter");
  h.setWeapon(0, "sword");
  h.potion(1);
  h.runSteps(1);
  h.message("p0", { trader: "trader-barter", pick: 0 });
  h.runSteps(1);
  h.setWeapon(0, "");
  const message = h.message("p0", { trader: "trader-barter", pick: 0 });
  h.runSteps(1);
  actionCases.push(h.record({ message, expectedOrder: "the barter cooldown is checked before the held-weapon branch" }));
}

// 9. Declared phase "ended": step() does not drain inputs outside active.
{
  const h = actionHarness("phase-ended-not-drained");
  h.atTrader("trader-barter");
  h.world.state.phase = "ended";
  h.declared.push({ kind: "phase", to: "ended" });
  const message = h.message("p0", { trader: "trader-barter", pick: 0 });
  const events = h.runSteps(1);
  actionCases.push(h.record({ message, eventsThisStep: eventsPlain(events), queueAfter: h.world.players.get("p0")!.inputs.actions.length, handlerRan: "source-anchored phase guard; step() never invokes actions outside active" }));
}

// ===================================================================================================== corpora
function makeCodec(world: any): any {
  schemaLib.Encoder.BUFFER_SIZE = 64 * 1024;
  const encoder = new schemaLib.Encoder(world.state);
  const decoder = schemaLib.Reflection.decode(schemaLib.Reflection.encode(encoder));
  const capture = (): any => {
    const bytes = encoder.encodeAll();
    decoder.decode(bytes);
    const st = decoder.state;
    const playersDecoded = entriesOf(st.players).map(([id, p]: any) => ({
      id, name: p.name, status: p.status, x: p.x, y: p.y, weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot,
      potionSmall: p.potionSmall, tradeUsed: p.tradeUsed, tradeOffers: p.tradeOffers === undefined ? [] : [...p.tradeOffers], tradeStats: pairs(p.tradeStats),
    })).sort((a: any, b: any) => keySorted(a.id, b.id));
    const tradersDecoded = entriesOf(st.traders).map(([id, t]: any) => ({ id, kind: t.kind, x: t.x, y: t.y, name: t.name }))
      .sort((a: any, b: any) => keySorted(a.id, b.id));
    return {
      bytes: bytes.length,
      sha256: sha256(Buffer.from(bytes)),
      decoded: { phase: st.phase, serverTime: st.serverTime, traders: tradersDecoded, players: playersDecoded },
    };
  };
  return { capture };
}

async function buildSchemaReceiverCorpus(): Promise<any> {
  const { world, map } = open();
  placeAtTrader(world, "trader-stats");
  step(world, TICK_MS);
  const codec = makeCodec(world);
  const preTrade = codec.capture();
  const offersBeforeTrade = offerViews(world);
  enqueueClientMessage(world.players.get("p0")!.inputs, "trade", { trader: "trader-stats", pick: 0 });
  const statEvents = step(world, TICK_MS);
  const postTrade = codec.capture();
  const offersAfterTrade = offerViews(world);
  // A real barter trade leaves the owner-private cooldown in the runtime map only.
  placeAtTrader(world, "trader-barter");
  combatantMod.setSlot(world.state.players.get("p0")!, 0, "sword");
  world.state.players.get("p0")!.potionSmall = 1;
  step(world, TICK_MS);
  enqueueClientMessage(world.players.get("p0")!.inputs, "trade", { trader: "trader-barter", pick: 0 });
  const barterEvents = step(world, TICK_MS);
  const cooldown = barterAt(world);
  const cooldownRound = codec.capture();

  const traderFields = Object.values(getEncodeDescriptor(new schemaMod.TraderState()).metadata).map((f: any) => ({ name: f.name, type: f.type, index: f.index, noSync: !!f.noSync }));
  const playerFields = Object.values(getEncodeDescriptor(new schemaMod.PlayerState()).metadata)
    .filter((f: any) => /^(name|status|x|y|weapon0|weapon1|slot|potionSmall|tradeUsed|tradeOffers|tradeStats)$/.test(f.name))
    .map((f: any) => ({ name: f.name, type: f.type, index: f.index, noSync: !!f.noSync }));
  const raidFields = Object.values(getEncodeDescriptor(new schemaMod.RaidState()).metadata)
    .filter((f: any) => /^(traders)$/.test(f.name))
    .map((f: any) => ({ name: f.name, type: f.type, index: f.index, noSync: !!f.noSync }));

  // The real TraderPanel receiver over the actual post-trade player state.
  const { room, sent } = makeRoom();
  const panel = makePanel(room);
  panel.update(panelFrame(world, map));
  const panelActual = panelView();
  panel.destroy();

  return {
    format: FORMAT,
    role: "B. actual schema metadata and Colyseus encode/decode shapes; the trader actor vs owner offer/cooldown boundary; the real TraderPanel/TraderView/model receivers",
    world: worldFacts(world, map),
    schema: {
      encoderBufferBytes: 64 * 1024,
      encodeCall: "new Encoder(state); Reflection.encode(encoder); decoder.decode(encoder.encodeAll())",
      kinds: [
        { name: "TraderState", fields: traderFields },
        { name: "PlayerState (selected trade/body fields)", fields: playerFields, totalFieldCount: Object.keys(getEncodeDescriptor(new schemaMod.PlayerState()).metadata).length },
        { name: "RaidState (trader container)", fields: raidFields },
      ],
      rounds: [
        { label: "after-offer-roll-before-trade", ...preTrade },
        { label: "after-stat-trade", ...postTrade },
        { label: "after-barter-trade", ...cooldownRound },
      ],
    },
    disclosure: {
      matrix: [
        {
          id: "trader-actor-public",
          fields: traderFields,
          actual: { decoded: postTrade.decoded.traders, source: traderPublic(world) },
          source: "TraderState is id/kind/x/y/name; no offer, deadline or owner field is on it",
          classification: "PUBLIC ACTOR (no offer on the actor)",
        },
        {
          id: "owner-barter-cooldown",
          ownerPrivate: "world.traders.barterAt is a plain runtime Map<string, number>",
          actual: { cooldown, decodedPlayersWithDeadline: postTrade.decoded.players.map((p: any) => ({ id: p.id, hasDeadlineField: "barterAt" in p })), barterEvents: eventsPlain(barterEvents) },
          source: "sim/traders.ts keeps barterAt in TradersRuntime, never in TraderState/PlayerState",
          classification: "OWNER-PRIVATE (source-preserved; not synced)",
        },
        {
          id: "player-trade-offers",
          fields: playerFields.filter((f: any) => /^trade/.test(f.name)),
          actual: {
            offersBeforeTrade, offersAfterTrade,
            decodedP0: postTrade.decoded.players.find((p: any) => p.id === "p0") ?? null,
            decodedP1: postTrade.decoded.players.find((p: any) => p.id === "p1") ?? null,
            statEvents: eventsPlain(statEvents),
          },
          source: "PlayerState.tradeOffers/tradeStats/tradeUsed are ordinary synced fields on the shared RaidState; the panel reads frame.me but the wire carries every player's rows",
          classification: "SOURCE FINDING: public-field disclosure. Each client's decoded state can read p0's rolled stat offers (cost/gain/values/label), tradeUsed and applied stat deltas. Recorded as the source's actual shape, not sanitized into owner-private behaviour.",
        },
      ],
    },
    receivers: {
      cases: [
        {
          id: "trader-panel-post-trade",
          panel: panelActual,
          sent,
          player: playerView(world, "p0"),
          parsedOffers: offersAfterTrade,
        },
        {
          id: "schema-decoded-player-rows",
          players: postTrade.decoded.players,
          note: "The decoded rows are the actual decoder's state; no per-client filter exists in the source state schema.",
        },
      ],
      methodLimits: "TraderPanel is the real imported class on the declared fake DOM; TraderView is the real imported class on a declared scene recorder. No browser, renderer, socket or real input is claimed.",
    },
  };
}

async function buildWordingCorpus(cases: any[], doors: any[]): Promise<any> {
  const { world, map } = open();
  placeAtTrader(world, "trader-stats");
  step(world, TICK_MS);
  const offers = offerViews(world);
  const { room } = makeRoom();
  const panel = makePanel(room);
  panel.update(panelFrame(world, map));
  const statsView = panelView();
  panel.destroy();
  // A barter panel with a real held sword supplies the actual barter labels.
  const { world: barterWorld, map: barterMap } = open();
  placeAtTrader(barterWorld, "trader-barter");
  combatantMod.setSlot(barterWorld.state.players.get("p0")!, 0, "sword");
  barterWorld.state.players.get("p0")!.potionSmall = 1;
  step(barterWorld, TICK_MS);
  const { room: barterRoom } = makeRoom();
  const barterPanel = makePanel(barterRoom);
  barterPanel.update(panelFrame(barterWorld, barterMap));
  const barterView = panelView();
  barterPanel.destroy();

  const runtimeToasts = [
    ...cases.flatMap((c: any) => (c.actual?.toasts ?? []).map((t: any) => ({ case: c.id, to: t.to, text: t.text }))),
    ...doors.flatMap((c: any) => (c.actual?.toasts ?? []).map((t: any) => ({ case: c.id, to: t.to, text: t.text }))),
  ];
  const byText = (text: string): any[] => runtimeToasts.filter((t: any) => t.text === text);
  const sourceStrings = [
    "Move closer to the trader",
    "You already made your stat trade this run",
    "Wait for the trader's offers",
    "The villager is packing your last trade",
    "Bring a small healing potion",
    "You already hold that weapon",
    "Make an empty weapon slot first",
    "Hold a weapon to trade",
    "Your small potion pouch is full",
  ];
  const tradeStatNames = plain(S.TRADE_STAT_NAMES);
  const barterLabels = {
    sword: [...S.barterLabels("sword")],
    bow: [...S.barterLabels("bow")],
    wand: [...S.barterLabels("wand")],
    empty: [...S.barterLabels("")],
  };
  return {
    format: FORMAT,
    role: "C. actual shared trade label declarations, the panel's real rendered wording, and the real handler toast text/recipients",
    strings: [
      ...Object.entries(tradeStatNames).map(([key, value]: any) => ({ id: "trade-stat-name-" + key, kind: "helper declaration", source: "packages/shared/src/traders.ts TRADE_STAT_NAMES", value, runtime: [] })),
      { id: "barter-labels-sword", kind: "helper declaration", source: "packages/shared/src/traders.ts barterLabels('sword')", value: barterLabels.sword, runtime: [] },
      { id: "barter-labels-bow", kind: "helper declaration", source: "packages/shared/src/traders.ts barterLabels('bow')", value: barterLabels.bow, runtime: [] },
      { id: "barter-labels-wand", kind: "helper declaration", source: "packages/shared/src/traders.ts barterLabels('wand')", value: barterLabels.wand, runtime: [] },
      { id: "barter-labels-empty", kind: "helper declaration", source: "packages/shared/src/traders.ts barterLabels('')", value: barterLabels.empty, runtime: [] },
      { id: "panel-stats-title", kind: "actual panel render", source: "TraderPanel.update title", value: statsView.title, runtime: [] },
      { id: "panel-stats-description", kind: "actual panel render", source: "TraderPanel.update description", value: statsView.description, runtime: [] },
      { id: "panel-stats-choices", kind: "actual panel render", source: "TraderPanel.update choices (server-written offer labels)", value: statsView.choices.map((c: any) => c.text), runtime: [] },
      { id: "panel-barter-title", kind: "actual panel render", source: "TraderPanel.update title", value: barterView.title, runtime: [] },
      { id: "panel-barter-description", kind: "actual panel render", source: "TraderPanel.update description", value: barterView.description, runtime: [] },
      { id: "panel-barter-choices", kind: "actual panel render", source: "TraderPanel.update choices (barterLabels helper)", value: barterView.choices.map((c: any) => c.text), runtime: [] },
      { id: "offer-labels", kind: "actual source-written labels", source: "rollStatTrades -> tradeOffers", value: offers.map((o: any) => o.parsed?.label ?? null), runtime: [] },
      ...sourceStrings.map((text) => ({ id: "runtime-string:" + text, kind: "inline handler source string", source: "packages/server/src/sim/traders.ts handleTrade", value: text, runtime: byText(text) })),
      { id: "stat-trade-toast-prefix", kind: "inline handler source prefix", source: "packages/server/src/sim/traders.ts handleTrade notify", value: "Stat trade: ", runtime: runtimeToasts.filter((t: any) => t.text.startsWith("Stat trade: ")) },
      { id: "traded-potion-toast", kind: "inline handler source string", source: "packages/server/src/sim/traders.ts handleTrade notify", value: "Traded weapon for a small healing potion", runtime: byText("Traded weapon for a small healing potion") },
      { id: "traded-weapon-toast-prefix", kind: "inline handler source prefix", source: "packages/server/src/sim/traders.ts handleTrade notify", value: "Traded for ", runtime: runtimeToasts.filter((t: any) => t.text.startsWith("Traded for ")) },
      { id: "potion-stored-toast-prefix", kind: "actual consumable-grant toast", source: "packages/server/src/sim/consumables.ts grantConsumable", value: "Small potion stored", runtime: runtimeToasts.filter((t: any) => t.text.startsWith("Small potion stored")) },
    ],
    helpers: { tradeStatNames, barterLabels, traderRange: S.TRADER_RANGE, traderSpeed: S.TRADER_SPEED, traderStopMs: S.TRADER_STOP_MS, offers },
    panelStates: { statsView, barterView },
    runtimeToasts,
    helperVsRuntime: {
      rule: "barterLabels and TRADE_STAT_NAMES are helper declarations used by the panel; the handler's refusal/success strings are inline source strings recorded here only by their actual toast events. A helper string is not counted as a runtime confirmation unless a matching recipient/text row exists.",
      sourceStrings: sourceStrings.map((text) => ({ text, runtime: byText(text), source: lineOf("packages/server/src/sim/traders.ts", text) })),
    },
  };
}

const factsWorld = open();
const doorsCorpus: any = {
  format: FORMAT,
  role: "A. the real human trade door (TraderPanel + sendInput recorder), the real intake/parse/queue, and the real handleTrade through ordinary 50 ms steps",
  world: worldFacts(factsWorld.world, factsWorld.map),
  clientDoor: {
    class: "packages/client/src/ui/traderPanel.ts TraderPanel (real imported class)",
    wiring: "new TraderPanel((trader, pick) => sendInput(declaredRoom, 'trade', { trader, pick }))",
    fixture: "declared fake-dom.mts (elements, disabled buttons, bubbling click); no browser/renderer",
    cases: doorCases,
  },
  intake: intakeCorpus,
  actions: {
    harness: "createGameWorld (production module order, quests on, map seed 1 attempt 0, random mulberry32(12), reward salt [1,2,3,4]); addPlayer p0..p2; one 50 ms step to active; then ordinary enqueueClientMessage + step(50)",
    cases: actionCases,
  },
  methodLimits: [
    "No socket, Colyseus Room instance, session, liveness tracker, order budget or real client is constructed; the generic RaidRoom registration and its guards are source-anchored in sourceInventory.roomRegistration.",
    "No browser DOM, renderer, CSS layout, real mouse or real keyboard: the declared fake-dom.mts supplies elements and synthetic clicks; TraderPanel's own code is unchanged.",
    "TraderView is called with a declared Phaser-like scene recorder; it is a method-level receiver witness, not a rendered scene or pixel proof.",
    "The action cases set positions/status/weapons/potions/card/one wall tile by declaration (recorded per case); the sim's step/input/action/event code is actual.",
  ],
};
const schemaReceiverCorpus: any = await buildSchemaReceiverCorpus();
const wordingCorpus: any = await buildWordingCorpus(actionCases, doorCases);

const corpora: Record<string, any> = {
  "doors.json": doorsCorpus,
  "schema-receivers.json": schemaReceiverCorpus,
  "wording.json": wordingCorpus,
};
const bytes: Record<string, string> = {};
for (const name of OUTPUTS) bytes[name] = finalize(corpora[name]!);
const manifest: any = {
  format: FORMAT,
  image: IMAGE,
  canonicalSerialization: 'JSON.stringify(corpus) + "\\n"',
  files: OUTPUTS.map((name) => {
    const corpus = corpora[name];
    return {
      file: name, bytes: Buffer.byteLength(bytes[name]!, "utf8"), sha256: sha256(bytes[name]!),
      captureSha256: corpus.profile.captureSha256,
      counts: name === "doors.json" ? { clientDoorCases: corpus.clientDoor.cases.length, intakeCases: corpus.intake.cases.length, actionCases: corpus.actions.cases.length }
        : name === "schema-receivers.json" ? { schemaKinds: corpus.schema?.kinds?.length ?? 0, disclosureRows: corpus.disclosure?.matrix?.length ?? 0, receiverCases: corpus.receivers?.cases?.length ?? 0 }
        : { strings: corpus.strings?.length ?? 0, runtimeToasts: corpus.runtimeToasts?.length ?? 0 },
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
expectSource(sourceIssues.length === 0, "source assertions failed: " + sourceIssues.join("; "));
console.log(JSON.stringify({
  mode,
  files: Object.fromEntries(OUTPUTS.map((n) => [n, { bytes: Buffer.byteLength(bytes[n]!, "utf8"), sha256: sha256(bytes[n]!), captureSha256: corpora[n]!.profile.captureSha256 }])),
  clientDoorCases: doorCases.length,
  intakeCases: intakeCases.length,
  actionCases: actionCases.length,
  sourceFiles: Object.keys(sourceFileHashes).length,
  issues: sourceIssues,
}));
