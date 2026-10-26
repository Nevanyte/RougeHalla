// Run lifecycle + the fixed-step update. `step()` is the only entry point the Room ticks; arena.ts decides
// how a run ends.
import {
  AIM_STALE_MS, defaultFaction, FACTIONS, MAX_PLAYERS, mulberry32, SIGNATURE_WEAPONS, type FactionId, type Vec2,
} from "@raid/shared";
import { PlayerState } from "@raid/shared/schema";
import { beginRun, downPlayer, markTickStart, settle, suddenDeath, unbankedGv } from "./arena";
import { combatant, standingCombatants, type Combatant } from "./combatant";
import { InputQueue } from "./inputs";
import { applyLedger } from "./ledger";
import { resolveMelee } from "./melee";
import { advanceAlongPath, planPath, recordHistory } from "./movement";
import { clearProjectiles, spawnProjectiles, sweepProjectiles } from "./projectiles";
import { updateTargets } from "./targeting";
import { trainingSettle } from "./training";
import { dropLock, moveMultiplierOf, resetWeapons, setAim, updateWeapons } from "./weapons";
import { emit, newWeaponRuntime, type SimEvent, type World } from "./world";

/**
 * Joins the lobby with a faction (`faction`, picked in the hub; else a round-robin default over join order), its hp, and
 * its signature weapon in the first slot. Nothing else is brought in from outside the run except `look`, the packed
 * cosmetics word (cosmetics.ts) the Room worked out from the profile: it is shown to everyone and changes nothing else.
 */
export function addPlayer(
  world: World, id: string, profile: string, opts: { faction?: FactionId | null; look?: number } = {},
): PlayerState {
  const s = world.state;
  const p = new PlayerState();
  const joinIndex = world.joined++;
  const faction = opts.faction ?? defaultFaction(joinIndex);
  p.name = profile;
  p.look = (opts.look ?? 0) >>> 0;
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

/**
 * One fighter's queued inputs, in the order they arrived: the move (where it arrived among the actions), the aim (the same)
 * and the actions. A move or a stop ends the target lock, whether or not the point can be reached: the order was given.
 */
function applyInputs(world: World, c: Combatant): void {
  const { move, moveBefore, aim, aimBefore, actions } = c.rt.inputs.drain();
  const applyMove = (): void => {
    if (move === null) return;
    dropLock(c);
    // An unreachable click is ignored rather than treated as "stop".
    const path = move.kind === "move" ? planPath(world, c.s, move) : [];
    if (move.kind === "stop" || path.length > 0) c.rt.path = path;
  };
  // The cursor's aim is ignored while a lock aims the fighter (sim/targeting.ts); the next aim after the lock ends counts.
  const applyAim = (): void => {
    if (aim !== null && c.rt.weapon.lock === null) setAim(world, c, aim);
  };
  // An input applies just before actions[i] for the i it arrived at, so an attack's own angle never overrides an aim sent
  // after it, and a target and a move replace each other in arrival order. With both at one spot the move goes first.
  for (let i = 0; i <= actions.length; i++) {
    if (c.s.status !== "alive") return;
    if (i === Math.min(moveBefore, actions.length)) applyMove();
    if (i === Math.min(aimBefore, actions.length)) applyAim();
    const cmd = actions[i];
    if (cmd) world.actions[cmd.kind]?.(world, c, cmd);
  }
}

/**
 * One active tick, in this order (see arena.ts for why the order matters):
 *   inputs (players in the shuffled actionOrder, then mobs) → target locks (the chase, the trigger and the aim of every
 *   locked player) → weapon state machines → afterWeapons → movement → history → projectile sweep (present time) →
 *   spawns → melee (rewound) → beforeDamage (signature damage joins the ledger) → sudden death's burn joins it → the
 *   damage ledger, all at once → systems → settle.
 * Damage lands only in the ledger step, so a fighter killed this tick still lands what it started, and simultaneous
 * deaths are settled by the hp fraction at the start of the tick. The burn is in that pass, so what a kill wins (paid
 * after the pass) never decides who survives it.
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
  world.combat.landed = [];
  const order = actionOrder(world);
  world.combat.rank = new Map(order.map((id, i) => [id, i]));
  for (const id of order) applyInputs(world, combatant(world, id)!);
  for (const id of world.mobs.keys()) applyInputs(world, combatant(world, id)!);
  updateTargets(world);
  updateWeapons(world);
  for (const sys of world.afterWeapons) sys(world, dtMs);
  const fighters = standingCombatants(world);
  // Every multiplier is read before anyone moves, so none depends on who moved first (the chill reads distances).
  const mults = fighters.map((c) => world.moveModifiers.reduce((m, mod) => m * mod(world, c), moveMultiplierOf(world, c)));
  fighters.forEach((c, i) => {
    const w = c.rt.weapon;
    const aiming = w.aimAt > 0 && now - w.aimAt < AIM_STALE_MS;
    advanceAlongPath(c.s, c.rt, dt, aiming, mults[i]!);
  });
  // Record after everyone has moved so hit tests see one consistent tick.
  for (const c of fighters) recordHistory(c.rt, c.s, now);
  sweepProjectiles(world, dtMs);
  spawnProjectiles(world);
  resolveMelee(world);
  for (const sys of world.beforeDamage) sys(world, dtMs);
  // After the signatures, which read the ledger for this tick's contacts: the burn is no one's hit.
  if (!world.config.training) suddenDeath(world, dtMs);
  applyLedger(world);
  for (const sys of world.systems) sys(world, dtMs);
  if (world.config.training) trainingSettle(world);
  else settle(world);
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
