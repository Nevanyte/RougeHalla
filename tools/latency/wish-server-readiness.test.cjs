'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { ownsLoopbackListener, waitOwnedServer } = require('./wish-server-readiness.cjs');

// Real local Node HTTP children exercise OS descriptor ownership; they are not
// a Rust gameplay, browser or Unity proof.
async function startChild(t, port = 0, listen = true) {
  const child = spawn(process.execPath, ['-e', `
    const http = require('node:http');
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Connection', 'close');
      res.end(JSON.stringify({protocol:13, state:'ready', contentHash:'synthetic-fixture'}));
    });
    server.on('error', error => { console.error(error.code); process.exit(7); });
    process.on('message', message => {
      if (message === 'close') server.close(() => process.send('closed'));
    });
    ${listen ? `server.listen(${port}, '127.0.0.1', () => console.log(server.address().port));` : "console.log('idle');"}
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let logs = '';
  child.stderr.on('data', data => { logs += data; });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
    try { await exited; } finally { clearTimeout(timer); }
  });
  const line = await Promise.race([
    once(child.stdout, 'data').then(([data]) => data.toString().trim()),
    once(child, 'exit').then(() => { throw new Error(`fixture exited: ${logs}`); }),
  ]);
  return { child, port: listen ? Number(line) : null, logs: () => logs };
}

test('real direct child loopback listener plus /info yields PID-bound readiness', { timeout: 10000 }, async t => {
  const owned = await startChild(t);
  assert.equal(await ownsLoopbackListener(owned.child.pid, owned.port), true);
  const ready = await waitOwnedServer(owned.port, owned.child, owned.logs, () => null);
  assert.equal(ready.info.protocol, 13);
  assert.equal(ready.ownership.pid, owned.child.pid);
  assert.equal(ready.ownership.endpoint, `127.0.0.1:${owned.port}`);
  assert.match(ready.ownership.method, /before and after/);
});

test('healthy foreign /info and an alive non-listening child never satisfy readiness', { timeout: 10000 }, async t => {
  const foreign = await startChild(t);
  const idle = await startChild(t, 0, false);
  assert.equal(await ownsLoopbackListener(idle.child.pid, foreign.port), false);
  let fetches = 0;
  await assert.rejects(waitOwnedServer(foreign.port, idle.child, idle.logs, () => null, {
    timeoutMs: 250,
    fetchInfo: async (...args) => { fetches++; return fetch(...args); },
  }), /direct child ownership/);
  assert.equal(fetches, 0, 'do not even use /info from the process that won the port');
  assert.equal((await (await fetch(`http://127.0.0.1:${foreign.port}/info`)).json()).protocol, 13);
  assert.equal(foreign.child.exitCode, null, 'foreign listener was not signalled');
});

test('a child losing its port during HTTP readiness fails closed', { timeout: 10000 }, async t => {
  const owned = await startChild(t);
  await assert.rejects(waitOwnedServer(owned.port, owned.child, owned.logs, () => null, {
    fetchInfo: async (...args) => {
      const response = await fetch(...args);
      const closed = once(owned.child, 'message');
      owned.child.send('close');
      const [message] = await closed;
      assert.equal(message, 'closed');
      return response;
    },
  }), /lost direct child listener ownership/);
  assert.equal(owned.child.exitCode, null, 'the fixture remains alive after releasing its listener');
});

test('invalid PID and exited child cannot borrow a healthy listener', { timeout: 10000 }, async t => {
  const owned = await startChild(t);
  await assert.rejects(ownsLoopbackListener(0, owned.port), /valid direct child PID/);
  await assert.rejects(waitOwnedServer(owned.port,
    { pid: owned.child.pid, exitCode: 7, signalCode: null }, () => 'bind failure', () => null), /exited before ready/);
});
