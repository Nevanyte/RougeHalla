import {types, shared} from './runtime.mts';
import {NOW, MAP, ME, at, config, observe, sent, fighter, mob, dot, container, projectile, event, hit, ext, campView} from './builders.mts';
const note = (tc: any) => ({method: 'noteSent', input: tc});
const query = (id: string, now: number) => ({method: 'whereabouts', input: {id, now}});
export function memoryCases(): any[] {
  const out: any[] = [];
  const add = (id: string, covers: string[], operations: any[], cfg: any = {}) => out.push({id, suite: 'memory-api', config: config(cfg), covers, operations});
  const allCommands = [
    ['move', {...at(400), seq: 9}], ['stop', {seq: 10}], ['target', {id: 'foe'}], ['attack', {a: -0, t: NOW}],
    ['release', {a: 0, t: NOW + 1}], ['swap', {slot: 1}], ['pickup', {containerId: 'box'}],
    ['cast', {slot: 'wish', ...at(50), id: 'foe', seq: 7}], ['cast', {slot: 'q', ...at(50)}],
    ['cast', {slot: 'e', ...at(50), id: undefined}], ['plan', {spawn: 1, boon: 0, ready: true}],
    ['choose', {chest: 'reward', pick: 1, replace: 0}], ['useConsumable', {kind: 'heal'}],
  ];
  add('memory-api-command-shapes', ['Memory.initial', 'Memory.noteSent-all-command-shapes', 'Memory.recordChoice-order-duplicates', 'MethodValue.undefined-null-negative-zero'], [
    {method: 'nullPercept', input: null}, observe(), ...allCommands.map(([type, msg], i) => note(sent(NOW + i, type as string, msg))),
    ...['opener|fire|sentenced', 'second|fire|bow', 'opener|fire|sentenced'].map((input) => ({method: 'recordChoice', input})),
    query('missing', NOW), observe(NOW + 50),
  ]);
  add('memory-orders-reflection-arrival-and-failure', ['Memory.order-move-seq', 'Memory.order-walked', 'Memory.order-stop', 'Memory.order-target', 'Memory.order-failure400', 'Memory.arrival24'], [
    observe(), note(sent(NOW, 'move', {...at(400), seq: 4})),
    observe(NOW + 399), observe(NOW + 400),
    note(sent(NOW + 450, 'move', {...at(100), seq: 5})),
    observe(NOW + 500, {self: {moveSeq: 5, x: ME.x + 50}}),
    observe(NOW + 550, {self: {moveSeq: 5, x: ME.x + 76}}),
    note(sent(NOW + 600, 'move', at(400))),
    observe(NOW + 650, {self: {moveSeq: 5, x: ME.x + 84}}), observe(NOW + 1000, {self: {moveSeq: 5, x: ME.x + 84}}),
    note(sent(NOW + 1050, 'move', at(400))),
    observe(NOW + 1100, {self: {moveSeq: 5, x: ME.x + 92.001}}), observe(NOW + 1450, {self: {moveSeq: 5, x: ME.x + 92.001}}),
    note(sent(NOW + 1500, 'stop', {})), observe(NOW + 1550),
    note(sent(NOW + 1600, 'stop', {seq: 6})), observe(NOW + 2000, {self: {moveSeq: 5}}),
    note(sent(NOW + 2050, 'target', {id: 'foe'})), observe(NOW + 2100, {self: {attackTarget: 'foe'}, fighters: [fighter()]}),
    note(sent(NOW + 2150, 'target', {id: 'other'})), observe(NOW + 2550, {fighters: [fighter()]}),
  ]);
  add('memory-pickup-refusal-window-and-container-absence', ['Memory.pickup-refusal-regex', 'Memory.pickup5000', 'Memory.container-undefined-null', 'Memory.loose60000'], [
    observe(NOW, {containers: [container('box'), container('unknown', 150, {kind: 'chest', weapon: undefined}), container('empty', 200, {weapon: null})]}),
    note(sent(NOW, 'pickup', {containerId: 'box'})), observe(NOW + 5000, {events: [event('toast', NOW + 5000, {text: "Can't reach that"})]}),
    observe(NOW + 5100, {containers: [container('box2')]}), note(sent(NOW + 5100, 'pickup', {containerId: 'box2'})),
    observe(NOW + 10101, {events: [event('toast', NOW + 10101, {text: 'Nothing to take'})]}),
    observe(NOW + 60000), observe(NOW + 60001),
  ]);
  add('memory-fighters-events-and-permanent-death', ['Memory.all-eight-outputs', 'Memory.trade-hit-block', 'Memory.chasing', 'Memory.bounty', 'Memory.death-no-resurrection', 'Memory.announcement-never-seen'], [
    observe(NOW, {fighters: [fighter('foe', 200, {vx: -170, hpFrac: .4, bounty: 6}), fighter('third', -300)]}),
    observe(NOW + 50, {fighters: [fighter('foe', 200, {inHand: 'bow'}), fighter('third', -300)],
      events: [hit(NOW + 50, 'foe', 'third', 12), event('block', NOW + 50, {id: 'third', by: 'foe', weapon: 'shield'}), hit(NOW + 50, 'me', 'foe', 10)], self: {hp: 90}}),
    observe(NOW + 100, {fighters: [fighter('foe', 200, {inHand: null}), fighter('third', -300)], events: [hit(NOW + 100, 'foe', 'me', 5)]}),
    observe(NOW + 150, {fighters: [fighter('foe', 200, {inHand: 'wand'})], events: [event('bounty', NOW + 150, {id: 'ghost', name: 'Ghost', bounty: 30})]}),
    query('ghost', NOW + 150),
    observe(NOW + 200, {events: [event('death', NOW + 200, {id: 'third', name: 'Third', by: 'foe', mob: false}), event('victory', NOW + 200, {id: null, name: null, draw: true})]}),
    observe(NOW + 250, {fighters: [fighter('third', -300)], events: [event('death', NOW + 250, {id: 'stranger', name: 'Never seen', by: null, mob: false})]}),
    query('stranger', NOW + 250), observe(NOW + 20000), observe(NOW + 20151),
  ]);
  for (const tier of ['easy', 'normal', 'hard']) {
    const span = types.TIERS[tier].memorySpanMs;
    add('memory-expiry-' + tier, ['Memory.whereabouts-exact-expiry', 'Memory.no-position-extrapolation', 'Memory.hp-forget', 'Memory.stillness-anchor'], [
      observe(NOW, {fighters: [fighter('非ASCII😀', 200, {vx: 100, vy: -50, hpFrac: .2})]}),
      query('非ASCII😀', NOW - 1), query('非ASCII😀', NOW + 19999), query('非ASCII😀', NOW + span), query('非ASCII😀', NOW + span + .001),
      observe(NOW + 20000), observe(NOW + 20000.001),
      observe(NOW + span + 10, {self: {x: ME.x + 1}}), observe(NOW + span + 20, {self: {x: ME.x + 1.001}}),
    ], {tier});
  }
  add('memory-lock-hp-credit-and-teleport', ['Memory.lock-dying-wait', 'Memory.lock-purpose-drop', 'Memory.hp-credit', 'Memory.teleport', 'Memory.spectator-stimuli'], [
    observe(NOW, {self: {attackTarget: 'foe'}, fighters: [fighter('foe', 200, {hpFrac: .1})]}),
    observe(NOW + 50, {self: {hp: 90}, fighters: [fighter('foe', 200, {hpFrac: .1})], events: [hit(NOW + 40, 'me', 'foe', 10)]}),
    observe(NOW + 109, {fighters: []}), observe(NOW + 110), observe(NOW + 1550),
    note(sent(NOW + 1600, 'stop', {})), observe(NOW + 1650),
    observe(NOW + 1700, {self: {hp: 80}, events: [hit(NOW + 1700, 'me', null, 5)]}),
    observe(NOW + 1800, {self: {hp: 80}, events: [event('teleport', NOW + 1750)], hud: {inColiseum: true}}),
    observe(NOW + 1850, {self: {status: 'dead', hp: 0}, events: [event('bounty', NOW + 1850, {id: 'foe', name: 'Foe', bounty: 30}), hit(NOW + 1850, 'me', 'foe')]}),
    observe(NOW + 1900, {self: {status: 'mia', hp: 0}}),
  ]);
  add('memory-active-lock-purpose-drop-and-contrast', ['Memory.purpose-drop-active-lock', 'Memory.nonintentional-lock-loss'], [
    observe(NOW, {self: {attackTarget: 'foe'}, fighters: [fighter('foe', 200, {hpFrac: 1})]}),
    note(sent(NOW + 10, 'stop', {})),
    observe(NOW + 50, {fighters: [fighter('foe', 200, {hpFrac: 1})]}),
    observe(NOW + 2000, {self: {attackTarget: 'foe'}, fighters: [fighter('foe', 200, {hpFrac: 1})]}),
    observe(NOW + 2050, {fighters: [fighter('foe', 200, {hpFrac: 1})]}),
  ]);
  add('memory-windup-draw-feint-projectiles', ['Memory.windup-bow-wand', 'Memory.feint', 'Memory.incoming', 'Memory.reflection-event-filter'], [
    observe(NOW, {fighters: [fighter('foe', 200, {inHand: 'bow', drawStartedAt: NOW})], projectiles: [projectile()],
      events: [event('windup', NOW, {by: 'foe', weapon: 'bow', a: Math.PI, ms: 400})]}),
    observe(NOW + 100, {fighters: [fighter('foe', 200, {inHand: 'bow', drawStartedAt: NOW})], projectiles: [projectile()], events: [event('cancel', NOW + 100, {id: 'foe'})]}),
    observe(NOW + 400, {fighters: [fighter()], events: [event('windup', NOW + 400, {by: 'foe', weapon: 'wand', a: 0, ms: 100}), event('cancel', NOW + 400, {id: 'foe'})],
      projectiles: [projectile({id: 'away', vx: 380}), projectile({id: 'miss', y: ME.y + 400}), projectile({id: 'arrow', kind: 'arrow', vx: -800})]}),
    observe(NOW + 600, {fighters: [fighter()], events: [event('windup', NOW + 600, {by: 'foe', weapon: 'sword', a: Math.PI, ms: 300}), event('swing', NOW + 600, {by: 'foe', weapon: 'sword', a: Math.PI})]}),
  ]);
  const wishOps: any[] = [];
  for (const [i, faction] of shared.FACTION_IDS.entries()) {
    const t = NOW + i * 100;
    wishOps.push(observe(t, {fighters: [fighter('caster', 200, {faction})], events: [ext(t, 'castLand', {by: 'caster', ability: shared.wishOf(faction).id, x: ME.x, y: ME.y})]}));
  }
  wishOps.push(observe(NOW + 600, {fighters: [fighter('caster')], events: [ext(NOW + 600, 'castLand', {by: 'caster', ability: 'unknown'}), ext(NOW + 600, 'castLand', {by: null}), ext(NOW + 600, 'castLand', {by: 'me'}), ext(NOW + 600, 'cast', {by: 'caster'})]}));
  add('memory-wish-plan-chest', ['Memory.Wish-castLand-five-factions', 'Memory.Wish-fallback', 'Memory.plan-private-extras', 'Memory.chest-once'], [
    ...wishOps,
    observe(NOW + 700, {extras: {plan: {endsAt: NOW + 5000, spawns: [0, 1], taken: [false, true], boons: ['a', 'b']}, chests: [{id: 'reward', ...ME, expiresAt: NOW + 20000, options: null, takenBy: [], picked: false}]}}),
    observe(NOW + 750, {extras: {plan: {endsAt: NOW + 5000, spawns: [0, 1], taken: [false, true], boons: ['a', 'b']}, chests: [{id: 'reward', ...ME, expiresAt: NOW + 20000, options: ['a'], takenBy: [], picked: false}]}}),
    observe(NOW + 800, {events: [event('private', NOW + 800, {type: 'plan', msg: {endsAt: NOW + 6000}}), event('private', NOW + 800, {type: 'reveal', msg: {camp: 0, reward: 'ap'}})]}),
  ]);
  const c = MAP.camps[0], home = c.spots[0];
  add('memory-mob-dot-home-return-clear', ['Memory.mob-dot-only', 'Memory.mob-visible-only', 'Memory.never-dotted-absence', 'Memory.mob-return-home', 'Memory.camp-clear-contest-visit'], [
    observe(NOW, {minimap: {mobs: [{id: 'dotted', ...home, faction: c.zone, elite: false}]}, mobs: [mob('visible-only', 100)]}),
    observe(NOW + 50, {mobs: [mob('dotted', 100, {...home, faction: c.zone, hpFrac: .4})], minimap: {mobs: [{id: 'dotted', ...home, faction: c.zone, elite: false}]}}),
    observe(NOW + 100, {mobs: [mob('dotted', 100, {x: home.x + 80, y: home.y, faction: c.zone, hpFrac: .4})], minimap: {mobs: [{id: 'dotted', x: home.x + 80, y: home.y, faction: c.zone, elite: false}]}}),
    observe(NOW + 150, {mobs: [mob('dotted', 100, {x: home.x + 80, y: home.y, faction: c.zone, hpFrac: .43})], minimap: {mobs: [{id: 'dotted', x: home.x + 80, y: home.y, faction: c.zone, elite: false}]}}),
    observe(NOW + 200, {mobs: [mob('dotted', 100, {...home, faction: c.zone, hpFrac: .6})], minimap: {mobs: [{id: 'dotted', ...home, faction: c.zone, elite: false}]}, self: {x: c.x, y: c.y}, fighters: [fighter('camper', 0, {x: c.x, y: c.y})]}),
    observe(NOW + 250, {extras: {camps: [campView(c, 0, {state: 2, alive: 0})]}}),
    observe(NOW + 300, {mobs: [mob('visible-only', 100, {status: 'dead', hpFrac: 0})]}),
  ]);
  return out;
}
