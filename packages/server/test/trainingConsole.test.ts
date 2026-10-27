// The training room's practice console (the `train` message, sim/training.ts): what it accepts, what each command does to the
// world, and that none of it exists in an arena. Headless, built the way the Room builds a training world (createGameWorld with the
// training config, installTraining, addPlayer, startRaid), with an arena world as the control. The live half (a real room, a
// real socket) is in test/training.test.ts.
import { describe, expect, it } from "vitest";
import {
  CHEST_OPTIONS, CHEST_SECONDS, circleClear, decodeFlat, decodeMult, FACTIONS, GV_SKIP, hasLineOfSight, MOB_TYPES, mobFaction, mobTypeById,
  mobWeapon, mulberry32, nextRank, PLAYER_RADIUS, REGION_FACTIONS, SKILL_IDS, skillDef, skillLive, TICK_MS, TILE, TRAIN_CAMP_SIZE,
  TRAIN_DEFAULT_RANK, TRAIN_DEFAULT_STACKS, TRAIN_MAX_CHESTS, TRAIN_MAX_MOBS, TRAIN_MAX_MOBS_SPAWNED, TRAIN_MAX_STACKS,
  TRAIN_SPAWN_GAP_MS, WIRE_IDENTITY_MIRRORS, type FactionId, type FxEvent, type MobTypeId,
} from "@raid/shared";
import type { MobState, PlayerState } from "@raid/shared/schema";
import { rewardChests } from "../src/sim/chests";
import { combatant, mobScale } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage, InputQueue, parseTrain, type ActionCommand } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { aggro } from "../src/sim/mobAI";
import type { MobCombatant } from "../src/sim/mobLife";
import { planPath } from "../src/sim/movement";
import { addPlayer, startRaid, step } from "../src/sim/step";
import { handleTrain, installTraining, PRACTICE_CAMP_FIRST } from "../src/sim/training";
import type { SimConfig, SimEvent, World } from "../src/sim/world";

const BASE: SimConfig = {
  minPlayers: 8, lobbySeconds: 120, fillSeconds: 0, patienceSeconds: 2, patienceMinSeconds: 2, suddenDeathSeconds: 2,
};
const SEED = 1234;
const ME = "p0";

/** What RaidRoom builds for a training room: one player, in the run at once. */
function trainingWorld(faction: FactionId = "fire", seed = SEED): World {
  const world = createGameWorld({ seed, config: { ...BASE, dummies: true, training: true }, random: mulberry32(seed + 1) });
  installTraining(world);
  addPlayer(world, ME, "alice", { faction });
  startRaid(world);
  return world;
}

/** The same world as an arena run of one: the control. */
function arenaWorld(seed = SEED): World {
  const world = createGameWorld({ seed, config: { ...BASE, minPlayers: 1 }, random: mulberry32(seed + 1) });
  addPlayer(world, ME, "alice", { faction: "fire" });
  startRaid(world);
  return world;
}

const me = (w: World): PlayerState => w.state.players.get(ME)!;
const rtOf = (w: World) => w.players.get(ME)!;
const tick = (w: World): SimEvent[] => step(w, TICK_MS);

function run(w: World, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...tick(w));
  return events;
}

/** Ticks long enough that the next camp or chest is not refused for coming too soon. */
const GAP_TICKS = Math.ceil(TRAIN_SPAWN_GAP_MS / TICK_MS) + 1;

/** What a client's `train` message does: accepted at the door of a training room, then applied by the next tick. */
function train(w: World, msg: unknown, ticks = 1): SimEvent[] {
  expect(enqueueClientMessage(rtOf(w).inputs, "train", msg, { training: true }), `train ${JSON.stringify(msg)} accepted`).toBe(true);
  return run(w, ticks);
}

const toasts = (events: SimEvent[]): string[] => events.flatMap((e) => (e.type === "toast" ? [e.text] : []));
const fxOf = <K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Extract<FxEvent, { kind: K }>> =>
  events.flatMap((e) => (e.type === "fx" && e.fx.kind === kind ? [e.fx as Extract<FxEvent, { kind: K }>] : []));

/** The regional mobs in the room (a training world places none of its own: every one is the console's). */
const practiceMobs = (w: World): Array<[string, MobState]> =>
  [...w.state.mobs].filter(([, m]) => m.kind === "mob" || m.kind === "elite");
const dummies = (w: World): number => [...w.state.mobs.values()].filter((m) => m.kind === "dummy").length;
const tileOf = (v: { x: number; y: number }): string => `${Math.floor(v.x / TILE)},${Math.floor(v.y / TILE)}`;
const tilesFrom = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y) / TILE;

