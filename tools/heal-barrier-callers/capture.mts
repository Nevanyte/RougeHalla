// Canonical actual-source G6 real-caller witness (P-G6-CALLER-REPAIR), captured in the pinned linux/amd64 Node
// 22.23.4 container: a genuine player-only / no-mobs full-player faction world (config.mobs false, createGameWorld
// modules signatures:true), real cards, real attacks through the ordinary input queue, the real potion consumable
// command and the real generic status-application API. The old ten-case corpus is untouched.
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
import {applyDamage} from '/repo/packages/server/src/sim/arena.ts';
import {addStatus} from '/repo/packages/server/src/sim/status.ts';

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
const PLAYERS = [{faction: 'holy', name: 'name0'}, {faction: 'holy', name: 'name1'}];
const CONFIG = {
  minPlayers: 2, lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
  suddenDeathSeconds: 3600, mobs: false, signatures: true, quests: false, training: false, dummies: false,
  planSeconds: 0, pvpRules: false,
};
const MODULES = {signatures: true, walkHints: false};

const r6 = (v: any): any => typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v;
const idx = (id: any): number | null => typeof id === 'string' && /^p[0-9]+$/.test(id) ? Number(id.slice(1)) : null;
const boostOf = (w: any, id: string): any => {
  const b = w.players.get(id)?.boost;
  if (!b || !(b.shieldUntil > 0)) return null;
  return {shieldUntil: r6(b.shieldUntil), decays: b.decays === true};
};
const playerView = (w: any): any[] => PLAYERS.map((_p, i) => {
  const id = 'p' + i;
  const s = w.state.players.get(id);
  if (!s) return null;
  return {id: i, faction: s.faction, x: r6(s.x), y: r6(s.y), hp: r6(s.hp), maxHp: r6(s.maxHp),
    barrier: r6(s.barrier), status: s.status, slot: s.slot, weapon0: s.weapon0, weapon1: s.weapon1,
    potionSmall: s.potionSmall, boost: boostOf(w, id)};
});

function open(): any {
  const map: any = generateMap(SEED, ATTEMPT, {decor: false});
  let uid = 0;
  const w: any = createGameWorld({
    seed: SEED, map, config: CONFIG, random: mulberry32(RANDOM_SEED), rewardSalt: REWARD_SALT,
    newItemUid: () => 'U' + ++uid,
  }, {signatures: MODULES.signatures, walkHints: MODULES.walkHints});
  for (let i = 0; i < PLAYERS.length; i++) addPlayer(w, 'p' + i, PLAYERS[i].name, {faction: PLAYERS[i].faction as any});
  step(w, TICK_MS);
  assert.equal(w.state.phase, 'active');
  assert.equal(w.state.mobs.size, 0, 'the player-only profile has no mobs');
  assert.equal(w.config.mobs, false);
  return w;
}

function runner(name: string) {
  const w = open();
  const actions: any[] = [];
  let seq = 0;
  const frames: any[] = [];
  const pendingHits: any[] = [];
  const pendingHeals: any[] = [];
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
  const grant = (actor: string, card: string): void => {
    assert.notEqual(grantCard(w, combatant(w, actor) as any, card), null, 'the source granted ' + card);
    push('grantCard', {actor: Number(actor.slice(1)), card});
  };
  const wound = (actor: string, amount: number): void => {
    const c = combatant(w, actor) as any;
    applyDamage(w, c.s, c.rt, amount, 'declared-wound');
    push('damage', {actor: Number(actor.slice(1)), amount});
  };
  const setPotion = (actor: string, count: number): void => {
    w.state.players.get(actor)!.potionSmall = count;
    push('setPotion', {actor: Number(actor.slice(1)), count});
  };
  const status = (actor: string, kind: string, value: number, ms: number): void => {
    const made = addStatus(w, combatant(w, actor) as any, {kind: kind as any, source: {id: 'p1', name: 'p1'}, ms, value});
    assert.notEqual(made, null, 'the real generic status API applied the labelled trusted status');
    push('addStatus', {actor: Number(actor.slice(1)), statusKind: kind, value, ms});
  };
  const attack = (actor: string, a: number): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, 'attack', {a}), true, 'the source took the attack');
    push('input', {actor: Number(actor.slice(1)), type: 'attack', payload: {a}});
  };
  const drink = (actor: string): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, 'useConsumable', {kind: 'heal'}), true, 'the source took the potion command');
    push('input', {actor: Number(actor.slice(1)), type: 'useConsumable', payload: {kind: 'heal'}});
  };
  const snap = (label: string): void => {
    frames.push({label, actionCount: actions.length, tick: w.state.tick, time: w.state.serverTime,
      phase: w.state.phase, players: playerView(w), hits: pendingHits.splice(0), heals: pendingHeals.splice(0)});
  };
  const runSteps = (n: number): void => {
    for (let i = 0; i < n; i++) {
      const evs = step(w, TICK_MS);
      for (const ev of evs) {
        if (ev.type === 'fx' && ev.fx.kind === 'hit') {
          pendingHits.push({victim: idx(ev.fx.id), by: idx(ev.fx.by), amount: r6(ev.fx.amount)});
        } else if (ev.type === 'fx' && ev.fx.kind === 'heal') {
          pendingHeals.push({id: idx(ev.fx.id), amount: r6(ev.fx.amount)});
        }
      }
    }
  };
  const initial = PLAYERS.map((_p, i) => {
    const s = w.state.players.get('p' + i)!;
    return {x: s.x, y: s.y, faction: s.faction, hp: r6(s.hp), maxHp: r6(s.maxHp)};
  });
  const output = (script: any): any => ({
    input: {name, profile: 'player-only-no-mobs/full-player-faction/signatures-true', map: {seed: SEED, attempt: ATTEMPT, decor: false},
      config: CONFIG, modules: MODULES, players: PLAYERS, initial, seeds: {random: RANDOM_SEED, rewardSalt: REWARD_SALT}},
    script, actions, frames,
  });
  snap('start');
  return {w, grant, wound, setPotion, status, attack, drink, setWeapon, place, snap, runSteps, output, frames, actions};
}

