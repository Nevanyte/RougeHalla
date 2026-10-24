// The feed on the server (sim/feed.ts and the creditMobKill / updateBounty hunks in arena.ts): a player's feed, the lobby
// median, what mobs pay, and the rampage announcement with its throttle. The curve itself (rewardCurve, catchUpMultiplier,
// median) is tested in packages/shared/test/buffs.test.ts; this is the part that reads the sim state.
import { describe, expect, it } from "vitest";
import {
  BOUNTY_ANNOUNCE_MS, CATCHUP_MULT, FEED_MOB_KILL_WEIGHT, GV_ELITE, GV_KILL, GV_MOB, GV_MOB_CAP, mulberry32, rewardCurve, TICK_MS,
  type FxEvent,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { applyDamage, creditMobKill, downPlayer, markDropped, type Attacker } from "../src/sim/arena";
import {
  announceBounty, feedOfPlayer, flushAnnouncements, install as installFeed, lobbyMedianFeed, mobRewardFor,
} from "../src/sim/feed";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, removePlayer, step } from "../src/sim/step";
import { createWorld, type SimConfig, type SimEvent, type World } from "../src/sim/world";

type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;

const NAMES = ["alice", "bob", "carol", "dave", "erin", "frank", "gina", "hank"];
const idOf = (i: number): string => `p${i}`;

function makeConfig(n: number): SimConfig {
  return {
    minPlayers: n, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 1,
  };
}

