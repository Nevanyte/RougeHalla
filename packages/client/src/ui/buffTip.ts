// The wording of a build-strip chip's tooltip: what the buff gives now, what the next kill adds, and the matchup tags (what it
// works with and what it is strong against), so the knowledge the planning screen offers stays visible during the run. Pure.
import {
  FACTIONS, WEAPONS, buffDef, buffToast, formatGain, isFactionId, isWeaponId, type BuffTag, type BuffView,
} from "@raid/shared";

/** The words (not faction or weapon ids) a BuffTag can be, as the player reads them. */
const WORD: Readonly<Record<string, string>> = {
  any: "anyone",
  melee: "melee fighters",
  kiters: "kiters",
  magic: "magic damage",
  physical: "physical damage",
  highHp: "high-HP fighters",
  healers: "healers",
  lifesteal: "lifesteal",
  longDuels: "long duels",
  fastAttacks: "fast attackers",
  burst: "burst damage",
  sustain: "sustain",
  comebacks: "comebacks",
};

/** One tag in words: a faction by its name ("Demon Blood"), a weapon as its users ("bow users"), a word as above; an unknown tag as given. */
export function tagLabel(tag: string): string {
  if (isFactionId(tag)) return FACTIONS[tag].displayName;
  if (isWeaponId(tag)) return `${WEAPONS[tag].name.toLowerCase()} users`;
  return WORD[tag] ?? tag;
}

/** Tags joined: "kiters, bow users, wand users". */
export function tagList(tags: readonly BuffTag[]): string {
  return tags.map(tagLabel).join(", ");
}

/** The zone a buff comes from, as the player reads it: "Demon Blood zone". */
export function zoneLabel(zone: string): string {
  return `${isFactionId(zone) ? FACTIONS[zone].displayName : zone} zone`;
}

/** The status marker's tooltip sentence for a row the server does not apply yet. */
export const COMING_NOTE = "Not active yet: this effect needs the status system (coming).";

/**
 * The tooltip, one line per row:
 *   Ember Imp (Fire zone)                 the name, with "elite" on an elite's
 *   3.2 stacks: +5.4% damage              what the stacks give now
 *   At 3 stacks: +5% damage               the quoted value
 *   Next kill: +1.1 stacks (+6.8% damage) only when `withNext` (a regional mob can be killed)
 *   Works with: anyone
 *   Strong against: anyone
 *   Not active yet ...                    only for a row that waits for R4b
 */
export function tipText(view: BuffView, withNext: boolean): string {
  const lines = [
    `${view.name} (${view.elite ? "elite, " : ""}${zoneLabel(view.zone)})`,
    `${view.stacksText} stacks: ${view.text}`,
    `At 3 stacks: ${view.quoted}`,
  ];
  if (withNext && view.nextGain > 0) lines.push(`Next kill: +${formatGain(view.nextGain)} stacks (${view.nextText})`);
  lines.push(`Works with: ${view.worksWith.length > 0 ? tagList(view.worksWith) : "anyone"}`);
  if (view.counters.length > 0) lines.push(`Strong against: ${tagList(view.counters)}`);
  if (!view.active) lines.push(COMING_NOTE);
  return lines.join("\n");
}

// ------------------------------------------------------------------------------------------------------ the toast

/** One `buff` fx for the local player: `gained` stacks of `buff`, bringing it to `total`. */
export interface BuffNews { buff: string; gained: number; total: number }

/** The buffs a toast lists by name before it counts the rest ("and 2 more"). */
export const NEWS_LISTED = 3;

/**
 * The one toast for the buffs the local player gained in a frame. A single buff keeps the shared wording ("Ember Imp +1.1
 * (3.2): +5.4% damage", buffToast); several (a bounty kill moves a share of each buff the victim held) are listed in the
 * order gained, a buff gained twice summed, "Ember Imp +2.0, Bailiff +1.5, Acolyte +1.0 and 2 more".
 */
export function buffNewsText(news: readonly BuffNews[]): string {
  const sums = new Map<string, BuffNews>();
  for (const n of news) {
    const sum = sums.get(n.buff);
    if (sum) { sum.gained += n.gained; sum.total = n.total; } else sums.set(n.buff, { ...n });
  }
  const list = [...sums.values()];
  if (list.length === 0) return "";
  if (list.length === 1) return buffToast(list[0]!.buff, list[0]!.gained, list[0]!.total);
  const shown = list.slice(0, NEWS_LISTED).map((b) => `${buffDef(b.buff)?.name ?? b.buff} +${formatGain(b.gained)}`).join(", ");
  const more = list.length - NEWS_LISTED;
  return more > 0 ? `${shown} and ${more} more` : shown;
}
