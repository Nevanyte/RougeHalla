// Kiting in the real sim: how long a melee fighter needs to reach a shooter that starts at the edge of its range, by how
// the shooter plays, and what the shooter lands on it on the way. The design's check (testing/realtime.py, `kite`)
// assumes a shooter that STANDS: the chaser closes (range - reach) / speed, and that is the "free fire" it has to absorb.
// A shooter that walks away between shots can give itself more than that: it is rooted only for each windup, and the
// chaser closes the gap only then, so the free fire is about interval / windup times the standing shooter's (the ranged
// windup shares in shared/weapons.ts are the lever; testing/TUNING_CONTROLS.md). The `orbwalk` style is the perfect version
// of it, and `lock` is a shooter that just clicks its chaser (the server walks it into range and shoots); this section
// measures them all. Report-only, like the rest of the harness.
import {
  FACTION_IDS, FACTIONS, PLAYER_RADIUS, PLAYER_SPEED, WEAPONS, type FactionId, type WeaponId,
} from "@raid/shared";
import { runDuel } from "./duel";
import { spacingFor, type Style } from "./matrix";

export const MELEE_WEAPONS: readonly WeaponId[] = ["sword", "axe", "shield"];
export const RANGED_WEAPONS: readonly WeaponId[] = ["bow", "wand"];
/** post: never moves (the design's standing shooter). stand / strafe / kite: how the harness plays the ranged weapon; orbwalk: the perfect kiter; lock: a click on the chaser (matrix.ts). */
export const KITE_STYLES: readonly Style[] = ["post", "stand", "strafe", "kite", "orbwalk", "lock"];

export interface KiteCell {
  melee: WeaponId;
  ranged: WeaponId;
  style: Style;
  /** Median over the factions of the seconds until the melee fighter is close enough to hit (the cap when it never was). */
  contact: number;
  /** Median over the factions of the shooter's damage before then, as a share of the faction's hp. */
  freeFire: number;
  /** Duels (of the factions) where the melee fighter never got in reach within the cap. */
  missed: number;
}

export interface KitingReport {
  cells: KiteCell[];
  /** (range - reach) / speed for each shooter: the time a standing shooter gets. */
  bound: Record<string, number>;
  /** The worst kite time over the time against a shooter that never moves, over every melee and ranged weapon pair and style. */
  worst: { ratio: number; melee: WeaponId; ranged: WeaponId; style: Style };
  /** The same for the perfect kiter alone (the style that bounds the windups' tuning). */
  worstOrbwalk: { ratio: number; melee: WeaponId; ranged: WeaponId };
  text: string[];
}

const CAP_SECONDS = 10;
const reachOf = (w: WeaponId): number => { const s = WEAPONS[w].shape; return s.kind === "arc" ? s.reach : 0; };
const rangeOf = (w: WeaponId): number => { const s = WEAPONS[w].shape; return s.kind === "projectile" ? s.range : 0; };

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function kitingReport(factions: readonly FactionId[] = FACTION_IDS): KitingReport {
  const cells: KiteCell[] = [];
  const bound: Record<string, number> = {};
  for (const r of RANGED_WEAPONS) bound[r] = (rangeOf(r) - 60) / PLAYER_SPEED;
  for (const m of MELEE_WEAPONS) {
    for (const r of RANGED_WEAPONS) {
      for (const style of KITE_STYLES) {
        const times: number[] = [];
        const frees: number[] = [];
        let missed = 0;
        for (const faction of factions) {
          // The shooter starts just inside its range, in line with the chaser, with the arena behind it.
          let contact: number | null = null;
          const res = runDuel({
            faction, weapons: [m, r], distance: rangeOf(r) - 20, angle: 0.1, capSeconds: CAP_SECONDS, seed: 3,
            spacing: [undefined, spacingFor(r, style)],
            locks: [false, style === "lock"],
            onTick: (world, tick) => {
              if (contact !== null) return;
              const a = world.state.players.get("f0")!;
              const b = world.state.players.get("f1")!;
              if (Math.hypot(a.x - b.x, a.y - b.y) <= reachOf(m) + PLAYER_RADIUS) contact = (tick + 1) / 20;
            },
          });
          const t1: number = contact ?? CAP_SECONDS;
          if (contact === null) missed++;
          times.push(t1);
          frees.push(res.hitLog.filter((h) => h.by === 1 && h.t <= t1).reduce((a, h) => a + h.amount, 0) / FACTIONS[faction].hp);
        }
        cells.push({ melee: m, ranged: r, style, contact: median(times), freeFire: median(frees), missed });
      }
    }
  }
  let worst: KitingReport["worst"] = { ratio: 0, melee: "sword", ranged: "bow", style: "stand" };
  let worstOrbwalk: KitingReport["worstOrbwalk"] = { ratio: 0, melee: "sword", ranged: "bow" };
  for (const c of cells) {
    if (c.style === "post") continue;
    const post = cells.find((x) => x.melee === c.melee && x.ranged === c.ranged && x.style === "post")!;
    const ratio = c.contact / Math.max(1e-9, post.contact);
    if (ratio > worst.ratio) worst = { ratio, melee: c.melee, ranged: c.ranged, style: c.style };
    if (c.style === "orbwalk" && ratio > worstOrbwalk.ratio) worstOrbwalk = { ratio, melee: c.melee, ranged: c.ranged };
  }
  const text: string[] = [];
  text.push(`standing-shooter bound (range - 60 u) / ${PLAYER_SPEED} u/s: bow ${bound.bow!.toFixed(2)} s, wand ${bound.wand!.toFixed(2)} s`);
  text.push(`${"".padEnd(16)}${KITE_STYLES.map((s) => s.padStart(14)).join("")}   seconds until in reach / the shooter's hits before then, % of hp  (+ = never within ${CAP_SECONDS} s)`);
  for (const r of RANGED_WEAPONS) {
    for (const m of MELEE_WEAPONS) {
      const row = [`${m} vs ${r}`.padEnd(16)];
      for (const style of KITE_STYLES) {
        const c = cells.find((x) => x.melee === m && x.ranged === r && x.style === style)!;
        row.push(`${c.contact.toFixed(2)}s${c.missed ? "+" : " "} ${(c.freeFire * 100).toFixed(0).padStart(3)}%`.padStart(14));
      }
      text.push(row.join(""));
    }
  }
  text.push(`worst time against a shooter that moves, over the time against one that never does: x${worst.ratio.toFixed(2)} (${worst.melee} vs ${worst.ranged}, ${worst.style})`);
  text.push(`worst time against the perfect kiter (orbwalk: rooted only for its windups), over the time against one that never moves: x${worstOrbwalk.ratio.toFixed(2)} (${worstOrbwalk.melee} vs ${worstOrbwalk.ranged})`);
  return { cells, bound, worst, worstOrbwalk, text };
}
