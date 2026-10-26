// docs/BOTS.md 9.1: memory.ts finds the stimuli (2.4) and keeps the run's model (3.5): stimuli fire once, whereabouts grow and
// expire, the other slot is a belief, the Wish guess, camps clear from dots, a mob's hp is never refilled off screen, deaths are
// permanent, who is fighting whom, orderFailed / arrived, and the geometry of an incoming projectile.
import { describe, expect, it } from "vitest";
import { PLAYER_SPEED } from "@raid/shared";
import { createMemory } from "../../src/bots/brain/memory";
import {
  TIERS,
  type Command, type MemoryApi, type ObservedEvent, type Percept, type ProjectileView, type Stimulus, type StimulusKind, type TierId,
  type TimedCommand,
} from "../../src/bots/brain/types";
import { container, features, fighter, floorPoint, minimapMob, mobView, percept, selfView, testMap } from "./fixtures";

const ME = floorPoint(0);
const T0 = 100_000;

function mem(tier: TierId = "normal", f = features()): MemoryApi {
  return createMemory({ tier: TIERS[tier], map: testMap(), selfId: "me", features: f });
}

/** A percept at server time `t`, the bot standing at ME unless `self` says otherwise. */
function at(t: number, over: Partial<Percept> = {}): Percept {
  return percept({ now: t, ...over });
}

const kinds = (s: readonly Stimulus[]): StimulusKind[] => s.map((x) => x.kind);
const of = (s: readonly Stimulus[], kind: StimulusKind): Stimulus[] => s.filter((x) => x.kind === kind);

function hit(t: number, id: string, by: string | null, amount = 10): ObservedEvent {
  return { kind: "hit", t, at: null, id, by, amount, weapon: "sword", sig: null };
}
function windup(t: number, by: string, a: number, weapon: "sword" | "bow" | "wand" = "sword", ms = 100): ObservedEvent {
  return { kind: "windup", t, at: null, by, weapon, a, ms };
}
const cancel = (t: number, id: string): ObservedEvent => ({ kind: "cancel", t, at: null, id });
const death = (t: number, id: string, mob = false): ObservedEvent => ({ kind: "death", t, at: null, id, name: id, by: null, mob });
const toast = (t: number, text: string): ObservedEvent => ({ kind: "toast", t, at: null, text });
const ext = (t: number, fx: string, data: Record<string, unknown>): ObservedEvent => ({ kind: "ext", t, at: null, fx, data });

function sent(atMs: number, cmd: Command): TimedCommand {
  return { at: atMs, cmd, intent: cmd.type === "move" || cmd.type === "stop" || cmd.type === "target" ? cmd.type === "target" ? "lock" : cmd.type : "pickup", priority: 2, stimulus: null };
}

