// The matchup layers of the balance pass (BALANCE_CONTRACT 1.2, acceptance A6-A8): do the designed counters win without being
// walls? Real sim, even duels (both fighters hold the same kit), signatures on, the 18 fullSetups(), both seats.
//
//   npx tsx packages/server/bench/matchups.ts --layer faction [--kit 0..5] [--weapon auto|fists|sig|<id>] [--noise 0.45 --draws 6]
//                                              [--flip] [--style lock|policy] [--setups 18] [--cap 300]
//   npx tsx packages/server/bench/matchups.ts --layer weapon  [--kit 0..5] [--cross] [--setups 6] [--noise S --draws K] [--edges sword>axe,...]
//
// FACTION layer (A6, A8): for each of the ten BEATS edges the favourite's win % (noise-free, or the Monte-Carlo win % under the
// noise model when --noise is given), the underdog's, h (the favourite's hp share at the end of its wins, noise off) and TTK. With
// --flip it also bisects r for every duel (the damage multiplier the underdog needs to win; h = 1 - 1/r) and reports its median.
// --weapon says what everyone fights with: auto (the kit's: fists at minute 0, the faction's reference weapon after), fists,
// sig (SIGNATURE_WEAPONS), or one of the five.
//   A6  h 15-30% (tolerance 10-35); Monte-Carlo favourite win 60-72% (56-76); the underdog wins >= 24% on every edge
//   A8  every favourite wins >= 50% of its noise-free duels
// WEAPON layer (A7): each WEAPON_BEATS edge, pooled over all 25 ordered faction pairs with --cross (so faction effects cancel;
// the same-faction cells are printed too) or over the five same-faction mirrors, 6 setups x 2 seats, noise off unless asked.
//   A7  favourite 55-75% pooled, no edge under 50% (the loop is provisional: the weapon agent tunes it)
// Minute 1-5 kits hold cards and need `grantCard` (agent A3); the bench says so instead of running a wrong kit.
import { BEATS, FACTION_IDS, SIGNATURE_WEAPONS, WEAPON_BEATS, type FactionId, type WeaponId } from "@raid/shared";
import { fullSetups } from "../src/harness/matrix";
import {
  edgeStats, favouriteShare, flag, flipMultiplier, median, opt, pct, playDuel, sec, verdict, type DuelRecord,
} from "./lib/balance";
import { kitCards, kitsAvailable, kitWeapon, parseMinutes, type Minute } from "./kits";

const args = process.argv.slice(2);
if (flag(args, "help") || !flag(args, "layer")) {
  console.log("usage: npx tsx packages/server/bench/matchups.ts --layer faction|weapon [--kit 0..5] [--weapon auto|fists|sig|<id>] [--noise 0.45 --draws K] [--flip] [--cross] [--setups N] [--style lock|policy] [--cap S] [--edges a>b,...]");
  process.exit(flag(args, "help") ? 0 : 1);
}
const layer = opt(args, "layer", "faction");
const kit = parseMinutes(opt(args, "kit", "0"))[0]!;
const style: "lock" | "policy" = opt(args, "style", "lock") === "policy" ? "policy" : "lock";
const sigma = Number(opt(args, "noise", "0"));
const draws = sigma > 0 ? Number(opt(args, "draws", kit === 0 ? "6" : "4")) : 1;
const cap = Number(opt(args, "cap", kit === 0 ? "300" : "200"));
const weaponArg = opt(args, "weapon", "auto");
const doFlip = flag(args, "flip");
const cross = flag(args, "cross");
if (!kitsAvailable(kit)) {
  console.log(`kit ${kit} holds cards (${kitCards(kit, "sword").join(", ")}): grantCard lands with the card catalog (agent A3), nothing to measure yet.`);
  process.exit(0);
}

const weaponOf = (f: FactionId): WeaponId =>
  weaponArg === "auto" ? kitWeapon(f, kit) : weaponArg === "sig" ? SIGNATURE_WEAPONS[f] : (weaponArg as WeaponId);

