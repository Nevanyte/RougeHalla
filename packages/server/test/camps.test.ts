// Camp rosters (sim/camps.ts, ROGUELIKE_PLAN D5/D16): rolled at world build from world.rewardRandom only, published as
// state.camps before anyone joins, what the camp spawner places, how `alive` counts down, and what a training or mob-less
// world has. The pure roll (rollZoneTypes and friends) is covered in shared/test/rosters.test.ts.
import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import {
  CAMPS_PER_ZONE, campMobs, eliteTypeOf, FACTION_IDS, mapFromTiles, mobTypeById, mulberry32, normalTypesOf, TICK_MS, type FactionId, type MobTypeId,
} from "@raid/shared";
import { campMobDied, ensureRosters, rollRosters } from "../src/sim/camps";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { hurtMob, install as installMobLife, killMob, mobTypeOf, placeMob, spawnRegionalMobs, type MobCombatant } from "../src/sim/mobLife";
import { addPlayer, step } from "../src/sim/step";
import type { RaidState } from "@raid/shared/schema";
import { createWorld, type LedgerEntry, type SimConfig, type World } from "../src/sim/world";

const BASE: SimConfig = {
  minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60, mobs: true,
};

interface Opts { seed?: number; salt?: number; cfg?: Partial<SimConfig>; random?: () => number; players?: number }

/** A game world (every module) in the lobby; the roster is rolled by the build. */
function lobby(o: Opts = {}): World {
  const seed = o.seed ?? 1234;
  let uid = 0;
  const w = createGameWorld({
    seed, config: { ...BASE, ...o.cfg }, random: o.random ?? mulberry32(seed + 1), rewardSalt: o.salt ?? seed * 31 + 7,
    newItemUid: () => `L${++uid}`,
  });
  for (let i = 0; i < (o.players ?? 2); i++) addPlayer(w, `p${i}`, `name${i}`);
  return w;
}

/** The run started (first step). */
function run(o: Opts = {}): World {
  const w = lobby(o);
  step(w, TICK_MS);
  expect(w.state.phase).toBe("active");
  return w;
}

const roster = (w: World): string[] => [...w.state.camps].map((c) => c.type);
const normalIds = (zone: FactionId): MobTypeId[] => normalTypesOf(zone).map((t) => t.id);
const mobsOf = (w: World): MobCombatant[] => [...w.state.mobs.keys()].map((id) => combatant(w, id) as MobCombatant);

