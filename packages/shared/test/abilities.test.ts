import { describe, expect, it } from "vitest";
import {
  ABILITIES, ABILITY_IDS, ABILITY_SLOTS, abilityCooldownMs, abilityInSlot, BLAZE_BURN_DPS, BLAZE_BURN_MS, BLAZE_MIN_DIST, BLAZE_RANGE,
  BLAZE_TRAIL_HALF_WIDTH, BLAZE_TRAIL_MS, BLINK_STEP, CAST_RANGE_SLACK, effectSide, FACTION_IDS, FIELD_KINDS, fieldKindOf, FREEZE_CAST_MS,
  FREEZE_RANGE, FREEZE_STUN_MS, hasteMultiplier, isAbilityDot, isAbilityId, isAbilitySlot, LAST_STAND_FLOOR_HP, LAST_STAND_HEAL_SHARE,
  LAST_STAND_MS, LAST_STAND_SPEED_BONUS, rankOf, heldSpell, setSlotFullAt, setSlotReadyAt, slotFullAt, slotHasStock, slotReadyAt, stockReadyAt, STATUS_KINDS, SWARM_CAST_MS, SWARM_CLOUD_RADIUS, SWARM_MS,
  TARGET_SNAP_RADIUS, TRAINING_WISH_COOLDOWN_SECONDS, TRIAL_CAST_MS, TRIAL_DEALT_MULT, TRIAL_CONVICTED_RADIUS, TRIAL_EXIT_STUN_MS, TRIAL_MS, TRIAL_RADIUS,
  TRIAL_RANGE, TRIAL_TAKEN_MULT, WISH_LOCK_SECONDS, FREEZE_COOLDOWN_SECONDS, SWARM_COOLDOWN_SECONDS, LAST_STAND_COOLDOWN_SECONDS, BLAZE_RECHARGE_SECONDS, BLAZE_MAX_CHARGES, chargesAt, TRIAL_COOLDOWN_SECONDS, spendCharge, nextChargeAt, maxCharges, wishOf, WISHES, type AbilityDef, type AbilityEffect,
  type AbilityId,
} from "../src/index";

describe("ability ids and slots", () => {
  it("lists the abilities in the wire order, each once (Frost Wall appended; Freeze kept)", () => {
    expect([...ABILITY_IDS]).toEqual(["freeze", "swarm", "trial", "blaze", "lastStand", "frostWall"]);
    expect(new Set(ABILITY_IDS).size).toBe(ABILITY_IDS.length);
    expect(Object.keys(ABILITIES).sort()).toEqual([...ABILITY_IDS].sort());
    for (const id of ABILITY_IDS) expect(ABILITIES[id].id).toBe(id);
  });

  it("knows its slots and rejects anything else", () => {
    expect([...ABILITY_SLOTS]).toEqual(["wish", "q", "e", "spell"]);
    for (const s of ABILITY_SLOTS) expect(isAbilitySlot(s)).toBe(true);
    for (const v of ["", "Wish", "r", "WISH", 0, null, undefined, {}]) expect(isAbilitySlot(v), String(v)).toBe(false);
    for (const id of ABILITY_IDS) expect(isAbilityId(id)).toBe(true);
    for (const v of ["", "Freeze", "chill", "wish", 3, null, undefined]) expect(isAbilityId(v), String(v)).toBe(false);
  });

  it("lists the field kinds in the wire order", () => {
    expect([...FIELD_KINDS]).toEqual(["zone", "cloud", "trail", "wall"]);
    expect(fieldKindOf(0)).toBe("zone");
    expect(fieldKindOf(1)).toBe("cloud");
    expect(fieldKindOf(2)).toBe("trail");
    expect(fieldKindOf(3)).toBe("wall");
    expect(fieldKindOf(4)).toBeUndefined();
    expect(fieldKindOf(-1)).toBeUndefined();
    expect(fieldKindOf(Number.NaN)).toBeUndefined();
  });
});

