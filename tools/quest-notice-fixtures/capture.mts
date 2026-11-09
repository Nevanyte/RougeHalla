/**
 * Canonical actual-source quest NOTICE/event witness (source-only, additive). Pinned linux/amd64 Node 22.23.4 container,
 * unmodified legacy TypeScript via createGameWorld / addPlayer / real step() 50 ms, declared setup/recipes only.
 *
 * Records the actual emitted events (all types, not only strings starting "Quest") with tick/time, recipient
 * (typed private seat id vs null room), action order and real side effects for six bounded notice producers:
 *   1 parcel-feedback             two real known Fetch offers, pre-accept/carry refusals, real death/drop, accepted
 *                                human steal, real turn-in, farm/GV notices around completion
 *   2 pickup-closed-guard        ordinary pickup against a real produced quest box under a declared NONCANONICAL
 *                                stale/closed runtime guard; private shared Over, no consumption; optional stale-carrier
 *                                silent sibling (also a labelled noncanonical guard)
 *   3 expiry-cohort-order        two published offers expire together while a discovery and a ready turn-in happen in
 *                                the same step; discovery -> aggregate expired -> completion ordering
 *   4 teleport-close-notices     direct invocation of the exported source teleportToColiseum producer (the one
 *                                settle() calls), real emitted queue recorded before step clears it; one aggregate notice
 *   5 run-end-silent-close       real final-rival sword deaths/settle/endRun with public and hidden offers; closure,
 *                                silence of quest-expiry notices, other real end-run events preserved
 *   6 camp-and-publication-closure  the real killMob whole-region producer/recheck, then a revealed impossible offer
 *                                that publishes and closes in the same step; publication precedes aggregated expiry
 *
 * Declared inputs (map/seed/positions/HP/loadouts and the lifecycle expireSoon convention) are trusted SETUP, never
 * outcomes. Helper/declared diagnostics are labelled separately from genuine runtime emissions. No expected acceptance,
 * progress, carrier, reward, ledger, death or toast is installed. No production source is modified.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const IMAGE = "node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const FORMAT = "rh-quest-notices-source/1";
const BASE = "dbd70f9d810330099b754281b70d511a60f62cf8";
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
  suddenDeathSeconds: 3600, mobs: true, signatures: false, quests: true, training: false, dummies: false,
  planSeconds: 0, pvpRules: false,
};
const PROFILE = "three-human-seats/quests/mobs/no-signatures/no-planning/no-training";
const RECORD_MODE = process.env.RH_QUEST_NOTICE_RECORD === "1";

const args = process.argv.slice(2);
const argMap: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) argMap[args[i]!] = args[i + 1] ?? "";
const mode = args[0];
if (mode !== "--write" && mode !== "--check") {
  console.error("usage: capture.mts --write <source.json> --repo <repo-root> | --check <source.json> --repo <repo-root>");
  process.exit(2);
}
const outPath = resolve(argMap["--write"] ?? argMap["--check"] ?? "");
const repoRoot = resolve(argMap["--repo"] ?? "/repo");
assert.equal(process.version, "v22.23.4");
assert.equal(process.platform, "linux");
assert.equal(process.arch, "x64");

const sha256 = (data: any): string => createHash("sha256").update(data).digest("hex");
const repoPath = (p: string): string => join(repoRoot, p);
const shaRepo = (p: string): string => sha256(readFileSync(repoPath(p)));
const load = (p: string): Promise<any> => import(pathToFileURL(repoPath(p)).href);
const sourceIssues: string[] = [];
/** Canonical captures assert structural bindings; mutant/control captures record an issue instead (the semantic
 * comparator is the control). No expected outcome is installed either way. */
const expectSource = (condition: any, message: string): void => {
  if (!condition) {
    if (RECORD_MODE) sourceIssues.push(message);
    else assert(condition, message);
  }
};

/** Exact JSON conversion: preserves finite numbers without rounding, rejects non-finite/unsupported values rather than
 * silently lossy-encoding them. Undefined optional fields are absent, as in the source event shape. */
function exact(v: any, path = "$"): any {
  if (v === null) return null;
  const t = typeof v;
  if (t === "string" || t === "boolean") return v;
  if (t === "number") {
    if (!Number.isFinite(v)) throw new Error("nonfinite number at " + path);
    return v;
  }
  if (Array.isArray(v)) return v.map((x, i) => exact(x, path + "[" + i + "]"));
  if (t === "object") {
    if (v instanceof Map || v instanceof Set) throw new Error("non-JSON " + (v.constructor?.name ?? "object") + " at " + path);
    const out: any = {};
    for (const key of Object.keys(v)) {
      if (v[key] === undefined) continue;
      out[key] = exact(v[key], path + "." + key);
    }
    return out;
  }
  throw new Error("unsupported " + t + " at " + path);
}

const sortPairs = (m: any): any[] => [...(m ?? new Map())].map(([k, v]: any) => [k, v]).sort(([a]: any, [b]: any) => (a < b ? -1 : a > b ? 1 : 0));
const byId = (a: any, b: any): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ------------------------------------------------------------------------------------------------- source module load
const S = await load("packages/shared/src/index.ts");
const mapgen = await load("packages/shared/src/mapgen.ts");
const gameplay = await load("packages/server/src/sim/gameplay.ts");
const stepMod = await load("packages/server/src/sim/step.ts");
const inputs = await load("packages/server/src/sim/inputs.ts");
const arena = await load("packages/server/src/sim/arena.ts");
const mobLife = await load("packages/server/src/sim/mobLife.ts");
const { mulberry32 } = S;
const { generateMap } = mapgen;
const { createGameWorld } = gameplay;
const { addPlayer, step } = stepMod;
const { enqueueClientMessage } = inputs;
const { teleportToColiseum } = arena;
const { killMob } = mobLife;

// ------------------------------------------------------------------------------------------------- world and views
function openWorld(): any {
  const map: any = generateMap(SEED, ATTEMPT, { decor: false });
  let uid = 0;
  const w: any = createGameWorld({
    seed: SEED, map, config: CONFIG, random: mulberry32(RANDOM_SEED), rewardSalt: REWARD_SALT,
    newItemUid: () => "U" + ++uid,
  }, { signatures: false, walkHints: false });
  for (let i = 0; i < PLAYERS.length; i++) addPlayer(w, "p" + i, PLAYERS[i]!.name, { faction: PLAYERS[i]!.faction as any });
  const boot = step(w, TICK_MS);
  assert.equal(w.state.phase, "active", "the declared raid started");
  assert.ok(w.quests, "the source quest runtime spawned at the raid start");
  return { w, boot };
}

function offerView(w: any): any[] {
  return [...w.quests.quests].map(([id, qt]: any) => ({
    id,
    def: qt.def.id,
    name: qt.def.name,
    giver: qt.def.giver,
    kind: qt.def.kind,
    count: qt.def.count,
    region: qt.def.region ?? null,
    elite: !!qt.def.elite,
    players: !!qt.def.players,
    tour: qt.def.tour ?? 0,
    published: !!qt.published,
    npcId: qt.npcId || null,
    finder: qt.finder || null,
    publishAt: qt.publishAt,
    at: { x: qt.s.x, y: qt.s.y },
    tokens: (qt.placement.tokens ?? []).map((p: any) => ({ x: p.x, y: p.y })),
    parcel: qt.placement.parcel ? { x: qt.placement.parcel.x, y: qt.placement.parcel.y } : null,
    containers: [...qt.containers],
    status: qt.s.status,
    expiresAt: qt.s.expiresAt,
    carrier: qt.s.carrier || null,
    lastCarrier: qt.lastCarrier || null,
    closedAt: qt.closedAt,
    doneBy: qt.s.doneBy || null,
    accepted: sortPairs(qt.s.accepted).map(([pid]: any) => pid),
    progress: sortPairs(qt.s.progress),
    visitedRegions: sortPairs(qt.s.visitedRegions),
  })).sort(byId);
}

