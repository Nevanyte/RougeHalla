import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {captureCase} from './oracle.ts';
import {f64} from './float.ts';
const original=JSON.parse(readFileSync('parity/stat-fold/canonical.json','utf8'));
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('canonical runtime required');
const specs:any[]=[];
const template=original.cases.find((x:any)=>x.kind==='fold').input;
for(const values of [[.5,.5],[1,1],[.2,.3],[-.5,-.5],[.25,.5,.75],[2,-.25]]) for(const kind of ['fold','statFold']) {
 const input=structuredClone(template); input.rows=values.map(v=>({k:'stat',stat:'lifestealMult',v:f64(v)})); input.holds=values.map(()=>null); input.farmRows=[]; input.farmHolds=[]; input.boosts=null; input.owned=[];
 specs.push({id:`ci-${String(specs.length).padStart(5,'0')}`,seed:71243+specs.length,origin:{kind:'synthetic',label:`independent product witness ${values.join(',')} ${kind}`},tags:[`kind:${kind}`],kind,input:kind==='fold'?input:{rows:input.rows,holds:input.holds,owned:input.owned}});
}
const provenance={...original.provenance,command:'node --import tsx tools/stat-fold/review-mutant-capture.ts',commit:'f14a89e87b4541c31076496935585d69c66ecddf',runtime:{node:process.version,platform:process.platform,arch:process.arch},sources:original.provenance.sources.map((s:any)=>({path:s.path,sha256:createHash('sha256').update(readFileSync(s.path)).digest('hex')}))};
writeFileSync('/out/fresh-mutant-cases.json',JSON.stringify({format:original.format,preset:'ci',provenance,coverage:[],cases:specs.map(s=>({...s,expected:captureCase(s)}))})+'\n');
console.log(JSON.stringify({cases:specs.length,scriptSha256:createHash('sha256').update(readFileSync('tools/stat-fold/review-mutant-capture.ts')).digest('hex')}));
