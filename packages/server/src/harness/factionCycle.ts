// The faction cycle per weapon (GAME_DESIGN 17; testing/COUNTER_REVIEW.md section 5). Report-only: it prints numbers
// for the owner and never blocks the build.
//
// Every duel runs the real sim: createGameWorld + step(), the weapon state machines, the ledger, the signature
// systems and settle(), with two players standing in reach of each other on an open floor, in contact from the first
// tick, holding the trigger toward each other (the bow draws and looses on its own). "trades" mode leaves out only where a
// hit lands: every swing that lands and every arrow or ball that leaves hits the other fighter in that same tick (an
// afterWeapons system), so a duel is the faction rules alone, as in testing/realtime.py, and the two compare cell by
// cell on the same grid of first-swing phases (phaseGrid mirrors realtime.phases). "full" mode keeps arcs and projectile
// flight, and with them blocks, reflections and stagger, with the two still standing face to face. "policy" mode plays
// each cell through Phase 9's weapon duel (duel.ts): both fighters move and attack by the shared weapon policies, the
// way the bots do, from the weapon matrix's 18 starting setups (distance, start offset, direction).
import {
  attackInterval, chillMultiplier, FACTIONS, mapFromTiles, mulberry32, pacedFaction, TICK_MS, TILE, TILE_FLOOR,
  TILE_WALL, WEAPONS, weaponTimings, type FactionId, type GameMap, type WeaponId, type WeaponTimings,
} from "@raid/shared";
import { combatant, type Combatant } from "../sim/combatant";
import { noteContact } from "../sim/factions";
import { createGameWorld } from "../sim/gameplay";
import { recordHit } from "../sim/ledger";
import { addPlayer, step } from "../sim/step";
import { runDuel as policyDuel } from "./duel";
import { fullSetups } from "./matrix";
import { packetFor } from "../sim/weapons";
import type { World } from "../sim/world";

/** realtime.py's DT and EPS. */
const DT = TICK_MS / 1000;
const EPS = 1e-9;
/** Centre-to-centre distance of the two fighters: inside every weapon's reach (the shield's 44 + 12 is the shortest). */
const DUEL_GAP = 40;
const MAP_TILES = 24;

export type DuelMode = "trades" | "full" | "policy";

export interface Fighter { faction: FactionId; weapon: WeaponId }

export interface DuelResult {
  /** 0: the first fighter won, 1: the second, -1: both fell in the same tick or time ran out (realtime.py's draw). */
  win: 0 | 1 | -1;
  frac0: number;
  frac1: number;
  /** Seconds from the first tick to the end of the tick it ended in (realtime.py's `t`). */
  t: number;
}

export interface CellStats {
  /** Share of phase pairs the first fighter won. */
  rate: number;
  /** Its worst and mean hp left (0 where it lost). */
  worst: number;
  mean: number;
  draws: number;
  /** Median and longest fight. */
  t: number;
  tmax: number;
  P: number;
}

/** numpy's round (half to even), so the phase grid picks the same offsets as realtime.py. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - Math.trunc(x)) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/**
 * First-swing offsets (seconds) of `side` against `opp`, and the chill multiplier the side starts under: realtime.phases
 * with both in contact from the start. `sub` refines the grid, `nmax` thins it evenly.
 */
export function phaseGrid(side: Fighter, opp: Fighter, sub = 1, nmax?: number): { offs: number[]; m: number } {
  const m = chillMultiplier(FACTIONS[opp.faction]);
  const span = attackInterval(FACTIONS[side.faction], side.weapon) / m;
  const n = Math.max(1, Math.ceil(span / DT - EPS)) * sub;
  let offs = Array.from({ length: n }, (_, i) => i * (span / n));
  if (nmax && n > nmax) {
    offs = Array.from({ length: nmax }, (_, i) => offs[roundHalfEven((i * (n - 1)) / (nmax - 1))]!);
  }
  return { offs, m };
}

/** An open floor (walled border) with the two duel spots in the middle. */
function duelMap(): GameMap {
  const tiles = new Uint8Array(MAP_TILES * MAP_TILES).fill(TILE_FLOOR);
  for (let i = 0; i < MAP_TILES; i++) {
    tiles[i] = tiles[(MAP_TILES - 1) * MAP_TILES + i] = TILE_WALL;
    tiles[i * MAP_TILES] = tiles[i * MAP_TILES + MAP_TILES - 1] = TILE_WALL;
  }
  const map = mapFromTiles(MAP_TILES, MAP_TILES, tiles);
  const c = (MAP_TILES * TILE) / 2;
  map.spawns = [{ x: c - DUEL_GAP / 2, y: c }, { x: c + DUEL_GAP / 2, y: c }];
  return map;
}

