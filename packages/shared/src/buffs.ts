// Buffs (roguelike R4a, ROGUELIKE_PLAN 3.4) and the mob reward curve (GAME_DESIGN 12). Pure: the sim, the HUD and the
// tests all read these.
//
// Every mob type (shared/mobs.ts MOB_TYPES) gives its own buff: a mob kill grants MOB_BUFF_STACKS x m stacks of the
// buff of the mob's type (an elite ELITE_BUFF_STACKS x m), m being the reward curve x the catch-up. A buff is a list of
// Effect rows (effects.ts) whose numbers are the value at BUFF_REF_STACKS (3) stacks (D6); at n stacks every number is
// scaled by buffScale(n) = S(n) / S(3), S(x) = sigmoid((x - 3) / 1) - sigmoid(-3): 1 stack 0.16x, 2 stacks 0.49x,
// 3 stacks 1x, 4 stacks 1.51x, 6 stacks 2x, a plateau of about 2.1x. Stacks are real numbers (the reward curve scales a
// grant, and a bounty moves half of a victim's stacks of each buff, fractions and all).
//
// How the table's rows are read (decisions R4a made where ROGUELIKE_PLAN 3.4 left room; the docs record them):
//   damage       an outgoing multiplier on every hit the owner deals, weapon hits and signature damage alike (burn,
//                disease, the mark, backlash), so Sentenced, whose damage is nearly all its mark, benefits in full. It is
//                applied to the raw damage before armor and shield (server ledger.ts).
//   vs, scale    damage rows too: a `vs` row whose test holds for the victim, and a `scale` row's stepped bonus, add to
//                the damage sum (1 + stat damage + vs + scale; rows within the damage key add, never multiply). Both read
//                the state as the tick's ledger pass began, so the order hits are applied in never matters. `scale`
//                (Penitent) is +per for every whole `step` of the owner's missing hp fraction (stepped: 10% steps).
//   shield       the faction's magic-resistance stat (`shield`, D7), raised by a `flat` row. Not the kill barrier.
//   while        folds into the stat mirrors only while its condition holds. `chasingLock` (Cinder Hound) holds while
//                the player has a target lock: on or off, so the speedMult mirror patches only when a lock starts or ends.
//                The sim re-checks it once per tick (server mods.ts), so the change shows one tick late, by design.
//   markRate     the Sentenced mark's ramp rate: the mark's engaged time grows (1 + markRate) x as fast, so it reaches
//                the same cap sooner. No effect on any other faction (worksWith: sentenced).
//   lifesteal    for any faction: heals that share of the damage the owner lands, exempt from the heal lockout like
//                Holy's. Rows add up to at most LS_CAP (0.25); Holy's own lifesteal comes on top; the total never passes
//                LIFESTEAL_MAX (1, Holy's own cap).
//   trigger      Blood Saint: the first time a hit leaves the owner standing below `arg` of max hp, it heals `share` of
//                max hp, ignoring the heal lockout; once per run. The share scales with the stacks like any number.
//   onHit, vs slowed, vs streak   need the status runtime (Wishes' sim/status.ts; roguelike R4b): such rows carry
//                `needs: "status"`, are shown in the HUD and tooltips, and are never applied until R4b.
//   dot (Bloatfly) `per` is raw damage per second before DUEL_PACE; `cap` counts instances per source (1: it refreshes).
//   streak (Inquisitor) `arg` is seconds the owner has kept hitting that target.
// Kill combos (bursts, the kill shield, the cooldown reset) are gone (decision 7); they come back as relic and skill synergies.
import {
  BOUNTY_STACK_SHARE, BUFF_REF_STACKS, BUFF_S0, BUFF_W, CATCHUP_GAP, CATCHUP_MULT, DUEL_PACE, LIFESTEAL_MAX, LS_CAP,
  REWARD_FLOOR, REWARD_MID, REWARD_WIDTH,
} from "./constants";
import { visitEffect, type Effect, type StatKey } from "./effects";
import type { FactionId } from "./factions";
import { MOB_TYPES, type MobTypeId } from "./mobs";

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ------------------------------------------------------------------------------------------------------- the curve

/** The S-curve: 0 at 0 stacks, rising fastest around BUFF_S0, flattening after. */
export function buffCurve(stacks: number): number {
  if (!(stacks > 0)) return 0;
  return sigmoid((stacks - BUFF_S0) / BUFF_W) - sigmoid(-BUFF_S0 / BUFF_W);
}

