// Canonical actual-source P-TROPHY-WITNESS-1 evidence, captured in the pinned linux/amd64 Node 22.23.4 container.
// EVIDENCE ONLY: real credited player kills through ordinary enqueue/input/steps in a four-seat player-only/no-mobs
// world, plus a separate declared-input pure helper corpus that calls the ACTUAL shared Trophy functions.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {generateMap} from '/repo/packages/shared/src/mapgen.ts';
import {createGameWorld} from '/repo/packages/server/src/sim/gameplay.ts';
import {addPlayer, step, removePlayer} from '/repo/packages/server/src/sim/step.ts';
import {enqueueClientMessage} from '/repo/packages/server/src/sim/inputs.ts';
import {combatant} from '/repo/packages/server/src/sim/combatant.ts';
import {grantCard} from '/repo/packages/server/src/sim/chests.ts';
import {grantMobStat} from '/repo/packages/server/src/sim/mobStats.ts';
import {applyDamage} from '/repo/packages/server/src/sim/arena.ts';
import {installTraining} from '/repo/packages/server/src/sim/training.ts';
import {
  KILL_AUG_LABEL, KILL_AUG_OPTIONS, KILL_AUG_SECONDS, KILL_AUG_SHARE, KILL_STAT_KEYS,
  combatReadability, encodeKillAugment, killAugmentGrant, killAugmentText, killStatEffects, parseKillAugment,
  rollKillAugments,
} from '/repo/packages/shared/src/index.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string', 'closed capture arguments');
const [, outDir] = args;
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
  {faction: 'frost', name: 'name3'},
];
const CONFIG = {
  minPlayers: 4, lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
  suddenDeathSeconds: 3600, mobs: false, signatures: false, quests: false, training: false, dummies: false,
  planSeconds: 0, pvpRules: false,
};
const MODULES = {signatures: false, walkHints: false};
const PROFILE = 'four-seat-player-only/no-mobs/weapons-only';

const r6 = (v: any): any => typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v;
const mapObj = (m: any): any => Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]: any) => [k, r6(v)]));
const idx = (id: any): number | null => typeof id === 'string' && /^p[0-9]+$/.test(id) ? Number(id.slice(1)) : null;

function open(training = false): any {
  const map: any = generateMap(SEED, ATTEMPT, {decor: false});
  let uid = 0;
  const config = training
    ? {...CONFIG, minPlayers: 2, lobbySeconds: 0, training: true, dummies: true}
    : CONFIG;
  const w: any = createGameWorld({
    seed: SEED, map, config, random: mulberry32(RANDOM_SEED), rewardSalt: REWARD_SALT,
    newItemUid: () => 'U' + ++uid,
  }, {signatures: MODULES.signatures, walkHints: MODULES.walkHints});
  if (training) installTraining(w);
  for (let i = 0; i < (training ? 2 : PLAYERS.length); i++) {
    addPlayer(w, 'p' + i, PLAYERS[i].name, {faction: PLAYERS[i].faction as any});
  }
  step(w, TICK_MS);
  assert.equal(w.state.phase, 'active');
  // The training-exclusion case is the only world allowed practice dummies; every arena profile is mob-free.
  if (!training) assert.equal(w.state.mobs.size, 0, 'player-only/no-mobs profile has no mobs');
  return w;
}

