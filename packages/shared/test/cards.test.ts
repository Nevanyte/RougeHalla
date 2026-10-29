// The card catalog and the chest roll (BALANCE_CONTRACT 4 and 4.8): the validation rules the contract lists, the offer rules, the
// power measure and the words a panel shows.
import { describe, expect, it } from "vitest";
import {
  ABILITIES, AUGMENT_IDS, BASE_STAT_IDS, BASE_TITLES, baseCardId, baseCount, CARD_IDS, CARD_TIERS, cardBlock, cardDef, cardLive,
  cardOptionView, cardPower, CARDS, cardsOfKind, cardText, cardTierOf, cardTitle, CHEST_CONDITIONAL_CHANCE, CHEST_REFUSAL,
  CHEST_REFUSALS, CHEST_TIER_ODDS, conditionalPool, CONDITIONAL_IDS, countIn, FACTIONS, FACTION_IDS, GLOSSARY, isCardId, isChestRefusal, cardRows,
  LIVE_CARD_READY, MECHANIC_TAGS, MOB_TYPES, mulberry32, needsRefusal, ownedCards, ownsBase, QUEST_DEFS, rollChestOptions,
  SIGNATURE_TAGS, tierRoman, TAG_GLOSSARY, WEAPON_TAGS, WEAPONS, whyOffered, isInteractiveAugment, rewardAugmentPool, ZONE_AUGMENT_THEMES,
  type CardCounts, type CardDef, type CardId, type CardTier,
} from "../src/index";

const title = (id: string): string => cardTitle(id);

