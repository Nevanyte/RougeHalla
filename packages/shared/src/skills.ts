// Skills (roguelike R5, ROGUELIKE_PLAN 3.6): what a camp's shared chest offers. Pure data and helpers, read by the sim
// (sim/chests.ts rolls and applies them, sim/mods.ts folds their rows), the client (the chest panel, tooltips) and tests.
//
// Until R6 brings the active skills (Q/E), the catalog holds the passives only. A passive has two ranks; picking a passive
// you own applies its rank 2, and one you own at rank 2 cannot be picked (ROGUELIKE_PLAN D6). A player's ranks are the
// synced `PlayerState.build` map (id -> rank).
//
// `ready` says when a passive's machinery exists. Only the LIVE ones (LIVE_SKILL_READY: "r5" today) are rolled into chests
// and folded by the sim; the others are catalog data (text, tags) so the UI and the Codex can show them, and their rows,
// where the Effect union can already say them, are never applied. R4b makes "r4b" live (firebrand, hoarfrostArmor) by
// adding it to LIVE_SKILL_READY once the status runtime is in.
//
// Numbers are ROGUELIKE_PLAN 3.6's (the owner's "double them" ruling was for BuffDef rows only). The owner retunes them;
// sessions do not.
import { effectsText, type BuffTag } from "./buffs";
import type { Effect } from "./effects";
import type { FactionId } from "./factions";

export type SkillId =
  | "firebrand" | "searingRiposte" | "ashwalk"
  | "doubleSentence" | "witness" | "sentenceServed"
  | "biteTwice" | "pestilence"
  | "shatter" | "frozenPath" | "hoarfrostArmor"
  | "radiance" | "lastRites"
  | "whetstone" | "swiftBoots" | "quickdraw" | "thickHide" | "bountyHunter" | "quartermaster" | "scout" | "secondWind";

/** The zone whose chests offer it, or "neutral" (every chest's filler). */
export type SkillPool = FactionId | "neutral";
/** "passive" only until R6 adds "active". */
export type SkillKind = "passive";
/** The phase whose machinery the skill needs: only LIVE_SKILL_READY ones are rolled and applied. */
export type SkillReady = "r5" | "r4b" | "r6" | "r7";
/** Tags as the buffs use them (shared/buffs.ts BuffTag): what a skill suits and what it is strong against. */
export type SkillTag = BuffTag;

/** The phases whose skills are live now. R4b appends "r4b"; R6 "r6"; R7 "r7". */
export const LIVE_SKILL_READY: readonly SkillReady[] = ["r5"];

/** A passive's highest rank. */
export const SKILL_MAX_RANK = 2;

export interface SkillRank {
  /** The rows of this rank (not scaled by anything: a rank is a fixed step). */
  effects: readonly Effect[];
  /**
   * Rows that REPLACE `effects` for a fighter of that faction (Pestilence: Plague widens its execute instead of the
   * damage row everyone else gets).
   */
  byFaction?: Partial<Record<FactionId, readonly Effect[]>>;
  /** The rank in one line: generated from the rows, or written out where the rows cannot say it (a later phase's machinery). */
  text: string;
}

export interface SkillDef {
  id: SkillId;
  pool: SkillPool;
  kind: SkillKind;
  /** Display name: "Swift Boots". */
  name: string;
  ready: SkillReady;
  /** Rank 1, then rank 2. */
  ranks: readonly [SkillRank, SkillRank];
  worksWith: readonly SkillTag[];
  counters: readonly SkillTag[];
  /** A caveat the HUD tooltip adds under the rank lines (Quickdraw: windups end on ticks). Not part of any card's text. */
  note?: string;
}

type RankRow = { effects: readonly Effect[]; byFaction?: Partial<Record<FactionId, readonly Effect[]>>; text?: string };
type Row = Omit<SkillDef, "ranks"> & { ranks: readonly [RankRow, RankRow] };

function rank(r: RankRow): SkillRank {
  if (r.text === undefined && r.byFaction !== undefined) throw new Error("a rank with faction rows needs its own text");
  const text = r.text ?? effectsText(r.effects);
  return r.byFaction ? { effects: r.effects, byFaction: r.byFaction, text } : { effects: r.effects, text };
}

