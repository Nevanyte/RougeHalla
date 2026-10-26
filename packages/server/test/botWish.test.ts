// The bots' use of their faction's Wish: `decideCast` (bots/abilityPolicy.ts) picks and aims a cast by the intent tags of the def
// (`ai`), never by ability id, and BotClient asks for it only once it is ready, at most once a second, and never at a fighter
// nobody can target. Pure situations on a hand-built map; BotClient is driven through a stand-in room.
import { describe, expect, it } from "vitest";
import {
  ABILITIES, BLAZE_RANGE, blinkLanding, EFFECT_CASTING, EFFECT_HIDDEN, EFFECT_ROOTED, EFFECT_SILENCED, EFFECT_STUNNED,
  EFFECT_UNTARGETABLE, FREEZE_RANGE, mapFromTiles, TILE, TILE_FLOOR, TILE_WALL, TRIAL_RANGE, WISHES, type AbilityDef, type AbilityId,
  type FactionId, type GameMap,
} from "@raid/shared";
import { PlayerState } from "@raid/shared/schema";
import {
  ENGAGE_BLINK_MIN_DISTANCE, ENGAGE_BLINK_STOP_SHORT, ENGAGE_RANGE_MARGIN, PEEL_DISTANCE, decideCast, type CastSituation,
} from "../src/bots/abilityPolicy";
import { BotClient } from "../src/bots/BotClient";

const W = 40;
const H = 20;

function openMap(): GameMap {
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let x = 0; x < W; x++) { tiles[x] = TILE_WALL; tiles[(H - 1) * W + x] = TILE_WALL; }
  for (let y = 0; y < H; y++) { tiles[y * W] = TILE_WALL; tiles[y * W + W - 1] = TILE_WALL; }
  return { ...mapFromTiles(W, H, tiles), spawns: [{ x: 100, y: 100 }] };
}

/** A sealed 3 x 3 pocket of floor in a field of rock: nothing in reach of a blink from its middle is valid. */
function pocketMap(): GameMap {
  const tiles = new Uint8Array(W * H).fill(TILE_WALL);
  for (let y = 8; y <= 10; y++) for (let x = 8; x <= 10; x++) tiles[y * W + x] = TILE_FLOOR;
  return { ...mapFromTiles(W, H, tiles), spawns: [{ x: 9.5 * TILE, y: 9.5 * TILE }] };
}

const ME = { x: 640, y: 320 };

/** A calm situation: full hp, nobody near. Each test changes what it is about. */
function calm(over: Omit<Partial<CastSituation>, "me"> & { me?: Partial<CastSituation["me"]> } = {}): CastSituation {
  const { me, ...rest } = over;
  return {
    me: { ...ME, hpFrac: 1, effects: 0, recentlyHit: false, ...me },
    foe: null, threat: null, map: openMap(), gatesLocked: false, ...rest,
  };
}

const foeAt = (d: number, over: Partial<NonNullable<CastSituation["foe"]>> = {}): NonNullable<CastSituation["foe"]> =>
  ({ id: "foe", x: ME.x + d, y: ME.y, d, los: true, targetable: true, ...over });

const threatAt = (d: number, over: Partial<NonNullable<CastSituation["threat"]>> = {}): NonNullable<CastSituation["threat"]> =>
  ({ x: ME.x + d, y: ME.y, d, chasing: true, id: "foe", los: true, targetable: true, ...over });

const cast = (id: AbilityId, s: CastSituation) => decideCast(ABILITIES[id], 1, s);

describe("never while the bot cannot cast", () => {
  const trouble = (effects: number) => calm({ me: { hpFrac: 0.2, recentlyHit: true, effects }, threat: threatAt(100), foe: foeAt(100) });

  it("a stun or a silence refuses every Wish; a root does not (no Wish lists it); a cast in progress refuses all", () => {
    for (const id of Object.values(WISHES)) {
      expect(cast(id, trouble(0)), `${id} in trouble`).not.toBeNull();
      expect(cast(id, trouble(EFFECT_STUNNED)), `${id} stunned`).toBeNull();
      expect(cast(id, trouble(EFFECT_SILENCED)), `${id} silenced`).toBeNull();
      expect(cast(id, trouble(EFFECT_CASTING)), `${id} casting`).toBeNull();
    }
    expect(cast("lastStand", trouble(EFFECT_ROOTED))).not.toBeNull();
    expect(cast("blaze", trouble(EFFECT_ROOTED))).not.toBeNull();
  });

  it("reads the def's own blockedBy list, not the id: a skill that a root refuses is refused by one", () => {
    const rootBlocked: AbilityDef = { ...ABILITIES.lastStand, blockedBy: ["root"] };
    expect(decideCast(rootBlocked, 1, trouble(EFFECT_ROOTED))).toBeNull();
    expect(decideCast(rootBlocked, 1, trouble(EFFECT_STUNNED))).not.toBeNull();
  });
});