/** A ball 200 u east of the bot flying west along `dy` u off the bot's line. */
function ball(over: Partial<ProjectileView> = {}): ProjectileView {
  return { id: "p1", kind: "ball", x: ME.x + 200, y: ME.y, vx: -380, vy: 0, x0: ME.x + 220, y0: ME.y, t0: T0, range: 220, from: "foe", ...over };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

describe("newThreat and re-entry", () => {
  it("fires once for a foe that stays on screen", () => {
    const m = mem();
    const first = m.observe(at(T0, { fighters: [fighter()] }));
    expect(of(first, "newThreat")).toEqual([{ kind: "newThreat", at: T0, subject: "foe", central: true, value: 200 }]);
    expect(m.observe(at(T0 + 50, { fighters: [fighter()] }))).toEqual([]);
    expect(m.observe(at(T0 + 100, { fighters: [fighter()] }))).toEqual([]);
  });

  it("is not new again after a short trip off screen, and is after more than 3 s", () => {
    const m = mem();
    m.observe(at(T0, { fighters: [fighter()] }));
    m.observe(at(T0 + 1000, { fighters: [] }));
    expect(of(m.observe(at(T0 + 2000, { fighters: [fighter()] })), "newThreat")).toHaveLength(0);
    m.observe(at(T0 + 3000, { fighters: [] }));
    expect(of(m.observe(at(T0 + 7000, { fighters: [fighter()] })), "newThreat")).toHaveLength(1);
  });

  it("marks a foe outside the attention centre as not central", () => {
    const s = mem().observe(at(T0, { fighters: [fighter({ x: ME.x + 700 })] }));
    expect(of(s, "newThreat")[0]!.central).toBe(false);
    const near = mem().observe(at(T0, { fighters: [fighter({ x: ME.x + 300 })] }));
    expect(of(near, "newThreat")[0]!.central).toBe(true);
  });

  it("reveals a foe that vanished from the middle of the window (hidden) however briefly, only with Wishes on", () => {
    for (const hiding of [true, false]) {
      const m = mem("normal", features({ statusEffects: hiding }));
      m.observe(at(T0, { fighters: [fighter()], features: features({ statusEffects: hiding }) }));
      m.observe(at(T0 + 50, { fighters: [], features: features({ statusEffects: hiding }) }));
      const back = m.observe(at(T0 + 1000, { fighters: [fighter()], features: features({ statusEffects: hiding }) }));
      expect(of(back, "newThreat")).toHaveLength(hiding ? 1 : 0);
    }
  });

  it("does not take the foe walking off the edge for hidden", () => {
    const f = features({ statusEffects: true });
    const m = mem("normal", f);
    m.observe(at(T0, { fighters: [fighter({ x: ME.x + 790 })], features: f }));
    m.observe(at(T0 + 50, { fighters: [], features: f }));
    expect(of(m.observe(at(T0 + 500, { fighters: [fighter({ x: ME.x + 790 })], features: f })), "newThreat")).toHaveLength(0);
  });

  it("is not a threat when it is down", () => {
    const m = mem();
    expect(kinds(m.observe(at(T0, { fighters: [fighter({ status: "dead" })] })))).not.toContain("newThreat");
    expect(m.view.fighters.get("foe")!.alive).toBe(false);
  });

  it("decides nothing on the [BOT] flag", () => {
    const run = (bot: boolean) => {
      const m = mem();
      return [
        m.observe(at(T0, { fighters: [fighter({ bot })] })),
        m.observe(at(T0 + 50, { fighters: [fighter({ bot, inHand: "bow" })], events: [windup(T0, "foe", Math.PI)] })),
      ];
    };
    expect(run(true)).toEqual(run(false));
  });
});

describe("fighter memory", () => {
  it("tracks faction, position, velocity, hp and weapons", () => {
    const m = mem();
    m.observe(at(T0, { fighters: [fighter({ faction: "plague", x: ME.x + 250, y: ME.y + 30, vx: 5, vy: -6, hpFrac: 0.6, inHand: "bow", name: "Wren", bot: true })] }));
    const f = m.view.fighters.get("foe")!;
    expect(f).toMatchObject({ name: "Wren", bot: true, faction: "plague", inHand: "bow", weaponsSeen: ["bow"], seenAt: T0, hpFrac: 0.6, alive: true });
    expect(f.pos).toEqual({ x: ME.x + 250, y: ME.y + 30 });
    expect(f.vel).toEqual({ x: 5, y: -6 });
  });

  it("believes the other slot is the last different weapon it held, and says foeSwapped", () => {
    const m = mem();
    m.observe(at(T0, { fighters: [fighter({ inHand: "sword" })] }));
    expect(m.view.fighters.get("foe")!.otherSlot).toBeNull();
    const swapped = m.observe(at(T0 + 50, { fighters: [fighter({ inHand: "bow" })] }));
    expect(of(swapped, "foeSwapped")).toHaveLength(1);
    expect(m.view.fighters.get("foe")).toMatchObject({ inHand: "bow", otherSlot: "sword", weaponsSeen: ["sword", "bow"] });
    m.observe(at(T0 + 100, { fighters: [fighter({ inHand: "bow" })] }));
    expect(of(m.observe(at(T0 + 150, { fighters: [fighter({ inHand: "sword" })] })), "foeSwapped")).toHaveLength(1);
    expect(m.view.fighters.get("foe")).toMatchObject({ inHand: "sword", otherSlot: "bow", weaponsSeen: ["sword", "bow"] });
  });

  it("keeps the other-slot belief across an empty hand and across time off screen", () => {
    const m = mem();
    m.observe(at(T0, { fighters: [fighter({ inHand: "axe" })] }));
    m.observe(at(T0 + 50, { fighters: [fighter({ inHand: null })] }));
    m.observe(at(T0 + 100, { fighters: [fighter({ inHand: "wand" })] }));
    expect(m.view.fighters.get("foe")!.otherSlot).toBe("axe");
    m.observe(at(T0 + 10_000, { fighters: [] }));
    const back = m.observe(at(T0 + 20_000, { fighters: [fighter({ inHand: "axe" })] }));
    expect(m.view.fighters.get("foe")!.otherSlot).toBe("wand");
    expect(of(back, "foeSwapped")).toHaveLength(0);
  });

  it("forgets an opponent's hp 20 s after it was last read", () => {
    const m = mem();
    m.observe(at(T0, { fighters: [fighter({ hpFrac: 0.4 })] }));
    m.observe(at(T0 + 19_000, { fighters: [] }));
    expect(m.view.fighters.get("foe")!.hpFrac).toBe(0.4);
    m.observe(at(T0 + 21_000, { fighters: [] }));
    expect(m.view.fighters.get("foe")!.hpFrac).toBe(1);
  });

  it("reads the crown, and a bounty announcement", () => {
    const m = mem();
    m.observe(at(T0, { fighters: [fighter({ bounty: 6 })] }));
    expect(m.view.fighters.get("foe")!.bounty).toBe(6);
    expect(m.view.bounties.get("foe")).toBe(6);
    m.observe(at(T0 + 50, { fighters: [fighter({ bounty: 0 })] }));
    expect(m.view.fighters.get("foe")!.bounty).toBe(0);
    expect(m.view.bounties.has("foe")).toBe(false);

    const s = m.observe(at(T0 + 100, { fighters: [], events: [{ kind: "bounty", t: T0 + 90, at: null, id: "ghost", name: "Ghost", bounty: 10 }] }));
    expect(of(s, "announcement")).toEqual([{ kind: "announcement", at: T0 + 100, subject: "ghost", central: true, value: 10 }]);
    expect(m.view.bounties.get("ghost")).toBe(10);
    expect(m.view.fighters.get("ghost")).toMatchObject({ name: "Ghost", bounty: 10 });
    expect(m.view.whereabouts("ghost", T0 + 100)).toBeNull();
  });

  it("is the memory of a fighter that has not been seen: nothing to locate", () => {
    const m = mem();
    m.observe(at(T0, { fighters: [], events: [death(T0, "stranger")] }));
    expect(m.view.fighters.get("stranger")).toMatchObject({ alive: false, diedAt: T0 });
    expect(m.view.whereabouts("stranger", T0)).toBeNull();
  });

  it("flags a foe running at the bot as chasing, and nobody else", () => {
    const m = mem();
    const s = selfView();
    const toward = (vx: number, vy: number) => fighter({ x: s.x + 200, y: s.y, vx, vy });
    m.observe(at(T0, { fighters: [toward(-170, 0)] }));
    expect(m.view.fighters.get("foe")!.chasingMe).toBe(true);
    m.observe(at(T0 + 50, { fighters: [toward(0, 170)] }));
    expect(m.view.fighters.get("foe")!.chasingMe).toBe(false);
    m.observe(at(T0 + 100, { fighters: [toward(170, 0)] }));
    expect(m.view.fighters.get("foe")!.chasingMe).toBe(false);
    m.observe(at(T0 + 150, { fighters: [toward(0, 0)] }));
    expect(m.view.fighters.get("foe")!.chasingMe).toBe(false);
    m.observe(at(T0 + 200, { fighters: [toward(-120, 60)] }));
    expect(m.view.fighters.get("foe")!.chasingMe).toBe(true);
  });

  it("counts a windup cancelled while it faced the bot as a feint", () => {
    const m = mem();
    const f = [fighter()];
    m.observe(at(T0, { fighters: f, events: [windup(T0, "foe", Math.PI, "wand", 400)] }));
    m.observe(at(T0 + 100, { fighters: f, events: [cancel(T0 + 100, "foe")] }));
    expect(m.view.fighters.get("foe")).toMatchObject({ feints: 1, lastFeintAt: T0 + 100 });
    // A windup aimed elsewhere, and a cancel with no windup before it, are not feints at us.
    m.observe(at(T0 + 1000, { fighters: f, events: [windup(T0 + 1000, "foe", 0, "wand", 400)] }));
    m.observe(at(T0 + 1100, { fighters: f, events: [cancel(T0 + 1100, "foe")] }));
    m.observe(at(T0 + 1200, { fighters: f, events: [cancel(T0 + 1200, "foe")] }));
    expect(m.view.fighters.get("foe")!.feints).toBe(1);
    // Too long after the windup would have landed.
    m.observe(at(T0 + 2000, { fighters: f, events: [windup(T0 + 2000, "foe", Math.PI, "sword", 100)] }));
    m.observe(at(T0 + 3000, { fighters: f, events: [cancel(T0 + 3000, "foe")] }));
    expect(m.view.fighters.get("foe")!.feints).toBe(1);
  });

  it("guesses a Wish ready 300 s after it saw one land", () => {
    const m = mem();
    const s = m.observe(at(T0, { fighters: [fighter()], events: [ext(T0 - 50, "castLand", { by: "foe", ability: "x" })] }));
    expect(of(s, "castSeen")).toEqual([{ kind: "castSeen", at: T0, subject: "foe", central: true }]);
    expect(m.view.fighters.get("foe")).toMatchObject({ wishSeenAt: T0 - 50, wishReadyGuess: T0 - 50 + 300_000 });
    // Other fx kinds, and the bot's own casts, say nothing.
    const quiet = mem();
    expect(quiet.observe(at(T0, { fighters: [fighter()], events: [ext(T0, "cast", { by: "foe" }), ext(T0, "castLand", { by: "me" })] }))).not.toContainEqual(expect.objectContaining({ kind: "castSeen" }));
    expect(quiet.view.fighters.get("foe")!.wishSeenAt).toBeNull();
  });

  it("reads the caster from `by`, the real castLand field, and nothing else: a status fx names its target as `id`", () => {
    const m = mem();
    const f = [fighter(), fighter({ id: "other", x: ME.x - 200 })];
    m.observe(at(T0, { fighters: f, events: [
      // A Freeze on the other fighter, cast by foe: `id` of a status fx is who it landed on, not who cast.
      ext(T0 - 100, "status", { id: "other", status: "stun", ms: 1250, by: "foe" }),
      ext(T0 - 50, "castLand", { by: "foe", ability: "freeze", target: "other", x: ME.x - 200, y: ME.y }),
    ] }));
    expect(m.view.fighters.get("foe")).toMatchObject({ wishSeenAt: T0 - 50, wishReadyGuess: T0 - 50 + 300_000 });
    expect(m.view.fighters.get("other")!.wishSeenAt).toBeNull();
  });

  it("keeps the last cast the driver sent apart from the last order", () => {
    const m = mem();
    m.observe(at(T0, {}));
    m.noteSent(sent(T0 + 10, { type: "move", msg: { x: ME.x, y: ME.y + 100 } }));
    expect(m.view.self.lastCast ?? null).toBeNull();
    const cast = sent(T0 + 500, { type: "cast", msg: { slot: "wish", x: ME.x, y: ME.y } });
    m.noteSent(cast);
    expect(m.view.self.lastCast).toBe(cast);
    expect(m.view.self.lastOrder).toMatchObject({ cmd: { type: "move" } });
  });
});

describe("whereabouts", () => {
  it("is exact while seen and grows at 0.6 x PLAYER_SPEED per second off screen", () => {
    const m = mem();
    m.observe(at(T0, { fighters: [fighter({ x: ME.x + 300 })] }));
    expect(m.view.whereabouts("foe", T0)).toEqual({ at: { x: ME.x + 300, y: ME.y }, radius: 0 });
    const w = m.view.whereabouts("foe", T0 + 10_000)!;
    expect(w.at).toEqual({ x: ME.x + 300, y: ME.y });
    expect(w.radius).toBeCloseTo(0.6 * PLAYER_SPEED * 10, 9);
    expect(m.view.whereabouts("foe", T0 + 20_000)!.radius).toBeCloseTo(0.6 * PLAYER_SPEED * 20, 9);
  });

  it("expires after the tier's memory span, which differs per tier", () => {
    for (const tier of ["easy", "normal", "hard"] as const) {
      const m = mem(tier);
      m.observe(at(T0, { fighters: [fighter()] }));
      const span = TIERS[tier].memorySpanMs;
      expect(m.view.whereabouts("foe", T0 + span)).not.toBeNull();
      expect(m.view.whereabouts("foe", T0 + span + 1)).toBeNull();
    }
  });

  it("is null for the unknown and for the dead", () => {
    const m = mem();
    expect(m.view.whereabouts("nobody", T0)).toBeNull();
    m.observe(at(T0, { fighters: [fighter()] }));
    m.observe(at(T0 + 50, { fighters: [], events: [death(T0 + 50, "foe")] }));
    expect(m.view.whereabouts("foe", T0 + 100)).toBeNull();
  });
});

describe("deaths are permanent", () => {
  it("records the death, announces it once, and never revives the fighter", () => {
    const m = mem();
    m.observe(at(T0, { fighters: [fighter({ bounty: 4 })] }));
    const s = m.observe(at(T0 + 50, { fighters: [], events: [death(T0 + 40, "foe")] }));
    expect(of(s, "announcement")).toEqual([{ kind: "announcement", at: T0 + 50, subject: "foe", central: true }]);
    expect(m.view.fighters.get("foe")).toMatchObject({ alive: false, diedAt: T0 + 40, bounty: 0 });
    expect(m.view.bounties.has("foe")).toBe(false);

    // The very same fighter drawn alive again (a stale frame) changes nothing and is no threat.
    const again = m.observe(at(T0 + 100, { fighters: [fighter()] }));
    expect(kinds(again)).not.toContain("newThreat");
    expect(m.view.fighters.get("foe")).toMatchObject({ alive: false, diedAt: T0 + 40 });
    expect(m.view.whereabouts("foe", T0 + 100)).toBeNull();
    // A second word of the same death does not move the time of it.
    m.observe(at(T0 + 200, { fighters: [], events: [death(T0 + 190, "foe")] }));
    expect(m.view.fighters.get("foe")!.diedAt).toBe(T0 + 40);
  });

  it("takes a drawn status of dead or mia as a death too", () => {
    const m = mem();
    m.observe(at(T0, { fighters: [fighter({ status: "alive" })] }));
    m.observe(at(T0 + 50, { fighters: [fighter({ status: "mia" })] }));
    expect(m.view.fighters.get("foe")).toMatchObject({ alive: false, diedAt: T0 + 50 });
  });
});

describe("engagedWith", () => {
  const two = [fighter({ id: "a", x: ME.x + 300 }), fighter({ id: "b", x: ME.x + 340 })];

  it("needs two other fighters trading blows within 3 s", () => {
    const m = mem();
    m.observe(at(T0, { fighters: two, events: [hit(T0, "b", "a")] }));
    expect(m.view.fighters.get("a")!.engagedWith).toBeNull();
    m.observe(at(T0 + 1000, { fighters: two, events: [hit(T0 + 1000, "a", "b")] }));
    expect(m.view.fighters.get("a")).toMatchObject({ engagedWith: "b", engagedAt: T0 + 1000 });
    expect(m.view.fighters.get("b")).toMatchObject({ engagedWith: "a", engagedAt: T0 + 1000 });
  });

  it("does not link blows more than 3 s apart, or hits on the bot, or on a stranger", () => {
    const m = mem();
    m.observe(at(T0, { fighters: two, events: [hit(T0, "b", "a")] }));
    m.observe(at(T0 + 3500, { fighters: two, events: [hit(T0 + 3500, "a", "b")] }));
    m.observe(at(T0 + 3600, { fighters: two, events: [hit(T0 + 3600, "me", "a"), hit(T0 + 3600, "b", "me"), hit(T0 + 3600, "nobody", "a")] }));
    expect(m.view.fighters.get("a")!.engagedWith).toBeNull();
    expect(m.view.fighters.get("b")!.engagedWith).toBeNull();
  });

  it("counts a block as a blow", () => {
    const m = mem();
    m.observe(at(T0, { fighters: two, events: [hit(T0, "b", "a"), { kind: "block", t: T0 + 500, at: null, id: "a", by: "b", weapon: "shield" }] }));
    expect(m.view.fighters.get("a")!.engagedWith).toBe("b");
  });
});

describe("windups and draws at the bot", () => {
  const foe = [fighter()];

  it("sees a windup aimed at it, within 400 u, as windupAtMe with the time it has left", () => {
    const m = mem();
    const s = m.observe(at(T0, { fighters: foe, events: [windup(T0 - 100, "foe", Math.PI, "wand", 400)] }));
    expect(of(s, "windupAtMe")).toEqual([{ kind: "windupAtMe", at: T0, subject: "foe", central: true, value: 300 }]);
  });

  it("ignores a windup aimed away, aimed past it, or from too far", () => {
    const m = mem();
    expect(m.observe(at(T0, { fighters: foe, events: [windup(T0, "foe", 0)] }))).not.toContainEqual(expect.objectContaining({ kind: "windupAtMe" }));
    expect(m.observe(at(T0 + 50, { fighters: foe, events: [windup(T0 + 50, "foe", Math.PI + 0.9)] }))).not.toContainEqual(expect.objectContaining({ kind: "windupAtMe" }));
    const far = [fighter({ x: ME.x + 450 })];
    expect(m.observe(at(T0 + 100, { fighters: far, events: [windup(T0 + 100, "foe", Math.PI)] }))).not.toContainEqual(expect.objectContaining({ kind: "windupAtMe" }));
  });

  it("calls a bow's windup a drawAtMe, and a draw read off drawStartedAt too, once per draw", () => {
    const m = mem();
    const first = m.observe(at(T0, { fighters: [fighter({ inHand: "bow", drawStartedAt: T0 - 50 })], events: [windup(T0 - 50, "foe", Math.PI, "bow", 600)] }));
    expect(of(first, "drawAtMe")).toHaveLength(1);
    expect(of(first, "windupAtMe")).toHaveLength(0);
    expect(m.observe(at(T0 + 50, { fighters: [fighter({ inHand: "bow", drawStartedAt: T0 - 50 })] }))).toEqual([]);

    const bare = mem();
    expect(of(bare.observe(at(T0, { fighters: [fighter({ inHand: "bow", drawStartedAt: T0 - 100, facing: Math.PI })] })), "drawAtMe")).toHaveLength(1);
    const next = bare.observe(at(T0 + 900, { fighters: [fighter({ inHand: "bow", drawStartedAt: T0 + 800, facing: Math.PI })] }));
    expect(of(next, "drawAtMe")).toHaveLength(1);
    const away = mem();
    expect(of(away.observe(at(T0, { fighters: [fighter({ inHand: "bow", drawStartedAt: T0 - 100, facing: 0 })] })), "drawAtMe")).toHaveLength(0);
  });

  it("also sees a mob's windup", () => {
    const m = mem();
    const mob = mobView({ id: "mob9", x: ME.x + 150 });
    const s = m.observe(at(T0, { mobs: [mob], events: [windup(T0, "mob9", Math.PI, "wand", 400)] }));
    expect(of(s, "windupAtMe")).toMatchObject([{ subject: "mob9" }]);
  });
});

describe("incoming projectiles", () => {
  it("fires for a ball on a hitting course, once, with the time to impact from the drawn position", () => {
    const m = mem();
    const s = m.observe(at(T0, { projectiles: [ball()] }));
    const inc = of(s, "incoming");
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ subject: "p1", central: true });
    // It enters the 26 u hit circle (RANGED_HIT_REACH + PLAYER_RADIUS) after flying 174 u at 380 u/s.
    expect(inc[0]!.value).toBeCloseTo(((200 - 26) / 380) * 1000, 6);
    expect(m.observe(at(T0 + 50, { projectiles: [ball({ x: ME.x + 180 })] }))).toEqual([]);
  });

  it("fires for a course that clips the hit circle and not for one that misses it", () => {
    for (const [dy, hits] of [[0, true], [20, true], [25, true], [27, false], [80, false], [-80, false]] as const) {
      const s = mem().observe(at(T0, { projectiles: [ball({ y: ME.y + dy, y0: ME.y + dy })] }));
      expect(of(s, "incoming").length, `offset ${dy}`).toBe(hits ? 1 : 0);
    }
  });

  it("ignores a projectile flying away, one that has passed, one too short to arrive, and the bot's own", () => {
    const m = mem();
    const s = m.observe(at(T0, {
      projectiles: [
        ball({ id: "away", vx: 380 }),
        ball({ id: "passed", x: ME.x - 100, x0: ME.x + 120, range: 220 }),
        ball({ id: "short", x0: ME.x + 240, range: 120 }),
        ball({ id: "mine", from: "me" }),
        ball({ id: "still", vx: 0, vy: 0 }),
      ],
    }));
    expect(of(s, "incoming")).toEqual([]);
  });

  it("fires when the bot walks into a course it was missing, and when a ball is already on it", () => {
    const m = mem();
    const miss = ball({ y: ME.y + 60, y0: ME.y + 60 });
    expect(m.observe(at(T0, { projectiles: [miss] }))).toEqual([]);
    const moved = m.observe(at(T0 + 50, { self: selfView({ y: ME.y + 55 }), projectiles: [{ ...miss, x: ME.x + 180 }] }));
    expect(of(moved, "incoming")).toHaveLength(1);
    const onMe = mem().observe(at(T0, { projectiles: [ball({ x: ME.x + 10, x0: ME.x + 100, range: 220 })] }));
    expect(of(onMe, "incoming")[0]!.value).toBe(0);
  });

  it("marks a ball in the periphery as not central", () => {
    const s = mem().observe(at(T0, { projectiles: [ball({ x: ME.x + 700, x0: ME.x + 720, range: 800 })] }));
    expect(of(s, "incoming")[0]!.central).toBe(false);
  });
});