const MAP = duelMap();
const IDS = ["a", "b"] as const;

/** Every swing landing and every projectile leaving this tick hits the other fighter now (trades mode). */
function autoHit(world: World): void {
  const other = (id: string): string => (id === IDS[0] ? IDS[1] : IDS[0]);
  const name = (id: string): string => world.state.players.get(id)?.name ?? id;
  for (const m of world.combat.melee) {
    recordHit(world, { victim: other(m.attacker), by: { id: m.attacker, name: name(m.attacker) }, packet: m.packet, weapon: m.weapon, stagger: false });
  }
  for (const s of world.combat.spawns) {
    recordHit(world, { victim: other(s.owner), by: { id: s.owner, name: name(s.owner) }, packet: s.packet, weapon: s.weapon, stagger: false });
  }
  world.combat.melee = [];
  world.combat.spawns = [];
}

export interface DuelOpts {
  mode?: DuelMode;
  /** Seconds before the duel counts as a draw (realtime.py: 400). */
  tMax?: number;
}

/**
 * One duel: `a` and `b` start in contact at the first tick, `a` swinging first after offA seconds and `b` after offB
 * (offsets from phaseGrid, which already account for the chill each starts under).
 */
export function runDuel(a: Fighter, b: Fighter, offA: number, offB: number, opts: DuelOpts = {}): DuelResult {
  const mode = opts.mode ?? "trades";
  const tMax = opts.tMax ?? 400;
  const world = createGameWorld({
    seed: 1,
    config: {
      minPlayers: 2, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 1e9, patienceMinSeconds: 1e9,
      suddenDeathSeconds: 1e9,
    },
    random: mulberry32(1),
    map: MAP,
  });
  if (mode === "trades") world.afterWeapons.push(autoHit);
  addPlayer(world, IDS[0], "A");
  addPlayer(world, IDS[1], "B");
  step(world, TICK_MS);
  if (world.state.phase !== "active") throw new Error("harness: the duel did not start");

  // t = 0 of the duel is the next tick (T1); everything below is in place before it.
  const t1 = world.state.serverTime + TICK_MS;
  const sides = [a, b] as const;
  const offs = [offA, offB];
  const ms = [chillMultiplier(FACTIONS[b.faction]), chillMultiplier(FACTIONS[a.faction])];
  IDS.forEach((id, i) => {
    const c = combatant(world, id)!;
    if (c.kind !== "player") return;
    const side = sides[i]!;
    const spot = MAP.spawns[i]!;
    c.s.faction = side.faction;
    c.s.hp = c.s.maxHp = FACTIONS[side.faction].hp;
    c.s.weapon0 = side.weapon;
    c.s.weapon1 = "";
    c.s.slot = 0;
    c.s.x = spot.x;
    c.s.y = spot.y;
    c.rt.path = [];
    c.rt.history = [{ t: world.state.serverTime, x: c.s.x, y: c.s.y }];
    primeAttack(c, side.weapon, offs[i]!, ms[i]!, t1, i === 0 ? 0 : Math.PI);
    c.rt.inputs.pushAction({ kind: "attack", a: i === 0 ? 0 : Math.PI });
  });
  noteContact(world, IDS[0], IDS[1]);

  const ticks = Math.round(tMax / DT);
  const active = (): boolean => world.state.phase === "active";
  for (let k = 0; k < ticks && active(); k++) {
    step(world, TICK_MS);
  }
  const p0 = world.state.players.get(IDS[0])!;
  const p1 = world.state.players.get(IDS[1])!;
  const dead0 = p0.status !== "alive";
  const dead1 = p1.status !== "alive";
  const win: 0 | 1 | -1 = dead0 === dead1 ? -1 : dead1 ? 0 : 1;
  const ended = !active();
  return {
    win,
    frac0: Math.max(0, p0.hp) / p0.maxHp,
    frac1: Math.max(0, p1.hp) / p1.maxHp,
    t: ended ? (world.state.serverTime - t1) / 1000 + DT : tMax,
  };
}

