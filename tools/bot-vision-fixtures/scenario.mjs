// Declared BotVision method contexts for the bot-vision witness. PURE DATA: this module imports
// nothing and evaluates no source. Every value below is a DECLARED input handed to the actual
// unmodified source `BotVision` by runtime.mjs; no output, visibility, grid or expected mask is
// declared here. Inputs are declared method contexts, NOT earned World/socket deliveries:
//  - `state` holds only the leaves BotVision.update reads (players is a Map, as KeyedLike);
//  - `percept` is a declared composed-Percept shape (FrameRing.compose was not run).
// Geometry is chosen on the captured seed-1 map (crates/rh-sim/src/mapdata/fixtures/seed1.map.json).

export const SCENARIO_FORMAT = 'rh-bot-vision-scenario/1';
export const SELF = 'p1';
const CAMPS = 50; // map.camps.length on seed 1

// ---------------------------------------------------------------------------------------- geometry
// Fire corner (tile = floor(world / 32)).
const A = { x: 784.1, y: 464.3 };     // tile (24,14); not float32-representable (in-process driver domain)
const B = { x: 816, y: 464 };          // tile (25,14); float32-exact (decoded schema domain)
const C = { x: 848, y: 496 };          // tile (26,15)
const G = { x: 2000, y: 600 };         // tile (62,18); more than 900 from A
const N1 = { x: 720, y: 400 };         // near A
const N2 = { x: 848, y: 528 };         // near A
const BEHIND = { x: 400, y: 240 };     // tile (12,7), behind the column-17 wall seen from A
const F1 = { x: 3000, y: 3000 };       // far from every source in these cases
const F2 = { x: 4000, y: 1000 };
const BUSH = { x: 560, y: 368 };       // bush feature 16, tile (17,11)
const BUSH_N = { x: 592, y: 336 };     // bush feature 16, tile (18,10)
const BUSH_S = { x: 560, y: 400 };     // bush feature 16, tile (17,12)
const CAMP0 = { x: 912, y: 1488 };     // map.camps[0] (fire-1), more than 900 from A
const CAMP0_NEAR = [{ x: 912, y: 1488 }, { x: 976, y: 1520 }, { x: 912, y: 1700 }, { x: 1300, y: 1488 }];
// Coliseum north gate (tiles 78..81, 71); arena rect 71..88.
const NORTH = { x: 2544.5, y: 2128.25 }; // tile (79,66), outside the coliseum
const ARENA_IN = [{ x: 2576, y: 2400 }, { x: 2576, y: 2576 }, { x: 2300, y: 2580 }, { x: 2830, y: 2830 }];
const ARENA_CENTRE = { x: 2576, y: 2576 };

const tileCentre = (index) => ({ x: (index % 160) * 32 + 16, y: Math.floor(index / 160) * 32 + 16 });
const idx = (tx, ty) => ty * 160 + tx;

// ----------------------------------------------------------------------------------------- builders
const extra = (until = 0) => ({ bushRevealUntil: until });
const player = (at, status = 'alive', ex = extra()) => ({ x: at.x, y: at.y, status, extra: ex });
const camps = (overrides = {}, length = CAMPS) => Array.from({ length }, (_, i) =>
  Object.hasOwn(overrides, i) ? overrides[i] : { wardOwner: '', wardExpiresAt: 0 });
/** Declares a state without a `camps` member (a default parameter cannot express absence). */
const ABSENT = Symbol('absent');
const state = ({ t, phase = 'active', training = false, gatesLocked = false, players, campList = camps() }) => {
  const s = { phase, serverTime: t, training, gatesLocked, players: new Map(players) };
  if (campList !== ABSENT) s.camps = campList;
  return s;
};
const update = (s, privates, note) => ({ op: 'update', input: privates === undefined ? { state: s } : { state: s, privates }, selfId: SELF, note });
const probe = (points, note) => ({ op: 'canSee', points, note });
const filter = (percept, note) => ({ op: 'filter', percept, note });

