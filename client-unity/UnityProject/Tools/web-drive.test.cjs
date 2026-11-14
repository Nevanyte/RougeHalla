'use strict';
// P-UNITY-WEB-DRIVE-2 oracle: the driver's landmark commands (eval, anchors, where, goto {x,y}).
//  1. web-drive-lib.cjs `run(cmd, page, env)` against a simulated page: always runs (no browser needed).
//  2. web-drive.cjs itself against Tools/fixtures/web-drive-page.html in a real Chromium: SKIPPED with a message when Playwright
//     cannot be loaded (RH_PLAYWRIGHT_MODULE, else `playwright`), because the gate's machines do not all have it (no existing node
//     test needs a browser). The lib tests are what the gate always enforces.
// Contract: docs/backlog/packets/P-UNITY-WEB-DRIVE-2.md section "Established facts".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { run } = require('./web-drive-lib.cjs');

const ANCHORS = [
  { kind: 'cave', zone: 4, footprint: { x: 10, y: 5, w: 6, h: 6 }, centre: { x: 368, y: 208 }, entrance: [{ x: 336, y: 336 }] },
  { kind: 'hall', zone: 5, footprint: { x: 40, y: 40, w: 8, h: 8 }, centre: { x: 1456, y: 1456 }, entrance: [] },
];
const MOVE_KEYS = ['w', 'a', 's', 'd', 'W', 'A', 'S', 'D', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const DIR = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] };

/** A simulated client page: 100 units/s, a key acts 300 ms after key-up, optional wall at x, optional active Tab-walk target that
 * drifts the player toward it until any movement key is pressed (the reported overshoot). Time advances only in env.sleep(). */
function world({ wallX = Infinity, walk = null, noProbe = false } = {}) {
  const w = { t: 0, me: { id: 1, x: 100, y: 100 }, until: new Map(), events: [], walk, wallX };
  const win = noProbe ? {} : { __rhProbe: { session: true, me: w.me, anchors: ANCHORS } };
  const key = (k) => String(k).toLowerCase();
  const hit = (k) => { if (MOVE_KEYS.includes(k)) w.walk = null; };
  w.page = {
    evaluate: async (src) => {
      assert.equal(typeof src, 'string', 'page.evaluate must be given an expression string');
      const r = new Function('window', 'return (' + src + ')')(win);
      return r === undefined ? undefined : JSON.parse(JSON.stringify(r));
    },
    keyboard: {
      down: async (k) => { w.events.push({ t: w.t, type: 'down', key: k }); hit(k); w.until.set(key(k), Infinity); },
      up: async (k) => { w.events.push({ t: w.t, type: 'up', key: k }); w.until.set(key(k), w.t + 300); },
      press: async (k) => { w.events.push({ t: w.t, type: 'press', key: k }); hit(k); w.until.set(key(k), w.t + 300); },
    },
  };
  w.env = {
    now: () => w.t,
    sleep: async (ms) => {
      for (let left = ms; left > 0; left -= 10) {
        w.t += 10;
        for (const [k, d] of Object.entries(DIR)) if ((w.until.get(k) || 0) > w.t) { w.me.x += d[0]; w.me.y += d[1]; }
        if (w.walk) { const dx = w.walk.x - w.me.x, dy = w.walk.y - w.me.y, n = Math.hypot(dx, dy) || 1; w.me.x += dx / n; w.me.y += dy / n; }
        if (w.me.x > w.wallX) w.me.x = w.wallX;
      }
    },
  };
  w.heldNow = () => [...w.until.entries()].filter(([, u]) => u === Infinity).map(([k]) => k);
  w.go = (cmd) => run(cmd, w.page, w.env);
  return w;
}

test('eval runs an expression in the page and returns its value as JSON', async () => {
  const w = world();
  assert.equal(await w.go({ cmd: 'eval', js: '1 + 2' }), '3');
  assert.deepEqual(JSON.parse(await w.go({ cmd: 'eval', js: 'window.__rhProbe.me' })), { id: 1, x: 100, y: 100 });
  assert.match(await w.go({ cmd: 'eval', js: 'nope.nope' }), /^ERR /, 'a throwing expression answers ERR <message>');
});