describe("the catalog", () => {
  it("has 80 cards with unique ids: 24 base, 13 conditional, 43 augments", () => {
    expect(CARDS).toHaveLength(80);
    expect(new Set(CARD_IDS).size).toBe(80);
    expect(cardsOfKind("base")).toHaveLength(24);
    expect(cardsOfKind("conditional")).toHaveLength(13);
    expect(cardsOfKind("augment")).toHaveLength(43);
    expect(CONDITIONAL_IDS).toHaveLength(13);
    expect(AUGMENT_IDS).toHaveLength(43);
    for (const c of CARDS) expect(isCardId(c.id) && cardDef(c.id) === c, c.id).toBe(true);
    expect(isCardId("whetstone")).toBe(false);
    expect(isCardId(7)).toBe(false);
  });

  it("has all 80 cards live: the phase-B hooks landed, so no card is held back as catalog data", () => {
    const live = CARDS.filter((c) => cardLive(c));
    expect(LIVE_CARD_READY).toEqual(["a"]);
    expect(live).toHaveLength(80);
    expect(cardsOfKind("base", { liveOnly: true })).toHaveLength(24);
    expect(cardsOfKind("conditional", { liveOnly: true })).toHaveLength(13);
    expect(cardsOfKind("augment", { liveOnly: true })).toHaveLength(43);
    expect(CARDS.filter((c) => c.ready === "b").map((c) => c.id)).toEqual([]);
  });

  it("gives every card a tier of 1-3, a title, a text and tags from the mechanic list", () => {
    for (const c of CARDS) {
      expect(CARD_TIERS, c.id).toContain(c.tier);
      expect(c.title.length, c.id).toBeGreaterThan(0);
      expect(c.text.length, c.id).toBeGreaterThan(0);
      for (const t of c.tags) expect(MECHANIC_TAGS, `${c.id} ${t}`).toContain(t);
      expect(c.unique, c.id).toBe(c.kind !== "base");
    }
    expect(CARDS.filter((c) => c.kind === "conditional").every((c) => c.tier === 2)).toBe(true);
    expect(tierRoman(1)).toBe("I");
    expect(tierRoman(2)).toBe("II");
    expect(tierRoman(3)).toBe("III");
  });

  it("has unique titles, none the name of a mob, a quest, a Wish, a faction, a weapon or a passive that left the chest", () => {
    const titles = CARDS.map((c) => c.title.toLowerCase());
    expect(new Set(titles).size).toBe(80);
    // The twelve declared-only passives and the three neutrals that base cards replaced (the other six passives live on as augments).
    const retired = [
      "Firebrand", "Searing Riposte", "Ashwalk", "Double Sentence", "Sentence Served", "Bite Twice", "Shatter", "Frozen Path",
      "Hoarfrost Defense", "Radiance", "Quartermaster", "Scout", "Whetstone", "Swift Boots", "Thick Hide",
    ];
    const reserved = new Set<string>([
      ...MOB_TYPES.map((m) => m.name), ...QUEST_DEFS.map((q) => q.name), ...Object.values(ABILITIES).map((a) => a.name),
      ...FACTION_IDS.flatMap((f) => [FACTIONS[f].name, FACTIONS[f].displayName]), ...Object.values(WEAPONS).map((w) => w.name), ...retired,
    ].map((n) => n.toLowerCase()));
    for (const c of CARDS) expect(reserved.has(c.title.toLowerCase()), `${c.id}: "${c.title}"`).toBe(false);
  });

  it("states general mechanics only: no card text names a faction, a weapon, a mob or a Wish (whole words, any case)", () => {
    const words = new Set<string>();
    for (const f of FACTION_IDS) { words.add(f); words.add(FACTIONS[f].name); words.add(FACTIONS[f].displayName); }
    for (const w of Object.values(WEAPONS)) { words.add(w.id); words.add(w.name); }
    for (const m of MOB_TYPES) { words.add(m.id); words.add(m.name); }
    for (const a of Object.values(ABILITIES)) { words.add(a.id); words.add(a.name); }
    // The single words of the multi-word names too ("Blaze Step" names "blaze", "Holy" names "demon").
    for (const w of [...words]) for (const part of w.split(/\s+/)) if (part.length >= 4) words.add(part);
    words.delete("wish"); // "your Wish" is the generic word; no Wish has that id
    const re = [...words].map((w) => ({ w, re: new RegExp(`(^|[^a-z])${w.toLowerCase().replace(/[^a-z ]/g, "")}([^a-z]|$)`, "i") }));
    for (const c of CARDS) {
      for (const { w, re: r } of re) expect(r.test(c.text), `${c.id} "${c.text}" names "${w}"`).toBe(false);
    }
  });

  it("makes every conditional name an existing base, and every base card the stat it deepens", () => {
    for (const c of cardsOfKind("conditional")) {
      expect(BASE_STAT_IDS, c.id).toContain(c.requires);
      expect(cardDef(baseCardId(c.requires!, 1)), c.id).toBeDefined();
      expect(c.base, c.id).toBeUndefined();
    }
    for (const c of cardsOfKind("base")) {
      expect(c.id, c.id).toBe(`${c.base}${c.tier}`);
      expect(c.title, c.id).toBe(`${BASE_TITLES[c.base!]} ${tierRoman(c.tier)}`);
      expect(c.requires, c.id).toBeUndefined();
    }
    for (const c of cardsOfKind("augment")) expect(c.requires, c.id).toBeUndefined();
  });

  it("gives every card rows (a live card with none would do nothing), and the phase-B cards the rows their hooks read", () => {
    for (const c of CARDS) expect(c.effects.length, c.id).toBeGreaterThan(0);
    const flags = (id: string): string[] => cardDef(id)!.effects.flatMap((e) => (e.k === "flag" ? [e.flag] : []));
    expect(flags("festeringArcana")).toEqual(["festering"]);
    expect(flags("cruelWounds")).toEqual(["dotCrit"]);
    expect(flags("gambler")).toEqual(["gambler"]);
    expect(flags("thirdTimesTheCharm")).toEqual(["thirdCharm"]);
    expect(flags("eyeForAnEye")).toEqual(["eyeForAnEye"]);
    expect(flags("bestOffense")).toEqual(["blockHits"]);
    expect(flags("plantYourFeet")).toEqual(["plantFeet"]);
    expect(flags("fistsOfFury")).toEqual(["twiceUnarmed"]);
    // Rhythm: a third of a critical strike per attack on the accumulator, so every 3rd attack crits; Cruel Wounds: +20%.
    expect(cardDef("rhythm")!.effects).toEqual([{ k: "stat", stat: "critChance", v: 1 / 3 }]);
    expect(cardDef("cruelWounds")!.effects[0]).toEqual({ k: "stat", stat: "critChance", v: 0.2 });
    expect(cardDef("tunnelVision")!.effects).toEqual([{ k: "scale", src: "streak", per: 0.04, step: 1, cap: 0.4 }]);
    expect(cardDef("firstImpressions")!.effects).toEqual([{ k: "vs", test: "streak", arg: 0, v: 0.4 }]);
    expect(cardDef("hemorrhage")!.effects).toEqual([{ k: "onHit", status: "dot", per: 0.1, cap: 1, ms: 2000 }]);
    const triggers = (id: string): Array<[string, string]> => cardDef(id)!.effects.flatMap((e) => (e.k === "trigger" ? [[e.on, e.do.do] as [string, string]] : []));
    expect(triggers("overkill")).toEqual([["kill", "splash"]]);
    expect(triggers("tankEngine")).toEqual([["block", "fortify"]]);
    expect(triggers("pocketSand")).toEqual([["block", "status"]]);
    expect(triggers("adrenaline")).toEqual([["hitTaken", "boost"]]);
    expect(triggers("spikedShell")).toEqual([["hitTaken", "return"]]);
    expect(triggers("wishfulThinking")).toEqual([["hit", "cooldown"]]);
  });

  it("keeps each base's tiers in ratio: T2 about 1.75 x T1 (1.6-1.9) and T3 about 2.75 x T1 (2.5-3.0)", () => {
    for (const base of BASE_STAT_IDS) {
      const v = (tier: CardTier): number => (cardDef(baseCardId(base, tier))!.effects[0] as { v: number }).v;
      expect(v(2) / v(1), `${base} T2/T1`).toBeGreaterThanOrEqual(1.6);
      expect(v(2) / v(1), `${base} T2/T1`).toBeLessThanOrEqual(1.9);
      expect(v(3) / v(1), `${base} T3/T1`).toBeGreaterThanOrEqual(2.5);
      expect(v(3) / v(1), `${base} T3/T1`).toBeLessThanOrEqual(3.0);
    }
  });

  it("writes the base cards' numbers exactly as the contract's table (4.2)", () => {
    const text = (id: string): string => cardText(id);
    expect([text("ad1"), text("ad2"), text("ad3")]).toEqual(["+12 Offense", "+21 Offense", "+33 Offense"]);
    expect([text("ap1"), text("ap2"), text("ap3")]).toEqual(["+12 Soul Offence", "+21 Soul Offence", "+33 Soul Offence"]);
    expect([text("haste1"), text("haste2"), text("haste3")]).toEqual(["+9% attack speed", "+16% attack speed", "+25% attack speed"]);
    expect([text("vitality1"), text("vitality2"), text("vitality3")]).toEqual(["+9% max health", "+16% max health", "+25% max health"]);
    expect([text("armor1"), text("armor2"), text("armor3")]).toEqual(["+15 Defense", "+26 Defense", "+41 Defense"]);
    expect([text("mr1"), text("mr2"), text("mr3")]).toEqual(["+15 Soul Defense", "+26 Soul Defense", "+41 Soul Defense"]);
    expect([text("leech1"), text("leech2"), text("leech3")]).toEqual(["+5% lifesteal", "+9% lifesteal", "+14% lifesteal"]);
    expect(text("fleet1")).toBe("+6% move speed (off while shooting)");
    expect([title("haste2"), title("mr3"), title("ad1")]).toEqual(["Haste II", "Soul Defense III", "Offense I"]);
  });

  it("gives the augments the contract's tiers (4.4)", () => {
    const tiers: Record<string, CardTier> = {
      hereComesTheBoom: 3, machineGun: 2, glassCannon: 2, thickSkull: 2, vampiricPact: 2, arcaneOverload: 2, committed: 3, slowBurn: 1,
      fistsOfFury: 2, overkill: 2, tankEngine: 2, pocketSand: 1, gambler: 1, slowStarter: 2, coupDeGrace: 2, bigGameHunter: 2, packLeader: 2,
      adrenaline: 2, raceToZero: 3, cruelWounds: 2, thirdTimesTheCharm: 2, eyeForAnEye: 2, bestOffense: 1, sittingDucks: 2, tunnelVision: 2,
      firstImpressions: 1, plantYourFeet: 2, wishfulThinking: 2, hemorrhage: 1, ironWill: 1, spikedShell: 2, gatheringStorm: 2, wellspring: 1,
      siphon: 2, quickdraw: 1, bountyHunter: 1, secondWind: 2, witness: 1, pestilence: 2, lastRites: 1, gallowsPatience: 2,
      noCommutation: 2, finalVerdict: 3,
    };
    expect(Object.keys(tiers).sort()).toEqual([...AUGMENT_IDS].sort());
    for (const [id, tier] of Object.entries(tiers)) expect(cardTierOf(id), id).toBe(tier);
    expect(title("raceToZero")).toBe("A Race to 0");
    expect(title("thirdTimesTheCharm")).toBe("Third Time's the Charm");
  });

  it("reads card words from the catalog and an unknown id as nothing", () => {
    expect(cardTitle("hereComesTheBoom")).toBe("Here Comes the Boom");
    expect(cardText("bloodthirst")).toBe("While below 50% health, your lifesteal is doubled.");
    expect(cardTitle("nope")).toBe("");
    expect(cardText("nope")).toBe("");
    expect(cardText("cruelWounds", "plague")).toContain("bonus damage equal to half your current critical strike chance");
    expect(cardText("cruelWounds", "fire")).toBe(cardText("cruelWounds"));
    expect(cardOptionView("cruelWounds", {}, "plague")?.text).toBe(cardText("cruelWounds", "plague"));
    expect(cardRows("cruelWounds", "plague")).toEqual([
      { k: "stat", stat: "critChance", v: 0.2 }, { k: "flag", flag: "plagueDotCritConversion" },
    ]);
    expect(cardRows("cruelWounds", "plague").some((row) => row.k === "flag" && row.flag === "dotCrit")).toBe(false);
  });
});

