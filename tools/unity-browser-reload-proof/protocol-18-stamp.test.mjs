// P-PROTOCOL-18-STAMP-1 oracle (JS): the browser probe's decoder (crates/rh-server/web/probe.html, held to the vectors by
// tools/protocol-js/check-*.mjs) and the reload proof's metadata parser speak protocol 18, and both read the generated
// protocol/fixtures/v18.json Hello and Welcome as protocol 18. Run by the gate's reload-proof step whenever
// crates/rh-protocol/ or protocol/fixtures/ changes. P-NET-DRAWAHEAD-1a moved every pin to protocol 19 (v19.json);
// P-SYNC-ORIGIN-1 reads the current v<PROTOCOL>.json (protocol 20). On origin, P-COLISEUM-HEALS-2 took protocol 20
// (v20.json) and P-TICK-3 21 (v21.json); P-SYNC-ORIGIN-2 merged both lines as 22, read the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseWireMetadata } from './wire-metadata.js';

const html = readFileSync(new URL('../../crates/rh-server/web/probe.html', import.meta.url), 'utf8');
const start = html.search(/\/\/ ---- protocol v\d+ /), end = html.indexOf('// ---- probe state', start);
const probe = new Function(`${html.slice(start, end)}\nreturn { PROTOCOL, decode, decodeClient };`)();
// P-WIRE19-A: the readers read the current vectors (v<PROTOCOL>.json) as the current version; v18.json stays history.
const current = new URL(`../../protocol/fixtures/v${probe.PROTOCOL}.json`, import.meta.url);
const fromHex = hex => Uint8Array.from(hex.match(/../g), b => Number.parseInt(b, 16));

function vectors() {
  assert.equal(existsSync(current), true, `protocol/fixtures/v${probe.PROTOCOL}.json is missing (cargo run -p rh-protocol --bin protocol-fixtures)`);
  return JSON.parse(readFileSync(current, 'utf8'));
}

test('probe.html speaks protocol 18 or later and its codec block is marked with its version', () => {
  assert.ok(probe.PROTOCOL >= 18);
  assert.notEqual(html.indexOf(`// ---- protocol v${probe.PROTOCOL} `), -1, 'the codec block marker names the version');
});

test('the probe decodes the current Hello and Welcome as its protocol', () => {
  const v = vectors();
  assert.equal(v.protocol, probe.PROTOCOL);
  const hello = fromHex(v.client.find(r => r.name === 'hello').hex);
  const welcome = fromHex(v.server.find(r => r.name === 'welcome').hex);
  assert.equal(probe.decodeClient(hello.buffer).protocol, probe.PROTOCOL);
  assert.equal(probe.decode(welcome.buffer).protocol, probe.PROTOCOL);
});

test('the reload proof reads the current Hello and Welcome metadata as the probe\'s protocol', () => {
  const v = vectors();
  const hello = parseWireMetadata('client', fromHex(v.client.find(r => r.name === 'hello').hex));
  assert.equal(hello.status, 'metadata', JSON.stringify(hello));
  assert.equal(hello.protocol, probe.PROTOCOL);
  const welcome = parseWireMetadata('server', fromHex(v.server.find(r => r.name === 'welcome').hex));
  assert.equal(welcome.status, 'public-prefix', JSON.stringify(welcome));
  assert.equal(welcome.protocol, probe.PROTOCOL);
});
