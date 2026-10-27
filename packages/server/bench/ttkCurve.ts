// The TTK curve of the balance pass (BALANCE_CONTRACT 1.2, acceptance A1-A5): how long do even duels last at minute 0 (fists, no
// cards) and as both fighters farm (the kits of 1.3: one card a minute), measured in the real sim.
//
//   npx tsx packages/server/bench/ttkCurve.ts [--style lock|policy] [--minutes 0,1,2,3,4,5] [--setups 18]
//                                              [--cap 300] [--weapon auto|fists|sig|<id>] [--json FILE]
//
// Each minute: all 25 ordered faction pairs x the 18 fullSetups(), signatures on, both fighters on the minute's kit (kits.ts),
// style `lock` (the controls of the game client) unless told otherwise. TTK is the seconds from the first landed hit to the end of
// a finished duel (bench/lib/balance.ts has the definitions). Prints per minute the median / mean over the 20 non-mirror ordered
// pairs, the spread of the pairs, the mirrors, and then the acceptance lines:
//   A1  minute 0 median 17-23 s (mean 15-26)        A2  minute 5 median 4.0-6.5 s (mean 3.5-8)
//   A3  the curve is monotone and minute 0 / minute 5 >= 3
//   A4  every ordered pair's median is 0.4x-2.0x the overall median (tolerance 0.3x-2.5x)
//   A5  every mirror finishes and is within 2.3x of the median (tolerance 3x), at minutes 0 and 5
// Minutes 1-5 hold cards: they need `grantCard` (agent A3's card catalog) and are skipped with a note until it exists.
import { writeFileSync } from "node:fs";
import { FACTION_IDS, SIGNATURE_WEAPONS, type FactionId, type WeaponId } from "@raid/shared";
import { fullSetups } from "../src/harness/matrix";
import { flag, mean, median, opt, playDuel, sec, verdict, type DuelRecord } from "./lib/balance";
import { kitCards, kitsAvailable, kitWeapon, MINUTES, parseMinutes, type Minute } from "./kits";

const args = process.argv.slice(2);
if (flag(args, "help")) {
  console.log("usage: npx tsx packages/server/bench/ttkCurve.ts [--style lock|policy] [--minutes 0,1,2,3,4,5] [--setups 18] [--cap 300] [--weapon auto|fists|sig|<id>] [--json FILE]");
  process.exit(0);
}
const style: "lock" | "policy" = opt(args, "style", "lock") === "policy" ? "policy" : "lock";
const minutes: Minute[] = parseMinutes(opt(args, "minutes", MINUTES.join(",")));
const nSetups = Number(opt(args, "setups", "18"));
const capArg = opt(args, "cap", "");
const weaponArg = opt(args, "weapon", "auto");
const jsonOut = opt(args, "json", "");

const setups = fullSetups().filter((_, i) => i % Math.ceil(18 / nSetups) === 0);
const weaponOf = (f: FactionId, minute: Minute): WeaponId =>
  weaponArg === "auto" ? kitWeapon(f, minute) : weaponArg === "sig" ? SIGNATURE_WEAPONS[f] : (weaponArg as WeaponId);

interface MinuteResult { minute: Minute; records: DuelRecord[]; median: number; mean: number; mirrorMedian: Record<string, number>; pairMedian: Map<string, number>; caps: number }

function runMinute(minute: Minute): MinuteResult {
  const records: DuelRecord[] = [];
  const t0 = performance.now();
  for (const a of FACTION_IDS) for (const b of FACTION_IDS) {
    const wa = weaponOf(a, minute);
    const wb = weaponOf(b, minute);
    setups.forEach((setup, i) => {
      records.push(playDuel({
        a, b, weapons: [wa, wb], setup, setupIndex: i, style, cap: capArg ? Number(capArg) : minute === 0 ? 300 : 200,
        cards: [kitCards(minute, wa), kitCards(minute, wb)],
      }));
    });
  }
  const finished = records.filter((r) => r.end !== "cap");
  const non = finished.filter((r) => r.a !== r.b);
  const pairMedian = new Map<string, number>();
  for (const a of FACTION_IDS) for (const b of FACTION_IDS) {
    pairMedian.set(`${a}>${b}`, median(finished.filter((r) => r.a === a && r.b === b).map((r) => r.ttk)));
  }
  const mirrorMedian: Record<string, number> = {};
  for (const f of FACTION_IDS) mirrorMedian[f] = median(finished.filter((r) => r.a === f && r.b === f).map((r) => r.ttk));
  console.log(`# minute ${minute} (${style}): ${records.length} duels in ${((performance.now() - t0) / 1000).toFixed(1)} s, caps ${records.length - finished.length}`);
  return { minute, records, median: median(non.map((r) => r.ttk)), mean: mean(non.map((r) => r.ttk)), mirrorMedian, pairMedian, caps: records.length - finished.length };
}