describe("escape (Swarm: a self cast)", () => {
  it("casts at low hp with a threat close, or at low hp while being hit; otherwise not", () => {
    expect(cast("swarm", calm())).toBeNull();
    expect(cast("swarm", calm({ me: { hpFrac: 0.45 }, threat: threatAt(200) }))).toEqual(ME);
    expect(cast("swarm", calm({ me: { hpFrac: 0.45 }, threat: threatAt(300) }))).toBeNull();
    expect(cast("swarm", calm({ me: { hpFrac: 0.55 }, threat: threatAt(100) }))).toBeNull();
    expect(cast("swarm", calm({ me: { hpFrac: 0.54, recentlyHit: true } }))).toEqual(ME);
    expect(cast("swarm", calm({ me: { hpFrac: 0.56, recentlyHit: true } }))).toBeNull();
    expect(cast("swarm", calm({ me: { hpFrac: 0.9, recentlyHit: true }, threat: threatAt(50) }))).toBeNull();
  });

  it("never engages: a foe in the open with full hp is left alone", () => {
    expect(cast("swarm", calm({ foe: foeAt(150), threat: threatAt(150) }))).toBeNull();
  });
});

describe("sustain, then escape (Last Stand: a self cast)", () => {
  it("casts at very low hp while being hit", () => {
    expect(cast("lastStand", calm({ me: { hpFrac: 0.3, recentlyHit: true } }))).toEqual(ME);
    expect(cast("lastStand", calm({ me: { hpFrac: 0.3 } }))).toBeNull();
  });

  it("its second intent, escape, covers the rest of trouble", () => {
    expect(cast("lastStand", calm({ me: { hpFrac: 0.4, recentlyHit: true } }))).toEqual(ME);
    expect(cast("lastStand", calm({ me: { hpFrac: 0.45 }, threat: threatAt(150) }))).toEqual(ME);
    expect(cast("lastStand", calm({ me: { hpFrac: 0.7, recentlyHit: true }, threat: threatAt(150) }))).toBeNull();
  });
});

describe("engage and control (Trial, Freeze: a unit cast)", () => {
  it("casts on a targetable player foe in sight within the range less a margin", () => {
    const r = TRIAL_RANGE - ENGAGE_RANGE_MARGIN;
    expect(cast("trial", calm({ foe: foeAt(300) }))).toEqual({ x: ME.x + 300, y: ME.y, id: "foe" });
    expect(cast("trial", calm({ foe: foeAt(r) }))).toMatchObject({ id: "foe" });
    expect(cast("trial", calm({ foe: foeAt(r + 1) }))).toBeNull();
    const f = FREEZE_RANGE - ENGAGE_RANGE_MARGIN;
    expect(cast("freeze", calm({ foe: foeAt(f) }))).toMatchObject({ id: "foe" });
    expect(cast("freeze", calm({ foe: foeAt(f + 1) }))).toBeNull();
  });

  it("not without a line of sight, not at a fighter nobody can target, not at a mob, not with nobody", () => {
    expect(cast("trial", calm({ foe: foeAt(200, { los: false }) }))).toBeNull();
    expect(cast("trial", calm({ foe: foeAt(200, { targetable: false }) }))).toBeNull();
    expect(cast("freeze", calm({ foe: foeAt(200, { mob: true }) }))).toBeNull();
    expect(cast("trial", calm())).toBeNull();
    expect(cast("freeze", calm())).toBeNull();
  });

  it("is cast at full hp: it is not an escape", () => {
    expect(cast("trial", calm({ me: { hpFrac: 1 }, foe: foeAt(200) }))).not.toBeNull();
  });
});

