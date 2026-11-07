/**
 * Actual-source camp-ward vision probes (P-VISION-1 "owned ward" remainder).
 *
 * The only trusted input is the scenario's placement of seats and the camp the probes target: everything else runs
 * through the unchanged source modules. The ward is produced by the actual \`campMobDied\` caller chain (the installed
 * mobLife kill path via \`hurtMob\`), never assigned by hand, and every probe calls the exported \`canPlayerSee\` /
 * \`canPlayerSeeActor\` consumers installed by \`vision.install\`.
 *
 * Run only under the pinned Linux x64 Node 22.23.4 container (see tools/vision-fixtures/README.md).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  CAMP_WARD_MS, TILE, TICK_MS, TILE_WALL, VISION_TRAIL_MS,
  bushAt, generateMap, isInVision, mapHashU32,
} from '@raid/shared';
import { createScenarioWorld } from '../../parity/legacy-capture/world';
import { addPlayer, step } from '../../packages/server/src/sim/step';
import { combatant } from '../../packages/server/src/sim/combatant';
import { hurtMob } from '../../packages/server/src/sim/mobLife';
import { canPlayerSee, canPlayerSeeActor, getVisionMemory } from '../../packages/server/src/sim/vision';

if (process.version !== 'v22.23.4' || process.platform !== 'linux' || process.arch !== 'x64') {
  throw Error('requires Linux x64 Node22.23.4');
}

const NOW = 10000;
const TICK = NOW / TICK_MS;
/** fire-9 (index 8): 5 spots, central; plague-9 (index 28): 5 spots, central. */
const CAMP_A = 8;
const CAMP_B = 28;
const PLAYERS = [{ id: 'p0' }, { id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
const CONFIG = {
  minPlayers: 4, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
  suddenDeathSeconds: 3600, mobs: true,
};

type Vec2 = { x: number; y: number };
type LedgerEntry = any;

function hit(victim: string, by: string, raw: number): LedgerEntry {
  return { victim, by: { id: by, name: by }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: 'sword', scale: 1, stagger: false };
}

function scene() {
  const map = generateMap(1, undefined, { decor: false });
  const w = createScenarioWorld({
    name: 'vision-ward-probe', randomSeed: 12, modules: undefined, players: PLAYERS as any,
    config: CONFIG, secrets: { rewardSalt: [1, 2, 3, 4], questSalt: [5, 6, 7, 8] },
  } as any, map);
  for (const p of PLAYERS) addPlayer(w, p.id, p.id.toUpperCase(), { faction: 'holy' });
  step(w, TICK_MS);
  if (w.state.phase !== 'active') throw new Error('the run did not start');
  w.state.serverTime = NOW;
  w.state.tick = TICK;
  return { w, map };
}

function place(w: any, id: string, at: Vec2, status = 'alive'): void {
  const s = w.state.players.get(id)!;
  s.status = status;
  s.x = at.x;
  s.y = at.y;
  const rt = w.players.get(id)!;
  rt.path = [];
  rt.history = [{ t: w.state.serverTime, x: at.x, y: at.y }];
}

function campMobs(w: any, ci: number): any[] {
  return [...w.state.mobs].filter(([, s]: any) => s.camp === ci + 1).map(([id]: any) => combatant(w, id));
}

function wardFields(w: any, ci: number) {
  const c = w.state.camps[ci]!;
  return {
    alive: c.alive, state: c.state, clearedAt: c.clearedAt, respawnAt: c.respawnAt,
    wardOwner: c.wardOwner, wardExpiresAt: c.wardExpiresAt,
  };
}

/** The actual installed producer chain: mobLife.hurtMob -> killMob -> camps.campMobDied. */
function killCamp(w: any, ci: number, killer: string): any[] {
  const states: any[] = [];
  for (const mob of campMobs(w, ci)) {
    hurtMob(w, mob, [mob.s.maxHp], [hit(mob.id, killer, mob.s.maxHp)]);
    states.push(wardFields(w, ci));
  }
  return states;
}

function floorAt(map: any, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  return (map.tiles[ty * map.w + tx] & TILE_WALL) === 0;
}

/** A deterministic far floor point, at least minDist from every camp the case uses. */
function viewerAt(map: any, camps: number[], minDist: number, taken: Vec2[] = []): Vec2 {
  const sites = camps.map((ci: number) => map.camps[ci]! as Vec2);
  for (let ty = 2; ty < map.h - 2; ty += 2) {
    for (let tx = 2; tx < map.w - 2; tx += 2) {
      if ((map.tiles[ty * map.w + tx] & TILE_WALL) !== 0) continue;
      const at = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      if (sites.some((s: Vec2) => Math.hypot(at.x - s.x, at.y - s.y) < minDist)) continue;
      if (taken.some((s: Vec2) => Math.hypot(at.x - s.x, at.y - s.y) < 200)) continue;
      return at;
    }
  }
  throw new Error('no far viewer position');
}

/** Tile-centre grid around a camp, plus the exact vision-radius boundary points on both axes. */
function grid(map: any, ci: number): Vec2[] {
  const def = map.camps[ci]!;
  const cx = Math.floor(def.x / TILE), cy = Math.floor(def.y / TILE);
  const out: Vec2[] = [];
  for (let dy = -28; dy <= 28; dy += 4) {
    for (let dx = -28; dx <= 28; dx += 4) {
      const tx = cx + dx, ty = cy + dy;
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
      if ((map.tiles[ty * map.w + tx] & TILE_WALL) !== 0) continue;
      out.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
    }
  }
  for (const [dx, dy] of [[900, 0], [-900, 0], [0, 900], [0, -900], [900.5, 0], [0, -900.5]]) {
    out.push({ x: def.x + dx, y: def.y + dy });
  }
  return out;
}

/** The first bush cell the camp's ward would reveal (bush occupants are the source's actor-only concealment case). */
function bushVisibleFromCamp(map: any, ci: number): Vec2 | null {
  const site = map.camps[ci]!;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const v = map.featureGrid[ty * map.w + tx];
      if (!v) continue;
      const f = map.features[v - 1];
      if (!f || f.kind !== 'bush') continue;
      const at = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      if (bushAt(map, at) === 0) continue;
      if (isInVision(map, site, at)) return at;
    }
  }
  return null;
}

