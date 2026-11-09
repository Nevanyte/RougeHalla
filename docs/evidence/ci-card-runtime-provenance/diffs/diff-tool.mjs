
import fs from 'node:fs';
import crypto from 'node:crypto';
const [oldPath, freshPath, kind, outPrefix] = process.argv.slice(2);
const a = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
const b = JSON.parse(fs.readFileSync(freshPath, 'utf8'));
const diffs = [];
function walk(x, y, path) {
  if (x === y) return;
  const tx = typeof x, ty = typeof y;
  if (x === null || y === null || tx !== ty || tx !== 'object') {
    diffs.push({ path, old: x, new: y });
    return;
  }
  if (Array.isArray(x) || Array.isArray(y)) {
    if (!Array.isArray(x) || !Array.isArray(y)) { diffs.push({ path, old: x, new: y }); return; }
    if (x.length !== y.length) diffs.push({ path: path + '/#len', old: x.length, new: y.length });
    const n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i++) walk(x[i], y[i], path + '/' + i);
    for (let i = n; i < x.length; i++) diffs.push({ path: path + '/' + i, old: x[i], new: '<missing>' });
    for (let i = n; i < y.length; i++) diffs.push({ path: path + '/' + i, old: '<missing>', new: y[i] });
    return;
  }
  const kx = Object.keys(x), ky = Object.keys(y);
  for (const k of kx) if (!(k in y)) diffs.push({ path: path + '/' + k, old: x[k], new: '<missing>' });
  for (const k of ky) if (!(k in x)) diffs.push({ path: path + '/' + k, old: '<missing>', new: y[k] });
  for (const k of kx) if (k in y) walk(x[k], y[k], path + '/' + k);
}
walk(a, b, '');
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const sem = (o) => sha({ format: o.format, roles: o.roles, profiles: o.profiles, noninterference: o.noninterference, cases: o.cases, privateOracleRecords: o.privateOracleRecords });
const semA = sem(a), semB = sem(b);
const counts = { cases: a.cases?.length, privateRecords: a.privateOracleRecords ? Object.keys(a.privateOracleRecords).length : undefined, ordinarySteps: a.cases?.reduce((n, c) => n + (c.ordinarySteps || 0), 0) };
const allowed = [];
const forbidden = [];
const refShas = { old: kind === 'runtime' ? 'd50c03e471f9d11ff790cac0f31d4ab82b5bb45f1b963b41725d58814cc6f74e' : 'c2e5d1a071f3f7a05a6c3e8bf46fbdba8f0c7ae47d4de1aea8e62a1726ecd019',
                   new: kind === 'runtime' ? '9e76292b7ae74d305da2729a2ceba63965e64aa9fd670ab85568ae7909270507' : '<runtime-new-source-sha>' };
const captureOld = '24df22055a3c77b75e01b478d04a477a57690d7f71220916d0816551102fff9e';
const captureNew = '5ca446a1934846ffa14e561a10b06230b55a73f924d7853c5c9ecec79b13857d';
for (const d of diffs) {
  const p = d.path;
  const isCatalogRef = /^\/provenance\/immutableReferences\/0\/(sha256|scope)$/.test(p) || /^\/immutableReferences\/0\/(sha256|scope)$/.test(p);
  const isCaptureHarness = /^\/provenance\/harnessInputs\/\d+\/sha256$/.test(p) || /^\/harnessInputs\/\d+\/sha256$/.test(p);
  const isOverlay = /^\/provenance\/acceptedProvenanceOverlay(\/|$)/.test(p) || /^\/acceptedProvenanceOverlay(\/|$)/.test(p);
  if (isCatalogRef || isOverlay) allowed.push(d);
  else if (isCaptureHarness) { allowed.push(d); }
  else forbidden.push(d);
}
fs.writeFileSync(outPrefix + '.json', JSON.stringify({ kind, diffs, allowedPaths: allowed.map(d => d.path), forbiddenPaths: forbidden.map(d => d.path), semanticDigestOld: semA, semanticDigestNew: semB, semanticEqual: semA === semB, counts, refShas, captureOld, captureNew }, null, 2));
console.log(JSON.stringify({ kind, diffCount: diffs.length, allowed: allowed.length, forbidden: forbidden.length, semanticEqual: semA === semB, counts, semanticDigestOld: semA, semanticDigestNew: semB }));
if (forbidden.length) { console.log('FORBIDDEN', JSON.stringify(forbidden.slice(0, 10), null, 2).slice(0, 4000)); process.exit(2); }
console.log('ALLOWED', JSON.stringify(allowed, null, 2).slice(0, 5000));

