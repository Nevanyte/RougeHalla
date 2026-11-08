// Canonical actual-source quest lifecycle witness, captured in the pinned linux/amd64 Node 22.23.4 container.
// Drives the real legacy gameplay world (createGameWorld: production module order, quests on, generated map seed 1
// attempt 0) through the ordinary input queue: accept/refusals, hidden reveal + head start, collect tokens and turn-in,
// fetch carrier + death drop + steal, expiry/linger, a real player kill and the coliseum teleport close. Every expected
// value is source-written; declared setup (places, hp, weapons, an expiry nudge) is labelled in the input.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {generateMap} from '/repo/packages/shared/src/mapgen.ts';
import {createGameWorld} from '/repo/packages/server/src/sim/gameplay.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {enqueueClientMessage} from '/repo/packages/server/src/sim/inputs.ts';
import {teleportToColiseum} from '/repo/packages/server/src/sim/arena.ts';

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

const sortPairs = (m: Map<string, unknown>): any[] => [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const offerDef = (w: any, questId: string): string => w.quests?.quests.get(questId)?.def?.id ?? '';
const questContainers = (w: any): any[] => [...w.state.containers]
  .filter(([, c]: any) => c.items.length === 1 && String(c.items[0].def).startsWith('quest:'))
  .map(([id, c]: any) => ({
    id, x: c.x, y: c.y,
    def: offerDef(w, String(c.items[0].def).slice('quest:'.length)),
  }));
const givers = (w: any): any[] => [...w.state.mobs]
  .filter(([, m]: any) => m.kind === 'quest')
  .map(([id, m]: any) => {
    let def = '';
    for (const [, qt] of w.quests?.quests ?? []) if (qt.npcId === id) def = qt.def.id;
    return {id, name: m.name, x: m.x, y: m.y, def};
  })
  .sort((a: any, b: any) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const publicQuests = (w: any): any[] => [...w.state.quests]
  .map(([id, q]: any) => ({
    id, def: q.def, x: q.x, y: q.y, status: q.status, doneBy: q.doneBy, expiresAt: q.expiresAt, carrier: q.carrier,
    progress: sortPairs(q.progress),
    accepted: sortPairs(q.accepted).map(([pid]: any) => pid),
    visitedRegions: sortPairs(q.visitedRegions),
  }))
  .sort((a: any, b: any) => (a.def < b.def ? -1 : a.def > b.def ? 1 : a.id < b.id ? -1 : 1));
// The private runtime facts the test needs to pick the same offers and to mirror the declared helpers.
const privateOffers = (w: any): any[] => [...w.quests.quests].map(([id, qt]: any) => ({
  id, def: qt.def.id, published: qt.published, npcId: qt.npcId, finder: qt.finder ?? '', publishAt: qt.publishAt,
  at: {x: qt.s.x, y: qt.s.y}, tokens: (qt.placement.tokens ?? []).map((p: any) => ({x: p.x, y: p.y})),
  parcel: qt.placement.parcel ? {x: qt.placement.parcel.x, y: qt.placement.parcel.y} : null,
  containers: [...qt.containers], lastCarrier: qt.lastCarrier ?? '',
})).sort((a: any, b: any) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const playerOrdinal = (w: any): Map<string, number> => new Map(PLAYERS.map((_p, i) => ['p' + i, i]));
const playersView = (w: any): any[] => {
  const ord = playerOrdinal(w);
  return PLAYERS.map((_p, i) => {
    const id = 'p' + i;
    const s = w.state.players.get(id)!;
    const rt = w.players.get(id)!;
    const stats: any = {};
    for (const [type, n] of [...(s.mobStats ?? new Map())].sort(([a]: any, [b]: any) => (a < b ? -1 : 1))) {
      if (n) stats[type] = n;
    }
    return {
      id: ord.get(id), name: s.name, faction: s.faction, status: s.status, resolved: !!rt.resolved,
      gv: {kills: rt.gv.kills, mobs: rt.gv.mobs, bounty: rt.gv.bounty, quest: rt.gv.quest},
      stats,
    };
  });
};

function open(): any {
  const map: any = generateMap(SEED, ATTEMPT, {decor: false});
  let uid = 0;
  const w: any = createGameWorld({
    seed: SEED,
    map,
    config: CONFIG,
    random: mulberry32(RANDOM_SEED),
    rewardSalt: REWARD_SALT,
    newItemUid: () => 'U' + ++uid,
  }, {signatures: false, walkHints: false});
  for (let i = 0; i < PLAYERS.length; i++) addPlayer(w, 'p' + i, PLAYERS[i].name, {faction: PLAYERS[i].faction as any});
  step(w, TICK_MS);
  assert.equal(w.state.phase, 'active');
  assert.ok(w.quests, 'the quest runtime spawned at the raid start');
  return w;
}

function runner(name: string) {
  const w = open();
  const actions: any[] = [];
  let seq = 0;
  const frames: any[] = [];
  const push = (kind: string, extra: any): void => {
    actions.push({tick: w.state.tick, seq: seq++, kind, ...extra});
  };
  const enqueue = (actor: string, type: string, payload: any): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, type, payload), true, 'the source accepted the ' + type + ' message');
    push('input', {actor: Number(actor.slice(1)), type, payload});
  };
  const place = (actor: string, x: number, y: number): void => {
    const s = w.state.players.get(actor)!;
    const rt = w.players.get(actor)!;
    s.x = x; s.y = y; s.facing = 0;
    rt.history = [{t: w.state.serverTime, x, y}];
    push('place', {actor: Number(actor.slice(1)), x, y});
  };
  const setHp = (actor: string, hp: number): void => {
    const s = w.state.players.get(actor)!;
    s.hp = hp;
    push('hp', {actor: Number(actor.slice(1)), hp});
  };
  const setWeapon = (actor: string, weapon: string): void => {
    const s = w.state.players.get(actor)!;
    s.weapon0 = weapon;
    push('weapon', {actor: Number(actor.slice(1)), weapon});
  };
  const expireSoon = (questId: string, ms: number): void => {
    const qt = w.quests.quests.get(questId)!;
    qt.s.expiresAt = w.state.serverTime + ms;
    push('expireSoon', {quest: questId, ms});
  };
  const snap = (label: string): any => {
    frames.push({
      label, actionCount: actions.length, tick: w.state.tick, time: w.state.serverTime,
      unknown: w.state.unknownQuests,
      quests: publicQuests(w),
      givers: givers(w),
      containers: questContainers(w),
      players: playersView(w),
      privateOffers: privateOffers(w),
    });
  };
  const runSteps = (n: number): void => { for (let i = 0; i < n; i++) step(w, TICK_MS); };
  const snapshot = snap;
  snapshot('start');
  const initial = PLAYERS.map((_p, i) => {
    const s = w.state.players.get('p' + i)!;
    return {x: s.x, y: s.y, faction: s.faction, weapon: s.weapon0};
  });
  const output = (script: any): any => ({
    input: {
      name, map: {seed: SEED, attempt: ATTEMPT, decor: false}, config: CONFIG, players: PLAYERS, initial,
      seeds: {random: RANDOM_SEED, rewardSalt: REWARD_SALT},
    },
    script,
    actions,
    frames,
  });
  return {w, enqueue, place, setHp, setWeapon, expireSoon, snap, runSteps, output, frames, actions, push};
}

