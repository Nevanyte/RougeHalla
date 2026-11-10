// Two new actual-World tour-supply regressions. No quest progress/visited/recheck/status is installed by this tool.
// Source imports may be redirected only to a disposable read-only-mounted-source copy by the mutation runner.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const args = process.argv.slice(2);
assert(args.length === 2 || (args.length === 4 && args[2] === '--repo'), 'closed arguments');
const [mode, output] = args;
assert(mode === '--write' || mode === '--check');
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
const ROOT = args[3] ?? '/repo';
const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const TOOL_REL = 'tools/quest-tour-supply-fixtures';
const IMAGE = 'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292';
const BASE_COMMIT = '4151b3af597cc06d1b3b77f4e3e21cc9906b6a86';
const digest = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex');
const repo = (p: string): string => join(ROOT, p);
const read = (p: string): string => readFileSync(p, 'utf8');
const pin = (p: string): any => ({bytes: statSync(p).size, sha256: digest(readFileSync(p))});
const plain = (v: any): any => JSON.parse(JSON.stringify(v));
const load = (p: string): Promise<any> => import(pathToFileURL(repo(p)).href);
const shared = await load('packages/shared/src/index.ts');
const mapgen = await load('packages/shared/src/mapgen.ts');
const mapWire = await load('packages/shared/src/mapWire.ts');
const gameplay = await load('packages/server/src/sim/gameplay.ts');
const stepMod = await load('packages/server/src/sim/step.ts');
const inputMod = await load('packages/server/src/sim/inputs.ts');
const mobLife = await load('packages/server/src/sim/mobLife.ts');

