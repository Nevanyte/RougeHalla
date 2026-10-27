// The "typical power" kits of the balance pass (BALANCE_CONTRACT 1.3): what a player holds after about one camp a minute, one
// card a camp. The benches (ttkCurve, matchups, farmVsFight) give both fighters of an even duel the same kit.
//
//   minute 0   fists                          no cards         P 0   f(P) 0.75
//   minute 1   the faction's reference weapon O1               P 1   f(P) 1.10
//   minute 2   same                           O1, vitality1    P 2   f(P) 1.39
//   minute 3   same                           + haste1         P 3   f(P) 1.64
//   minute 4   same                           + O2             P 5   f(P) 2.02
//   minute 5   same                           + armor1         P 6   f(P) 2.17
//
// `O` is the offense base that fits the weapon: `ap` on a wand, `armor` on a shield, else `ad`. The minute-0 kit is complete
// today. Minutes 1-5 are cards, granted through the chest's own `grantCard` when it exists (DuelSpec.cards); until the card
// catalog lands (agent A3) `kitsAvailable(minute)` is false for them and the benches say so instead of running a wrong kit.
// TODO(cards, agent A3): nothing to change here once `grantCard` is exported from sim/chests.ts.
import { cardPower, SIGNATURE_WEAPONS, type FactionId, type WeaponId } from "@raid/shared";
import * as chests from "../src/sim/chests";

export type Minute = 0 | 1 | 2 | 3 | 4 | 5;
export const MINUTES: readonly Minute[] = [0, 1, 2, 3, 4, 5];

/** The kit as card slots; `O1`/`O2` stand for the weapon's offense base at that tier. */
const KIT_SLOTS: Readonly<Record<Minute, readonly string[]>> = {
  0: [],
  1: ["O1"],
  2: ["O1", "vitality1"],
  3: ["O1", "vitality1", "haste1"],
  4: ["O1", "vitality1", "haste1", "O2"],
  5: ["O1", "vitality1", "haste1", "O2", "armor1"],
};

/** The offense base card that fits a weapon (the kit's `O`). */
export function offenseBase(weapon: WeaponId): "ad" | "ap" | "armor" {
  return weapon === "wand" ? "ap" : weapon === "shield" ? "armor" : "ad";
}

/** What `faction` fights with at `minute`: fists at minute 0, its reference weapon after (the weapon a mob kill armed it with). */
export function kitWeapon(faction: FactionId, minute: Minute): WeaponId {
  return minute === 0 ? "fists" : SIGNATURE_WEAPONS[faction];
}

/** The card ids of the kit for a fighter holding `weapon` at `minute`. */
export function kitCards(minute: Minute, weapon: WeaponId): string[] {
  return KIT_SLOTS[minute].map((slot) => (slot.startsWith("O") ? offenseBase(weapon) + slot.slice(1) : slot));
}

/** The card power P of the kit (the PvP factor reads it). */
export function kitPower(minute: Minute, weapon: WeaponId = "sword"): number {
  return cardPower(Object.fromEntries(kitCards(minute, weapon).map((id) => [id, 1])));
}

/** Can this tree grant cards yet? (`grantCard` is exported from sim/chests.ts once the catalog lands.) */
export function cardsAvailable(): boolean {
  return typeof (chests as unknown as Record<string, unknown>)["grantCard"] === "function";
}

/** Can the kit of `minute` be applied? Minute 0 holds no cards; the others need `grantCard`. */
export function kitsAvailable(minute: Minute): boolean {
  return minute === 0 || cardsAvailable();
}

/** The `--minutes` argument: a comma list of 0..5. */
export function parseMinutes(arg: string): Minute[] {
  const out: Minute[] = [];
  for (const part of arg.split(",")) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 5) throw new Error(`minute ${part} is not 0..5`);
    out.push(n as Minute);
  }
  return out;
}