describe("card power", () => {
  it("is the sum over owned cards of tier x count", () => {
    expect(cardPower(null)).toBe(0);
    expect(cardPower(undefined)).toBe(0);
    expect(cardPower({})).toBe(0);
    expect(cardPower({ ad1: 1 })).toBe(1);
    expect(cardPower({ ad2: 2, haste1: 1 })).toBe(5);
    expect(cardPower({ ad3: 1, ap3: 1, armor1: 3 })).toBe(9);
    expect(cardPower({ hereComesTheBoom: 1, bloodthirst: 1, ad1: 1 })).toBe(3 + 2 + 1);
    expect(cardPower(new Map([["ad2", 2], ["vitality1", 1], ["lastRites", 1]]))).toBe(6);
    expect(cardPower({ ad2: 0, ap3: -2 })).toBe(0);
  });

  it("counts an id the catalog does not know as tier 1, and reads a Map, a record and a forEach-only map alike", () => {
    expect(cardTierOf("whetstone")).toBe(1);
    const mapLike = { forEach: (cb: (count: number, id: string) => void) => { cb(2, "ad3"); cb(1, "mystery"); } };
    expect(cardPower(mapLike)).toBe(7);
  });

  it("knows the cards a build holds, in catalog order, and the base stats it owns", () => {
    const build: CardCounts = { lastRites: 1, ad2: 2, ad1: 1, leech3: 1, nope: 4 };
    expect(ownedCards(build).map((o) => [o.def.id, o.count])).toEqual([["ad1", 1], ["ad2", 2], ["leech3", 1], ["lastRites", 1]]);
    expect(countIn(build, "ad2")).toBe(2);
    expect(countIn(build, "ap1")).toBe(0);
    expect(countIn(null, "ad2")).toBe(0);
    expect(ownsBase(build, "ad")).toBe(true);
    expect(ownsBase(build, "leech")).toBe(true);
    expect(ownsBase(build, "armor")).toBe(false);
    expect(baseCount(build, "ad")).toBe(3);
  });
});

