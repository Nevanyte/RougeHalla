// Canonical actual-source chest witness, captured in the pinned linux/amd64 Node 22.23.4 container.
// Records, from unmodified source with only passive hook observers and declared setup helpers: real camp-clear elite
// chest drops (options, camp, expiry, hold birth and reward draws), real `choose` intake for a card and for a skip,
// another player's refusal, and the stat-crate first-open boost drop and pick. Every expected value is source-written.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {mulberry32, isChestRefusal} from '/repo/packages/shared/src/index.ts';
import {createWorld, chainHook} from '/repo/packages/server/src/sim/world.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {combatant} from '/repo/packages/server/src/sim/combatant.ts';
import {enqueueClientMessage} from '/repo/packages/server/src/sim/inputs.ts';
import {crateHoldsStatChest} from '/repo/packages/server/src/sim/loot.ts';
import {grantCard} from '/repo/packages/server/src/sim/chests.ts';
import {modsOf, statSumsOf} from '/repo/packages/server/src/sim/mods.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string', 'closed capture arguments');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const TICK_MS = 50;
const installers = ['loot', 'weapons', 'targeting', 'projectiles', 'mobs', 'buffs', 'feed', 'camps', 'chests', 'mobLife', 'mobAI', 'abilities', 'vision', 'cardHooks', 'mods'];
const installersStat = ['loot', 'weapons', 'targeting', 'projectiles', 'mobs', 'buffs', 'feed', 'camps', 'chests', 'mobLife', 'mobAI', 'abilities', 'vision', 'consumables', 'cardHooks', 'mods'];
const campModules = await Promise.all(installers.map((m: string) => import('/repo/packages/server/src/sim/' + m + '.ts')));
const statModules = await Promise.all(installersStat.map((m: string) => import('/repo/packages/server/src/sim/' + m + '.ts')));
const CAMP_MAP = '/repo/tools/mob-runtime-fixtures/declared-map-input.json';
const STAT_MAP = '/repo/parity/initial-loot/input-map.json';
const campMap = JSON.parse(readFileSync(CAMP_MAP, 'utf8'));
const statMap = JSON.parse(readFileSync(STAT_MAP, 'utf8'));

const SETUPS: any = {
  camp: {
    mapPath: CAMP_MAP,
    map: campMap,
    modules: campModules,
    installers,
    players: [
      {faction: 'holy', x: 80, y: 112, weapon: 'wand'},
      {faction: 'plague', x: 176, y: 80, weapon: 'wand'},
      {faction: 'holy', x: 624, y: 624, weapon: ''},
    ],
    config: {minPlayers: 3, lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true, signatures: false, quests: false, training: false, dummies: false, planSeconds: 0},
  },
  stat: {
    mapPath: STAT_MAP,
    map: statMap,
    modules: statModules,
    installers: installersStat,
    players: [
      {faction: 'fire', x: 112, y: 112, weapon: ''},
      {faction: 'sentenced', x: 200, y: 200, weapon: ''},
    ],
    config: {minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: false, quests: false, training: false, dummies: false, planSeconds: 0},
  },
};

const plain = (x: any): any => x === undefined
  ? null
  : typeof x === 'number' && !Number.isFinite(x)
    ? null
    : x === null || typeof x !== 'object'
      ? x
      : x instanceof Map ? [...x].map(([k, v]) => [k, plain(v)])
        : x instanceof Set ? [...x].map(plain)
          : ArrayBuffer.isView(x) ? Array.from(x as any)
            : Array.isArray(x) ? x.map(plain)
              : typeof x.toJSON === 'function' ? plain(x.toJSON())
                : Object.fromEntries(Object.keys(x).filter((k) => typeof x[k] !== 'function').sort().map((k) => [k, plain(x[k])]));
