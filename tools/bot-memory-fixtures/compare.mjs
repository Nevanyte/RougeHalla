import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const semantic=c=>({codecCases:c.codecCases,clockFrames:c.clockFrames,memoryCases:c.memoryCases});
function diff(a,b,path=''){if(Object.is(a,b))return [];if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return [path];return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diff(a[k],b[k],`${path}/${k}`));}
const [expected,actual,required]=process.argv.slice(2);const paths=diff(semantic(JSON.parse(readFileSync(expected,'utf8'))),semantic(JSON.parse(readFileSync(actual,'utf8'))));
if(required){assert(paths.some(p=>p.startsWith(required)&&p.includes('/result/')),`no required result difference ${required}`);console.log(`SEMANTIC KILL: ${paths.filter(p=>p.startsWith(required)).slice(0,5).join(', ')}`);}else {assert.deepEqual(paths,[]);console.log('SEMANTIC CONTROL PASS');}