describe("why a card is offered, and who cannot take it", () => {
  it("says deepens for an owned base, new for one that is not, and names the base a conditional needs", () => {
    const build = { ad1: 1, leech1: 1 };
    expect(whyOffered("ad3", build)).toEqual({ code: "deepens", base: "ad", text: "Deepens your Offense" });
    expect(whyOffered("armor2", build)).toEqual({ code: "new", base: "armor", text: "New" });
    expect(whyOffered("bloodthirst", build)).toEqual({ code: "synergy", base: "leech", has: true, text: "You have Leech" });
    expect(whyOffered("juggernaut", {})).toEqual({ code: "synergy", base: "ad", has: false, text: "Needs Offense" });
    expect(whyOffered("glassCannon", build)).toEqual({ code: "augment", text: "" });
    expect(whyOffered("nope", build)).toBeNull();
  });

  it("refuses a conditional without its base (Needs <Base>) and a unique card already held (Already yours), never a base card", () => {
    expect(cardBlock("bloodthirst", { ad1: 1 })).toEqual({ reason: "needs", text: "Needs Leech" });
    expect(cardBlock("bloodthirst", { leech2: 1 })).toBeNull();
    expect(cardBlock("bloodthirst", { leech2: 1, bloodthirst: 1 })).toEqual({ reason: "owned", text: "Already yours" });
    expect(cardBlock("glassCannon", { glassCannon: 1 })).toEqual({ reason: "owned", text: "Already yours" });
    expect(cardBlock("ad1", { ad1: 4 })).toBeNull();
    expect(cardBlock("nope", {})).toBeNull();
    expect(isChestRefusal("Needs Leech")).toBe(true);
    expect(isChestRefusal(needsRefusal("ad"))).toBe(true);
    expect(isChestRefusal(CHEST_REFUSAL.owned)).toBe(true);
    expect(isChestRefusal("Needs a break")).toBe(false);
    expect(CHEST_REFUSALS).toContain("Already yours");
  });

  it("builds the panel's view of an option for one picker", () => {
    const v = cardOptionView("bloodthirst", { ad1: 1 })!;
    expect(v).toMatchObject({ id: "bloodthirst", title: "Bloodthirst", tier: 2, kind: "conditional", requires: "leech", held: 0 });
    expect(v.blocked).toEqual({ reason: "needs", text: "Needs Leech" });
    expect(v.why.text).toBe("Needs Leech");
    const base = cardOptionView("ad2", { ad2: 2 })!;
    expect(base).toMatchObject({ id: "ad2", base: "ad", held: 2, blocked: null });
    expect(base.why.code).toBe("deepens");
    expect(cardOptionView("nope", {})).toBeNull();
  });
});