function runner(name: string, opts: {training?: boolean} = {}) {
  const w = open(opts.training === true);
  const actions: any[] = [];
  let seq = 0;
  const frames: any[] = [];
  const hooks: any[] = [];
  let pendingHits: any[] = [];
  let pendingToasts: any[] = [];
  // Labelled observational hook-only probe (not a gameplay producer).
  const prevOffered = w.hooks.rewardOffered;
  w.hooks.rewardOffered = (world: any, box: any, kind: any, camp: any, eligible: any) => {
    hooks.push({probe: 'hook-only', hook: 'rewardOffered', tick: world.state.tick, kind, camp,
      eligible: [...eligible].map(idx), box: {id: box.id, label: box.label, owner: idx(box.owner), x: r6(box.x), y: r6(box.y),
        expiresAt: r6(box.expiresAt), options: [...box.options]}});
    prevOffered?.(world, box, kind, camp, eligible);
  };
  const prevChosen = w.hooks.rewardChosen;
  w.hooks.rewardChosen = (world: any, c: any, box: any, option: any) => {
    hooks.push({probe: 'hook-only', hook: 'rewardChosen', tick: world.state.tick, by: idx(c.id), box: box.id, option});
    prevChosen?.(world, c, box, option);
  };
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
    assert.notEqual(grantCard(w, combatant(w, actor) as any, card), null, 'the real grantCard producer granted ' + card);
    push('grantCard', {actor: Number(actor.slice(1)), card});
  };
  const farm = (actor: string, mobType: string, amount: number): void => {
    grantMobStat(w, combatant(w, actor) as any, mobType, amount);
    push('grantMobStat', {actor: Number(actor.slice(1)), mobType, amount});
  };
  const wound = (actor: string, amount: number): void => {
    const c = combatant(w, actor) as any;
    applyDamage(w, c.s, c.rt, amount, 'declared-wound');
    push('damage', {actor: Number(actor.slice(1)), amount});
  };
  const attack = (actor: string): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, 'attack', {a: 0}), true, 'normal attack input accepted');
    push('input', {actor: Number(actor.slice(1)), type: 'attack', payload: {a: 0}});
  };
  const choose = (actor: string, chest: string, pick: number): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, 'choose', {chest, pick}), true, 'normal choose input accepted');
    push('input', {actor: Number(actor.slice(1)), type: 'choose', payload: {chest, pick}});
  };
  const leave = (actor: string): void => {
    removePlayer(w, actor);
    push('leave', {actor: Number(actor.slice(1))});
  };
  const trophies = (): any[] => [...w.state.containers.values()]
    .filter((c: any) => c.kind === 'reward')
    .map((c: any) => ({id: c.id, kind: c.kind, x: r6(c.x), y: r6(c.y), label: c.label, owner: idx(c.owner),
      expiresAt: r6(c.expiresAt), options: [...c.options], takenBy: [...c.takenBy], pickers: [...c.pickers], items: c.items.length}));
  const playersView = (): any[] => PLAYERS.slice(0, opts.training ? 2 : PLAYERS.length).map((_p, i) => {
    const s = w.state.players.get('p' + i);
    if (!s) return null;
    return {id: i, faction: s.faction, x: r6(s.x), y: r6(s.y), hp: r6(s.hp), maxHp: r6(s.maxHp), status: s.status,
      weapon0: s.weapon0, weapon1: s.weapon1, slot: s.slot, build: mapObj(s.build), killStats: mapObj(s.extra.killStats),
      mobStats: mapObj(s.mobStats), campClears: s.campClears ?? 0};
  });
  const snap = (label: string): void => {
    frames.push({label, actionCount: actions.length, tick: w.state.tick, time: w.state.serverTime,
      phase: w.state.phase, players: playersView(), trophies: trophies(), hits: pendingHits.splice(0),
      toasts: pendingToasts.splice(0), hooks: hooks.splice(0)});
  };
  const runSteps = (n: number): void => {
    for (let i = 0; i < n; i++) {
      const evs = step(w, TICK_MS);
      for (const ev of evs) {
        if (ev.type === 'fx' && ev.fx.kind === 'hit') pendingHits.push({victim: idx(ev.fx.id), by: idx(ev.fx.by), amount: r6(ev.fx.amount)});
        if (ev.type === 'toast') pendingToasts.push({to: idx(ev.to), text: ev.text});
      }
    }
  };
  const initial = PLAYERS.slice(0, opts.training ? 2 : PLAYERS.length).map((_p, i) => {
    const s = w.state.players.get('p' + i)!;
    return {x: s.x, y: s.y, faction: s.faction, hp: r6(s.hp), maxHp: r6(s.maxHp)};
  });
  const output = (script: any): any => ({
    input: {name, profile: PROFILE, map: {seed: SEED, attempt: ATTEMPT, decor: false}, config: opts.training ? {...CONFIG, training: true, dummies: true, minPlayers: 2, lobbySeconds: 0} : CONFIG,
      modules: MODULES, players: PLAYERS.slice(0, opts.training ? 2 : PLAYERS.length), initial,
      seeds: {random: RANDOM_SEED, rewardSalt: REWARD_SALT},
      probes: {rewardOffered: 'observational hook-only probe; not a gameplay producer', rewardChosen: 'observational hook-only probe; not a gameplay producer'}},
    script, actions, frames,
  });
  snap('start');
  return {w, grant, farm, wound, attack, choose, leave, setWeapon, place, snap, runSteps, output, frames, actions};
}

