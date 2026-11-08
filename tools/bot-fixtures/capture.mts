// Canonical actual-source bot-core witness, captured in the pinned linux/amd64 Node 22.23.4 container.
// Runs the unmodified legacy brain modules (tier/persona tables, seeded distributions, click model, humanizer) over
// declared inputs and records their outputs. Nothing here feeds an expected value back into the source.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {mulberry32, TILE} from '/repo/packages/shared/src/index.ts';
import {isSolidAt} from '/repo/packages/shared/src/map.ts';
import {
  TIERS, TIER_IDS, PERSONAS, PERSONA_IDS, BOT_VIEW, HP_QUANT, MINIMAP_QUANT, MINIMAP_REFRESH_MS, PRIORITY,
} from '/repo/packages/server/src/bots/brain/types.ts';
import {
  uniform, chance, gaussian, exponential, exGaussian, softmaxIndex, pickOption,
} from '/repo/packages/server/src/bots/brain/random.ts';
import {
  pickTarget, lockCandidates, lockClick, inWindow, clampToWindow, edgeToward, groundSigma, groundClick, moveClick,
} from '/repo/packages/server/src/bots/brain/clicks.ts';
import {createHumanizer, HUMANIZER_RULES} from '/repo/packages/server/src/bots/brain/humanizer.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string', 'closed capture arguments');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const mapInput = JSON.parse(readFileSync('/capture/declared-map-input.json', 'utf8'));
const map: any = {w: mapInput.w, h: mapInput.h, tiles: Uint8Array.from(mapInput.tiles)};
const WORLD_W = map.w * TILE;
const WORLD_H = map.h * TILE;

// ------------------------------------------------------------------------------------------------ declared percepts
const percept = (o: any): any => ({
  now: 1000, viewT: 900,
  self: {
    id: 'bot', name: 'bot', x: 300, y: 300, facing: 0, status: 'alive', hp: 800, maxHp: 1000, barrier: 0,
    faction: 'fire', weapons: ['sword', null], slot: 0, attackTarget: null, drawStartedAt: 0, readyAt: 0,
    immuneUntil: 0, sig: 0, brand: 0, power: 0, asMult: 1, windupMult: 1, speedMult: 1, kills: 0, mobKills: 0,
    gv: 0, bounty: 0, moveSeq: 0, ...(o.self ?? {}),
  },
  hud: {phase: 'active', training: false, lobbyEndsAt: 0, raidStartedAt: 0, patienceEndsAt: 0, suddenDeathAt: 0,
    inColiseum: false, gatesLocked: false, startedWith: 4, alive: 4, playerCount: 4, minPlayers: 2, winner: '',
    ...(o.hud ?? {})},
  fighters: o.fighters ?? [],
  mobs: o.mobs ?? [],
  containers: o.containers ?? [],
  projectiles: [],
  minimap: {t: 0, mobs: [], gatesLocked: false},
  events: [],
  extras: o.extras ?? {},
  features: o.features ?? {},
});
const fighter = (o: any): any => ({
  id: 'p1', name: 'p1', bot: false, x: 380, y: 300, facing: 0, status: 'alive', hpFrac: 1, barrierFrac: 0,
  faction: 'plague', inHand: 'axe', drawStartedAt: 0, bounty: 0, immune: false, sig: 0, brand: 0,
  targetable: true, vx: 0, vy: 0, dist: 80, los: true, tint: 0, central: true, ...o,
});
const mob = (o: any): any => ({
  id: 'mob1', kind: 'mob', name: 'rat', faction: 'plague', x: 250, y: 350, facing: 0, status: 'alive',
  hpFrac: 1, inHand: 'fists', drawStartedAt: 0, sig: 0, brand: 0, vx: 0, vy: 0, dist: 70, los: true,
  central: true, ...o,
});
const PERCEPTS: Record<string, any> = {
  duel: percept({fighters: [fighter({}), fighter(fighter({id: 'p2', x: 340, y: 310, faction: 'holy', inHand: 'wand'}))]}),
  wand: percept({self: {weapons: ['wand', null], attackTarget: null}, fighters: [fighter({id: 'p1', x: 380, y: 300, vx: 40})]}),
  twinsWand: percept({self: {weapons: ['wand', null]}, fighters: [
    fighter({id: 'p1', x: 300, y: 320}), fighter(fighter({id: 'p2', x: 296, y: 320, faction: 'holy'})),
  ]}),
  twins: percept({fighters: [
    fighter({id: 'p1', x: 300, y: 320}), fighter(fighter({id: 'p2', x: 296, y: 320, faction: 'holy'})),
  ]}),
  crowd: percept({fighters: [
    fighter({id: 'p1', x: 300, y: 320}), fighter(fighter({id: 'p2', x: 308, y: 300})), fighter(fighter({id: 'p3', x: 420, y: 300})),
  ]}),
  far: percept({self: {x: 120, y: 120}, fighters: [fighter({id: 'p1', x: 700, y: 120})]}),
  loot: percept({
    fighters: [fighter({id: 'p1', x: 500, y: 300})],
    mobs: [mob({id: 'mob1', x: 250, y: 350})],
    containers: [
      {id: 'c1', kind: 'ground', x: 320, y: 300, label: '', closed: true, weapon: 'axe', interactable: true, dist: 20},
      {id: 'c2', kind: 'chest', x: 600, y: 600, label: '', closed: true, weapon: null, interactable: false, dist: 400},
    ],
    extras: {chests: [{id: 'r1', x: 320, y: 310, expiresAt: 9000, options: ['a', 'b'], takenBy: [], picked: false}]},
  }),
};

