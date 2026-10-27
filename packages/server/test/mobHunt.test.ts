// The bots' mob hunt decisions (src/bots/mobHunt.ts), pure: no server, no sockets, no clock. A scene is a bot, a few mobs
// and a straight-line "walk"; time is passed in, so a fight of seconds runs in microseconds.
import { describe, expect, it } from "vitest";
import {
  FACTIONS, type FactionId, type Vec2, type WeaponId,
} from "@raid/shared";
import {
  bestEdge, bestSlotVsMob, matchupShare, MOB_HUNT, MobHunter, MobTracker, mobWeapon, pathLength, retreatPoint,
  useless, type HuntInput, type HuntSelf, type MobHuntConfig, type MobLike,
} from "../src/bots/mobHunt";

const REGION_WEAPON: Record<FactionId, WeaponId> = { fire: "axe", sentenced: "sword", plague: "bow", frost: "shield", holy: "wand" };

function mob(region: FactionId, x: number, y: number, o: Partial<MobLike> = {}): MobLike {
  const hp = o.maxHp ?? 300;
  return { kind: "mob", status: "alive", x, y, hp, maxHp: hp, faction: region, weapon0: REGION_WEAPON[region], ...o };
}

const ME: HuntSelf = { faction: "plague", x: 0, y: 0, hp: 1000, maxHp: 1000, weapons: ["sword", null], stacks: 0, mobKills: 0 };

/** One scene: the bot, the mobs (by id) and a straight-line walk. Every field can be overridden per call. */
class Scene {
  now = 10_000;
  readonly mobs = new Map<string, MobLike>();
  self: HuntSelf = { ...ME };
  playerDistance = Infinity;
  players: Vec2[] = [];
  inColiseum = false;
  attacking = false;
  /** When a player last hit the bot (bots/brain/memory.ts reads it off the hit fx: `lastHitByPlayerAt`); never, by default. */
  shotByPlayerAt = -Infinity;
  /** Pretend there is no path to these ids. */
  unreachable = new Set<string>();
  walkLimit = Infinity;
  readonly hunter: MobHunter;

  constructor(cfg: Partial<MobHuntConfig> = {}) {
    this.hunter = new MobHunter({ ...MOB_HUNT, ...cfg });
  }

  add(id: string, m: MobLike): this {
    this.mobs.set(id, m);
    return this;
  }

  input(): HuntInput {
    return {
      now: this.now,
      self: this.self,
      playerDistance: this.playerDistance,
      players: this.players,
      inColiseum: this.inColiseum,
      mobs: this.mobs,
      attacking: this.attacking,
      shotByPlayerAt: this.shotByPlayerAt,
      walk: (to) => {
        const d = Math.hypot(to.x - this.self.x, to.y - this.self.y);
        for (const [id, m] of this.mobs) if (m.x === to.x && m.y === to.y && this.unreachable.has(id)) return null;
        return d > this.walkLimit ? null : d;
      },
    };
  }

  /** One decision, `ms` after the last. */
  step(ms = 50) {
    this.now += ms;
    return this.hunter.decide(this.input());
  }

  /** Steps for `ms` in 50 ms ticks; returns the last decision. */
  run(ms: number, each?: () => void) {
    let out = this.step(0);
    for (let t = 0; t < ms; t += 50) {
      each?.();
      out = this.step(50);
    }
    return out;
  }
}

