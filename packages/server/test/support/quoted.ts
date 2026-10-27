import { cardRows, type Effect } from "@raid/shared";

/**
 * A card row's number read from the catalog (shared/src/cards.ts): `quoted("haste2")` is the attack speed Haste II gives. The rig tests
 * pin what the sim does with the number, and shared/test/cards.test.ts pins the number itself, so a retune is a one-line data edit.
 * `i` picks the row of a card that has several (Juggernaut: 0 is its armor row, 1 its magic resist row).
 */
export function quoted(id: string, i = 0): number {
  const e: Effect = cardRows(id)[i]!;
  switch (e.k) {
    case "stat": case "flat": case "vs": case "while": return e.v;
    case "scale": case "onHit": case "convert": return e.per;
    case "mult": return e.v;
    case "trigger": return e.do.do === "heal" || e.do.do === "barrier" ? e.do.share : Number.NaN;
    case "flag": return Number.NaN;
  }
}
