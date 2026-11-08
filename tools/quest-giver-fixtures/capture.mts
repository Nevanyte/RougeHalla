// Canonical actual-source P-QUEST-GIVER-SOURCE-WITNESS capture: real quest lifecycle giver birth/retirement and the
// bounded combat/status/terrain side effects around it. Pinned linux/amd64 Node 22.23.4 container; declared map/player
// setup and helper-declared diagnostics are labelled in the corpus input/actions; no giver/status/damage/telemetry
// outcome is installed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {generateMap} from '/repo/packages/shared/src/mapgen.ts';
import {TILE} from '/repo/packages/shared/src/constants.ts';
import {TERRAIN_EMBER, TERRAINS, terrainAtTile} from '/repo/packages/shared/src/terrain.ts';
import {createGameWorld} from '/repo/packages/server/src/sim/gameplay.ts';
import {addPlayer, step} from '/repo/packages/server/src/sim/step.ts';
import {enqueueClientMessage} from '/repo/packages/server/src/sim/inputs.ts';
import {standingCombatants, hostile, isQuestGiver, combatant} from '/repo/packages/server/src/sim/combatant.ts';
import {signatureState} from '/repo/packages/server/src/sim/factions.ts';
import {addStatus} from '/repo/packages/server/src/sim/status.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string');
const [, outDir] = args;
assert.equal(process.version, 'v22.23.4'); assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
const TICK_MS = 50; const RANDOM_SEED = 12; const REWARD_SALT = [1,2,3,4];
const PLAYERS = [{faction:'fire', name:'name0'}, {faction:'frost', name:'name1'}, {faction:'sentenced', name:'name2'}];
const baseConfig = (planSeconds = 0) => ({
  minPlayers: 2, lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
  suddenDeathSeconds: 3600, mobs: true, signatures: true, quests: true, training: false, dummies: false,
  planSeconds, pvpRules: false, wishLockSeconds: 0,
});
const r6 = (v: any): any => typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : (v === -Infinity ? null : v);
const ord = (id: any): number | null => typeof id === 'string' && /^p[0-9]+$/.test(id) ? Number(id.slice(1)) : null;

function emberTile(map: any): any {
  for (let ty = 1; ty < map.h - 1; ty++) for (let tx = 1; tx < map.w - 1; tx++) {
    if (map.tiles[ty * map.w + tx] === 0 && map.terrain[ty * map.w + tx] === TERRAIN_EMBER) return {tx, ty};
  }
  return null;
}

function open(planSeconds = 0, mapSeed = 1): any {
  const map: any = generateMap(mapSeed, 0, {decor: false});
  let uid = 0;
  const config = baseConfig(planSeconds);
  const w: any = createGameWorld({seed: mapSeed, map, config, random: mulberry32(RANDOM_SEED), rewardSalt: REWARD_SALT,
    newItemUid: () => 'U' + ++uid}, {signatures: true, walkHints: false});
  for (let i = 0; i < PLAYERS.length; i++) addPlayer(w, 'p' + i, PLAYERS[i].name, {faction: PLAYERS[i].faction as any});
  return w;
}