const FEATURES = {
  messageTypes: ['move', 'attack', 'swap', 'interact', 'useConsumable'],
  wishes: true, statusEffects: true, fields: true, planning: true, chests: true,
  skills: true, relics: true, camps: true, hazards: true,
};
const fighter = (id, at, extraKeys = {}) => ({ id, name: id, x: at.x, y: at.y, vx: 0, vy: 0, status: 'alive', faction: null,
  inHand: 'sword', hp: 100, maxHp: 100, dist: 0, los: true, tint: 0, central: false, ...extraKeys });
const mob = (id, at) => ({ id, kind: 'mob', x: at.x, y: at.y, vx: 0, vy: 0, status: 'alive', faction: null, inHand: null,
  hp: 30, maxHp: 30, dist: 0, los: true, central: false });
const selfView = (at) => ({ id: SELF, x: at.x, y: at.y, status: 'alive', hp: 100, maxHp: 100, faction: null,
  weapons: ['sword', 'bow'], slot: 0 });
const percept = ({ t, self, fighters = [], mobs = [], containers = [], projectiles = [], minimapMobs = [], events = [], extras = {} }) => ({
  now: t, viewT: t - 150, self: selfView(self), hud: { phase: 'active', gatesLocked: false },
  fighters, mobs, containers, projectiles,
  minimap: { t, mobs: minimapMobs, gatesLocked: false }, events, extras, features: FEATURES,
});

// ------------------------------------------------------------------------------------------- cases
function resetGates() {
  const ps = (at, t) => [[SELF, player(at)], ['p2', player(N1, 'alive', extra(t + 400))]];
  const pc = (t) => percept({ t, self: B, fighters: [fighter('p2', N1), fighter('p3', F1)], events: [{ kind: 'hit', t, at: F1, by: 'p3' }] });
  return {
    id: 'reset-gates',
    purpose: 'phase/training gates, disabled identity filter, nonactive reset of trail and wards, reuse after clear',
    steps: [
      update(state({ t: 1000, phase: 'lobby', players: ps(B, 1000) }), undefined, 'lobby: disabled'),
      probe([F1, N1], 'disabled canSee is unconditionally true'),
      filter(pc(1000), 'disabled filter returns the same percept object'),
      update(state({ t: 1100, phase: 'planning', players: ps(B, 1100) })),
      update(state({ t: 1200, training: true, players: ps(B, 1200) }), undefined, 'active Training: disabled'),
      filter(pc(1200)),
      update(state({ t: 1300, players: ps(B, 1300), campList: camps({ 0: { wardOwner: SELF, wardExpiresAt: 9000 } }) }), undefined, 'enabled: first scan and ward'),
      probe([B, N1, F1, CAMP0], 'own trail and ward'),
      filter(pc(1300), 'enabled filter drops the far fighter and event'),
      update(state({ t: 1400, players: ps(B, 1400), campList: camps({ 0: { wardOwner: SELF, wardExpiresAt: 9000 } }) }), undefined, 'same origin after 100ms: reuse path'),
      update(state({ t: 1500, phase: 'ended', players: ps(B, 1500) }), undefined, 'nonactive: memory and wards cleared'),
      probe([B, CAMP0]),
      update(state({ t: 1600, players: ps(B, 1600) }), undefined, 'active again, same origin: lastMap was cleared so no reuse'),
      probe([B, CAMP0, N1]),
      update(state({ t: 1700, training: 0, players: ps(B, 1700) }), undefined, 'falsy non-boolean training (declared truthiness subcase)'),
      update(state({ t: 1800, training: 1, players: ps(B, 1800) }), undefined, 'truthy non-boolean training: disabled'),
      probe([B]),
    ],
  };
}

