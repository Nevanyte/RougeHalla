import {shared, types} from './runtime.mts';
import {NOW, MAP, ME, at, config, observe, decide, tick, fighter, mob, dot, container, hit, event, campView} from './builders.mts';
const idle = {kind: 'idle'};
const moduleGoal = (n: any) => ({kind: 'module', module: 'declared', data: {n}});
const offer = (n: any, utility: number, over: any = {}) => ({goal: moduleGoal(n), utility, why: 'declared module ' + n, ...over});
const mods = (goals: any[]) => [{id: 'declared', enabled: true, goals}];
export function strategyCases(): any[] {
  const out: any[] = [];
  const add = (id: string, covers: string[], operations: any[], cfg: any = {}) => out.push({id, suite: 'strategy', config: config(cfg), covers,
    operations: operations.map((op) => op.method === 'observe' && cfg.id ? {...op, input: {...op.input, self: {...op.input.self, id: cfg.id}}} : op)});
  // Each matrix member has its own real Memory and real source Knowledge, streams, hunt adapter and strategy state.
  for (const tier of ['easy', 'normal', 'hard']) for (const persona of types.PERSONA_IDS) {
    add('strategy-matrix-' + tier + '-' + persona, ['Strategy.all-tiers-personas', 'Strategy.farm-hunt-loot', 'Strategy.softmax-lapse-source-streams'], [
      ...tick(NOW, {mobs: [mob('meal', 300)], minimap: {mobs: [dot('meal', 300)]}, fighters: [fighter('rival', -600, {hpFrac: .25, faction: 'fire'})], containers: [container('bow', 200)]}),
      ...tick(NOW + 1500, {mobs: [mob('meal', 300, {hpFrac: .7})], minimap: {mobs: [dot('meal', 300)]}, fighters: [fighter('rival', -600, {hpFrac: .25, faction: 'fire'})], containers: [container('bow', 200)]}),
    ], {tier, persona});
  }
  add('strategy-modules-dedup-tie-hysteresis-status', ['Strategy.module-enabled-order-missing-goals', 'Strategy.module-lower-clamp-only', 'Strategy.dedup-replacement-keeps-order',
    'Strategy.hysteresis', 'Strategy.failed5000-done1500-exact', 'Strategy.blocked', 'Strategy.choice-omitted-when-kept'], [
    ...tick(NOW),
    decide({current: moduleGoal(1), status: {state: 'blocked', why: 'declared blocked'}, env: {moduleGoals: {declared: [offer(1, 1, {choice: 'second|fire|bow'}), offer(2, 1.05)]}}}),
    ...tick(NOW + 1, {}, {current: moduleGoal(1), env: {moduleGoals: {declared: [offer(1, 1), offer(2, 1.1)]}}}),
    ...tick(NOW + 2, {}, {current: moduleGoal(2), status: {state: 'failed', why: 'declared fail'}}),
    ...tick(NOW + 5001), ...tick(NOW + 5002),
    ...tick(NOW + 5100, {}, {current: moduleGoal(3), status: {state: 'done', why: 'declared done'}}),
    ...tick(NOW + 6599), ...tick(NOW + 6600),
  ], {tierOverrides: {softmaxT: 0, lapseP: 0}, modules: [
    {id: 'off', enabled: false, goals: [offer('off', 100)]}, {id: 'missing', enabled: true},
    ...mods([offer(1, .9, {choice: 'second|fire|bow'}), offer(2, .95), offer(1, .9), offer(3, -1), offer(1, 1), offer(4, 2.5)]),
  ]});
  add('strategy-lapse-top-three-and-softmax', ['Strategy.lapse-two-draws-top-three', 'Strategy.softmax-no-lapse'], [
    ...tick(NOW), ...tick(NOW + 1000), ...tick(NOW + 2000),
  ], {tierOverrides: {softmaxT: .2, lapseP: .5}, random: {lapse: [0, .99, .9, .25, .01]}, modules: mods([offer(1, .8), offer(2, .9), offer(3, 1), offer(4, 1.1)])});
  add('strategy-tunnel-fight-flee-and-not-alive', ['Strategy.tunnel-no-pick-draw', 'Strategy.reconsider-exact', 'Strategy.flee-interrupts-fight', 'Strategy.not-alive-retains-private-state',
    'Strategy.fight-lock-hit-fallback'], [
    ...tick(NOW, {self: {attackTarget: 'rival'}, fighters: [fighter('rival', 120)]}, {engaged: true, current: {kind: 'fight', target: 'rival'}}),
    ...tick(NOW + types.TIERS.hard.attention.reconsiderMs - 1, {self: {attackTarget: 'rival'}, fighters: [fighter('rival', 120)]}, {engaged: true}),
    ...tick(NOW + types.TIERS.hard.attention.reconsiderMs, {self: {attackTarget: 'rival'}, fighters: [fighter('rival', 120)]}, {engaged: true}),
    ...tick(NOW + 2000, {self: {hp: 20}, fighters: [fighter('rival', 120)], events: [hit(NOW + 2000)]}, {engaged: true, current: {kind: 'fight', target: 'rival'}}),
    ...tick(NOW + 2100, {self: {status: 'dead', hp: 0}}),
    ...tick(NOW + 2200, {self: {status: 'mia', hp: 0}}),
    ...tick(NOW + 2300, {fighters: [fighter('rival', 200)], events: [hit(NOW + 2300)]}, {engaged: true, current: idle}),
  ], {persona: 'cautious', modules: mods([offer('interrupt', 1.2)])});
  const chaseLimit = types.PERSONAS.hunter.chaseGiveUpMs + 750;
  const rivals = (distance: number) => [fighter('追跡😀', distance, {hpFrac: .1}), fighter('other', -600, {hpFrac: .1})];
  add('strategy-pursuit-progress-timeout-hit-release', ['Strategy.unitHash-utf16', 'Strategy.chase-progress40-strict', 'Strategy.chase-timeout-strict', 'Strategy.avoid-hit-expiry-near',
    'Strategy.chase-reset-nonhunt'], [
    ...tick(NOW, {fighters: rivals(700)}, {current: {kind: 'hunt', target: '追跡😀'}}),
    ...tick(NOW + 500, {fighters: rivals(660)}, {current: {kind: 'hunt', target: '追跡😀'}}),
    ...tick(NOW + chaseLimit, {fighters: rivals(660)}, {current: {kind: 'hunt', target: '追跡😀'}}),
    ...tick(NOW + chaseLimit + .001, {fighters: rivals(660)}, {current: {kind: 'hunt', target: '追跡😀'}}),
    ...tick(NOW + chaseLimit + 100, {fighters: rivals(660), events: [hit(NOW + chaseLimit + 100, 'me', '追跡😀', 1)]}),
    ...tick(NOW + chaseLimit + 200, {fighters: rivals(700)}, {current: {kind: 'hunt', target: '追跡😀'}}),
    ...tick(NOW + 2 * chaseLimit + 201, {fighters: rivals(700)}, {current: {kind: 'hunt', target: '追跡😀'}}),
    ...tick(NOW + 2 * chaseLimit + 202, {fighters: [fighter('追跡😀', 700, {hpFrac: .1})]}),
    ...tick(NOW + 2 * chaseLimit + 203, {fighters: rivals(149.999)}, {current: idle}),
    ...tick(NOW + 2 * chaseLimit + 6201, {fighters: rivals(659)}, {current: {kind: 'hunt', target: '追跡😀'}}),
    ...tick(NOW + 2 * chaseLimit + 6300, {fighters: rivals(618)}, {current: {kind: 'hunt', target: '追跡😀'}}),
  ], {persona: 'hunter', random: {decide: Array(1000).fill(.5)}, tierOverrides: {softmaxT: 0, lapseP: 0}});
  add('strategy-avoid-last-standing-and-exact-expiry', ['Strategy.avoid-last-one-fallback', 'Strategy.avoid-expiry-exact'], [
    ...tick(NOW, {fighters: rivals(700)}, {current: {kind: 'hunt', target: '追跡😀'}}),
    ...tick(NOW + chaseLimit + .001, {fighters: rivals(700)}, {current: {kind: 'hunt', target: '追跡😀'}}),
    ...tick(NOW + chaseLimit + .002, {fighters: [fighter('追跡😀', 700, {hpFrac: .1})],
      events: [event('death', NOW + chaseLimit + .002, {id: 'other', name: 'Other', by: null, mob: false})]}),
    ...tick(NOW + chaseLimit + 6000.001, {fighters: [fighter('追跡😀', 700, {hpFrac: .1})]}),
  ], {persona: 'hunter', random: {decide: Array(1000).fill(.5)}, tierOverrides: {softmaxT: 0, lapseP: 0}});
  add('strategy-appraisal-third-party-aged-memory', ['Strategy.appraisal-cache5000', 'Strategy.third-party-hit-block-dead-partner', 'Strategy.remembered5000-12000-lastSeen', 'Strategy.bounty-max',
    'Strategy.hidden-position-real-whereabouts'], [
    ...tick(NOW, {fighters: [fighter('rival', 650, {hpFrac: .25, bounty: 10}), fighter('third', -500)], events: [hit(NOW, 'rival', 'third'), event('block', NOW, {id: 'third', by: 'rival', weapon: 'shield'})]}),
    ...tick(NOW + 4999, {fighters: [fighter('rival', 650, {hpFrac: .25})], events: [event('bounty', NOW + 4999, {id: 'rival', name: 'Rival', bounty: 40})]}),
    ...tick(NOW + 5000, {fighters: [fighter('rival', 650, {hpFrac: .25})]}),
    ...tick(NOW + 6000),
    ...tick(NOW + 6050, {events: [hit(NOW + 6050, 'rival', 'third'), event('block', NOW + 6050, {id: 'third', by: 'rival', weapon: 'shield'})]}),
    ...tick(NOW + 6100, {events: [event('death', NOW + 6100, {id: 'third', name: 'Third', by: null, mob: false})]}),
    ...tick(NOW + 10000), ...tick(NOW + 17000), ...tick(NOW + 17000.001), ...tick(NOW + 40000),
    ...tick(NOW + 40100, {fighters: [fighter('rival', 650, {status: 'dead'})]}),
  ], {persona: 'hunter'});
  add('strategy-flee-renew-cornered-ban-evade', ['Strategy.flee-hp-ramp-depth', 'Strategy.flee-done-renews', 'Strategy.flee-cornered-ban', 'Strategy.flee-failure-ban', 'Strategy.evade-wary-hysteresis'], [
    ...tick(NOW, {self: {hp: 30}, fighters: [fighter('rival', 250)]}),
    ...tick(NOW + 3000, {self: {hp: 70}, fighters: [fighter('rival', 300)]}, {status: {state: 'done', why: 'flee leg done'}}),
    ...tick(NOW + 12000, {self: {hp: 70}, fighters: [fighter('rival', 100)]}),
    ...tick(NOW + 18000, {self: {hp: 30}, fighters: [fighter('rival', 200)]}),
    ...tick(NOW + 18500, {self: {hp: 30}, fighters: [fighter('rival', 200)]}, {status: {state: 'failed', why: 'cornered'}}),
    ...tick(NOW + 24500, {self: {hp: 100}, fighters: [fighter('rival', 200, {vx: -170, hpFrac: 1})], hud: {raidStartedAt: NOW + 20000}}),
    ...tick(NOW + 25000, {self: {hp: 100}, fighters: [fighter('rival', 500, {vx: -170, hpFrac: 1})], hud: {raidStartedAt: NOW + 20000}}),
  ], {persona: 'cautious'});
  add('strategy-loot-skip-budget-expiry-and-counters', ['Strategy.loot-failed-skip30000', 'Strategy.loot-budget8000-strict', 'Strategy.loot-undefined-null', 'Strategy.loot-counter-fullhands',
    'Strategy.loot-enemy-race-near', 'Strategy.learned-finite-clamp-disabled'], [
    ...tick(NOW, {containers: [container('bow'), container('unknown', 150, {kind: 'body', weapon: undefined}), container('empty', 200, {weapon: null})]}),
    ...tick(NOW + 1, {containers: [container('bow')]}, {current: {kind: 'loot', container: 'bow'}, status: {state: 'failed', why: 'declared pickup failure'}}),
    ...tick(NOW + 30000, {containers: [container('bow')]}), ...tick(NOW + 30001, {containers: [container('bow')]}),
    ...tick(NOW + 31000, {containers: [container('bow')]}, {current: {kind: 'loot', container: 'bow'}}),
    ...tick(NOW + 39000, {containers: [container('bow')]}, {current: {kind: 'loot', container: 'bow'}}),
    ...tick(NOW + 39000.001, {containers: [container('bow')]}, {current: {kind: 'loot', container: 'bow'}}),
    ...tick(NOW + 70000, {self: {weapons: ['wand', 'shield']}, containers: [container('bow')], fighters: [fighter('axe-foe', 2000, {inHand: 'axe'})]}),
    ...tick(NOW + 71000, {containers: [container('raced', 200)], fighters: [fighter('racer', 380)]}),
    ...tick(NOW + 72000, {containers: [container('close')], fighters: [fighter('close', 239.999)]}),
  ], {persona: 'opportunist', learned: {enabled: true, entries: [['second|fire|bow', Infinity], ['opener|fire|sentenced', -10]]}});
  add('strategy-learned-opener-choice-and-hunt-release', ['Strategy.opener-recordChoice', 'Strategy.learned-bounded-bias', 'Strategy.nonfarm-releases-real-hunter'], [
    ...tick(NOW, {mobs: [mob('meal')], minimap: {mobs: [dot('meal')]} }),
    {method: 'recordChoice', input: 'opener|fire|sentenced'},
    ...tick(NOW + 1500, {mobs: [mob('meal', 100, {hpFrac: .9})], minimap: {mobs: [dot('meal')]}}),
    ...tick(NOW + 2000, {mobs: [mob('meal', 100, {hpFrac: .9})], minimap: {mobs: [dot('meal')]}}, {env: {moduleGoals: {declared: [offer('takeover', 3)]}}}),
    ...tick(NOW + 2100, {mobs: [mob('meal', 100, {hpFrac: .8})], minimap: {mobs: [dot('meal')]}}, {env: {moduleGoals: {declared: []}}}),
  ], {learned: {enabled: true, entries: [['opener|fire|sentenced', 10]]}, modules: mods([])});
  add('strategy-coliseum-patience-hold-and-sudden-death', ['Strategy.coliseum-hold-spot', 'Strategy.coliseum-odds-edge', 'Strategy.coliseum-patience', 'Strategy.sudden-death-hunts',
    'Strategy.patience-dash-exact', 'Strategy.hold-current-safe'], [
    ...tick(NOW, {events: [event('teleport', NOW)], hud: {inColiseum: true}, fighters: [fighter('rival', 400)]}),
    ...tick(NOW + 1000, {hud: {inColiseum: true}, fighters: [fighter('rival', 100)]}, {current: {kind: 'hold', at: at(-500), why: 'coliseum'}}),
    ...tick(NOW + 50000, {hud: {inColiseum: true}, fighters: [fighter('rival', 400), fighter('weak', -300, {hpFrac: .1})]}),
    ...tick(NOW + 51000, {hud: {inColiseum: true, suddenDeathAt: NOW + 51000}, fighters: [fighter('rival', 400), fighter('weak', -300, {hpFrac: .1})]}),
    ...tick(NOW + 52000, {hud: {inColiseum: false, patienceEndsAt: NOW + 72000}}),
    ...tick(NOW + 52001, {hud: {inColiseum: false, patienceEndsAt: NOW + 72000}}),
    ...tick(NOW + 72000, {hud: {patienceEndsAt: NOW + 72000}}),
  ], {persona: 'cautious'});
  for (const faction of shared.FACTION_IDS) add('strategy-route-five-factions-' + faction, ['Strategy.route-five-factions', 'Strategy.route-public-extras', 'Strategy.unitHash-utf16', 'Strategy.camp-candidate-walk-limit'], [
    ...tick(NOW, {self: {faction, weapons: ['axe', 'wand']}, extras: {camps: MAP.camps.map((c: any, i: number) => campView(c, i))}}),
    ...tick(NOW + 8000, {self: {faction, weapons: ['axe', 'wand'], speedMult: 0}, extras: {camps: MAP.camps.map((c: any, i: number) => campView(c, i, {state: i === 0 ? 2 : 0, alive: i === 0 ? 0 : c.spots.length, respawnAt: NOW + 12000}))}}),
  ], {id: 'route-非ASCII😀', persona: 'farmer'});
  for (const path of [{kind: 'null'}, {kind: 'coordinate-block', minX: ME.x, maxX: ME.x + 800}, {kind: 'source'}, {kind: 'open', factor: 1.3, exact: false}])
    add('strategy-path-' + path.kind + (path.factor ?? ''), ['Strategy.path-null-blocked-source-fallback'], [...tick(NOW, {mobs: [mob('meal', 400)], minimap: {mobs: [dot('meal', 400)]}})], {path});
  add('strategy-dedup-equal-and-higher-retains-slot', ['Strategy.dedup-equal-strict', 'Strategy.dedup-higher-retains-insertion'], [
    ...tick(NOW),
    ...tick(NOW + 1, {}, {env: {moduleGoals: {declared: [offer(1, .9, {why: 'first'}), offer(2, .95), offer(1, 1, {why: 'higher'})]}}}),
  ], {tierOverrides: {softmaxT: 0, lapseP: 0}, modules: mods([offer(1, .9, {why: 'first'}), offer(2, .95), offer(1, .9, {why: 'equal-must-lose'})])});
  add('strategy-route-and-mob-weight-coupling', ['Strategy.real-route-typeweight-and-elite-readiness', 'Strategy.feature-conditioned-module'], [
    ...tick(NOW, {self: {weapons: ['axe', 'wand']}, mobs: [mob('farm', 100, {name: 'Ember Imp', type: 'emberImp', faction: 'fire', inHand: 'axe'})],
      minimap: {mobs: [dot('farm', 100, {faction: 'fire'})]}, extras: {camps: MAP.camps.map((c: any, i: number) => campView(c, i))}}),
    ...tick(NOW + 1500, {self: {weapons: ['axe', 'wand'], power: 6, mobKills: 12}, mobs: [mob('farm', 100, {name: 'Ember Imp', type: 'emberImp', faction: 'fire', inHand: 'axe', hpFrac: .8})],
      minimap: {mobs: [dot('farm', 100, {faction: 'fire'})]}, extras: {camps: MAP.camps.map((c: any, i: number) => campView(c, i))}}),
  ], {modules: [{id: 'feature-off', enabled: 'relics', goals: [offer('off', 100)]}]});
  add('strategy-module-consumes-current-context', ['Strategy.module-current-context-when-after-hp'], [
    ...tick(NOW, {self: {hp: 100}}), ...tick(NOW + 1, {self: {hp: 100}}), ...tick(NOW + 2, {self: {hp: 79}}),
  ], {tierOverrides: {softmaxT: 0, lapseP: 0}, modules: mods([offer('conditional', 2.5, {when: {after: NOW + 1, hpBelow: 80}})])});
  // The fallback is earned through actual Memory visits, not an installed camp-memory map.
  add('strategy-earned-patrol-visits-wait-fallback', ['Strategy.patrol-revisit', 'Strategy.wait-fallback', 'Strategy.lie-low', 'Strategy.centre'], [
    ...MAP.camps.map((c: any, i: number) => observe(NOW + i * 50, {self: {x: c.x, y: c.y, mobKills: 50}})),
    ...tick(NOW + 5000, {self: {x: MAP.w * shared.TILE / 2, y: MAP.h * shared.TILE / 2, mobKills: 50}}),
    ...tick(NOW + 6000, {self: {hp: 30, x: MAP.w * shared.TILE / 2, y: MAP.h * shared.TILE / 2, mobKills: 50}}),
    ...tick(NOW + 51000, {self: {mobKills: 50}}),
  ], {persona: 'hunter', tierOverrides: {softmaxT: 0, lapseP: 0}});
  return out;
}