function runner(name: string, opts: {planSeconds?: number, mapSeed?: number} = {}) {
  const w = open(opts.planSeconds ?? 0, opts.mapSeed ?? 1);
  const actions: any[] = []; let seq = 0; const frames: any[] = []; const pendingEvents: any[] = [];
  // Diagnostic read-only tap: records the actual source ledger at the producer point (after beforeDamage, before the
  // damage pass consumes it). It never writes the world; genuine runtime frames and this helper diagnostic are labelled
  // separately in the output.
  const ledgerTap: any[] = [];
  w.beforeDamage.push((ww: any) => {
    for (const e of ww.combat.ledger ?? []) ledgerTap.push({victim: e.victim, by: typeof e.by === 'string' ? e.by : e.by?.id ?? null, raw: r6(e.packet?.raw ?? 0), weapon: e.weapon ?? null, arena: !!e.arena, sig: e.sig ?? null});
  });
  const push = (kind: string, extra: any): void => { actions.push({tick: w.state.tick, seq: seq++, kind, ...extra}); };
  const enqueue = (actor: string, type: string, payload: any): void => {
    assert.equal(enqueueClientMessage(w.players.get(actor)!.inputs, type, payload), true, 'source accepted '+type);
    push('input', {actor: Number(actor.slice(1)), type, payload});
  };
  const place = (actor: string, x: number, y: number): void => {
    const s = w.state.players.get(actor)!; s.x = x; s.y = y; s.facing = 0;
    w.players.get(actor)!.history = [{t: w.state.serverTime, x, y}];
    push('place', {actor: Number(actor.slice(1)), x, y});
  };
  const setWeapon = (actor: string, weapon: string): void => {
    const s = w.state.players.get(actor)!; s.weapon0 = weapon; s.weapon1 = ''; s.slot = 0;
    push('weapon', {actor: Number(actor.slice(1)), weapon});
  };
  const giverState = (id: string): any => {
    const m = w.state.mobs.get(id); if (!m) return null;
    const rt = w.mobs.get(id); const sig = signatureState(w, id);
    const c = combatant(w, id);
    return {id, kind: m.kind, name: m.name, faction: m.faction, x: r6(m.x), y: r6(m.y), facing: r6(m.facing),
      hp: r6(m.hp), maxHp: r6(m.maxHp), status: m.status, weapon0: m.weapon0, type: m.type, camp: m.camp,
      isQuestGiver: c ? isQuestGiver(c) : null, hostileFromP0: c ? hostile(combatant(w,'p0')!, c) : null,
      runtime: rt ? {historyLen: rt.history?.length ?? 0, historyLast: (rt.history ?? []).at(-1) ? {t: r6(rt.history.at(-1).t), x: r6(rt.history.at(-1).x), y: r6(rt.history.at(-1).y)} : null,
        path: rt.path?.length ?? null, brain: rt.brain ? {mode: rt.brain.mode, region: rt.brain.region ?? null} : null,
        statuses: (rt.statuses ?? []).map((s: any) => ({kind: s.kind, until: r6(s.until), source: s.source?.id ?? null}))} : null,
      signature: sig ? {target: sig.target, tier: sig.tier, hpFrac: r6(sig.hpFrac), chill: r6(sig.chill)} : null,
    };
  };
  const players = (): any[] => PLAYERS.map((p, i) => {
    const id = 'p'+i; const s = w.state.players.get(id); if (!s) return null;
    const rt = w.players.get(id)!;
    return {id: i, faction: s.faction, x: r6(s.x), y: r6(s.y), facing: r6(s.facing), hp: r6(s.hp), maxHp: r6(s.maxHp),
      status: s.status, weapon0: s.weapon0, slot: s.slot, wishReadyAt: r6(s.wishReadyAt), done: !!rt.down, resolved: !!rt.resolved,
      history: (rt.history ?? []).map((h: any) => ({t: r6(h.t), x: r6(h.x), y: r6(h.y)})),
      statuses: (rt.statuses ?? []).map((st: any) => ({kind: st.kind, until: r6(st.until), source: st.source?.id ?? null})),
      cast: rt.cast ? {ability: rt.cast.ability, landsAt: r6(rt.cast.landsAt)} : null,
    };
  });
  const quests = (): any[] => [...(w.quests?.quests ?? new Map())].map(([id, qt]: any) => ({
    id, def: qt.def.id, kind: qt.def.kind, name: qt.def.name, giver: qt.def.giver, status: qt.s.status,
    x: r6(qt.s.x), y: r6(qt.s.y), expiresAt: r6(qt.s.expiresAt), published: qt.published, npcId: qt.npcId || null,
    containers: [...qt.containers],
  })).sort((a,b) => a.id.localeCompare(b.id));
  const snap = (label: string): void => {
    const givers = [...w.state.mobs].filter(([,m]: any) => m.kind === 'quest').map(([id]: any) => giverState(id));
    frames.push({label, actionCount: actions.length, tick: w.state.tick, time: r6(w.state.serverTime), phase: w.state.phase,
      idCounter: w.idCounter, knownQuests: [...w.state.quests.keys()].length, unknownQuests: w.state.unknownQuests,
      givers, standing: (() => { const all = standingCombatants(w); const kinds: any = {}; for (const c of all) { const k = c.kind === 'mob' ? 'mob:'+c.s.kind : c.kind; kinds[k] = (kinds[k] ?? 0) + 1; } return {count: all.length, kinds, players: all.filter((c: any) => c.kind === 'player').map((c: any) => c.id).sort(), givers: all.filter((c: any) => c.kind === 'mob' && c.s.kind === 'quest').map((c: any) => c.id).sort()}; })(),
      quests: quests(), players: players(),
      landed: w.combat.landed.map((l: any) => ({victim: l.victim, by: typeof l.by === 'string' ? l.by : l.by?.id ?? null, amount: r6(l.amount), weapon: l.weapon, sig: l.sig ?? null})),
      diagnosticLedger: ledgerTap.splice(0),
      projectiles: [...w.projectiles.values()].map((p: any) => ({id: p.id, owner: p.owner, kind: p.kind, x: r6(p.x), y: r6(p.y), targetId: p.targetId ?? null, ended: !!p.ended})),
      terrain: {hazards: {seconds: {...w.hazards.stats.seconds}, damage: [...w.hazards.stats.damage].map(([id,row]: any) => ({id, row}))}, surface: givers.map((g: any) => g ? {id: g.id, terrain: terrainAtTile(w.map, Math.floor(g.x/TILE), Math.floor(g.y/TILE)), spec: TERRAINS[terrainAtTile(w.map, Math.floor(g.x/TILE), Math.floor(g.y/TILE))]?.key ?? null} : null)},
      events: pendingEvents.splice(0).map((e: any) => e),
    });
  };
  const runSteps = (n: number): void => { for (let i = 0; i < n; i++) { const ev = step(w, TICK_MS); if (Array.isArray(ev)) pendingEvents.push(...ev); } };
  const initial = PLAYERS.map((_p, i) => { const s = w.state.players.get('p'+i)!; return {x: r6(s.x), y: r6(s.y), faction: s.faction}; });
  const output = (script: any): any => ({input: {name, mapSeed: opts.mapSeed ?? 1, mapAttempt: 0, decor: false,
    config: baseConfig(opts.planSeconds ?? 0), modules: {signatures: true, walkHints: false}, players: PLAYERS, initial,
    diagnostics: [{name: 'read-only ledgertap at beforeDamage producer boundary', writesWorld: false}],
    seeds: {random: RANDOM_SEED, rewardSalt: REWARD_SALT}}, script, actions, frames});
  snap('start');
  return {w, enqueue, place, setWeapon, snap, runSteps, output, frames, actions, push};
}
const cases: any[] = [];
const knownGiver = (r: any): any => {
  const entry = [...(r.w.quests?.quests ?? new Map())].find(([,qt]: any) => qt.published && qt.npcId && r.w.state.mobs.get(qt.npcId)?.kind === 'quest');
  assert.ok(entry, 'a real published quest giver');
  const [id, qt] = entry as any;
  return {id, qt, giverId: qt.npcId};
};
const active = (r: any): void => { for (let i = 0; i < 200 && r.w.state.phase !== 'active'; i++) r.runSteps(1); assert.equal(r.w.state.phase, 'active'); };

