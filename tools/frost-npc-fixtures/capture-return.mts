// Canonical actual-source witness for P-FROST-NPC-RECIPIENTS-1: a real Frost PLAYER chilling the source-born admitted
// basic Fire/Holy regional NPCs. The unmodified source sim is driven through the real installers found in the declared
// pve-dot map/config profile (factions + mobs/mobLife/mobAI + the rest), declared placements and actual enqueued
// target/attack/release client messages. Only passive observation: snapshots read source state after each ordinary
// 50 ms step; every expected value is written by the source, never fed back. A no-Frost case is the unchanged control.
import {grantCard} from '/repo/packages/server/src/sim/chests.ts';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {createWorld} from '/repo/packages/server/src/sim/world.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {enqueueClientMessage, parseAngle} from '/repo/packages/server/src/sim/inputs.ts';

assert(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--check'), 'closed capture arguments');
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const installers = ['loot','weapons','targeting','projectiles','factions','mobs','buffs','feed','camps','chests','mobLife','mobAI','abilities','vision','cardHooks','bruiserPassives','mods'];
const modules = await Promise.all(installers.map((m: string) => import('/repo/packages/server/src/sim/' + m + '.ts')));
const inputMap = JSON.parse(readFileSync('/capture/declared-map-input.json', 'utf8'));

const cases: any[] = [
  {name: 'frost-bow-pulls-fire-npcs-home-return', zone: 'fire', ticks: 240, players: [{faction: 'frost', x: 276, y: 276, weapon: 'bow', hp: 120}, {faction: 'holy', x: 624, y: 624, weapon: '', hp: 4000}, {faction: 'holy', x: 700, y: 600, weapon: '', hp: 4000}], script: [{tick: 0, kind: 'target-first'}, {tick: 2, kind: 'attack'}, {tick: 5, kind: 'release'}]},
  {name: 'no-frost-return-control', zone: 'fire', ticks: 240, players: [{faction: 'holy', x: 276, y: 276, weapon: 'bow', hp: 120}, {faction: 'holy', x: 624, y: 624, weapon: '', hp: 4000}, {faction: 'holy', x: 700, y: 600, weapon: '', hp: 4000}], script: [{tick: 0, kind: 'target-first'}, {tick: 2, kind: 'attack'}, {tick: 5, kind: 'release'}]},
];

const plain = (x: any): any => x === undefined ? null
  : typeof x === 'number' && !Number.isFinite(x) ? null
  : x === null || typeof x !== 'object' ? x
  : x instanceof Map ? [...x].map(([k, v]: any) => [k, plain(v)])
  : x instanceof Set ? [...x].map(plain)
  : ArrayBuffer.isView(x) ? Array.from(x as any)
  : Array.isArray(x) ? x.map(plain)
  : typeof x.toJSON === 'function' ? plain(x.toJSON())
  : Object.fromEntries(Object.keys(x).filter((k) => typeof x[k] !== 'function').sort().map((k) => [k, plain(x[k])]));

function snap(w: any) {
  return {tick: w.state.tick, time: w.state.serverTime, phase: w.state.phase, counter: w.idCounter, camps: plain(w.state.camps),
    players: [...w.state.players].map(([id, p]: any) => ({id, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, status: p.status, weapon0: p.weapon0, weapon1: p.weapon1, readyAt: p.readyAt, drawStartedAt: p.drawStartedAt, mobKills: w.players.get(id).mobKills, gv: p.gv, stats: plain(p.mobStats), build: plain(p.build)})),
    mobs: [...w.state.mobs].map(([id, p]: any) => ({id, state: plain(p), brain: plain(w.mobs.get(id).brain), weapon: plain(w.mobs.get(id).weapon), inputs: plain(w.mobs.get(id).inputs), path: plain(w.mobs.get(id).path), lastHitAt: w.mobs.get(id).lastHitAt})),
    containers: plain(w.state.containers), events: plain(w.events), landed: plain(w.combat.landed), signatures: plain(w.factions.fighters), dot: plain(w.factions.dot), dotSince: w.factions.dotSince};
}

function run(c: any) {
  const map = structuredClone(inputMap);
  if (c.zone !== 'fire') {
    const other = map.regions.findIndex((r: any) => r.id === c.zone);
    const fire = map.regions[0]; const target = map.regions[other];
    [fire.id, target.id] = [target.id, fire.id];
    for (const camp of fire.mobCamps) { camp.id = c.zone + '-1'; camp.region = c.zone; camp.weapon = c.zone === 'plague' ? 'bow' : 'wand'; }
    for (const p of map.spawnPool) { p.zone = p.zone === 'fire' ? c.zone : p.zone === c.zone ? 'fire' : p.zone; }
    map.camps[0].zone = c.zone; map.camps[0].id = c.zone + '-1';
    map.regionGrid = map.regionGrid.map((v: number) => v === 1 ? other + 1 : v === other + 1 ? 1 : v);
    [map.regions[0], map.regions[other]] = [map.regions[other], map.regions[0]];
    map.spawns = map.regions.flatMap((r: any) => r.spawns);
  }
  for (const key of ['tiles', 'terrain', 'regionGrid', 'territoryGrid', 'featureGrid']) map[key] = Uint8Array.from(map[key]);
  let uid = 0;
  const w = createWorld({seed: 1, map, config: {minPlayers: c.players.length, lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true, signatures: true, quests: false, training: false, dummies: false, planSeconds: 0}, random: mulberry32(12), rewardSalt: [1, 2, 3, 4], questSalt: [5, 6, 7, 8], newItemUid: () => 'U' + (++uid)});
  let draws = 0; const random = w.rewardRandom; w.rewardRandom = () => { draws++; return random(); };
  for (const m of modules) m.install(w);
  assert.equal(w.idCounter, 0);
  for (let i = 0; i < c.players.length; i++) addPlayer(w, 'p' + i, 'name' + i, {faction: c.players[i].faction});
  step(w, 50);
  assert.equal(w.state.phase, 'active');
  for (let i = 0; i < c.players.length; i++) {
    const p = w.state.players.get('p' + i)!; const rt = w.players.get('p' + i)!; const spec = c.players[i];
    p.x = spec.x; p.y = spec.y; p.facing = 0; p.weapon0 = spec.weapon; p.weapon1 = '';
    rt.history = [{t: w.state.serverTime, x: p.x, y: p.y}];
    if (spec.hp !== undefined) p.hp = spec.hp;
    for (const card of (spec.cards ?? [])) assert.equal(grantCard(w, {kind: 'player', id: 'p' + i, s: p, rt}, card), 1);
  }
  w.events.length = 0;
  const initial = snap(w);
  const frames: any[] = [];
  for (let i = 0; i < c.ticks; i++) {
    const commands: any[] = [];
    if (w.state.phase === 'active') {
      for (const a of (c.script ?? [])) {
        if (a.tick !== i) continue;
        const actor = a.actor ?? 'p0';
        const s = w.state.players.get(actor); const rt = w.players.get(actor);
        if (!s || !rt || s.status !== 'alive' || rt.down || rt.resolved) continue;
        const mobs = [...w.state.mobs].filter(([, m]: any) => m.status === 'alive');
        const first = mobs[0] as any;
        if (a.kind === 'target-first') {
          if (first) { rt.inputs.pushAction({kind: 'target', id: first[0]}); commands.push({actor, kind: 'target', id: first[0]}); }
        } else if (a.kind === 'move') {
          const accepted = enqueueClientMessage(rt.inputs, 'move', {x: a.x, y: a.y}, {training: false});
          commands.push({actor, kind: 'move', x: a.x, y: a.y});
        } else if (a.kind === 'attack-fixed') {
          rt.inputs.pushAction({kind: 'attack', a: a.a});
          commands.push({actor, kind: 'attack', a: a.a});
        } else if (a.kind === 'attack' || a.kind === 'release') {
          if (first) { const ang = parseAngle(Math.atan2(first[1].y - s.y, first[1].x - s.x)); rt.inputs.pushAction({kind: a.kind, a: ang}); commands.push({actor, kind: a.kind, a: ang}); }
        }
      }
    }
    const events = step(w, 50);
    frames.push({commands, output: {...snap(w), events: plain(events)}});
    if (w.state.phase === 'ended') break;
  }
  return {input: c, initial, frames, draws, next: Array.from({length: 4}, () => w.rewardRandom())};
}

const outputs = cases.map(run);
const repeat = cases.map(run);
assert.deepEqual(outputs, repeat);

const inputs = ['package.json', 'package-lock.json', ...['packages/server/src/sim', 'packages/shared/src'].flatMap((dir) => readdirSync('/repo/' + dir, {recursive: true}).filter((p) => p.endsWith('.ts')).map((p) => dir + '/' + p))].sort();
const hashes = Object.fromEntries(inputs.map((p) => [p, createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex')]));
const result = {format: 'rh-frost-npc-return-source/1', profile: {name: 'basic-factions-pve-frost-player-return-v1', installers, signatures: true, consumables: 'omitted installer; the native config must set consumables=false', abilities: 'installed installer; no ability producer is used in the bounded cases (asserted)', lifecycle: 'engine patience/sudden-death timers not reached in the bounded window; no teleport or sudden-death event asserted', config: {minPlayers: 'players.length', lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true, signatures: true, quests: false, training: false, dummies: false, planSeconds: 0}, inert: ['quests installer omitted', 'consumables installer omitted', 'terrainEffects/killAugments/regen/campHeal/traders/initialLoot not installed', 'abilities installer present but unused in these bounded cases']}, provenance: {node: process.version, platform: process.platform, arch: process.arch, sourceSha256: hashes, inputSha256: createHash('sha256').update(readFileSync('/capture/declared-map-input.json')).digest('hex'), recorderSha256: createHash('sha256').update(readFileSync('/capture/capture-return.mts')).digest('hex')}, cases: outputs};

const frameHas = (c: any, pred: (f: any) => boolean) => c.frames.some((f: any) => pred(f.output));
const returnFrames = (c: any) => c.frames.filter((f: any) => f.output.mobs.some((m: any) => m.brain.mode === 'return'));
assert(returnFrames(outputs[0]).length >= 5, 'the Frost pull emits genuine source Return frames');
assert(returnFrames(outputs[1]).length >= 5, 'the no-Frost pull also returns: Return is the generic source lifecycle, not a Frost artifact');
for (const out of outputs) {
  const returning = returnFrames(out);
  assert(returning.some((f: any) => f.output.mobs.some((m: any) => m.brain.mode === 'return' && m.brain.target === null && m.brain.holding === false)), 'return drops target and holding');
  assert(returning.some((f: any) => f.output.mobs.some((m: any) => m.brain.mode === 'return' && Array.isArray(m.path) && m.path.length > 0)), 'return walks a homeward path');
  const last = out.frames[out.frames.length - 1]!.output;
  assert.equal(last.phase, 'active', 'the two observers keep the run active through the return');
  assert.equal(last.players[0].status, 'dead', 'the pulling attacker died, which removed the threat');
  assert(last.players.slice(1).some((p: any) => p.status === 'alive'), 'a standing observer remains');
  for (const f of out.frames) {
    for (const e of f.output.events) {
      assert(!['castStarted','castLanded','castEnded','abilityHit','questAccepted','questCompleted','potionNotice','teleported','suddenDeath'].includes(e.type), 'inert installer event ' + e.type);
    }
  }
}
const text = JSON.stringify(result) + '\n';
if (process.argv[2] === '--check') assert.equal(readFileSync('/out/return.json', 'utf8'), text);
else writeFileSync('/out/return.json', text);
console.log(JSON.stringify({cases: outputs.map((x: any) => ({name: x.input.name, frames: x.frames.length, chilledNpcs: x.frames.some((f: any) => f.output.signatures.some(([id, s]: any) => id.startsWith('mob') && s.chill < 1)), mobs: x.frames.at(-1).output.mobs.map((m: any) => [m.id, m.state.hp])})), bytes: text.length, exactRepeat: true}));