// Zone order (REGION_FACTIONS), then the neutrals; within a pool, the plan's table order.
const ROWS: readonly Row[] = [
  // ---- Fire
  {
    id: "firebrand", pool: "fire", kind: "passive", name: "Firebrand", ready: "r4b",
    ranks: [
      { effects: [], text: "Weapon hits burn for 10% of a second of your damage over 2 s" },
      { effects: [], text: "Weapon hits burn for 15% of a second of your damage over 2 s" },
    ],
    worksWith: ["any"], counters: ["holy", "healers"],
  },
  {
    id: "searingRiposte", pool: "fire", kind: "passive", name: "Searing Riposte", ready: "r7",
    ranks: [
      { effects: [], text: "Melee hits you take burn the attacker for 15% of the hit" },
      { effects: [], text: "Melee hits you take burn the attacker for 25% of the hit" },
    ],
    worksWith: ["any"], counters: ["melee"],
  },
  {
    id: "ashwalk", pool: "fire", kind: "passive", name: "Ashwalk", ready: "r6",
    ranks: [
      {
        effects: [{ k: "stat", stat: "moveSpeed", v: 0.05 }, { k: "while", cond: "afterCast", arg: 0, stat: "moveSpeed", v: 0.2, ms: 2000 }],
      },
      {
        effects: [{ k: "stat", stat: "moveSpeed", v: 0.08 }, { k: "while", cond: "afterCast", arg: 0, stat: "moveSpeed", v: 0.3, ms: 2000 }],
      },
    ],
    worksWith: ["melee"], counters: ["kiters"],
  },
  // ---- Sentenced
  {
    id: "doubleSentence", pool: "sentenced", kind: "passive", name: "Double Sentence", ready: "r6",
    ranks: [
      { effects: [], text: "Every 4th attack hits twice (the second at 60%)" },
      { effects: [], text: "Every 3rd attack hits twice (the second at 60%)" },
    ],
    worksWith: ["any"], counters: ["longDuels"],
  },
  {
    id: "witness", pool: "sentenced", kind: "passive", name: "Witness", ready: "r5",
    ranks: [
      { effects: [{ k: "vs", test: "thirdParty", arg: 0, v: 0.08 }] },
      { effects: [{ k: "vs", test: "thirdParty", arg: 0, v: 0.12 }] },
    ],
    worksWith: ["any"], counters: [],
  },
  {
    id: "sentenceServed", pool: "sentenced", kind: "passive", name: "Sentence Served", ready: "r6",
    ranks: [
      { effects: [], text: "When an enemy you hit in the last 3 s dies: heal 8% of max HP, Q/E cooldowns 2 s shorter" },
      { effects: [], text: "When an enemy you hit in the last 3 s dies: heal 12% of max HP, Q/E cooldowns 3 s shorter" },
    ],
    worksWith: ["any"], counters: [],
  },
  // ---- Plague
  {
    id: "biteTwice", pool: "plague", kind: "passive", name: "Bite Twice", ready: "r6",
    ranks: [
      { effects: [], text: "Every 3rd weapon hit bites again at 55%" },
      { effects: [], text: "Every 2nd weapon hit bites again at 55%" },
    ],
    worksWith: ["any"], counters: [],
  },
  {
    id: "pestilence", pool: "plague", kind: "passive", name: "Pestilence", ready: "r5",
    ranks: [
      {
        effects: [{ k: "vs", test: "hpBelow", arg: 0.6, v: 0.08 }],
        byFaction: { plague: [{ k: "stat", stat: "executeBand", v: 0.1 }] },
        text: "Plague: execute starts at 60% HP (from 50%). Others: +8% damage to targets below 60% HP",
      },
      {
        effects: [{ k: "vs", test: "hpBelow", arg: 0.6, v: 0.12 }],
        byFaction: { plague: [{ k: "stat", stat: "executeBand", v: 0.2 }] },
        text: "Plague: execute starts at 70% HP (from 50%). Others: +12% damage to targets below 60% HP",
      },
    ],
    worksWith: ["any"], counters: ["healers", "holy"],
  },
  // ---- Frost
  {
    id: "shatter", pool: "frost", kind: "passive", name: "Shatter", ready: "r6",
    ranks: [
      { effects: [{ k: "vs", test: "rooted", arg: 0, v: 0.15 }], text: "+15% damage to rooted or frozen targets" },
      { effects: [{ k: "vs", test: "rooted", arg: 0, v: 0.25 }], text: "+25% damage to rooted or frozen targets" },
    ],
    worksWith: ["frost"], counters: [],
  },
  {
    id: "frozenPath", pool: "frost", kind: "passive", name: "Frozen Path", ready: "r6",
    ranks: [
      { effects: [], text: "Every second of walking leaves a 2 s ice patch that slows enemies 20%" },
      { effects: [], text: "Every second of walking leaves a 2 s ice patch that slows enemies 30%" },
    ],
    worksWith: ["any"], counters: ["melee"],
  },
  {
    id: "hoarfrostArmor", pool: "frost", kind: "passive", name: "Hoarfrost Armor", ready: "r4b",
    ranks: [
      { effects: [{ k: "flat", stat: "armor", v: 12 }], text: "+12 armor; melee attackers get -10% attack speed for 1 s" },
      { effects: [{ k: "flat", stat: "armor", v: 18 }], text: "+18 armor; melee attackers get -15% attack speed for 1 s" },
    ],
    worksWith: ["any"], counters: ["melee", "physical"],
  },
  // ---- Holy
  {
    id: "radiance", pool: "holy", kind: "passive", name: "Radiance", ready: "r6",
    ranks: [
      { effects: [], text: "Overheal becomes a barrier, up to 15% of max HP (decays over 5 s)" },
      { effects: [], text: "Overheal becomes a barrier, up to 25% of max HP (decays over 5 s)" },
    ],
    worksWith: ["holy", "lifesteal"], counters: ["burst"],
  },
  {
    id: "lastRites", pool: "holy", kind: "passive", name: "Last Rites", ready: "r5",
    ranks: [
      { effects: [{ k: "while", cond: "hpBelow", arg: 0.3, stat: "attackSpeed", v: 0.25 }] },
      { effects: [{ k: "while", cond: "hpBelow", arg: 0.4, stat: "attackSpeed", v: 0.25 }] },
    ],
    worksWith: ["any"], counters: ["comebacks"],
  },
  // ---- Neutral
  {
    id: "whetstone", pool: "neutral", kind: "passive", name: "Whetstone", ready: "r5",
    ranks: [{ effects: [{ k: "stat", stat: "damage", v: 0.06 }] }, { effects: [{ k: "stat", stat: "damage", v: 0.1 }] }],
    worksWith: ["any"], counters: ["any"],
  },
  {
    id: "swiftBoots", pool: "neutral", kind: "passive", name: "Swift Boots", ready: "r5",
    ranks: [{ effects: [{ k: "stat", stat: "moveSpeed", v: 0.06 }] }, { effects: [{ k: "stat", stat: "moveSpeed", v: 0.1 }] }],
    worksWith: ["any"], counters: ["kiters"],
  },
  {
    id: "quickdraw", pool: "neutral", kind: "passive", name: "Quickdraw", ready: "r5",
    ranks: [{ effects: [{ k: "stat", stat: "windup", v: -0.08 }] }, { effects: [{ k: "stat", stat: "windup", v: -0.12 }] }],
    worksWith: ["bow", "axe"], counters: ["kiters"],
    note: "Never below 0.55 s on the bow, and the wand's 0.4 s does not shorten. A windup ends on a 50 ms tick, so the gain comes in whole ticks.",
  },
  {
    id: "thickHide", pool: "neutral", kind: "passive", name: "Thick Hide", ready: "r5",
    ranks: [
      { effects: [{ k: "stat", stat: "maxHp", v: 0.06 }, { k: "flat", stat: "armor", v: 5 }, { k: "flat", stat: "shield", v: 5 }] },
      { effects: [{ k: "stat", stat: "maxHp", v: 0.1 }, { k: "flat", stat: "armor", v: 8 }, { k: "flat", stat: "shield", v: 8 }] },
    ],
    worksWith: ["any"], counters: ["burst"],
  },
  {
    id: "bountyHunter", pool: "neutral", kind: "passive", name: "Bounty Hunter", ready: "r5",
    ranks: [
      { effects: [{ k: "vs", test: "higherFeed", arg: 0, v: 0.1 }] },
      { effects: [{ k: "vs", test: "higherFeed", arg: 0, v: 0.15 }] },
    ],
    worksWith: ["any"], counters: [],
  },
  {
    id: "quartermaster", pool: "neutral", kind: "passive", name: "Quartermaster", ready: "r6",
    ranks: [{ effects: [{ k: "stat", stat: "cooldown", v: -0.12 }] }, { effects: [{ k: "stat", stat: "cooldown", v: -0.18 }] }],
    worksWith: ["any"], counters: [],
  },
  {
    id: "scout", pool: "neutral", kind: "passive", name: "Scout", ready: "r7",
    ranks: [
      { effects: [], text: "Shows you every \"?\" camp's reward" },
      { effects: [], text: "Shows you every \"?\" camp's reward, and enemies within 480 u on your minimap" },
    ],
    worksWith: ["any"], counters: [],
  },
  {
    id: "secondWind", pool: "neutral", kind: "passive", name: "Second Wind", ready: "r5",
    ranks: [
      {
        effects: [{ k: "trigger", on: "hpBelow", arg: 0.25, once: true, do: { do: "heal", share: 0.2, ignoreLockout: true, ms: 2000 } }],
      },
      {
        effects: [{
          k: "trigger", on: "hpBelow", arg: 0.25, once: true, rearm: "teleport",
          do: { do: "heal", share: 0.3, ignoreLockout: true, ms: 2000 },
        }],
      },
    ],
    worksWith: ["any"], counters: ["burst"],
  },
];