// --------------------------------------------------------------------------------------------------- declared inputs
const solidPoints: Array<{x: number; y: number}> = [];
for (let ty = 0; ty < map.h; ty++) {
  for (let tx = 0; tx < map.w; tx++) {
    solidPoints.push({x: tx * TILE + 0.5, y: ty * TILE + 0.5}, {x: tx * TILE + TILE - 1e-9, y: ty * TILE + 1e-9});
  }
}
solidPoints.push({x: -1, y: 10}, {x: WORLD_W + 1, y: 10}, {x: 10, y: -1}, {x: 10, y: WORLD_H + 1});

const rngCases = [
  {name: 'uniform-7', kind: 'uniform', seed: 7, lo: -5, hi: 12, draws: 32},
  {name: 'chance-99', kind: 'chance', seed: 99, p: 0.37, draws: 32},
  {name: 'gaussian-3', kind: 'gaussian', seed: 3, mu: 2.5, sigma: 4, draws: 32},
  {name: 'exponential-11', kind: 'exponential', seed: 11, mean: 120, draws: 32},
  {name: 'exgaussian-easy-reaction', kind: 'exGaussian', seed: 21, ex: TIERS.easy.reaction, draws: 24},
  {name: 'exgaussian-hard-step', kind: 'exGaussian', seed: 22, ex: TIERS.hard.step, draws: 24},
  {name: 'exgaussian-easy-reaction-long', kind: 'exGaussian', seed: 23, ex: TIERS.easy.reaction, draws: 128},
  {name: 'softmax-5', kind: 'softmaxIndex', seed: 5, utilities: [0.1, 0.9, 0.4, 0.0, 0.7], temperature: 0.12, draws: 24},
  {name: 'softmax-argmax', kind: 'softmaxIndex', seed: 5, utilities: [0.1, 0.9, 0.4], temperature: 0, draws: 8},
  {name: 'pickOption-13', kind: 'pickOption', seed: 13, lapseSeed: 31, utilities: [0.2, 0.8, 0.5, 0.9, 0.1], temperature: 0.25, lapseP: 0.3, draws: 24},
];