function publicQuests(w: any): any[] {
  return [...w.state.quests].map(([id, q]: any) => ({
    id,
    def: q.def,
    x: q.x,
    y: q.y,
    status: q.status,
    doneBy: q.doneBy,
    expiresAt: q.expiresAt,
    carrier: q.carrier,
    accepted: sortPairs(q.accepted).map(([pid]: any) => pid),
    progress: sortPairs(q.progress),
    visitedRegions: sortPairs(q.visitedRegions),
  })).sort(byId);
}

function questBoxes(w: any): any[] {
  return [...w.state.containers].map(([id, c]: any) => ({ id, c }))
    .filter(({ c }: any) => c.items.length === 1 && String(c.items[0].def).startsWith("quest:"))
    .map(({ id, c }: any) => {
      const questId = String(c.items[0].def).slice("quest:".length);
      const qt = w.quests.quests.get(questId);
      return {
        id, questId, questDef: qt?.def.id ?? null, name: c.name, x: c.x, y: c.y, itemUid: c.items[0].uid,
        itemDef: c.items[0].def,
      };
    }).sort(byId);
}

function playersView(w: any): any[] {
  return PLAYERS.map((_p, i) => {
    const id = "p" + i;
    const s = w.state.players.get(id)!;
    const rt = w.players.get(id)!;
    const stats: any = {};
    for (const [type, n] of sortPairs(s.mobStats)) if (n) stats[type] = n;
    return {
      seat: i, actor: id, name: s.name, faction: s.faction,
      x: s.x, y: s.y, facing: s.facing, hp: s.hp, maxHp: s.maxHp, status: s.status,
      weapon0: s.weapon0, down: !!rt.down, resolved: !!rt.resolved,
      gv: { kills: rt.gv.kills, mobs: rt.gv.mobs, bounty: rt.gv.bounty, quest: rt.gv.quest, total: s.gv },
      stats,
      accepted: [...w.quests.quests].filter(([, qt]: any) => qt.s.accepted.get(id) === true).map(([qid]: any) => qid).sort(),
      carriedQuest: w.quests.carried.get(id) ?? null,
    };
  });
}

function liveInRegion(w: any, region: string): string[] {
  return [...w.mobs.keys()].filter((id: string) => {
    const rt = w.mobs.get(id);
    const s = w.state.mobs.get(id);
    return rt?.brain?.region === region && s?.status === "alive" && (s.kind === "mob" || s.kind === "elite");
  });
}

// ------------------------------------------------------------------------------------------------- runner
function runner(name: string, setup: any[] = [], method: any = null): any {
  const { w, boot } = openWorld();
  const actions: any[] = [];
  const frames: any[] = [];
  const events: any[] = [];
  const seen = new WeakSet<object>();
  let seq = 0;
  const push = (kind: string, extra: any): void => {
    actions.push({ tick: w.state.tick, seq: seq++, kind, ...extra });
  };
  const record = (arr: readonly any[], via: "step" | "inline-producer", producer?: string): void => {
    for (const ev of arr) {
      if (seen.has(ev)) continue;
      seen.add(ev);
      const copy = exact(ev);
      events.push({
        tick: w.state.tick, time: w.state.serverTime, via, ...(producer ? { producer } : {}), ...copy,
      });
    }
  };
  record(boot, "step");
  const stepOnce = (): any => {
    const out = step(w, TICK_MS);
    record(out, "step");
    return { tick: w.state.tick, time: w.state.serverTime, events: out };
  };
  const runSteps = (n: number): void => { for (let i = 0; i < n; i++) stepOnce(); };
  const inline = (producer: string, label: string, fn: () => void, extra: any = {}): void => {
    fn();
    record(w.events, "inline-producer", producer);
    push("inlineProducer", { producer, label, ...extra });
  };
  const enqueue = (actor: string, type: string, payload: any): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, type, payload), true, "the source accepted the " + type + " message");
    push("input", { actor, type, payload });
  };
  const place = (actor: string, x: number, y: number): void => {
    const s = w.state.players.get(actor)!;
    s.x = x; s.y = y; s.facing = 0;
    w.players.get(actor)!.history = [{ t: w.state.serverTime, x, y }];
    push("place", { actor, x, y, note: "declared setup position" });
  };
  const setHp = (actor: string, hp: number): void => {
    w.state.players.get(actor)!.hp = hp;
    push("hp", { actor, hp, note: "declared setup hp" });
  };
  const setWeapon = (actor: string, weapon: string): void => {
    const s = w.state.players.get(actor)!;
    s.weapon0 = weapon; s.weapon1 = ""; s.slot = 0;
    push("weapon", { actor, weapon, note: "declared setup loadout" });
  };
  const expireSoon = (questId: string, ms: number): void => {
    const qt = w.quests.quests.get(questId)!;
    qt.s.expiresAt = w.state.serverTime + ms;
    push("expireSoon", { quest: questId, ms, note: "declared lifecycle-convention deadline nudge (ORDER only, not natural duration)" });
  };
  const snap = (label: string): void => {
    frames.push({
      label, actionCount: actions.length, eventCount: events.length, tick: w.state.tick, time: w.state.serverTime,
      phase: w.state.phase, unknownQuests: w.state.unknownQuests, knownQuests: w.state.quests.size,
      gatesLocked: !!w.state.gatesLocked, idCounter: w.idCounter,
      quests: publicQuests(w), offers: offerView(w), boxes: questBoxes(w), carried: sortPairs(w.quests.carried),
      players: playersView(w),
    });
  };
  const team = PLAYERS.map((_p, i) => {
    const s = w.state.players.get("p" + i)!;
    return {
      seat: i, alias: "p" + i, sourceActorId: "p" + i, name: s.name, faction: s.faction,
      seatLabel: "human-seat-" + i, note: "alias is a trusted fixture binding only; it is not ownership or capability",
      birth: { x: s.x, y: s.y, hp: s.hp, maxHp: s.maxHp, weapon0: s.weapon0 },
    };
  });
  const input = {
    name, profile: PROFILE, base: BASE,
    map: { seed: SEED, attempt: ATTEMPT, decor: false, note: "declared generated map; the actual map is regenerated by the same source call" },
    config: CONFIG, modules: { signatures: false, walkHints: false },
    seeds: { random: RANDOM_SEED, rewardSalt: REWARD_SALT },
    actors: team,
    setup,
    ...(method !== null ? { method } : {}),
  };
  const output = (script: any, facts: any): any => ({ input, script, actions, events, frames, facts });
  snap("start");
  return { w, actions, frames, events, push, stepOnce, runSteps, inline, enqueue, place, setHp, setWeapon, expireSoon, snap, output };
}

const cases: any[] = [];
const offersOf = (r: any): any[] => offerView(r.w);
const indexWhere = (r: any, pred: (e: any) => boolean): number => r.events.findIndex((e: any) => pred(e));
const eventsAt = (r: any, tick: number): any[] => r.events.filter((e: any) => e.tick === tick);
const shortEvent = (e: any): any => e ? {
  tick: e.tick, time: e.time, via: e.via, type: e.type,
  to: e.type === "toast" ? e.to : null, text: e.text ?? null,
  ...(e.id ? { id: e.id } : {}),
  ...(e.fx ? { fx: e.fx } : {}),
  ...(e.reason ? { reason: e.reason, amount: e.amount } : {}),
  ...(e.type === "resolved" ? { outcome: e.result?.outcome, place: e.result?.place, gv: e.result?.gv } : {}),
  ...(e.type === "questReveal" ? { quest: e.quest } : {}),
} : null;