// A. Known planning publication with no actor, then the active giver birth and identity/counter/faction/terrain facts.
{ const r = runner('planning-then-active-birth', {planSeconds: 2});
  r.snap('lobby');
  let planning = null;
  for (let i = 0; i < 200 && r.w.state.phase !== 'active'; i++) { r.runSteps(1); if (r.w.state.phase === 'planning' && planning === null) { planning = true; r.snap('planning-known-no-actor'); } }
  assert.ok(planning, 'planning phase observed'); assert.equal(r.w.state.phase, 'active'); r.snap('active-birth'); r.runSteps(1); r.snap('active-tick');
  const {giverId} = knownGiver(r); const g = r.frames[r.frames.length-1].givers.find((x: any) => x.id === giverId); assert.ok(g);
  cases.push(r.output({known: r.frames[0].knownQuests, giverId})); }

// B. A player's ordinary move input through the giver's location; giver history/position unchanged.
{ const r = runner('movement-through-giver'); active(r); r.snap('birth'); const {giverId, qt} = knownGiver(r); const giver = r.w.state.mobs.get(giverId)!;
  r.place('p0', giver.x - 80, giver.y); r.snap('placed'); r.enqueue('p0','move',{x: giver.x + 80, y: giver.y});
  for (let i=0;i<40;i++) { r.runSteps(1); if (i % 8 === 0) r.snap('move-'+i); } r.snap('crossed');
  cases.push(r.output({giverId, quest: qt.def.id, start: {x: r6(giver.x), y: r6(giver.y)}})); }

// C. A real bow shot from one side of the giver at a valid player behind it: the giver must not intercept.
{ const r = runner('projectile-through-giver'); active(r); r.snap('birth'); const {giverId} = knownGiver(r); const giver = r.w.state.mobs.get(giverId)!;
  r.setWeapon('p0','bow'); r.place('p0', giver.x - 140, giver.y); r.place('p2', giver.x + 140, giver.y); r.snap('placed');
  r.enqueue('p0','target',{id:'p2'}); r.enqueue('p0','attack',{a:0}); r.runSteps(30); r.snap('drawn'); r.enqueue('p0','release',{a:0});
  for (let i=0;i<50;i++) { r.runSteps(1); if (i < 4 || i % 5 === 0) r.snap('shot-'+i); } r.snap('landed');
  cases.push(r.output({giverId, shooter: 0, target: 2})); }

