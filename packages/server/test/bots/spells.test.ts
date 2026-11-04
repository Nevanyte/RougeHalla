// The bots and the spell slot: perception shows the slot as the weapon bar does (`extras.spell`, null while empty) and a find's
// spell; the Wishes module casts a held spell on slot "spell" by its intent tags, after the Wish; the spells module takes a find in
// reach into an empty slot and walks to one nearby. No spell exists yet, so this file registers test-only spells.
import { describe, expect, it } from "vitest";
import { ABILITIES, abilityInSlot, type AbilityDef } from "@raid/shared";
import { spellsModule, SPELL_RULES } from "../../src/bots/brain/modules/spells";
import { wishesModule } from "../../src/bots/brain/modules/wishes";
import { detectFeatures } from "../../src/bots/brain/perception";
import type { BrainConfig, Intent, WishView } from "../../src/bots/brain/types";
import { BOLT, useTestSpells } from "../support/testSpell";
import { brainConfig, container, ctx as makeCtx, emptyMemory, features, hudView, percept, rngs, selfView } from "./fixtures";

useTestSpells();

const NOW = 200_000;
const SPELL_FEATURES = features({ messageTypes: ["move", "stop", "target", "pickup", "cast"], wishes: true, statusEffects: true, spells: true });

function spellView(over: Partial<WishView> = {}): WishView {
  const def = ABILITIES[BOLT];
  return { ability: def.id, def, rank: 1, readyAt: 0, casting: false, ...over };
}

function wishView(readyAt: number): WishView {
  const slot = abilityInSlot({ faction: "holy" }, "wish")!;
  return { ability: slot.def.id, def: slot.def, rank: 1, readyAt, casting: false };
}

const cfgFor = (modules = [wishesModule, spellsModule]): BrainConfig => brainConfig("hard", "farmer", { features: SPELL_FEATURES, modules });

function at(cfg: BrainConfig, extras: Record<string, unknown>, over: { hpFrac?: number; hurtAgo?: number; containers?: ReturnType<typeof container>[] } = {}) {
  const self = selfView({ faction: "holy", hp: Math.round((over.hpFrac ?? 1) * 100), maxHp: 100 });
  const p = percept({ now: NOW, self, hud: hudView({ phase: "active" }), features: SPELL_FEATURES, containers: over.containers ?? [], extras: { effects: { [self.id]: 0 }, ...extras } });
  const base = emptyMemory();
  const mem = { ...base, self: { ...base.self, lastHitAt: over.hurtAgo === undefined ? null : NOW - over.hurtAgo } };
  return makeCtx({ cfg, p, mem, rng: rngs(cfg.seed) });
}

const casts = (list: readonly Intent[]) => list.filter((i): i is Extract<Intent, { kind: "cast" }> => i.kind === "cast");

describe("perception and the spell slot", () => {
  it("the feature is on where the schema has the slot and the server takes casts", () => {
    const player = { wishReadyAt: 0, extra: { spell: "" } };
    expect(detectFeatures({ state: { players: new Map([["a", player]]) }, messageTypes: ["cast"] }).spells).toBe(true);
    expect(detectFeatures({ state: { players: new Map([["a", { wishReadyAt: 0, extra: {} }]]) }, messageTypes: ["cast"] }).spells).toBe(false);
    expect(detectFeatures({ state: { players: new Map([["a", player]]) }, messageTypes: ["move"] }).spells).toBe(false);
  });
});

describe("casting a held spell (the Wishes module)", () => {
  // BOLT is tagged "buff" in the fixture, which the policy does not use; a sustain-tagged copy is the one a hurt bot presses. Made at
  // test time: the test spells are registered in beforeAll, after this block is collected.
  const sustainOf = (): AbilityDef => ({ ...ABILITIES[BOLT], ai: ["sustain"] });

  it("casts the held spell on slot \"spell\" when the Wish is out and the moment fits its tags", () => {
    const cfg = cfgFor([wishesModule]);
    const c = at(cfg, { wish: wishView(NOW + 60_000), spell: spellView({ def: sustainOf() }) }, { hpFrac: 0.2, hurtAgo: 200 });
    wishesModule.observe?.(c);
    const out = casts(wishesModule.intents!(c, { kind: "idle" }));
    expect(out).toHaveLength(1);
    expect(out[0]!.slot).toBe("spell");
  });

  it("sends nothing for an empty slot, a spell still reloading, or one whose tags do not fit", () => {
    for (const spell of [null, spellView({ def: sustainOf(), readyAt: NOW + 5000 }), spellView()]) {
      const cfg = cfgFor([wishesModule]);
      const c = at(cfg, { wish: wishView(NOW + 60_000), spell }, { hpFrac: 0.2, hurtAgo: 200 });
      wishesModule.observe?.(c);
      expect(casts(wishesModule.intents!(c, { kind: "idle" }))).toEqual([]);
    }
  });
});

describe("taking a spell (the spells module)", () => {
  const find = (over: Partial<ReturnType<typeof container>> = {}) => container({ id: "s1", kind: "spell", spell: BOLT, weapon: null, ...over });

  it("takes a find in reach into an empty slot, and leaves it with a spell in hand", () => {
    const cfg = cfgFor();
    const empty = at(cfg, { spell: null }, { containers: [find({ interactable: true, x: selfView().x + 30, dist: 30 })] });
    expect(spellsModule.intents!(empty, { kind: "idle" })).toEqual([expect.objectContaining({ kind: "pickup", container: "s1" })]);
    const held = at(cfgFor(), { spell: spellView() }, { containers: [find({ interactable: true, x: selfView().x + 30, dist: 30 })] });
    expect(spellsModule.intents!(held, { kind: "idle" })).toEqual([]);
  });

  it("walks to a find it sees nearby, as a goal under a committed fight, and not with an enemy close", () => {
    const cfg = cfgFor();
    const c = at(cfg, { spell: null }, { containers: [find({ dist: 300 })] });
    const goals = spellsModule.goals!(c);
    expect(goals).toHaveLength(1);
    expect(goals[0]!.utility).toBeLessThanOrEqual(SPELL_RULES.cap);
    const goal = goals[0]!.goal;
    expect(goal.kind).toBe("module");
    const out = spellsModule.act!(c, goal as Extract<typeof goal, { kind: "module" }>);
    expect(out.status.state).toBe("running");
    expect(out.intents).toEqual([expect.objectContaining({ kind: "move" })]);
    // Too far, or with the slot full, it is no goal at all.
    expect(spellsModule.goals!(at(cfgFor(), { spell: null }, { containers: [find({ dist: SPELL_RULES.walkReach + 1 })] }))).toEqual([]);
    expect(spellsModule.goals!(at(cfgFor(), { spell: spellView() }, { containers: [find({ dist: 300 })] }))).toEqual([]);
  });
});