// ------------------------------------------------------------------------------------------------- 1 parcel-feedback
function caseParcelFeedback(): any {
  const r = runner("parcel-feedback", [
      "two genuine known Fetch offers selected from the source roster",
      "real quest acceptance and pickups through the ordinary input queue",
      "the carrier is killed by a real sword attack (set weapon/hp/position are declared setup only)",
      "no carrier/reward/death/progress is installed; every pickup, drop, steal, turn-in and notice is source-produced",
  ]);
  r.snap("start");
  const all = offersOf(r);
  const A = all.find((o: any) => o.def === "banner-holy");
  const B = all.find((o: any) => o.def === "banner-frost");
  assert.ok(A && B, "the two admitted known Fetch offers exist");
  const ticks: any = {};
  r.place("p0", A.parcel.x, A.parcel.y);
  r.enqueue("p0", "pickup", { containerId: A.containers[0] });
  ticks.beforeAccept = r.stepOnce().tick;
  r.snap("refused-before-accept");
  r.place("p0", A.at.x, A.at.y);
  r.enqueue("p0", "questAccept", { quest: A.id });
  ticks.acceptP0 = r.stepOnce().tick;
  r.place("p2", A.at.x, A.at.y);
  r.enqueue("p2", "questAccept", { quest: A.id });
  r.stepOnce();
  r.snap("accepted");
  r.place("p0", A.parcel.x, A.parcel.y);
  r.enqueue("p0", "pickup", { containerId: A.containers[0] });
  ticks.pickupA = r.stepOnce().tick;
  r.snap("first-parcel-picked");
  r.place("p0", B.at.x, B.at.y);
  r.enqueue("p0", "questAccept", { quest: B.id });
  r.stepOnce();
  r.place("p0", B.parcel.x, B.parcel.y);
  r.enqueue("p0", "pickup", { containerId: B.containers[0] });
  ticks.carryRefusal = r.stepOnce().tick;
  r.snap("second-parcel-carry-refused");
  r.setWeapon("p1", "sword");
  r.setHp("p0", 1);
  const p0s = r.w.state.players.get("p0")!;
  r.place("p1", p0s.x - 32, p0s.y);
  r.enqueue("p1", "attack", { a: 0 });
  let guard = 0;
  let deathTick = -1;
  while (!r.w.players.get("p0")!.down && guard < 20) {
    const t = r.stepOnce().tick;
    if (r.w.players.get("p0")!.down) deathTick = t;
    guard++;
  }
  r.enqueue("p1", "release", { a: 0 });
  r.stepOnce();
  expectSource(!!r.w.players.get("p0")!.down, "the carrier died to the real sword attack");
  ticks.death = deathTick;
  r.snap("carrier-down");
  const dropped = questBoxes(r.w).find((b: any) => b.questId === A.id);
  expectSource(!!dropped, "the carrier's real parcel dropped at the body");
  assert.ok(dropped, "a dropped parcel exists for the steal action");
  r.place("p2", dropped.x, dropped.y);
  r.enqueue("p2", "pickup", { containerId: dropped.id });
  ticks.steal = r.stepOnce().tick;
  r.snap("stolen");
  r.place("p2", A.at.x, A.at.y);
  ticks.turnIn = r.stepOnce().tick;
  r.snap("turned-in");
  r.stepOnce();
  r.snap("lingered");
  const at = (tick: number, pred: (e: any) => boolean): number => indexWhere(r, (e: any) => e.tick === tick && pred(e));
  const e = r.events;
  const beforeAcceptIdx = at(ticks.beforeAccept, (x: any) => x.type === "toast" && x.to === "p0" && x.text.startsWith("Accept "));
  const pickupIdx = at(ticks.pickupA, (x: any) => x.type === "toast" && x.to === "p0" && x.text.startsWith("Picked up:"));
  const carryIdx = at(ticks.carryRefusal, (x: any) => x.type === "toast" && x.to === "p0" && x.text === "you can carry one quest item");
  const dropIdx = at(ticks.death, (x: any) => x.type === "toast" && x.to === null && x.text.includes(" dropped parcel: "));
  const stolenIdx = at(ticks.steal, (x: any) => x.type === "toast" && x.to === null && x.text.includes(" stole parcel: "));
  const privatePickedIdx = at(ticks.steal, (x: any) => x.type === "toast" && x.to === "p2" && x.text.startsWith("Picked up:"));
  const gvIdx = at(ticks.turnIn, (x: any) => x.type === "gv" && x.id === "p2" && x.reason === "quest");
  const privateDoneIdx = at(ticks.turnIn, (x: any) => x.type === "toast" && x.to === "p2" && x.text.startsWith("Quest complete:"));
  const roomDoneIdx = at(ticks.turnIn, (x: any) => x.type === "toast" && x.to === null && x.text.includes(" completed quest: "));
  const farmIdx = (() => {
    if (gvIdx < 0 || privateDoneIdx < 0) return -1;
    for (let i = gvIdx + 1; i < privateDoneIdx; i++) if (e[i]!.type === "toast" && e[i]!.to === "p2") return i;
    return -1;
  })();
  expectSource(beforeAcceptIdx >= 0, "the pre-accept pickup emitted the private accept-first refusal");
  expectSource(pickupIdx >= 0, "the first parcel pickup emitted its private picked-up notice");
  expectSource(carryIdx >= 0, "the second parcel pickup emitted the private carry-limit refusal");
  expectSource(dropIdx >= 0 && stolenIdx >= 0 && privatePickedIdx >= 0, "drop, steal and private pickup were all emitted");
  expectSource(dropIdx < stolenIdx && stolenIdx < privatePickedIdx, "dropped -> room stolen -> private picked ordering");
  expectSource(gvIdx >= 0 && farmIdx >= 0 && privateDoneIdx >= 0 && roomDoneIdx >= 0, "complete reward/farm/private/room notices all emitted");
  expectSource(gvIdx < farmIdx && farmIdx < privateDoneIdx && privateDoneIdx < roomDoneIdx, "GV -> farm stat -> private complete -> room complete ordering");
  const BboxBefore = r.frames.find((f: any) => f.label === "first-parcel-picked")!.boxes.find((b: any) => b.id === B.containers[0]);
  const BboxAfter = r.frames.find((f: any) => f.label === "second-parcel-carry-refused")!.boxes.find((b: any) => b.id === B.containers[0]);
  expectSource(!!BboxBefore && !!BboxAfter && BboxBefore.itemUid === BboxAfter.itemUid, "the carry-limit refusal consumed nothing");
  return r.output({
    selected: {
      A: { id: A.id, def: A.def, name: A.name, kind: A.kind, giver: A.giver, at: A.at, parcel: A.parcel, box: A.containers[0] },
      B: { id: B.id, def: B.def, name: B.name, kind: B.kind, giver: B.giver, at: B.at, parcel: B.parcel, box: B.containers[0] },
    },
    bindings: { p0: "carrier / first picker (human seat 0)", p1: "sword killer (human seat 1)", p2: "accepted other human / stealer / turn-in (human seat 2)" },
    note: "role labels are fixture bindings, not ownership or capability",
  }, {
    ticks,
    indices: { beforeAcceptIdx, pickupIdx, carryIdx, dropIdx, stolenIdx, privatePickedIdx, gvIdx, farmIdx, privateDoneIdx, roomDoneIdx },
    beforeAcceptRefusal: shortEvent(e[beforeAcceptIdx]),
    firstPickup: shortEvent(e[pickupIdx]),
    carryLimitRefusal: shortEvent(e[carryIdx]),
    dropped: shortEvent(e[dropIdx]),
    stolen: shortEvent(e[stolenIdx]),
    privatePicked: shortEvent(e[privatePickedIdx]),
    completion: [shortEvent(e[gvIdx]), shortEvent(e[farmIdx]), shortEvent(e[privateDoneIdx]), shortEvent(e[roomDoneIdx])],
    order: {
      droppedBeforeStolenBeforePrivatePicked: dropIdx >= 0 && dropIdx < stolenIdx && stolenIdx < privatePickedIdx,
      gvBeforeFarmBeforePrivateBeforeRoom: gvIdx >= 0 && gvIdx < farmIdx && farmIdx < privateDoneIdx && privateDoneIdx < roomDoneIdx,
    },
    carryRefusalConsumedNothing: !!BboxBefore && !!BboxAfter && BboxBefore.itemUid === BboxAfter.itemUid,
    finalQuestStatus: r.w.quests.quests.get(A.id)!.s.status,
    finalDoneBy: r.w.quests.quests.get(A.id)!.s.doneBy,
  });
}

