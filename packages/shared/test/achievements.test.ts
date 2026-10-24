import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS, achievementById, evaluateAchievements, goalProgress, isGoalMet,
  type AchievementDef, type AchievementGoal, type AchievementSnapshot,
} from "../src/achievements";
import { WIN_BONUS_MIN_OPPONENTS, WIN_BONUS_MIN_PLAYERS } from "../src/constants";
import { COSMETICS, cosmeticById, GOLD_FACTIONS, GOLD_WEAPONS } from "../src/cosmetics";
import { FACTION_IDS } from "../src/factions";
import * as shared from "../src/index";
import type { ProfileProgress, ProfileStats } from "../src/messages";
import { mulberry32 } from "../src/rng";

interface SnapOver { stats?: Partial<ProfileStats>; progress?: Partial<ProfileProgress>; gvLifetime?: number }

function snap(over: SnapOver = {}): AchievementSnapshot {
  return {
    stats: { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0, ...over.stats },
    progress: { qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {}, ...over.progress },
    gvLifetime: over.gvLifetime ?? 0,
  };
}

const ids = (list: readonly AchievementDef[]): string[] => list.map((a) => a.id);
const winsWith = (faction: string, n: number): SnapOver => ({ progress: { winsByFaction: { [faction]: n } } });
const everyFaction = (n: number): Record<string, number> => Object.fromEntries(FACTION_IDS.map((f) => [f, n]));
const find = (pred: (a: AchievementDef) => boolean): AchievementDef[] => ACHIEVEMENTS.filter(pred);

// The titles the faction "win once" achievements grant; cosmetics.ts stores these ids in profiles.
const FACTION_TITLE_ID: Record<string, string> = {
  fire: "title-pyre-lord", sentenced: "title-the-judge", plague: "title-rat-king", frost: "title-ice-wall", holy: "title-demon-blood",
};