const lifecycle: any[] = [];

// A. Birth hold, owner choose, repeated pick and skip: a real invested victim, a real killing attack, and the ordinary
// choose inputs; the hook probe only observes.
{
  const r = runner('birth-hold-owner-choose');
  r.grant('p1', 'ad3');
  r.farm('p1', 'brute', 2);
  r.setWeapon('p0', 'sword');
  r.place('p0', 400, 320);
  r.place('p1', 432, 320);
  const p1 = r.w.state.players.get('p1')!;
  r.wound('p1', r6(p1.hp - 1));
  r.snap('invested-wounded');
  r.attack('p0');
  r.runSteps(1);
  r.snap('kill-tick');
  const box = [...r.w.state.containers.values()].find((c: any) => c.kind === 'reward' && c.label === 'Trophy')!;
  assert.ok(box, 'credited player kill dropped a trophy');
  r.choose('p0', box.id, 0);
  r.runSteps(1);
  r.snap('birth-hold-refused');
  r.choose('p0', box.id, 0);
  r.runSteps(1);
  r.snap('owner-chosen');
  r.choose('p0', box.id, 1);
  r.runSteps(1);
  r.snap('repeat-pick-refused');
  r.choose('p0', box.id, -1);
  r.runSteps(1);
  r.snap('skip-after-pick-refused');
  lifecycle.push(r.output({}));
}

// B. Owner vs stranger and out-of-range: the same trophy is refused to a non-owner and to a distant owner.
{
  const r = runner('owner-stranger-range');
  r.grant('p1', 'ap3');
  r.setWeapon('p0', 'sword');
  r.place('p0', 400, 320);
  r.place('p1', 432, 320);
  r.wound('p1', r6(r.w.state.players.get('p1')!.hp - 1));
  r.attack('p0');
  r.runSteps(1);
  r.snap('kill-tick');
  r.runSteps(1);
  r.snap('birth-hold-cleared');
  const box = [...r.w.state.containers.values()].find((c: any) => c.kind === 'reward' && c.label === 'Trophy')!;
  r.choose('p2', box.id, 0);
  r.runSteps(1);
  r.snap('stranger-refused');
  r.place('p0', 800, 320);
  r.choose('p0', box.id, 0);
  r.runSteps(1);
  r.snap('out-of-range');
  r.place('p0', box.x, box.y);
  r.choose('p0', box.id, 0);
  r.runSteps(1);
  r.snap('owner-chosen-after-range');
  lifecycle.push(r.output({}));
}

