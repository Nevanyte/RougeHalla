// Canonical actual-source P-SENTENCED-MARK-RATE-1 witness, captured in the pinned linux/amd64 Node 22.23.4 container.
// A declared player-only / no-mobs full-player faction profile (signatures on): real grantCard producers, ordinary
// validated target/attack/swap inputs and 50 ms steps. No expected Mark progress/chill/tier is installed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {generateMap} from '/repo/packages/shared/src/mapgen.ts';
import {createGameWorld} from '/repo/packages/server/src/sim/gameplay.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {enqueueClientMessage} from '/repo/packages/server/src/sim/inputs.ts';
import {combatant} from '/repo/packages/server/src/sim/combatant.ts';
import {grantCard} from '/repo/packages/server/src/sim/chests.ts';
import {installTraining} from '/repo/packages/server/src/sim/training.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string', 'closed capture arguments');
const [, outDir] = args;
assert.equal(process.version, 'v22.23.4'); assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');

const TICK_MS = 50; const SEED = 1; const ATTEMPT = 0; const RANDOM_SEED = 12; const REWARD_SALT = [1,2,3,4];
const CONFIG = {
  minPlayers: 2, lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
  suddenDeathSeconds: 3600, mobs: false, signatures: true, quests: false, training: false, dummies: false,
  planSeconds: 0, pvpRules: false,
};
const MODULES = {signatures: true, walkHints: false};
const PROFILE = 'player-only-no-mobs/full-player-faction/sentenced-frost';
const r6 = (v: any): any => typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : (v === -Infinity ? null : v);
const ord = (id: any): number | null => typeof id === 'string' && /^p[0-9]+$/.test(id) ? Number(id.slice(1)) : null;

function open(training = false): any {
  const map: any = generateMap(SEED, ATTEMPT, {decor: false});
  let uid = 0;
  const config = training ? {...CONFIG, minPlayers: 2, lobbySeconds: 0, training: true, dummies: true} : CONFIG;
  const w: any = createGameWorld({seed: SEED, map, config, random: mulberry32(RANDOM_SEED), rewardSalt: REWARD_SALT,
    newItemUid: () => 'U' + ++uid}, {signatures: MODULES.signatures, walkHints: MODULES.walkHints});
  if (training) installTraining(w);
  addPlayer(w, 'p0', 'sentenced', {faction: 'sentenced'});
  addPlayer(w, 'p1', 'frost', {faction: 'frost'});
  step(w, TICK_MS);
  assert.equal(w.state.phase, 'active');
  if (!training) assert.equal(w.state.mobs.size, 0, 'player-only/no-mobs profile');
  return w;
}

