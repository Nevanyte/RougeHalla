// Additive supplement reader; delegates unchanged tagged/case validation to the frozen primary verifier.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.RH_MODULE_KEY_REPO??process.cwd();
const {validate,decode}=await import(pathToFileURL(join(root,'tools/bot-private-strategy-fixtures/verify.mjs')).href);
const path=process.argv[2]??join(root,'parity/policy/bot-module-goal-key/source.json');
const bytes=readFileSync(path),body=JSON.parse(bytes);
assert.equal(body.format,'rh-bot-module-goal-key-source/1');assert.equal(body.methodValue,'rh-method-value/1');
const primaryBytes=readFileSync(join(root,'parity/policy/bot-private-strategy/source.json'));
assert.equal(createHash('sha256').update(primaryBytes).digest('hex'),body.mapReference.primarySourceSha256);
const primary=JSON.parse(primaryBytes);assert.equal(primary.maps[0].mapHashU32,body.mapReference.mapHashU32);
const converted=validate({format:'rh-bot-private-strategy-source/1',methodValue:body.methodValue,profile:body.profile,maps:primary.maps,cases:body.cases});
assert.equal(converted.length,4);assert.equal(body.assertions.length,4);assert(body.assertions.every(x=>x.result==='PASS'));
const keys=[];
for(const c of body.cases)keys.push({case:c.id,currentKeys:c.operations.filter(o=>o.method==='decide').map(o=>decode(o.own,true).currentKey)});
console.log(JSON.stringify({validated:path,cases:converted.length,operations:converted.reduce((n,c)=>n+c.operations.length,0),assertions:4,
  bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),keys}));
