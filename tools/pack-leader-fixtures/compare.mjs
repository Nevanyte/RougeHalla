/** First-difference comparator for Pack Leader source outputs (provenance keys excluded). */
import { readFileSync } from 'node:fs';
const [aPath, bPath] = process.argv.slice(2);
const strip = (v) => { const o = JSON.parse(JSON.stringify(v)); delete o.source; delete o.tool; delete o.base; return o; };
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
const d = firstDiff(strip(JSON.parse(readFileSync(aPath, 'utf8'))), strip(JSON.parse(readFileSync(bPath, 'utf8'))));
if (!d) console.log('IDENTICAL');
else console.log('DIFF ' + d.path + ' baseline=' + JSON.stringify(d.a) + ' mutant=' + JSON.stringify(d.b));
