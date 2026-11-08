// Canonical actual-source G6 heal-barrier witness, captured in the pinned linux/amd64 Node 22.23.4 container.
// Drives the unmodified legacy world through the real producers (grantCard, the factions heal funnel, arena applyDamage,
// the training console and the arena lifecycle) and records the public player state plus the private buffs boost timer.
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
import {heal} from '/repo/packages/server/src/sim/factions.ts';
import {applyDamage, downPlayer} from '/repo/packages/server/src/sim/arena.ts';
import {installTraining} from '/repo/packages/server/src/sim/training.ts';

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
const TRAIN_CONFIG = {
  minPlayers: 1, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 0, patienceMinSeconds: 0,
  suddenDeathSeconds: 0, mobs: true, signatures: false, quests: false, training: true, dummies: true, planSeconds: 0,
  pvpRules: false,
};

const r6 = (v: any): any => typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v;
const boostOf = (w: any, id: string): any => {
  const b = w.players.get(id)?.boost;
  // The source keeps the empty BoostRuntime object after a clear; only a set timer is semantically private state.
  if (!b || !(b.shieldUntil > 0)) return null;
  return {shieldUntil: r6(b.shieldUntil), decays: b.decays === true};
};
const playerView = (w: any): any[] => PLAYERS.map((_p, i) => {
  const id = 'p' + i;
  const s = w.state.players.get(id);
  if (!s) return null;
  return {
    id: i, faction: s.faction, x: r6(s.x), y: r6(s.y), hp: r6(s.hp), maxHp: r6(s.maxHp),
    barrier: r6(s.barrier), status: s.status, slot: s.slot, weapon0: s.weapon0, weapon1: s.weapon1,
    potionSmall: s.potionSmall, boost: boostOf(w, id),
  };
});

function open(training = false, patienceSeconds = 3600, signatures = false): any {
  const map: any = generateMap(SEED, ATTEMPT, {decor: false});
  let uid = 0;
  const w: any = createGameWorld({
    seed: SEED,
    map,
    config: training ? TRAIN_CONFIG : {...CONFIG, patienceSeconds, patienceMinSeconds: patienceSeconds},
    random: mulberry32(RANDOM_SEED),
    rewardSalt: REWARD_SALT,
    newItemUid: () => 'U' + ++uid,
  }, {signatures, walkHints: false});
  if (training) installTraining(w);
  for (let i = 0; i < (training ? 1 : PLAYERS.length); i++) {
    addPlayer(w, 'p' + i, PLAYERS[i].name, {faction: PLAYERS[i].faction as any});
  }
  step(w, TICK_MS);
  assert.equal(w.state.phase, 'active');
  return w;
}

