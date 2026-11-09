// Canonical actual-source quest human-eligibility witness (P-QUEST-HUMAN-ELIGIBILITY), captured in the pinned
// linux/amd64 Node 22.23.4 container. Drives the real legacy gameplay world (createGameWorld production module order,
// quests on, generated map seed 1 attempt 0) through ordinary enqueueClientMessage/50 ms steps, with declared human/bot
// seats added by addPlayer. Ordinary cases use no forged quest state; diagnostic cases are clearly labelled malformed-
// state controls. Every expected value is source-written; declared setup is recorded per case.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const argv = process.argv.slice(2);
const MODE = argv[0];
assert(MODE === '--write' || MODE === '--check', 'closed capture mode: --write or --check');
const OUT = argv[1];
assert(typeof OUT === 'string' && OUT.length > 0, 'an output directory');
const repoFlag = argv.indexOf('--repo');
const ROOT = repoFlag >= 0 ? argv[repoFlag + 1]! : '/repo';
assert(typeof ROOT === 'string' && ROOT.length > 0, 'a repo root');
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const IMAGE = 'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292';
const IMAGE_DIGEST = 'sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292';
const BASE_COMMIT = 'f034ace7d1f6617ed64a1eb194469e0b4531caa9';
const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const TOOL_REL = 'tools/quest-human-eligibility-fixtures';

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const repo = (rel: string): string => join(ROOT, rel);
const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();
const readText = (p: string): string => readFileSync(p, 'utf8');
const shaFile = (p: string): string => sha256(readFileSync(p));
const plain = (v: any): any => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------------------------------- real source imports
const shared: any = await import(pathToFileURL(repo('packages/shared/src/index.ts')).href);
const constants: any = await import(pathToFileURL(repo('packages/shared/src/constants.ts')).href);
const sharedQuests: any = await import(pathToFileURL(repo('packages/shared/src/quests.ts')).href);
const mapgen: any = await import(pathToFileURL(repo('packages/shared/src/mapgen.ts')).href);
const mapWire: any = await import(pathToFileURL(repo('packages/shared/src/mapWire.ts')).href);
const gameplay: any = await import(pathToFileURL(repo('packages/server/src/sim/gameplay.ts')).href);
const stepMod: any = await import(pathToFileURL(repo('packages/server/src/sim/step.ts')).href);
const inputsMod: any = await import(pathToFileURL(repo('packages/server/src/sim/inputs.ts')).href);
const worldMod: any = await import(pathToFileURL(repo('packages/server/src/sim/world.ts')).href);
const mobLifeMod: any = await import(pathToFileURL(repo('packages/server/src/sim/mobLife.ts')).href);

const TICK_MS = 50;
const SEED = 1;
const ATTEMPT = 0;
const RANDOM_SEED = 12;
const REWARD_SALT = [1, 2, 3, 4];
const BASE_CONFIG = {
  minPlayers: 2, lobbySeconds: 30, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
  suddenDeathSeconds: 3600, mobs: true, signatures: false, quests: true, training: false, dummies: false, planSeconds: 0,
  pvpRules: false,
};
// Declared seats: two humans and one bot for the ordinary human-vs-bot cases; one human and two bots for the camp-clear
// pair (the human must be able to leave the world without ending the run, and the same seats are used in both controls).
const STANDARD_SEATS = [
  {id: 'p0', profile: 'name0', faction: 'holy', bot: false, role: 'human'},
  {id: 'p1', profile: 'name1', faction: 'fire', bot: true, role: 'bot'},
  {id: 'p2', profile: 'name2', faction: 'plague', bot: false, role: 'human'},
];
const CAMP_SEATS = [
  {id: 'p0', profile: 'name0', faction: 'holy', bot: false, role: 'human'},
  {id: 'p1', profile: 'name1', faction: 'fire', bot: true, role: 'bot'},
  {id: 'p2', profile: 'name2', faction: 'plague', bot: true, role: 'bot'},
];