describe("achievement catalog", () => {
  it("has unique ids and non-empty text", () => {
    expect(new Set(ids(ACHIEVEMENTS)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.id).toMatch(/^[a-z_]+$/);
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.desc.length).toBeGreaterThan(0);
    }
  });

  it("grants at least one cosmetic per achievement, and every reward exists in COSMETICS", () => {
    const known = new Set(COSMETICS.map((c) => c.id));
    for (const a of ACHIEVEMENTS) {
      expect(a.reward.length, a.id).toBeGreaterThan(0);
      expect(new Set(a.reward).size, a.id).toBe(a.reward.length);
      for (const id of a.reward) expect(known.has(id), `${a.id} -> ${id}`).toBe(true);
    }
  });

  it("asks for a positive whole number in every goal", () => {
    for (const a of ACHIEVEMENTS) {
      expect(Number.isInteger(a.goal.min), a.id).toBe(true);
      expect(a.goal.min, a.id).toBeGreaterThan(0);
    }
  });

  it("names only real factions and weapons in its goals", () => {
    for (const a of ACHIEVEMENTS) {
      if (a.goal.kind === "factionWins") expect(FACTION_IDS).toContain(a.goal.faction);
      if (a.goal.kind === "weaponWins") expect(GOLD_WEAPONS).toContain(a.goal.weapon);
    }
  });

  it("gives each faction a win-once achievement (a title) and a gild achievement (its golden variant)", () => {
    for (const f of FACTION_IDS) {
      const once = find((a) => a.goal.kind === "factionWins" && a.goal.faction === f && a.goal.min === 1);
      expect(once, f).toHaveLength(1);
      expect(once[0]!.reward, f).toEqual([FACTION_TITLE_ID[f]]);
      expect(cosmeticById(once[0]!.reward[0])?.slot).toBe("title");

      const gild = find((a) => a.goal.kind === "factionWins" && a.goal.faction === f && a.goal.min > 1);
      expect(gild, f).toHaveLength(1);
      expect(gild[0]!.goal.min).toBe(3);
      expect(gild[0]!.reward).toEqual([`gilded-${f}`]);
      expect(cosmeticById(`gilded-${f}`)?.slot).toBe(`gold-${f}`);
    }
    expect(find((a) => a.goal.kind === "factionWins")).toHaveLength(FACTION_IDS.length * 2);
  });

  it("gilds each of the five weapons after 5 wins with it", () => {
    const gilds = find((a) => a.goal.kind === "weaponWins");
    expect(gilds).toHaveLength(5);
    for (const w of GOLD_WEAPONS) {
      const mine = gilds.filter((a) => a.goal.kind === "weaponWins" && a.goal.weapon === w);
      expect(mine, w).toHaveLength(1);
      expect(mine[0]!.goal.min).toBe(5);
      expect(mine[0]!.reward).toEqual([`gilded-${w}`]);
    }
  });

  it("has the headline achievements", () => {
    const goals = ACHIEVEMENTS.map((a) => a.goal);
    expect(goals).toContainEqual({ kind: "progress", key: "qualifiedWins", min: 1 });
    expect(goals).toContainEqual({ kind: "stat", stat: "kills", min: 10 });
    expect(goals).toContainEqual({ kind: "progress", key: "bountyRuns", min: 1 });
    expect(goals).toContainEqual({ kind: "everyFactionWins", min: 1 });
    expect(goals).toContainEqual({ kind: "lifetimeGv", min: 1000 });
  });

  it("reads no achievement from stats.wins: a win only counts once it passed the win-bonus gate", () => {
    for (const a of ACHIEVEMENTS) {
      if (a.goal.kind === "stat") expect(a.goal.stat, a.id).not.toBe("wins");
    }
    expect(find((a) => a.goal.kind === "stat" && a.goal.stat === "wins")).toEqual([]);
  });

  it("drives first_win, champion and warlord from qualifiedWins at 1, 5 and 20", () => {
    const wins = [["first_win", 1], ["champion", 5], ["warlord", 20]] as const;
    for (const [id, min] of wins) {
      expect(achievementById(id)!.goal, id).toEqual({ kind: "progress", key: "qualifiedWins", min });
    }
  });

  it("names the win-bonus gate in the description of every win-based achievement", () => {
    const winBased = find((a) => {
      const g = a.goal;
      return g.kind === "factionWins" || g.kind === "weaponWins" || g.kind === "everyFactionWins"
        || (g.kind === "progress" && g.key === "qualifiedWins");
    });
    expect(ids(winBased).sort()).toEqual([
      "champion", "cycle_breaker", "first_win", "warlord",
      ...GOLD_FACTIONS.flatMap((f) => [`win_${f}`, `gild_${f}`]),
      ...GOLD_WEAPONS.map((w) => `gild_${w}`),
    ].sort());
    for (const a of winBased) {
      expect(a.desc, a.id).toContain(String(WIN_BONUS_MIN_PLAYERS));
      expect(a.desc, a.id).toContain(String(WIN_BONUS_MIN_OPPONENTS));
    }
  });

  it("looks up by id and rejects everything else", () => {
    for (const a of ACHIEVEMENTS) expect(achievementById(a.id)).toBe(a);
    for (const v of ["", "nope", "__proto__", "constructor", "toString", undefined, null, 3, {}, []]) {
      expect(achievementById(v)).toBeUndefined();
    }
  });

  it("is reachable from the shared index", () => {
    expect(shared.evaluateAchievements).toBe(evaluateAchievements);
    expect(shared.ACHIEVEMENTS).toBe(ACHIEVEMENTS);
  });
});

