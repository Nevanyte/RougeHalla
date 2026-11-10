'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseUrl, safeBrowserArguments, browserLaunchOptions, assessBrowserArguments, classifyRenderer,
  sameRoom, visitUrl, assetPath, run, SOURCE_PORT, WEB_PORT } = require('./profile-m5-b.cjs');

test('default/import and unreviewed run cannot start a browser, listener or child', async () => {
  await assert.rejects(run({}, {}), { fixedCode: 'BROWSER_REVIEW_REQUIRED' });
});

test('only the exact existing peer-socket DB or a dedicated credential-free local DB is admitted', () => {
  const good = 'postgresql://rh_game@localhost/rh_m5_profile?host=%2Fprivate%2Ftmp%2Frh-profile-pg&port=65439';
  assert.equal(databaseUrl(good), good);
  const existing = 'postgresql://rh_game@localhost/roguehalla?host=%2Fprivate%2Ftmp%2Frh-browser-c52-pg-65439&port=65439';
  assert.equal(databaseUrl(existing), existing);
  for (const bad of [undefined, 'postgresql://u:secret@localhost/rh_m5_profile?host=%2Ftmp&port=65439',
    'postgresql://rh_game@remote/rh_m5_profile?host=%2Ftmp&port=65439',
    'postgresql://rh_game@localhost/roguehalla?host=%2Ftmp&port=65439',
    'postgresql://wrong_role@localhost/rh_m5_profile?host=%2Ftmp&port=65439',
    'postgresql://rh_game@localhost/rh_m5_profile?host=%2Ftmp&port=65439&password=secret',
    'postgresql://rh_game@localhost/rh_m5_profile?host=%2Ftmp&host=%2Fother&port=65439',
    'postgresql://rh_game@localhost/rh_m5_profile?host=remote&port=65439']) {
    assert.throws(() => databaseUrl(bad), { fixedCode: 'DATABASE_PREREQUISITE' });
  }
});

test('normal Hub account API and WS both target the isolated native process', () => {
  const u = new URL(visitUrl());
  assert.equal(u.origin, `http://127.0.0.1:${WEB_PORT}`);
  assert.equal(u.searchParams.get('server'), `ws://127.0.0.1:${SOURCE_PORT}/ws`);
  assert.equal(u.searchParams.get('accountApi'), `http://127.0.0.1:${SOURCE_PORT}/api`);
  assert.deepEqual([...u.searchParams.keys()].sort(), ['accountApi', 'server']);
  assert.equal(u.username + u.password, '');
});

test('static routing admits exact local GET/HEAD paths without a proxy fallback', () => {
  assert.equal(assetPath('GET', `127.0.0.1:${WEB_PORT}`, '/?server=local'), '/');
  assert.equal(assetPath('HEAD', `127.0.0.1:${WEB_PORT}`, '/Build/Web.wasm'), '/Build/Web.wasm');
  assert.equal(assetPath('GET', 'play.rougehalla.com', '/'), null);
  assert.equal(assetPath('POST', `127.0.0.1:${WEB_PORT}`, '/api/profile/name'), null);
});

test('same-room gate requires both admitted peers, exact P14/content and owner MatchId', () => {
  const owner = { matchId: '01020304050607080910111213141516' };
  const fake = (overrides = {}) => ({ view: () => ({ connected: true, errors: [], rejects: [],
    welcome: { protocol: 14, contentHash: '7c6a633f68c2cc72', match: Buffer.from(owner.matchId, 'hex') }, ...overrides }) });
  assert.equal(sameRoom(owner, [fake(), fake()]), true);
  assert.equal(sameRoom(owner, [fake()]), false);
  assert.equal(sameRoom(owner, [fake(), fake({ errors: ['rejected'] })]), false);
  assert.equal(sameRoom(owner, [fake(), fake({ connected: false })]), false);
  assert.equal(sameRoom(owner, [fake(), fake({ welcome: { protocol: 14, contentHash: '7c6a633f68c2cc72', match: Buffer.alloc(16) } })]), false);
});

test('browser flag reporting omits ephemeral profile and debugging-address values', () => {
  assert.deepEqual(safeBrowserArguments(['--enable-automation', '--user-data-dir=/tmp/fresh-private', '--remote-debugging-port=12345']),
    ['--enable-automation', '--user-data-dir=<fresh temporary profile; path omitted>', '--remote-debugging-port=<owned ephemeral port>']);
});

test('launch policy enables sandbox and excludes only the unsafe SwiftShader default', () => {
  assert.deepEqual(browserLaunchOptions(), { headless: false, args: [], chromiumSandbox: true,
    ignoreDefaultArgs: ['--enable-unsafe-swiftshader'] });
});

test('effective arguments reject forbidden switch presence including false-valued spellings', () => {
  assert.deepEqual(assessBrowserArguments(['--enable-automation', '--remote-debugging-pipe']),
    { noSandboxPresent: false, unsafeSwiftshaderPresent: false, accepted: true });
  for (const flag of ['--no-sandbox', '--no-sandbox=false', '--enable-unsafe-swiftshader', '--enable-unsafe-swiftshader=false']) {
    assert.equal(assessBrowserArguments(['--enable-automation', flag]).accepted, false);
  }
});

test('renderer classification uses actual concrete descriptors and gives software priority', () => {
  for (const raw of ['Google SwiftShader', 'llvmpipe (LLVM)', 'softpipe', 'lavapipe', 'Software Rasterizer',
    'Microsoft Basic Render Driver', 'WARP', 'ANGLE (Apple M5 Pro, SwiftShader)']) {
    const v = classifyRenderer([{ renderer: raw }]);
    assert.equal(v.classification, 'software', raw); assert.equal(v.available, true); assert.equal(v.rawRenderer, raw);
  }
  for (const raw of ['ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)',
    'NVIDIA GeForce RTX 3080', 'AMD Radeon Pro', 'Intel(R) UHD Graphics 630']) {
    assert.equal(classifyRenderer([{ renderer: raw }]).classification, 'hardware-indicated', raw);
  }
  for (const raw of ['ANGLE', 'Metal', 'WebKit WebGL', 'Intel', '', '  ']) {
    assert.equal(classifyRenderer([{ renderer: raw }]).classification, 'unknown', raw);
  }
  assert.deepEqual({ available: classifyRenderer(null).available, classification: classifyRenderer(null).classification },
    { available: false, classification: 'unknown' });
});
