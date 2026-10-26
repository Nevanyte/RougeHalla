// One headless weapon duel: the real sim (createGameWorld, addPlayer, step) on a hand-built arena, with two in-process
// "clients" that play through enqueueClientMessage exactly as a socket would: aim every tick, attack on the trigger's
// rising edge, release on its falling edge, and move/stop. Their decisions come from
// shared/policies.ts, the same brain the bots use. Nothing here changes a weapon or a faction number.
//
// What a client sees. Positions are read from the sim's history at serverTime - INTERP_DELAY_MS, where a client draws
// them, and velocities come from two such samples. Every attack and release carries t = that render time, so melee is
// rewound the way it is for a client with no network latency; a melee client just acts on what it sees. A projectile
// flies in present time, so a projectile client leads for the stale view, the tick its input waits and the cast
// (perception "client"); "stale" aims at the stale view with no lead (what the bots do) and "present" reads the present
// state (a cheat), for comparison.
import {
  circleClear, FACTIONS, hasLineOfSight, INTERP_DELAY_MS, isRanged, mapFromTiles, mulberry32, PLAYER_RADIUS, segmentClear, TICK_MS,
  TILE, TILE_WALL, decide,
  type FactionId, type GameMap, type PolicyInput, type SpacingPolicy, type Vec2, type WeaponId,
} from "@raid/shared";
import { activeWeapon, combatant, timingsOf, type Combatant } from "../sim/combatant";
import { createGameWorld } from "../sim/gameplay";
import { enqueueClientMessage } from "../sim/inputs";
import { positionAt } from "../sim/movement";
import { addPlayer, step } from "../sim/step";
import { moveMultiplierOf } from "../sim/weapons";
import { collisionMap, type SimEvent, type World } from "../sim/world";

export type Arena = "open" | "pillars";
/** How a projectile client sees its target: the render-time view with the leads a real client can make ("client"), that view taken at face value ("stale"), or the present ("present"). */
export type Perception = "client" | "stale" | "present";

export interface DuelSpec {
  faction: FactionId;
  /** Fighter 0's and fighter 1's faction when they differ (the faction cycle, harness/factionCycle.ts); else `faction`. */
  factions?: readonly [FactionId, FactionId];
  /** Fighter 0's and fighter 1's weapon (in the weapon matrix both hold the same faction, so only the weapon differs). */
  weapons: readonly [WeaponId, WeaponId];
  /**
   * Faction signatures on (sim/factions.ts). Off by default: the weapon matrix measures weapons alone, and a mirror
   * faction's signatures (backlash reads the enemy's weapon, the mark and DoT ignore shields) would colour it.
   */
  signatures?: boolean;
  /** Start distance, centre to centre, along `angle`. */
  distance: number;
  /** Direction from fighter 0 to fighter 1 (radians). */
  angle?: number;
  /** Ticks each fighter waits before it starts acting: the start-phase offset. */
  delayTicks?: readonly [number, number];
  arena?: Arena;
  capSeconds?: number;
  seed?: number;
  perception?: Perception;
  /** Spacing to play fighter 0 / fighter 1's weapon with instead of the shared POLICIES (policy experiments). */
  spacing?: readonly [SpacingPolicy | undefined, SpacingPolicy | undefined];
  /** Called after every step (debugging and tests). */
  onTick?: (world: World, tick: number, events: readonly SimEvent[]) => void;
}

/** One landed hit, as the sim reported it. `by` is the fighter index. */
export interface HitRecord { t: number; by: 0 | 1; amount: number; weapon: WeaponId | null }

export interface DuelCounts {
  /** Swings and casts started, by fighter. */
  attacks: [number, number];
  /** Arrows and balls that left their owner (a reflected arrow counts for the shield holder). */
  shots: [number, number];
  /** Hits landed on the other fighter, and their damage after mitigation. */
  hits: [number, number];
  damage: [number, number];
  /** Hits this fighter's shield negated. */
  blocks: [number, number];
  /** Times this fighter was staggered. */
  staggers: [number, number];
  /** Projectile endings by `kind:reason`, e.g. "arrow:deleted". */
  projectiles: Record<string, number>;
  /** Ticks a fighter wanted to walk, was free to and did not move: walking into a wall. */
  stuck: [number, number];
  /** Ticks a fighter stood with its body within WALL_MARGIN of a wall: backed up against it or into a corner. */
  atWall: [number, number];
}

