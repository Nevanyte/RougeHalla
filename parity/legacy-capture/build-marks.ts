// Legacy overhead build marks (packages/client/src/render/PlayerView.ts drawBuildMarks): the top two of
// combatReadability(p).investedStats (packages/shared/src/combatReadability.ts, display mode, not `lasting`).
// Writes parity/build-marks/legacy.json, the oracle for rh_sim::kill_augments::build_marks (ADR0026, B2).
// Run from the repository root: `npx tsx parity/legacy-capture/build-marks.ts` (or any tsx binary).
import { writeFileSync, mkdirSync } from "node:fs";
import { combatReadability, type ReadableFighter } from "../../packages/shared/src/combatReadability";
import { decodeMirrors, encodeMirrors, IDENTITY_MIRRORS } from "../../packages/shared/src/mods";
import { FACTIONS } from "../../packages/shared/src/factions";

interface Case {
  name: string;
  faction: "fire" | "frost" | "plague" | "holy" | "sentenced";
  cards: Record<string, number>;
  /** Decoded mirrors (what the server simulated with); the capture encodes them as the synced fields. */
  mirrors: Partial<typeof IDENTITY_MIRRORS>;
  /** max hp as a multiple of the faction's base hp. */
  hpScale: number;
  killStats?: Record<string, number>;
}

const cases: Case[] = [
  { name: "fresh", faction: "fire", cards: {}, mirrors: {}, hpScale: 1 },
  { name: "offense_and_defense", faction: "sentenced", cards: { ad1: 2 }, mirrors: { adBonus: 24, armorBonus: 15 }, hpScale: 1 },
  { name: "tie_keeps_key_order", faction: "plague", cards: { ad1: 1, ap1: 1 }, mirrors: { adBonus: 12, apBonus: 12 }, hpScale: 1 },
  { name: "damage_and_leech_cards", faction: "holy", cards: { glassCannon: 1, vampiricPact: 1, leech1: 2 }, mirrors: { asMult: 1.18, speedMult: 1.12 }, hpScale: 0.75 },
  { name: "health_speed", faction: "frost", cards: { vitality1: 2, fleet1: 1 }, mirrors: { speedMult: 1.3 }, hpScale: 1.18 },
  { name: "below_threshold", faction: "fire", cards: {}, mirrors: { adBonus: 0.1, armorBonus: 0.1 }, hpScale: 1 },
  { name: "attack_speed_soul_defense", faction: "holy", cards: { haste2: 1, committed: 1 }, mirrors: { asMult: 1.45, shieldBonus: 40 }, hpScale: 1.05 },
  { name: "kill_stats", faction: "sentenced", cards: {}, mirrors: { apBonus: 6 }, hpScale: 1, killStats: { damage: 0.05, lifesteal: 0.02 } },
  { name: "negative_mirrors_ignored", faction: "plague", cards: {}, mirrors: { armorBonus: -30, asMult: 0.8, speedMult: 0.9 }, hpScale: 0.5 },
];

const out = cases.map((c) => {
  const decoded = { ...IDENTITY_MIRRORS, ...c.mirrors };
  const wire = encodeMirrors(decoded);
  const maxHp = FACTIONS[c.faction].hp * c.hpScale;
  const killStats = c.killStats ? new Map(Object.entries(c.killStats)) : undefined;
  const p: ReadableFighter = {
    ...wire,
    faction: c.faction,
    weapon0: "sword",
    weapon1: "",
    slot: 0,
    hp: maxHp,
    maxHp,
    build: c.cards,
    extra: killStats ? { killStats } : undefined,
  };
  const r = combatReadability(p);
  return {
    name: c.name,
    faction: c.faction,
    cards: c.cards,
    // The decoded mirrors exactly as the client reads them back from the wire.
    mirrors: decodeMirrors(wire),
    wire,
    maxHp,
    killStats: c.killStats ?? {},
    invested: r.investedStats.map((s) => ({ key: s.key, score: s.score })),
    marks: r.investedStats.slice(0, 2).map((s) => s.key),
  };
});

mkdirSync("parity/build-marks", { recursive: true });
writeFileSync("parity/build-marks/legacy.json", JSON.stringify({ format: "rh-build-marks/1", source: "packages/shared/src/combatReadability.ts", cases: out }, null, 2) + "\n");
console.log(`wrote ${out.length} cases`);