const clickCases: any[] = [
  {name: 'pick-target-near', fn: 'pickTarget', cursor: {x: 305, y: 302},
    candidates: [{id: 'p1', x: 300, y: 300}, {id: 'p2', x: 310, y: 305}, {id: 'm1', x: 400, y: 300}]},
  {name: 'pick-target-tie', fn: 'pickTarget', cursor: {x: 300, y: 300},
    candidates: [{id: 'b', x: 300, y: 300}, {id: 'a', x: 300, y: 300}]},
  {name: 'pick-target-none', fn: 'pickTarget', cursor: {x: 500, y: 500}, candidates: [{id: 'p1', x: 300, y: 300}]},
  {name: 'lock-candidates', fn: 'lockCandidates', percept: 'crowd'},
  {name: 'lock-candidates-gates', fn: 'lockCandidates', percept: 'crowd', gates: true},
  {name: 'in-window', fn: 'inWindow', self: {x: 400, y: 300}, points: [{x: 1200, y: 300}, {x: 1201, y: 300}, {x: 400, y: 862}, {x: 400, y: 863}]},
  {name: 'clamp-window', fn: 'clampToWindow', self: {x: 400, y: 300}, point: {x: 1500, y: -50}},
  {name: 'edge-toward', fn: 'edgeToward', self: {x: 400, y: 300}, to: {x: 1500, y: 500}},
  {name: 'ground-sigma', fn: 'groundSigma', tier: 'normal', self: {x: 300, y: 300}, pt: {x: 460, y: 300}},
  {name: 'ground-click-hard', fn: 'groundClick', tier: 'hard', seed: 4, self: {x: 300, y: 300}, pt: {x: 460, y: 320}},
  {name: 'ground-click-easy-wall', fn: 'groundClick', tier: 'easy', seed: 5, self: {x: 300, y: 300}, pt: {x: 0, y: 0}},
  {name: 'move-click-ground', fn: 'moveClick', tier: 'normal', seed: 6, self: {x: 300, y: 300}, to: {x: 500, y: 300}},
  ...[2, 3, 4, 8, 9].map((seed) => ({name: 'move-click-far-' + seed, fn: 'moveClick', tier: 'easy', seed,
    self: {x: 300, y: 300}, to: {x: 1400, y: 300}})),
  ...[7, 35, 183, 218].map((lapseSeed) => ({name: 'lock-click-slip-' + lapseSeed, fn: 'lockClick', tier: 'easy',
    percept: 'crowd', motorSeed: 100 + lapseSeed, lapseSeed, target: {id: 'p1', at: {x: 300, y: 320}}})),
  ...[0, 1, 2, 3].map((motorSeed) => ({name: 'lock-click-target-' + motorSeed, fn: 'lockClick', tier: 'easy',
    percept: 'twins', motorSeed: 300 + motorSeed, lapseSeed: 400 + motorSeed, target: {id: 'p1', at: {x: 300, y: 320}}})),
  {name: 'lock-click', fn: 'lockClick', tier: 'normal', percept: 'duel', motorSeed: 9, lapseSeed: 10, target: {id: 'p1', at: {x: 380, y: 300}}},
  {name: 'lock-click-wand', fn: 'lockClick', tier: 'easy', percept: 'wand', motorSeed: 11, lapseSeed: 12, target: {id: 'p1', at: {x: 380, y: 300}}},
];

const stimulus = (kind: string, at: number, subject: string | null = null, central = true, value?: number) =>
  (value === undefined ? {kind, at, subject, central} : {kind, at, subject, central, value});
const intent = (kind: string, priority: number, timing: any, body: any, why = 'capture') =>
  ({kind, priority, timing, why, ...body});
const react = (kind: string, priority: number, stim: any, body: any) => intent(kind, priority, {kind: 'react', stimulus: stim}, body);
const step = (kind: string, priority: number, body: any) => intent(kind, priority, {kind: 'step'}, body);
const timed = (kind: string, priority: number, due: number, body: any) => intent(kind, priority, {kind: 'timed', due}, body);