export interface DuelResult {
  spec: DuelSpec;
  /** The fighter who stood last (the sim's tie-break decides two falling together), or null for a draw or a time cap. */
  winner: 0 | 1 | null;
  /** "kill": one fighter stood; "draw": both fell with exactly equal hp fractions; "cap": nobody had fallen at the time cap. */
  end: "kill" | "draw" | "cap";
  /** From the start of the run to its end (or the cap). */
  seconds: number;
  hp: [number, number];
  hpFrac: [number, number];
  /** At a time cap, who was ahead on hp fraction. */
  lead: 0 | 1 | null;
  counts: DuelCounts;
  hitLog: HitRecord[];
}

const ARENA_TILES = 40;
/** A body whose edge is this close to a wall counts as at the wall: backed up against it, a tile and a bit away. */
const WALL_MARGIN = 36;
const DEFAULT_CAP_SECONDS = 60;
/** The run never reaches its patience timer or sudden death within a duel. */
const NEVER_SECONDS = 1_000_000;

export function buildArena(arena: Arena, starts: readonly [Vec2, Vec2], seed: number): GameMap {
  const n = ARENA_TILES;
  const tiles = new Uint8Array(n * n);
  const wall = (tx: number, ty: number): void => { tiles[ty * n + tx] = TILE_WALL; };
  for (let i = 0; i < n; i++) { wall(i, 0); wall(i, n - 1); wall(0, i); wall(n - 1, i); }
  if (arena === "pillars") {
    const rng = mulberry32(seed ^ 0x9e3779b1);
    const [a, b] = starts;
    let placed = 0;
    for (let tries = 0; placed < 10 && tries < 400; tries++) {
      const tx = 3 + Math.floor(rng() * (n - 7));
      const ty = 3 + Math.floor(rng() * (n - 7));
      // A 2x2 block that keeps the starting line (and a body width either side of it) clear.
      const cx = (tx + 1) * TILE;
      const cy = (ty + 1) * TILE;
      const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const k = len2 > 0 ? Math.min(1, Math.max(0, ((cx - a.x) * (b.x - a.x) + (cy - a.y) * (b.y - a.y)) / len2)) : 0;
      const off = Math.hypot(cx - (a.x + (b.x - a.x) * k), cy - (a.y + (b.y - a.y) * k));
      if (off < 2.5 * TILE) continue;
      wall(tx, ty); wall(tx + 1, ty); wall(tx, ty + 1); wall(tx + 1, ty + 1);
      placed++;
    }
  }
  return mapFromTiles(n, n, tiles);
}

/** Where the two fighters start: centred on the arena, `distance` apart along `angle`. */
export function startPoints(distance: number, angle = 0): [Vec2, Vec2] {
  const c = (ARENA_TILES * TILE) / 2;
  const dx = Math.cos(angle) * distance / 2;
  const dy = Math.sin(angle) * distance / 2;
  return [{ x: c - dx, y: c - dy }, { x: c + dx, y: c + dy }];
}

const IDS = ["f0", "f1"] as const;

interface View { pos: Vec2; vel: Vec2; at: number }

/** One in-process client: reads the world as a player would see it and sends the policy's inputs. */
class Client {
  private triggerDown = false;
  private sent: Vec2 | "stop" | null = null;
  private lastPos: Vec2 | null = null;
  stuck = 0;
  atWall = 0;

  constructor(readonly index: 0 | 1, private readonly perception: Perception, private readonly spacing?: SpacingPolicy) {}

  private get id(): string { return IDS[this.index]; }
  private get foeId(): string { return IDS[this.index === 0 ? 1 : 0]; }

  private view(c: Combatant, now: number, atPresent: boolean): View {
    const at = atPresent ? now : now - INTERP_DELAY_MS;
    const pos = positionAt(c.rt, c.s, at);
    const before = positionAt(c.rt, c.s, at - TICK_MS);
    const dt = TICK_MS / 1000;
    return { pos, vel: { x: (pos.x - before.x) / dt, y: (pos.y - before.y) / dt }, at };
  }