/** Every passive, zone order then the neutrals. */
export const SKILLS: readonly SkillDef[] = ROWS.map((r) => ({ ...r, ranks: [rank(r.ranks[0]), rank(r.ranks[1])] as const }));

export const SKILL_IDS: readonly SkillId[] = SKILLS.map((s) => s.id);

const SKILL_BY_ID: ReadonlyMap<string, SkillDef> = new Map(SKILLS.map((s) => [s.id, s]));

export function isSkillId(v: unknown): v is SkillId {
  return typeof v === "string" && SKILL_BY_ID.has(v);
}

/** The skill with this id; undefined for an id that is not in the catalog (newer server content). */
export function skillDef(id: string): SkillDef | undefined {
  return SKILL_BY_ID.get(id);
}

/** Is the skill's machinery in (LIVE_SKILL_READY)? Only live skills are rolled into chests and applied by the sim. */
export function skillLive(skill: SkillDef | string): boolean {
  const def = typeof skill === "string" ? skillDef(skill) : skill;
  return def !== undefined && LIVE_SKILL_READY.includes(def.ready);
}

/** The skills a pool offers (zone order, then catalog order). */
export function skillsOf(pool: SkillPool, opts: { liveOnly?: boolean } = {}): SkillDef[] {
  return SKILLS.filter((s) => s.pool === pool && (!opts.liveOnly || skillLive(s)));
}