function runner(name: string, opts: {training?: boolean; patienceSeconds?: number; signatures?: boolean} = {}) {
  const w = open(opts.training === true, opts.patienceSeconds ?? 3600, opts.signatures === true);
  const actions: any[] = [];
  let seq = 0;
  const frames: any[] = [];
  const push = (kind: string, extra: any): void => { actions.push({tick: w.state.tick, seq: seq++, kind, ...extra}); };
  const place = (actor: string, x: number, y: number): void => {
    const s = w.state.players.get(actor)!;
    s.x = x; s.y = y; s.facing = 0;
    w.players.get(actor)!.history = [{t: w.state.serverTime, x, y}];
    push('place', {actor: Number(actor.slice(1)), x, y});
  };
  const setWeapon = (actor: string, weapon: string): void => {
    const s = w.state.players.get(actor)!;
    s.weapon0 = weapon; s.weapon1 = ''; s.slot = 0;
    push('weapon', {actor: Number(actor.slice(1)), weapon});
  };
  const setHp = (actor: string, hp: number): void => {
    w.state.players.get(actor)!.hp = hp;
    push('setHp', {actor: Number(actor.slice(1)), hp});
  };
  const setMaxHp = (actor: string, maxHp: number): void => {
    const s = w.state.players.get(actor)!;
    s.maxHp = maxHp;
    push('setMaxHp', {actor: Number(actor.slice(1)), maxHp});
  };
  const setBarrier = (actor: string, barrier: number, until = 0, decays = false): void => {
    const s = w.state.players.get(actor)!;
    s.barrier = barrier;
    if (until === 0 && decays === false) {
      (w.players.get(actor) as any).boost = undefined;
    } else {
      (w.players.get(actor) as any).boost = {shieldUntil: until, decays: decays ? true : undefined};
    }
    push('setBarrier', {actor: Number(actor.slice(1)), barrier, until, decays});
  };
  const grant = (actor: string, card: string): void => {
    assert.notEqual(grantCard(w, combatant(w, actor) as any, card), null, 'the source granted ' + card);
    push('grantCard', {actor: Number(actor.slice(1)), card});
  };
  const healOn = (actor: string, amount: number, kind: string): number => {
    const opts: any = kind === 'lifesteal' ? {lifesteal: true}
      : kind === 'ignoreLockout' ? {ignoreLockout: true}
      : kind === 'quietRegen' ? {quiet: true, ignoreLockout: true, noBarrier: true}
      : kind === 'quietOrdinary' ? {quiet: true}
      : {};
    const gained = heal(w, combatant(w, actor) as any, amount, opts);
    push('heal', {actor: Number(actor.slice(1)), amount, healKind: kind});
    return gained;
  };
  const damage = (actor: string, amount: number): number => {
    const c = combatant(w, actor) as any;
    const dealt = applyDamage(w, c.s, c.rt, amount, 'declared');
    push('damage', {actor: Number(actor.slice(1)), amount});
    return dealt;
  };
  const down = (actor: string): void => {
    const c = combatant(w, actor) as any;
    downPlayer(w, c.s, c.rt, 'died');
    push('down', {actor: Number(actor.slice(1))});
  };
  const setImmunity = (actor: string, until: number): void => {
    w.state.players.get(actor)!.immuneUntil = until;
    push('setImmunity', {actor: Number(actor.slice(1)), until});
  };
  const train = (actor: string, command: Record<string, any>): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, 'train', {cmd: 'clear'}, {training: true}), true, 'the source took the console command');
    push('train', {actor: Number(actor.slice(1)), command});
  };
  const attack = (actor: string, a: number): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, 'attack', {a}), true, 'the source took the attack');
    push('input', {actor: Number(actor.slice(1)), type: 'attack', payload: {a}});
  };
  const snap = (label: string): void => {
    frames.push({label, actionCount: actions.length, tick: w.state.tick, time: w.state.serverTime,
      phase: w.state.phase, players: playerView(w)});
  };
  const runSteps = (n: number): void => { for (let i = 0; i < n; i++) step(w, TICK_MS); };
  const initial = PLAYERS.slice(0, opts.training ? 1 : PLAYERS.length).map((_p, i) => {
    const s = w.state.players.get('p' + i)!;
    return {x: s.x, y: s.y, faction: s.faction, hp: r6(s.hp), maxHp: r6(s.maxHp)};
  });
  const output = (script: any): any => ({
    input: {name, training: opts.training === true, signatures: opts.signatures === true, patienceSeconds: opts.patienceSeconds ?? 3600,
      map: {seed: SEED, attempt: ATTEMPT, decor: false}, config: opts.training ? TRAIN_CONFIG : CONFIG,
      players: PLAYERS.slice(0, opts.training ? 1 : PLAYERS.length), initial,
      seeds: {random: RANDOM_SEED, rewardSalt: REWARD_SALT}},
    script, actions, frames,
  });
  const snapshot = snap;
  snapshot('start');
  return {w, grant, healOn, damage, down, setHp, setMaxHp, setBarrier, setImmunity, setWeapon, place, train, attack, snap, runSteps, output, frames, actions};
}

const cases: any[] = [];

// 1. Grant, add, clamp on grant and the five-second deadline extension (real grantCard + real heal funnel).
{
  const r = runner('grant-overheal-cap');
  r.grant('p0', 'leech1');
  r.grant('p0', 'secondSkin');
  r.setHp('p0', 200);
  r.healOn('p0', 100, 'ordinary');
  r.snap('first-grant');
  r.setHp('p0', 500);
  r.healOn('p0', 1000, 'ordinary');
  r.snap('overheal-cap');
  r.runSteps(1);
  r.healOn('p0', 50, 'ordinary');
  r.snap('grant-clamps-current');
  r.runSteps(1);
  r.snap('after-tick');
  cases.push(r.output({}));
}

// 2. Decay at the fixed 20 Hz step, the reachable decay-to-zero tuple and the next pass's clear.
{
  const r = runner('decay-expiry-zero');
  r.grant('p0', 'leech1');
  r.grant('p0', 'secondSkin');
  r.healOn('p0', 1000, 'ordinary');
  r.snap('granted');
  for (let i = 0; i < 99; i++) r.runSteps(1);
  r.snap('near-zero');
  r.runSteps(1);
  r.snap('zero-while-timed');
  r.runSteps(1);
  r.snap('cleared');
  cases.push(r.output({}));
}

// 3. Lifesteal healing also stands as barrier (the source heal funnel's lifesteal call).
{
  const r = runner('lifesteal-barrier');
  r.grant('p0', 'leech1');
  r.grant('p0', 'secondSkin');
  r.setHp('p0', 300);
  r.healOn('p0', 50, 'lifesteal');
  r.snap('lifesteal-grant');
  r.runSteps(1);
  r.snap('same-tick-decay');
  cases.push(r.output({}));
}

// 4. Refusals, zero and no-barrier heals: regen, locked-out ordinary, a zero amount, and Vampiric Pact's zero heal.
{
  const r = runner('no-barrier-heals');
  r.grant('p0', 'leech1');
  r.grant('p0', 'secondSkin');
  r.setHp('p0', 100);
  r.runSteps(1);
  r.snap('regen-tick');
  r.damage('p0', 10);
  r.runSteps(1);
  r.healOn('p0', 50, 'ordinary');
  r.snap('lockout-refused');
  r.healOn('p0', 0, 'ordinary');
  r.grant('p0', 'vampiricPact');
  r.healOn('p0', 50, 'ordinary');
  r.snap('vampiric-zero');
  r.runSteps(1);
  r.snap('after');
  cases.push(r.output({}));
}

