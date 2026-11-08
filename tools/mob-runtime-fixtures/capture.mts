// Canonical actual-source mob lifecycle witness, captured in the pinned linux/amd64 Node 22.23.4 container.
// Records a real camp clear from unmodified source: the ordered `mobKilled`/`campCleared` hook producer calls with their
// arguments, the reward payout state, the ground weapon awards and the 180 s full-roster respawn boundary driven through
// ordinary fixed steps. The harness adds only passive observers of `world.hooks` (they call the installed chain first and
// change no gameplay state); every expected value is written by the source, never read back into it.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {createWorld} from '/repo/packages/server/src/sim/world.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string', 'closed capture arguments');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const TICK_MS = 50;
const DENSE_TICKS = 500;
const installers = [
  'loot', 'weapons', 'targeting', 'projectiles', 'mobs', 'buffs', 'feed', 'camps', 'chests',
  'mobLife', 'mobAI', 'abilities', 'vision', 'cardHooks', 'mods',
];
const modules = await Promise.all(installers.map((m: string) => import('/repo/packages/server/src/sim/' + m + '.ts')));
const inputMap = JSON.parse(readFileSync('/capture/declared-map-input.json', 'utf8'));

/** JSON projection of source state: Maps become [key, value] pairs, Sets arrays, non-finite numbers null. */
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

const players = [
  {faction: 'holy', x: 80, y: 112, weapon: 'wand'},
  {faction: 'plague', x: 176, y: 80, weapon: 'wand'},
  {faction: 'holy', x: 624, y: 624, weapon: ''},
];