// C. Expiry boundary: an owner pick just before expiry succeeds; an attempt at/after expiry is refused as gone.
{
  const r = runner('expiry-boundary');
  r.grant('p1', 'ad3');
  r.setWeapon('p0', 'sword');
  r.place('p0', 400, 320);
  r.place('p1', 432, 320);
  r.wound('p1', r6(r.w.state.players.get('p1')!.hp - 1));
  r.attack('p0');
  r.runSteps(1);
  r.snap('kill-tick');
  const box = [...r.w.state.containers.values()].find((c: any) => c.kind === 'reward' && c.label === 'Trophy')!;
  while (r.w.state.serverTime + 100 < box.expiresAt) r.runSteps(1);
  r.snap('before-expiry');
  r.choose('p0', box.id, 0);
  r.runSteps(1);
  r.snap('boundary-pick');
  while (r.w.state.serverTime < box.expiresAt) r.runSteps(1);
  r.snap('at-expiry');
  r.choose('p0', box.id, 0);
  r.runSteps(1);
  r.snap('expired-gone');
  lifecycle.push(r.output({containsExpiry: 'actual boundary; no expected outcome installed'}));
}

// D. Empty investment: a credited kill of a victim with no readable investment drops no trophy.
{
  const r = runner('empty-investment');
  r.setWeapon('p0', 'sword');
  r.place('p0', 400, 320);
  r.place('p2', 432, 320);
  r.wound('p2', r6(r.w.state.players.get('p2')!.hp - 1));
  r.attack('p0');
  r.runSteps(1);
  r.snap('kill-tick-no-investment');
  lifecycle.push(r.output({}));
}

// E. Training world: the playerKilled trophy hook skips training; a credited kill drops no trophy there.
{
  const r = runner('training-exclusion', {training: true});
  r.setWeapon('p0', 'sword');
  r.place('p0', 400, 320);
  r.place('p1', 432, 320);
  r.wound('p1', r6(r.w.state.players.get('p1')!.hp - 1));
  r.attack('p0');
  r.runSteps(1);
  r.snap('training-kill');
  lifecycle.push(r.output({}));
}

// F. MIA (a real leave producer): outcome mia is excluded from the trophy hook.
{
  const r = runner('mia-exclusion');
  r.grant('p1', 'ad3');
  r.leave('p1');
  r.runSteps(1);
  r.snap('mia');
  lifecycle.push(r.output({}));
}

// --------------------------------------------------------------------------------------------- declared helper corpus:
// separate declared-input cases that call the ACTUAL shared functions (never runtime outputs, never copied formulas).
const ZERO_MIRRORS = {asMult: 1000, windupMult: 1000, speedMult: 1000, armorBonus: 0, shieldBonus: 0, adBonus: 0, apBonus: 0};
// The declared ReadableFighter: plain JSON spec in, the Map-shaped runtime object the shared functions expect.
const fighter = (over: any = {}): any => ({
  faction: over.faction ?? 'holy', weapon0: over.weapon0 ?? 'sword', weapon1: over.weapon1 ?? '', slot: over.slot ?? 0,
  hp: over.hp ?? 800, maxHp: over.maxHp ?? 1145, build: over.build ?? {},
  mobStats: new Map(Object.entries(over.mobStats ?? {})), campClears: over.campClears ?? 0,
  extra: {
    killStats: new Map(Object.entries(over.extra?.killStats ?? {})),
    chestBoosts: new Map(Object.entries(over.extra?.chestBoosts ?? {})),
  },
  asMult: over.asMult ?? ZERO_MIRRORS.asMult, windupMult: over.windupMult ?? ZERO_MIRRORS.windupMult,
  speedMult: over.speedMult ?? ZERO_MIRRORS.speedMult, armorBonus: over.armorBonus ?? 0,
  shieldBonus: over.shieldBonus ?? 0, adBonus: over.adBonus ?? 0, apBonus: over.apBonus ?? 0,
});
const investments: Array<[string, any]> = [
  ['ad', {adBonus: 120}],
  ['ap', {apBonus: 120}],
  ['damage', {extra: {killStats: {damage: 0.5}, chestBoosts: {}}}],
  ['health', {maxHp: 1145 * 1.09}],
  ['attackSpeed', {build: {haste1: 1}, asMult: 1090}],
  ['armor', {armorBonus: 150}],
  ['mr', {shieldBonus: 150}],
  ['speed', {build: {fleet1: 1}, speedMult: 1060}],
  ['leech', {build: {leech1: 1}}],
];
const helperCases: any[] = [];
const H = (name: string, call: any, result: any, extra: any = {}): void => {
  helperCases.push({name, caseKind: 'declared-input-helper', callsActualSharedFunctions: true,
    notRuntimeOutput: true, ...extra, call, result});
};