describe("peel (Freeze)", () => {
  it("casts on the enemy that is on us and chasing, even with nothing locked", () => {
    expect(cast("freeze", calm({ threat: threatAt(PEEL_DISTANCE) }))).toEqual({ x: ME.x + PEEL_DISTANCE, y: ME.y, id: "foe" });
    expect(cast("freeze", calm({ threat: threatAt(PEEL_DISTANCE + 1) }))).toBeNull();
    expect(cast("freeze", calm({ threat: threatAt(100, { chasing: false }) }))).toBeNull();
  });

  it("needs the threat's id and a target the server would take", () => {
    expect(cast("freeze", calm({ threat: threatAt(100, { id: undefined }) }))).toBeNull();
    expect(cast("freeze", calm({ threat: threatAt(100, { targetable: false }) }))).toBeNull();
    expect(cast("freeze", calm({ threat: threatAt(100, { los: false }) }))).toBeNull();
  });
});

describe("the intents, in the order the def lists them, by tag and not by id", () => {
  const both = calm({ foe: foeAt(300, { id: "foe" }), threat: threatAt(100, { id: "chaser", x: ME.x - 100 }) });

  it("the first intent that fires decides", () => {
    const peelFirst: AbilityDef = { ...ABILITIES.freeze, ai: ["peel", "control"] };
    const controlFirst: AbilityDef = { ...ABILITIES.freeze, ai: ["control", "peel"] };
    expect(decideCast(peelFirst, 1, both)).toMatchObject({ id: "chaser" });
    expect(decideCast(controlFirst, 1, both)).toMatchObject({ id: "foe" });
  });

  it("another id with the same tags behaves the same; the same id with other tags does not", () => {
    const renamed: AbilityDef = { ...ABILITIES.trial, id: "freeze", name: "Not Trial" };
    expect(decideCast(renamed, 1, calm({ foe: foeAt(300) }))).toEqual(cast("trial", calm({ foe: foeAt(300) })));
    const retagged: AbilityDef = { ...ABILITIES.trial, ai: ["escape"] };
    expect(decideCast(retagged, 1, calm({ foe: foeAt(300) }))).toBeNull();
  });

  it("burst, zone and buff are for skills to come: nothing is cast for them", () => {
    const later: AbilityDef = { ...ABILITIES.trial, ai: ["burst", "zone", "buff"] };
    expect(decideCast(later, 1, calm({ me: { hpFrac: 0.1, recentlyHit: true }, foe: foeAt(100), threat: threatAt(50) }))).toBeNull();
  });

  it("a rank past the def's last is clamped, as the server clamps it", () => {
    expect(decideCast(ABILITIES.trial, 9, calm({ foe: foeAt(300) }))).not.toBeNull();
    expect(decideCast(ABILITIES.trial, 0, calm({ foe: foeAt(300) }))).not.toBeNull();
  });
});