const results: MinuteResult[] = [];
for (const minute of minutes) {
  if (!kitsAvailable(minute)) {
    console.log(`# minute ${minute}: skipped, the kit (${kitCards(minute, "sword").join(", ")}) needs cards (grantCard lands with agent A3)`);
    continue;
  }
  results.push(runMinute(minute));
}

console.log("\n| minute | median TTK (20 ordered pairs) | mean | caps | pair spread (min-max x median) | mirrors (s) |");
console.log("|---|---|---|---|---|---|");
for (const r of results) {
  const pairs = [...r.pairMedian].filter(([k]) => k.split(">")[0] !== k.split(">")[1]).map(([, v]) => v / r.median);
  console.log(`| ${r.minute} | ${sec(r.median)} | ${sec(r.mean)} | ${r.caps} | ${Math.min(...pairs).toFixed(2)}x-${Math.max(...pairs).toFixed(2)}x | ${FACTION_IDS.map((f) => `${f} ${sec(r.mirrorMedian[f]!)}`).join(", ")} |`);
}
for (const r of results) {
  console.log(`\nordered-pair TTK, minute ${r.minute} (row = fighter 0):`);
  for (const a of FACTION_IDS) console.log(a.padEnd(10) + FACTION_IDS.map((b) => sec(r.pairMedian.get(`${a}>${b}`)!).padStart(7)).join(""));
}

console.log("\nacceptance (PASS inside the target, WARN inside the tolerance, FAIL outside, n/a not measurable here):");
const at = (m: Minute): MinuteResult | undefined => results.find((r) => r.minute === m);
const m0 = at(0);
const m5 = at(5);
console.log(verdict("A1", "minute 0 median TTK", m0?.median ?? NaN, [17, 23], [15, 26], " s"));
console.log(verdict("A1", "minute 0 mean TTK", m0?.mean ?? NaN, [15, 26], [12, 30], " s"));
console.log(verdict("A2", "minute 5 median TTK", m5?.median ?? NaN, [4, 6.5], [3.5, 8], " s"));
console.log(verdict("A2", "minute 5 mean TTK", m5?.mean ?? NaN, [3.5, 8], [3, 10], " s"));
if (results.length >= 2) {
  const meds = results.map((r) => r.median);
  const monotone = meds.every((x, i) => i === 0 || x <= meds[i - 1]! * 1.02);
  console.log(`${monotone ? "PASS" : "FAIL"} A3 the curve is monotone: ${results.map((r) => `m${r.minute} ${sec(r.median)}`).join(" / ")}`);
  if (m0 && m5) console.log(verdict("A3", "minute 0 / minute 5", m0.median / m5.median, [3, 6], [2.8, 8], "x"));
} else {
  console.log("n/a  A3 the curve needs at least two minutes (minutes 1-5 wait for the card catalog)");
}
for (const r of results) {
  if (r.minute !== 0) continue;
  const ratios = [...r.pairMedian].filter(([k]) => k.split(">")[0] !== k.split(">")[1]).map(([k, v]) => ({ k, x: v / r.median }));
  const lo = ratios.reduce((a, b) => (b.x < a.x ? b : a));
  const hi = ratios.reduce((a, b) => (b.x > a.x ? b : a));
  console.log(verdict("A4", `minute 0 shortest pair (${lo.k})`, lo.x, [0.4, 2], [0.3, 2.5], "x median"));
  console.log(verdict("A4", `minute 0 longest pair (${hi.k})`, hi.x, [0.4, 2], [0.3, 2.5], "x median"));
}
for (const r of results) {
  if (r.minute !== 0 && r.minute !== 5) continue;
  const worst = FACTION_IDS.map((f) => ({ f, x: r.mirrorMedian[f]! / r.median })).reduce((a, b) => (!(b.x <= a.x) ? b : a));
  console.log(verdict("A5", `minute ${r.minute} slowest mirror (${worst.f})${r.caps > 0 ? `, ${r.caps} capped duels` : ""}`, worst.x, [0, 2.3], [0, 3], "x median"));
}
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(results.map((r) => ({ minute: r.minute, records: r.records })), null, 0));
  console.log(`\nraw records: ${jsonOut}`);
}
