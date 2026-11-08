// Canonical actual-source Frozen Justice witness (P-FACTION-5), captured in the pinned linux/amd64 Node 22.23.4
// container. Each case rebuilds the declared world from unchanged source installers, applies only the declared scripted
// operations (the source's own exports addPlayer/step/recordHit/applyLedger/downPlayer and the installed chains), and
// snapshots real public state after every operation: each player's weapon lock, frostEliteGuard and defenseOf() armor/shield.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {createWorld} from '/repo/packages/server/src/sim/world.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {combatant, defenseOf} from '/repo/packages/server/src/sim/combatant.ts';
import {applyLedger, recordHit} from '/repo/packages/server/src/sim/ledger.ts';
import {downPlayer} from '/repo/packages/server/src/sim/arena.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string', 'closed capture arguments');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const TICK_MS = 50;
const PLAYERS = [
  {id: 'p0', faction: 'frost', x: 80, y: 112, weapon: 'wand'},
  {id: 'p1', faction: 'holy', x: 176, y: 80, weapon: ''},
];
// The source's own install order, limited to the modules whose rows the ported plan owns (the boundary is declared below).
const installers = [
  'loot', 'weapons', 'targeting', 'projectiles', 'mobs', 'buffs', 'feed', 'camps', 'chests',
  'mobLife', 'mobAI', 'abilities', 'vision', 'cardHooks', 'factions', 'bruiserPassives', 'mods',
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
  const walkers = [...w.state.mobs].filter(([, m]: any) => m.status === 'alive');
  const elite = walkers.find(([, m]: any) => m.kind === 'elite');
  const normal = walkers.find(([, m]: any) => m.kind === 'mob');
  assert.ok(elite && normal, 'the declared map has its normal camp roster and the elite');
  return {w, eliteId: elite![0], normalId: normal![0]};
}

const snapshot = (w: any) => ({
  tick: w.state.tick,
  time: w.state.serverTime,
  players: PLAYERS.map((p) => {
    const s = w.state.players.get(p.id)!;
    const rt = w.players.get(p.id)!;
    const d = defenseOf(s);
    return {id: p.id, lock: rt.weapon.lock ?? null, guard: s.frostEliteGuard === true, armor: round(d.armor), shield: round(d.shield)};
  }),
});

type Op = Record<string, any>;

/** One declared case: a fresh world, then the ordered operations; a snapshot after the initial placement and every op. */
function runCase(name: string, declared: Op[], mobs: {elite: string; normal: string}) {
  const {w, eliteId, normalId} = makeWorld();
  const resolve = (o: Op) => {
    const r: Op = {...o};
    for (const key of ['victim', 'target', 'holder', 'attacker']) {
      if (r[key] === 'ELITE') r[key] = eliteId;
      if (r[key] === 'NORMAL') r[key] = normalId;
    }
    return r;
  };
  const expanded: Op[] = [];
  for (const raw of declared) {
    if (raw.op === 'step' && (raw.n ?? 1) > 1) {
      for (let i = 0; i < raw.n; i++) expanded.push({op: 'step'});
    } else {
      expanded.push(resolve(raw));
    }
  }
  const applied: Op[] = [];
  const frames = [snapshot(w)];
  for (const o of expanded) {
    switch (o.op) {
      case 'place': {
        const s = w.state.players.get(o.player)!;
        const rt = w.players.get(o.player)!;
        s.x = o.x;
        s.y = o.y;
        rt.history = [{t: w.state.serverTime, x: s.x, y: s.y}];
        break;
      }
      case 'lock':
        w.players.get(o.player)!.weapon.lock = o.target ?? null;
        break;
      case 'step':
        step(w, TICK_MS);
        break;
      case 'hit':
        recordHit(w, {
          victim: o.victim, by: {id: o.by, name: o.by}, packet: {raw: o.raw ?? 10, phys: 1, magic: 0, true: 0},
          weapon: o.weapon ?? 'wand', stagger: false,
        });
        applyLedger(w);
        break;
      case 'blocked':
        w.hooks.blocked?.(w, combatant(w, o.holder)!, combatant(w, o.attacker)!, {raw: 10, phys: 1, magic: 0, true: 0}, true);
        break;
      case 'down': {
        downPlayer(w, w.state.players.get(o.player)!, w.players.get(o.player)!, 'died');
        break;
      }
      case 'run_ended':
        w.hooks.runEnded?.(w);
        break;
      case 'camp_cleared':
        w.hooks.campCleared?.(w, 0);
        break;
      default:
        throw new Error('unknown declared operation ' + o.op);
    }
    applied.push(o);
    frames.push(snapshot(w));
  }
  // The elite/normal identities and initial poses are declared once at the corpus root.
  return {name, ops: applied, frames};
}