describe("self memory and hp stimuli", () => {
  it("records hits taken, by whom, and the last 3 s of them", () => {
    const m = mem();
    const s = m.observe(at(T0, { fighters: [fighter()], events: [hit(T0 - 100, "me", "foe", 12)] }));
    expect(of(s, "hpLoss")).toEqual([{ kind: "hpLoss", at: T0, subject: "foe", central: true, value: 12 }]);
    expect(m.view.self).toMatchObject({ lastHitAt: T0 - 100, lastHitByPlayerAt: T0 - 100, recentDamage: 12 });
    expect(m.view.fighters.get("foe")).toMatchObject({ hitMeAt: T0 - 100, damageToMe: 12 });
    m.observe(at(T0 + 1000, { fighters: [fighter()], events: [hit(T0 + 900, "me", null, 5)] }));
    expect(m.view.self.recentDamage).toBe(17);
    expect(m.view.self.recentHits.map((h) => h.by)).toEqual(["foe", null]);
    m.observe(at(T0 + 3200, { fighters: [fighter()] }));
    expect(m.view.self.recentHits.map((h) => h.amount)).toEqual([5]);
    expect(m.view.self.lastHitAt).toBe(T0 + 900);
  });

  it("only a visible or known fighter makes a hit a player's", () => {
    const m = mem();
    m.observe(at(T0, { mobs: [mobView({ id: "mob1" })], events: [hit(T0, "me", "mob1", 7)] }));
    expect(m.view.self.lastHitAt).toBe(T0);
    expect(m.view.self.lastHitByPlayerAt).toBeNull();
    m.observe(at(T0 + 50, { events: [hit(T0 + 50, "me", null, 7)] }));
    expect(m.view.self.lastHitByPlayerAt).toBeNull();
  });

  it("records damage dealt, on a player and on anything else", () => {
    const m = mem();
    m.observe(at(T0, { fighters: [fighter()], events: [hit(T0, "foe", "me", 9)] }));
    expect(m.view.self.lastDealtAt).toBe(T0);
    expect(m.view.fighters.get("foe")).toMatchObject({ hitByMeAt: T0, damageByMe: 9 });
    m.observe(at(T0 + 500, { mobs: [mobView()], events: [hit(T0 + 500, "mob1", "me", 9)] }));
    expect(m.view.self.lastDealtAt).toBe(T0 + 500);
  });

  it("reports one hpLoss per hit whether the bar or the fx comes first, and none for a small burn", () => {
    const m = mem();
    m.observe(at(T0, { self: selfView({ hp: 100 }) }));
    const drop = m.observe(at(T0 + 50, { self: selfView({ hp: 70 }) }));
    expect(of(drop, "hpLoss")).toMatchObject([{ value: 30 }]);
    const late = m.observe(at(T0 + 150, { self: selfView({ hp: 70 }), events: [hit(T0 + 50, "me", null, 30)] }));
    expect(of(late, "hpLoss")).toEqual([]);

    const fxFirst = mem();
    fxFirst.observe(at(T0, { self: selfView({ hp: 100 }) }));
    expect(of(fxFirst.observe(at(T0 + 50, { self: selfView({ hp: 100 }), events: [hit(T0 + 40, "me", null, 20)] })), "hpLoss")).toMatchObject([{ value: 20 }]);
    expect(of(fxFirst.observe(at(T0 + 100, { self: selfView({ hp: 80 }) })), "hpLoss")).toEqual([]);

    const both = mem();
    both.observe(at(T0, { self: selfView({ hp: 100 }) }));
    expect(of(both.observe(at(T0 + 50, { self: selfView({ hp: 85 }), events: [hit(T0 + 40, "me", null, 15)] })), "hpLoss")).toMatchObject([{ value: 15 }]);

    const burn = mem();
    let hp = 100;
    burn.observe(at(T0, { self: selfView({ hp }) }));
    for (let i = 1; i <= 10; i++) {
      hp -= 0.1;
      expect(of(burn.observe(at(T0 + i * 50, { self: selfView({ hp }) })), "hpLoss")).toEqual([]);
    }
  });

  it("two hits a second apart are two stimuli", () => {
    const m = mem();
    m.observe(at(T0, {}));
    expect(of(m.observe(at(T0 + 50, { events: [hit(T0 + 40, "me", null, 5)] })), "hpLoss")).toHaveLength(1);
    expect(of(m.observe(at(T0 + 1050, { events: [hit(T0 + 1040, "me", null, 5)] })), "hpLoss")).toHaveLength(1);
  });

  it("says lowHp once, when the hp share crosses below a half", () => {
    const m = mem();
    m.observe(at(T0, { self: selfView({ hp: 60 }) }));
    const s = m.observe(at(T0 + 50, { self: selfView({ hp: 49 }) }));
    expect(of(s, "lowHp")).toEqual([{ kind: "lowHp", at: T0 + 50, subject: null, central: true, value: 0.49 }]);
    expect(of(m.observe(at(T0 + 100, { self: selfView({ hp: 30 }) })), "lowHp")).toEqual([]);
    m.observe(at(T0 + 150, { self: selfView({ hp: 90 }) }));
    expect(of(m.observe(at(T0 + 200, { self: selfView({ hp: 40 }) })), "lowHp")).toHaveLength(1);
  });

  it("knows when the bot stopped moving", () => {
    const m = mem();
    m.observe(at(T0, {}));
    expect(m.view.self.stillSince).toBe(T0);
    m.observe(at(T0 + 500, { self: selfView({ x: ME.x + 0.5 }) }));
    expect(m.view.self.stillSince).toBe(T0);
    m.observe(at(T0 + 1000, { self: selfView({ x: ME.x + 30 }) }));
    expect(m.view.self.stillSince).toBe(T0 + 1000);
    m.observe(at(T0 + 1500, { self: selfView({ x: ME.x + 30 }) }));
    expect(m.view.self.stillSince).toBe(T0 + 1000);
  });

  it("notes the teleport and announces it", () => {
    const m = mem();
    const s = m.observe(at(T0, { events: [{ kind: "teleport", t: T0 - 60, at: null }] }));
    expect(of(s, "teleport")).toEqual([{ kind: "teleport", at: T0, subject: null, central: true }]);
    expect(m.view.self.teleportedAt).toBe(T0 - 60);
  });

  it("announces a victory", () => {
    const s = mem().observe(at(T0, { events: [{ kind: "victory", t: T0, at: null, id: "foe", name: "Foe", draw: false }] }));
    expect(of(s, "announcement")).toMatchObject([{ subject: "foe" }]);
  });

  it("shows a dead bot the announcements only", () => {
    const m = mem();
    const s = m.observe(at(T0, { self: selfView({ status: "dead", hp: 0 }), fighters: [fighter()], events: [hit(T0, "me", "foe"), death(T0, "other")] }));
    expect(kinds(s)).toEqual(["announcement"]);
  });
});

