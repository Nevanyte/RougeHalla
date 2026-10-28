// The training room's practice console (the `train` message, sim/training.ts): what it accepts, what each command does to the
// world, and that none of it exists in an arena. Headless, built the way the Room builds a training world (createGameWorld with the
// training config, installTraining, addPlayer, startRaid), with an arena world as the control. The live half (a real room, a
// real socket) is in test/training.test.ts.
import { describe, expect, it } from "vitest";
import {
  CARD_IDS, cardDef, cardLive, CHEST_OPTIONS, CHEST_SECONDS, circleClear, decodeFlat, decodeMult, FACTIONS, GV_SKIP, hasLineOfSight,
  MOB_TYPES, mobTypeById, mobTypeFaction, mobTypeWeapon, mulberry32, PLAYER_RADIUS, REGION_FACTIONS, TICK_MS, TILE, TRAIN_CAMP_SIZE,
  TRAIN_DEFAULT_CARD_COUNT, TRAIN_MAX_CARD_COUNT, TRAIN_MAX_CHESTS, TRAIN_MAX_MOBS, TRAIN_MAX_MOBS_SPAWNED, TRAIN_SPAWN_GAP_MS,
  WIRE_IDENTITY_MIRRORS, type FactionId, type FxEvent, type MobTypeId,
} from "@raid/shared";
import type { MobState, PlayerState } from "@raid/shared/schema";
import { clearChests, grantCard, rewardChests } from "../src/sim/chests";
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
import { withNotLive } from "./support/notLive";

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
    for (const msg of [{ cmd: "card", id: "ad1" }, { cmd: "clear" }, { cmd: "camp", id: "wyrmling" }, { cmd: "chest" }]) {
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

  it("card: a known card id and a finite count, floored and clamped to 0..TRAIN_MAX_CARD_COUNT, one copy when none is given", () => {
    expect(parseTrain({ cmd: "card", id: "ad1" })).toEqual({ kind: "train", cmd: "card", id: "ad1", count: TRAIN_DEFAULT_CARD_COUNT });
    expect(TRAIN_DEFAULT_CARD_COUNT).toBe(1);
    for (const [count, want] of [[6, 6], [0, 0], [2.7, 2], [99, TRAIN_MAX_CARD_COUNT], [-4, 0], [1e9, TRAIN_MAX_CARD_COUNT]] as const) {
      expect(parseTrain({ cmd: "card", id: "haste2", count }), String(count)).toEqual({ kind: "train", cmd: "card", id: "haste2", count: want });
    }
    for (const id of CARD_IDS) expect(parseTrain({ cmd: "card", id }), id).not.toBeNull(); // live or not: all of them
    for (const bad of [
      { cmd: "card" }, { cmd: "card", id: "" }, { cmd: "card", id: "nope" }, { cmd: "card", id: "whetstone" }, { cmd: "card", id: 3 },
      { cmd: "card", id: null }, { cmd: "card", id: "emberImp" }, { cmd: "card", id: "ad1", count: "3" }, { cmd: "card", id: "ad1", count: NaN },
      { cmd: "card", id: "ad1", count: Infinity }, { cmd: "card", id: "ad1", count: null },
      { cmd: "card", id: "x".repeat(65) }, { cmd: "card", id: ["ad1"] }, { cmd: "card", id: "__proto__" },
      { cmd: "buff", id: "emberImp" }, { cmd: "passive", id: "whetstone" }, // the retired commands
    ]) expect(parseTrain(bad), JSON.stringify(bad)).toBeNull();
  });

  it("camp: any of the 30 mob types, nothing else", () => {
    for (const t of MOB_TYPES) expect(parseTrain({ cmd: "camp", id: t.id }), t.id).toEqual({ kind: "train", cmd: "camp", id: t.id });
    for (const bad of [{ cmd: "camp" }, { cmd: "camp", id: "fire" }, { cmd: "camp", id: "Wyrmling" }, { cmd: "camp", id: 1 }, { cmd: "camp", id: "ad1" }]) {
      expect(parseTrain(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("chest: no options (or an empty list) asks for the server's rolled cards; otherwise 1 to 3 distinct known cards", () => {
    expect(parseTrain({ cmd: "chest" })).toEqual({ kind: "train", cmd: "chest", options: [] });
    expect(parseTrain({ cmd: "chest", options: [] })).toEqual({ kind: "train", cmd: "chest", options: [] });
    expect(parseTrain({ cmd: "chest", options: ["ad1"] })).toEqual({ kind: "train", cmd: "chest", options: ["ad1"] });
    expect(parseTrain({ cmd: "chest", options: ["ad1", "overkill", "witness"] })).toMatchObject({ options: ["ad1", "overkill", "witness"] });
    expect(CHEST_OPTIONS).toBe(3);
    for (const bad of [
      { cmd: "chest", options: ["ad1", "ad1"] }, { cmd: "chest", options: ["a", "b", "c", "d"] },
      { cmd: "chest", options: ["ad1", "haste1", "armor1", "mr1"] }, { cmd: "chest", options: ["nope"] },
      { cmd: "chest", options: ["ad1", "nope"] }, { cmd: "chest", options: ["whetstone"] }, { cmd: "chest", options: "ad1" }, { cmd: "chest", options: [1] },
      { cmd: "chest", options: null }, { cmd: "chest", options: { 0: "ad1" } },
    ]) expect(parseTrain(bad), JSON.stringify(bad)).toBeNull();
  });

  it("clear takes nothing; an unknown command, a missing one or a message that is not an object is refused whole", () => {
    expect(parseTrain({ cmd: "clear" })).toEqual({ kind: "train", cmd: "clear" });
    expect(parseTrain({ cmd: "clear", id: "junk", amount: 5 })).toEqual({ kind: "train", cmd: "clear" });
    for (const bad of [{}, { cmd: "" }, { cmd: "give" }, { cmd: "Card", id: "ad1" }, { cmd: 1 }, { cmd: null }, { cmd: ["clear"] }, null, undefined, "clear", 7, []]) {
      expect(parseTrain(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("a refused message in a training room counts for nothing: it returns false (so the idle rule is not fed) and queues nothing", () => {
    const q = fresh();
    for (const bad of [{}, { cmd: "card", id: "nope" }, { cmd: "buff", id: "emberImp" }, null, "clear"]) {
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
      { kind: "train", cmd: "card", id: "armor2", count: 3 },
      { kind: "train", cmd: "camp", id: "emberImp" }, { kind: "train", cmd: "chest", options: [] }, { kind: "train", cmd: "clear" },
    ];
    for (const msg of queued) rt.inputs.pushAction(msg);
    const events = run(world, 3);
    expect(me(world).build.size).toBe(0);
    expect([world.state.mobs.size, world.state.containers.size]).toEqual([before.mobs, before.containers]);
    expect(toasts(events)).toEqual([]);

    // And called directly, the training handler checks the flag itself.
    handleTrain(world, combatant(world, ME)!, { kind: "train", cmd: "card", id: "armor2", count: 3 });
    handleTrain(world, combatant(world, ME)!, { kind: "train", cmd: "camp", id: "emberImp" });
    expect(me(world).build.size).toBe(0);
    expect(world.state.mobs.size).toBe(before.mobs);
  });
});

// ============================================================================================ cards

describe("train card", () => {
  it("sets the copies and re-folds the mirrors at once, exactly as a chest pick does", () => {
    const world = trainingWorld("fire");
    const events = train(world, { cmd: "card", id: "haste2", count: 2 });
    expect(me(world).build.get("haste2")).toBe(2);
    expect(decodeMult(me(world).asMult)).toBeCloseTo(1.32, 3); // two Haste II cards: +32% attack speed
    expect(toasts(events)).toEqual(["Haste II x2: +16% attack speed"]);

    // The same copies given by the chest's own grant fold to the very same mirrors.
    const other = trainingWorld("fire");
    grantCard(other, combatant(other, ME) as never, "haste2");
    grantCard(other, combatant(other, ME) as never, "haste2");
    expect(me(other).asMult).toBe(me(world).asMult);
    expect(me(other).build.get("haste2")).toBe(2);
  });

  it("max hp follows (and the hp that came with it), speed and armor rows reach their mirrors, and 0 takes everything back", () => {
    const world = trainingWorld("fire");
    const p = me(world);
    expect([p.maxHp, p.hp]).toEqual([baseHp("fire"), baseHp("fire")]);
    train(world, { cmd: "card", id: "vitality2" }); // +16% max hp
    expect(p.maxHp).toBeCloseTo(baseHp("fire") * 1.16, 6);
    expect(p.hp).toBeCloseTo(p.maxHp, 6);
    train(world, { cmd: "card", id: "armor3" }); // +41 armor
    expect(decodeFlat(p.armorBonus)).toBeCloseTo(41, 0);
    train(world, { cmd: "card", id: "mr2" }); // +26 magic resist
    expect(decodeFlat(p.shieldBonus)).toBeCloseTo(26, 0);
    train(world, { cmd: "card", id: "hearty" }); // +18% max hp, needs Vitality (held)
    expect(p.maxHp).toBeCloseTo(baseHp("fire") * 1.34, 6);

    for (const id of ["hearty", "vitality2", "armor3", "mr2"]) train(world, { cmd: "card", id, count: 0 });
    expect(p.build.size).toBe(0);
    expect(p.maxHp).toBeCloseTo(baseHp("fire"), 6);
    expect(p.hp).toBeCloseTo(baseHp("fire"), 6); // hp never above the new max
    expect([p.asMult, p.windupMult, p.speedMult, p.armorBonus, p.shieldBonus]).toEqual([IDENTITY.asMult, IDENTITY.windupMult, IDENTITY.speedMult, 0, 0]);
  });

  it("is a set, not an add: the same count twice is the same copies, a smaller one lowers them, and the count is clamped (a unique card is held once)", () => {
    const world = trainingWorld("sentenced");
    const p = me(world);
    train(world, { cmd: "card", id: "haste1", count: 6 });
    train(world, { cmd: "card", id: "haste1", count: 6 });
    expect(p.build.get("haste1")).toBe(6);
    const six = p.asMult;
    train(world, { cmd: "card", id: "haste1", count: 2 });
    expect(p.build.get("haste1")).toBe(2);
    expect(p.asMult).toBeLessThan(six);
    expect(decodeMult(p.asMult)).toBeGreaterThan(1);
    train(world, { cmd: "card", id: "haste1", count: 99 });
    expect(p.build.get("haste1")).toBe(TRAIN_MAX_CARD_COUNT);
    train(world, { cmd: "card", id: "haste1", count: -7 });
    expect(p.build.has("haste1")).toBe(false);
    train(world, { cmd: "card", id: "haste1" }); // the default
    expect(p.build.get("haste1")).toBe(TRAIN_DEFAULT_CARD_COUNT);
    train(world, { cmd: "card", id: "glassCannon", count: 5 });
    expect(p.build.get("glassCannon")).toBe(1);
  });

  it("answers with a toast naming the card and what it gives, and flags a card that waits for its hook", () => {
    const world = trainingWorld("fire");
    const [ok] = toasts(train(world, { cmd: "card", id: "ad3" }));
    expect(ok).toBe("Attack Damage III x1: +33 attack damage");
    const [unique] = toasts(train(world, { cmd: "card", id: "glassCannon" }));
    expect(unique).toBe("Glass Cannon: +35% damage, -25% max health.");
    withNotLive(["overkill"], () => {
      const [pending] = toasts(train(world, { cmd: "card", id: "overkill" }));
      expect(pending).toMatch(/^Overkill: .*\(not live yet: no effect\)$/);
      expect(cardLive("overkill")).toBe(false);
    });
    expect(toasts(train(world, { cmd: "card", id: "ad3", count: 0 }))).toEqual(["Attack Damage III removed"]);
  });

  it("a conditional needs a card of its base: refused with a toast and nothing set, then fine once the base is held", () => {
    const world = trainingWorld("fire");
    const [refused] = toasts(train(world, { cmd: "card", id: "hearty" }));
    expect(refused).toBe("Hearty: Needs Vitality");
    expect(me(world).build.size).toBe(0);
    train(world, { cmd: "card", id: "vitality1" });
    train(world, { cmd: "card", id: "hearty" });
    expect(me(world).build.get("hearty")).toBe(1);
    expect(me(world).maxHp).toBeCloseTo(baseHp("fire") * (1 + 0.09 + 0.18), 6);
  });

  it("re-arms a once-per-run trigger when its card is taken off, and not when it is only lowered", () => {
    const world = trainingWorld("holy");
    train(world, { cmd: "card", id: "secondWind" });
    const rt = rtOf(world);
    rt.fired = new Set(["card:secondWind:0", "skill:other:0"]);
    train(world, { cmd: "card", id: "secondWind", count: 1 });
    expect([...rt.fired]).toEqual(["card:secondWind:0", "skill:other:0"]);
    train(world, { cmd: "card", id: "secondWind", count: 0 });
    expect([...rt.fired]).toEqual(["skill:other:0"]);
  });

  it("folds with other cards: Haste, Fleet and Quickdraw each reach their own mirror, and removing one leaves the others", () => {
    const world = trainingWorld("fire");
    const p = me(world);
    train(world, { cmd: "card", id: "haste2" });
    train(world, { cmd: "card", id: "fleet2" }); // +10% move speed
    train(world, { cmd: "card", id: "quickdraw" }); // -50% melee windup
    expect(decodeMult(p.asMult)).toBeCloseTo(1.16, 3);
    expect(decodeMult(p.speedMult)).toBeCloseTo(1.1, 3);
    expect(decodeMult(p.windupMult)).toBeCloseTo(0.5, 3);
    train(world, { cmd: "card", id: "fleet2", count: 0 });
    expect(p.speedMult).toBe(IDENTITY.speedMult);
    expect(decodeMult(p.asMult)).toBeCloseTo(1.16, 3);
  });

  it("is the same fold as a chest pick: Armor II by the console and by `choose` leave the very same stats", () => {
    const byConsole = trainingWorld("frost");
    train(byConsole, { cmd: "card", id: "armor2" });

    const byChest = trainingWorld("frost");
    train(byChest, { cmd: "chest", options: ["armor2"] }, 2);
    const [chest] = rewardChests(byChest);
    expect(chest).toBeDefined();
    rtOf(byChest).inputs.pushAction({ kind: "choose", chest: chest!.id, pick: 0 });
    run(byChest, 1);
    expect(me(byChest).build.get("armor2")).toBe(1);

    for (const field of ["maxHp", "hp", "asMult", "windupMult", "speedMult", "armorBonus", "shieldBonus"] as const) {
      expect(me(byChest)[field], field).toBe(me(byConsole)[field]);
    }
  });

  it("sets a card whose machinery is not live yet, which does nothing, and says so in its toast", () => {
    const world = trainingWorld("fire");
    const p = me(world);
    withNotLive(["tankEngine"], () => {
      expect(cardDef("tankEngine")!.ready).toBe("b");
      const [note] = toasts(train(world, { cmd: "card", id: "tankEngine" }));
      expect(p.build.get("tankEngine")).toBe(1);
      expect(note).toMatch(/Tank Engine.*not live yet: no effect/);
      expect([p.asMult, p.speedMult, p.armorBonus, p.maxHp]).toEqual([IDENTITY.asMult, IDENTITY.speedMult, 0, baseHp("fire")]);
    });
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
        kind: "mob", name: "Ember Imp", type: "emberImp", faction: "fire", weapon0: mobTypeWeapon("fire", "emberImp"), status: "alive",
        maxHp: mobTypeFaction("fire", false, "emberImp", mobScale(false)).hp,
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

  it("an elite type is a lone elite; every one of the 30 types spawns as its row says, in its zone", () => {
    for (const t of MOB_TYPES) {
      const world = trainingWorld(REGION_FACTIONS[0]);
      train(world, { cmd: "camp", id: t.id });
      const mobs = practiceMobs(world);
      expect(mobs.length, t.id).toBe(t.elite ? 1 : TRAIN_CAMP_SIZE);
      for (const [id, m] of mobs) {
        expect(m, t.id).toMatchObject({ kind: t.elite ? "elite" : "mob", type: t.id, name: t.name, faction: t.zone });
        expect(m.maxHp, t.id).toBe(mobTypeFaction(t.zone, t.elite, t.id, mobScale(t.elite)).hp);
        expect(m.weapon0, t.id).toBe(t.weapon);
        expect(world.mobs.get(id)!.brain, t.id).toMatchObject({ region: t.zone, elite: t.elite });
      }
    }
    expect(ELITE_TYPES).toHaveLength(10);
    expect(NORMAL_TYPES).toHaveLength(20);
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

  it("their death pays and records nothing: no GV, feed, drop, camp or chest, where the same kill in an arena run pays", () => {
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
    expect([p.gv, p.mobKills, p.kills, p.bounty]).toEqual([0, 0, 0, 0]);
    expect(rtOf(world).gv).toEqual({ kills: 0, mobs: 0, bounty: 0, quest: 0 });
    expect(rtOf(world).mobKills).toBe(0);
    expect(p.build.size).toBe(0);
    expect(world.state.containers.size).toBe(containers); // no weapon dropped, no chest
    expect(rewardChests(world)).toEqual([]);
    expect(world.state.camps.length).toBe(0);
    expect(world.state.phase).toBe("active");

    // The control: the same kill with the training flag off pays the GV, so the checks above could have failed.
    const paying = trainingWorld("fire");
    train(paying, { cmd: "camp", id: "emberImp" });
    paying.config = { ...paying.config, training: false };
    const paid = strike(paying, practiceMobs(paying)[0]![0], 1e6);
    expect(paid.some((e) => e.type === "gv")).toBe(true);
    expect(rtOf(paying).mobKills).toBe(1);
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
  it("drops a reward chest in view, about two tiles from the player, with three rolled live cards (a base card, a second base card, an augment) and the normal expiry", () => {
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
    for (const id of chest.options) expect(cardLive(id), id).toBe(true);
    // The player holds no card: no conditional is offered to them.
    expect(chest.options.map((id) => cardDef(id)!.kind)).toEqual(["base", "base", "augment"]);
    expect([...chest.takenBy]).toEqual(["", "", ""]);
    expect([...chest.pickers]).toEqual([]);
    expect(chest.expiresAt).toBe(at + CHEST_SECONDS * 1000);
    expect(tilesFrom(p, chest)).toBeGreaterThanOrEqual(1.5);
    expect(tilesFrom(p, chest)).toBeLessThanOrEqual(3);
    expect(hasLineOfSight(world.map, p, chest)).toBe(true);
    expect(toasts(events)).toEqual([expect.stringMatching(/^Chest: /)]);
  });

  it("rolls for what the player holds: with a Leech card, a conditional of Leech comes up now and then, and no other", () => {
    const world = trainingWorld("fire");
    grantCard(world, combatant(world, ME) as never, "leech1");
    let conditionals = 0;
    for (let i = 0; i < 40; i++) {
      train(world, { cmd: "chest" }, GAP_TICKS);
      const [chest] = rewardChests(world);
      for (const id of chest!.options) {
        const def = cardDef(id)!;
        if (def.kind === "conditional") {
          conditionals++;
          expect(def.requires).toBe("leech");
        }
      }
      clearChests(world);
    }
    expect(conditionals).toBeGreaterThan(8);
  });

  it("is not held back by a camp dropped a moment ago (the two have gaps of their own)", () => {
    const world = trainingWorld("fire");
    expect(toasts(train(world, { cmd: "camp", id: "emberImp" }))).toEqual([expect.stringMatching(/^Practice camp/)]);
    expect(toasts(train(world, { cmd: "chest" }))).toEqual([expect.stringMatching(/^Chest: /)]);
    expect(toasts(train(world, { cmd: "chest" }))).toEqual(["Slow down"]);
  });

  it("offers the options it is given, in that order, live or not (a toast flags the ones that are not)", () => {
    const world = trainingWorld("holy");
    const [note] = withNotLive(["overkill"], () => toasts(train(world, { cmd: "chest", options: ["fleet1", "overkill"] })));
    const [chest] = rewardChests(world);
    expect([...chest!.options]).toEqual(["fleet1", "overkill"]);
    expect([...chest!.takenBy]).toEqual(["", ""]);
    expect(note).toBe("Chest: Fleet I, Overkill (not live yet)");
  });

  it("can be picked at once with `choose` (the player is in range and in view), and goes at its expiry", () => {
    const world = trainingWorld("sentenced");
    train(world, { cmd: "chest", options: ["haste1", "fleet1"] }, 2);
    const [chest] = rewardChests(world);
    const events: SimEvent[] = [];
    rtOf(world).inputs.pushAction({ kind: "choose", chest: chest!.id, pick: 1 });
    events.push(...run(world, 1));
    expect(toasts(events)).toEqual([]);
    expect(me(world).build.get("fleet1")).toBe(1);
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
  });
});

// ============================================================================================ clear

describe("train clear", () => {
  it("takes off every card, removes the practice mobs and the chests, and leaves the dummies and the rack", () => {
    const world = trainingWorld("fire");
    const p = me(world);
    const rack = world.state.containers.size;
    const dummyCount = dummies(world);
    for (const msg of [
      { cmd: "card", id: "haste1", count: 6 }, { cmd: "card", id: "vitality3" }, { cmd: "card", id: "armor2", count: 2 },
      { cmd: "card", id: "overkill" }, { cmd: "camp", id: "wyrmling" },
    ]) train(world, msg, GAP_TICKS);
    train(world, { cmd: "chest" }, GAP_TICKS);
    expect(p.build.size).toBe(4);
    expect(practiceMobs(world)).toHaveLength(1);
    expect(rewardChests(world)).toHaveLength(1);
    expect(p.maxHp).toBeGreaterThan(baseHp("fire"));
    p.hp = p.maxHp;
    rtOf(world).fired = new Set(["card:secondWind:0"]);

    expect(toasts(train(world, { cmd: "clear" }))).toEqual(["Cleared: cards, practice mobs and chests"]);
    expect(p.build.size).toBe(0);
    expect(practiceMobs(world)).toEqual([]);
    expect(rewardChests(world)).toEqual([]);
    expect(dummies(world)).toBe(dummyCount);
    expect(world.state.containers.size).toBe(rack);
    expect([p.maxHp, p.hp]).toEqual([baseHp("fire"), baseHp("fire")]);
    expect([p.asMult, p.windupMult, p.speedMult, p.armorBonus, p.shieldBonus]).toEqual([IDENTITY.asMult, IDENTITY.windupMult, IDENTITY.speedMult, 0, 0]);
    expect(rtOf(world).fired?.size ?? 0).toBe(0);
  });

  it("also forgets what the cards left behind: Tank Engine's earned max hp, the crit and streak memory, a barrier, the camps counted (the final review's m9)", () => {
    const world = trainingWorld("holy");
    const p = me(world);
    const rt = rtOf(world);
    train(world, { cmd: "card", id: "tankEngine" });
    train(world, { cmd: "card", id: "secondSkin" });
    const holder = combatant(world, ME)!;
    const bag = combatant(world, [...world.state.mobs].find(([, m]) => m.kind === "dummy")![0])!;
    for (let i = 0; i < 10; i++) world.hooks.blocked?.(world, holder, bag, { raw: 200, phys: 1, magic: 0, true: 0 }, true);
    expect(p.maxHp, "Tank Engine earned some").toBeGreaterThan(baseHp("holy"));
    p.barrier = 80;
    rt.boost = { shieldUntil: world.state.serverTime + 60_000, decays: true };
    rt.campsCleared = 4;
    world.campContrib = new Map([[PRACTICE_CAMP_FIRST, new Set([ME])]]);
    expect(rt.cards?.tankHp).toBeGreaterThan(0);

    train(world, { cmd: "clear" });
    expect(p.maxHp).toBe(baseHp("holy"));
    expect(p.hp).toBeLessThanOrEqual(baseHp("holy"));
    expect(p.barrier).toBe(0);
    expect(rt.boost?.shieldUntil ?? 0).toBe(0);
    expect(rt.campsCleared ?? 0).toBe(0);
    expect(world.campContrib?.size ?? 0).toBe(0);
    expect(rt.cards?.tankHp ?? 0).toBe(0);
    expect(rt.cards?.prevented ?? 0).toBe(0);
    // A card taken again starts from nothing: the earned hp is not remembered anywhere.
    train(world, { cmd: "card", id: "tankEngine" });
    expect(p.maxHp).toBe(baseHp("holy"));
    run(world, 40);
    expect(p.maxHp).toBe(baseHp("holy"));
  });

  it("`card tankEngine 0` takes the earned max hp with it, and another card's removal leaves it alone", () => {
    const world = trainingWorld("holy");
    const p = me(world);
    train(world, { cmd: "card", id: "tankEngine" });
    train(world, { cmd: "card", id: "vitality1" });
    const holder = combatant(world, ME)!;
    const bag = combatant(world, [...world.state.mobs].find(([, m]) => m.kind === "dummy")![0])!;
    for (let i = 0; i < 10; i++) world.hooks.blocked?.(world, holder, bag, { raw: 200, phys: 1, magic: 0, true: 0 }, true);
    const earned = rtOf(world).cards!.tankHp;
    expect(earned).toBeGreaterThan(0);
    train(world, { cmd: "card", id: "vitality1", count: 0 });
    expect(p.maxHp).toBeCloseTo(baseHp("holy") + earned, 6);
    train(world, { cmd: "card", id: "tankEngine", count: 0 });
    expect(p.maxHp).toBe(baseHp("holy"));
    expect(rtOf(world).cards?.tankHp ?? 0).toBe(0);
  });

  it("the arrows and balls the practice mobs have in the air end with them: a projEnd 'cleared', and nothing lands after", () => {
    const world = trainingWorld("fire");
    train(world, { cmd: "camp", id: "plagueRat" }); // Plague's mobs carry the bow
    const shooters = new Set(practiceMobs(world).map(([id]) => id));
    const [lead] = practiceMobs(world);
    const p = me(world);
    // Inside the bow's 240 u, in the open: the first spot (ring 150 u, then nearer and farther; 16 directions) with room for a body and a clear line to the mob.
    const around = (r: number) => Array.from({ length: 16 }, (_, k) => ({ x: lead![1].x + Math.cos((k * Math.PI) / 8) * r, y: lead![1].y + Math.sin((k * Math.PI) / 8) * r }));
    const spot = [150, 120, 180, 90, 210].flatMap(around).find((at) => circleClear(world.map, at, PLAYER_RADIUS) && hasLineOfSight(world.map, at, lead![1]));
    expect(spot, "an open spot within the bow's range of the practice mob").toBeDefined();
    p.x = spot!.x;
    p.y = spot!.y;
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
      { cmd: "card", id: "coupDeGrace", count: 9 }, { cmd: "card", id: "pestilence" }, { cmd: "camp", id: "ratOgre" },
      { cmd: "chest", options: ["haste1"] }, { cmd: "camp", id: "bloatfly" }, { cmd: "clear" },
    ]) events.push(...train(world, msg, GAP_TICKS));
    expect(events.filter((e) => e.type === "gv" || e.type === "resolved" || e.type === "raidEnded")).toEqual([]);
    expect([p.gv, p.kills, p.mobKills, p.bounty]).toEqual([0, 0, 0, 0]);
    expect(rtOf(world).gv).toEqual({ kills: 0, mobs: 0, bounty: 0, quest: 0 });
    expect(rtOf(world).resolved).toBe(false);
    expect(world.state).toMatchObject({ phase: "active", training: true, patienceEndsAt: 0, gatesLocked: false });
    expect(world.state.camps.length).toBe(0);
  });

  it("a chest SKIP that heals nothing (full hp, or in combat) pays no GV and sends no '+3 GV' toast in training, where an arena skip pays", () => {
    const skip = (w: World, trainingOff = false): SimEvent[] => {
      train(w, { cmd: "chest", options: ["haste1"] }, GAP_TICKS);
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
    expect([me(world).gv, rtOf(world).gv]).toEqual([0, { kills: 0, mobs: 0, bounty: 0, quest: 0 }]);

    // Hurt and out of combat: the heal pays, still no GV. In combat the heal is locked out (the other GV branch).
    const hurt = trainingWorld("plague");
    me(hurt).hp = me(hurt).maxHp * 0.5;
    train(hurt, { cmd: "chest", options: ["haste1"] }, GAP_TICKS);
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
  it("every mob type and every card is reachable by id, and the catalogs' sizes are what the client's pickers show", () => {
    expect(MOB_TYPES).toHaveLength(30);
    expect(CARD_IDS).toHaveLength(80);
    expect(mobTypeById("wyrmling" satisfies MobTypeId)?.elite).toBe(true);
  });
});