const COOLDOWNS = { frost: FREEZE_COOLDOWN_SECONDS, plague: SWARM_COOLDOWN_SECONDS, sentenced: TRIAL_COOLDOWN_SECONDS, fire: BLAZE_RECHARGE_SECONDS, holy: LAST_STAND_COOLDOWN_SECONDS } as const;

describe("the stock clock of a charged Wish", () => {
  const R = 30_000;
  it("pins the requested numbers", () => {
    expect([FREEZE_COOLDOWN_SECONDS, SWARM_COOLDOWN_SECONDS, LAST_STAND_COOLDOWN_SECONDS, BLAZE_RECHARGE_SECONDS, BLAZE_MAX_CHARGES]).toEqual([45, 120, 150, 30, 2]);
    expect(maxCharges(ABILITIES.blaze, 1)).toBe(2);
    expect(maxCharges(ABILITIES.freeze, 1)).toBe(1);
  });
  it("spends one charge at a time and recharges one every 30 s", () => {
    let s = { fullAt: 0, readyAt: 0 };
    expect(chargesAt(s.fullAt, 1000, 2, R)).toBe(2);
    s = spendCharge(s.fullAt, 1000, 2, R);
    expect(s).toEqual({ fullAt: 31_000, readyAt: 1000 });
    expect(chargesAt(s.fullAt, 1000, 2, R)).toBe(1);
    expect(nextChargeAt(s.fullAt, 1000, 2, R)).toBe(31_000);
    s = spendCharge(s.fullAt, 2000, 2, R);
    expect(s).toEqual({ fullAt: 61_000, readyAt: 31_000 });
    expect(chargesAt(s.fullAt, 2000, 2, R)).toBe(0);
    expect(chargesAt(s.fullAt, 31_000, 2, R)).toBe(1);
    expect(chargesAt(s.fullAt, 61_000, 2, R)).toBe(2);
  });
  it("is the plain cooldown with one charge", () => {
    expect(spendCharge(0, 500, 1, 45_000)).toEqual({ fullAt: 45_500, readyAt: 45_500 });
  });
});