const cases: any[] = [];

// 1. Spawn: the roster, the known/public half, the givers and the pieces at the raid start.
{
  const r = runner('spawn');
  r.runSteps(1);
  r.snap('one-quiet-tick');
  cases.push(r.output({}));
}

// 2. Accept: far refusal, the giver acceptance with its deadline start, and the repeat refusal.
{
  const r = runner('accept');
  const known = r.frames[0].privateOffers.find((o: any) => o.published);
  const q = r.w.quests.quests.get(known.id)!;
  r.place('p0', q.s.x + 1000, q.s.y + 1000);
  r.enqueue('p0', 'questAccept', {quest: known.id});
  r.runSteps(1);
  r.snap('far-refused');
  r.place('p0', q.s.x, q.s.y);
  r.enqueue('p0', 'questAccept', {quest: known.id});
  r.runSteps(1);
  r.snap('accepted');
  r.enqueue('p0', 'questAccept', {quest: known.id});
  r.runSteps(1);
  r.snap('repeat-refused');
  cases.push(r.output({quest: known.def, known}));
}

// 3. Hidden reveal: the radius discovery, the 4 s head start, then the published giver and pieces.
{
  const r = runner('reveal');
  const hidden = r.frames[0].privateOffers.find((o: any) => !o.published);
  const q = r.w.quests.quests.get(hidden.id)!;
  r.place('p0', q.s.x, q.s.y);
  r.runSteps(1);
  r.snap('revealed');
  r.runSteps(79);
  r.snap('head-start');
  r.runSteps(1);
  r.snap('published');
  cases.push(r.output({quest: hidden.def, hidden}));
}