describe("MobTracker", () => {
  it("remembers where a mob first stood and forgets mobs that left the state", () => {
    const t = new MobTracker();
    const a = mob("fire", 100, 100);
    t.observe(new Map([["a", a]]), 0);
    a.x = 300;
    t.observe(new Map([["a", a]]), 50);
    expect(t.home("a")).toEqual({ x: 100, y: 100 });
    t.observe(new Map(), 100);
    expect(t.mob("a")).toBeNull();
  });

  it("flags a mob whose hp rises as walking home, for a moment", () => {
    const t = new MobTracker();
    const a = mob("fire", 100, 100, { hp: 100, maxHp: 225 });
    t.observe(new Map([["a", a]]), 0);
    expect(t.returning("a", 10)).toBe(false);
    a.hp = 130;
    t.observe(new Map([["a", a]]), 50);
    expect(t.returning("a", 60)).toBe(true);
    expect(t.returning("a", 50 + 5000)).toBe(false);
  });

  it("calls a mob awake when it left its spot or is hurt, but not while it is walking home", () => {
    const t = new MobTracker();
    const a = mob("fire", 100, 100);
    const sleeper = mob("fire", 500, 500);
    const all = new Map([["a", a], ["s", sleeper]]);
    t.observe(all, 0);
    expect(t.awake("a", 0, 40)).toBe(false);
    a.x = 200;
    expect(t.awake("a", 10, 40)).toBe(true);
    expect(t.awakeNear({ x: 150, y: 100 }, 300, 10, 40)).toEqual([{ x: 200, y: 100 }]);
    a.hp = a.maxHp - 50;
    a.x = 100;
    t.observe(all, 20);
    expect(t.awake("a", 20, 40)).toBe(true); // hurt, at home
    a.hp += 10;
    t.observe(all, 30);
    expect(t.awake("a", 40, 40)).toBe(false); // healing: on its way home
  });
});