/** One declared fixed-step scenario: the same initial placements and scripted target locks on every replay. */
function run() {
  const map = structuredClone(inputMap);
  for (const key of ['tiles', 'terrain', 'regionGrid', 'territoryGrid', 'featureGrid']) map[key] = Uint8Array.from(map[key]);
  let uid = 0;
  const w = createWorld({
    seed: 1,
    map,
    config: {
      minPlayers: players.length,
      lobbySeconds: 30,
      fillSeconds: 0,
      patienceSeconds: 3600,
      patienceMinSeconds: 3600,
      suddenDeathSeconds: 3600,
      mobs: true,
      signatures: false,
      quests: false,
      training: false,
      dummies: false,
      planSeconds: 0,
    },
    random: mulberry32(12),
    rewardSalt: [1, 2, 3, 4],
    questSalt: [5, 6, 7, 8],
    newItemUid: () => 'U' + ++uid,
  });
  for (const m of modules) m.install(w);

  // Passive producer observers: run the installed chain first, then record the ordered calls (no source writes).
  const hooks: any[] = [];
  const chainedMobKilled = w.hooks.mobKilled;
  w.hooks.mobKilled = (world: any, rt: any, mob: any) => {
    chainedMobKilled?.(world, rt, mob);
    hooks.push({tick: world.state.tick, time: world.state.serverTime, kind: 'mobKilled', killer: rt.id, type: mob.type, zone: mob.zone, camp: mob.camp, elite: mob.elite, at: {x: mob.at.x, y: mob.at.y}});
  };
  const chainedCampCleared = w.hooks.campCleared;
  w.hooks.campCleared = (world: any, camp: number) => {
    chainedCampCleared?.(world, camp);
    hooks.push({tick: world.state.tick, time: world.state.serverTime, kind: 'campCleared', camp});
  };

  for (let i = 0; i < players.length; i++) addPlayer(w, 'p' + i, 'name' + i, {faction: players[i].faction});
  // The source equivalent of the native reset_active: one step closes the lobby, then the declared placements are applied.
  step(w, TICK_MS);
  assert.equal(w.state.phase, 'active');
  for (let i = 0; i < players.length; i++) {
    const id = 'p' + i;
    const s = w.state.players.get(id)!;
    const rt = w.players.get(id)!;
    s.x = players[i].x;
    s.y = players[i].y;
    s.facing = 0;
    s.weapon0 = players[i].weapon;
    s.weapon1 = '';
    rt.history = [{t: w.state.serverTime, x: s.x, y: s.y}];
  }
  w.events.length = 0;

  const snapshot = () => {
    const ids = [...w.state.mobs.keys()].sort();
    return {
      tick: w.state.tick,
      time: w.state.serverTime,
      counter: w.idCounter,
      phase: w.state.phase,
      players: [...w.state.players].map(([id, s]: any) => {
        const rt = w.players.get(id);
        return {
          id,
          x: s.x,
          y: s.y,
          hp: s.hp,
          maxHp: s.maxHp,
          status: s.status,
          weapon0: s.weapon0,
          weapon1: s.weapon1,
          mobKills: rt.mobKills,
          gv: s.gv,
          stats: Object.fromEntries([...s.mobStats].sort(([a]: any, [b]: any) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]: any) => [k, v])),
        };
      }),
      camps: [...w.state.camps].map((c: any) => ({alive: c.alive, state: c.state, clearedAt: c.clearedAt, respawnAt: c.respawnAt})),
      mobs: ids.map((id: string) => {
        const s = w.state.mobs.get(id)!;
        const rt = w.mobs.get(id)!;
        const b = rt.brain;
        return {
          id,
          state: {x: s.x, y: s.y, hp: s.hp, maxHp: s.maxHp, facing: s.facing, status: s.status, readyAt: s.readyAt, drawStartedAt: s.drawStartedAt},
          brain: {mode: b.mode, target: b.target, lastCombatAt: b.lastCombatAt, lastMoveAt: b.lastMoveAt, phase: b.phase, diedAt: b.diedAt, elite: b.elite, region: b.region, home: b.home, homeFacing: b.homeFacing, holding: b.holding, moving: b.moving, goal: b.goal, threat: plain(b.threat), lastAim: b.lastAim},
          inputs: {aim: rt.inputs.aim, moveBefore: rt.inputs.moveBefore, aimBefore: rt.inputs.aimBefore, actions: rt.inputs.actions.map((a: any) => ({kind: a.kind, a: a.a})), move: rt.inputs.move},
          // A copy: the source walker consumes this array in place, so a stored reference would show every frame empty.
          path: plain(rt.path),
          lastHitAt: rt.lastHitAt,
        };
      }),
      containers: [...w.state.containers].filter(([, c]: any) => c.kind === 'ground').map(([id, c]: any) => ({id, items: [...c.items].map((i: any) => i.def), x: c.x, y: c.y})),
    };
  };

  const initial = snapshot();
  const frames: any[] = [];
  const trace: any[] = [];
  const lastTargets = new Map<string, string>();
  let cleared = false;
  let clearTick: number | null = null;
  let respawnTick: number | null = null;
  for (let i = 0; ; i++) {
    const commands: any[] = [];
    if (w.state.phase === 'active' && !cleared) {
      // Scripted target locks while the camp lives: the first still-alive normal mob, else the first alive mob (the elite).
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
          commands.push({actor: id, kind: 'target', id: target});
          lastTargets.set(id, target);
        }
      }
    }
    const before = hooks.length;
    step(w, TICK_MS);
    const tick = w.state.tick;
    const camp = w.state.camps[0];
    trace.push([tick, camp.alive, camp.state, w.state.mobs.size]);
    const newHooks = hooks.slice(before);
    const frame = {commands, ...snapshot(), hooks: newHooks};
    if (tick <= DENSE_TICKS) frames.push(frame);
    if (!cleared && camp.state === 2) {
      cleared = true;
      clearTick = tick;
      respawnTick = Math.round(camp.respawnAt / TICK_MS);
    }
    if (respawnTick !== null) {
      if (tick >= respawnTick - 2 && tick <= respawnTick + 2) frames.push({...frame, boundary: true});
      if (tick >= respawnTick + 2) break;
    }
    if (i > 20000) throw new Error('the camp never respawned');
  }
  assert.ok(cleared && clearTick !== null && respawnTick !== null, 'the camp cleared and its respawn clock is set');
  assert.ok(hooks.some((h) => h.kind === 'mobKilled'), 'real mobKilled producer calls');
  assert.ok(hooks.some((h) => h.kind === 'campCleared'), 'a real campCleared producer call');
  assert.ok(frames.some((f) => f.boundary), 'frames at the respawn boundary');
  assert.ok(trace.some((t) => t[1] === 3), 'the full roster returned (three alive at a respawned camp)');
  return {input: {players, script: 'joint-target-locks', denseTicks: DENSE_TICKS}, initial, frames, trace, hooks, clearTick, respawnTick};
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
const sourceSha256 = Object.fromEntries(sourceFiles.map((p) => [p, createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex')]));
const result = {
  format: 'rh-mob-lifecycle-source/1',
  profile: {
    name: 'mob-lifecycle-basic-pve-v1',
    installers,
    signatures: false,
    consumables: 'omitted entire installer',
    boundary:
      'Selected unchanged source installers with passive world.hooks observers, declared initial player placements and one declared fixed-step scenario. No full-default claim; the passive camp heal/regen producers (P-MOBS-2) and the training dummy constructor (P-ARENA-2) are not installed.',
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
  assert.equal(readFileSync(outPath, 'utf8'), text, 'the checked-in mob lifecycle corpus is byte-identical');
} else {
  writeFileSync(outPath, text);
}
console.log(JSON.stringify({
  frames: first.frames.length,
  trace: first.trace.length,
  hooks: first.hooks.length,
  clearTick: first.clearTick,
  respawnTick: first.respawnTick,
  bytes: text.length,
  exactRepeat: true,
}));