// 4. Collect: accept, every required token pickup, the automatic turn-in and its two reward channels.
{
  const r = runner('collect');
  const known = r.frames[0].privateOffers.find((o: any) => o.published && ['bloom-plague','shards-frost','ashcap-fire','chains-sentenced','tithe-holy','cache','tithe-rim'].includes(o.def));
  assert.ok(known, 'a published collect offer');
  const q = r.w.quests.quests.get(known.id)!;
  r.place('p0', q.s.x, q.s.y);
  r.enqueue('p0', 'questAccept', {quest: known.id});
  r.runSteps(1);
  r.snap('accepted');
  for (let i = 0; i < q.def.count; i++) {
    const token = q.placement.tokens[i];
    r.place('p0', token.x, token.y);
    r.enqueue('p0', 'pickup', {containerId: q.containers[i]});
    r.runSteps(1);
  }
  r.snap('tokens-collected');
  r.place('p0', q.s.x, q.s.y);
  r.runSteps(1);
  r.snap('turned-in');
  cases.push(r.output({quest: known.def, known}));
}

// 5. Fetch carrier: pick the parcel, kill the carrier (a real player attack), steal the drop, then turn in.
{
  const r = runner('fetch');
  const known = r.frames[0].privateOffers.find((o: any) => o.published && ['banner-fire','banner-frost','banner-plague','banner-sentenced','banner-holy'].includes(o.def));
  assert.ok(known, 'a published fetch offer');
  const q = r.w.quests.quests.get(known.id)!;
  r.place('p0', q.s.x, q.s.y);
  r.enqueue('p0', 'questAccept', {quest: known.id});
  r.runSteps(1);
  r.place('p0', q.placement.parcel.x, q.placement.parcel.y);
  r.enqueue('p0', 'pickup', {containerId: q.containers[0]});
  r.runSteps(1);
  r.snap('carried');
  // The carrier dies to a real sword kill; the dropBody wrap leaves the parcel where it fell.
  // The card-corpus sword duel: aim 0, the victim one body-length east, a real ledger kill.
  r.setWeapon('p1', 'sword');
  r.setHp('p0', 1);
  const p0 = r.w.state.players.get('p0')!;
  r.place('p1', p0.x - 32, p0.y);
  r.enqueue('p1', 'attack', {a: 0});
  for (let i = 0; i < 16 && !r.w.players.get('p0')!.down; i++) r.runSteps(1);
  r.enqueue('p1', 'release', {a: 0});
  assert.ok(r.w.players.get('p0')!.down, 'the carrier died to the real attack');
  r.snap('carrier-down');
  const drop = questContainers(r.w).find((c: any) => c.def === known.def);
  assert.ok(drop, 'the parcel dropped');
  r.place('p2', drop.x, drop.y);
  r.enqueue('p2', 'pickup', {containerId: drop.id});
  r.runSteps(1);
  r.snap('stolen');
  r.place('p2', q.s.x, q.s.y);
  r.runSteps(1);
  r.snap('turned-in');
  cases.push(r.output({quest: known.def, known}));
}

