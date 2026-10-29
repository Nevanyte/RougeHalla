// Effect rows in words (BALANCE_CONTRACT 4.6): "+5% damage", "attack speed x0.5". The card catalog writes its own player-facing texts
// (cards.ts); these are for tooltips of crafted rows (relics later), the training console and the tests. Pure.
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
    case "markRate": return "mark tier climb speed (Sentenced only)";
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

/** A `flag` row in words. */
function flagWords(flag: EffectOf<"flag">["flag"]): string {
  switch (flag) {
    case "lockSecondSlot": return "Your second weapon slot is locked";
    case "noCrit": return "Your hits can never critically strike";
    case "dotCrit": return "Your damage over time can critically strike";
    case "plagueDotCritConversion": return "Your DoT critical chance becomes steady DoT damage";
    case "gambler": return "Each hit has a chance to deal double damage and the same chance to deal half";
    case "thirdCharm": return "Every 3rd hit on the same target applies its on-hit effects once more";
    case "eyeForAnEye": return "Damage you return to attackers applies your on-hit effects";
    case "twiceUnarmed": return "Your on-hit effects apply twice while unarmed";
    case "blockHits": return "Your blocks count as hits";
    case "plantFeet": return "After standing still, your next attack has more range and damage";
    case "festering": return "Your magic damage over time keeps ticking after it ends";
    case "heavierSentence": return "Your marks deal more the more bonus max health you have";
    case "swiftJudgment": return "Every 2nd hit on a marked enemy counts as a weapon swap for your marks' tiers";
    case "gallowsPatience": return "Your zone Wish lasts longer and its escape stun is longer";
    case "noCommutation": return "A weapon swap by a marked enemy promotes your mark two tiers";
    case "finalVerdict": return "An execute your mark blocks is paid back to its attacker as true damage";
  }
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
        case "streak": return r.arg === 0 ? `${amount} on your first hit on a target` : `${amount} on your first ${pts(r.arg + 1)} hits on a target`;
        case "thirdParty": return `${amount} to targets fighting someone else`;
        case "higherFeed": return `${amount} to targets with a higher feed`;
        case "elite": return `${amount} to elite monsters`;
        case "higherPower": return `${amount} to players with more card power than you`;
        case "playerAbove": return `${amount} to players above ${pct(r.arg)}% HP`;
      }
    },
    scale: (r) => {
      const upTo = r.cap === undefined ? "" : ` (up to +${pct(r.cap)}%)`;
      if (r.src === "streak") return `+${pct(r.per)}% damage per hit in a row on the same target${upTo}`;
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
        // A bleed is a share of the hit; every other status of an on-hit row keeps its strength per hit.
        case "dot": return `Your physical hits make the target bleed for ${pct(r.per)}% of the hit over ${s} s`;
      }
    },
    convert: (r) => r.cap === undefined ? convertWords(r) : `${convertWords(r)} (up to ${pts(isFlatStat(r.to) ? r.cap : r.cap * 100)}${isFlatStat(r.to) ? "" : "%"})`,
    mult: (r) => `${multWord(r.key)} x${pts(r.v)}`,
    flag: (r) => flagWords(r.flag),
    trigger: (r) => {
      const when = r.on === "hpBelow" ? `Below ${pct(r.arg)}% HP`
        : r.on === "kill" ? "On a kill"
        : r.on === "hit" ? "On each hit you land"
        : r.on === "block" ? "On each block"
        : r.arg > 0 ? `When a hit takes ${pct(r.arg)}% of your max HP` : "When hit";
      const once = r.once ? (r.rearm === "teleport" ? " (once, and again after each teleport)" : " (once per run)") : "";
      const a = r.do;
      switch (a.do) {
        case "heal": return `${when}: heal ${pct(a.share)}% of max HP${a.ms ? ` over ${pts(healOverTimeSpanMs(a.ms) / 1000)} s` : ""}${once}`;
        case "barrier": return `${when}: a barrier of ${pct(a.share)}% of max HP for ${pts(a.ms / 1000)} s${once}`;
        case "status": return `${when}: ${a.status} for ${pts(a.ms / 1000)} s${once}`;
        case "cleanse": return `${when}: cleanse${once}`;
        case "cooldown": return `${when}: cooldowns ${pts(a.ms / 1000)} s shorter${once}`;
        case "boost": return `${when}: +${pct(a.as)}% attack speed and +${pct(a.move)}% move speed for ${pts(a.ms / 1000)} s${once}`;
        case "return": return `${when}: ${pct(a.share)}% of the damage dealt comes back as physical damage${a.melee ? " (melee only)" : ""}${once}`;
        case "fortify": return `${when}: +1 max HP per ${pts(1 / a.per)} damage prevented (up to +${pts(a.cap)})${once}`;
        case "splash": return `${when}: the damage beyond it splashes onto the nearest enemy within ${pts(a.radius)} u${once}`;
      }
    },
  });
}

/** Rows in words, joined: "+3% max HP and +10 magic resist". */
export function effectsText(effects: readonly Effect[]): string {
  return effects.map(effectText).join(" and ");
}