test('anchors prints the probe landmark list as JSON; where prints the player position', async () => {
  const w = world();
  assert.deepEqual(JSON.parse(await w.go({ cmd: 'anchors' })), ANCHORS);
  assert.deepEqual(JSON.parse(await w.go({ cmd: 'where' })), { x: 100, y: 100 });
  w.me.x = 250.5; w.me.y = -3;
  assert.deepEqual(JSON.parse(await w.go({ cmd: 'where' })), { x: 250.5, y: -3 }, 'where reads the live position');
});

test('anchors and where without the probe answer ERR naming scenario.probe=1', async () => {
  const w = world({ noProbe: true });
  assert.match(await w.go({ cmd: 'anchors' }), /^ERR .*scenario\.probe=1/);
  assert.match(await w.go({ cmd: 'where' }), /^ERR .*scenario\.probe=1/);
});

test("commands that are not the lib's answer null, including goto with a url (navigation stays the driver's)", async () => {
  const w = world();
  assert.equal(await w.go({ cmd: 'shot', path: 'x.png' }), null);
  assert.equal(await w.go({ cmd: 'goto', url: 'http://127.0.0.1:1/' }), null);
  assert.equal(w.events.length, 0, 'no key was touched');
});

test('goto without x and y answers ERR', async () => {
  const w = world();
  assert.match(await w.go({ cmd: 'goto', x: 5 }), /^ERR /);
});

test('goto walks to a reachable point, stops within the distance, and leaves no key held', async () => {
  const w = world();
  const r = JSON.parse(await w.go({ cmd: 'goto', x: 260, y: -20, within: 48 }));
  assert.equal(r.reason, 'reached'); assert.equal(r.ok, true);
  assert.ok(Math.hypot(w.me.x - 260, w.me.y + 20) <= 48, 'ended at ' + w.me.x + ',' + w.me.y);
  assert.ok(Math.abs(r.x - w.me.x) < 1e-6 && Math.abs(r.y - w.me.y) < 1e-6, 'x,y in the answer are the final position');
  assert.ok(r.dist <= 48 + 1e-6 && r.elapsedMs > 0);
  assert.deepEqual(w.heldNow(), [], 'every key released');
  assert.ok(w.events.every((e) => MOVE_KEYS.includes(e.key)), 'only movement keys are used');
  assert.ok(w.events.some((e) => e.type === 'down' && (e.key === 'd' || e.key === 'D')), 'east is D');
  assert.ok(w.events.some((e) => e.type === 'down' && (e.key === 'w' || e.key === 'W')), 'north (y decreasing) is W');
});

test('goto taps in short steps near the goal: at least one key press of 250 ms or less', async () => {
  const w = world();
  await w.go({ cmd: 'goto', x: 260, y: 100, within: 48 });
  const held = [];
  for (let i = 0; i < w.events.length; i++) {
    const e = w.events[i]; if (e.type !== 'down') continue;
    const up = w.events.slice(i + 1).find((u) => u.type === 'up' && u.key === e.key);
    if (up) held.push(up.t - e.t);
  }
  assert.ok(held.length >= 2, 'more than one key press');
  assert.ok(held.some((ms) => ms <= 250), 'at least one short tap (<= 250 ms)');
});

test('goto at a blocked point stops with reason "blocked", a stated position, and no key held', async () => {
  const w = world({ wallX: 400 });
  const r = JSON.parse(await w.go({ cmd: 'goto', x: 700, y: 100, within: 48 }));
  assert.equal(r.reason, 'blocked'); assert.equal(r.ok, false);
  assert.ok(w.me.x > 350 && w.me.x <= 400, 'pushed against the wall, at ' + w.me.x);
  assert.ok(Math.abs(r.x - w.me.x) < 1e-6);
  assert.ok(r.dist > 48 && r.elapsedMs < 30000, 'did not wait for the whole timeout');
  assert.deepEqual(w.heldNow(), []);
});

