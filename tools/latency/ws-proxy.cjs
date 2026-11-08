'use strict';

const net = require('node:net');
const tls = require('node:tls');
const { FifoDelay, sampleDelay, seededRandom } = require('./impairment.cjs');

function summarize(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return { count: values.length, p50: at(.5), p95: at(.95), max: sorted[sorted.length - 1] };
}

function validateSelfSignedOrigins({ allowSelfSigned, playerUrl, serverUrl }) {
  if (!allowSelfSigned) return;
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (![playerUrl, serverUrl].every(url => loopback.has(new URL(url).hostname)))
    throw new Error('Self-signed TLS test mode is restricted to loopback player and server endpoints.');
}

async function startProxy({ listenHost = '127.0.0.1', listenPort = 0, targetHost = '127.0.0.1', targetPort,
  targetTls = false, targetServerName = targetHost, oneWayMs = 0, jitterMs = 0, seed = 1, stallEvery = 0, stallMs = 0 } = {}) {
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new RangeError('targetPort is required');
  if (!Number.isInteger(stallEvery) || stallEvery < 0 || !Number.isFinite(stallMs) || stallMs < 0) throw new RangeError('invalid ordered stall configuration');
  // Half-closes are forwarded only after their direction's delayed bytes have drained.
  const server = net.createServer({ allowHalfOpen: true });
  const connections = new Set();
  const closedConnections = [];
  let directionSeed = seed >>> 0;
  const profile = { oneWayMs, jitterMs, seed, stallEvery, stallMs };
  server.on('connection', client => {
    const target = targetTls ? tls.connect({ host: targetHost, port: targetPort, servername: targetServerName, allowHalfOpen: true }) : net.connect({ host: targetHost, port: targetPort, allowHalfOpen: true });
    const record = { openedAt: Date.now(), clientAddress: client.remoteAddress, directions: {}, client, target, closed: false };
    connections.add(record);
    const direction = (name, source, destination) => {
      const rng = seededRandom(++directionSeed);
      const delays = [];
      const stalls = [];
      let chunkNo = 0;
      let handshakeBuffer = Buffer.alloc(0), handshakeDone = !targetTls || name !== 'clientToServer';
      const fifo = new FifoDelay({ oneWayMs: 0, jitterMs: 0, onForward: event => {
        delays.push(event.forwardedAt - event.enqueuedAt);
        if (event.stall) stalls.push(event.sampledMs);
      } });
      // Apply the configured distribution per queued TCP read chunk. Each chunk remains FIFO; TCP still supplies a
      // reliable ordered byte stream. Optional periodic stalls model head-of-line delay, never packet loss.
      source.on('data', bytes => {
        chunkNo++;
        if (!handshakeDone) {
          handshakeBuffer = Buffer.concat([handshakeBuffer, bytes]);
          const boundary = handshakeBuffer.indexOf('\r\n\r\n');
          if (boundary < 0) return;
          const header = handshakeBuffer.subarray(0, boundary + 4).toString('latin1')
            .replace(/\r\nHost: [^\r\n]+/i, `\r\nHost: ${targetServerName}${targetPort === 443 ? '' : `:${targetPort}`}`);
          bytes = Buffer.concat([Buffer.from(header, 'latin1'), handshakeBuffer.subarray(boundary + 4)]);
          handshakeBuffer = Buffer.alloc(0); handshakeDone = true;
        }
        const sampled = sampleDelay(profile.oneWayMs, profile.jitterMs, rng);
        const isStall = profile.stallEvery > 0 && chunkNo % profile.stallEvery === 0;
        const delayMs = sampled + (isStall ? profile.stallMs : 0);
        fifo.pushWithDelay(bytes, data => { if (!destination.destroyed) destination.write(data); }, delayMs, isStall);
      });
      source.on('end', () => fifo.end(() => { if (!destination.destroyed) destination.end(); }));
      source.on('error', () => destination.destroy());
      record.directions[name] = { delays, stalls, fifo, get summary() { return summarize(delays); } };
    };
    direction('clientToServer', client, target);
    direction('serverToClient', target, client);
    let closedSides = 0;
    const close = () => {
      // One socket can finish while the opposite direction still has delayed response bytes to deliver.
      if (++closedSides < 2 || record.closed) return;
      record.closed = true;
      for (const value of Object.values(record.directions)) value.fifo.close();
      record.closedAt = Date.now();
      closedConnections.push(record);
      connections.delete(record);
    };
    client.once('close', close); target.once('close', close);
    client.on('error', () => target.destroy()); target.on('error', () => client.destroy());
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(listenPort, listenHost, resolve); });
  const address = server.address();
  return {
    host: address.address,
    port: address.port,
    url: `ws://${listenHost}:${address.port}/ws`,
    config: { oneWayMs, jitterMs, seed, stallEvery, stallMs, targetTls, semantics: 'TCP reliable ordered stream with FIFO chunk delay/jitter; optional periodic ordered stalls model head-of-line blocking, not packet loss.' },
    setProfile({ rttMs = profile.oneWayMs * 2, jitterMs = profile.jitterMs * 2, stallEvery = profile.stallEvery, stallMs = profile.stallMs } = {}) {
      if (![rttMs, jitterMs, stallMs].every(v => Number.isFinite(v) && v >= 0) || !Number.isInteger(stallEvery) || stallEvery < 0)
        throw new RangeError('profile values must be non-negative; stallEvery must be an integer');
      profile.oneWayMs = rttMs / 2; profile.jitterMs = jitterMs / 2; profile.stallEvery = stallEvery; profile.stallMs = stallMs;
      this.config = { ...this.config, oneWayMs: profile.oneWayMs, jitterMs: profile.jitterMs, stallEvery, stallMs,
        configuredRttMs: rttMs, configuredJitterMs: jitterMs };
    },
    report() {
      return {
        config: this.config,
        connections: [...closedConnections, ...connections].map(c => ({
          openedAt: c.openedAt,
          closedAt: c.closedAt ?? null,
          clientAddress: c.clientAddress,
          directions: Object.fromEntries(Object.entries(c.directions).map(([k, d]) => [k, {
            chunks: d.fifo.stats.chunks,
            bytes: d.fifo.stats.bytes,
            actualQueueDelayMs: summarize(d.delays),
            orderedStalls: d.stalls.length,
            stallDelayMs: summarize(d.stalls),
          }]))
        }))
      };
    },
    async close() {
      for (const c of [...connections]) {
        for (const d of Object.values(c.directions)) d.fifo.close();
        c.client.destroy(); c.target.destroy(); c.closed = true;
      }
      connections.clear();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

module.exports = { startProxy, summarize, validateSelfSignedOrigins };