describe("who to farm", () => {
  it("takes the nearest mob within reach and ignores the dead, dummies, the far and the unreachable", () => {
    const s = new Scene();
    s.self = { ...ME, mobKills: 1 }; // past its first kill: the short reach
    s.add("far", mob("sentenced", 900, 0)); // beyond MOB_HUNT.reach
    s.add("dead", mob("sentenced", 50, 0, { status: "dead" }));
    s.add("dummy", mob("sentenced", 60, 0, { kind: "dummy" }));
    s.add("walled", mob("sentenced", 70, 0));
    s.unreachable.add("walled");
    s.add("ok", mob("sentenced", 300, 0));
    s.add("nearer", mob("sentenced", 200, 0));
    expect(s.step()).toMatchObject({ kind: "mob", id: "nearer" });
  });

  it("walks farther for a first kill than for the rest", () => {
    const first = new Scene().add("m", mob("sentenced", 1000, 0));
    expect(first.step()).toMatchObject({ kind: "mob", id: "m" });
    const later = new Scene().add("m", mob("sentenced", 1000, 0));
    later.self = { ...ME, mobKills: 1 };
    expect(later.step()).toMatchObject({ kind: "player" });
  });

  it("skips a walk that is far longer than the straight line", () => {
    const s = new Scene().add("m", mob("sentenced", 400, 0));
    s.walkLimit = 100;
    expect(s.step()).toMatchObject({ kind: "player", why: "no mob in reach" });
  });

  it("prefers a mob whose weapon its own weapon beats, all else equal", () => {
    // Bow beats sword and axe, loses to wand and shield; a sentenced (sword) mob and a holy (wand) mob stand equally far.
    const s = new Scene();
    s.self = { ...ME, faction: "frost", weapons: ["bow", "bow"], mobKills: 1 };
    s.add("wand", mob("holy", 0, 300)).add("sword", mob("sentenced", 300, 0));
    expect(s.step()).toMatchObject({ id: "sword" });
  });

  it("prefers the region that drops a weapon type it lacks, while a slot is free", () => {
    // Holding an axe, a shield mob (the axe beats it, and it drops a shield) is worth the extra 130 u over an axe mob (a mirror, no drop).
    const s = new Scene();
    s.self = { ...ME, faction: "plague", weapons: ["axe", null], mobKills: 1 };
    s.add("axe", mob("fire", 0, 200)).add("shield", mob("frost", 330, 0));
    expect(s.step()).toMatchObject({ id: "shield" });
    // With both slots full a drop is no use, and the nearer axe mob (the bow beats it) wins.
    const full = new Scene();
    full.self = { ...ME, faction: "plague", weapons: ["axe", "bow"], mobKills: 1 };
    full.add("axe", mob("fire", 0, 200)).add("shield", mob("frost", 330, 0));
    expect(full.step()).toMatchObject({ id: "axe" });
  });

  it("takes a mob whose weapon beats ours only when nothing better is about, and never an elite like that", () => {
    // The sword out-swings the axe, so the sentenced mob is a poor meal even though it is nearer; the shield mob is pierced by the axe.
    const s = new Scene();
    s.self = { ...ME, faction: "plague", weapons: ["axe", null], mobKills: 1 };
    s.add("sword", mob("sentenced", 200, 0));
    expect(s.step()).toMatchObject({ kind: "mob", id: "sword" });
    s.add("shield", mob("frost", 450, 0));
    expect(s.step()).toMatchObject({ id: "sword" }); // sticks with its target
    const both = new Scene();
    both.self = { ...ME, faction: "plague", weapons: ["axe", null], mobKills: 1 };
    both.add("sword", mob("sentenced", 200, 0)).add("shield", mob("frost", 450, 0));
    expect(both.step()).toMatchObject({ id: "shield" });
    // An elite whose weapon beats ours is not worth it, whatever the stacks.
    const e = new Scene();
    e.self = { ...ME, faction: "holy", weapons: ["axe", null], stacks: 3, mobKills: 1 };
    e.add("swordElite", mob("sentenced", 200, 0, { kind: "elite", maxHp: 600 }));
    expect(e.step()).toMatchObject({ kind: "player" });
  });

  it("hunts on fists: with both slots empty a mob of any weapon is a meal (fists pierce a shield), and the drop it earns is welcome", () => {
    // A bow or a sword bot skips a shield mob (its arrows bounce, its blows are blocked); an empty-handed bot punches through.
    const shield = new Scene().add("shield", mob("frost", 200, 0));
    shield.self = { ...ME, weapons: [null, null], mobKills: 1 };
    expect(shield.step()).toMatchObject({ kind: "mob", id: "shield" });
    // Carrying nothing, any weapon is one it lacks: a nearer mob does not beat a farther one by much, but a drop is worth a detour.
    const lacks = new Scene();
    lacks.self = { ...ME, faction: "plague", weapons: [null, null], mobKills: 1 };
    lacks.add("axe", mob("fire", 0, 200)).add("shield", mob("frost", 300, 0));
    expect(lacks.step()).toMatchObject({ kind: "mob" });
    // Mobs that fight from range are still left alone (a bow backs away out of its leash), fists or not.
    const ranged = new Scene().add("bow", mob("plague", 200, 0));
    ranged.self = { ...ME, weapons: [null, null], mobKills: 1 };
    expect(ranged.step()).toMatchObject({ kind: "player" });
  });

  it("skips mobs it cannot hurt or that cannot hurt it, and mobs that fight from range", () => {
    // A bow's arrows bounce off a shield mob; a shield bot's blocks make a sword mob give up; both are useless matchups.
    const bow = new Scene().add("shield", mob("frost", 200, 0));
    bow.self = { ...ME, weapons: ["bow", null], mobKills: 1 };
    expect(bow.step()).toMatchObject({ kind: "player" });
    const shield = new Scene().add("sword", mob("sentenced", 200, 0));
    shield.self = { ...ME, weapons: ["shield", null], mobKills: 1 };
    expect(shield.step()).toMatchObject({ kind: "player" });
    // ...but an axe mob pierces a shield, so it fights back and can be killed; and a second weapon that works is enough.
    const pierced = new Scene().add("axe", mob("fire", 200, 0));
    pierced.self = { ...ME, weapons: ["shield", null], mobKills: 1 };
    expect(pierced.step()).toMatchObject({ kind: "mob", id: "axe" });
    const spare = new Scene().add("sword", mob("sentenced", 200, 0));
    spare.self = { ...ME, weapons: ["shield", "bow"], mobKills: 1 };
    expect(spare.step()).toMatchObject({ kind: "mob", id: "sword" });
    // Mobs with a bow or a wand back away from the bot and out of their leash: left alone, unless asked for.
    const ranged = new Scene().add("bow", mob("plague", 200, 0)).add("wand", mob("holy", 220, 0));
    ranged.self = { ...ME, weapons: ["axe", null], mobKills: 1 };
    expect(ranged.step()).toMatchObject({ kind: "player" });
    const keen = new Scene({ skipRanged: false }).add("bow", mob("plague", 200, 0));
    keen.self = { ...ME, faction: "frost", weapons: ["axe", null], mobKills: 1 };
    expect(keen.step()).toMatchObject({ kind: "mob", id: "bow" });
  });

  it("does not take on a faction it loses to or only just beats", () => {
    // Sentenced keeps less against a Fire mob in the duel table than Plague does. mobMinShare (0.5) sat between them while MOB_K was
    // 0.45; the owner's ruling lowered it to 0.22 and every normal mob is a clear win now, so the bar is set between the two here.
    const sentencedShare = matchupShare("sentenced", "fire", false);
    const plagueShare = matchupShare("plague", "fire", false);
    expect(sentencedShare).toBeLessThan(plagueShare);
    const mobMinShare = (sentencedShare + plagueShare) / 2;
    const sentenced = new Scene({ mobMinShare }).add("axe", mob("fire", 200, 0));
    sentenced.self = { ...ME, faction: "sentenced", weapons: ["bow", null] };
    expect(sentenced.step()).toMatchObject({ kind: "player" });
    const plague = new Scene({ mobMinShare }).add("axe", mob("fire", 200, 0));
    plague.self = { ...ME, faction: "plague", weapons: ["bow", null] };
    expect(plague.step()).toMatchObject({ kind: "mob", id: "axe" });
  });

  it("leaves elites to bots with stacks or full hp, and to those who can afford the duel", () => {
    const elite = (region: FactionId) => mob(region, 200, 0, { kind: "elite", maxHp: 600 });
    // Full hp, but Frost keeps only 23% against the Sentenced elite: too narrow.
    const narrow = new Scene().add("e", elite("sentenced"));
    narrow.self = { ...ME, faction: "frost", weapons: ["axe", null], hp: 950 };
    expect(narrow.step()).toMatchObject({ kind: "player" });
    // ...unless three stacks make it worth the risk (the bar drops to eliteSureShare, 0.4: still not 23%).
    const stackedNarrow = new Scene().add("e", elite("sentenced"));
    stackedNarrow.self = { ...ME, faction: "frost", weapons: ["axe", null], hp: 950, stacks: 3 };
    expect(stackedNarrow.step()).toMatchObject({ kind: "player" });
    // Plague keeps 78% against the Frost elite (the axe beats its shield too): fine at full hp...
    const strong = new Scene().add("e", elite("frost"));
    strong.self = { ...ME, faction: "plague", weapons: ["axe", null], hp: 950 };
    expect(strong.step()).toMatchObject({ kind: "mob", id: "e" });
    // ...not when hurt without stacks, fine again with a stack.
    const hurt = new Scene().add("e", elite("frost"));
    hurt.self = { ...ME, faction: "plague", weapons: ["axe", null], hp: 700 };
    expect(hurt.step()).toMatchObject({ kind: "player" });
    const stacked = new Scene().add("e", elite("frost"));
    stacked.self = { ...ME, faction: "plague", weapons: ["axe", null], hp: 700, stacks: 1 };
    expect(stacked.step()).toMatchObject({ kind: "mob", id: "e" });
  });

  it("does not start a fight below half hp", () => {
    const s = new Scene().add("m", mob("sentenced", 200, 0));
    s.self = { ...ME, hp: 400 };
    expect(s.step()).toMatchObject({ kind: "player" });
  });

  it("keeps its target while another is nearer, and moves on when the target dies", () => {
    const s = new Scene().add("a", mob("sentenced", 300, 0)).add("b", mob("sentenced", 500, 0));
    expect(s.step()).toMatchObject({ id: "a" });
    s.add("c", mob("sentenced", 100, 0));
    expect(s.step()).toMatchObject({ id: "a" });
    s.mobs.get("a")!.status = "dead";
    expect(s.step()).toMatchObject({ id: "c" });
  });
});

