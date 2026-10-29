// The card catalog (BALANCE_CONTRACT 4): legacy stat cards remain available to builds and compatibility helpers, while chests and
// elite deaths now reward functioning interactive augments. Normal mob kills grant fixed, capped stat progression (mobStats.ts). The
// catalog holds 80 cards: 24 base stats, 13 conditionals and 43 augments. A card is data: its `effects` are rows of the closed Effect
// union (effects.ts), folded by sim/mods.ts through shared/mods.ts.
//   conditional  13 cards, all tier 2, each tied to a base (`requires`): offered only when a player who earns the chest owns that
//                base at any tier, and pickable only by an owner. One per player.
//   augment      43 titled cards with trade-offs and rules (Here Comes the Boom, A Race to 0...), tiers 1-3, unconditional, one per player.
// A card is data: its `effects` are rows of the closed Effect union (effects.ts), folded by sim/mods.ts through shared/mods.ts, so a
// new card is a row unless it needs a new kind. A card's `text` states GENERAL MECHANICS ONLY: never a faction, weapon, mob or Wish
// name (cards.test.ts enforces it), so the same line reads right for every build; the glossary (glossary.ts) explains the tags.
//
// `ready` says when a card's machinery exists. Only the LIVE ones (LIVE_CARD_READY: "a") are rolled into chests and applied by the
// sim; all 80 are live now. The phase-B cards (crit, streaks, the on-hit pipeline, blocks, returned damage, the DoT extension...) are
// rows like the rest: a stat, a flag or a trigger the hooks of sim/cardHooks.ts, sim/onHit.ts and the combat files read (the `hook`
// field survives only as a note for a card whose machinery is not data). Some cards also read a number whose consumer lives in the
// combat files (heal(), the ledger's DoT and returned damage, lifesteal totals): the sim reads them through sim/mods.ts;
// GAME_DESIGN 12 lists which.
//
// Power: `cardPower(build)` = the sum over owned cards of tier x count; the PvP factor (rules.ts pvpFactor) reads it.
import {
  GALLOWS_PATIENCE_EXTRA_MS, GALLOWS_PATIENCE_STUN_MS, HEAVIER_SENTENCE_PER_BONUS, OVERKILL_RADIUS, SWIFT_BOOTS_PAUSE_MS, TANK_ENGINE_CAP,
} from "./constants";
import type { Effect } from "./effects";
import type { FactionId } from "./factions";

// ------------------------------------------------------------------------------------------------------------------ types

export type CardKind = "base" | "conditional" | "augment";
export type CardTier = 1 | 2 | 3;
export const CARD_TIERS: readonly CardTier[] = [1, 2, 3];

/** What a card or a signature is about: the tooltip chips and the glossary (glossary.ts) key on these. */
export type MechanicTag =
  | "physical" | "magic" | "true" | "dot" | "onHit" | "returned" | "slow" | "heal" | "block" | "ramping"
  | "execute" | "crit" | "area" | "wish";
export const MECHANIC_TAGS: readonly MechanicTag[] = [
  "physical", "magic", "true", "dot", "onHit", "returned", "slow", "heal", "block", "ramping", "execute", "crit", "area", "wish",
];

/** The eight stats the base cards deepen (a conditional names one as its `requires`). */
export type BaseStatId = "ad" | "ap" | "haste" | "vitality" | "armor" | "mr" | "leech" | "fleet";
export const BASE_STAT_IDS: readonly BaseStatId[] = ["ad", "ap", "haste", "vitality", "armor", "mr", "leech", "fleet"];

/** "ad1" .. "fleet3". */
export type BaseCardId = `${BaseStatId}${1 | 2 | 3}`;

export const CONDITIONAL_IDS = [
  "bloodthirst", "secondSkin", "juggernaut", "spellsword", "bigBrain", "arcaneTempo", "momentum", "stoneSkin", "hearty",
  "festeringArcana", "rhythm", "heavierSentence", "swiftJudgment",
] as const;
export type ConditionalCardId = (typeof CONDITIONAL_IDS)[number];

export const AUGMENT_IDS = [
  "hereComesTheBoom", "machineGun", "glassCannon", "thickSkull", "vampiricPact", "arcaneOverload", "committed", "slowBurn", "fistsOfFury",
  "overkill", "tankEngine", "pocketSand", "gambler", "slowStarter", "coupDeGrace", "bigGameHunter", "packLeader", "adrenaline",
  "raceToZero", "cruelWounds", "thirdTimesTheCharm", "eyeForAnEye", "bestOffense", "sittingDucks", "tunnelVision", "firstImpressions",
  "plantYourFeet", "wishfulThinking", "hemorrhage", "ironWill", "spikedShell", "gatheringStorm", "wellspring", "siphon", "quickdraw",
  "bountyHunter", "secondWind", "witness", "pestilence", "lastRites", "gallowsPatience", "noCommutation", "finalVerdict",
] as const;
export type AugmentCardId = (typeof AUGMENT_IDS)[number];

