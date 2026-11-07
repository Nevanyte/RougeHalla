// Captures the actual legacy travel-cannon behaviour (P-CONS-1c) for the Rust parity harness.
//   node --import tsx tools/cannon-fixtures/capture.mts <out.json>
// The program imports the original TypeScript modules and installs the recorded module profile in gameplay order; it never
// patches packages/, injects damage or replaces a system. The only trusted state is what a scenario would otherwise have to
// play hundreds of ticks to reach (positions, a cannon's private reload/destination, a stun status, a walk/attack-move
// mirror); every attempt goes through the real enqueueClientMessage intake and ordinary 50 ms steps.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { generateMap, mapHashU32, mulberry32, TILE, TILE_WALL } from "@raid/shared";
import { createWorld, rewardStream } from "../../packages/server/src/sim/world.ts";
import { addPlayer, step } from "../../packages/server/src/sim/step.ts";
import { enqueueClientMessage } from "../../packages/server/src/sim/inputs.ts";
import { addStatus } from "../../packages/server/src/sim/status.ts";
import { crateHoldsStatChest } from "../../packages/server/src/sim/loot.ts";
import { install as installLoot } from "../../packages/server/src/sim/loot.ts";
import { install as installWeapons } from "../../packages/server/src/sim/weapons.ts";
import { install as installTargeting } from "../../packages/server/src/sim/targeting.ts";
import { install as installProjectiles } from "../../packages/server/src/sim/projectiles.ts";
import { install as installMobs } from "../../packages/server/src/sim/mobs.ts";
import { install as installBuffs } from "../../packages/server/src/sim/buffs.ts";
import { install as installFeed } from "../../packages/server/src/sim/feed.ts";
import { install as installCamps } from "../../packages/server/src/sim/camps.ts";
import { install as installChests } from "../../packages/server/src/sim/chests.ts";
import { install as installMobLife } from "../../packages/server/src/sim/mobLife.ts";
import { install as installMobAI } from "../../packages/server/src/sim/mobAI.ts";
import { install as installAbilities } from "../../packages/server/src/sim/abilities.ts";
import { install as installVision } from "../../packages/server/src/sim/vision.ts";
import { install as installConsumables } from "../../packages/server/src/sim/consumables.ts";
import { install as installCardHooks } from "../../packages/server/src/sim/cardHooks.ts";
import { install as installMods } from "../../packages/server/src/sim/mods.ts";

assert(process.argv.length === 3, "usage: capture.mts <out.json>");
assert.equal(process.version, "v22.23.4", "the pinned Linux/x64 Node 22.23.4 runtime is the only accepted capture host");
assert.equal(process.platform, "linux");
assert.equal(process.arch, "x64");

const sha = (x: string | Buffer) => createHash("sha256").update(x).digest("hex");
const MODULES: Array<[string, (w: any) => void]> = [
  ["loot", installLoot],
  ["weapons", installWeapons],
  ["targeting", installTargeting],
  ["projectiles", installProjectiles],
  ["mobs", installMobs],
  ["buffs", installBuffs],
  ["feed", installFeed],
  ["camps", installCamps],
  ["chests", installChests],
  ["mobLife", installMobLife],
  ["mobAI", installMobAI],
  ["abilities", installAbilities],
  ["vision", installVision],
  ["consumables", installConsumables],
  ["cardHooks", installCardHooks],
  ["mods", installMods],
];
// The slice profile the Rust initial-loot simulator models (docs/MIGRATION.md selected installers in source order).
const CONFIG = {
  minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
  suddenDeathSeconds: 3600, mobs: false, quests: false, training: false, dummies: false, planSeconds: 0,
};
const SEED = 1;
const RANDOM_SEED = 12;
const REWARD_SALT = [1, 2, 3, 4];
const QUEST_SALT = [5, 6, 7, 8];
const TICK_MS = 50;
const MAP = generateMap(SEED);

interface Opts { commands?: Array<{ tick: number; player: string; type: "pickup" | "target" | "move"; msg: any }>; setup?: Array<{ tick: number; op: string; [k: string]: any }>; steps: number; }