const CONFIG = {
  minPlayers: 2, lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
  suddenDeathSeconds: 3600, mobs: true, signatures: false, quests: true, training: false, dummies: false,
  planSeconds: 0, pvpRules: false,
};
const SEATS = [
  {id: 'p0', faction: 'holy', name: 'name0', bot: false},
  {id: 'p1', faction: 'fire', name: 'name1', bot: false},
  {id: 'p2', faction: 'plague', name: 'name2', bot: false},
];
const REGIONS = ['fire', 'sentenced', 'plague', 'frost', 'holy'];
const sortPairs = (m: Map<any, any>): any[] => [...m].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
function alive(w: any): any[] {
  return [...w.mobs].filter(([id, rt]: any) => {
    const s = w.state.mobs.get(id);
    return rt.brain && s?.status === 'alive' && (s.kind === 'mob' || s.kind === 'elite');
  }).map(([id, rt]: any) => ({id, rt, s: w.state.mobs.get(id)}));
}
function scenario(name: string, keepRegions: string[], expectedStatus: string): any {
  const map = mapgen.generateMap(1, 0, {decor: false});
  let uid = 0;
  const w = gameplay.createGameWorld({seed: 1, map, config: CONFIG,
    random: shared.mulberry32(12), rewardSalt: [1, 2, 3, 4], newItemUid: () => 'U' + ++uid},
    {signatures: false, walkHints: false});
  for (const p of SEATS) stepMod.addPlayer(w, p.id, p.name, {faction: p.faction, bot: p.bot});
  const actions: any[] = [];
  const frames: any[] = [];
  const notices: any[] = [];
  let seq = 0;
  const action = (kind: string, fields: any = {}) => actions.push({tick: w.state.tick, seq: seq++, kind, ...fields});
  const collectEvents = (events: any[]) => {
    for (const event of events) {
      if (event.type === 'toast' || (event.type === 'gv' && event.reason === 'quest'))
        notices.push({tick: w.state.tick, time: w.state.serverTime, event: plain(event)});
    }
  };
  const step = () => { const events = stepMod.step(w, 50); collectEvents(events); };
  step();
  assert.equal(w.state.phase, 'active');
  const q = [...w.quests.quests.values()].find((q: any) => q.def.id === 'grand-tour') as any;
  assert(q && q.published && q.s.status === 'open', 'actual salt profile has a known open Grand Tour');
  const snap = (label: string) => {
    const supply: any = Object.fromEntries(REGIONS.map((region) => [region, alive(w).filter((m) => m.rt.brain.region === region).length]));
    const humans = SEATS.map(({id}) => {
      const p = w.state.players.get(id), rt = w.players.get(id);
      return {id, status: p.status, down: !!rt.down, resolved: rt.resolved, bot: rt.bot,
        accepted: q.s.accepted.get(id) === true, progress: q.s.progress.get(id) ?? 0,
        visited: [...(q.tours.get(id) ?? [])].sort(),
        visitedRegions: q.s.visitedRegions.get(id) ?? 0,
        x: p.x, y: p.y, hp: p.hp, weapon0: p.weapon0, weapon1: p.weapon1,
        gv: plain(rt.gv), mobStats: sortPairs(p.mobStats)};
    });
    frames.push({label, tick: w.state.tick, time: w.state.serverTime, actionCount: actions.length,
      phase: w.state.phase, recheck: w.quests.recheck, unknown: w.state.unknownQuests,
      quest: {id: q.id, def: q.def.id, published: q.published, status: q.s.status,
        at: {x: q.s.x, y: q.s.y}, accepted: sortPairs(q.s.accepted), progress: sortPairs(q.s.progress),
        visitedRegions: sortPairs(q.s.visitedRegions), visits: sortPairs(q.tours).map(([id, v]) => [id, [...v].sort()]),
        expiresAt: q.s.expiresAt, closedAt: q.closedAt, doneBy: q.s.doneBy, carrier: q.s.carrier,
        giverPresent: !!q.npcId && w.state.mobs.has(q.npcId), containers: [...q.containers]},
      offers: [...w.quests.quests.values()].map((offer: any) => ({id: offer.id, def: offer.def.id,
        status: offer.s.status, published: offer.published, at: {x: offer.s.x, y: offer.s.y},
        tokens: plain(offer.placement.tokens ?? []), parcel: plain(offer.placement.parcel ?? null),
        giver: offer.npcId, giverPresent: !!offer.npcId && w.state.mobs.has(offer.npcId),
        accepted: sortPairs(offer.s.accepted), progress: sortPairs(offer.s.progress),
        visitedRegions: sortPairs(offer.s.visitedRegions),
        visits: sortPairs(offer.tours).map(([id, v]) => [id, [...v].sort()]),
        expiresAt: offer.s.expiresAt, closedAt: offer.closedAt, publishAt: offer.publishAt,
        finder: offer.finder, doneBy: offer.s.doneBy, carrier: offer.s.carrier, containers: [...offer.containers]})),
      supply, liveMobs: alive(w).map((m) => ({id: m.id, kind: m.s.kind, region: m.rt.brain.region,
        elite: m.rt.brain.elite, type: m.s.type, camp: m.s.camp, hp: m.s.hp, x: m.s.x, y: m.s.y})), humans, camps: plain([...w.state.camps].map((c: any) => ({alive: c.alive, state: c.state, clearedAt: c.clearedAt, respawnAt: c.respawnAt}))),
      noticeCount: notices.length});
  };
  const place = (id: string, x: number, y: number) => {
    const p = w.state.players.get(id), rt = w.players.get(id);
    p.x = x; p.y = y; p.facing = 0; rt.history = [{t: w.state.serverTime, x, y}];
    action('place', {actor: id, x, y});
  };
  const input = (actor: string, type: string, payload: any) => {
    assert.equal(inputMod.enqueueClientMessage(w.players.get(actor).inputs, type, payload), true);
    action('input', {actor, type, payload, accepted: true, appliesAtTick: w.state.tick + 1});
  };
  const initial = SEATS.map(({id}) => {
    const s = w.state.players.get(id);
    return {id, x: s.x, y: s.y, hp: s.hp, weapon0: s.weapon0, weapon1: s.weapon1};
  });
  snap('spawned-known-open');
  place('p0', q.s.x, q.s.y);
  input('p0', 'questAccept', {quest: q.id});
  step();
  assert.equal(q.s.accepted.get('p0'), true);
  assert(q.s.expiresAt > w.state.serverTime);
  snap('accepted-through-input');
  // A genuine sword kill earns the visit; setup changes only loadout, target HP and actor position.
  const victim = alive(w).find((m) => m.rt.brain.region === 'frost' && !m.rt.brain.elite);
  assert(victim, 'a live normal Frost mob exists');
  const victimSpec = {id: victim.id, region: victim.rt.brain.region, type: victim.s.type, camp: victim.s.camp,
    x: victim.s.x, y: victim.s.y, hp: victim.s.hp, elite: victim.rt.brain.elite};
  w.state.players.get('p0').weapon0 = 'sword';
  action('weapon', {actor: 'p0', weapon: 'sword'});
  victim.s.hp = 1;
  action('mobHp', {mob: victimSpec, hp: 1});
  place('p0', victim.s.x - 32, victim.s.y);
  input('p0', 'attack', {a: 0});
  for (let i = 0; i < 16 && victim.s.status === 'alive'; i++) step();
  assert.equal(victim.s.status, 'dead', 'the real sword attack killed the Frost mob');
  input('p0', 'release', {a: 0});
  step();
  assert.equal(q.s.progress.get('p0'), 1, 'source kill producer wrote tour progress');
  assert.deepEqual([...(q.tours.get('p0') ?? [])], ['frost'], 'source kill producer wrote actual Frost visit');
  assert.equal(q.s.status, 'open');
  snap('earned-frost-visit');
  // Move away from combat and giver. Places are explicit, not movement parity claims.
  place('p0', initial[0].x, initial[0].y);
  const wiped = alive(w).filter((m) => !keepRegions.includes(m.rt.brain.region));
  assert(wiped.length > 0);
  const targets = wiped.map((m) => ({id: m.id, region: m.rt.brain.region, type: m.s.type, camp: m.s.camp,
    at: {x: m.s.x, y: m.s.y}, hp: m.s.hp, elite: m.rt.brain.elite}));
  for (const m of wiped) mobLife.killMob(w, {kind: 'mob', id: m.id, s: m.s, rt: m.rt}, [], [], m.s.hp);
  action('wipeExceptRegions', {keepRegions, targets,
    boundary: 'declared out-of-step real killMob producer, no credited killer, not a player-fought camp'});
  assert.equal(w.quests.recheck, true, 'real camp deaths requested the system recheck');
  assert.equal(q.s.status, 'open', 'no helper called the quest sweep');
  snap('real-camp-producer-before-recheck');
  for (const {id} of SEATS) {
    const p = w.state.players.get(id), rt = w.players.get(id);
    assert.equal(p.status, 'alive'); assert.equal(rt.down, null); assert.equal(rt.resolved, false);
    if (id !== 'p0') assert.equal(q.s.progress.get(id) ?? 0, 0);
  }
  const remaining = alive(w);
  assert.deepEqual([...new Set(remaining.map((m) => m.rt.brain.region))].sort(), [...keepRegions].sort());
  const beforeNotices = notices.length;
  step();
  snap('ordinary-step-recheck-result');
  if (process.env.RH_QUEST_TOUR_MUTANT !== '1') {
    assert.equal(q.s.status, expectedStatus, name + ': expected ordinary source outcome');
    assert.equal(w.quests.recheck, false);
    assert.equal(frames.at(-1).quest.giverPresent, expectedStatus === 'open');
    assert(SEATS.every(({id}) => w.players.get(id).gv.quest === 0));
    if (expectedStatus === 'expired') assert(q.closedAt > 0 && q.s.expiresAt <= w.state.serverTime);
    else assert.equal(q.closedAt, 0);
  }
  return {name, input: {map: {seed: 1, attempt: 0, decor: false, mapHashU32: mapWire.mapHashU32(map)},
    config: CONFIG, options: {signatures: false, walkHints: false}, randomSeed: 12, rewardSalt: [1, 2, 3, 4],
    tickMs: 50, orderSalt: w.orderSalt, spawnSeed: 0,
    questSaltDerivation: "source questSaltFrom(rewardSalt) under QUES tag; no questSalt override",
    seats: SEATS, initial, quest: {id: q.id, def: q.def.id}, keepRegions},
    declaredSetup: ['actor places/history reset', 'p0 sword in slot0', 'one real Frost mob HP=1',
      'uncredited out-of-step killMob batch removes all other regions; every quest state field is source-written'],
    expectedStatus, actions, frames, notices, outcomeNoticeRange: [beforeNotices, notices.length]};
}
const build = () => [scenario('frost-visit-fire-holy-stays-open', ['fire', 'holy'], 'open'),
  scenario('frost-visit-frost-sentenced-expires', ['frost', 'sentenced'], 'expired')];