/** The first camp whose ward would reveal a bush tile (actor-only concealment after point visibility). */
function bushCamp(map: any): { camp: number; at: Vec2 } | null {
  for (let ci = 0; ci < map.camps.length; ci++) {
    const at = bushVisibleFromCamp(map, ci);
    if (at) return { camp: ci, at };
  }
  return null;
}

function visiblePoint(w: any, map: any, ci: number, gridPoints: Vec2[]): Vec2 {
  const site = map.camps[ci]!;
  const found = gridPoints.find((p) => isInVision(map, site, p));
  if (!found) throw new Error('no ward-visible grid point');
  return found;
}

type Probe = {
  kind: 'point' | 'actor' | 'trail';
  viewer: string;
  target?: string;
  x: number;
  y: number;
  serverTime: number;
  gatesLocked: boolean;
  /** Status override applied only for this probe (the source's dead-viewer boundary). */
  status?: string;
  expected: boolean;
};

function makeProbes(w: any): {
  point(viewer: string, at: Vec2, serverTime?: number, gatesLocked?: boolean): void;
  actor(viewer: string, target: string, at: Vec2, serverTime?: number, gatesLocked?: boolean): void;
  trail(viewer: string, at: Vec2, serverTime?: number, gatesLocked?: boolean): void;
  list: Probe[];
} {
  const list: Probe[] = [];
  const point = (viewer: string, at: Vec2, serverTime = w.state.serverTime, gatesLocked = w.state.gatesLocked) => {
    w.state.gatesLocked = gatesLocked;
    w.state.serverTime = serverTime;
    list.push({ kind: 'point', viewer, x: at.x, y: at.y, serverTime, gatesLocked, expected: canPlayerSee(w, viewer, at) });
  };
  const actor = (viewer: string, target: string, at: Vec2, serverTime = w.state.serverTime, gatesLocked = w.state.gatesLocked) => {
    w.state.gatesLocked = gatesLocked;
    w.state.serverTime = serverTime;
    list.push({ kind: 'actor', viewer, target, x: at.x, y: at.y, serverTime, gatesLocked, expected: canPlayerSeeActor(w, viewer, target, at) });
  };
  const trail = (viewer: string, at: Vec2, serverTime = w.state.serverTime, gatesLocked = w.state.gatesLocked) => {
    w.state.gatesLocked = gatesLocked;
    w.state.serverTime = serverTime;
    const memory = getVisionMemory(w, viewer);
    list.push({ kind: 'trail', viewer, x: at.x, y: at.y, serverTime, gatesLocked, expected: memory ? memory.canSee(at, serverTime) : false });
  };
  return { point, actor, trail, list };
}