function runner(name: string, opts: {training?: boolean} = {}) {
  const w = open(opts.training === true);
  const actions: any[] = []; let seq = 0; const frames: any[] = [];
  const push = (kind: string, extra: any): void => { actions.push({tick: w.state.tick, seq: seq++, kind, ...extra}); };
  const place = (actor: string, x: number, y: number): void => {
    const s = w.state.players.get(actor)!; s.x = x; s.y = y; s.facing = 0;
    w.players.get(actor)!.history = [{t: w.state.serverTime, x, y}]; push('place', {actor: Number(actor.slice(1)), x, y});
  };
  const weapon = (actor: string, weapon0: string, weapon1 = ''): void => {
    const s = w.state.players.get(actor)!; s.weapon0 = weapon0; s.weapon1 = weapon1; s.slot = 0;
    push('weapon', {actor: Number(actor.slice(1)), weapon0, weapon1});
  };
  const grant = (actor: string, card: string): void => {
    assert.notEqual(grantCard(w, combatant(w, actor) as any, card), null, 'real grantCard producer: ' + card);
    push('grantCard', {actor: Number(actor.slice(1)), card});
  };
  const target = (actor: string, victim: string): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, 'target', {id: victim}), true, 'target input');
    push('input', {actor: Number(actor.slice(1)), type: 'target', payload: {id: victim}});
  };
  const attack = (actor: string, a: number): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, 'attack', {a}), true, 'attack input');
    push('input', {actor: Number(actor.slice(1)), type: 'attack', payload: {a}});
  };
  const swap = (actor: string): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, 'swap', {}), true, 'swap input');
    push('input', {actor: Number(actor.slice(1)), type: 'swap', payload: {}});
  };
  const train = (actor: string, command: Record<string, any>): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, 'train', {cmd: command.cmd, id: command.id, count: command.count}, {training: true}), true, 'training clear input');
    push('train', {actor: Number(actor.slice(1)), command});
  };
  const markView = (id: string): any => {
    const f = w.factions?.fighters?.get(id);
    if (!f) return null;
    return {target: ord(f.target), tier: f.tier, hits: f.markHits, progress: r6(f.markProgress), swaps: f.markSwaps,
      denied: f.markDenied, farSince: r6(f.farSince), ampUntil: r6(f.ampUntil), chill: r6(f.chill)};
  };
  const players = (): any[] => ['p0','p1'].map((id, i) => {
    const s = w.state.players.get(id); if (!s) return null;
    return {id: i, faction: s.faction, x: r6(s.x), y: r6(s.y), hp: r6(s.hp), maxHp: r6(s.maxHp), status: s.status,
      weapon0: s.weapon0, weapon1: s.weapon1, slot: s.slot, public: {sig: s.sig, markTier: s.markTier, brand: s.brand,
        markBy: ord(s.markBy), markTax: s.markTax}, mark: markView(id)};
  });
  const snap = (label: string): void => { frames.push({label, actionCount: actions.length, tick: w.state.tick,
    time: w.state.serverTime, phase: w.state.phase, players: players()}); };
  const runSteps = (n: number): void => { for (let i = 0; i < n; i++) step(w, TICK_MS); };
  const init = ['p0','p1'].map((id) => { const s = w.state.players.get(id)!; return {x: s.x, y: s.y, faction: s.faction, hp: r6(s.hp), maxHp: r6(s.maxHp)}; });
  const output = (script: any): any => ({input: {name, profile: PROFILE, training: opts.training === true,
    map: {seed: SEED, attempt: ATTEMPT, decor: false}, config: opts.training ? {...CONFIG, training: true, dummies: true, minPlayers: 2, lobbySeconds: 0} : CONFIG,
    modules: MODULES, players: [{faction:'sentenced'},{faction:'frost'}], initial: init,
    seeds: {random: RANDOM_SEED, rewardSalt: REWARD_SALT}}, script, actions, frames});
  snap('start');
  return {w, grant, weapon, place, target, attack, swap, train, snap, runSteps, output, frames, actions};
}
const cases: any[] = [];

// Both seats target and attack; steps until the Sentenced seat's mark hit count reaches the wanted goals.
function duelFrames(r: any, goals: number[], labelBase: string) {
  let last = 0;
  for (let i = 0; i < 400 && last < goals[goals.length - 1]; i++) {
    r.runSteps(1);
    const h = r.w.factions?.fighters?.get('p0')?.markHits ?? 0;
    if (h > last && goals.includes(h)) { r.snap(labelBase + h); last = h; }
  }
  assert.ok(last >= goals[goals.length - 1], 'real attacks produced the requested mark hits');
}

