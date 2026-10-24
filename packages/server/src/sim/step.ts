// Run lifecycle + the fixed-step update. `step()` is the only entry point the Room ticks; arena.ts decides
// how a run ends.
import { AIM_STALE_MS, defaultFaction, FACTIONS, MAX_PLAYERS, mulberry32, SIGNATURE_WEAPONS, type Vec2 } from "@raid/shared";
import { PlayerState } from "@raid/shared/schema";
import { beginRun, downPlayer, markTickStart, settle, suddenDeath, unbankedGv } from "./arena";
import { combatant, standingCombatants, type Combatant } from "./combatant";
import { InputQueue } from "./inputs";
import { applyLedger } from "./ledger";
import { resolveMelee } from "./melee";
import { advanceAlongPath, planPath, recordHistory } from "./movement";
import { clearProjectiles, spawnProjectiles, sweepProjectiles } from "./projectiles";
import { moveMultiplierOf, resetWeapons, setAim, updateWeapons } from "./weapons";
import { emit, newWeaponRuntime, type SimEvent, type World } from "./world";

/**
 * Joins the lobby with a faction (a server default until the Phase 10 picker: round-robin over join order), its hp,
 * and its signature weapon in the first slot. Nothing is brought in from outside the run except `look`, the packed
 * cosmetics word (cosmetics.ts) the Room worked out from the profile: it is shown to everyone and changes nothing else.
 */
export function addPlayer(world: World, id: string, profile: string, look = 0): PlayerState {
  const s = world.state;
  const p = new PlayerState();
  const faction = defaultFaction(world.joined++);
  p.name = profile;
  p.look = look >>> 0;
  p.faction = faction;
  p.hp = FACTIONS[faction].hp;
  p.maxHp = FACTIONS[faction].hp;
  p.status = "lobby";
  p.weapon0 = SIGNATURE_WEAPONS[faction];
  p.weapon1 = "";
  p.slot = 0;
  const spot = lobbySpot(world, s.players.size);
  p.x = spot.x;
  p.y = spot.y;
  if (s.players.size === 0 && s.phase === "lobby") {
    s.lobbyEndsAt = s.serverTime + world.config.lobbySeconds * 1000;
  }
  s.players.set(id, p);
  world.players.set(id, {
    id,
    profile,
    inputs: new InputQueue(),
    path: [],
    history: [],
    weapon: newWeaponRuntime(),
    killedBy: null,
    gv: { kills: 0, mobs: 0, bounty: 0 },
    mobKills: 0,
    lastHit: null,
    damaged: new Set(),
    droppedAt: null,
    hpFracAtTickStart: 1,
    down: null,
    resolved: false,
  });
  return p;
}

/** Lobby placement only; real spawns are assigned (shuffled, distinct) when the raid starts. */
function lobbySpot(world: World, index: number): Vec2 {
  const spawns = world.map.spawns;
  // A hand-built map may have no spawns at all.
  return spawns.length > 0 ? spawns[index % spawns.length]! : world.map.coliseum.centre;
}