describe("the Wish catalog", () => {
  it("gives every faction one Wish of its own: kind wish, flat, one rank, its own cooldown", () => {
    expect(Object.keys(WISHES).sort()).toEqual([...FACTION_IDS].sort());
    for (const f of FACTION_IDS) {
      const def = ABILITIES[WISHES[f]];
      expect(def.faction, f).toBe(f);
      expect(def.kind, f).toBe("wish");
      expect(def.flat, f).toBe(true);
      expect(def.ranks, f).toHaveLength(1);
      expect(def.ranks[0]!.cooldownMs, f).toBe(COOLDOWNS[f] * 1000);
      expect(wishOf(f), f).toBe(def);
    }
    expect(new Set(Object.values(WISHES)).size).toBe(FACTION_IDS.length);
    expect(WISH_LOCK_SECONDS).toBe(45);
  });

  it("maps each faction to its Wish", () => {
    expect(WISHES).toEqual({ frost: "frostWall", plague: "swarm", sentenced: "trial", fire: "blaze", holy: "lastStand" });
  });

  it("is cancelled and blocked by stun and silence only, so a stagger or a root never wastes one", () => {
    for (const id of ABILITY_IDS) {
      expect([...ABILITIES[id].cancelledBy], id).toEqual(["stun", "silence"]);
      expect([...ABILITIES[id].blockedBy], id).toEqual(["stun", "silence"]);
    }
  });

  it("has an ai intent, art and a colour for each", () => {
    for (const id of ABILITY_IDS) {
      const d = ABILITIES[id];
      expect(d.ai.length, id).toBeGreaterThan(0);
      expect(d.name.length, id).toBeGreaterThan(0);
      expect(d.blurb.length, id).toBeGreaterThan(0);
      expect(d.color, id).toBeGreaterThan(0);
      expect(d.color, id).toBeLessThanOrEqual(0xffffff);
    }
    expect(ABILITIES.freeze.ai).toEqual(["control", "peel", "engage"]);
    expect(ABILITIES.swarm.ai).toEqual(["escape"]);
    expect(ABILITIES.trial.ai).toEqual(["engage", "control"]);
    expect(ABILITIES.blaze.ai).toEqual(["escape", "engage"]);
    expect(ABILITIES.lastStand.ai).toEqual(["sustain", "escape"]);
    expect(ABILITIES.freeze).toMatchObject({ telegraph: "beam", icon: "snowflake", color: 0x81d4fa });
    expect(ABILITIES.swarm).toMatchObject({ telegraph: "swirl", icon: "swarm", color: 0x9ccc65 });
    expect(ABILITIES.trial).toMatchObject({ telegraph: "ring", icon: "scales", color: 0xb39ddb });
    expect(ABILITIES.blaze).toMatchObject({ telegraph: "flare", icon: "flame", color: 0xff7043 });
    expect(ABILITIES.lastStand).toMatchObject({ telegraph: "aura", icon: "cross", color: 0xffd54f });
  });

  it("Freeze: a unit target 450 u away with line of sight, stunning it for 1.25 s after a 250 ms cast", () => {
    const r = ABILITIES.freeze.ranks[0]!;
    expect([FREEZE_RANGE, FREEZE_STUN_MS, FREEZE_CAST_MS]).toEqual([450, 1250, 250]);
    expect(r.castMs).toBe(250);
    expect(r.targeting).toEqual({ kind: "unit", range: 450, los: true, snapRadius: TARGET_SNAP_RADIUS, who: "enemy" });
    expect(r.shape).toEqual({ kind: "none" });
    expect(r.effects).toEqual([{ do: "status", to: "target", status: "stun", ms: 1250 }]);
    expect(ABILITIES.freeze.ownOrder).toBe(false);
  });

  it("Swarm: a self cast that hides the caster 8 s and leaves a 72 u cloud", () => {
    const r = ABILITIES.swarm.ranks[0]!;
    expect([SWARM_MS, SWARM_CAST_MS, SWARM_CLOUD_RADIUS]).toEqual([8000, 250, 72]);
    expect(r.castMs).toBe(250);
    expect(r.targeting).toEqual({ kind: "self" });
    expect(r.shape).toEqual({ kind: "circle", radius: 72 });
    expect(r.effects).toEqual([
      { do: "status", to: "self", status: "hidden", ms: 8000 },
      { do: "cloud", ms: 8000, radius: 72 },
    ]);
    // Casting it drops the caster's own lock, or its locked attack would reveal it at once, and nothing else: the walk goes on.
    expect(ABILITIES.swarm.dropsLock).toBe(true);
    expect(ABILITIES.swarm.ownOrder).toBe(false);
  });

  it("Trial: a zone slows by 30%, dealt x0.8, taken from the caster x1.2, and stuns for 1.5 s on leaving", () => {
    const r = ABILITIES.trial.ranks[0]!;
    expect([TRIAL_RANGE, TRIAL_RADIUS, TRIAL_MS, TRIAL_DEALT_MULT, TRIAL_TAKEN_MULT, TRIAL_EXIT_STUN_MS, TRIAL_CAST_MS]).toEqual([
      400, 300, 5000, 0.8, 1.2, 1500, 350,
    ]);
    expect(r.castMs).toBe(350);
    expect(r.targeting).toEqual({ kind: "unit", range: 400, los: true, snapRadius: TARGET_SNAP_RADIUS, who: "enemy" });
    expect(r.shape).toEqual({ kind: "circle", radius: 300 });
    expect(r.effects).toEqual([{ do: "zone", ms: 5000, radius: 300, dealtMult: 0.8, takenFromCasterMult: 1.2, moveMult: 0.7, exitStunMs: 1500, convictedRadius: 200 }]);
    expect(TRIAL_CONVICTED_RADIUS).toBe(200);
  });

  it("Blaze Step: an own order that blinks 64..300 u at once and leaves a burning trail, a dot ability", () => {
    const d = ABILITIES.blaze;
    const r = d.ranks[0]!;
    expect([BLAZE_RANGE, BLAZE_MIN_DIST, BLINK_STEP, BLAZE_TRAIL_MS, BLAZE_TRAIL_HALF_WIDTH, BLAZE_BURN_DPS, BLAZE_BURN_MS]).toEqual([
      300, 64, 4, 2500, 20, 30, 2000,
    ]);
    expect(d.ownOrder).toBe(true);
    expect(d.dot).toBe(true);
    expect(r.castMs).toBe(0);
    expect(r.targeting).toEqual({ kind: "point", range: 300, minRange: 64 });
    expect(r.shape).toEqual({ kind: "line", length: 300, width: 40 });
    expect(r.effects).toEqual([
      { do: "blink", maxDist: 300, minDist: 64 },
      { do: "trail", ms: 2500, halfWidth: 20, dps: 30, dotMs: 2000 },
    ]);
  });

  it("Last Stand: an instant self cast, a 1 hp floor for 5 s with 30% healed back and +30% speed", () => {
    const r = ABILITIES.lastStand.ranks[0]!;
    expect([LAST_STAND_MS, LAST_STAND_FLOOR_HP, LAST_STAND_SPEED_BONUS, LAST_STAND_HEAL_SHARE]).toEqual([5000, 1, 0.3, 0.3]);
    expect(r.castMs).toBe(0);
    expect(r.targeting).toEqual({ kind: "self" });
    expect(r.shape).toEqual({ kind: "none" });
    expect(r.effects).toEqual([
      { do: "deathFloor", ms: 5000, floorHp: 1, healBack: 0.3 },
      { do: "status", to: "self", status: "haste", ms: 5000, value: 0.3 },
    ]);
  });

  it("only uses status kinds the runtime has, only Blaze Step is an own order, only Swarm drops the lock alone and only Blaze Step is a dot", () => {
    for (const id of ABILITY_IDS) {
      for (const e of ABILITIES[id].ranks[0]!.effects) if (e.do === "status") expect(STATUS_KINDS).toContain(e.status);
    }
    expect(ABILITY_IDS.filter((id) => ABILITIES[id].ownOrder)).toEqual(["blaze"]);
    expect(ABILITY_IDS.filter((id) => ABILITIES[id].dropsLock)).toEqual(["swarm"]);
    expect(ABILITY_IDS.filter((id) => ABILITIES[id].dot === true)).toEqual(["blaze"]);
  });

  it("keeps its cast range slack a small positive number of units", () => {
    expect(CAST_RANGE_SLACK).toBe(32);
  });
});

