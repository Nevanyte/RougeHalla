// Budget check for the Phase 11 wire: bytes per second one client receives with 8 players and 60 mobs, most of the
// mobs awake and fighting. Headless, no sockets: it runs the real sim and encodes what RaidRoom would send.
//   npx tsx bench/bandwidth.ts                 (from packages/server; seed=N ticks=N override the defaults)
// test/bandwidth.test.ts runs the same scenarios against the gate (under 20 KB/s per client).
//
// What is counted, per client (the room has no StateView, so every client gets the same bytes):
//   patch  one ROOM_STATE_PATCH frame per tick, encoded by a schema Encoder built right after the world, the way
//          core's SchemaSerializer does it (`sharedBuffer[0] = ROOM_STATE_PATCH; encode({ offset: 1 })`), then discardChanges().
//   fx     one ROOM_DATA frame per simulation step that produced any fx or loosed a projectile: the batch FxChannel builds
//          (the same class RaidRoom.handleEvents uses, so the roster, the launches and the short projEnds are counted),
//          packed by core's own `getMessageBytes.raw`, so the msgpack options and the type header cannot drift from what
//          core sends. `fxByKind` splits those bytes by kind (a tuple's share of the frame; "launch" is the projectiles).
//          The projectiles are not in the patches (they are not in the synced state at all), and the patches carry the
//          roster entries (a player or mob id the first time the tick sees it).
//   Every frame also pays the ws frame header (2 B under 126 B of payload, 4 B under 64 KiB). TCP/IP and TLS framing are
//   not counted: the budget is ws payload (the owner may want the wire number too; it adds about 52 B per frame).
// The initial full-state sync a joiner gets is reported but is not part of the rate.
//
// The "bots" scenario (`bots: 7`, docs/BOTS.md 9.2) seats 7 fill bots through the BotManager of a headless room
// (bots/tournament/headlessRoom.ts, the Room's own tick order) and drives the 8th seat like a client, which is the measured
// one. Every client receives the same bytes (no StateView), so the measured client is any of the eight. The bots play for
// themselves (they send inputs only, never `aim`, so they patch `facing` far less than clients do); a bot below half its hp is
// healed, as the driven players are, so the load stays level.
//
// The load is the worst case for bytes: players are driven like clients (aim every tick, the weapon policy `decide`
// against the nearest live mob, a strafe `move` every 600 ms) and never die; the 60 mobs are spread evenly over the
// camps (about 4.6 each), those of an occupied camp are woken every 3 s, and a dead mob is replaced at its camp so the
// load stays level for as long as the run lasts. Results are deterministic for a seed (nothing here reads the clock or
// Math.random).
import { getMessageBytes, Protocol } from "@colyseus/core";
import { Encoder } from "@colyseus/schema";
import {
  circleClear, decide, inArc, mulberry32, PLAYER_RADIUS, raycast, staggers, TICK_MS, TILE, TILE_FLOOR, tileToWorldCenter,
  WEAPONS, type FactionId, type FxBatch, type FxEvent, type MobCampDef, type Vec2,
} from "@raid/shared";
import { BOT_FILL_DEFAULTS, type TierId } from "../src/bots/brain/types";
import type { BotManagerStats } from "../src/bots/BotManager";
import { createHeadlessRoom, type HeadlessRoom } from "../src/bots/tournament/headlessRoom";
import { FxChannel } from "../src/rooms/FxChannel";
import { teleportToColiseum } from "../src/sim/arena";
import { activeWeapon, combatant, standingCombatants, timingsOf, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { aggro } from "../src/sim/mobAI";
import { placeMob } from "../src/sim/mobLife";
import { positionAt } from "../src/sim/movement";
import { addPlayer, step } from "../src/sim/step";
import { collisionMap, type MeleeRequest, type SimConfig, type World } from "../src/sim/world";

/** The gate: ws payload KiB per second, per client, with 8 players and 60 mobs. */
export const BANDWIDTH_BUDGET_KBPS = 20;

/**
 * `resolveMelee` (sim/melee.ts) is a stub until track A lands, so no swing or hit would ever be queued and the melee
 * mobs would cost almost nothing. While true, a stand-in follows the melee.ts contract (sampled positions, the arc, walls,
 * hits through the real ledger, a `swing` fx per landed swing) so those bytes are counted. It leaves out shields and
 * balls. Set this to false when resolveMelee is real; with it still on, the first swing fx the stand-in did not make
 * throws, so the numbers can never be counted twice by mistake.
 */
export const MELEE_STAND_IN = false;

/** The typical load: 4 camps occupied, two players at each. The heavy load: 8 camps, one player at each. */
export const TYPICAL_CAMPS = 4;
export const HEAVY_CAMPS = 8;
/** The bots scenario: fill bots among the 8 players (the rest are driven like clients), and the camps those clients fight at. */
export const BOTS_SCENARIO_BOTS = 7;
export const BOTS_SCENARIO_CAMPS = 1;

export interface BandwidthOptions {
  seed?: number;
  players?: number;
  /** How many of the `players` are fill bots seated by a BotManager (at most players - 1: one driven client stays). 0: all driven. */
  bots?: number;
  /** Fixes every bot's tier; absent: drawn from the fill config's mix. */
  botTier?: TierId;
  /** Mobs kept in the state: the map's own camp mobs, then more next to camp spots. 0 = none, and the sim runs with mobs off. */
  mobs?: number;
  /**
   * Camps the players stand at (spread over the regions, players spread evenly over them); every mob of those camps is
   * woken every 3 s. 0 = the coliseum endgame: the players are teleported in, the gates lock, they fight each other and
   * every mob rests at its camp, so none is ever awake (nothing outside the walls can be hit).
   */
  camps?: number;
  /** Ticks measured after the warm-up. At least 1200 (a minute) so the average does not ride on one fight. */
  ticks?: number;
  warmup?: number;
  /** Ms between a player's strafe moves. */
  strafeMs?: number;
  /** Called after every measured step, before the patch is encoded: for analysis scripts that look at what changed. */
  probe?: (world: World) => void;
  /** Called after every measured step with the size of that tick's patch frame (0 when nothing changed). */
  onPatch?: (bytes: number) => void;
  /** Called with every fx batch that is counted, and the bytes it cost (message and ws header). */
  onBatch?: (batch: FxBatch, bytes: number) => void;
}

export interface BandwidthResult {
  /** Game seconds measured. */
  seconds: number;
  /** KiB (1024 B) per second one client receives: state patches, fx messages, and both together. */
  patchKBps: number;
  fxKBps: number;
  totalKBps: number;
  patchFramesPerSecond: number;
  /** `fxs` messages per second: one per step that had any fx or loosed a projectile. */
  fxFramesPerSecond: number;
  /** Mean over the measured ticks: mobs fighting, mobs awake (fighting or walking home), arrows and balls in flight. */
  avgFighting: number;
  avgAwake: number;
  avgProjectiles: number;
  /** Mobs in the state at the end. */
  mobs: number;
  /** The first full-state sync a joiner gets (protocol byte and ws header included). Not part of the rates. */
  initialSyncBytes: number;
  /** Set when the run had fill bots: what the manager did over the whole run, and how many bots were still standing. */
  bots?: { count: number; aliveAtEnd: number; manager: BotManagerStats };
  /** fx bytes by kind, for finding what to shrink: each tuple's share of its frame; "launch" are the projectiles. "(batch)" is what is left: ws header, message type, `t`. */
  fxByKind: Record<string, { frames: number; bytes: number }>;
}

const KIB = 1024;

/** Server-to-client ws frame header: no mask, so 2 B up to 125 B of payload, 4 B up to 64 KiB, else 10 B. */
const wsHeader = (payload: number): number => (payload < 126 ? 2 : payload < 65536 ? 4 : 10);

// Same shape as a Colyseus session id: 9 characters, which is what the key length of every map entry costs on the wire.
const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function sessionId(rnd: () => number): string {
  let s = "";
  for (let i = 0; i < 9; i++) s += ID_CHARS[Math.floor(rnd() * ID_CHARS.length)];
  return s;
}

function config(players: number, mobs: boolean): SimConfig {
  // Nothing ends the run while we measure: no patience teleport, no sudden death.
  return {
    minPlayers: players, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 1e6, patienceMinSeconds: 1e6,
    suddenDeathSeconds: 1e6, mobs,
  };
}

interface Camp { region: FactionId; camp: MobCampDef }

function allCamps(world: World): Camp[] {
  return world.map.regions.flatMap((r) => r.mobCamps.map((camp) => ({ region: r.id as FactionId, camp })));
}

function freeFloorNear(world: World, at: Vec2, rMin: number, rMax: number, rnd: () => number): Vec2 | null {
  const map = world.map;
  for (let tries = 0; tries < 400; tries++) {
    const a = rnd() * Math.PI * 2;
    const r = rMin + rnd() * (rMax - rMin);
    const tx = Math.floor((at.x + Math.cos(a) * r) / TILE);
    const ty = Math.floor((at.y + Math.sin(a) * r) / TILE);
    if (tx < 1 || ty < 1 || tx >= map.w - 1 || ty >= map.h - 1 || map.tiles[ty * map.w + tx] !== TILE_FLOOR) continue;
    const p = { x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) };
    if (circleClear(map, p, PLAYER_RADIUS)) return p;
  }
  return null;
}

