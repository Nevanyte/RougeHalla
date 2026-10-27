// What the bots take from the camps' chests (balance pass, BALANCE_CONTRACT 9): short headless games of eight bots, two of each
// persona, and every card they pick at a chest, by persona: how many cards, which kinds, which trade-offs, how many skips, and the
// card power they end with. The chooser is bots/chestHunt.ts `cardScore`; the persona's `risk` is what separates the rows.
//   npx tsx packages/server/bench/botPicks.ts [seeds...]     (default seeds 3 4 7 8 9)
// Report only: nothing here fails.
import { cardDef, cardPower, cardTitle, type CardKind } from "@raid/shared";
import { createHeadlessRoom } from "../src/bots/tournament/headlessRoom";
import { BOT_FILL_DEFAULTS, PERSONAS, PERSONA_IDS, type PersonaId } from "../src/bots/brain/types";
import { costsSomething } from "../src/bots/chestHunt";

const seeds = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (seeds.length === 0) seeds.push(3, 4, 7, 8, 9);

interface Row { bots: number; picks: number; skips: number; kinds: Record<CardKind, number>; tradeoffs: number; power: number; cards: Map<string, number> }
const rows = new Map<PersonaId, Row>(PERSONA_IDS.map((p) => [p, { bots: 0, picks: 0, skips: 0, kinds: { base: 0, conditional: 0, augment: 0 }, tradeoffs: 0, power: 0, cards: new Map() }]));

for (const seed of seeds) {
  const room = createHeadlessRoom({
    seed,
    config: { patienceSeconds: 240, patienceMinSeconds: 96, suddenDeathSeconds: 40, firstPatienceSeconds: 0 },
    bots: { ...BOT_FILL_DEFAULTS, fillTo: 8 },
    lineup: PERSONA_IDS.flatMap((persona) => [{ tier: "hard" as const, persona }, { tier: "hard" as const, persona }]),
    startAtOnce: true,
  });
  const personaOf = new Map(room.seats.map((s) => [s.id, s.persona]));
  const options = new Map<string, string[]>();
  const power = new Map<string, number>();
  room.runUntilEnd(600_000, (events) => {
    for (const [id, c] of room.world.state.containers) if (c.kind === "reward") options.set(id, [...c.options]);
    for (const [id, p] of room.world.state.players) power.set(id, cardPower(p.build));
    for (const e of events) {
      if (e.type !== "fx" || e.fx.kind !== "chestTaken") continue;
      const persona = personaOf.get(e.fx.by);
      if (!persona) continue;
      const row = rows.get(persona)!;
      if (e.fx.option < 0) { row.skips++; continue; }
      const id = options.get(e.fx.chest)?.[e.fx.option];
      const def = id ? cardDef(id) : undefined;
      if (!id || !def) continue;
      row.picks++;
      row.kinds[def.kind]++;
      if (def.kind === "augment" && costsSomething(def)) row.tradeoffs++;
      row.cards.set(cardTitle(id), (row.cards.get(cardTitle(id)) ?? 0) + 1);
    }
  });
  for (const [id, persona] of personaOf) {
    const row = rows.get(persona)!;
    row.bots++;
    row.power += power.get(id) ?? 0;
  }
}

console.log(`bots in ${seeds.length} games (seeds ${seeds.join(", ")}), eight hard bots a game, two of each persona\n`);
console.log("| persona | risk | bots | picks | skips | base | conditional | augment | trade-offs | mean power at the end |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const [persona, r] of rows) {
  console.log(`| ${persona} | ${PERSONAS[persona].risk} | ${r.bots} | ${r.picks} | ${r.skips} | ${r.kinds.base} | ${r.kinds.conditional} | ${r.kinds.augment} | ${r.tradeoffs} | ${(r.power / Math.max(1, r.bots)).toFixed(1)} |`);
}
console.log("");
for (const [persona, r] of rows) {
  const top = [...r.cards].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([t, n]) => `${t} x${n}`).join(", ");
  console.log(`${persona.padEnd(12)} ${top || "(nothing picked)"}`);
}
