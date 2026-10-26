// Small helpers the hub panels share: what a profile owns and wears, where an unsold item comes from, a status line.
// Everything here treats the profile as the server's word: panels only read it and never edit it.
import {
  ACHIEVEMENTS, cssColor, packLook, unpackLook,
  type AchievementDef, type Cosmetic, type ProfileDTO, type TitleCosmetic,
} from "@raid/shared";
import { friendlyError } from "../../net/errors";
import { ShopRequestError } from "../../net/profile";
import { el } from "../dom";

/** Owned ids and the id worn per slot, taken from one profile. The wire has `owned` as an array, so look-ups go through a Set. */
export interface Closet {
  owned: ReadonlySet<string>;
  equipped: Readonly<Record<string, string>>;
}

export function closetOf(profile: ProfileDTO): Closet {
  return { owned: new Set(profile.cosmetics.owned), equipped: profile.cosmetics.equipped };
}

/** Own keys only: slot names come from a catalog, but the equipped map comes from the wire. */
export function isEquipped(closet: Closet, c: Cosmetic): boolean {
  return closet.owned.has(c.id) && Object.hasOwn(closet.equipped, c.slot) && closet.equipped[c.slot] === c.id;
}

export function isGold(c: Cosmetic): boolean {
  return c.slot.startsWith("gold-");
}

const REWARD_SOURCE: ReadonlyMap<string, AchievementDef> = (() => {
  const map = new Map<string, AchievementDef>();
  for (const a of ACHIEVEMENTS) for (const id of a.reward) if (!map.has(id)) map.set(id, a);
  return map;
})();

/** The achievement that grants this cosmetic, for items the shop doesn't sell. */
export function earnedBy(c: Cosmetic): AchievementDef | undefined {
  return REWARD_SOURCE.get(c.id);
}

/**
 * The title other players see on this profile. It goes through the same look word a run uses, so a stale or
 * hand-edited equipped map can't show a title the player doesn't own.
 */
export function equippedTitle(profile: ProfileDTO): TitleCosmetic | undefined {
  return unpackLook(packLook(profile.cosmetics.equipped, profile.cosmetics.owned)).title;
}

/** A title in its own colour. Text comes from the catalog, never from the wire. */
export function titleTag(title: TitleCosmetic, className = "hub-title-tag"): HTMLElement {
  const tag = el("span", className, title.text);
  tag.style.color = cssColor(title.color);
  return tag;
}

export function sectionHeading(text: string, note?: string): HTMLElement {
  const h = el("h3", undefined, text);
  if (note) h.append(" ", el("span", "hub-section-note", note));
  return h;
}

/** Player-facing text of a failed shop or equip request. */
export function describeError(err: unknown): string {
  if (!(err instanceof ShopRequestError)) console.error(err);
  return friendlyError(err);
}

/** A disabled button drops keyboard focus; hand it back once the request is over so keyboard use isn't interrupted. */
export function refocus(node: Element | null): void {
  if (node instanceof HTMLElement && node.isConnected && document.activeElement !== node) node.focus({ preventScroll: true });
}

export type StatusTone = "info" | "ok" | "error";

/** One polite live line at the top of a tab. It lives as long as the tab, so it survives the re-renders a purchase causes. */
export class StatusLine {
  readonly root = el("div", "hub-status");

  constructor() {
    this.root.setAttribute("role", "status");
  }

  set(text: string, tone: StatusTone = "info"): void {
    this.root.textContent = text;
    this.root.className = `hub-status ${tone}`;
  }

  clear(): void {
    this.set("");
  }
}