// D. A real sword swing with a valid player behind the giver: melee bodies exclude the giver.
{ const r = runner('melee-through-giver'); active(r); r.snap('birth'); const {giverId} = knownGiver(r); const giver = r.w.state.mobs.get(giverId)!;
  r.setWeapon('p0','sword'); r.place('p0', giver.x - 30, giver.y); r.place('p2', giver.x + 30, giver.y); r.snap('placed');
  r.enqueue('p0','target',{id:'p2'}); r.enqueue('p0','attack',{a:0}); for (let i=0;i<20;i++) { r.runSteps(1); if (i < 3 || i === 19) r.snap('swing-'+i); } r.snap('after');
  // Directly targeting the giver itself is a real refused/ignored attack attempt, recorded as such.
  r.enqueue('p0','target',{id: giverId}); r.enqueue('p0','attack',{a:0}); for (let i=0;i<10;i++) r.runSteps(1); r.snap('direct-giver-attempt');
  cases.push(r.output({giverId, attacker: 0, target: 2})); }

// E. A real status-producing Frost Wish attempt on the giver (public cast input); no status is applied to it.
{ const r = runner('status-wish-on-giver'); active(r); r.snap('birth'); const {giverId} = knownGiver(r); const giver = r.w.state.mobs.get(giverId)!;
  r.place('p1', giver.x - 80, giver.y); r.place('p2', giver.x - 30, giver.y); r.place('p0', giver.x + 40, giver.y); r.snap('placed');
  // Freeze is unit-targeted; the giver is not a hostile target, so the real cast attempt is refused at the target gate.
  r.enqueue('p1','cast',{slot:'wish', x: giver.x, y: giver.y, id: giverId}); r.runSteps(1); r.snap('freeze-on-giver-1'); r.runSteps(12); r.snap('freeze-on-giver-13');
  // Trial is unit-targeted: cast it at the nearby valid player so its zone overlaps the giver and status effects must still skip it.
  r.enqueue('p2','cast',{slot:'wish', x: r.w.state.players.get('p0')!.x, y: r.w.state.players.get('p0')!.y, id:'p0'}); r.runSteps(1); r.snap('trial-over-giver-1'); r.runSteps(30); r.snap('trial-over-giver-31');
  // Separately labelled helper diagnostic (not an admitted runtime producer): call the actual source status applicator
  // directly on the real giver combatant. It must refuse the giver; the surrounding runtime frames remain the genuine
  // trial-zone witness that applied a status to the valid player and none to the giver.
  const giverCombatant = combatant(r.w, giverId)!;
  const probe = addStatus(r.w, giverCombatant, {kind: 'stun', ms: 500, source: {id: 'p1', name: 'name1'}} as any);
  r.push('diagnosticAddStatusOnGiver', {returned: probe === null ? 'null' : 'status', giverId});
  cases.push(r.output({giverId, freezeCaster: 1, trialCaster: 2, trialTarget: 0, diagnostics: {directAddStatusOnGiver: {helper: true, returned: probe === null ? 'null' : 'status', giverHp: r.w.state.mobs.get(giverId)!.hp, giverStatuses: r.w.mobs.get(giverId)!.statuses?.length ?? 0}}})); }

// F. A Fire player crossing an actual ember tile occupied/under the giver: real terrain ledger entries with zero hp change.
{ let r = null; let tile = null; let usedSeed = 1;
  for (const seed of [1,2,3,4,5,6,7,8]) { const candidate = runner('fire-ember-through-giver', {mapSeed: seed}); const t = emberTile(candidate.w.map); if (t) { r = candidate; tile = t; usedSeed = seed; break; } }
  assert.ok(r && tile, 'an actual generated ember tile exists on the declared map');
  active(r); r.snap('birth'); const {giverId} = knownGiver(r); const g = r.w.state.mobs.get(giverId)!;
  const x = (tile.tx + 0.5) * TILE, y = (tile.ty + 0.5) * TILE; g.x = x; g.y = y; r.push('placeGiverOnEmber', {giverId, tx: tile.tx, ty: tile.ty, x: r6(x), y: r6(y)});
  r.place('p0', x - 72, y); r.snap('giver-on-ember'); r.enqueue('p0','move',{x: x + 72, y});
  for (let i=0;i<60;i++) { r.runSteps(1); if (i % 10 === 0) r.snap('ember-'+i); } r.snap('ember-crossed');
  cases.push(r.output({giverId, mapSeed: usedSeed, emberTile: tile, firePlayer: 0})); }

