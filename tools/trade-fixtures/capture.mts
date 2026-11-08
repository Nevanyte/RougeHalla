// Canonical actual-source neutral-trader witness, captured in the pinned linux/amd64 Node 22.23.4 container.
// Drives the real legacy gameplay world (createGameWorld: production module order, quests on so the native enable switch
// matches, generated map seed 1 attempt 0) through the ordinary input queue: trader spawn/placement, wandering, the Soul
// Broker's fixed stat offers, a stat exchange and the barter villager's three trades with their cooldown/refusals.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {generateMap} from '/repo/packages/shared/src/mapgen.ts';
import {createGameWorld} from '/repo/packages/server/src/sim/gameplay.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {enqueueClientMessage} from '/repo/packages/server/src/sim/inputs.ts';
import {combatant} from '/repo/packages/server/src/sim/combatant.ts';
import {grantCard} from '/repo/packages/server/src/sim/chests.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string', 'closed capture arguments');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const TICK_MS = 50;
const SEED = 1;
const ATTEMPT = 0;
const RANDOM_SEED = 12;
const REWARD_SALT = [1, 2, 3, 4];
const PLAYERS = [
  {faction: 'holy', name: 'name0'},
  {faction: 'fire', name: 'name1'},
  {faction: 'plague', name: 'name2'},
];
const CONFIG = {
  minPlayers: 2, lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
  suddenDeathSeconds: 3600, mobs: true, signatures: false, quests: true, training: false, dummies: false, planSeconds: 0,
  pvpRules: false,
};

const traderView = (w: any): any[] => [...w.state.traders]
  .map(([id, t]: any) => ({
    id, kind: t.kind, name: t.name, x: t.x, y: t.y,
    nextWalkAt: w.traders?.walkers?.get(id)?.nextWalkAt ?? 0,
  }))
  .sort((a: any, b: any) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const parseOffer = (raw: string): any => {
  const v = JSON.parse(raw);
  return {cost: v.cost, costValue: v.costValue, gain: v.gain, gainValue: v.gainValue, label: v.label};
};
const barterAt = (w: any): any => {
  const out: any = {};
  for (const [id, at] of [...(w.traders?.barterAt ?? new Map())].sort(([a]: any, [b]: any) => (a < b ? -1 : 1))) out[id] = at;
  return out;
};
const playerView = (w: any): any[] => PLAYERS.map((_p, i) => {
  const id = 'p' + i;
  const s = w.state.players.get(id)!;
  const offers = (s.tradeOffers ?? []).map(parseOffer);
  const stats: any = {};
  for (const [key, value] of [...(s.tradeStats ?? new Map())].sort(([a]: any, [b]: any) => (a < b ? -1 : 1))) stats[key] = value;
  return {
    id: i, weapon0: s.weapon0, weapon1: s.weapon1, slot: s.slot, potionSmall: s.potionSmall,
    hp: s.hp, maxHp: s.maxHp,
    mirrors: {
      asMult: s.asMult, windupMult: s.windupMult, speedMult: s.speedMult,
      armorBonus: s.armorBonus, shieldBonus: s.shieldBonus, adBonus: s.adBonus, apBonus: s.apBonus,
    },
    tradeUsed: s.tradeUsed, tradeOffers: offers, tradeStats: stats,
  };
});
const destinationsDigest = (w: any): any => {
  const dests = w.traders?.destinations ?? [];
  let fold = 0n;
  for (const p of dests) fold = (fold * 1099511628211n + BigInt(Math.round(p.x)) * 1000003n + BigInt(Math.round(p.y))) & 0xffffffffffffffffn;
  return {count: dests.length, fold: fold.toString(16)};
};

function open(): any {
  const map: any = generateMap(SEED, ATTEMPT, {decor: false});
  let uid = 0;
  const w: any = createGameWorld({
    seed: SEED,
    map,
    config: CONFIG,
    random: mulberry32(RANDOM_SEED),
    rewardSalt: REWARD_SALT,
    newItemUid: () => 'U' + ++uid,
  }, {signatures: false, walkHints: false});
  for (let i = 0; i < PLAYERS.length; i++) addPlayer(w, 'p' + i, PLAYERS[i].name, {faction: PLAYERS[i].faction as any});
  step(w, TICK_MS);
  assert.equal(w.state.phase, 'active');
  assert.ok(w.traders, 'the traders spawned at the raid start');
  return w;
}

function runner(name: string) {
  const w = open();
  const actions: any[] = [];
  let seq = 0;
  const frames: any[] = [];
  const push = (kind: string, extra: any): void => { actions.push({tick: w.state.tick, seq: seq++, kind, ...extra}); };
  const place = (actor: string, x: number, y: number): void => {
    const s = w.state.players.get(actor)!;
    const rt = w.players.get(actor)!;
    s.x = x; s.y = y; s.facing = 0;
    rt.history = [{t: w.state.serverTime, x, y}];
    push('place', {actor: Number(actor.slice(1)), x, y});
  };
  const setWeapon = (actor: string, weapon: string): void => {
    const s = w.state.players.get(actor)!;
    s.weapon0 = weapon; s.weapon1 = ''; s.slot = 0;
    push('weapon', {actor: Number(actor.slice(1)), weapon});
  };
  const grant = (actor: string, card: string): void => {
    assert.notEqual(grantCard(w, combatant(w, actor) as any, card), null, 'the source granted the card');
    push('grantCard', {actor: Number(actor.slice(1)), card});
  };
  const setPotion = (actor: string, count: number): void => {
    w.state.players.get(actor)!.potionSmall = count;
    push('potion', {actor: Number(actor.slice(1)), count});
  };
  const trade = (actor: string, trader: string, pick: number): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, 'trade', {trader, pick}), true, 'the source parsed the trade message');
    push('input', {actor: Number(actor.slice(1)), type: 'trade', payload: {trader, pick}});
  };
  const snap = (label: string): void => {
    frames.push({
      label, actionCount: actions.length, tick: w.state.tick, time: w.state.serverTime,
      traders: traderView(w), destinations: destinationsDigest(w), barterAt: barterAt(w), players: playerView(w),
    });
  };
  const runSteps = (n: number): void => { for (let i = 0; i < n; i++) step(w, TICK_MS); };
  const initial = PLAYERS.map((_p, i) => {
    const s = w.state.players.get('p' + i)!;
    return {x: s.x, y: s.y, faction: s.faction};
  });
  const output = (script: any): any => ({
    input: {
      name, map: {seed: SEED, attempt: ATTEMPT, decor: false}, config: CONFIG, players: PLAYERS, initial,
      seeds: {random: RANDOM_SEED, rewardSalt: REWARD_SALT},
    },
    script, actions, frames,
  });
  const snapshot = snap;
  snapshot('start');
  return {w, trade, place, setWeapon, grant, setPotion, snap, runSteps, output, frames, actions};
}