/** A build's ranks: a PlayerState's `build` map (MapSchema), a Map, or a plain record. */
export type BuildRanks = { get(id: string): number | undefined } | Readonly<Record<string, number>>;

/** The rank of `id` held (0 for none, a bad value, or no build at all), never above SKILL_MAX_RANK. */
export function rankIn(build: BuildRanks | null | undefined, id: string): number {
  if (build == null) return 0;
  const get = (build as { get?: unknown }).get;
  const n = typeof get === "function" ? (build as { get(id: string): number | undefined }).get(id) : (build as Record<string, number>)[id];
  return typeof n === "number" && n > 0 ? Math.min(SKILL_MAX_RANK, Math.floor(n)) : 0;
}

/** The rank picking `id` would give (1 if not owned, 2 if owned at rank 1), or null when it is already at the top rank. */
export function nextRank(build: BuildRanks | null | undefined, id: string): 1 | 2 | null {
  const r = rankIn(build, id);
  return r <= 0 ? 1 : r === 1 ? 2 : null;
}

/** The rank's own rows for a fighter of `faction` (its byFaction rows where it has some). [] for rank 0 or an unknown id. */
export function skillRows(id: string, rankNo: number, faction?: string): readonly Effect[] {
  const def = skillDef(id);
  if (!def || !(rankNo >= 1)) return [];
  const r = def.ranks[Math.min(SKILL_MAX_RANK, Math.floor(rankNo)) - 1]!;
  const own = faction !== undefined ? r.byFaction?.[faction as FactionId] : undefined;
  return own ?? r.effects;
}

/**
 * A rank in one line. With a faction, only what applies to that faction (Pestilence says either its Plague line or the
 * others' one); without, the rank's full text. "" for an unknown id or rank 0.
 */
export function skillText(id: string, rankNo: number, faction?: string): string {
  const def = skillDef(id);
  if (!def || !(rankNo >= 1)) return "";
  const r = def.ranks[Math.min(SKILL_MAX_RANK, Math.floor(rankNo)) - 1]!;
  if (faction === undefined || !r.byFaction) return r.text;
  const own = r.byFaction[faction as FactionId];
  return effectsText(own ?? r.effects);
}