if (layer === "faction") factionLayer();
else if (layer === "weapon") weaponLayer();
else throw new Error(`--layer ${layer}: faction or weapon`);

function factionLayer(): void {
  const nSetups = Number(opt(args, "setups", "18"));
  const setups = fullSetups().filter((_, i) => i % Math.ceil(18 / nSetups) === 0);
  const records: DuelRecord[] = [];
  const flips = new Map<string, number[]>();
  const t0 = performance.now();
  for (const a of FACTION_IDS) for (const b of FACTION_IDS) {
    if (a === b) continue;
    const edge = BEATS.find(([w, l]) => (w === a && l === b) || (w === b && l === a));
    const wa = weaponOf(a);
    const wb = weaponOf(b);
    setups.forEach((setup, i) => {
      const base = {
        a, b, weapons: [wa, wb] as const, setup, setupIndex: i, style, cap, cards: [kitCards(kit, wa), kitCards(kit, wb)] as const,
      };
      for (let d = 0; d < draws; d++) records.push(playDuel({ ...base, draw: d, sigma }));
      if (doFlip && edge) {
        // The underdog is the seat that is not the favourite.
        const underdog: 0 | 1 = edge[0] === a ? 1 : 0;
        const list = flips.get(`${edge[0]}>${edge[1]}`) ?? [];
        list.push(flipMultiplier(base, underdog));
        flips.set(`${edge[0]}>${edge[1]}`, list);
      }
    });
  }
  // The noise-free h needs a noise-free run: with --noise the table above is Monte Carlo, so run those once more.
  const clean: DuelRecord[] = sigma > 0 ? [] : records;
  if (sigma > 0) {
    for (const [w, l] of BEATS) for (const [a, b] of [[w, l], [l, w]] as const) {
      setups.forEach((setup, i) => clean.push(playDuel({ a, b, weapons: [weaponOf(a), weaponOf(b)], setup, setupIndex: i, style, cap, cards: [kitCards(kit, weaponOf(a)), kitCards(kit, weaponOf(b))] })));
    }
  }
  console.log(`# faction layer, kit ${kit}, weapons ${weaponArg}, ${style}, ${sigma > 0 ? `noise ${sigma} x ${draws} draws` : "noise off"}: ${records.length} duels in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`| edge | fav win% ${sigma > 0 ? "(MC)" : ""} | underdog win% | caps | h med % | h min % | TTK med s | TTK fav kills s |${doFlip ? " r med | P(fav) from r |" : ""}`);
  console.log(`|---|---|---|---|---|---|---|---|${doFlip ? "---|---|" : ""}`);
  const minFav: number[] = [];
  const hs: number[] = [];
  const mcs: number[] = [];
  const unders: number[] = [];
  for (const [w, l] of BEATS) {
    const mc = edgeStats(records, w, l);
    const nf = edgeStats(clean, w, l);
    minFav.push(nf.favWin);
    hs.push(nf.h);
    mcs.push(mc.favWin);
    unders.push(mc.underWin);
    const fl = flips.get(`${w}>${l}`);
    const r = fl ? median(fl) : NaN;
    console.log(`| ${w}>${l} | ${pct(mc.favWin)} | ${pct(mc.underWin)} | ${mc.caps} | ${pct(nf.h)} | ${pct(nf.hMin)} | ${sec(mc.ttk)} | ${sec(mc.ttkFavKills)} |${doFlip ? ` ${Number.isFinite(r) ? r.toFixed(2) : "--"} | ${Number.isFinite(r) ? pct(favouriteShare(r)) : "--"} |` : ""}`);
  }
  const mirrors = records.filter((r) => r.a === r.b);
  if (mirrors.length > 0) console.log("mirrors: " + FACTION_IDS.map((f) => `${f} ${sec(median(mirrors.filter((r) => r.a === f && r.end !== "cap").map((r) => r.ttk)))} s`).join(" | "));
  console.log("\nacceptance:");
  console.log(verdict("A6", "median h over the ten edges (noise off)", median(hs), [0.15, 0.30], [0.10, 0.35]));
  console.log(verdict("A6", "highest edge h", Math.max(...hs), [0.15, 0.30], [0.10, 0.35]));
  console.log(verdict("A6", "lowest edge h", Math.min(...hs), [0.15, 0.30], [0.10, 0.35]));
  if (sigma > 0) {
    console.log(verdict("A6", "Monte-Carlo favourite win, lowest edge", Math.min(...mcs), [0.60, 0.72], [0.56, 0.76]));
    console.log(verdict("A6", "Monte-Carlo favourite win, highest edge", Math.max(...mcs), [0.60, 0.72], [0.56, 0.76]));
    console.log(verdict("A6", "weakest underdog win share", Math.min(...unders), [0.24, 1], [0.24, 1]));
  } else {
    console.log("n/a  A6 Monte-Carlo win % and the underdog floor need --noise 0.45");
  }
  console.log(verdict("A8", "lowest noise-free favourite win", Math.min(...minFav), [0.5, 1], [0.5, 1]));
}

function weaponLayer(): void {
  const nSetups = Number(opt(args, "setups", "6"));
  const setups = fullSetups().filter((_, i) => i % Math.ceil(18 / nSetups) === 0);
  const edgesArg = opt(args, "edges", "");
  const edges: ReadonlyArray<readonly [WeaponId, WeaponId]> = edgesArg
    ? edgesArg.split(",").map((e) => e.split(">") as unknown as [WeaponId, WeaponId])
    : WEAPON_BEATS;
  const t0 = performance.now();
  const rows: string[] = [];
  const pooledWin: number[] = [];
  for (const [w, l] of edges) {
    const cells: string[] = [];
    let wins = 0;
    let n = 0;
    const hs: number[] = [];
    const ts: number[] = [];
    for (const f of FACTION_IDS) for (const g of cross ? FACTION_IDS : [f]) {
      let fw = 0;
      let fn = 0;
      const fh: number[] = [];
      setups.forEach((setup, i) => {
        for (const seat of [0, 1] as const) for (let d = 0; d < draws; d++) {
          const weapons: readonly [WeaponId, WeaponId] = seat === 0 ? [w, l] : [l, w];
          const factions: readonly [FactionId, FactionId] = seat === 0 ? [f, g] : [g, f];
          const r = playDuel({
            a: factions[0], b: factions[1], weapons, setup, setupIndex: i, style, cap, draw: d, sigma,
            cards: [kitCards(kit, weapons[0]), kitCards(kit, weapons[1])],
          });
          fw += r.winner === seat ? 1 : r.winner === null ? 0.5 : 0;
          fn++;
          if (r.winner === seat) { fh.push(r.hp[seat]); ts.push(r.ttk); }
        }
      });
      wins += fw;
      n += fn;
      hs.push(...fh);
      if (f === g) cells.push(`${pct(fw / fn).padStart(3)}%/${fh.length ? pct(median(fh)).padStart(2) : "--"}`);
    }
    pooledWin.push(wins / n);
    rows.push(`| ${w}>${l} | ${cells.join(" | ")} | ${pct(wins / n)}% / ${pct(median(hs))} / ${sec(median(ts))} s |`);
  }
  console.log(`# weapon layer, kit ${kit}, ${cross ? "pooled over the 25 faction pairs" : "same-faction mirrors"}, ${style}, ${sigma > 0 ? `noise ${sigma} x ${draws} draws` : "noise off"}: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  console.log("| edge | fire win%/h | sentenced | plague | frost | holy | pooled win% / h med / TTK |");
  console.log("|---|---|---|---|---|---|---|");
  console.log(rows.join("\n"));
  console.log("\nacceptance:");
  console.log(verdict("A7", "weakest edge, pooled favourite win", Math.min(...pooledWin), [0.55, 0.75], [0.5, 0.8]));
  console.log(verdict("A7", "strongest edge, pooled favourite win", Math.max(...pooledWin), [0.55, 0.75], [0.5, 0.8]));
}