function run() {
  const probe = makeWorld();
  const mobs = {elite: probe.eliteId, normal: probe.normalId};
  const cases = [
    runCase('idle_no_contact', [{op: 'step', n: 3}], mobs),
    runCase('locked_elite_guard', [
      {op: 'place', player: 'p0', x: 114, y: 112},
      {op: 'step'},
      {op: 'lock', player: 'p0', target: 'ELITE'},
      {op: 'step'},
      {op: 'step'},
    ], mobs),
    runCase('hit_contact_linger', [
      {op: 'place', player: 'p0', x: 114, y: 112},
      {op: 'hit', by: 'p0', victim: 'ELITE', raw: 10},
      {op: 'step'},
      {op: 'place', player: 'p0', x: 560, y: 48},
      {op: 'step', n: 40},
    ], mobs),
    runCase('normal_mob_hit_no_guard', [
      {op: 'place', player: 'p0', x: 114, y: 130},
      {op: 'hit', by: 'p0', victim: 'NORMAL', raw: 10},
      {op: 'step'},
    ], mobs),
    runCase('holy_hit_elite_no_guard', [
      {op: 'place', player: 'p1', x: 114, y: 112},
      {op: 'hit', by: 'p1', victim: 'ELITE', raw: 10},
      {op: 'step'},
    ], mobs),
    runCase('blocked_contact_guard', [
      {op: 'place', player: 'p0', x: 114, y: 112},
      {op: 'blocked', holder: 'p0', attacker: 'ELITE'},
      {op: 'step'},
    ], mobs),
    runCase('death_clears_guard', [
      {op: 'place', player: 'p0', x: 114, y: 112},
      {op: 'hit', by: 'p0', victim: 'ELITE', raw: 10},
      {op: 'step'},
      {op: 'down', player: 'p0'},
      {op: 'step'},
    ], mobs),
    runCase('run_end_clears_guard', [
      {op: 'place', player: 'p0', x: 114, y: 112},
      {op: 'hit', by: 'p0', victim: 'ELITE', raw: 10},
      {op: 'step'},
      {op: 'run_ended'},
    ], mobs),
    runCase('camp_cleared_link', [
      {op: 'place', player: 'p0', x: 114, y: 112},
      {op: 'hit', by: 'p0', victim: 'ELITE', raw: 10},
      {op: 'step'},
      {op: 'place', player: 'p0', x: 560, y: 48},
      {op: 'camp_cleared'},
      {op: 'step', n: 40},
    ], mobs),
  ];
  const base = makeWorld();
  const start = {players: PLAYERS.map((p) => ({id: p.id, faction: p.faction, x: p.x, y: p.y, weapon: p.weapon}))};
  return {
    elite: {id: mobs.elite, x: round(base.w.state.mobs.get(mobs.elite)!.x), y: round(base.w.state.mobs.get(mobs.elite)!.y)},
    normal: {id: mobs.normal},
    start,
    cases,
  };
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
  format: 'rh-bruiser-frozen-justice-source/1',
  profile: {
    name: 'bruiser-frozen-justice-pve-v1',
    installers,
    boundary:
      'Selected unchanged source installers with declared initial placements and declared fixed-step operations; the declared operations call only source exports (addPlayer/step/recordHit/applyLedger/downPlayer) and the source-installed blocked/runEnded/campCleared chains. No full-default claim: the camp-heal/regen producers (P-MOBS-2), training constructors (P-ARENA-2/P-MOBS-1), quests (P-QUEST-1) and other pending consumer modules are not installed.',
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
  assert.equal(readFileSync(outPath, 'utf8'), text, 'the checked-in Frozen Justice corpus is byte-identical');
} else {
  writeFileSync(outPath, text);
}
console.log(JSON.stringify({cases: first.cases.length, bytes: text.length, exactRepeat: true}));