describe("players first", () => {
  it("hunts a player that comes within 250 u and keeps on until it is 450 u away", () => {
    const s = new Scene().add("m", mob("sentenced", 300, 0));
    expect(s.step()).toMatchObject({ kind: "mob" });
    s.playerDistance = 240;
    expect(s.step()).toMatchObject({ kind: "player", why: "a player is close" });
    s.playerDistance = 400; // hysteresis: still the player
    expect(s.step()).toMatchObject({ kind: "player" });
    s.playerDistance = 460;
    expect(s.step()).toMatchObject({ kind: "mob" });
  });

  it("does not mind a player at 300 u that it was not hunting", () => {
    const s = new Scene().add("m", mob("sentenced", 300, 0));
    s.playerDistance = 300;
    expect(s.step()).toMatchObject({ kind: "mob" });
  });

  it("answers fire from a player: a hit by one while it is in bow range", () => {
    const s = new Scene().add("m", mob("sentenced", 300, 0));
    s.playerDistance = 500;
    expect(s.step()).toMatchObject({ kind: "mob" });
    s.shotByPlayerAt = s.now;
    expect(s.step()).toMatchObject({ kind: "player", why: "a player is close" });
    // The lock holds until the player is clearly gone, as for a close one.
    s.shotByPlayerAt = -Infinity;
    s.playerDistance = 440; // inside playerRelease
    expect(s.step(5000)).toMatchObject({ kind: "player" });
    s.playerDistance = 460;
    expect(s.step()).toMatchObject({ kind: "mob" });
    // A shooter out of bow range is not the one that is hitting: the hit was a stray, so the mob fight goes on.
    const far = new Scene().add("m", mob("sentenced", 300, 0));
    far.playerDistance = 700;
    far.step();
    far.shotByPlayerAt = far.now;
    expect(far.step()).toMatchObject({ kind: "mob" });
    // And a hit from a while ago no longer counts.
    const old = new Scene().add("m", mob("sentenced", 300, 0));
    old.playerDistance = 500;
    old.shotByPlayerAt = old.now - MOB_HUNT.underFireMs - 1;
    expect(old.step()).toMatchObject({ kind: "mob" });
  });

  it("hp lost to the mob is not fire from a player: a player in bow range that never hit keeps the mob fight", () => {
    // The mob is awake (left its camp spot) and trades blows with the bot while another player stands 480 u away, shooting nothing.
    const s = new Scene().add("m", mob("sentenced", 40, 0));
    s.playerDistance = 480;
    s.players = [{ x: 480, y: 0 }];
    s.attacking = true;
    expect(s.step()).toMatchObject({ kind: "mob", id: "m" });
    const m = s.mobs.get("m")!;
    m.x = 90;
    for (let t = 0; t < 8; t++) {
      s.self = { ...s.self, hp: s.self.hp - 40 }; // the mob lands a blow every second...
      m.hp -= 30; // ...and takes one
      const d = s.run(1000);
      expect(d).toMatchObject({ kind: "mob", id: "m" });
    }
    expect(s.hunter.target).toBe("m");
    expect(s.hunter.stats.drops).toBe(0);
  });

  it("a mob fight does not suppress the retreat at low hp when no player shot", () => {
    const s = new Scene().add("m", mob("sentenced", 40, 0));
    s.playerDistance = 480;
    s.step();
    s.mobs.get("m")!.x = 90;
    s.mobs.get("m")!.hp -= 50;
    s.self = { ...s.self, hp: 300 }; // 30% of 1000
    expect(s.step()).toMatchObject({ kind: "retreat", why: "low hp" });
  });

  it("hunts players inside the coliseum, where no mob can be reached", () => {
    const s = new Scene().add("m", mob("sentenced", 100, 0));
    expect(s.step()).toMatchObject({ kind: "mob" });
    s.inColiseum = true;
    expect(s.step()).toMatchObject({ kind: "player", why: "coliseum" });
    expect(s.hunter.target).toBeNull();
  });
});

