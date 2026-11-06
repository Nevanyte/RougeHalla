import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as C from '../../packages/shared/src/cards.ts';
import * as R from '../../packages/shared/src/rewards.ts';
import { EFFECT_KINDS } from '../../packages/shared/src/effects.ts';
import { CHEST_TIER_ODDS } from '../../packages/shared/src/constants.ts';

const diagnostic = process.argv.includes('--diagnostic');
assert(process.argv.slice(2).every(x => ['--check', '--diagnostic'].includes(x)));
assert(!(diagnostic && process.argv.includes('--check')));
if (!diagnostic) { assert.equal(process.version, 'v22.23.4'); assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64'); }
Math.random = () => { throw Error('undeclared Math.random'); };
const sha = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
const plain = (v: any): any => typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0))
  ? { $number: Object.is(v, -0) ? '-0' : String(v) } : v === undefined ? { $undefined: true }
  : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k,x]) => [k,plain(x)])) : v;
function files(dir: string): string[] { return readdirSync(dir, {withFileTypes:true}).flatMap(d => d.isDirectory() ? files(dir+'/'+d.name) : [dir+'/'+d.name]).sort(); }
const sourcePaths = [...files('packages/shared/src'), 'packages/shared/test/cards.test.ts', 'package.json', 'package-lock.json'];
// Frozen existing tracked inventory: unrelated proposals may add files concurrently.
const protectedPaths: string[] = JSON.parse(readFileSync('tools/card-catalog-fixtures/protected-inputs.json','utf8'));
assert.equal(new Set(protectedPaths).size,protectedPaths.length);
assert(protectedPaths.every(p=>(p.startsWith('tools/')||p.startsWith('parity/'))&&!p.includes('card-catalog')));
const hashes = (paths: string[]) => Object.fromEntries(paths.map(p => [p,sha(readFileSync(p))]));
const originalSources = hashes(sourcePaths), originalProtected = hashes(protectedPaths);
const cases: any[] = [];
function add(id: string, family: string, input: any, run: () => any) {
  const before = JSON.stringify(plain(input));
  const expected = run();
  assert.equal(JSON.stringify(plain(input)), before, 'input mutated '+id);
  cases.push({id, family, input: plain(input), expected: plain(expected)});
}
const factions = ['fire','sentenced','plague','frost','holy'] as const;
const ids = (defs: readonly C.CardDef[]) => defs.map(c => c.id);
const interactive = ids(C.CARDS.filter(c => C.isInteractiveAugment(c)));
assert.equal(C.CARDS.length,80); assert.equal(interactive.length,14);
const kinds = new Set(C.CARDS.flatMap(c => [...c.effects,...Object.values(c.byFaction??{}).flat()].map(e => e.k)));
assert.deepEqual([...kinds].sort(), [...EFFECT_KINDS].sort());
for (const card of C.CARDS) {
  add('catalog/'+card.id, 'catalog', {id:card.id, factions:[undefined,...factions,'unknown-faction']}, () => ({
    definition:C.cardDef(card.id), valid:C.isCardId(card.id), live:C.cardLive(card.id), interactive:C.isInteractiveAugment(card.id),
    tier:C.cardTierOf(card.id), title:C.cardTitle(card.id),
    selections:[undefined,...factions,'unknown-faction'].map(faction => ({faction, rows:C.cardRows(card.id,faction), text:C.cardText(card.id,faction)})),
  }));
  const prerequisite = card.requires ? {[C.baseCardId(card.requires,2)]:1} : {};
  const builds = [{}, {[card.id]:2}, prerequisite, {...prerequisite,[card.id]:1}];
  add('eligibility/'+card.id, 'eligibility', {id:card.id,builds,viewFaction:'plague'}, () => builds.map(build => ({
    count:C.countIn(build,card.id), block:C.cardBlock(card.id,build), why:C.whyOffered(card.id,build),
    view:R.cardOptionView(card.id,build,'plague'), power:C.cardPower(build), owned:C.ownedCards(build),
  })));
}
type BuildSpec = {representation:string, entries?:[string,any][]};
const decode = (s: BuildSpec): any => {
  const es = s.entries??[];
  if(s.representation==='null') return null;
  if(s.representation==='undefined') return undefined;
  if(s.representation==='map') return new Map(es);
  if(s.representation==='getOnly') { const m=new Map(es); return {get:(id:string)=>m.get(id)}; }
  if(s.representation==='forEachOnly') return {forEach:(f:any)=>es.forEach(([k,v])=>f(v,k))};
  assert.equal(s.representation,'record'); return Object.fromEntries(es);
};
const entries:[string,any][] = [['ad2',2.75],['haste1',1],['gambler',2],['future-card',3.5]];
const specs:BuildSpec[] = ['record','map','getOnly','forEachOnly','null','undefined'].map(representation=>({representation,entries}));
for (const value of [-Infinity,-1,-0,0,0.5,1.75,Infinity,NaN,'2',null,undefined])
  for(const representation of ['record','map']) specs.push({representation,entries:[['ad1',value],['future-card',value]]});
