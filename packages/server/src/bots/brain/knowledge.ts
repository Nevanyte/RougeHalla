// What a bot knows of the counter wheels (docs/BOTS.md 2.7). The faction wheel and the weapon wheel have ten edges each; a bot
// knows each with probability TierParams.knowledge, drawn once at creation, and an edge it does not know reads 0. On top of
// that every bot reads the matchup tint the UI shows a human (in sight within MATCHUP_RANGE), so what knowledge buys is the
// matchup beyond 450 u or out of sight: whom to hunt from afar, which second weapon to fetch, which camps to route through.
import {
  BEATS, FACTION_IDS, WEAPON_BEATS, factionEdge as trueFactionEdge, weaponEdge as trueWeaponEdge,
  type FactionId, type Rng, type WeaponId,
} from "@raid/shared";
import { matchupShare } from "../mobHunt";
import type { FightOdds, Knowledge, OpponentSnapshot, SelfView, TierParams } from "./types";

const MAX_EDGE = 2;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** "a|b" -> the index of the beats row the pair belongs to, either way round (a mirror is in no row). */
function edgeTable<T extends string>(pairs: ReadonlyArray<readonly [T, T]>): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  pairs.forEach(([w, l], i) => { map.set(`${w}|${l}`, i); map.set(`${l}|${w}`, i); });
  return map;
}
const FACTION_EDGES = edgeTable(BEATS);
const WEAPON_EDGES = edgeTable(WEAPON_BEATS);

/** The Knowledge of one bot. `rng` is the bot's `decide` stream: the masks and the mob-share errors take a fixed number of draws. */
export function createKnowledge(tier: TierParams, rng: Rng): Knowledge {
  const factionKnown = BEATS.map(() => rng() < tier.knowledge);
  const weaponKnown = WEAPON_BEATS.map(() => rng() < tier.knowledge);
  // One fixed error per (me, region, elite): a bot misjudges some camps and not others, the same way all run.
  const shareError = new Map<string, number>();
  for (const me of FACTION_IDS) {
    for (const region of FACTION_IDS) {
      for (const elite of [false, true]) shareError.set(shareKey(me, region, elite), (rng() * 2 - 1) * tier.mobShareNoise);
    }
  }

  const factionIsKnown = (a: FactionId, b: FactionId): boolean => {
    const i = FACTION_EDGES.get(`${a}|${b}`);
    return i === undefined || factionKnown[i]!; // a mirror has nothing to learn
  };
  const weaponIsKnown = (a: WeaponId, b: WeaponId): boolean => {
    const i = WEAPON_EDGES.get(`${a}|${b}`);
    return i === undefined || weaponKnown[i]!;
  };
  const factionEdge = (a: FactionId, b: FactionId): -1 | 0 | 1 => (factionIsKnown(a, b) ? trueFactionEdge(a, b) : 0);
  const weaponEdge = (a: WeaponId, b: WeaponId): -1 | 0 | 1 => (weaponIsKnown(a, b) ? trueWeaponEdge(a, b) : 0);

  return {
    factionEdge,
    weaponEdge,
    mobShare(me, region, elite) {
      return clamp(matchupShare(me, region, elite) + (shareError.get(shareKey(me, region, elite)) ?? 0), 0, 1);
    },
    odds(me: SelfView, them: OpponentSnapshot): FightOdds {
      const mine: WeaponId | null = me.weapons[me.slot];
      let score = 0;
      let factionOk = false;
      let weaponOk = false;
      if (me.faction !== null && them.faction !== null) {
        score += factionEdge(me.faction, them.faction);
        factionOk = factionIsKnown(me.faction, them.faction);
      }
      // Their weapon in hand is all that is drawn: without it only the faction part says anything.
      if (mine !== null && them.inHand !== null) {
        score += weaponEdge(mine, them.inHand);
        weaponOk = weaponIsKnown(mine, them.inHand);
      }
      const known = factionOk && weaponOk;
      let source = known ? "known" : "partial";
      if (!known && them.tint !== 0) {
        // The UI shows the true score faded by distance: sign x 2 x |tint| is what a human reads off it.
        score = Math.sign(them.tint) * MAX_EDGE * Math.abs(them.tint);
        source = "tint";
      }
      const lead = me.maxHp > 0 ? me.hp / me.maxHp - them.hpFrac : 0;
      const leadTerm = clamp(2 * lead, -MAX_EDGE, MAX_EDGE);
      return {
        edge: clamp(score + leadTerm, -MAX_EDGE, MAX_EDGE),
        known,
        why: `${source} ${score.toFixed(2)}, hp lead ${leadTerm.toFixed(2)}`,
      };
    },
  };
}

function shareKey(me: FactionId, region: FactionId, elite: boolean): string {
  return `${me}/${region}/${elite ? "e" : "m"}`;
}
