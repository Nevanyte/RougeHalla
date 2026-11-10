import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCase} from '/repo/tools/bot-private-strategy-fixtures/runner.mts';
import {decode} from '/repo/tools/bot-private-strategy-fixtures/verify.mjs';
import {cases} from './cases.mts';
const [mode, output] = process.argv.slice(2); assert(process.argv.length === 4 && ['--write','--check'].includes(mode));
assert.equal(process.version,'v22.23.4'); assert.equal(process.platform,'linux'); assert.equal(process.arch,'x64');
const hash=(b: string|Buffer)=>createHash('sha256').update(b).digest('hex');
const pin=(p: string)=>({bytes:statSync(p).size,sha256:hash(readFileSync(p))});
const read=(p: string)=>readFileSync(p,'utf8');
const primaryManifestPath='/repo/docs/evidence/bot-private-strategy-source/FROZEN_MANIFEST.json';
const primaryManifest=JSON.parse(read(primaryManifestPath));
function primaryProof() {
  const pins: any={};
  for(const [relative,expected] of Object.entries(primaryManifest.files) as any) {
    const actual=pin('/repo/'+relative); assert.deepEqual(actual,expected,'immutable primary '+relative);pins[relative]=actual;
  }
  return pins;
}
const primaryBefore=primaryProof();
const selected=process.env.RH_MODULE_KEY_CASES?.split(',');
const specs=cases().filter(c=>!selected||selected.includes(c.id)); if(selected)assert.equal(specs.length,selected.length);
const outputs=specs.map(c=>{const first=runCase(c);assert.deepEqual(runCase(c),first,'source instance recreation '+c.id);return first;});
const decisions=(c: any)=>c.operations.filter((o: any)=>o.method==='decide');
const value=(o: any,k: string)=>decode(o[k],true);
const modules=(o: any)=>value(o,'state').candidates.filter((d: any)=>d.goal.kind==='module');
const assertions: any[]=[];
const check=(name: string,fn:()=>void)=>{fn();assertions.push({name,result:'PASS'});};
if(process.env.RH_MODULE_KEY_MUTANT!=='1'){
  const find=(id: string)=>outputs.find(c=>c.id===id);
  if(!selected||selected.includes('negative-zero-positive-zero-collision'))check('signed zero dedups, keeps source current and shares exclusion until exact expiry',()=>{
    const r=decisions(find('negative-zero-positive-zero-collision'));assert.equal(modules(r[0]).length,1);
    assert(Object.is(value(r[0],'result').goal.data.v,-0));assert.equal(r[1].identity.returnedCurrentGoal,true);
    assert(Object.is(value(r[1],'result').goal.data.v,-0));
    const actualKey=value(r[1],'own').currentKey;
    assert(value(r[2],'own').excluded.has(actualKey));assert.equal(value(r[2],'result').goal.data.v,'safe');
    assert.equal(value(r[3],'result').goal.data.v,'safe');assert.equal(value(r[4],'result').goal.data.v,0);
  });
  if(!selected||selected.includes('nonfinite-null-collision-and-current-reuse'))check('NaN and both infinities collide with null, preserve current NaN, and share exclusion',()=>{
    const r=decisions(find('nonfinite-null-collision-and-current-reuse'));assert.equal(modules(r[0]).length,1);
    assert(Number.isNaN(value(r[0],'result').goal.data.v));
    for(const row of r.slice(1,4)){assert.equal(row.identity.returnedCurrentGoal,true);assert(Number.isNaN(value(row,'result').goal.data.v));}
    const keys=r.slice(1,4).map((row:any)=>value(row,'own').currentKey);assert.equal(new Set(keys).size,1);
    assert.equal(value(r[4],'result').goal.data.v,'safe');assert.equal(value(r[5],'result').goal.data.v,null);
  });
  if(!selected||selected.includes('ecmascript-exponent-boundaries'))check('four boundary numbers retain four distinct source keys and Done exclusion expires exactly',()=>{
    const r=decisions(find('ecmascript-exponent-boundaries'));assert.equal(modules(r[0]).length,4);
    const keys=r.slice(1,5).map((row:any)=>value(row,'own').currentKey);assert.equal(new Set(keys).size,4);
    assert.equal(r[4].identity.returnedCurrentGoal,true);assert.equal(value(r[5],'result').goal.data.v,'safe');
    assert.equal(value(r[6],'result').goal.data.v,1e21);
  });
  if(!selected||selected.includes('undefined-object-array-distinction'))check('omitted object values and array nullification bind actual distinct/colliding source keys',()=>{
    const r=decisions(find('undefined-object-array-distinction'));assert.equal(modules(r[0]).length,5);
    assert.equal(r[1].identity.returnedCurrentGoal,true);assert(Object.hasOwn(value(r[1],'result').goal.data,'v'));
    assert.equal(value(r[1],'result').goal.data.v,undefined);
    assert.equal(value(r[2],'result').goal.data.v[0],null);assert.equal(r[3].identity.returnedCurrentGoal,true);
    assert.equal(r[5].identity.returnedCurrentGoal,true);assert(Object.hasOwn(value(r[5],'result').goal.data.v,'a'));
  });
}
const toolDir=dirname(fileURLToPath(import.meta.url));
const toolFiles=Object.fromEntries(readdirSync(toolDir).filter(p=>statSync(join(toolDir,p)).isFile()&&!p.endsWith('.log')).sort().map(p=>['tools/bot-module-goal-key-fixtures/'+p,pin(join(toolDir,p))]));
const primarySource=JSON.parse(read('/repo/parity/policy/bot-private-strategy/source.json'));
const sourceRoot=process.env.RH_BOT_STRATEGY_SOURCE_ROOT??'/repo';
const sourcePins=Object.fromEntries(Object.keys(primarySource.profile.sourceInventory.files).map(p=>[p,pin(join(sourceRoot,p))]));
const primaryAfter=primaryProof();assert.deepEqual(primaryAfter,primaryBefore);
const result={format:'rh-bot-module-goal-key-source/1',methodValue:'rh-method-value/1',
  profile:{sourceBase:'4151b3af597cc06d1b3b77f4e3e21cc9906b6a86',primarySeal:'5ec31212b0082d650cbe15d58877e82ac2793060',
    boundary:'Four bounded actual createStrategy method histories using immutable primary real Memory/runner helpers; declared module goals, not production module or full Brain/gameplay proof.',
    image:primarySource.profile.image,node:process.version,platform:process.platform,arch:process.arch,
    primaryManifest:pin(primaryManifestPath),primaryFilesBefore:primaryBefore,primaryFilesAfter:primaryAfter,
    sourceInventory:{files:sourcePins,sha256:hash(JSON.stringify(sourcePins))},
    configFiles:primarySource.profile.configFiles,toolFiles},
  mapReference:{primarySourceSha256:primaryBefore['parity/policy/bot-private-strategy/source.json'].sha256,id:'generated7',mapHashU32:primarySource.maps[0].mapHashU32},
  assertions,cases:outputs};
const bytes=JSON.stringify(result)+'\n';
if(mode==='--write')writeFileSync(output,bytes);else assert.equal(hash(read(output)),hash(bytes),'supplement exact bytes');
console.log(JSON.stringify({mode,bytes:Buffer.byteLength(bytes),sha256:hash(bytes),cases:outputs.length,operations:outputs.reduce((n,c)=>n+c.operations.length,0),assertions:assertions.length,primary17:'UNCHANGED'}));