describe("the published roster", () => {
  it("is in state.camps from the build on: before anyone plays, one CampState per map camp", () => {
    const w = lobby({ seed: 3 });
    expect(w.state.phase).toBe("lobby");
    expect(w.state.mobs.size).toBe(0);
    expect(w.map.camps.length).toBeGreaterThan(0);
    expect(w.state.camps.length).toBe(w.map.camps.length);
    w.map.camps.forEach((camp, i) => {
      const s = w.state.camps[i]!;
      expect(normalIds(camp.zone), camp.id).toContain(s.type);
      expect(s.alive, camp.id).toBe(camp.spots.length);
      expect(s.reward).toBe("");
      expect(s.state).toBe(0);
    });
  });

  it("exists in a world with no players and no step at all (rolled at the build, not at the first join)", () => {
    let uid = 0;
    const w = createGameWorld({ seed: 9, config: BASE, random: mulberry32(1), rewardSalt: 5, newItemUid: () => `L${++uid}` });
    expect(w.state.camps.length).toBe(w.map.camps.length);
    expect(w.joined).toBe(0);
  });

  /**
   * D5 on a 4-camp zone: the first three camps (in camp order) take the zone's three normal types, none twice; the fourth
   * repeats one of them, so a zone's type counts are exactly [1, 1, 2] and no type of the zone is absent.
   */
  function expectD5(w: World, label: string): void {
    for (const zone of FACTION_IDS) {
      const types = w.map.camps.flatMap((c, i) => (c.zone === zone ? [w.state.camps[i]!.type] : []));
      expect(types.length, `${label} ${zone}`).toBe(CAMPS_PER_ZONE);
      expect(new Set(types.slice(0, 3)).size, `${label} ${zone}: no repeat in the first three`).toBe(3);
      expect(new Set(types), `${label} ${zone}: all three types stand somewhere`).toEqual(new Set(normalIds(zone)));
      const counts = [...new Set(types)].map((t) => types.filter((u) => u === t).length).sort();
      expect(counts, `${label} ${zone}: one type repeats`).toEqual([1, 1, 2]);
      for (const t of types) expect(mobTypeById(t)?.zone, `${label} ${zone}`).toBe(zone);
    }
  }

  it.each([1, 2, 3, 100, 732])("seed %i follows D5: four camps a zone, the first three distinct, one type repeated, every type its zone's own", (seed) => {
    expectD5(lobby({ seed }), `seed ${seed}`);
  });

  it("holds D5 over many worlds, and the salt alone decides which types a map's zones have", () => {
    const seen = new Set<string>();
    for (let salt = 0; salt < 40; salt++) {
      const w = lobby({ seed: 21, salt });
      seen.add(roster(w).join());
      expectD5(w, `salt ${salt}`);
    }
    expect(seen.size).toBeGreaterThan(10); // the same map rolls many different rosters
  });

  it("is the same for the same reward salt and different for another", () => {
    const a = roster(lobby({ seed: 5, salt: 111 }));
    expect(roster(lobby({ seed: 5, salt: 111 }))).toEqual(a);
    // The loot stream and the player count do not matter: only the reward stream does.
    expect(roster(lobby({ seed: 5, salt: 111, random: mulberry32(777), players: 4 }))).toEqual(a);
    expect(roster(lobby({ seed: 5, salt: 112 }))).not.toEqual(a);
    expect(roster(lobby({ seed: 5, salt: 113 }))).not.toEqual(a);
  });
});

describe("rosters take nothing from world.random", () => {
  /** A stream that counts its draws. */
  const counted = (seed: number) => {
    const inner = mulberry32(seed);
    const o = { draws: 0, rng: () => { o.draws++; return inner(); } };
    return o;
  };

  it("a world with camps and a world without draw the same numbers from random, and place the same loot", () => {
    const withMobs = counted(42);
    const without = counted(42);
    const a = lobby({ seed: 8, random: withMobs.rng, cfg: { mobs: true } });
    const b = lobby({ seed: 8, random: without.rng, cfg: { mobs: false } });
    expect(a.state.camps.length).toBeGreaterThan(0);
    expect(b.state.camps.length).toBe(0);
    expect(withMobs.draws).toBe(without.draws);
    expect(a.random()).toBe(b.random());

    const x = run({ seed: 8, random: counted(42).rng, cfg: { mobs: true } });
    const y = run({ seed: 8, random: counted(42).rng, cfg: { mobs: false } });
    expect(x.state.mobs.size).toBeGreaterThan(0);
    expect(y.state.mobs.size).toBe(0);
    const loot = (w: World): unknown[] => [...w.state.containers.entries()].map(([id, c]) => [id, c.toJSON()]);
    expect(loot(x).length).toBeGreaterThan(0);
    expect(loot(x)).toEqual(loot(y));
    for (let i = 0; i < 5; i++) expect(x.random()).toBe(y.random());
  });

  it("rolling again draws from rewardRandom only: the loot stream stays where a world that never rolled again has it", () => {
    const w = lobby({ seed: 8 });
    const before = [w.random(), w.random()];
    const first = roster(w);
    rollRosters(w);
    expect(w.state.camps.length).toBe(w.map.camps.length);
    expect(roster(w).length).toBe(first.length);
    // The loot stream is where it would have been without the second roll.
    const control = lobby({ seed: 8 });
    expect([control.random(), control.random()]).toEqual(before);
    expect(w.random()).toBe(control.random());
  });
});