// 5. Absorption, immunity and death: a barrier takes damage first; immunity prevents it; the death tick ends with none.
{
  const r = runner('absorb-immunity-death');
  r.grant('p0', 'leech1');
  r.grant('p0', 'secondSkin');
  r.healOn('p0', 1000, 'ordinary');
  r.snap('barrier-up');
  r.damage('p0', 50);
  r.snap('partial-absorb');
  r.runSteps(1);
  r.snap('after-absorb-tick');
  r.setImmunity('p0', r.w.state.serverTime + 1500);
  r.damage('p0', 50);
  r.snap('immune');
  r.runSteps(1);
  r.setImmunity('p0', 0);
  r.setBarrier('p0', 1000);
  r.snap('overwhelming-seeded-barrier');
  r.damage('p0', 500);
  r.snap('swallowed-whole');
  r.healOn('p0', 500, 'ordinary');
  r.snap('heal-barrier-back');
  r.setHp('p0', 10);
  r.down('p0');
  r.snap('downed');
  r.runSteps(1);
  r.snap('dead-no-barrier');
  cases.push(r.output({}));
}

// 6. A max-hp decrease after a grant leaves an over-cap barrier (the source clamps only on grant).
{
  const r = runner('maxhp-decrease');
  r.grant('p0', 'leech1');
  r.grant('p0', 'secondSkin');
  r.healOn('p0', 1000, 'ordinary');
  r.snap('cap-125');
  r.setMaxHp('p0', 300);
  r.snap('over-cap-valid');
  r.runSteps(1);
  r.snap('decays-from-over-cap');
  r.healOn('p0', 100, 'ordinary');
  r.snap('grant-clamps-to-new-cap');
  cases.push(r.output({}));
}

// 7. A timerless seeded barrier is left alone by the expiry system (the source proof fixtures' shape).
{
  const r = runner('timerless-seed');
  r.setBarrier('p0', 60);
  r.snap('seeded');
  r.runSteps(10);
  r.snap('ten-ticks');
  r.damage('p0', 20);
  r.snap('absorbed');
  r.runSteps(1);
  r.snap('after');
  cases.push(r.output({}));
}

// 8. Training clear resets the barrier and both private fields with the rest of the practice memory.
{
  const r = runner('training-reset', {training: true});
  r.grant('p0', 'leech1');
  r.grant('p0', 'secondSkin');
  r.setHp('p0', 100);
  r.healOn('p0', 200, 'ordinary');
  r.snap('barrier-up');
  r.train('p0', {cmd: 'clear'});
  r.runSteps(1);
  r.snap('cleared');
  cases.push(r.output({}));
}

// 9. Teleport survival: a real coliseum teleport does not clear the barrier; it keeps decaying and immunity blocks damage.
{
  const r = runner('teleport-survival', {patienceSeconds: 2});
  r.grant('p0', 'leech1');
  r.grant('p0', 'secondSkin');
  r.healOn('p0', 1000, 'ordinary');
  r.runSteps(1);
  r.snap('before-teleport');
  r.runSteps(42);
  r.snap('teleported');
  r.runSteps(10);
  r.snap('after-teleport');
  cases.push(r.output({}));
}

// 10. Run-end retention: the barrier stays on the ended state's body (no reset in the end producer).
{
  const r = runner('run-end-retention');
  r.grant('p0', 'leech1');
  r.grant('p0', 'secondSkin');
  r.healOn('p0', 1000, 'ordinary');
  r.snap('barrier-up');
  r.down('p1');
  r.down('p2');
  r.runSteps(2);
  r.snap('ended');
  r.runSteps(2);
  r.snap('ended-retained');
  cases.push(r.output({}));
}

const repeat = cases.map((c) => ({name: c.input.name, script: c.script, actions: c.actions, frames: c.frames}));
assert.deepEqual(repeat, cases.map((c) => ({name: c.input.name, script: c.script, actions: c.actions, frames: c.frames})), 'declared repeat');

const sourceFiles = ['packages/shared/src', 'packages/server/src/sim'].flatMap((dir) =>
  readdirSync('/repo/' + dir, {recursive: true}).filter((p: string) => p.endsWith('.ts')).map((p: string) => dir + '/' + p),
);
const sourceSha256 = Object.fromEntries(sourceFiles.map((p: string) => [p, createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex')]));
const body = {
  format: 'rh-heal-barrier-source/1',
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
  const want = readFileSync(outPath, 'utf8');
  assert.equal(text, want, 'capture --check requires identical bytes');
  console.log(JSON.stringify({checked: outPath, bytes: text.length, sha256: sha, cases: cases.length}));
}