describe("goalProgress", () => {
  const kills10: AchievementGoal = { kind: "stat", stat: "kills", min: 10 };

  it("reports have and need, with have capped at need", () => {
    expect(goalProgress(kills10, snap({ stats: { kills: 4 } }))).toEqual({ have: 4, need: 10 });
    expect(goalProgress(kills10, snap({ stats: { kills: 10 } }))).toEqual({ have: 10, need: 10 });
    expect(goalProgress(kills10, snap({ stats: { kills: 500 } }))).toEqual({ have: 10, need: 10 });
  });

  it("never reports a negative have", () => {
    expect(goalProgress(kills10, snap({ stats: { kills: -3 } }))).toEqual({ have: 0, need: 10 });
    expect(goalProgress({ kind: "lifetimeGv", min: 1000 }, snap({ gvLifetime: -5 }))).toEqual({ have: 0, need: 1000 });
  });

  it("reads each goal kind from its own counter", () => {
    const s = snap({
      stats: { runs: 7, wins: 9, kills: 3 },
      progress: { qualifiedWins: 2, bountyRuns: 1, bestRunKills: 4, winsByFaction: { frost: 2 }, winsByWeapon: { axe: 3 } },
      gvLifetime: 640,
    });
    expect(goalProgress({ kind: "stat", stat: "runs", min: 25 }, s)).toEqual({ have: 7, need: 25 });
    expect(goalProgress({ kind: "progress", key: "qualifiedWins", min: 5 }, s)).toEqual({ have: 2, need: 5 });
    expect(goalProgress({ kind: "progress", key: "bestRunKills", min: 5 }, s)).toEqual({ have: 4, need: 5 });
    expect(goalProgress({ kind: "progress", key: "bountyRuns", min: 1 }, s)).toEqual({ have: 1, need: 1 });
    expect(goalProgress({ kind: "lifetimeGv", min: 1000 }, s)).toEqual({ have: 640, need: 1000 });
    expect(goalProgress({ kind: "factionWins", faction: "frost", min: 3 }, s)).toEqual({ have: 2, need: 3 });
    expect(goalProgress({ kind: "factionWins", faction: "fire", min: 3 }, s)).toEqual({ have: 0, need: 3 });
    expect(goalProgress({ kind: "weaponWins", weapon: "axe", min: 5 }, s)).toEqual({ have: 3, need: 5 });
    expect(goalProgress({ kind: "weaponWins", weapon: "bow", min: 5 }, s)).toEqual({ have: 0, need: 5 });
  });

  it("reads qualifiedWins for the win goals and ignores stats.wins", () => {
    const wins = [["first_win", 1], ["champion", 5], ["warlord", 20]] as const;
    for (const [id, need] of wins) {
      const goal = achievementById(id)!.goal;
      expect(goalProgress(goal, snap({ stats: { wins: 100 } })), id).toEqual({ have: 0, need });
      expect(goalProgress(goal, snap({ stats: { wins: 100 }, progress: { qualifiedWins: 3 } })), id).toEqual({ have: Math.min(3, need), need });
      expect(goalProgress(goal, snap({ progress: { qualifiedWins: 500 } })), id).toEqual({ have: need, need });
    }
  });

  it("counts the factions at or above min, out of 5, for everyFactionWins", () => {
    const goal1: AchievementGoal = { kind: "everyFactionWins", min: 1 };
    const goal3: AchievementGoal = { kind: "everyFactionWins", min: 3 };
    expect(goalProgress(goal1, snap())).toEqual({ have: 0, need: 5 });
    expect(goalProgress(goal1, snap({ progress: { winsByFaction: { fire: 1, frost: 7 } } }))).toEqual({ have: 2, need: 5 });
    expect(goalProgress(goal1, snap({ progress: { winsByFaction: everyFaction(1) } }))).toEqual({ have: 5, need: 5 });
    expect(goalProgress(goal1, snap({ progress: { winsByFaction: everyFaction(40) } }))).toEqual({ have: 5, need: 5 });
    expect(goalProgress(goal3, snap({ progress: { winsByFaction: { fire: 3, frost: 2, holy: 99 } } }))).toEqual({ have: 2, need: 5 });
  });

  it("ignores keys that are not factions when counting everyFactionWins", () => {
    const winsByFaction = { fire: 1, sentenced: 1, plague: 1, frost: 1, bogus: 50, other: 50 };
    expect(goalProgress({ kind: "everyFactionWins", min: 1 }, snap({ progress: { winsByFaction } }))).toEqual({ have: 4, need: 5 });
  });

  it("reads dictionaries by own keys only and never throws on hostile ones", () => {
    const hostile = JSON.parse('{"__proto__": 9, "constructor": 9, "toString": 9}') as Record<string, number>;
    const goals: AchievementGoal[] = [
      { kind: "factionWins", faction: "fire", min: 1 },
      { kind: "weaponWins", weapon: "sword", min: 1 },
      { kind: "everyFactionWins", min: 1 },
    ];
    for (const goal of goals) {
      const s = snap({ progress: { winsByFaction: hostile, winsByWeapon: hostile } });
      expect(() => goalProgress(goal, s)).not.toThrow();
      expect(goalProgress(goal, s).have, goal.kind).toBe(0);
      expect(isGoalMet(goal, s), goal.kind).toBe(false);
    }
  });

  it("reads a faction or weapon named like a prototype member as 0 from a plain dictionary", () => {
    const s = snap();
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(goalProgress({ kind: "factionWins", faction: key as "fire", min: 1 }, s).have, key).toBe(0);
      expect(goalProgress({ kind: "weaponWins", weapon: key as "sword", min: 1 }, s).have, key).toBe(0);
    }
  });

  it("does not see counts a dictionary only inherits", () => {
    const inherited = Object.create({ fire: 4, sword: 9 }) as Record<string, number>;
    const s = snap({ progress: { winsByFaction: inherited, winsByWeapon: inherited } });
    expect(goalProgress({ kind: "factionWins", faction: "fire", min: 3 }, s).have).toBe(0);
    expect(goalProgress({ kind: "weaponWins", weapon: "sword", min: 5 }, s).have).toBe(0);
  });

  it("reads own entries that are not finite numbers as 0", () => {
    const bad = { fire: NaN, sentenced: Infinity, plague: "3", frost: null, holy: {} } as unknown as Record<string, number>;
    const s = snap({ progress: { winsByFaction: bad } });
    for (const f of FACTION_IDS) expect(goalProgress({ kind: "factionWins", faction: f, min: 1 }, s).have, f).toBe(0);
    expect(goalProgress({ kind: "everyFactionWins", min: 1 }, s).have).toBe(0);
  });

  it("agrees with isGoalMet: met exactly when have reaches need", () => {
    const rng = mulberry32(12);
    for (let i = 0; i < 300; i++) {
      const s = snap({
        stats: { kills: Math.floor(rng() * 80), wins: Math.floor(rng() * 30), runs: Math.floor(rng() * 40) },
        progress: {
          qualifiedWins: Math.floor(rng() * 30),
          bountyRuns: Math.floor(rng() * 3),
          bestRunKills: Math.floor(rng() * 8),
          winsByFaction: Object.fromEntries(FACTION_IDS.map((f) => [f, Math.floor(rng() * 5)])),
          winsByWeapon: Object.fromEntries(GOLD_WEAPONS.map((w) => [w, Math.floor(rng() * 8)])),
        },
        gvLifetime: Math.floor(rng() * 2000),
      });
      for (const a of ACHIEVEMENTS) {
        const { have, need } = goalProgress(a.goal, s);
        expect(have).toBeGreaterThanOrEqual(0);
        expect(have).toBeLessThanOrEqual(need);
        expect(isGoalMet(a.goal, s), a.id).toBe(have === need);
      }
    }
  });
});

