// Canonical actual-source Wish/ability-policy witness, captured in the pinned linux/amd64 Node 22.23.4 container.
// Runs the unmodified legacy abilityPolicy.ts (decideCast / hidesCaster / its constants) and the Wishes module's rule table
// over declared situations and records their outputs. Nothing here feeds an expected value back into the source.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {TILE} from '/repo/packages/shared/src/index.ts';
import {EFFECT_CASTING, EFFECT_ROOTED, EFFECT_SILENCED, EFFECT_STUNNED} from '/repo/packages/shared/src/status.ts';
import {ABILITIES, ABILITY_IDS, rankOf} from '/repo/packages/shared/src/abilities.ts';
import {mapFromTiles} from '/repo/packages/shared/src/map.ts';
import {
  decideCast, ESCAPE_HP_HIT, ESCAPE_HP_THREATENED, ESCAPE_THREAT_DISTANCE, ENGAGE_RANGE_MARGIN,
  PEEL_DISTANCE, SUSTAIN_HP, hidesCaster as policyHides,
} from '/repo/packages/server/src/bots/abilityPolicy.ts';
import {WISH_RULES} from '/repo/packages/server/src/bots/brain/modules/wishes.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string', 'closed capture arguments');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

const mapInput = JSON.parse(readFileSync('/capture/declared-map-input.json', 'utf8'));
const map = mapFromTiles(mapInput.w, mapInput.h, Uint8Array.from(mapInput.tiles), mapInput.seed ?? 0);

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const choice = (c: any) => c === null ? null : c.id === undefined
  ? {x: r6(c.x), y: r6(c.y)}
  : {x: r6(c.x), y: r6(c.y), id: c.id};

// ------------------------------------------------------------------------------------------------- the declared rows
const defs = ABILITY_IDS.map((id: any) => {
  const def: any = ABILITIES[id as keyof typeof ABILITIES];
  const rank = rankOf(def, 1);
  const hidden = policyHides(def, 1);
  const blink: any = rank.effects.find((e: any) => e.do === 'blink');
  return {
    id, name: def.name, ai: [...def.ai], blockedBy: [...def.blockedBy], dropsLock: def.dropsLock,
    castMs: rank.castMs,
    cooldownMs: rank.cooldownMs,
    charges: rank.charges ?? 1,
    targeting: rank.targeting,
    effects: {hidesCaster: hidden, blink: blink ? {maxDist: blink.maxDist, minDist: blink.minDist} : null},
  };
});
const hides = [];
for (const id of ABILITY_IDS) {
  for (const rank of [0, 1, 2, 3, 99]) hides.push({id, rank, hidden: policyHides(ABILITIES[id as keyof typeof ABILITIES], rank)});
}

// ------------------------------------------------------------------------------------------------- declared situations
const me = (o: any) => ({x: 400, y: 400, hpFrac: 0.8, effects: 0, recentlyHit: false, ...o});
const foe = (o: any) => ({id: 'p7', x: 500, y: 400, d: 100, los: true, targetable: true, ...o});
const threat = (o: any) => ({x: 500, y: 400, d: 100, chasing: true, id: 'p7', los: true, targetable: true, ...o});
const sit = (o: any) => ({me: me({}), foe: null, threat: null, map, gatesLocked: false, ...o});
const cases: any[] = [];
const add = (name: string, id: any, rank: number, s: any) => cases.push({name, def: id, rank, gatesLocked: !!s.gatesLocked, me: s.me, foe: s.foe, threat: s.threat, choice: choice(decideCast(ABILITIES[id as keyof typeof ABILITIES], rank, s))});

