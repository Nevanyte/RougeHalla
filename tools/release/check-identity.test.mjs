import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseInfo, bakedHash, codecProtocol, check} from './check-identity.mjs';

const script = fileURLToPath(new URL('./check-identity.mjs', import.meta.url));
const codec = (p) => `public const ushort ProtocolVersion = ${p};`;
const baked = (h) => `public static class BakedContent { public const ulong Hash = 0x${h}UL; }`;
function tree({hash = 'a2d1022ebe713382', proto = 16, proto2 = proto} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ident-'));
  const unity = path.join(root, 'client-unity/UnityProject');
  for (const [p, s] of [['Assets/Scripts/BakedContent.cs', baked(hash)], ['Assets/RoguehallaNet/Protocol/Codec.cs', codec(proto2)],
    ['../RoguehallaNet/Protocol/Codec.cs', codec(proto)]]) {
    const f = path.join(unity, p); mkdirSync(path.dirname(f), {recursive: true}); writeFileSync(f, s);
  }
  return {root, unity};
}
const info = {protocol: 16, content: 'a2d1022ebe713382'};

test('parse helpers', () => {
  assert.deepEqual(parseInfo('{"protocol":16,"contentHash":"A2D1022EBE713382"}'), info);
  assert.deepEqual(parseInfo('{"protocol":16,"content_hash":"a2d1022ebe713382"}'), info);
  assert.throws(() => parseInfo('{"protocol":16,"contentHash":"abc"}'));
  assert.throws(() => parseInfo('{"contentHash":"a2d1022ebe713382"}'));
  assert.equal(bakedHash(baked('06e2cdab2889abc5')), '06e2cdab2889abc5');
  assert.equal(codecProtocol(codec(16)), 16);
});
test('matching tree passes', () => assert.deepEqual(check({info, unity: tree().unity}), []));
test('stale baked hash fails', () => {
  const bad = check({info, unity: tree({hash: '06e2cdab2889abc5'}).unity});
  assert.equal(bad.length, 1); assert.match(bad[0], /06e2cdab2889abc5 != server contentHash a2d1022ebe713382/);
});
test('zero hash fails', () => assert.match(check({info, unity: tree({hash: '0000000000000000'}).unity})[0], /zero/));
test('either codec copy on the wrong protocol fails', () => {
  assert.equal(check({info, unity: tree({proto: 15}).unity}).length, 2);
  assert.equal(check({info, unity: tree({proto: 16, proto2: 14}).unity}).length, 1);
});
test('web build must exist, contain wasm and not predate the bake', () => {
  const {root, unity} = tree();
  const web = path.join(root, 'Build/Web');
  assert.match(check({info, unity, web})[0], /does not exist/);
  mkdirSync(web, {recursive: true}); writeFileSync(path.join(web, 'index.html'), '');
  assert.match(check({info, unity, web})[0], /no \.wasm/);
  const wasm = path.join(web, 'Web.wasm'); writeFileSync(wasm, '');
  assert.deepEqual(check({info, unity, web}), []);
  const old = new Date(Date.now() - 3600e3); utimesSync(wasm, old, old);
  assert.match(check({info, unity, web})[0], /older than BakedContent/);
});
test('CLI exits non-zero loudly on mismatch and zero on match', () => {
  const {root, unity} = tree();
  const good = path.join(root, 'info.json'); writeFileSync(good, '{"protocol":16,"contentHash":"a2d1022ebe713382"}');
  const bad = path.join(root, 'bad.json'); writeFileSync(bad, '{"protocol":16,"contentHash":"1111111111111111"}');
  assert.equal(spawnSync('node', [script, '--info', good, '--unity', unity]).status, 0);
  const r = spawnSync('node', [script, '--info', bad, '--unity', unity], {encoding: 'utf8'});
  assert.equal(r.status, 1); assert.match(r.stderr, /IDENTITY CHECK FAILED/);
});