  /** Counts a tick in which the fighter was free to walk toward a faraway point and stayed where it was. */
  noteMovement(world: World): void {
    const me = combatant(world, this.id);
    if (!me || me.s.status !== "alive") return;
    const pos = { x: me.s.x, y: me.s.y };
    const last = this.lastPos;
    this.lastPos = pos;
    if (!circleClear(collisionMap(world), pos, PLAYER_RADIUS + WALL_MARGIN)) this.atWall++;
    if (!last || !this.sent || this.sent === "stop") return;
    const wants = Math.hypot(this.sent.x - pos.x, this.sent.y - pos.y) > 40;
    if (wants && moveMultiplierOf(world, me) > 0 && Math.hypot(pos.x - last.x, pos.y - last.y) < 0.5) this.stuck++;
  }

  act(world: World): void {
    const me = combatant(world, this.id);
    const foe = combatant(world, this.foeId);
    if (!me || !foe || me.s.status !== "alive" || foe.s.status !== "alive") return;
    const weapon = activeWeapon(me.s);
    const tm = weapon ? timingsOf(me.s, weapon) : null;
    if (!weapon || !tm) return;
    const now = world.state.serverTime;
    const projectile = isRanged(weapon);
    const atPresent = this.perception === "present" && projectile;
    const mine = this.view(me, now, atPresent);
    const theirs = this.view(foe, now, atPresent);
    const map = collisionMap(world);
    const input: PolicyInput = {
      self: mine.pos,
      target: theirs.pos,
      targetVel: theirs.vel,
      selfVel: mine.vel,
      los: hasLineOfSight(map, mine.pos, theirs.pos),
      weapon,
      ready: now >= me.s.readyAt,
      walkable: (a, b) => segmentClear(map, a, b, PLAYER_RADIUS),
      spacing: this.spacing,
      time: now / 1000,
    };
    // A swing is judged as the attacker saw the world (the server rewinds it), so a melee client just acts on its view.
    // A projectile flies in present time: lead it for the stale view, the tick the input waits and the cast.
    if (projectile && this.perception !== "stale") {
      if (this.perception === "client") input.viewLag = INTERP_DELAY_MS / 1000;
      input.inputDelay = TICK_MS / 1000;
      input.windup = tm.windup;
    }
    const out = decide(input);
    const q = me.rt.inputs;
    enqueueClientMessage(q, "aim", { a: out.aim });
    if (out.move === "stop") {
      if (this.sent !== "stop") enqueueClientMessage(q, "stop", {});
      this.sent = "stop";
    } else if (out.move) {
      const last = this.sent;
      if (last === null || last === "stop" || Math.hypot(last.x - out.move.x, last.y - out.move.y) > 2) {
        enqueueClientMessage(q, "move", out.move);
        this.sent = out.move;
      }
    }
    const t = mine.at;
    if (out.hold && !this.triggerDown) {
      enqueueClientMessage(q, "attack", { a: out.aim, t });
      this.triggerDown = true;
    } else if (!out.hold && this.triggerDown) {
      enqueueClientMessage(q, "release", { a: out.aim, t });
      this.triggerDown = false;
    }
  }
}

function emptyCounts(): DuelCounts {
  return {
    attacks: [0, 0], shots: [0, 0], hits: [0, 0], damage: [0, 0], blocks: [0, 0], staggers: [0, 0], projectiles: {}, stuck: [0, 0], atWall: [0, 0],
  };
}

const indexOf = (id: string | null): 0 | 1 | null => (id === IDS[0] ? 0 : id === IDS[1] ? 1 : null);

