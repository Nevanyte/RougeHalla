'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FifoDelay, fifoReadyTimes, seededRandom, sampleDelay } = require('./impairment.cjs');
const { evaluate, quantiles } = require('./report.cjs');

test('FIFO schedule never forwards a later chunk before its predecessor', () => {
  assert.deepEqual(fifoReadyTimes([30, 0, 5]), [30, 30, 30]);
  assert.deepEqual(fifoReadyTimes([20, 0, 1], 0, [0, 10, 20]), [20, 20, 21]);
});

test('seeded jitter is reproducible and remains within its configured bound', () => {
  const first = seededRandom(42), second = seededRandom(42);
  const a = Array.from({ length: 100 }, () => sampleDelay(25, 7, first));
  const b = Array.from({ length: 100 }, () => sampleDelay(25, 7, second));
  assert.deepEqual(a, b);
  assert.ok(a.every(v => v >= 18 && v <= 32));
});

test('runtime delay writer preserves chunk order under adverse per-chunk delay', async () => {
  const got = [];
  const queue = new FifoDelay({ onForward: () => {} });
  queue.pushWithDelay(Buffer.from('first'), b => got.push(b.toString()), 25);
  queue.pushWithDelay(Buffer.from('second'), b => got.push(b.toString()), 0);
  await new Promise(resolve => setTimeout(resolve, 40));
  queue.close();
  assert.deepEqual(got, ['first', 'second']);
});

function completeReport() {
  return {
    expectedTrials: 1,
    trials: [{
      keyboardEvent: { at: 1 }, inputSample: { at: 2, seq: 4, frame: 12 }, moveSent: { at: 2.4, seq: 4, frame: 12, sameUnityFrame: true },
      selfEcho: { seq: 4 }, selfPresented: { seq: 4 }, opponentBaseline: { at: 0, stableMs: 400, actor: 8 }, opponentPresented: { at: 227, actor: 8 },
      keyboardToSendMs: 2, sampleToSendMs: 0.4, sendToEchoMs: 80, echoToPresentMs: 10,
      sampleToPresentMs: 90, sampleToOpponentMs: 225, traceOverflow: false, observerOverflow: false, traceErrors: []
    }], errors: [], pageErrors: []
  };
}

test('report completeness requires sampled input, wire, echo, both presentations and every trial', () => {
  assert.equal(evaluate(completeReport()).status, 'PASS');
  const missingObserver = completeReport(); missingObserver.trials[0].opponentPresented = null;
  assert.equal(evaluate(missingObserver).status, 'INCOMPLETE');
  const missingTrial = completeReport(); missingTrial.expectedTrials = 2;
  assert.equal(evaluate(missingTrial).status, 'INCOMPLETE');
});

test('report fails sequence/frame mismatches, trace overflow, and page errors', () => {
  const wrongSeq = completeReport(); wrongSeq.trials[0].selfEcho.seq = 5;
  assert.equal(evaluate(wrongSeq).status, 'FAIL');
  const wrongFrame = completeReport(); wrongFrame.trials[0].moveSent.frame = 13;
  assert.equal(evaluate(wrongFrame).status, 'FAIL');
  const overflow = completeReport(); overflow.trials[0].traceOverflow = true;
  assert.equal(evaluate(overflow).status, 'FAIL');
  const pageError = completeReport(); pageError.pageErrors.push('Unity page error');
  assert.equal(evaluate(pageError).status, 'FAIL');
});

test('latency quantiles use nearest-rank p50 and p95', () => {
  assert.deepEqual(quantiles([10, 30, 20, 40]), { count: 4, p50Ms: 20, p95Ms: 40, maxMs: 40 });
});

test('earlier interpolated motion and unsettled baselines cannot pass as the current input response', () => {
  const beforeInput = completeReport(); beforeInput.trials[0].opponentPresented.at = 1;
  assert.equal(evaluate(beforeInput).status, 'FAIL');
  const stillSettling = completeReport(); stillSettling.trials[0].opponentBaseline.stableMs = 100;
  assert.equal(evaluate(stillSettling).status, 'FAIL');
});

test('driver identity, runtime errors and unexercised requested stalls cannot silently pass', () => {
  const wrongDriver = completeReport(); wrongDriver.players = { driver: 9 }; wrongDriver.trials[0].inputSample.player = 10;
  assert.equal(evaluate(wrongDriver).status, 'FAIL');
  const runtime = completeReport(); runtime.errors.push('failed browser run');
  assert.equal(evaluate(runtime).status, 'FAIL');
  const noStall = completeReport(); noStall.proxyRun = { config: { stallEvery: 20 }, connections: [] };
  assert.equal(evaluate(noStall).status, 'INCOMPLETE');
  const missingCount = completeReport(); delete missingCount.expectedTrials;
  assert.equal(evaluate(missingCount).status, 'INCOMPLETE');
});