describe("Blaze Step (a point cast: a blink)", () => {
  const landing = (s: CastSituation, to: { x: number; y: number }) => blinkLanding(s.map, s.gatesLocked, s.me, to);

  it("escapes away from the threat, to a point the server would accept, and further from it", () => {
    const s = calm({ me: { hpFrac: 0.4 }, threat: threatAt(150) });
    const c = cast("blaze", s)!;
    expect(c).not.toBeNull();
    expect(c.id).toBeUndefined();
    const at = landing(s, c)!;
    expect(at).not.toBeNull();
    expect(Math.hypot(at.x - (ME.x + 150), at.y - ME.y)).toBeGreaterThan(150 + 24);
    // Straight away from a threat to the east is west.
    expect(c.x).toBeLessThan(ME.x);
    expect(Math.hypot(c.x - ME.x, c.y - ME.y)).toBeCloseTo(BLAZE_RANGE, 6);
  });

  it("turns to another heading when the one straight away is a wall, and gives up when there is none", () => {
    // Against the west wall with the threat to the east: straight away is no landing, a diagonal is.
    const wall = calm({ me: { x: 50, y: 320, hpFrac: 0.4 }, threat: { x: 200, y: 320, d: 150, chasing: true, id: "foe" } });
    const c = cast("blaze", wall)!;
    expect(c).not.toBeNull();
    expect(landing(wall, c)).not.toBeNull();
    const pocket = calm({ map: pocketMap(), me: { x: 9.5 * TILE, y: 9.5 * TILE, hpFrac: 0.4 }, threat: { x: 9.5 * TILE + 40, y: 9.5 * TILE, d: 40, chasing: true, id: "foe" } });
    expect(cast("blaze", pocket)).toBeNull();
  });

  it("escapes from what it is fighting when no player is near (a mob that beats it)", () => {
    const s = calm({ me: { hpFrac: 0.5, recentlyHit: true }, foe: foeAt(60, { mob: true }) });
    const c = cast("blaze", s)!;
    expect(c).not.toBeNull();
    expect(c.x).toBeLessThan(ME.x);
  });

  it("engages: blinks toward a player foe at a gap worth closing, landing short of it", () => {
    const s = calm({ foe: foeAt(200) });
    const c = cast("blaze", s)!;
    expect(c.x).toBeCloseTo(ME.x + 200 - ENGAGE_BLINK_STOP_SHORT, 6);
    expect(c.y).toBeCloseTo(ME.y, 6);
    expect(landing(s, c)).not.toBeNull();
    expect(cast("blaze", calm({ foe: foeAt(ENGAGE_BLINK_MIN_DISTANCE - 1) }))).toBeNull();
    expect(cast("blaze", calm({ foe: foeAt(BLAZE_RANGE - ENGAGE_RANGE_MARGIN + 1) }))).toBeNull();
    expect(cast("blaze", calm({ foe: foeAt(200, { mob: true }) }))).toBeNull();
    expect(cast("blaze", calm({ foe: foeAt(200, { targetable: false }) }))).toBeNull();
  });

  it("a blink with no valid landing toward the foe is not cast", () => {
    const s = calm({ map: pocketMap(), me: { x: 9.5 * TILE, y: 9.5 * TILE }, foe: { id: "foe", x: 9.5 * TILE + 200, y: 9.5 * TILE, d: 200, los: false, targetable: true } });
    expect(cast("blaze", s)).toBeNull();
  });
});