export function runDuel(spec: DuelSpec): DuelResult {
  const seed = spec.seed ?? 1;
  const cap = spec.capSeconds ?? DEFAULT_CAP_SECONDS;
  const perception = spec.perception ?? "client";
  const starts = startPoints(spec.distance, spec.angle ?? 0);
  const delays = spec.delayTicks ?? [0, 0];

  const world = createGameWorld({
    seed,
    random: mulberry32(seed + 1),
    config: {
      minPlayers: 2, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: NEVER_SECONDS, patienceMinSeconds: NEVER_SECONDS,
      suddenDeathSeconds: NEVER_SECONDS,
    },
  }, { signatures: spec.signatures ?? false });
  // The world builds a map from its seed (about 15 ms, unused here); the duel's hand-built arena replaces it.
  world.map = { ...buildArena(spec.arena ?? "open", starts, seed), spawns: [starts[0], starts[1]] };
  for (let i = 0; i < 2; i++) {
    const p = addPlayer(world, IDS[i]!, IDS[i]!);
    const faction = spec.factions?.[i] ?? spec.faction;
    const f = FACTIONS[faction];
    p.faction = faction;
    p.hp = p.maxHp = f.hp;
    p.weapon0 = spec.weapons[i]!;
    p.weapon1 = "";
  }
  step(world, TICK_MS); // lobby -> active
  for (let i = 0; i < 2; i++) {
    const p = world.state.players.get(IDS[i]!)!;
    const rt = world.players.get(IDS[i]!)!;
    p.x = starts[i]!.x;
    p.y = starts[i]!.y;
    p.facing = Math.atan2(starts[1 - i]!.y - starts[i]!.y, starts[1 - i]!.x - starts[i]!.x);
    rt.history = [{ t: world.state.serverTime, x: p.x, y: p.y }];
  }
  if (!circleClear(world.map, starts[0], PLAYER_RADIUS) || !circleClear(world.map, starts[1], PLAYER_RADIUS)) {
    throw new Error(`duel start (${spec.distance} u at ${spec.angle ?? 0} rad) is inside a wall`);
  }

  const clients = [new Client(0, perception, spec.spacing?.[0]), new Client(1, perception, spec.spacing?.[1])] as const;
  const counts = emptyCounts();
  const hitLog: HitRecord[] = [];
  const seenProjectiles = new Set<string>();
  const t0 = world.state.raidStartedAt;
  const maxTicks = Math.round((cap * 1000) / TICK_MS);

  let tick = 0;
  for (; tick < maxTicks && world.state.phase === "active"; tick++) {
    for (const c of clients) if (tick >= delays[c.index]!) c.act(world);
    const events = step(world, TICK_MS);
    const now = world.state.serverTime;
    for (const e of events) {
      if (e.type !== "fx") continue;
      const fx = e.fx;
      switch (fx.kind) {
        case "windup": { const i = indexOf(fx.by); if (i !== null) counts.attacks[i]++; break; }
        case "hit": {
          const i = indexOf(fx.by);
          if (i !== null) { counts.hits[i]++; counts.damage[i] += fx.amount; hitLog.push({ t: (now - t0) / 1000, by: i, amount: fx.amount, weapon: fx.weapon }); }
          break;
        }
        case "block": { const i = indexOf(fx.id); if (i !== null) counts.blocks[i]++; break; }
        case "stagger": { const i = indexOf(fx.id); if (i !== null) counts.staggers[i]++; break; }
        case "projEnd": counts.projectiles[`${fx.proj}:${fx.reason}`] = (counts.projectiles[`${fx.proj}:${fx.reason}`] ?? 0) + 1; break;
        default: break;
      }
    }
    for (const [id, pr] of world.projectiles) {
      if (seenProjectiles.has(id)) continue;
      seenProjectiles.add(id);
      const i = indexOf(pr.owner);
      if (i !== null) counts.shots[i]++;
    }
    for (const c of clients) c.noteMovement(world);
    spec.onTick?.(world, tick, events);
  }
  counts.stuck = [clients[0].stuck, clients[1].stuck];
  counts.atWall = [clients[0].atWall, clients[1].atWall];

  const players = IDS.map((id) => world.state.players.get(id)!);
  const hp: [number, number] = [players[0]!.hp, players[1]!.hp];
  const hpFrac: [number, number] = [hp[0] / players[0]!.maxHp, hp[1] / players[1]!.maxHp];
  const seconds = (world.state.serverTime - t0) / 1000;
  const ended = world.state.phase === "ended";
  const winnerIndex = ended ? indexOf(IDS.find((id) => world.state.players.get(id)?.name === world.state.winner) ?? null) : null;
  const end: DuelResult["end"] = !ended ? "cap" : winnerIndex === null ? "draw" : "kill";
  const lead: DuelResult["lead"] = end !== "cap" || hpFrac[0] === hpFrac[1] ? null : hpFrac[0] > hpFrac[1] ? 0 : 1;
  return { spec, winner: winnerIndex, end, seconds, hp, hpFrac, lead, counts, hitLog };
}
