// A small rig for the PvP-rule tests (pvpFactor.test.ts, guards.test.ts): a started run of hand-placed fighters on an open floor
// with the PvP rules ON (the factor and its caps; a test of the damage law's own arithmetic turns them off), and hits recorded by
// hand inside a real tick, so they land in the real ledger pass with the real systems around it.
import {
  FACTIONS, mapFromTiles, mulberry32, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type DamageShares, type FactionId, type GameMap, type Vec2,
  type WeaponId,
} from "@raid/shared";
import { createGameWorld } from "../../src/sim/gameplay";
import { recordHit } from "../../src/sim/ledger";
import { addPlayer, step } from "../../src/sim/step";
import type { LedgerEntry, SimEvent, World } from "../../src/sim/world";

const W_TILES = 40;
const H_TILES = 20;

function openMap(): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let tx = 0; tx < W_TILES; tx++) { tiles[tx] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + tx] = TILE_WALL; }
  for (let ty = 0; ty < H_TILES; ty++) { tiles[ty * W_TILES] = TILE_WALL; tiles[ty * W_TILES + W_TILES - 1] = TILE_WALL; }
  const spawns = Array.from({ length: 8 }, (_, i) => ({ x: (3 + i) * TILE + TILE / 2, y: 3 * TILE + TILE / 2 }));
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns };
}

export interface RigFighter {
  id: string;
  faction: FactionId;
  at?: Vec2;
  /** hp as a share of the faction's max hp. */
  hpFrac?: number;
  weapon?: WeaponId | "";
  /** Cards (PlayerState.build: id -> count), set before the run's first tick, so they are in the pass-start state. */
  build?: Record<string, number>;
}

export const PHYSICAL: DamageShares = { phys: 1, magic: 0, true: 0 };
export const MAGIC: DamageShares = { phys: 0, magic: 1, true: 0 };
export const TRUE: DamageShares = { phys: 0, magic: 0, true: 1 };

export const nameOf = (id: string): string => id[0]!.toUpperCase() + id.slice(1);
export const P = (world: World, id: string) => world.state.players.get(id)!;
export const RT = (world: World, id: string) => world.players.get(id)!;

/** An active run (the first step starts it) of these fighters, side by side, with the PvP rules on. */
export function pvpArena(fighters: readonly RigFighter[], opts: { pvpRules?: boolean; signatures?: boolean } = {}): World {
  const world = createGameWorld({
    seed: 11,
    config: {
      minPlayers: fighters.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 3600, ...(opts.pvpRules === false ? { pvpRules: false } : {}),
    },
    random: mulberry32(12),
  }, { signatures: opts.signatures === true });
  world.map = openMap();
  for (const f of fighters) {
    const p = addPlayer(world, f.id, nameOf(f.id));
    p.faction = f.faction;
    p.hp = p.maxHp = FACTIONS[f.faction].hp;
    p.weapon0 = f.weapon ?? "";
    for (const [id, count] of Object.entries(f.build ?? {})) p.build.set(id, count);
  }
  step(world, TICK_MS);
  fighters.forEach((f, i) => {
    const at = f.at ?? { x: 200 + 60 * i, y: 320 };
    const p = P(world, f.id);
    p.x = at.x;
    p.y = at.y;
    RT(world, f.id).history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
    if (f.hpFrac !== undefined) p.hp = p.maxHp * f.hpFrac;
  });
  return world;
}

export const tick = (world: World): SimEvent[] => step(world, TICK_MS);

/**
 * One tick in which `fn` runs in the inputs phase, where it records its hits: they are applied at the ledger step of that same
 * tick, with the real weapon, movement, system and settle phases around them. (The pickup handler is swapped for `fn`.)
 */
export function inStep(world: World, fn: () => void): SimEvent[] {
  const actor = [...world.players.values()].find((rt) => !rt.down && !rt.resolved)!;
  const prev = world.actions.pickup;
  world.actions.pickup = () => fn();
  actor.inputs.pushAction({ kind: "pickup", containerId: "none" });
  try {
    return tick(world);
  } finally {
    world.actions.pickup = prev;
  }
}

export interface HitOpts { shares?: DamageShares; weapon?: WeaponId | null; scale?: number; sig?: LedgerEntry["sig"]; dot?: boolean; ability?: LedgerEntry["ability"]; arena?: boolean; passive?: boolean }

/** Records a hit of `raw` on `victim` by `by` (an armor-free victim, Fire / Holy / a dummy, takes a physical `raw` as it is). */
export function hit(world: World, victim: string, by: string, raw: number, o: HitOpts = {}): LedgerEntry {
  return recordHit(world, {
    victim, by: { id: by, name: nameOf(by) }, packet: { raw, ...(o.shares ?? PHYSICAL) }, weapon: o.weapon === undefined ? "axe" : o.weapon,
    stagger: false, ...(o.scale === undefined ? {} : { scale: o.scale }), ...(o.sig === undefined ? {} : { sig: o.sig }),
    ...(o.dot ? { dot: true } : {}), ...(o.ability === undefined ? {} : { ability: o.ability }), ...(o.arena ? { arena: true } : {}),
    ...(o.passive ? { passive: true } : {}),
  });
}
