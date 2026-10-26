import { buffDef, type BuffId, type Effect } from "@raid/shared";

/**
 * A buff row's quoted number (its value at 3 stacks) read from the catalog (shared/src/buffs.ts). The rig tests pin what the
 * sim does with the number, and shared/test/buffsRoguelike.test.ts pins the number itself, so a retune is a one-line data
 * edit. `i` picks the row of a buff that has several (Magma Brute: 0 is max hp, 1 is magic resist).
 */
export function quoted(id: BuffId, i = 0): number {
  const e: Effect = buffDef(id)!.effects[i]!;
  switch (e.k) {
    case "stat": case "flat": case "vs": case "while": return e.v;
    case "scale": case "onHit": return e.per;
    case "trigger": return e.do.do === "heal" || e.do.do === "barrier" ? e.do.share : Number.NaN;
  }
}
