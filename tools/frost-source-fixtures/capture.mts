import {placeMob, killMob, reapMobs, respawnCamps} from '/repo/packages/server/src/sim/mobLife.ts';
import {addMob} from '/repo/packages/server/src/sim/mobs.ts';
import {raiseOrGrowZombie} from '/repo/packages/server/src/sim/plagueZombies.ts';
import {combatant} from '/repo/packages/server/src/sim/combatant.ts';
import {modsOf, recomputeMods} from '/repo/packages/server/src/sim/mods.ts';
import {grantCard} from '/repo/packages/server/src/sim/chests.ts';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {encodeMirrors, mulberry32} from '/repo/packages/shared/src/index.ts';
import {createWorld} from '/repo/packages/server/src/sim/world.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {enqueueClientMessage, parseAngle} from '/repo/packages/server/src/sim/inputs.ts';

assert(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--check'), 'closed capture arguments');
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

// The declared constructor supplies every entropy stream and item UID; ambient entropy is never permitted.
Math.random = () => { throw new Error('unexpected ambient Math.random in pinned Frost source witness'); };

const installers = ['loot','weapons','targeting','projectiles','factions','mobs','buffs','feed','camps','chests','mobLife','mobAI','abilities','vision','cardHooks','bruiserPassives','mods'];
const modules = await Promise.all(installers.map((m: string) => import('/repo/packages/server/src/sim/' + m + '.ts')));
const inputMap = JSON.parse(readFileSync('/capture/declared-map-input.json', 'utf8'));

const cases: any[] = [
  {name: 'helper-npc-bonus-mirrors-stay-base', kind: 'helper-npc-bonus', zone: 'frost', ticks: 0, players: [{faction: 'holy', x: 112, y: 112, weapon: '', hp: 4000}, {faction: 'holy', x: 624, y: 624, weapon: '', hp: 4000}], script: []},
  {name: 'helper-source-recipient-kinds', kind: 'helper-recipients', zone: 'frost', ticks: 0, players: [{faction: 'holy', x: 112, y: 112, weapon: '', hp: 4000}, {faction: 'plague', x: 112, y: 144, weapon: '', hp: 4000}], script: []},
  {name: 'helper-eleven-ordered-sources-lifecycle', kind: 'helper-diagnostic', zone: 'frost', extraSpots: true, ticks: 0, players: [{faction: 'holy', x: 112, y: 112, weapon: '', hp: 4000}, {faction: 'frost', x: 112, y: 112, weapon: '', hp: 4000, cards: ['haste3','mr3']}], script: []},
  {name: 'runtime-ten-frost-npc-sources', kind: 'runtime', zone: 'frost', extraSpots: true, ticks: 220, players: [{faction: 'holy', x: 80, y: 112, weapon: 'sword', hp: 4000}, {faction: 'holy', x: 624, y: 624, weapon: '', hp: 4000}], script: [{tick: 0, kind: 'target-first'}, {tick: 2, kind: 'attack'}]},
  {name: 'runtime-reciprocal-frost-player-npcs', kind: 'runtime', zone: 'frost', ticks: 140, players: [{faction: 'frost', x: 80, y: 112, weapon: 'sword', hp: 4000}, {faction: 'holy', x: 624, y: 624, weapon: '', hp: 4000}], script: [{tick: 0, kind: 'target-first'}, {tick: 2, kind: 'attack'}]},
  {name: 'runtime-npc-base-holy-recipient', kind: 'runtime', zone: 'frost', ticks: 140, players: [{faction: 'holy', x: 80, y: 112, weapon: 'sword', hp: 4000}, {faction: 'holy', x: 624, y: 624, weapon: '', hp: 4000}], script: [{tick: 0, kind: 'target-first'}, {tick: 2, kind: 'attack'}]},
  {name: 'runtime-boosted-player-npc-base', kind: 'runtime', zone: 'frost', ticks: 140, players: [{faction: 'frost', x: 80, y: 112, weapon: 'sword', hp: 4000, cards: ['haste3','mr3']}, {faction: 'holy', x: 624, y: 624, weapon: '', hp: 4000}], script: [{tick: 0, kind: 'target-first'}, {tick: 2, kind: 'attack'}]},
  {name: 'runtime-frost-npcs-return', kind: 'runtime', zone: 'frost', ticks: 300, players: [{faction: 'holy', x: 276, y: 276, weapon: 'bow', hp: 40}, {faction: 'holy', x: 624, y: 624, weapon: '', hp: 4000}, {faction: 'holy', x: 700, y: 600, weapon: '', hp: 4000}], script: [{tick: 0, kind: 'target-first'}, {tick: 2, kind: 'attack'}, {tick: 5, kind: 'release'}]},
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
    players: [...w.state.players].map(([id, p]: any) => ({id, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, status: p.status, weapon0: p.weapon0, weapon1: p.weapon1, readyAt: p.readyAt, drawStartedAt: p.drawStartedAt, facing: p.facing, sig: p.sig, frostMoveMult: p.frostMoveMult, weapon: plain(w.players.get(id).weapon), inputs: plain(w.players.get(id).inputs), path: plain(w.players.get(id).path), mobKills: w.players.get(id).mobKills, gv: p.gv, stats: plain(p.mobStats), build: plain(p.build)})),
    mobs: [...w.state.mobs].map(([id, p]: any) => ({id, state: plain(p), brain: plain(w.mobs.get(id).brain), weapon: plain(w.mobs.get(id).weapon), inputs: plain(w.mobs.get(id).inputs), path: plain(w.mobs.get(id).path), lastHitAt: w.mobs.get(id).lastHitAt})),
    containers: plain(w.state.containers), events: plain(w.events), landed: plain(w.combat.landed), signatures: plain(w.factions.fighters), dot: plain(w.factions.dot), dotSince: w.factions.dotSince, rewardDraws: w.captureDraws()};
}