const humanizerCases: any[] = [
  {
    name: 'reaction-lock-sword', tier: 'easy', percept: 'duel', engaged: false, motorSeed: 41, lapseSeed: 42,
    frames: [{now: 1000, intents: [react('lock', 1, stimulus('newThreat', 1000, 'p1'), {target: 'p1', at: {x: 380, y: 300}})]}],
    frameStep: 20, frameCount: 100,
  },
  {
    name: 'reaction-lock-wand', tier: 'normal', percept: 'wand', engaged: true, motorSeed: 43, lapseSeed: 44,
    frames: [{now: 2000, intents: [react('lock', 1, stimulus('newThreat', 2000, 'p1'), {target: 'p1', at: {x: 380, y: 300}})]}],
    frameStep: 20, frameCount: 90,
  },
  {
    name: 'wand-lock-miss', tier: 'normal', percept: 'wand', engaged: false, motorSeed: 61, lapseSeed: 62,
    frames: [{now: 2100, intents: [react('lock', 1, stimulus('clickMissed', 2100, 'p1'), {target: 'ghost', at: {x: 300, y: 900}})]}],
    frameStep: 20, frameCount: 70,
  },
  {
    name: 'wand-lock-wrong-pick', tier: 'easy', percept: 'crowd', engaged: false, motorSeed: 63, lapseSeed: 64,
    frames: [{now: 2200, intents: [react('lock', 1, stimulus('newThreat', 2200, 'p1'), {target: 'p1', at: {x: 300, y: 320}})]}],
    frameStep: 20, frameCount: 80,
  },
  ...[0, 1, 2, 3, 4, 5].map((motorSeed) => ({
    name: 'wand-wrong-pick-' + motorSeed, tier: 'easy', percept: 'twinsWand', engaged: false,
    motorSeed: 500 + motorSeed, lapseSeed: 600 + motorSeed,
    frames: [{now: 2250 + motorSeed * 10, intents: [react('lock', 1, stimulus('newThreat', 2250 + motorSeed * 10, 'p1'), {target: 'p1', at: {x: 300, y: 320}})]}],
    frameStep: 20, frameCount: 60,
  })),
  {
    name: 'two-independent-channels', tier: 'hard', percept: 'duel', engaged: false, motorSeed: 45, lapseSeed: 46,
    frames: [{now: 3000, intents: [
      react('lock', 1, stimulus('newThreat', 3000, 'p1'), {target: 'p1', at: {x: 380, y: 300}}),
      react('swap', 1, stimulus('foeSwapped', 3000, 'p2'), {slot: 1}),
    ]}],
    frameStep: 20, frameCount: 80,
  },
  {
    name: 'move-steps-and-timed', tier: 'normal', percept: 'duel', engaged: false, motorSeed: 47, lapseSeed: 48,
    frames: [
      {now: 4000, intents: [step('move', 2, {to: {x: 460, y: 320}}), timed('move', 2, 4300, {to: {x: 500, y: 300}})]},
      {now: 4020, intents: [step('move', 2, {to: {x: 480, y: 340}})]},
    ],
    frameStep: 20, frameCount: 80,
  },
  {
    name: 'deep-window-move', tier: 'hard', percept: 'far', engaged: false, motorSeed: 49, lapseSeed: 50,
    frames: [{now: 5000, intents: [step('move', 2, {to: {x: 1500, y: 500}})]}],
    frameStep: 20, frameCount: 40,
  },
  {
    name: 'channel-conversions', tier: 'normal', percept: 'loot', engaged: false, motorSeed: 51, lapseSeed: 52,
    frames: [{now: 6000, intents: [
      step('swap', 1, {slot: 1}),
      step('pickup', 1, {container: 'c1'}),
      step('pickup', 1, {container: 'c2'}),
      step('cast', 1, {slot: 'wish', x: 320, y: 310, target: 'p1', at: {x: 500, y: 300}, snapRadius: 64}),
      step('cast', 1, {slot: 'q', x: 320, y: 310}),
      step('plan', 3, {msg: {spawn: 0, ready: true}}),
      step('choose', 3, {msg: {chest: 'r1', pick: 1}}),
    ]}],
    frameStep: 20, frameCount: 50,
  },
  {
    name: 'pickup-interactable-only', tier: 'normal', percept: 'loot', engaged: false, motorSeed: 65, lapseSeed: 66,
    frames: [{now: 6100, intents: [step('pickup', 1, {container: 'c1'})]}],
    frameStep: 20, frameCount: 40,
  },
  {
    name: 'same-frame-five-channels', tier: 'easy', percept: 'loot', engaged: false, motorSeed: 67, lapseSeed: 68,
    frames: [{now: 6200, intents: [
      step('move', 2, {to: {x: 460, y: 320}}),
      step('swap', 1, {slot: 1}),
      step('pickup', 1, {container: 'c1'}),
      step('cast', 1, {slot: 'wish', x: 320, y: 310}),
      step('choose', 3, {msg: {chest: 'r1', pick: 0}}),
    ]}],
    frameStep: 20, frameCount: 200,
  },
  {
    name: 'dedupe-and-resend', tier: 'normal', percept: 'duel', engaged: false, motorSeed: 55, lapseSeed: 56,
    frames: (() => {
      const out: any[] = [];
      for (let i = 0; i < 20; i++) {
        out.push({now: 8000 + i * 20, intents: [react('lock', 1, stimulus('orderFailed', 8000, 'p1'), {target: 'p1', at: {x: 380, y: 300}})]});
      }
      return out;
    })(),
    frameStep: 20, frameCount: 20,
  },
  {
    name: 'changing-move-hesitation', tier: 'easy', percept: 'duel', engaged: false, motorSeed: 69, lapseSeed: 70,
    frames: (() => {
      const out: any[] = [];
      for (let i = 0; i < 60; i++) {
        out.push({now: 9000 + i * 20, intents: [step('move', 2, {to: {x: 440 + (i % 5) * 15, y: 320 + (i % 3) * 10}})]});
      }
      return out;
    })(),
    frameStep: 20, frameCount: 60,
  },
  {
    name: 'many-reaction-swaps', tier: 'easy', percept: 'duel', engaged: false, motorSeed: 71, lapseSeed: 72,
    frames: (() => {
      const out: any[] = [];
      for (let i = 0; i < 60; i++) {
        out.push({now: 13000 + i * 20, intents: [react('swap', 1, stimulus('foeSwapped', 13000 + i * 20, 'p' + i), {slot: (i % 2) as 0 | 1})]});
      }
      return out;
    })(),
    frameStep: 20, frameCount: 60,
  },
  {
    name: 'burst-throttle', tier: 'easy', percept: 'duel', engaged: false, motorSeed: 57, lapseSeed: 58,
    frames: (() => {
      const out: any[] = [];
      for (let i = 0; i < 30; i++) {
        out.push({now: 12000 + i * 20, intents: [
          step('move', 2, {to: {x: 460 + (i % 3) * 30, y: 320}}),
          react('lock', 1, stimulus('newThreat', 12000 + i * 20, 'p' + (1 + (i % 2))), {target: 'p1', at: {x: 380, y: 300}}),
        ]});
      }
      return out;
    })(),
    frameStep: 20, frameCount: 30,
  },
  {
    name: 'dead-self', tier: 'normal', percept: 'duel', engaged: false, motorSeed: 59, lapseSeed: 60,
    frames: [{now: 15000, intents: [step('move', 2, {to: {x: 460, y: 320}})], patch: {self: {status: 'dead'}}}],
    frameStep: 20, frameCount: 20,
  },
];
// ------------------------------------------------------------------------------------------------------ the runner
function rngDraws(c: any): any[] {
  const rng = mulberry32(c.seed);
  const out: any[] = [];
  for (let i = 0; i < c.draws; i++) {
    switch (c.kind) {
      case 'uniform': out.push(uniform(rng, c.lo, c.hi)); break;
      case 'chance': out.push(chance(rng, c.p)); break;
      case 'gaussian': out.push(gaussian(rng, c.mu, c.sigma)); break;
      case 'exponential': out.push(exponential(rng, c.mean)); break;
      case 'exGaussian': out.push(exGaussian(rng, c.ex)); break;
      case 'softmaxIndex': out.push(softmaxIndex(rng, c.utilities, c.temperature)); break;
      case 'pickOption': {
        const lapse = mulberry32(c.lapseSeed!);
        out.push(pickOption(rng, lapse, c.utilities, c.temperature, c.lapseP));
        break;
      }
      default: throw new Error('unknown rng case ' + c.kind);
    }
  }
  return out;
}

