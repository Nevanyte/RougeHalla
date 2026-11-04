import { describe, expect, it } from "vitest";
import { FACTION_IDS, MOB_STAT_REWARDS, type MobTypeId } from "@raid/shared";
import {
  BUILD_GOALS, BuildRoute, CONTEST_MS, ELITE_AFTER_MS, ELITE_MIN_KILLS, MAX_WAIT_MS, STAT_FLOOR, ZONE_AVOID_MS,
  buildOf, readyForElites, typeWeight, type RouteCamp, type RouteInput,
} from "../../src/bots/brain/buildRoute";

const NOW = 100_000;
const camp = (index: number, x: number, type: MobTypeId, over: Partial<RouteCamp> = {}): RouteCamp => ({
  index, id: `c${index}`, zone: "fire", x, y: 0, r: 96, elite: false, spots: 4, type, alive: 4, state: 0, respawnAt: 0, ...over,
});
const input = (camps: RouteCamp[], over: Partial<RouteInput> = {}): RouteInput => ({
  now: NOW, runMs: 60_000, self: { x: 0, y: 0 }, speed: 160, mobKills: 0, power: 0, camps, players: [], canFarm: () => true, ...over,
});
// Fire A (AD burst) wants damage (Ember Imp) most, then Offense (Pardoner) and defenses; Fire B (AP burn tank) wants Defense and damage
// most and Soul Offence (Flame Caller) too, and no Offense (BUILD_GOALS: weights from what a kill adds in a fight).
const fireA = BUILD_GOALS.fire[0];
const fireB = BUILD_GOALS.fire[1];

describe("the build a bot farms for", () => {
  it("every faction has two builds, and every normal mob type is worth at least the floor to each", () => {
    for (const f of FACTION_IDS) {
      expect(BUILD_GOALS[f]).toHaveLength(2);
      for (const b of BUILD_GOALS[f]) for (const r of MOB_STAT_REWARDS) expect(typeWeight(b, r.id)).toBeGreaterThanOrEqual(STAT_FLOOR);
    }
    expect(buildOf("fire", 0.2)).toBe(fireA);
    expect(buildOf("fire", 0.8)).toBe(fireB);
  });

  it("weighs a type by the stat it gives", () => {
    expect(typeWeight(fireA, "emberImp")).toBe(1); // +damage
    expect(typeWeight(fireA, "pardoner")).toBe(fireA.weights.ad); // Offense, the build's signature stat
    expect(typeWeight(fireA, "flameCaller")).toBe(STAT_FLOOR); // SO: not this build's
    expect(typeWeight(fireB, "flameCaller")).toBe(fireB.weights.ap);
    expect(typeWeight(fireB, "bailiff")).toBe(1); // Defense
    expect(typeWeight(fireB, "pardoner")).toBe(STAT_FLOOR);
    expect(typeWeight(fireB, undefined)).toBe(STAT_FLOOR);
  });
});

describe("the route", () => {
  it("goes for the camps its build wants first, even a little farther, and sequences the rest", () => {
    const camps = [camp(0, 500, "flameCaller"), camp(1, 800, "emberImp"), camp(2, 1100, "pardoner")];
    const a = new BuildRoute(fireA);
    expect(a.update(input(camps))?.camp).toBe(1); // damage, past the nearer Soul Offence camp
    expect(a.route.map((s) => s.camp)).toEqual([1, 2, 0]);
    const near = [camp(0, 500, "pardoner"), camp(1, 800, "bailiff")];
    expect(new BuildRoute(fireA).update(input(near))?.camp).toBe(0); // Offense is Fire A's
    expect(new BuildRoute(fireB).update(input(near))?.camp).toBe(1); // Defense is Fire B's: it walks past the Offense camp
  });

  it("plans a cleared camp for its respawn when it is close, and leaves it out when it is far off", () => {
    const soon = camp(0, 300, "pardoner", { state: 2, alive: 0, respawnAt: NOW + 10_000 });
    const late = camp(1, 300, "pardoner", { state: 2, alive: 0, respawnAt: NOW + MAX_WAIT_MS + 60_000 });
    const r = new BuildRoute(fireA);
    r.plan(input([soon, late]));
    expect(r.route.map((s) => s.camp)).toEqual([0]);
    expect(r.route[0]!.startAt).toBe(NOW + 10_000);
  });

  it("holds elites back until later in the run, then wants them", () => {
    const elite = camp(0, 400, "pardoner", { elite: true });
    const r = new BuildRoute(fireA);
    r.plan(input([elite]));
    expect(r.route).toEqual([]);
    expect(readyForElites({ runMs: ELITE_AFTER_MS, mobKills: ELITE_MIN_KILLS, power: 0 })).toBe(true);
    r.plan(input([elite, camp(1, 400, "flameCaller")], { runMs: ELITE_AFTER_MS, mobKills: ELITE_MIN_KILLS }));
    expect(r.route[0]!.camp).toBe(0);
  });

  it("is the same whatever order the camps come in", () => {
    const camps = [camp(0, 500, "pardoner"), camp(1, -500, "pardoner"), camp(2, 900, "emberImp")];
    const a = new BuildRoute(fireA), b = new BuildRoute(fireA);
    a.plan(input(camps));
    b.plan(input([...camps].reverse()));
    expect(b.route).toEqual(a.route);
  });

  it("leaves out a camp it cannot farm", () => {
    const r = new BuildRoute(fireA);
    r.plan(input([camp(0, 300, "pardoner"), camp(1, 600, "emberImp")], { canFarm: (c) => c.index !== 0 }));
    expect(r.route.map((s) => s.camp)).toEqual([1]);
  });
});

