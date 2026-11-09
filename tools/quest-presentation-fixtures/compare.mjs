import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
// Actual helper/row output only. A metadata/hash difference cannot count as a semantic kill.
export function assertSemantics(expected, actual) {
  assert.equal(expected.format,"rh-quest-presentation-source/1");
  assert.equal(actual.format,expected.format);
  assert.deepEqual(actual.cases,expected.cases,"PRESENTATION_OUTPUT_SEMANTIC_MISMATCH");
}
function difference(a,b,path) {
  if(Object.is(a,b))return null;
  if(a===null||b===null||typeof a!=="object"||typeof b!=="object")return {path,expected:a,actual:b};
  for(const key of new Set([...Object.keys(a),...Object.keys(b)])) {
    const found=difference(a[key],b[key],path+(Array.isArray(a)?`[${key}]`:`.${key}`));if(found)return found;
  }
  return null;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length,4);
  const expected=JSON.parse(readFileSync(process.argv[2],"utf8")),actual=JSON.parse(readFileSync(process.argv[3],"utf8"));
  try {
    assertSemantics(expected,actual);
    console.log(JSON.stringify({status:"IDENTICAL_SEMANTICS",provenanceCompared:false,provenanceChanged:JSON.stringify(expected.provenance)!==JSON.stringify(actual.provenance)}));
  }catch(e) {
    if(e?.code!=="ERR_ASSERTION"||!String(e.message).includes("PRESENTATION_OUTPUT_SEMANTIC_MISMATCH"))throw e;
    console.error("PRESENTATION_OUTPUT_SEMANTIC_MISMATCH: actual compiled helper output differs; provenance excluded");
    console.error(JSON.stringify(difference(expected.cases,actual.cases,"$.cases")));process.exitCode=1;
  }
}