function timingsFor(c: Combatant, w: WeaponId): WeaponTimings {
  return weaponTimings(w, attackInterval(pacedFaction(FACTIONS[c.s.faction as FactionId]), w));
}

/**
 * Sets the fighter up so that its first hit lands `off` seconds after t1 under the chill multiplier `m`, as
 * realtime.py's first swing does: a hit lands a windup (real time) after its attack starts, an arrow a full draw
 * (drawn at m x real time) after its draw starts. When that start falls before t1 the attack is already under way.
 */
function primeAttack(c: Combatant, weapon: WeaponId, off: number, m: number, t1: number, a: number): void {
  const tm = timingsFor(c, weapon);
  const w = c.rt.weapon;
  const packet = packetFor(c, weapon);
  const origin = { x: c.s.x, y: c.s.y };
  if (weapon === "bow") {
    const lead = m * off - tm.windup; // cooldown seconds before the draw starts; < 0: drawing already
    if (lead >= 0) {
      c.s.readyAt = t1 + lead * 1000;
      return;
    }
    const startedAt = t1 + lead * 1000;
    w.action = { kind: "draw", weapon, startedAt, landsAt: startedAt + tm.windup * 1000, a, packet, origin };
    c.s.drawStartedAt = startedAt;
    c.s.readyAt = startedAt + tm.interval * 1000;
    return;
  }
  const lead = off - tm.windup; // real seconds before the attack starts
  if (lead >= 0) {
    c.s.readyAt = t1 + m * lead * 1000;
    return;
  }
  const base = { weapon, startedAt: t1 + lead * 1000, landsAt: t1 + off * 1000, a, packet };
  w.action = WEAPONS[weapon].shape.kind === "arc"
    ? { kind: "swing", ...base }
    : { kind: "cast", ...base, origin };
  c.s.readyAt = t1 + (m * lead + tm.interval) * 1000;
}

/** Long enough for the slowest pair to finish after walking into range (Frost against Holy runs about 37 s). */
const POLICY_CAP_SECONDS = 150;

/** A cell in policy mode: one weapon duel per matrix setup. */
function policyCell(a: Fighter, b: Fighter): DuelResult[] {
  return fullSetups().map((setup, i) => {
    const r = policyDuel({
      faction: a.faction, factions: [a.faction, b.faction], weapons: [a.weapon, b.weapon],
      distance: setup.distance, angle: setup.angle, delayTicks: setup.delayTicks,
      arena: "open", perception: "client", capSeconds: POLICY_CAP_SECONDS, seed: 1 + i * 7, signatures: true,
    });
    return { win: r.winner ?? -1, frac0: r.hpFrac[0], frac1: r.hpFrac[1], t: r.seconds };
  });
}

/**
 * Every phase pair of a cell (a-major, as numpy's meshgrid with indexing="ij"), `a` the intended winner. In policy mode,
 * one duel per matrix setup instead (`sub` and `nmax` don't apply).
 */
export function runCell(a: Fighter, b: Fighter, opts: DuelOpts & { sub?: number; nmax?: number } = {}): DuelResult[] {
  if (opts.mode === "policy") return policyCell(a, b);
  const ga = phaseGrid(a, b, opts.sub ?? 1, opts.nmax);
  const gb = phaseGrid(b, a, opts.sub ?? 1, opts.nmax);
  const out: DuelResult[] = [];
  for (const oa of ga.offs) for (const ob of gb.offs) out.push(runDuel(a, b, oa, ob, opts));
  return out;
}

/** realtime.edge_stats for the first fighter. */
export function cellStats(rs: readonly DuelResult[]): CellStats {
  const n = rs.length;
  const left = rs.map((r) => (r.win === 0 ? r.frac0 : 0));
  const ts = rs.map((r) => r.t).sort((x, y) => x - y);
  const median = n % 2 ? ts[(n - 1) / 2]! : (ts[n / 2 - 1]! + ts[n / 2]!) / 2;
  return {
    rate: rs.filter((r) => r.win === 0).length / n,
    worst: Math.min(...left),
    mean: left.reduce((s, x) => s + x, 0) / n,
    draws: rs.filter((r) => r.win === -1).length / n,
    t: median,
    tmax: ts[n - 1]!,
    P: n,
  };
}