// ------------------------------------------------------------------------------------------------- 2 pickup-closed-guard
function casePickupClosedGuard(): any {
  const r = runner("pickup-closed-guard", [
      "real produced quest box from a published Fetch offer",
      "NONCANONICAL guard setup: the runtime status is set directly to expired while the real box stays in the world; ordinary retirement removes the box, so this is a guard fixture, not normal post-retirement state",
      "sibling: NONCANONICAL stale-carrier guard: an already-accepted player's carrier is set directly while the real box stays; ordinary carrier state has no box",
  ]);
  r.snap("start");
  const all = offersOf(r);
  const A = all.find((o: any) => o.def === "banner-holy");
  assert.ok(A, "a published Fetch offer with a real produced box");
  const boxId = A.containers[0];
  const before = r.w.state.containers.get(boxId);
  assert.ok(before, "the source produced the quest box");
  const qt = r.w.quests.quests.get(A.id)!;
  qt.s.status = "expired";
  r.push("noncanonicalSetup", { setup: "staleClosedStatus", quest: A.id, status: qt.s.status, box: boxId, note: "direct status write; NOT ordinary retirement (retire removes the box)" });
  r.snap("stale-closed-setup");
  r.place("p0", before.x, before.y);
  r.enqueue("p0", "pickup", { containerId: boxId });
  const ticks: any = { staleClosed: r.stepOnce().tick };
  r.snap("stale-closed-refused");
  const overIdx = indexWhere(r, (e: any) => e.tick === ticks.staleClosed && e.type === "toast" && e.to === "p0" && e.text === "That quest is over");
  const afterClosed = r.w.state.containers.get(boxId);
  expectSource(overIdx >= 0, "the stale/closed pickup emitted the private shared Over notice");
  expectSource(!!afterClosed && afterClosed.items[0].uid === before.items[0].uid, "the stale/closed pickup consumed nothing");
  qt.s.status = "open";
  r.push("noncanonicalSetup", { setup: "restoreOpenForSibling", quest: A.id, status: qt.s.status, box: boxId, note: "declared guard-fixture restoration" });
  r.place("p0", A.at.x, A.at.y);
  r.enqueue("p0", "questAccept", { quest: A.id });
  r.stepOnce();
  r.snap("stale-carrier-accepted");
  qt.s.carrier = "p1";
  r.push("noncanonicalSetup", { setup: "staleCarrier", quest: A.id, carrier: qt.s.carrier, box: boxId, note: "direct carrier write with the box retained; NOT ordinary carrier state" });
  r.snap("stale-carrier-setup");
  r.place("p0", before.x, before.y);
  r.enqueue("p0", "pickup", { containerId: boxId });
  ticks.staleCarrier = r.stepOnce().tick;
  r.snap("stale-carrier-silent");
  const carrierStepEvents = eventsAt(r, ticks.staleCarrier);
  const afterCarrier = r.w.state.containers.get(boxId);
  expectSource(carrierStepEvents.length === 0, "the existing-carrier guard was silent");
  expectSource(!!afterCarrier && afterCarrier.items[0].uid === before.items[0].uid, "the existing-carrier guard consumed nothing");
  return r.output({
    noncanonical: true,
    selected: { A: { id: A.id, def: A.def, name: A.name, kind: A.kind, box: boxId, at: A.at } },
    bindings: { p0: "picker (human seat 0)" },
    noncanonicalBoundary: "both guard scenarios write runtime state directly; they are not ordinary gameplay outcomes and are labelled in every action/fact",
  }, {
    ticks,
    staleClosed: {
      status: "expired",
      event: shortEvent(r.events[overIdx]),
      privateSharedOver: overIdx >= 0,
      boxStillPresent: !!afterClosed,
      sameItemUid: !!afterClosed && afterClosed.items[0].uid === before.items[0].uid,
      noncanonical: true,
    },
    staleCarrierSilent: {
      carrier: qt.s.carrier,
      eventCountInStep: carrierStepEvents.length,
      events: carrierStepEvents.map(shortEvent),
      boxStillPresent: !!afterCarrier,
      sameItemUid: !!afterCarrier && afterCarrier.items[0].uid === before.items[0].uid,
      noncanonical: true,
    },
    finalStatus: qt.s.status,
  });
}

