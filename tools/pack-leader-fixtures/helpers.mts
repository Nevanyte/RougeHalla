/** Pack Leader pure source helper probes: declared-helper contexts, NEVER earned World parity. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
Math.random = () => { throw Error('undeclared randomness'); };
import * as S from '@raid/shared';
import { createWorld } from '../../packages/server/src/sim/world.ts';
import { addPlayer } from '../../packages/server/src/sim/step.ts';
import { grantCard } from '../../packages/server/src/sim/chests.ts';
import { combatant } from '../../packages/server/src/sim/combatant.ts';
import { recomputeMods, outgoingMult, outgoingExecuteShare } from '../../packages/server/src/sim/mods.ts';
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
function world(seed: number) {
  const w: any = createWorld({
    map: S.mapFromTiles(8, 8, new Uint8Array(64)),
    config: { minPlayers: 1, lobbySeconds: 30, fillSeconds: 0, planSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60, hazards: false, wishLockSeconds: 0 },
    random: S.mulberry32(seed), rewardSalt: [1, 2, 3, 4], questSalt: [5, 6, 7, 8], newItemUid: () => 'U1',
  });
  addPlayer(w, 'p0', 'helper', { faction: 'fire', bot: false });
  return w;
}
function context(seed: number, cards: string[]) {
  const w = world(seed);
  const c: any = combatant(w, 'p0');
  for (const id of cards) assert.notEqual(grantCard(w, c, id as any), null, 'declared helper card ' + id);
  recomputeMods(w, c);
  return { w, c };
}
function declaredCount(ctx: any, n: number) {
  // Declared helper count: written to the source runtime field, then refreshed through the ACTUAL production path.
  ctx.c.rt.campsCleared = n;
  recomputeMods(ctx.w, ctx.c);
  return {
    count: n,
    other: outgoingMult(ctx.c.s, 1, undefined, 'other', 1),
    hit: outgoingMult(ctx.c.s, 1, undefined, 'hit', 1),
    hitBaked3: outgoingMult(ctx.c.s, 1, undefined, 'hit', 3),
  };
}
const ctx = context(12, ['packLeader']);
const probes = [0, 1, 7, 8, 9, 20].map((n) => ({ id: 'declared-helper-count-' + n, kind: 'pure-helper-declared-count', ...declaredCount(ctx, n) }));
// Execution share: a declared helper context with Pack Leader + Coup de Grace (vs hpBelow); not a World witness.
const exCtx = context(13, ['packLeader', 'coupDeGrace']);
exCtx.c.rt.campsCleared = 1;
recomputeMods(exCtx.w, exCtx.c);
const executeShare = outgoingExecuteShare(exCtx.c.s, 0.2, undefined, 'hit', 1);
const executeCount0 = (() => { const c0 = context(14, ['packLeader', 'coupDeGrace']); c0.c.rt.campsCleared = 0; recomputeMods(c0.w, c0.c); return outgoingExecuteShare(c0.c.s, 0.2, undefined, 'hit', 1); })();
probes.push({ id: 'declared-helper-execute-share-count-1', kind: 'pure-helper-declared-count', count: 1, executeShare, executeShareCount0: executeCount0 });
// Cache refresh timing: same declared context, before/after the ACTUAL refresh path.
const timing = context(15, ['packLeader']);
const before = outgoingMult(timing.c.s, 1, undefined, 'other', 1);
timing.c.rt.campsCleared = 1;
const stale = outgoingMult(timing.c.s, 1, undefined, 'other', 1);
recomputeMods(timing.w, timing.c);
const refreshed = outgoingMult(timing.c.s, 1, undefined, 'other', 1);
probes.push({ id: 'declared-helper-cache-refresh-timing', kind: 'pure-helper-declared-count', count: 1, before, stale, refreshed });
assert.ok(probes.length <= 8, 'helper probe budget');
assert.equal(stale, before, 'unrefreshed cache keeps its pass-stable value');
assert.ok(refreshed > stale, 'actual refresh path applies the declared count');
const out = {
  format: 'rh-pack-leader-helpers/1',
  labels: 'declared-helper-count contexts only: NOT earned clear parity, NOT contributor selection, NOT World timing',
  base: process.env.RH_PACK_LEADER_BASE ?? null,
  tool: { helpers: sha(readFileSync(new URL(import.meta.url))) },
  outgoingRowCap: S.OUTGOING_ROW_CAP,
  source: Object.fromEntries(['packages/shared/src/cards.ts', 'packages/server/src/sim/mods.ts'].map((p) => [p, sha(readFileSync(p))])),
  probes,
};
mkdirSync('/out', { recursive: true });
writeFileSync(process.env.RH_PACK_LEADER_HELPERS ?? '/out/helpers.json', JSON.stringify(out, null, 1) + '\n');
console.log('pack-leader helpers wrote ' + (process.env.RH_PACK_LEADER_HELPERS ?? '/out/helpers.json'));