function rig() {
  let uid = 0;
  const main = mulberry32(RANDOM_SEED);
  const draws = { random: 0, rewardRandom: 0, questRandom: 0 };
  const w = createWorld({
    seed: SEED, map: MAP, config: CONFIG as any,
    random: () => { draws.random++; return main(); },
    rewardSalt: REWARD_SALT as any, questSalt: QUEST_SALT as any,
    newItemUid: () => `U${++uid}`,
  });
  const raws = { rewardRandom: w.rewardRandom, questRandom: w.questRandom };
  w.rewardRandom = () => { draws.rewardRandom++; return raws.rewardRandom(); };
  w.questRandom = () => { draws.questRandom++; return raws.questRandom(); };
  for (const [name, install] of MODULES) install(w);
  const initial = [...w.state.containers].map(([id, c]: any) => ({
    id, kind: c.kind, x: c.x, y: c.y, opened: c.opened, label: c.label,
    items: c.items.map((i: any) => ({ uid: i.uid, def: i.def })),
    targetX: c.targetX, targetY: c.targetY, readyAt: c.readyAt,
    statOffer: crateHoldsStatChest(w, id),
  }));
  addPlayer(w, "p0", "p0", { faction: "fire" });
  addPlayer(w, "p1", "p1", { faction: "sentenced" });
  step(w, TICK_MS);
  w.events = [];
  const next = (make: () => () => number, count: number): number[] => {
    const copy = make();
    for (let i = 0; i < count; i++) copy();
    return Array.from({ length: 4 }, () => copy());
  };
  const rng = () => ({
    random: { next: next(() => mulberry32(RANDOM_SEED), draws.random) },
    rewardRandom: { next: next(() => rewardStream(REWARD_SALT as any), draws.rewardRandom) },
  });
  return { w, initial, uid: () => uid, rng };
}

const plain = (v: any): any => v === undefined ? { $undefined: true } : typeof v === "number" && !Number.isFinite(v) ? { $number: String(v) } : v;
function frame(w: any, events: any[], uid: number, rng: () => any) {
  return {
    tick: w.state.tick, time: w.state.serverTime, serial: w.idCounter, uid,
    players: [...w.state.players].map(([id, p]: any) => {
      const rt = w.players.get(id);
      return {
        id, x: p.x, y: p.y, facing: p.facing, hp: p.hp, status: p.status,
        weapon0: p.weapon0 ?? "", weapon1: p.weapon1 ?? "",
        displaceSeq: p.displaceSeq ?? 0, readyAt: p.readyAt ?? 0, attackTarget: p.attackTarget ?? "",
        path: rt.path ?? [], held: rt.weapon.held === true, attackMove: rt.weapon.attackMoveGoal ?? null,
      };
    }),
    containers: [...w.state.containers].map(([id, c]: any) => ({
      id, kind: c.kind, x: c.x, y: c.y, opened: c.opened, label: c.label,
      items: c.items.map((i: any) => ({ uid: i.uid, def: i.def })),
      targetX: c.targetX, targetY: c.targetY, readyAt: c.readyAt,
      statOffer: crateHoldsStatChest(w, id),
    })),
    gatesLocked: w.state.gatesLocked,
    notices: events.filter((e: any) => e.type === "toast").map((e: any) => ({ to: e.to, text: e.text })),
    rng: rng(),
  };
}

function combatant(w: any, id: string) {
  return { kind: "player", id, s: w.state.players.get(id)!, rt: w.players.get(id)! };
}

function applySetup(w: any, op: any) {
  if (op.op === "place") {
    const p = w.state.players.get(op.id)!, rt = w.players.get(op.id)!;
    p.x = op.x; p.y = op.y; p.facing = 0; rt.path = [];
    rt.history = [{ t: w.state.serverTime, x: op.x, y: op.y }];
  } else if (op.op === "container") {
    const c = w.state.containers.get(op.id)!;
    if (op.readyAt !== undefined) c.readyAt = op.readyAt;
    if (op.targetX !== undefined) c.targetX = op.targetX;
    if (op.targetY !== undefined) c.targetY = op.targetY;
  } else if (op.op === "gates") {
    w.state.gatesLocked = op.locked;
  } else if (op.op === "status") {
    assert(addStatus(w, combatant(w, op.id), { kind: op.kind, source: { id: op.source, name: op.source.toUpperCase() }, ms: op.ms }));
  } else if (op.op === "private") {
    const rt = w.players.get(op.id)!;
    if (op.path !== undefined) rt.path = op.path;
    if (op.attackMove !== undefined) rt.weapon.attackMoveGoal = op.attackMove;
    if (op.held !== undefined) rt.weapon.held = op.held;
    if (op.attackTarget !== undefined) {
      w.state.players.get(op.id)!.attackTarget = op.attackTarget;
      rt.weapon.lock = op.attackTarget === "" ? null : op.attackTarget;
    }
  } else if (op.op === "weapon") {
    const p = w.state.players.get(op.id)!;
    if (op.weapon0 !== undefined) p.weapon0 = op.weapon0;
    if (op.weapon1 !== undefined) p.weapon1 = op.weapon1;
  } else throw new Error(`unknown setup op ${op.op}`);
}