/** A hit worth `raw` damage on `victim` from the player, applied in a ledger pass the way a tick's hits are. */
function strike(w: World, victim: string, raw: number): SimEvent[] {
  recordHit(w, { victim, by: { id: ME, name: "alice" }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
  applyLedger(w);
  return w.events.splice(0);
}

const IDENTITY = WIRE_IDENTITY_MIRRORS;
const baseHp = (faction: FactionId): number => FACTIONS[faction].hp;
const NORMAL_TYPES = MOB_TYPES.filter((t) => !t.elite);
const ELITE_TYPES = MOB_TYPES.filter((t) => t.elite);

// ============================================================================================ the door

describe("the `train` message at the door", () => {
  const fresh = () => new InputQueue();

  it("is accepted in a training room and refused anywhere else, and a refusal queues nothing", () => {
    for (const msg of [{ cmd: "buff", id: "emberImp" }, { cmd: "clear" }, { cmd: "camp", id: "wyrmling" }, { cmd: "chest" }]) {
      const q = fresh();
      expect(enqueueClientMessage(q, "train", msg), JSON.stringify(msg)).toBe(false);
      expect(enqueueClientMessage(q, "train", msg, {}), JSON.stringify(msg)).toBe(false);
      expect(enqueueClientMessage(q, "train", msg, { training: false }), JSON.stringify(msg)).toBe(false);
      expect(enqueueClientMessage(q, "train", msg, { training: "yes" as unknown as boolean }), JSON.stringify(msg)).toBe(false);
      expect(q.actions).toEqual([]);
      expect(enqueueClientMessage(q, "train", msg, { training: true }), JSON.stringify(msg)).toBe(true);
      expect(q.actions).toHaveLength(1);
    }
  });

  it("buff: a known buff id and a finite amount, clamped to 0..TRAIN_MAX_STACKS, 3 stacks when none is given", () => {
    expect(parseTrain({ cmd: "buff", id: "emberImp" })).toEqual({ kind: "train", cmd: "buff", id: "emberImp", amount: TRAIN_DEFAULT_STACKS });
    expect(TRAIN_DEFAULT_STACKS).toBe(3);
    for (const [amount, want] of [[6, 6], [0, 0], [2.5, 2.5], [99, TRAIN_MAX_STACKS], [-4, 0], [1e9, TRAIN_MAX_STACKS]] as const) {
      expect(parseTrain({ cmd: "buff", id: "bailiff", amount }), String(amount)).toEqual({ kind: "train", cmd: "buff", id: "bailiff", amount: want });
    }
    for (const id of MOB_TYPES.map((t) => t.id)) expect(parseTrain({ cmd: "buff", id })).not.toBeNull();
    for (const bad of [
      { cmd: "buff" }, { cmd: "buff", id: "" }, { cmd: "buff", id: "nope" }, { cmd: "buff", id: "whetstone" }, { cmd: "buff", id: 3 },
      { cmd: "buff", id: null }, { cmd: "buff", id: "emberImp", amount: "3" }, { cmd: "buff", id: "emberImp", amount: NaN },
      { cmd: "buff", id: "emberImp", amount: Infinity }, { cmd: "buff", id: "emberImp", amount: null },
      { cmd: "buff", id: "x".repeat(65) }, { cmd: "buff", id: ["emberImp"] }, { cmd: "buff", id: "__proto__" },
    ]) expect(parseTrain(bad), JSON.stringify(bad)).toBeNull();
  });

  it("passive: a known skill id and a rank of exactly 0, 1 or 2 (1 when none is given)", () => {
    expect(parseTrain({ cmd: "passive", id: "whetstone" })).toEqual({ kind: "train", cmd: "passive", id: "whetstone", rank: TRAIN_DEFAULT_RANK });
    for (const rank of [0, 1, 2] as const) expect(parseTrain({ cmd: "passive", id: "thickHide", rank })).toEqual({ kind: "train", cmd: "passive", id: "thickHide", rank });
    for (const id of SKILL_IDS) expect(parseTrain({ cmd: "passive", id, rank: 2 }), id).not.toBeNull(); // live or not: all of them
    for (const bad of [
      { cmd: "passive" }, { cmd: "passive", id: "nope" }, { cmd: "passive", id: "emberImp" }, { cmd: "passive", id: "whetstone", rank: 3 },
      { cmd: "passive", id: "whetstone", rank: -1 }, { cmd: "passive", id: "whetstone", rank: 1.5 }, { cmd: "passive", id: "whetstone", rank: "1" },
      { cmd: "passive", id: "whetstone", rank: null }, { cmd: "passive", id: "whetstone", rank: NaN },
    ]) expect(parseTrain(bad), JSON.stringify(bad)).toBeNull();
  });

  it("camp: any of the 20 mob types, nothing else", () => {
    for (const t of MOB_TYPES) expect(parseTrain({ cmd: "camp", id: t.id }), t.id).toEqual({ kind: "train", cmd: "camp", id: t.id });
    for (const bad of [{ cmd: "camp" }, { cmd: "camp", id: "fire" }, { cmd: "camp", id: "Wyrmling" }, { cmd: "camp", id: 1 }, { cmd: "camp", id: "whetstone" }]) {
      expect(parseTrain(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("chest: no options (or an empty list) asks for the server's random three; otherwise 1 to 3 distinct known skills", () => {
    expect(parseTrain({ cmd: "chest" })).toEqual({ kind: "train", cmd: "chest", options: [] });
    expect(parseTrain({ cmd: "chest", options: [] })).toEqual({ kind: "train", cmd: "chest", options: [] });
    expect(parseTrain({ cmd: "chest", options: ["whetstone"] })).toEqual({ kind: "train", cmd: "chest", options: ["whetstone"] });
    expect(parseTrain({ cmd: "chest", options: ["whetstone", "firebrand", "witness"] })).toMatchObject({ options: ["whetstone", "firebrand", "witness"] });
    expect(CHEST_OPTIONS).toBe(3);
    for (const bad of [
      { cmd: "chest", options: ["whetstone", "whetstone"] }, { cmd: "chest", options: ["a", "b", "c", "d"] },
      { cmd: "chest", options: ["whetstone", "swiftBoots", "quickdraw", "thickHide"] }, { cmd: "chest", options: ["nope"] },
      { cmd: "chest", options: ["whetstone", "nope"] }, { cmd: "chest", options: "whetstone" }, { cmd: "chest", options: [1] },
      { cmd: "chest", options: null }, { cmd: "chest", options: { 0: "whetstone" } },
    ]) expect(parseTrain(bad), JSON.stringify(bad)).toBeNull();
  });

  it("clear takes nothing; an unknown command, a missing one or a message that is not an object is refused whole", () => {
    expect(parseTrain({ cmd: "clear" })).toEqual({ kind: "train", cmd: "clear" });
    expect(parseTrain({ cmd: "clear", id: "junk", amount: 5 })).toEqual({ kind: "train", cmd: "clear" });
    for (const bad of [{}, { cmd: "" }, { cmd: "give" }, { cmd: "Buff", id: "emberImp" }, { cmd: 1 }, { cmd: null }, { cmd: ["clear"] }, null, undefined, "clear", 7, []]) {
      expect(parseTrain(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("a refused message in a training room counts for nothing: it returns false (so the idle rule is not fed) and queues nothing", () => {
    const q = fresh();
    for (const bad of [{}, { cmd: "buff", id: "nope" }, { cmd: "passive", id: "whetstone", rank: 9 }, null, "clear"]) {
      expect(enqueueClientMessage(q, "train", bad, { training: true }), JSON.stringify(bad)).toBe(false);
    }
    expect(q.actions).toEqual([]);
    expect(q.move).toBeNull();
  });
});

// ============================================================================================ an arena world

describe("an arena world", () => {
  it("has no `train` handler, and the handler it would have refuses a world without the training flag", () => {
    const world = arenaWorld();
    expect(world.actions.train).toBeUndefined();
    expect(trainingWorld().actions.train).toBe(handleTrain);

    // Even a command that got past the door (queued by hand here) does nothing in an arena run.
    const rt = rtOf(world);
    const before = { mobs: world.state.mobs.size, containers: world.state.containers.size };
    const queued: ActionCommand[] = [
      { kind: "train", cmd: "buff", id: "emberImp", amount: 12 }, { kind: "train", cmd: "passive", id: "thickHide", rank: 2 },
      { kind: "train", cmd: "camp", id: "emberImp" }, { kind: "train", cmd: "chest", options: [] }, { kind: "train", cmd: "clear" },
    ];
    for (const msg of queued) rt.inputs.pushAction(msg);
    const events = run(world, 3);
    expect(me(world).buffs.size).toBe(0);
    expect(me(world).build.size).toBe(0);
    expect([world.state.mobs.size, world.state.containers.size]).toEqual([before.mobs, before.containers]);
    expect(toasts(events)).toEqual([]);

    // And called directly, the training handler checks the flag itself.
    handleTrain(world, combatant(world, ME)!, { kind: "train", cmd: "buff", id: "emberImp", amount: 12 });
    handleTrain(world, combatant(world, ME)!, { kind: "train", cmd: "camp", id: "emberImp" });
    expect(me(world).buffs.size).toBe(0);
    expect(world.state.mobs.size).toBe(before.mobs);
  });
});

// ============================================================================================ buffs

describe("train buff", () => {
  it("sets the stacks and re-folds the mirrors at once, exactly as a kill's grant does", () => {
    const world = trainingWorld("fire");
    const events = train(world, { cmd: "buff", id: "plagueRat", amount: 3 });
    expect(me(world).buffs.get("plagueRat")).toBe(3);
    expect(decodeMult(me(world).asMult)).toBeCloseTo(1.08, 3); // +8% attack speed at 3 stacks (the quoted value)
    expect(fxOf(events, "buff")).toEqual([{ kind: "buff", id: ME, buff: "plagueRat", stacks: 3, total: 3 }]);

    // The same stacks given by a mob kill's path (grantBuff) fold to the very same mirrors.
    const other = trainingWorld("fire");
    train(other, { cmd: "buff", id: "plagueRat", amount: 1 });
    train(other, { cmd: "buff", id: "plagueRat", amount: 3 });
    expect(me(other).asMult).toBe(me(world).asMult);
    expect(me(other).buffs.get("plagueRat")).toBe(3);
  });

  it("max hp follows (and the hp that came with it), speed and armor rows reach their mirrors, and 0 takes everything back", () => {
    const world = trainingWorld("fire");
    const p = me(world);
    expect([p.maxHp, p.hp]).toEqual([baseHp("fire"), baseHp("fire")]);
    train(world, { cmd: "buff", id: "iceGolem", amount: 3 }); // +8% max hp
    expect(p.maxHp).toBeCloseTo(baseHp("fire") * 1.08, 6);
    expect(p.hp).toBeCloseTo(p.maxHp, 6);
    train(world, { cmd: "buff", id: "rimeStalker", amount: 3 }); // +20 armor
    expect(decodeFlat(p.armorBonus)).toBeCloseTo(20, 0);
    train(world, { cmd: "buff", id: "magmaBrute", amount: 3 }); // +6% max hp, +20 magic resist
    expect(p.maxHp).toBeCloseTo(baseHp("fire") * 1.14, 6);
    expect(decodeFlat(p.shieldBonus)).toBeCloseTo(20, 0);

    for (const id of ["iceGolem", "rimeStalker", "magmaBrute"]) train(world, { cmd: "buff", id, amount: 0 });
    expect(p.buffs.size).toBe(0);
    expect(p.maxHp).toBeCloseTo(baseHp("fire"), 6);
    expect(p.hp).toBeCloseTo(baseHp("fire"), 6); // hp never above the new max
    expect([p.asMult, p.windupMult, p.speedMult, p.armorBonus, p.shieldBonus]).toEqual([IDENTITY.asMult, IDENTITY.windupMult, IDENTITY.speedMult, 0, 0]);
  });

  it("is a set, not an add: the same amount twice is the same stacks, a smaller one lowers them, and the amount is clamped", () => {
    const world = trainingWorld("sentenced");
    const p = me(world);
    train(world, { cmd: "buff", id: "plagueRat", amount: 6 });
    train(world, { cmd: "buff", id: "plagueRat", amount: 6 });
    expect(p.buffs.get("plagueRat")).toBe(6);
    const six = p.asMult;
    train(world, { cmd: "buff", id: "plagueRat", amount: 2 });
    expect(p.buffs.get("plagueRat")).toBe(2);
    expect(p.asMult).toBeLessThan(six);
    expect(decodeMult(p.asMult)).toBeGreaterThan(1);
    train(world, { cmd: "buff", id: "plagueRat", amount: 99 });
    expect(p.buffs.get("plagueRat")).toBe(TRAIN_MAX_STACKS);
    train(world, { cmd: "buff", id: "plagueRat", amount: -7 });
    expect(p.buffs.has("plagueRat")).toBe(false);
    train(world, { cmd: "buff", id: "plagueRat" }); // the default
    expect(p.buffs.get("plagueRat")).toBe(TRAIN_DEFAULT_STACKS);
  });

  it("answers with a toast naming the buff and what it gives, and flags a buff the server does not apply yet", () => {
    const world = trainingWorld("fire");
    const [ok] = toasts(train(world, { cmd: "buff", id: "emberImp", amount: 3 }));
    expect(ok).toMatch(/^Ember Imp 3 stacks: \+10% damage$/);
    const [pending] = toasts(train(world, { cmd: "buff", id: "chainWarden", amount: 3 }));
    expect(pending).toMatch(/^Chain Warden 3 stacks: .*not applied yet/);
    expect(toasts(train(world, { cmd: "buff", id: "emberImp", amount: 0 }))).toEqual(["Ember Imp removed"]);
  });

  it("re-arms a once-per-run trigger when its buff is taken off, and not when it is only lowered", () => {
    const world = trainingWorld("holy");
    train(world, { cmd: "buff", id: "bloodSaint", amount: 3 });
    const rt = rtOf(world);
    rt.fired = new Set(["bloodSaint:0", "skill:secondWind:0"]);
    train(world, { cmd: "buff", id: "bloodSaint", amount: 2 });
    expect([...rt.fired]).toEqual(["bloodSaint:0", "skill:secondWind:0"]);
    train(world, { cmd: "buff", id: "bloodSaint", amount: 0 });
    expect([...rt.fired]).toEqual(["skill:secondWind:0"]);
  });
});

// ============================================================================================ passives

describe("train passive", () => {
  it("sets the rank in the build and re-folds: Thick Hide's max hp, armor and magic resist at rank 1, 2 and gone", () => {
    const world = trainingWorld("fire");
    const p = me(world);
    train(world, { cmd: "passive", id: "thickHide", rank: 1 });
    expect(p.build.get("thickHide")).toBe(1);
    expect(p.maxHp).toBeCloseTo(baseHp("fire") * 1.06, 6);
    expect([decodeFlat(p.armorBonus), decodeFlat(p.shieldBonus)]).toEqual([5, 5]);
    train(world, { cmd: "passive", id: "thickHide", rank: 2 });
    expect(p.build.get("thickHide")).toBe(2);
    expect(p.maxHp).toBeCloseTo(baseHp("fire") * 1.1, 6);
    expect([decodeFlat(p.armorBonus), decodeFlat(p.shieldBonus)]).toEqual([8, 8]);
    train(world, { cmd: "passive", id: "thickHide", rank: 0 });
    expect(p.build.has("thickHide")).toBe(false);
    expect(p.maxHp).toBeCloseTo(baseHp("fire"), 6);
    expect([p.armorBonus, p.shieldBonus]).toEqual([0, 0]);
  });

  it("folds with the buffs: a passive's damage row and a buff's add up, and removing one leaves the other", () => {
    const world = trainingWorld("fire");
    const p = me(world);
    train(world, { cmd: "buff", id: "plagueRat", amount: 3 });
    train(world, { cmd: "passive", id: "swiftBoots", rank: 2 }); // +10% move speed
    train(world, { cmd: "passive", id: "quickdraw", rank: 2 }); // -12% windup
    expect(decodeMult(p.asMult)).toBeCloseTo(1.08, 3);
    expect(decodeMult(p.speedMult)).toBeCloseTo(1.1, 3);
    expect(decodeMult(p.windupMult)).toBeCloseTo(0.88, 3);
    train(world, { cmd: "passive", id: "swiftBoots", rank: 0 });
    expect(p.speedMult).toBe(IDENTITY.speedMult);
    expect(decodeMult(p.asMult)).toBeCloseTo(1.08, 3);
  });

  it("is the same fold as a chest pick: Thick Hide by the console and by `choose` leave the very same stats", () => {
    const byConsole = trainingWorld("frost");
    train(byConsole, { cmd: "passive", id: "thickHide", rank: 1 });

    const byChest = trainingWorld("frost");
    train(byChest, { cmd: "chest", options: ["thickHide"] }, 2);
    const [chest] = rewardChests(byChest);
    expect(chest).toBeDefined();
    rtOf(byChest).inputs.pushAction({ kind: "choose", chest: chest!.id, pick: 0 });
    run(byChest, 1);
    expect(me(byChest).build.get("thickHide")).toBe(1);

    for (const field of ["maxHp", "hp", "asMult", "windupMult", "speedMult", "armorBonus", "shieldBonus"] as const) {
      expect(me(byChest)[field], field).toBe(me(byConsole)[field]);
    }
  });

  it("sets a passive whose machinery is not live yet, which does nothing, and says so in its toast", () => {
    const world = trainingWorld("fire");
    const p = me(world);
    expect(skillLive("firebrand")).toBe(false);
    expect(skillLive("hoarfrostArmor")).toBe(false);
    const [note] = toasts(train(world, { cmd: "passive", id: "firebrand", rank: 2 }));
    expect(p.build.get("firebrand")).toBe(2);
    expect(note).toMatch(/Firebrand rank 2.*not live yet: no effect/);
    // Hoarfrost Armor has an armor row, but the sim only folds live skills.
    train(world, { cmd: "passive", id: "hoarfrostArmor", rank: 2 });
    expect(p.build.get("hoarfrostArmor")).toBe(2);
    expect(p.armorBonus).toBe(0);
    expect([p.asMult, p.speedMult, p.maxHp]).toEqual([IDENTITY.asMult, IDENTITY.speedMult, baseHp("fire")]);
    // A live one: no flag.
    expect(toasts(train(world, { cmd: "passive", id: "whetstone", rank: 1 }))[0]).not.toMatch(/not live/);
    expect(toasts(train(world, { cmd: "passive", id: "whetstone", rank: 0 }))).toEqual(["Whetstone removed"]);
  });

  it("says the line that fits the player's faction (Pestilence: Plague's execute, the others' damage)", () => {
    const plague = toasts(train(trainingWorld("plague"), { cmd: "passive", id: "pestilence", rank: 1 }))[0]!;
    const fire = toasts(train(trainingWorld("fire"), { cmd: "passive", id: "pestilence", rank: 1 }))[0]!;
    expect(plague).toMatch(/Execute starts at 60% HP/);
    expect(fire).toMatch(/\+8% damage to targets below 60% HP/);
  });
});

// ============================================================================================ camps

describe("train camp", () => {
  it("spawns three mobs of the type on free, reachable floor near the player, asleep and sharing one camp", () => {
    const world = trainingWorld("fire");
    const p = me(world);
    const before = dummies(world);
    const events = train(world, { cmd: "camp", id: "emberImp" });
    const mobs = practiceMobs(world);
    expect(mobs).toHaveLength(TRAIN_CAMP_SIZE);
    expect(toasts(events)).toEqual(["Practice camp: 3 x Ember Imp"]);
    expect(dummies(world)).toBe(before);

    const refs = new Set(mobs.map(([, m]) => m.camp));
    expect(refs.size).toBe(1);
    expect([...refs][0]).toBeGreaterThanOrEqual(PRACTICE_CAMP_FIRST);
    const tiles = new Set<string>();
    for (const [id, m] of mobs) {
      expect(m).toMatchObject({
        kind: "mob", name: "Ember Imp", type: "emberImp", faction: "fire", weapon0: mobWeapon("fire"), status: "alive",
        maxHp: mobFaction("fire", false, mobScale(false)).hp,
      });
      expect(m.hp).toBe(m.maxHp);
      expect(circleClear(world.map, m, PLAYER_RADIUS), `${id} on free floor`).toBe(true);
      expect(planPath(world, p, m).length, `${id} reachable`).toBeGreaterThan(0);
      const rt = world.mobs.get(id)!;
      expect(rt.brain).toMatchObject({ region: "fire", elite: false, mode: "idle", home: { x: m.x, y: m.y } });
      expect(tilesFrom(p, m)).toBeGreaterThan(3);
      expect(tilesFrom(p, m)).toBeLessThan(12);
      tiles.add(tileOf(m));
    }
    expect(tiles.size).toBe(TRAIN_CAMP_SIZE); // nobody stands on a neighbour
    // Not on a dummy, a loose weapon or the player either.
    for (const m of world.state.mobs.values()) if (m.kind === "dummy") expect(tiles.has(tileOf(m))).toBe(false);
    for (const b of world.state.containers.values()) expect(tiles.has(tileOf(b))).toBe(false);
    expect(tiles.has(tileOf(p))).toBe(false);
    // The camp faces the player, and nothing about the map's own camps was touched.
    expect(world.state.camps.length).toBe(0);
  });

  it("an elite type is a lone elite; every one of the 20 types spawns as its row says, in its zone", () => {
    for (const t of MOB_TYPES) {
      const world = trainingWorld(REGION_FACTIONS[0]);
      train(world, { cmd: "camp", id: t.id });
      const mobs = practiceMobs(world);
      expect(mobs.length, t.id).toBe(t.elite ? 1 : TRAIN_CAMP_SIZE);
      for (const [id, m] of mobs) {
        expect(m, t.id).toMatchObject({ kind: t.elite ? "elite" : "mob", type: t.id, name: t.name, faction: t.zone });
        expect(m.maxHp, t.id).toBe(mobFaction(t.zone, t.elite, mobScale(t.elite)).hp);
        expect(world.mobs.get(id)!.brain, t.id).toMatchObject({ region: t.zone, elite: t.elite });
      }
    }
    expect(ELITE_TYPES).toHaveLength(5);
    expect(NORMAL_TYPES).toHaveLength(15);
  });

  it("a second camp takes another camp number, away from the first one's tiles", () => {
    const world = trainingWorld("fire");
    train(world, { cmd: "camp", id: "bailiff" }, GAP_TICKS);
    train(world, { cmd: "camp", id: "rotMonk" });
    const mobs = practiceMobs(world);
    expect(mobs).toHaveLength(2 * TRAIN_CAMP_SIZE);
    expect(new Set(mobs.map(([, m]) => m.camp)).size).toBe(2);
    expect(new Set(mobs.map(([, m]) => tileOf(m))).size).toBe(2 * TRAIN_CAMP_SIZE);
    expect(mobs.filter(([, m]) => m.type === "bailiff")).toHaveLength(3);
    expect(mobs.filter(([, m]) => m.type === "rotMonk")).toHaveLength(3);
  });

  it("damaging one wakes its camp-mates (D24) and only them", () => {
    const world = trainingWorld("fire");
    train(world, { cmd: "camp", id: "emberImp" }, GAP_TICKS);
    train(world, { cmd: "camp", id: "bailiff" });
    const first = practiceMobs(world).filter(([, m]) => m.type === "emberImp").map(([id]) => id);
    const second = practiceMobs(world).filter(([, m]) => m.type === "bailiff").map(([id]) => id);
    const brain = (id: string) => world.mobs.get(id)!.brain!;
    for (const id of [...first, ...second]) expect(brain(id).mode).toBe("idle");
    // Put the player next to the first camp, so it is the one they would pull.
    const lead = world.state.mobs.get(first[0]!)!;
    me(world).x = lead.x - 40;
    me(world).y = lead.y;
    aggro(world, combatant(world, first[0]!) as MobCombatant, ME, 5);
    for (const id of first) expect([id, brain(id).mode, brain(id).target]).toEqual([id, "fight", ME]);
    for (const id of second) expect([id, brain(id).mode]).toEqual([id, "idle"]);
  });

  it("their death pays and records nothing: no GV, feed, buff, drop, camp or chest, where the same kill in an arena run pays", () => {
    const world = trainingWorld("fire");
    train(world, { cmd: "camp", id: "emberImp" });
    const containers = world.state.containers.size;
    const p = me(world);
    const events: SimEvent[] = [];
    for (const [id] of practiceMobs(world)) events.push(...strike(world, id, 1e6));
    events.push(...run(world, 5));
    for (const [, m] of practiceMobs(world)) expect(m.status).toBe("dead");
    expect(fxOf(events, "death")).toHaveLength(3);
    expect(fxOf(events, "death").every((d) => d.by === ME)).toBe(true);
    expect(events.filter((e) => e.type === "gv" || e.type === "resolved")).toEqual([]);
    expect(fxOf(events, "campCleared")).toEqual([]);
    expect(fxOf(events, "buff")).toEqual([]);
    expect([p.gv, p.mobKills, p.kills, p.bounty]).toEqual([0, 0, 0, 0]);
    expect(rtOf(world).gv).toEqual({ kills: 0, mobs: 0, bounty: 0 });
    expect(rtOf(world).mobKills).toBe(0);
    expect(p.buffs.size).toBe(0);
    expect(world.state.containers.size).toBe(containers); // no weapon dropped, no chest
    expect(rewardChests(world)).toEqual([]);
    expect(world.state.camps.length).toBe(0);
    expect(world.state.phase).toBe("active");

    // The control: the same kill with the training flag off pays the buff and the GV, so the checks above could have failed.
    const paying = trainingWorld("fire");
    train(paying, { cmd: "camp", id: "emberImp" });
    paying.config = { ...paying.config, training: false };
    const paid = strike(paying, practiceMobs(paying)[0]![0], 1e6);
    expect(paid.some((e) => e.type === "gv")).toBe(true);
    expect(me(paying).buffs.get("emberImp")).toBeGreaterThan(0);
  });

  it("a corpse is removed like any mob's, and a practice kill never keeps the room's roster from growing past what was spawned", () => {
    const world = trainingWorld("fire");
    train(world, { cmd: "camp", id: "emberImp" });
    for (const [id] of practiceMobs(world)) strike(world, id, 1e6);
    run(world, 40); // MOB_CORPSE_MS (1.5 s) is 30 ticks
    expect(practiceMobs(world)).toEqual([]);
    expect(dummies(world)).toBe(2);
  });

  it("is refused, with a toast and no mob, when too many stand, when it comes too soon after the last, or when the room's share is used up", () => {
    const world = trainingWorld("fire");
    // Two orders in one tick: the second is inside the gap.
    expect(enqueueClientMessage(rtOf(world).inputs, "train", { cmd: "camp", id: "emberImp" }, { training: true })).toBe(true);
    expect(enqueueClientMessage(rtOf(world).inputs, "train", { cmd: "camp", id: "bailiff" }, { training: true })).toBe(true);
    expect(toasts(run(world, 1))).toEqual(["Practice camp: 3 x Ember Imp", "Slow down"]);
    expect(practiceMobs(world)).toHaveLength(3);

    // Up to the cap, then a refusal.
    for (let i = 1; i < TRAIN_MAX_MOBS / TRAIN_CAMP_SIZE; i++) {
      run(world, GAP_TICKS);
      expect(toasts(train(world, { cmd: "camp", id: NORMAL_TYPES[i]!.id })), `camp ${i + 1}`).toEqual([expect.stringMatching(/^Practice camp/)]);
    }
    expect(practiceMobs(world)).toHaveLength(TRAIN_MAX_MOBS);
    run(world, GAP_TICKS);
    expect(toasts(train(world, { cmd: "camp", id: "wyrmling" }))).toEqual([expect.stringMatching(/At most 12 practice mobs/)]);
    expect(practiceMobs(world)).toHaveLength(TRAIN_MAX_MOBS);

    // Clearing frees the cap but not the room's lifetime share, which the fx roster (it never shrinks) is why.
    const spawned = TRAIN_MAX_MOBS;
    const camps = Math.floor((TRAIN_MAX_MOBS_SPAWNED - spawned) / TRAIN_CAMP_SIZE);
    for (let i = 0; i < camps; i++) {
      train(world, { cmd: "clear" });
      run(world, GAP_TICKS);
      expect(toasts(train(world, { cmd: "camp", id: "emberImp" })), `camp ${i}`).toEqual([expect.stringMatching(/^Practice camp/)]);
    }
    train(world, { cmd: "clear" });
    run(world, GAP_TICKS);
    expect(toasts(train(world, { cmd: "camp", id: "emberImp" }))).toEqual([expect.stringMatching(/leave and come back/)]);
    expect(practiceMobs(world)).toHaveLength(0);
  });
});

// ============================================================================================ chests

describe("train chest", () => {
  it("drops a reward chest in view, about two tiles from the player, with three random live options for their faction and the normal expiry", () => {
    const world = trainingWorld("sentenced");
    const p = me(world);
    const at = world.state.serverTime + TICK_MS; // the tick the order is applied in
    const events = train(world, { cmd: "chest" });
    const chests = rewardChests(world);
    expect(chests).toHaveLength(1);
    const chest = chests[0]!;
    expect(chest).toMatchObject({ kind: "reward", camp: 0, pickers: expect.anything() });
    expect(chest.options.length).toBe(CHEST_OPTIONS);
    expect(new Set(chest.options).size).toBe(CHEST_OPTIONS);
    for (const id of chest.options) expect(skillLive(id), id).toBe(true);
    expect(chest.options[0]).toBe("witness"); // Sentenced's one live passive is the zone card, then neutrals
    expect([...chest.takenBy]).toEqual(["", "", ""]);
    expect([...chest.pickers]).toEqual([]);
    expect(chest.expiresAt).toBe(at + CHEST_SECONDS * 1000);
    expect(tilesFrom(p, chest)).toBeGreaterThanOrEqual(1.5);
    expect(tilesFrom(p, chest)).toBeLessThanOrEqual(3);
    expect(hasLineOfSight(world.map, p, chest)).toBe(true);
    expect(toasts(events)).toEqual([expect.stringMatching(/^Chest: Witness, /)]);
  });

  it("a faction with no live passive of its own gets neutrals only", () => {
    const world = trainingWorld("fire");
    train(world, { cmd: "chest" });
    const [chest] = rewardChests(world);
    expect(chest!.options.length).toBe(CHEST_OPTIONS);
    for (const id of chest!.options) expect(skillDef(id)!.pool).toBe("neutral");
  });

  it("is not held back by a camp dropped a moment ago (the two have gaps of their own)", () => {
    const world = trainingWorld("fire");
    expect(toasts(train(world, { cmd: "camp", id: "emberImp" }))).toEqual([expect.stringMatching(/^Practice camp/)]);
    expect(toasts(train(world, { cmd: "chest" }))).toEqual([expect.stringMatching(/^Chest: /)]);
    expect(toasts(train(world, { cmd: "chest" }))).toEqual(["Slow down"]);
  });

  it("offers the options it is given, in that order, live or not (a toast flags the ones that are not)", () => {
    const world = trainingWorld("holy");
    const [note] = toasts(train(world, { cmd: "chest", options: ["swiftBoots", "firebrand"] }));
    const [chest] = rewardChests(world);
    expect([...chest!.options]).toEqual(["swiftBoots", "firebrand"]);
    expect([...chest!.takenBy]).toEqual(["", ""]);
    expect(note).toBe("Chest: Swift Boots, Firebrand (not live yet)");
  });

  it("can be picked at once with `choose` (the player is in range and in view), and goes at its expiry", () => {
    const world = trainingWorld("sentenced");
    train(world, { cmd: "chest", options: ["whetstone", "swiftBoots"] }, 2);
    const [chest] = rewardChests(world);
    const events: SimEvent[] = [];
    rtOf(world).inputs.pushAction({ kind: "choose", chest: chest!.id, pick: 1 });
    events.push(...run(world, 1));
    expect(toasts(events)).toEqual([]);
    expect(me(world).build.get("swiftBoots")).toBe(1);
    expect(chest!.takenBy[1]).toBe(ME);
    expect(fxOf(events, "chestTaken")).toEqual([{ kind: "chestTaken", chest: chest!.id, by: ME, option: 1 }]);
    expect(decodeMult(me(world).speedMult)).toBeCloseTo(1.06, 3);

    // 15 s from the drop: still there a tick before, gone in the tick serverTime reaches expiresAt.
    const expiry = chest!.expiresAt;
    while (world.state.serverTime < expiry - TICK_MS) tick(world);
    expect(rewardChests(world)).toHaveLength(1);
    tick(world);
    expect(rewardChests(world)).toEqual([]);
  });

  it("is refused, with a toast and no chest, when too many stand or it comes too soon after the last", () => {
    const world = trainingWorld("fire");
    expect(enqueueClientMessage(rtOf(world).inputs, "train", { cmd: "chest" }, { training: true })).toBe(true);
    expect(enqueueClientMessage(rtOf(world).inputs, "train", { cmd: "chest" }, { training: true })).toBe(true);
    expect(toasts(run(world, 1)).filter((t) => t === "Slow down")).toHaveLength(1);
    expect(rewardChests(world)).toHaveLength(1);
    for (let i = 1; i < TRAIN_MAX_CHESTS; i++) {
      run(world, GAP_TICKS);
      train(world, { cmd: "chest" });
    }
    expect(rewardChests(world)).toHaveLength(TRAIN_MAX_CHESTS);
    expect(new Set(rewardChests(world).map(tileOf)).size).toBe(TRAIN_MAX_CHESTS); // each on a tile of its own
    run(world, GAP_TICKS);
    expect(toasts(train(world, { cmd: "chest" }))).toEqual([expect.stringMatching(/At most 6 chests/)]);
    expect(rewardChests(world)).toHaveLength(TRAIN_MAX_CHESTS);
    expect(nextRank(me(world).build, "whetstone")).toBe(1);
  });
});

// ============================================================================================ clear

describe("train clear", () => {
  it("takes off every buff and passive, removes the practice mobs and the chests, and leaves the dummies and the rack", () => {
    const world = trainingWorld("fire");
    const p = me(world);
    const rack = world.state.containers.size;
    const dummyCount = dummies(world);
    for (const msg of [
      { cmd: "buff", id: "plagueRat", amount: 6 }, { cmd: "buff", id: "iceGolem", amount: 3 }, { cmd: "passive", id: "thickHide", rank: 2 },
      { cmd: "passive", id: "firebrand", rank: 1 }, { cmd: "camp", id: "wyrmling" },
    ]) train(world, msg, GAP_TICKS);
    train(world, { cmd: "chest" }, GAP_TICKS);
    expect(p.buffs.size).toBe(2);
    expect(p.build.size).toBe(2);
    expect(practiceMobs(world)).toHaveLength(1);
    expect(rewardChests(world)).toHaveLength(1);
    expect(p.maxHp).toBeGreaterThan(baseHp("fire"));
    p.hp = p.maxHp;
    rtOf(world).fired = new Set(["skill:secondWind:0"]);

    expect(toasts(train(world, { cmd: "clear" }))).toEqual(["Cleared: buffs, passives, practice mobs and chests"]);
    expect([p.buffs.size, p.build.size]).toEqual([0, 0]);
    expect(practiceMobs(world)).toEqual([]);
    expect(rewardChests(world)).toEqual([]);
    expect(dummies(world)).toBe(dummyCount);
    expect(world.state.containers.size).toBe(rack);
    expect([p.maxHp, p.hp]).toEqual([baseHp("fire"), baseHp("fire")]);
    expect([p.asMult, p.windupMult, p.speedMult, p.armorBonus, p.shieldBonus]).toEqual([IDENTITY.asMult, IDENTITY.windupMult, IDENTITY.speedMult, 0, 0]);
    expect(rtOf(world).fired?.size ?? 0).toBe(0);
  });

  it("the arrows and balls the practice mobs have in the air end with them: a projEnd 'cleared', and nothing lands after", () => {
    const world = trainingWorld("fire");
    train(world, { cmd: "camp", id: "plagueRat" }); // Plague's mobs carry the bow
    const shooters = new Set(practiceMobs(world).map(([id]) => id));
    const [lead] = practiceMobs(world);
    const p = me(world);
    p.x = lead![1].x + 150; // inside the bow's 240 u, in the open
    p.y = lead![1].y;
    rtOf(world).history = [{ t: world.state.serverTime, x: p.x, y: p.y }];
    aggro(world, combatant(world, lead![0]) as MobCombatant, ME, 1);
    let inFlight: string[] = [];
    for (let i = 0; i < 80 && inFlight.length === 0; i++) {
      tick(world);
      inFlight = [...world.projectiles.values()].filter((pr) => shooters.has(pr.owner)).map((pr) => pr.id);
    }
    expect(inFlight.length, "a practice mob loosed an arrow").toBeGreaterThan(0);
    const hp = p.hp;

    const events = train(world, { cmd: "clear" });
    expect([...world.projectiles.values()].filter((pr) => shooters.has(pr.owner))).toEqual([]);
    const ends = events.flatMap((e) => (e.type === "fx" && e.fx.kind === "projEnd" ? [e.fx] : []));
    expect(ends.map((e) => e.id).sort()).toEqual(inFlight.sort());
    expect(ends.every((e) => e.reason === "cleared")).toBe(true);
    run(world, 40);
    expect(p.hp).toBe(hp); // no arrow of a cleared mob finds the player
    expect(p.status).toBe("alive");
  });

  it("a player locked on a practice mob that is cleared away is simply let go, and the room keeps ticking", () => {
    const world = trainingWorld("fire");
    train(world, { cmd: "camp", id: "emberImp" });
    const [id, m] = practiceMobs(world)[0]!;
    me(world).x = m.x - 40;
    me(world).y = m.y;
    rtOf(world).inputs.pushAction({ kind: "target", id });
    run(world, 2);
    expect(rtOf(world).weapon.lock).toBe(id);
    train(world, { cmd: "clear" }, 3);
    expect(rtOf(world).weapon.lock).toBeNull();
    expect(world.state.phase).toBe("active");
  });
});

// ============================================================================================ it records nothing

describe("the console never makes the training room record anything", () => {
  it("whatever it is used for, nobody resolves, banks or earns anything, and the run stays on", () => {
    const world = trainingWorld("plague");
    const events: SimEvent[] = [];
    const p = me(world);
    for (const msg of [
      { cmd: "buff", id: "executioner", amount: 12 }, { cmd: "passive", id: "pestilence", rank: 2 }, { cmd: "camp", id: "ratOgre" },
      { cmd: "chest", options: ["whetstone"] }, { cmd: "camp", id: "bloatfly" }, { cmd: "clear" },
    ]) events.push(...train(world, msg, GAP_TICKS));
    expect(events.filter((e) => e.type === "gv" || e.type === "resolved" || e.type === "raidEnded")).toEqual([]);
    expect([p.gv, p.kills, p.mobKills, p.bounty]).toEqual([0, 0, 0, 0]);
    expect(rtOf(world).gv).toEqual({ kills: 0, mobs: 0, bounty: 0 });
    expect(rtOf(world).resolved).toBe(false);
    expect(world.state).toMatchObject({ phase: "active", training: true, patienceEndsAt: 0, gatesLocked: false });
    expect(world.state.camps.length).toBe(0);
  });

  it("a chest SKIP that heals nothing (full hp, or in combat) pays no GV and sends no '+3 GV' toast in training, where an arena skip pays", () => {
    const skip = (w: World, trainingOff = false): SimEvent[] => {
      train(w, { cmd: "chest", options: ["whetstone"] }, GAP_TICKS);
      if (trainingOff) w.config = { ...w.config, training: false }; // the console needed the flag; the pick does not
      const [chest] = rewardChests(w);
      rtOf(w).inputs.pushAction({ kind: "choose", chest: chest!.id, pick: -1 });
      return run(w, 1);
    };
    const world = trainingWorld("plague");
    expect(me(world).hp).toBe(me(world).maxHp); // nothing to heal: the GV branch
    const events = skip(world);
    expect(fxOf(events, "chestTaken")).toEqual([expect.objectContaining({ by: ME, option: -1 })]); // the skip itself went through
    expect(events.filter((e) => e.type === "gv")).toEqual([]);
    expect([me(world).gv, rtOf(world).gv]).toEqual([0, { kills: 0, mobs: 0, bounty: 0 }]);

    // Hurt and out of combat: the heal pays, still no GV. In combat the heal is locked out (the other GV branch).
    const hurt = trainingWorld("plague");
    me(hurt).hp = me(hurt).maxHp * 0.5;
    train(hurt, { cmd: "chest", options: ["whetstone"] }, GAP_TICKS);
    const [box] = rewardChests(hurt);
    hurt.factions!.fighters.get(ME)!.combatAt = hurt.state.serverTime + 5000; // inside the 3 s lockout when the pick lands
    rtOf(hurt).inputs.pushAction({ kind: "choose", chest: box!.id, pick: -1 });
    const lockedOut = run(hurt, 1);
    expect(fxOf(lockedOut, "chestTaken")).toHaveLength(1);
    expect(me(hurt).hp).toBe(me(hurt).maxHp * 0.5); // the heal was refused: the GV branch, and still nothing paid
    expect(lockedOut.filter((e) => e.type === "gv")).toEqual([]);
    expect(me(hurt).gv).toBe(0);

    // The control: the same skip with the training flag off pays GV_SKIP, so the checks above could have failed.
    const paying = trainingWorld("plague");
    const paid = skip(paying, true);
    expect(paid.filter((e) => e.type === "gv")).toEqual([{ type: "gv", id: ME, amount: GV_SKIP, reason: "skip" }]);
  });
});

// A short reminder of what the tests above depend on staying true.
describe("the console's contract", () => {
  it("every mob type and every passive is reachable by id, and the catalogs' sizes are what the client's pickers show", () => {
    expect(MOB_TYPES).toHaveLength(20);
    expect(SKILL_IDS).toHaveLength(21);
    expect(mobTypeById("wyrmling" satisfies MobTypeId)?.elite).toBe(true);
  });
});
