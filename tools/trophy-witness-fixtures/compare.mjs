// Compare only captured cases. Source/tool provenance changing is never a semantic kill.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';

const expected = {
  '01-owner-refusal-removed': ['lifecycle', '/cases/1/frames/3/toasts'],
  '02-birth-hold-removed': ['lifecycle', '/cases/0/frames/3/trophies/0/takenBy'],
  '03-ranking-order-reversed': ['helpers', '/cases/3/result/1/options'],
  '04-grant-arithmetic-doubled': ['lifecycle', '/cases/0/frames/4/players/0/killStats/ad'],
};

function load(dir, name) {
  const doc = JSON.parse(readFileSync(join(dir, name + '.json'), 'utf8'));
  if (doc.format !== `rh-trophy-${name === 'helpers' ? 'helpers' : 'lifecycle'}-source/1` ||
      !Array.isArray(doc.cases) || !doc.provenance) throw Error('invalid corpus ' + name);
  return doc;
}

function at(doc, path) {
  let value = doc;
  for (const key of path.slice(1).split('/')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key))
      throw Error('expected witness path missing: ' + path);
    value = value[key];
  }
  return value;
}

function firstDiff(a, b, path = '/cases') {
  if (isDeepStrictEqual(a, b)) return null;
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
      if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) return path + '/' + key;
      const found = firstDiff(a[key], b[key], path + '/' + key);
      if (found) return found;
    }
  }
  return path;
}

try {
  const [baseline, actual, mode] = process.argv.slice(2);
  if (!baseline || !actual || !(mode in expected || mode === '--equal' || mode === '--provenance-only'))
    throw Error('usage: compare.mjs BASE ACTUAL MUTANT|--equal|--provenance-only');
  const pairs = Object.fromEntries(['lifecycle', 'helpers'].map(name => [name, [load(baseline, name), load(actual, name)]]));
  const differences = Object.entries(pairs).flatMap(([name, [a, b]]) => {
    const path = firstDiff(a.cases, b.cases);
    return path ? [{corpus: name, path}] : [];
  });
  if (mode === '--equal' || mode === '--provenance-only') {
    if (differences.length) throw Error('semantic cases changed: ' + JSON.stringify(differences));
    if (mode === '--provenance-only' && Object.values(pairs).some(([a, b]) => isDeepStrictEqual(a.provenance, b.provenance)))
      throw Error('provenance-only control did not change provenance in both corpora');
    console.log(JSON.stringify({mode, semanticDifferences: 0, semanticKill: false}));
  } else {
    const [corpus, path] = expected[mode];
    const [a, b] = pairs[corpus];
    if (!differences.length || isDeepStrictEqual(at(a, path), at(b, path)))
      throw Error('mutant survived expected semantic witness: ' + corpus + path);
    console.log(JSON.stringify({mutant: mode, semanticKill: true, expectedWitness: {corpus, path}, firstDifferences: differences}));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