function run(c: Opts & { name: string; description: string }) {
  const { w, uid, rng } = rig();
  const frames: any[] = [];
  const commandLog: any[] = [];
  const setupLog: any[] = [];
  const commandsAt = new Map<number, any[]>();
  for (const cmd of c.commands ?? []) {
    const list = commandsAt.get(cmd.tick) ?? [];
    list.push(cmd); commandsAt.set(cmd.tick, list);
  }
  const setupAt = new Map<number, any[]>();
  for (const op of c.setup ?? []) {
    const list = setupAt.get(op.tick) ?? [];
    list.push(op); setupAt.set(op.tick, list);
  }
  for (let tick = 0; tick <= c.steps; tick++) {
    for (const op of setupAt.get(tick) ?? []) { applySetup(w, op); setupLog.push(op); }
    if (tick > 0) {
      for (const cmd of commandsAt.get(tick) ?? []) {
        const ok = enqueueClientMessage(w.players.get(cmd.player)!.inputs, cmd.type, cmd.msg);
        assert(ok, `${c.name}: intake refused tick ${tick} ${cmd.type}`);
        commandLog.push(cmd);
      }
    }
    const events = tick === 0 ? [] : step(w, TICK_MS);
    frames.push(frame(w, events, uid(), rng));
  }
  return { input: { name: c.name, description: c.description, setup: setupLog, commands: commandLog, steps: c.steps }, frames };
}

