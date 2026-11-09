/** Classify a mutant capture against the repaired canonical corpus: semantic vs provenance. */
import { readFileSync } from 'node:fs';
const [aPath, bPath] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const semantic = (v) => { const o = JSON.parse(JSON.stringify(v)); delete o.source; delete o.tool; delete o.base; return o; };
const prov = (v) => ({ source: v.source ?? null, tool: v.tool ?? null, base: v.base ?? null });
function firstDiff(a, b, path = '') {
  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
  const tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;
  if (ta !== tb) return { path, a: ta, b: tb };
  if (ta === 'array') {
    if (a.length !== b.length) return { path: path + '.length', a: a.length, b: b.length };
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], path + '[' + i + ']'); if (d) return d; }
    return null;
  }
  if (ta === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return { path: path + '.keys', a: ka, b: kb };
    for (const k of ka) { const d = firstDiff(a[k], b[k], path + '.' + k); if (d) return d; }
    return null;
  }
  if (a !== b) return { path, a, b };
  return null;
}
const A = read(aPath), B = read(bPath);
const s = firstDiff(semantic(A), semantic(B));
if (s) { console.log('SEMANTIC-DIFF ' + s.path + ' baseline=' + JSON.stringify(s.a) + ' mutant=' + JSON.stringify(s.b)); }
else {
  const p = firstDiff(prov(A), prov(B));
  if (p) {
    const changed = [];
    if (firstDiff(A.source ?? {}, B.source ?? {})) changed.push('source');
    if (firstDiff(A.tool ?? {}, B.tool ?? {})) changed.push('tool');
    if (firstDiff(A.base ?? null, B.base ?? null)) changed.push('base');
    console.log('SEMANTIC-IDENTICAL PROVENANCE-DIFF changed=' + changed.join(','));
  } else console.log('SEMANTIC-IDENTICAL PROVENANCE-IDENTICAL');
}