export type CardId = BaseCardId | ConditionalCardId | AugmentCardId;

/** "a": its machinery exists and chests roll it; "b": catalog data until its hook lands (never offered; no card is "b" any more). */
export type CardReady = "a" | "b";
export const LIVE_CARD_READY: readonly CardReady[] = ["a"];

export interface CardDef {
  id: CardId;
  kind: CardKind;
  tier: CardTier;
  /** "Attack Damage II", "Here Comes the Boom". */
  title: string;
  /** One or two sentences of general mechanics, numbers included: never a faction, weapon, mob or Wish name. */
  text: string;
  tags: readonly MechanicTag[];
  /** A base card: the stat it deepens. */
  base?: BaseStatId;
  /** A conditional: offered and pickable only with this base owned (any tier). */
  requires?: BaseStatId;
  /** Conditionals and augments are one per player; base cards stack. */
  unique: boolean;
  /** The rows (folded by sim/mods.ts). Empty only for a phase "b" card, of which there are none now. */
  effects: readonly Effect[];
  /** Rows that REPLACE `effects` for a fighter of that faction (Pestilence: an execute faction widens its execute instead). */
  byFaction?: Partial<Record<FactionId, readonly Effect[]>>;
  /** Player-facing card text that replaces `text` for a faction-specific row set. */
  byFactionText?: Partial<Record<FactionId, string>>;
  ready: CardReady;
  /** A phase "b" card: the machinery it waits for (documentation; nothing reads it). */
  hook?: string;
}

// ------------------------------------------------------------------------------------------------------------ base cards

export const BASE_TITLES: Readonly<Record<BaseStatId, string>> = {
  ad: "Attack Damage", ap: "Ability Power", haste: "Haste", vitality: "Vitality", armor: "Armor", mr: "Magic Resist", leech: "Leech", fleet: "Fleet",
};

/** T1, T2, T3 of each base (T2 = 1.75 x T1 and T3 = 2.75 x T1 within rounding: the catalog test holds the ratios). */
const BASE_NUMBERS: Readonly<Record<BaseStatId, readonly [number, number, number]>> = {
  ad: [12, 21, 33],
  ap: [12, 21, 33],
  haste: [0.09, 0.16, 0.25],
  vitality: [0.09, 0.16, 0.25],
  armor: [15, 26, 41],
  mr: [15, 26, 41],
  leech: [0.05, 0.09, 0.14],
  fleet: [0.06, 0.10, 0.15],
};

const BASE_TAGS: Readonly<Record<BaseStatId, readonly MechanicTag[]>> = {
  ad: ["physical"], ap: ["magic", "dot"], haste: [], vitality: [], armor: ["physical"], mr: ["magic"], leech: ["heal"], fleet: [],
};

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function baseEffects(base: BaseStatId, v: number): readonly Effect[] {
  switch (base) {
    case "ad": return [{ k: "flat", stat: "ad", v }];
    case "ap": return [{ k: "flat", stat: "ap", v }];
    case "haste": return [{ k: "stat", stat: "attackSpeed", v }];
    case "vitality": return [{ k: "stat", stat: "maxHp", v }];
    case "armor": return [{ k: "flat", stat: "armor", v }];
    case "mr": return [{ k: "flat", stat: "shield", v }];
    case "leech": return [{ k: "stat", stat: "lifesteal", v }];
    // Swift Boots' rule: the move speed is off while shooting and for a pause after (the ranged windups are the anti-kiting lever).
    case "fleet": return [{ k: "while", cond: "notShooting", arg: 0, stat: "moveSpeed", v, ms: SWIFT_BOOTS_PAUSE_MS }];
  }
}

function baseText(base: BaseStatId, v: number): string {
  switch (base) {
    case "ad": return `+${v} attack damage`;
    case "ap": return `+${v} ability power`;
    case "haste": return `+${pct(v)} attack speed`;
    case "vitality": return `+${pct(v)} max health`;
    case "armor": return `+${v} armor`;
    case "mr": return `+${v} magic resist`;
    case "leech": return `+${pct(v)} lifesteal`;
    case "fleet": return `+${pct(v)} move speed (off while shooting)`;
  }
}

const TIER_ROMAN: Readonly<Record<CardTier, string>> = { 1: "I", 2: "II", 3: "III" };

/** "I", "II", "III". */
export function tierRoman(tier: CardTier): string {
  return TIER_ROMAN[tier];
}

