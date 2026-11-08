import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export function semanticDifferences(a,b,path='') {
 if(Object.is(a,b))return [];
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return [path];
 const keys=new Set([...Object.keys(a),...Object.keys(b)]);
 return [...keys].flatMap(k=>semanticDifferences(a[k],b[k],`${path}/${k}`));
}
export function semantic(c){return {rules:c.rules,classifications:c.classifications,steps:c.steps,adjusts:c.adjusts};}
if(process.argv[1]?.endsWith('/compare.mjs')){
 const [expected,actual,required]=process.argv.slice(2);
 const a=JSON.parse(readFileSync(expected,'utf8')),b=JSON.parse(readFileSync(actual,'utf8'));
 const differences=semanticDifferences(semantic(a),semantic(b));
 if(required){assert(differences.some(p=>p.startsWith(required)),`no required semantic mismatch ${required}`);console.log(`SEMANTIC KILL ${required}: ${differences.filter(p=>p.startsWith(required)).slice(0,5).join(', ')}`);}
 else {assert.deepEqual(differences,[]);console.log('SEMANTIC CONTROL PASS');}
}