describe("a target that cannot be hurt", () => {
  it("is dropped, and left alone, once it walks home (its hp rises)", () => {
    const s = new Scene().add("a", mob("sentenced", 300, 0, { hp: 280, maxHp: 315 })).add("b", mob("sentenced", 600, 0));
    expect(s.step()).toMatchObject({ id: "a" });
    s.mobs.get("a")!.hp = 300;
    expect(s.step()).toMatchObject({ id: "b" });
    expect(s.hunter.isBanned("a", s.now)).toBe(true);
    expect(s.hunter.stats.drops).toBe(1);
    // ...and it is not picked again until the ban is over, even once it is whole.
    s.mobs.get("a")!.hp = 315;
    s.run(2000);
    expect(s.hunter.target).toBe("b");
  });

  it("is dropped after 3 s of attacking without a scratch, but not while it keeps losing hp", () => {
    const s = new Scene().add("a", mob("sentenced", 100, 0)).add("b", mob("sentenced", 700, 0));
    s.attacking = true;
    expect(s.step()).toMatchObject({ id: "a" });
    let hp = 300;
    // Hit every second: 20 s of fighting and it stays the target.
    let out = s.run(20_000, () => { if (s.now % 1000 === 0) s.mobs.get("a")!.hp = hp -= 3; });
    expect(out).toMatchObject({ id: "a" });
    out = s.run(2900);
    expect(out).toMatchObject({ id: "a" });
    out = s.run(300);
    expect(out).toMatchObject({ id: "b" });
    expect(s.hunter.isBanned("a", s.now)).toBe(true);
  });

  it("is dropped when the bot cannot get at it for MOB_HUNT.approachMs", () => {
    const s = new Scene().add("a", mob("sentenced", 300, 0)).add("b", mob("sentenced", 600, 0));
    s.attacking = false;
    expect(s.step()).toMatchObject({ id: "a" });
    expect(s.run(MOB_HUNT.approachMs - 500)).toMatchObject({ id: "a" });
    expect(s.run(1000)).toMatchObject({ id: "b" });
  });

  it("is dropped when the whole chase takes too long, however it is going", () => {
    const s = new Scene({ targetBudgetMs: 5000 }).add("a", mob("sentenced", 300, 0)).add("b", mob("sentenced", 600, 0));
    s.attacking = true;
    expect(s.step()).toMatchObject({ id: "a" });
    let hp = 300;
    expect(s.run(4500, () => { s.mobs.get("a")!.hp = hp -= 0.5; })).toMatchObject({ id: "a" }); // slow but steady: kept
    expect(s.run(1000, () => { s.mobs.get("a")!.hp = hp -= 0.5; })).toMatchObject({ id: "b" }); // ...until the budget runs out
  });

  it("never lets a stuck bot wait forever: every budget ends in the player hunt", () => {
    const s = new Scene({ focusBudgetMs: 2500 }).add("a", mob("sentenced", 300, 0));
    s.attacking = true;
    let out = s.run(2000);
    expect(out.kind).toBe("mob");
    out = s.run(5000);
    expect(out).toMatchObject({ kind: "player" });
    // Once the budget is spent, mobs are off for the rest of the run.
    s.mobs.get("a")!.status = "dead";
    s.add("fresh", mob("sentenced", 100, 0));
    expect(s.run(1000)).toMatchObject({ kind: "player", why: "mob time budget spent" });
  });

  it("stops farming after the kill goal", () => {
    const s = new Scene().add("m", mob("sentenced", 100, 0));
    s.self = { ...ME, mobKills: MOB_HUNT.killGoal };
    expect(s.step()).toMatchObject({ kind: "player", why: "enough mob kills" });
  });
});

