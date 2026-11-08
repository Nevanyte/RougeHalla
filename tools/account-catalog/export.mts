// Presentation constants only: never import/evaluate goal, eligibility, roll or purchase helpers into Unity.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COSMETICS } from '../../packages/shared/src/cosmetics.ts';
import { ACHIEVEMENTS } from '../../packages/shared/src/achievements.ts';
const repo = resolve(new URL('../..', import.meta.url).pathname);
const output = process.env.RH_ACCOUNT_CATALOG_OUTPUT ?? resolve(repo, 'client-unity/UnityProject/Assets/Resources/Account');
const sources = ['crates/rh-persist/data/cosmetics.json', 'packages/shared/src/cosmetics.ts', 'packages/shared/src/achievements.ts',
 'packages/shared/src/constants.ts', 'crates/rh-persist/src/achievements.rs', 'crates/rh-persist/tests/fixtures/achievements.json'];
const read = (path: string) => readFileSync(resolve(repo, path), 'utf8');
const rust = JSON.parse(read(sources[0]!));
assert.deepEqual(rust, COSMETICS, 'Rust authoritative cosmetics and shared presentation catalog drifted');
const fixture = JSON.parse(read(sources[5]!));
assert.deepEqual(fixture.catalog.map(({ id, reward }: any) => ({ id, reward })), ACHIEVEMENTS.map(({ id, reward }) => ({ id, reward })), 'Shared achievement IDs/rewards differ from Rust parity fixture');
assert.equal(new Set(COSMETICS.map(c => c.id)).size, COSMETICS.length);
assert.equal(new Set(ACHIEVEMENTS.map(a => a.id)).size, ACHIEVEMENTS.length);
for (const a of ACHIEVEMENTS) for (const reward of a.reward) assert.ok(COSMETICS.some(c => c.id === reward));
const cosmetics = JSON.stringify(rust, null, 2) + '\n';
const achievements = JSON.stringify(ACHIEVEMENTS.map(({ id, name, desc, reward }) => ({ id, name, desc, reward })), null, 2) + '\n';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const files = { 'cosmetics.json': cosmetics, 'achievements.json': achievements };
const manifest = JSON.stringify({ format: 'rh-account-presentation/1', authority: 'server-only',
 cosmetics: COSMETICS.length, achievements: ACHIEVEMENTS.length,
 sources: Object.fromEntries(sources.map(path => [path, sha(read(path))])),
 outputs: Object.fromEntries(Object.entries(files).map(([path, text]) => [path, sha(text)])) }, null, 2) + '\n';
for (const [name, text] of Object.entries({ ...files, 'catalog-source.json': manifest })) {
 const path = resolve(output, name);
 if (process.argv.includes('--check')) assert.equal(readFileSync(path, 'utf8'), text, name + ' differs; reconcile source then intentionally export');
 else writeFileSync(path, text);
}
console.log(`Verified/exported ${COSMETICS.length} cosmetics and ${ACHIEVEMENTS.length} presentation-only achievements`);
