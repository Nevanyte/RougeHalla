import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connectNormalCompanion, companionContentHash, companionProtocol } from './normal-companion.mjs';

const vectors = JSON.parse(readFileSync(new URL('../../protocol/fixtures/v14.json', import.meta.url), 'utf8'));
const serverVector = name => vectors.server.find(row => row.name === name).hex;
const clientVector = name => vectors.client.find(row => row.name === name).hex;
const fromHex = hex => Uint8Array.from(hex.match(/../g), byte => Number.parseInt(byte, 16)).buffer;

function codec() {
  const html = readFileSync(new URL('../../crates/rh-server/web/probe.html', import.meta.url), 'utf8');
  const start = html.indexOf('// ---- protocol v14 '), end = html.indexOf('// ---- probe state', start);
  return new Function(`${html.slice(start, end)}\nreturn { decodeClient };`)();
}

const protocol = codec();
const issuedToken = 'private-claimed-profile-token-never-report';

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = String(url);
    this.readyState = 0;
    this.binaryType = 'blob';
    this.handlers = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => { this.readyState = 1; this.#emit('open', {}); });
  }
  addEventListener(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.handlers.get(type)?.delete(fn); }
  #emit(type, event) { for (const fn of [...(this.handlers.get(type) ?? [])]) fn(event); }
  send(frame) {
    const bytes = frame instanceof Uint8Array ? new Uint8Array(frame) : new Uint8Array(frame);
    this.sent.push(bytes);
    if (bytes[0] === 1) {
      const hello = protocol.decodeClient(bytes.buffer);
      FakeWebSocket.lastHello = hello;
      for (const name of ['welcome', 'snapshot', 'state_trade_available']) {
        let frame = fromHex(serverVector(name));
        if (name === 'welcome') {
          const copy = new Uint8Array(frame.slice(0));
          new DataView(copy.buffer).setBigUint64(3, BigInt(`0x${companionContentHash}`), true);
          frame = copy.buffer;
        }
        queueMicrotask(() => this.#emit('message', { data: frame }));
      }
    }
  }
  close() { this.readyState = 3; queueMicrotask(() => this.#emit('close', {})); }
  deliver(data) { this.#emit('message', { data }); }
}

function fakeFetch({ info = { protocol: 14, contentHash: companionContentHash }, claim } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/info')) return new Response(JSON.stringify(info), { status: 200 });
    const profile = decodeURIComponent(new URL(String(url)).pathname.split('/').at(-1));
    const body = claim ?? { created: true, profile: { name: profile }, token: issuedToken };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { calls, fetchImpl };
}

test('claims a fresh profile and sends its credential only in the ordinary Hello frame', async () => {
  FakeWebSocket.instances = [];
  const { calls, fetchImpl } = fakeFetch();
  const companion = await connectNormalCompanion({ endpoint: 'http://127.0.0.1:7777', profile: 'source14_test', faction: 4,
    fetchImpl, WebSocketImpl: FakeWebSocket, timeoutMs: 1000 });
  try {
    assert.equal(companionProtocol, 14);
    assert.equal(companion.view().welcome.protocol, 14);
    assert.equal(companion.view().welcome.contentHash, companionContentHash);
    assert.equal(FakeWebSocket.lastHello.t, 'hello');
    assert.equal(FakeWebSocket.lastHello.protocol, 14);
    assert.equal(FakeWebSocket.lastHello.profile, 'source14_test');
    assert.equal(new TextDecoder().decode(FakeWebSocket.lastHello.ticket), issuedToken);
    assert.equal(FakeWebSocket.lastHello.faction, 4);
    assert.equal(FakeWebSocket.instances[0].url, 'ws://127.0.0.1:7777/ws');
    assert.equal(new URL(FakeWebSocket.instances[0].url).search, '');
    assert.equal(calls[0].url, 'http://127.0.0.1:7777/info');
    assert.equal(calls[1].url, 'http://127.0.0.1:7777/api/profile/source14_test');
    assert.equal(calls[1].init.method, 'GET');
    assert.equal(calls[1].init.headers.has('x-playtest-passcode'), false);
    assert.ok(calls.every(call => call.init.signal instanceof AbortSignal));
    assert.equal(calls.some(call => call.url.includes(issuedToken)), false);

    const view = companion.view();
    assert.ok(view.snapshot);
    assert.equal(Object.hasOwn(view.welcome, 'session'), false);
    assert.ok(Array.isArray(view.welcome.match));
    assert.ok(view.welcome.map.tiles instanceof Uint8Array);
    assert.ok(view.collections.some(([key]) => key === 11));
    view.snapshot.me.hp = -123;
    view.welcome.map.tiles[0] ^= 1;
    view.collections.find(([key]) => key === 11)[1].tradeUsed = 'mutated-copy';
    assert.notEqual(companion.view().snapshot.me.hp, -123);
    assert.notEqual(companion.view().welcome.map.tiles[0], view.welcome.map.tiles[0]);
    assert.notEqual(companion.view().collections.find(([key]) => key === 11)[1].tradeUsed, 'mutated-copy');

    const accepted = companion.send([{ k: 'move', x: 10, y: 20 }, { k: 'pickup', handle: 41 },
      { k: 'choose', handle: 42, pick: 1 }, { k: 'plan', ready: true }]);
    assert.deepEqual(accepted, { seq: 1, commandCount: 4 });
    const inputFrame = FakeWebSocket.instances[0].sent.find(frame => frame[0] === 2);
    const decoded = protocol.decodeClient(inputFrame.buffer.slice(inputFrame.byteOffset, inputFrame.byteOffset + inputFrame.byteLength));
    assert.equal(decoded.t, 'input');
    assert.equal(decoded.seq, 1);
    assert.deepEqual(decoded.cmds.map(row => row.k), ['move', 'pickup', 'choose', 'plan']);
    assert.equal(decoded.cmds[0].seq, 1);
    assert.equal(decoded.cmds[3].ready, true);
    assert.equal(companion.sanitizedReport().errorCodes.length, 0);
    const safe = JSON.stringify({ view: companion.view(), report: companion.sanitizedReport() });
    assert.equal(safe.includes(issuedToken), false);
  } finally {
    await companion.leaveAndClose(100);
  }
});

test('rejects non-loopback and identity-mismatched endpoints before profile claim or socket creation', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('{}'); };
  await assert.rejects(connectNormalCompanion({ endpoint: 'http://example.test', fetchImpl, WebSocketImpl: FakeWebSocket }), /loopback/);
  assert.equal(calls, 0);

  const mismatch = fakeFetch({ info: { protocol: 13, contentHash: companionContentHash } });
  const before = FakeWebSocket.instances.length;
  await assert.rejects(connectNormalCompanion({ endpoint: 'http://localhost:7777', fetchImpl: mismatch.fetchImpl,
    WebSocketImpl: FakeWebSocket }), /identity mismatch/);
  assert.equal(mismatch.calls.length, 1);
  assert.equal(FakeWebSocket.instances.length, before);
});

test('does not expose a failed claim response body or accept an existing profile token', async () => {
  const { fetchImpl } = fakeFetch({ claim: { created: false, profile: { name: 'r14_test' }, token: issuedToken } });
  await assert.rejects(connectNormalCompanion({ endpoint: 'http://127.0.0.1:7777', fetchImpl, WebSocketImpl: FakeWebSocket }), error => {
    assert.match(error.message, /fresh credential/);
    assert.equal(error.message.includes(issuedToken), false);
    return true;
  });
});

test('refuses training/debug command kinds before any frame is written', async () => {
  FakeWebSocket.instances = [];
  const { fetchImpl } = fakeFetch();
  const companion = await connectNormalCompanion({ endpoint: 'http://127.0.0.1:7777', fetchImpl,
    WebSocketImpl: FakeWebSocket, timeoutMs: 1000 });
  try {
    const socket = FakeWebSocket.instances[0];
    const framesBefore = socket.sent.length;
    assert.throws(() => companion.send([{ k: 'train', command: 1, id: 1, count: 1n }]), /ordinary public commands/);
    assert.equal(socket.sent.length, framesBefore);
  } finally {
    await companion.leaveAndClose(100);
  }
});

test('terminalizes malformed frames and Reject before a later close event can permit another send', async () => {
  for (const sample of [
    { label: 'malformed', data: new Uint8Array([0xff]).buffer, error: 'malformed_server_frame', rejectCode: null },
    { label: 'Reject', data: fromHex(serverVector('reject')), error: 'server_rejected', rejectCode: true },
  ]) {
    FakeWebSocket.instances = [];
    const { fetchImpl } = fakeFetch();
    const companion = await connectNormalCompanion({ endpoint: 'http://127.0.0.1:7777', fetchImpl,
      WebSocketImpl: FakeWebSocket, timeoutMs: 1000 });
    try {
      const socket = FakeWebSocket.instances[0];
      const before = socket.sent.length;
      socket.deliver(sample.data);
      assert.equal(companion.view().errors[0], sample.error, sample.label);
      assert.equal(companion.view().rejects.length > 0, sample.rejectCode === true, sample.label);
      assert.throws(() => companion.send([{ k: 'move', x: 1, y: 2 }]), /not admitted/);
      assert.equal(socket.sent.length, before, `${sample.label}: no queued frame after terminal input`);
      await assert.rejects(companion.waitFor(() => false, 100), /companion failed/);
    } finally {
      await companion.leaveAndClose(100);
    }
  }
});

test('bounds the HTTP identity and claim stages with one validated timeout value', async () => {
  let calls = 0;
  await assert.rejects(connectNormalCompanion({ endpoint: 'http://127.0.0.1:7777', timeoutMs: Infinity,
    fetchImpl: async () => { calls++; }, WebSocketImpl: FakeWebSocket }), /timeoutMs/);
  assert.equal(calls, 0);
});
