'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

// The bind-zero reservation is released before the Rust child starts. An /info
// response alone therefore cannot identify the process that won that port.
async function ownsLoopbackListener(pid, port) {
  if (!Number.isSafeInteger(pid) || pid < 1 || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('listener ownership requires a valid direct child PID and port');
  let stdout;
  try {
    ({ stdout } = await run('lsof', ['-nP', '-a', '-p', String(pid), `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn'],
      { timeout: 1500, maxBuffer: 65536 }));
  } catch (error) {
    if (error.code === 1 && !error.stdout && !error.stderr) return false; // No matching descriptor.
    throw new Error(`cannot verify direct child listener with lsof: ${error.code || error.message}`);
  }
  let processId = null;
  for (const field of stdout.split('\n')) {
    if (field.startsWith('p')) processId = Number(field.slice(1));
    if (processId === pid && field === `n127.0.0.1:${port}`) return true;
  }
  return false;
}

async function waitOwnedServer(port, child, getLogs, spawnFailure, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const inspect = options.inspect ?? ownsLoopbackListener;
  const fetchInfo = options.fetchInfo ?? fetch;
  const deadline = Date.now() + timeoutMs;
  const address = `http://127.0.0.1:${port}/info`;
  const checkChild = () => {
    const failure = spawnFailure();
    if (failure) throw new Error(`rh-server could not be started: ${failure}`);
    if (!Number.isSafeInteger(child.pid) || child.pid < 1 || child.exitCode !== null || child.signalCode !== null)
      throw new Error(`rh-server exited before ready (code=${child.exitCode}, signal=${child.signalCode}): ${getLogs()}`);
  };
  while (Date.now() < deadline) {
    checkChild();
    if (await inspect(child.pid, port)) {
      checkChild();
      let response;
      try {
        response = await fetchInfo(address, { signal: AbortSignal.timeout(Math.max(1, Math.min(1500, deadline - Date.now()))) });
      } catch (_) { /* A listening child may not have finished starting its HTTP service. */ }
      if (response?.ok) {
        const info = await response.json();
        checkChild();
        // Recheck after HTTP too: never accept another listener's response if the
        // child lost the endpoint while the request was in flight.
        if (!await inspect(child.pid, port)) throw new Error('rh-server lost direct child listener ownership during /info readiness');
        checkChild();
        if (info.protocol !== 12) throw new Error(`server protocol is ${info.protocol}; expected 12`);
        if (!info.state || info.state === 'ready') return {
          info,
          ownership: { pid: child.pid, endpoint: `127.0.0.1:${port}`, method: 'lsof direct child TCP LISTEN before and after /info',
            checkedAt: new Date().toISOString() },
        };
      }
    }
    await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.min(100, deadline - Date.now()))));
  }
  checkChild();
  throw new Error(`server did not become ready with direct child ownership on port ${port}: ${getLogs()}`);
}

module.exports = { ownsLoopbackListener, waitOwnedServer };
