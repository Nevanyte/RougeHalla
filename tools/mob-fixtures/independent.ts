import {readFileSync,writeFileSync} from 'node:fs';
import * as r from '../../packages/shared/src/rosters.ts';
import {strict as assert} from 'node:assert';
assert.deepEqual([process.version,process.platform,process.arch],['v22.23.4','linux','x64']);
const cases=JSON.parse(readFileSync('/out/fresh-inputs.json','utf8'));
const sourceCamp=(c:any)=>({zone:c.zone,spots:Array.from({length:c.spotCount},()=>({x:0,y:0})),eliteSpot:c.eliteSpot});
for(const c of cases){
 const i=c.input;let used=0;
 const next=()=>{const d=i.tape[used++];assert(Number.isFinite(d)&&d>=0&&d<1);return d;};
 let output;
 if(i.kind==='zone') output=r.rollZoneTypes(i.zone,i.count,next);
 else if(i.kind==='camps') output=r.rollCampTypes(i.zones,next);
 else if(i.kind==='elites') output=r.rollCampElites(i.camps.map(sourceCamp));
 else output=r.campMobs(sourceCamp(i.camp),i.campType,i.eliteType??undefined);
 c.expected={output,draws:used,continuation:Array.from({length:4},next)};
}
writeFileSync('/out/fresh-source.json',JSON.stringify(cases,null,2)+'\n');
console.log(JSON.stringify({cases:cases.length,draws:cases.reduce((n:number,c:any)=>n+c.expected.draws,0),runtime:[process.version,process.platform,process.arch]}));