const REF_CURVE = buffCurve(BUFF_REF_STACKS);

/** What a buff's quoted numbers are multiplied by at `stacks`: S(stacks) / S(3). 0 for none, 1 at 3, about 2.1 at most. */
export function buffScale(stacks: number): number {
  return buffCurve(stacks) / REF_CURVE;
}

/** The scale the curve approaches: what endless stacks of one buff give, as a multiple of its quoted numbers. */
export const BUFF_PLATEAU = (1 - sigmoid(-BUFF_S0 / BUFF_W)) / REF_CURVE;

// ---------------------------------------------------------------------------------------------------- the catalog

/** One buff per mob type. */
export type BuffId = MobTypeId;

/**
 * Who a buff is for or against: a faction or a weapon id, or one of these words. `counters` lists what the buff is
 * strong against (R3's planning screen offers the buffs whose `counters` name a faction present); `worksWith`, what it
 * needs or suits ("any" for everyone).
 */
export type BuffTag =
  | FactionId | "sword" | "bow" | "wand" | "shield" | "axe"
  | "any" | "melee" | "kiters" | "magic" | "physical" | "highHp" | "healers" | "lifesteal" | "longDuels" | "fastAttacks"
  | "burst" | "sustain" | "comebacks";

export interface BuffDef {
  id: BuffId;
  /** The zone (region faction) whose mobs of this type give it. */
  zone: FactionId;
  /** An elite's buff. */
  elite: boolean;
  /** The mob type's display name: "Ember Imp". */
  name: string;
  /** One line with the quoted numbers (the value at 3 stacks): "+5% damage". */
  text: string;
  /** The rows, valued at 3 stacks. */
  effects: readonly Effect[];
  /** Set when any row needs the status runtime: shown, not applied until R4b. */
  needs?: "status";
  worksWith: readonly BuffTag[];
  counters: readonly BuffTag[];
}

type BuffRow = Omit<BuffDef, "zone" | "elite" | "name" | "text" | "needs">;

// Values at 3 stacks: ROGUELIKE_PLAN 3.4 drafted them; the owner ruled "double them" after the R4a power report (every
// value x2; caps, durations, thresholds and the grants are unchanged). The owner retunes these; sessions do not.
const ROWS: readonly BuffRow[] = [
  { id: "emberImp", effects: [{ k: "stat", stat: "damage", v: 0.1 }], worksWith: ["any"], counters: ["any"] },
  {
    id: "cinderHound", effects: [{ k: "while", cond: "chasingLock", arg: 0, stat: "moveSpeed", v: 0.1 }],
    worksWith: ["melee"], counters: ["kiters", "bow", "wand"],
  },
  {
    id: "magmaBrute", effects: [{ k: "stat", stat: "maxHp", v: 0.06 }, { k: "flat", stat: "shield", v: 20 }],
    worksWith: ["any"], counters: ["fire", "sentenced", "magic"],
  },
  { id: "wyrmling", effects: [{ k: "vs", test: "hpAbove", arg: 0.7, v: 0.2 }], worksWith: ["any"], counters: ["highHp", "frost", "holy"] },
  { id: "bailiff", effects: [{ k: "stat", stat: "markRate", v: 0.16 }], worksWith: ["sentenced"], counters: [] },
  {
    id: "chainWarden", effects: [{ k: "onHit", status: "slowMove", per: 0.1, cap: 0.25, ms: 1000, needs: "status" }],
    worksWith: ["any"], counters: ["kiters", "bow", "wand"],
  },
  { id: "inquisitor", effects: [{ k: "vs", test: "streak", arg: 3, v: 0.12, needs: "status" }], worksWith: ["any"], counters: ["longDuels"] },
  { id: "executioner", effects: [{ k: "vs", test: "hpBelow", arg: 0.3, v: 0.3 }], worksWith: ["any"], counters: ["healers", "holy"] },
  { id: "plagueRat", effects: [{ k: "stat", stat: "attackSpeed", v: 0.08 }], worksWith: ["any"], counters: ["any"] },
  {
    id: "bloatfly", effects: [{ k: "onHit", status: "dot", per: 4, cap: 1, ms: 3000, needs: "status" }],
    worksWith: ["any"], counters: ["frost", "highHp"],
  },
  {
    id: "rotMonk", effects: [{ k: "onHit", status: "antiHeal", per: 0.12, cap: 0.4, ms: 3000, needs: "status" }],
    worksWith: ["any"], counters: ["holy", "lifesteal", "healers"],
  },
  { id: "ratOgre", effects: [{ k: "vs", test: "hpBelow", arg: 0.5, v: 0.16 }], worksWith: ["any"], counters: [] },
  {
    id: "frostWisp", effects: [{ k: "onHit", status: "slowAttack", per: 0.06, cap: 0.15, ms: 2000, needs: "status" }],
    worksWith: ["any"], counters: ["plague", "fastAttacks"],
  },
  { id: "iceGolem", effects: [{ k: "stat", stat: "maxHp", v: 0.08 }], worksWith: ["any"], counters: ["burst"] },
  {
    id: "rimeStalker", effects: [{ k: "flat", stat: "armor", v: 20 }], worksWith: ["any"],
    counters: ["plague", "frost", "holy", "physical"],
  },
  { id: "glacialWarden", effects: [{ k: "vs", test: "slowed", arg: 0, v: 0.2, needs: "status" }], worksWith: ["frost"], counters: [] },
  { id: "acolyte", effects: [{ k: "stat", stat: "lifesteal", v: 0.04 }], worksWith: ["any"], counters: ["sustain"] },
  {
    id: "seraphShard", effects: [{ k: "flat", stat: "shield", v: 16 }], worksWith: ["any"],
    counters: ["fire", "sentenced", "magic"],
  },
  { id: "penitent", effects: [{ k: "scale", src: "ownMissingHp", per: 0.02, step: 0.1 }], worksWith: ["any"], counters: ["comebacks"] },
  {
    id: "bloodSaint", effects: [{ k: "trigger", on: "hpBelow", arg: 0.3, once: true, do: { do: "heal", share: 0.2, ignoreLockout: true } }],
    worksWith: ["any"], counters: ["burst"],
  },
];