describe("one policy per intent covers every Wish", () => {
  it("each Wish has an intent the policy handles, and a situation in which it casts", () => {
    const wants: Record<FactionId, CastSituation> = {
      frost: calm({ foe: foeAt(200) }),
      plague: calm({ me: { hpFrac: 0.3, recentlyHit: true } }),
      sentenced: calm({ foe: foeAt(200) }),
      fire: calm({ me: { hpFrac: 0.4 }, threat: threatAt(150) }),
      holy: calm({ me: { hpFrac: 0.3, recentlyHit: true } }),
    };
    for (const [faction, id] of Object.entries(WISHES) as Array<[FactionId, AbilityId]>) {
      expect(cast(id, wants[faction]), `${faction}'s ${id}`).not.toBeNull();
      expect(cast(id, calm()), `${faction}'s ${id} at peace`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// BotClient: when it asks, and who it will not pick.

interface Sent { type: string; payload: Record<string, unknown> }

/** A bot with a stand-in room: its own player, an enemy, and what it sends. */
function rig(opts: { faction?: FactionId; wishReadyAt?: number; serverTime?: number } = {}): {
  bot: BotClient; me: PlayerState; foe: PlayerState; sent: Sent[]; state: { serverTime: number; gatesLocked: boolean; players: Map<string, PlayerState>; mobs: Map<string, unknown> };
} {
  const sent: Sent[] = [];
  const me = new PlayerState();
  me.faction = opts.faction ?? "sentenced";
  me.status = "alive";
  me.x = 640; me.y = 320; me.hp = me.maxHp = 100;
  me.weapon0 = "bow";
  me.wishReadyAt = opts.wishReadyAt ?? 0;
  const foe = new PlayerState();
  foe.faction = "fire";
  foe.status = "alive";
  foe.x = 840; foe.y = 320; foe.hp = foe.maxHp = 100;
  foe.weapon0 = "axe";
  const state = { serverTime: opts.serverTime ?? 10_000, gatesLocked: false, players: new Map([["me", me], ["foe", foe]]), mobs: new Map() };
  const bot = new BotClient();
  Object.assign(bot, { room: { sessionId: "me", state, send: (type: string, payload: Record<string, unknown>) => sent.push({ type, payload }) }, map: openMap() });
  return { bot, me, foe, sent, state };
}

const castWish = (bot: BotClient, me: PlayerState, foe: PlayerState | null, now: number): void => {
  const inner = bot as unknown as {
    foe: unknown; castWish(me: PlayerState, enemy: unknown, now: number): void;
  };
  inner.foe = foe ? { id: "foe", at: { x: foe.x, y: foe.y }, d: Math.hypot(foe.x - me.x, foe.y - me.y), theirs: "axe", mob: false } : null;
  inner.castWish(me, foe ? { id: "foe", p: foe, d: Math.hypot(foe.x - me.x, foe.y - me.y) } : null, now);
};

describe("BotClient casts its Wish", () => {
  it("sends one `cast` for the wish slot with the cursor point and the target, once the Wish is ready", () => {
    const { bot, me, foe, sent } = rig();
    castWish(bot, me, foe, 1_000_000);
    expect(sent).toEqual([{ type: "cast", payload: { slot: "wish", x: 840, y: 320, id: "foe" } }]);
    expect(bot.sent.cast).toBe(1);
  });

  it("waits for the synced ready time, by the server's clock", () => {
    const { bot, me, foe, sent, state } = rig({ wishReadyAt: 45_000, serverTime: 44_999 });
    castWish(bot, me, foe, 1_000_000);
    expect(sent).toEqual([]);
    state.serverTime = 45_000;
    castWish(bot, me, foe, 1_000_001);
    expect(sent).toHaveLength(1);
  });

  it("asks at most once a second, and asks again after it (a refused or fizzled cast cost nothing)", () => {
    const { bot, me, foe, sent } = rig();
    castWish(bot, me, foe, 1_000_000);
    castWish(bot, me, foe, 1_000_500);
    castWish(bot, me, foe, 1_000_999);
    expect(sent).toHaveLength(1);
    castWish(bot, me, foe, 1_001_000);
    expect(sent).toHaveLength(2);
  });

  it("does nothing when the policy says no: nobody to engage, or a stun on it", () => {
    const quiet = rig();
    castWish(quiet.bot, quiet.me, null, 1_000_000);
    expect(quiet.sent).toEqual([]);
    const stunned = rig();
    stunned.me.effects = EFFECT_STUNNED;
    castWish(stunned.bot, stunned.me, stunned.foe, 1_000_000);
    expect(stunned.sent).toEqual([]);
  });

  it("a self cast carries the bot's own position; a faction without a Wish casts nothing", () => {
    const swarm = rig({ faction: "plague" });
    swarm.me.hp = 30;
    (swarm.bot as unknown as { hitAt: number }).hitAt = 1_000_000 - 100;
    castWish(swarm.bot, swarm.me, swarm.foe, 1_000_000);
    expect(swarm.sent).toEqual([{ type: "cast", payload: { slot: "wish", x: 640, y: 320 } }]);
    const none = rig();
    none.me.faction = "";
    castWish(none.bot, none.me, none.foe, 1_000_000);
    expect(none.sent).toEqual([]);
  });

  it("hidden behind its own Swarm it walks away from the enemy and never locks it, which would reveal it again", () => {
    const { bot, me, foe, sent } = rig({ faction: "plague" });
    me.effects = EFFECT_HIDDEN;
    const inner = bot as unknown as { slipAway(me: PlayerState, enemy: unknown, now: number): boolean };
    const enemy = { id: "foe", p: foe, d: Math.hypot(foe.x - me.x, foe.y - me.y) };
    expect(inner.slipAway(me, enemy, 1_000_000)).toBe(false);
    expect(sent.map((m) => m.type)).not.toContain("target");
    const move = sent.find((m) => m.type === "move");
    expect(move).toBeDefined();
    // Farther from the enemy than where it stands.
    const to = move!.payload as { x: number; y: number };
    expect(Math.hypot(to.x - foe.x, to.y - foe.y)).toBeGreaterThan(enemy.d);
  });

  it("sends a hidden or untargetable enemy nothing: it never targets one", () => {
    const { bot, me, foe, sent } = rig();
    foe.effects = EFFECT_HIDDEN;
    const pick = (): unknown => (bot as unknown as { pickEnemy(me: PlayerState, now: number): unknown }).pickEnemy(me, 1_000_000);
    expect(pick()).toBeNull();
    foe.effects = EFFECT_UNTARGETABLE;
    expect(pick()).toBeNull();
    foe.effects = 0;
    expect(pick()).toMatchObject({ id: "foe" });
    expect(sent).toEqual([]);
  });
});
