// Semantic controls alter only a unique disposable container source copy. Canonical source/corpus remain read-only.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {decode} from './verify.mjs';
const [mode, out = '/out'] = process.argv.slice(2); assert(['--write', '--check'].includes(mode));
const read = (p) => readFileSync(p, 'utf8'); const hash = (v) => createHash('sha256').update(v).digest('hex');
const canonicalBytes = read(join(out, 'source.json')); const canonical = JSON.parse(canonicalBytes);
const brain = 'packages/server/src/bots/brain/'; const hunterPath = 'packages/server/src/bots/mobHunt.ts';
const rows = (c, method = 'decide') => c.operations.filter((o) => o.method === method);
const v = (o, key) => decode(o[key], true);
const state = (c, i) => v(rows(c)[i], 'state');
const defs = [
  {id: 'dedup-equal-strict', file: brain+'strategy.ts', needle: 'if (!old || c.utility > old.utility)', replace: 'if (!old || c.utility >= old.utility)',
    case: 'strategy-dedup-equal-and-higher-retains-slot', select: c => state(c, 0).candidates.find(d=>d.goal.kind==='module').why},
  {id: 'hysteresis-margin', file: brain+'strategy.ts', needle: 'export const HYSTERESIS = 0.1;', replace: 'export const HYSTERESIS = 0;',
    case: 'strategy-modules-dedup-tie-hysteresis-status', select: c => v(rows(c)[1], 'result').goal.data.n},
  {id: 'exclusion-expiry-inclusive', file: brain+'strategy.ts', needle: 'for (const [k, until] of this.excluded) if (until <= now)', replace: 'for (const [k, until] of this.excluded) if (until < now)',
    case: 'strategy-modules-dedup-tie-hysteresis-status', select: c => v(rows(c)[5], 'own').excluded.has('module:declared:{"n":2}')},
  {id: 'pursuit-progress-strict', file: brain+'strategy.ts', needle: 'e.dist < c.best - ORBIT_PROGRESS', replace: 'e.dist <= c.best - ORBIT_PROGRESS',
    case: 'strategy-pursuit-progress-timeout-hit-release', select: c => state(c, 1).chase.since},
  {id: 'pursuit-hit-release', file: brain+'strategy.ts', needle: 'if (hit || close) this.avoidId = null;', replace: 'if (close) this.avoidId = null;',
    case: 'strategy-pursuit-progress-timeout-hit-release', select: c => state(c, 4).avoidId},
  {id: 'loot-budget-strict', file: brain+'strategy.ts', needle: 'now - this.goalSince > LOOT_BUDGET_MS', replace: 'now - this.goalSince >= LOOT_BUDGET_MS',
    case: 'strategy-loot-skip-budget-expiry-and-counters', select: c => v(rows(c)[5], 'own').lootSkip.has('bow')},
  {id: 'appraisal-cache-expiry', file: brain+'strategy.ts', needle: 'j.until <= p.now', replace: 'j.until < p.now',
    case: 'strategy-appraisal-third-party-aged-memory', select: c => rows(c)[2].drawCounts.decide},
  {id: 'module-callback-order', file: brain+'strategy.ts', needle: 'for (const m of cfg.modules)', replace: 'for (const m of [...cfg.modules].reverse())',
    case: 'strategy-modules-dedup-tie-hysteresis-status', select: c => v(rows(c)[0], 'callbacks').filter(e=>e.kind==='callback'&&e.name.startsWith('module.')).map(e=>e.name)},
  {id: 'adapter-catchup-cap', file: brain+'huntAdapter.ts', needle: 'const CATCHUP_MAX_PIECES = 14;', replace: 'const CATCHUP_MAX_PIECES = 1;',
    case: 'adapter-catchup-5000', select: c => v(rows(c, 'adapterDecide')[1], 'stats').drops},
  {id: 'adapter-release-real-near-player', file: brain+'huntAdapter.ts', needle: 'hunter.decide({ ...input(ctx), playerDistance: 0 });', replace: 'hunter.decide({ ...input(ctx), playerDistance: Infinity });',
    case: 'strategy-learned-opener-choice-and-hunt-release', select: c => v(rows(c)[2], 'huntTarget')},
  {id: 'adapter-seed-source-home', file: brain+'huntAdapter.ts', needle: 'if (any) hunter.tracker.observe(fresh, inp.now);', replace: 'if (false && any) hunter.tracker.observe(fresh, inp.now);',
    case: 'adapter-walks-and-source-home-hard', select: c => v(rows(c,'adapterDecide')[0], 'own').hunter.tracker.rec.get('m').home.x},
  {id: 'tracker-rise-strict', file: hunterPath, needle: 'm.hp > r.hp + RISE_EPS', replace: 'm.hp >= r.hp + RISE_EPS',
    case: 'tracker-home-rise-expiry-removal', select: c => v(rows(c, 'trackerQuery')[2], 'result').returning},
  {id: 'hunter-ban-expiry', file: hunterPath, needle: 'if (now >= until)', replace: 'if (now > until)',
    case: 'hunter-rising-drop-ban-expiry', select: c => v(rows(c,'isBanned')[1], 'result')},
  {id: 'route-contest-inclusive', file: brain+'buildRoute.ts', needle: 'dist(p, c) <= CONTEST_PLAYER_RANGE', replace: 'dist(p, c) < CONTEST_PLAYER_RANGE',
    case: 'route-contest-player320-boundary', select: c => v(rows(c,'routeUpdate')[1], 'own').stats.contests},
  {id: 'route-lower-index-tie', file: brain+'buildRoute.ts', needle: 'c.index < best.c.index', replace: 'c.index > best.c.index',
    case: 'route-exact-tie-true', select: c => v(rows(c,'routePlan')[0], 'own').route[0].camp},
  {id: 'route-replan-inclusive', file: brain+'buildRoute.ts', needle: 'inp.now - this.plannedAt >= REPLAN_MS', replace: 'inp.now - this.plannedAt > REPLAN_MS',
    case: 'route-stolen-unplanned-sticky-broken-replan', select: c => v(rows(c,'routeUpdate')[3], 'own').stats.plans},
  {id: 'memory-walked8-strict', file: brain+'memory.ts', needle: 'dist(me, order.from) > WALKED_U', replace: 'dist(me, order.from) >= WALKED_U',
    case: 'memory-orders-reflection-arrival-and-failure', select: c => v(c.operations.find(o=>o.method==='observe'&&decode(o.input).now===301000), 'result').some(s=>s.kind==='orderFailed')},
  {id: 'memory-purpose-drop', file: brain+'memory.ts', needle: 'if (d.intentional) { dropped = null; return; }', replace: 'if (false && d.intentional) { dropped = null; return; }',
    case: 'memory-active-lock-purpose-drop-and-contrast', select: c => v(rows(c,'observe')[1], 'result').some(s=>s.kind==='lockLost')},
  {id: 'third-party-dead-partner', file: brain+'strategy.ts', needle: 'if (ctx.mem.fighters.get(m.engagedWith)?.alive === false) return 0;', replace: 'if (false && ctx.mem.fighters.get(m.engagedWith)?.alive === false) return 0;',
    case: 'strategy-appraisal-third-party-aged-memory', select: c => state(c, 5).candidates.some(d=>d.why.includes('third party'))},
];
const temp = mkdtempSync('/tmp/rh-private-strategy-controls-'); const receipts = [];
try {
  const copy = join(temp, 'source');
  cpSync('/repo', copy, {recursive: true, filter: p => !p.split('/').some(part => ['node_modules','.git','target','client-unity','docs','crates','protocol','parity','dist','build'].includes(part))});
  symlinkSync('/repo/node_modules', join(copy,'node_modules'), 'dir');
  const originals = new Map([...new Set(defs.map(d=>d.file))].map(p=>[p,read('/repo/'+p)]));
  const run = (id, selected, root = copy) => {
    const dest = join(temp,id);
    // capture.mts owns its output directory; per-control output paths are newly created, never canonical.
    mkdirSync(dest);
    const child = spawnSync(process.execPath, ['--import','tsx','/capture/capture.mts','--write',dest],
      {cwd:root,env:{...process.env,RH_BOT_STRATEGY_SOURCE_ROOT:root,RH_BOT_STRATEGY_MUTANT:'1',RH_BOT_STRATEGY_CASES:selected.join(',')},encoding:'utf8',maxBuffer:4*1024*1024});
    assert.equal(child.status,0,id+': capture failure is not a semantic kill\n'+child.stdout+child.stderr);
    return JSON.parse(read(join(dest,'source.json')));
  };
  for (const def of defs) {
    const original = originals.get(def.file); assert.equal(original.split(def.needle).length,2,def.id+': one exact source needle');
    const changed = original.replace(def.needle,def.replace); writeFileSync(join(copy,def.file),changed);
    const got = run(def.id,[def.case]).cases[0]; const base = canonical.cases.find(c=>c.id===def.case); assert(base);
    const expected = def.select(base), observed = def.select(got);
    const killed = !Object.is(expected, observed) && JSON.stringify(expected)!==JSON.stringify(observed);
    assert(killed,def.id+': semantic control survived at its intended selector');
    const encodeReceipt = x => x === undefined ? {$:'undefined'} : x;
    receipts.push({id:def.id,result:'KILL',file:def.file,case:def.case,source:encodeReceipt(expected),mutant:encodeReceipt(observed),sourceSha256:hash(original),mutantSha256:hash(changed)});
    console.log(JSON.stringify({id:def.id,result:'KILL',case:def.case,source:expected,mutant:observed}));
    writeFileSync(join(copy,def.file),original); assert.equal(read(join(copy,def.file)),original);
  }
  const file=brain+'strategy.ts', original=originals.get(file);
  writeFileSync(join(copy,file),original+'\n// private-strategy provenance-only control\n');
  const sample = ['strategy-pursuit-progress-timeout-hit-release','adapter-catchup-5000','route-zone-hit-memory-and-avoid'];
  const comment = run('comment-only',sample); assert.deepEqual(comment.cases,canonical.cases.filter(c=>sample.includes(c.id)));
  receipts.push({id:'comment-only',result:'NONKILL',cases:sample}); writeFileSync(join(copy,file),original);
  const restored = run('restored',sample); assert.deepEqual(restored.cases,canonical.cases.filter(c=>sample.includes(c.id)));
  for(const [file,original]of originals)assert.equal(read('/repo/'+file),original);
  assert.equal(read(join(out,'source.json')),canonicalBytes);
  const receipt={format:'rh-bot-private-strategy-controls/1',source:{bytes:Buffer.byteLength(canonicalBytes),sha256:hash(canonicalBytes)},
    controls:receipts,restoredCases:'BYTE_IDENTICAL',immutableSource:'UNCHANGED',safety:'all mutations in unique disposable container source directory; /repo read-only; no canonical corpus writes'};
  const bytes=JSON.stringify(receipt,null,1)+'\n'; const path=join(out,'controls.json');
  if(mode==='--write')writeFileSync(path,bytes);else assert.equal(read(path),bytes,'control receipt byte-identical');
  console.log(JSON.stringify({semanticControls:defs.length,commentOnly:'NONKILL',restored:'PASS',bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}));
} finally { rmSync(temp,{recursive:true,force:true}); }