const entries = (m: any): any[] => [...m].sort((a: any, b: any) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

const playerView = (w: any, players: any[], i: number): any => {
  const id = 'p' + i;
  const s = w.state.players.get(id)!;
  const rt = w.players.get(id)!;
  return {id, x: s.x, y: s.y, hp: s.hp, maxHp: s.maxHp, gv: s.gv, mobKills: rt.mobKills, build: entries(s.build), boosts: entries(s.extra.chestBoosts), mods: modsOf(s), sums: statSumsOf(s)};
};
const chestsView = (w: any): any[] => [...w.state.containers]
  .filter(([, c]: any) => c.kind === 'reward')
  .sort(([a]: any, [b]: any) => a < b ? -1 : a > b ? 1 : 0)
  .map(([id, c]: any) => ({id, x: c.x, y: c.y, camp: c.camp, label: c.label, expiresAt: c.expiresAt, options: [...c.options], takenBy: [...c.takenBy], pickers: [...c.pickers]}));
const campView = (w: any): any[] => [...w.state.camps].map((c: any) => ({alive: c.alive, state: c.state, clearedAt: c.clearedAt, respawnAt: c.respawnAt}));
function run(scenario: string): any {
  const campScenario = scenario !== 'stat-boost';
  const setup = campScenario ? SETUPS.camp : SETUPS.stat;
  const map = structuredClone(setup.map);
  for (const key of ['tiles', 'terrain', 'regionGrid', 'territoryGrid', 'featureGrid']) map[key] = Uint8Array.from(map[key]);
  let uid = 0;
  const w: any = createWorld({
    seed: 1,
    map,
    config: setup.config,
    random: mulberry32(12),
    rewardSalt: [1, 2, 3, 4],
    questSalt: [5, 6, 7, 8],
    newItemUid: () => 'U' + ++uid,
  });
  for (const m of setup.modules) m.install(w);
  const hooks: any[] = [];
  chainHook(w, 'rewardOffered', (world: any, box: any, kind: any, camp: any, eligible: any) => hooks.push({tick: world.state.tick, kind: 'offered', offer: kind, camp, options: [...box.options], eligible: [...eligible]}));
  chainHook(w, 'rewardChosen', (_world: any, c: any, box: any, option: any) => hooks.push({kind: 'chosen', by: c.id, chest: box.id, option}));
  const players = setup.players;
  for (let i = 0; i < players.length; i++) addPlayer(w, 'p' + i, 'name' + i, {faction: players[i].faction as any});
  // The source equivalent of the native reset_active: one step closes the lobby, then the declared placements apply.
  step(w, TICK_MS);
  assert.equal(w.state.phase, 'active');
  for (let i = 0; i < players.length; i++) {
    const id = 'p' + i;
    const s = w.state.players.get(id)!;
    const rt = w.players.get(id)!;
    s.x = players[i].x; s.y = players[i].y; s.facing = 0; s.weapon0 = players[i].weapon; s.weapon1 = '';
    rt.history = [{t: w.state.serverTime, x: s.x, y: s.y}];
  }
  w.events.length = 0;
  let draws = 0;
  const baseReward = w.rewardRandom;
  w.rewardRandom = () => { draws++; return baseReward(); };
  const commands: any[] = [];
  const trace: any[] = [];
  const frames: any[] = [];
  const events: any[] = [];
  const relevant = (e: any): boolean => e.type === 'gv' || (e.type === 'fx' && (e.fx.kind === 'chestTaken' || e.fx.kind === 'heal')) || (e.type === 'toast' && isChestRefusal(e.text));
  const snap = (label: string): void => {
    frames.push({label, tick: w.state.tick, time: w.state.serverTime, camp: campView(w), chests: chestsView(w), players: players.map((_: any, i: number) => playerView(w, players, i)), draws});
  };
  const stepRec = (): any[] => {
    const evs = step(w, TICK_MS);
    for (const e of evs) if (relevant(e)) events.push([w.state.tick, plain(e)]);
    return evs;
  };
  const place = (id: string, x: number, y: number): void => {
    const s = w.state.players.get(id)!;
    const rt = w.players.get(id)!;
    s.x = x; s.y = y;
    rt.history = [{t: w.state.serverTime, x, y}];
  };
  const choose = (id: string, chest: string, pick: number): void => {
    assert.equal(enqueueClientMessage(w.players.get(id)!.inputs, 'choose', {chest, pick}), true);
  };
  const pickup = (id: string, containerId: string): void => {
    assert.equal(enqueueClientMessage(w.players.get(id)!.inputs, 'pickup', {containerId}), true);
  };
  // Declared bootstrap like the cards corpus's grant helper: both camp contributors hold the same augment so the
  // source pool excludes it, which makes the eligible-picker wiring observable in the chest options.
  const grants: any[] = [];
  if (scenario === 'card-pick-held') {
    for (const id of ['p0', 'p1']) {
      const c = combatant(w, id) as any;
      assert.equal(grantCard(w, c, 'overkill'), 1);
      grants.push({actor: id, card: 'overkill'});
    }
  }
  const lastTargets = new Map<string, string>();
  const clearLoop = (maxTicks: number): boolean => {
    for (let i = 0; i < maxTicks; i++) {
      for (let pi = 0; pi < 2; pi++) {
        const id = 'p' + pi;
        const s = w.state.players.get(id);
        const rt = w.players.get(id);
        if (!s || s.status !== 'alive' || rt!.down || rt!.resolved) continue;
        const candidates = [...w.state.mobs].filter(([, m]: any) => m.status === 'alive');
        const entry = candidates.find(([, m]: any) => m.kind === 'mob') ?? candidates[0];
        if (!entry) continue;
        const target = entry[0];
        if (lastTargets.get(id) !== target) {
          rt!.inputs.pushAction({kind: 'target', id: target});
          commands.push([w.state.tick + 1, id, target]);
          lastTargets.set(id, target);
        }
      }
      stepRec();
      const camp = w.state.camps[0];
      trace.push([w.state.tick, camp.alive, camp.state, chestsView(w).length, draws]);
      if (camp.state === 2) return true;
    }
    return false;
  };
  const quiet = (n: number): void => { for (let i = 0; i < n; i++) stepRec(); };
  const result = (extra: any): any => ({
    scenario,
    input: {players, scenario, grants, installers: setup.installers, seeds: {seed: 1, random: 12, rewardSalt: [1, 2, 3, 4], questSalt: [5, 6, 7, 8]}, map: setup.mapPath.replace('/repo/', ''), config: setup.config, ...extra},
    commands, trace, frames, events, hooks,
    draws,
    next: Array.from({length: 4}, () => w.rewardRandom()),
  });
  snap('baseline');
  if (campScenario) {
    assert.ok(clearLoop(4000), 'the camp cleared through ordinary attacks');
    snap('clear');
    const dropped = chestsView(w);
    assert.equal(dropped.length, 1, 'one camp chest dropped');
    const chest = dropped[0];
    quiet(2);
    snap('held');
    if (scenario === 'skip-heal') {
      quiet(62);
      const s = w.state.players.get('p0')!;
      s.hp = s.maxHp * 0.4;
    }
    place('p0', chest.x, chest.y);
    choose('p0', chest.id, scenario.startsWith('card-pick') ? 0 : -1);
    stepRec();
    snap('chosen');
    if (scenario.startsWith('card-pick')) {
      place('p1', chest.x, chest.y);
      choose('p1', chest.id, 0);
      stepRec();
      snap('refused-other');
    }
    return result({chestPick: scenario.startsWith('card-pick') ? 0 : -1});
  }
  const statCrates = [...w.state.containers]
    .filter(([id, c]: any) => c.kind === 'chest' && !c.opened && crateHoldsStatChest(w, id))
    .map(([id]: any) => id);
  assert.ok(statCrates.length > 0, 'the source picked at least one stat crate');
  const crate = statCrates[0];
  const box = w.state.containers.get(crate)!;
  place('p0', box.x, box.y);
  pickup('p0', crate);
  stepRec();
  snap('stat-dropped');
  quiet(2);
  snap('stat-held');
  const chest = chestsView(w).find((c: any) => c.label === 'Stat Chest');
  assert.ok(chest, 'a stat chest dropped at the crate');
  place('p0', chest.x, chest.y);
  choose('p0', chest.id, 0);
  stepRec();
  snap('boost-picked');
  return result({statCrates, chestPick: 0});
}

const cases = ['card-pick', 'card-pick-held', 'skip-gv', 'skip-heal', 'stat-boost'].map((scenario) => {
  const first = run(scenario);
  assert.deepEqual(run(scenario), first, 'the actual-source run repeats exactly: ' + scenario);
  return first;
});

const sourceFiles = [
  'package.json',
  'package-lock.json',
  ...['packages/server/src/sim', 'packages/shared/src'].flatMap((dir) =>
    readdirSync('/repo/' + dir, {recursive: true}).filter((p: string) => p.endsWith('.ts')).map((p: string) => dir + '/' + p)),
].sort();
const sourceSha256 = Object.fromEntries(sourceFiles.map((p) => [p, createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex')]));
const result = {
  format: 'rh-chest-runtime-source/1',
  profile: {
    name: 'chest-camp-stat-v1',
    boundary:
      'Selected unchanged source installers with passive world.hooks observers, declared initial placements and real fixed-step attacks; the camp chest comes from the actual mobKilled chests link, the stat chest from the actual first opening of a source-picked stat crate. Named place/pickup/choose helpers are declared setup before a real action; no expected state is constructed.',
  },
  provenance: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sourceSha256,
    maps: {camp: createHash('sha256').update(readFileSync(CAMP_MAP)).digest('hex'), stat: createHash('sha256').update(readFileSync(STAT_MAP)).digest('hex')},
    recorderSha256: createHash('sha256').update(readFileSync('/capture/capture.mts')).digest('hex'),
  },
  cases,
};
const text = JSON.stringify(result) + '\n';
if (args[0] === '--check') {
  assert.equal(readFileSync(outPath, 'utf8'), text, 'the checked-in chest corpus is byte-identical');
} else {
  writeFileSync(outPath, text);
}
console.log(JSON.stringify({cases: cases.length, frames: cases.map((c) => c.frames.length), draws: cases.map((c) => c.draws), bytes: text.length, exactRepeat: true}));
