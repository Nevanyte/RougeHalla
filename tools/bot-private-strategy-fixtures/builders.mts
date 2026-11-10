import {shared, types, mapgen} from './runtime.mts';
export const MAP = mapgen.generateMap(7, undefined, {decor: false});
export const ME = {x: MAP.spawns[0].x, y: MAP.spawns[0].y};
export const NOW = 300_000;
export const at = (dx: number, dy = 0) => ({x: ME.x + dx, y: ME.y + dy});
export const features = (o: any = {}) => ({messageTypes: ['move', 'stop', 'target', 'attack', 'release', 'swap', 'pickup', 'cast', 'plan', 'choose', 'useConsumable'],
  wishes: true, statusEffects: true, fields: true, planning: true, chests: true, skills: true, relics: false, camps: true, hazards: true, ...o});
export const self = (o: any = {}) => ({id: 'me', name: 'Me', ...ME, facing: 0, status: 'alive', hp: 100, maxHp: 100,
  barrier: 0, faction: 'fire', weapons: ['sword', null], slot: 0, attackTarget: null, drawStartedAt: 0,
  readyAt: 0, immuneUntil: 0, sig: 0, brand: 0, power: 0, asMult: 1, windupMult: 1, speedMult: 1,
  kills: 0, mobKills: 0, gv: 0, bounty: 0, moveSeq: 0, ...o});
export const hud = (o: any = {}) => ({phase: 'active', training: false, lobbyEndsAt: 0, raidStartedAt: -1_000_000,
  patienceEndsAt: 900_000, suddenDeathAt: 0, inColiseum: false, gatesLocked: false, startedWith: 6, alive: 6,
  playerCount: 6, minPlayers: 2, winner: '', ...o});
export const fighter = (id = 'foe', dx = 200, o: any = {}) => ({id, name: id, bot: false, ...at(dx), facing: Math.PI,
  status: 'alive', hpFrac: 1, barrierFrac: 0, faction: 'frost', inHand: 'sword', drawStartedAt: 0, bounty: 0,
  immune: false, sig: 0, brand: 0, targetable: true, vx: 0, vy: 0, dist: Math.hypot(o.x === undefined ? dx : o.x - ME.x, o.y === undefined ? 0 : o.y - ME.y),
  los: true, tint: 0, central: true, ...o});
export const mob = (id = 'mob1', dx = 100, o: any = {}) => ({id, kind: 'mob', name: 'Pardoner', type: 'pardoner', faction: 'sentenced', ...at(dx), facing: Math.PI,
  status: 'alive', hpFrac: 1, inHand: 'sword', drawStartedAt: 0, sig: 0, brand: 0, vx: 0, vy: 0,
  dist: Math.hypot(o.x === undefined ? dx : o.x - ME.x, o.y === undefined ? 0 : o.y - ME.y), los: true, central: true, ...o});
export const dot = (id = 'mob1', dx = 100, o: any = {}) => ({id, ...at(dx), faction: 'sentenced', elite: false, ...o});
export const container = (id = 'box', dx = 100, o: any = {}) => ({id, kind: 'ground', ...at(dx), label: '', closed: true,
  weapon: 'bow', interactable: false, dist: Math.abs(dx), ...o});
export const projectile = (o: any = {}) => ({id: 'ball', kind: 'ball', ...at(200), vx: -380, vy: 0,
  x0: ME.x + 220, y0: ME.y, t0: NOW, range: 220, from: 'foe', ...o});
export const event = (kind: string, t = NOW, o: any = {}) => ({kind, t, at: null, ...o});
export const hit = (t: number, id = 'me', by: any = 'foe', amount = 10, o: any = {}) => event('hit', t, {id, by, amount, weapon: 'sword', sig: null, ...o});
export const ext = (t: number, fx: string, data: any) => event('ext', t, {fx, data});
export const percept = (now = NOW, o: any = {}) => ({now, viewT: o.viewT ?? now - 130, self: self(o.self), hud: hud(o.hud),
  fighters: o.fighters ?? [], mobs: o.mobs ?? [], containers: o.containers ?? [], projectiles: o.projectiles ?? [],
  minimap: {t: now, mobs: [], gatesLocked: false, ...o.minimap}, events: o.events ?? [], extras: o.extras ?? {}, features: features(o.features)});
export const sent = (atMs: number, type: string, msg: any = {}, o: any = {}) => ({at: atMs, cmd: {type, msg},
  intent: type === 'target' ? 'lock' : type === 'attack' || type === 'release' ? 'lock' : type, priority: 2, stimulus: null, ...o});
export const observe = (now = NOW, o: any = {}) => ({method: 'observe', input: percept(now, o)});
export const decide = (o: any = {}) => ({method: 'decide', current: '$previous', status: {state: 'running', why: 'declared tactic status'}, ...o});
export const tick = (now = NOW, o: any = {}, d: any = {}) => [observe(now, o), decide(d)];
export const config = (o: any = {}) => ({tier: 'hard', persona: 'farmer', seed: 1, id: 'me', map: 'generated7',
  features: features(), path: {kind: 'open', factor: 1, exact: true}, knowledge: {kind: 'source'},
  learned: {enabled: false, entries: []}, modules: [], ...o});
export const campView = (c: any, index: number, o: any = {}) => ({index, id: c.id, type: shared.normalTypesOf(c.zone)[0]?.id ?? '',
  reward: 'known', alive: c.spots.length, state: 0, clearedAt: 0, respawnAt: 0, ...o});
export const routeCamp = (index = 0, x = 600, zone = 'fire', type = 'pardoner', o: any = {}) => ({index, id: 'camp-' + index,
  zone, x, y: 0, r: 96, elite: false, spots: 4, type, alive: 4, state: 0, respawnAt: 0, ...o});
export const routeInput = (now = 100_000, camps: any[] = [], o: any = {}) => ({now, runMs: 60_000, self: {x: 0, y: 0},
  speed: 160, mobKills: 0, power: 0, camps, players: [], canFarm: {kind: 'allow'}, ...o});
export const mobLike = (id = 'm', x = 100, o: any = {}) => [id, {kind: 'mob', type: 'pardoner', status: 'alive', x, y: 0,
  hp: 100, maxHp: 100, faction: 'sentenced', weapon0: 'sword', ...o}];
export const huntInput = (now = 100_000, mobs = [mobLike()], o: any = {}) => ({now,
  self: {faction: 'fire', x: 0, y: 0, hp: 100, maxHp: 100, weapons: ['sword', null], power: 0, mobKills: 0, mobStats: {}, ...o.self},
  playerDistance: Infinity, players: [], inColiseum: false, mobs, attacking: false, shotByPlayerAt: -Infinity,
  walk: {kind: 'open', factor: 1}, ...o, ...(o.self ? {self: {faction: 'fire', x: 0, y: 0, hp: 100, maxHp: 100, weapons: ['sword', null], power: 0, mobKills: 0, mobStats: {}, ...o.self}} : {})});
