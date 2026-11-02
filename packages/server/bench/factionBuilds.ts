// The faction rework's two builds per faction (testing/TUNING_BALANCE.md section 13): each build, at the minute-5 card power
// (P 6), against every other faction holding the typical minute-5 kit on the SAME weapon (so the weapon loop is out of it),
// real sim, signatures on, both seats, the noise model. Report only.
//
//   npx tsx packages/server/bench/factionBuilds.ts [--setups 6] [--draws 3] [--noise 0.45] [--builds fire:A,holy:B]
import { cardPower, FACTION_IDS, type FactionId, type WeaponId } from "@raid/shared";
import { fullSetups } from "../src/harness/matrix";
import { flag, opt, playDuel } from "./lib/balance";
import { kitCards } from "./kits";

interface Build { faction: FactionId; key: string; name: string; weapon: WeaponId; cards: string[] }

const BUILDS: Build[] = [
  { faction: "fire", key: "A", name: "AD burst assassin", weapon: "sword", cards: ["ad2", "ad2", "haste1", "vitality1"] },
  { faction: "fire", key: "B", name: "AP burn tank", weapon: "shield", cards: ["ap2", "armor2", "mr1", "vitality1"] },
  { faction: "sentenced", key: "A", name: "stat bully bruiser", weapon: "sword", cards: ["ad1", "ap1", "armor1", "mr1", "vitality2"] },
  { faction: "sentenced", key: "B", name: "attack-speed max-HP punisher", weapon: "bow", cards: ["haste2", "haste2", "ad1", "vitality1"] },
  { faction: "plague", key: "A", name: "attack-speed AP DoT stacker", weapon: "wand", cards: ["haste2", "ap2", "ap1", "vitality1"] },
  { faction: "plague", key: "B", name: "wand zombie tank (no corpse in a duel)", weapon: "wand", cards: ["armor2", "mr2", "ap1", "vitality1"] },
  { faction: "frost", key: "A", name: "Defense/SD shield tank", weapon: "shield", cards: ["armor2", "mr2", "vitality2"] },
  { faction: "frost", key: "B", name: "bow kiter", weapon: "bow", cards: ["ad2", "haste2", "fleet2"] },
  { faction: "holy", key: "A", name: "lifesteal juggernaut", weapon: "axe", cards: ["leech2", "vitality2", "ad2"] },
  { faction: "holy", key: "B", name: "Soul-damage wand", weapon: "wand", cards: ["ap2", "ap2", "haste1", "leech1"] },
  { faction: "holy", key: "B2", name: "Soul-damage sword (dominant AP)", weapon: "sword", cards: ["ap2", "ap2", "haste1", "leech1"] },
];

const args = process.argv.slice(2);
if (flag(args, "help")) {
  console.log("usage: npx tsx packages/server/bench/factionBuilds.ts [--setups 6] [--draws 3] [--noise 0.45] [--builds fire:A,holy:B]");
  process.exit(0);
}
const nSetups = Number(opt(args, "setups", "6"));
const draws = Number(opt(args, "draws", "3"));
const sigma = Number(opt(args, "noise", "0.45"));
const only = opt(args, "builds", "");
const setups = fullSetups().filter((_, i) => i % Math.ceil(18 / nSetups) === 0);
const pick = only ? BUILDS.filter((b) => only.split(",").includes(`${b.faction}:${b.key}`)) : BUILDS;
const power = (cards: readonly string[]): number => cardPower(cards.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {}));

console.log(`# faction builds (P ${power(BUILDS[0]!.cards)} each) vs the minute-5 kit of every other faction on the same weapon, ${setups.length} setups x 2 seats x ${draws} draws, noise ${sigma}`);
console.log(`| build | weapon | P | ${FACTION_IDS.map((f) => `vs ${f}`).join(" | ")} | mean win% | TTK med s |`);
console.log(`|---|---|---|${FACTION_IDS.map(() => "---").join("|")}|---|---|`);
const t0 = performance.now();
for (const b of pick) {
  const cells: string[] = [];
  let wins = 0;
  let n = 0;
  const ttks: number[] = [];
  for (const g of FACTION_IDS) {
    if (g === b.faction) { cells.push("-"); continue; }
    const foe = kitCards(5, b.weapon);
    let w = 0;
    let m = 0;
    setups.forEach((setup, i) => {
      for (const seat of [0, 1] as const) for (let d = 0; d < draws; d++) {
        const r = playDuel({
          a: seat === 0 ? b.faction : g, b: seat === 0 ? g : b.faction, weapons: [b.weapon, b.weapon], setup, setupIndex: i,
          style: "lock", cap: 200, draw: d, sigma, cards: seat === 0 ? [b.cards, foe] : [foe, b.cards],
        });
        if (r.winner === seat) w++;
        else if (r.winner === null) w += 0.5;
        m++;
        ttks.push(r.ttk);
      }
    });
    cells.push(`${Math.round((100 * w) / m)}`);
    wins += w;
    n += m;
  }
  ttks.sort((x, y) => x - y);
  console.log(`| ${b.faction} ${b.key}: ${b.name} | ${b.weapon} | ${power(b.cards)} | ${cells.join(" | ")} | ${Math.round((100 * wins) / n)} | ${ttks[ttks.length >> 1]!.toFixed(1)} |`);
}
console.log(`(${((performance.now() - t0) / 1000).toFixed(0)} s)`);
