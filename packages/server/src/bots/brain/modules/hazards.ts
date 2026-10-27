// The hazards module (docs/BOTS.md 8, roguelike R2's zone terrain): the bot reads the ground under its feet as a person reads the
// floor art. Embers burn (2% of max hp a second, true damage; Fire is at home), bog slows (Plague is at home), ice slides (Frost is
// at home), and light heals (Holy twice as much). The server walks every path by plain A*, so a route still crosses a field; what
// the bot decides is where it stands and where it asks to go:
//   - a reflex: standing still on ground that burns it, with nothing locked, it steps to the nearest ground that does not, at most
//     once per STEP_EVERY_MS (a walk already under way is left to finish: it may be crossing the field, and turning round in the
//     middle of one is worse);
//   - a destination on bad ground (a retreat point, a roam target, a hold spot) is moved onto the nearest good ground within
//     REDIRECT_TILES, when it is a walk worth planning (a dodge or a juke is a reaction, never detoured);
//   - a hurt bot lying low looks for light within LIGHT_TILES and waits there.
// It reads the tile under a fighter's centre through the shared `surfaceAt`, the very table the sim burns and slows by. Terrain
// is part of the map every client holds (seed-derived), so nothing here reads anything a human could not see.
import { circleClear, PLAYER_RADIUS, surfaceAt, TERRAIN_LIGHT, terrainAt, TILE, tileToWorldCenter, worldToTile, type GameMap, type Vec2 } from "@raid/shared";
import { PRIORITY, type BrainContext, type FeatureModule, type Goal, type Intent, type ServerMs } from "../types";

/** The module's numbers (ms and u; tiles where it says so). */
export const HAZARD_RULES = {
  /** A new step off burning ground goes out at most this often. */
  stepEveryMs: 600,
  /** The bot must have stood this long (ms) before the step: moving, it is walking somewhere. */
  stillMs: 250,
  /** The step searches this many tiles round the bot for ground that does not burn. */
  stepTiles: 6,
  /** A step or a walk to the light is kept (the same order offered again) this long, or until the bot is within `arriveU`. */
  holdMs: 1500,
  arriveU: 20,
  /** A walk's destination on bad ground is moved onto good ground within this many tiles... */
  redirectTiles: 3,
  /** ...when the walk is at least this long (u): a dodge, a juke or an orb-walk step is shorter. */
  redirectMinU: 4 * TILE,
  /** A hurt bot lying low looks for light this many tiles round. */
  lightTiles: 8,
} as const;

interface Step {
  readonly to: Vec2;
  readonly at: ServerMs;
  readonly why: string;
}

/** What the module keeps for one bot (the one module instance serves every bot of a room). */
interface HazardState {
  step: Step | null;
  /** When the last NEW step was decided: the 600 ms rule. */
  lastStepAt: ServerMs;
}

const states = new WeakMap<object, HazardState>();