describe("effectSide", () => {
  const cases: Array<[AbilityEffect, "self" | "target"]> = [
    [{ do: "status", to: "self", status: "haste", ms: 1 }, "self"],
    [{ do: "status", to: "target", status: "stun", ms: 1 }, "target"],
    [{ do: "cleanse", to: "self", classes: ["soft"] }, "self"],
    [{ do: "cleanse", to: "target", classes: ["soft", "hard"] }, "target"],
    [{ do: "deathFloor", ms: 1, floorHp: 1, healBack: 0.3 }, "self"],
    [{ do: "zone", ms: 1, radius: 1, dealtMult: 1, takenFromCasterMult: 1, moveMult: 1, exitStunMs: 0 }, "target"],
    [{ do: "cloud", ms: 1, radius: 1 }, "self"],
    [{ do: "blink", maxDist: 1, minDist: 0 }, "self"],
    [{ do: "trail", ms: 1, halfWidth: 1, dps: 1, dotMs: 1 }, "self"],
  ];
  it.each(cases)("%j applies in the %s pass", (effect, side) => {
    expect(effectSide(effect)).toBe(side);
  });

  it("puts every Wish effect in a pass, self effects before the target ones", () => {
    expect(ABILITIES.freeze.ranks[0]!.effects.map(effectSide)).toEqual(["target"]);
    expect(ABILITIES.swarm.ranks[0]!.effects.map(effectSide)).toEqual(["self", "self"]);
    expect(ABILITIES.trial.ranks[0]!.effects.map(effectSide)).toEqual(["target"]);
    expect(ABILITIES.blaze.ranks[0]!.effects.map(effectSide)).toEqual(["self", "self"]);
    expect(ABILITIES.lastStand.ranks[0]!.effects.map(effectSide)).toEqual(["self", "self"]);
  });
});