function clickCase(c: any): any {
  switch (c.fn) {
    case 'pickTarget': return {picked: pickTarget(c.cursor, c.candidates)};
    case 'lockCandidates': {
      const p = JSON.parse(JSON.stringify(PERCEPTS[c.percept]));
      if (c.gates) p.hud.gatesLocked = true;
      return {candidates: lockCandidates(p)};
    }
    case 'inWindow': return {inWindow: c.points.map((pt: any) => inWindow(c.self, pt))};
    case 'clampToWindow': return {point: clampToWindow(c.self, c.point)};
    case 'edgeToward': return {point: edgeToward(map, c.self, c.to)};
    case 'groundSigma': return {sigma: groundSigma(TIERS[c.tier], c.self, c.pt)};
    case 'groundClick': return {point: groundClick(mulberry32(c.seed), TIERS[c.tier], map, c.self, c.pt)};
    case 'moveClick': return moveClick(mulberry32(c.seed), TIERS[c.tier], map, c.self, c.to);
    case 'lockClick': {
      const out = lockClick(mulberry32(c.motorSeed), mulberry32(c.lapseSeed), TIERS[c.tier], PERCEPTS[c.percept], c.target);
      return {cursor: out.cursor, picked: out.picked, slipped: out.slipped};
    }
    default: throw new Error('unknown click case ' + c.fn);
  }
}