const ROW_BY_ID = new Map(ROWS.map((r) => [r.id, r]));

/** Every buff, in MOB_TYPES order (zone order, then the three normal types, then the elite). */
export const BUFFS: readonly BuffDef[] = MOB_TYPES.map((t): BuffDef => {
  const row = ROW_BY_ID.get(t.id);
  if (!row) throw new Error(`no buff for mob type ${t.id}`);
  const def: BuffDef = {
    id: t.id, zone: t.zone, elite: t.elite, name: t.name, text: effectsText(row.effects), effects: row.effects,
    worksWith: row.worksWith, counters: row.counters,
  };
  if (row.effects.some((e) => e.needs === "status")) def.needs = "status";
  return def;
});

export const BUFF_IDS: readonly BuffId[] = BUFFS.map((b) => b.id);

const BUFF_BY_ID: ReadonlyMap<string, BuffDef> = new Map(BUFFS.map((b) => [b.id, b]));

export function isBuffId(v: unknown): v is BuffId {
  return typeof v === "string" && BUFF_BY_ID.has(v);
}

/** The buff with this id; undefined for an id that is not in the catalog (newer server content). */
export function buffDef(id: string): BuffDef | undefined {
  return BUFF_BY_ID.get(id);
}

/** The buffs whose `counters` name `tag` (a faction id, a weapon id or a word). */
export function buffsCountering(tag: BuffTag): BuffDef[] {
  return BUFFS.filter((b) => b.counters.includes(tag));
}

// ------------------------------------------------------------------------------------------------ scaled rows

/** Stack counts by buff id: a PlayerState's `buffs` map (MapSchema), a Map, or a plain record. */
export type BuffStacks = { get(id: string): number | undefined } | Readonly<Record<string, number>>;

/** Stacks of `id` held (0 for none or a bad value, and for no map at all: a state from a server without buffs). */
export function stacksIn(stacks: BuffStacks | null | undefined, id: string): number {
  if (stacks == null) return 0;
  const get = (stacks as { get?: unknown }).get;
  const n = typeof get === "function" ? (stacks as { get(id: string): number | undefined }).get(id) : (stacks as Record<string, number>)[id];
  return typeof n === "number" && n > 0 ? n : 0;
}