{ const r = runner('neutral-rate'); r.weapon('p0','sword'); r.weapon('p1','sword','wand'); r.place('p0',400,320); r.place('p1',432,320); r.target('p0','p1'); r.target('p1','p0'); r.attack('p0',0); r.attack('p1',Math.PI); duelFrames(r,[1,2,3],'hit'); r.runSteps(120); r.snap('later'); cases.push(r.output({})); }
{ const r = runner('gathering-storm'); r.grant('p0','gatheringStorm'); r.weapon('p0','sword'); r.weapon('p1','sword','wand'); r.place('p0',400,320); r.place('p1',432,320); r.target('p0','p1'); r.target('p1','p0'); r.attack('p0',0); r.attack('p1',Math.PI); duelFrames(r,[1,2,3],'hit'); r.runSteps(120); r.snap('later'); cases.push(r.output({})); }
{ const r = runner('mid-mark-grant'); r.weapon('p0','sword'); r.weapon('p1','sword','wand'); r.place('p0',400,320); r.place('p1',432,320); r.target('p0','p1'); r.target('p1','p0'); r.attack('p0',0); r.attack('p1',Math.PI); duelFrames(r,[1],'hit'); r.grant('p0','gatheringStorm'); r.snap('granted-mid-mark'); duelFrames(r,[2,3],'hit'); cases.push(r.output({})); }
{ const r = runner('frost-resisted'); r.grant('p0','ironWill'); r.weapon('p0','sword'); r.weapon('p1','sword','wand'); r.place('p0',400,320); r.place('p1',432,320); r.target('p0','p1'); r.target('p1','p0'); r.attack('p0',0); r.attack('p1',Math.PI); duelFrames(r,[1,2],'hit'); cases.push(r.output({})); }
{ const r = runner('frost-deepened'); for (let i=0;i<4;i++) r.grant('p1','haste2'); r.weapon('p0','sword'); r.weapon('p1','sword','wand'); r.place('p0',400,320); r.place('p1',432,320); r.target('p0','p1'); r.target('p1','p0'); r.attack('p0',0); r.attack('p1',Math.PI); duelFrames(r,[1,2],'hit'); cases.push(r.output({})); }
{ const r = runner('tier-flags'); r.grant('p0','gatheringStorm'); r.grant('p0','haste1'); r.grant('p0','swiftJudgment'); r.grant('p0','noCommutation'); r.weapon('p0','sword','wand'); r.weapon('p1','sword','wand'); r.place('p0',400,320); r.place('p1',432,320); r.target('p0','p1'); r.target('p1','p0'); r.attack('p0',0); r.attack('p1',Math.PI); duelFrames(r,[1,2],'hit'); r.swap('p0'); r.runSteps(1); r.snap('after-swap'); duelFrames(r,[3,4,5,6],'hit'); r.runSteps(120); r.snap('later'); cases.push(r.output({})); }
{ const r = runner('opponent-card-control'); r.grant('p1','gatheringStorm'); r.weapon('p0','sword'); r.weapon('p1','sword','wand'); r.place('p0',400,320); r.place('p1',432,320); r.target('p0','p1'); r.target('p1','p0'); r.attack('p0',0); r.attack('p1',Math.PI); duelFrames(r,[1,2],'hit'); cases.push(r.output({})); }
{ const r = runner('training-clear-history', {training: true}); r.grant('p0','gatheringStorm'); r.weapon('p0','sword'); r.weapon('p1','sword','wand'); r.place('p0',400,320); r.place('p1',432,320); r.target('p0','p1'); r.target('p1','p0'); r.attack('p0',0); r.attack('p1',Math.PI); duelFrames(r,[1],'hit'); r.train('p0',{cmd:'clear'}); r.runSteps(1); r.snap('cleared'); duelFrames(r,[2,3],'hit'); cases.push(r.output({})); }

const repeat = cases.map((c) => ({name: c.input.name, script: c.script, actions: c.actions, frames: c.frames}));
assert.deepEqual(repeat, cases.map((c) => ({name: c.input.name, script: c.script, actions: c.actions, frames: c.frames})), 'declared repeat');
const sourceFiles = ['packages/shared/src','packages/server/src/sim'].flatMap((dir) => readdirSync('/repo/'+dir,{recursive:true}).filter((p:string)=>p.endsWith('.ts')).map((p:string)=>dir+'/'+p));
const fileSha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
const body = {format: 'rh-mark-rate-source/1', provenance: {
  image: 'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
  platform: 'linux/amd64', node: process.version, profile: PROFILE, config: CONFIG, modules: MODULES,
  map: {seed: SEED, attempt: ATTEMPT, decor: false},
  tools: {captureMts: fileSha('/repo/tools/mark-rate-fixtures/capture.mts'), captureSh: fileSha('/repo/tools/mark-rate-fixtures/capture.sh'),
    runMutantsSh: fileSha('/repo/tools/mark-rate-fixtures/run-mutants.sh'), packageLock: fileSha('/repo/package-lock.json')},
  sourceSha256: Object.fromEntries(sourceFiles.map((p:string)=>[p,fileSha('/repo/'+p)]))}, cases};
const text = JSON.stringify(body, null, 1) + '\n';
const sha = createHash('sha256').update(text).digest('hex');
if (args[0] === '--write') { mkdirSync(outDir,{recursive:true}); writeFileSync(join(outDir,'runtime.json'), text); console.log(JSON.stringify({written: outDir, bytes: text.length, sha256: sha, cases: cases.length})); }
else { assert.equal(text, readFileSync(join(outDir,'runtime.json'),'utf8'), 'capture --check requires identical bytes'); console.log(JSON.stringify({checked: outDir, bytes: text.length, sha256: sha, cases: cases.length})); }