H('nine-key-investments-and-options', 'KILL_STAT_KEYS + rollKillAugments + killAugmentText',
  KILL_STAT_KEYS.map((key: string) => {
    const spec = investments.find(([k]) => k === key)![1];
    const victim = fighter(spec);
    const options = rollKillAugments(victim);
    const parsed = options.map((id: string) => parseKillAugment(id));
    return {key, victimSpec: spec, options, parsed, text: parsed[0] ? killAugmentText(parsed[0]) : null,
      readability: combatReadability(victim, {lasting: true}).investedStats};
  }),
  {keys: KILL_STAT_KEYS, share: KILL_AUG_SHARE, optionsMax: KILL_AUG_OPTIONS, lifetimeSeconds: KILL_AUG_SECONDS, label: KILL_AUG_LABEL});

H('flat-versus-percentage-wording', 'killAugmentText via actual parse',
  KILL_STAT_KEYS.map((key: string) => {
    const flat = ['ad', 'ap', 'armor', 'mr'].includes(key);
    const raw = flat ? 3.14 : 0.123456;
    const id = encodeKillAugment(key as any, raw);
    const parsed = parseKillAugment(id);
    return {key, raw, encoded: id, parsed, text: parsed ? killAugmentText(parsed) : null,
      expectedShape: flat ? 'flat one-decimal' : 'percentage one-decimal of the percentage'};
  }));

H('encode-parse-rounding-and-refusals', 'actual encodeKillAugment/parseKillAugment',
  (() => {
    const rows: any[] = [];
    for (const key of KILL_STAT_KEYS) {
      for (const raw of [1, 0.5, 0.12345, 12.3456, 0.00004]) {
        const id = encodeKillAugment(key as any, raw);
        rows.push({key, raw, id, parsed: parseKillAugment(id)});
      }
    }
    const malformed = ['', 'kill:', 'kill:nope:1', 'kill:ad', 'kill:ad:-1', 'kill:ad:0', 'kill:ad:NaN', 'kill:ad:Infinity', 'kill:damage:1e999', 'nope:ad:1'];
    return {roundTrips: rows, malformed: malformed.map((id) => ({id, parsed: parseKillAugment(id)}))};
  })());

H('ranking-ties-truncation', 'actual rollKillAugments over declared ReadableFighter inputs',
  (() => {
    const cases = [
      {name: 'tie-ad-vs-armor', spec: {adBonus: 240, armorBonus: 300}},
      {name: 'four-investments-truncated-to-three', spec: {adBonus: 240, armorBonus: 300, apBonus: 120, speedMult: 1200}},
      {name: 'fewer-than-three', spec: {adBonus: 120, shieldBonus: 150}},
      {name: 'nothing', spec: {}},
      {name: 'tiny-scores-filtered', spec: {adBonus: 0.1, apBonus: 0.1}},
    ];
    return cases.map((c) => {
      const victim = fighter(c.spec);
      return {name: c.name, spec: c.spec, readability: combatReadability(victim, {lasting: true}).investedStats,
        options: rollKillAugments(victim), parsed: rollKillAugments(victim).map((id: string) => parseKillAugment(id))};
    });
  })());

H('kill-augment-grant-store-map', 'actual parseKillAugment + killAugmentGrant',
  KILL_STAT_KEYS.map((key: string) => {
    const id = encodeKillAugment(key as any, key === 'damage' ? 0.0123 : 2.5);
    const parsed = parseKillAugment(id)!;
    return {key, id, parsed, grant: killAugmentGrant(parsed)};
  }));

