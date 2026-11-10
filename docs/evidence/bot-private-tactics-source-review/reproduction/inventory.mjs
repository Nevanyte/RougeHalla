import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,statSync,writeFileSync} from 'node:fs';

const [phase,output] = process.argv.slice(2);
assert(['before','after'].includes(phase));
assert(output);
const hash = b => createHash('sha256').update(b).digest('hex');
const pin = path => ({bytes:statSync(`/repo/${path}`).size,sha256:hash(readFileSync(`/repo/${path}`))});
const manifestPath = 'parity/policy/bot-private-tactics/manifest.json';
const manifestBytes = readFileSync(`/repo/${manifestPath}`);
const manifest = JSON.parse(manifestBytes);
const groups = {
  sourceInventory:manifest.profile.sourceInventory,
  actualRuntimeImports:manifest.profile.actualRuntimeImports,
  configFiles:manifest.profile.configFiles,
  compatibilityCorpora:manifest.profile.compatibilityCorpora,
  toolFiles:manifest.profile.toolFiles,
  corpus:manifest.corpus,
};
const inventory = {};
let mismatches = 0;
for (const [group,entries] of Object.entries(groups)) {
  inventory[group] = {};
  for (const [name,expected] of Object.entries(entries)) {
    const path = group === 'corpus' ? `parity/policy/bot-private-tactics/${name}` : name;
    const actual = pin(path);
    const matches = actual.bytes === expected.bytes && actual.sha256 === expected.sha256;
    if (!matches) mismatches++;
    inventory[group][path] = {expected,actual,matches};
  }
}
const source = JSON.parse(readFileSync('/repo/parity/policy/bot-private-tactics/source.json'));
for (const map of manifest.maps) {
  const actual = hash(JSON.stringify(source.maps.find(m => m.id === map.id).value));
  if (actual !== map.encodedValueSha256) mismatches++;
}
const result = {
  format:'rh-bot-private-tactics-review-inventory/1',
  phase,
  reviewHead:process.env.REVIEW_HEAD,
  baselinePorcelainWasClean:process.env.REVIEW_BASELINE_CLEAN === 'true',
  runtime:{node:process.version,platform:process.platform,arch:process.arch},
  manifest:{path:manifestPath,bytes:manifestBytes.length,sha256:hash(manifestBytes),format:manifest.format},
  declared:{cases:manifest.cases,operations:manifest.operations,semanticControls:manifest.semanticControls,reachedAssertions:manifest.reachedAssertions.length},
  groups:inventory,
  mapChecks:manifest.maps.map(map=>({id:map.id,expectedSha256:map.encodedValueSha256,actualSha256:hash(JSON.stringify(source.maps.find(m=>m.id===map.id).value)),matches:hash(JSON.stringify(source.maps.find(m=>m.id===map.id).value))===map.encodedValueSha256})),
  mismatchCount:mismatches,
};
writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({phase,manifestSha256:result.manifest.sha256,entries:Object.values(groups).reduce((n,g)=>n+Object.keys(g).length,0),mismatches}));
assert.equal(mismatches,0,'manifest-pinned file or map inventory mismatch');