test('goto stops with reason "timeout" when the time runs out before it arrives', async () => {
  const w = world();
  const r = JSON.parse(await w.go({ cmd: 'goto', x: 100000, y: 100, within: 48, timeoutMs: 2000 }));
  assert.equal(r.reason, 'timeout'); assert.equal(r.ok, false);
  assert.ok(r.elapsedMs >= 2000 && r.elapsedMs <= 4000, 'elapsed ' + r.elapsedMs);
  assert.deepEqual(w.heldNow(), []);
});

test('goto clears an active Tab-map walk target before anything else, so it does not overshoot', async () => {
  const w = world({ walk: { x: -3000, y: 100 } });   // the old target drags the player west until a movement key is pressed
  const r = JSON.parse(await w.go({ cmd: 'goto', x: 260, y: 100, within: 48 }));
  const first = w.events[0];
  assert.ok(first && (first.type === 'down' || first.type === 'press') && MOVE_KEYS.includes(first.key), 'the first keyboard event is a movement key');
  assert.ok(first.t <= 200, 'it comes at once (t=' + first.t + ' ms), before the target can drag the player');
  assert.equal(r.reason, 'reached');
  assert.ok(Math.hypot(w.me.x - 260, w.me.y - 100) <= 48);
});

// ---------------------------------------------------------------- the real driver
let pw = null;
try { pw = require(process.env.RH_PLAYWRIGHT_MODULE || 'playwright'); } catch (_) { /* skipped below */ }
const skip = pw ? false : 'Playwright not available (set RH_PLAYWRIGHT_MODULE); the simulated-page tests above still run';

const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const post = (port, body) => new Promise((res, rej) => {
  const q = http.request({ host: '127.0.0.1', port, method: 'POST' }, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => res(b)); });
  q.on('error', rej); q.end(JSON.stringify(body));
});

test('web-drive.cjs in a browser: eval, anchors, where and goto against the fixture page', { skip, timeout: 120000 }, async (t) => {
  const page = fs.readFileSync(path.join(__dirname, 'fixtures', 'web-drive-page.html'));
  const web = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(page); });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, 'web-drive.cjs'), '800', '600'], {
    env: { ...process.env, RH_DRIVE_PORT: String(port), RH_DRIVE_HEADLESS: '1' }, stdio: 'ignore' });
  t.after(async () => { try { await post(port, { cmd: 'quit' }); } catch (_) { /* already gone */ } child.kill(); web.close(); });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { await post(port, { cmd: 'wait', ms: 1 }); up = true; } catch (_) { await new Promise((r) => setTimeout(r, 500)); } }
  assert.ok(up, 'the driver answers');
  assert.equal(await post(port, { cmd: 'goto', url: 'http://127.0.0.1:' + web.address().port + '/' }), 'ok', 'goto with a url still navigates');
  assert.equal(await post(port, { cmd: 'eval', js: '6 * 7' }), '42');
  assert.deepEqual(JSON.parse(await post(port, { cmd: 'anchors' })), ANCHORS);
  assert.deepEqual(JSON.parse(await post(port, { cmd: 'where' })), { x: 100, y: 100 });
  const ok = JSON.parse(await post(port, { cmd: 'goto', x: 260, y: 40, within: 48 }));
  assert.equal(ok.reason, 'reached');
  const at = JSON.parse(await post(port, { cmd: 'where' }));
  assert.ok(Math.hypot(at.x - 260, at.y - 40) <= 48, 'player at ' + at.x + ',' + at.y);
  const blocked = JSON.parse(await post(port, { cmd: 'goto', x: 900, y: 40, within: 48 }));   // the page's wall stops x at 400
  assert.equal(blocked.reason, 'blocked');
});
