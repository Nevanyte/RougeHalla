// Effect rows in words (BALANCE_CONTRACT 4.6): "+5% damage", "attack speed x0.5". The card catalog writes its own player-facing texts
// (cards.ts); these are for tooltips of crafted rows (relics later), the training console and the tests. Pure.
import { DUEL_PACE } from "./constants";
import { isFlatStat, visitEffect, type Effect, type EffectOf, type MultKey, type StatKey } from "./effects";
import { healOverTimeSpanMs } from "./rules";

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
    case "windup": return "melee windup time";
    case "lifesteal": return "lifesteal";
    case "markRate": return "mark ramp speed (Sentenced only)";
    case "healTaken": return "healing taken";
    case "damageTaken": return "damage taken";
    case "cooldown": return "cooldown time";
    case "executeBand": return "execute threshold (Plague only)";
    case "slowResist": return "slow resistance";
    case "lifestealMult": return "lifesteal";
    case "lifestealDot": return "lifesteal on damage over time";
    case "critChance": return "critical strike chance";
    case "healBarrier": return "of healing received as a barrier";
    case "armor": return "armor";
    case "shield": return "magic resist";
    case "ad": return "attack damage";
    case "ap": return "ability power";
  }
}

/** A `mult` row in words: "attack speed x0.5". */
function multWord(key: MultKey): string {
  switch (key) {
    case "asPost": return "attack speed";
    case "hit": return "damage per hit";
    case "dot": return "damage over time";
    case "returned": return "returned damage";
    case "ap": return "ability power";
    case "wishCooldown": return "Wish cooldown";
    case "hpRace": return "damage dealt and taken, up to";
    case "linger": return "damage-over-time linger";
  }
}

/** A `convert` row's source, in words, with the unit `per` is quoted against ("per 4 attack damage"). */
function convertWords(r: EffectOf<"convert">): string {
  const to = statWord(r.to);
  const pctTo = !isFlatStat(r.to); // a fraction stat is quoted in percent
  switch (r.from) {
    case "ad": return r.per >= 1 ? `+${pts(r.per)} ${to} per attack damage` : `+1 ${to} per ${pts(1 / r.per)} attack damage`;
    case "maxHp": return `+${pts(r.per * 100)} ${to} per 100 max HP`;
    case "bonusAttackSpeed": return `+${pts(pctTo ? r.per : r.per / 100)}${pctTo ? "%" : ""} ${to} per 1% bonus attack speed`;
    case "bonusMoveSpeed": return `+${pts(pctTo ? r.per : r.per / 100)}${pctTo ? "%" : ""} ${to} per 1% bonus move speed`;
  }
}

function signed(v: number, s: string): string {
  return v < 0 ? `-${s}` : `+${s}`;
}

/** One row in words, numbers as given (already scaled): "+5% damage". */
export function effectText(e: Effect): string {
  return visitEffect<string>(e, {
    stat: (r) => r.stat === "executeBand"
      ? `Execute starts at ${pct(0.5 + r.v)}% HP (from 50%; Plague only)`
      : r.stat === "lifestealMult"
        ? `x${pts(1 + r.v)} ${statWord(r.stat)} from your lifesteal effects`
        : `${signed(r.v, `${pct(Math.abs(r.v))}%`)} ${statWord(r.stat)}`,
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
        case "elite": return `${amount} to elite monsters`;
        case "higherPower": return `${amount} to players with more card power than you`;
        case "playerAbove": return `${amount} to players above ${pct(r.arg)}% HP`;
      }
    },
    scale: (r) => {
      const upTo = r.cap === undefined ? "" : ` (up to +${pct(r.cap)}%)`;
      return r.src === "campsCleared"
        ? `+${pct(r.per)}% damage for every camp you helped clear${upTo}`
        : `+${pct(r.per)}% damage per ${pct(r.step)}% HP missing${upTo}`;
    },
    while: (r) => {
      const amount = r.stat === "armor" || r.stat === "shield"
        ? `${signed(r.v, pts(Math.abs(r.v)))} ${statWord(r.stat)}`
        : `${signed(r.v, `${pct(Math.abs(r.v))}%`)} ${statWord(r.stat)}`;
      switch (r.cond) {
        case "chasingLock": return `${amount} while chasing your target`;
        case "hpBelow": return `${amount} while below ${pct(r.arg)}% HP`;
        case "afterCast": return `${amount} for ${pts((r.ms ?? 0) / 1000)} s after a cast`;
        case "notShooting": return `${amount}, but not while you shoot or for ${pts((r.ms ?? 0) / 1000)} s after a bow or wand shot`;
        case "unarmed": return `${amount} while unarmed`;
        case "fightTime": return `${amount} once a fight has lasted ${pts(r.arg)} s`;
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
    convert: (r) => r.cap === undefined ? convertWords(r) : `${convertWords(r)} (up to ${pts(isFlatStat(r.to) ? r.cap : r.cap * 100)}${isFlatStat(r.to) ? "" : "%"})`,
    mult: (r) => `${multWord(r.key)} x${pts(r.v)}`,
    flag: (r) => r.flag === "lockSecondSlot" ? "Your second weapon slot is locked" : "Your hits can never critically strike",
    trigger: (r) => {
      const when = r.on === "hpBelow" ? `Below ${pct(r.arg)}% HP` : r.on === "kill" ? "On a kill" : "When hit";
      const once = r.once ? (r.rearm === "teleport" ? " (once, and again after each teleport)" : " (once per run)") : "";
      const a = r.do;
      switch (a.do) {
        case "heal": return `${when}: heal ${pct(a.share)}% of max HP${a.ms ? ` over ${pts(healOverTimeSpanMs(a.ms) / 1000)} s` : ""}${once}`;
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