// G. Real expiry retirement: the accepted offer's actual timer, then the giver is removed; counters unchanged.
{ const r = runner('expiry-retirement'); active(r); r.snap('birth'); const {giverId, id, qt} = knownGiver(r); const giver = r.w.state.mobs.get(giverId)!;
  r.place('p0', giver.x, giver.y); r.enqueue('p0','questAccept',{quest: id}); r.runSteps(1); r.snap('accepted');
  const expiresAt = r.w.quests.quests.get(id).s.expiresAt; assert.ok(expiresAt > 0);
  let guard = 0; while (r.w.state.serverTime < expiresAt && guard < 12000) { r.runSteps(1); guard++; if (r.w.state.serverTime >= expiresAt - 100 && !r.frames.some((f: any) => f.label === 'before-expiry')) r.snap('before-expiry'); }
  r.runSteps(1); r.snap('expired'); r.snap('after');
  cases.push(r.output({giverId, quest: id, expiresAt: r6(expiresAt), steps: guard})); }

// H. Real completion retirement where a published known offer is collect/fetch; tokens/parcel and turn-in through real actions.
{ const r = runner('completion-retirement'); active(r); r.snap('birth');
  const candidates = [...(r.w.quests?.quests ?? new Map())].filter(([,qt]: any) => qt.published && qt.def.kind !== 'kill' && r.w.state.mobs.get(qt.npcId)?.kind === 'quest');
  if (candidates.length === 0) { cases.push(r.output({limit: 'no published known collect/fetch offer in the fixed roster'})); }
  else {
    const [id, qt]: any = candidates[0]; const giverId = qt.npcId; r.place('p0', qt.s.x, qt.s.y); r.enqueue('p0','questAccept',{quest: id}); r.runSteps(1); r.snap('accepted');
    const containers = [...qt.containers]; for (let i=0;i<containers.length;i++) { const c = r.w.state.containers.get(containers[i]); if (!c) continue; r.place('p0', c.x, c.y); r.enqueue('p0','pickup',{containerId: containers[i]}); r.runSteps(1); r.snap('picked-'+i); }
    r.place('p0', qt.s.x, qt.s.y); r.runSteps(1); r.snap('turned-in'); runStepsLinger(r); r.snap('after');
    cases.push(r.output({giverId, quest: id, kind: qt.def.kind, containers}));
  } }
function runStepsLinger(r: any): void { for (let i=0;i<25;i++) r.runSteps(1); }

const sourceDirs = ['packages/shared/src', 'packages/server/src/sim'];
const sourceFiles = sourceDirs.flatMap((dir) => readdirSync('/repo/'+dir, {recursive: true}).filter((p: string) => p.endsWith('.ts')).map((p: string) => dir+'/'+p));
const fileSha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
const body = {format: 'rh-quest-giver-source/1', provenance: {
  image: 'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292', platform: 'linux/amd64', node: process.version,
  profile: 'player-only-no-mobs?/quests/signatures/hazards', players: PLAYERS, seeds: {random: RANDOM_SEED, rewardSalt: REWARD_SALT},
  tools: {captureMts: fileSha('/repo/tools/quest-giver-fixtures/capture.mts'), captureSh: fileSha('/repo/tools/quest-giver-fixtures/capture.sh'), runMutantsSh: fileSha('/repo/tools/quest-giver-fixtures/run-mutants.sh'), packageLock: fileSha('/repo/package-lock.json')},
  sourceSha256: Object.fromEntries(sourceFiles.map((p: string) => [p, fileSha('/repo/'+p)])),
}, cases: cases.map((c: any) => ({...c, script: c.script ?? {}}))};
const text = JSON.stringify(body, null, 1) + '\n'; const sha = createHash('sha256').update(text).digest('hex');
if (args[0] === '--write') { mkdirSync(outDir, {recursive:true}); writeFileSync(join(outDir, 'source.json'), text); console.log(JSON.stringify({written: outDir, bytes: text.length, sha256: sha, cases: cases.length})); }
else { assert.equal(text, readFileSync(join(outDir, 'source.json'), 'utf8'), 'capture --check requires identical bytes'); console.log(JSON.stringify({checked: outDir, bytes: text.length, sha256: sha, cases: cases.length})); }