describe("rankOf", () => {
  const two: AbilityDef = {
    ...ABILITIES.freeze,
    ranks: [ABILITIES.freeze.ranks[0]!, { ...ABILITIES.freeze.ranks[0]!, cooldownMs: 1234 }],
  };

  it("returns the numbers of the rank, counted from 1", () => {
    expect(rankOf(two, 1)).toBe(two.ranks[0]);
    expect(rankOf(two, 2)).toBe(two.ranks[1]);
  });

  it("clamps a rank past either end to 1..ranks.length", () => {
    expect(rankOf(two, 0)).toBe(two.ranks[0]);
    expect(rankOf(two, -5)).toBe(two.ranks[0]);
    expect(rankOf(two, 3)).toBe(two.ranks[1]);
    expect(rankOf(two, 99)).toBe(two.ranks[1]);
    expect(rankOf(ABILITIES.blaze, 4)).toBe(ABILITIES.blaze.ranks[0]);
  });

  it("reads a fractional rank as the whole one below it, and a non-finite one as rank 1", () => {
    expect(rankOf(two, 1.9)).toBe(two.ranks[0]);
    expect(rankOf(two, 2.1)).toBe(two.ranks[1]);
    expect(rankOf(two, Number.NaN)).toBe(two.ranks[0]);
    expect(rankOf(two, Number.POSITIVE_INFINITY)).toBe(two.ranks[0]);
  });
});

