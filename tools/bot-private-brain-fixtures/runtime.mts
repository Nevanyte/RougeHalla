import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
export const ROOT = process.env.RH_BOT_BRAIN_SOURCE_ROOT ?? '/repo';
const source = (p: string) => import(pathToFileURL(join(ROOT, p)).href);
export const shared = await source('packages/shared/src/index.ts');
export const types = await source('packages/server/src/bots/brain/types.ts');
export const brain = await source('packages/server/src/bots/brain/brain.ts');
export const hand = await source('packages/server/src/bots/brain/humanizer.ts');
export const knowledge = await source('packages/server/src/bots/brain/knowledge.ts');
export const services = await source('packages/server/src/bots/brain/services.ts');
export const registry = await source('packages/server/src/bots/brain/modules/index.ts');
export const mapgen = await source('packages/shared/src/mapgen.ts');
export const mapWire = await source('packages/shared/src/mapWire.ts');
export const modules: any = {};
for (const name of ['wishes','planning','chests','hazards']) {
  modules[name] = (await source('packages/server/src/bots/brain/modules/' + name + '.ts'))[name + 'Module'];
}
export function resetRegistry() {
  registry.resetModules();
  for (const m of Object.values(modules)) registry.registerModule(m);
}
// Same read-only actual-source extraction recipe as knowledge-repair-fixtures/capture.mts28..44.
const text = readFileSync(join(ROOT, 'packages/server/src/bots/brain/brain.ts'), 'utf8');
const start = text.indexOf('function derive(seed: number, tag: number): number {');
assert(start >= 0);
// Braces are balanced explicitly; no imports/source rewriting or constructor instrumentation.
function extract() {
  let n = 0;
  for (let i = text.indexOf('{',start); i < text.length; i++) {
    if (text[i] === '{') n++;
    else if (text[i] === '}' && --n === 0) return text.slice(start, i+1);
  }
  throw Error('derive source unbalanced');
}
export const deriveSource = extract();
export const derive = new Function(deriveSource.replace(/: number/g, '') + '; return derive;')();
export const wiring = text.split('\n').filter(s => s.includes('mulberry32(derive(cfg.seed,') || s.includes('createKnowledge(tier, knowledgeRng)'));
assert.equal(wiring.length, 5);