describe("what the camps place", () => {
  it.each([1, 2, 3, 100, 732])("seed %i: every mob has its camp, its type's name, and the roster's type at its spot", (seed) => {
    const w = run({ seed });
    const mobs = mobsOf(w);
    const expected = w.map.camps.flatMap((camp, ci) =>
      campMobs(camp, w.state.camps[ci]!.type as MobTypeId).map((m, spot) => ({ camp, ci, spot, ...m })));
    expect(mobs.length).toBe(expected.length);
    expected.forEach((e, i) => {
      const { s } = mobs[i]!;
      expect(s.camp, `mob ${i}`).toBe(e.ci + 1);
      expect(s.type).toBe(e.type);
      expect(s.name).toBe(mobTypeById(e.type)!.name);
      expect(s.kind).toBe(e.elite ? "elite" : "mob");
      expect(s.faction).toBe(e.camp.zone);
      expect({ x: s.x, y: s.y }).toEqual(e.camp.spots[e.spot]);
      expect(mobTypeById(s.type)!.zone).toBe(s.faction);
      expect(mobTypeById(s.type)!.elite).toBe(e.elite);
    });
    w.map.camps.forEach((camp, ci) => {
      const here = mobs.filter((m) => m.s.camp === ci + 1);
      expect(here.length).toBe(camp.spots.length);
      expect(w.state.camps[ci]!.alive).toBe(here.length);
      const normals = here.filter((m) => m.s.kind === "mob");
      expect(new Set(normals.map((m) => m.s.type)).size, camp.id).toBeLessThanOrEqual(1); // mono-type
      if (normals.length > 0) expect(normals[0]!.s.type).toBe(w.state.camps[ci]!.type);
      expect(here.filter((m) => m.s.kind === "elite").length, camp.id).toBe(camp.eliteSpot >= 0 ? 1 : 0);
    });
    for (const zone of FACTION_IDS) {
      const elites = mobs.filter((m) => m.s.kind === "elite" && m.s.faction === zone);
      expect(elites).toHaveLength(1);
      expect(elites[0]!.s.type).toBe(eliteTypeOf(zone).id);
    }
  });

  it("keeps the old ids, order, hp, faction and weapon: only type, camp and name are new", () => {
    const w = run({ seed: 2 });
    const expected = w.map.regions.flatMap((r) => r.mobCamps.flatMap((camp) =>
      camp.spots.map((spot, i) => ({ camp, spot, elite: camp.elite && i === 0 }))));
    const mobs = mobsOf(w);
    expect(mobs.length).toBe(expected.length);
    expected.forEach((e, i) => {
      expect(mobs[i]!.s.kind).toBe(e.elite ? "elite" : "mob");
      expect(mobs[i]!.s.faction).toBe(e.camp.region);
      expect(mobs[i]!.s.weapon0).toBe(e.camp.weapon);
      expect({ x: mobs[i]!.s.x, y: mobs[i]!.s.y }).toEqual(e.spot);
    });
    expect([...w.state.mobs.keys()]).toEqual([...w.mobs.keys()]);
    expect(mobs.every((m) => m.rt.brain?.region === m.s.faction)).toBe(true);
  });

  it("a mob placed without a type or camp keeps the two-name table, no camp, and the zone's default type", () => {
    const w = lobby({ seed: 4 });
    const plain = combatant(w, placeMob(w, { region: "frost", elite: false, at: { x: 100, y: 100 } })) as MobCombatant;
    expect(plain.s.camp).toBe(0);
    expect(plain.s.type).toBe("");
    expect(plain.s.name).toBe("Rimeguard");
    expect(mobTypeOf(plain.s.type, "frost", false)).toBe(normalTypesOf("frost")[0]!.id);
    expect(mobTypeOf("", "frost", true)).toBe(eliteTypeOf("frost").id);
    const typed = combatant(w, placeMob(w, { region: "frost", elite: false, at: { x: 100, y: 100 }, type: "iceGolem", camp: 4 })) as MobCombatant;
    expect(typed.s.type).toBe("iceGolem");
    expect(typed.s.name).toBe("Ice Golem");
    expect(typed.s.camp).toBe(5);
  });
});