describe("slots", () => {
  it("abilityInSlot: the wish slot is the faction's Wish at rank 1; q, e and an empty spell slot are empty", () => {
    for (const f of FACTION_IDS) {
      const got = abilityInSlot({ faction: f }, "wish");
      expect(got).toEqual({ def: ABILITIES[WISHES[f]], rank: 1 });
      expect(abilityInSlot({ faction: f }, "q")).toBeNull();
      expect(abilityInSlot({ faction: f }, "e")).toBeNull();
      expect(abilityInSlot({ faction: f }, "spell")).toBeNull();
    }
  });

  it("abilityInSlot: no faction (a training dummy, a lobby seat) has no Wish", () => {
    expect(abilityInSlot({ faction: "" }, "wish")).toBeNull();
    expect(abilityInSlot({ faction: "dragon" }, "wish")).toBeNull();
    expect(wishOf("")).toBeNull();
    expect(wishOf("Frost")).toBeNull();
    expect(wishOf("toString")).toBeNull();
  });

  it("slotReadyAt and setSlotReadyAt round trip each slot without touching the others", () => {
    const p = { wishReadyAt: 0, qReadyAt: 0, eReadyAt: 0, extra: { wishFullAt: 0, spellReadyAt: 0, spellFullAt: 0 } };
    setSlotReadyAt(p, "wish", 45_000);
    expect(p).toEqual({ wishReadyAt: 45_000, qReadyAt: 0, eReadyAt: 0, extra: { wishFullAt: 0, spellReadyAt: 0, spellFullAt: 0 } });
    setSlotReadyAt(p, "q", 7);
    setSlotReadyAt(p, "e", 9);
    setSlotReadyAt(p, "spell", 11);
    expect(p).toEqual({ wishReadyAt: 45_000, qReadyAt: 7, eReadyAt: 9, extra: { wishFullAt: 0, spellReadyAt: 11, spellFullAt: 0 } });
    expect(ABILITY_SLOTS.map((s) => slotReadyAt(p, s))).toEqual([45_000, 7, 9, 11]);
    setSlotReadyAt(p, "wish", 0);
    expect(slotReadyAt(p, "wish")).toBe(0);
    expect(slotReadyAt(p, "q")).toBe(7);
    // No `extra` (a bare fixture): the spell slot reads as ready and a write is dropped.
    const bare = { wishReadyAt: 0, qReadyAt: 0, eReadyAt: 0 };
    setSlotReadyAt(bare, "spell", 5);
    expect(slotReadyAt(bare, "spell")).toBe(0);
  });

  it("the stock clocks: the Wish's and the spell's are their own, Q and E have none", () => {
    const p = { wishReadyAt: 0, qReadyAt: 0, eReadyAt: 0, extra: { wishFullAt: 0, spellReadyAt: 0, spellFullAt: 0 } };
    expect(ABILITY_SLOTS.filter(slotHasStock)).toEqual(["wish", "spell"]);
    setSlotFullAt(p, "wish", 100);
    setSlotFullAt(p, "spell", 200);
    setSlotFullAt(p, "q", 300);
    expect(ABILITY_SLOTS.map((s) => slotFullAt(p, s))).toEqual([100, 0, 0, 200]);
    expect(p.extra).toEqual({ wishFullAt: 100, spellReadyAt: 0, spellFullAt: 200 });
  });

  it("stockReadyAt: a clock taken over as it stands is ready with a charge in hand, and agrees with spendCharge", () => {
    expect(stockReadyAt(0, 3, 1000)).toBe(0);
    // 3 charges, all back at 10 000: one is in hand from 8 000 (two recharges out).
    expect(stockReadyAt(10_000, 3, 1000)).toBe(8_000);
    expect(stockReadyAt(10_000, 1, 1000)).toBe(10_000);
    for (const [fullAt, now, max] of [[0, 5_000, 1], [0, 5_000, 3], [6_000, 5_000, 3], [9_500, 5_000, 2]] as const) {
      const spent = spendCharge(fullAt, now, max, 1000);
      expect(stockReadyAt(spent.fullAt, max, 1000)).toBe(spent.readyAt);
    }
  });

  it("the spell slot holds the spell in `extra.spell`, and only an ability of kind \"spell\" (none exists yet)", () => {
    expect(ABILITY_IDS.filter((id) => ABILITIES[id].kind === "spell")).toEqual([]);
    expect(abilityInSlot({ faction: "fire" }, "spell")).toBeNull();
    expect(abilityInSlot({ faction: "fire", extra: { spell: "" } }, "spell")).toBeNull();
    // A Wish's id in the spell slot is no spell.
    expect(heldSpell({ extra: { spell: "blaze" } })).toBeNull();
    expect(abilityInSlot({ faction: "fire", extra: { spell: "blaze" } }, "spell")).toBeNull();
    expect(isAbilitySlot("spell")).toBe(true);
  });
});

