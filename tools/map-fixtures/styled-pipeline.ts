/** Complete source styled maps, reusing the byte-identical certified DTO backbone and recording decor separately. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { certifiedMap, mapHash } from '../../packages/shared/src/mapgen.ts';
import { PINNED_MAPS, PIN_STYLER_VERSIONS } from '../../packages/shared/test/mapPins.ts';

if (process.version !== 'v22.23.4' || process.platform !== 'linux' || process.arch !== 'x64') throw Error('canonical Linux x64 Node22.23.4 required');
const argv = process.argv.slice(2);
if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--check')) throw Error('usage: styled-pipeline.ts [--check]');
const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = join(root, 'packages/shared/src');
const fixturePath = join(root, 'crates/rh-sim/src/mapgen/fixtures/map-certify.json');
const backboneBytes = readFileSync(fixturePath);
const backbone = JSON.parse(backboneBytes.toString('utf8'));
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
if (backbone.format !== 'rh-map-certify/1' || backbone.sourceSeedCount !== 200) throw Error('unexpected certified backbone');
if (PINNED_MAPS.length !== 200 || Object.keys(PIN_STYLER_VERSIONS).length !== 5 || Object.values(PIN_STYLER_VERSIONS).some(v => v !== 400)) throw Error('unexpected original styled pin inventory');
const plain = (v: any): any => ArrayBuffer.isView(v) ? Array.from(v as any) : Array.isArray(v) ? v.map(plain) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v;
function pack(map: any) {
  const out = plain(map);
  for (const key of ['tiles', 'terrain', 'regionGrid', 'territoryGrid', 'featureGrid']) {
    const runs: number[][] = [];
    for (const value of out[key]) {
      if (!Number.isInteger(value) || value < 0 || value > 255) throw Error(`nonbyte ${key}`);
      const last = runs.at(-1);
      if (last && last[0] === value) last[1]++; else runs.push([value, 1]);
    }
    out[key] = { rle: runs };
  }
  return out;
}
const sources: Record<string, string> = {};
function visit(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = join(dir, e.name);
    if (e.isDirectory()) visit(path);
    else if (e.isFile() && e.name.endsWith('.ts')) sources[relative(sourceRoot, path)] = sha(readFileSync(path));
  }
}
visit(sourceRoot);
const pins = [];
for (let seed = 0; seed < 200; seed++) {
  const expected = backbone.cases.filter((c: any) => c.name === `generated-${seed}-strict`);
  if (expected.length !== 1) throw Error(`missing/duplicate backbone seed ${seed}`);
  const bare = certifiedMap(seed, { decor: false });
  const decorated = certifiedMap(seed, { decor: true });
  if (!bare || !decorated) throw Error(`source refused pinned seed ${seed}`);
  const packedBare = pack(bare), packedDecorated = pack(decorated);
  if (!isDeepStrictEqual(packedBare, expected[0].map)) throw Error(`source backbone drift ${seed}`);
  if (!isDeepStrictEqual({ ...packedDecorated, props: packedBare.props }, packedBare)) throw Error(`decor changed a non-prop field ${seed}`);
  const pin = `${seed}:${decorated.attempt}:${mapHash(decorated)}`;
  if (pin !== PINNED_MAPS[seed] || mapHash(bare) !== mapHash(decorated)) throw Error(`original styled pin drift ${seed}`);
  pins.push({ seed, pin, backboneCase: expected[0].name, props: packedDecorated.props });
  if (seed % 25 === 0) console.log(`source styled ${seed}`);
}
const result = {
  format: 'rh-map-styled-pipeline/1', node: process.version, platform: process.platform, arch: process.arch,
  sources, pinsFileSha256: sha(readFileSync(join(root, 'packages/shared/test/mapPins.ts'))), pinStylerVersions: PIN_STYLER_VERSIONS,
  backbone: { file: 'map-certify.json', sha256: sha(backboneBytes), verifiedActualBareMaps: 200, verifiedDecorOnlyChangesProps: 200 }, pins,
};
const text = JSON.stringify(result) + '\n';
const output = process.env.RH_STYLED_OUTPUT ?? join(root, 'crates/rh-sim/src/mapgen/fixtures/map-styled-pipeline.json');
if (argv[0] === '--check') { if (readFileSync(output, 'utf8') !== text) throw Error('styled source capture differs'); }
else writeFileSync(output, text);
console.log(JSON.stringify({ pins: pins.length, props: pins.reduce((sum, p) => sum + p.props.length, 0), bytes: Buffer.byteLength(text) }));