describe("the mark's five cards (docs/SENTENCED_REDESIGN.md section 4)", () => {
  const row = (id: string, flag: string): void => {
    expect(cardDef(id as CardId)!.effects, id).toEqual([{ k: "flag", flag }]);
  };

  it("are flag rows with the contract's kind, tier and requirement", () => {
    const heavier = cardDef("heavierSentence")!;
    expect([heavier.kind, heavier.tier, heavier.requires]).toEqual(["conditional", 2, "vitality"]);
    const swift = cardDef("swiftJudgment")!;
    expect([swift.kind, swift.tier, swift.requires]).toEqual(["conditional", 2, "haste"]);
    expect([cardDef("gallowsPatience")!.kind, cardDef("gallowsPatience")!.tier]).toEqual(["augment", 2]);
    expect([cardDef("noCommutation")!.kind, cardDef("noCommutation")!.tier]).toEqual(["augment", 2]);
    expect([cardDef("finalVerdict")!.kind, cardDef("finalVerdict")!.tier]).toEqual(["augment", 3]);
    row("heavierSentence", "heavierSentence");
    row("swiftJudgment", "swiftJudgment");
    row("gallowsPatience", "gallowsPatience");
    row("noCommutation", "noCommutation");
    row("finalVerdict", "finalVerdict");
  });

  it("have the titles the spec names, and texts in mechanic terms", () => {
    expect(["heavierSentence", "swiftJudgment", "gallowsPatience", "noCommutation", "finalVerdict"].map(title)).toEqual([
      "Heavier Sentence", "Swift Judgment", "Gallows' Patience", "No Commutation", "Final Verdict",
    ]);
    for (const id of ["heavierSentence", "swiftJudgment", "gallowsPatience", "noCommutation", "finalVerdict"]) {
      const text = cardDef(id as CardId)!.text.toLowerCase();
      for (const banned of ["sentenced", "plague", "frost", "fire", "holy", "demon", "bow", "sword", "axe", "wand", "shield", "trial", "mark:"]) {
        expect(text.includes(banned), `${id}: ${banned}`).toBe(false);
      }
    }
    expect(cardText("gallowsPatience")).toContain("2 s longer");
    expect(cardText("gallowsPatience")).toContain("2.25 s");
    expect(cardText("noCommutation")).toContain("two tiers");
    expect(cardText("gatheringStorm")).toBe("Your marks climb their tiers 50% faster.");
  });

  it("the two conditionals are offered only to a picker holding their base (Vitality, Haste)", () => {
    const vit: CardCounts = { vitality1: 1 };
    const haste: CardCounts = { haste1: 1 };
    const ids = (c: CardCounts): string[] => conditionalPool([c]).map((x) => x.id);
    expect(ids({ ad1: 1 })).not.toContain("heavierSentence");
    expect(ids({ ad1: 1 })).not.toContain("swiftJudgment");
    expect(ids(vit)).toContain("heavierSentence");
    expect(ids(vit)).not.toContain("swiftJudgment");
    expect(ids(haste)).toContain("swiftJudgment");
    expect(ids(haste)).not.toContain("heavierSentence");
  });
});