// ------------------------------------------------------------------------------------------------- 3 expiry-cohort-order
function caseExpiryCohortOrder(): any {
  const r = runner("expiry-cohort-order", [
      "real collect acceptance and pickups to make a ready turn-in",
      "two published offers' deadlines nudged to the same next step with the admitted lifecycle expireSoon convention (ORDER only; giver8 is the independent actual 300-second timing witness)",
      "a hidden offer discovery in the same step; no progress/reward is installed",
  ]);
  r.snap("start");
  const all = offersOf(r);
  const A = all.find((o: any) => o.def === "shards-frost");
  const C = all.find((o: any) => o.def === "grand-tour");
  const D = all.find((o: any) => o.def === "headhunter");
  const H = all.find((o: any) => o.def === "long-haul");
  assert.ok(A && C && D && H, "the admitted collect, two published offers and hidden discovery offer exist");
  const ticks: any = {};
  r.place("p0", A.at.x, A.at.y);
  r.enqueue("p0", "questAccept", { quest: A.id });
  r.stepOnce();
  r.snap("accepted");
  for (let i = 0; i < A.count; i++) {
    const token = A.tokens[i];
    r.place("p0", token.x, token.y);
    r.enqueue("p0", "pickup", { containerId: A.containers[i] });
    r.stepOnce();
  }
  r.snap("collected");
  r.expireSoon(C.id, 50);
  r.expireSoon(D.id, 50);
  r.place("p0", A.at.x, A.at.y);
  r.place("p1", H.at.x, H.at.y);
  ticks.target = r.stepOnce().tick;
  r.snap("target-step");
  const targetEvents = eventsAt(r, ticks.target);
  const targetIndices = r.events.map((e: any, i: number) => (e.tick === ticks.target ? i : -1)).filter((i: number) => i >= 0);
  const gidx = (pred: (e: any) => boolean): number => indexWhere(r, (e: any) => e.tick === ticks.target && pred(e));
  const revealIdx = gidx((e: any) => e.type === "questReveal" && e.to === "p1" && e.quest?.id === H.id);
  const discoveryIdx = gidx((e: any) => e.type === "toast" && e.to === "p1" && e.text.startsWith("Quest discovered:"));
  const aggregateIdx = gidx((e: any) => e.type === "toast" && e.to === null && e.text === "2 quests expired");
  const gvIdx = gidx((e: any) => e.type === "gv" && e.id === "p0" && e.reason === "quest");
  const privateDoneIdx = gidx((e: any) => e.type === "toast" && e.to === "p0" && e.text.startsWith("Quest complete:"));
  const roomDoneIdx = gidx((e: any) => e.type === "toast" && e.to === null && e.text.includes(" completed quest: "));
  const farmIdx = (() => {
    if (gvIdx < 0 || privateDoneIdx < 0) return -1;
    for (let i = gvIdx + 1; i < privateDoneIdx; i++) if (r.events[i]!.type === "toast" && r.events[i]!.to === "p0") return i;
    return -1;
  })();
  expectSource(revealIdx >= 0 && discoveryIdx >= 0 && revealIdx < discoveryIdx, "the finder-private reveal then discovery notice were emitted in the target step");
  expectSource(aggregateIdx >= 0, "the two same-step expiries were aggregated");
  expectSource(gvIdx >= 0 && farmIdx >= 0 && privateDoneIdx >= 0 && roomDoneIdx >= 0, "the ready turn-in emitted its completion notices");
  expectSource(discoveryIdx < aggregateIdx && aggregateIdx < gvIdx, "discovery -> aggregated-expired -> completion ordering");
  expectSource(gvIdx < farmIdx && farmIdx < privateDoneIdx && privateDoneIdx < roomDoneIdx, "completion reward/farm/private/room order");
  const hiddenNames = all.filter((o: any) => !o.published).map((o: any) => o.name);
  const nullToasts = targetEvents.filter((e: any) => e.type === "toast" && e.to === null);
  const leaked = nullToasts.filter((e: any) => hiddenNames.some((n: string) => e.text.includes(n)));
  expectSource(leaked.length === 0, "no hidden quest name is present in a public notice");
  expectSource(targetEvents.some((e: any) => e.type === "toast" && e.to === null && e.text.startsWith("name0 completed quest: ")), "the room completion notice names the published quest");
  const startUnknown = r.frames[0]!.unknownQuests;
  const targetFrame = r.frames.find((f: any) => f.label === "target-step")!;
  expectSource(startUnknown === targetFrame.unknownQuests && targetFrame.unknownQuests === 10, "the hidden unknown count is retained/unchanged by the discovery");
  const HQ = r.w.quests.quests.get(H.id)!;
  expectSource(!HQ.published && HQ.s.status === "open", "the discovered hidden offer stayed private until its own head start");
  return r.output({
    selected: {
      A: { id: A.id, def: A.def, name: A.name, kind: A.kind, giver: A.giver, at: A.at, count: A.count, tokens: A.tokens.slice(0, A.count), boxes: A.containers.slice(0, A.count) },
      C: { id: C.id, def: C.def, name: C.name, at: C.at },
      D: { id: D.id, def: D.def, name: D.name, at: D.at },
      H: { id: H.id, def: H.def, name: H.name, at: H.at, finder: "p1", parcel: H.parcel },
    },
    bindings: { p0: "collector / ready turn-in (human seat 0)", p1: "hidden discoverer (human seat 1)", p2: "idle human seat (human seat 2)" },
    note: "the discovery does not make the hidden offer actionable; C/D deadlines are a declared order-only nudge",
  }, {
    ticks,
    targetEvents: targetEvents.map((e: any, i: number) => ({ index: targetIndices[i], ...shortEvent(e) })),
    indices: { revealIdx, discoveryIdx, aggregateIdx, gvIdx, farmIdx, privateDoneIdx, roomDoneIdx },
    aggregate: shortEvent(r.events[aggregateIdx]),
    discovery: {
      reveal: r.events[revealIdx] ?? null,
      toast: shortEvent(r.events[discoveryIdx]),
      finder: "p1",
      publicSameStep: false,
      unknownUnchanged: startUnknown,
    },
    hiddenLeakInPublicNotices: leaked.map(shortEvent),
    statuses: { C: r.w.quests.quests.get(C.id)!.s.status, D: r.w.quests.quests.get(D.id)!.s.status, A: r.w.quests.quests.get(A.id)!.s.status, H: HQ.s.status, HPublished: HQ.published },
    order: {
      discoveryBeforeAggregateBeforeCompletion: discoveryIdx >= 0 && aggregateIdx >= 0 && gvIdx >= 0 && discoveryIdx < aggregateIdx && aggregateIdx < gvIdx,
      completionOrder: gvIdx >= 0 && farmIdx >= 0 && privateDoneIdx >= 0 && roomDoneIdx >= 0 && gvIdx < farmIdx && farmIdx < privateDoneIdx && privateDoneIdx < roomDoneIdx,
      sameStep: revealIdx >= 0 && gvIdx >= 0 && r.events[revealIdx]!.tick === r.events[gvIdx]!.tick,
    },
  });
}

// ------------------------------------------------------------------------------------------------- 4 teleport-close-notices
function caseTeleportCloseNotices(): any {
  const r = runner("teleport-close-notices", [
    "two real accepted published offers",
    "the initial hidden offers stay hidden",
    "the emitted queue is recorded immediately after the producer, before the next step clears it",
  ], "direct invocation of the exported source teleportToColiseum producer (the one settle() calls), not only the quest hook");
  r.snap("start");
  const all = offersOf(r);
  const G = all.find((o: any) => o.def === "grand-tour");
  const Hh = all.find((o: any) => o.def === "headhunter");
  assert.ok(G && Hh, "two published offers exist for real acceptance");
  for (const o of [G, Hh]) {
    r.place("p0", o.at.x, o.at.y);
    r.enqueue("p0", "questAccept", { quest: o.id });
    r.stepOnce();
  }
  r.snap("accepted");
  const queueStart = r.events.length;
  const initial = offersOf(r);
  const publishedOpenBefore = initial.filter((o: any) => o.published && o.status === "open").length;
  const hiddenBefore = initial.filter((o: any) => !o.published);
  const unknownBefore = r.w.state.unknownQuests;
  r.inline("teleportToColiseum", "direct source producer invocation", () => teleportToColiseum(r.w), {
    note: "the producer itself runs its real move/immunity/gate/fx and its teleported hook (quests closeAll(true))",
  });
  const queue = r.events.slice(queueStart);
  r.snap("producer-queue");
  const stepTick = r.stepOnce().tick;
  r.snap("after-teleport-step");
  const queueToasts = queue.filter((e: any) => e.type === "toast");
  const aggregate = queueToasts[0] ?? null;
  const expectedText = publishedOpenBefore + " quests expired";
  expectSource(queueToasts.length === 1, "exactly one aggregate public notice");
  expectSource(!!aggregate && aggregate.to === null && aggregate.text === expectedText, "the aggregate room notice counts every published open offer");
  expectSource(queue.some((e: any) => e.type === "fx" && e.fx?.kind === "teleport"), "the producer's own teleport fx is in the same real queue");
  const hiddenLeak = queue.filter((e: any) => typeof e.text === "string" && hiddenBefore.some((o: any) => e.text.includes(o.name)));
  expectSource(hiddenLeak.length === 0, "no hidden quest definition appears in the emitted queue");
  const final = offersOf(r);
  const hiddenAfter = final.filter((o: any) => !o.published);
  const expiredAfter = final.filter((o: any) => o.status === "expired");
  expectSource(r.w.state.unknownQuests === 0 && hiddenAfter.length === 0, "hidden offers were deleted silently and the unknown count fell");
  expectSource(expiredAfter.length === publishedOpenBefore, "every published open offer closed to expired");
  return r.output({
    selected: { accepted: [G.def, Hh.def], hiddenOffers: hiddenBefore.length, publishedOpenBefore },
    bindings: { p0: "accepting human seat 0", p1: "idle human seat 1", p2: "idle human seat 2" },
    method: "teleportToColiseum(r.w) invoked directly between steps; its real world.events queue was read immediately BEFORE the next step cleared it",
  }, {
    queueStart,
    queue: queue.map(shortEvent),
    queueEventsFull: queue,
    queueToasts: queueToasts.length,
    aggregate,
    expectedAggregateText: expectedText,
    fxTeleport: queue.some((e: any) => e.type === "fx" && e.fx?.kind === "teleport"),
    hiddenBefore: hiddenBefore.map((o: any) => ({ id: o.id, def: o.def, name: o.name })),
    hiddenLeakInQueue: hiddenLeak.map(shortEvent),
    unknownBefore,
    unknownAfter: r.w.state.unknownQuests,
    publishedOpenBefore,
    expiredAfter: expiredAfter.length,
    hiddenAfter: hiddenAfter.length,
    stepTick,
    sourceHook: "quests.ts chainHook(world, teleported, closeAll true) - see profile.sourceAnchors for the exact line",
  });
}