const baseline = rig();
const initialContainers = baseline.initial;
const cases: Array<Opts & { name: string; description: string }> = (() => {
  const probe = baseline;
  const cannons = [...probe.w.state.containers].filter(([, c]: any) => c.kind === "cannon");
  assert(cannons.length >= 2, "the seed-1 map must place at least two travel cannons");
  const [cannonId, cannon] = cannons[0];
  const target = { x: cannon.targetX, y: cannon.targetY };
  const wall = (() => {
    const m: any = probe.w.map;
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
      if (m.tiles[y * m.w + x] === TILE_WALL) return { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE };
    }
    throw new Error("no wall tile");
  })();
  const chest = [...probe.w.state.containers].find(([, c]: any) => c.kind === "chest")!;
  const place = (id: string, x: number, y: number) => ({ tick: 0, op: "place", id, x, y });
  return [
    {
      name: "spawn", description: "The consumables installer's travel producer after the loot prefix: every cannon, its half-way-round destination, and the loot around it.", steps: 2,
      setup: [place("p1", 624, 400), place("p0", 400, 400)],
    },
    {
      name: "blast", description: "A real F pickup at the cannon: the cooldown stamp, the displacement and the cleared mirrors.", steps: 3,
      setup: [place("p1", 624, 400), place("p0", cannon.x, cannon.y)],
      commands: [{ tick: 1, player: "p0", type: "pickup", msg: { containerId: cannonId } }],
    },
    {
      name: "reload-two-seconds", description: "The source's rounded-up whole-second reload refusal (trusted private reload clock 2 s ahead).", steps: 2,
      setup: [place("p1", 624, 400), place("p0", cannon.x, cannon.y), { tick: 0, op: "container", id: cannonId, readyAt: 50 + 2000 }],
      commands: [{ tick: 1, player: "p0", type: "pickup", msg: { containerId: cannonId } }],
    },
    {
      name: "reload-one-second", description: "The refusing boundary: one millisecond left rounds up to 1 s.", steps: 2,
      setup: [place("p1", 624, 400), place("p0", cannon.x, cannon.y), { tick: 0, op: "container", id: cannonId, readyAt: 50 + 51 }],
      commands: [{ tick: 1, player: "p0", type: "pickup", msg: { containerId: cannonId } }],
    },
    {
      name: "reload-ready-boundary", description: "A reload clock exactly at the previous step's time is ready: the blast lands.", steps: 2,
      setup: [place("p1", 624, 400), place("p0", cannon.x, cannon.y), { tick: 0, op: "container", id: cannonId, readyAt: 50 }],
      commands: [{ tick: 1, player: "p0", type: "pickup", msg: { containerId: cannonId } }],
    },
    {
      name: "sealed", description: "The coliseum gate lock seals every cannon.", steps: 2,
      setup: [place("p1", 624, 400), place("p0", cannon.x, cannon.y), { tick: 0, op: "gates", locked: true }],
      commands: [{ tick: 1, player: "p0", type: "pickup", msg: { containerId: cannonId } }],
    },
    {
      name: "cannot-enter", description: "A real root status refuses entry after the reload check (a stun is refused earlier by the pickup admission).", steps: 2,
      setup: [place("p1", 624, 400), place("p0", cannon.x, cannon.y), { tick: 0, op: "status", kind: "root", id: "p0", source: "p1", ms: 5000 }],
      commands: [{ tick: 1, player: "p0", type: "pickup", msg: { containerId: cannonId } }],
    },
    {
      name: "blocked-landing", description: "A landing whose disc is not clear silently declines: no stamp, no toast, no move.", steps: 2,
      setup: [place("p1", 624, 400), place("p0", cannon.x, cannon.y), { tick: 0, op: "container", id: cannonId, targetX: wall.x, targetY: wall.y }],
      commands: [{ tick: 1, player: "p0", type: "pickup", msg: { containerId: cannonId } }],
    },
    {
      name: "clears-mirrors", description: "The blast clears the walk path, the attack-move goal, the held trigger and the weapon target mirror.", steps: 2,
      setup: [
        place("p1", 624, 400),
        place("p0", cannon.x, cannon.y),
        { tick: 0, op: "weapon", id: "p0", weapon0: "wand" },
        { tick: 0, op: "private", id: "p0", path: [{ x: cannon.x, y: cannon.y + 64 }], attackMove: { x: cannon.x, y: cannon.y + 64 }, held: true, attackTarget: "p1" },
      ],
      commands: [{ tick: 1, player: "p0", type: "pickup", msg: { containerId: cannonId } }],
    },
    {
      name: "chest-control", description: "The cannon branch is not the pickup branch: an ordinary chest still stores its potion with no displacement.", steps: 2,
      setup: [place("p1", 624, 400), place("p0", chest[1].x, chest[1].y)],
      commands: [{ tick: 1, player: "p0", type: "pickup", msg: { containerId: chest[0] } }],
    },
  ];
})();

const sourceFiles = [
  "packages/server/src/sim/world.ts", "packages/server/src/sim/step.ts", "packages/server/src/sim/inputs.ts",
  "packages/server/src/sim/loot.ts", "packages/server/src/sim/consumables.ts", "packages/server/src/sim/status.ts",
  "packages/server/src/sim/gameplay.ts", "packages/server/src/sim/combatant.ts",
];
const provenance = {
  node: process.version, platform: process.platform, arch: process.arch,
  nodeSha256: sha(readFileSync(process.execPath)),
  sourceSha256: Object.fromEntries(sourceFiles.map((f) => [f, sha(readFileSync("/repo/" + f))])),
  recorderSha256: sha(readFileSync("/repo/tools/cannon-fixtures/capture.mts")),
  map: { seed: SEED, legacyHashU32: mapHashU32(MAP) },
};
const result = {
  format: "rh-cannon-source/1",
  provenance,
  configuration: {
    seed: SEED, randomSeed: RANDOM_SEED, rewardSalt: REWARD_SALT, questSalt: QUEST_SALT,
    config: CONFIG, modules: MODULES.map(([name]) => name),
    players: [{ id: "p0", faction: "fire" }, { id: "p1", faction: "sentenced" }],
  },
  initialContainers,
  cases: cases.map(run),
};
const text = JSON.stringify(result) + "\n";
writeFileSync(process.argv[2], text);
console.log(JSON.stringify({ cases: result.cases.length, bytes: Buffer.byteLength(text), sha256: sha(text) }));
