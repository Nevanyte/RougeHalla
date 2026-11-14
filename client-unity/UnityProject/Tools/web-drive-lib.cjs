// Pure command logic of the Web driver (Tools/web-drive.cjs), split out so the gate tests it without a browser.
// Contract: docs/backlog/packets/P-UNITY-WEB-DRIVE-2.md. Time comes only from env.sleep / env.now (tests simulate it).
'use strict';

const NO_PROBE = 'ERR no probe on this page: open it with scenario.probe=1 and wait until a match is joined';
const LAG_MS = 500;          // keys keep acting about half a second after key-up
const FAR = 200;             // world units: nearer than this the walk taps instead of holding
const STALL_MS = 1500;       // key time without progress before the walk calls it blocked
const STALL_GAIN = 2;        // world units of progress that count

const json = (v) => { const s = JSON.stringify(v); return s === undefined ? 'null' : s; };

async function probeValue(page, field) {
  return page.evaluate('window.__rhProbe && window.__rhProbe.' + field + ' !== undefined ? window.__rhProbe.' + field + ' : null');
}

async function where(page) {
  const me = await probeValue(page, 'me');
  if (!me || typeof me.x !== 'number' || typeof me.y !== 'number') return null;
  return { x: me.x, y: me.y };
}

async function walk(c, page, env) {
  const gx = Number(c.x), gy = Number(c.y);
  if (c.x === undefined || c.y === undefined || !Number.isFinite(gx) || !Number.isFinite(gy)) return 'ERR goto needs numeric x and y (world units)';
  const within = c.within === undefined ? 48 : Number(c.within);
  const timeoutMs = c.timeoutMs === undefined ? 30000 : Number(c.timeoutMs);
  if (!Number.isFinite(within) || !Number.isFinite(timeoutMs)) return 'ERR goto: within and timeoutMs must be numbers';
  let pos = await where(page);
  if (!pos) return NO_PROBE;
  const start = env.now();
  const held = new Set();
  const keyFor = (p) => {
    const dx = gx - p.x, dy = gy - p.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'd' : 'a';
    return dy >= 0 ? 's' : 'w';
  };
  const hold = async (k, ms) => {
    held.add(k); await page.keyboard.down(k);
    try { await env.sleep(ms); } finally { await page.keyboard.up(k); held.delete(k); }
  };
  const dist = (p) => Math.hypot(gx - p.x, gy - p.y);
  const answer = (reason) => JSON.stringify({ ok: reason === 'reached', reason, x: pos.x, y: pos.y, dist: dist(pos), elapsedMs: env.now() - start });
  try {
    // A movement key replaces a standing Tab-map walk target, so the first thing done is a short tap, then the key lag is waited out.
    await hold(keyFor(pos), 100);
    await env.sleep(LAG_MS);
    let best = Infinity, keyTime = 0;
    for (;;) {
      pos = await where(page);
      if (!pos) return NO_PROBE;
      const d = dist(pos);
      if (d <= within) return answer('reached');
      if (env.now() - start >= timeoutMs) return answer('timeout');
      if (d < best - STALL_GAIN) { best = d; keyTime = 0; }
      else if (keyTime > STALL_MS) return answer('blocked');
      const gap = Math.max(Math.abs(gx - pos.x), Math.abs(gy - pos.y));
      if (d > FAR) { await hold(keyFor(pos), 500); keyTime += 500; }
      else {
        const ms = Math.min(250, Math.max(80, Math.round((gap - within / 2) * 3)));
        await hold(keyFor(pos), ms); keyTime += ms;
        await env.sleep(LAG_MS);
      }
    }
  } finally {
    for (const k of held) { try { await page.keyboard.up(k); } catch (_) { /* nothing more to do */ } }
  }
}

/**
 * Handles `eval`, `anchors`, `where` and `goto {x,y}`. Returns the driver's answer string, or null when the command is not one of
 * these (including `goto` with a `url`, which the driver itself handles as navigation).
 * @param {object} c the parsed command; @param {object} page needs evaluate(string) and keyboard.down/up/press;
 * @param {{sleep:(ms:number)=>Promise<void>, now:()=>number}} env
 */
async function run(c, page, env) {
  try {
    switch (c.cmd) {
      case 'eval': return json(await page.evaluate('(' + c.js + ')'));
      case 'anchors': { const a = await probeValue(page, 'anchors'); return a === null ? NO_PROBE : json(a); }
      case 'where': { const p = await where(page); return p ? json(p) : NO_PROBE; }
      case 'goto': return c.url !== undefined ? null : await walk(c, page, env);
      default: return null;
    }
  } catch (e) {
    return 'ERR ' + (e && e.message ? e.message : e);
  }
}

module.exports = { run };