describe("evaluateAchievements", () => {
  it("returns nothing for a zero snapshot", () => {
    expect(evaluateAchievements(snap(), {})).toEqual([]);
  });

  it("returns exactly the newly met achievements, in catalog order", () => {
    const got = evaluateAchievements(snap({ stats: { kills: 10 }, progress: { qualifiedWins: 1 } }), {});
    expect(ids(got)).toEqual(["first_blood", "slayer", "first_win"]);
    const order = ids(got).map((id) => ACHIEVEMENTS.findIndex((a) => a.id === id));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("skips achievements already in unlocked, even with a falsy unlock time", () => {
    const s = snap({ stats: { kills: 10 }, progress: { qualifiedWins: 1 } });
    expect(ids(evaluateAchievements(s, { first_blood: 1700000000000 }))).toEqual(["slayer", "first_win"]);
    expect(ids(evaluateAchievements(s, { first_blood: 0, first_win: 0 }))).toEqual(["slayer"]);
    expect(evaluateAchievements(s, { first_blood: 1, slayer: 2, first_win: 3 })).toEqual([]);
  });

  it("ignores unlocked ids it does not know", () => {
    expect(ids(evaluateAchievements(snap({ stats: { kills: 1 } }), { retired_one: 5 }))).toEqual(["first_blood"]);
  });

  it("returns all of the achievements a jump over several thresholds crosses, once each", () => {
    const got = ids(evaluateAchievements(snap({ stats: { kills: 50 } }), {}));
    expect(got).toEqual(["first_blood", "slayer", "reaper"]);
    expect(new Set(got).size).toBe(got.length);
  });

  it("is exactly-once: record the results, evaluate again, get nothing", () => {
    const s = snap({
      stats: { runs: 30, wins: 6, kills: 12 },
      progress: { qualifiedWins: 6, bountyRuns: 1, bestRunKills: 5, winsByFaction: everyFaction(3), winsByWeapon: { sword: 5 } },
      gvLifetime: 1500,
    });
    const unlocked: Record<string, number> = {};
    const first = evaluateAchievements(s, unlocked);
    expect(first.length).toBeGreaterThan(0);
    for (const a of first) unlocked[a.id] = 1;
    expect(evaluateAchievements(s, unlocked)).toEqual([]);
  });

  it("never returns the same achievement twice over a growing career, and ends with every met one unlocked", () => {
    const rng = mulberry32(2026);
    const stats = { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 };
    const progress: ProfileProgress = { qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} };
    let gv = 0;
    const unlocked: Record<string, number> = {};
    const seen: string[] = [];
    for (let run = 1; run <= 400; run++) {
      const faction = FACTION_IDS[Math.floor(rng() * FACTION_IDS.length)]!;
      const weapon = GOLD_WEAPONS[Math.floor(rng() * GOLD_WEAPONS.length)]!;
      const kills = Math.floor(rng() * 4);
      stats.runs++;
      stats.kills += kills;
      progress.bestRunKills = Math.max(progress.bestRunKills, kills);
      if (rng() < 0.1) progress.bountyRuns++;
      if (rng() < 0.25) {
        stats.wins++;
        if (rng() < 0.8) {
          progress.qualifiedWins++;
          progress.winsByFaction[faction] = (progress.winsByFaction[faction] ?? 0) + 1;
          progress.winsByWeapon[weapon] = (progress.winsByWeapon[weapon] ?? 0) + 1;
        }
      } else stats.deaths++;
      gv += Math.floor(rng() * 60);
      const s: AchievementSnapshot = { stats: { ...stats }, progress: structuredClone(progress), gvLifetime: gv };
      for (const a of evaluateAchievements(s, unlocked)) {
        seen.push(a.id);
        unlocked[a.id] = run;
      }
    }
    expect(new Set(seen).size).toBe(seen.length);
    const final: AchievementSnapshot = { stats, progress, gvLifetime: gv };
    expect(new Set(seen)).toEqual(new Set(ACHIEVEMENTS.filter((a) => isGoalMet(a.goal, final)).map((a) => a.id)));
    expect(seen.length).toBeGreaterThan(10);
  });

  it("returns the whole catalog, in order, for a snapshot that meets every goal", () => {
    const s = snap({
      stats: { runs: 25, wins: 20, kills: 50 },
      progress: { qualifiedWins: 20, bountyRuns: 1, bestRunKills: 5, winsByFaction: everyFaction(3), winsByWeapon: Object.fromEntries(GOLD_WEAPONS.map((w) => [w, 5])) },
      gvLifetime: 1000,
    });
    expect(ids(evaluateAchievements(s, {}))).toEqual(ids(ACHIEVEMENTS));
  });

  it("does not change the snapshot or the unlocked record", () => {
    const deepFreeze = <T extends object>(o: T): T => {
      for (const v of Object.values(o)) if (typeof v === "object" && v !== null) deepFreeze(v);
      return Object.freeze(o);
    };
    const s = deepFreeze(snap({ stats: { kills: 10 }, progress: { winsByFaction: { fire: 3 } } }));
    const unlocked = deepFreeze({ first_blood: 5 });
    expect(() => evaluateAchievements(s, unlocked)).not.toThrow();
    expect(unlocked).toEqual({ first_blood: 5 });
  });

  describe("stat and progress goals", () => {
    it.each([
      [{ stats: { kills: 1 } }, ["first_blood"]],
      [{ stats: { kills: 9 } }, ["first_blood"]],
      [{ stats: { kills: 10 } }, ["first_blood", "slayer"]],
      [{ stats: { kills: 49 } }, ["first_blood", "slayer"]],
      [{ progress: { qualifiedWins: 0 } }, []],
      [{ progress: { qualifiedWins: 1 } }, ["first_win"]],
      [{ progress: { qualifiedWins: 4 } }, ["first_win"]],
      [{ progress: { qualifiedWins: 5 } }, ["first_win", "champion"]],
      [{ progress: { qualifiedWins: 19 } }, ["first_win", "champion"]],
      [{ progress: { qualifiedWins: 20 } }, ["first_win", "champion", "warlord"]],
      [{ stats: { wins: 100 } }, []],
      [{ stats: { wins: 100 }, progress: { qualifiedWins: 4 } }, ["first_win"]],
      [{ stats: { runs: 24 } }, []],
      [{ stats: { runs: 25 } }, ["veteran"]],
      [{ stats: { draws: 100, deaths: 100 } }, []],
      [{ progress: { bestRunKills: 4 } }, []],
      [{ progress: { bestRunKills: 5 } }, ["rampage"]],
      [{ progress: { bountyRuns: 1 } }, ["bounty_hunter"]],
    ] as [SnapOver, string[]][])("%j unlocks %j", (over, expected) => {
      expect(ids(evaluateAchievements(snap(over), {}))).toEqual(expected);
    });

    it("grants the titles and colours the goals are for", () => {
      const reward = (id: string) => achievementById(id)!.reward;
      expect(reward("first_win")).toEqual(["title-victor", "skin-laurel"]);
      expect(reward("rampage")).toEqual(["title-rampage", "trail-comet"]);
      expect(reward("bounty_hunter")).toEqual(["title-bounty-hunter", "outline-bounty"]);
      expect(reward("veteran")).toEqual(["title-veteran", "skin-ghost"]);
    });
  });

  describe("lifetime GV", () => {
    it("unlocks glorious at 1000 and not at 999", () => {
      expect(evaluateAchievements(snap({ gvLifetime: 999 }), {})).toEqual([]);
      expect(ids(evaluateAchievements(snap({ gvLifetime: 1000 }), {}))).toEqual(["glorious"]);
      expect(ids(evaluateAchievements(snap({ gvLifetime: 1e9 }), {}))).toEqual(["glorious"]);
    });

    it("does not unlock glorious from stats alone", () => {
      expect(ids(evaluateAchievements(snap({ stats: { runs: 25, wins: 20, kills: 50 }, progress: { qualifiedWins: 20 } }), {}))).not.toContain("glorious");
    });
  });

  describe("faction wins", () => {
    for (const faction of FACTION_IDS) {
      it(`${faction}: 1 and 2 wins give the title, 3 and more also gild, and nothing else unlocks`, () => {
        for (const n of [0, 1, 2]) {
          const want = n === 0 ? [] : [`win_${faction}`];
          expect(ids(evaluateAchievements(snap(winsWith(faction, n)), {})), `${n} wins`).toEqual(want);
        }
        for (const n of [3, 4, 5, 50]) {
          const got = evaluateAchievements(snap(winsWith(faction, n)), {});
          expect(ids(got), `${n} wins`).toEqual([`win_${faction}`, `gild_${faction}`]);
          expect(got.flatMap((a) => a.reward), `${n} wins`).toEqual([FACTION_TITLE_ID[faction], `gilded-${faction}`]);
        }
      });
    }

    it("does not let one faction's wins unlock another's", () => {
      const got = ids(evaluateAchievements(snap({ progress: { winsByFaction: { fire: 3, frost: 1 } } }), {}));
      expect(got.sort()).toEqual(["gild_fire", "win_fire", "win_frost"]);
    });
  });

  describe("weapon wins", () => {
    for (const weapon of GOLD_WEAPONS) {
      it(`${weapon}: needs 5 wins, then grants only its golden variant`, () => {
        for (const n of [0, 1, 3, 4]) {
          expect(evaluateAchievements(snap({ progress: { winsByWeapon: { [weapon]: n } } }), {}), `${n} wins`).toEqual([]);
        }
        for (const n of [5, 6, 100]) {
          const got = evaluateAchievements(snap({ progress: { winsByWeapon: { [weapon]: n } } }), {});
          expect(ids(got), `${n} wins`).toEqual([`gild_${weapon}`]);
          expect(got[0]!.reward).toEqual([`gilded-${weapon}`]);
        }
      });
    }

    it("does not count wins by weapon toward factions or the reverse", () => {
      expect(evaluateAchievements(snap({ progress: { winsByWeapon: Object.fromEntries(FACTION_IDS.map((f) => [f, 9])) } }), {})).toEqual([]);
      expect(evaluateAchievements(snap({ progress: { winsByFaction: Object.fromEntries(GOLD_WEAPONS.map((w) => [w, 9])) } }), {})).toEqual([]);
    });
  });

  describe("cycle breaker", () => {
    it("needs a win with all five factions", () => {
      const four = Object.fromEntries(GOLD_FACTIONS.slice(0, 4).map((f) => [f, 1]));
      const got = ids(evaluateAchievements(snap({ progress: { winsByFaction: four } }), {}));
      expect(got).not.toContain("cycle_breaker");
      expect(got).toEqual(GOLD_FACTIONS.slice(0, 4).map((f) => `win_${f}`));
    });

    it("is not earned by many wins with a single faction", () => {
      expect(ids(evaluateAchievements(snap(winsWith("fire", 100)), {}))).not.toContain("cycle_breaker");
    });

    it("is not earned by wins under names that are not factions", () => {
      const fake = { fire: 1, sentenced: 1, plague: 1, frost: 1, bogus: 1 };
      expect(ids(evaluateAchievements(snap({ progress: { winsByFaction: fake } }), {}))).not.toContain("cycle_breaker");
    });

    it("unlocks with one win each, between the win titles and the gilds in catalog order", () => {
      const got = ids(evaluateAchievements(snap({ progress: { winsByFaction: everyFaction(1) } }), {}));
      expect(got).toEqual([...GOLD_FACTIONS.map((f) => `win_${f}`), "cycle_breaker"]);
      expect(achievementById("cycle_breaker")!.reward).toEqual(["title-cycle-breaker"]);
    });

    it("comes with every gild when each faction has three wins", () => {
      const got = ids(evaluateAchievements(snap({ progress: { winsByFaction: everyFaction(3) } }), {}));
      expect(got).toEqual([...GOLD_FACTIONS.map((f) => `win_${f}`), "cycle_breaker", ...GOLD_FACTIONS.map((f) => `gild_${f}`)]);
    });
  });
});
