// Canonical actual-source K1 quest data witness, captured in the pinned linux/amd64 Node 22.23.4 container.
// Records, from unmodified source: the twenty catalog rows and their reward rules, the roster selection for declared
// quest salts, the map placement of givers/tokens/parcels (known and hidden passes) on real generated maps, the refusal
// and accept wording, and the candidate-count/digest facts. Every expected value is source-written.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {
  QUEST_DEFS, QUEST_REFUSAL, npcCandidates, parityGv, placeQuests, questAcceptFirstText, questAcceptedText,
  questBase, questHomeComponent, questRewardCard, questRewardCopies, questRewardStats, questRewardText, questTier,
  questTierPoints, selectQuests,
} from '/repo/packages/shared/src/quests.ts';
import {generateMap} from '/repo/packages/shared/src/mapgen.ts';
import {mapHashU32} from '/repo/packages/shared/src/mapWire.ts';
import {createWorld, rewardStream} from '/repo/packages/server/src/sim/world.ts';

const args = process.argv.slice(2);
assert(args.length === 2 && (args[0] === '--write' || args[0] === '--check') && typeof args[1] === 'string', 'closed capture arguments');
const [, outPath] = args;
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');

// Real certified generated maps (the bots'/server's own generation path: decor skipped). The corpus pins each map's
// seed, attempt and mapHashU32, so the native test regenerates and checks the same map before comparing placement.
const MAP_SEEDS = [1, 2];
const SALTS: Record<string, number[]> = {
  alpha: [5, 6, 7, 8],
  beta: [1, 2, 3, 4],
  gamma: [0xdeadbeef, 0x12345678, 0x9abcdef0, 0x0fedcba9],
};
const FEEDS = [0, 6];

function mapSetup(seed: number): any {
  const map: any = generateMap(seed, undefined, {decor: false});
  let uid = 0;
  const world: any = createWorld({
    seed,
    map,
    config: {quests: true, mobs: false, training: false, dummies: false, signatures: false},
    random: mulberry32(12),
    rewardSalt: [1, 2, 3, 4],
    questSalt: [5, 6, 7, 8],
    newItemUid: () => 'U' + ++uid,
  });
  return {
    world,
    mapMeta: {
      seed: map.seed,
      attempt: map.attempt,
      mapHashU32: mapHashU32(map),
      width: map.w,
      height: map.h,
    },
  };
}

function catalogCase(): any {
  return QUEST_DEFS.map((def: any) => ({
    id: def.id,
    kind: def.kind,
    name: def.name,
    giver: def.giver,
    text: def.text,
    count: def.count,
    region: def.region ?? null,
    farZone: def.farZone,
    elite: def.elite ?? false,
    players: def.players ?? false,
    tour: def.tour ?? 0,
    tokens: def.tokens ?? null,
    tokenSpawns: def.tokenSpawns ?? 0,
    objSec: def.objSec,
    travelSec: def.travelSec,
    rewardCard: def.reward.card,
    rewardCopies: def.reward.copies,
    rewardGv: def.reward.gv,
    expiresAtSec: def.expiresAtSec,
    tierPoints: questTierPoints(def.objSec, def.travelSec),
    parityGv: parityGv(def.objSec, def.travelSec),
    tier: questTier(def),
    base: questBase(def),
    cardByFeed: FEEDS.map((feed) => questRewardCard(def, feed)),
    copies: questRewardCopies(def),
    stat: (() => { const s = questRewardStats(def); return {id: s.id, stacks: s.stacks}; })(),
    rewardText: questRewardText(def),
  }));
}

function rosterCase(salt: number[]): any {
  const rng = rewardStream(salt);
  return selectQuests(rng).map((entry: any) => ({def: entry.def.id, known: entry.known}));
}

function placementCase(seed: number, salt: number[]): any {
  const {world, mapMeta} = mapSetup(seed);
  const rng = rewardStream(salt);
  const roster = selectQuests(rng);
  const placements = placeQuests(world.map, roster, rng);
  const candidates = npcCandidates(world.map);
  let fold = 0n;
  for (const c of candidates) {
    fold = (fold * 1099511628211n + BigInt(Math.round(c.x)) * 1000003n + BigInt(Math.round(c.y))) & 0xffffffffffffffffn;
  }
  return {
    map: mapMeta,
    home: questHomeComponent(world.map),
    candidates: candidates.length,
    candidateFold: fold.toString(16),
    roster: roster.map((entry: any) => ({def: entry.def.id, known: entry.known})),
    placements: placements.map((p: any) => ({
      def: p.def.id,
      known: p.known,
      at: {x: p.at.x, y: p.at.y},
      tokens: (p.tokens ?? []).map((t: any) => ({x: t.x, y: t.y})),
      parcel: p.parcel ? {x: p.parcel.x, y: p.parcel.y} : null,
    })),
  };
}

function phrasesCase(): any {
  return {
    refusal: QUEST_REFUSAL,
    accepted: QUEST_DEFS.map((def: any) => questAcceptedText(def)),
    acceptFirst: QUEST_DEFS.map((def: any) => questAcceptFirstText(def)),
  };
}

function allCases(): any {
  return {
    catalog: catalogCase(),
    rosters: Object.fromEntries(Object.entries(SALTS).map(([name, salt]) => [name, rosterCase(salt)])),
    placements: Object.fromEntries(
      MAP_SEEDS.flatMap((seed) =>
        Object.entries(SALTS).map(([saltName, salt]) => ['seed' + seed + '/' + saltName, placementCase(seed, salt)]),
      ),
    ),
    phrases: phrasesCase(),
  };
}

const cases: any = allCases();
assert.deepEqual(cases, allCases(), 'the source data cases must repeat exactly');

const sourceFiles = ['packages/shared/src', 'packages/server/src/sim'].flatMap((dir) =>
  readdirSync('/repo/' + dir, {recursive: true}).filter((p: string) => p.endsWith('.ts')).map((p: string) => dir + '/' + p),
);
const sourceSha256 = Object.fromEntries(sourceFiles.map((p: string) => [p, createHash('sha256').update(readFileSync('/repo/' + p)).digest('hex')]));
const body = {
  format: 'rh-quest-data-source/1',
  provenance: {
    image: 'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
    platform: 'linux/amd64',
    node: process.version,
    sourceSha256,
    mapSeeds: MAP_SEEDS,
    feeds: FEEDS,
  },
  cases,
};
const text = JSON.stringify(body, null, 1) + '\n';
const sha = createHash('sha256').update(text).digest('hex');
if (args[0] === '--write') {
  writeFileSync(outPath, text);
  console.log(JSON.stringify({written: outPath, bytes: text.length, sha256: sha, placements: Object.keys(cases.placements).length}));
} else {
  const existing = readFileSync(outPath, 'utf8');
  assert.equal(createHash('sha256').update(existing).digest('hex'), sha, 'the checked-in corpus is byte-identical');
  console.log(JSON.stringify({checked: outPath, bytes: existing.length, sha256: sha, placements: Object.keys(cases.placements).length}));
}