describe("the lock", () => {
  const locked = (t: number, target: string | null, over: Partial<Percept> = {}) => at(t, { self: selfView({ attackTarget: target }), ...over });

  it("says lockLost when the lock went to nothing and the target is alive on screen", () => {
    const m = mem();
    m.observe(locked(T0, "foe", { fighters: [fighter()] }));
    const s = m.observe(locked(T0 + 50, null, { fighters: [fighter()] }));
    expect(of(s, "lockLost")).toEqual([{ kind: "lockLost", at: T0 + 50, subject: "foe", central: true }]);
    expect(m.observe(locked(T0 + 100, null, { fighters: [fighter()] }))).toEqual([]);
  });

  it("says targetDown when the target died", () => {
    const m = mem();
    m.observe(locked(T0, "foe", { fighters: [fighter()] }));
    const s = m.observe(locked(T0 + 50, null, { fighters: [], events: [death(T0 + 40, "foe")] }));
    expect(kinds(s)).toContain("targetDown");
    expect(kinds(s)).not.toContain("lockLost");
    expect(of(s, "targetDown")[0]!.subject).toBe("foe");
  });

  it("waits for the death fx of a target that was nearly dead before calling it a lost lock", () => {
    const m = mem();
    m.observe(locked(T0, "foe", { fighters: [fighter({ hpFrac: 0.05 })] }));
    // The HUD drops the lock before the world shows the kill.
    expect(m.observe(locked(T0 + 50, null, { fighters: [fighter({ hpFrac: 0.05 })] }))).toEqual([]);
    const s = m.observe(locked(T0 + 100, null, { fighters: [], events: [death(T0 + 90, "foe")] }));
    expect(kinds(s)).toContain("targetDown");
    expect(kinds(s)).not.toContain("lockLost");

    const survives = mem();
    survives.observe(locked(T0, "foe", { fighters: [fighter({ hpFrac: 0.05 })] }));
    survives.observe(locked(T0 + 50, null, { fighters: [fighter({ hpFrac: 0.05 })] }));
    expect(of(survives.observe(locked(T0 + 400, null, { fighters: [fighter({ hpFrac: 0.05 })] })), "lockLost")).toMatchObject([{ at: T0 + 50 }]);
  });

  it("says targetDown for a mob that died", () => {
    const m = mem();
    m.observe(locked(T0, "mob1", { mobs: [mobView()] }));
    const s = m.observe(locked(T0 + 50, null, { mobs: [], events: [death(T0 + 50, "mob1", true)] }));
    expect(of(s, "targetDown")).toHaveLength(1);
  });

  it("says nothing when the bot's own move or stop dropped it, or when it switched target", () => {
    const m = mem();
    m.observe(locked(T0, "foe", { fighters: [fighter()] }));
    m.noteSent(sent(T0 + 10, { type: "move", msg: { x: ME.x, y: ME.y + 100 } }));
    expect(m.observe(locked(T0 + 100, null, { fighters: [fighter()] }))).toEqual([]);

    const sw = mem();
    sw.observe(locked(T0, "foe", { fighters: [fighter(), fighter({ id: "other" })] }));
    expect(sw.observe(locked(T0 + 50, "other", { fighters: [fighter(), fighter({ id: "other" })] }))).toEqual([]);
  });
});