function run(c: any) {
  const map = structuredClone(inputMap);
  if (c.zone !== 'fire') {
    const other = map.regions.findIndex((r: any) => r.id === c.zone);
    const fire = map.regions[0]; const target = map.regions[other];
    [fire.id, target.id] = [target.id, fire.id];
    for (const camp of fire.mobCamps) { camp.id = c.zone + '-1'; camp.region = c.zone; camp.weapon = c.zone === 'frost' ? 'shield' : c.zone === 'plague' ? 'bow' : 'wand'; }
    for (const p of map.spawnPool) { p.zone = p.zone === 'fire' ? c.zone : p.zone === c.zone ? 'fire' : p.zone; }
    map.camps[0].zone = c.zone; map.camps[0].id = c.zone + '-1';
    map.regionGrid = map.regionGrid.map((v: number) => v === 1 ? other + 1 : v === other + 1 ? 1 : v);
    [map.regions[0], map.regions[other]] = [map.regions[other], map.regions[0]];
    map.spawns = map.regions.flatMap((r: any) => r.spawns);
  }
  if (c.extraSpots) {
    const spots = Array.from({length: 10}, (_, i) => i === 5 ? {x: 208, y: 112} : ({x: 80 + (i % 4) * 32, y: 80 + Math.floor(i / 4) * 32}));
    map.camps[0].spots = spots;
    map.regions.find((r: any) => r.id === 'frost').mobCamps[0].spots = structuredClone(spots);
  }
  for (const key of ['tiles', 'terrain', 'regionGrid', 'territoryGrid', 'featureGrid']) map[key] = Uint8Array.from(map[key]);
  let uid = 0;
  const w = createWorld({seed: 1, map, config: {minPlayers: c.players.length, lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true, signatures: true, quests: false, training: false, dummies: false, planSeconds: 0}, random: mulberry32(12), rewardSalt: [1, 2, 3, 4], questSalt: [5, 6, 7, 8], newItemUid: () => 'U' + (++uid)});
  let draws = 0; const random = w.rewardRandom; w.rewardRandom = () => { draws++; return random(); };
  (w as any).captureDraws = () => draws;
  let frostAfterDamage: any;
  for (let i = 0; i < modules.length; i++) {
    const systemIndex = w.systems.length; modules[i].install(w);
    if (installers[i] === 'factions') frostAfterDamage = w.systems[systemIndex];
  }
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
  if (c.kind === 'helper-npc-bonus') {
    const id = [...w.state.mobs.keys()][0];
    const npc = w.state.mobs.get(id) as any;
    // NPC mirrors live in source's private modifier cache, not MobState's public schema.
    // The actual source NPC mirror reader uses the private mod cache. Populate it through its real producer.
    w.modSources.push((_world:any,c:any) => c.id === id ? {asMult:1.5,shield:45} : null);
    recomputeMods(w,combatant(w,id));
    frostAfterDamage(w,0);
    const f = w.factions.fighters.get(id); f.target = 'p0'; f.engaged = true;
    frostAfterDamage(w,50);
    frames.push({commands:[{kind:'helper-npc-bonus-mirrors',id,asMult:1500,shieldBonus:450,contribution:{asMult:1.5,shield:45}},{kind:'helper-engagement',pairs:[[id,'p0']],recompute:'installed-factions-afterDamage',dtMs:50}],output:{...snap(w),diagnosticNpcMirrors:{id,raw:plain(encodeMirrors(modsOf(npc))),decoded:plain(modsOf(npc))}}});
    return {input:c,initial,frames,draws,next:Array.from({length:4},()=>w.rewardRandom())};
  }
  if (c.kind === 'helper-recipients') {
    // Direct source constructors are diagnostic inputs, never a claim of client-triggered corpse consumption.
    const setup: any[] = [];
    const dummy = addMob(w, {kind: 'dummy', name: 'Declared helper dummy', at: {x:112,y:112}});
    setup.push({kind: 'helper-addMob', spec: {kind:'dummy',name:'Declared helper dummy',at:{x:112,y:112}}, resultId:dummy});
    const regions = ['fire','holy','plague'] as const;
    const recipients = ['p0', dummy];
    for (const region of regions) {
      const spec = {region, elite:false, at:{x:112,y:112}};
      const id = placeMob(w, spec); recipients.push(id); setup.push({kind:'helper-placeMob',spec,resultId:id});
    }
    raiseOrGrowZombie(w, combatant(w,'p1') as any);
    const zombie = w.state.players.get('p1').plagueZombieId; recipients.push(zombie);
    setup.push({kind:'helper-raiseOrGrowZombie',owner:'p1',resultId:zombie});
    frostAfterDamage(w,0);
    const frost = [...w.state.mobs.keys()][0];
    for (const id of recipients) { const f = w.factions.fighters.get(id); f.target = frost; f.engaged = true; }
    frostAfterDamage(w,50);
    frames.push({commands:[...setup,{kind:'helper-engagement',pairs:recipients.map(id=>[id,frost]),recompute:'installed-factions-afterDamage',dtMs:50}],output:snap(w)});
    w.mobs.get(frost).brain.mode = 'return'; frostAfterDamage(w,50);
    frames.push({commands:[{kind:'helper-return-mode',id:frost,mode:'return',recompute:'installed-factions-afterDamage',dtMs:50}],output:snap(w)});
    return {input:c,initial,frames,draws,next:Array.from({length:4},()=>w.rewardRandom())};
  }
  if (c.kind === 'helper-diagnostic') {
    const capture = (commands: any[]) => frames.push({commands, output: snap(w)});
    // Populate genuine default signature objects through the installed source system, then declare only engagement.
    frostAfterDamage(w, 0);
    const ids = [...w.state.mobs.keys()];
    const engage = () => {
      for (const [id, f] of w.factions.fighters) { f.target = null; f.engaged = false; }
      for (const id of ['p1', ...w.state.mobs.keys()]) {
        const state = id === 'p1' ? w.state.players.get(id) : w.state.mobs.get(id);
        if (state.status !== 'alive') continue;
        const f = w.factions.fighters.get(id); f.target = 'p0'; f.engaged = true;
      }
      // The reciprocal first edge inserts first NPC before p1, and the NPC->p0 edge repeats it once.
      const p = w.factions.fighters.get('p0'); p.target = [...w.state.mobs.keys()][0]; p.engaged = true;
    };
    engage(); frostAfterDamage(w, 50);
    capture([{kind: 'helper-engagement', pairs: ['p1', ...ids].map(id => [id, 'p0']).concat([['p0',ids[0]]]), recompute: 'installed-factions-afterDamage', dtMs: 50}]);
    w.mobs.get(ids[0]).brain.mode = 'return';
    frostAfterDamage(w, 50);
    capture([{kind: 'helper-return-mode', id: ids[0], mode: 'return', recompute: 'installed-factions-afterDamage', dtMs: 50}]);
    for (const id of ids) killMob(w, combatant(w,id) as any, [], []);
    w.combat.landed.length = 0; frostAfterDamage(w, 50);
    capture([{kind: 'helper-killMob', ids, entries: [], amounts: [], recompute: 'installed-factions-afterDamage', dtMs: 50}]);
    w.state.serverTime += 1500; reapMobs(w, 0); frostAfterDamage(w, 0);
    capture([{kind: 'helper-advance-clock-and-reap', ms: 1500, dtMs: 0, recompute: 'installed-factions-afterDamage'}]);
    const elapsed = w.state.camps[0].respawnAt - w.state.serverTime;
    w.state.serverTime += elapsed; respawnCamps(w); frostAfterDamage(w, 0);
    capture([{kind: 'helper-advance-clock-and-respawn', ms: elapsed, recompute: 'installed-factions-afterDamage', dtMs: 0}]);
    engage(); frostAfterDamage(w, 50);
    capture([{kind: 'helper-engagement', pairs: ['p1', ...w.state.mobs.keys()].map(id => [id, 'p0']).concat([['p0',[...w.state.mobs.keys()][0]]]), recompute: 'installed-factions-afterDamage', dtMs: 50}]);
    w.hooks.teleported(w); frostAfterDamage(w, 0);
    capture([{kind: 'helper-teleported-hook', recompute: 'installed-factions-afterDamage', dtMs: 0}]);
    return {input: c, initial, frames, draws, next: Array.from({length: 4}, () => w.rewardRandom())};
  }
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
          if (first) { assert(enqueueClientMessage(rt.inputs, 'target', {id: first[0]})); commands.push({actor, kind: 'target', id: first[0]}); }
        } else if (a.kind === 'move') {
          assert(enqueueClientMessage(rt.inputs, 'move', {x: a.x, y: a.y}, {training: false}));
          commands.push({actor, kind: 'move', x: a.x, y: a.y});
        } else if (a.kind === 'attack-fixed') {
          assert(enqueueClientMessage(rt.inputs, 'attack', {a: a.a}));
          commands.push({actor, kind: 'attack', a: a.a});
        } else if (a.kind === 'attack' || a.kind === 'release') {
          if (first) { const ang = parseAngle(Math.atan2(first[1].y - s.y, first[1].x - s.x)); assert(enqueueClientMessage(rt.inputs, a.kind, {a: ang})); commands.push({actor, kind: a.kind, a: ang}); }
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
const result = {format: 'rh-frost-sources-source/1', profile: {name: 'basic-factions-pve-frost-npc-sources-v1', constructor: {seed:1, random:'mulberry32', randomSeed:12, rewardSalt:[1,2,3,4], questSalt:[5,6,7,8], itemUid:'U + preincrementing counter starting at zero'}, installers, runtime: 'Only cases kind=runtime use ordinary 50ms steps, normal NPC AI and validated enqueued client inputs after declared setup.', helpers: 'Cases kind=helper-diagnostic/helper-recipients/helper-npc-bonus invoke the actual installed factions afterDamage system; engagement/mode, direct source constructors/lifecycle helpers and clock jumps are explicit diagnostic inputs, never ordinary runtime or client ability witnesses.', map: 'declared-map-input.json cloned before createWorld; swap fire and frost zone identities/grids/spawnPool/region order exactly as code declares. extraSpots=true replaces the Frost camp spots pre-world with ten row-major positions (80+32*(i%4),80+32*floor(i/4)), except index5 is (208,112) to keep source spots distinct from the chest (112,112).', signatures: true, consumables: 'omitted installer; the native config must set consumables=false', abilities: 'installed installer; no ability producer is used in the bounded cases (asserted)', lifecycle: 'engine patience/sudden-death timers not reached in the bounded window; no teleport or sudden-death event asserted', config: {minPlayers: 'players.length', lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true, signatures: true, quests: false, training: false, dummies: false, planSeconds: 0}, inert: ['quests installer omitted', 'consumables installer omitted', 'terrainEffects/killAugments/regen/campHeal/traders/initialLoot not installed', 'abilities installer present but unused in these bounded cases']}, provenance: {sourceRevision:'8cd510752ddab9e30b210efce85ca5faced8bbbd', node: process.version, platform: process.platform, arch: process.arch, sourceSha256: hashes, inputSha256: createHash('sha256').update(readFileSync('/capture/declared-map-input.json')).digest('hex'), recorderSha256: createHash('sha256').update(readFileSync('/capture/capture.mts')).digest('hex')}, cases: outputs};

const wideRuntime = outputs.find((c: any) => c.input.name === 'runtime-ten-frost-npc-sources');
const wideCounts = wideRuntime.frames.map((f:any) => ({tick:f.output.tick,time:f.output.time,count:f.output.signatures.find(([id]:any)=>id === 'p0')?.[1].chillers.length ?? 0}));
const wideMaximum = wideCounts.reduce((a:any,b:any)=>a.count >= b.count ? a:b);
console.log(JSON.stringify({wideRuntimeMaximum:wideMaximum}));
assert(wideMaximum.count > 8, 'ordinary runtime must demonstrate more than eight Frost NPC sources');
const runtime = outputs.filter((c: any) => c.input.kind === 'runtime' && c.input.name !== 'runtime-ten-frost-npc-sources');
const helper = outputs.find((c: any) => c.input.kind === 'helper-diagnostic');
const npcBonus = outputs.find((c:any)=>c.input.kind === 'helper-npc-bonus');
assert.equal(npcBonus.frames[0].output.diagnosticNpcMirrors.decoded.asMult,1.5);
assert.equal(npcBonus.frames[0].output.diagnosticNpcMirrors.decoded.shieldBonus,45);
assert(Math.abs(npcBonus.frames[0].output.signatures.find(([id]:any)=>id === 'p0')[1].chill - 0.68)<1e-12);
const recipientCase = outputs.find((c:any)=>c.input.kind === 'helper-recipients');
const recipientInitial = recipientCase.frames[0].output;
const recipientIds = ['p0',...recipientInitial.mobs.filter((m:any)=>['dummy','zombie'].includes(m.state.kind)||['fire','holy','plague'].includes(m.state.faction)).map((m:any)=>m.id)];
assert.equal(recipientIds.length,6);
for (const id of recipientIds) {
  assert(recipientInitial.signatures.find(([actor]:any)=>actor === id)[1].chillers.includes(recipientCase.initial.mobs[0].id));
  assert.equal(recipientCase.frames[1].output.signatures.find(([actor]:any)=>actor === id)[1].chillers.length,0);
}
const many = helper.frames[0].output.signatures.find(([id]:any) => id === 'p0')[1].chillers;
assert.equal(many.length, 11); assert.equal(new Set(many).size, 11);
assert.deepEqual(many, [helper.initial.mobs[0].id, 'p1', ...helper.initial.mobs.slice(1).map((m:any)=>m.id)]);
assert(helper.frames[1].output.signatures.every(([,s]:any) => !s.chillers.includes(helper.initial.mobs[0].id)));
assert.equal(helper.frames[3].output.mobs.length, 0);
assert.equal(helper.frames[4].output.mobs.length, 10);
assert(helper.frames[4].output.mobs.every((m:any) => !helper.initial.mobs.some((old:any)=>old.id === m.id)));
assert(helper.frames[6].output.signatures.every(([,s]:any) => s.chillers.length === 0));
const has = (c: any, pred: (f: any) => boolean) => c.frames.some((f: any) => pred(f.output));
assert(has(runtime[0], f => f.signatures.some(([id,s]: any) => id === 'p0' && s.chillers.some((x: string) => x.startsWith('mob')))), 'genuine NPC sources chill player');
assert(has(runtime[0], f => f.signatures.some(([id,s]: any) => id.startsWith('mob') && s.chillers.includes('p0'))), 'reciprocal player source chills NPC');
assert(has(runtime[1], f => f.signatures.some(([id,s]: any) => id === 'p0' && Math.abs(s.chill - 0.68) < 1e-12)), 'NPC base is 0.68');
assert(has(runtime[2], f => f.signatures.some(([id,s]: any) => id.startsWith('mob') && s.chill < 0.68)), 'boosted player deeper chill');
assert(has(runtime[2], f => f.signatures.some(([id,s]: any) => id === 'p0' && Math.abs(s.chill - 0.68) < 1e-12)), 'NPC chill stays base against boosted player');
const returning = runtime[3].frames.filter((f: any) => f.output.mobs.some((m: any) => m.brain.mode === 'return'));
assert(returning.length >= 5, 'genuine source Frost return frames');
for (const f of returning) for (const m of f.output.mobs.filter((m:any) => m.brain.mode === 'return')) {
  const index = runtime[3].frames.indexOf(f);
  if (index === 0 || !runtime[3].frames[index-1].output.mobs.some((old:any)=>old.id === m.id && old.brain.mode === 'return')) continue;
  assert(f.output.signatures.every(([,s]:any) => !s.chillers.includes(m.id)), 'returning Frost NPC is not a source');
}
const text = JSON.stringify(result) + '\n';
if (process.argv[2] === '--check') assert.equal(readFileSync('/out/source.json', 'utf8'), text);
else writeFileSync('/out/source.json', text);
console.log(JSON.stringify({cases: outputs.map((x: any) => ({name: x.input.name, frames: x.frames.length, chilledNpcs: x.frames.some((f: any) => f.output.signatures.some(([id, s]: any) => id.startsWith('mob') && s.chill < 1)), mobs: x.frames.at(-1).output.mobs.map((m: any) => [m.id, m.state.hp])})), bytes: text.length, exactRepeat: true}));