function caseStart(name: string) {
  const { w, map } = scene();
  const sites = [CAMP_A, CAMP_B].map((ci: number) => map.camps[ci]! as Vec2);
  const p0 = viewerAt(map, [CAMP_A, CAMP_B], 2400);
  const p1 = viewerAt(map, [CAMP_A, CAMP_B], 2400, [p0]);
  for (const p of PLAYERS) place(w, p.id, p0);
  place(w, 'p0', p0);
  place(w, 'p1', p1);
  for (const id of ['p0', 'p1', 'p2', 'p3']) getVisionMemory(w, id)?.clear();
  return { name, w, map, sites, p0, p1 };
}

function caseState(w: any, map: any, camps: number[]): any {
  return {
    tick: w.state.tick, serverTime: w.state.serverTime, gatesLocked: w.state.gatesLocked,
    players: PLAYERS.map((p) => {
      const s = w.state.players.get(p.id)!;
      return { id: p.id, faction: s.faction, status: s.status, x: s.x, y: s.y };
    }),
    camps: camps.map((ci: number) => {
      const def = map.camps[ci]!;
      return { index: ci, id: def.id, zone: def.zone, x: def.x, y: def.y, spots: def.spots.length, eliteSpot: def.eliteSpot };
    }),
  };
}

function runProducerAndTwoCamps(): any {
  const c = caseStart('producer_and_two_camps');
  const { w, map } = c;
  // The ward producer: kill every mob of A with p0's whole-fight damage, then B with p1's.
  const statesA = killCamp(w, CAMP_A, 'p0');
  const clearedAt = w.state.camps[CAMP_A]!.clearedAt;
  const statesB = killCamp(w, CAMP_B, 'p1');
  place(w, 'p2', visiblePoint(w, map, CAMP_A, grid(map, CAMP_A)));
  const bush = bushVisibleFromCamp(map, CAMP_A);
  place(w, 'p3', bush ?? visiblePoint(w, map, CAMP_A, grid(map, CAMP_A)));
  const probes = makeProbes(w);
  for (const ci of [CAMP_A, CAMP_B]) {
    for (const at of grid(map, ci)) {
      probes.point('p0', at);
      probes.point('p1', at);
    }
    probes.trail('p0', map.camps[ci]!);
    probes.trail('p1', map.camps[ci]!);
  }
  const p2 = w.state.players.get('p2')!;
  const p3 = w.state.players.get('p3')!;
  for (const viewer of ['p0', 'p1']) {
    probes.actor(viewer, 'p2', { x: p2.x, y: p2.y });
    probes.actor(viewer, 'p3', { x: p3.x, y: p3.y });
  }
  w.state.serverTime = NOW;
  w.state.gatesLocked = false;
  return {
    ...caseState(w, map, [CAMP_A, CAMP_B]),
    name: c.name,
    kills: [
      { camp: CAMP_A, killer: 'p0', states: statesA },
      { camp: CAMP_B, killer: 'p1', states: statesB },
    ],
    clearedAt,
    actors: [
      { id: 'p2', x: p2.x, y: p2.y, bush: false },
      { id: 'p3', x: p3.x, y: p3.y, bush: bush !== null },
    ],
    probes: probes.list,
  };
}

function runEngagedOnly(): any {
  const c = caseStart('engaged_only');
  const { w, map } = c;
  const group = campMobs(w, CAMP_A);
  hurtMob(w, group[0]!, [group[0]!.s.maxHp], [hit(group[0]!.id, 'p0', group[0]!.s.maxHp)]);
  const probes = makeProbes(w);
  for (const at of grid(map, CAMP_A)) probes.point('p0', at);
  return {
    ...caseState(w, map, [CAMP_A]),
    name: c.name,
    kills: [],
    engagedState: wardFields(w, CAMP_A),
    probes: probes.list,
  };
}

function runExpiry(): any {
  const c = caseStart('expiry_boundary');
  const { w, map } = c;
  const states = killCamp(w, CAMP_A, 'p0');
  const deadline = w.state.camps[CAMP_A]!.wardExpiresAt;
  const base = caseState(w, map, [CAMP_A]);
  const probes = makeProbes(w);
  const points = grid(map, CAMP_A);
  const at = visiblePoint(w, map, CAMP_A, points);
  const hidden = points.find((p) => !isInVision(map, map.camps[CAMP_A], p))!;
  for (const t of [deadline - 1, deadline, deadline + VISION_TRAIL_MS, deadline - 1]) {
    probes.point('p0', at, t);
    probes.point('p0', hidden, t);
    probes.point('p1', at, t);
  }
  return {
    ...base,
    name: c.name, kills: [{ camp: CAMP_A, killer: 'p0', states }], deadline, visiblePoint: at,
    hiddenPoint: hidden, probes: probes.list,
  };
}