/** `n` players in a run that started on the first step (serverTime TICK_MS), in a world with every gameplay module. */
function startRun(n: number, seed = 1234): World {
  const world = createGameWorld({ seed, config: makeConfig(n), random: mulberry32(seed + 1) });
  for (let i = 0; i < n; i++) addPlayer(world, idOf(i), NAMES[i]!);
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

const P = (world: World, i: number): PlayerState => world.state.players.get(idOf(i))!;
const RT = (world: World, i: number) => world.players.get(idOf(i))!;
const attacker = (world: World, i: number): Attacker => ({ id: idOf(i), p: P(world, i), rt: RT(world, i) });
const tick = (world: World): SimEvent[] => step(world, TICK_MS);

function runTo(world: World, serverTime: number): SimEvent[] {
  const all: SimEvent[] = [];
  while (world.state.serverTime < serverTime) all.push(...tick(world));
  expect(world.state.serverTime).toBe(serverTime);
  return all;
}

function fxOf<K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Fx<K>> {
  return events
    .filter((e): e is Extract<SimEvent, { type: "fx" }> => e.type === "fx")
    .map((e) => e.fx)
    .filter((fx): fx is Fx<K> => fx.kind === kind);
}

function gvOf(events: SimEvent[]): Array<Extract<SimEvent, { type: "gv" }>> {
  return events.filter((e): e is Extract<SimEvent, { type: "gv" }> => e.type === "gv");
}

function kill(world: World, victim: number, source: Attacker | string = "test"): number {
  const p = P(world, victim);
  return applyDamage(world, p, RT(world, victim), p.hp + p.shield + 1000, source);
}

/** Sets a player's feed: `kills` player kills and `mobKills` mob kills (the synced copy too). */
function setFeed(world: World, i: number, kills: number, mobKills = 0): void {
  P(world, i).kills = kills;
  P(world, i).mobKills = mobKills;
  RT(world, i).mobKills = mobKills;
}

/** A run of `feeds.length` players with these `[kills, mobKills]`. */
function lobby(feeds: ReadonlyArray<readonly [number, number?]>): World {
  const w = startRun(feeds.length);
  feeds.forEach(([kills, mobKills], i) => setFeed(w, i, kills, mobKills ?? 0));
  return w;
}

describe("feedOfPlayer", () => {
  it("is player kills plus a quarter per mob kill", () => {
    const w = startRun(2);
    expect(feedOfPlayer(P(w, 0), RT(w, 0))).toBe(0);
    setFeed(w, 0, 2, 4);
    expect(feedOfPlayer(P(w, 0), RT(w, 0))).toBe(2 + 4 * FEED_MOB_KILL_WEIGHT);
    expect(feedOfPlayer(P(w, 0), RT(w, 0))).toBe(3);
    setFeed(w, 1, 0, 10);
    expect(feedOfPlayer(P(w, 1), RT(w, 1))).toBe(2.5);
  });

  it("reads the mob kills off the runtime (the synced copy is only for the HUD)", () => {
    const w = startRun(2);
    P(w, 0).kills = 1;
    RT(w, 0).mobKills = 8;
    P(w, 0).mobKills = 0;
    expect(feedOfPlayer(P(w, 0), RT(w, 0))).toBe(3);
  });
});

describe("lobbyMedianFeed", () => {
  it("is the median over everyone standing, the player included: middle value for an odd count", () => {
    const w = lobby([[0], [1], [2, 4], [0, 10], [5]]); // 0, 1, 3, 2.5, 5
    expect(lobbyMedianFeed(w)).toBe(2.5);
  });

  it("is the mean of the two middle values for an even count", () => {
    const w = lobby([[0], [1], [2, 4], [0, 10]]); // 0, 1, 3, 2.5 -> 0, 1, 2.5, 3
    expect(lobbyMedianFeed(w)).toBe(1.75);
  });

  it("is 0 for a lobby with nobody in it", () => {
    const w = createWorld({ seed: 1, config: makeConfig(2), random: mulberry32(1) });
    expect(lobbyMedianFeed(w)).toBe(0);
  });

  it("leaves out a player who is dead and resolved", () => {
    const w = lobby([[0], [1], [2, 4], [0, 10], [5]]);
    expect(lobbyMedianFeed(w)).toBe(2.5);
    kill(w, 4); // between ticks: dead and resolved at once
    expect(RT(w, 4).resolved).toBe(true);
    expect(lobbyMedianFeed(w)).toBe(1.75); // 0, 1, 2.5, 3
  });

  it("leaves out a player downed this tick whose result is not out yet", () => {
    const w = lobby([[0], [1], [2, 4], [0, 10], [5]]);
    let during = NaN;
    let resolvedDuring = true;
    w.systems.push((world) => {
      if (world.state.serverTime !== 100) return;
      kill(world, 4);
      resolvedDuring = RT(world, 4).resolved;
      during = lobbyMedianFeed(world);
    });
    runTo(w, 100);
    expect(resolvedDuring).toBe(false);
    expect(RT(w, 4).down).not.toBeNull();
    expect(during).toBe(1.75);
  });

  it("leaves out a player who left, and every player when all are down", () => {
    const w = lobby([[0], [1], [2, 4], [0, 10], [5]]);
    removePlayer(w, idOf(4));
    expect(lobbyMedianFeed(w)).toBe(1.75);
    let allDown = NaN;
    w.systems.push((world) => {
      if (world.state.serverTime !== 100) return;
      for (let i = 0; i < 4; i++) kill(world, i);
      allDown = lobbyMedianFeed(world);
    });
    runTo(w, 100);
    expect(allDown).toBe(0);
  });

  it("still counts a player whose connection dropped: they are in the fight until the grace runs out", () => {
    const w = lobby([[0], [1], [2, 4], [0, 10], [5]]);
    markDropped(w, idOf(4));
    expect(RT(w, 4).droppedAt).not.toBeNull();
    expect(lobbyMedianFeed(w)).toBe(2.5);
  });

  it("moves with the feeds", () => {
    const w = lobby([[0], [0], [0]]);
    expect(lobbyMedianFeed(w)).toBe(0);
    P(w, 0).kills = 6;
    expect(lobbyMedianFeed(w)).toBe(0); // a lone leader does not move the middle
    P(w, 1).kills = 3;
    expect(lobbyMedianFeed(w)).toBe(3);
  });
});

describe("mobRewardFor", () => {
  it("is the reward curve at the player's feed when nobody is far enough ahead for the catch-up", () => {
    const table: Array<[number, number]> = [[0, 0.98], [2, 0.92], [3, 0.85], [4, 0.76], [5, 0.65], [6, 0.54], [7, 0.45], [8, 0.38], [10, 0.32]];
    for (const [feed, shown] of table) {
      const w = lobby([[feed], [feed], [feed]]);
      const m = mobRewardFor(w, P(w, 0), RT(w, 0));
      expect(m, `feed ${feed}`).toBe(rewardCurve(feed));
      expect(Math.round(m * 100) / 100, `feed ${feed}`).toBe(shown); // the table in GAME_DESIGN 12.3
    }
  });

  it("counts mob kills in the feed the curve is read at", () => {
    const w = lobby([[1, 12], [1, 12], [1, 12]]); // feed 4
    expect(mobRewardFor(w, P(w, 0), RT(w, 0))).toBe(rewardCurve(4));
  });

  it("is never below the floor, however fed", () => {
    const w = lobby([[100], [100], [100]]);
    expect(mobRewardFor(w, P(w, 0), RT(w, 0))).toBeCloseTo(0.3, 9);
  });

  it("gets the catch-up only when MORE than 2 below the lobby median", () => {
    // Median of [x, 4, 4, 4, 4] is 4.
    const exactly2 = lobby([[2], [4], [4], [4], [4]]);
    expect(lobbyMedianFeed(exactly2)).toBe(4);
    expect(mobRewardFor(exactly2, P(exactly2, 0), RT(exactly2, 0))).toBe(rewardCurve(2)); // 2 below: no bonus

    const exactly2WithMobs = lobby([[1, 4], [4], [4], [4], [4]]); // 1 + 4 x 0.25 = 2
    expect(mobRewardFor(exactly2WithMobs, P(exactly2WithMobs, 0), RT(exactly2WithMobs, 0))).toBe(rewardCurve(2));

    const justOver = lobby([[1, 3], [4], [4], [4], [4]]); // 1.75
    expect(mobRewardFor(justOver, P(justOver, 0), RT(justOver, 0))).toBe(rewardCurve(1.75) * CATCHUP_MULT);

    // The ones at the median are not helped.
    expect(mobRewardFor(justOver, P(justOver, 1), RT(justOver, 1))).toBe(rewardCurve(4));
  });

  it("the catch-up multiplies the whole curve value", () => {
    const w = lobby([[0], [5], [5], [5], [5]]);
    expect(mobRewardFor(w, P(w, 0), RT(w, 0))).toBeCloseTo(rewardCurve(0) * 1.25, 12);
    expect(mobRewardFor(w, P(w, 0), RT(w, 0))).toBeGreaterThan(1.2);
  });

  it("measures against the players still standing: when the leaders go down the catch-up goes with them", () => {
    const w = lobby([[1, 3], [4], [4], [4], [4]]); // 1.75
    expect(mobRewardFor(w, P(w, 0), RT(w, 0))).toBe(rewardCurve(1.75) * CATCHUP_MULT);
    kill(w, 1);
    kill(w, 2);
    // Still [1.75, 4, 4]: median 4.
    expect(mobRewardFor(w, P(w, 0), RT(w, 0))).toBe(rewardCurve(1.75) * CATCHUP_MULT);
    kill(w, 3);
    // [1.75, 4]: median 2.875, only 1.125 behind.
    expect(lobbyMedianFeed(w)).toBeCloseTo(2.875, 12);
    expect(mobRewardFor(w, P(w, 0), RT(w, 0))).toBe(rewardCurve(1.75));
  });
});

describe("creditMobKill", () => {
  it("pays round(GV_MOB x reward) for a mob and round(GV_ELITE x reward) for an elite", () => {
    const w = lobby([[0], [0], [0]]);
    const m = rewardCurve(0);
    expect(creditMobKill(w, P(w, 0), RT(w, 0), false)).toBe(Math.round(GV_MOB * m));
    expect(creditMobKill(w, P(w, 1), RT(w, 1), true)).toBe(Math.round(GV_ELITE * m));
    // At feed 0 the multiplier is 0.976: it rounds back to the base values.
    expect(RT(w, 0).gv.mobs).toBe(GV_MOB);
    expect(RT(w, 1).gv.mobs).toBe(GV_ELITE);
    expect(gvOf(w.events)).toEqual([
      { type: "gv", id: idOf(0), amount: GV_MOB, reason: "mob" },
      { type: "gv", id: idOf(1), amount: GV_ELITE, reason: "elite" },
    ]);
    expect(P(w, 0).gv).toBe(GV_MOB);
  });

  it("a high-feed player (feed 8) is paid less than a hungry one", () => {
    const w = lobby([[0], [8], [0], [0]]); // median 0: neither gets a catch-up
    const hungryMob = creditMobKill(w, P(w, 0), RT(w, 0), false);
    const hungryElite = creditMobKill(w, P(w, 0), RT(w, 0), true);
    const fedMob = creditMobKill(w, P(w, 1), RT(w, 1), false);
    const fedElite = creditMobKill(w, P(w, 1), RT(w, 1), true);
    expect([hungryMob, hungryElite]).toEqual([2, 10]);
    // The elite is the fed player's second kill, so it is read at feed 8.25.
    expect([fedMob, fedElite]).toEqual([Math.round(GV_MOB * rewardCurve(8)), Math.round(GV_ELITE * rewardCurve(8.25))]);
    expect([fedMob, fedElite]).toEqual([1, 4]); // x0.38
    expect(fedElite).toBeLessThan(hungryElite);
    expect(fedMob).toBeLessThan(hungryMob);
    expect(RT(w, 1).gv.mobs).toBe(5);
  });

  it("never pays 0 for a kill under the cap: the floor of x0.3 rounds a mob to 1 and an elite to 3", () => {
    const w = lobby([[100], [100], [100]]);
    expect(creditMobKill(w, P(w, 0), RT(w, 0), false)).toBe(1);
    expect(creditMobKill(w, P(w, 0), RT(w, 0), true)).toBe(3);
  });

  it("reads the multiplier BEFORE the kill counts toward the feed", () => {
    // Feed 1.75 is more than 2 behind a median of 4, so the catch-up applies; this kill makes it exactly 2.0, where it would not.
    const w = lobby([[1, 3], [4], [4], [4], [4]]);
    const before = mobRewardFor(w, P(w, 0), RT(w, 0));
    expect(before).toBe(rewardCurve(1.75) * CATCHUP_MULT);
    const paid = creditMobKill(w, P(w, 0), RT(w, 0), true);
    expect(paid).toBe(Math.round(GV_ELITE * before)); // 12
    expect(paid).toBe(12);
    expect(paid).toBeGreaterThan(Math.round(GV_ELITE * rewardCurve(2))); // what reading it after the kill would have paid (9)
    expect(feedOfPlayer(P(w, 0), RT(w, 0))).toBe(2);
  });

  it("counts the kill and syncs p.mobKills with the runtime", () => {
    const w = lobby([[0], [0]]);
    expect(P(w, 0).mobKills).toBe(0);
    creditMobKill(w, P(w, 0), RT(w, 0), false);
    creditMobKill(w, P(w, 0), RT(w, 0), true);
    expect(RT(w, 0).mobKills).toBe(2);
    expect(P(w, 0).mobKills).toBe(2);
    expect(P(w, 0).kills).toBe(0);
    // The HUD copy follows even if the runtime was set from elsewhere.
    RT(w, 0).mobKills = 9;
    creditMobKill(w, P(w, 0), RT(w, 0), false);
    expect(P(w, 0).mobKills).toBe(10);
  });

  it("GV_MOB_CAP still binds on the multiplied amount", () => {
    const w = lobby([[0], [0]]);
    RT(w, 0).gv.mobs = GV_MOB_CAP - 5;
    w.events = [];
    expect(creditMobKill(w, P(w, 0), RT(w, 0), true)).toBe(5); // 10 would not fit
    expect(RT(w, 0).gv.mobs).toBe(GV_MOB_CAP);
    expect(P(w, 0).gv).toBe(GV_MOB_CAP);
    expect(gvOf(w.events)).toEqual([{ type: "gv", id: idOf(0), amount: 5, reason: "elite" }]);
    w.events = [];
    expect(creditMobKill(w, P(w, 0), RT(w, 0), true)).toBe(0);
    expect(gvOf(w.events)).toEqual([]);
    expect(RT(w, 0).mobKills).toBe(2); // the kill counts toward the feed all the same
  });

  it("the cap applies after the catch-up bonus, not instead of it", () => {
    const w = lobby([[0], [6], [6], [6], [6]]); // p0: feed 0, median 6
    expect(mobRewardFor(w, P(w, 0), RT(w, 0))).toBeGreaterThan(1.2);
    RT(w, 0).gv.mobs = GV_MOB_CAP - 3;
    expect(creditMobKill(w, P(w, 0), RT(w, 0), true)).toBe(3); // 12 clipped to what is left
    RT(w, 0).gv.mobs = GV_MOB_CAP - 20;
    setFeed(w, 0, 0);
    expect(creditMobKill(w, P(w, 0), RT(w, 0), true)).toBe(Math.round(GV_ELITE * rewardCurve(0) * CATCHUP_MULT)); // 12, under the cap
  });

  it("a catch-up player is paid more than the same feed without it, but never beyond GV_ELITE x 1.25 rounded", () => {
    const behind = lobby([[1, 3], [4], [4], [4], [4]]);
    const level = lobby([[1, 3], [1], [1], [1], [1]]);
    const catchUp = creditMobKill(behind, P(behind, 0), RT(behind, 0), true);
    const plain = creditMobKill(level, P(level, 0), RT(level, 0), true);
    expect(catchUp).toBeGreaterThan(plain);
    expect([plain, catchUp]).toEqual([9, 12]);
    const ceiling = Math.round(GV_ELITE * CATCHUP_MULT);
    const mobCeiling = Math.round(GV_MOB * CATCHUP_MULT);
    const w = lobby([[0], [30], [30], [30]]);
    for (const feed of [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 20]) { // all more than 2 below the median of 30
      const kills = Math.floor(feed);
      const mobKills = Math.round((feed - kills) / FEED_MOB_KILL_WEIGHT);
      for (const elite of [false, true]) {
        setFeed(w, 0, kills, mobKills); // undoes the last kill's own count
        RT(w, 0).gv.mobs = 0; // below the cap
        expect(mobRewardFor(w, P(w, 0), RT(w, 0)), `feed ${feed}`).toBeLessThanOrEqual(CATCHUP_MULT);
        const paid = creditMobKill(w, P(w, 0), RT(w, 0), elite);
        expect(paid, `feed ${feed}`).toBeLessThanOrEqual(elite ? ceiling : mobCeiling);
        expect(paid, `feed ${feed}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("pays nothing, counts nothing and emits nothing for a player whose result is out", () => {
    const w = lobby([[0], [0], [0]]);
    downPlayer(w, P(w, 2), RT(w, 2), "died");
    expect(RT(w, 2).resolved).toBe(true);
    w.events = [];
    expect(creditMobKill(w, P(w, 2), RT(w, 2), true)).toBe(0);
    expect(RT(w, 2).mobKills).toBe(0);
    expect(P(w, 2).mobKills).toBe(0);
    expect(w.events).toEqual([]);
  });

  it("raises the bounty from the mob feed, and it is claimed like any other", () => {
    const w = lobby([[2], [0], [0], [0]]);
    for (let i = 0; i < 4; i++) creditMobKill(w, P(w, 0), RT(w, 0), false); // feed 3
    expect(P(w, 0).bounty).toBe(10);
    w.events = [];
    kill(w, 0, attacker(w, 1));
    expect(gvOf(w.events)).toEqual([
      { type: "gv", id: idOf(1), amount: GV_KILL, reason: "kill" },
      { type: "gv", id: idOf(1), amount: 10, reason: "bounty" },
    ]);
  });
});

describe("announceBounty and flushAnnouncements", () => {
  const bountyFx = (w: World) => fxOf(w.events, "bounty");
  /** Moves the clock to `t` the way a tick would, without running one. */
  const at = (w: World, t: number): void => { w.state.serverTime = t; };

  it("a bounty that first appears is announced at once, to everyone, with the player's name and amount", () => {
    const w = startRun(3);
    P(w, 0).bounty = 10;
    w.events = [];
    announceBounty(w, P(w, 0), RT(w, 0));
    expect(w.events).toEqual([{ type: "fx", fx: { kind: "bounty", id: idOf(0), name: "alice", bounty: 10 } }]);
    expect(RT(w, 0).announce).toEqual({ lastAt: w.state.serverTime, sent: 10 });
  });

  it("a second rise inside the window is held, up to the last millisecond", () => {
    const w = startRun(3);
    const t0 = w.state.serverTime;
    P(w, 0).bounty = 10;
    announceBounty(w, P(w, 0), RT(w, 0));
    w.events = [];
    P(w, 0).bounty = 28;
    at(w, t0 + 1);
    announceBounty(w, P(w, 0), RT(w, 0));
    at(w, t0 + BOUNTY_ANNOUNCE_MS - 1);
    announceBounty(w, P(w, 0), RT(w, 0));
    expect(bountyFx(w)).toEqual([]);
    expect(RT(w, 0).announce).toEqual({ lastAt: t0, sent: 10 });
    // Once the window is over a call announces it.
    at(w, t0 + BOUNTY_ANNOUNCE_MS);
    announceBounty(w, P(w, 0), RT(w, 0));
    expect(bountyFx(w)).toEqual([{ kind: "bounty", id: idOf(0), name: "alice", bounty: 28 }]);
    expect(RT(w, 0).announce).toEqual({ lastAt: t0 + BOUNTY_ANNOUNCE_MS, sent: 28 });
  });

  it("the flush system announces the held rise when the window ends, with the value then, and only once", () => {
    const w = startRun(3);
    const t0 = w.state.serverTime;
    P(w, 0).bounty = 10;
    announceBounty(w, P(w, 0), RT(w, 0));
    w.events = [];
    P(w, 0).bounty = 28;
    announceBounty(w, P(w, 0), RT(w, 0)); // held
    at(w, t0 + 5000);
    P(w, 0).bounty = 52; // and again
    announceBounty(w, P(w, 0), RT(w, 0)); // held
    at(w, t0 + BOUNTY_ANNOUNCE_MS - 1);
    flushAnnouncements(w);
    expect(bountyFx(w)).toEqual([]);
    at(w, t0 + BOUNTY_ANNOUNCE_MS);
    flushAnnouncements(w);
    expect(bountyFx(w)).toEqual([{ kind: "bounty", id: idOf(0), name: "alice", bounty: 52 }]); // not 28
    w.events = [];
    for (const dt of [TICK_MS, 1000, 20_000]) {
      at(w, t0 + BOUNTY_ANNOUNCE_MS + dt);
      flushAnnouncements(w);
    }
    expect(bountyFx(w)).toEqual([]); // only once
  });

  it("a rise after a flushed announcement opens a new window from the flush", () => {
    const w = startRun(3);
    const t0 = w.state.serverTime;
    P(w, 0).bounty = 10;
    announceBounty(w, P(w, 0), RT(w, 0));
    P(w, 0).bounty = 28;
    at(w, t0 + BOUNTY_ANNOUNCE_MS);
    flushAnnouncements(w); // 28 goes out here
    w.events = [];
    P(w, 0).bounty = 52;
    at(w, t0 + BOUNTY_ANNOUNCE_MS + 9000);
    announceBounty(w, P(w, 0), RT(w, 0));
    flushAnnouncements(w);
    expect(bountyFx(w)).toEqual([]);
    at(w, t0 + 2 * BOUNTY_ANNOUNCE_MS);
    flushAnnouncements(w);
    expect(bountyFx(w).map((fx) => fx.bounty)).toEqual([52]);
  });

  it("announces nothing when the bounty did not rise, in a call or in the flush, window or no window", () => {
    const w = startRun(3);
    const t0 = w.state.serverTime;
    announceBounty(w, P(w, 0), RT(w, 0)); // a bounty of 0
    flushAnnouncements(w);
    expect(bountyFx(w)).toEqual([]);
    P(w, 0).bounty = 10;
    announceBounty(w, P(w, 0), RT(w, 0));
    w.events = [];
    announceBounty(w, P(w, 0), RT(w, 0));
    at(w, t0 + 3 * BOUNTY_ANNOUNCE_MS);
    announceBounty(w, P(w, 0), RT(w, 0));
    flushAnnouncements(w);
    expect(bountyFx(w)).toEqual([]);
  });

  it("two players are throttled independently: each has their own window", () => {
    const w = startRun(3);
    const t0 = w.state.serverTime;
    P(w, 0).bounty = 10;
    announceBounty(w, P(w, 0), RT(w, 0)); // p0's window opens at t0
    at(w, t0 + 4000);
    P(w, 1).bounty = 10;
    announceBounty(w, P(w, 1), RT(w, 1)); // p1's opens 4 s later
    expect(bountyFx(w).map((fx) => [fx.id, fx.bounty])).toEqual([[idOf(0), 10], [idOf(1), 10]]);
    w.events = [];
    at(w, t0 + 6000);
    P(w, 0).bounty = 28;
    P(w, 1).bounty = 28;
    announceBounty(w, P(w, 0), RT(w, 0));
    announceBounty(w, P(w, 1), RT(w, 1));
    expect(bountyFx(w)).toEqual([]); // both held
    at(w, t0 + BOUNTY_ANNOUNCE_MS); // p0's window is over, p1's is not
    flushAnnouncements(w);
    expect(bountyFx(w).map((fx) => [fx.id, fx.bounty])).toEqual([[idOf(0), 28]]);
    w.events = [];
    at(w, t0 + 4000 + BOUNTY_ANNOUNCE_MS - 1);
    flushAnnouncements(w);
    expect(bountyFx(w)).toEqual([]);
    at(w, t0 + 4000 + BOUNTY_ANNOUNCE_MS);
    flushAnnouncements(w);
    expect(bountyFx(w).map((fx) => [fx.id, fx.bounty])).toEqual([[idOf(1), 28]]);
  });

  it("a player whose rise is held does not hold anyone else's first announcement back", () => {
    const w = startRun(3);
    P(w, 0).bounty = 10;
    announceBounty(w, P(w, 0), RT(w, 0));
    w.events = [];
    P(w, 1).bounty = 10;
    announceBounty(w, P(w, 1), RT(w, 1));
    expect(bountyFx(w).map((fx) => fx.id)).toEqual([idOf(1)]);
  });

  it("the flush system is part of a game world (and only of that), and runs in step()", () => {
    const bare = createWorld({ seed: 1, config: makeConfig(2), random: mulberry32(1) });
    const game = createGameWorld({ seed: 1, config: makeConfig(2), random: mulberry32(1) });
    expect(bare.systems).not.toContain(flushAnnouncements);
    expect(game.systems).toContain(flushAnnouncements);
    installFeed(bare);
    expect(bare.systems).toContain(flushAnnouncements);

    const w = startRun(3);
    const t0 = w.state.serverTime;
    setFeed(w, 0, 2, 4); // feed 3
    creditMobKill(w, P(w, 0), RT(w, 0), false); // feed 3.25: a bounty of 14, announced at once
    expect(P(w, 0).bounty).toBe(14);
    expect(bountyFx(w).map((fx) => fx.bounty)).toEqual([14]);
    for (let i = 0; i < 7; i++) creditMobKill(w, P(w, 0), RT(w, 0), false); // feed 5: a bounty of 52, held
    const grown = P(w, 0).bounty;
    expect(grown).toBe(52);
    expect(bountyFx(w).map((fx) => fx.bounty)).toEqual([14]);
    w.events = [];
    expect(fxOf(runTo(w, t0 + BOUNTY_ANNOUNCE_MS - TICK_MS), "bounty")).toEqual([]);
    expect(fxOf(tick(w), "bounty")).toEqual([{ kind: "bounty", id: idOf(0), name: "alice", bounty: grown }]);
    expect(fxOf(runTo(w, t0 + BOUNTY_ANNOUNCE_MS + 2000), "bounty")).toEqual([]);
  });

  it("a bounty that is claimed is never announced afterwards: the killer is paid the real amount, not the announced one", () => {
    const w = startRun(8);
    const t0 = w.state.serverTime;
    for (const v of [1, 2, 3, 5]) kill(w, v, attacker(w, 0)); // 4 kills: bounty 28, but only the 10 of the 3rd went out
    expect(P(w, 0).bounty).toBe(28);
    expect(RT(w, 0).announce!.sent).toBe(10);
    w.events = [];
    kill(w, 0, attacker(w, 4));
    expect(gvOf(w.events)).toEqual([
      { type: "gv", id: idOf(4), amount: GV_KILL, reason: "kill" },
      { type: "gv", id: idOf(4), amount: 28, reason: "bounty" },
    ]);
    expect(w.state.phase).toBe("active"); // 3 left
    const rest = runTo(w, t0 + BOUNTY_ANNOUNCE_MS + 1000);
    expect(fxOf(rest, "bounty")).toEqual([]);
  });

  it("not announced for a player downed in the very tick the window ends, before the flush looks", () => {
    const w = startRun(8);
    const t0 = w.state.serverTime;
    for (const v of [1, 2, 3, 5]) kill(w, v, attacker(w, 0));
    w.events = [];
    w.systems.unshift((world) => { // before flush: the system order is registration order
      if (world.state.serverTime === t0 + BOUNTY_ANNOUNCE_MS) kill(world, 0, attacker(world, 4));
    });
    expect(fxOf(runTo(w, t0 + BOUNTY_ANNOUNCE_MS - TICK_MS), "bounty")).toEqual([]);
    const events = tick(w);
    expect(RT(w, 0).down).not.toBeNull();
    expect(fxOf(events, "bounty")).toEqual([]);
    expect(fxOf(runTo(w, t0 + BOUNTY_ANNOUNCE_MS + 1000), "bounty")).toEqual([]);
  });
});