for(const [i,s] of specs.entries()) add('counts/'+i,'count-boundary',s,()=>{
  const b=decode(s); return {counts:['ad1','ad2','gambler','future-card'].map(id=>({id,count:C.countIn(b,id)})),
    power:C.cardPower(b), owned:C.ownedCards(b), bases:C.BASE_STAT_IDS.map(base=>({base,count:C.baseCount(b,base),owns:C.ownsBase(b,base)}))};
});
for (const id of ['unknown-card','', 'boost:ad','kill:unknown','__proto__','constructor']) add('unknown/'+id,'unknown', {id}, ()=>({
  valid:C.isCardId(id), def:C.cardDef(id), live:C.cardLive(id), interactive:C.isInteractiveAugment(id), rows:C.cardRows(id),
  tier:C.cardTierOf(id), title:C.cardTitle(id), text:C.cardText(id), block:C.cardBlock(id,{}), why:C.whyOffered(id,{}), view:R.cardOptionView(id,{}),
}));
add('membership','membership', {kinds:['base','conditional','augment'],readyOnly:[false,true]},()=>({
  ids:C.CARD_IDS, liveReady:C.LIVE_CARD_READY, interactive,
  kinds:['base','conditional','augment'].map(kind=>({kind,all:ids(C.cardsOfKind(kind as C.CardKind)),live:ids(C.cardsOfKind(kind as C.CardKind,{liveOnly:true}))})),
  themes:R.ZONE_AUGMENT_THEMES, odds:CHEST_TIER_ODDS,
}));
const owned = (keep:string[]=[]) => Object.fromEntries(interactive.filter(id=>!keep.includes(id)).map(id=>[id,1]));
const pools:any[] = [[],[{}],[owned()],[owned(),{}],[{ad1:1}],[{ad1:1},{ad1:1, juggernaut:1}], [{ad1:1,juggernaut:1},{juggernaut:1}]];
for(const base of C.BASE_STAT_IDS) pools.push([{[C.baseCardId(base,3)]:1}]);
for(const id of interactive) pools.push([{[id]:1}]);
for(const [i,pickers] of pools.entries()) for(const readyOnly of (i===0?[false,true]:[true])) add('pool/'+i+'/'+readyOnly,'pool',{pickers,readyOnly},()=>({
  conditional:ids(R.conditionalPool(pickers,readyOnly)),augment:ids(R.rewardAugmentPool(pickers,readyOnly)),
}));
function roll(id:string, opts:R.ChestRollOptions, tape:number[]) {
  assert(tape.every(n=>Number.isFinite(n)&&n>=0&&n<1));
  add('roll/'+id,'roll',{opts,tape},()=>{
    let cursor=0; const draws:{cursor:number,value:number}[]=[];
    const result=R.rollChestOptions(()=>{assert(cursor<tape.length,'tape exhausted '+id); const value=tape[cursor];draws.push({cursor,value});cursor++;return value;},opts);
    assert.equal(new Set(result).size,result.length); assert(result.length<=3);
    assert(result.every(id=>R.rewardAugmentPool(opts.pickers??[],opts.readyOnly!==false).some(c=>c.id===id)));
    return {options:result,draws,cursor,unusedContinuation:tape.slice(cursor)};
  });
}
for(const elite of [false,true]) for(const zone of [undefined,...factions]) {
  const thresholds=elite?[0,0.1-Number.EPSILON,0.1,0.1+Number.EPSILON,0.7-Number.EPSILON,0.7,0.7+Number.EPSILON,1-Number.EPSILON]
    :[0,0.5-Number.EPSILON,0.5,0.5+Number.EPSILON,0.95-Number.EPSILON,0.95,0.95+Number.EPSILON,1-Number.EPSILON];
  for(const [i,t] of thresholds.entries()) roll(`${elite}/${zone}/threshold-${i}`,{elite,zone},[t,0,t,0.5,t,1-Number.EPSILON,0.314159,0.271828]);
  const theme=zone?R.ZONE_AUGMENT_THEMES[zone]:[];
  const scenarios = [
    {name:'empty-picker',pickers:[{}]}, {name:'mixed-owners',pickers:[owned(),{}]},
    {name:'all-owned',pickers:[owned()]}, {name:'theme-exhausted',pickers:[Object.fromEntries(theme.map(id=>[id,1]))]},
    {name:'one-left',pickers:[owned(['gambler'])]}, {name:'two-left',pickers:[owned(['gambler','siphon'])]},
    {name:'lower-tie-tier2',pickers:[owned(['gambler','slowBurn'])]},
  ];
  for(const s of scenarios) roll(`${elite}/${zone}/${s.name}`,{elite,zone,pickers:s.pickers},[0.5,0.75,0.5,0.25,0.5,0.9,0.12345,0.6789]);
}
// Include high pick index endpoints, readyOnly false, and genuine Map picker representations.
roll('catalog-ready-false',{readyOnly:false},[0.999,0.999,0,0.999,0.5,0.999,0.42]);
for(const [i,representation] of ['map','getOnly','forEachOnly'].entries()) {
  const spec={representation,entries:interactive.map(id=>[id,1])} as BuildSpec;
  add('pool-representation/'+i,'pool-representation',spec,()=>({conditional:ids(R.conditionalPool([decode(spec)])),augment:ids(R.rewardAugmentPool([decode(spec)]))}));
}
assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);
const rolls=cases.filter(c=>c.family==='roll');
assert.deepEqual([...new Set(rolls.flatMap(c=>c.expected.options))].sort(), [...interactive].sort());
for(const c of rolls) {
  assert.equal(c.expected.cursor,c.expected.options.length*2);
  assert.deepEqual(c.expected.draws.map((d:any)=>d.value), c.input.tape.slice(0,c.expected.cursor));
  assert.deepEqual(c.expected.unusedContinuation,c.input.tape.slice(c.expected.cursor));
}
assert.equal(cases.length,409);
assert.deepEqual(hashes(sourcePaths),originalSources); assert.deepEqual(hashes(protectedPaths),originalProtected);
const harnessPaths=files('tools/card-catalog-fixtures').filter(p=>!p.endsWith('manifest.json'));
const out={format:'rh-card-catalog-source/1',baseRevision:'3619339a1c03469be837aa9b42a280d7940044d0',
  environment:{node:'v22.23.4',os:'linux',arch:'x64',image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292'},
  sourceSha256:originalSources,harnessSha256:hashes(harnessPaths),protectedSha256:originalProtected,
  inventory:{total:cases.length,families:Object.fromEntries([...new Set(cases.map(c=>c.family))].map(f=>[f,cases.filter(c=>c.family===f).length])),caseIds:cases.map(c=>c.id)},cases};
const bytes=JSON.stringify(out,null,2)+'\n';
const output=process.env.RH_CARD_CATALOG_OUTPUT??'parity/card-catalog/source.json';
if(diagnostic) assert(output!=='parity/card-catalog/source.json');
if(process.argv.includes('--check')) assert.equal(readFileSync(output,'utf8'),bytes,'canonical bytes differ'); else writeFileSync(output,bytes);
console.log(JSON.stringify({mode:diagnostic?'diagnostic':process.argv.includes('--check')?'check':'capture',cases:cases.length,families:out.inventory.families,sha256:sha(bytes)}));