/** A row's numbers times `k`: a stat, flat, vs or while row's `v`; a scale or onHit row's `per` (an onHit `cap` never moves); a trigger's amount. */
export function scaleEffect(e: Effect, k: number): Effect {
  return visitEffect<Effect>(e, {
    stat: (r) => ({ ...r, v: r.v * k }),
    flat: (r) => ({ ...r, v: r.v * k }),
    vs: (r) => ({ ...r, v: r.v * k }),
    while: (r) => ({ ...r, v: r.v * k }),
    scale: (r) => ({ ...r, per: r.per * k }),
    onHit: (r) => ({ ...r, per: r.per * k }),
    trigger: (r) => {
      const a = r.do;
      switch (a.do) {
        case "heal": return { ...r, do: { ...a, share: a.share * k } };
        case "barrier": return { ...r, do: { ...a, share: a.share * k } };
        case "status": return a.value === undefined ? r : { ...r, do: { ...a, value: a.value * k } };
        case "cleanse":
        case "cooldown":
          return r;
      }
    },
  });
}

/** One buff's rows at `stacks` (rows that need the status runtime are left out unless `includeNeeds`). */
export function buffRowsOf(id: string, stacks: number, opts: { includeNeeds?: boolean } = {}): Effect[] {
  const def = buffDef(id);
  const k = buffScale(stacks);
  if (!def || !(k > 0)) return [];
  const out: Effect[] = [];
  for (const e of def.effects) if (opts.includeNeeds || e.needs !== "status") out.push(scaleEffect(e, k));
  return out;
}

/**
 * Every owned buff's rows, scaled to its stack count, in catalog order (so a sum over them is the same whatever order the
 * buffs were gained in). Rows with `needs: "status"` are left out (they are not applied before R4b) unless `includeNeeds`.
 */
export function buffRows(stacks: BuffStacks | null | undefined, opts: { includeNeeds?: boolean } = {}): Effect[] {
  const out: Effect[] = [];
  for (const def of BUFFS) {
    const n = stacksIn(stacks, def.id);
    if (n > 0) for (const e of buffRowsOf(def.id, n, opts)) out.push(e);
  }
  return out;
}

/**
 * A rough measure of how strong a build is, in stacks at the quoted value: 3 x buffScale(n) summed over the buffs held
 * (one buff at 3 stacks is 3; spreading over many types is worth less than the same stacks in one). The bots read it.
 */
export function buffPower(stacks: BuffStacks | null | undefined): number {
  let sum = 0;
  for (const def of BUFFS) {
    const n = stacksIn(stacks, def.id);
    if (n > 0) sum += BUFF_REF_STACKS * buffScale(n);
  }
  return sum;
}

/**
 * The share of the damage it lands a fighter heals: its faction's own lifesteal (Holy's, `own`) plus what its `lifesteal`
 * rows add (`rows`, capped at LS_CAP), never more than LIFESTEAL_MAX in all.
 */
export function lifestealShare(own: number, rows: number): number {
  const fromRows = rows > 0 ? Math.min(LS_CAP, rows) : 0;
  return Math.min(LIFESTEAL_MAX, (own > 0 ? own : 0) + fromRows);
}

// ------------------------------------------------------------------------------------------------------ wording

/** A fraction as a percent with at most one decimal: 0.05 "5", 0.0539 "5.4". */
function pct(v: number): string {
  return String(Math.round(v * 1000) / 10);
}

/** Points with at most one decimal: 10 "10", 10.84 "10.8". */
function pts(v: number): string {
  return String(Math.round(v * 10) / 10);
}

// A function, not a table: BUFFS is built (and its texts written) while this module loads, before a const here would exist.
function statWord(stat: StatKey): string {
  switch (stat) {
    case "maxHp": return "max HP";
    case "attackSpeed": return "attack speed";
    case "moveSpeed": return "move speed";
    case "damage": return "damage";
    case "windup": return "windup time";
    case "lifesteal": return "lifesteal";
    case "markRate": return "mark ramp speed (Sentenced only)";
    case "healTaken": return "healing taken";
    case "damageTaken": return "damage taken";
    case "cooldown": return "cooldown time";
    case "armor": return "armor";
    case "shield": return "magic resist";
  }
}

function signed(v: number, s: string): string {
  return v < 0 ? `-${s}` : `+${s}`;
}