H('kill-stat-effects-rows', 'actual killStatEffects over declared stats maps',
  [
    {name: 'all-store-keys-and-noise', stats: {ad: 5, ap: 3, damage: 0.1, maxHp: 20, attackSpeed: 0.1, moveSpeed: 0.1,
      lifesteal: 0.05, shield: 4, armor: 1, unknown: 9, zero: 0, nan: Number.NaN}},
    {name: 'empty', stats: {}},
  ].map((c) => ({name: c.name, stats: c.stats, rows: killStatEffects({forEach: (cb: any) => Object.entries(c.stats).forEach(([k, v]) => cb(v, k))})})));

H('combat-readability-declared-all-nine', 'actual combatReadability({lasting:true}) over one declared ReadableFighter',
  (() => {
    const spec = {adBonus: 120, apBonus: 120, asMult: 1090, speedMult: 1060, armorBonus: 150, shieldBonus: 150,
      maxHp: 1145 * 1.09, build: {leech1: 1}, extra: {killStats: {damage: 0.5}, chestBoosts: {}}};
    const all = fighter(spec);
    return {spec, readability: combatReadability(all, {lasting: true}), options: rollKillAugments(all)};
  })());

const provenance = (() => {
  const sourceFiles = ['packages/shared/src', 'packages/server/src/sim'].flatMap((dir) =>
    readdirSync('/repo/' + dir, {recursive: true}).filter((p: string) => p.endsWith('.ts')).map((p: string) => dir + '/' + p));
  const fileSha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
  return {
    image: 'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
    platform: 'linux/amd64', node: process.version,
    tools: {
      captureMts: fileSha('/repo/tools/trophy-witness-fixtures/capture.mts'),
      captureSh: fileSha('/repo/tools/trophy-witness-fixtures/capture.sh'),
      runMutantsSh: fileSha('/repo/tools/trophy-witness-fixtures/run-mutants.sh'),
      packageLock: fileSha('/repo/package-lock.json'),
    },
    profile: {config: CONFIG, modules: MODULES, players: PLAYERS.map((p) => p.faction), map: {seed: SEED, attempt: ATTEMPT, decor: false},
      probe: 'rewardOffered/rewardChosen are hook-only observational probes, never gameplay producers'},
    sourceSha256: Object.fromEntries(sourceFiles.map((p: string) => [p, fileSha('/repo/' + p)])),
  };
})();

const lifecycleBody = {format: 'rh-trophy-lifecycle-source/1', provenance, cases: lifecycle};
const helpersBody = {format: 'rh-trophy-helpers-source/1', provenance,
  evidence: 'declared-input pure helper cases calling the actual shared functions; NOT runtime lifecycle outputs',
  cases: helperCases};
const lifecycleText = JSON.stringify(lifecycleBody, null, 1) + '\n';
const helpersText = JSON.stringify(helpersBody, null, 1) + '\n';
const lsha = createHash('sha256').update(lifecycleText).digest('hex');
const hsha = createHash('sha256').update(helpersText).digest('hex');
if (args[0] === '--write') {
  mkdirSync(outDir, {recursive: true});
  writeFileSync(join(outDir, 'lifecycle.json'), lifecycleText);
  writeFileSync(join(outDir, 'helpers.json'), helpersText);
  console.log(JSON.stringify({written: outDir, lifecycle: {bytes: lifecycleText.length, sha256: lsha, cases: lifecycle.length},
    helpers: {bytes: helpersText.length, sha256: hsha, cases: helperCases.length}}));
} else {
  assert.equal(lifecycleText, readFileSync(join(outDir, 'lifecycle.json'), 'utf8'), 'lifecycle --check requires identical bytes');
  assert.equal(helpersText, readFileSync(join(outDir, 'helpers.json'), 'utf8'), 'helpers --check requires identical bytes');
  console.log(JSON.stringify({checked: outDir, lifecycle: {bytes: lifecycleText.length, sha256: lsha, cases: lifecycle.length},
    helpers: {bytes: helpersText.length, sha256: hsha, cases: helperCases.length}}));
}