describe("abilityCooldownMs", () => {
  const wish = ABILITIES.freeze;
  const skill: AbilityDef = { ...wish, kind: "skill", flat: false, ranks: [{ ...wish.ranks[0]!, cooldownMs: 10_000 }] };

  /** Per-faction Wish cooldowns (the merged design): Frost 45 s, Plague 120, Holy 150, Sentenced 180; Fire's Blaze Step is a charge every 30 s. */
  const WISH_COOLDOWNS: Record<string, number> = {
    freeze: FREEZE_COOLDOWN_SECONDS * 1000, swarm: SWARM_COOLDOWN_SECONDS * 1000, lastStand: LAST_STAND_COOLDOWN_SECONDS * 1000,
    trial: TRIAL_COOLDOWN_SECONDS * 1000, blaze: BLAZE_RECHARGE_SECONDS * 1000, frostWall: FREEZE_COOLDOWN_SECONDS * 1000,
  };

  it("gives each Wish its own faction's cooldown in a real run", () => {
    expect(WISH_COOLDOWNS).toEqual({ freeze: 45_000, swarm: 120_000, lastStand: 150_000, trial: 180_000, blaze: 30_000, frostWall: 45_000 });
    for (const id of ABILITY_IDS) {
      if (ABILITIES[id].kind !== "wish") continue;
      expect(abilityCooldownMs(ABILITIES[id], 1, {}), id).toBe(WISH_COOLDOWNS[id]);
      expect(abilityCooldownMs(ABILITIES[id], 1, { training: false }), id).toBe(WISH_COOLDOWNS[id]);
    }
  });

  it("gives a Wish TRAINING_WISH_COOLDOWN_SECONDS in training", () => {
    expect(TRAINING_WISH_COOLDOWN_SECONDS).toBe(5);
    for (const id of ABILITY_IDS) expect(abilityCooldownMs(ABILITIES[id], 1, { training: true }), id).toBe(5000);
  });

  it("lets a flat def ignore any reduction", () => {
    for (const id of ABILITY_IDS) {
      const def = ABILITIES[id];
      if (!def.flat) continue;
      expect(abilityCooldownMs(def, 1, { reduction: 0.4 }), id).toBe(WISH_COOLDOWNS[id]);
      expect(abilityCooldownMs(def, 1, { reduction: 0.5 }), id).toBe(WISH_COOLDOWNS[id]);
      expect(abilityCooldownMs(def, 1, { reduction: 0.4, training: true }), id).toBe(5000);
    }
    expect(abilityCooldownMs(wish, 1, { reduction: 0.4 })).toBe(45_000);
  });

  it("applies reduction to a def that is not flat, clamped to 0..0.5", () => {
    expect(abilityCooldownMs(skill, 1, {})).toBe(10_000);
    expect(abilityCooldownMs(skill, 1, { reduction: 0.4 })).toBe(6000);
    expect(abilityCooldownMs(skill, 1, { reduction: 0.5 })).toBe(5000);
    expect(abilityCooldownMs(skill, 1, { reduction: 0.9 })).toBe(5000);
    expect(abilityCooldownMs(skill, 1, { reduction: -1 })).toBe(10_000);
  });

  it("does not shorten a skill's cooldown in training (only Wishes get the practice cooldown)", () => {
    expect(abilityCooldownMs(skill, 1, { training: true })).toBe(10_000);
  });

  it("reads the rank's own cooldown", () => {
    const ranked: AbilityDef = { ...skill, ranks: [skill.ranks[0]!, { ...skill.ranks[0]!, cooldownMs: 8000 }] };
    expect(abilityCooldownMs(ranked, 2, {})).toBe(8000);
    expect(abilityCooldownMs(ranked, 9, { reduction: 0.25 })).toBe(6000);
  });
});

describe("hasteMultiplier", () => {
  it("adds bonus x the base speed on top of whatever the base multiplier is", () => {
    expect(hasteMultiplier(1, 0.3)).toBeCloseTo(1.3, 12);
    expect(hasteMultiplier(1, 0)).toBe(1);
    // With a 1.2x buff the bonus is still 0.3 of the BASE speed: 1.2 * (1 + 0.3 / 1.2) = 1.5.
    expect(1.2 * hasteMultiplier(1.2, 0.3)).toBeCloseTo(1.5, 12);
    // A slow shrinks the multiplier's own part, never the added speed: 0.5 * (1 + 0.3 / 0.5) = 0.8.
    expect(0.5 * hasteMultiplier(0.5, 0.3)).toBeCloseTo(0.8, 12);
  });

  it("never divides by a near-zero multiplier", () => {
    expect(hasteMultiplier(0, 0.3)).toBeCloseTo(1 + 0.3 / 0.05, 12);
    expect(hasteMultiplier(-1, 0.3)).toBeCloseTo(1 + 0.3 / 0.05, 12);
    expect(Number.isFinite(hasteMultiplier(0, 0.5))).toBe(true);
  });
});

describe("isAbilityDot", () => {
  it("is true for a dot ability only", () => {
    expect(isAbilityDot("blaze")).toBe(true);
    for (const id of ABILITY_IDS.filter((a) => a !== "blaze")) expect(isAbilityDot(id), id).toBe(false);
    expect(isAbilityDot(undefined)).toBe(false);
  });

  it("agrees with the defs", () => {
    for (const id of ABILITY_IDS as readonly AbilityId[]) expect(isAbilityDot(id), id).toBe(ABILITIES[id].dot === true);
  });
});