// ------------------------------------------------------------------------------------------------- 5 run-end-silent-close
function caseRunEndSilentClose(): any {
  const r = runner("run-end-silent-close", [
    "two real accepted published offers remain open",
    "the final two rivals die to real sword attacks (weapon/hp/positions are declared setup only)",
    "the source settle() -> endRun() -> runEnded hook closes every open offer with closeAll(false)",
  ]);
  r.snap("start");
  const all = offersOf(r);
  const G = all.find((o: any) => o.def === "grand-tour");
  const Hh = all.find((o: any) => o.def === "headhunter");
  assert.ok(G && Hh, "two published offers exist for real acceptance");
  for (const o of [G, Hh]) {
    r.place("p0", o.at.x, o.at.y);
    r.enqueue("p0", "questAccept", { quest: o.id });
    r.stepOnce();
  }
  r.snap("accepted");
  const publishedOpenBefore = offersOf(r).filter((o: any) => o.published && o.status === "open").length;
  const hiddenBefore = offersOf(r).filter((o: any) => !o.published);
  const unknownBefore = r.w.state.unknownQuests;
  r.setWeapon("p0", "sword");
  r.setHp("p0", 1000);
  const duel = (victim: string): number => {
    r.setHp(victim, 1);
    const v = r.w.state.players.get(victim)!;
    r.place("p0", v.x - 32, v.y);
    r.enqueue("p0", "attack", { a: 0 });
    let n = 0;
    while (!r.w.players.get(victim)!.down && n < 20) { r.stepOnce(); n++; }
    r.enqueue("p0", "release", { a: 0 });
    return n;
  };
  const firstSteps = duel("p1");
  const ticks: any = { firstDown: r.w.state.tick };
  r.snap("first-down");
  expectSource(r.w.state.phase === "active", "one rival down leaves the contested run active");
  const secondSteps = duel("p2");
  ticks.runEnd = r.w.state.tick;
  r.snap("run-ended");
  expectSource(r.w.state.phase === "ended", "the final rival death ended the run");
  r.runSteps(2);
  r.snap("lingered");
  const endEvents = r.events.map((e: any, i: number) => ({ index: i, e })).filter(({ e }: any) => e.tick === ticks.runEnd)
    .map(({ index, e }: any) => ({ index, ...shortEvent(e) }));
  const endRaw = r.events.filter((e: any) => e.tick === ticks.runEnd);
  const expiryToasts = r.events.filter((e: any) => e.type === "toast" && /quest expired|quests expired/i.test(e.text ?? ""));
  const endToasts = endRaw.filter((e: any) => e.type === "toast");
  expectSource(expiryToasts.length === 0, "the silent run-end closure emitted no quest-expiry notice");
  expectSource(endToasts.length === 0, "the run-end step emitted no toast at all");
  expectSource(endRaw.some((e: any) => e.type === "raidEnded"), "the real raidEnded event is preserved");
  expectSource(endRaw.some((e: any) => e.type === "fx" && e.fx?.kind === "victory"), "the real victory fx is preserved");
  expectSource(endRaw.some((e: any) => e.type === "resolved" && e.id === "p2"), "the final rival's real resolved event is preserved");
  expectSource(endRaw.some((e: any) => e.type === "resolved" && e.id === "p0"), "the winner's real resolved event is preserved");
  expectSource(endRaw.some((e: any) => e.type === "gv" && e.id === "p0" && e.reason === "kill"), "the real final kill GV is preserved");
  const final = offersOf(r);
  expectSource(r.w.state.unknownQuests === 0 && final.filter((o: any) => !o.published).length === 0, "hidden offers were deleted silently");
  expectSource(final.filter((o: any) => o.status === "expired").length === publishedOpenBefore, "every published open offer closed to expired");
  return r.output({
    selected: { accepted: [G.def, Hh.def], publishedOpenBefore, hiddenOffers: hiddenBefore.length, winner: "p0" },
    bindings: { p0: "killer / winner (human seat 0)", p1: "first final rival (human seat 1)", p2: "last final rival (human seat 2)" },
    method: "real final-rival sword attacks -> source settle()/endRun() -> quests runEnded hook closeAll(false)",
  }, {
    ticks,
    firstDuelSteps: firstSteps,
    secondDuelSteps: secondSteps,
    endEvents,
    expiryNotices: expiryToasts.map(shortEvent),
    endStepToasts: endToasts.map(shortEvent),
    phase: r.w.state.phase,
    winner: r.w.state.winner,
    unknownBefore,
    unknownAfter: r.w.state.unknownQuests,
    publishedOpenBefore,
    expiredAfter: final.filter((o: any) => o.status === "expired").length,
    hiddenAfter: final.filter((o: any) => !o.published).length,
    silent: expiryToasts.length === 0 && endToasts.length === 0,
  });
}