function commandOut(cmd: any): any {
  const msg: any = {};
  for (const k of Object.keys(cmd.msg).sort()) msg[k] = cmd.msg[k];
  return {type: cmd.type, msg};
}
function stimulusOut(s: any): any {
  const out: any = {kind: s.kind, at: s.at, subject: s.subject, central: s.central};
  if (s.value !== undefined) out.value = s.value;
  return out;
}
function humanizerCase(c: any): any {
  const p = JSON.parse(JSON.stringify(PERCEPTS[c.percept]));
  const h = createHumanizer({tier: TIERS[c.tier], map});
  const motor = mulberry32(c.motorSeed);
  const lapse = mulberry32(c.lapseSeed);
  const decide = mulberry32(c.motorSeed ^ 0x5bf03635);
  const frames: any[] = [];
  const allIntents: any[] = [];
  for (let i = 0; i < c.frameCount; i++) {
    const spec = c.frames.find((f: any) => f.now === c.frames[0].now + i * c.frameStep) ?? c.frames[i];
    const now = c.frames[0].now + i * c.frameStep;
    p.now = now;
    if (spec?.patch) Object.assign(p.self, spec.patch.self ?? {});
    const intents = spec?.intents ?? [];
    const ctx = {p, rng: {decide, motor, lapse}, engaged: c.engaged, cfg: null, mem: null, know: null, svc: null};
    h.submit(intents, ctx);
    const released = h.release(ctx);
    const misses = h.drainMisses();
    allIntents.push(intents.map((it: any) => ({kind: it.kind, priority: it.priority, timing: it.timing.kind === 'react' ? {kind: 'react', stimulus: stimulusOut(it.timing.stimulus)} : it.timing.kind === 'timed' ? {kind: 'timed', due: it.timing.due} : {kind: 'step'}, body: bodyOut(it)})));
    frames.push({
      now,
      commands: released.map((tc: any) => ({at: tc.at, cmd: commandOut(tc.cmd), intent: tc.intent, priority: tc.priority, stimulus: tc.stimulus ? stimulusOut(tc.stimulus) : null})),
      misses: misses.map((m: any) => ({target: m.target, at: m.at})),
    });
  }
  const s = h.stats;
  const stats: any = {
    commands: s.commands, reactions: s.reactions, targetClicks: s.targetClicks, clickMissed: s.clickMissed,
    clickWrong: s.clickWrong, hesitations: s.hesitations, lapses: s.lapses, throttled: s.throttled,
    superseded: s.superseded, apmPeak: s.apmPeak,
  };
  return {name: c.name, tier: c.tier, percept: c.percept, engaged: c.engaged, motorSeed: c.motorSeed, lapseSeed: c.lapseSeed,
    frameStart: c.frames[0].now, frameStep: c.frameStep, frameCount: c.frameCount, frames, stats, intents: allIntents};
}
function bodyOut(it: any): any {
  const out: any = {};
  for (const k of ['target', 'at', 'to', 'slot', 'container', 'x', 'y', 'snapRadius', 'msg']) {
    if (it[k] !== undefined) out[k] = it[k];
  }
  return out;
}

