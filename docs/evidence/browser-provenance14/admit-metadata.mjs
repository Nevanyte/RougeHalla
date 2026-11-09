// Finite metadata transformation, not a gameplay/source outcome generator.
// --write applies only to exact base bytes; default verifies the completed candidate.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const BASE='58f476763128a84b2acb28d2d7e41cb60a1c20e5';
const evidence='docs/evidence/browser-provenance14/{README.md,receipt.json,logs}';
const sha=b=>createHash('sha256').update(b).digest('hex');
const text=p=>readFileSync(root+p,'utf8');
const before=p=>execFileSync('git',['show',BASE+':'+p],{cwd:root,maxBuffer:128*1024*1024}).toString();
const read=p=>JSON.parse(text(p));
const old=p=>JSON.parse(before(p));
const leafHashes={
 'tools/protocol-js/check-vectors.mjs':'1173a06fa8b2d0017367795f4a07c82bfe87285cbcc300df197aa5ee80aa47b3',
 'tools/browser-proof/proof.mjs':'9d9a5f64a59ecc048653975f5b60fa9a74e71edffc983037c64aea96ac74d8a7',
};
const paths={catalog:'parity/card-catalog/source.json',runtime:'parity/card-runtime/source.json',runtimeInput:'parity/card-runtime/INPUT_SHA256.json',runtimeTool:'tools/card-runtime-fixtures/capture.mts',witness:'parity/card-runtime-witness/source.json',witnessInput:'parity/card-runtime-witness/INPUT_SHA256.json',witnessTool:'tools/card-runtime-witness-fixtures/capture.mts'};
for(const [p,h] of Object.entries(leafHashes)){assert.equal(sha(text(p)),h,p);assert.equal(text(p),before(p),p+' must remain untouched');}
const proposed=new Map();
const catalog=old(paths.catalog);
for(const [p,h] of Object.entries(leafHashes))catalog.protectedSha256[p]=h;
proposed.set(paths.catalog,JSON.stringify(catalog,null,2)+'\n');
assert.equal(sha(proposed.get(paths.catalog)),'e2de5226d31fc7fe4f23d8cd0552ad73be44855bb3109ebed8042b2fd899b9c3');
const runtime=old(paths.runtime),runtimeInput=old(paths.runtimeInput);
const overlay=structuredClone(runtime.provenance.acceptedProvenanceOverlay);
overlay.priorAcceptedEffectiveSha256=sha(before(paths.catalog));
overlay.effectiveSha256=sha(proposed.get(paths.catalog));
for(const c of overlay.acceptedChanges){const p=c.leaf.slice('/protectedSha256/'.length);assert(Object.hasOwn(leafHashes,p));c.from=c.to;c.to=leafHashes[p];c.evidence=evidence;}
overlay.preservedPriorLineage='catalog original d50c03e471f9d11ff790cac0f31d4ab82b5bb45f1b963b41725d58814cc6f74e -> accepted 9e76292b7ae74d305da2729a2ceba63965e64aa9fd670ab85568ae7909270507 -> accepted 2ddb8f85114ff6e8e70c2d70b8207ed3f32c71431845f3cce1007be494e39792 -> this effectiveSha256; earlier exact leaf transitions/receipts remain in docs/evidence/ci-card-catalog-protocol13 and docs/evidence/ci-browser-provenance-chain; this hop admits only the two listed current-to-final protected leaves';
function replaceLiteral(tool,pattern,literal){const source=before(tool);assert.equal([...source.matchAll(new RegExp(pattern,'g'))].length,1);return source.replace(new RegExp(pattern),(...m)=>m[1]+literal+m[2]);}
proposed.set(paths.runtimeTool,replaceLiteral(paths.runtimeTool,'(const acceptedProvenanceOverlay=)[\\s\\S]*?(;const refs=)',JSON.stringify(overlay)));
for(const p of [runtime.provenance,runtimeInput]){
 assert.equal(p.harnessInputs[2].path,paths.runtimeTool);p.harnessInputs[2].sha256=sha(proposed.get(paths.runtimeTool));
 assert.equal(p.immutableReferences[0].path,paths.catalog);p.immutableReferences[0].sha256=overlay.effectiveSha256;
 p.acceptedProvenanceOverlay=structuredClone(overlay);
}
proposed.set(paths.runtime,JSON.stringify(runtime)+'\n');
proposed.set(paths.runtimeInput,JSON.stringify(runtimeInput,null,2)+'\n');
const witness=old(paths.witness),witnessInput=old(paths.witnessInput);
const overlays=structuredClone(witness.provenance.acceptedProvenanceOverlay);
assert.deepEqual(overlays.map(x=>x.path),[paths.runtime,paths.runtimeInput,paths.runtimeTool]);
for(const ov of overlays){ov.priorAcceptedEffectiveSha256=ov.effectiveSha256;ov.effectiveSha256=sha(proposed.get(ov.path));ov.evidence=evidence;}
proposed.set(paths.witnessTool,replaceLiteral(paths.witnessTool,'(const acceptedProvenanceOverlay=)[\\s\\S]*?(;assert.equal\\(pins.files)',JSON.stringify(overlays)));
for(const p of [witness.provenance,witnessInput]){
 assert.equal(p.harnessInputs[1].path,paths.witnessTool);p.harnessInputs[1].sha256=sha(proposed.get(paths.witnessTool));
 p.acceptedProvenanceOverlay=structuredClone(overlays);
 for(const index of [1,3,6]){
  const row=p.actualPinnedInputs[index]; assert(overlays.some(x=>x.path===row.path));
  row.sha256=sha(proposed.get(row.path));row.bytes=Buffer.byteLength(proposed.get(row.path));
  row.acceptedProvenanceOverlay.effectiveSha256=row.sha256;row.acceptedProvenanceOverlay.evidence=evidence;
 }
}
proposed.set(paths.witness,JSON.stringify(witness)+'\n');
proposed.set(paths.witnessInput,JSON.stringify(witnessInput,null,2)+'\n');
function differences(a,b,path=''){
 if(Object.is(a,b))return [];
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return [{path,before:a,after:b}];
 const result=[];if(Array.isArray(a)&&a.length!==b.length)result.push({path:path+'/#length',before:a.length,after:b.length});
 for(const k of new Set([...Object.keys(a),...Object.keys(b)])){
  if(!Object.hasOwn(a,k)||!Object.hasOwn(b,k))result.push({path:path+'/'+k,before:Object.hasOwn(a,k)?a[k]:'<missing>',after:Object.hasOwn(b,k)?b[k]:'<missing>'});
  else result.push(...differences(a[k],b[k],path+'/'+k));
 }
 return result;
}
const runtimeOverlay=['priorAcceptedEffectiveSha256','effectiveSha256','preservedPriorLineage',...Array.from({length:2},(_,i)=>['from','to','evidence'].map(k=>'acceptedChanges/'+i+'/'+k)).flat()];
function allowed(p){
 if(p===paths.catalog)return Object.keys(leafHashes).map(k=>'/protectedSha256/'+k);
 const prefix=p.endsWith('INPUT_SHA256.json')?'':'/provenance';
 if([paths.runtime,paths.runtimeInput].includes(p))return [prefix+'/harnessInputs/2/sha256',prefix+'/immutableReferences/0/sha256',...runtimeOverlay.map(k=>prefix+'/acceptedProvenanceOverlay/'+k)];
 return [prefix+'/harnessInputs/1/sha256',...Array.from({length:3},(_,i)=>['priorAcceptedEffectiveSha256','effectiveSha256','evidence'].map(k=>prefix+'/acceptedProvenanceOverlay/'+i+'/'+k)).flat(),...[1,3,6].flatMap(i=>['sha256','bytes','acceptedProvenanceOverlay/effectiveSha256','acceptedProvenanceOverlay/evidence'].map(k=>prefix+'/actualPinnedInputs/'+i+'/'+k))];
}
const semanticFields={
 [paths.catalog]:['format','baseRevision','environment','inventory','cases'],
 [paths.runtime]:['format','roles','profiles','noninterference','cases','privateOracleRecords'],
 [paths.witness]:['format','roles','controlCorrection','cleanControls','witnessDefinition','cases','comparison','privateOracleRecords'],
};
function checked(p,after){
 const a=old(p),b=typeof after==='string'?JSON.parse(after):after;
 const delta=differences(a,b),permit=new Set(allowed(p));
 const forbidden=delta.filter(d=>!permit.has(d.path));assert.equal(forbidden.length,0,p+' forbidden fields: '+JSON.stringify(forbidden.map(x=>x.path)));
 // Require every proposed metadata field to change: no missing transition silently admitted.
 assert.deepEqual(new Set(delta.map(d=>d.path)),permit,p+' exact changed-field set');
 const fields=semanticFields[p];
 const sem=o=>sha(JSON.stringify(Object.fromEntries(fields.map(k=>[k,o[k]]))));
 if(fields)assert.equal(sem(a),sem(b),p+' semantic digest');
 return {path:p,beforeSha256:sha(before(p)),afterSha256:sha(JSON.stringify(b)+(p.endsWith('INPUT_SHA256.json')?'':'\n')),diffs:delta,semanticFields:fields,semanticDigestBefore:fields?sem(a):undefined,semanticDigestAfter:fields?sem(b):undefined,allOtherFieldsEqual:true};
}
// Inspect every recursive field before writes; no blanket /provenance allowance.
const reports=[];
for(const [p,data] of proposed){
 if(p.endsWith('.json')){const row=checked(p,data);row.afterSha256=sha(data);row.beforeBytes=Buffer.byteLength(before(p));row.afterBytes=Buffer.byteLength(data);reports.push(row);}
 else reports.push({path:p,beforeSha256:sha(before(p)),afterSha256:sha(data),beforeBytes:Buffer.byteLength(before(p)),afterBytes:Buffer.byteLength(data),allowedToolSeam:'existing acceptedProvenanceOverlay literal only; every outside byte preserved'});
}
if(process.argv.includes('--write')){
 for(const p of proposed.keys())assert.equal(text(p),before(p),p+' write requires exact base bytes');
 for(const [p,data] of proposed)writeFileSync(root+p,data);
}else for(const [p,data] of proposed)assert.equal(sha(text(p)),sha(data),p+' deterministic metadata bytes');
// Whole-file equality protects prior receipts, native/client/browser sources, and FROZEN via scope checks later.
assert.equal(text('tools/card-runtime-witness-fixtures/FROZEN_PINS.json'),before('tools/card-runtime-witness-fixtures/FROZEN_PINS.json'));
const controls=[];
for(const p of [paths.catalog,paths.runtime,paths.witness]){
 const b=JSON.parse(proposed.get(p));b.cases[0].id=(b.cases[0].id??'')+'__semantic_negative';
 assert.throws(()=>checked(p,b),undefined,p+' changed case must refuse');controls.push({path:p,control:'changed case id',refused:true});
}
for(const p of [paths.runtime,paths.witness]){
 const b=JSON.parse(proposed.get(p));const k=Object.keys(b.privateOracleRecords)[0];b.privateOracleRecords[k]={changed:'negative'};
 assert.throws(()=>checked(p,b),undefined,p+' private oracle change must refuse');controls.push({path:p,control:'changed private record',refused:true});
}
const report={base:BASE,mode:process.argv.includes('--write')?'exact-metadata-write':'verification',reports,offlineSemanticNegativeControls:controls,sourceOutcomeGeneration:false};
writeFileSync(root+'docs/evidence/browser-provenance14/metadata-diff.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({base:BASE,mode:report.mode,artifacts:reports.map(({path,beforeSha256,afterSha256,diffs,semanticDigestBefore,semanticDigestAfter})=>({path,beforeSha256,afterSha256,fieldDiffs:diffs?.length,semanticDigestBefore,semanticDigestAfter})),offlineSemanticNegativeControls:controls},null,2));
