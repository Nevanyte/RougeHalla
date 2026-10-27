// Tactics (docs/BOTS.md 4, 2.6, 2.8; the intent of test/botLock.test.ts ported to the brain): one lock click, re-sent only while
// the server has not taken it; the approach; swaps; the orb-walk cycle; dodges and jukes; flee; the bounty and sudden-death
// rules; and the dispatch of the world goals. Everything runs on plain-data contexts from fixtures.ts, seeded, with no clock.
import { describe, expect, it } from "vitest";
import {
  attackInterval, FACTIONS, hasLineOfSight, lockSpacing, mapFromTiles, mulberry32, pacedFaction, TARGET_RANGE, TILE,
  type GameMap, type Rng, type Vec2, type WeaponId,
} from "@raid/shared";
import { createTactics, channelOf } from "../../src/bots/brain/tactics";
import { angleGap, ownTimings } from "../../src/bots/brain/tactics/kite";
import type { WorldGoal, WorldTactics } from "../../src/bots/brain/tactics/world";
import {
  PRIORITY, TIERS,
  type BrainContext, type BrainRngs, type FighterMemory, type FighterView, type Goal, type HudView, type Intent, type Knowledge,
  type MobMemory, type MobView, type ObservedEvent, type PersonaId, type ProjectileView, type SelfView, type Stimulus, type TacticsOutput,
  type TierId,
} from "../../src/bots/brain/types";
import { brainConfig, ctx, emptyMemory, fighter, fullKnowledge, hudView, mobView, percept, rngs, selfView, services } from "./fixtures";

// ------------------------------------------------------------------------------------------------------------------ helpers

const NOW = 100_000;
const ME: Vec2 = { x: 1000, y: 760 };

/** An open walled box (tiles), plus the extra wall rectangles given as [x0, y0, x1, y1] tile ranges (inclusive). */
function arena(w = 64, h = 48, walls: ReadonlyArray<readonly [number, number, number, number]> = []): GameMap {
  const tiles = new Uint8Array(w * h);
  for (let i = 0; i < w; i++) { tiles[i] = 1; tiles[(h - 1) * w + i] = 1; }
  for (let j = 0; j < h; j++) { tiles[j * w] = 1; tiles[j * w + w - 1] = 1; }
  for (const [x0, y0, x1, y1] of walls) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles[y * w + x] = 1;
  return mapFromTiles(w, h, tiles);
}

const OPEN = arena();