test('real TCP half-close drains delayed request and response bytes before forwarding FIN', async () => {
  const net = require('node:net');
  const { startProxy } = require('./ws-proxy.cjs');
  const peers = new Set();
  let received = '', sawRequestFin = false;
  const server = net.createServer(socket => {
    peers.add(socket);
    socket.on('close', () => peers.delete(socket));
    socket.on('data', data => { received += data.toString(); });
    socket.on('end', () => { sawRequestFin = true; socket.end(`ACK:${received}`); });
  });
  let proxy, client;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    proxy = await startProxy({ targetPort: server.address().port, oneWayMs: 20 });
    const response = await new Promise((resolve, reject) => {
      let data = '';
      const timeout = setTimeout(() => reject(new Error('half-close did not drain within 3s')), 3000);
      client = net.connect({ host: '127.0.0.1', port: proxy.port, allowHalfOpen: true });
      client.on('connect', () => { client.write('first:'); client.end('last'); });
      client.on('data', bytes => { data += bytes.toString(); });
      client.once('end', () => { clearTimeout(timeout); resolve(data); });
      client.once('error', error => { clearTimeout(timeout); reject(error); });
    });
    assert.equal(sawRequestFin, true);
    assert.equal(received, 'first:last', 'all queued request bytes precede request FIN');
    assert.equal(response, 'ACK:first:last', 'a closed upstream socket must not erase its delayed response');
  } finally {
    if (client) client.destroy();
    if (proxy) await proxy.close();
    for (const peer of peers) peer.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});

test('self-signed mode requires both player and server origins to be loopback', () => {
  const { validateSelfSignedOrigins } = require('./ws-proxy.cjs');
  for (const [playerUrl, serverUrl] of [
    ['http://127.0.0.1:8097/', 'wss://localhost:7798/ws'],
    ['https://localhost:8097/', 'wss://127.0.0.1:7798/ws'],
    ['https://[::1]:8097/', 'wss://[::1]:7798/ws'],
  ]) assert.doesNotThrow(() => validateSelfSignedOrigins({ allowSelfSigned: true, playerUrl, serverUrl }));
  for (const [playerUrl, serverUrl] of [
    ['https://external.example/', 'wss://localhost:7798/ws'],
    ['http://127.0.0.1:8097/', 'wss://external.example/ws'],
    ['https://external.example/', 'wss://external.example/ws'],
  ]) assert.throws(() => validateSelfSignedOrigins({ allowSelfSigned: true, playerUrl, serverUrl }), /loopback player and server/);
  assert.doesNotThrow(() => validateSelfSignedOrigins({ allowSelfSigned: false,
    playerUrl: 'https://external.example/', serverUrl: 'wss://external.example/ws' }), 'normal public TLS validation remains enabled');
});

test('browser close failure still attempts proxy report, proxy close and a failing saved verdict', async () => {
  const { finalizeRun } = require('./runtime.cjs');
  const { attachSummary } = require('./report.cjs');
  const report = completeReport(), stages = [];
  await finalizeRun({ report,
    browser: { close: async () => { stages.push('browser'); throw new Error('browser transport failed'); } },
    proxy: {
      report: () => { stages.push('proxy report'); return { closed: true }; },
      close: async () => { stages.push('proxy close'); throw new Error('proxy close failed'); },
    },
    saveReport: () => { stages.push('save'); attachSummary(report); },
  });
  assert.deepEqual(stages, ['browser', 'proxy report', 'proxy close', 'save']);
  assert.equal(report.proxyRun.closed, true);
  assert.equal(report.errors.length, 2);
  assert.match(report.errors[0], /browser close:.*browser transport failed/);
  assert.equal(report.summary.status, 'FAIL', 'cleanup errors cannot leave a passing report');
});

test('Playwright resolves from the checkout, NODE_PATH or the explicit override without private defaults', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const { loadPlaywright } = require('./runtime.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-latency-resolution-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
    const moduleDir = path.join(root, 'node_modules/playwright'); fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'index.js'), 'module.exports={source:"checkout"}');
    const override = path.join(root, 'override.cjs'); fs.writeFileSync(override, 'module.exports={source:"override"}');
    assert.equal(loadPlaywright(root, '').source, 'checkout');
    assert.equal(loadPlaywright(root, override).source, 'override');
    assert.throws(() => loadPlaywright(root, path.join(root, 'missing.cjs')), /Cannot load Playwright/);
    fs.rmSync(moduleDir, { recursive: true, force: true });
    const emptyRoot = path.join(root, 'empty'); fs.mkdirSync(emptyRoot);
    fs.writeFileSync(path.join(emptyRoot, 'package.json'), '{"private":true}');
    const globalPath = path.join(root, 'standard-node-path'); fs.mkdirSync(path.join(globalPath, 'playwright'), { recursive: true });
    fs.writeFileSync(path.join(globalPath, 'playwright/index.js'), 'module.exports={source:"NODE_PATH"}');
    const source = execFileSync(process.execPath, ['-e',
      'process.stdout.write(require(process.argv[1]).loadPlaywright(process.argv[2], "").source)',
      require.resolve('./runtime.cjs'), emptyRoot], { env: { ...process.env, NODE_PATH: globalPath }, encoding: 'utf8' });
    assert.equal(source, 'NODE_PATH');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