describe("orderFailed and arrived", () => {
  const moveTo = { x: ME.x + 300, y: ME.y };

  it("fails a move whose seq never comes back after 400 ms, once", () => {
    const m = mem();
    m.observe(at(T0, { self: selfView({ moveSeq: 3 }) }));
    m.noteSent(sent(T0 + 10, { type: "move", msg: { ...moveTo, seq: 4 } }));
    expect(m.observe(at(T0 + 400, { self: selfView({ moveSeq: 3 }) }))).toEqual([]);
    const s = m.observe(at(T0 + 410, { self: selfView({ moveSeq: 3 }) }));
    expect(of(s, "orderFailed")).toEqual([{ kind: "orderFailed", at: T0 + 410, subject: null, central: true }]);
    expect(m.observe(at(T0 + 600, { self: selfView({ moveSeq: 3 }) }))).toEqual([]);
  });

  it("takes a move as applied once its seq shows, even if the bot has not moved yet", () => {
    const m = mem();
    m.observe(at(T0, { self: selfView({ moveSeq: 3 }) }));
    m.noteSent(sent(T0 + 10, { type: "move", msg: { ...moveTo, seq: 4 } }));
    m.observe(at(T0 + 200, { self: selfView({ moveSeq: 4 }) }));
    expect(m.observe(at(T0 + 900, { self: selfView({ moveSeq: 4 }) }))).toEqual([]);
  });

  it("without a seq, a changed moveSeq or a few units walked counts as applied", () => {
    const walked = mem();
    walked.observe(at(T0, {}));
    walked.noteSent(sent(T0 + 10, { type: "move", msg: moveTo }));
    expect(walked.observe(at(T0 + 600, { self: selfView({ x: ME.x + 20 }) }))).toEqual([]);

    const stuck = mem();
    stuck.observe(at(T0, {}));
    stuck.noteSent(sent(T0 + 10, { type: "move", msg: moveTo }));
    expect(of(stuck.observe(at(T0 + 600, {})), "orderFailed")).toHaveLength(1);
  });

  it("fails a stop whose seq does not show", () => {
    const m = mem();
    m.observe(at(T0, { self: selfView({ moveSeq: 9 }) }));
    m.noteSent(sent(T0, { type: "stop", msg: { seq: 10 } }));
    expect(of(m.observe(at(T0 + 450, { self: selfView({ moveSeq: 9 }) })), "orderFailed")).toHaveLength(1);
    const ok = mem();
    ok.observe(at(T0, { self: selfView({ moveSeq: 9 }) }));
    ok.noteSent(sent(T0, { type: "stop", msg: { seq: 10 } }));
    expect(ok.observe(at(T0 + 450, { self: selfView({ moveSeq: 10 }) }))).toEqual([]);
  });

  it("fails a target order whose lock never shows, and not one that locked then dropped", () => {
    const m = mem();
    m.observe(at(T0, { fighters: [fighter()] }));
    m.noteSent(sent(T0 + 10, { type: "target", msg: { id: "foe" } }));
    const s = m.observe(at(T0 + 450, { fighters: [fighter()] }));
    expect(of(s, "orderFailed")).toMatchObject([{ subject: "foe" }]);

    const ok = mem();
    ok.observe(at(T0, { fighters: [fighter()] }));
    ok.noteSent(sent(T0 + 10, { type: "target", msg: { id: "foe" } }));
    ok.observe(at(T0 + 150, { self: selfView({ attackTarget: "foe" }), fighters: [fighter()] }));
    expect(of(ok.observe(at(T0 + 600, { self: selfView({ attackTarget: null }), fighters: [fighter()] })), "orderFailed")).toEqual([]);
  });

  it("does not blame the teleport for a lost lock or a walk it wiped", () => {
    const coliseum = { ...at(T0).hud, inColiseum: true };
    const lock = mem();
    lock.observe(at(T0, { self: selfView({ attackTarget: "foe" }), fighters: [fighter()] }));
    expect(lock.observe(at(T0 + 50, { self: selfView({ attackTarget: null }), hud: coliseum, fighters: [fighter()] }))).toEqual([]);

    const walk = mem();
    walk.observe(at(T0, { self: selfView({ moveSeq: 1 }) }));
    walk.noteSent(sent(T0 + 10, { type: "move", msg: { x: ME.x, y: ME.y + 200, seq: 2 } }));
    walk.observe(at(T0 + 100, { self: selfView({ moveSeq: 1 }), hud: coliseum }));
    expect(walk.observe(at(T0 + 900, { self: selfView({ moveSeq: 1 }), hud: coliseum }))).toEqual([]);
  });

  it("a newer order replaces the one being watched", () => {
    const m = mem();
    m.observe(at(T0, {}));
    m.noteSent(sent(T0, { type: "move", msg: { ...moveTo, seq: 1 } }));
    m.noteSent(sent(T0 + 300, { type: "move", msg: { x: ME.x - 200, y: ME.y, seq: 2 } }));
    expect(m.observe(at(T0 + 500, { self: selfView({ moveSeq: 0 }) }))).toEqual([]);
    expect(m.view.self.lastOrder?.cmd).toMatchObject({ type: "move", msg: { seq: 2 } });
  });

  it("says arrived once the bot is within 24 u of its last move", () => {
    const m = mem();
    m.observe(at(T0, {}));
    m.noteSent(sent(T0, { type: "move", msg: { ...moveTo, seq: 1 } }));
    expect(m.observe(at(T0 + 500, { self: selfView({ moveSeq: 1, x: ME.x + 100 }) }))).toEqual([]);
    const s = m.observe(at(T0 + 1000, { self: selfView({ moveSeq: 1, x: ME.x + 280 }) }));
    expect(of(s, "arrived")).toEqual([{ kind: "arrived", at: T0 + 1000, subject: null, central: true }]);
    expect(m.observe(at(T0 + 1050, { self: selfView({ moveSeq: 1, x: ME.x + 290 }) }))).toEqual([]);
  });

  it("does not say arrived for a stop or a target", () => {
    const m = mem();
    m.observe(at(T0, {}));
    m.noteSent(sent(T0, { type: "stop", msg: { seq: 1 } }));
    expect(kinds(m.observe(at(T0 + 100, { self: selfView({ moveSeq: 1 }) })))).not.toContain("arrived");
  });
});

