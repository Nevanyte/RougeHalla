// One approved diagnostic: actual unchanged source aimedAt, forwarded Math calls, never an expected fixture.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
Math.random=()=>{throw Error('undeclared randomness');};
const source=readFileSync('/repo/packages/server/src/bots/brain/tactics/kite.ts','utf8');
const append='\n// temporary diagnostic export; original body/import/constants unchanged\nexport { aimedAt as __aimedAt };\n';
const bundled=await build({stdin:{contents:source+append,resolveDir:'/repo/packages/server/src/bots/brain/tactics',loader:'ts',sourcefile:'/repo/packages/server/src/bots/brain/tactics/kite.ts'},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
assert.equal(bundled.outputFiles.length,1);
writeFileSync('/tmp/source-aim-diagnostic-bundle.mjs',bundled.outputFiles[0].text);
const actual=await import('file:///tmp/source-aim-diagnostic-bundle.mjs');
assert.equal(typeof actual.__aimedAt,'function');
const bits=v=>{assert(Number.isFinite(v));const b=new ArrayBuffer(8),d=new DataView(b);d.setFloat64(0,v,false);return d.getBigUint64(0,false).toString(16).padStart(16,'0');};
const number=v=>({value:v,bits:bits(v)});
const fixtureBytes=readFileSync('/repo/parity/policy/bot-reflex/source.json'),fixture=JSON.parse(fixtureBytes);
const runs=[];
for(const name of ['aim-lateral60-nominal-binary64-outside','aim-lateral60-exact-3-4-5']){
 const c=fixture.cases.find(c=>c.name===name),p=c.rows[0].input.percept,from=p.fighters[0],aim=p.events[0].a,at=p.self;
 const original={},calls=[];
 for(const method of ['hypot','atan2','sin']){
  original[method]=Math[method];
  Math[method]=(...args)=>{const result=Reflect.apply(original[method],Math,args);calls.push({method,args:args.map(number),result:number(result)});return result;};
 }
 let result;
 try{result=actual.__aimedAt(from,aim,at);}finally{for(const method of Object.keys(original))Math[method]=original[method];}
 const distance=calls.find(c=>c.method==='hypot').result.value,sine=calls.find(c=>c.method==='sin').result.value;
 runs.push({name,input:{from:{x:from.x,y:from.y},aim,at:{x:at.x,y:at.y}},actualAimedAt:result,actualForwardedMathCalls:calls,
  diagnosticProductOfActualReturnedValues:number(distance*sine),capturedReflexResult:c.rows[0].result});
}
const result={format:'rh-reflex-aim-primitive-diagnostic/1',role:'Diagnostic only; actual source aimedAt with original imports/constants and unmodified Math forwarding. The product is a labelled diagnostic of actual returned values, not a replacement oracle or gameplay outcome.',
 node:process.version,platform:process.platform,arch:process.arch,image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',
 sourceSha256:sha(source),append,appendSha256:sha(append),bundleSha256:sha(bundled.outputFiles[0].text),fixtureSha256:sha(fixtureBytes),scriptSha256:sha(readFileSync('/repo/docs/evidence/bot-reflex-native/raw/source-aim-diagnostic.mjs')),runs};
console.log(JSON.stringify(result,null,1));
