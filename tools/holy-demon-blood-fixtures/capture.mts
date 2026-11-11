// Canonical actual-source Holy Demon Blood witness (P-HOLY-DEMON-BLOOD-1), captured in the pinned linux/amd64 Node 22.23.4
// container. Holy's camp lifesteal (`holyCampLifestealOf(c.s.campClears)`, packages/server/src/sim/factions.ts:895-896) is
// added to the earned farm rows of the per-tick lifesteal, outside LS_CAP and LIFESTEAL_MAX (packages/shared/src/mods.ts:380-382).
// Each case rebuilds the declared world from unchanged source installers (production order), applies only the declared
// scripted operations (the source's own exports addPlayer/step/deferHit/grantCard, trusted hp and camp-count placements) and snapshots
// real state after every operation: each player's hp, private campsCleared and synced campClears, and every camp mob's hp and
// status. Nothing is read back from expected values.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {createWorld} from '/repo/packages/server/src/sim/world.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {deferHit} from '/repo/packages/server/src/sim/ledger.ts';
import {grantCard} from '/repo/packages/server/src/sim/chests.ts';
import {combatant} from '/repo/packages/server/src/sim/combatant.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string', 'closed capture arguments');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const TICK_MS = 50;
// p0 is the Holy under test, p1 the non-Holy control (Frost has no faction sustain: any heal it shows is a leak).
const PLAYERS = [
  {id: 'p0', faction: 'holy', x: 80, y: 112, weapon: ''},
  {id: 'p1', faction: 'frost', x: 176, y: 80, weapon: ''},
];
// gameplay.ts MODULES order, limited to the modules the Rust plan of this world runs (no regen, consumables, quests, traders,
// kill augments, terrain, Plague/Fire/Sentenced extras, walk hints: they are off in the native SimConfig of the comparison).
const installers = [
  'loot', 'weapons', 'targeting', 'projectiles', 'factions', 'mobs', 'buffs', 'feed', 'camps', 'chests',
  'mobLife', 'mobAI', 'abilities', 'vision', 'campHeal', 'cardHooks', 'bruiserPassives', 'mods',
];
const modules = await Promise.all(installers.map((m: string) => import('/repo/packages/server/src/sim/' + m + '.ts')));
const inputMap = JSON.parse(readFileSync('/capture/declared-map-input.json', 'utf8'));

const round = (x: number) => Math.round(x * 1e6) / 1e6;

function makeWorld() {
  const map = structuredClone(inputMap);
  for (const key of ['tiles', 'terrain', 'regionGrid', 'territoryGrid', 'featureGrid']) map[key] = Uint8Array.from(map[key]);
  let uid = 0;
  const w = createWorld({
    seed: 1,
    map,
    config: {
      minPlayers: PLAYERS.length, lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600,
      patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true, signatures: false,
      quests: false, training: false, dummies: false, planSeconds: 0,
    },
    random: mulberry32(12),
    rewardSalt: [1, 2, 3, 4],
    questSalt: [5, 6, 7, 8],
    newItemUid: () => 'U' + ++uid,
  });
  for (const m of modules) m.install(w);
  for (const p of PLAYERS) addPlayer(w, p.id, 'name' + p.id.slice(1), {faction: p.faction});
  step(w, TICK_MS);
  assert.equal(w.state.phase, 'active');
  for (const p of PLAYERS) {
    const s = w.state.players.get(p.id)!;
    const rt = w.players.get(p.id)!;
    s.x = p.x;
    s.y = p.y;
    s.facing = 0;
    s.weapon0 = p.weapon;
    s.weapon1 = '';
    rt.history = [{t: w.state.serverTime, x: s.x, y: s.y}];
  }
  w.events.length = 0;
  const mobs = [...w.state.mobs].filter(([, m]: any) => m.camp === 1).map(([id]: any) => id);
  assert.equal(mobs.length, 3, 'the declared map spawns its three-member camp');
  return {w, mobs};
}