const distance = (a: any, b: any): number => Math.hypot(a.x - b.x, a.y - b.y);
const sortedPairs = (m: Map<any, any>): any[] => [...m].sort(([a], [b]) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
const sortedBooleans = (m: Map<any, any>): any[] => sortedPairs(m).map(([k, v]) => [k, !!v]);

function questSummary(qt: any): any {
  const d = qt.def;
  return {
    id: qt.id, def: d.id, kind: d.kind, name: d.name, giver: d.giver, count: d.count,
    region: d.region ?? null, elite: d.elite === true, players: d.players === true, tour: d.tour ?? 0,
    expiresAtSec: d.expiresAtSec, rewardGv: d.reward.gv, tokenSpawns: d.tokenSpawns ?? null,
  };
}

function boxView(w: any, id: string): any {
  const b = w.state.containers.get(id);
  if (!b) return null;
  return {id: b.id, kind: b.kind, x: b.x, y: b.y, items: [...b.items].map((i: any) => ({uid: i.uid, def: i.def}))};
}

function publicQuestView(w: any, id: string): any {
  const s = w.state.quests.get(id);
  if (!s) return null;
  return {
    id: s.id, def: s.def, x: s.x, y: s.y, status: s.status, doneBy: s.doneBy, expiresAt: s.expiresAt, carrier: s.carrier,
    progress: sortedPairs(s.progress), accepted: sortedBooleans(s.accepted), visitedRegions: sortedPairs(s.visitedRegions),
  };
}

function privateQuestView(qt: any): any {
  return {
    id: qt.id, def: qt.def.id, kind: qt.def.kind, name: qt.def.name, giver: qt.def.giver, count: qt.def.count,
    published: qt.published, publishAt: qt.publishAt, finder: qt.finder, npcId: qt.npcId, lastCarrier: qt.lastCarrier,
    closedAt: qt.closedAt, at: {x: qt.s.x, y: qt.s.y},
    tokens: (qt.placement.tokens ?? []).map((t: any) => ({x: t.x, y: t.y})),
    parcel: qt.placement.parcel ? {x: qt.placement.parcel.x, y: qt.placement.parcel.y} : null,
    containers: [...qt.containers],
  };
}

function giverView(w: any, qt: any): any {
  if (!qt.npcId) return null;
  const m = w.state.mobs.get(qt.npcId);
  return m ? {id: m.id, name: m.name, kind: m.kind, x: m.x, y: m.y} : null;
}

function playerView(w: any, seat: any): any {
  const s = w.state.players.get(seat.id);
  const rt = w.players.get(seat.id);
  return {
    id: seat.id, name: s.name, profile: seat.profile, role: seat.role, bot: !!s.bot, faction: s.faction,
    status: s.status, down: !!rt.down, resolved: !!rt.resolved, x: s.x, y: s.y,
    gv: {kills: rt.gv.kills, mobs: rt.gv.mobs, bounty: rt.gv.bounty, quest: rt.gv.quest},
  };
}

function questContainers(w: any): any[] {
  return [...w.state.containers]
    .filter(([, b]: any) => b.items.length === 1 && String(b.items[0].def).startsWith(constants.QUEST_ITEM_PREFIX))
    .map(([id, b]: any) => ({id, kind: b.kind, x: b.x, y: b.y, item: {uid: b.items[0].uid, def: b.items[0].def}}))
    .sort((a: any, b: any) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function targetContainers(w: any, qt: any): any[] {
  return [...qt.containers].map((id: string) => boxView(w, id)).filter((b: any) => b !== null);
}

function snapshot(w: any, seats: any[], label: string, targetId: string | null, extra: any = {}): any {
  const qt = targetId === null ? null : w.quests.quests.get(targetId) ?? null;
  return {
    label, tick: w.state.tick, time: w.state.serverTime, phase: w.state.phase, gatesLocked: !!w.state.gatesLocked,
    unknownQuests: w.state.unknownQuests, publicQuestCount: w.state.quests.size,
    publicStatuses: [...w.state.quests.values()]
      .map((s: any) => [s.def, s.status])
      .sort((a: any, b: any) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    privateOfferCounts: {
      total: w.quests.quests.size,
      published: [...w.quests.quests.values()].filter((q: any) => q.published).length,
      hidden: [...w.quests.quests.values()].filter((q: any) => !q.published).length,
      selected: targetId,
    },
    questContainerCount: questContainers(w).length,
    giverCount: [...w.state.mobs.values()].filter((m: any) => m.kind === 'quest').length,
    target: qt === null ? null : {
      quest: questSummary(qt), public: publicQuestView(w, qt.id), private: privateQuestView(qt),
      giver: giverView(w, qt), containers: targetContainers(w, qt),
    },
    seats: seats.map((seat: any) => playerView(w, seat)),
    ...extra,
  };
}

function relevantEvent(ev: any): boolean {
  return ev.type === 'toast' || ev.type === 'questReveal' || (ev.type === 'gv' && ev.reason === 'quest');
}

function openWorld(seats: any[], config: any = {}): {w: any; map: any} {
  const map: any = mapgen.generateMap(SEED, ATTEMPT, {decor: false});
  let uid = 0;
  const w: any = gameplay.createGameWorld({
    seed: SEED, map, config: {...BASE_CONFIG, ...config},
    random: shared.mulberry32(RANDOM_SEED), rewardSalt: REWARD_SALT,
    newItemUid: () => 'U' + (++uid),
  }, {signatures: false, walkHints: false});
  for (const seat of seats) stepMod.addPlayer(w, seat.id, seat.profile, {faction: seat.faction, bot: seat.bot});
  stepMod.step(w, TICK_MS);
  assert.equal(w.state.phase, 'active', 'the declared lobby starts an active run');
  assert.ok(w.quests, 'the real quest runtime spawned at the raid start');
  return {w, map};
}

function harness(w: any) {
  const events: any[] = [];
  let totalEvents = 0;
  const record = (where: string, evs: any[]): void => {
    for (const ev of evs) {
      totalEvents++;
      if (relevantEvent(ev)) events.push({where, tick: w.state.tick, time: w.state.serverTime, ...plain(ev)});
    }
  };
  return {
    events,
    totalEvents: (): number => totalEvents,
    step: (where: string): any[] => {
      const evs = stepMod.step(w, TICK_MS);
      record(where, evs);
      return evs;
    },
    drain: (where: string): any[] => {
      const evs = w.events;
      w.events = [];
      record(where, evs);
      return evs;
    },
  };
}

function caseContext(seats: any[], config: any = {}) {
  const {w, map} = openWorld(seats, config);
  const h = harness(w);
  const setup: any[] = [];
  const frames: any[] = [];
  setup.push({
    op: 'world', seed: SEED, attempt: ATTEMPT, decor: false, random: RANDOM_SEED, rewardSalt: REWARD_SALT,
    config: {...BASE_CONFIG, ...config}, mapHashU32: mapWire.mapHashU32(map), note: 'real generateMap/createGameWorld; declared config and seeds only',
  });
  setup.push({op: 'seats', seats, note: 'addPlayer seat declaration; bot:true seats are declared directly and never connect a profile or join'});
  const place = (actor: string, x: number, y: number, why: string): void => {
    const s = w.state.players.get(actor)!;
    const rt = w.players.get(actor)!;
    s.x = x; s.y = y; s.facing = 0;
    rt.path = [];
    rt.history = [{t: w.state.serverTime, x, y}];
    setup.push({op: 'place', actor, x, y, why});
  };
  const setHp = (actor: string, hp: number): void => {
    w.state.players.get(actor)!.hp = hp;
    setup.push({op: 'setHp', actor, hp});
  };
  const setWeapon = (actor: string, weapon: string): void => {
    w.state.players.get(actor)!.weapon0 = weapon;
    setup.push({op: 'setWeapon', actor, weapon});
  };
  const enqueue = (actor: string, type: string, payload: any): void => {
    assert.equal(inputsMod.enqueueClientMessage(w.players.get(actor)!.inputs, type, payload), true, 'the source accepted the ' + type + ' message');
    setup.push({op: 'enqueue', actor, type, payload});
  };
  const frame = (label: string, targetId: string | null, extra: any = {}): any => {
    const f = snapshot(w, seats, label, targetId, extra);
    frames.push(f);
    return f;
  };
  return {w, map, h, setup, frames, place, setHp, setWeapon, enqueue, frame, seats, config};
}

function published(w: any, kind: string): any[] {
  return [...w.quests.quests.values()].filter((q: any) => q.published && q.def.kind === kind && q.npcId !== '' && w.state.mobs.has(q.npcId));
}

function hiddenOffers(w: any): any[] {
  return [...w.quests.quests.values()].filter((q: any) => !q.published);
}

function farPoint(map: any, offers: any[], radius: number): any {
  const points = map.spawns.filter((s: any) => offers.every((q: any) => distance(s, q.s) > radius));
  assert.ok(points.length > 0, 'a declared point beyond every selected hidden giver');
  return points[0]!;
}

function accepted(qt: any, id: string): boolean { return qt.s.accepted.get(id) === true; }
function progress(qt: any, id: string): number { return qt.s.progress.get(id) ?? 0; }
function isReady(qt: any, id: string): boolean {
  if (!accepted(qt, id)) return false;
  if (qt.def.kind === 'fetch') return qt.s.carrier === id;
  return progress(qt, id) >= qt.def.count;
}

function eventRows(h: any, wherePrefix: string, type?: string): any[] {
  return h.events.filter((e: any) => e.where.startsWith(wherePrefix) && (type === undefined || e.type === type));
}

const RECORD = process.env.RH_QUEST_MUTANT_RECAPTURE === '1';
// In canonical mode these are hard assertions. In mutant-recapture mode they are recorded-output assertions only: the
// semantic corpus (frames/events) still captures the mutated source's actual behavior, while a setup/inventory failure
// remains a capture failure rather than a semantic kill.
const A = {
  ok: (condition: any, message: string): void => { if (!RECORD) assert.ok(condition, message); },
  equal: (actual: any, expected: any, message: string): void => { if (!RECORD) assert.equal(actual, expected, message); },
  deepEqual: (actual: any, expected: any, message: string): void => { if (!RECORD) assert.deepEqual(actual, expected, message); },
};

function revealAndPublish(c: any, target: any, human = 'p0'): void {
  c.place(human, target.s.x, target.s.y, 'human placed inside the selected hidden giver reveal radius');
  c.h.step('reveal-step');
  A.equal(target.finder, human, 'the standing human is the finder');
  A.equal(target.publishAt, c.w.state.serverTime + constants.QUEST_REVEAL_HEAD_START_MS, 'the reveal head start is source-written');
  A.equal(c.w.state.quests.has(target.id), false, 'the public row is absent during the head start');
  for (let i = 0; i < 79; i++) c.h.step('head-start-pending');
  A.equal(c.w.state.quests.has(target.id), false, 'the public row is still absent one tick before the head start ends');
  c.h.step('publish-step');
  A.equal(target.published, true, 'the offer publishes at the head start');
  A.equal(c.w.state.quests.has(target.id), true, 'the public row appears at the head start');
}

// ===================================================================================================== ordinary cases

function caseHiddenReveal(): any {
  const c = caseContext(STANDARD_SEATS);
  const hidden = hiddenOffers(c.w);
  const solo = hidden.find((q: any) => hidden.every((o: any) => o === q || distance(o.s, q.s) > constants.QUEST_REVEAL_RADIUS));
  A.ok(solo, 'a hidden offer whose exact position is outside every other hidden reveal radius');
  const target = solo!;
  const far = farPoint(c.map, hidden, constants.QUEST_REVEAL_RADIUS);
  c.place('p0', far.x, far.y, 'human parked beyond every hidden giver reveal radius');
  c.place('p2', far.x, far.y, 'second human parked beyond every hidden giver reveal radius');
  c.place('p1', target.s.x, target.s.y, 'declared bot seat placed inside the selected hidden giver reveal radius');
  c.frame('bot-only-in-radius', target.id);
  c.h.step('bot-only-step-1');
  c.h.step('bot-only-step-2');
  c.frame('bot-only-after-two-steps', target.id);
  A.equal(target.finder, '', 'the bot is not the finder');
  A.equal(target.publishAt, 0, 'the bot sets no publish deadline');
  A.equal(c.w.state.quests.has(target.id), false, 'no public row from the bot');
  A.equal(c.w.state.unknownQuests, hidden.length, 'the unknown count is unchanged');
  A.equal(eventRows(c.h, 'bot-only', 'questReveal').length, 0, 'no questReveal event from the bot');
  A.equal(eventRows(c.h, 'bot-only', 'toast').length, 0, 'no discovery toast from the bot');
  c.place('p1', far.x, far.y, 'bot leaves every reveal radius');
  c.place('p0', target.s.x, target.s.y, 'human enters the selected hidden giver reveal radius');
  c.h.step('human-reveal-step');
  c.frame('human-reveal', target.id);
  A.equal(target.finder, 'p0', 'the human is the finder');
  A.equal(target.publishAt, c.w.state.serverTime + constants.QUEST_REVEAL_HEAD_START_MS, 'publishAt = now + head start');
  A.equal(c.w.state.quests.has(target.id), false, 'the public row is still absent at the reveal');
  const revealEvents = eventRows(c.h, 'human-reveal', 'questReveal');
  A.equal(revealEvents.length, 1, 'one private reveal event');
  A.equal(revealEvents[0]?.to ?? null, 'p0', 'the reveal recipient is the human only');
  A.deepEqual(revealEvents[0]?.quest ?? null, {
    id: target.id, def: target.def.id, x: target.s.x, y: target.s.y, expiresAt: target.s.expiresAt,
  }, 'the reveal message carries the source QuestRevealMessage fields');
  A.equal(eventRows(c.h, 'human-reveal', 'toast').length, 1, 'one discovery toast');
  for (let i = 0; i < 79; i++) c.h.step('head-start-pending');
  c.frame('head-start-pending', target.id);
  A.equal(c.w.state.quests.has(target.id), false, 'the public row is absent one tick before the head start ends');
  c.h.step('publish-head-start');
  const publishedFrame = c.frame('published-at-head-start', target.id);
  A.equal(target.published, true, 'the offer publishes at the head start');
  A.equal(c.w.state.quests.has(target.id), true, 'the public row appears at the head start');
  A.equal(c.w.state.unknownQuests, hidden.length - 1, 'the unknown count drops once');
  const announce = c.h.events.filter((e: any) => e.where === 'publish-head-start' && e.type === 'toast');
  A.equal(announce.length, 1, 'the publish announcement');
  return {
    id: 'hidden-reveal-bot-then-human', kind: 'ordinary', title: 'Bot-only hidden discovery vs human finder',
    outcome: 'reachable', quest: questSummary(target), setup: c.setup, frames: c.frames,
    events: c.h.events, totalEvents: c.h.totalEvents(),
    assertions: {
      hiddenOffers: hidden.length, selectedIsSoloReveal: true, farPoint: {x: far.x, y: far.y},
      botFinder: '', botPublishAt: 0, botRevealEvents: 0, botToasts: 0,
      humanFinder: 'p0', humanPublishAt: target.publishAt, revealRecipient: revealEvents[0]?.to ?? null,
      publicRowAtReveal: false, publicRowAtHeadStart: true, unknownAtReveal: 10,
      unknownAtPublish: publishedFrame.unknownQuests,
    },
  };
}

function caseAccept(): any {
  const c = caseContext(STANDARD_SEATS);
  const hidden = hiddenOffers(c.w);
  const safe = (q: any): boolean => hidden.every((o: any) => distance(o.s, q.s) > constants.QUEST_REVEAL_RADIUS);
  const candidates = published(c.w, 'collect').filter(safe);
  const target = candidates[0] ?? published(c.w, 'collect')[0]!;
  A.ok(target, 'an actual published collect offer');
  const far = farPoint(c.map, hidden, constants.QUEST_REVEAL_RADIUS);
  c.place('p0', far.x, far.y, 'human parked beyond every hidden giver reveal radius');
  c.place('p2', far.x, far.y, 'second human parked beyond every hidden giver reveal radius');
  c.place('p1', target.s.x, target.s.y, 'declared bot seat placed at the published giver');
  c.enqueue('p1', 'questAccept', {quest: target.id});
  c.h.step('bot-accept-step');
  c.frame('bot-accept', target.id);
  A.equal(target.s.accepted.size, 0, 'the bot is not in the public accepted map');
  A.equal(target.s.expiresAt, 0, 'the bot starts no deadline');
  A.equal(eventRows(c.h, 'bot-accept', 'toast').length, 0, 'the bot accept is silent');
  A.equal(eventRows(c.h, 'bot-accept', 'questReveal').length, 0, 'no reveal');
  c.place('p0', target.s.x, target.s.y, 'standing human placed at the same published giver');
  c.enqueue('p0', 'questAccept', {quest: target.id});
  c.h.step('human-accept-step');
  const humanFrame = c.frame('human-accept', target.id);
  A.equal(accepted(target, 'p0'), true, 'the human is accepted');
  A.equal(target.s.expiresAt, c.w.state.serverTime + target.def.expiresAtSec * 1000, 'the human acceptance starts the source deadline');
  const toasts = eventRows(c.h, 'human-accept', 'toast');
  A.equal(toasts.length, 1, 'one success toast');
  A.equal(toasts[0]?.to ?? null, 'p0', 'the success toast goes to the human');
  A.equal(toasts[0]?.text ?? null, sharedQuests.questAcceptedText(target.def), 'the source success wording');
  return {
    id: 'bot-accept-ignored-vs-human-accepted', kind: 'ordinary', title: 'Bot questAccept ignored vs legal standing-human acceptance',
    outcome: 'reachable', quest: questSummary(target), setup: c.setup, frames: c.frames,
    events: c.h.events, totalEvents: c.h.totalEvents(),
    assertions: {
      botAcceptedSize: 0, botExpiresAt: 0, botToasts: 0, humanAccepted: ['p0'], humanExpiresAt: target.s.expiresAt,
      humanToast: {to: toasts[0]?.to ?? null, text: toasts[0]?.text ?? null}, publicRowStatus: humanFrame.target.public.status,
    },
  };
}

function casePickup(kind: 'collect' | 'fetch'): any {
  const c = caseContext(STANDARD_SEATS);
  const hidden = hiddenOffers(c.w);
  const safe = (q: any): boolean => hidden.every((o: any) => distance(o.s, q.s) > constants.QUEST_REVEAL_RADIUS);
  const spotSafe = (q: any): boolean => (kind === 'collect' ? q.placement.tokens : [q.placement.parcel])
    .every((t: any) => hidden.every((o: any) => distance(t, o.s) > constants.QUEST_REVEAL_RADIUS));
  const candidates = published(c.w, kind).filter((q: any) => q.containers.length > 0 && safe(q) && spotSafe(q));
  const target = candidates[0] ?? published(c.w, kind).find((q: any) => q.containers.length > 0);
  A.ok(target, 'an actual published ' + kind + ' offer with its container');
  const tokenAt = kind === 'collect' ? target.placement.tokens[0] : target.placement.parcel;
  A.ok(tokenAt, 'the source placed the token/parcel');
  const boxId: string = target.containers[0]!;
  const beforeBox = boxView(c.w, boxId);
  A.ok(beforeBox, 'the container exists before the bot pickup');
  const beforeCount = c.w.state.containers.size;
  const far = farPoint(c.map, hidden, constants.QUEST_REVEAL_RADIUS);
  c.place('p0', far.x, far.y, 'human parked beyond every hidden giver reveal radius');
  c.place('p2', far.x, far.y, 'second human parked beyond every hidden giver reveal radius');
  c.place('p1', tokenAt.x, tokenAt.y, 'declared bot seat placed at the ' + (kind === 'collect' ? 'token' : 'parcel') + ' container');
  c.h.step('before-bot-pickup-step');
  c.frame('before-bot-pickup', target.id, {boxId, beforeBox});
  c.enqueue('p1', 'pickup', {containerId: boxId});
  c.h.step('bot-pickup-step');
  const botBox = boxView(c.w, boxId);
  c.frame('after-bot-pickup', target.id, {boxId, box: botBox, containerCount: c.w.state.containers.size});
  A.ok(botBox, 'the container remains after the bot pickup');
  A.equal(c.w.state.containers.size, beforeCount, 'the bot removes no container');
  A.deepEqual(botBox.items, beforeBox.items, 'the bot consumes no item');
  A.deepEqual(sortedPairs(target.s.progress), [], 'the bot gains no progress');
  A.deepEqual(sortedPairs(target.s.accepted), [], 'the bot is not accepted');
  A.equal(target.s.carrier, '', 'the bot becomes no carrier');
  A.deepEqual([...c.w.quests.carried], [], 'the bot carries nothing');
  const botToasts = eventRows(c.h, 'bot-pickup', 'toast');
  A.equal(botToasts.length, 1, 'the source loot fallback toast');
  A.equal(botToasts[0]?.to ?? null, 'p1', 'the fallback goes to the bot');
  A.equal(botToasts[0]?.text ?? null, 'Nothing to take', 'the source fallback wording');
  c.place('p0', target.s.x, target.s.y, 'standing human placed at the published giver');
  c.enqueue('p0', 'questAccept', {quest: target.id});
  c.h.step('human-accept-step');
  A.equal(accepted(target, 'p0'), true, 'the human accepted the offer');
  c.place('p0', tokenAt.x, tokenAt.y, 'the accepted human placed at the same ' + (kind === 'collect' ? 'token' : 'parcel'));
  c.enqueue('p0', 'pickup', {containerId: boxId});
  c.h.step('human-pickup-step');
  const humanBox = boxView(c.w, boxId);
  c.frame('after-human-pickup', target.id, {boxId, box: humanBox, containerCount: c.w.state.containers.size});
  A.equal(humanBox, null, 'the human pickup removes the container');
  A.equal(c.w.state.containers.size, beforeCount - 1, 'exactly one container removed');
  const humanToasts = eventRows(c.h, 'human-pickup', 'toast');
  A.equal(humanToasts.length, 1, 'one actual pickup toast');
  A.equal(humanToasts[0]?.to ?? null, 'p0', 'the pickup toast goes to the human');
  if (kind === 'collect') {
    A.equal(progress(target, 'p0'), 1, 'the human gains one token of progress');
    A.equal(humanToasts[0]?.text ?? null, target.def.name + ': 1/' + target.def.count, 'the source collect progress wording');
  } else {
    A.equal(target.s.carrier, 'p0', 'the human becomes the carrier');
    A.deepEqual([...c.w.quests.carried], [['p0', target.id]], 'the carried map links the human to the offer');
    A.equal(humanToasts[0]?.text ?? null, 'Picked up: ' + target.def.name + ' — carry it to ' + target.def.giver, 'the source fetch wording');
  }
  return {
    id: 'bot-' + kind + '-pickup-ignored-vs-human', kind: 'ordinary', title: 'Bot ' + kind + ' pickup ignored vs human accept-and-pickup',
    outcome: 'reachable', quest: questSummary(target), setup: c.setup, frames: c.frames,
    events: c.h.events, totalEvents: c.h.totalEvents(),
    assertions: {
      boxId, item: beforeBox.items[0], containerCountBefore: beforeCount, containerCountAfterBot: beforeCount,
      containerCountAfterHuman: beforeCount - 1, botProgress: [], botCarrier: '', botToast: {to: botToasts[0]?.to ?? null, text: botToasts[0]?.text ?? null},
      humanProgress: kind === 'collect' ? sortedPairs(target.s.progress) : [], humanCarrier: target.s.carrier,
      humanCarried: [...c.w.quests.carried].map(([p, q]: any) => [p, q]), humanToast: {to: humanToasts[0]?.to ?? null, text: humanToasts[0]?.text ?? null},
    },
  };
}

function liveMobsIn(w: any, region: string): string[] {
  return [...w.mobs.keys()].filter((id: string) => {
    const rt = w.mobs.get(id);
    const s = w.state.mobs.get(id);
    return rt?.brain?.region === region && s?.status === 'alive' && (s.kind === 'mob' || s.kind === 'elite');
  });
}

function campClearCase(mode: 'bot-only' | 'human-control'): any {
  const c = caseContext(CAMP_SEATS, {minPlayers: 1});
  const hidden = hiddenOffers(c.w);
  const regional = hidden.filter((q: any) => q.def.kind === 'kill' && q.def.region && !q.def.tour && !q.def.elite && !q.def.players);
  const target = regional.find((q: any) => hidden.every((o: any) => o === q || distance(o.s, q.s) > constants.QUEST_REVEAL_RADIUS))
    ?? regional[0];
  A.ok(target, 'an actual hidden regional kill offer');
  const region: string = target.def.region;
  revealAndPublish(c, target, 'p0');
  c.frame('published', target.id);
  if (mode === 'bot-only') {
    c.setWeapon('p1', 'sword');
    c.setHp('p0', 1);
    const p0 = c.w.state.players.get('p0')!;
    c.place('p1', p0.x - 32, p0.y, 'declared bot attacker placed one body-length west of the human');
    c.enqueue('p1', 'attack', {a: 0});
    for (let i = 0; i < 16 && !c.w.players.get('p0')!.down; i++) c.h.step('human-kill');
    c.enqueue('p1', 'release', {a: 0});
    A.ok(c.w.players.get('p0')!.down, 'the human died to the real player-kill producer');
    A.equal(c.w.state.phase, 'active', 'two declared bots keep the run active');
    c.place('p1', target.s.x, target.s.y, 'standing bot placed at the impossible-kill offer');
    c.place('p2', target.s.x, target.s.y, 'second standing bot placed at the impossible-kill offer');
    c.frame('human-down-bots-only', target.id);
    const humansStanding = [...c.w.state.players].filter(([, p]: any) => p.status === 'alive' && !c.w.players.get(p.id)?.down && !c.w.players.get(p.id)?.resolved && !p.bot).length;
    A.equal(humansStanding, 0, 'no standing human remains');
  } else {
    c.place('p0', target.s.x, target.s.y, 'standing human placed at the published giver');
    c.enqueue('p0', 'questAccept', {quest: target.id});
    c.h.step('human-accept-step');
    A.equal(accepted(target, 'p0'), true, 'the human accepted the offer before the camp clear');
    c.place('p1', target.s.x + 1000, target.s.y + 1000, 'bot parked away from the offer');
    c.place('p2', target.s.x + 1000, target.s.y + 1000, 'bot parked away from the offer');
    c.frame('human-accepted', target.id);
  }
  const statusesBefore = new Map([...c.w.state.quests].map(([id, s]: any) => [id, s.status]));
  const live = liveMobsIn(c.w, region);
  A.ok(live.length > 0, 'the region has live regional mobs to clear');
  for (const id of live) {
    const mob = {kind: 'mob', id, s: c.w.state.mobs.get(id), rt: c.w.mobs.get(id)};
    mobLifeMod.killMob(c.w, mob, [], [], mob.s.hp);
  }
  c.setup.push({op: 'regionWipe', region, mobs: live.length, note: 'declared producer setup: the real killMob producer for every live regional mob, no credited killer; ordinary campaign path used by tools/quest-fixtures/lifecycle.mts'});
  c.h.drain('region-wipe-producer');
  A.equal(liveMobsIn(c.w, region).length, 0, 'no live regional mob remains');
  c.h.step('recheck-step-1');
  c.h.step('recheck-step-2');
  c.frame('after-camp-clear-recheck', target.id);
  const expired = [...c.w.state.quests].filter(([, s]: any) => s.status === 'expired').map(([, s]: any) => s.def);
  const changed = [...c.w.state.quests]
    .filter(([id, s]: any) => statusesBefore.get(id) !== s.status)
    .map(([id, s]: any) => ({id, def: s.def, before: statusesBefore.get(id), after: s.status}));
  const expireToasts = c.h.events.filter((e: any) => e.where.startsWith('recheck') && e.type === 'toast');
  if (mode === 'bot-only') {
    A.equal(target.s.status, 'open', 'with no standing human the source leaves the offer open');
    A.equal(expireToasts.length, 0, 'no expiry announcement');
    A.equal(c.w.state.unknownQuests, hidden.length - 1, 'the published offer has already left the unknown count');
  } else {
    A.equal(target.s.status, 'expired', 'the source closes the impossible offer for the standing accepted human');
    A.ok(expireToasts.length >= 1, 'the source announces the expiry');
  }
  return {
    id: 'camp-clear-' + mode, kind: 'ordinary', title: mode === 'bot-only' ? 'Camp clear with only bots standing' : 'Camp clear with a standing accepted human',
    outcome: 'reachable', quest: questSummary(target), region, setup: c.setup, frames: c.frames,
    events: c.h.events, totalEvents: c.h.totalEvents(),
    assertions: {
      mode, status: target.s.status, changed, expired, expireToasts: expireToasts.map((e: any) => ({to: e.to, text: e.text})),
      unknownQuests: c.w.state.unknownQuests, regionMobsBefore: live.length, regionMobsAfter: liveMobsIn(c.w, region).length,
      accepted: sortedPairs(target.s.accepted), progress: sortedPairs(target.s.progress), expiresAt: target.s.expiresAt,
    },
  };
}

function twoHumansCollectUnreachable(): any {
  const c = caseContext(STANDARD_SEATS);
  const hidden = hiddenOffers(c.w);
  const candidates = published(c.w, 'collect').filter((q: any) =>
    hidden.every((o: any) => distance(o.s, q.s) > constants.QUEST_REVEAL_RADIUS)
    && q.placement.tokens.length >= q.def.count
    && q.placement.tokens.every((t: any) => distance(t, q.s) > constants.QUEST_TURN_IN_RANGE)
    && q.placement.tokens.every((t: any) => hidden.every((o: any) => distance(t, o.s) > constants.QUEST_REVEAL_RADIUS)));
  const target = candidates[0];
  A.ok(target, 'an actual collect offer with enough source tokens and tokens away from the giver');
  const tokens = target.placement.tokens.map((t: any) => ({x: t.x, y: t.y}));
  const boxes = [...target.containers];
  c.place('p0', target.s.x, target.s.y, 'first standing human at the published giver');
  c.place('p2', target.s.x, target.s.y, 'second standing human at the published giver');
  c.place('p1', target.s.x + 1000, target.s.y + 1000, 'declared bot parked away');
  c.enqueue('p0', 'questAccept', {quest: target.id});
  c.enqueue('p2', 'questAccept', {quest: target.id});
  c.h.step('both-accept-step');
  c.frame('both-accepted', target.id);
  A.equal(accepted(target, 'p0') && accepted(target, 'p2'), true, 'both humans accepted');
  for (let i = 0; i < target.def.count; i++) {
    c.place('p0', tokens[i]!.x, tokens[i]!.y, 'first human placed at token ' + i);
    c.enqueue('p0', 'pickup', {containerId: boxes[i]!});
    c.h.step('first-human-token-' + i);
  }
  for (let i = target.def.count; i < tokens.length; i++) {
    c.place('p2', tokens[i]!.x, tokens[i]!.y, 'second human placed at token ' + i);
    c.enqueue('p2', 'pickup', {containerId: boxes[i]!});
    c.h.step('second-human-token-' + i);
  }
  c.frame('tokens-exhausted', target.id);
  A.equal(progress(target, 'p0'), target.def.count, 'the first human is ready');
  A.equal(progress(target, 'p2'), tokens.length - target.def.count, 'the second human is short');
  A.equal(isReady(target, 'p0'), true, 'first human ready');
  A.equal(isReady(target, 'p2'), false, 'second human not ready');
  A.equal(target.containers.length, 0, 'every token container is consumed');
  return {
    id: 'two-humans-one-collect', kind: 'ordinary', title: 'Two humans on one collect offer: explicit unreachable',
    outcome: 'unreachable', quest: questSummary(target), setup: c.setup, frames: c.frames,
    events: c.h.events, totalEvents: c.h.totalEvents(),
    unreachable: {
      id: 'two-humans-one-collect',
      claim: 'two humans cannot both be ready on this collect offer through ordinary pickups',
      count: target.def.count, tokenSpawns: tokens.length, tokensNeededForTwo: target.def.count * 2,
      picked: {p0: progress(target, 'p0'), p2: progress(target, 'p2')}, remainingTokens: target.containers.length,
      sourceReason: 'packages/shared/src/quests.ts catalog: tokenSpawns ' + tokens.length + ' with count ' + target.def.count
        + '; the two-full-sets requirement is ' + (target.def.count * 2)
        + ', so the source guarantee (always more than count, so one contest does not starve the offer) is not a second full set. No state was forged.',
    },
    assertions: {
      bothAccepted: ['p0', 'p2'], p0Progress: progress(target, 'p0'), p2Progress: progress(target, 'p2'),
      p0Ready: isReady(target, 'p0'), p2Ready: isReady(target, 'p2'), remainingTokens: target.containers.length,
    },
  };
}

function twoHumansPlayerKillUnreachable(): any {
  const c = caseContext(STANDARD_SEATS);
  const hidden = hiddenOffers(c.w);
  const target = published(c.w, 'kill').find((q: any) =>
    q.def.players && hidden.every((o: any) => distance(o.s, q.s) > constants.QUEST_REVEAL_RADIUS));
  A.ok(target, 'an actual player-kill offer with a safe giver');
  c.place('p0', target.s.x, target.s.y, 'first standing human at the published giver');
  c.place('p2', target.s.x, target.s.y, 'second standing human at the published giver');
  c.place('p1', target.s.x + 1000, target.s.y + 1000, 'declared bot parked away');
  c.enqueue('p0', 'questAccept', {quest: target.id});
  c.enqueue('p2', 'questAccept', {quest: target.id});
  c.h.step('both-accept-step');
  A.equal(accepted(target, 'p0') && accepted(target, 'p2'), true, 'both humans accepted');
  c.setWeapon('p0', 'sword');
  c.setHp('p2', 1);
  const p2 = c.w.state.players.get('p2')!;
  c.place('p0', p2.x - 32, p2.y, 'declared human attacker placed one body-length west of the victim');
  c.enqueue('p0', 'attack', {a: 0});
  for (let i = 0; i < 16 && !c.w.players.get('p2')!.down; i++) c.h.step('player-kill');
  c.enqueue('p0', 'release', {a: 0});
  A.ok(c.w.players.get('p2')!.down, 'the second human died to the real player-kill producer');
  A.equal(c.w.state.phase, 'active', 'the bot keeps the run active after the rival human death');
  A.equal(progress(target, 'p0'), 1, 'the real killer gains the player-kill credit');
  A.equal(isReady(target, 'p0'), true, 'the killer is ready');
  A.equal(c.w.players.get('p2')!.resolved, true, 'the victim is resolved, not standing');
  c.frame('after-player-kill', target.id);
  c.place('p0', target.s.x, target.s.y, 'ready killer placed at the giver for the actual automatic turn-in');
  c.h.step('automatic-turn-in');
  c.frame('after-player-kill-turn-in', target.id);
  A.equal(target.s.status, 'done', 'the killer completes the offer');
  A.equal(target.s.doneBy, 'name0', 'the killer is the source doneBy');
  return {
    id: 'two-humans-one-player-kill', kind: 'ordinary', title: 'Two humans on one player-kill offer: explicit unreachable',
    outcome: 'unreachable', quest: questSummary(target), setup: c.setup, frames: c.frames,
    events: c.h.events, totalEvents: c.h.totalEvents(),
    unreachable: {
      id: 'two-humans-one-player-kill', claim: 'two humans cannot both be ready on this player-kill offer through the real kill producer',
      killer: 'p0', victim: 'p2', victimStatus: c.w.state.players.get('p2')!.status, victimResolved: c.w.players.get('p2')!.resolved,
      victimReady: isReady(target, 'p2'), killerProgress: progress(target, 'p0'), victimProgress: progress(target, 'p2'),
      sourceReason: 'packages/server/src/sim/quests.ts onPlayerKilled: only the killer (accepted(killer), takesPart(killer)) is bumped; the victim of the only real progress producer goes down and is resolved, so it cannot be a standing ready turn-in contender. No state was forged.',
    },
    assertions: {
      bothAccepted: ['p0', 'p2'], killerProgress: progress(target, 'p0'), victimProgress: progress(target, 'p2'),
      killerReady: isReady(target, 'p0'), victimReady: isReady(target, 'p2'), victimStatus: c.w.state.players.get('p2')!.status,
      victimResolved: c.w.players.get('p2')!.resolved, status: target.s.status, doneBy: target.s.doneBy,
    },
  };
}

function twoHumansFetchUnreachable(): any {
  const c = caseContext(STANDARD_SEATS);
  const hidden = hiddenOffers(c.w);
  const candidates = published(c.w, 'fetch').filter((q: any) =>
    q.containers.length > 0 && hidden.every((o: any) => distance(o.s, q.s) > constants.QUEST_REVEAL_RADIUS)
    && hidden.every((o: any) => distance(q.placement.parcel, o.s) > constants.QUEST_REVEAL_RADIUS));
  const target = candidates[0];
  A.ok(target, 'an actual fetch offer with its parcel');
  const parcel = target.placement.parcel;
  const boxId = target.containers[0]!;
  c.place('p0', target.s.x, target.s.y, 'first standing human at the published giver');
  c.place('p2', target.s.x, target.s.y, 'second standing human at the published giver');
  c.place('p1', target.s.x + 1000, target.s.y + 1000, 'declared bot parked away');
  c.enqueue('p0', 'questAccept', {quest: target.id});
  c.enqueue('p2', 'questAccept', {quest: target.id});
  c.h.step('both-accept-step');
  c.place('p0', parcel.x, parcel.y, 'first human placed at the parcel');
  c.enqueue('p0', 'pickup', {containerId: boxId});
  c.h.step('first-human-parcel');
  A.equal(target.s.carrier, 'p0', 'the first human carries the one parcel');
  c.place('p2', parcel.x, parcel.y, 'second human placed at the parcel spot');
  c.enqueue('p2', 'pickup', {containerId: boxId});
  c.h.step('second-human-parcel');
  c.frame('second-human-parcel', target.id);
  A.equal(target.s.carrier, 'p0', 'the carrier remains the first human');
  A.equal(target.s.carrier === 'p2', false, 'the second human becomes no carrier');
  A.equal(target.containers.length, 0, 'the single parcel container is gone');
  const secondToasts = c.h.events.filter((e: any) => e.where === 'second-human-parcel' && e.type === 'toast');
  A.equal(secondToasts.length, 1, 'the second pickup gets the generic fallback');
  A.equal(secondToasts[0]?.text ?? null, 'Nothing there', 'the generic fallback wording');
  return {
    id: 'two-humans-one-fetch', kind: 'ordinary', title: 'Two humans on one fetch offer: explicit unreachable',
    outcome: 'unreachable', quest: questSummary(target), setup: c.setup, frames: c.frames,
    events: c.h.events, totalEvents: c.h.totalEvents(),
    unreachable: {
      id: 'two-humans-one-fetch', claim: 'two humans cannot both be ready on one fetch offer',
      carrier: target.s.carrier, secondHuman: 'p2', secondToast: secondToasts[0]?.text ?? null,
      sourceReason: 'packages/server/src/sim/quests.ts onQuestPickup: a fetch offer has one parcel and one carrier field (qt.s.carrier); the first pickup removes the only container, so the second human cannot carry the same parcel. No state was forged.',
    },
    assertions: {bothAccepted: ['p0', 'p2'], carrier: target.s.carrier, secondCarrier: target.s.carrier === 'p2', secondToast: secondToasts[0]?.text ?? null},
  };
}

// ===================================================================================================== diagnostic cases

function diagnosticForge(actor: string, qt: any, extra: any = {}): any {
  const edge: any = {op: 'forge', actor, quest: qt.id, diagnostic: true, note: 'DIAGNOSTIC malformed-state control: direct source-state write, not a normal-history claim'};
  if (extra.accepted !== undefined) {
    qt.s.accepted.set(actor, extra.accepted);
    edge.accepted = extra.accepted;
  }
  if (extra.progress !== undefined) {
    qt.s.progress.set(actor, extra.progress);
    edge.progress = extra.progress;
  }
  return edge;
}

function diagnosticPickup(): any {
  const c = caseContext(STANDARD_SEATS);
  const hidden = hiddenOffers(c.w);
  const collect = published(c.w, 'collect').find((q: any) => q.containers.length > 0 && hidden.every((o: any) => distance(o.s, q.s) > constants.QUEST_REVEAL_RADIUS));
  const fetch = published(c.w, 'fetch').find((q: any) => q.containers.length > 0 && hidden.every((o: any) => distance(o.s, q.s) > constants.QUEST_REVEAL_RADIUS));
  A.ok(collect && fetch, 'a collect and a fetch offer');
  const collectBox = collect.containers[0]!;
  const collectAt = collect.placement.tokens[0];
  c.setup.push(diagnosticForge('p1', collect, {accepted: true, progress: 1}));
  c.place('p0', collect.s.x + 1000, collect.s.y + 1000, 'human parked away');
  c.place('p2', collect.s.x + 1000, collect.s.y + 1000, 'second human parked away');
  c.place('p1', collectAt.x, collectAt.y, 'forged bot placed at the collect token');
  c.h.step('before-forged-bot-token');
  c.enqueue('p1', 'pickup', {containerId: collectBox});
  c.h.step('forged-bot-token-pickup');
  c.frame('after-forged-bot-token-pickup', collect.id);
  A.ok(boxView(c.w, collectBox), 'the forged bot removes no token container');
  A.equal(progress(collect, 'p1'), 1, 'the forged progress does not advance');
  const tokenToast = c.h.events.filter((e: any) => e.where === 'forged-bot-token-pickup' && e.type === 'toast');
  A.equal(tokenToast.length, 1, 'the generic loot fallback');
  A.equal(tokenToast[0]?.text ?? null, 'Nothing to take', 'the source fallback wording');
  const fetchBox = fetch.containers[0]!;
  c.setup.push(diagnosticForge('p1', fetch, {accepted: true}));
  c.place('p1', fetch.placement.parcel.x, fetch.placement.parcel.y, 'forged bot placed at the parcel');
  c.enqueue('p1', 'pickup', {containerId: fetchBox});
  c.h.step('forged-bot-parcel-pickup');
  c.frame('after-forged-bot-parcel-pickup', fetch.id);
  A.ok(boxView(c.w, fetchBox), 'the forged bot removes no parcel container');
  A.equal(fetch.s.carrier, '', 'the forged bot becomes no carrier');
  A.deepEqual([...c.w.quests.carried], [], 'the forged bot carries nothing');
  const parcelToast = c.h.events.filter((e: any) => e.where === 'forged-bot-parcel-pickup' && e.type === 'toast');
  A.equal(parcelToast.length, 1, 'the generic loot fallback for the parcel');
  A.equal(parcelToast[0]?.text ?? null, 'Nothing to take', 'the source fallback wording');
  return {
    id: 'diagnostic-forged-bot-cannot-pickup', kind: 'diagnostic', title: 'DIAGNOSTIC: forged-accepted bot cannot pick a token or parcel',
    label: 'DIAGNOSTIC — malformed-state control; not ordinary gameplay and not a normal-history claim',
    outcome: 'diagnostic', setup: c.setup, frames: c.frames, events: c.h.events, totalEvents: c.h.totalEvents(),
    assertions: {
      collectBoxPreserved: true, collectProgressAfter: progress(collect, 'p1'), collectCarrier: collect.s.carrier,
      fetchBoxPreserved: true, fetchCarrier: fetch.s.carrier, carried: [...c.w.quests.carried],
      tokenToast: tokenToast[0]?.text ?? null, parcelToast: parcelToast[0]?.text ?? null,
    },
  };
}

function diagnosticTurnIn(): any {
  const c = caseContext(STANDARD_SEATS);
  const hidden = hiddenOffers(c.w);
  const candidates = published(c.w, 'collect').filter((q: any) =>
    q.containers.length >= q.def.count && q.placement.tokens.length >= q.def.count
    && hidden.every((o: any) => distance(o.s, q.s) > constants.QUEST_REVEAL_RADIUS)
    && q.placement.tokens.every((t: any) => distance(t, q.s) > constants.QUEST_TURN_IN_RANGE)
    && q.placement.tokens.every((t: any) => hidden.every((o: any) => distance(t, o.s) > constants.QUEST_REVEAL_RADIUS)));
  const target = candidates[0];
  A.ok(target, 'an actual collect offer with tokens away from the giver');
  const tokens = target.placement.tokens.map((t: any) => ({x: t.x, y: t.y}));
  const boxes = [...target.containers];
  const far = farPoint(c.map, hidden, constants.QUEST_REVEAL_RADIUS);
  c.place('p0', target.s.x, target.s.y, 'human at the published giver to accept');
  c.enqueue('p0', 'questAccept', {quest: target.id});
  c.h.step('human-accept-step');
  A.equal(accepted(target, 'p0'), true, 'the human acceptance is ordinary');
  for (let i = 0; i < target.def.count; i++) {
    c.place('p0', tokens[i]!.x, tokens[i]!.y, 'human placed at token ' + i + ' (outside the turn-in range)');
    c.enqueue('p0', 'pickup', {containerId: boxes[i]!});
    c.h.step('human-token-' + i);
  }
  A.equal(progress(target, 'p0'), target.def.count, 'the human is ready through ordinary pickups');
  A.equal(isReady(target, 'p0'), true, 'the human is ready');
  c.place('p0', far.x, far.y, 'ready human parked outside the turn-in range');
  c.place('p1', far.x, far.y, 'forged bot parked outside the turn-in range');
  c.setup.push(diagnosticForge('p1', target, {accepted: true, progress: target.def.count}));
  const rank = (id: string, tick: number): number => worldMod.tieRank({orderSalt: c.w.orderSalt, state: {tick}}, id);
  let targetTick = c.w.state.tick + 1;
  while (rank('p1', targetTick) >= rank('p0', targetTick)) targetTick++;
  A.ok(targetTick - c.w.state.tick < 500, 'a nearby tick where the bot would win the source tie rank');
  for (let t = c.w.state.tick; t < targetTick - 1; t++) c.h.step('waiting-for-tie-tick');
  c.place('p0', target.s.x, target.s.y, 'ready human placed at the giver on the selected turn-in tick');
  c.place('p1', target.s.x, target.s.y, 'forged ready bot placed at the giver on the selected turn-in tick');
  const botRank = rank('p1', targetTick);
  const humanRank = rank('p0', targetTick);
  A.ok(botRank < humanRank, 'the forged bot would win the source tie rank (lower wins) if improperly admitted');
  c.h.step('automatic-turn-in-tick');
  c.frame('after-automatic-turn-in', target.id);
  A.equal(target.s.status, 'done', 'the human turn-in completes the offer');
  A.equal(target.s.doneBy, 'name0', 'the human wins the actual turn-in');
  const humanGv = c.w.players.get('p0')!.gv.quest;
  const botGv = c.w.players.get('p1')!.gv.quest;
  A.equal(humanGv, target.def.reward.gv, 'the human is paid the source quest GV');
  A.equal(botGv, 0, 'the forged bot is paid nothing');
  const completionToast = c.h.events.filter((e: any) => e.where === 'automatic-turn-in-tick' && e.type === 'toast');
  A.ok(completionToast.some((e: any) => e.to === 'p0' && e.text === 'Quest complete: ' + target.def.name), 'the human completion toast');
  return {
    id: 'diagnostic-forged-ready-bot-loses-turn-in', kind: 'diagnostic', title: 'DIAGNOSTIC: forged-ready bot cannot win the actual source turn-in',
    label: 'DIAGNOSTIC — malformed-state control; not ordinary gameplay and not a normal-history claim',
    outcome: 'diagnostic', quest: questSummary(target), setup: c.setup, frames: c.frames, events: c.h.events, totalEvents: c.h.totalEvents(),
    assertions: {
      selectedTick: targetTick, botRank, humanRank, botWouldWinIfAdmitted: true, status: target.s.status, doneBy: target.s.doneBy,
      humanGv, botGv, humanAccepted: accepted(target, 'p0'), botForgedAccepted: accepted(target, 'p1'), humanToast: 'Quest complete: ' + target.def.name,
    },
  };
}

// ===================================================================================================== build & provenance

function buildOrdinary(): any {
  return [
    caseHiddenReveal(),
    caseAccept(),
    casePickup('collect'),
    casePickup('fetch'),
    campClearCase('bot-only'),
    campClearCase('human-control'),
    twoHumansCollectUnreachable(),
    twoHumansPlayerKillUnreachable(),
    twoHumansFetchUnreachable(),
  ];
}

function buildDiagnostic(): any {
  return [diagnosticPickup(), diagnosticTurnIn()];
}

// ------------------------------------------------------------------------------------------------ source closure pins
const ENTRY_SOURCES = [
  TOOL_REL + '/capture.mts',
  'packages/shared/src/index.ts',
  'packages/shared/src/mapgen.ts',
  'packages/shared/src/mapWire.ts',
  'packages/server/src/sim/gameplay.ts',
  'packages/server/src/sim/step.ts',
  'packages/server/src/sim/inputs.ts',
  'packages/server/src/sim/world.ts',
  'packages/server/src/sim/quests.ts',
  'packages/server/src/sim/mobLife.ts',
];
const IMPORT_RE = /(?:^|[;\n])\s*(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g;
const LOAD_RE = /\b(?:import|load)\s*\(\s*["']([^"']+)["']/g;
const importsOf = (text: string): string[] => {
  const out: string[] = [];
  for (const re of [IMPORT_RE, LOAD_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push(m[1]!);
  }
  return out;
};
const tryTs = (base: string): string | null => {
  for (const cand of [base, base + '.ts', base + '.tsx', base + '.mts', base.replace(/\.js$/, '.ts'), base + '/index.ts', base + '/index.tsx']) {
    if (isFile(cand)) return cand;
  }
  return null;
};
function resolveSpecifier(fromRel: string, spec: string): {kind: 'ts' | 'external' | 'node' | 'unresolved'; path: string} {
  if (spec.startsWith('node:')) return {kind: 'node', path: spec};
  if (spec.startsWith('.')) {
    const base = join(dirname(fromRel), spec).split('\\').join('/');
    const ts = tryTs(base);
    return ts ? {kind: 'ts', path: ts} : {kind: 'unresolved', path: base};
  }
  if (spec === '@raid/shared') return {kind: 'ts', path: 'packages/shared/src/index.ts'};
  if (spec.startsWith('@raid/shared/')) {
    const ts = tryTs('packages/shared/src/' + spec.slice('@raid/shared/'.length));
    return ts ? {kind: 'ts', path: ts} : {kind: 'unresolved', path: spec};
  }
  if (spec === '@raid/server') return {kind: 'ts', path: 'packages/server/src/index.ts'};
  if (spec.startsWith('@raid/server/')) {
    const ts = tryTs('packages/server/src/' + spec.slice('@raid/server/'.length));
    return ts ? {kind: 'ts', path: ts} : {kind: 'unresolved', path: spec};
  }
  return {kind: 'external', path: spec};
}
const sourceFiles = new Set<string>();
const externalImports = new Set<string>();
const nodeBuiltins = new Set<string>();
const unresolved = new Set<string>();
const stack = [...ENTRY_SOURCES];
while (stack.length > 0) {
  const rel = stack.pop()!;
  if (!isFile(repo(rel)) || sourceFiles.has(rel)) continue;
  sourceFiles.add(rel);
  for (const spec of importsOf(readText(repo(rel)))) {
    const r = resolveSpecifier(rel, spec);
    if (r.kind === 'ts') stack.push(r.path);
    else if (r.kind === 'node') nodeBuiltins.add(r.path);
    else if (r.kind === 'external') externalImports.add(r.path);
    else unresolved.add(spec + ' (from ' + rel + ')');
  }
}
assert.equal(unresolved.size, 0, 'unresolved internal imports: ' + [...unresolved].join(', '));
const sourceFileHashes = Object.fromEntries([...sourceFiles].sort().map((p) => [p, shaFile(repo(p))]));
const closureSha256 = sha256(Object.entries(sourceFileHashes).map(([p, h]) => p + '\0' + h).join('\n'));

const CONFIG_FILES = [
  'package-lock.json', 'package.json', 'tsconfig.base.json',
  'packages/shared/package.json', 'packages/shared/tsconfig.json',
  'packages/server/package.json', 'packages/server/tsconfig.json',
  'packages/client/package.json', 'packages/client/tsconfig.json',
];
const configPins = Object.fromEntries(CONFIG_FILES.map((p) => [p, {bytes: statSync(repo(p)).size, sha256: shaFile(repo(p))}]));
function walkTool(dirRel: string): string[] {
  const abs = join(TOOL_DIR, dirRel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, {withFileTypes: true}).flatMap((d: any) =>
    d.isDirectory()
      ? (d.name === 'node_modules' ? [] : walkTool(dirRel + '/' + d.name))
      : [dirRel + '/' + d.name]);
}
const toolFiles = walkTool('.').filter((p) => !p.includes('/node_modules') && !p.endsWith('.log')).sort();
const toolPins = Object.fromEntries(toolFiles.map((p) => [TOOL_REL + '/' + p.replace(/^\.\//, ''), shaFile(join(TOOL_DIR, p))]));
const dependencyVersion = (name: string): any => {
  const p = repo('node_modules/' + name + '/package.json');
  return isFile(p) ? {version: JSON.parse(readText(p)).version, packageLockSha256: shaFile(repo('package-lock.json'))} : {unavailable: true};
};

const STRICT_ANCHORS = process.env.RH_QUEST_MUTANT_RECAPTURE !== '1';
function lineOf(rel: string, needle: string, occurrence = 0): any {
  const lines = readText(repo(rel)).split('\n');
  const hits: number[] = [];
  lines.forEach((text, i) => { if (text.includes(needle)) hits.push(i + 1); });
  const line = hits[occurrence];
  if (line === undefined) {
    if (STRICT_ANCHORS) assert.fail('source inventory anchor not found: ' + rel + ' :: ' + needle);
    return {path: rel, line: null, needle, source: null};
  }
  return {path: rel, line, needle, source: lines[line - 1]!.trim()};
}

const SOURCE_INVENTORY = {
  guards: [
    lineOf('packages/server/src/sim/quests.ts', 'const takesPart = (rt: PlayerRuntime | undefined)'),
    lineOf('packages/server/src/sim/quests.ts', 'const accepted = (qt: QuestRuntime, playerId: string)'),
    lineOf('packages/server/src/sim/quests.ts', 'const standing = (p: PlayerState, rt: PlayerRuntime | undefined)'),
    lineOf('packages/server/src/sim/quests.ts', 'function killSupplyLeft('),
    lineOf('packages/server/src/sim/quests.ts', 'if (!standing(p, world.players.get(pid))) continue;'),
    lineOf('packages/server/src/sim/quests.ts', 'if (!standing(p, rt)) continue;', 0),
    lineOf('packages/server/src/sim/quests.ts', 'if (!standing(p, rt) || !ready(qt, pid)) continue;'),
    lineOf('packages/server/src/sim/quests.ts', 'if (best !== null) completeQuest(world, qt, best);'),
  ],
  accept: [
    lineOf('packages/server/src/sim/quests.ts', 'export const handleQuestAccept: ActionHandler'),
    lineOf('packages/server/src/sim/quests.ts', 'if (cmd.kind !== \"questAccept\" || c.kind !== \"player\" || !q || world.state.phase !== \"active\" || !fighterStanding(c) || !takesPart(c.rt)) return;'),
    lineOf('packages/server/src/sim/quests.ts', 'qt.s.accepted.set(c.id, true);'),
  ],
  pickup: [
    lineOf('packages/server/src/sim/quests.ts', 'function onQuestPickup('),
    lineOf('packages/server/src/sim/quests.ts', 'if (!q || !item || !item.def.startsWith(QUEST_ITEM_PREFIX) || !takesPart(c.rt)) return false;'),
    lineOf('packages/server/src/sim/loot.ts', 'if (!world.quests?.onQuestPickup(world, c, box)) toast(world, c.id, \"Nothing to take\");'),
  ],
  reveal: [
    lineOf('packages/shared/src/constants.ts', 'export const QUEST_REVEAL_RADIUS'),
    lineOf('packages/shared/src/constants.ts', 'export const QUEST_REVEAL_HEAD_START_MS'),
    lineOf('packages/server/src/sim/quests.ts', 'qt.publishAt = now + QUEST_REVEAL_HEAD_START_MS;'),
    lineOf('packages/server/src/sim/quests.ts', 'type: \"questReveal\", to: finder,'),
    lineOf('packages/server/src/sim/quests.ts', 'if (qt.publishAt > 0) {'),
  ],
  campClear: [
    lineOf('packages/server/src/sim/mobLife.ts', 'export function killMob('),
    lineOf('packages/server/src/sim/camps.ts', 'world.hooks.campCleared?.(world, camp);'),
    lineOf('packages/server/src/sim/quests.ts', 'function onCampCleared(world: World): void'),
    lineOf('packages/server/src/sim/quests.ts', 'if (world.quests) world.quests.recheck = true;'),
    lineOf('packages/server/src/sim/quests.ts', 'function closeImpossible(world: World, out: QuestRuntime[], only?: QuestRuntime): void'),
  ],
  seats: [
    lineOf('packages/server/src/sim/step.ts', 'export function addPlayer('),
    lineOf('packages/server/src/sim/step.ts', 'p.bot = opts.bot === true;'),
    lineOf('packages/server/src/sim/world.ts', 'export function tieRank(world: World, id: string): number'),
  ],
  tokenSupply: [
    lineOf('packages/shared/src/quests.ts', 'count: 3, region: \"frost\", farZone: \"frost\", tokens: \"camp\", tokenSpawns: 5,'),
    lineOf('packages/shared/src/quests.ts', 'Collect quest: tokens on the ground (always more than'),
  ],
};

const PROFILE_FORMAT = 'rh-quest-human-eligibility-profile/1';
const profileBase: any = {
  format: PROFILE_FORMAT,
  baseCommit: BASE_COMMIT,
  runtime: 'Node.js ' + process.version + ' linux/x64 (pinned container)',
  image: IMAGE,
  imageDigest: IMAGE_DIGEST,
  asserts: {node: 'v22.23.4', platform: 'linux', arch: 'x64'},
  canonicalSerialization: 'JSON.stringify(corpus) + "\\n"',
  configFiles: configPins,
  sourceClosure: {
    method: 'static import/export + dynamic import/load literal graph from the entry list; the tool entry plus every internal TypeScript file it imports',
    entrySources: ENTRY_SOURCES,
    sourceFileCount: Object.keys(sourceFileHashes).length,
    closureSha256,
    sourceFiles: sourceFileHashes,
  },
  externalImports: [...externalImports].sort(),
  nodeBuiltins: [...nodeBuiltins].sort(),
  dependencies: {
    tsx: dependencyVersion('tsx'),
    typescript: dependencyVersion('typescript'),
    esbuild: dependencyVersion('esbuild'),
    '@colyseus/schema': dependencyVersion('@colyseus/schema'),
  },
  tool: toolPins,
  sourceInventory: SOURCE_INVENTORY,
  declared: {
    map: 'real generateMap(1, 0, {decor:false}); mapHashU32 recorded in each case',
    world: 'real createGameWorld production module order; quests on, mobs on, signatures off, walkHints off; declared seats via addPlayer; ordinary 50 ms step()',
    seats: 'p0/p2 declared humans, p1 declared bot for the standard cases; p0 human + p1/p2 bots for the camp-clear pair. Bots are declared directly with bot:true and never connect a profile or join.',
    positions: 'every player x/y, hp and weapon change is a declared trusted placement and is recorded in each case setup; the sim reads them as the server position',
    inputs: 'every command is the real enqueueClientMessage into the real InputQueue, applied by the real action handler during the ordinary step',
    producers: 'the camp-clear producer is the real killMob for every live regional mob with no credited killer, the same whole-region path used by tools/quest-fixtures/lifecycle.mts; the human departure in the bot-only camp world is a real player-kill attack',
    events: 'every toast/questReveal/gv(reason=quest) row is a real SimEvent returned by step() or drained after a declared producer',
    ordinary: 'no expected offer, acceptance, progress, ready state, reward or toast is installed in the ordinary cases',
    diagnostic: 'diagnostic cases forge only their named bot accepted/progress/ready state; they are labelled and are not ordinary gameplay or normal-history claims',
  },
  priorFindings: [
    {
      id: 'tradeOffers-public-schema',
      source: 'docs/evidence/quest-trade-public/README.md (P-QUEST-TRADE-PUBLIC-WITNESSES)',
      finding: 'PlayerState.tradeOffers, tradeStats and tradeUsed are ordinary synced fields (noSync:false); every client can read another player\'s rolled stat offers and applied deltas.',
      boundary: 'This is a separate prior source finding. It does NOT authorize Rust to disclose rolled owner offers; the native public/observation contract remains the lead/root decision.',
    },
  ],
  limits: [
    'Source-only: no native rh-sim run, no Room/socket/session, no Unity/browser/UI, no protocol-13 wire codec, no real profile connection or join.',
    'The human departure in the bot-only camp world uses a real player attack, but the camp clear itself is a declared whole-region killMob producer, not a player-fought camp.',
    'Two humans both ready on one kill offer was not produced by real player combat in this bounded packet; the ordinary unreachables cover the actual collect and fetch token/parcel rules, and the kill path used here credits no player.',
    'Bots are declared addPlayer seats; no BotManager, policy, profile, account, socket or dependency on host services runs.',
  ],
};

function finalize(corpus: any): string {
  corpus.profile = JSON.parse(JSON.stringify(profileBase));
  corpus.profile.captureSha256 = sha256(JSON.stringify(corpus));
  return JSON.stringify(corpus) + '\n';
}

const ordinaryCases = buildOrdinary();
assert.deepEqual(plain(ordinaryCases), plain(buildOrdinary()), 'the ordinary source cases repeat exactly');
const diagnosticCases = buildDiagnostic();
assert.deepEqual(plain(diagnosticCases), plain(buildDiagnostic()), 'the diagnostic source cases repeat exactly');

const ordinary: any = {
  format: 'rh-quest-human-eligibility-ordinary/1',
  scope: 'Actual legacy quest human/bot eligibility: hidden discovery, accept, token/parcel pickup, camp-clear impossibility, and the explicit two-human unreachables.',
  ordinary: ordinaryCases.filter((c: any) => c.outcome !== 'unreachable'),
  unreachable: ordinaryCases.filter((c: any) => c.outcome === 'unreachable'),
  counters: {
    ordinaryCases: ordinaryCases.filter((c: any) => c.outcome !== 'unreachable').length,
    unreachableCases: ordinaryCases.filter((c: any) => c.outcome === 'unreachable').length,
    frames: ordinaryCases.reduce((n: number, c: any) => n + c.frames.length, 0),
    events: ordinaryCases.reduce((n: number, c: any) => n + c.events.length, 0),
  },
};
const diagnostic: any = {
  format: 'rh-quest-human-eligibility-diagnostic/1',
  warning: 'DIAGNOSTIC ONLY — these cases forge bot accepted/progress/ready state to exercise source defense in depth. They are not ordinary gameplay, not reachable history, and must not be read as normal quest state.',
  cases: diagnosticCases,
  counters: {
    diagnosticCases: diagnosticCases.length,
    frames: diagnosticCases.reduce((n: number, c: any) => n + c.frames.length, 0),
    events: diagnosticCases.reduce((n: number, c: any) => n + c.events.length, 0),
  },
};

const ordinaryText = finalize(ordinary);
const diagnosticText = finalize(diagnostic);
const manifest: any = {
  format: 'rh-quest-human-eligibility-manifest/1',
  baseCommit: BASE_COMMIT,
  image: IMAGE,
  platform: 'linux/amd64',
  node: process.version,
  canonicalSerialization: 'JSON.stringify(corpus) + "\\n"',
  files: [
    {
      file: 'ordinary.json', bytes: Buffer.byteLength(ordinaryText, 'utf8'), sha256: sha256(ordinaryText),
      captureSha256: ordinary.profile.captureSha256, counts: ordinary.counters,
    },
    {
      file: 'diagnostic.json', bytes: Buffer.byteLength(diagnosticText, 'utf8'), sha256: sha256(diagnosticText),
      captureSha256: diagnostic.profile.captureSha256, counts: diagnostic.counters,
    },
  ],
  counters: {
    ordinaryCases: ordinary.counters.ordinaryCases,
    unreachableCases: ordinary.counters.unreachableCases,
    diagnosticCases: diagnostic.counters.diagnosticCases,
    frames: ordinary.counters.frames + diagnostic.counters.frames,
    events: ordinary.counters.events + diagnostic.counters.events,
  },
  provenance: {
    sourceClosure: {sourceFileCount: Object.keys(sourceFileHashes).length, closureSha256},
    configFiles: configPins,
    tool: toolPins,
    dependencies: {
      tsx: dependencyVersion('tsx'), typescript: dependencyVersion('typescript'), esbuild: dependencyVersion('esbuild'),
      '@colyseus/schema': dependencyVersion('@colyseus/schema'),
    },
  },
  priorFindings: profileBase.priorFindings,
};
const manifestText = JSON.stringify(manifest) + '\n';
const files: Record<string, string> = {'ordinary.json': ordinaryText, 'diagnostic.json': diagnosticText, 'manifest.json': manifestText};

if (MODE === '--write') {
  mkdirSync(OUT, {recursive: true});
  for (const [name, text] of Object.entries(files)) writeFileSync(join(OUT, name), text);
  console.log(JSON.stringify({
    written: OUT, counters: manifest.counters,
    files: Object.fromEntries(Object.entries(files).map(([n, t]) => [n, {bytes: Buffer.byteLength(t, 'utf8'), sha256: sha256(t)}])),
  }));
} else {
  for (const [name, text] of Object.entries(files)) {
    assert.ok(existsSync(join(OUT, name)), 'missing corpus: ' + join(OUT, name));
    const existing = readFileSync(join(OUT, name), 'utf8');
    assert.equal(existing, text, 'byte-identical corpus: ' + name);
  }
  console.log(JSON.stringify({
    checked: OUT, counters: manifest.counters,
    files: Object.fromEntries(Object.entries(files).map(([n, t]) => [n, {bytes: Buffer.byteLength(t, 'utf8'), sha256: sha256(t)}])),
  }));
}