const trader = (w: any, kind: string): any => [...w.state.traders.values()].find((t: any) => t.kind === kind)!;
const cases: any[] = [];

// 1. Spawn and placement: both villagers, the destination grid, and one quiet tick.
{
  const r = runner('spawn');
  r.runSteps(1);
  r.snap('one-tick');
  cases.push(r.output({}));
}

// 2. Wandering with nobody nearby: the walker takes a path and moves for 200 ticks.
{
  const r = runner('wander');
  r.runSteps(1);
  r.snap('tick-2');
  r.runSteps(199);
  r.snap('tick-201');
  cases.push(r.output({}));
}

// 3. A visitor freezes the broker and rolls the three offers once; moving away cannot reroll them.
{
  const r = runner('stat-offer');
  const broker = trader(r.w, 'stats');
  r.place('p0', broker.x, broker.y);
  r.runSteps(1);
  r.snap('offers-rolled');
  r.place('p0', broker.x + 400, broker.y + 400);
  r.runSteps(5);
  r.snap('offers-kept');
  cases.push(r.output({}));
}

// 4. The stat exchange: one pick applies its stat deltas (folded mirrors/max hp), a second trade is refused.
{
  const r = runner('stat-trade');
  const broker = trader(r.w, 'stats');
  r.place('p0', broker.x, broker.y);
  r.runSteps(1);
  r.trade('p0', 'trader-stats', 0);
  r.runSteps(1);
  r.snap('traded');
  r.trade('p0', 'trader-stats', 1);
  r.runSteps(1);
  r.snap('second-refused');
  cases.push(r.output({}));
}