describe("mobs", () => {
  const camp = testMap().camps[0]!;
  const spot = camp.spots[0]!;

  it("takes its home from the first dot and its camp from the nearest spot", () => {
    const m = mem();
    m.observe(at(T0, { minimap: { t: T0, gatesLocked: false, mobs: [minimapMob({ id: "a", x: spot.x, y: spot.y, faction: camp.zone })] } }));
    const a = m.view.mobs.get("a")!;
    expect(a).toMatchObject({ kind: "mob", faction: camp.zone, home: { x: spot.x, y: spot.y }, campId: camp.id, alive: true, hpFrac: 1, awake: false, returning: false, seenAt: null, dotAt: T0 });
  });

  it("leaves campId null for a dot far from every spot, and marks an elite dot", () => {
    const m = mem();
    const w = floorPoint(1);
    m.observe(at(T0, { minimap: { t: T0, gatesLocked: false, mobs: [minimapMob({ id: "wild", x: w.x, y: w.y, elite: true })] } }));
    expect(m.view.mobs.get("wild")).toMatchObject({ kind: "elite", campId: null });
  });

  it("is awake when its dot is more than 24 u off its home, and settles when it returns", () => {
    const m = mem();
    const dot = (x: number, t: number) => at(t, { minimap: { t, gatesLocked: false, mobs: [minimapMob({ id: "a", x, y: spot.y })] } });
    m.observe(dot(spot.x, T0));
    m.observe(dot(spot.x + 16, T0 + 100));
    expect(m.view.mobs.get("a")!.awake).toBe(false);
    m.observe(dot(spot.x + 48, T0 + 200));
    expect(m.view.mobs.get("a")!.awake).toBe(true);
    expect(m.view.mobs.get("a")!.home).toEqual({ x: spot.x, y: spot.y });
    m.observe(dot(spot.x, T0 + 300));
    expect(m.view.mobs.get("a")!.awake).toBe(false);
  });

  it("holds its hp at the last value seen on screen and never refills it off screen", () => {
    const m = mem();
    const dot = (t: number, mobs: readonly ReturnType<typeof mobView>[] = []) =>
      at(t, { mobs, minimap: { t, gatesLocked: false, mobs: [minimapMob({ id: "mob1", x: spot.x, y: spot.y })] } });
    m.observe(dot(T0));
    expect(m.view.mobs.get("mob1")!.hpFrac).toBe(1);
    m.observe(dot(T0 + 100, [mobView({ id: "mob1", x: spot.x, y: spot.y, hpFrac: 0.45 })]));
    expect(m.view.mobs.get("mob1")).toMatchObject({ hpFrac: 0.45, seenAt: T0 + 100 });
    for (let i = 2; i < 200; i++) m.observe(dot(T0 + i * 100));
    expect(m.view.mobs.get("mob1")).toMatchObject({ hpFrac: 0.45, seenAt: T0 + 100, alive: true });
  });

  it("takes a rise in hp away from its spot for walking home, until it arrives or is hurt", () => {
    const m = mem();
    const away = { x: spot.x + 100, y: spot.y };
    const see = (t: number, hp: number, pos = away) =>
      m.observe(at(t, { mobs: [mobView({ id: "mob1", x: pos.x, y: pos.y, hpFrac: hp })], minimap: { t, gatesLocked: false, mobs: [minimapMob({ id: "mob1", x: spot.x, y: spot.y })] } }));
    see(T0, 1, { x: spot.x, y: spot.y });
    see(T0 + 100, 0.5, away);
    expect(m.view.mobs.get("mob1")).toMatchObject({ awake: true, returning: false });
    see(T0 + 200, 0.51, away);
    expect(m.view.mobs.get("mob1")!.returning).toBe(false);
    see(T0 + 300, 0.6, away);
    expect(m.view.mobs.get("mob1")).toMatchObject({ returning: true, awake: false });
    // It stays flagged while off screen on the way, and clears on arrival.
    m.observe(at(T0 + 5000, { minimap: { t: T0 + 5000, gatesLocked: false, mobs: [minimapMob({ id: "mob1", x: spot.x + 64, y: spot.y })] } }));
    expect(m.view.mobs.get("mob1")!.returning).toBe(true);
    m.observe(at(T0 + 6000, { minimap: { t: T0 + 6000, gatesLocked: false, mobs: [minimapMob({ id: "mob1", x: spot.x, y: spot.y })] } }));
    expect(m.view.mobs.get("mob1")!.returning).toBe(false);

    const hurt = mem();
    const view = (t: number, hp: number) =>
      hurt.observe(at(t, { mobs: [mobView({ id: "m", x: away.x, y: away.y, hpFrac: hp })], minimap: { t, gatesLocked: false, mobs: [minimapMob({ id: "m", x: spot.x, y: spot.y })] } }));
    view(T0, 0.5);
    view(T0 + 100, 0.5);
    view(T0 + 150, 0.7);
    expect(hurt.view.mobs.get("m")!.returning).toBe(true);
    view(T0 + 200, 0.6);
    expect(hurt.view.mobs.get("m")!.returning).toBe(false);
  });

  it("is dead once its dot is gone or a death fx names it, and stays dead", () => {
    const m = mem();
    const dots = (t: number, ids: string[]) =>
      at(t, { minimap: { t, gatesLocked: false, mobs: ids.map((id) => minimapMob({ id, x: spot.x, y: spot.y })) } });
    m.observe(dots(T0, ["a", "b"]));
    m.observe(dots(T0 + 100, ["b"]));
    expect(m.view.mobs.get("a")!.alive).toBe(false);
    expect(m.view.mobs.get("b")!.alive).toBe(true);
    m.observe(dots(T0 + 200, ["a", "b"]));
    expect(m.view.mobs.get("a")!.alive).toBe(false);
    m.observe(at(T0 + 300, { minimap: { t: T0 + 200, gatesLocked: false, mobs: [] }, events: [death(T0 + 300, "b", true)] }));
    expect(m.view.mobs.get("b")!.alive).toBe(false);
  });

  it("does not judge a mob by the minimap until the minimap repaints", () => {
    const m = mem();
    m.observe(at(T0, { minimap: { t: T0, gatesLocked: false, mobs: [minimapMob({ id: "a", x: spot.x, y: spot.y })] } }));
    m.observe(at(T0 + 50, { minimap: { t: T0, gatesLocked: false, mobs: [] } }));
    expect(m.view.mobs.get("a")!.alive).toBe(true);
  });

  it("ignores training dummies and notes a mob that is drawn dead", () => {
    const m = mem();
    m.observe(at(T0, { mobs: [mobView({ id: "dummy1", kind: "dummy" }), mobView({ id: "mob2", status: "dead" })] }));
    expect(m.view.mobs.has("dummy1")).toBe(false);
    expect(m.view.mobs.get("mob2")!.alive).toBe(false);
  });
});