function trailThrottle() {
  const ps = (at, status = 'alive') => [[SELF, player(at, status)]];
  const points = [A, B, C, N1, N2, BEHIND, BUSH, F1, tileCentre(idx(24, 14)), tileCentre(idx(44, 14)), tileCentre(idx(52, 14)),
    tileCentre(idx(24, 25)), tileCentre(idx(30, 6))]; // the last two are candidate A-only edge cells
  return {
    id: 'trail-throttle',
    purpose: 'Math.fround origin, 100ms throttle ignoring movement, reuse refresh, dead seat keeps trail, exclusive expiry, backwards time',
    steps: [
      update(state({ t: 5000, players: ps(A) }), undefined, 'non-float32 origin scanned at fround(A)'),
      probe(points),
      update(state({ t: 5050, players: ps(B) }), undefined, 'moved within 100ms: throttled, no scan'),
      probe(points),
      update(state({ t: 5100, players: ps(B) }), undefined, 'scan from B'),
      update(state({ t: 5150, players: ps(B) })),
      update(state({ t: 5200, players: ps(B) }), undefined, 'same origin: reuse refresh only'),
      update(state({ t: 5250, players: ps(C, 'dead') }), undefined, 'dead: no update'),
      probe(points),
      update(state({ t: 34999, players: ps(C, 'dead') })),
      probe(points, 'A-only cells expire at 35000 (exclusive)'),
      update(state({ t: 35000, players: ps(C, 'dead') })),
      probe(points),
      update(state({ t: 35200, players: ps(C, 'dead') })),
      probe(points, 'everything expired'),
      update(state({ t: 40000, players: ps(B) }), undefined, 'alive again'),
      update(state({ t: 39990, players: ps(B) }), undefined, 'time before lastUpdate: no throttle, reuse path'),
      update(state({ t: 40010, players: ps(G) }), undefined, 'moved far within the window from 39990: throttled'),
      update(state({ t: 40090, players: ps(G) }), undefined, 'now - lastUpdate = 100: scan from G'),
      probe(points),
      update(state({ t: 40300, players: [['p2', player(A)]] }), undefined, 'seat missing from players: no scan'),
      probe(points),
    ],
  };
}

function reconnect() {
  const dead = [[SELF, player(C, 'dead')]];
  const i1 = idx(24, 14), i2 = idx(25, 14), i3 = idx(26, 14), i4 = idx(27, 14), i5 = idx(28, 14), i6 = idx(29, 14), i7 = idx(30, 14);
  const msg = (cells, over = {}) => ({ seed: 1, w: 160, h: 160, at: 50000, cells, ...over });
  const vision = (m) => ({ type: 'vision', msg: m });
  const restored = [
    [i1, 60000], [i2, 50000], [i3, 49999], [-1, 60000], [25600, 60000], [1.5, 60000], ['5', 60000],
    [i4, Infinity], [i5, NaN], [i6], 7, [i7, 60000, 'extra'], [i1, 61000], [-0, 60000], null, [idx(0, 159) + 159, 50000.5],
  ];
  const points = [i1, i2, i3, i4, i5, i6, i7, 0, idx(159, 159), idx(40, 40)].map(tileCentre);
  const other = [[idx(40, 40), 70000], [idx(41, 40), 70000]];
  return {
    id: 'reconnect-restore',
    purpose: 'own vision snapshot restore: accepted/refused cells, refused envelopes, last accepted wins, empty clears, ignored while disabled',
    steps: [
      update(state({ t: 50000, players: dead }), [vision(msg(restored))], 'positive restore with every refused cell form'),
      probe(points),
      update(state({ t: 50100, players: dead }), [
        vision(msg(other, { seed: 2 })), vision(msg(other, { w: 159 })), vision(msg(other, { h: 161 })), vision(null),
        vision('vision'), vision(msg({ length: 0 })), { type: 'Vision', msg: msg(other) }, { type: 'plan', msg: msg(other) },
        vision(msg(other, { seed: '1' })), 'vision', ['vision', msg(other)], vision(0), vision({ seed: 1, w: 160, h: 160 }),
      ], 'every refused envelope leaves the restored trail unchanged'),
      probe(points),
      update(state({ t: 50200, players: dead }), [vision(msg(other)), { type: 'plan', msg: {} }, vision(msg([[i1, 80000]]))], 'two accepted snapshots: the last wins entirely'),
      probe(points),
      update(state({ t: 50300, players: dead }), [vision(msg(other)), vision(msg(other, { seed: 2 }))], 'accepted then refused: accepted stays'),
      update(state({ t: 50400, players: dead }), [vision(msg([]))], 'accepted empty snapshot clears the trail'),
      probe(points),
      update(state({ t: 50500, players: dead }), 'privates', 'a string privates value iterates characters: no restore'),
      update(state({ t: 50600, phase: 'planning', players: dead }), [vision(msg(other))], 'disabled: privates are not read'),
      update(state({ t: 50700, players: dead }), undefined, 'active again without a snapshot: nothing restored'),
      probe(points),
      update(state({ t: 50800, players: [[SELF, player(A)]] }), [vision(msg(other))], 'restore then own scan from A merges'),
      probe(points),
    ],
  };
}