describe("low hp", () => {
  /** A bot on mob "a" with another awake mob close by. */
  function fighting(): Scene {
    const s = new Scene().add("a", mob("sentenced", 200, 0)).add("chaser", mob("sentenced", 700, 700));
    s.attacking = true;
    expect(s.step()).toMatchObject({ id: "a" });
    return s;
  }

  it("runs from the awake mobs and the players at 35% hp, for at least a moment, and stays off mobs afterwards", () => {
    const s = fighting();
    s.mobs.get("a")!.x = 150; // moved off its spot: awake
    s.players = [{ x: -400, y: 0 }];
    s.self = { ...s.self, hp: 300 };
    const out = s.step();
    expect(out).toMatchObject({ kind: "retreat" });
    if (out.kind === "retreat") expect(out.from).toEqual([{ x: 150, y: 0 }, { x: -400, y: 0 }]);
    expect(s.hunter.stats.retreats).toBe(1);
    // The mob lets go (far away now): the retreat still lasts retreatMinMs...
    s.mobs.get("a")!.x = 2000;
    expect(s.step(100)).toMatchObject({ kind: "retreat" });
    // ...and then it is over, and the mobs are off limits for a good while.
    expect(s.step(MOB_HUNT.retreatMinMs)).toMatchObject({ kind: "player", why: "staying off mobs" });
    s.add("fresh", mob("sentenced", 100, 0));
    expect(s.run(10_000)).toMatchObject({ kind: "player" });
    expect(s.hunter.stats.retreats).toBe(1);
  });

  it("gives up a retreat after retreatMaxMs even with the mob still on its heels", () => {
    const s = fighting();
    s.mobs.get("a")!.x = 150;
    s.self = { ...s.self, hp: 300 };
    expect(s.step()).toMatchObject({ kind: "retreat" });
    expect(s.run(MOB_HUNT.retreatMaxMs - 500)).toMatchObject({ kind: "retreat" });
    expect(s.run(1000)).toMatchObject({ kind: "player" });
  });

  it("just leaves a sleeping mob alone at 35% hp", () => {
    const s = fighting(); // "a" still sits on its spot
    s.self = { ...s.self, hp: 300 };
    expect(s.step()).toMatchObject({ kind: "player", why: "staying off mobs" });
    expect(s.hunter.stats.retreats).toBe(0);
  });

  it("does not run when it was not on a mob", () => {
    const s = new Scene().add("a", mob("sentenced", 150, 0));
    s.self = { ...ME, hp: 300 };
    s.step(); // hp < startMinHp: no target
    s.mobs.get("a")!.hp = 100; // hurt: awake, near
    expect(s.step()).toMatchObject({ kind: "player" });
    expect(s.hunter.stats.retreats).toBe(0);
  });
});

