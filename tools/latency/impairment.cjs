'use strict';

// Deterministic, ordered delay scheduler for a byte stream. It never drops or reorders bytes.
function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function sampleDelay(oneWayMs, jitterMs, random) {
  if (!Number.isFinite(oneWayMs) || oneWayMs < 0 || !Number.isFinite(jitterMs) || jitterMs < 0)
    throw new RangeError('delay and jitter must be finite non-negative milliseconds');
  return Math.max(0, oneWayMs + (random() * 2 - 1) * jitterMs);
}

function fifoReadyTimes(delays, startAt = 0, arrivals = null) {
  let tail = startAt;
  return delays.map((delay, index) => {
    if (!Number.isFinite(delay) || delay < 0) throw new RangeError('sampled delays must be finite and non-negative');
    const arrival = arrivals ? arrivals[index] : startAt;
    if (!Number.isFinite(arrival) || arrival < startAt) throw new RangeError('arrival times must be finite and >= startAt');
    tail = Math.max(arrival + delay, tail);
    return tail;
  });
}

class FifoDelay {
  constructor({ oneWayMs = 0, jitterMs = 0, seed = 1, onForward = () => {} } = {}) {
    if (!Number.isFinite(oneWayMs) || oneWayMs < 0 || !Number.isFinite(jitterMs) || jitterMs < 0)
      throw new RangeError('delay and jitter must be finite non-negative milliseconds');
    this.oneWayMs = oneWayMs;
    this.jitterMs = jitterMs;
    this.random = seededRandom(seed);
    this.onForward = onForward;
    this.tailAt = 0;
    this.closed = false;
    this.ended = false;
    this.onDrained = null;
    this.queue = [];
    this.stats = { chunks: 0, bytes: 0, sampledDelayMs: [], queueWaitMs: [] };
  }

  push(bytes, write) {
    if (this.closed || this.ended) return;
    this.pushWithDelay(bytes, write, sampleDelay(this.oneWayMs, this.jitterMs, this.random), false);
  }

  pushWithDelay(bytes, write, sampledMs, stall = false) {
    if (this.closed || this.ended) return;
    const now = performance.now();
    const dueAt = Math.max(now + sampledMs, this.tailAt);
    this.tailAt = dueAt;
    const item = { bytes, write, enqueuedAt: now, dueAt, sampledMs, stall };
    this.queue.push(item);
    this.#schedule();
  }

  // A TCP FIN follows the bytes already queued in this direction. It is not an abort.
  end(onDrained) {
    if (this.closed || this.ended) return;
    this.ended = true;
    this.onDrained = onDrained;
    this.#schedule();
  }

  close() {
    this.closed = true;
    this.onDrained = null;
    if (this.timer) clearTimeout(this.timer);
    this.queue.length = 0;
  }

  #schedule() {
    if (this.timer || this.closed) return;
    if (this.queue.length === 0) {
      const onDrained = this.onDrained;
      this.onDrained = null;
      if (onDrained) onDrained();
      return;
    }
    const waitMs = Math.max(0, this.queue[0].dueAt - performance.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      const item = this.queue.shift();
      if (item && !this.closed) {
        const forwardedAt = performance.now();
        item.write(item.bytes);
        this.stats.chunks++;
        this.stats.bytes += item.bytes.length;
        this.stats.sampledDelayMs.push(item.sampledMs);
        this.stats.queueWaitMs.push(Math.max(0, forwardedAt - item.enqueuedAt));
        this.onForward({ bytes: item.bytes.length, sampledMs: item.sampledMs, stall: item.stall, enqueuedAt: item.enqueuedAt, forwardedAt });
      }
      this.#schedule();
    }, waitMs);
  }
}

module.exports = { FifoDelay, fifoReadyTimes, sampleDelay, seededRandom };