function bushReveal() {
  const at = (x) => ({ x, y: 368 });
  const ps = (t, over = {}) => [
    [SELF, player(at(624))],
    ['p2', player(BUSH, 'alive', extra(0))],
    ['p3', player(BUSH_N, 'alive', extra(t + 300))],
    ['p4', player(N1)],
    ['p5', { ...player(BUSH_S), extra: null }],
    ['p6', { x: BUSH.x, y: BUSH.y, status: 'alive' }],
    ['p7', player(BUSH, 'alive', { bushRevealUntil: null })],
    ...Object.entries(over),
  ];
  const fs = () => [fighter('p2', BUSH), fighter('p3', BUSH_N), fighter('p4', N1), fighter('p5', BUSH_S),
    fighter('p6', BUSH), fighter('p7', BUSH), fighter('ghost', BUSH), fighter('far', F1)];
  return {
    id: 'bush-reveal',
    purpose: 'bushConceals via percept.self, exact 64 boundary, same bush, bushRevealUntil reveal and exclusive expiry, missing/null extra',
    steps: [
      update(state({ t: 70000, players: ps(70000) }), undefined, 'seat at (624,368), outside the bush'),
      probe([BUSH, BUSH_N, BUSH_S, N1, F1]),
      filter(percept({ t: 70000, self: at(624), fighters: fs() }), 'viewer exactly 64 from (560,368): not concealed; reveal shows p3'),
      filter(percept({ t: 70000, self: at(624.5), fighters: fs() }), 'viewer 64.5 away: (560,368) occupants concealed'),
      filter(percept({ t: 70000, self: BUSH_S, fighters: fs() }), 'viewer inside the same bush: none concealed'),
      update(state({ t: 70300, players: ps(70000) }), undefined, 'p3 bushRevealUntil == now: not revealed'),
      filter(percept({ t: 70300, self: at(800), fighters: fs() })),
      update(state({ t: 70350, players: ps(70350, { p2: player(BUSH, 'dead', extra(80000)) }) }), undefined, 'dead p2 still has a synced reveal'),
      filter(percept({ t: 70350, self: at(800), fighters: fs() })),
    ],
  };
}

