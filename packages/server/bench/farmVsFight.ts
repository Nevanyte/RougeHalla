// Farm, then fight (BALANCE_CONTRACT 1.2, acceptance A10): is killing a mob worth it against a player who did not?
//
//   npx tsx packages/server/bench/farmVsFight.ts [--draws 2] [--noise 0.45] [--hp 0.94] [--setups 18] [--style lock|policy] [--json FILE]
//
// Player A killed ONE mob on fists, so it holds the weapon that mob dropped (the mob of its own zone: REGION_WEAPONS) and is
// scratched (a mob duel leaves a fists starter about 94% hp, bench/mobDuel.ts); it has no card yet (a camp's chest comes after
// the whole camp). Player B is fresh, on fists, at full hp. They meet in the real sim under the noise model (even play), all 25
// ordered faction pairs x the 18 fullSetups() x the draws, A in seat 0. Prints A's Monte-Carlo win % per pair and:
//   A10  A wins >= 60% overall; >= 50% against every faction except the one that counters it (>= 40% there)
import { BEATS, FACTION_IDS, REGION_WEAPONS, type FactionId } from "@raid/shared";
import { fullSetups } from "../src/harness/matrix";
import { flag, median, opt, pct, playDuel, SIGMA, verdict, type DuelRecord } from "./lib/balance";

const args = process.argv.slice(2);
if (flag(args, "help")) {
  console.log("usage: npx tsx packages/server/bench/farmVsFight.ts [--draws 2] [--noise 0.45] [--hp 0.94] [--setups 18] [--style lock|policy] [--json FILE]");
  process.exit(0);
}
const sigma = Number(opt(args, "noise", String(SIGMA)));
const draws = Number(opt(args, "draws", "2"));
const hp = Number(opt(args, "hp", "0.94"));
const nSetups = Number(opt(args, "setups", "18"));
const style: "lock" | "policy" = opt(args, "style", "lock") === "policy" ? "policy" : "lock";
const jsonOut = opt(args, "json", "");
const setups = fullSetups().filter((_, i) => i % Math.ceil(18 / nSetups) === 0);

const records: DuelRecord[] = [];
const t0 = performance.now();
for (const a of FACTION_IDS) for (const b of FACTION_IDS) {
  setups.forEach((setup, i) => {
    for (let d = 0; d < draws; d++) {
      records.push(playDuel({
        a, b, weapons: [REGION_WEAPONS[a], "fists"], setup, setupIndex: i, style, cap: 300, draw: d, sigma, startHp: [hp, 1],
      }));
    }
  });
}
const aWin = (rs: readonly DuelRecord[]): number => rs.length ? rs.reduce((s, r) => s + (r.winner === 0 ? 1 : r.winner === null ? 0.5 : 0), 0) / rs.length : NaN;
const cell = (a: FactionId, b: FactionId): DuelRecord[] => records.filter((r) => r.a === a && r.b === b);

console.log(`# farm vs fight, ${style}, noise ${sigma} x ${draws} draws, A at ${pct(hp)}% hp: ${records.length} duels in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log("A's win % (row = A with its zone weapon, column = B on fists):");
console.log("A \\ B".padEnd(14) + FACTION_IDS.map((b) => b.padStart(10)).join("") + "     row");
for (const a of FACTION_IDS) {
  console.log(`${a} (${REGION_WEAPONS[a]})`.padEnd(14) + FACTION_IDS.map((b) => pct(aWin(cell(a, b))).padStart(10)).join("") + pct(aWin(records.filter((r) => r.a === a))).padStart(8));
}
const countersOf = (a: FactionId): FactionId[] => BEATS.filter(([, l]) => l === a).map(([w]) => w);
const overall = aWin(records);
const nonCounter: number[] = [];
const vsCounter: number[] = [];
for (const a of FACTION_IDS) for (const b of FACTION_IDS) {
  (countersOf(a).includes(b) ? vsCounter : nonCounter).push(aWin(cell(a, b)));
}
const nonMirrorMedian = median(records.filter((r) => r.a !== r.b).map((r) => r.ttk));
console.log(`\nmedian TTK ${nonMirrorMedian.toFixed(1)} s`);
console.log("\nacceptance:");
console.log(verdict("A10", "A's win overall", overall, [0.6, 1], [0.55, 1]));
console.log(verdict("A10", "A's lowest win against a non-counter", Math.min(...nonCounter), [0.5, 1], [0.45, 1]));
console.log(verdict("A10", "A's lowest win against its counter", Math.min(...vsCounter), [0.4, 1], [0.35, 1]));
if (jsonOut) {
  (await import("node:fs")).writeFileSync(jsonOut, JSON.stringify(records));
  console.log(`raw records: ${jsonOut}`);
}