/** A rng whose `decide` stream replays these numbers, then 0.5 for ever (0.5 reads as "a coin that lands neither way"). */
function scripted(...vals: number[]): BrainRngs {
  let i = 0;
  const decide: Rng = () => (i < vals.length ? vals[i++]! : 0.5);
  return { decide, motor: mulberry32(2), lapse: mulberry32(3) };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const at = (dx: number, dy: number): Vec2 => ({ x: ME.x + dx, y: ME.y + dy });

interface Scene {
  map?: GameMap;
  tier?: TierId;
  persona?: PersonaId;
  now?: number;
  self?: Partial<SelfView>;
  foes?: FighterView[];
  mobs?: MobView[];
  projectiles?: ProjectileView[];
  events?: ObservedEvent[];
  hud?: Partial<HudView>;
  stimuli?: Stimulus[];
  memFighters?: FighterMemory[];
  memMobs?: MobMemory[];
  whereabouts?: (id: string) => { at: Vec2; radius: number } | null;
  /** Ms the bot has been standing still. */
  still?: number;
  rng?: BrainRngs;
  know?: Knowledge;
  engaged?: boolean;
}

function makeCtx(s: Scene = {}): BrainContext {
  const map = s.map ?? OPEN;
  const cfg = brainConfig(s.tier ?? "hard", s.persona ?? "cautious", { map, services: services(map) });
  const now = s.now ?? NOW;
  const base = emptyMemory();
  const mem = emptyMemory({
    self: { ...base.self, stillSince: now - (s.still ?? 0) },
    fighters: new Map((s.memFighters ?? []).map((f) => [f.id, f])),
    mobs: new Map((s.memMobs ?? []).map((m) => [m.id, m])),
    stimuli: s.stimuli ?? [],
    whereabouts: s.whereabouts ? (id) => s.whereabouts!(id) : () => null,
  });
  const p = percept({
    now,
    self: selfView({ id: "me", x: ME.x, y: ME.y, faction: "fire", weapons: ["axe", null], ...s.self }),
    hud: hudView(s.hud),
    fighters: s.foes ?? [],
    mobs: s.mobs ?? [],
    projectiles: s.projectiles ?? [],
    events: s.events ?? [],
  });
  return ctx({ cfg, p, mem, rng: s.rng ?? rngs(1), know: s.know ?? fullKnowledge(), engaged: s.engaged ?? false });
}

/** A world-tactics fake that answers nothing and records what it was asked. */
function fakeWorld(out?: Partial<TacticsOutput>): WorldTactics & { calls: Array<{ goal: WorldGoal; ctx: BrainContext }>; answer: TacticsOutput } {
  const calls: Array<{ goal: WorldGoal; ctx: BrainContext }> = [];
  const answer: TacticsOutput = { intents: [], status: { state: "running", why: "fake" }, attacking: false, ...out };
  return { calls, answer, act: (c, goal) => { calls.push({ goal, ctx: c }); return answer; } };
}

function think(t: ReturnType<typeof createTactics>, goal: Goal, s: Scene = {}): TacticsOutput {
  return t.act(makeCtx(s), goal);
}

/** An enemy `dx, dy` from the bot, with the line of sight the map gives it. */
function foe(dx: number, dy: number, over: Partial<FighterView> = {}, map: GameMap = OPEN): FighterView {
  const p = at(dx, dy);
  return fighter({ id: "foe", x: p.x, y: p.y, dist: Math.hypot(dx, dy), los: hasLineOfSight(map, ME, p), inHand: "sword", faction: "frost", ...over });
}

function mob(dx: number, dy: number, over: Partial<MobView> = {}, map: GameMap = OPEN): MobView {
  const p = at(dx, dy);
  return mobView({ id: "mob1", x: p.x, y: p.y, dist: Math.hypot(dx, dy), los: hasLineOfSight(map, ME, p), inHand: "axe", faction: "fire", ...over });
}

function memFighter(over: Partial<FighterMemory> = {}): FighterMemory {
  return {
    id: "foe", name: "Foe", bot: false, faction: "frost", weaponsSeen: [], inHand: "sword", otherSlot: null, seenAt: NOW - 1000, pos: at(300, 0),
    vel: { x: 0, y: 0 }, hpFrac: 1, bounty: 0, alive: true, diedAt: null, hitMeAt: null, hitByMeAt: null, damageToMe: 0, damageByMe: 0,
    engagedWith: null, engagedAt: null, chasingMe: false, wishSeenAt: null, wishReadyGuess: null, feints: 0, lastFeintAt: null, ...over,
  };
}

function ball(over: Partial<ProjectileView> = {}): ProjectileView {
  return {
    id: "ball1", kind: "ball", x: ME.x + 220, y: ME.y, vx: -380, vy: 0, x0: ME.x + 220, y0: ME.y, t0: NOW - 130, range: 220, from: "foe", ...over,
  };
}

const hunt: Goal = { kind: "hunt", target: "foe" };
const fightGoal: Goal = { kind: "fight", target: "foe" };
const farm: Goal = { kind: "farm", mob: "mob1", camp: null };
const FORBIDDEN = ["aim", "attack", "release"];
const kinds = (o: TacticsOutput) => o.intents.map((i) => i.kind);
const only = (o: TacticsOutput, kind: Intent["kind"]): Intent => {
  const found = o.intents.filter((i) => i.kind === kind);
  expect(found, `${kind} intents in ${JSON.stringify(kinds(o))}`).toHaveLength(1);
  return found[0]!;
};
const moveTo = (i: Intent): Vec2 => {
  if (i.kind !== "move") throw new Error(`not a move: ${i.kind}`);
  return i.to;
};

// ------------------------------------------------------------------------------------------------- approach and lock

describe("approach and lock", () => {
  it("clicks a foe in reach ONCE, on its drawn position, and nothing else", () => {
    const t = createTactics(fakeWorld());
    const out = think(t, hunt, { foes: [foe(300, 0)] });
    expect(out.intents).toHaveLength(1);
    expect(out.intents[0]).toMatchObject({ kind: "lock", target: "foe", at: at(300, 0), priority: PRIORITY.combat });
    expect(out.status.state).toBe("running");
    expect(out.attacking).toBe(false);
  });

  it("asks again only while the server has not taken the lock, and says nothing for the rest of the fight", () => {
    const t = createTactics(fakeWorld());
    for (let i = 0; i < 5; i++) {
      const out = think(t, hunt, { now: NOW + i * 100, foes: [foe(300, 0)] });
      expect(kinds(out), "not locked yet: still one lock").toEqual(["lock"]);
    }
    for (let i = 0; i < 40; i++) {
      const out = think(t, hunt, { now: NOW + 600 + i * 50, self: { attackTarget: "foe" }, foes: [foe(300, 0)] });
      expect(out.intents, "locked: the server chases, attacks and aims").toEqual([]);
    }
  });

  it("re-locks when the server shows another fighter locked (a wrong pick)", () => {
    const t = createTactics(fakeWorld());
    const out = think(t, hunt, { self: { attackTarget: "other" }, foes: [foe(300, 0)] });
    expect(only(out, "lock")).toMatchObject({ target: "foe" });
  });

  it("walks to a foe beyond the server's reach, locks it from TARGET_RANGE - 40 on", () => {
    const t = createTactics(fakeWorld());
    const far = think(t, hunt, { foes: [foe(TARGET_RANGE + 100, 0)] });
    expect(far.intents).toHaveLength(1);
    expect(far.intents[0]).toMatchObject({ kind: "move", to: at(TARGET_RANGE + 100, 0), priority: PRIORITY.goal });
    const edge = createTactics(fakeWorld());
    expect(kinds(think(edge, hunt, { foes: [foe(TARGET_RANGE - 40 + 1, 0)] }))).toEqual(["move"]);
    const inside = createTactics(fakeWorld());
    expect(kinds(think(inside, hunt, { foes: [foe(TARGET_RANGE - 40, 0)] }))).toEqual(["lock"]);
  });

  it("does not repeat a walk order that is already on its way, but sends it again when the bot stands still", () => {
    const t = createTactics(fakeWorld());
    const f = foe(800, 0);
    expect(kinds(think(t, hunt, { foes: [f] }))).toEqual(["move"]);
    expect(think(t, hunt, { now: NOW + 100, foes: [f], still: 0 }).intents, "walking").toEqual([]);
    expect(think(t, hunt, { now: NOW + 1000, foes: [f], still: 0 }).intents, "still walking").toEqual([]);
    expect(kinds(think(t, hunt, { now: NOW + 1000, foes: [f], still: 900 })), "standing: the order was lost").toEqual(["move"]);
    expect(kinds(think(t, hunt, { now: NOW + 3000, foes: [f], still: 0 })), "an old order is refreshed").toEqual(["move"]);
    const moved = foe(900, 0);
    expect(kinds(think(t, hunt, { now: NOW + 3100, foes: [moved] })), "the foe went 100 u").toEqual(["move"]);
  });

  it("walks round a wall by the path's waypoints when it cannot see the foe", () => {
    const map = arena(64, 48, [[40, 3, 40, 44]]);
    const t = createTactics(fakeWorld());
    const f = foe(700, 0, {}, map);
    expect(f.los).toBe(false);
    const out = think(t, hunt, { map, foes: [f] });
    const to = moveTo(only(out, "move"));
    expect(dist(to, at(700, 0)), "a waypoint, not the foe's position").toBeGreaterThan(100);
    expect(services(map).paths.clear(ME, to), "a walk it can make in one click").toBe(true);
  });

  it("locks a foe behind a wall once in reach: the server walks round to it", () => {
    const map = arena(64, 48, [[33, 3, 33, 44]]);
    const t = createTactics(fakeWorld());
    const f = foe(250, 0, {}, map);
    expect(f.los).toBe(false);
    const out = think(t, hunt, { map, foes: [f] });
    expect(kinds(out)).toEqual(["lock"]);
    expect(out.attacking).toBe(false);
  });

  it("fails when the foe cannot be reached: no path, three plans in a row", () => {
    const map = arena(64, 48, [[49, 19, 53, 19], [49, 23, 53, 23], [49, 19, 49, 23], [53, 19, 53, 23]]);
    const t = createTactics(fakeWorld());
    const f = foe(648, -72, {}, map);
    expect(f.los).toBe(false);
    const states = [0, 450, 900, 1350].map((dt) => think(t, hunt, { map, now: NOW + dt, foes: [f] }).status.state);
    expect(states.slice(0, 2)).toEqual(["running", "running"]);
    expect(states).toContain("failed");
  });

  it("fails after 10 s without getting nearer or landing anything, and restarts the clock on progress", () => {
    const t = createTactics(fakeWorld());
    /** Thinks every 500 ms from `from` to `to` (ms after NOW) with the foe `dx` away; the states seen, in order. */
    const watch = (from: number, to: number, dx: number): string[] => {
      const seen: string[] = [];
      for (let ms = from; ms <= to; ms += 500) seen.push(think(t, hunt, { now: NOW + ms, foes: [foe(dx, 0)] }).status.state);
      return seen;
    };
    expect(watch(0, 9500, 900).every((s) => s === "running"), "9.5 s with nothing to show is still within the limit").toBe(true);
    expect(watch(10_000, 10_500, 900), "past 10 s").toContain("failed");
    expect(watch(11_000, 20_500, 800).every((s) => s === "running"), "a fresh watch from the foe 100 u nearer").toBe(true);
    expect(watch(21_000, 22_500, 800), "and 10 s later with no more progress").toContain("failed");
  });

  it("is done when the target is dead or gone, failed when it is lost", () => {
    const t = createTactics(fakeWorld());
    expect(think(t, hunt, { foes: [foe(300, 0, { status: "dead" })] }).status.state).toBe("done");
    expect(think(t, hunt, { foes: [] }).status.state, "never seen, not remembered: gone").toBe("done");
    const dead = think(t, hunt, { memFighters: [memFighter({ alive: false })] });
    expect(dead.status.state, "remembered dead").toBe("done");
    expect(think(t, farm, { mobs: [mob(200, 0, { status: "dead" })] }).status.state).toBe("done");
  });

  it("sends its walk again after another goal had the order channel", () => {
    const t = createTactics(fakeWorld());
    const f = foe(800, 0);
    expect(kinds(think(t, hunt, { foes: [f] }))).toEqual(["move"]);
    expect(think(t, hunt, { now: NOW + 100, foes: [f] }).intents).toEqual([]);
    think(t, { kind: "idle" }, { now: NOW + 200 });
    expect(kinds(think(t, hunt, { now: NOW + 300, foes: [f] })), "the idle goal's stop replaced the walk").toEqual(["move"]);
  });

  it("walks to where an off-screen foe was last seen, and fails once the memory has lapsed", () => {
    const t = createTactics(fakeWorld());
    const last = at(900, 0);
    const out = think(t, hunt, { memFighters: [memFighter({ pos: last })], whereabouts: () => ({ at: last, radius: 80 }) });
    expect(out.intents[0]).toMatchObject({ kind: "move", to: last });
    expect(think(t, hunt, { memFighters: [memFighter()], whereabouts: () => null }).status.state).toBe("failed");
  });

  it("farms a mob like a player, counts each mob once, and finds none in the coliseum or behind locked gates", () => {
    const t = createTactics(fakeWorld());
    const out = think(t, farm, { mobs: [mob(200, 0)] });
    expect(out.intents[0]).toMatchObject({ kind: "lock", target: "mob1" });
    think(t, farm, { now: NOW + 100, mobs: [mob(200, 0)] });
    expect(t.stats().mobTargets).toBe(1);
    think(t, { kind: "farm", mob: "mob2", camp: null }, { now: NOW + 200, mobs: [mob(300, 0, { id: "mob2" })] });
    expect(t.stats().mobTargets).toBe(2);
    expect(think(t, farm, { mobs: [mob(200, 0)], hud: { inColiseum: true } }).status.state).toBe("failed");
    expect(think(t, farm, { mobs: [mob(200, 0)], hud: { gatesLocked: true } }).status.state).toBe("failed");
  });

  it("is attacking only while locked, in the weapon's reach and in sight", () => {
    const t = createTactics(fakeWorld());
    const bow: Partial<SelfView> = { weapons: ["bow", null], attackTarget: "foe" };
    const reach = lockSpacing("bow").attackRange + 24;
    expect(think(t, hunt, { self: bow, foes: [foe(reach - 5, 0)] }).attacking).toBe(true);
    expect(think(t, hunt, { self: bow, foes: [foe(reach + 5, 0)] }).attacking, "past the weapon's range").toBe(false);
    expect(think(t, hunt, { self: { weapons: ["bow", null] }, foes: [foe(100, 0)] }).attacking, "not locked").toBe(false);
    const walled = arena(64, 48, [[32, 3, 32, 44]]);
    const blind = foe(100, 0, { los: false });
    expect(think(t, hunt, { map: walled, self: bow, foes: [blind] }).attacking, "no line of sight").toBe(false);
  });

  it("never emits aim, attack or release, nor two intents on one channel, over a long scripted scramble", () => {
    const t = createTactics(fakeWorld());
    const rnd = mulberry32(99);
    const weapons: WeaponId[] = ["sword", "bow", "wand", "shield", "axe"];
    const goals: Goal[] = [
      hunt, fightGoal, farm, { kind: "flee", from: [at(100, 0)], until: NOW + 100_000 }, { kind: "idle" },
      { kind: "roam", to: at(500, 0), why: "explore" }, { kind: "module", module: "x", data: {} },
    ];
    let now = NOW;
    for (let i = 0; i < 600; i++) {
      now += 50 + Math.floor(rnd() * 350);
      const foes = rnd() < 0.8 ? [foe(Math.round((rnd() - 0.5) * 1400), Math.round((rnd() - 0.5) * 900), {
        inHand: weapons[Math.floor(rnd() * 5)]!, vx: (rnd() - 0.5) * 340, vy: 0, drawStartedAt: rnd() < 0.2 ? now - 200 : 0, facing: rnd() * 6.28 - 3.14,
      })] : [];
      const projectiles = rnd() < 0.3 ? [ball({ id: `b${i}`, vy: (rnd() - 0.5) * 100 })] : [];
      const out = think(t, goals[Math.floor(rnd() * goals.length)]!, {
        now, foes, projectiles, tier: (["easy", "normal", "hard"] as const)[i % 3], rng: rngs(i),
        self: {
          weapons: [weapons[Math.floor(rnd() * 5)]!, rnd() < 0.5 ? weapons[Math.floor(rnd() * 5)]! : null], slot: rnd() < 0.5 ? 0 : 1,
          attackTarget: rnd() < 0.4 ? "foe" : null, readyAt: now + Math.floor(rnd() * 1500) - 700, hp: 20 + Math.floor(rnd() * 80),
        },
      });
      const channels = out.intents.map(channelOf);
      expect(new Set(channels).size, `two intents on one channel at step ${i}`).toBe(channels.length);
      for (const intent of out.intents) expect(FORBIDDEN).not.toContain(intent.kind);
    }
  });
});

// ------------------------------------------------------------------------------------------------------------ camp mates

describe("a camp fights as one: the lock on a mate is kept", () => {
  const memMob = (id: string, over: Partial<MobMemory> = {}): MobMemory => ({
    id, kind: "mob", faction: "fire", home: at(0, 0), campId: null, pos: at(100, 0), dotAt: NOW, seenAt: NOW, hpFrac: 1, inHand: "axe",
    awake: true, returning: false, alive: true, ...over,
  });
  const goal = mob(70, 0, { id: "mob1" });
  const mate = (over: Partial<MobView> = {}) => mob(60, 30, { id: "mob2", ...over });
  const locked = (id: string): Partial<SelfView> => ({ attackTarget: id });

  it("sends no click while the lock is on a mate in reach, and counts as attacking", () => {
    const t = createTactics(fakeWorld());
    for (let i = 0; i < 20; i++) {
      const out = think(t, farm, { now: NOW + i * 100, self: locked("mob2"), mobs: [goal, mate()] });
      expect(out.intents, "the server is swinging at a mate: a click would only cancel its windup").toEqual([]);
      expect(out.attacking).toBe(true);
      expect(out.status.state).toBe("running");
    }
  });

  it("clicks the goal's mob when the lock is empty, and when it is on a player", () => {
    const t = createTactics(fakeWorld());
    const out = think(t, farm, { mobs: [goal, mate()] });
    expect(only(out, "lock")).toMatchObject({ target: "mob1" });
    expect(out.attacking).toBe(false);
    const onPlayer = think(createTactics(fakeWorld()), farm, { self: locked("foe"), mobs: [goal, mate()], foes: [foe(300, 0)] });
    expect(only(onPlayer, "lock")).toMatchObject({ target: "mob1" });
  });

  it("clicks again when the mate it was locked on is dead", () => {
    const t = createTactics(fakeWorld());
    const out = think(t, farm, { self: locked("mob2"), mobs: [goal, mate({ status: "dead" })] });
    expect(only(out, "lock")).toMatchObject({ target: "mob1" });
    expect(out.attacking).toBe(false);
    const gone = think(createTactics(fakeWorld()), farm, { self: locked("mob2"), mobs: [goal] });
    expect(only(gone, "lock"), "off the screen too").toMatchObject({ target: "mob1" });
  });

  it("keeps the lock on a mob of the same camp however far apart they stand, but re-clicks one of another camp", () => {
    const far = mob(60, 300, { id: "mob2" });
    const one = memMob("mob1", { campId: "c1" });
    const same = think(createTactics(fakeWorld()), farm, { self: locked("mob2"), mobs: [goal, far], memMobs: [one, memMob("mob2", { campId: "c1" })] });
    expect(same.intents).toEqual([]);
    const other = think(createTactics(fakeWorld()), farm, { self: locked("mob2"), mobs: [goal, far], memMobs: [one, memMob("mob2", { campId: "c2" })] });
    expect(only(other, "lock")).toMatchObject({ target: "mob1" });
    const unknown = think(createTactics(fakeWorld()), farm, { self: locked("mob2"), mobs: [goal, far] });
    expect(only(unknown, "lock"), "no camp known and not bunched").toMatchObject({ target: "mob1" });
  });

  it("does not keep a lock on a mate it cannot hurt, one walking home, a shooter, or an elite the goal is not", () => {
    const sword: Partial<SelfView> = { weapons: ["sword", null], attackTarget: "mob2" };
    const shield = think(createTactics(fakeWorld()), farm, { self: sword, mobs: [goal, mate({ inHand: "shield", faction: "frost" })] });
    expect(only(shield, "lock"), "a sword does nothing against a shield").toMatchObject({ target: "mob1" });
    const home = think(createTactics(fakeWorld()), farm, { self: locked("mob2"), mobs: [goal, mate()], memMobs: [memMob("mob2", { returning: true })] });
    expect(only(home, "lock"), "untouchable: it walks home").toMatchObject({ target: "mob1" });
    const shooter = think(createTactics(fakeWorld()), farm, { self: locked("mob2"), mobs: [goal, mate({ inHand: "bow" })] });
    expect(only(shooter, "lock"), "mobHunt leaves shooters alone: they back off to their leash").toMatchObject({ target: "mob1" });
    const elite = think(createTactics(fakeWorld()), farm, { self: locked("mob2"), mobs: [goal, mate({ kind: "elite" })] });
    expect(only(elite, "lock"), "the hunt did not choose the elite").toMatchObject({ target: "mob1" });
    const bothElite = think(createTactics(fakeWorld()), farm, { self: locked("mob2"), mobs: [mob(70, 0, { id: "mob1", kind: "elite" }), mate({ kind: "elite" })] });
    expect(bothElite.intents).toEqual([]);
  });

  it("only mobs: a player's lock on another player is still corrected, and a mate is no excuse for a player", () => {
    const hunting = think(createTactics(fakeWorld()), hunt, { self: locked("mob2"), foes: [foe(300, 0)], mobs: [mate()] });
    expect(only(hunting, "lock")).toMatchObject({ target: "foe" });
  });
});

// ------------------------------------------------------------------------------------------------------------------ swaps

describe("swaps", () => {
  const swapScene = (over: Partial<Scene> = {}): Scene => ({
    self: { weapons: ["sword", "wand"], slot: 0 }, foes: [foe(300, 0, { inHand: "bow" })], ...over,
  });

  it("holds the slot with the better weapon edge against the foe's weapon in hand", () => {
    const t = createTactics(fakeWorld());
    const out = think(t, hunt, swapScene());
    expect(only(out, "swap")).toMatchObject({ slot: 1, priority: PRIORITY.combat });
    expect(kinds(out).sort(), "the lock goes out beside it, on its own channel").toEqual(["lock", "swap"]);
    const keep = createTactics(fakeWorld());
    expect(kinds(think(keep, hunt, { self: { weapons: ["wand", "sword"], slot: 0 }, foes: [foe(300, 0, { inHand: "bow" })] }))).toEqual(["lock"]);
  });

  it("swaps while locked too, and against a mob by what works on it", () => {
    const t = createTactics(fakeWorld());
    const out = think(t, hunt, swapScene({ self: { weapons: ["sword", "wand"], slot: 0, attackTarget: "foe" } }));
    expect(kinds(out)).toEqual(["swap"]);
    const m = createTactics(fakeWorld());
    const vsMob = think(m, farm, { self: { weapons: ["sword", "wand"], slot: 0 }, mobs: [mob(200, 0, { inHand: "shield" })] });
    expect(only(vsMob, "swap")).toMatchObject({ slot: 1 });
  });

  it("never swaps mid-draw or inside its own windup", () => {
    const t = createTactics(fakeWorld());
    expect(kinds(think(t, hunt, swapScene({ self: { weapons: ["sword", "wand"], slot: 0, drawStartedAt: NOW - 100 } })))).not.toContain("swap");
    const wand = ownTimings(selfView({ faction: "fire" }), "wand")!;
    const started = NOW - 50;
    const mid = think(t, hunt, {
      self: { weapons: ["wand", "sword"], slot: 0, readyAt: started + wand.intervalMs },
      foes: [foe(200, 0, { inHand: "axe" })],
    });
    expect(kinds(mid), "the wand is still winding up: a swap would cancel the shot").not.toContain("swap");
    const done = think(t, hunt, {
      now: started + wand.windupMs + 20, self: { weapons: ["wand", "sword"], slot: 0, readyAt: started + wand.intervalMs },
      foes: [foe(200, 0, { inHand: "axe" })],
    });
    expect(only(done, "swap")).toMatchObject({ slot: 1 });
  });

  it("waits until the foe's weapon has been seen, and for a foe within 600 u", () => {
    const t = createTactics(fakeWorld());
    expect(kinds(think(t, hunt, swapScene({ foes: [foe(300, 0, { inHand: null })] })))).not.toContain("swap");
    expect(kinds(think(t, hunt, swapScene({ foes: [foe(700, 0, { inHand: "bow" })] })))).not.toContain("swap");
    expect(kinds(think(t, hunt, swapScene({ foes: [foe(600, 0, { inHand: "bow" })] })))).toContain("swap");
  });

  it("swaps again no sooner than 2 s and no later than 4 s after the last", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const t = createTactics(fakeWorld());
      const rng = rngs(seed);
      const first = think(t, hunt, swapScene({ rng, now: NOW }));
      expect(kinds(first)).toContain("swap");
      let again = -1;
      for (let dt = 50; dt <= 4500; dt += 50) {
        if (kinds(think(t, hunt, swapScene({ rng, now: NOW + dt, self: { weapons: ["sword", "wand"], slot: 0, attackTarget: "foe" } }))).includes("swap")) { again = dt; break; }
      }
      expect(again, `seed ${seed}`).toBeGreaterThanOrEqual(2000);
      expect(again, `seed ${seed}`).toBeLessThanOrEqual(4000);
    }
  });

  it("does not swap on an edge the bot does not know", () => {
    const ignorant: Knowledge = { ...fullKnowledge(), weaponEdge: () => 0 };
    const t = createTactics(fakeWorld());
    expect(kinds(think(t, hunt, swapScene({ know: ignorant })))).toEqual(["lock"]);
  });
});