interface Driver {
  /** The players driven like clients. */
  ids: string[];
  /** Fill bots: healed like the driven players, otherwise left to themselves. */
  botIds: string[];
  camps: Camp[];
  /** Player id -> the index in `camps` it stands at. Empty when nobody is near a camp. */
  campOf: Map<string, number>;
  strafeAt: Map<string, number>;
  /** The players' dice (strafe directions). */
  rnd: () => number;
  /** Where mobs go: a stream of its own, so the players behave the same whatever number of mobs there are. */
  placeRnd: () => number;
  cursor: number;
  ticks: number;
}

/**
 * Adds mobs next to camp spots until there are `target`, each to the camp holding the fewest (the first camp in map order
 * on a tie). The map's own camps hold about 38 mobs, so the other 22 make every camp about 4.6 strong, whichever camps the
 * players stand at, and a camp that lost a mob is refilled at once: the load does not drain away as the run goes on.
 */
function topUp(world: World, d: Driver, target: number): void {
  if (world.mobs.size >= target || d.camps.length === 0) return;
  const count = d.camps.map(() => 0);
  for (const rt of world.mobs.values()) {
    if (!rt.brain) continue;
    const home = rt.brain.home;
    let best = 0;
    let bestD = Infinity;
    d.camps.forEach(({ camp }, i) => {
      const dd = Math.hypot(home.x - camp.x, home.y - camp.y);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    count[best]!++;
  }
  while (world.mobs.size < target) {
    let ci = 0;
    count.forEach((n, i) => {
      if (n < count[ci]!) ci = i;
    });
    count[ci]!++;
    const { region, camp } = d.camps[ci]!;
    const spot = camp.spots[d.cursor++ % camp.spots.length]!;
    placeMob(world, {
      region, elite: false, at: freeFloorNear(world, spot, 12, 24, d.placeRnd) ?? spot, facing: Math.atan2(camp.y - spot.y, camp.x - spot.x),
    });
  }
}

/** One decision of the weapon policy for `c` against `target`, the way the bots and the mob AI take it. */
function policyFor(world: World, c: Combatant, target: Combatant) {
  const now = world.state.serverTime;
  const weapon = activeWeapon(c.s);
  if (!weapon) return null;
  const tm = timingsOf(c.s, weapon);
  const tpos = { x: target.s.x, y: target.s.y };
  const before = positionAt(target.rt, target.s, now - 100);
  const vel = { x: (tpos.x - before.x) * 10, y: (tpos.y - before.y) * 10 };
  const los = !raycast(collisionMap(world), c.s.x, c.s.y, tpos.x, tpos.y).hit;
  return decide({
    self: { x: c.s.x, y: c.s.y }, target: tpos, targetVel: vel, los, weapon, ready: now >= c.s.readyAt, windup: tm?.windup ?? 0,
  });
}

/** The live mob nearest to a player standing at a camp; the live player nearest to one that is not. */
function nearestTarget(world: World, d: Driver, pid: string): Combatant | null {
  const p = world.state.players.get(pid)!;
  let bestId: string | null = null;
  let bestD = Infinity;
  const consider = (id: string, o: { x: number; y: number; status: string }): void => {
    if (o.status !== "alive") return;
    const dd = Math.hypot(o.x - p.x, o.y - p.y);
    if (dd < bestD) {
      bestD = dd;
      bestId = id;
    }
  };
  if (d.campOf.has(pid)) for (const [mid, m] of world.state.mobs) consider(mid, m);
  else for (const [oid, o] of world.state.players) if (oid !== pid) consider(oid, o);
  return bestId === null ? null : combatant(world, bestId);
}

/** What the clients would have sent since the last tick, plus the bench's own heal and wake-ups. */
function drivePlayers(world: World, d: Driver, mobsWanted: number, strafeMs: number): void {
  const now = world.state.serverTime;
  d.ticks++;
  if (mobsWanted > 0 && world.mobs.size < mobsWanted) topUp(world, d, mobsWanted);
  for (const bid of d.botIds) {
    const b = world.state.players.get(bid);
    if (b && b.status === "alive" && b.hp < b.maxHp * 0.5) b.hp = b.maxHp;
  }
  for (const pid of d.ids) {
    const c = combatant(world, pid);
    if (!c || c.s.status !== "alive") continue;
    // Nobody dies: the bench is about bytes, not about who wins.
    if (c.s.hp < c.s.maxHp * 0.5) c.s.hp = c.s.maxHp;
    const target = nearestTarget(world, d, pid);
    if (!target) continue;
    const q = c.rt.inputs;
    const out = policyFor(world, c, target);
    if (!out) continue;
    // Clients stream their aim every tick (at most), and press and release when the policy flips.
    q.pushAim(out.aim);
    const held = c.rt.weapon.held;
    if (out.hold && !held) q.pushAction({ kind: "attack", a: out.aim, t: now - 100 });
    else if (!out.hold && held) q.pushAction({ kind: "release", a: out.aim, t: now - 100 });
    // Always on the move around the target: the worst case for the patch.
    if (now >= (d.strafeAt.get(pid) ?? 0)) {
      d.strafeAt.set(pid, now + strafeMs);
      const a = d.rnd() * Math.PI * 2;
      const r = 70 + d.rnd() * 90;
      q.pushMove({ kind: "move", x: target.s.x + Math.cos(a) * r, y: target.s.y + Math.sin(a) * r });
    }
  }
  // Every 3 s the mobs of each occupied camp turn on the player standing there (a mob already fighting just gains threat).
  if (d.ticks % 60 === 1) {
    for (const [pid, ci] of d.campOf) {
      const camp = d.camps[ci]!.camp;
      for (const [mid, m] of world.state.mobs) {
        const rt = world.mobs.get(mid);
        if (m.status !== "alive" || !rt?.brain) continue;
        if (Math.hypot(rt.brain.home.x - camp.x, rt.brain.home.y - camp.y) > camp.r + 24) continue;
        aggro(world, { kind: "mob", id: mid, s: m, rt }, pid, 1);
      }
    }
  }
}

/**
 * Stands in for the melee phase while sim/melee.ts is a stub: the swings whose windup ended this tick (captured as
 * resolveMelee drops them) are resolved as the contract says and recorded in the real ledger, which is then applied.
 * Runs as the first system, so it lands one stage after the projectile hits of its tick; the bytes do not care.
 */
function installMeleeStandIn(world: World): void {
  const captured: MeleeRequest[][] = [];
  let current: MeleeRequest[] = [];
  Object.defineProperty(world.combat, "melee", {
    get: () => current,
    set: (v: MeleeRequest[]) => {
      if (current.length > 0) captured.push(current);
      current = v;
    },
    configurable: true,
    enumerable: true,
  });
  const ours = new WeakSet<object>();
  world.systems.unshift((w) => {
    const lists = captured.splice(0);
    if (lists.length === 0) return;
    const bodies = standingCombatants(w);
    const map = collisionMap(w);
    for (const list of lists) {
      for (const req of list) {
        const att = combatant(w, req.attacker);
        const shape = WEAPONS[req.weapon].shape;
        if (!att || shape.kind !== "arc") continue;
        const origin = positionAt(att.rt, att.s, req.rewindT);
        for (const b of bodies) {
          if (b.id === att.id || b.s.status !== "alive") continue;
          const p = positionAt(b.rt, b.s, req.rewindT);
          if (!inArc(origin, req.a, shape.reach, shape.halfArc, p, PLAYER_RADIUS)) continue;
          if (raycast(map, origin.x, origin.y, p.x, p.y).hit) continue;
          recordHit(w, {
            victim: b.id, by: { id: att.id, name: att.s.name }, packet: req.packet, weapon: req.weapon,
            stagger: staggers({ melee: req.weapon }),
          });
        }
        const fx = { kind: "swing" as const, by: att.id, weapon: req.weapon, x: origin.x, y: origin.y, a: req.a };
        ours.add(fx);
        w.events.push({ type: "fx", fx });
      }
    }
    applyLedger(w);
  });
  world.systems.push((w) => {
    for (const e of w.events) {
      if (e.type === "fx" && e.fx.kind === "swing" && !ours.has(e.fx)) {
        throw new Error("resolveMelee now emits swings: set MELEE_STAND_IN to false in bench/bandwidth.ts");
      }
    }
  });
}

export function runBandwidth(opts: BandwidthOptions = {}): BandwidthResult {
  const seed = opts.seed ?? 1;
  const playerCount = opts.players ?? 8;
  const botCount = Math.min(playerCount - 1, Math.max(0, Math.floor(opts.bots ?? 0)));
  const mobsWanted = opts.mobs ?? 60;
  const camps = opts.camps ?? TYPICAL_CAMPS;
  const ticks = opts.ticks ?? 1200;
  const warmup = opts.warmup ?? 200;
  const strafeMs = opts.strafeMs ?? 600;

  let uid = 0;
  // With fill bots the world is a headless room's (the Room's tick order, the manager's delay lines); otherwise the bare sim.
  let room: HeadlessRoom | null = null;
  let world: World;
  if (botCount > 0) {
    room = createHeadlessRoom({
      seed, config: config(playerCount, mobsWanted > 0), bots: { ...BOT_FILL_DEFAULTS, fillTo: playerCount },
    });
    world = room.world;
  } else {
    world = createGameWorld({
      seed, config: config(playerCount, mobsWanted > 0), random: mulberry32(seed + 1), newItemUid: () => `L${++uid}`,
    });
  }
  // What the room's SchemaSerializer does in `reset(state)`, before anyone joins.
  const encoder = new Encoder(world.state);

  const rnd = mulberry32(seed * 7 + 3);
  const ids: string[] = [];
  const botIds: string[] = [];
  for (let i = 0; i < playerCount - botCount; i++) {
    const id = sessionId(rnd);
    ids.push(id);
    addPlayer(world, id, `Player${i + 1}x`);
  }
  // The bots take the seats the clients left, and the raid starts with the next tick (a full lobby does not wait).
  for (let i = 0; i < botCount; i++) {
    const spec = room!.manager.addBot(opts.botTier ? { tier: opts.botTier } : {});
    if (spec === null) throw new Error("the bandwidth lobby has no seat for a bot");
    botIds.push(spec.id);
  }
  if (room) room.tick();
  else step(world, TICK_MS);
  if (world.state.phase !== "active") throw new Error("the bandwidth run did not start");

  const driver: Driver = {
    ids, botIds, camps: allCamps(world), campOf: new Map(), strafeAt: new Map(), rnd,
    placeRnd: mulberry32(seed * 13 + 5), cursor: 0, ticks: 0,
  };
  if (camps > 0 && mobsWanted > 0) {
    // The occupied camps: the first camp of each region in turn (so the fights are spread over the map), then the regions' second camps...
    const byRegion = new Map<string, number[]>();
    driver.camps.forEach((c, i) => {
      if (!byRegion.has(c.region)) byRegion.set(c.region, []);
      byRegion.get(c.region)!.push(i);
    });
    const order: number[] = [];
    for (let round = 0; order.length < driver.camps.length; round++) {
      let any = false;
      for (const list of byRegion.values()) {
        if (list[round] !== undefined) {
          order.push(list[round]!);
          any = true;
        }
      }
      if (!any) break;
    }
    const used = order.slice(0, camps);
    topUp(world, driver, mobsWanted);
    ids.forEach((pid, i) => {
      const ci = used[i % used.length]!;
      driver.campOf.set(pid, ci);
      const camp = driver.camps[ci]!.camp;
      // A little way out from the camp, so the mobs are in reach when they wake.
      const at = freeFloorNear(world, camp, camp.r + 1.5 * TILE, camp.r + 3 * TILE, driver.placeRnd) ?? { x: camp.x - 70, y: camp.y };
      const p = world.state.players.get(pid)!;
      p.x = at.x;
      p.y = at.y;
      world.players.get(pid)!.history = [{ t: world.state.serverTime, x: p.x, y: p.y }];
    });
  } else {
    topUp(world, driver, mobsWanted);
    if (camps === 0) teleportToColiseum(world);
  }
  if (MELEE_STAND_IN) installMeleeStandIn(world);

  // A joiner's first sync (core's getFullState), then forget everything done so far: from here on the encoder is
  // measured one patch per tick.
  encoder.sharedBuffer[0] = Protocol.ROOM_STATE;
  const full = encoder.encodeAll({ offset: 1 });
  const initialSyncBytes = full.length + wsHeader(full.length);
  encoder.discardChanges();

  let patchBytes = 0;
  let patchFrames = 0;
  let fxBytes = 0;
  let fxFrames = 0;
  let fighting = 0;
  let awake = 0;
  let projectiles = 0;
  const fxByKind: Record<string, { frames: number; bytes: number }> = {};
  const channel = room ? room.channel : new FxChannel();

  for (let n = 0; n < warmup + ticks; n++) {
    drivePlayers(world, driver, mobsWanted, strafeMs);
    const events = room ? room.tick() : step(world, TICK_MS);
    const measuring = n >= warmup;

    // RaidRoom.handleEvents broadcasts the step's fx (and the projectiles it loosed) as one message, then broadcastPatch()
    // sends the patch. The channel runs for every step, measured or not: it remembers which projectiles it announced.
    // (A headless room's tick has done the batch, the roster and the bots' frames already, in that order.)
    const fxs: FxEvent[] = [];
    for (const ev of events) if (ev.type === "fx") fxs.push(ev.fx);
    const batch = room ? room.lastBatch : channel.batch(fxs, world.state.serverTime, world.projectiles);
    if (measuring && batch) {
      const frame = getMessageBytes.raw(Protocol.ROOM_DATA, "fxs", batch);
      const bytes = frame.length + wsHeader(frame.length);
      opts.onBatch?.(batch, bytes);
      fxBytes += bytes;
      fxFrames++;
      // Each tuple's own share: the frame with only it, minus the frame with nothing.
      const empty = getMessageBytes.raw(Protocol.ROOM_DATA, "fxs", { t: batch.t, l: [] }).length;
      let attributed = 0;
      const share = (tuple: FxBatch["l"][number], kind: string): void => {
        const own = getMessageBytes.raw(Protocol.ROOM_DATA, "fxs", { t: batch.t, l: [tuple] }).length - empty;
        const k = (fxByKind[kind] ??= { frames: 0, bytes: 0 });
        k.frames++;
        k.bytes += own;
        attributed += own;
      };
      batch.l.forEach((tuple, i) => share(tuple, fxs[i]!.kind));
      for (const tuple of batch.p ?? []) share(tuple, "launch");
      // The framing (ws header, message type, `t`, the keys) is what is left.
      const rest = (fxByKind["(batch)"] ??= { frames: 0, bytes: 0 });
      rest.frames++;
      rest.bytes += bytes - attributed;
    }
    if (measuring) opts.probe?.(world);
    if (!room) channel.extendRoster(world.state);
    if (encoder.hasChanges) {
      encoder.sharedBuffer[0] = Protocol.ROOM_STATE_PATCH;
      const frame = encoder.encode({ offset: 1 });
      if (measuring) {
        patchBytes += frame.length + wsHeader(frame.length);
        patchFrames++;
        opts.onPatch?.(frame.length + wsHeader(frame.length));
      }
    } else if (measuring) opts.onPatch?.(0);
    encoder.discardChanges();
    if (!room) channel.rosterSent();

    if (!measuring) continue;
    projectiles += world.projectiles.size;
    for (const [id, m] of world.mobs) {
      if (world.state.mobs.get(id)?.status !== "alive" || !m.brain) continue;
      if (m.brain.mode === "fight") fighting++;
      if (m.brain.mode !== "idle") awake++;
    }
  }

  const seconds = (ticks * TICK_MS) / 1000;
  const kbps = (bytes: number): number => bytes / seconds / KIB;
  return {
    seconds,
    patchKBps: kbps(patchBytes),
    fxKBps: kbps(fxBytes),
    totalKBps: kbps(patchBytes + fxBytes),
    patchFramesPerSecond: patchFrames / seconds,
    fxFramesPerSecond: fxFrames / seconds,
    avgFighting: fighting / ticks,
    avgAwake: awake / ticks,
    avgProjectiles: projectiles / ticks,
    mobs: world.mobs.size,
    initialSyncBytes,
    fxByKind,
    ...(room
      ? {
        bots: {
          count: botCount,
          aliveAtEnd: botIds.filter((id) => world.state.players.get(id)?.status === "alive").length,
          manager: { ...room.manager.stats },
        },
      }
      : {}),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split("=")) as Array<[string, string]>);
  const common: BandwidthOptions = {};
  if (args.seed !== undefined) common.seed = Number(args.seed);
  if (args.ticks !== undefined) common.ticks = Number(args.ticks);
  const f = (n: number): string => n.toFixed(2);
  const show = (label: string, o: BandwidthOptions): void => {
    const r = runBandwidth({ ...common, ...o });
    console.log(
      `${label}: ${r.mobs} mobs, ${r.avgFighting.toFixed(1)} fighting, ${r.avgProjectiles.toFixed(1)} projectiles in flight\n` +
      `  total ${f(r.totalKBps)} KB/s = patch ${f(r.patchKBps)} (${r.patchFramesPerSecond.toFixed(0)} frames/s)` +
      ` + fx ${f(r.fxKBps)} (${r.fxFramesPerSecond.toFixed(0)} frames/s)   joiner's first sync ${(r.initialSyncBytes / KIB).toFixed(1)} KB`,
    );
    if (r.bots) {
      const m = r.bots.manager;
      console.log(`  ${r.bots.count} fill bots (${r.bots.aliveAtEnd} alive at the end): ${m.frames} frames, ${m.sent} commands sent, ${m.refused} refused, ${m.errors} errors`);
    }
    const top = Object.entries(r.fxByKind).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 5);
    console.log(`  fx by kind: ${top.map(([k, v]) => `${k} ${f(v.bytes / r.seconds / KIB)} KB/s (${(v.frames / r.seconds).toFixed(1)}/s)`).join(", ")}`);
  };
  console.log(`per client, ws payload (gate: under ${BANDWIDTH_BUDGET_KBPS} KB/s)`);
  show(`typical (${TYPICAL_CAMPS} camps, 2 players each)`, { camps: TYPICAL_CAMPS });
  show(`heavy   (${HEAVY_CAMPS} camps, 1 player each)`, { camps: HEAVY_CAMPS });
  show("idle    (60 mobs, none awake)", { camps: 0 });
  show("no mobs (players only)", { camps: 0, mobs: 0 });
  show(`bots    (${BOTS_SCENARIO_BOTS} fill bots + 1 client at ${BOTS_SCENARIO_CAMPS} camp)`, { bots: BOTS_SCENARIO_BOTS, camps: BOTS_SCENARIO_CAMPS });
}
