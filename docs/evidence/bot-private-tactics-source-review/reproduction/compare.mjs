import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const before = JSON.parse(readFileSync('/evidence/before.json'));
const after = JSON.parse(readFileSync('/evidence/after.json'));
const stable = x => ({reviewHead:x.reviewHead,baselinePorcelainWasClean:x.baselinePorcelainWasClean,runtime:x.runtime,manifest:x.manifest,declared:x.declared,groups:x.groups,mapChecks:x.mapChecks,mismatchCount:x.mismatchCount});
assert.deepEqual(stable(after),stable(before),'all manifest-pinned inputs remained byte-identical');
const result = {
  format:'rh-bot-private-tactics-review-inventory-comparison/1',
  before:{path:'before.json',phase:before.phase,manifestSha256:before.manifest.sha256,entries:Object.values(before.groups).reduce((n,g)=>n+Object.keys(g).length,0),mismatches:before.mismatchCount},
  after:{path:'after.json',phase:after.phase,manifestSha256:after.manifest.sha256,entries:Object.values(after.groups).reduce((n,g)=>n+Object.keys(g).length,0),mismatches:after.mismatchCount},
  completeInventoryIdentical:true,
};
writeFileSync('/evidence/inventory-comparison.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