function wards() {
  const ps = [[SELF, player(A)]];
  const owned = (end) => ({ wardOwner: SELF, wardExpiresAt: end });
  const points = [...CAMP0_NEAR, A, F1];
  const tagged = (t, end, extraOver = {}) => camps({ 0: owned(end), ...extraOver });
  return {
    id: 'wards',
    purpose: 'ward owner/expiry at original camp indexes, keep/renew/gate rebuild, removal, out-of-map index, null/undefined entries, infinite expiry',
    steps: [
      update(state({ t: 20000, players: ps, campList: tagged(20000, 26000.3) }), undefined, 'ward at camp 0 with a fractional expiry'),
      probe(points),
      update(state({ t: 20100, players: ps, campList: tagged(20100, 26000.3) }), undefined, 'unchanged end and map: ward kept, not rescanned'),
      probe(points),
      update(state({ t: 20200, players: ps, campList: tagged(20200, 30000) }), undefined, 'renewal: rescanned with ttl = end - now'),
      update(state({ t: 20300, gatesLocked: true, players: ps, campList: tagged(20300, 30000) }), undefined, 'gate lock: map identity change rescans'),
      probe(points),
      update(state({ t: 20400, players: ps, campList: camps({ 0: { wardOwner: 'p9', wardExpiresAt: 30000 }, 1: owned(0) }) }), undefined, 'another owner: removed; owned with expiry 0: skipped'),
      probe(points),
      update(state({ t: 20500, players: ps, campList: camps({ 0: owned(20600), 3: owned(25000), 50: owned(30000) }, 51) }), undefined, 'two wards; index 50 has no map site'),
      probe(points),
      update(state({ t: 20600, players: ps, campList: camps({ 0: owned(20600), 3: owned(25000) }) }), undefined, 'end == now: camp 0 removed, camp 3 kept'),
      probe(points),
      update(state({ t: 20700, players: ps, campList: camps({ 0: owned(Infinity), 2: null, 4: { wardOwner: SELF }, 3: owned(25000) }) }), undefined, 'infinite expiry: ward kept but never scanned; null entry; missing expiry'),
      probe(points),
      update(state({ t: 20800, players: ps, campList: ABSENT }), undefined, 'state.camps absent: every ward removed'),
      probe(points),
      update(state({ t: 20900, players: [[SELF, player(A, 'dead')]], campList: camps({ 0: owned(29000) }) }), undefined, 'dead seat still owns a ward'),
      probe(points),
    ],
  };
}

function gates() {
  const ps = (at) => [[SELF, player(at)]];
  const points = [NORTH, ...ARENA_IN, F1];
  return {
    id: 'gates-coliseum',
    purpose: 'withGates sight when locked, open sight through a gate, map identity, inColiseum full arena rectangle',
    steps: [
      update(state({ t: 30000, gatesLocked: true, players: ps(NORTH) }), undefined, 'locked gates: arena hidden from the north'),
      probe(points),
      update(state({ t: 30050, gatesLocked: false, players: ps(NORTH) }), undefined, 'gates open within 100ms: new map identity, not throttled'),
      probe(points),
      update(state({ t: 30200, gatesLocked: true, players: ps(ARENA_CENTRE) }), undefined, 'inside the coliseum: whole rectangle'),
      probe(points),
    ],
  };
}