describe("alive counts down", () => {
  const entryBy = (victim: string, by: string, raw: number): LedgerEntry => ({
    victim, by: { id: by, name: by }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword", scale: 1, stagger: false,
  });

  it("each kill takes one off its camp and nothing off the others, down to 0 and no lower", () => {
    const w = run({ seed: 3 });
    const mobs = mobsOf(w);
    const camp0 = mobs.filter((m) => m.s.camp === 1);
    const camp1 = mobs.filter((m) => m.s.camp === 2);
    const total0 = camp0.length;
    expect(w.state.camps[0]!.alive).toBe(total0);
    const before1 = w.state.camps[1]!.alive;
    camp0.forEach((m, i) => {
      killMob(w, m, [], []);
      expect(m.s.status).toBe("dead");
      expect(w.state.camps[0]!.alive).toBe(total0 - i - 1);
    });
    expect(w.state.camps[0]!.alive).toBe(0);
    expect(w.state.camps[1]!.alive).toBe(before1);
    expect(camp1.length).toBe(before1);
    campMobDied(w, 1); // a stray extra call cannot wrap the counter
    expect(w.state.camps[0]!.alive).toBe(0);
  });

  it("a mob dies once: a second kill of the corpse changes nothing", () => {
    const w = run({ seed: 3 });
    const m = mobsOf(w).find((x) => x.s.camp === 3)!;
    const alive = w.state.camps[2]!.alive;
    killMob(w, m, [], []);
    killMob(w, m, [], []);
    expect(w.state.camps[2]!.alive).toBe(alive - 1);
  });

  it("a kill through the ledger's way down (hurtMob, a player's hits) counts too, and the corpse leaving does not", () => {
    const w = run({ seed: 3 });
    const m = mobsOf(w).find((x) => x.s.camp === 2)!;
    const alive = w.state.camps[1]!.alive;
    hurtMob(w, m, [m.s.maxHp + 5], [entryBy(m.id, "p0", m.s.maxHp + 5)]);
    expect(m.s.status).toBe("dead");
    expect(w.state.camps[1]!.alive).toBe(alive - 1);
    for (let i = 0; i < 400; i++) step(w, TICK_MS); // past MOB_CORPSE_MS: the body is removed
    expect(w.state.mobs.has(m.id)).toBe(false);
    expect(w.state.camps[1]!.alive).toBe(alive - 1);
  });

  it("ignores a mob with no camp and a camp that is not published", () => {
    const w = run({ seed: 3 });
    const loose = combatant(w, placeMob(w, { region: "fire", elite: false, at: { x: 100, y: 100 } })) as MobCombatant;
    const snapshot = [...w.state.camps].map((c) => c.alive);
    killMob(w, loose, [], []);
    campMobDied(w, 0);
    campMobDied(w, 999);
    expect([...w.state.camps].map((c) => c.alive)).toEqual(snapshot);
  });
});

