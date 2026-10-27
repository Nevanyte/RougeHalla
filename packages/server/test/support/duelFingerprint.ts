// A fingerprint of the default duel path: a fixed set of specs that touch every part of duel.ts that existed before the zone
// duels (open and pillar arenas, locks, signatures, perceptions, start offsets, cards), each reduced to a sha256 of its result
// (everything but the spec echo, which holds a callback). The hashes in zoneDuel.test.ts were taken BEFORE duel.ts learned
// `map`, `starts` and the rows arena, so a changed hash means a default duel is no longer what it was.
import { createHash } from "node:crypto";
import { runDuel, type DuelResult, type DuelSpec } from "../../src/harness/duel";

export const FINGERPRINT_SPECS: ReadonlyArray<readonly [name: string, spec: DuelSpec]> = [
  ["holy wand>bow open", { faction: "holy", weapons: ["wand", "bow"], distance: 300, angle: 0.8, capSeconds: 8, seed: 7 }],
  ["fire bow>wand open", { faction: "fire", weapons: ["bow", "wand"], distance: 300, capSeconds: 8, seed: 3 }],
  ["fire sword>axe open", { faction: "fire", weapons: ["sword", "axe"], distance: 120, capSeconds: 8, seed: 3 }],
  ["frost shield mirror capped", { faction: "frost", weapons: ["shield", "shield"], distance: 300, capSeconds: 2, seed: 1 }],
  ["fire sword mirror pillars", { faction: "fire", weapons: ["sword", "sword"], distance: 450, angle: 0.8, arena: "pillars", capSeconds: 5, seed: 11 }],
  ["plague bow mirror pillars", { faction: "plague", weapons: ["bow", "bow"], distance: 300, angle: 0.1, arena: "pillars", capSeconds: 6, seed: 5 }],
  ["fire/sentenced locks signatures", {
    faction: "fire", factions: ["fire", "sentenced"], weapons: ["axe", "bow"], distance: 240, angle: 0.3, signatures: true,
    locks: [true, true], capSeconds: 25, seed: 2,
  }],
  ["fire bow mirror start offset", { faction: "fire", weapons: ["bow", "bow"], distance: 300, delayTicks: [20, 0], capSeconds: 4, seed: 5 }],
  ["holy bow>sword stale", { faction: "holy", weapons: ["bow", "sword"], distance: 300, angle: 0.1, perception: "stale", capSeconds: 8, seed: 9 }],
  ["holy bow>sword present", { faction: "holy", weapons: ["bow", "sword"], distance: 300, angle: 0.1, perception: "present", capSeconds: 8, seed: 9 }],
  ["fire wand>shield carded", {
    faction: "fire", weapons: ["wand", "shield"], distance: 300, angle: 0.8, capSeconds: 10, seed: 4,
    cards: [["haste1"], undefined], asMult: [1.2, undefined],
  }],
];

/** sha256 (hex, 16 chars) of a duel result with the spec echo left out. */
export function fingerprintOf(r: DuelResult): string {
  const { spec: _spec, ...rest } = r;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 16);
}

export function fingerprints(): Array<[string, string]> {
  return FINGERPRINT_SPECS.map(([name, spec]) => [name, fingerprintOf(runDuel(spec))]);
}