function filterFamilies() {
  const ps = (at) => [[SELF, player(at)], ['p2', player(N1)], ['p3', player(F1)]];
  const fields = [
    { kind: 'fire', ability: 1, x: N1.x, y: N1.y, x2: 0, y2: 0, r: 40, owner: 'p2', until: 70000 },
    { kind: 'fire', ability: 1, x: F1.x, y: F1.y, x2: 0, y2: 0, r: 40, owner: 'p3', until: 70000 },
    { kind: 'trail', ability: 2, x: N1.x, y: N1.y, x2: N2.x, y2: N2.y, r: 12, owner: null, until: 70000 },
    { kind: 'trail', ability: 2, x: N1.x, y: N1.y, x2: F1.x, y2: F1.y, r: 12, owner: 'p2', until: 70000 },
    { kind: 'trail', ability: 2, x: F1.x, y: F1.y, x2: N1.x, y2: N1.y, r: 12, owner: 'p3', until: 70000 },
    { kind: 'bog', ability: 3, x: N2.x, y: N2.y, x2: F1.x, y2: F1.y, r: 30, owner: null, until: 70000 },
  ];
  const full = (t, self) => percept({
    t, self,
    fighters: [fighter('p2', N1), fighter('p3', F1)],
    mobs: [mob('7', N2), mob('m9', F2)],
    containers: [{ id: 'c1', kind: 'crate', x: N1.x, y: N1.y, dist: 0 }, { id: 'c2', kind: 'body', x: F1.x, y: F1.y, dist: 0 }],
    projectiles: [
      { id: 'a1', kind: 'arrow', x: N2.x, y: N2.y, vx: 300, vy: 0, x0: N1.x, y0: N1.y, t0: t - 500, range: 600, from: 'p2' },
      { id: 'b1', kind: 'ball', x: F1.x, y: F1.y, vx: 0, vy: 300, x0: F1.x, y0: F1.y - 100, t0: t - 300, range: 500, from: null },
    ],
    minimapMobs: [{ x: N2.x, y: N2.y, kind: 'elite', camp: 0 }, { x: F2.x, y: F2.y, kind: 'mob', camp: 1 }],
    events: [
      { kind: 'hit', t, at: { x: N1.x, y: N1.y }, by: 'p2', amount: 5 },
      { kind: 'hit', t, at: { x: F1.x, y: F1.y }, by: 'p3', amount: 5 },
      { kind: 'death', t, id: 'm9', at: { x: F2.x, y: F2.y }, by: 'p3', mob: true },
      { kind: 'death', t, id: 'p3', at: { x: F1.x, y: F1.y }, mob: false },
      { kind: 'death', t, id: 'p2', at: { x: N1.x, y: N1.y }, by: null, mob: false },
      { kind: 'toast', t, at: null, text: 'hello' },
      { kind: 'block', t, at: { x: N2.x, y: N2.y }, by: 'p3' },
    ],
    extras: {
      wish: { ready: true },
      effects: { p1: 1, p2: 2, p3: 4, 7: 8, m9: 16, zz: 32, 12: 64 },
      fields,
      camps: [{ index: 0, state: 'idle' }],
      chests: [{ id: 'k1', x: N2.x, y: N2.y, kind: 'reward' }, { id: 'k2', x: F2.x, y: F2.y, kind: 'reward' }],
      reveals: { 3: 'gold' },
    },
  });
  return {
    id: 'filter-families',
    purpose: 'fighters/mobs/containers/projectiles/minimap/events/fields (both trail ends)/chests/effects, death redaction, effect key order, delayed retention',
    steps: [
      update(state({ t: 60000, players: ps(A) }), undefined, 'scan from A'),
      filter(full(60000, A), 'complete family filter'),
      filter(percept({ t: 60000, self: A, extras: { fields: null, effects: {} } }), 'null fields untouched; empty effects stays an empty object'),
      filter(percept({ t: 60000, self: A, fighters: [fighter('p2', N1)], extras: {} }), 'no effects key: none added'),
      update(state({ t: 60100, players: ps(G) }), undefined, 'moved more than 900 away: A cells retained by the trail'),
      filter(full(60100, G), 'delayed rows at the A trail are retained; far rows still dropped'),
      update(state({ t: 60200, players: ps(G) }), undefined, 'reuse from G'),
      filter(full(60200, G)),
    ],
  };
}

/** Each throwing case is a fresh BotVision whose only throwing step is last: no partial state is reused. */
function throwing() {
  const ok = [[SELF, player(A)]];
  return [
    { id: 'throw-private-null', purpose: 'source throws on a nullish private message (Rust refuses)', expectThrow: true,
      steps: [update(state({ t: 1000, players: ok }), [null])] },
    { id: 'throw-player-null', purpose: 'source throws reading extra of a nullish player (Rust refuses)', expectThrow: true,
      steps: [update(state({ t: 1000, players: [...ok, ['p2', null]] }))] },
    { id: 'throw-minimap-mobs', purpose: 'source throws filtering a minimap without mobs (Rust refuses)', expectThrow: true,
      steps: [update(state({ t: 1000, players: ok })), filter({ ...percept({ t: 1000, self: A }), minimap: { t: 1000, gatesLocked: false } })] },
    { id: 'throw-event-at', purpose: 'source throws on an event whose at is undefined (Rust refuses)', expectThrow: true,
      steps: [update(state({ t: 1000, players: ok })), filter(percept({ t: 1000, self: A, events: [{ kind: 'hit', t: 1000, by: 'p2' }] }))] },
    { id: 'disabled-skips-throwing-reads', purpose: 'a disabled update reads neither privates nor players, so nothing throws',
      steps: [update(state({ t: 1000, phase: 'lobby', players: [...ok, ['p2', null]] }), [null]), probe([F1])] },
  ];
}

export function cases() {
  return [resetGates(), trailThrottle(), reconnect(), bushReveal(), wards(), gates(), filterFamilies(), ...throwing()];
}