describe("worlds with no camps", () => {
  it("a training world has no roster and no regional mobs, even with mobs on in its config", () => {
    const w = lobby({ seed: 6, players: 1, cfg: { mobs: true, dummies: true, training: true, planSeconds: 0, minPlayers: 1 } });
    expect(w.state.camps.length).toBe(0);
    step(w, TICK_MS);
    expect(w.state.phase).toBe("active");
    spawnRegionalMobs(w);
    expect(w.state.camps.length).toBe(0);
    expect([...w.state.mobs.values()].every((m) => m.kind === "dummy" && m.camp === 0 && m.type === "")).toBe(true);
  });

  it("a world with mobs off has no roster and draws nothing from the reward stream for one", () => {
    const w = lobby({ seed: 6, cfg: { mobs: false } });
    expect(w.state.camps.length).toBe(0);
    const control = lobby({ seed: 6, cfg: { mobs: false } });
    expect(w.rewardRandom()).toBe(control.rewardRandom());
  });

  it("a hand-built map publishes no camps and draws nothing", () => {
    const map = mapFromTiles(8, 8, new Uint8Array(64));
    const a = createWorld({ seed: 1, config: BASE, random: mulberry32(1), rewardSalt: 4, map });
    const b = createWorld({ seed: 1, config: BASE, random: mulberry32(1), rewardSalt: 4, map });
    rollRosters(a);
    ensureRosters(a);
    expect(a.state.camps.length).toBe(0);
    expect(a.rewardRandom()).toBe(b.rewardRandom());
  });
});

describe("ensureRosters, for worlds assembled without gameplay.ts", () => {
  it("rolls once, when the mobs spawn, and is the same roster a game world rolls from the same salt", () => {
    const bare = createWorld({ seed: 11, config: BASE, random: mulberry32(12), rewardSalt: 77 });
    installMobLife(bare);
    expect(bare.state.camps.length).toBe(0);
    bare.hooks.raidStarted!(bare);
    expect(bare.state.camps.length).toBe(bare.map.camps.length);
    expect(bare.state.mobs.size).toBeGreaterThan(0);
    const game = lobby({ seed: 11, salt: 77 });
    expect(roster(bare)).toEqual(roster(game));
  });

  it("never draws twice: calling it again leaves the roster and the stream where they were", () => {
    const a = createWorld({ seed: 11, config: BASE, random: mulberry32(12), rewardSalt: 77 });
    const b = createWorld({ seed: 11, config: BASE, random: mulberry32(12), rewardSalt: 77 });
    ensureRosters(a);
    ensureRosters(a);
    ensureRosters(a);
    ensureRosters(b);
    expect(roster(a)).toEqual(roster(b));
    expect(a.rewardRandom()).toBe(b.rewardRandom());
  });

  it("rolls again when a test swaps in a map with a different number of camps", () => {
    const w = lobby({ seed: 11 });
    const n = w.map.camps.length;
    w.map = { ...w.map, camps: w.map.camps.slice(0, 3) };
    ensureRosters(w);
    expect(w.state.camps.length).toBe(3);
    expect(n).toBeGreaterThan(3);
  });

  it("an unpublished or unknown camp type spawns the zone's default normal type rather than nothing", () => {
    const w = lobby({ seed: 11 });
    w.state.camps[0]!.type = "";
    step(w, TICK_MS);
    const first = mobsOf(w).find((m) => m.s.camp === 1 && m.s.kind === "mob")!;
    expect(first.s.type).toBe(normalTypesOf(w.map.camps[0]!.zone)[0]!.id);
  });
});

describe("on the wire", () => {
  it("a client decodes the roster from the full state, the mobs' type and camp, and each `alive` change as a patch", () => {
    const w = run({ seed: 3 });
    const encoder = new Encoder(w.state);
    const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
    decoder.decode(encoder.encodeAll());
    encoder.discardChanges();
    const client = decoder.state;
    const view = (s: RaidState) => ({
      camps: [...s.camps].map((c) => ({ type: c.type, reward: c.reward, alive: c.alive, state: c.state })),
      mobs: [...s.mobs].map(([id, m]) => [id, m.type, m.camp, m.name]),
    });
    expect(client.camps.length).toBe(w.map.camps.length);
    expect(view(client)).toEqual(view(w.state));

    const m = mobsOf(w).find((x) => x.s.camp === 4)!;
    killMob(w, m, [], []);
    decoder.decode(encoder.encode());
    encoder.discardChanges();
    expect(view(client)).toEqual(view(w.state));
    expect(client.camps[3]!.alive).toBe(w.map.camps[3]!.spots.length - 1);
  });
});