/** One row in words, numbers as given (already scaled): "+5% damage". */
export function effectText(e: Effect): string {
  return visitEffect<string>(e, {
    stat: (r) => `${signed(r.v, `${pct(Math.abs(r.v))}%`)} ${statWord(r.stat)}`,
    flat: (r) => `${signed(r.v, pts(Math.abs(r.v)))} ${statWord(r.stat)}`,
    vs: (r) => {
      const amount = `${signed(r.v, `${pct(Math.abs(r.v))}%`)} damage`;
      switch (r.test) {
        case "hpAbove": return `${amount} to targets above ${pct(r.arg)}% HP`;
        case "hpBelow": return `${amount} to targets below ${pct(r.arg)}% HP`;
        case "slowed": return `${amount} to slowed or chilled targets`;
        case "rooted": return `${amount} to rooted targets`;
        case "streak": return `${amount} to a target you have kept hitting for ${pts(r.arg)} s`;
        case "thirdParty": return `${amount} to targets fighting someone else`;
        case "higherFeed": return `${amount} to targets with a higher feed`;
      }
    },
    scale: (r) => `+${pct(r.per)}% damage per ${pct(r.step)}% HP missing`,
    while: (r) => {
      const amount = r.stat === "armor" || r.stat === "shield"
        ? `${signed(r.v, pts(Math.abs(r.v)))} ${statWord(r.stat)}`
        : `${signed(r.v, `${pct(Math.abs(r.v))}%`)} ${statWord(r.stat)}`;
      switch (r.cond) {
        case "chasingLock": return `${amount} while chasing your target`;
        case "hpBelow": return `${amount} while below ${pct(r.arg)}% HP`;
        case "afterCast": return `${amount} for ${pts((r.ms ?? 0) / 1000)} s after a cast`;
      }
    },
    onHit: (r) => {
      const s = pts(r.ms / 1000);
      switch (r.status) {
        case "slowMove": return `Your hits slow movement ${pct(r.per)}% for ${s} s (up to ${pct(r.cap)}%)`;
        case "slowAttack": return `Your hits slow attacks ${pct(r.per)}% for ${s} s (up to ${pct(r.cap)}%)`;
        case "antiHeal": return `Your hits cut healing ${pct(r.per)}% for ${s} s (up to ${pct(r.cap)}%)`;
        case "dot": return `Your hits deal ${pts(r.per * DUEL_PACE)} damage/s for ${s} s`;
      }
    },
    trigger: (r) => {
      const when = r.on === "hpBelow" ? `Below ${pct(r.arg)}% HP` : r.on === "kill" ? "On a kill" : "When hit";
      const once = r.once ? " (once per run)" : "";
      const a = r.do;
      switch (a.do) {
        case "heal": return `${when}: heal ${pct(a.share)}% of max HP${once}`;
        case "barrier": return `${when}: a barrier of ${pct(a.share)}% of max HP for ${pts(a.ms / 1000)} s${once}`;
        case "status": return `${when}: ${a.status} for ${pts(a.ms / 1000)} s${once}`;
        case "cleanse": return `${when}: cleanse${once}`;
        case "cooldown": return `${when}: cooldowns ${pts(a.ms / 1000)} s shorter${once}`;
      }
    },
  });
}

/** Rows in words, joined: "+3% max HP and +10 magic resist". */
export function effectsText(effects: readonly Effect[]): string {
  return effects.map(effectText).join(" and ");
}

/** A buff's line at `stacks` (the quoted line at 3): every number scaled. "" for an unknown id. */
export function buffText(id: string, stacks: number = BUFF_REF_STACKS): string {
  const def = buffDef(id);
  if (!def) return "";
  const k = buffScale(stacks);
  return effectsText(def.effects.map((e) => scaleEffect(e, k)));
}

// ---------------------------------------------------------------------------------------------------------- feed
// The feed score itself (feedScore) and the bounty (bountyFor) are in rules.ts.

/** The mob reward curve: near 1 while hungry, falling sharply around a feed of REWARD_MID, never below REWARD_FLOOR. */
export function rewardCurve(feed: number): number {
  return REWARD_FLOOR + (1 - REWARD_FLOOR) * (1 - sigmoid((feed - REWARD_MID) / REWARD_WIDTH));
}

/** Median of the values (the mean of the two middle ones for an even count); 0 for none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** CATCHUP_MULT for a feed more than CATCHUP_GAP below the lobby median, else 1. */
export function catchUpMultiplier(feed: number, medianFeed: number): number {
  return feed < medianFeed - CATCHUP_GAP ? CATCHUP_MULT : 1;
}

/** What a mob's GV and buff stacks are multiplied by for a player with this feed in a lobby with this median feed. */
export function mobRewardMultiplier(feed: number, medianFeed: number): number {
  return rewardCurve(feed) * catchUpMultiplier(feed, medianFeed);
}

/** The stacks a bounty kill moves to the killer from a victim holding `stacks` of one buff. */
export function bountyStacks(stacks: number): number {
  return stacks * BOUNTY_STACK_SHARE;
}