const snapshot = (w: any, mobs: string[]) => ({
  tick: w.state.tick,
  time: w.state.serverTime,
  players: PLAYERS.map((p) => {
    const s = w.state.players.get(p.id)!;
    const rt = w.players.get(p.id)!;
    return {id: p.id, hp: round(s.hp), campsCleared: rt.campsCleared ?? 0, campClears: s.campClears};
  }),
  mobs: mobs.map((id) => {
    const m = w.state.mobs.get(id);
    return {id, hp: m ? round(m.hp) : null, status: m ? m.status : null};
  }),
});

type Op = Record<string, any>;

/** One declared case: a fresh world, then the ordered operations; a snapshot after the initial placement and every op. */
function runCase(name: string, declared: Op[]) {
  const {w, mobs} = makeWorld();
  const expanded: Op[] = [];
  for (const raw of declared) {
    if (raw.op === 'step' && (raw.n ?? 1) > 1) {
      for (let i = 0; i < raw.n; i++) expanded.push({op: 'step'});
    } else {
      expanded.push(raw);
    }
  }
  const frames = [snapshot(w, mobs)];
  for (const o of expanded) {
    switch (o.op) {
      case 'hp':
        // Trusted placement: the player's current hp (the source's PlayerState.hp).
        w.state.players.get(o.player)!.hp = o.hp;
        break;
      case 'mob_hp':
        // Trusted placement: a camp mob's current hp (MobState.hp), so a lethal pass feeds a small, unsaturated lifesteal.
        w.state.mobs.get(o.mob)!.hp = o.hp;
        break;
      case 'card':
        // The source export every card grant goes through (chests.ts:189-195): count + 1, mods re-folded at once.
        assert.notEqual(grantCard(w, combatant(w, o.player) as any, o.card), null, 'declared card granted');
        break;
      case 'clears':
        // Trusted placement: the private camp count (PlayerRuntime.campsCleared) as campHeal.ts:92 would have left it; the
        // public mirror (PlayerState.campClears) is synced by the installed bruiserPassives update (bruiserPassives.ts:62-70).
        w.players.get(o.player)!.campsCleared = o.n;
        break;
      case 'defer':
        // The source export: queues the entry for the next tick's ledger (ledger.ts:72-76, step.ts opens that ledger with it).
        assert.ok(mobs.includes(o.victim) || w.state.players.has(o.victim), 'declared victim exists');
        deferHit(w, {
          victim: o.victim, by: {id: o.by, name: 'name' + o.by.slice(1)},
          packet: {raw: o.raw, phys: 1, magic: 0, true: 0}, weapon: undefined, stagger: false,
        });
        break;
      case 'step':
        step(w, TICK_MS);
        break;
      default:
        throw new Error('unknown declared operation ' + o.op);
    }
    frames.push(snapshot(w, mobs));
  }
  return {name, ops: expanded, frames};
}