function run() {
  const solid = solidPoints.map((pt) => ({x: pt.x, y: pt.y, solid: isSolidAt(map, pt.x, pt.y)}));
  return {
    inputs: {
      map: {w: map.w, h: map.h, tiles: Array.from(map.tiles)},
      percepts: PERCEPTS,
      rngCases,
      clickCases,
      humanizerCases: humanizerCases.map((c) => ({name: c.name, tier: c.tier, percept: c.percept, engaged: c.engaged,
        motorSeed: c.motorSeed, lapseSeed: c.lapseSeed, frameStart: c.frames[0].now, frameStep: c.frameStep,
        frameCount: c.frameCount,
        frames: c.frames})),
    },
    tables: {tiers: TIERS, tierIds: TIER_IDS, personas: PERSONAS, personaIds: PERSONA_IDS, botView: BOT_VIEW,
      humanizerRules: HUMANIZER_RULES, priority: PRIORITY, hpQuant: HP_QUANT, minimapQuant: MINIMAP_QUANT,
      minimapRefreshMs: MINIMAP_REFRESH_MS, tile: TILE, targetSnapRadius: 64},
    solid: {w: map.w, h: map.h, points: solid},
    rng: rngCases.map((c) => ({name: c.name, draws: rngDraws(c)})),
    clicks: clickCases.map((c) => ({name: c.name, output: clickCase(c)})),
    humanizer: humanizerCases.map(humanizerCase),
  };
}

const first = run();
const repeat = run();
assert.deepEqual(first, repeat, 'the capture is deterministic');

const sourceFiles = [
  'package.json',
  'package-lock.json',
  ...['packages/server/src/bots/brain', 'packages/shared/src'].flatMap((dir) =>
    readdirSync('/repo/' + dir, {recursive: true}).filter((p: string) => p.endsWith('.ts')).map((p: string) => dir + '/' + p)),
].sort();
const sourceSha256 = Object.fromEntries(sourceFiles.map((p) => [p, createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex')]));
const result = {
  format: 'rh-bot-core-source/1',
  profile: {
    name: 'bot-core-human-likeness-v1',
    boundary:
      'Unmodified legacy brain modules (types/tiers/personas, random distributions, click model, humanizer) run over declared inputs with declared seeded streams. No server match state, no hidden information, no driver: perception, memory, strategy and the feature modules are not part of this corpus.',
  },
  provenance: {
    node: process.version, platform: process.platform, arch: process.arch, sourceSha256,
    inputSha256: createHash('sha256').update(readFileSync('/capture/declared-map-input.json')).digest('hex'),
    recorderSha256: createHash('sha256').update(readFileSync('/capture/capture.mts')).digest('hex'),
  },
  ...first,
};
const text = JSON.stringify(result) + '\n';
if (args[0] === '--check') {
  assert.equal(readFileSync(outPath, 'utf8'), text, 'the checked-in bot-core corpus is byte-identical');
} else {
  writeFileSync(outPath, text);
}
console.log(JSON.stringify({
  tables: Object.keys(result.tables).length,
  solidPoints: result.solid.points.length,
  rngCases: result.rng.length,
  clicks: result.clicks.length,
  humanizerCases: result.humanizer.length,
  humanizerFrames: result.humanizer.reduce((n: number, c: any) => n + c.frames.length, 0),
  commands: result.humanizer.reduce((n: number, c: any) => n + c.frames.reduce((m: number, f: any) => m + f.commands.length, 0), 0),
  bytes: text.length,
  exactRepeat: true,
}));