describe("adapting when the route is contested", () => {
  it("drops a camp somebody else is fighting, or one with an enemy player at it, and plans again at once", () => {
    const camps = [camp(0, 600, "pardoner"), camp(1, 1500, "emberImp")];
    const r = new BuildRoute(fireA);
    expect(r.update(input(camps))?.camp).toBe(0);
    const fighting = [camp(0, 600, "pardoner", { state: 1, alive: 3 }), camps[1]!]; // a mob died there while the bot was away
    expect(r.update(input(fighting, { now: NOW + 500 }))?.camp).toBe(1);
    expect(r.isContested(0, NOW + 500)).toBe(true);
    expect(r.isContested(0, NOW + 500 + CONTEST_MS)).toBe(false);
    const r2 = new BuildRoute(fireA);
    r2.plan(input(camps));
    expect(r2.update(input(camps, { players: [{ x: 620, y: 40 }] }))?.camp).toBe(1);
  });

  it("treats a camp cleared by someone else while it walked there as contested", () => {
    const r = new BuildRoute(fireA);
    expect(r.update(input([camp(0, 800, "emberImp"), camp(1, 1200, "pardoner")]))?.camp).toBe(0);
    const stolen = camp(0, 800, "emberImp", { state: 2, alive: 0, respawnAt: NOW + 5000 });
    expect(r.update(input([stolen, camp(1, 1200, "pardoner")], { now: NOW + 1000 }))?.camp).toBe(1);
    expect(r.stats.contests).toBe(1);
  });

  it("watches only the camps on its route, and a long-engaged camp (the sticky state) is no contest", () => {
    const r = new BuildRoute(fireA);
    const camps = [camp(0, 600, "pardoner", { state: 1 }), camp(1, 5000, "flameCaller")];
    const onlyFirst = { canFarm: (c: RouteCamp) => c.index === 0 }; // camp 1 is not on the route
    expect(r.update(input(camps, onlyFirst))?.camp).toBe(0);
    expect(r.update(input(camps, { ...onlyFirst, now: NOW + 500, players: [{ x: 5000, y: 0 }] }))?.camp).toBe(0);
    expect(r.stats.contests).toBe(0);
  });

  it("avoids a zone contested twice in a row for a while", () => {
    const r = new BuildRoute(fireA);
    const camps = [camp(0, 600, "pardoner"), camp(1, 900, "pardoner"), camp(2, 2000, "bailiff", { zone: "sentenced" })];
    r.plan(input(camps));
    r.update(input(camps, { players: [{ x: 600, y: 0 }, { x: 900, y: 0 }] }));
    expect(r.route.map((s) => s.camp)).toEqual([2]);
    // The players left, but the fire zone stays out until ZONE_AVOID_MS has passed.
    r.plan(input(camps, { now: NOW + CONTEST_MS + 1 }));
    expect(r.route.map((s) => s.camp)).toEqual([2]);
    r.plan(input(camps, { now: NOW + ZONE_AVOID_MS + CONTEST_MS }));
    expect(r.route[0]!.camp).toBe(0);
  });
});