const cases: any[] = [];

// 1. The real lifesteal caller BEFORE the buffs slot: cards granted normally, a real wound, a real validated melee
// attack; the factions afterDamage system heals before buffs.expireBoosts, so the new barrier loses one tick in the
// very tick it is granted. Frames pin damage, lifesteal/heal, barrier and the private deadline.
{
  const r = runner('lifesteal-before-slot');
  r.grant('p0', 'leech1');
  r.grant('p0', 'secondSkin');
  r.setWeapon('p0', 'sword');
  r.place('p0', 400, 320);
  r.place('p1', 432, 320);
  r.wound('p0', 300);
  r.snap('wounded');
  r.attack('p0', 0);
  r.runSteps(1);
  r.snap('hit-tick');
  r.runSteps(1);
  r.snap('next-tick');
  cases.push(r.output({}));
}

// 2. A real caller AFTER the buffs slot: the installed consumables system drinks a real potion command; the barrier is
// granted after buffs.expireBoosts has run, so it is not decayed on its grant tick and decays on the next one.
{
  const r = runner('potion-after-slot');
  r.grant('p0', 'leech1');
  r.grant('p0', 'secondSkin');
  r.wound('p0', 400);
  r.setPotion('p0', 1);
  r.snap('wounded-potion-ready');
  r.drink('p0');
  for (let i = 1; i <= 12; i++) {
    r.runSteps(1);
    r.snap('after-drink-' + i);
  }
  cases.push(r.output({}));
}

// 3. The real anti-heal status scales BOTH the potion's hp gain and its Second Skin barrier: a labelled trusted setup
// through the real generic status-application API (no ordinary shipped producer for antiHeal in this world).
{
  const r = runner('antiheal-scaled-heal');
  r.grant('p0', 'leech1');
  r.grant('p0', 'secondSkin');
  r.wound('p0', 400);
  r.status('p0', 'antiHeal', 0.5, 6000);
  r.setPotion('p0', 1);
  r.snap('antiheal-ready');
  r.drink('p0');
  for (let i = 1; i <= 12; i++) {
    r.runSteps(1);
    r.snap('after-drink-' + i);
  }
  cases.push(r.output({}));
}

const repeat = cases.map((c) => ({name: c.input.name, script: c.script, actions: c.actions, frames: c.frames}));
assert.deepEqual(repeat, cases.map((c) => ({name: c.input.name, script: c.script, actions: c.actions, frames: c.frames})), 'declared repeat');

const sourceFiles = ['packages/shared/src', 'packages/server/src/sim'].flatMap((dir) =>
  readdirSync('/repo/' + dir, {recursive: true}).filter((p: string) => p.endsWith('.ts')).map((p: string) => dir + '/' + p),
);
const sourceSha256 = Object.fromEntries(sourceFiles.map((p: string) => [p, createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex')]));
const body = {
  format: 'rh-heal-barrier-callers-source/1',
  provenance: {
    image: 'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
    platform: 'linux/amd64', node: process.version, sourceSha256, map: {seed: SEED, attempt: ATTEMPT, decor: false},
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