// ------------------------------------------------------------------------------------------------- 6 camp-and-publication-closure
function caseCampPublicationClosure(): any {
  const r = runner("camp-and-publication-closure", [
    "p0 hp 1000 is declared setup so the finder can stand through the head-start waits",
    "the expireSoon nudge is the admitted lifecycle ORDER convention, not a natural-duration claim",
  ], [
    "inline source killMob calls wipe every live mob of a whole region (the producer the ledger uses); this is a declared inline producer call, not ordinary player swings",
    "a hidden region-cull offer is revealed, publishes through the real questSystem publication path and is immediately closed as impossible",
    "a second, already-published offer's deadline is nudged to the same publication step so the aggregated count is exercised",
  ]);
  r.snap("start");
  const all = offersOf(r);
  const A = all.find((o: any) => o.def === "cull-fire");
  const B = all.find((o: any) => o.def === "cull-frost");
  const C = all.find((o: any) => o.def === "grand-tour");
  assert.ok(A && B && C, "the hidden region culls and a published offer exist");
  r.setHp("p0", 1000);
  const ticks: any = {};
  r.place("p0", A.at.x, A.at.y);
  ticks.revealFire = r.stepOnce().tick;
  r.snap("revealed-cull-fire");
  r.runSteps(80);
  ticks.publishedFire = r.w.state.tick;
  r.snap("published-cull-fire");
  const fireMobs = liveInRegion(r.w, "fire");
  expectSource(fireMobs.length > 0, "the fire region has live mobs before the wipe");
  const fireLiveBefore = fireMobs.length;
  r.inline("killMob", "regionWipe-fire", () => {
    for (const id of fireMobs) {
      const c = { kind: "mob", id, s: r.w.state.mobs.get(id), rt: r.w.mobs.get(id) };
      killMob(r.w, c, [], [], c.s.hp);
    }
  }, { region: "fire", mobs: fireMobs.length, creditedKiller: null, note: "inline source whole-region producer; not ordinary player swings" });
  const fireLiveAfter = liveInRegion(r.w, "fire").length;
  expectSource(fireLiveAfter === 0, "the whole fire region is dead after the real killMob producer");
  ticks.fireWipe = r.w.state.tick;
  r.stepOnce();
  ticks.fireClosed = r.w.state.tick;
  r.snap("camp-wiped-fire-closed");
  const fireExpiryIdx = indexWhere(r, (e: any) => e.tick === ticks.fireClosed && e.type === "toast" && e.to === null && e.text === "Quest expired: " + A.name);
  const fireExpiryToasts = eventsAt(r, ticks.fireClosed).filter((e: any) => e.type === "toast" && e.to === null && e.text.startsWith("Quest expired:"));
  expectSource(fireExpiryIdx >= 0, "the recheck closed the published cull offer with one named expiry");
  expectSource(fireExpiryToasts.length === 1, "the single published cull expiry was named, not aggregated");
  r.place("p0", B.at.x, B.at.y);
  ticks.revealFrost = r.stepOnce().tick;
  r.snap("revealed-cull-frost");
  r.enqueue("p0", "questAccept", { quest: B.id });
  ticks.acceptAttempt = r.stepOnce().tick;
  r.snap("accept-refused-before-publication");
  const acceptIdx = indexWhere(r, (e: any) => e.tick === ticks.acceptAttempt && e.type === "toast" && e.to === "p0" && e.text === "That quest is over");
  expectSource(acceptIdx >= 0, "the finder-private hidden offer is nonactionable before publication");
  r.runSteps(78);
  r.expireSoon(C.id, 50);
  const frostMobs = liveInRegion(r.w, "frost");
  expectSource(frostMobs.length > 0, "the frost region has live mobs before the wipe");
  const frostLiveBefore = frostMobs.length;
  r.inline("killMob", "regionWipe-frost", () => {
    for (const id of frostMobs) {
      const c = { kind: "mob", id, s: r.w.state.mobs.get(id), rt: r.w.mobs.get(id) };
      killMob(r.w, c, [], [], c.s.hp);
    }
  }, { region: "frost", mobs: frostMobs.length, creditedKiller: null, note: "inline source whole-region producer; not ordinary player swings" });
  const frostLiveAfter = liveInRegion(r.w, "frost").length;
  expectSource(frostLiveAfter === 0, "the whole frost region is dead before the impossible publication");
  ticks.publication = r.stepOnce().tick;
  r.snap("publication-closed");
  const pubIdx = indexWhere(r, (e: any) => e.tick === ticks.publication && e.type === "toast" && e.to === null && e.text.includes(" revealed quest: " + B.name));
  const aggIdx = indexWhere(r, (e: any) => e.tick === ticks.publication && e.type === "toast" && e.to === null && e.text === "2 quests expired");
  const revealFrostIdx = indexWhere(r, (e: any) => e.tick === ticks.revealFrost && e.type === "questReveal" && e.to === "p0" && e.quest?.id === B.id);
  const discoveredFrostIdx = indexWhere(r, (e: any) => e.tick === ticks.revealFrost && e.type === "toast" && e.to === "p0" && e.text.startsWith("Quest discovered:"));
  expectSource(revealFrostIdx >= 0 && discoveredFrostIdx > revealFrostIdx, "the finder got the private questReveal then the discovery toast in the same step");
  expectSource(pubIdx >= 0, "the impossible offer still published through the real publication path");
  expectSource(pubIdx >= 0 && aggIdx >= 0 && pubIdx < aggIdx, "public publication precedes the aggregated expiry");
  const BQ = r.w.quests.quests.get(B.id)!;
  const CQ = r.w.quests.quests.get(C.id)!;
  expectSource(BQ.published && BQ.s.status === "expired", "the published impossible offer closed immediately");
  expectSource(CQ.s.status === "expired", "the nudged published offer expired in the same step");
  const aggEvent = aggIdx >= 0 ? r.events[aggIdx] : null;
  const sameStepClosed = aggEvent ? offersOf(r).filter((o: any) => o.status === "expired" && o.closedAt === aggEvent.time).map((o: any) => o.def) : [];
  expectSource(aggEvent !== null && sameStepClosed.length === 2, "the same-step aggregated count is exactly the two closed offers");
  expectSource(aggEvent !== null && aggEvent.text === "2 quests expired", "the same-step aggregation replaced per-quest spam");
  const hiddenAtPublication = offersOf(r).filter((o: any) => !o.published).map((o: any) => o.name);
  const publicLeak = aggEvent ? r.events.filter((e: any) => e.tick === ticks.publication && e.type === "toast" && e.to === null && typeof e.text === "string" && hiddenAtPublication.some((n: string) => e.text.includes(n))) : [];
  expectSource(publicLeak.length === 0, "no still-hidden quest name leaked in the publication-step public notices");
  return r.output({
    selected: {
      A: { id: A.id, def: A.def, name: A.name, region: A.region, at: A.at },
      B: { id: B.id, def: B.def, name: B.name, region: B.region, at: B.at, finder: "p0" },
      C: { id: C.id, def: C.def, name: C.name, at: C.at },
    },
    bindings: { p0: "finder (human seat 0)", p1: "idle human seat 1", p2: "idle human seat 2" },
    inlineProducerCalls: [
      { producer: "killMob", region: "fire", mobs: fireLiveBefore, creditedKiller: null, label: "regionWipe-fire" },
      { producer: "killMob", region: "frost", mobs: frostLiveBefore, creditedKiller: null, label: "regionWipe-frost" },
    ],
    note: "inline killMob calls are declared producer invocations, not claims that ordinary player swings killed the region",
  }, {
    ticks,
    fire: {
      region: "fire", liveBefore: fireLiveBefore, liveAfter: fireLiveAfter,
      expiry: shortEvent(r.events[fireExpiryIdx]),
      namedSingle: fireExpiryToasts.length === 1,
      publishedBy: "real questSystem publication after the 4000 ms head start",
    },
    frost: {
      region: "frost", liveBefore: frostLiveBefore, liveAfter: frostLiveAfter,
      reveal: r.events[revealFrostIdx] ?? null,
      discoveryToast: shortEvent(r.events[discoveredFrostIdx]),
      acceptBeforePublication: shortEvent(r.events[acceptIdx]),
      publication: shortEvent(r.events[pubIdx]),
      aggregate: shortEvent(aggEvent),
      publicationBeforeAggregate: pubIdx >= 0 && aggIdx >= 0 && pubIdx < aggIdx,
      sameStepAggregation: aggEvent !== null && sameStepClosed.length === 2,
      sameStepClosed,
      statuses: { B: BQ.s.status, BPublished: BQ.published, C: CQ.s.status },
      hiddenLeakInPublicationToasts: publicLeak.map(shortEvent),
    },
    inlineProducerLabels: r.actions.filter((a: any) => a.kind === "inlineProducer").map((a: any) => ({ tick: a.tick, producer: a.producer, label: a.label, region: a.region, mobs: a.mobs })),
  });
}