describe("retreatPoint", () => {
  const open = () => true;

  it("heads away from the threats", () => {
    const p = retreatPoint({ x: 0, y: 0 }, [{ x: 100, y: 0 }], open)!;
    expect(p.x).toBeLessThan(0);
    const q = retreatPoint({ x: 0, y: 0 }, [{ x: 0, y: -100 }, { x: 100, y: 0 }], open)!;
    expect(q.x).toBeLessThan(10);
    expect(q.y).toBeGreaterThan(-10);
  });

  it("only picks a point it can walk to, and says so when there is none", () => {
    const wall = (_a: Vec2, b: Vec2) => b.x > 0; // everything to the west is blocked
    const p = retreatPoint({ x: 0, y: 0 }, [{ x: -100, y: 0 }], wall)!;
    expect(p.x).toBeGreaterThan(0);
    expect(retreatPoint({ x: 0, y: 0 }, [{ x: 100, y: 0 }], () => false)).toBeNull();
  });
});

describe("pieces", () => {
  it("bestEdge uses the best carried weapon that works on the mob", () => {
    expect(bestEdge(["sword", "axe"], "wand")).toBe(1); // sword beats wand
    expect(bestEdge(["axe", null], "bow")).toBe(-1);
    expect(bestEdge(["axe", null], "axe")).toBe(0);
    expect(bestEdge(["bow", "axe"], "shield")).toBe(1); // the bow is reflected, the axe pierces
    expect(bestEdge(["shield", null], "shield")).toBe(-2); // two raised shields only block each other
    expect(bestEdge(["sword", "shield"], "shield")).toBe(-2);
    // Carrying nothing is fighting on fists: neutral against everything, and never useless (they pierce a shield).
    expect(bestEdge([null, null], "axe")).toBe(0);
    expect(bestEdge([null, null], "shield")).toBe(0);
    expect(bestEdge([null, null], "wand")).toBe(0);
  });

  it("useless: guards that stop a weapon, and shields that stop the mob", () => {
    expect(useless("sword", "shield")).toBe(true);
    expect(useless("bow", "shield")).toBe(true);
    expect(useless("axe", "shield")).toBe(false);
    expect(useless("wand", "shield")).toBe(false);
    expect(useless("shield", "sword")).toBe(true);
    expect(useless("shield", "bow")).toBe(true);
    expect(useless("shield", "axe")).toBe(false);
    expect(useless("bow", "wand")).toBe(true);
    expect(useless("wand", "axe")).toBe(true);
    expect(useless("axe", "wand")).toBe(false);
    expect(useless("sword", "sword")).toBe(false);
  });

  it("bestSlotVsMob holds the weapon that works, then the better edge, and keeps the current one on a tie", () => {
    expect(bestSlotVsMob(["shield", "axe"], 0, "sword")).toBe(1); // the shield would make the mob give up
    expect(bestSlotVsMob(["sword", "axe"], 0, "sword")).toBe(0); // a mirror (0) beats the axe (-1): stay
    expect(bestSlotVsMob(["axe", "sword"], 0, "axe")).toBe(1); // sword beats axe
    expect(bestSlotVsMob(["sword", "bow"], 1, "axe")).toBe(1); // both beat it: stay
    expect(bestSlotVsMob(["bow", null], 0, "shield")).toBe(0); // nothing better
    expect(bestSlotVsMob([null, "axe"], 0, null)).toBe(1); // an empty slot never
  });

  it("mobWeapon reads the mob's weapon and falls back on its region's", () => {
    expect(mobWeapon({ weapon0: "bow", faction: "fire" })).toBe("bow");
    expect(mobWeapon({ weapon0: "", faction: "fire" })).toBe("axe");
    expect(mobWeapon({ weapon0: "", faction: "" })).toBeNull();
  });

  it("matchupShare follows the duel table: everyone beats a normal mob of their own region, Fire keeps little against Holy", () => {
    for (const f of Object.keys(FACTIONS) as FactionId[]) expect(matchupShare(f, f, false)).toBeGreaterThan(0.5);
    expect(matchupShare("fire", "holy", true)).toBe(0); // a loss
    expect(matchupShare("holy", "fire", false)).toBeGreaterThan(0.9);
  });

  it("pathLength adds up the legs", () => {
    expect(pathLength({ x: 0, y: 0 }, [{ x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11);
    expect(pathLength({ x: 0, y: 0 }, [])).toBe(0);
  });
});