function baseCards(): CardDef[] {
  const out: CardDef[] = [];
  for (const base of BASE_STAT_IDS) {
    CARD_TIERS.forEach((tier, i) => {
      const v = BASE_NUMBERS[base][i]!;
      out.push({
        id: `${base}${tier}` as BaseCardId, kind: "base", tier, title: `${BASE_TITLES[base]} ${tierRoman(tier)}`, text: baseText(base, v),
        tags: BASE_TAGS[base], base, unique: false, effects: baseEffects(base, v), ready: "a",
      });
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------- the conditionals

type Row = Omit<CardDef, "kind" | "unique" | "tier"> & { tier?: CardTier };

function conditional(r: Row & { requires: BaseStatId }): CardDef {
  return { ...r, kind: "conditional", tier: r.tier ?? 2, unique: true };
}

const CONDITIONALS: readonly CardDef[] = [
  conditional({
    id: "bloodthirst", title: "Bloodthirst", requires: "leech", tags: ["heal"], ready: "a",
    text: "While below 50% health, your lifesteal is doubled.",
    effects: [{ k: "while", cond: "hpBelow", arg: 0.5, stat: "lifestealMult", v: 1 }],
  }),
  conditional({
    id: "secondSkin", title: "Second Skin", requires: "leech", tags: ["heal"], ready: "a",
    text: "Healing you receive also grants a barrier worth 30% of it (up to 25% of max health).",
    effects: [{ k: "stat", stat: "healBarrier", v: 0.3 }],
  }),
  conditional({
    id: "juggernaut", title: "Juggernaut", requires: "ad", tags: ["physical", "magic"], ready: "a",
    text: "Gain 1 armor and 1 magic resist per 4 AD.",
    effects: [{ k: "convert", from: "ad", to: "armor", per: 0.25 }, { k: "convert", from: "ad", to: "shield", per: 0.25 }],
  }),
  conditional({
    id: "spellsword", title: "Spellsword", requires: "ad", tags: ["magic"], ready: "a",
    text: "Your AD also counts as AP at half value.",
    effects: [{ k: "convert", from: "ad", to: "ap", per: 0.5 }],
  }),
  conditional({
    id: "bigBrain", title: "Big Brain", requires: "vitality", tags: ["magic"], ready: "a",
    text: "Gain AP equal to 2% of your max health.",
    effects: [{ k: "convert", from: "maxHp", to: "ap", per: 0.02 }],
  }),
  conditional({
    id: "arcaneTempo", title: "Arcane Tempo", requires: "haste", tags: ["magic"], ready: "a",
    text: "Every 1% attack speed above base also grants 1 AP.",
    effects: [{ k: "convert", from: "bonusAttackSpeed", to: "ap", per: 100 }],
  }),
  conditional({
    id: "momentum", title: "Momentum", requires: "fleet", tags: [], ready: "a",
    text: "Your bonus move speed is added to your damage.",
    effects: [{ k: "convert", from: "bonusMoveSpeed", to: "damage", per: 1, cap: 0.3 }],
  }),
  conditional({
    id: "stoneSkin", title: "Stone Skin", requires: "armor", tags: ["physical", "magic"], ready: "a",
    text: "Gain 2 armor and 2 magic resist per 100 max health.",
    effects: [{ k: "convert", from: "maxHp", to: "armor", per: 0.02 }, { k: "convert", from: "maxHp", to: "shield", per: 0.02 }],
  }),
  conditional({
    id: "hearty", title: "Hearty", requires: "vitality", tags: [], ready: "a",
    text: "+18% max health.",
    effects: [{ k: "stat", stat: "maxHp", v: 0.18 }],
  }),
  conditional({
    id: "festeringArcana", title: "Festering Arcana", requires: "ap", tags: ["magic", "dot"], ready: "a",
    text: "Your magic damage over time keeps ticking 4 more times after it ends, each tick 1/8 of your AP.",
    // sim/factions.ts starts a `dot` status (FESTERING_TICKS ticks of FESTERING_AP_SHARE x AP, a tick a second) when a damage-over-time signature disengages.
    effects: [{ k: "flag", flag: "festering" }],
  }),
  conditional({
    id: "rhythm", title: "Rhythm", requires: "haste", tags: ["crit"], ready: "a",
    text: "Every 3rd attack is a critical strike.",
    // A third of a crit per attack on the deterministic accumulator (sim/cardState.ts): the 3rd attack reaches 1 and crits.
    effects: [{ k: "stat", stat: "critChance", v: 1 / 3 }],
  }),
  conditional({
    id: "heavierSentence", title: "Heavier Sentence", requires: "vitality", tags: ["true", "ramping"], ready: "a",
    text: `Your marks deal +${Math.round(HEAVIER_SENTENCE_PER_BONUS * 10)}% more for every 10% bonus max health you have.`,
    // sim/factions.ts reads the flag: the mark's share of the target's max health is multiplied by 1 + HEAVIER_SENTENCE_PER_BONUS x (bonus hp / base hp).
    effects: [{ k: "flag", flag: "heavierSentence" }],
  }),
  conditional({
    id: "swiftJudgment", title: "Swift Judgment", requires: "haste", tags: ["ramping"], ready: "a",
    text: "Every 2nd hit on a marked enemy counts as a weapon swap for your marks' tiers.",
    effects: [{ k: "flag", flag: "swiftJudgment" }],
  }),
];

// ----------------------------------------------------------------------------------------------------------- the augments

function augment(r: Row): CardDef {
  return { ...r, kind: "augment", tier: r.tier ?? 1, unique: true };
}

const AUGMENTS: readonly CardDef[] = [
  augment({
    id: "hereComesTheBoom", title: "Here Comes the Boom", tier: 3, tags: ["dot", "returned"], ready: "a",
    text: "Your attack speed is halved, but your hits deal 2.5x damage, AD and AP alike. Your damage over time and returned damage deal 1.25x.",
    effects: [
      { k: "mult", key: "asPost", v: 0.5 }, { k: "mult", key: "hit", v: 2.5 }, { k: "mult", key: "dot", v: 1.25 },
      { k: "mult", key: "returned", v: 1.25 },
    ],
  }),
  augment({
    id: "machineGun", title: "Machine Gun", tier: 2, tags: ["onHit"], ready: "a",
    text: "Your attack speed is doubled, but each hit deals half damage. Your on-hit effects keep their full strength.",
    effects: [{ k: "mult", key: "asPost", v: 2 }, { k: "mult", key: "hit", v: 0.5 }],
  }),
  augment({
    id: "glassCannon", title: "Glass Cannon", tier: 2, tags: [], ready: "a",
    text: "+35% damage, -25% max health.",
    effects: [{ k: "stat", stat: "damage", v: 0.35 }, { k: "stat", stat: "maxHp", v: -0.25 }],
  }),
  augment({
    id: "thickSkull", title: "Thick Skull", tier: 2, tags: ["crit"], ready: "a",
    text: "+30% max health, but your hits can never critically strike.",
    effects: [{ k: "stat", stat: "maxHp", v: 0.3 }, { k: "flag", flag: "noCrit" }],
  }),
  augment({
    id: "vampiricPact", title: "Vampiric Pact", tier: 2, tags: ["heal"], ready: "a",
    text: "+15% lifesteal, but no other healing works on you (camp heals included).",
    // healTaken -1 zeroes every heal but lifesteal, which heal() exempts.
    effects: [{ k: "stat", stat: "lifesteal", v: 0.15 }, { k: "stat", stat: "healTaken", v: -1 }],
  }),
  augment({
    id: "arcaneOverload", title: "Arcane Overload", tier: 2, tags: ["magic", "wish"], ready: "a",
    text: "Your AP is multiplied by 1.5, but your Wish's cooldown is doubled.",
    effects: [{ k: "mult", key: "ap", v: 1.5 }, { k: "mult", key: "wishCooldown", v: 2 }],
  }),
  augment({
    id: "committed", title: "Committed", tier: 3, tags: [], ready: "a",
    text: "Your second weapon slot is locked. The weapon you hold deals +20% damage and attacks 15% faster.",
    effects: [{ k: "flag", flag: "lockSecondSlot" }, { k: "stat", stat: "damage", v: 0.2 }, { k: "stat", stat: "attackSpeed", v: 0.15 }],
  }),
  augment({
    id: "slowBurn", title: "Slow Burn", tier: 1, tags: ["dot"], ready: "a",
    text: "Your damage over time keeps burning twice as long after a fight breaks off, at 30% less per second.",
    effects: [{ k: "mult", key: "linger", v: 2 }, { k: "mult", key: "dot", v: 0.7 }],
  }),
  augment({
    id: "fistsOfFury", title: "Fists of Fury", tier: 2, tags: ["onHit"], ready: "a",
    text: "While unarmed: +40% attack speed (counts toward the cap), and your on-hit effects apply twice.",
    // The attack speed is a `while` row; the on-hit part is a flag the on-hit pipeline reads (sim/onHit.ts).
    effects: [{ k: "while", cond: "unarmed", arg: 0, stat: "attackSpeed", v: 0.4 }, { k: "flag", flag: "twiceUnarmed" }],
  }),
  augment({
    id: "overkill", title: "Overkill", tier: 2, tags: ["area"], ready: "a",
    text: "Damage beyond a kill splashes onto the nearest enemy within 200 u.",
    effects: [{ k: "trigger", on: "kill", arg: 0, do: { do: "splash", radius: OVERKILL_RADIUS } }],
  }),
  augment({
    id: "tankEngine", title: "Tank Engine", tier: 2, tags: ["block"], ready: "a",
    // 1 max health per point prevented: a block stops only SHIELD_BLOCK_SHARE of a hit (about 10 points of a late duel's bash, 2-3 of a camp
    // mob's), so the original 1 per 4 needed ~1000 prevented damage for the +250: sixteen camps of tanking. At 1 it takes about four.
    text: "Permanently gain 1 max health for every point of damage your blocks prevent (up to +250).",
    effects: [{ k: "trigger", on: "block", arg: 0, do: { do: "fortify", per: 1, cap: TANK_ENGINE_CAP } }],
  }),
  augment({
    id: "pocketSand", title: "Pocket Sand", tier: 1, tags: ["block", "slow"], ready: "a",
    text: "Your blocks slow the attacker by 30% for 1 s.",
    effects: [{ k: "trigger", on: "block", arg: 0, do: { do: "status", to: "target", status: "slowMove", ms: 1000, value: 0.3 } }],
  }),
  augment({
    id: "gambler", title: "Gambler", tier: 1, tags: ["crit"], ready: "a",
    text: "Each hit has a 15% chance to deal double damage and a 15% chance to deal half.",
    // The roll is a hash of a secret salt, the tick, the attacker, the victim and the entry's place (sim/cardState.ts gamblerFactor): no order decides it.
    effects: [{ k: "flag", flag: "gambler" }],
  }),
  augment({
    id: "slowStarter", title: "Slow Starter", tier: 2, tags: [], ready: "a",
    text: "-30% damage for your first 3 s in a fight, then +35%.",
    // -30% always, +65% once the fight has lasted 3 s: -30% then +35% in all.
    effects: [{ k: "stat", stat: "damage", v: -0.3 }, { k: "while", cond: "fightTime", arg: 3, stat: "damage", v: 0.65 }],
  }),
  augment({
    id: "coupDeGrace", title: "Coup de Grace", tier: 2, tags: ["execute"], ready: "a",
    text: "+30% damage to targets below 30% health.",
    effects: [{ k: "vs", test: "hpBelow", arg: 0.3, v: 0.3 }],
  }),
  augment({
    id: "bigGameHunter", title: "Big Game Hunter", tier: 2, tags: [], ready: "a",
    text: "+25% damage to elites and to players above 70% health.",
    effects: [{ k: "vs", test: "elite", arg: 0, v: 0.25 }, { k: "vs", test: "playerAbove", arg: 0.7, v: 0.25 }],
  }),
  augment({
    id: "packLeader", title: "Pack Leader", tier: 2, tags: [], ready: "a",
    text: "+3% damage for every camp you helped clear this run (up to +24%).",
    effects: [{ k: "scale", src: "campsCleared", per: 0.03, step: 1, cap: 0.24 }],
  }),
  augment({
    id: "adrenaline", title: "Adrenaline", tier: 2, tags: [], ready: "a",
    text: "After losing 10% or more of your max health in one hit: +40% move and attack speed for 2 s.",
    effects: [{ k: "trigger", on: "hitTaken", arg: 0.1, do: { do: "boost", as: 0.4, move: 0.4, ms: 2000 } }],
  }),
  augment({
    id: "raceToZero", title: "A Race to 0", tier: 3, tags: [], ready: "a",
    text: "Damage you deal and take is multiplied by 1 / your health fraction (up to 2.5x).",
    effects: [{ k: "mult", key: "hpRace", v: 2.5 }],
  }),
  augment({
    id: "cruelWounds", title: "Cruel Wounds", tier: 2, tags: ["crit", "dot"], ready: "a",
    text: "Your damage over time can critically strike (+20% critical strike chance).",
    effects: [{ k: "stat", stat: "critChance", v: 0.2 }, { k: "flag", flag: "dotCrit" }],
    byFaction: { plague: [{ k: "stat", stat: "critChance", v: 0.2 }, { k: "flag", flag: "plagueDotCritConversion" }] },
    byFactionText: { plague: "Your attacks gain +20% critical strike chance. Plague's damage-over-time ticks cannot crit; instead they deal bonus damage equal to half your current critical strike chance." },
  }),
  augment({
    id: "thirdTimesTheCharm", title: "Third Time's the Charm", tier: 2, tags: ["onHit"], ready: "a",
    text: "Every 3rd hit on the same target applies its on-hit effects twice.",
    effects: [{ k: "flag", flag: "thirdCharm" }],
  }),
  augment({
    id: "eyeForAnEye", title: "Eye for an Eye", tier: 2, tags: ["onHit", "returned"], ready: "a",
    text: "Damage you return to attackers applies your on-hit effects.",
    effects: [{ k: "flag", flag: "eyeForAnEye" }],
  }),
  augment({
    id: "bestOffense", title: "Best Offense", tier: 1, tags: ["block"], ready: "a",
    text: "Your blocks count as hits.",
    effects: [{ k: "flag", flag: "blockHits" }],
  }),
  augment({
    id: "sittingDucks", title: "Sitting Ducks", tier: 2, tags: ["slow"], ready: "a",
    text: "Slowed enemies take 12% more damage from you.",
    effects: [{ k: "vs", test: "slowed", arg: 0, v: 0.12 }],
  }),
  augment({
    id: "tunnelVision", title: "Tunnel Vision", tier: 2, tags: ["ramping"], ready: "a",
    text: "+4% damage per hit on the same target, up to 10 stacks; switching targets resets it.",
    effects: [{ k: "scale", src: "streak", per: 0.04, step: 1, cap: 0.4 }],
  }),
  augment({
    id: "firstImpressions", title: "First Impressions", tier: 1, tags: [], ready: "a",
    text: "Your first hit on a new target deals +40% damage.",
    // The `streak` test holds while the hits already landed in a row on this target are `arg` or fewer: 0 is the first one.
    effects: [{ k: "vs", test: "streak", arg: 0, v: 0.4 }],
  }),
  augment({
    id: "plantYourFeet", title: "Plant Your Feet", tier: 2, tags: [], ready: "a",
    text: "After standing still for 1 s, your next attack has +25% range and damage.",
    effects: [{ k: "flag", flag: "plantFeet" }],
  }),
  augment({
    id: "wishfulThinking", title: "Wishful Thinking", tier: 2, tags: ["wish"], ready: "a",
    text: "Each hit you land shortens your Wish's cooldown by 1 s (at most 30 s a minute).",
    // G13: sim/cardHooks.ts keeps it to WISHFUL_BUDGET_MS in any WISHFUL_WINDOW_MS and never under half the cooldown.
    effects: [{ k: "trigger", on: "hit", arg: 0, do: { do: "cooldown", ms: 1000 } }],
  }),
  augment({
    id: "hemorrhage", title: "Hemorrhage", tier: 1, tags: ["onHit", "dot", "physical"], ready: "a",
    text: "Your physical hits make the target bleed for 10% of the hit over 2 s.",
    effects: [{ k: "onHit", status: "dot", per: 0.1, cap: 1, ms: 2000 }],
  }),
  augment({
    id: "ironWill", title: "Iron Will", tier: 1, tags: ["slow"], ready: "a",
    text: "Slows on you are 40% weaker.",
    effects: [{ k: "stat", stat: "slowResist", v: 0.4 }],
  }),
  augment({
    id: "spikedShell", title: "Spiked Shell", tier: 2, tags: ["returned", "physical"], ready: "a",
    text: "Melee attackers take 15% of the damage they deal to you back as physical damage.",
    effects: [{ k: "trigger", on: "hitTaken", arg: 0, do: { do: "return", share: 0.15, melee: true } }],
  }),
  augment({
    id: "gatheringStorm", title: "Gathering Storm", tier: 2, tags: ["ramping"], ready: "a",
    text: "Your marks climb their tiers 50% faster.",
    effects: [{ k: "stat", stat: "markRate", v: 0.5 }],
  }),
  augment({
    id: "wellspring", title: "Wellspring", tier: 1, tags: ["heal"], ready: "a",
    text: "Healing you receive is 25% stronger (camp heals included).",
    effects: [{ k: "stat", stat: "healTaken", v: 0.25 }],
  }),
  augment({
    id: "siphon", title: "Siphon", tier: 2, tags: ["dot", "heal"], ready: "a",
    text: "Your damage over time heals you for 20% of the damage it deals.",
    effects: [{ k: "stat", stat: "lifestealDot", v: 0.2 }],
  }),
  augment({
    id: "quickdraw", title: "Quickdraw", tier: 1, tags: [], ready: "a",
    text: "Your melee windups are 50% shorter.",
    effects: [{ k: "stat", stat: "windup", v: -0.5 }],
  }),
  augment({
    id: "bountyHunter", title: "Bounty Hunter", tier: 1, tags: [], ready: "a",
    text: "+10% damage to players who hold more card power than you.",
    effects: [{ k: "vs", test: "higherPower", arg: 0, v: 0.1 }],
  }),
  augment({
    id: "secondWind", title: "Second Wind", tier: 2, tags: ["heal"], ready: "a",
    text: "Once per run, the first time a hit leaves you below 25% health: heal 20% of max health over 1.5 s.",
    effects: [{ k: "trigger", on: "hpBelow", arg: 0.25, once: true, do: { do: "heal", share: 0.2, ignoreLockout: true, ms: 2000 } }],
  }),
  augment({
    id: "witness", title: "Witness", tier: 1, tags: [], ready: "a",
    text: "+8% damage to a target that is fighting someone else.",
    effects: [{ k: "vs", test: "thirdParty", arg: 0, v: 0.08 }],
  }),
  augment({
    id: "pestilence", title: "Pestilence", tier: 2, tags: ["execute"], ready: "a",
    text: "Your execute starts at 60% health instead of 50%; with no execute, +8% damage to targets below 60% health.",
    effects: [{ k: "vs", test: "hpBelow", arg: 0.6, v: 0.08 }],
    byFaction: { plague: [{ k: "stat", stat: "executeBand", v: 0.1 }] },
  }),
  augment({
    id: "lastRites", title: "Last Rites", tier: 1, tags: [], ready: "a",
    text: "+25% attack speed while below 30% health.",
    effects: [{ k: "while", cond: "hpBelow", arg: 0.3, stat: "attackSpeed", v: 0.25 }],
  }),
  augment({
    id: "gallowsPatience", title: "Gallows' Patience", tier: 2, tags: ["wish"], ready: "a",
    text: `Your zone Wish lasts ${GALLOWS_PATIENCE_EXTRA_MS / 1000} s longer, and an enemy that leaves it is stunned for ${GALLOWS_PATIENCE_STUN_MS / 1000} s.`,
    effects: [{ k: "flag", flag: "gallowsPatience" }],
  }),
  augment({
    id: "noCommutation", title: "No Commutation", tier: 2, tags: ["ramping"], ready: "a",
    text: "When a marked enemy swaps weapons, your mark climbs two tiers instead of one.",
    effects: [{ k: "flag", flag: "noCommutation" }],
  }),
  augment({
    id: "finalVerdict", title: "Final Verdict", tier: 3, tags: ["true", "execute", "returned"], ready: "a",
    text: "When your mark blocks an enemy's execute, the blocked damage is dealt back to it as true damage.",
    effects: [{ k: "flag", flag: "finalVerdict" }],
  }),
];

// -------------------------------------------------------------------------------------------------------------- the catalog

/** Every card: the 24 base cards (by stat, then tier), the 13 conditionals, the 43 augments, each in the contract's order. */
export const CARDS: readonly CardDef[] = [...baseCards(), ...CONDITIONALS, ...AUGMENTS];

export const CARD_IDS: readonly CardId[] = CARDS.map((c) => c.id);

const CARD_BY_ID: ReadonlyMap<string, CardDef> = new Map(CARDS.map((c) => [c.id, c]));

export function isCardId(v: unknown): v is CardId {
  return typeof v === "string" && CARD_BY_ID.has(v);
}

/** The card with this id; undefined for an id that is not in the catalog (newer server content). */
export function cardDef(id: string): CardDef | undefined {
  return CARD_BY_ID.get(id);
}

/** "Haste II"; "" for an unknown id. */
export function cardTitle(id: string): string {
  return CARD_BY_ID.get(id)?.title ?? "";
}

/** The card's one-line mechanics ("+16% attack speed"); "" for an unknown id. */
export function cardText(id: string, faction?: string): string {
  const def = CARD_BY_ID.get(id);
  if (!def) return "";
  const custom = faction !== undefined ? def.byFactionText?.[faction as FactionId] : undefined;
  return custom ?? def.text;
}

/** The base card of `base` at `tier`: "ad" and 2 give "ad2". */
export function baseCardId(base: BaseStatId, tier: CardTier): CardId {
  return `${base}${tier}` as BaseCardId;
}

/** Is the card's machinery in (LIVE_CARD_READY)? Only live cards are rolled into chests and applied by the sim. */
export function cardLive(card: CardDef | string): boolean {
  const def = typeof card === "string" ? CARD_BY_ID.get(card) : card;
  return def !== undefined && LIVE_CARD_READY.includes(def.ready);
}

/** The cards of one kind (catalog order); with `liveOnly`, only the live ones. */
export function cardsOfKind(kind: CardKind, opts: { liveOnly?: boolean } = {}): CardDef[] {
  return CARDS.filter((c) => c.kind === kind && (!opts.liveOnly || cardLive(c)));
}

/** The rows of a card for a fighter of `faction` (its byFaction rows where it has some). [] for an unknown id. */
export function cardRows(id: string, faction?: string): readonly Effect[] {
  const def = CARD_BY_ID.get(id);
  if (!def) return [];
  const own = faction !== undefined ? def.byFaction?.[faction as FactionId] : undefined;
  return own ?? def.effects;
}

// ------------------------------------------------------------------------------------------------------------------ builds

/** A player's cards: the synced `PlayerState.build` (id -> count; a MapSchema or a Map), or a plain record. */
export type CardCounts =
  | { get(id: string): number | undefined }
  | { forEach(cb: (count: number, id: string) => void): void }
  | Readonly<Record<string, number>>;

/** How many of card `id` a build holds (0 for none, a bad value, or no build at all). */
export function countIn(build: CardCounts | null | undefined, id: string): number {
  if (build == null) return 0;
  const get = (build as { get?: unknown }).get;
  const n = typeof get === "function"
    ? (build as { get(id: string): number | undefined }).get(id)
    : (build as Record<string, number>)[id];
  return typeof n === "number" && n > 0 ? Math.floor(n) : 0;
}

/** Every card held (count above 0), in catalog order. Ids the catalog does not know are left out. */
export function ownedCards(build: CardCounts | null | undefined): Array<{ def: CardDef; count: number }> {
  const out: Array<{ def: CardDef; count: number }> = [];
  if (build == null) return out;
  for (const def of CARDS) {
    const count = countIn(build, def.id);
    if (count > 0) out.push({ def, count });
  }
  return out;
}

/** Does the build hold any tier of base card `base` (what a conditional's `requires` asks)? */
export function ownsBase(build: CardCounts | null | undefined, base: BaseStatId): boolean {
  if (build == null) return false;
  for (const tier of CARD_TIERS) if (countIn(build, baseCardId(base, tier)) > 0) return true;
  return false;
}

/** The base cards of `base` held, summed over tiers (Attack Damage I twice and II once is 3). */
export function baseCount(build: CardCounts | null | undefined, base: BaseStatId): number {
  let n = 0;
  for (const tier of CARD_TIERS) n += countIn(build, baseCardId(base, tier));
  return n;
}

/**
 * A card's tier, 1-3. Ids the catalog does not know count tier 1 (a test's made-up id; a build only ever holds catalog ids, because
 * grantCard validates), so a stray entry never makes a fighter weaker than a fresh one.
 */
export function cardTierOf(id: string): CardTier {
  return CARD_BY_ID.get(id)?.tier ?? 1;
}

/**
 * A fighter's card power P: the sum over its cards of tier x count (a base card stacks, so Attack Damage II twice is 4). The PvP
 * factor (rules.ts pvpFactor) reads it. Pure; an empty or missing build is 0.
 */
export function cardPower(build: CardCounts | null | undefined): number {
  if (build == null) return 0;
  let p = 0;
  const add = (count: number, id: string): void => {
    if (count > 0) p += cardTierOf(id) * count;
  };
  const forEach = (build as { forEach?: unknown }).forEach;
  if (typeof forEach === "function") (build as { forEach(cb: (count: number, id: string) => void): void }).forEach(add);
  else for (const [id, count] of Object.entries(build as Record<string, number>)) add(count, id);
  return p;
}

// ------------------------------------------------------------------------------------------------------------ why offered

/**
 * Why a card is on a picker's panel (BALANCE_CONTRACT 9): a base card deepens a stat the picker owns or is new to them; a
 * conditional names the base it needs (and says whether the picker has it); an augment stands alone.
 */
export type WhyOffered =
  | { code: "deepens"; base: BaseStatId; text: string }
  | { code: "new"; base: BaseStatId; text: string }
  | { code: "synergy"; base: BaseStatId; has: boolean; text: string }
  | { code: "augment"; text: string };

export function whyOffered(id: string, build: CardCounts | null | undefined): WhyOffered | null {
  const def = CARD_BY_ID.get(id);
  if (!def) return null;
  if (def.kind === "base") {
    const base = def.base!;
    return ownsBase(build, base)
      ? { code: "deepens", base, text: `Deepens your ${BASE_TITLES[base]}` }
      : { code: "new", base, text: "New" };
  }
  if (def.kind === "conditional") {
    const base = def.requires!;
    const has = ownsBase(build, base);
    return { code: "synergy", base, has, text: has ? `You have ${BASE_TITLES[base]}` : `Needs ${BASE_TITLES[base]}` };
  }
  return { code: "augment", text: "" };
}

/** The reason a player cannot take a card now (the server refuses it with the same words), or null when they can. */
export function cardBlock(id: string, build: CardCounts | null | undefined): { reason: "needs" | "owned"; text: string } | null {
  const def = CARD_BY_ID.get(id);
  if (!def) return null;
  if (def.kind === "conditional" && def.requires && !ownsBase(build, def.requires)) {
    return { reason: "needs", text: `Needs ${BASE_TITLES[def.requires]}` };
  }
  if (def.unique && countIn(build, def.id) > 0) return { reason: "owned", text: "Already yours" };
  return null;
}

/** True when a card grants a rule or trigger, rather than a direct or conditional stat bonus. */
const INTERACTIVE_AUGMENT_IDS = new Set<string>([
  "slowBurn", "overkill", "tankEngine", "pocketSand", "gambler", "thirdTimesTheCharm", "eyeForAnEye", "bestOffense",
  "plantYourFeet", "wishfulThinking", "hemorrhage", "spikedShell", "siphon", "secondWind",
]);
export function isInteractiveAugment(card: CardDef | string): boolean {
  const def = typeof card === "string" ? cardDef(card) : card;
  return !!def && def.kind === "augment" && INTERACTIVE_AUGMENT_IDS.has(def.id);
}