describe("camps", () => {
  const camp = testMap().camps[0]!;
  const dotsOf = (n: number) => camp.spots.slice(0, n).map((s, i) => minimapMob({ id: `${camp.id}#${i}`, x: s.x, y: s.y, elite: camp.eliteSpot === i }));

  it("counts living dots on its spots and says cleared when the last one goes", () => {
    const m = mem();
    const total = camp.spots.length;
    m.observe(at(T0, { minimap: { t: T0, gatesLocked: false, mobs: dotsOf(total) } }));
    expect(m.view.camps.get(camp.id)).toMatchObject({ aliveSeen: total, clearedAt: null, zone: camp.zone, elite: camp.eliteSpot >= 0 });
    m.observe(at(T0 + 1000, { minimap: { t: T0 + 1000, gatesLocked: false, mobs: dotsOf(2) } }));
    expect(m.view.camps.get(camp.id)).toMatchObject({ aliveSeen: 2, clearedAt: null });
    m.observe(at(T0 + 2000, { minimap: { t: T0 + 2000, gatesLocked: false, mobs: [] } }));
    expect(m.view.camps.get(camp.id)).toMatchObject({ aliveSeen: 0, clearedAt: T0 + 2000 });
    m.observe(at(T0 + 3000, { minimap: { t: T0 + 3000, gatesLocked: false, mobs: [] } }));
    expect(m.view.camps.get(camp.id)!.clearedAt).toBe(T0 + 2000);
  });

  it("is not cleared if no mob was ever seen on it, and other camps are unaffected", () => {
    const m = mem();
    m.observe(at(T0, { minimap: { t: T0, gatesLocked: false, mobs: dotsOf(3) } }));
    expect(m.view.camps.size).toBe(testMap().camps.length);
    const other = testMap().camps.find((c) => c.id !== camp.id)!;
    expect(m.view.camps.get(other.id)).toMatchObject({ aliveSeen: 0, clearedAt: null });
  });

  it("is contested when another player is seen inside it, and visited when the bot was within 150 u", () => {
    const m = mem();
    const there = { x: camp.x, y: camp.y };
    m.observe(at(T0, { self: selfView({ x: there.x + 120, y: there.y }), fighters: [fighter({ x: there.x + 40, y: there.y + 40 })] }));
    expect(m.view.camps.get(camp.id)).toMatchObject({ contestedAt: T0, visitedAt: T0 });
    m.observe(at(T0 + 5000, { self: selfView({ x: there.x + 400, y: there.y }) }));
    expect(m.view.camps.get(camp.id)).toMatchObject({ contestedAt: T0, visitedAt: T0 });
    const far = mem();
    far.observe(at(T0, { fighters: [fighter({ x: camp.x + camp.radius + 200, y: camp.y })] }));
    expect(far.view.camps.get(camp.id)!.contestedAt).toBeNull();
  });
});