// 5. The barter villager: sword → the cycle's first weapon, then the cooldown refusal, then the potion trade and the
// potion → second weapon trade; a fist-only visitor cannot give anything.
{
  const r = runner('barter');
  const villager = trader(r.w, 'barter');
  r.setWeapon('p0', 'sword');
  r.place('p0', villager.x, villager.y);
  r.runSteps(1);
  r.trade('p0', 'trader-barter', 0);
  r.runSteps(1);
  r.snap('traded-weapon');
  r.trade('p0', 'trader-barter', 1);
  r.runSteps(1);
  r.snap('cooldown-refused');
  r.runSteps(100);
  r.trade('p0', 'trader-barter', 1);
  r.runSteps(1);
  r.snap('traded-potion');
  r.runSteps(100);
  r.trade('p0', 'trader-barter', 2);
  r.runSteps(1);
  r.snap('traded-second-weapon');
  r.setWeapon('p1', 'fists');
  r.place('p1', villager.x, villager.y);
  r.runSteps(1);
  r.trade('p1', 'trader-barter', 0);
  r.runSteps(1);
  r.snap('fists-refused');
  cases.push(r.output({}));
}

// 6. The Committed lockSecondSlot refusal: p0 owns Committed (the real grantCard producer) so the only empty slot is the
// locked second one and the potion -> second-weapon trade must refuse without spending the potion or starting the
// cooldown; p1, without the card, makes the same trade into slot 1.
{
  const r = runner('barter-locked-second-slot');
  const villager = trader(r.w, 'barter');
  r.grant('p0', 'committed');
  r.setWeapon('p0', 'sword');
  r.setPotion('p0', 1);
  r.place('p0', villager.x, villager.y);
  r.runSteps(1);
  r.trade('p0', 'trader-barter', 2);
  r.runSteps(1);
  r.snap('locked-refused');
  const p0 = r.w.state.players.get('p0')!;
  assert.equal(p0.weapon0, 'sword');
  assert.equal(p0.weapon1, '', 'the locked slot stays empty');
  assert.equal(p0.potionSmall, 1, 'the refusal spends no potion');
  assert.equal(r.w.traders.barterAt.has('p0'), false, 'the refusal does not start the cooldown');
  // Positive control in the same world: the same trade without Committed succeeds.
  r.setWeapon('p1', 'sword');
  r.setPotion('p1', 1);
  r.place('p1', villager.x, villager.y);
  r.runSteps(1);
  r.trade('p1', 'trader-barter', 2);
  r.runSteps(1);
  r.snap('unlocked-traded');
  const p1 = r.w.state.players.get('p1')!;
  assert.equal(p1.weapon1, 'wand', 'the free second slot takes the cycle weapon');
  assert.equal(p1.potionSmall, 0);
  assert.equal(r.w.traders.barterAt.has('p1'), true);
  cases.push(r.output({lockedPlayer: 0, unlockedPlayer: 1}));
}

const repeat = cases.map((c) => ({name: c.input.name, script: c.script, actions: c.actions, frames: c.frames}));
assert.deepEqual(repeat, cases.map((c) => ({name: c.input.name, script: c.script, actions: c.actions, frames: c.frames})), 'declared repeat');

const sourceFiles = ['packages/shared/src', 'packages/server/src/sim'].flatMap((dir) =>
  readdirSync('/repo/' + dir, {recursive: true}).filter((p: string) => p.endsWith('.ts')).map((p: string) => dir + '/' + p),
);
const sourceSha256 = Object.fromEntries(sourceFiles.map((p: string) => [p, createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex')]));
const body = {
  format: 'rh-trade-source/1',
  provenance: {
    image: 'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
    platform: 'linux/amd64',
    node: process.version,
    sourceSha256,
    map: {seed: SEED, attempt: ATTEMPT, decor: false},
  },
  cases,
};
const text = JSON.stringify(body, null, 1) + '\n';
const sha = createHash('sha256').update(text).digest('hex');
if (args[0] === '--write') {
  writeFileSync(outPath, text);
  console.log(JSON.stringify({written: outPath, bytes: text.length, sha256: sha, cases: cases.length}));
} else {
  const existing = readFileSync(outPath, 'utf8');
  assert.equal(createHash('sha256').update(existing).digest('hex'), sha, 'the checked-in corpus is byte-identical');
  console.log(JSON.stringify({checked: outPath, bytes: existing.length, sha256: sha, cases: cases.length}));
}