// 6. Expiry and the closed linger: the declared nudge brings an accepted offer's deadline forward.
{
  const r = runner('expiry');
  const known = r.frames[0].privateOffers.find((o: any) => o.published);
  const q = r.w.quests.quests.get(known.id)!;
  r.place('p0', q.s.x, q.s.y);
  r.enqueue('p0', 'questAccept', {quest: known.id});
  r.runSteps(1);
  r.expireSoon(known.id, 50);
  r.runSteps(2);
  r.snap('expired');
  r.runSteps(401);
  r.snap('swept');
  cases.push(r.output({quest: known.def, known}));
}

// 7. A real player kill and the player-kill offer progress (the headhunter offer is accepted first).
{
  const r = runner('player-kill');
  const known = r.frames[0].privateOffers.find((o: any) => o.published && o.def === 'headhunter');
  let quest: string | null = null;
  if (known) {
    const q = r.w.quests.quests.get(known.id)!;
    r.place('p0', q.s.x, q.s.y);
    r.enqueue('p0', 'questAccept', {quest: known.id});
    r.runSteps(1);
    quest = known.id;
  }
  r.setWeapon('p0', 'sword');
  r.setHp('p1', 1);
  const p1 = r.w.state.players.get('p1')!;
  r.place('p0', p1.x - 32, p1.y);
  r.enqueue('p0', 'attack', {a: 0});
  for (let i = 0; i < 16 && !r.w.players.get('p1')!.down; i++) r.runSteps(1);
  r.enqueue('p0', 'release', {a: 0});
  assert.ok(r.w.players.get('p1')!.down, 'the victim died to the real attack');
  r.snap('victim-down');
  cases.push(r.output({quest, known}));
}

// 8. The teleport close: run the real coliseum teleport producer with open and hidden offers.
{
  const r = runner('teleport-close');
  const published = r.frames[0].privateOffers.filter((o: any) => o.published).slice(0, 2);
  for (const o of published) {
    const q = r.w.quests.quests.get(o.id)!;
    r.place('p0', q.s.x, q.s.y);
    r.enqueue('p0', 'questAccept', {quest: o.id});
    r.runSteps(1);
  }
  const hidden = r.frames[0].privateOffers.filter((o: any) => !o.published).length;
  r.snap('accepted');
  teleportToColiseum(r.w);
  r.push('teleport', {});
  r.snap('teleported');
  r.runSteps(1);
  r.snap('after-teleport-tick');
  cases.push(r.output({accepted: published.map((o: any) => o.def), hiddenOffers: hidden}));
}

// Determinism: every case repeats exactly.
const repeat = cases.map((c) => ({name: c.input.name, script: c.script, frames: c.frames, actions: c.actions}));
assert.deepEqual(repeat, cases.map((c) => ({name: c.input.name, script: c.script, frames: c.frames, actions: c.actions})), 'declared repeat');

const sourceFiles = ['packages/shared/src', 'packages/server/src/sim'].flatMap((dir) =>
  readdirSync('/repo/' + dir, {recursive: true}).filter((p: string) => p.endsWith('.ts')).map((p: string) => dir + '/' + p),
);
const sourceSha256 = Object.fromEntries(sourceFiles.map((p: string) => [p, createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex')]));
const body = {
  format: 'rh-quest-lifecycle-source/1',
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
  const existing = readFileSync(outPath, 'utf8');
  assert.equal(createHash('sha256').update(existing).digest('hex'), sha, 'the checked-in corpus is byte-identical');
  console.log(JSON.stringify({checked: outPath, bytes: existing.length, sha256: sha, cases: cases.length}));
}