function shuffledSpawns(world: World): Vec2[] {
  const out = world.map.spawns.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(world.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Removes a player whose client is gone for good. Leaving an active run counts as a death (MIA): their result
 * goes out at once and the next tick treats it like any other death.
 */
export function removePlayer(world: World, id: string): void {
  const p = world.state.players.get(id);
  const rt = world.players.get(id);
  if (p && rt && world.state.phase === "active") downPlayer(world, p, rt, "mia");
  world.state.players.delete(id);
  world.players.delete(id);
}

/**
 * Removes a player without resolving them: no result, no MIA, no body, no death. For a server shutdown, where the
 * run is void: from then on the run is frozen, so a tick between two abandons can't hand the rest a win (or a
 * death) in a run that no longer counts. Returns the GV they had earned and not yet banked, which the Room still pays.
 */
export function abandonPlayer(world: World, id: string): number {
  const rt = world.players.get(id);
  const gv = rt ? unbankedGv(rt) : 0;
  if (rt) rt.resolved = true;
  if (world.state.phase === "active") world.arena.voided = true;
  world.state.players.delete(id);
  world.players.delete(id);
  return gv;
}

export function startRaid(world: World): void {
  const s = world.state;
  s.phase = "active";
  s.raidStartedAt = s.serverTime;
  const spawns = shuffledSpawns(world);
  let i = 0;
  for (const [id, p] of s.players) {
    // No spawns (a hand-built map): players start where the lobby put them.
    const spot = spawns.length > 0 ? spawns[i++ % spawns.length]! : p;
    p.x = spot.x;
    p.y = spot.y;
    p.status = "alive";
    const rt = world.players.get(id)!;
    rt.inputs.drain();
    rt.history = [{ t: s.serverTime, x: p.x, y: p.y }];
    resetWeapons({ kind: "player", id, s: p, rt });
  }
  beginRun(world);
  world.hooks.raidStarted?.(world);
  emit(world, { type: "raidStarted" });
}

function updateLobby(world: World): void {
  const s = world.state;
  for (const rt of world.players.values()) rt.inputs.drain();
  const n = s.players.size;
  if (n === 0) return;
  if (n >= world.config.minPlayers) {
    s.lobbyEndsAt = Math.min(s.lobbyEndsAt, s.serverTime + world.config.fillSeconds * 1000);
  }
  if (n >= MAX_PLAYERS || s.serverTime >= s.lobbyEndsAt) startRaid(world);
}

/**
 * Order in which players' inputs are applied on `tick`: a shuffle keyed by a server-secret salt
 * and the tick. With a fixed (or merely rotated) order, earlier joiners would win most same-tick
 * races for an item; this is fair for any subset of contenders and unpredictable to clients.
 */
export function actionOrder(world: World, tick = world.state.tick): string[] {
  const ids = [...world.state.players.keys()];
  const rng = mulberry32((world.orderSalt ^ Math.imul(tick, 0x9e3779b1)) >>> 0);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

/** One fighter's queued inputs: its path, then its aim and actions in the order they arrived. */
function applyInputs(world: World, c: Combatant): void {
  const { move, aim, aimBefore, actions } = c.rt.inputs.drain();
  if (c.s.status !== "alive") return;
  if (move) {
    // An unreachable click is ignored rather than treated as "stop".
    const path = move.kind === "move" ? planPath(world, c.s, move) : [];
    if (move.kind === "stop" || path.length > 0) c.rt.path = path;
  }
  // The latest aim goes in where it arrived, so an attack's own angle never overrides an aim sent after it.
  actions.forEach((cmd, i) => {
    if (c.s.status !== "alive") return;
    if (aim !== null && i === aimBefore) setAim(world, c, aim);
    world.actions[cmd.kind]?.(world, c, cmd);
  });
  if (aim !== null && aimBefore >= actions.length && c.s.status === "alive") setAim(world, c, aim);
}

/**
 * One active tick, in this order (see arena.ts for why the order matters):
 *   inputs (players in the shuffled actionOrder, then mobs) → weapon state machines → movement → history →
 *   projectile sweep (present time) → spawns → melee (rewound) → the damage ledger, all at once → systems →
 *   sudden death → settle.
 * Damage lands only in the ledger step, so a fighter killed this tick still lands what it started, and simultaneous
 * deaths are settled by the hp fraction at the start of the tick.
 */
function updateActive(world: World, dtMs: number): void {
  if (world.arena.voided) return;
  const s = world.state;
  const now = s.serverTime;
  const dt = dtMs / 1000;
  markTickStart(world);
  world.combat.ledger = [];
  world.combat.melee = [];
  world.combat.spawns = [];
  const order = actionOrder(world);
  world.combat.rank = new Map(order.map((id, i) => [id, i]));
  for (const id of order) applyInputs(world, combatant(world, id)!);
  for (const id of world.mobs.keys()) applyInputs(world, combatant(world, id)!);
  updateWeapons(world);
  const fighters = standingCombatants(world);
  for (const c of fighters) {
    const w = c.rt.weapon;
    const aiming = w.aimAt > 0 && now - w.aimAt < AIM_STALE_MS;
    advanceAlongPath(c.s, c.rt, dt, aiming, moveMultiplierOf(world, c));
  }
  // Record after everyone has moved so hit tests see one consistent tick.
  for (const c of fighters) recordHistory(c.rt, c.s, now);
  sweepProjectiles(world, dtMs);
  spawnProjectiles(world);
  resolveMelee(world);
  applyLedger(world);
  for (const sys of world.systems) sys(world, dtMs);
  suddenDeath(world, dtMs);
  settle(world);
  // Nothing flies once the run is over: clients would otherwise draw what's left to its full range, through walls.
  if (s.phase === "ended") clearProjectiles(world, "cleared");
}

/** Advances the world by one fixed step and returns the events it produced. */
export function step(world: World, dtMs: number): SimEvent[] {
  const s = world.state;
  s.serverTime += dtMs;
  s.tick++;
  world.stepping = true;
  try {
    if (s.phase === "lobby") updateLobby(world);
    else if (s.phase === "active") updateActive(world, dtMs);
  } finally {
    world.stepping = false;
  }
  const out = world.events;
  world.events = [];
  return out;
}
