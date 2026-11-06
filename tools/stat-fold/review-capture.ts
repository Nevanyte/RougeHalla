import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {captureCase} from './oracle.ts';
import {f64} from './float.ts';
import {BOOST_STATS} from './schema.ts';
const original=JSON.parse(readFileSync('parity/stat-fold/canonical.json','utf8'));
const specs:any[]=[];
function add(label:string,input:any){specs.push({id:`ci-${String(specs.length).padStart(5,'0')}`,seed:54321+specs.length,origin:{kind:'synthetic',label},tags:['kind:fold'],kind:'fold',input});}
const template=original.cases.find((x:any)=>x.kind==='fold').input;
for(const stat of BOOST_STATS) for(const value of [Infinity,-Infinity,NaN,0,Number.MAX_VALUE]) for(const picks of [Infinity,NaN,-Infinity,0,Number.MIN_VALUE,3]){
 const input=structuredClone(template);input.rows=[{k:['ad','ap','armor','shield'].includes(stat)?'flat':'stat',stat,v:f64(value)}];input.holds=[null];input.baseMaxHp=f64(100);input.boosts=BOOST_STATS.map(s=>s===stat?f64(picks):null);
 add(`fresh boost ${stat} value=${value} picks=${picks}`,input);
}
const provenance={...original.provenance,command:'node --import tsx tools/stat-fold/review-capture.ts',commit:'f14a89e87b4541c31076496935585d69c66ecddf',runtime:{node:process.version,platform:process.platform,arch:process.arch},sources:original.provenance.sources.map((source:any)=>({path:source.path,sha256:createHash('sha256').update(readFileSync(source.path)).digest('hex')}))};
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('canonical runtime required');
const cases=specs.map(s=>({...s,expected:captureCase(s)}));
writeFileSync('/out/fresh-boost-cases.json',JSON.stringify({format:original.format,preset:'ci',provenance,coverage:[],cases})+'\n');
console.log(JSON.stringify({cases:cases.length,script: createHash('sha256').update(readFileSync('tools/stat-fold/review-capture.ts')).digest('hex')}));