function run() {
  const {mobs} = makeWorld();
  const [m1, m2, m3] = mobs;
  const hitThenTwo = (by: string, raw: number) => [{op: 'defer', by, victim: m2, raw}, {op: 'step', n: 2}];
  const cases = [
    // Zero clears: the camp term is 0 (Holy's own share only).
    runCase('holy_zero_clears', [{op: 'hp', player: 'p0', hp: 500}, ...hitThenTwo('p0', 60)]),
    // One and twenty clears: +0.005 per clear on the share, outside LS_CAP (20 x 0.005 x 2.7 would hit LS_CAP as a row).
    runCase('holy_one_clear', [{op: 'hp', player: 'p0', hp: 500}, {op: 'clears', player: 'p0', n: 1}, ...hitThenTwo('p0', 60)]),
    runCase('holy_twenty_clears', [{op: 'hp', player: 'p0', hp: 500}, {op: 'clears', player: 'p0', n: 20}, ...hitThenTwo('p0', 60)]),
    // Own share at its 0.6 ceiling plus 60 clears (0.3): 0.9, past LIFESTEAL_MAX (0.85), because the farm rows sit outside it.
    runCase('holy_sixty_clears_past_lifesteal_max', [{op: 'hp', player: 'p0', hp: 60}, {op: 'clears', player: 'p0', n: 60}, ...hitThenTwo('p0', 60)]),
    // The non-Holy control: twenty clears give a Frost nothing.
    runCase('frost_twenty_clears_control', [{op: 'hp', player: 'p1', hp: 500}, {op: 'clears', player: 'p1', n: 20}, ...hitThenTwo('p1', 60)]),
    // Bloodthirst (lifestealMult x2 below half health) multiplies the farm rows, the camp term included (mods.ts:382).
    runCase('holy_bloodthirst_zero_clears', [
      {op: 'hp', player: 'p0', hp: 300}, {op: 'card', player: 'p0', card: 'leech1'}, {op: 'card', player: 'p0', card: 'bloodthirst'},
      {op: 'step'}, ...hitThenTwo('p0', 60),
    ]),
    runCase('holy_bloodthirst_twenty_clears', [
      {op: 'hp', player: 'p0', hp: 300}, {op: 'card', player: 'p0', card: 'leech1'}, {op: 'card', player: 'p0', card: 'bloodthirst'},
      {op: 'clears', player: 'p0', n: 20}, {op: 'step'}, ...hitThenTwo('p0', 60),
    ]),
    // A real clear: one tick's lethal hits kill the whole camp; the clear is paid after the pass (campHeal counts p0, the
    // campCleared chain syncs the mirror) and the same tick's lifesteal (systems) already includes it.
    runCase('holy_real_clear_same_tick', [
      {op: 'hp', player: 'p0', hp: 200},
      {op: 'mob_hp', mob: m1, hp: 20},
      {op: 'mob_hp', mob: m2, hp: 20},
      {op: 'mob_hp', mob: m3, hp: 20},
      {op: 'defer', by: 'p0', victim: m1, raw: 100000},
      {op: 'defer', by: 'p0', victim: m2, raw: 100000},
      {op: 'defer', by: 'p0', victim: m3, raw: 100000},
      {op: 'step', n: 2},
    ]),
  ];
  return {mobs, start: {players: PLAYERS.map((p) => ({id: p.id, faction: p.faction, x: p.x, y: p.y, weapon: p.weapon}))}, cases};
}

const first = run();
const repeat = run();
assert.deepEqual(first, repeat);

const sourceFiles = [
  'package.json',
  'package-lock.json',
  ...['packages/server/src/sim', 'packages/shared/src'].flatMap((dir) =>
    readdirSync('/repo/' + dir, {recursive: true}).filter((p: string) => p.endsWith('.ts')).map((p: string) => dir + '/' + p)),
].sort();
const sourceSha256 = Object.fromEntries(sourceFiles.map((p: string) => [p, createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex')]));
const result = {
  format: 'rh-holy-demon-blood-source/1',
  profile: {
    name: 'holy-demon-blood-pve-v1',
    installers,
    boundary:
      'Selected unchanged source installers in production order with declared initial placements and declared fixed-step operations; the declared operations call only source exports (addPlayer/step/deferHit/grantCard) plus trusted player hp, mob hp and PlayerRuntime.campsCleared placements. No full-default claim: regen, consumables, quests, traders, kill augments, terrain and the Plague/Fire/Sentenced extras are not installed, and training practice camps (which pay the clear without the campCleared chain) are not exercised.',
  },
  provenance: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sourceSha256,
    inputSha256: createHash('sha256').update(readFileSync('/capture/declared-map-input.json')).digest('hex'),
    recorderSha256: createHash('sha256').update(readFileSync('/capture/capture.mts')).digest('hex'),
  },
  case: first,
};
const text = JSON.stringify(result) + '\n';
if (args[0] === '--check') {
  assert.equal(readFileSync(outPath, 'utf8'), text, 'the checked-in Holy Demon Blood corpus is byte-identical');
} else {
  writeFileSync(outPath, text);
}
console.log(JSON.stringify({cases: first.cases.length, bytes: text.length, exactRepeat: true}));
