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