function stateOf(ctx: BrainContext): HazardState {
  let st = states.get(ctx.cfg);
  if (!st) {
    st = { step: null, lastStepAt: Number.NEGATIVE_INFINITY };
    states.set(ctx.cfg, st);
  }
  return st;
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Does the ground burn a fighter of this faction (a fighter with no faction yet has no home)? */
export function burns(map: GameMap, faction: string, x: number, y: number): boolean {
  return surfaceAt(map, x, y, faction).burnShare > 0;
}

/** Is the ground bad to stand or walk on: it burns, slows or slides this faction? */
export function bad(map: GameMap, faction: string, x: number, y: number): boolean {
  const e = surfaceAt(map, x, y, faction);
  return e.burnShare > 0 || e.speedMult < 1 || e.accel > 0;
}

/** A tile is clean when it and its four neighbours that a body can stand on are not bad: a click's scatter then stays on good ground. */
function clean(map: GameMap, faction: string, x: number, y: number): boolean {
  if (bad(map, faction, x, y)) return false;
  for (const [dx, dy] of [[TILE, 0], [-TILE, 0], [0, TILE], [0, -TILE]] as const) {
    if (circleClear(map, { x: x + dx, y: y + dy }, 0) && bad(map, faction, x + dx, y + dy)) return false;
  }
  return true;
}

/**
 * The tile centre nearest to `from` among those within `tiles` tiles (Chebyshev) of `around` where a body fits and `ok` holds;
 * the nearest first by `ok`'s own order of preference (a list of tests, the strictest first). Null when none.
 */
function nearestTile(
  map: GameMap, around: Vec2, from: Vec2, tiles: number, tests: readonly ((x: number, y: number) => boolean)[], accept: (p: Vec2) => boolean = () => true,
): Vec2 | null {
  const cx = worldToTile(around.x);
  const cy = worldToTile(around.y);
  const open: Vec2[] = [];
  for (let dy = -tiles; dy <= tiles; dy++) {
    for (let dx = -tiles; dx <= tiles; dx++) {
      const p = { x: tileToWorldCenter(cx + dx), y: tileToWorldCenter(cy + dy) };
      if (circleClear(map, p, PLAYER_RADIUS)) open.push(p);
    }
  }
  open.sort((a, b) => dist(a, from) - dist(b, from));
  for (const ok of tests) {
    for (const p of open) if (ok(p.x, p.y) && accept(p)) return p;
  }
  return null;
}

const move = (to: Vec2, why: string): Intent => ({ kind: "move", to: { x: to.x, y: to.y }, priority: PRIORITY.goal, timing: { kind: "step" }, why });

/** A step or a walk to the light that is still on its way: the same order offered again, so a `stop` of a chore does not undo it. */
function keeping(ctx: BrainContext, st: HazardState): Intent | null {
  const s = st.step;
  if (s === null) return null;
  const { p } = ctx;
  if (p.now - s.at > HAZARD_RULES.holdMs || dist(p.self, s.to) <= HAZARD_RULES.arriveU) {
    st.step = null;
    return null;
  }
  return move(s.to, s.why);
}

/** Standing still on ground that burns the bot, nothing locked: where to step. */
function stepOff(ctx: BrainContext, map: GameMap, faction: string): Step | null {
  const { p, mem } = ctx;
  const me = p.self;
  if (!burns(map, faction, me.x, me.y)) return null;
  if (me.attackTarget !== null) return null; // the server is fighting for it: a move would end the lock and the windup
  if (p.now - mem.self.stillSince < HAZARD_RULES.stillMs) return null;
  const to = nearestTile(
    map, me, me, HAZARD_RULES.stepTiles,
    [(x, y) => clean(map, faction, x, y), (x, y) => !bad(map, faction, x, y)],
    (q) => ctx.svc.paths.clear(me, q),
  );
  return to === null ? null : { to, at: p.now, why: "step off the embers" };
}

/** A hurt bot lying low with nothing to do: the nearest light it can walk to in a line. */
function towardLight(ctx: BrainContext, map: GameMap, faction: string, goal: Goal): Step | null {
  if (goal.kind !== "hold" || (goal.why !== "ambush" && goal.why !== "wait")) return null;
  const { p, cfg } = ctx;
  const me = p.self;
  if (me.maxHp <= 0 || me.hp / me.maxHp >= cfg.persona.reengageHp || ctx.engaged) return null;
  if (terrainAt(map, me.x, me.y) === TERRAIN_LIGHT) return null;
  const cx = worldToTile(me.x);
  const cy = worldToTile(me.y);
  const r = HAZARD_RULES.lightTiles;
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const q = { x: tileToWorldCenter(cx + dx), y: tileToWorldCenter(cy + dy) };
      if (terrainAt(map, q.x, q.y) !== TERRAIN_LIGHT || !circleClear(map, q, PLAYER_RADIUS)) continue;
      const d = dist(me, q);
      if (d < bestD && ctx.svc.paths.clear(me, q)) { best = q; bestD = d; }
    }
  }
  return best === null ? null : { to: best, at: p.now, why: "lie low in the light" };
}

export const hazardsModule: FeatureModule = {
  id: "hazards",
  enabled: (f) => f.hazards,

  intents(ctx, goal): readonly Intent[] {
    const { p } = ctx;
    const me = p.self;
    if (p.hud.phase !== "active" || me.status !== "alive" || me.faction === null || p.hud.inColiseum) return [];
    const st = stateOf(ctx);
    const kept = keeping(ctx, st);
    if (kept) return [kept];
    const map = ctx.svc.paths.collisionMap();
    let next: Step | null = null;
    if (goal.kind !== "loot" && p.now - st.lastStepAt >= HAZARD_RULES.stepEveryMs) {
      next = stepOff(ctx, map, me.faction);
      if (next) st.lastStepAt = p.now;
    }
    // A bot that stands in the light heals; one that is not on burning ground may go and find some.
    next ??= towardLight(ctx, map, me.faction, goal);
    if (next === null) return [];
    st.step = next;
    return [move(next.to, next.why)];
  },

  adjust(ctx, _goal, intents): readonly Intent[] {
    const me = ctx.p.self;
    if (me.status !== "alive" || me.faction === null) return intents;
    const map = ctx.svc.paths.collisionMap();
    const faction = me.faction;
    let out: Intent[] | null = null;
    for (let k = 0; k < intents.length; k++) {
      const i = intents[k]!;
      if (i.kind !== "move" || dist(me, i.to) < HAZARD_RULES.redirectMinU || !bad(map, faction, i.to.x, i.to.y)) continue;
      const to = nearestTile(map, i.to, i.to, HAZARD_RULES.redirectTiles, [(x, y) => clean(map, faction, x, y), (x, y) => !bad(map, faction, x, y)]);
      if (to === null) continue;
      out ??= intents.slice();
      out[k] = { ...i, to, why: `${i.why} (round the bad ground)` };
    }
    return out ?? intents;
  },
};