const cases = build();
assert.deepEqual(build(), cases, 'independent actual World recapture is deterministic');

// Conservative static internal import closure, including type imports. It is not runtime loader instrumentation.
const entrySources = [TOOL_REL + '/capture.mts', 'packages/shared/src/index.ts', 'packages/shared/src/mapgen.ts',
  'packages/shared/src/mapWire.ts', 'packages/server/src/sim/gameplay.ts', 'packages/server/src/sim/step.ts',
  'packages/server/src/sim/inputs.ts', 'packages/server/src/sim/mobLife.ts'];
const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
const tryTs = (p: string): string | null => [p, p + '.ts', p + '.tsx', p + '.mts', p.replace(/\.js$/, '.ts'), p + '/index.ts']
  .find((s) => isFile(repo(s))) ?? null;
const sourceFiles = new Set<string>(), externalImports = new Set<string>(), nodeBuiltins = new Set<string>();
const pending = [...entrySources];
while (pending.length) {
  const path = pending.pop()!;
  if (sourceFiles.has(path)) continue;
  assert(isFile(repo(path)), 'source exists: ' + path);
  sourceFiles.add(path);
  const text = read(repo(path));
  const patterns = [/(?:^|[;\n])\s*(?:import|export)\s+(?:[^'\"]*?\sfrom\s+)?[\"']([^\"']+)[\"']/g,
    /\b(?:import|load)\s*\(\s*[\"']([^\"']+)[\"']/g];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
    const spec = match[1]!;
    if (spec.startsWith('node:')) { nodeBuiltins.add(spec); continue; }
    let resolved: string | null = null;
    if (spec.startsWith('.')) resolved = tryTs(join(dirname(path), spec));
    else if (spec === '@raid/shared') resolved = 'packages/shared/src/index.ts';
    else if (spec.startsWith('@raid/shared/')) resolved = tryTs('packages/shared/src/' + spec.slice('@raid/shared/'.length));
    else if (spec.startsWith('packages/')) resolved = tryTs(spec);
    else { externalImports.add(spec); continue; }
    assert(resolved, 'resolved internal import: ' + spec + ' from ' + path);
    pending.push(resolved);
  }
}
const files = Object.fromEntries([...sourceFiles].sort().map((p) => [p, pin(repo(p))]));
const configs = ['package-lock.json', 'package.json', 'tsconfig.base.json',
  ...['shared', 'server', 'client'].flatMap((p) => ['packages/' + p + '/package.json', 'packages/' + p + '/tsconfig.json'])];
const toolFiles = readdirSync(TOOL_DIR).filter((p) => isFile(join(TOOL_DIR, p)) && !p.endsWith('.log')).sort();
const profile = {baseCommit: BASE_COMMIT, image: IMAGE, node: process.version, platform: process.platform, arch: process.arch,
  configFiles: Object.fromEntries(configs.map((p) => [p, pin(repo(p))])),
  sourceClosure: {method: 'conservative static import/export/literal-load graph; includes type imports', entrySources,
    count: sourceFiles.size, sha256: digest(JSON.stringify(files)), files},
  nodeBuiltins: [...nodeBuiltins].sort(), externalImports: [...externalImports].sort(),
  dependencyVersions: Object.fromEntries(['tsx', 'typescript', 'esbuild', '@colyseus/schema'].map((p) => [p, JSON.parse(read(repo('node_modules/' + p + '/package.json'))).version])),
  tools: Object.fromEntries(toolFiles.map((p) => [TOOL_REL + '/' + p, pin(join(TOOL_DIR, p))]))};
const body = {format: 'rh-quest-tour-supply-source/1', profile, limits: [
  'Two actual legacy World traces, with ordinary input/step acceptance and sword-kill progress.',
  'HP, loadout, positions and the uncredited killMob supply batch are declared setup/producer boundaries.',
  'No private quest field is forged; no pure helper directly decides the captured outcome.',
  'Not a player-fought campaign, Room/network/client/persistence proof, or full quest parity.'], cases};
const bytes = JSON.stringify(body, null, 1) + '\n';
if (mode === '--write') writeFileSync(output!, bytes);
else assert.equal(read(output!), bytes, 'the new source corpus is byte-identical');
console.log(JSON.stringify({mode, output, bytes: Buffer.byteLength(bytes), sha256: digest(bytes), cases: cases.map((c) => ({name: c.name,
  tick: c.frames.at(-1).tick, time: c.frames.at(-1).time, progress: c.frames.at(-1).humans[0].progress,
  visited: c.frames.at(-1).humans[0].visited, status: c.frames.at(-1).quest.status}))}));
