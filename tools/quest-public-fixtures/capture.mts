/**
 * P-QUEST-TRADE-PUBLIC-WITNESSES — quest family canonical actual-source capture.
 *
 * Every recorded value is returned by the unchanged legacy TypeScript this witness imports:
 *   A doors.json             the real QuestDialog (constructor/open/update/accept/noteToast/key path) with the scene's real
 *                            sendInput(room,"questAccept",msg) wiring, on a declared minimal DOM; the real enqueueClientMessage
 *                            parse/queue table; the real handleQuestAccept through ordinary 50 ms steps.
 *   B schema-receivers.json  the real QuestState/TraderState/PlayerState/RaidState schema metadata and a real Colyseus
 *                            Encoder/Reflection decode round trip; the actual public-vs-private boundary; questFromReveal,
 *                            questCollections and questRows over actual state and the actual private reveal message.
 *   C wording.json           the actual shared refusal/accept strings, the dialog's real rendered wording, and the real
 *                            toast text/recipients emitted by the action cases, with helper declarations kept distinct.
 *
 * Declared: the DOM stub, the player positions/status/weapon setup, the one forced wall tile used only by the LOS probes,
 * the end-phase nudge, and the client frame wrapper. Actual: every method/function return value, every queued command,
 * every emitted event/toast and every schema byte. No production source is modified; nothing here is a real browser,
 * DOM, keyboard, socket/Room session or Unity claim.
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
const FORMAT = "rh-quest-public-witness/1";
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
const RECORD_MODE = process.env.RH_QUEST_PUBLIC_RECORD === "1";
/** Canonical captures assert structural invariants; mutant captures record them instead (the comparator is the check). */
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

/** A declared deterministic clock: no wall-clock value enters a corpus. */
let clockNow = 10000;
Object.defineProperty(globalThis, "performance", { value: { now: () => clockNow }, configurable: true });

/** Install the declared DOM before importing the real client modules (they read document/window at construction). */
const dom = installFakeDom();
const { doc, win, ui } = dom;

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
const questsMod = await load("packages/server/src/sim/quests.ts");
const tradersMod = await load("packages/server/src/sim/traders.ts");
const repoRequire = createRequire(join(repoRoot, "package.json"));
const schemaLib = await import(pathToFileURL(repoRequire.resolve("@colyseus/schema")).href);
const settingsMod = await load("packages/client/src/settings.ts");
const connectionMod = await load("packages/client/src/net/connection.ts");
const questDialogMod = await load("packages/client/src/ui/questDialog.ts");
const questMathMod = await load("packages/client/src/ui/questDialogMath.ts");
const questModelMod = await load("packages/client/src/ui/questModel.ts");

const { QuestDialog } = questDialogMod;
const { sendInput } = connectionMod;
const { InputQueue, enqueueClientMessage } = inputsMod;
const { addPlayer, step } = stepMod;
const { createGameWorld } = gameplay;
const { generateMap } = mapgen;
const { mapHashU32 } = mapWire;
const { addStatus } = statusMod;
const { combatant } = combatantMod;
const { collisionMap } = worldMod;
const { handleQuestAccept } = questsMod;
const { handleTrade } = tradersMod;
const { Encoder, Reflection, getEncodeDescriptor } = schemaLib;

