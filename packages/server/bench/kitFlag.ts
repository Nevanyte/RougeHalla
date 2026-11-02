// `--minute N` for mobDuel and campDuel: the player holds the balance pass's minute-N card kit (kits.ts) from the first tick,
// through the chest's own grantCard, so "an armed, carded player" can be measured (default 0 = no cards, as before).
import type { WeaponId } from "@raid/shared";
import { combatant, type Combatant } from "../src/sim/combatant";
import { grantCard } from "../src/sim/chests";
import type { World } from "../src/sim/world";
import { kitCards, parseMinutes, type Minute } from "./kits";

const at = process.argv.indexOf("--minute");
let minute: Minute = at >= 0 ? parseMinutes(process.argv[at + 1] ?? "0")[0]! : 0;

/** Run `fn` with the card kit of minute `m` (the tests ask for one: campTypes holds the elite gate at minute 5). */
export function withKitMinute<T>(m: Minute, fn: () => T): T {
  const before = minute;
  minute = m;
  try { return fn(); } finally { minute = before; }
}

export function grantKit(world: World, id: string, weapon: WeaponId): void {
  if (minute === 0) return;
  const me = combatant(world, id) as Extract<Combatant, { kind: "player" }>;
  for (const card of kitCards(minute, weapon)) grantCard(world, me, card);
}