describe("the glossary", () => {
  it("explains every mechanic tag, and lists the stats before them", () => {
    for (const t of MECHANIC_TAGS) expect(TAG_GLOSSARY[t].text.length, t).toBeGreaterThan(0);
    expect(GLOSSARY.map((g) => g.term).slice(0, 2)).toEqual(["Offense", "SO"]);
    expect(GLOSSARY).toHaveLength(16);
  });

  it("tags the five signatures and the weapons as the contract's table does (4.5)", () => {
    const sig = Object.fromEntries(SIGNATURE_TAGS.map((s) => [`${s.faction}:${s.signature}`, s.tags]));
    expect(sig["fire:Burn"]).toEqual(["magic", "dot"]);
    expect(sig["fire:Backlash"]).toEqual(["physical", "returned"]);
    expect(sig["sentenced:Mark"]).toEqual(["true", "ramping"]);
    expect(sig["plague:Disease and execute"]).toEqual(["magic", "dot", "execute"]);
    expect(sig["frost:Chill"]).toEqual(["slow"]);
    expect(sig["holy:Lifesteal"]).toEqual(["heal"]);
    expect(new Set(SIGNATURE_TAGS.map((s) => s.faction))).toEqual(new Set(FACTION_IDS));
    expect(WEAPON_TAGS.map((w) => w.weapon).sort()).toEqual(["axe", "bow", "fists", "shield", "sword", "wand"]);
    for (const row of [...SIGNATURE_TAGS, ...WEAPON_TAGS]) for (const t of row.tags) expect(MECHANIC_TAGS).toContain(t);
  });
});

// ------------------------------------------------------------------------------------------------------- the chest roll

const ROLLS = 4000;

function rolls(opts: Parameters<typeof rollChestOptions>[1], n = ROLLS, seed = 1): CardId[][] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => rollChestOptions(rng, opts));
}