// ------------------------------------------------------------------------------------------------- capture body
cases.push(caseParcelFeedback());
cases.push(casePickupClosedGuard());
cases.push(caseExpiryCohortOrder());
cases.push(caseTeleportCloseNotices());
cases.push(caseRunEndSilentClose());
cases.push(caseCampPublicationClosure());

// Genuine repeat: every case is built twice from fresh worlds and must serialize exactly the same.
const repeat = JSON.stringify(cases.map((c: any) => ({ script: c.script, actions: c.actions, frames: c.frames, events: c.events, facts: c.facts })));
const second = [caseParcelFeedback(), casePickupClosedGuard(), caseExpiryCohortOrder(), caseTeleportCloseNotices(), caseRunEndSilentClose(), caseCampPublicationClosure()];
const secondRepeat = JSON.stringify(second.map((c: any) => ({ script: c.script, actions: c.actions, frames: c.frames, events: c.events, facts: c.facts })));
assert.equal(secondRepeat, repeat, "every case repeats exactly from a fresh world");

// ------------------------------------------------------------------------------------------------- inventories
function walkFiles(rel: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(repoPath(dir), { withFileTypes: true })) {
      const p = dir + "/" + entry.name;
      if (entry.isDirectory()) visit(p);
      else if (entry.isFile()) out.push(p);
    }
  };
  visit(rel);
  return out.sort();
}
const sourceFiles = ["packages/shared/src", "packages/server/src/sim"].flatMap(walkFiles).filter((p: string) => p.endsWith(".ts"));
const toolFiles = walkFiles("tools/quest-notice-fixtures");
const sourceSha256 = Object.fromEntries(sourceFiles.map((p: string) => [p, shaRepo(p)]));
const toolSha256 = Object.fromEntries(toolFiles.map((p: string) => [p, shaRepo(p)]));

function sourceAnchor(file: string, needle: string): any {
  const lines = readFileSync(repoPath(file), "utf8").split("\n");
  const hits = lines.map((line, i) => ({ line, number: i + 1 })).filter(({ line }) => line.includes(needle));
  if (hits.length !== 1) {
    expectSource(false, "source anchor not found exactly once: " + file + " :: " + needle + " (hits " + hits.length + ")");
    return { file, line: null, text: null, needle };
  }
  return { file, line: hits[0]!.number, text: hits[0]!.line, needle };
}
const ANCHORS: Array<[string, string]> = [
  ["packages/server/src/sim/quests.ts", 'if (!qt || !qt.published || qt.s.status !== "open") { toast(world, c.id, QUEST_REFUSAL.over); return true; }'],
  ["packages/server/src/sim/quests.ts", 'if (!accepted(qt, c.id)) { toast(world, c.id, questAcceptFirstText(qt.def)); return true; }'],
  ["packages/server/src/sim/quests.ts", 'if (q.carried.has(c.id)) { toast(world, c.id, "you can carry one quest item"); return true; }'],
  ["packages/server/src/sim/quests.ts", 'if (qt.s.carrier !== "") return true;'],
  ["packages/server/src/sim/quests.ts", 'const stolen = qt.lastCarrier !== "" && qt.lastCarrier !== c.id;'],
  ["packages/server/src/sim/quests.ts", "if (stolen) announce(world,"],
  ["packages/server/src/sim/quests.ts", "dropped parcel: "],
  ["packages/server/src/sim/quests.ts", 'function completeQuest(world: World, qt: QuestRuntime, playerId: string): void {'],
  ["packages/server/src/sim/quests.ts", "Quest complete: "],
  ["packages/server/src/sim/quests.ts", "completed quest: "],
  ["packages/server/src/sim/quests.ts", 'function announceExpired(world: World, expired: readonly QuestRuntime[]): void {'],
  ["packages/server/src/sim/quests.ts", 'function closeAll(world: World, loud: boolean): void {'],
  ["packages/server/src/sim/quests.ts", 'chainHook(world, "teleported", (w) => closeAll(w, true));'],
  ["packages/server/src/sim/quests.ts", 'chainHook(world, "runEnded", (w) => closeAll(w, false));'],
  ["packages/server/src/sim/quests.ts", 'function publishQuest(world: World, qt: QuestRuntime): void {'],
  ["packages/server/src/sim/quests.ts", "revealed quest: "],
  ["packages/server/src/sim/quests.ts", 'type: "questReveal", to: finder,'],
  ["packages/server/src/sim/quests.ts", "Quest discovered: "],
  ["packages/server/src/sim/quests.ts", 'function closeImpossible(world: World, out: QuestRuntime[], only?: QuestRuntime): void {'],
  ["packages/server/src/sim/quests.ts", "        publishQuest(world, qt);"],
  ["packages/server/src/sim/quests.ts", "closeImpossible(world, expired, qt);"],
  ["packages/server/src/sim/arena.ts", 'export function teleportToColiseum(world: World): void {'],
  ["packages/server/src/sim/arena.ts", "world.hooks.teleported?.(world);"],
  ["packages/server/src/sim/arena.ts", "world.hooks.runEnded?.(world);"],
  ["packages/server/src/sim/step.ts", "const out = world.events;"],
  ["packages/server/src/sim/mobLife.ts", "export function killMob("],
];
const sourceAnchors = ANCHORS.map(([file, needle]) => sourceAnchor(file, needle));

const profile = {
  image: IMAGE,
  platform: "linux/amd64",
  node: process.version,
  base: BASE,
  profileLabel: PROFILE,
  players: PLAYERS,
  seeds: { random: RANDOM_SEED, rewardSalt: REWARD_SALT },
  map: { seed: SEED, attempt: ATTEMPT, decor: false },
  config: CONFIG,
  modules: { signatures: false, walkHints: false },
  canonicalSerialization: "JSON.stringify(body, null, 1) plus a trailing newline",
  captureSha: "sha256 over the canonical body with profile.captureSha256 absent",
  tools: {
    files: toolSha256,
    count: toolFiles.length,
    packageLock: shaRepo("package-lock.json"),
    packageJson: shaRepo("package.json"),
    tsconfigBase: shaRepo("tsconfig.base.json"),
    sharedTsconfig: shaRepo("packages/shared/tsconfig.json"),
    serverTsconfig: shaRepo("packages/server/tsconfig.json"),
  },
  sourceSha256,
  sourceClosureFiles: sourceFiles.length,
  sourceClosureSort: "lexicographic repo-relative path",
  sourceAnchors,
  sourceIssues: [...sourceIssues],
};
if (!RECORD_MODE) assert.equal(sourceIssues.length, 0, "canonical source bindings are all found exactly once");
const body: any = { format: FORMAT, profile, cases };
const unsigned = JSON.stringify(body, null, 1) + "\n";
const captureSha256 = sha256(unsigned);
body.profile.captureSha256 = captureSha256;
const text = JSON.stringify(body, null, 1) + "\n";

if (mode === "--write") {
  writeFileSync(outPath, text);
  console.log(JSON.stringify({
    written: outPath, bytes: text.length, sha256: sha256(text), captureSha256, cases: cases.length,
    events: cases.reduce((n: number, c: any) => n + c.events.length, 0),
    frames: cases.reduce((n: number, c: any) => n + c.frames.length, 0),
    sourceFiles: sourceFiles.length, toolFiles: toolFiles.length,
  }));
} else {
  const existing = readFileSync(outPath, "utf8");
  assert.equal(existing, text, "the checked-in corpus is byte-identical");
  console.log(JSON.stringify({ checked: outPath, bytes: existing.length, sha256: sha256(existing), captureSha256, cases: cases.length }));
}