function runDeadMissingLocked(): any {
  const c = caseStart('dead_missing_locked');
  const { w, map } = c;
  const states = killCamp(w, CAMP_A, 'p0');
  const at = visiblePoint(w, map, CAMP_A, grid(map, CAMP_A));
  const probes = makeProbes(w);
  probes.point('p1', at);
  probes.point('p0', at);
  w.state.gatesLocked = true;
  for (const p of grid(map, CAMP_A)) probes.point('p0', p, NOW, true);
  w.state.gatesLocked = false;
  // An actor probe is a point probe plus the actor's body: keep the body where the point is, as a client would see it.
  place(w, 'p2', at);
  const base = caseState(w, map, [CAMP_A]);
  w.state.players.get('p0')!.status = 'dead';
  const dead = (probe: Probe) => { probe.status = 'dead'; };
  probes.point('p0', at, NOW, false);
  dead(probes.list[probes.list.length - 1]!);
  probes.actor('p0', 'p2', at, NOW, false);
  dead(probes.list[probes.list.length - 1]!);
  probes.point('missing', at);
  w.state.players.get('p0')!.status = 'alive';
  return {
    ...base,
    name: c.name, kills: [{ camp: CAMP_A, killer: 'p0', states }], probes: probes.list,
  };
}

function runWardBushActor(): any {
  const found = bushCamp(generateMap(1, undefined, { decor: false }));
  if (!found) throw new Error('no camp reveals a bush on the certified map');
  const c = caseStart('ward_bush_actor');
  const { w, map } = c;
  // Re-place the seats for the bush camp: every viewer stays strictly outside its ward circle.
  const site = map.camps[found.camp]!;
  const p0 = viewerAt(map, [found.camp], 2400);
  const p1 = viewerAt(map, [found.camp], 2400, [p0]);
  place(w, 'p0', p0);
  place(w, 'p1', p1);
  const states = killCamp(w, found.camp, 'p0');
  const open = grid(map, found.camp).find((p) => isInVision(map, site, p) && bushAt(map, p) === 0)!;
  place(w, 'p2', found.at);
  place(w, 'p3', open);
  const base = caseState(w, map, [found.camp]);
  const probes = makeProbes(w);
  probes.point('p0', found.at);
  probes.point('p0', open);
  probes.actor('p0', 'p2', found.at);
  probes.actor('p0', 'p3', open);
  probes.point('p1', found.at);
  probes.actor('p1', 'p2', found.at);
  return {
    ...base,
    name: c.name, kills: [{ camp: found.camp, killer: 'p0', states }], bushCamp: found.camp,
    bush: { x: found.at.x, y: found.at.y }, open: { x: open.x, y: open.y }, probes: probes.list,
  };
}

const map = generateMap(1, undefined, { decor: false });
const out = {
  format: 'rh-vision-ward/1',
  kind: 'actual-source camp ward producer (mobLife kill path) and installed canPlayerSee/canPlayerSeeActor probes; '
    + 'trusted input is seat placement and the camp targeted; not ordinary gameplay intake',
  map: { seed: map.seed, hash: mapHashU32(map), w: map.w, h: map.h, fixture: 'crates/rh-sim/src/mapdata/fixtures/seed1.map.json' },
  constants: { tickMs: TICK_MS, visionTrailMs: VISION_TRAIL_MS, campWardMs: CAMP_WARD_MS, tile: TILE },
  provenance: {
    node: process.version, platform: process.platform, arch: process.arch,
    nodeSha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),
    sourceBaseline: 'packages/ byte-identical to the pinned capture source (container mounts the worktree read-only)',
  },
  cases: [runProducerAndTwoCamps(), runEngagedOnly(), runExpiry(), runDeadMissingLocked(), runWardBushActor()],
};
writeFileSync(process.argv[2] ?? 'parity/vision/ward-sight.json', JSON.stringify(out, null, 2) + '\n');
console.log('captured ' + out.cases.length + ' actual camp-ward cases: '
  + out.cases.map((c: any) => c.name + '(' + c.probes.length + ' probes)').join(', '));