describe("the chest roll (4.8)", () => {
  it("offers up to three distinct functioning augments and never raw stat cards", () => {
    for (const o of rolls({ pickers: [{ ad1: 1 }] })) {
      expect(o.length).toBeLessThanOrEqual(3);
      expect(new Set(o).size).toBe(o.length);
      for (const id of o) {
        const c = cardDef(id)!;
        expect(c.kind).toBe("augment");
        expect(cardLive(c)).toBe(true);
        expect(isInteractiveAugment(c)).toBe(true);
      }
    }
  });

  it("filters interactive options held by all eligible pickers, but keeps options held by only some", () => {
    const pool = rewardAugmentPool([]);
    expect(pool.length).toBeGreaterThan(0);
    const held = pool.map((c) => c.id);
    expect(rewardAugmentPool([Object.fromEntries(held.map((id) => [id, 1]))])).toHaveLength(0);
    expect(rewardAugmentPool([{ [held[0]!]: 1 }, {}]).map((c) => c.id)).toContain(held[0]);
    for (const c of cardsOfKind("base")) expect(isInteractiveAugment(c)).toBe(false);
    for (const c of cardsOfKind("conditional")) expect(isInteractiveAugment(c)).toBe(false);
    for (const id of ["gallowsPatience", "noCommutation", "finalVerdict"]) {
      expect(isInteractiveAugment(id)).toBe(false);
      expect(rewardAugmentPool([]).some((c) => c.id === id)).toBe(false);
    }
  });

  it("offers a compatible general-mechanic theme first in every zone, then fills with distinct neutral augments", () => {
    for (const [zone, theme] of Object.entries(ZONE_AUGMENT_THEMES)) {
      const seen = new Set<string>();
      const rng = mulberry32(1234);
      for (let i = 0; i < 500; i++) {
        const options = rollChestOptions(rng, { zone: zone as keyof typeof ZONE_AUGMENT_THEMES });
        expect(options).toHaveLength(3);
        expect(new Set(options).size).toBe(3);
        expect(theme).toContain(options[0]);
        for (const id of options) {
          expect(isInteractiveAugment(id)).toBe(true);
          seen.add(id);
        }
      }
      expect(theme.every((id) => seen.has(id)), zone).toBe(true);
    }
    const noThemes: CardCounts = Object.fromEntries(ZONE_AUGMENT_THEMES.fire.map((id) => [id, 1]));
    const fallback = rollChestOptions(mulberry32(1), { zone: "fire", pickers: [noThemes] });
    expect(fallback).toHaveLength(3);
    expect(fallback.every((id) => isInteractiveAugment(id))).toBe(true);
  });

  it("honors normal and elite augment tier odds for each offer", () => {
    expect(CHEST_TIER_ODDS.normal.augment).toEqual([50, 45, 5]);
    expect(CHEST_TIER_ODDS.elite.augment).toEqual([10, 60, 30]);
    for (const [elite, odds] of [[false, [50, 50, 0]], [true, [10, 90, 0]]] as const) {
      const rs = rolls({ elite }, 12000);
      const cards = rs.map((o) => cardDef(o[0]!)!);
      for (let t = 1; t <= 3; t++) {
        const share = cards.filter((c) => c.tier === t).length / cards.length;
        expect(Math.abs(share - odds[t - 1]! / 100)).toBeLessThan(0.03);
      }
    }
  });

  it("is deterministic, excludes stat-only catalog entries, and returns no fallback card after exhaustion", () => {
    const opts = { pickers: [{ ad1: 1 }] };
    expect(rollChestOptions(mulberry32(42), opts)).toEqual(rollChestOptions(mulberry32(42), opts));
    const all = rewardAugmentPool([]).map((c) => c.id);
    const exhausted = Object.fromEntries(all.map((id) => [id, 1]));
    expect(rollChestOptions(mulberry32(1), { pickers: [exhausted] })).toEqual([]);
    for (const c of cardsOfKind("augment")) if (!isInteractiveAugment(c)) expect(rollChestOptions(mulberry32(2))).not.toContain(c.id);
  });
});

describe("a Pestilence card for every build", () => {
  it("widens the execute of a faction that has one and adds damage for the rest", () => {
    const def: CardDef = cardDef("pestilence")!;
    expect(def.effects).toEqual([{ k: "vs", test: "hpBelow", arg: 0.6, v: 0.08 }]);
    expect(def.byFaction?.plague).toEqual([{ k: "stat", stat: "executeBand", v: 0.1 }]);
  });
});