describe("containers", () => {
  it("remembers where and what, keeping a weapon it once read when the next glance cannot tell", () => {
    const m = mem();
    m.observe(at(T0, { containers: [container({ id: "c1", kind: "chest", weapon: "wand", x: ME.x + 100 })] }));
    expect(m.view.containers.get("c1")).toMatchObject({ kind: "chest", pos: { x: ME.x + 100, y: ME.y }, closed: true, weapon: "wand", seenAt: T0, skipped: false });
    m.observe(at(T0 + 500, { containers: [container({ id: "c1", kind: "chest", weapon: undefined, x: ME.x + 100 })] }));
    expect(m.view.containers.get("c1")).toMatchObject({ weapon: "wand", seenAt: T0 + 500 });
    m.observe(at(T0 + 900, { containers: [container({ id: "c1", kind: "chest", weapon: null, closed: false, x: ME.x + 100 })] }));
    expect(m.view.containers.get("c1")).toMatchObject({ weapon: null, closed: false });
  });

  it.each(["Nothing there", "Nothing to take", "Too far away", "Can't reach that"])("skips the container after the toast %s", (text) => {
    const m = mem();
    m.observe(at(T0, { containers: [container({ id: "c1" }), container({ id: "c2" })] }));
    m.noteSent(sent(T0 + 10, { type: "pickup", msg: { containerId: "c1" } }));
    m.observe(at(T0 + 200, { containers: [container({ id: "c1" }), container({ id: "c2" })], events: [toast(T0 + 190, text)] }));
    expect(m.view.containers.get("c1")!.skipped).toBe(true);
    expect(m.view.containers.get("c2")!.skipped).toBe(false);
  });

  it("does not skip for an unrelated toast, a toast with no pickup sent, or a stale pickup", () => {
    const m = mem();
    m.observe(at(T0, { containers: [container({ id: "c1" })] }));
    m.observe(at(T0 + 50, { containers: [container({ id: "c1" })], events: [toast(T0 + 50, "Nothing there")] }));
    m.noteSent(sent(T0 + 100, { type: "pickup", msg: { containerId: "c1" } }));
    m.observe(at(T0 + 150, { containers: [container({ id: "c1" })], events: [toast(T0 + 150, "Picked up a bow")] }));
    m.observe(at(T0 + 20_000, { containers: [container({ id: "c1" })], events: [toast(T0 + 20_000, "Too far away")] }));
    expect(m.view.containers.get("c1")!.skipped).toBe(false);
  });

  it("assumes a loose weapon unseen for 60 s was taken, and leaves a chest alone", () => {
    const m = mem();
    const ground = container({ id: "g1", kind: "ground", weapon: "axe" });
    const chest = container({ id: "ch", kind: "chest", weapon: undefined, x: ME.x + 130 });
    m.observe(at(T0, { containers: [ground, chest] }));
    m.observe(at(T0 + 59_000, { containers: [] }));
    expect(m.view.containers.get("g1")).toMatchObject({ closed: true, weapon: "axe" });
    m.observe(at(T0 + 61_000, { containers: [] }));
    expect(m.view.containers.get("g1")).toMatchObject({ closed: false, weapon: null });
    expect(m.view.containers.get("ch")).toMatchObject({ closed: true });
  });

  it("sees the weapon again if it is back in view", () => {
    const m = mem();
    m.observe(at(T0, { containers: [container({ id: "g1", kind: "ground", weapon: "axe" })] }));
    m.observe(at(T0 + 61_000, { containers: [] }));
    m.observe(at(T0 + 62_000, { containers: [container({ id: "g1", kind: "ground", weapon: "axe" })] }));
    expect(m.view.containers.get("g1")).toMatchObject({ closed: true, weapon: "axe" });
  });
});

describe("feature extras", () => {
  it("says chestUp once per new reward chest and planOffer once per offer", () => {
    const m = mem();
    const chest = { id: "rc1", x: ME.x + 100, y: ME.y, expiresAt: T0 + 30_000, options: null, takenBy: [], picked: false };
    const plan = { endsAt: T0 + 12_000, spawns: [0, 1] as [number, number], taken: [false, false] as [boolean, boolean], boons: ["a", "b"] as [string, string] };
    const s = m.observe(at(T0, { extras: { chests: [chest], plan } }));
    expect(of(s, "chestUp")).toEqual([{ kind: "chestUp", at: T0, subject: "rc1", central: true }]);
    expect(of(s, "planOffer")).toHaveLength(1);
    expect(m.observe(at(T0 + 50, { extras: { chests: [chest], plan } }))).toEqual([]);
    expect(of(m.observe(at(T0 + 100, { extras: { chests: [{ ...chest, id: "rc2" }, { ...chest, id: "rc3", picked: true }], plan: { ...plan, endsAt: T0 + 50_000 } } })), "chestUp")).toMatchObject([{ subject: "rc2" }]);
  });

  it("emits neither without the extras", () => {
    expect(mem().observe(at(T0, {}))).toEqual([]);
  });

  it("also reads a private plan message when the extras are not filled", () => {
    const s = mem().observe(at(T0, { events: [{ kind: "private", t: T0, at: null, type: "plan", msg: {} }] }));
    expect(of(s, "planOffer")).toHaveLength(1);
  });
});

describe("the view", () => {
  it("is one live object, updated in place, and its choices are recorded", () => {
    const m = mem();
    const view = m.view;
    const fighters = view.fighters;
    m.observe(at(T0, { fighters: [fighter()] }));
    expect(m.view).toBe(view);
    expect(view.fighters).toBe(fighters);
    expect(fighters.get("foe")).toBeDefined();
    expect(view.stimuli).toHaveLength(1);
    m.observe(at(T0 + 50, { fighters: [fighter()] }));
    expect(view.stimuli).toEqual([]);
    m.recordChoice("faction|hunter|fire");
    m.recordChoice("second|fire|bow");
    expect(view.choices).toEqual(["faction|hunter|fire", "second|fire|bow"]);
  });

  it("keeps the stimuli it returned intact after the next observe", () => {
    const m = mem();
    const first = m.observe(at(T0, { fighters: [fighter()] }));
    m.observe(at(T0 + 50, { fighters: [fighter()] }));
    expect(first).toHaveLength(1);
  });

  it("never mutates a percept and is deterministic", () => {
    const script = (): Percept[] => [
      at(T0, { fighters: [fighter({ bounty: 3 })], mobs: [mobView()], containers: [container()], projectiles: [ball()], events: [hit(T0, "me", "foe"), windup(T0, "foe", Math.PI)] }),
      at(T0 + 50, { fighters: [fighter({ inHand: "bow", drawStartedAt: T0 })], events: [cancel(T0 + 50, "foe")] }),
      at(T0 + 100, { fighters: [], self: selfView({ hp: 20, attackTarget: null }) }),
    ];
    const run = (frozen: boolean) => {
      const m = mem();
      return script().map((p) => m.observe(frozen ? deepFreeze(p) : p));
    };
    expect(run(true)).toEqual(run(false));
  });
});