// ---------------------------------------------------------------------------------------------- internal source closure
const ENTRY_SOURCES = [
  "tools/quest-public-fixtures/capture.mts",
  "tools/quest-public-fixtures/fake-dom.mts",
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
  "packages/server/src/sim/quests.ts",
  "packages/server/src/sim/traders.ts",
  "packages/client/src/settings.ts",
  "packages/client/src/net/connection.ts",
  "packages/client/src/ui/questDialog.ts",
  "packages/client/src/ui/questDialogMath.ts",
  "packages/client/src/ui/questModel.ts",
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
const TOOL_DIR = "tools/quest-public-fixtures";
const toolFiles = walk(TOOL_DIR).filter((p) => !p.includes("/node_modules") && !p.endsWith("README.md")).sort();
const toolPins = Object.fromEntries(toolFiles.map((p) => [p, shaFile(p)]));
const dataPins = Object.fromEntries([
  "tools/quest-fixtures/capture.mts", "tools/quest-fixtures/lifecycle.mts",
  "parity/quests/data.json", "parity/quests/lifecycle.json",
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
    lineOf("packages/client/src/scenes/RaidScene.ts", 'send: (msg) => sendInput(this.room, "questAccept", msg)'),
    lineOf("packages/client/src/scenes/RaidScene.ts", 'new TraderPanel((trader, pick) => sendInput(this.room, "trade", { trader, pick }))'),
    lineOf("packages/client/src/scenes/RaidScene.ts", 'this.room.onMessage("questReveal"'),
    lineOf("packages/client/src/scenes/RaidScene.ts", 'this.traderPanel.update('),
    lineOf("packages/client/src/ui/questDialog.ts", "open(questId: string): boolean"),
    lineOf("packages/client/src/ui/questDialog.ts", "accept(): boolean"),
    lineOf("packages/client/src/ui/questDialog.ts", "noteToast(text: string): boolean"),
    lineOf("packages/client/src/ui/traderPanel.ts", "update(frame: TraderPanelFrame): void"),
    lineOf("packages/client/src/ui/traderPanel.ts", "this.onTrade(trader.id, i)"),
  ],
  roomRegistration: [
    lineOf("packages/server/src/rooms/RaidRoom.ts", "for (const type of CLIENT_MESSAGE_TYPES)"),
    lineOf("packages/server/src/rooms/RaidRoom.ts", "this.onMessage(type, (client: Client, msg: unknown) =>"),
    lineOf("packages/server/src/rooms/RaidRoom.ts", "if (!FREE_MESSAGE_TYPES.has(type) && !this.orderAllowed(client.sessionId)) return;"),
    lineOf("packages/server/src/rooms/RaidRoom.ts", "enqueueClientMessage(rt.inputs, type, msg, { training: this.training })"),
    lineOf("packages/server/src/rooms/RaidRoom.ts", 'this.sendTo(ev.to, "questReveal", ev.quest)'),
    lineOf("packages/server/src/rooms/RaidRoom.ts", "this.onMessage(TELEMETRY_PERF_MESSAGE"),
  ],
  intake: [
    lineOf("packages/server/src/sim/inputs.ts", "export function parseQuestAccept(msg: unknown)"),
    lineOf("packages/server/src/sim/inputs.ts", 'case "trade": {'),
    lineOf("packages/server/src/sim/inputs.ts", 'case "questAccept": {'),
    lineOf("packages/server/src/sim/inputs.ts", "export function enqueueClientMessage(q: InputQueue"),
    lineOf("packages/server/src/sim/inputs.ts", "export function parseId(v: unknown)"),
  ],
  actionHandlers: [
    lineOf("packages/server/src/sim/quests.ts", "export const handleQuestAccept"),
    lineOf("packages/server/src/sim/quests.ts", "qt.publishAt = now + QUEST_REVEAL_HEAD_START_MS;"),
    lineOf("packages/server/src/sim/quests.ts", 'type: "questReveal", to: finder,'),
    lineOf("packages/server/src/sim/traders.ts", "export const handleTrade"),
    lineOf("packages/server/src/sim/traders.ts", "export function spawnTraders"),
    lineOf("packages/server/src/sim/traders.ts", "p.tradeOffers.push(JSON.stringify(offer))"),
    lineOf("packages/server/src/sim/traders.ts", "w.traders?.barterAt.set(c.id, w.state.serverTime + 5000)"),
  ],
  schemaReceivers: [
    lineOf("packages/shared/src/schema.ts", "export const QuestState = schema({"),
    lineOf("packages/shared/src/schema.ts", "export const TraderState = schema({"),
    lineOf("packages/shared/src/schema.ts", "tradeUsed: t.boolean().default(false),"),
    lineOf("packages/shared/src/schema.ts", 'tradeOffers: t.array("string"),'),
    lineOf("packages/shared/src/schema.ts", 'tradeStats: t.map("float64"),'),
    lineOf("packages/shared/src/schema.ts", "quests: t.map(QuestState),"),
    lineOf("packages/shared/src/schema.ts", "traders: t.map(TraderState),"),
    lineOf("packages/shared/src/messages.ts", "export interface QuestRevealMessage"),
    lineOf("packages/shared/src/messages.ts", "questAccept: { quest: string };"),
    lineOf("packages/shared/src/messages.ts", "trade: { trader: string; pick: number };"),
    lineOf("packages/client/src/ui/questModel.ts", "export function questFromReveal"),
    lineOf("packages/client/src/ui/questModel.ts", "export function questCollections"),
    lineOf("packages/client/src/ui/questModel.ts", "export function questRows"),
  ],
  wording: [
    lineOf("packages/shared/src/quests.ts", "export const QUEST_REFUSAL"),
    lineOf("packages/shared/src/quests.ts", "export const questAcceptedText"),
    lineOf("packages/shared/src/quests.ts", "export const questAcceptFirstText"),
    lineOf("packages/client/src/ui/questDialog.ts", "export const ACCEPT_NOT_CONFIRMED_SAY"),
    lineOf("packages/client/src/ui/questDialog.ts", "export const ACCEPT_RECONNECTING_SAY"),
    lineOf("packages/client/src/ui/traderPanel.ts", "Choose one permanent exchange for this run."),
    lineOf("packages/client/src/ui/traderPanel.ts", "Your stat trade is complete for this run."),
    lineOf("packages/client/src/ui/traderPanel.ts", "Trade the weapon in your hand, or exchange a small potion for a weapon."),
    lineOf("packages/shared/src/traders.ts", "export function barterLabels"),
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
    phaser: "replaced by tools/quest-public-fixtures/stub-loader.mjs with a declared minimal base-class module; no game, scene renderer, DOM or keyboard runs",
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
    clientDoor: "QuestDialog is the real imported class; its frame values come from the actual RaidState/RaidPlayerState; the DOM is the declared fake-dom.mts; no browser, renderer, real keyboard or scene is claimed",
    clientPayload: "the scene wiring is re-expressed as (msg) => sendInput(declaredRoom, 'questAccept', msg); sendInput and room.send are the real client function and a declared room recorder",
    positions: "player x/y, status and one forced wall tile are declared and recorded in each case; the handler reads them as the server position",
    events: "all toasts/reveal events are the real SimEvent objects returned by step()",
    schema: "Colyseus Encoder.BUFFER_SIZE is raised to the server's 64 KiB setting before a full encodeAll; the decoded state is the actual decoder's state",
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
  expectSource(!!world.quests, "quest runtime missing at raid start");
  expectSource(world.actions.questAccept === handleQuestAccept, "the real handleQuestAccept is not installed");
  expectSource(typeof world.actions.trade === "function", "the trade handler is not installed in the full module order");
  expectSource(world.state.quests.size === 10 && world.state.unknownQuests === 10, "expected the real ten known + ten hidden offers");
  expectSource(world.state.traders.size === 2, "expected the real two traders");
  return { world, map, initEvents };
}

const setupNote = (text: string): any => ({ declared: text });
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
    weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot, potionSmall: p.potionSmall,
    tradeUsed: p.tradeUsed, tradeOffers: [...p.tradeOffers], tradeStats: pairs(p.tradeStats),
    effects: p.effects,
  };
}
function questPublic(world: any): any[] {
  return entriesOf(world.state.quests).map(([id, q]: any) => ({
    id, def: q.def, x: q.x, y: q.y, status: q.status, doneBy: q.doneBy, expiresAt: q.expiresAt, carrier: q.carrier,
    progress: pairs(q.progress), accepted: pairs(q.accepted), visitedRegions: pairs(q.visitedRegions),
  })).sort((a: any, b: any) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function questPrivate(world: any): any[] {
  return entriesOf(world.quests!.quests).map(([id, qt]: any) => ({
    id, def: qt.def.id, published: qt.published, npcId: qt.npcId, finder: qt.finder,
    at: { x: qt.s.x, y: qt.s.y }, tokens: (qt.placement.tokens ?? []).map((p: any) => ({ x: p.x, y: p.y })),
    parcel: qt.placement.parcel ? { x: qt.placement.parcel.x, y: qt.placement.parcel.y } : null,
    containers: [...qt.containers], lastCarrier: qt.lastCarrier, accepted: pairs(qt.s.accepted),
  })).sort((a: any, b: any) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function traderPublic(world: any): any[] {
  return entriesOf(world.state.traders).map(([id, t]: any) => ({ id, kind: t.kind, x: t.x, y: t.y, name: t.name }))
    .sort((a: any, b: any) => keySorted(a.id, b.id));
}
function eventsPlain(events: any[]): any[] { return events.map((e) => plain(e)); }
function toastsOf(events: any[]): any[] {
  return events.filter((e: any) => e.type === "toast").map((e: any) => ({ to: e.to, text: e.text }));
}
function revealsOf(events: any[]): any[] {
  return events.filter((e: any) => e.type === "questReveal").map((e: any) => ({ to: e.to, quest: plain(e.quest) }));
}
function worldFacts(world: any, map: any): any {
  return {
    phase: world.state.phase, serverTime: world.state.serverTime, tick: world.state.tick,
    seed: SEED, attempt: ATTEMPT, mapHashU32: mapHashU32(map), map: { w: map.w, h: map.h, decor: false },
    config: CONFIG, players: PLAYERS, random: { seed: RANDOM_SEED, rewardSalt: REWARD_SALT },
    quests: questPublic(world), unknownQuests: world.state.unknownQuests, traders: traderPublic(world),
    playersState: PLAYERS.map((_p, i) => playerView(world, "p" + i)),
  };
}
function knownOffers(world: any): any[] {
  return [...world.quests!.quests].filter(([, qt]: any) => qt.published).sort((a: any, b: any) => keySorted(a[0], b[0]));
}
function hiddenOffers(world: any): any[] {
  return [...world.quests!.quests].filter(([, qt]: any) => !qt.published).sort((a: any, b: any) => keySorted(a[0], b[0]));
}
function publicRow(world: any, id: string): any {
  const q = world.state.quests.get(id);
  if (!q) return null;
  return { id, def: q.def, x: q.x, y: q.y, status: q.status, doneBy: q.doneBy, expiresAt: q.expiresAt, carrier: q.carrier, progress: pairs(q.progress), accepted: pairs(q.accepted), visitedRegions: pairs(q.visitedRegions) };
}

// ============================================================================================ A. client door (real class)
function makeRoom(): any {
  const sent: any[] = [];
  const room = { send(type: string, payload: any): void { sent.push({ type, payload: plain(payload) }); } };
  return { room, sent };
}
function makeDialog(options: any = {}): any {
  const settings = new settingsMod.SettingsStore(null);
  const dialog = new QuestDialog({
    send: (msg: any) => sendInput(options.room, "questAccept", msg),
    canSend: options.canSend ?? (() => true),
    now: () => clockNow,
    settings,
  });
  return dialog;
}
function frameOf(world: any, map: any, meId = "p0"): any {
  const p = world.state.players.get(meId)!;
  return {
    active: world.state.phase === "active",
    serverNow: world.state.serverTime,
    me: { id: meId, x: p.x, y: p.y, alive: p.status === "alive" },
    quests: world.state.quests,
    sight: map,
  };
}
function textOf(dialog: any, cls: string): any {
  const e = dialog.element.byClass(cls)[0];
  return e ? e.textContent : null;
}
function allTextOf(dialog: any, cls: string): any {
  const e = dialog.element.byClass(cls)[0];
  return e ? e.allText : null;
}
function dialogView(dialog: any): any {
  const accept = dialog.element.byClass("qd-accept")[0];
  const badge = dialog.element.byClass("qd-badge")[0];
  return {
    isOpen: dialog.isOpen,
    questId: dialog.questId,
    focused: dialog.focused,
    acceptPending: dialog.acceptPending,
    rootHidden: dialog.element.hidden,
    title: textOf(dialog, "qd-title"),
    kind: textOf(dialog, "qd-kind"),
    timer: textOf(dialog, "qd-timer"),
    giver: textOf(dialog, "qd-giver"),
    brief: textOf(dialog, "qd-brief"),
    objective: textOf(dialog, "qd-objective"),
    reward: textOf(dialog, "qd-reward"),
    progress: textOf(dialog, "qd-progress"),
    status: textOf(dialog, "qd-status"),
    acceptHidden: accept ? accept.hidden : null,
    acceptDisabled: accept ? accept.disabled : null,
    badgeHidden: badge ? badge.hidden : null,
    hintIdle: allTextOf(dialog, "qd-hint"),
    hintFocus: dialog.element.byClass("qd-hint-keys")[0]?.allText ?? null,
    acceptLabel: accept ? accept.allText : null,
    closeLabel: dialog.element.byClass("qd-close")[0]?.allText ?? null,
    focusedClass: dialog.element.hasClass("focused"),
  };
}
function freshQueue(message: any, type = "questAccept", opts: any = {}): any {
  const q = new InputQueue();
  const parsed = type === "questAccept" ? inputsMod.parseQuestAccept(message) : null;
  const returned = enqueueClientMessage(q, type, message, opts);
  const drained = q.drain();
  return { type, message: plain(message), parsed: plain(parsed), returned, actions: plain(drained.actions), move: drained.move, dropped: q.dropped, opts };
}

const doorCases: any[] = [];
function doorSetup(): any {
  const { world, map } = open();
  const known = knownOffers(world)[0]!;
  const qid = known[0] as string;
  const qt = known[1] as any;
  const stand = place(world, "p0", qt.s.x, qt.s.y);
  const { room, sent } = makeRoom();
  const dialog = makeDialog({ room });
  dialog.update(frameOf(world, map));
  return { world, map, qid, qt, stand, room, sent, dialog, known };
}
const seedWorld = open();
const seedKnown = knownOffers(seedWorld.world)[0]!;
const knownId = seedKnown[0] as string;
const knownDef = S.questDefById(seedKnown[1].def.id)!;

// 1. Open a known offer at its giver and accept through the real Accept method, then let the actual server action answer.
{
  clockNow = 10000;
  const h = doorSetup();
  const opened = h.dialog.open(h.qid);
  const before = dialogView(h.dialog);
  const accepted = h.dialog.accept();
  const afterAccept = dialogView(h.dialog);
  const binding = freshQueue(h.sent[0]?.payload);
  const queued = enqueueClientMessage(h.world.players.get("p0")!.inputs, "questAccept", h.sent[0]!.payload);
  const events = step(h.world, TICK_MS);
  h.dialog.update(frameOf(h.world, h.map));
  const afterServer = dialogView(h.dialog);
  doorCases.push({
    id: "known-open-accept",
    declared: { stand: h.stand, dom: "declared fake-dom.mts", frame: "actual RaidState.quests, actual p0 position/status, actual map", wiring: "(msg) => sendInput(declaredRoom, 'questAccept', msg)" },
    actual: {
      opened, before, accepted, afterAccept, sent: h.sent, binding, queued,
      events: eventsPlain(events), toasts: toastsOf(events), reveals: revealsOf(events),
      afterServer, publicRow: publicRow(h.world, h.qid),
    },
  });
  h.dialog.destroy();
}

// 2. The dialog's own Enter key path (real capturing keydown listener on the declared window).
{
  clockNow = 11000;
  const h = doorSetup();
  const opened = h.dialog.open(h.qid);
  const event = win.press({ code: "Enter", target: h.dialog.element });
  doorCases.push({
    id: "keyboard-enter-accept",
    declared: { dom: "declared fake-dom.mts window.press", note: "a synthetic keydown dispatched to the real capturing listener; not a real keyboard" },
    actual: { opened, sent: h.sent, view: dialogView(h.dialog), key: { code: event.code, defaultPrevented: event.defaultPrevented, propagationStopped: event.propagationStopped } },
  });
  h.dialog.destroy();
}

// 3. The click guard and the pending latch: a click in the first 250 ms does nothing; a later click sends once.
{
  clockNow = 20000;
  const h = doorSetup();
  h.dialog.open(h.qid);
  const accept = h.dialog.element.byClass("qd-accept")[0]!;
  const early = accept.click({ detail: 1 });
  const afterEarly = { sent: h.sent.length, view: dialogView(h.dialog), event: { detail: early.detail } };
  clockNow += questDialogMod.QUEST_DIALOG_CLICK_GUARD_MS;
  const late = accept.click({ detail: 1 });
  const afterLate = { sent: h.sent.length, view: dialogView(h.dialog), event: { detail: late.detail } };
  accept.click({ detail: 1 });
  doorCases.push({
    id: "click-guard-and-pending-latch",
    declared: { guardMs: questDialogMod.QUEST_DIALOG_CLICK_GUARD_MS, dom: "declared fake-dom.mts click" },
    actual: { early: afterEarly, late: afterLate, afterSecondClick: { sent: h.sent, pending: h.dialog.acceptPending } },
  });
  h.dialog.destroy();
}

// 4. The reconnect canSend gate: nothing is sent, the real reconnect status line is shown.
{
  clockNow = 30000;
  const { world, map } = open();
  const known = knownOffers(world)[0]!;
  const qid = known[0] as string;
  const qt = known[1] as any;
  place(world, "p0", qt.s.x, qt.s.y);
  const { room, sent } = makeRoom();
  const dialog = makeDialog({ room, canSend: () => false });
  dialog.update(frameOf(world, map));
  dialog.open(qid);
  const accepted = dialog.accept();
  const enter = win.press({ code: "Enter", target: dialog.element });
  doorCases.push({
    id: "reconnect-gate",
    declared: { canSend: "declared false (the scene's !room.reconnection?.isReconnecting)" },
    actual: { accepted, sent, view: dialogView(dialog), enter: { defaultPrevented: enter.defaultPrevented } },
  });
  dialog.destroy();
}

// 5. The client's own open gates: out of range, dead, closed offer, inactive run.
{
  clockNow = 40000;
  const h = doorSetup();
  const far = place(h.world, "p0", h.qt.s.x + 1000, h.qt.s.y);
  h.dialog.update(frameOf(h.world, h.map));
  const outOfRange = h.dialog.open(h.qid);
  place(h.world, "p0", h.qt.s.x, h.qt.s.y);
  const p0 = h.world.state.players.get("p0")!;
  p0.status = "dead";
  h.dialog.update(frameOf(h.world, h.map));
  const dead = h.dialog.open(h.qid);
  p0.status = "alive";
  const savedStatus = h.qt.s.status;
  h.qt.s.status = "expired";
  h.dialog.update(frameOf(h.world, h.map));
  const closed = h.dialog.open(h.qid);
  h.qt.s.status = savedStatus;
  h.dialog.update({ ...frameOf(h.world, h.map), active: false });
  const inactive = h.dialog.open(h.qid);
  doorCases.push({
    id: "open-gates",
    declared: { far, dead: "p0.status = 'dead'", closed: "h.qt.s.status = 'expired'", inactive: "frame.active = false" },
    actual: { outOfRange, dead, closed, inactive, view: dialogView(h.dialog) },
  });
  h.dialog.destroy();
}

// 6. The refusal-toast receiver: the shared refusal text is recognized; a success toast is not a refusal.
{
  clockNow = 50000;
  const h = doorSetup();
  h.dialog.open(h.qid);
  h.dialog.accept();
  const refusal = h.dialog.noteToast(S.QUEST_REFUSAL.far);
  const afterRefusal = dialogView(h.dialog);
  const other = h.dialog.noteToast("Quest accepted: " + knownDef.name);
  doorCases.push({
    id: "note-toast-refusal",
    declared: { text: "S.QUEST_REFUSAL.far from the actual shared export; the success line is a helper-declared string" },
    actual: { refusal, afterRefusal, other, afterOther: dialogView(h.dialog), sent: h.sent },
  });
  h.dialog.destroy();
}

// 7. The training room: the messages still parse/queue at the edge, but the quest/trader handlers are not installed.
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
  const parsedQuest = enqueueClientMessage(q, "questAccept", { quest: "any" }, { training: true });
  const parsedTrade = enqueueClientMessage(q, "trade", { trader: "trader-stats", pick: 0 }, { training: true });
  const queued = q.drain();
  const events = step(training, TICK_MS);
  doorCases.push({
    id: "training-room-edge",
    declared: { config: { ...CONFIG, training: true, dummies: true, minPlayers: 1 }, world: "createGameWorld training" },
    actual: {
      phase: training.state.phase, questRuntime: !!training.quests, questHandler: typeof training.actions.questAccept,
      tradeHandler: typeof training.actions.trade, parsedQuest, parsedTrade, queued: plain(queued.actions), events: eventsPlain(events),
    },
  });
}

// ---------------------------------------------------------------------------------------------- intake / parse / queue
const intakeCases = [
  { id: "valid", type: "questAccept", msg: { quest: knownId } },
  { id: "extra-field-ignored", type: "questAccept", msg: { quest: knownId, extra: 1 } },
  { id: "malformed-null", type: "questAccept", msg: null },
  { id: "malformed-empty-object", type: "questAccept", msg: {} },
  { id: "empty-id", type: "questAccept", msg: { quest: "" } },
  { id: "non-string-id", type: "questAccept", msg: { quest: 7 } },
  { id: "array-id", type: "questAccept", msg: { quest: [knownId] } },
  { id: "over-64-id", type: "questAccept", msg: { quest: "x".repeat(65) } },
  { id: "at-64-id", type: "questAccept", msg: { quest: "x".repeat(64) } },
  { id: "unknown-id-parses", type: "questAccept", msg: { quest: "no-such-quest" } },
  { id: "unknown-message-type", type: "questAcceptt", msg: { quest: knownId } },
  { id: "training-option", type: "questAccept", msg: { quest: knownId }, opts: { training: true } },
].map((c: any) => ({ id: c.id, ...freshQueue(c.msg, c.type, c.opts ?? {}) }));
{
  const q = new InputQueue();
  const returns: boolean[] = [];
  for (let i = 0; i < 8; i++) returns.push(enqueueClientMessage(q, "questAccept", { quest: knownId }));
  const drained = q.drain();
  intakeCases.push({ id: "per-tick-queue-cap", message: { quest: knownId }, returns, actions: plain(drained.actions), dropped: q.dropped, note: "MAX_ACTIONS_PER_TICK = 6" });
}
const intakeCorpus = {
  format: FORMAT,
  role: "A2. the real enqueueClientMessage/parseQuestAccept/InputQueue table; no Room, socket or session is constructed",
  methodRig: "The generic RaidRoom registration is source-anchored (sourceInventory.roomRegistration): the Room instance, its onMessage loop, liveness and order budget are not executed. What is executed is the exact function RaidRoom calls: enqueueClientMessage(rt.inputs, type, msg, { training: this.training }).",
  cases: intakeCases,
  trainingGateSource: [
    { handler: "handleQuestAccept", file: "packages/server/src/sim/quests.ts", installGate: "install(world) returns early unless config.quests and not training; no world.actions.questAccept in a training world" },
    { handler: "handleTrade", file: "packages/server/src/sim/traders.ts", installGate: "install(world) returns early in training; the suite records the actual missing actions in doorCases.training-room-edge" },
  ],
};

// --------------------------------------------------------------------------------------------- action cases (real steps)
function actionHarness(id: string): any {
  const { world, map } = open();
  const declared: any[] = [];
  const allEvents: any[] = [];
  const api: any = {
    id, world, map, declared, allEvents,
    place(actor: string, x: number, y: number): any { const note = place(world, actor, x, y); declared.push({ kind: "place", ...note }); return note; },
    message(actor: string, payload: any, type = "questAccept"): any {
      const ok = enqueueClientMessage(world.players.get(actor)!.inputs, type, payload);
      return { actor, type, payload: plain(payload), enqueued: ok };
    },
    runSteps(n: number): any[] { const out: any[] = []; for (let i = 0; i < n; i++) { const e = step(world, TICK_MS); allEvents.push(...e); out.push(...e); } return out; },
    snapshot(label: string): any {
      return {
        label, tick: world.state.tick, serverTime: world.state.serverTime, phase: world.state.phase,
        unknownQuests: world.state.unknownQuests, quests: questPublic(world), privateOffers: questPrivate(world),
        players: PLAYERS.map((_p, i) => playerView(world, "p" + i)), traders: traderPublic(world),
      };
    },
    record(extra: any): any {
      return {
        id,
        declared: api.declared,
        actual: {
          events: eventsPlain(api.allEvents), toasts: toastsOf(api.allEvents), reveals: revealsOf(api.allEvents),
          ...extra,
          final: api.snapshot("final"),
        },
      };
    },
  };
  return api;
}

const actionCases: any[] = [];

// 1. A valid accept at the known giver: the public accepted set, the deadline start and the private toast.
{
  const h = actionHarness("known-accept");
  const known = knownOffers(h.world)[0]!;
  const qid = known[0] as string;
  const qt = known[1] as any;
  h.place("p0", qt.s.x, qt.s.y);
  const message = h.message("p0", { quest: qid });
  const events = h.runSteps(1);
  actionCases.push(h.record({ message, accepted: qt.s.accepted.get("p0") ?? false, expiresAt: qt.s.expiresAt, publicRow: publicRow(h.world, qid), toastRecognized: S.QUEST_REFUSALS.includes(S.questAcceptedText(qt.def)) ? "refusal" : "success" }));
}

// 2. Repeat accept: the offer is already accepted, so the exact "already" refusal order branch answers.
{
  const h = actionHarness("repeat-already");
  const known = knownOffers(h.world)[0]!;
  const qid = known[0] as string;
  const qt = known[1] as any;
  h.place("p0", qt.s.x, qt.s.y);
  const first = h.message("p0", { quest: qid });
  h.runSteps(1);
  const second = h.message("p0", { quest: qid });
  h.runSteps(1);
  actionCases.push(h.record({ first, second, accepted: qt.s.accepted.get("p0") ?? false, publicRow: publicRow(h.world, qid) }));
}

// 3. Far refusal on a real offer (the source's range branch); the existing lifecycle corpus already records the same
//    far -> accept -> repeat campaign, so this is only the new toast/recipient surface and an ordering probe.
{
  const h = actionHarness("far-refusal");
  const known = knownOffers(h.world)[0]!;
  const qid = known[0] as string;
  const qt = known[1] as any;
  h.place("p0", qt.s.x + 1000, qt.s.y + 1000);
  const message = h.message("p0", { quest: qid });
  h.runSteps(1);
  actionCases.push(h.record({ message, accepted: qt.s.accepted.get("p0") ?? false }));
}

// 4. Unknown id and an unpublished (hidden) id get the same answer, so probing ids learns nothing.
{
  const h = actionHarness("unknown-id");
  const known = knownOffers(h.world)[0]!;
  const message = h.message("p0", { quest: "no-such-quest" });
  h.runSteps(1);
  actionCases.push(h.record({ message, knownOfferVisible: publicRow(h.world, known[0] as string) !== null }));
}
{
  const h = actionHarness("hidden-id");
  const hidden = hiddenOffers(h.world).find(([, qt]: any) => qt.def.id === "cull-fire")!;
  const hid = hidden[0] as string;
  const qt = hidden[1] as any;
  h.place("p0", qt.s.x, qt.s.y);
  const message = h.message("p0", { quest: hid });
  h.runSteps(1);
  actionCases.push(h.record({ message, hiddenId: hid, publishedBefore: qt.published, publicHasRow: h.world.state.quests.has(hid), unknownQuests: h.world.state.unknownQuests }));
}

// 5. A stale/closed public row is refused by the same "over" branch.
{
  const h = actionHarness("stale-closed");
  const known = knownOffers(h.world)[0]!;
  const qid = known[0] as string;
  const qt = known[1] as any;
  h.place("p0", qt.s.x, qt.s.y);
  const old = qt.s.status;
  qt.s.status = "expired";
  h.declared.push({ kind: "status", quest: qid, from: old, to: "expired" });
  const message = h.message("p0", { quest: qid });
  h.runSteps(1);
  actionCases.push(h.record({ message, publicRow: publicRow(h.world, qid) }));
}

// 6. Busy (a real stun status): the first handler branch, a private toast.
{
  const h = actionHarness("busy-stun");
  const known = knownOffers(h.world)[0]!;
  const qid = known[0] as string;
  const qt = known[1] as any;
  h.place("p0", qt.s.x, qt.s.y);
  const inst = addStatus(h.world, combatant(h.world, "p0"), { kind: "stun", source: { id: "" }, ms: 1000 }, { quiet: true });
  h.declared.push({ kind: "status", actor: "p0", status: "stun", ms: 1000, returned: inst !== null });
  const message = h.message("p0", { quest: qid });
  h.runSteps(1);
  actionCases.push(h.record({ message, accepted: qt.s.accepted.get("p0") ?? false, effects: h.world.state.players.get("p0")!.effects }));
}

// 7. Dead: the ordinary applyInputs loop returns before the handler; the command is drained with no toast.
{
  const h = actionHarness("dead-silent");
  const known = knownOffers(h.world)[0]!;
  const qid = known[0] as string;
  const qt = known[1] as any;
  h.place("p0", qt.s.x, qt.s.y);
  h.world.state.players.get("p0")!.status = "dead";
  h.declared.push({ kind: "status", actor: "p0", to: "dead" });
  const message = h.message("p0", { quest: qid });
  const events = h.runSteps(1);
  actionCases.push(h.record({ message, eventsThisStep: eventsPlain(events), queueAfter: h.world.players.get("p0")!.inputs.actions.length, accepted: qt.s.accepted.get("p0") ?? false }));
}

// 8. Line of sight: one declared wall tile between the player and the giver (both on the real seed-1 map).
{
  const h = actionHarness("los-blocked");
  const known = knownOffers(h.world)[0]!;
  const qid = known[0] as string;
  const qt = known[1] as any;
  const tx = Math.floor(qt.s.x / S.TILE), ty = Math.floor(qt.s.y / S.TILE);
  const wall = { tx: tx + 1, ty };
  const idx = S.tileIndex(h.map, wall.tx, wall.ty);
  const before = h.map.tiles[idx];
  h.map.tiles[idx] = S.TILE_WALL;
  const px = (tx + 2) * S.TILE + S.TILE / 2, py = ty * S.TILE + S.TILE / 2;
  h.place("p0", px, py);
  h.declared.push({ kind: "forced-wall", tile: wall, index: idx, from: before, to: S.TILE_WALL, why: "one-tile declared wall for the LOS probe only" });
  const los = S.hasLineOfSight(collisionMap(h.world), { x: px, y: py }, { x: qt.s.x, y: qt.s.y }, S.MASK_MOVE);
  const message = h.message("p0", { quest: qid });
  h.runSteps(1);
  actionCases.push(h.record({ message, los, distance: Math.hypot(px - qt.s.x, py - qt.s.y), acceptRange: S.QUEST_ACCEPT_RANGE }));
}

// 9. Order probes: busy before offer validity, offer validity before range, range before already-accepted.
{
  const h = actionHarness("order-busy-before-offer");
  const known = knownOffers(h.world)[0]!;
  const qt = known[1] as any;
  h.place("p0", qt.s.x, qt.s.y);
  addStatus(h.world, combatant(h.world, "p0"), { kind: "stun", source: { id: "" }, ms: 1000 }, { quiet: true });
  h.declared.push({ kind: "status", actor: "p0", status: "stun" });
  const message = h.message("p0", { quest: "no-such-quest" });
  h.runSteps(1);
  actionCases.push(h.record({ message, expectedOrder: "busy is checked before the offer lookup" }));
}
{
  const h = actionHarness("order-offer-before-range");
  const known = knownOffers(h.world)[0]!;
  const qt = known[1] as any;
  h.place("p0", qt.s.x + 1000, qt.s.y);
  const message = h.message("p0", { quest: "no-such-quest" });
  h.runSteps(1);
  actionCases.push(h.record({ message, expectedOrder: "the offer/published/giver check is before the range check" }));
}
{
  const h = actionHarness("order-range-before-already");
  const known = knownOffers(h.world)[0]!;
  const qid = known[0] as string;
  const qt = known[1] as any;
  h.place("p0", qt.s.x, qt.s.y);
  h.message("p0", { quest: qid });
  h.runSteps(1);
  h.place("p0", qt.s.x + 1000, qt.s.y);
  const message = h.message("p0", { quest: qid });
  h.runSteps(1);
  actionCases.push(h.record({ message, accepted: qt.s.accepted.get("p0") ?? false, expectedOrder: "range is checked before the already-accepted branch" }));
}

// 10. Declared phase "ended": step() does not drain inputs outside active, so the handler is never called and the command stays queued.
{
  const h = actionHarness("phase-ended-not-drained");
  const known = knownOffers(h.world)[0]!;
  const qid = known[0] as string;
  const qt = known[1] as any;
  h.place("p0", qt.s.x, qt.s.y);
  h.world.state.phase = "ended";
  h.declared.push({ kind: "phase", to: "ended", why: "declared terminal phase; not a run-end producer" });
  const message = h.message("p0", { quest: qid });
  const events = h.runSteps(1);
  actionCases.push(h.record({ message, eventsThisStep: eventsPlain(events), queueAfter: h.world.players.get("p0")!.inputs.actions.length, handlerRan: "source-anchored phase guard; step() never invokes actions outside active" }));
}

// 11. Hidden reveal + 4 s head start + publication (real questSystem): the private recipient boundary and the public row.
{
  const h = actionHarness("hidden-reveal-publish");
  const hidden = hiddenOffers(h.world).find(([, qt]: any) => qt.def.id === "cull-fire")!;
  const hid = hidden[0] as string;
  const qt = hidden[1] as any;
  const px = qt.s.x, py = qt.s.y;
  h.place("p0", px, py);
  const before = { publicHas: h.world.state.quests.has(hid), unknown: h.world.state.unknownQuests, npcId: qt.npcId, published: qt.published };
  const revealEvents = h.runSteps(1);
  const revealed = { publicHas: h.world.state.quests.has(hid), unknown: h.world.state.unknownQuests, npcId: qt.npcId, published: qt.published, finder: qt.finder, serverTime: h.world.state.serverTime };
  h.runSteps(79);
  const headStart = { publicHas: h.world.state.quests.has(hid), unknown: h.world.state.unknownQuests, serverTime: h.world.state.serverTime };
  const publishEvents = h.runSteps(1);
  const published = { publicHas: h.world.state.quests.has(hid), unknown: h.world.state.unknownQuests, npcId: qt.npcId, publicRow: publicRow(h.world, hid), giverMob: h.world.state.mobs.get(qt.npcId) ? { id: qt.npcId, name: h.world.state.mobs.get(qt.npcId).name, kind: h.world.state.mobs.get(qt.npcId).kind } : null };
  actionCases.push(h.record({ hiddenId: hid, before, revealed, headStart, published, revealEvents: eventsPlain(revealEvents), publishEvents: eventsPlain(publishEvents) }));
}

// ===================================================================================================== corpora
const factsWorld = open();
const doorsCorpus: any = {
  format: FORMAT,
  role: "A. the real human questAccept door (QuestDialog + sendInput recorder), the real intake/parse/queue, and the real action handler through ordinary 50 ms steps",
  world: worldFacts(factsWorld.world, factsWorld.map),
  clientDoor: {
    class: "packages/client/src/ui/questDialog.ts QuestDialog (real imported class)",
    wiring: "new QuestDialog({ send: (msg) => sendInput(declaredRoom, 'questAccept', msg), canSend, now, settings })",
    fixture: "declared fake-dom.mts (elements, focus, capturing keydown, bubbling click); no browser/renderer",
    cases: doorCases,
  },
  intake: intakeCorpus,
  actions: {
    harness: "createGameWorld (production module order, quests on, map seed 1 attempt 0, random mulberry32(12), reward salt [1,2,3,4]); addPlayer p0..p2; one 50 ms step to active; then ordinary enqueueClientMessage + step(50)",
    cases: actionCases,
  },
  methodLimits: [
    "No socket, Colyseus Room instance, session, liveness tracker, order budget or real client is constructed; the generic RaidRoom registration and its guards are source-anchored in sourceInventory.roomRegistration.",
    "No browser DOM, renderer, CSS layout, real mouse or real keyboard: the declared fake-dom.mts supplies elements and synthetic events; QuestDialog's own code is unchanged.",
    "A synthetic keydown exercises the real capturing listener but is not a real keyboard claim.",
    "The action cases set positions/status/one wall tile by declaration (recorded per case); the sim's step/input/action/event code is actual.",
  ],
};
const schemaReceiverCorpus: any = await buildSchemaReceiverCorpus();
const wordingCorpus: any = await buildWordingCorpus(null, null, actionCases);

// Placeholder functions are replaced below; declared here so the file's shape is explicit.
async function buildSchemaReceiverCorpus(): Promise<any> {
  const { world, map } = open();
  const known = knownOffers(world)[0]!;
  const knownId = known[0] as string;
  const knownQt = known[1] as any;
  place(world, "p0", knownQt.s.x, knownQt.s.y);
  enqueueClientMessage(world.players.get("p0")!.inputs, "questAccept", { quest: knownId });
  step(world, TICK_MS);

  const hidden = hiddenOffers(world).find(([, qt]: any) => qt.def.id === "cull-fire")!;
  const hiddenId = hidden[0] as string;
  const hiddenQt = hidden[1] as any;
  place(world, "p0", hiddenQt.s.x, hiddenQt.s.y);
  const revealEvents = step(world, TICK_MS);
  const revealMessage = revealEvents.find((e: any) => e.type === "questReveal")?.quest ?? null;
  const revealRecipients = revealEvents.filter((e: any) => e.type === "questReveal").map((e: any) => e.to);
  const preview = revealMessage ? questModelMod.questFromReveal(revealMessage) : null;
  const prePublish = {
    publicHasHidden: world.state.quests.has(hiddenId),
    unknownQuests: world.state.unknownQuests,
    publicRow: publicRow(world, knownId),
    revealMessage: plain(revealMessage),
    revealRecipients,
  };
  const previews = preview ? new Map([[preview.id, preview]]).values() : [][Symbol.iterator]();
  const mergedBefore = questModelMod.questCollections(world.state, previews, world.state.serverTime);
  const mergedKeysBefore = [] as string[];
  mergedBefore.quests.forEach((_q: any, id: string) => mergedKeysBefore.push(id));
  const rowsBefore = questModelMod.questRows(mergedBefore.quests, "p0", world.state.serverTime, "name0");
  const revealPreview = preview ? {
    quest: plain(preview),
    visible: questModelMod.visibleQuest(preview),
    accepted: questModelMod.questAccepted(preview, "p0"),
    collections: { questKeys: mergedKeysBefore.sort(), hidden: mergedBefore.hidden },
    rows: rowsBefore.map((r: any) => ({
      id: r.id, def: r.def.id, objective: r.objective, progress: r.progress, status: r.status, ready: r.ready,
      accepted: r.accepted, acceptance: r.acceptance, time: r.time, reward: r.reward, closed: r.closed,
    })),
  } : null;

  world.state.players.get("p0")!.x = world.state.traders.get("trader-stats")!.x;
  world.state.players.get("p0")!.y = world.state.traders.get("trader-stats")!.y;
  step(world, TICK_MS);
  const offers = [...world.state.players.get("p0")!.tradeOffers];
  // One real stat trade through the ordinary intake/step path, so tradeStats/tradeUsed are source-written.
  const pick = offers.length > 0 ? 0 : 0;
  enqueueClientMessage(world.players.get("p0")!.inputs, "trade", { trader: "trader-stats", pick });
  const tradeEvents = step(world, TICK_MS);

  const codec = makeCodec(world);
  const prePublishEncode = codec.capture();
  // Publish after the recorded head-start boundary: 79 + 1 more steps from the reveal tick.
  for (let i = 0; i < 79; i++) step(world, TICK_MS);
  step(world, TICK_MS);
  const published = {
    publicHasHidden: world.state.quests.has(hiddenId),
    unknownQuests: world.state.unknownQuests,
    publicRow: publicRow(world, hiddenId),
    giverMob: hiddenQt.npcId ? { id: hiddenQt.npcId, name: world.state.mobs.get(hiddenQt.npcId)?.name, kind: world.state.mobs.get(hiddenQt.npcId)?.kind } : null,
  };
  const mergedAfter = questModelMod.questCollections(world.state, new Map(), world.state.serverTime);
  const mergedKeysAfter = [] as string[];
  mergedAfter.quests.forEach((_q: any, id: string) => mergedKeysAfter.push(id));
  const rowsAfter = questModelMod.questRows(mergedAfter.quests, "p0", world.state.serverTime, "name0");
  const postPublishEncode = codec.capture();

  const questFields = Object.values(getEncodeDescriptor(new schemaMod.QuestState()).metadata).map((f: any) => ({ name: f.name, type: f.type, index: f.index, noSync: !!f.noSync }));
  const traderFields = Object.values(getEncodeDescriptor(new schemaMod.TraderState()).metadata).map((f: any) => ({ name: f.name, type: f.type, index: f.index, noSync: !!f.noSync }));
  const playerFields = Object.values(getEncodeDescriptor(new schemaMod.PlayerState()).metadata)
    .filter((f: any) => /^(name|status|x|y|weapon0|weapon1|slot|potionSmall|tradeUsed|tradeOffers|tradeStats)$/.test(f.name))
    .map((f: any) => ({ name: f.name, type: f.type, index: f.index, noSync: !!f.noSync }));
  const raidFields = Object.values(getEncodeDescriptor(new schemaMod.RaidState()).metadata)
    .filter((f: any) => /^(quests|unknownQuests|traders)$/.test(f.name))
    .map((f: any) => ({ name: f.name, type: f.type, index: f.index, noSync: !!f.noSync }));

  return {
    format: FORMAT,
    role: "B. actual schema metadata and Colyseus encode/decode shapes; actual public-vs-private boundary; actual client receivers over actual state and the private reveal message",
    world: worldFacts(world, map),
    schema: {
      encoderBufferBytes: 64 * 1024,
      encodeCall: "new Encoder(state); Reflection.encode(encoder); decoder.decode(encoder.encodeAll())",
      kinds: [
        { name: "QuestState", fields: questFields },
        { name: "TraderState", fields: traderFields },
        { name: "PlayerState (selected trade/body fields)", fields: playerFields, totalFieldCount: Object.keys(getEncodeDescriptor(new schemaMod.PlayerState()).metadata).length },
        { name: "RaidState (quest/trader containers)", fields: raidFields },
      ],
      rounds: [
        { label: "before-publish", bytes: prePublishEncode.bytes, sha256: prePublishEncode.sha256, decoded: prePublishEncode.decoded },
        { label: "after-publish", bytes: postPublishEncode.bytes, sha256: postPublishEncode.sha256, decoded: postPublishEncode.decoded },
      ],
    },
    disclosure: {
      matrix: [
        {
          id: "hidden-quest-before-reveal",
          ownerPrivate: "world.quests.quests has the hidden runtime (id, def, placement); RaidState.quests has no row",
          actual: { publicHasHidden: prePublish.publicHasHidden, unknownQuests: prePublish.unknownQuests },
          source: "sim/quests.ts offerQuest publishes only known offers; syncUnknownCount keeps only the count",
          classification: "OWNER-PRIVATE (source-preserved)",
        },
        {
          id: "private-reveal-message",
          ownerPrivate: "QuestRevealMessage is a private server->client message",
          actual: { to: revealRecipients, message: plain(revealMessage), stateStillHidden: prePublish.publicHasHidden },
          source: "sim/quests.ts emits type questReveal to finder; RaidRoom.ts sendTo(ev.to, 'questReveal', ev.quest)",
          classification: "FINDER-PRIVATE (source-preserved); only the finder receives it, the public state still has no row",
        },
        {
          id: "quest-public-fields",
          fields: questFields,
          actual: { decodedPublicRow: postPublishEncode.decoded.quests.find((q: any) => q.id === hiddenId) ?? null, knownAcceptedRow: postPublishEncode.decoded.quests.find((q: any) => q.id === knownId) ?? null },
          source: "QuestState: accepted/progress/visitedRegions/carrier are synced public fields; the source comment calls accepted public like progress",
          classification: "PUBLIC BY DESIGN (not a leak)",
        },
        {
          id: "trader-actor-public",
          fields: traderFields,
          actual: { decoded: postPublishEncode.decoded.traders },
          source: "TraderState has id/kind/x/y/name only; no offer or deadline is on the actor",
          classification: "PUBLIC ACTOR (no offer on the actor)",
        },
        {
          id: "player-trade-offers-and-stats",
          fields: playerFields.filter((f: any) => /^trade/.test(f.name)),
          actual: {
            decodedP0: postPublishEncode.decoded.players.find((p: any) => p.id === "p0") ?? null,
            decodedP1: postPublishEncode.decoded.players.find((p: any) => p.id === "p1") ?? null,
            p0Offers: offers, tradeEvents: eventsPlain(tradeEvents),
          },
          source: "PlayerState.tradeOffers/tradeStats/tradeUsed are ordinary synced fields on the shared RaidState; the panel reads frame.me but the wire carries every player's rows",
          classification: "SOURCE FINDING: public-field disclosure. Each client's decoded state can read p0's stat offers (cost/gain/values/label) and applied stat deltas. This is recorded as the source's actual shape, not sanitized into owner-private behaviour.",
        },
      ],
    },
    receivers: {
      cases: [
        revealPreview,
        {
          id: "after-publish",
          view: questModelMod.visibleQuest(preview ?? {}),
          collections: { questKeys: mergedKeysAfter.sort(), hidden: mergedAfter.hidden },
          rows: rowsAfter.map((r: any) => ({ id: r.id, def: r.def.id, status: r.status, acceptance: r.acceptance, accepted: r.accepted, ready: r.ready, progress: r.progress, time: r.time })),
        },
      ],
      methodLimits: "questFromReveal/questCollections/questRows are the real client functions over the actual RaidState and the actual private reveal message; no rendered UI, scene or browser is claimed here (the dialog corpus is separate).",
    },
  };
}

function makeCodec(world: any): any {
  schemaLib.Encoder.BUFFER_SIZE = 64 * 1024;
  const encoder = new schemaLib.Encoder(world.state);
  const decoder = schemaLib.Reflection.decode(schemaLib.Reflection.encode(encoder));
  const capture = (): any => {
    const bytes = encoder.encodeAll();
    decoder.decode(bytes);
    const st = decoder.state;
    const questRowsDecoded = entriesOf(st.quests).map(([id, q]: any) => ({
      id, def: q.def, x: q.x, y: q.y, status: q.status, doneBy: q.doneBy, expiresAt: q.expiresAt, carrier: q.carrier,
      progress: pairs(q.progress), accepted: pairs(q.accepted), visitedRegions: pairs(q.visitedRegions),
    })).sort((a: any, b: any) => keySorted(a.id, b.id));
    const playersDecoded = entriesOf(st.players).map(([id, p]: any) => ({
      id, name: p.name, status: p.status, x: p.x, y: p.y, weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot,
      potionSmall: p.potionSmall, tradeUsed: p.tradeUsed, tradeOffers: [...p.tradeOffers], tradeStats: pairs(p.tradeStats),
    })).sort((a: any, b: any) => keySorted(a.id, b.id));
    const tradersDecoded = entriesOf(st.traders).map(([id, t]: any) => ({ id, kind: t.kind, x: t.x, y: t.y, name: t.name }))
      .sort((a: any, b: any) => keySorted(a.id, b.id));
    return {
      bytes: bytes.length,
      sha256: sha256(Buffer.from(bytes)),
      decoded: {
        phase: st.phase, serverTime: st.serverTime, unknownQuests: st.unknownQuests,
        quests: questRowsDecoded, traders: tradersDecoded, players: playersDecoded,
      },
    };
  };
  return { capture };
}
async function buildWordingCorpus(_world: any, _map: any, _cases: any[]): Promise<any> {
  const { world, map } = open();
  const known = knownOffers(world);
  const first = known[0]!;
  const second = known[1]!;
  const firstQt = first[1] as any;
  const secondQt = second[1] as any;
  const def = S.questDefById(firstQt.def.id)!;
  const secondDef = S.questDefById(secondQt.def.id)!;
  place(world, "p0", firstQt.s.x, firstQt.s.y);
  clockNow = 60000;
  const { room, sent } = makeRoom();
  const dialog = makeDialog({ room });
  dialog.update(frameOf(world, map));
  const opened = dialog.open(first[0] as string);
  const idle = dialogView(dialog);
  const accepted = dialog.accept();
  const accepting = dialogView(dialog);
  enqueueClientMessage(world.players.get("p0")!.inputs, "questAccept", sent[0]!.payload);
  const serverEvents = step(world, TICK_MS);
  dialog.update(frameOf(world, map));
  const acceptedView = dialogView(dialog);
  dialog.destroy();

  // A second offer for the refusal / not-confirmed / reconnect status lines (the first is now accepted).
  place(world, "p0", secondQt.s.x, secondQt.s.y);
  const dialog2 = makeDialog({ room });
  dialog2.update(frameOf(world, map));
  dialog2.open(second[0] as string);
  dialog2.accept();
  const refusal = dialog2.noteToast(S.QUEST_REFUSAL.far);
  const refusedView = dialogView(dialog2);
  dialog2.destroy();

  const dialog3 = makeDialog({ room });
  dialog3.update(frameOf(world, map));
  dialog3.open(second[0] as string);
  dialog3.accept();
  clockNow += questDialogMod.ACCEPT_PENDING_EXPIRE_MS + 1;
  dialog3.update(frameOf(world, map));
  const notConfirmedView = dialogView(dialog3);
  dialog3.destroy();

  const { room: reconnectRoom, sent: reconnectSent } = makeRoom();
  const dialog4 = makeDialog({ room: reconnectRoom, canSend: () => false });
  dialog4.update(frameOf(world, map));
  dialog4.open(second[0] as string);
  const reconnectAccepted = dialog4.accept();
  const reconnectView = dialogView(dialog4);
  dialog4.destroy();

  const helpers = {
    questRefusal: plain(S.QUEST_REFUSAL),
    questRefusals: [...S.QUEST_REFUSALS],
    questAcceptedText: S.questAcceptedText(def),
    questAcceptedTextSecond: S.questAcceptedText(secondDef),
    questAcceptFirstText: S.questAcceptFirstText(def),
    acceptNotConfirmed: questDialogMod.ACCEPT_NOT_CONFIRMED_SAY,
    acceptReconnecting: questDialogMod.ACCEPT_RECONNECTING_SAY,
    acceptRefusedHoldMs: questDialogMod.ACCEPT_REFUSED_HOLD_MS,
    acceptedHoldMs: questDialogMod.ACCEPTED_HOLD_MS,
    acceptPendingExpireMs: questDialogMod.ACCEPT_PENDING_EXPIRE_MS,
    clickGuardMs: questDialogMod.QUEST_DIALOG_CLICK_GUARD_MS,
  };
  const runtimeToasts = _cases.flatMap((c: any) => (c.actual?.toasts ?? []).map((t: any) => ({ case: c.id, to: t.to, text: t.text })));
  const runtimeReveals = _cases.flatMap((c: any) => (c.actual?.reveals ?? []).map((r: any) => ({ case: c.id, to: r.to, quest: r.quest })));
  const byText = (text: string): any[] => runtimeToasts.filter((t: any) => t.text === text);
  const refusalPairs = Object.entries(S.QUEST_REFUSAL).map(([key, text]: any) => ({
    key, declared: text, runtime: byText(text), helperKind: "shared QUEST_REFUSAL export",
  }));
  return {
    format: FORMAT,
    role: "C. actual shared and UI wording, with helper declarations kept distinct from runtime action toasts",
    strings: [
      { id: "quest-refusal-busy", kind: "helper declaration", source: "packages/shared/src/quests.ts QUEST_REFUSAL.busy", value: helpers.questRefusal.busy, runtime: byText(helpers.questRefusal.busy) },
      { id: "quest-refusal-far", kind: "helper declaration", source: "packages/shared/src/quests.ts QUEST_REFUSAL.far", value: helpers.questRefusal.far, runtime: byText(helpers.questRefusal.far) },
      { id: "quest-refusal-blocked", kind: "helper declaration", source: "packages/shared/src/quests.ts QUEST_REFUSAL.blocked", value: helpers.questRefusal.blocked, runtime: byText(helpers.questRefusal.blocked) },
      { id: "quest-refusal-over", kind: "helper declaration", source: "packages/shared/src/quests.ts QUEST_REFUSAL.over", value: helpers.questRefusal.over, runtime: byText(helpers.questRefusal.over) },
      { id: "quest-refusal-already", kind: "helper declaration", source: "packages/shared/src/quests.ts QUEST_REFUSAL.already", value: helpers.questRefusal.already, runtime: byText(helpers.questRefusal.already) },
      { id: "quest-accepted", kind: "helper declaration", source: "packages/shared/src/quests.ts questAcceptedText", value: helpers.questAcceptedText, runtime: byText(helpers.questAcceptedText) },
      { id: "quest-accept-first", kind: "helper declaration", source: "packages/shared/src/quests.ts questAcceptFirstText", value: helpers.questAcceptFirstText, runtime: [] },
      { id: "dialog-accepting", kind: "actual dialog render", source: "QuestDialog.render status", value: accepting.status, runtime: [] },
      { id: "dialog-accepted", kind: "actual dialog render", source: "QuestDialog.render status", value: acceptedView.status, runtime: [] },
      { id: "dialog-not-accepted", kind: "actual dialog render", source: "QuestDialog.render progress", value: idle.progress, runtime: [] },
      { id: "dialog-idle-status", kind: "actual dialog render", source: "QuestDialog.render status", value: idle.status, runtime: [] },
      { id: "dialog-refused", kind: "actual dialog render", source: "QuestDialog.noteToast + render", value: refusedView.status, runtime: byText(S.QUEST_REFUSAL.far) },
      { id: "dialog-not-confirmed", kind: "actual dialog render", source: "QuestDialog.ACCEPT_NOT_CONFIRMED_SAY", value: notConfirmedView.status, runtime: [] },
      { id: "dialog-reconnecting", kind: "actual dialog render", source: "QuestDialog.ACCEPT_RECONNECTING_SAY", value: reconnectView.status, runtime: [] },
      { id: "dialog-accept-label", kind: "actual dialog element", source: "QuestDialog build (keycap + label text)", value: idle.acceptLabel, runtime: [] },
      { id: "dialog-close-label", kind: "actual dialog element", source: "QuestDialog build (keycap + label text)", value: idle.closeLabel, runtime: [] },
      { id: "dialog-hint-idle", kind: "actual dialog element", source: "QuestDialog build", value: idle.hintIdle, runtime: [] },
      { id: "dialog-hint-focus", kind: "actual dialog element", source: "QuestDialog build", value: idle.hintFocus, runtime: [] },
      { id: "dialog-ready-status", kind: "source-anchored string (not executed: would require installing progress)", source: "packages/client/src/ui/questDialog.ts render", value: "Return to " + def.giver + " to turn it in.", runtime: [] },
    ],
    helpers,
    dialogStates: { idle, accepting, acceptedView, refusedView, notConfirmedView, reconnectView, opened, accepted, reconnectAccepted, sent, reconnectSent, serverEvents: eventsPlain(serverEvents) },
    refusalPairs,
    runtimeToasts,
    runtimeReveals,
    helperVsRuntime: {
      rule: "The shared QUEST_REFUSAL values are declarations; the runtime rows are the actual toast events emitted by handleQuestAccept in the action cases. A helper string is not counted as a runtime confirmation unless a matching recipient/text row exists.",
      refusalPairs,
    },
  };
}

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
