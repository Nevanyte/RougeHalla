// The four Sentenced edges (Fire > Sentenced, Sentenced > Plague, Sentenced > Frost, Holy > Sentenced) through the real sim, one column per
// weapon both fighters hold: the redesign's tuning loop (docs/SENTENCED_REDESIGN.md section 11, testing/TUNING_SENTENCED.md). The same duels and the
// same noise model as bench/matchups.ts --layer faction (lock style, the 18 fullSetups, both seats, sigma 0.45), restricted to the edges that
// involve Sentenced, so a number change is measured in a minute and not five.
//
//   npx tsx packages/server/bench/sentencedEdges.ts [--weapons fists,sword,axe,bow,wand,shield,sig] [--kit 0..5] [--noise 0.45 --draws 4]
//                                                     [--setups 18] [--flip] [--style lock|policy] [--cap 300] [--edges fire>sentenced,...]
//                                                     [--sentenced-weapon <id|sig>]   (Sentenced holds this in every column; the other fighter holds the column's)
//
// Per edge and weapon: the favourite's Monte-Carlo win % / the underdog's / the favourite's median hp left % noise-free (and, with --flip,
// the median flip multiplier r and P(favourite) = Phi(ln r / (sigma sqrt 2))). Targets (the balance pass's A6): favourite 60-76%, underdog at
// least 24%, h 10-35%. Report only: it never fails.
import { BEATS, SIGNATURE_WEAPONS, type FactionId, type WeaponId } from "@raid/shared";
import { fullSetups } from "../src/harness/matrix";
import { edgeStats, favouriteShare, flag, median, opt, pct, playDuel, flipMultiplier, type DuelRecord } from "./lib/balance";
import { kitCards, kitWeapon, parseMinutes } from "./kits";

const args = process.argv.slice(2);
const kit = parseMinutes(opt(args, "kit", "0"))[0]!;
const sigma = Number(opt(args, "noise", "0.45"));
const draws = sigma > 0 ? Number(opt(args, "draws", "4")) : 1;
const nSetups = Number(opt(args, "setups", "18"));
const style: "lock" | "policy" = opt(args, "style", "lock") === "policy" ? "policy" : "lock";
const cap = Number(opt(args, "cap", kit === 0 ? "300" : "200"));
const doFlip = flag(args, "flip");
const weaponsArg = opt(args, "weapons", "fists,sword,axe,bow,wand,shield,sig").split(",");
const edgesArg = opt(args, "edges", "");
const sentencedWeapon = opt(args, "sentenced-weapon", "");
const edges = (edgesArg ? edgesArg.split(",").map((e) => e.split(">") as [FactionId, FactionId]) : BEATS.filter(([w, l]) => w === "sentenced" || l === "sentenced"));
const setups = fullSetups().filter((_, i) => i % Math.ceil(18 / nSetups) === 0);

function weaponOf(f: FactionId, w: string): WeaponId {
  if (f === "sentenced" && sentencedWeapon !== "") return sentencedWeapon === "sig" ? SIGNATURE_WEAPONS.sentenced : (sentencedWeapon as WeaponId);
  return w === "sig" ? SIGNATURE_WEAPONS[f] : w === "auto" ? kitWeapon(f, kit) : (w as WeaponId);
}

const t0 = performance.now();
console.log(`# Sentenced edges, kit ${kit}, ${style}, noise ${sigma} x ${draws} draws, ${setups.length} setups, both seats`);
console.log(`| edge | weapons | fav win % (MC) | underdog % | h noise-free % | h min % |${doFlip ? " r med | P(fav) from r |" : ""}`);
console.log(`|---|---|---|---|---|---|${doFlip ? "---|---|" : ""}`);
for (const [w, l] of edges) {
  for (const wn of weaponsArg) {
    const ww = weaponOf(w, wn);
    const wl = weaponOf(l, wn);
    const mc: DuelRecord[] = [];
    const clean: DuelRecord[] = [];
    const rs: number[] = [];
    for (const [a, b] of [[w, l], [l, w]] as const) {
      const wa = a === w ? ww : wl;
      const wb = a === w ? wl : ww;
      setups.forEach((setup, i) => {
        const base = { a, b, weapons: [wa, wb] as const, setup, setupIndex: i, style, cap, cards: [kitCards(kit, wa), kitCards(kit, wb)] as const };
        for (let d = 0; d < draws; d++) mc.push(playDuel({ ...base, draw: d, sigma }));
        clean.push(playDuel(base));
        if (doFlip) rs.push(flipMultiplier(base, a === w ? 1 : 0));
      });
    }
    const m = edgeStats(mc, w, l);
    const c = edgeStats(clean, w, l);
    const r = doFlip ? median(rs) : NaN;
    console.log(`| ${w}>${l} | ${wn === "sig" ? `${SIGNATURE_WEAPONS[w]}/${SIGNATURE_WEAPONS[l]}` : wn} | ${pct(m.favWin)} | ${pct(m.underWin)} | ${pct(c.h)} | ${pct(c.hMin)} |${doFlip ? ` ${r.toFixed(2)} | ${pct(favouriteShare(r))} |` : ""}`);
  }
}
console.log(`\n(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
