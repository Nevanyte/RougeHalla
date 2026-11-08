
import fs from 'node:fs';
const [file, label, prefix] = process.argv.slice(2);
const root = prefix || '/cases/0/expected';
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
let hit = null;
const walk = (x, path) => {
  if (hit) return;
  if (x === null || typeof x !== 'object') {
    if (path.startsWith(root + '/') && (typeof x === 'string' || typeof x === 'number')) hit = { path, value: x };
    return;
  }
  if (Array.isArray(x)) { x.forEach((v, i) => walk(v, path + '/' + i)); return; }
  for (const k of Object.keys(x)) walk(x[k], path + '/' + k);
};
walk(d, '');
if (!hit) throw new Error('no scalar expected leaf under ' + root);
const next = typeof hit.value === 'string' ? hit.value + ' [negative-control]' : hit.value + 1;
const parts = hit.path.split('/').filter(Boolean);
let at = d;
for (const k of parts.slice(0, -1)) at = at[k];
at[parts[parts.length - 1]] = next;
fs.writeFileSync(file, JSON.stringify(d) + '\n');
console.log(JSON.stringify({ label, path: hit.path, from: hit.value, to: next }));