for (const id of ABILITY_IDS) {
  for (const [label, effects] of [
    ['casting', EFFECT_CASTING], ['stun', EFFECT_STUNNED], ['silence', EFFECT_SILENCED], ['root', EFFECT_ROOTED],
    ['all-blocked', EFFECT_STUNNED | EFFECT_SILENCED | EFFECT_ROOTED],
  ] as const) add('blocked-' + label, id, 1, sit({me: me({effects})}));
}
for (const id of ABILITY_IDS) {
  for (const [label, meFields, threatView] of [
    ['threatened', {hpFrac: 0.49}, threat({d: 200})],
    ['threat-far', {hpFrac: 0.49}, threat({d: 300})],
    ['hit', {hpFrac: 0.54, recentlyHit: true}, null],
    ['hit-high', {hpFrac: 0.6, recentlyHit: true}, null],
    ['hit-old', {hpFrac: 0.54, recentlyHit: false}, null],
    ['sustain', {hpFrac: 0.34, recentlyHit: true}, null],
    ['sustain-no-hit', {hpFrac: 0.34, recentlyHit: false}, null],
  ] as const) add(label, id, 1, sit({me: me(meFields), threat: threatView}));
}
for (const id of ABILITY_IDS) {
  for (const [label, foeView] of [
    ['engage-inside', foe({d: 100})],
    ['engage-margin-pass', foe({d: 440})],
    ['engage-margin-fail', foe({d: 445})],
    ['engage-no-los', foe({d: 100, los: false})],
    ['engage-mob', foe({d: 100})],
    ['engage-untargetable', foe({d: 100, targetable: false})],
    ['blink-close', foe({d: 150})],
    ['blink-too-close', foe({d: 100})],
    ['blink-far-pass', foe({d: 250})],
    ['blink-far-fail', foe({d: 290})],
  ] as const) {
    const f: any = {...foeView};
    if (label === 'engage-mob') f.mob = true;
    add(label, id, 1, sit({foe: f}));
  }
}
for (const id of ABILITY_IDS) {
  for (const [label, t] of [
    ['peel', threat({d: 100})],
    ['peel-edge', threat({d: PEEL_DISTANCE})],
    ['peel-far', threat({d: PEEL_DISTANCE + 10})],
    ['peel-still', threat({d: 100, chasing: false})],
    ['peel-untargetable', threat({d: 100, targetable: false})],
    ['peel-no-los', threat({d: 100, los: false})],
    ['peel-no-id', threat({d: 100, id: undefined})],
  ] as const) add(label, id, 1, sit({threat: t}));
}
for (const id of ['freeze', 'trial', 'swarm', 'blaze', 'lastStand'] as const) {
  add('order-engage-vs-peel', id, 1, sit({me: me({hpFrac: 0.8}), foe: foe({d: 100}), threat: threat({d: 100})}));
  add('order-escape-vs-engage', id, 1, sit({me: me({hpFrac: 0.49}), foe: foe({d: 100}), threat: threat({d: 200})}));
}
for (const rank of [0, 2, 99, -1, NaN]) {
  for (const id of ['freeze', 'lastStand'] as const) add('rank-clamp-' + String(rank), id, rank, sit({foe: foe({d: 100}), me: me({hpFrac: 0.34, recentlyHit: true})}));
}
const wallSide: any[] = [];
for (let y = 2; y < map.h - 2 && wallSide.length < 4; y++) {
  for (let x = 2; x < map.w - 2 && wallSide.length < 4; x++) {
    if ((map.tiles[y * map.w + x] & 1) !== 0) continue;
    if ((map.tiles[y * map.w + x + 1] & 1) === 0) continue;
    wallSide.push({x: x * TILE + TILE / 2, y: y * TILE + TILE / 2});
  }
}
for (const [i, at] of wallSide.entries()) {
  add('blaze-escape-wall-' + i, 'blaze', 1, sit({me: me({x: at.x, y: at.y, hpFrac: 0.45}), threat: threat({x: at.x + 60, y: at.y, d: 60})}));
  add('blaze-engage-wall-' + i, 'blaze', 1, sit({me: me({x: at.x, y: at.y}), foe: foe({x: at.x + 200, y: at.y, d: 200})}));
}

// ------------------------------------------------------------------------------------------------- the provenance
const SOURCE_FILES = [
  'packages/shared/src/abilities.ts', 'packages/shared/src/blink.ts', 'packages/shared/src/status.ts',
  'packages/shared/src/constants.ts', 'packages/shared/src/map.ts', 'packages/shared/src/geometry.ts',
  'packages/server/src/bots/abilityPolicy.ts', 'packages/server/src/bots/brain/modules/wishes.ts',
];
const sha = (p: string) => createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex');
const dirs = ['packages/shared/src', 'packages/server/src/sim', 'packages/server/src/bots'];
const dirHash = (dir: string) => {
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join('/repo', rel), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const relPath = rel + '/' + entry.name;
      if (entry.isDirectory()) walk(relPath);
      else if (entry.name.endsWith('.ts')) files.push(relPath);
    }
  };
  walk(dir);
  return files.map((f) => f + ' ' + sha(f)).join('\n');
};
const dirListing = dirs.map((d) => d + '\n' + dirHash(d)).join('\n\n');

const corpus: any = {
  format: 'rh-wish-source/1',
  profile: {
    node: process.version, platform: process.platform, arch: process.arch,
    map: {w: map.w, h: map.h, seed: mapInput.seed ?? 0, tiles: Array.from(map.tiles)},
    tickMs: 50,
    constants: {
      escapeThreatDistance: ESCAPE_THREAT_DISTANCE, escapeHpThreatened: ESCAPE_HP_THREATENED,
      escapeHpHit: ESCAPE_HP_HIT, sustainHp: SUSTAIN_HP, engageRangeMargin: ENGAGE_RANGE_MARGIN,
      peelDistance: PEEL_DISTANCE,
    },
    sourceFiles: Object.fromEntries(SOURCE_FILES.map((p) => [p, sha(p)])),
    sourceTree: createHash('sha256').update(dirListing).digest('hex'),
    tool: sha('tools/wish-fixtures/capture.mts'),
  },
  defs,
  hides,
  rules: {
    retryMs: WISH_RULES.retryMs, recentHitMs: WISH_RULES.recentHitMs, chaseClosing: WISH_RULES.chaseClosing,
    chaseCos: WISH_RULES.chaseCos, onItDistance: WISH_RULES.onItDistance, easyRemembers: WISH_RULES.easyRemembers,
    slipPendingMs: WISH_RULES.slipPendingMs, slipGraceMs: WISH_RULES.slipGraceMs, slipUtility: WISH_RULES.slipUtility,
    slipStepU: WISH_RULES.slipStepU, slipKeepMs: WISH_RULES.slipKeepMs, slipArrivedU: WISH_RULES.slipArrivedU,
  },
  cases,
};
corpus.profile.captureSha256 = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const out = JSON.stringify(corpus, null, 1) + '\n';
if (args[0] === '--write') {
  writeFileSync(outPath, out);
  console.log('captured ' + cases.length + ' wish-policy cases');
} else {
  const existing = readFileSync(outPath, 'utf8');
  assert.equal(existing, out, 'the checked-in wish corpus differs from the source capture');
  console.log('wish corpus matches the source capture: ' + outPath);
}