// ---------------------------------------------------------------------------------------------------------- the orb-walk

describe("the orb-walk", () => {
  // Frost shoots slowly (bow 1140 ms with a 600 ms draw, wand 1347 with 400): a long free stretch after each shot to walk in.
  const chaser = (over: Partial<FighterView> = {}) => foe(150, 0, { inHand: "sword", vx: -170, vy: 0, ...over });
  /** knowledge draw, then the engagement's kite dice (low = on), then the first cycle's heading noise (0.5 = none). */
  const kiter = (dice = 0.1): BrainRngs => scripted(0.5, dice, 0.5);
  const mine = (weapon: WeaponId, attackTarget: string | null, readyAt: number, over: Partial<SelfView> = {}): Partial<SelfView> => ({
    weapons: [weapon, null], faction: "frost", attackTarget, readyAt, ...over,
  });

  function shotTimes(weapon: WeaponId, startedAt: number, faction: SelfView["faction"] = "frost") {
    const t = ownTimings(selfView({ faction }), weapon)!;
    return { ...t, startedAt, readyAt: startedAt + t.intervalMs, leftAt: startedAt + t.windupMs + 20 };
  }

  it("walks away after each bow shot has LEFT, re-locks timed to the cooldown, and does it again", () => {
    const t = createTactics(fakeWorld());
    const rng = kiter();
    const bow = shotTimes("bow", NOW + 100);
    const base = { rng, foes: [chaser()] };
    expect(think(t, hunt, { ...base, self: mine("bow", "foe", NOW - 500) }).intents).toEqual([]);

    const drawing = think(t, hunt, { ...base, now: bow.startedAt + 200, self: mine("bow", "foe", bow.readyAt, { drawStartedAt: bow.startedAt }) });
    expect(drawing.intents, "a move now would cancel the shot").toEqual([]);

    const step = think(t, hunt, { ...base, now: bow.leftAt, self: mine("bow", "foe", bow.readyAt) });
    const move = only(step, "move");
    expect(move).toMatchObject({ priority: PRIORITY.combat, timing: { kind: "step" } });
    const to = moveTo(move);
    expect(to.x).toBeCloseTo(ME.x - TIERS.hard.orbwalk.stepU, 3);
    expect(to.y).toBeCloseTo(ME.y, 3);
    expect(t.stats().kiteCycles).toBe(1);

    const waiting = think(t, hunt, { ...base, now: bow.leftAt + 30, self: mine("bow", "foe", bow.readyAt) });
    expect(waiting.intents, "the walk has not taken yet: the lock is still on").toEqual([]);

    const relock = think(t, hunt, { ...base, now: bow.leftAt + 60, self: mine("bow", null, bow.readyAt) });
    expect(only(relock, "lock")).toMatchObject({ target: "foe", timing: { kind: "timed", due: bow.readyAt - 100 } });
    const late = think(t, hunt, { ...base, now: bow.readyAt + 50, self: mine("bow", null, bow.readyAt) });
    expect(only(late, "lock"), "overdue: as soon as it can").toMatchObject({ timing: { kind: "timed", due: bow.readyAt + 50 } });

    const back = think(t, hunt, { ...base, now: bow.readyAt + 100, self: mine("bow", "foe", bow.readyAt) });
    expect(back.intents).toEqual([]);

    const next = shotTimes("bow", bow.readyAt);
    think(t, hunt, { ...base, now: next.leftAt, self: mine("bow", "foe", next.readyAt) });
    expect(t.stats().kiteCycles).toBe(2);
  });

  it("gives up on a walk the server never took, and kites the next shot", () => {
    const t = createTactics(fakeWorld());
    const rng = kiter();
    const bow = shotTimes("bow", NOW + 100);
    const base = { rng, foes: [chaser()] };
    think(t, hunt, { ...base, self: mine("bow", "foe", NOW - 500) });
    expect(kinds(think(t, hunt, { ...base, now: bow.leftAt, self: mine("bow", "foe", bow.readyAt) }))).toEqual(["move"]);
    expect(think(t, hunt, { ...base, now: bow.leftAt + 500, self: mine("bow", "foe", bow.readyAt) }).intents, "still waiting").toEqual([]);
    // 900 ms on, the lock is still on: the walk was lost. The shot after is a cycle again.
    const next = shotTimes("bow", bow.readyAt);
    think(t, hunt, { ...base, now: bow.leftAt + 1000, self: mine("bow", "foe", bow.readyAt) });
    expect(kinds(think(t, hunt, { ...base, now: next.leftAt, self: mine("bow", "foe", next.readyAt) }))).toEqual(["move"]);
    expect(t.stats().kiteCycles).toBe(2);
  });

  it("waits for the wand's windup to end too", () => {
    const t = createTactics(fakeWorld());
    const rng = kiter();
    const wand = shotTimes("wand", NOW + 100);
    const base = { rng, foes: [chaser()] };
    think(t, hunt, { ...base, self: mine("wand", "foe", NOW - 500) });
    const early = think(t, hunt, { ...base, now: wand.startedAt + wand.windupMs - 50, self: mine("wand", "foe", wand.readyAt) });
    expect(early.intents).toEqual([]);
    const late = think(t, hunt, { ...base, now: wand.startedAt + wand.windupMs + 10, self: mine("wand", "foe", wand.readyAt) });
    expect(kinds(late)).toEqual(["move"]);
  });

  it("stands and shoots when too little of the cooldown is left to walk in, as the fast bows do", () => {
    // A Sentenced bow leaves 524 ms into a 570 ms cooldown; a Fire bow 600 into 855 (255 ms: less than the step, the walk and the re-lock need).
    for (const faction of ["sentenced", "fire"] as const) {
      const t = createTactics(fakeWorld());
      const rng = kiter();
      const shot = shotTimes("bow", NOW + 100, faction);
      const self = (readyAt: number): Partial<SelfView> => mine("bow", "foe", readyAt, { faction });
      think(t, hunt, { rng, foes: [chaser()], self: self(NOW - 500) });
      const out = think(t, hunt, { rng, now: shot.leftAt, foes: [chaser()], self: self(shot.readyAt) });
      expect(out.intents, faction).toEqual([]);
      expect(t.stats().kiteCycles, faction).toBe(0);
    }
  });

  it("does not take a swap's cooldown penalty for a shot", () => {
    const t = createTactics(fakeWorld());
    const rng = kiter();
    const base = { rng, foes: [chaser()] };
    think(t, hunt, { ...base, self: mine("bow", "foe", NOW + 600) });
    // 250 ms more on the cooldown (SWAP_SECONDS): without the guard this reads as a shot that left 10 ms ago with 530 ms to walk in.
    const out = think(t, hunt, { ...base, now: NOW + 320, self: mine("bow", "foe", NOW + 850) });
    expect(out.intents).toEqual([]);
    expect(t.stats().kiteCycles).toBe(0);
  });

  it("steps at the tier's heading noise: within +-angleJitter of straight away", () => {
    const o = TIERS.hard.orbwalk;
    for (const draw of [0, 0.25, 0.75, 0.999]) {
      const t = createTactics(fakeWorld());
      const rng = scripted(0.5, 0.1, draw);
      const bow = shotTimes("bow", NOW + 100);
      const base = { rng, foes: [chaser()] };
      think(t, hunt, { ...base, self: mine("bow", "foe", NOW - 500) });
      const out = think(t, hunt, { ...base, now: bow.leftAt, self: mine("bow", "foe", bow.readyAt) });
      const to = moveTo(only(out, "move"));
      expect(angleGap(Math.atan2(to.y - ME.y, to.x - ME.x), Math.PI)).toBeLessThanOrEqual(o.angleJitter + 1e-9);
      expect(dist(to, ME)).toBeCloseTo(o.stepU, 3);
    }
  });

  /** One full shot against `f`, returning whether the bot stepped away. */
  function steps(f: FighterView, over: { weapon?: WeaponId; dice?: number; tier?: TierId; persona?: PersonaId; map?: GameMap } = {}): boolean {
    const weapon = over.weapon ?? "bow";
    const t = createTactics(fakeWorld());
    const rng = scripted(0.5, over.dice ?? 0.1, 0.5);
    const shot = shotTimes(weapon, NOW + 100);
    const base = { rng, foes: [f], tier: over.tier, persona: over.persona, map: over.map };
    think(t, hunt, { ...base, self: mine(weapon, "foe", NOW - 500) });
    const out = think(t, hunt, { ...base, now: shot.leftAt, self: mine(weapon, "foe", shot.readyAt) });
    return kinds(out).includes("move");
  }

  it("is used only by a ranged bot, against a melee chaser, when the dice for the engagement say so", () => {
    expect(steps(chaser())).toBe(true);
    expect(steps(chaser({ inHand: "bow" })), "against a shooter: stand and trade").toBe(false);
    expect(steps(chaser({ inHand: "wand" })), "against a shooter: stand and trade").toBe(false);
    expect(steps(chaser(), { weapon: "sword" }), "melee never kites").toBe(false);
    expect(steps(chaser(), { weapon: "axe" })).toBe(false);
    expect(steps(chaser(), { dice: 0.99 }), "the dice were against it for this engagement").toBe(false);
    expect(steps(chaser(), { tier: "easy" }), "Easy never orb-walks").toBe(false);
    expect(steps(foe(350, 0, { inHand: "sword", vx: 0 })), "a melee foe that is neither close nor coming").toBe(false);
    expect(steps(foe(150, 0, { inHand: "sword", vx: 0 })), "a melee foe on top of it").toBe(true);
    expect(steps(foe(330, 0, { inHand: "axe", vx: -100 })), "a melee foe closing in").toBe(true);
    expect(steps(chaser({ inHand: null })), "a foe whose weapon has not been seen is not known to be a chaser").toBe(false);
  });

  it("rolls the dice once per engagement from the tier's chance times the persona's kite", () => {
    // Hard 0.85 x Cautious 1.0 = 0.85 on; x Hunter 0.2 = 0.17.
    expect(steps(chaser(), { dice: 0.84, persona: "cautious" })).toBe(true);
    expect(steps(chaser(), { dice: 0.86, persona: "cautious" })).toBe(false);
    expect(steps(chaser(), { dice: 0.16, persona: "hunter" })).toBe(true);
    expect(steps(chaser(), { dice: 0.18, persona: "hunter" })).toBe(false);
    // One roll covers the whole engagement: later cycles do not re-roll.
    const t = createTactics(fakeWorld());
    const rng = scripted(0.5, 0.1);
    const base = { rng, foes: [chaser()] };
    think(t, hunt, { ...base, self: mine("bow", "foe", NOW - 500) });
    let ready = NOW + 100;
    for (let i = 0; i < 3; i++) {
      const shot = shotTimes("bow", ready);
      think(t, hunt, { ...base, now: shot.leftAt, self: mine("bow", "foe", shot.readyAt) });
      think(t, hunt, { ...base, now: shot.leftAt + 100, self: mine("bow", null, shot.readyAt) });
      think(t, hunt, { ...base, now: shot.readyAt, self: mine("bow", "foe", shot.readyAt) });
      ready = shot.readyAt;
    }
    expect(t.stats().kiteCycles).toBe(3);
  });

  it("turns or shortens its step when a wall is behind it, and stands and trades when boxed in", () => {
    // A wall 100 u west of the bot: straight back is blocked, a turn along the wall is not.
    const wall = arena(64, 48, [[Math.floor((ME.x - 100) / TILE) - 3, 5, Math.floor((ME.x - 100) / TILE), 40]]);
    const f = chaser();
    expect(steps(f, { map: wall })).toBe(true);
    const t = createTactics(fakeWorld());
    const bow = shotTimes("bow", NOW + 100);
    const base = { rng: kiter(), foes: [f], map: wall };
    think(t, hunt, { ...base, self: mine("bow", "foe", NOW - 500) });
    const out = think(t, hunt, { ...base, now: bow.leftAt, self: mine("bow", "foe", bow.readyAt) });
    const to = moveTo(only(out, "move"));
    expect(services(wall).paths.clear(ME, to)).toBe(true);
    expect(dist(to, at(150, 0)), "still away from the chaser").toBeGreaterThan(150);
    // A room three tiles wide: no heading is clear.
    const cx = Math.floor(ME.x / TILE);
    const cy = Math.floor(ME.y / TILE);
    const box = arena(64, 48, [[cx - 8, cy - 8, cx + 8, cy - 2], [cx - 8, cy + 2, cx + 8, cy + 8], [cx - 8, cy - 8, cx - 2, cy + 8], [cx + 2, cy - 8, cx + 8, cy + 8]]);
    expect(steps(foe(30, 0), { map: box }), "cornered: no step").toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------------- dodges and jukes

describe("dodging a visible ball", () => {
  const seen = (id = "ball1", value = 449): Stimulus => ({ kind: "incoming", at: NOW, subject: id, central: true, value });

  it("sidesteps perpendicular to a ball that can still be dodged after the reaction, timed as a reaction to it", () => {
    const t = createTactics(fakeWorld());
    const stim = seen();
    const out = think(t, hunt, { rng: scripted(0.5, 0.99, 0.1), foes: [foe(220, 0, { inHand: "wand" })], projectiles: [ball()], stimuli: [stim] });
    const move = only(out, "move");
    expect(move).toMatchObject({ priority: PRIORITY.reflex, timing: { kind: "react", stimulus: stim } });
    const to = moveTo(move);
    expect(to.x).toBeCloseTo(ME.x, 6);
    expect(Math.abs(to.y - ME.y)).toBeGreaterThanOrEqual(26);
    expect(out.status.state, "strategy re-decides").toBe("blocked");
    expect(t.stats().dodges).toBe(1);
  });

  it("leaves the order channel alone while the sidestep is on its way, then locks again", () => {
    const t = createTactics(fakeWorld());
    const rng = scripted(0.5, 0.99, 0.1);
    const scene = { rng, foes: [foe(220, 0)], projectiles: [ball()], stimuli: [seen()] };
    expect(kinds(think(t, hunt, scene))).toEqual(["move"]);
    // The lock dropped (the dodge took) but the walk is not over: a lock now would replace it before the bot has stepped.
    const mid = think(t, hunt, { ...scene, now: NOW + 100, stimuli: [], self: { attackTarget: null } });
    expect(mid.intents).toEqual([]);
    expect(mid.status.state).toBe("running");
    expect(kinds(think(t, hunt, { ...scene, now: NOW + 1000, stimuli: [], projectiles: [], self: { attackTarget: null } }))).toEqual(["lock"]);
  });

  it("answers a ball it was already watching at the step of a plan", () => {
    const t = createTactics(fakeWorld());
    const out = think(t, hunt, { rng: scripted(0.5, 0.99, 0.1), foes: [foe(220, 0)], projectiles: [ball()] });
    expect(only(out, "move").timing).toEqual({ kind: "step" });
  });

  it("cannot dodge what it has no time for: Normal and Easy from the launch, anyone from close", () => {
    const launch = { foes: [foe(220, 0)], projectiles: [ball()], stimuli: [seen()] };
    for (const tier of ["normal", "easy"] as const) {
      const t = createTactics(fakeWorld());
      expect(think(t, hunt, { ...launch, tier, rng: scripted(0.5, 0.99, 0.0) }).status.state, tier).not.toBe("blocked");
      expect(t.stats().dodges).toBe(0);
    }
    const near = createTactics(fakeWorld());
    const late = ball({ x: ME.x + 100, x0: ME.x + 220 });
    think(near, hunt, { rng: scripted(0.5, 0.99, 0.0), foes: [foe(220, 0)], projectiles: [late], stimuli: [seen()] });
    expect(near.stats().dodges, "263 ms of flight, 130 of it already gone").toBe(0);
  });

  it("ignores a ball that will miss, one it loosed itself, and arrows it can only juke", () => {
    const miss = createTactics(fakeWorld());
    think(miss, hunt, { rng: scripted(0.5, 0.99, 0.0), foes: [foe(220, 0)], projectiles: [ball({ y: ME.y + 90, y0: ME.y + 90 })] });
    const mine = createTactics(fakeWorld());
    think(mine, hunt, { rng: scripted(0.5, 0.99, 0.0), foes: [foe(220, 0)], projectiles: [ball({ from: "me" })] });
    const fromBody = createTactics(fakeWorld());
    think(fromBody, hunt, { rng: scripted(0.5, 0.99, 0.0), foes: [foe(220, 0)], projectiles: [ball({ x: ME.x + 5, x0: ME.x + 5, from: null })] });
    const behind = createTactics(fakeWorld());
    think(behind, hunt, { rng: scripted(0.5, 0.99, 0.0), foes: [foe(220, 0)], projectiles: [ball({ x: ME.x - 100, x0: ME.x - 100, vx: -380 })] });
    for (const t of [miss, mine, fromBody, behind]) expect(t.stats().dodges).toBe(0);
  });

  it("makes ONE decision per projectile: a no stays a no, a yes dodges once", () => {
    const no = createTactics(fakeWorld());
    const stim = seen();
    const scene = { foes: [foe(220, 0)], projectiles: [ball()], stimuli: [stim] };
    think(no, hunt, { ...scene, rng: scripted(0.5, 0.99, 0.99) });
    think(no, hunt, { ...scene, now: NOW + 10, rng: scripted(0.0, 0.0, 0.0) });
    expect(no.stats().dodges).toBe(0);
    const yes = createTactics(fakeWorld());
    think(yes, hunt, { ...scene, rng: scripted(0.5, 0.99, 0.0) });
    think(yes, hunt, { ...scene, now: NOW + 10, rng: scripted(0.0, 0.0, 0.0) });
    expect(yes.stats().dodges).toBe(1);
  });

  it("dodges with the tier's chance: Hard about 65% of the balls it has time for", () => {
    let dodged = 0;
    const rng = rngs(5);
    const trials = 600;
    for (let i = 0; i < trials; i++) {
      const t = createTactics(fakeWorld());
      think(t, hunt, { rng, foes: [foe(220, 0)], projectiles: [ball({ id: `b${i}` })], stimuli: [seen(`b${i}`)], self: { attackTarget: "foe" } });
      dodged += t.stats().dodges;
    }
    expect(dodged / trials).toBeGreaterThan(TIERS.hard.dodgeP - 0.07);
    expect(dodged / trials).toBeLessThan(TIERS.hard.dodgeP + 0.07);
  });

  it("steps to the clear side, and not at all when both are walled", () => {
    // The ball flies west, so the sides are north (y - 32) and south (y + 32).
    const northWall = arena(64, 48, [[10, Math.floor((ME.y - 40) / TILE) - 3, 60, Math.floor((ME.y - 40) / TILE)]]);
    const t = createTactics(fakeWorld());
    const out = think(t, hunt, { map: northWall, rng: scripted(0.5, 0.99, 0.0), foes: [foe(220, 0)], projectiles: [ball()], stimuli: [seen()] });
    expect(moveTo(only(out, "move")).y).toBeGreaterThan(ME.y);
    const cy = Math.floor(ME.y / TILE);
    const corridor = arena(64, 48, [[10, cy - 4, 60, cy - 1], [10, cy + 1, 60, cy + 4]]);
    const stuck = createTactics(fakeWorld());
    think(stuck, hunt, { map: corridor, rng: scripted(0.5, 0.99, 0.0), foes: [foe(220, 0)], projectiles: [ball()], stimuli: [seen()] });
    expect(stuck.stats().dodges).toBe(0);
  });

  it("also dodges while it is only walking, looting or holding: the reflex takes the order channel from the world goal", () => {
    const world = fakeWorld({
      intents: [
        { kind: "move", to: at(500, 0), priority: PRIORITY.goal, timing: { kind: "step" }, why: "roam" },
        { kind: "pickup", container: "c1", priority: PRIORITY.goal, timing: { kind: "step" }, why: "loot" },
      ],
    });
    const t = createTactics(world);
    const out = think(t, { kind: "roam", to: at(500, 0), why: "explore" }, { rng: scripted(0.5, 0.0), projectiles: [ball()], stimuli: [seen()] });
    expect(kinds(out).sort()).toEqual(["move", "pickup"]);
    expect(only(out, "move")).toMatchObject({ priority: PRIORITY.reflex });
    expect(out.status.state).toBe("blocked");
    // The sidestep is still on its way: the roam step the world goal offers meanwhile would replace it, so only the pickup goes out.
    const meanwhile = think(t, { kind: "roam", to: at(500, 0), why: "explore" }, { now: NOW + 100, rng: scripted(0.5, 0.0), projectiles: [ball()] });
    expect(kinds(meanwhile)).toEqual(["pickup"]);
    expect(meanwhile.status.state).toBe("running");
    // Nothing coming: the world's own answer, untouched.
    const calm = createTactics(world);
    expect(think(calm, { kind: "roam", to: at(500, 0), why: "explore" }, {})).toBe(world.answer);
  });
});

describe("juking a draw", () => {
  const drawing = (over: Partial<FighterView> = {}) => foe(200, 0, { inHand: "bow", drawStartedAt: NOW - 200, facing: Math.PI, faction: null, ...over });
  const release = NOW - 200 + 600;

  it("times a direction change to just after the arrow leaves", () => {
    const t = createTactics(fakeWorld());
    const out = think(t, hunt, { rng: scripted(0.5, 0.99, 0.1, 0.9), foes: [drawing()] });
    const move = only(out, "move");
    expect(move).toMatchObject({ priority: PRIORITY.reflex, timing: { kind: "timed", due: release + 30 } });
    const to = moveTo(move);
    expect(dist(to, ME)).toBeCloseTo(44, 3);
    expect((to.x - ME.x) * 200 + (to.y - ME.y) * 0, "perpendicular to the line to the archer").toBeCloseTo(0, 3);
    expect(out.status.state).toBe("blocked");
    expect(t.stats().jukes).toBe(1);
  });

  it("keeps the order channel quiet until the juke has been sent, then locks again", () => {
    const t = createTactics(fakeWorld());
    const rng = scripted(0.5, 0.99, 0.1, 0.9);
    expect(kinds(think(t, hunt, { rng, foes: [drawing()] }))).toEqual(["move"]);
    const mid = think(t, hunt, { rng, now: NOW + 200, foes: [drawing()], self: { attackTarget: null } });
    expect(mid.intents, "a lock now would replace the timed juke").toEqual([]);
    const after = think(t, hunt, { rng, now: release + 600, foes: [drawing({ drawStartedAt: 0 })], self: { attackTarget: null } });
    expect(kinds(after)).toEqual(["lock"]);
  });

  it("only jukes a draw aimed at it, within range, not yet released, and once per draw", () => {
    const away = createTactics(fakeWorld());
    think(away, hunt, { rng: scripted(0.5, 0.99, 0.1, 0.9), foes: [drawing({ facing: 0 })] });
    const far = createTactics(fakeWorld());
    think(far, hunt, { rng: scripted(0.5, 0.99, 0.1, 0.9), foes: [foe(450, 0, { inHand: "bow", drawStartedAt: NOW - 200, facing: Math.PI, faction: null })] });
    const gone = createTactics(fakeWorld());
    think(gone, hunt, { rng: scripted(0.5, 0.99, 0.1, 0.9), foes: [drawing({ drawStartedAt: NOW - 900 })] });
    for (const t of [away, far, gone]) expect(t.stats().jukes).toBe(0);
    const once = createTactics(fakeWorld());
    const rng = scripted(0.5, 0.99, 0.1, 0.9, 0.1, 0.9);
    think(once, hunt, { rng, foes: [drawing()] });
    think(once, hunt, { rng, now: NOW + 100, foes: [drawing()] });
    expect(once.stats().jukes).toBe(1);
  });

  it("does not juke when it has no chance of it (Easy), and rolls the tier's chance otherwise", () => {
    const easy = createTactics(fakeWorld());
    think(easy, hunt, { tier: "easy", rng: scripted(0.5, 0.99, 0.0, 0.9), foes: [drawing()] });
    expect(easy.stats().jukes).toBe(0);
    let n = 0;
    const rng = rngs(11);
    for (let i = 0; i < 500; i++) {
      const t = createTactics(fakeWorld());
      think(t, hunt, { rng, foes: [drawing()], self: { attackTarget: "foe" } });
      n += t.stats().jukes;
    }
    expect(n / 500).toBeGreaterThan(TIERS.hard.jukeP - 0.07);
    expect(n / 500).toBeLessThan(TIERS.hard.jukeP + 0.07);
  });

  it("sometimes reads a feint: a fighter that cancelled windups at it is ignored with the tier's feint-read chance", () => {
    const feinter = memFighter({ feints: 2 });
    const read = createTactics(fakeWorld());
    think(read, hunt, { rng: scripted(0.5, 0.99, 0.1, 0.1, 0.9), foes: [drawing()], memFighters: [feinter] });
    expect(read.stats().jukes, "the feint read (0.1 < 0.2): no juke").toBe(0);
    const missed = createTactics(fakeWorld());
    think(missed, hunt, { rng: scripted(0.5, 0.99, 0.5, 0.1, 0.9), foes: [drawing()], memFighters: [feinter] });
    expect(missed.stats().jukes, "the feint not read: the juke dice").toBe(1);
  });

  it("jukes a wand windup announced to it, timed to the ball leaving", () => {
    const t = createTactics(fakeWorld());
    const event: ObservedEvent = { kind: "windup", t: NOW - 100, at: at(200, 0), by: "foe", weapon: "wand", a: Math.PI, ms: 400 };
    const out = think(t, hunt, { rng: scripted(0.5, 0.99, 0.1, 0.9), foes: [foe(200, 0, { inHand: "wand" })], events: [event] });
    expect(only(out, "move")).toMatchObject({ timing: { kind: "timed", due: NOW - 100 + 400 + 30 } });
    expect(t.stats().jukes).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------- flee

describe("flee", () => {
  const flee = (over: Partial<Extract<Goal, { kind: "flee" }>> = {}): Goal => ({ kind: "flee", from: [at(100, 0)], until: NOW + 5000, ...over });

  it("walks to the retreat point away from the threats as a reflex, and says blocked on the first emission only", () => {
    const t = createTactics(fakeWorld());
    const first = think(t, flee());
    const move = only(first, "move");
    expect(move.priority).toBe(PRIORITY.reflex);
    expect(dist(moveTo(move), at(100, 0))).toBeGreaterThan(dist(ME, at(100, 0)) + 60);
    expect(first.status.state).toBe("blocked");
    expect(first.attacking).toBe(false);
    const second = think(t, flee(), { now: NOW + 200 });
    expect(second.status.state).toBe("running");
    expect(moveTo(only(second, "move")), "the same destination: the humanizer dedupes it").toEqual(moveTo(move));
    expect(t.stats().retreats).toBe(1);
  });

  it("answers a low-hp stimulus with a reaction, else a step", () => {
    const stim: Stimulus = { kind: "lowHp", at: NOW, subject: null, central: true };
    expect(only(think(createTactics(fakeWorld()), flee(), { stimuli: [stim] }), "move").timing).toEqual({ kind: "react", stimulus: stim });
    expect(only(think(createTactics(fakeWorld()), flee()), "move").timing).toEqual({ kind: "step" });
  });

  it("is done when its time is up, and a later flight counts as a new retreat", () => {
    const t = createTactics(fakeWorld());
    think(t, flee());
    expect(think(t, flee(), { now: NOW + 6000 }).status.state).toBe("done");
    expect(think(t, flee({ until: NOW + 20_000 }), { now: NOW + 7000 }).status.state).toBe("blocked");
    expect(t.stats().retreats).toBe(2);
  });

  it("fights on when cornered, and fails when there is nobody to fight", () => {
    const cx = Math.floor(ME.x / TILE);
    const cy = Math.floor(ME.y / TILE);
    const box = arena(64, 48, [[cx - 8, cy - 8, cx + 8, cy - 2], [cx - 8, cy + 2, cx + 8, cy + 8], [cx - 8, cy - 8, cx - 2, cy + 8], [cx + 2, cy - 8, cx + 8, cy + 8]]);
    const t = createTactics(fakeWorld());
    const out = think(t, flee({ from: [at(20, 0)] }), { map: box, foes: [foe(20, 0, {}, box)] });
    expect(only(out, "lock")).toMatchObject({ target: "foe" });
    expect(out.status).toMatchObject({ state: "running", why: expect.stringContaining("cornered") });
    expect(think(createTactics(fakeWorld()), flee({ from: [at(20, 0)] }), { map: box }).status.state).toBe("failed");
  });
});

// ----------------------------------------------------------------------------------------------------- bounty and sudden death

describe("a bounty carrier", () => {
  it("opens no new fight with a player below 70% hp, but finishes one it is in and farms mobs", () => {
    const hurt = { bounty: 8, hp: 60, maxHp: 100 };
    const t = createTactics(fakeWorld());
    const blocked = think(t, hunt, { self: hurt, foes: [foe(300, 0)] });
    expect(blocked.status.state).toBe("blocked");
    expect(blocked.intents).toEqual([]);
    expect(think(t, hunt, { self: { ...hurt, hp: 80 }, foes: [foe(300, 0)] }).status.state).toBe("running");
    expect(kinds(think(t, fightGoal, { self: hurt, foes: [foe(300, 0)] })), "a fight in progress").toEqual(["lock"]);
    expect(kinds(think(t, hunt, { self: { ...hurt, attackTarget: "foe" }, foes: [foe(300, 0)] }))).toEqual([]);
    expect(kinds(think(t, farm, { self: hurt, mobs: [mob(200, 0)] }))).toEqual(["lock"]);
    expect(think(t, hunt, { self: { bounty: 0, hp: 60, maxHp: 100 }, foes: [foe(300, 0)] }).status.state, "no crown").toBe("running");
  });
});

describe("sudden death", () => {
  const sd = { suddenDeathAt: NOW - 1000, inColiseum: true };
  const ahead = { hp: 80, maxHp: 100 };
  /** knowledge draw (low = knows the rule), then the engagement dice. */
  const knows = () => scripted(0.1, 0.99);

  it("a bot ahead on hp share that knows the rule keeps its distance: no approach, no lock", () => {
    const t = createTactics(fakeWorld());
    const rng = knows();
    const near = think(t, hunt, { rng, hud: sd, self: ahead, foes: [foe(200, 0, { hpFrac: 0.5 })] });
    expect(kinds(near)).toEqual(["move"]);
    expect(dist(moveTo(only(near, "move")), at(200, 0))).toBeGreaterThan(200);
    expect(near.attacking).toBe(false);
    expect(near.status.state).toBe("running");
    const stand = createTactics(fakeWorld());
    const srng = knows();
    expect(kinds(think(stand, hunt, { rng: srng, hud: sd, self: ahead, foes: [foe(500, 0, { hpFrac: 0.5 })] })), "far enough: stand off").toEqual(["stop"]);
    expect(think(stand, hunt, { rng: srng, now: NOW + 200, hud: sd, self: ahead, foes: [foe(500, 0, { hpFrac: 0.5 })] }).intents, "once").toEqual([]);
  });

  it("engages as usual when behind, level, before sudden death, or when it does not know the rule", () => {
    const behind = { hp: 40, maxHp: 100 };
    expect(kinds(think(createTactics(fakeWorld()), hunt, { rng: knows(), hud: sd, self: behind, foes: [foe(300, 0, { hpFrac: 0.5 })] }))).toEqual(["lock"]);
    expect(kinds(think(createTactics(fakeWorld()), hunt, { rng: knows(), hud: sd, self: { hp: 50, maxHp: 100 }, foes: [foe(300, 0, { hpFrac: 0.5 })] }))).toEqual(["lock"]);
    expect(kinds(think(createTactics(fakeWorld()), hunt, { rng: knows(), hud: { ...sd, suddenDeathAt: NOW + 5000 }, self: ahead, foes: [foe(300, 0, { hpFrac: 0.5 })] }))).toEqual(["lock"]);
    expect(kinds(think(createTactics(fakeWorld()), hunt, { rng: scripted(0.99, 0.99), hud: sd, self: ahead, foes: [foe(300, 0, { hpFrac: 0.5 })] })), "does not know it").toEqual(["lock"]);
  });

  it("draws its knowledge once, on the first act, whatever the goal", () => {
    const t = createTactics(fakeWorld());
    const rng = scripted(0.99, 0.99);
    think(t, { kind: "idle" }, { rng });
    // The first draw (0.99) made it ignorant; a later bot-ahead fight is engaged as usual even though the stream now yields 0.5.
    expect(kinds(think(t, hunt, { rng, hud: sd, self: ahead, foes: [foe(300, 0, { hpFrac: 0.5 })] }))).toEqual(["lock"]);
  });

  it("fights when it cannot get away", () => {
    const cx = Math.floor(ME.x / TILE);
    const cy = Math.floor(ME.y / TILE);
    const box = arena(64, 48, [[cx - 8, cy - 8, cx + 8, cy - 2], [cx - 8, cy + 2, cx + 8, cy + 8], [cx - 8, cy - 8, cx - 2, cy + 8], [cx + 2, cy - 8, cx + 8, cy + 8]]);
    const t = createTactics(fakeWorld());
    expect(kinds(think(t, hunt, { map: box, rng: knows(), hud: sd, self: ahead, foes: [foe(40, 0, { hpFrac: 0.5 }, box)] }))).toEqual(["lock"]);
  });
});

// -------------------------------------------------------------------------------------------------------------- dispatch

describe("dispatch", () => {
  it("hands loot, roam, hold and idle to the world tactics with the same context and goal, and returns its answer", () => {
    const world = fakeWorld({ intents: [{ kind: "move", to: at(10, 10), priority: PRIORITY.goal, timing: { kind: "step" }, why: "walk" }] });
    const t = createTactics(world);
    const goals: WorldGoal[] = [
      { kind: "loot", container: "c1" }, { kind: "roam", to: at(300, 0), why: "explore" },
      { kind: "hold", at: at(0, 300), why: "coliseum" }, { kind: "idle" },
    ];
    for (const goal of goals) {
      const c = makeCtx();
      expect(t.act(c, goal)).toBe(world.answer);
      expect(world.calls.at(-1)).toMatchObject({ goal });
      expect(world.calls.at(-1)!.ctx).toBe(c);
    }
    expect(world.calls).toHaveLength(4);
  });

  it("keeps fights and flights to itself, and reports a module goal as not its own", () => {
    const world = fakeWorld();
    const t = createTactics(world);
    think(t, hunt, { foes: [foe(300, 0)] });
    think(t, fightGoal, { foes: [foe(300, 0)] });
    think(t, farm, { mobs: [mob(200, 0)] });
    think(t, { kind: "flee", from: [at(100, 0)], until: NOW + 1000 });
    expect(world.calls).toHaveLength(0);
    const out = think(t, { kind: "module", module: "chests", data: {} });
    expect(out.status.state).toBe("failed");
    expect(out.intents).toEqual([]);
  });

  it("defaults to the real world tactics, and exposes the same stats as stats() and getStats()", () => {
    const t = createTactics();
    const out = think(t, { kind: "idle" });
    expect(out.status.state).toBeDefined();
    expect(t.getStats()).toEqual(t.stats());
    expect(t.stats()).toEqual({ dodges: 0, jukes: 0, kiteCycles: 0, retreats: 0, mobTargets: 0 });
  });
});

describe("determinism", () => {
  it("replays exactly: the same inputs and seed give the same intents", () => {
    const run = () => {
      const t = createTactics(fakeWorld());
      const rng = rngs(7);
      const outs: TacticsOutput[] = [];
      for (let i = 0; i < 80; i++) {
        outs.push(think(t, hunt, {
          rng, now: NOW + i * 120, foes: [foe(150 + (i % 7) * 70, (i % 5) * 20, { inHand: i % 3 === 0 ? "bow" : "sword", vx: -100, drawStartedAt: i % 11 === 0 ? NOW + i * 120 - 150 : 0, facing: Math.PI })],
          projectiles: i % 6 === 0 ? [ball({ id: `b${i}` })] : [], self: { weapons: ["bow", "wand"], attackTarget: i % 4 === 0 ? null : "foe", readyAt: NOW + i * 120 },
        }));
      }
      return JSON.stringify(outs);
    };
    expect(run()).toBe(run());
  });
});

// A reminder that the numbers the tests lean on are the shared ones, so a retune shows up here and not as a mystery.
describe("the numbers under the cycle", () => {
  it("bow and wand windups are what the orb-walk waits for", () => {
    const spec = pacedFaction(FACTIONS.fire);
    const bow = ownTimings(selfView({ faction: "fire" }), "bow")!;
    expect(bow.intervalMs).toBeCloseTo(attackInterval(spec, "bow") * 1000, 6);
    expect(bow.windupMs).toBeLessThanOrEqual(600);
    expect(bow.windupMs).toBeGreaterThan(0);
  });
});
