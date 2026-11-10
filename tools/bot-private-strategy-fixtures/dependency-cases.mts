import {shared, hunt, types, route} from './runtime.mts';
import {NOW, ME, config, observe, mob, dot, fighter, hit, at, routeCamp, routeInput, mobLike, huntInput} from './builders.mts';
const adapterDecide = (o: any = {}) => ({method: 'adapterDecide', ...o});
const hunterDecide = (input: any) => ({method: 'hunterDecide', input});
const update = (input: any) => ({method: 'routeUpdate', input});
const plan = (input: any) => ({method: 'routePlan', input});
export function dependencyCases(): any[] {
  const out: any[] = [];
  const add = (suite: string, id: string, covers: string[], operations: any[], cfg: any = {}) => out.push({suite, id, config: config(cfg), covers, operations});
  const tq = (id: string, now: number, extra: any = {}) => ({method: 'trackerQuery', input: {id, now, from: {x: 0, y: 0}, radius: 400, awakeMoved: 40, ...extra}});
  add('mob-tracker', 'tracker-home-rise-expiry-removal', ['Tracker.home-first', 'Tracker.rise-half-strict', 'Tracker.return1500-strict', 'Tracker.awake-move40-strict',
    'Tracker.dead-missing-nonregional', 'Tracker.reiterable-map'], [
    {method: 'trackerObserve', input: {now: 1000, mobs: [mobLike('m', 100), mobLike('other', 200), mobLike('dummy', 10, {kind: 'dummy'})]}},
    tq('m', 1000), tq('missing', 1000),
    {method: 'trackerObserve', input: {now: 1100, mobs: [mobLike('m', 140, {hp: 100.5}), mobLike('other', 200)]}}, tq('m', 1100),
    {method: 'trackerObserve', input: {now: 1200, mobs: new Map([mobLike('m', 140.001, {hp: 101.001})])}},
    tq('m', 1200), tq('m', 2699.999), tq('m', 2700), tq('other', 2700),
    {method: 'trackerObserve', input: {now: 2800, mobs: [mobLike('m', 140.001, {status: 'dead', hp: 0})]}}, tq('m', 2800),
    {method: 'trackerObserve', input: {now: 2900, mobs: []}}, tq('m', 2900),
  ]);
  add('mob-hunter', 'hunter-player-priority-lock-release-coliseum', ['Hunter.player-threat-release', 'Hunter.under-fire-exact', 'Hunter.coliseum-priority'], [
    hunterDecide(huntInput(1000)),
    hunterDecide(huntInput(1100, undefined, {playerDistance: 249.999})),
    hunterDecide(huntInput(1200, undefined, {playerDistance: 449.999})),
    hunterDecide(huntInput(1300, undefined, {playerDistance: 450})),
    hunterDecide(huntInput(2000, undefined, {playerDistance: 500, shotByPlayerAt: 501})),
    hunterDecide(huntInput(2100, undefined, {playerDistance: 520, shotByPlayerAt: 601})),
    hunterDecide(huntInput(2200, undefined, {inColiseum: true, playerDistance: 0})),
  ]);
  add('mob-hunter', 'hunter-sleeping-low-hp-no-retreat', ['Hunter.sleeping-low-hp-ban-no-retreat'], [
    hunterDecide(huntInput(1000)), hunterDecide(huntInput(1100, undefined, {self: {hp: 34.999}})),
    hunterDecide(huntInput(16099)), hunterDecide(huntInput(16100)),
  ]);
  add('mob-hunter', 'hunter-awake-retreat-min-max-and-ban', ['Hunter.awake-retreat-min', 'Hunter.retreat-max', 'Hunter.retreat-staying-off'], [
    hunterDecide(huntInput(1000)), hunterDecide(huntInput(1100, [mobLike('m', 150, {hp: 90})], {self: {hp: 30}, players: [{x: 500, y: 0}]})),
    hunterDecide(huntInput(2599.999, [])), hunterDecide(huntInput(2600, [])),
    hunterDecide(huntInput(16100)),
    hunterDecide(huntInput(16200, [mobLike('m', 150, {hp: 90})], {self: {hp: 30}})),
    hunterDecide(huntInput(21200, [mobLike('m', 150, {hp: 90})], {self: {hp: 30}})),
  ]);
  add('mob-hunter', 'hunter-rising-drop-ban-expiry', ['Hunter.rising-drop-return-ban', 'Hunter.isBanned-expiry-mutates-map', 'Hunter.down-gone'], [
    hunterDecide(huntInput(1000, [mobLike('m', 100, {hp: 40})])),
    hunterDecide(huntInput(1100, [mobLike('m', 150, {hp: 41})])),
    {method: 'isBanned', input: {id: 'm', now: 9099.999}}, {method: 'isBanned', input: {id: 'm', now: 9100}},
    hunterDecide(huntInput(9200, [mobLike('m', 100, {hp: 41})])),
    hunterDecide(huntInput(9300, [mobLike('m', 100, {hp: 0, status: 'dead'})])),
    hunterDecide(huntInput(9800)), hunterDecide(huntInput(9900, [])),
  ]);
  add('mob-hunter', 'hunter-stall-damage-reset-and-time-caps', ['Hunter.stall3000', 'Hunter.damage-half-strict-reset', 'Hunter.dt250-cap', 'Hunter.target-budget60000'], [
    hunterDecide(huntInput(1000, [mobLike('m', 100, {hp: 100})], {attacking: true})),
    ...Array.from({length: 10}, (_, i) => hunterDecide(huntInput(1250 + i * 250, [mobLike('m', 100, {hp: 100})], {attacking: true}))),
    hunterDecide(huntInput(3750, [mobLike('m', 100, {hp: 99.5})], {attacking: true})),
    hunterDecide(huntInput(4000, [mobLike('m', 100, {hp: 99.499})], {attacking: true})),
    ...Array.from({length: 12}, (_, i) => hunterDecide(huntInput(4250 + i * 250, [mobLike('m', 100, {hp: 99.499})], {attacking: true}))),
    {method: 'isBanned', input: {id: 'm', now: 36999.999}},
    hunterDecide(huntInput(40000)), hunterDecide(huntInput(100000)),
  ]);
  add('mob-hunter', 'hunter-approach-and-focus-budget', ['Hunter.approach12000', 'Hunter.focus-budget', 'Hunter.kill-goal'], [
    hunterDecide(huntInput(1000)),
    ...Array.from({length: 48}, (_, i) => hunterDecide(huntInput(1250 + i * 250))),
    hunterDecide(huntInput(14000, undefined, {self: {mobKills: 5}})),
    hunterDecide(huntInput(15000, undefined, {self: {mobKills: 0}})),
  ], {huntOverrides: {focusBudgetMs: 13000}});
  const filterInputs: any[] = [
    ['nonregional-dead', [mobLike('dummy', 10, {kind: 'dummy'}), mobLike('dead', 10, {status: 'dead'})], {}],
    ['first-reach', [mobLike('m', 1000)], {}], ['regular-reach', [mobLike('m', 1000)], {self: {mobKills: 1}}],
    ['low-start', [mobLike()], {self: {hp: 49.999}}], ['null-maxhp-faction', [mobLike()], {self: {faction: null, maxHp: 0}}],
    ['elite-gated', [mobLike('elite', 100, {kind: 'elite'})], {elitesReady: false}],
    ['elite-power', [mobLike('elite', 100, {kind: 'elite'})], {self: {power: 6, weapons: ['axe', 'wand']}, elitesReady: true}],
    ['elite-progress-stacks', [mobLike('elite', 100, {kind: 'elite'})], {self: {mobStats: {emberImp: 120}, weapons: ['axe', 'wand']}}],
    ['useless', [mobLike('m', 100, {weapon0: 'shield'})], {}],
    ['ranged-skipped', [mobLike('m', 100, {weapon0: 'bow'})], {}], ['ranged-carried', [mobLike('m', 100, {weapon0: 'bow'})], {self: {weapons: ['bow', 'wand']}}],
    ['walk-null', [mobLike()], {walk: {kind: 'null'}}], ['walk-slack', [mobLike('m', 900)], {walk: {kind: 'open', factor: 2}}],
    ['off-build', [mobLike('m', 300)], {self: {mobKills: 1}, typeWeights: [['pardoner', .25]]}],
    ['wanted-build', [mobLike('m', 300), mobLike('other', 400, {type: 'emberImp'})], {self: {mobKills: 1}, typeWeights: [['pardoner', .25], ['emberImp', 1]]}],
    ['contest-choice-ties', [mobLike('first', 100), mobLike('second', -100)], {players: [{x: 105, y: 0}]}],
    ['fists-unknownweapon', [mobLike('m', 100, {weapon0: '', faction: 'unknown'})], {self: {weapons: [null, null]}}],
  ];
  for (const [id, mobs, overrides] of filterInputs)
    add('mob-hunter', 'hunter-filter-' + id, ['Hunter.pick-filters-' + id], [hunterDecide(huntInput(1000, mobs, overrides))]);
  add('mob-hunter', 'hunter-repick-exact-and-budget', ['Hunter.repick400', 'Hunter.time-budget-exact'], [
    hunterDecide(huntInput(1000, [])), hunterDecide(huntInput(1399.999)), hunterDecide(huntInput(1400)),
    hunterDecide(huntInput(1650)), hunterDecide(huntInput(1900)),
  ], {huntOverrides: {focusBudgetMs: 500}});
  // Adapter cases always build memory by observe; no installed MobMemory or alternate hunter is used.
  for (const tier of ['easy', 'normal', 'hard']) add('hunt-adapter', 'adapter-walks-and-source-home-' + tier,
    ['Adapter.tier-config-path', 'Adapter.seed-home', 'Adapter.blocked-threat-factor', 'Adapter.release-real-hunter'], [
      observe(NOW, {minimap: {mobs: [dot('m', 100)]}}),
      observe(NOW + 50, {mobs: [mob('m', 180, {hpFrac: .4})], minimap: {mobs: [dot('m', 180)]}}), adapterDecide(),
      {method: 'awakeNear', input: {from: ME, radius: 400, now: NOW + 50}},
      observe(NOW + 300, {mobs: [mob('m', 180, {hpFrac: .4})], minimap: {mobs: [dot('m', 180)]}, fighters: [fighter('screened', -100, {los: false})]}), adapterDecide(),
      {method: 'release'}, observe(NOW + 350, {mobs: [mob('m', 180, {hpFrac: .4})], minimap: {mobs: [dot('m', 180)]}}), adapterDecide(),
  ], {tier});
  add('hunt-adapter', 'adapter-remembered-fighter-age-and-returning', ['Adapter.whereabouts5000-strict', 'Adapter.returning-excluded', 'Adapter.mob-maxhp-name-zone-fallback'], [
    observe(NOW, {fighters: [fighter('rival', 560)], mobs: [mob('near', 500), mob('far', 500, {y: ME.y + 520, faction: 'fire', name: 'Magma Brute', type: 'magmaBrute', inHand: 'axe'})], minimap: {mobs: [dot('near', 500), dot('far', 500, {y: ME.y + 520, faction: 'fire'})]}}), adapterDecide(),
    observe(NOW + 4999, {minimap: {mobs: [dot('near', 500), dot('far', 500, {y: ME.y + 520, faction: 'fire'})]}}), adapterDecide(),
    observe(NOW + 5000, {minimap: {mobs: [dot('near', 500), dot('far', 500, {y: ME.y + 520, faction: 'fire'})]}}), adapterDecide(),
    observe(NOW + 6000, {mobs: [mob('near', 580, {hpFrac: .4})], minimap: {mobs: [dot('near', 580)]}}), adapterDecide(),
    observe(NOW + 6100, {mobs: [mob('near', 580, {hpFrac: .5})], minimap: {mobs: [dot('near', 580)]}}), adapterDecide(),
  ]);
  for (const gap of [240, 240.001, 3360, 3360.001, 5000]) add('hunt-adapter', 'adapter-catchup-' + gap,
    ['Adapter.catchup240-strict', 'Adapter.catchup14-cap', 'Adapter.source-stall-clock'], [
      observe(NOW, {mobs: [mob('m')], minimap: {mobs: [dot('m')]}}), adapterDecide(),
      observe(NOW + gap, {mobs: [mob('m')], minimap: {mobs: [dot('m')]}}), adapterDecide(),
      observe(NOW + gap + 1200, {mobs: [mob('m')], minimap: {mobs: [dot('m')]}}), adapterDecide(),
  ], {attacking: true});
  const camps = [routeCamp(0, 500, 'fire', 'flameCaller'), routeCamp(1, 800, 'fire', 'emberImp'), routeCamp(2, 1100, 'fire', 'pardoner')];
  for (const faction of shared.FACTION_IDS) for (const buildDraw of [.499999, .5]) add('build-route', 'route-build-' + faction + '-' + buildDraw,
    ['Route.five-factions-both-builds', 'Route.greedy-value-sequence'], [update(routeInput(100000, camps))], {faction, buildDraw});
  const contested = [routeCamp(0, 600), routeCamp(1, 1500, 'fire', 'emberImp')];
  add('build-route', 'route-contest-remote-loss-and-expiry', ['Route.remote-alive-loss', 'Route.immediate-replan', 'Route.contested30000-strict'], [
    update(routeInput(100000, contested)),
    update(routeInput(100500, [{...contested[0], alive: 3, state: 1}, contested[1]])),
    {method: 'isContested', input: {camp: 0, now: 130499.999}}, {method: 'isContested', input: {camp: 0, now: 130500}},
    update(routeInput(130500, contested)),
  ]);
  add('build-route', 'route-zone-hit-memory-and-avoid', ['Route.player-contest', 'Route.zone-two-hits', 'Route.zone-avoid-expiry'], [
    plan(routeInput(100000, [routeCamp(0, 600), routeCamp(1, 900), routeCamp(2, 2000, 'sentenced', 'bailiff')])),
    update(routeInput(100000, [routeCamp(0, 600), routeCamp(1, 900), routeCamp(2, 2000, 'sentenced', 'bailiff')], {players: [{x: 600, y: 0}, {x: 900, y: 0}]})),
    plan(routeInput(130001, [routeCamp(0, 600), routeCamp(1, 900), routeCamp(2, 2000, 'sentenced', 'bailiff')])),
    plan(routeInput(160000, [routeCamp(0, 600), routeCamp(1, 900), routeCamp(2, 2000, 'sentenced', 'bailiff')])),
    update(routeInput(190000, [routeCamp(0, 600), routeCamp(1, 900), routeCamp(2, 2000, 'sentenced', 'bailiff')], {players: [{x: 600, y: 0}]})),
  ]);
  add('build-route', 'route-stolen-unplanned-sticky-broken-replan', ['Route.stolen-heading', 'Route.unplanned-not-contested', 'Route.sticky-engaged-not-contested', 'Route.broken-route', 'Route.replan8000-exact'], [
    update(routeInput(100000, [routeCamp(0, 800, 'fire', 'emberImp'), routeCamp(1, 1200), routeCamp(2, 5000, 'fire', 'flameCaller')], {canFarm: {kind: 'indices', allow: [0, 1]}})),
    update(routeInput(100500, [routeCamp(0, 800, 'fire', 'emberImp', {state: 2, alive: 0, respawnAt: 105000}), routeCamp(1, 1200), routeCamp(2, 5000, 'fire', 'flameCaller', {alive: 1})], {canFarm: {kind: 'indices', allow: [0, 1]}, players: [{x: 5000, y: 0}]})),
    update(routeInput(108499.999, [routeCamp(1, 1200, 'fire', 'pardoner', {state: 1})])),
    update(routeInput(108500, [routeCamp(1, 1200, 'fire', 'pardoner', {state: 1})])),
    update(routeInput(108501, [])),
  ]);
  for (const reverse of [false, true]) {
    const tie = [routeCamp(0, 500), routeCamp(1, -500)];
    add('build-route', 'route-exact-tie-' + reverse, ['Route.lower-index-tie-independent-input-order'], [plan(routeInput(100000, reverse ? tie.reverse() : tie))]);
  }
  add('build-route', 'route-contest-player320-boundary', ['Route.player-contest320-inclusive'], [
    update(routeInput(100000, [routeCamp(0, 600), routeCamp(1, 1500)])),
    update(routeInput(100001, [routeCamp(0, 600), routeCamp(1, 1500)], {players: [{x: 920, y: 0}]})),
  ]);
  add('build-route', 'route-respawn-elite-filters-and-values', ['Route.respawn-wait-max', 'Route.elite-time-kills-power', 'Route.zero-value-speed-floor', 'Route.canFarm-callback'], [
    plan(routeInput(100000, [routeCamp(0, 300, 'fire', 'pardoner', {state: 2, alive: 0, respawnAt: 110000}), routeCamp(1, 300, 'fire', 'pardoner', {state: 2, alive: 0, respawnAt: 200000})])),
    plan(routeInput(108000, [routeCamp(0, 400, 'fire', 'pardoner', {elite: true}), routeCamp(1, 400, 'fire', 'flameCaller')])),
    plan(routeInput(116000, [routeCamp(0, 400, 'fire', 'pardoner', {elite: true})], {runMs: 360000, mobKills: 12})),
    plan(routeInput(124000, [routeCamp(0, 400, 'fire', 'pardoner', {elite: true})], {power: 6, speed: 0})),
    plan(routeInput(132000, [routeCamp(0, 300), routeCamp(1, 400, 'fire', 'emberImp')], {canFarm: {kind: 'indices', allow: [1]}})),
    {method: 'campValue', input: {camp: routeCamp(0, 100, 'fire', 'pardoner', {elite: true, alive: 0}), elites: true}},
    {method: 'campValue', input: {camp: routeCamp(0, 100, 'fire', 'pardoner', {elite: true}), elites: false}},
  ]);
  return out;
}
