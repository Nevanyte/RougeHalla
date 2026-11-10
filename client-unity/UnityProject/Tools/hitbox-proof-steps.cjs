// Steps for hitbox-proof.cjs. Each step receives the joined Game and a context.
const parse = line => { const o = {}; for (const m of line.matchAll(/(\w+)=([^\s]+)/g)) o[m[1]] = m[2]; return o; };

exports.probe = async (g, c) => {
  await g.shot('probe-start');
  console.log('actors seen:', g.actors.size);
  await c.sleep(3000);
  await g.shot('probe-later');
  console.log('hb logs:', g.hb.slice(-2).map(x => x.line).join('\n'));
  console.log('recon logs:', g.recon.slice(-1).map(x => x.line).join('\n'));
};

// Walk up to a wall from the south and report how far the feet stop from the wall face.
exports.wall = async (g, c) => {
  const { map, tileAt } = c;
  const P = g.self;
  const cands = [];
  for (let ty = 2; ty < map.h - 8; ty++) for (let tx = 2; tx < map.w - 2; tx++) {
    if (tileAt(tx - 1, ty - 1) === 0 || tileAt(tx, ty - 1) === 0 || tileAt(tx + 1, ty - 1) === 0) continue;   // wall tiles north of the face
    let ok = true;
    for (let dy = 0; dy <= 7 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) if (tileAt(tx + dx, ty + dy) !== 0) ok = false;
    if (!ok) continue;
    const sx = tx * 32 + 16, sy = (ty + 6) * 32 + 16;
    cands.push({ tx, ty, sx, sy, d: Math.hypot(sx - P.x, sy - P.y) });
  }
  cands.sort((a, b) => a.d - b.d);
  console.log('wall candidates', cands.length, 'nearest', JSON.stringify(cands.slice(0, 3)));
  const result = { tag: c.tag, trials: [] };
  for (const cand of cands.slice(0, 8)) {
    // stage 6 tiles south of the face, over the known map
    try { await goTo(g, c, cand.sx, cand.sy, 8); } catch (e) { console.log('stage failed:', e.message); continue; }
    await g.settle(700, 8000); await c.recalibrate(g);
    const near = Math.hypot(cand.sx - g.self.x, cand.sy - g.self.y);
    console.log(`stage ${cand.tx},${cand.ty}: ${near.toFixed(1)} u from staging point`);
    if (near > 40) continue;
    const face = cand.ty * 32;
    // 1. click 2 u south of the face
    await g.rightClickSim(cand.tx * 32 + 16, face + 2);
    await g.settle(1000, 15000);
    const clickStop = g.self;
    await c.recalibrate(g);
    await g.shot('wall-click-stop');
    // 2. back off, then hold W into the wall
    await g.rightClickSim(cand.tx * 32 + 16, face + 5 * 32); await g.settle(1000, 15000); await c.recalibrate(g);
    await g.page.keyboard.down('w'); await c.sleep(4500); await g.page.keyboard.up('w');
    const keyStop = await g.settle(1000, 8000);
    await c.recalibrate(g);
    await g.shot('wall-key-stop');
    result.trials.push({ tx: cand.tx, ty: cand.ty, faceY: face, clickStopY: clickStop.y, clickGap: clickStop.y - face, clickX: clickStop.x, keyStopY: keyStop.y, keyGap: keyStop.y - face, keyX: keyStop.x });
    console.log('trial', JSON.stringify(result.trials[result.trials.length - 1]));
    if (result.trials.length >= 2) break;
  }
  c.fs.writeFileSync(c.path.join(c.out, `${c.tag}-wall.json`), JSON.stringify(result, null, 1));
};

// 30 s of walking along and into walls with a fixed key script; report the reconciliation counters.
exports.walk = async (g, c) => {
  const seconds = Number(c.opt('seconds', 30));
  const script = [['w'], ['w', 'd'], ['d'], ['s', 'd'], ['s'], ['s', 'a'], ['a'], ['w', 'a'], ['w'], ['d'], ['s'], ['a']];
  const durs = [1.3, 1.1, 1.4, 1.0, 1.2, 1.1, 1.3, 1.0, 1.2, 1.1, 1.0, 1.3];
  const start = g.recon.length ? g.recon[g.recon.length - 1].line : null;
  const t0 = Date.now(); let i = 0, held = 0, stalled = 0, moved = 0, last = g.self, lastT = Date.now();
  const mon = setInterval(() => {
    const s = g.self; if (!s || !last) return;
    const d = Math.hypot(s.x - last.x, s.y - last.y); moved += d;
    if (held > 0 && d < 0.2) stalled += (Date.now() - lastT) / 1000;
    last = { x: s.x, y: s.y }; lastT = Date.now();
  }, 100);
  while (Date.now() - t0 < seconds * 1000) {
    const keys = script[i % script.length], dur = durs[i % durs.length] * 1000; i++;
    held = keys.length;
    for (const k of keys) await g.page.keyboard.down(k);
    await c.sleep(dur);
    for (const k of keys) await g.page.keyboard.up(k);
    held = 0;
    if (i % 5 === 0) { const [px, py] = g.css(g.self.x, g.self.y); await g.page.mouse.click(px + 300 * Math.cos(i), py - 200 * Math.sin(i), { button: 'right' }); await c.sleep(700); }
  }
  clearInterval(mon);
  await c.sleep(1500);
  const end = g.recon[g.recon.length - 1].line;
  const summary = { tag: c.tag, seconds, segments: i, distanceWalked: +moved.toFixed(0), stalledSecondsAgainstWalls: +stalled.toFixed(1), start, end, endParsed: parse(end) };
  console.log(JSON.stringify(summary, null, 1));
  c.fs.writeFileSync(c.path.join(c.out, `${c.tag}-walk.json`), JSON.stringify(summary, null, 1));
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Helpers over the client's [hitboxes] / [shot] / [aim] console lines.
const table = c => JSON.parse(c.fs.readFileSync(c.path.join(__dirname, '../../../protocol/fixtures/archetypes_v1.json'), 'utf8')).archetypes;
const latestHb = g => {
  const last = g.hb[g.hb.length - 1]; if (!last) return { actors: [], props: [] };
  const [a, p] = last.line.split(' props=');
  const actors = (a.split('actors=')[1] || '').split(';').filter(Boolean).map(s => { const [id, kind, arch, key, x, y] = s.split(':'); return { id: +id, kind: +kind, arch: +arch, key, x: +x, y: +y }; });
  const props = (p || '').split(';').filter(Boolean).map(s => { const [kind, weapon, x, y, open, focus] = s.split(':'); return { kind: +kind, weapon: +weapon, x: +x, y: +y, open: +open, focus: +focus }; });
  return { actors, props };
};
exports._latestHb = latestHb;

// Tile BFS over the known map (floor tiles whose 8 neighbours are floor): waypoints from (x0,y0) to (x1,y1) every ~`gap` tiles.
const navPath = (c, x0, y0, x1, y1, gap = 6) => {
  const { map, tileAt } = c, w = map.w, key = (tx, ty) => ty * w + tx;
  const free = (tx, ty) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(tx + dx, ty + dy) !== 0) return false; return true; };
  const s = [Math.floor(x0 / 32), Math.floor(y0 / 32)], t = [Math.floor(x1 / 32), Math.floor(y1 / 32)];
  if (!free(...t)) {   // snap the goal tile to the nearest tile with a free 3x3
    let best = null, bd = 1e9;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (free(t[0] + dx, t[1] + dy) && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = [t[0] + dx, t[1] + dy]; }
    if (!best) return null; t[0] = best[0]; t[1] = best[1]; x1 = t[0] * 32 + 16; y1 = t[1] * 32 + 16;
  }
  const prev = new Map([[key(...s), -1]]), q = [s];
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let found = false;
  for (let i = 0; i < q.length && !found; i++) {
    const [cx, cy] = q[i];
    for (const [dx, dy] of nb) {
      const nx = cx + dx, ny = cy + dy, k = key(nx, ny);
      if (prev.has(k) || !free(nx, ny)) continue;
      if (dx && dy && !(free(cx + dx, cy) && free(cx, cy + dy))) continue;
      prev.set(k, key(cx, cy)); q.push([nx, ny]);
      if (nx === t[0] && ny === t[1]) { found = true; break; }
    }
  }
  if (!found) return null;
  const tiles = []; for (let k = key(...t); k !== -1; k = prev.get(k)) tiles.push([k % w, Math.floor(k / w)]);
  tiles.reverse();
  const pts = []; for (let i = gap; i < tiles.length; i += gap) pts.push([tiles[i][0] * 32 + 16, tiles[i][1] * 32 + 16]);
  pts.push([x1, y1]);
  return pts;
};
exports._navPath = navPath;
const goTo = async (g, c, x, y, doneDist = 12) => {
  const pts = navPath(c, g.self.x, g.self.y, x, y);
  if (!pts) throw new Error(`no tile path from (${g.self.x | 0},${g.self.y | 0}) to (${x},${y})`);
  for (const [px, py] of pts) {
    await g.rightClickSim(px, py);
    const t0 = Date.now();
    while (Date.now() - t0 < 12000 && Math.hypot(g.self.x - px, g.self.y - py) > doneDist) await c.sleep(150);
    await c.recalibrate(g);
  }
};
exports._goTo = goTo;

// Walk to the nearest ground Bow (1) or Wand (2), pick it up, then burst against the nearest hostile actor with the cursor on its torso.
exports.aim = async (g, c) => {
  const want = Number(c.opt('weapon', 1));   // 1 bow, 2 wand
  const T = table(c);
  const log = {};
  await c.sleep(2500);
  // Ground weapons are sparse and the observed props are limited to what the player can see: tour coarse grid cells until a ranged
  // weapon is listed. (A training server with a weapon rack needs an account-owned join the diagnostic client cannot make.)
  const seen = new Map(), visited = new Set();
  const scan = () => { for (const p of latestHb(g).props) if (p.kind === 1 && (p.weapon === 1 || p.weapon === 2)) seen.set(`${p.x},${p.y}`, p); };
  const deadline = Date.now() + 420000;
  scan();
  while (![...seen.values()].some(p => want < 0 || p.weapon === want) && Date.now() < deadline && visited.size < Number(c.opt('cells', 8))) {
    const cells = [];
    for (let ty = 8; ty < c.map.h - 8; ty += 24) for (let tx = 8; tx < c.map.w - 8; tx += 24) {
      const k = `${tx},${ty}`; if (visited.has(k)) continue;
      let fx = null; for (let r = 0; r < 6 && !fx; r++) for (let dy = -r; dy <= r && !fx; dy++) for (let dx = -r; dx <= r && !fx; dx++) { let ok = true; for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) if (c.tileAt(tx + dx + xx, ty + dy + yy) !== 0) ok = false; if (ok) fx = [tx + dx, ty + dy]; }
      if (fx) cells.push({ k, x: fx[0] * 32 + 16, y: fx[1] * 32 + 16 });
    }
    cells.sort((a, b) => Math.hypot(a.x - g.self.x, a.y - g.self.y) - Math.hypot(b.x - g.self.x, b.y - g.self.y));
    if (!cells.length) break;
    const next = cells[0]; visited.add(next.k);
    try { await goTo(g, c, next.x, next.y, 24); } catch (e) { console.log('tour hop failed:', e.message); if (/no target marks/.test(e.message)) { process.exitCode = 3; throw new Error('retry: player gone'); } }
    scan();
    console.log(`toured ${visited.size} cells; at (${g.self.x | 0},${g.self.y | 0}); ranged weapons seen: ${seen.size}`);
  }
  scan();
  const ground = [...seen.values()];
  console.log('ground ranged weapons found:', JSON.stringify(ground));
  const target = ground.filter(p => p.weapon === want || want < 0).sort((a, b) => Math.hypot(a.x - g.self.x, a.y - g.self.y) - Math.hypot(b.x - g.self.x, b.y - g.self.y))[0];
  if (!target) { process.exitCode = 3; throw new Error('retry: no ranged weapon found after the tour'); }
  await goTo(g, c, target.x, target.y, 14);
  await g.page.keyboard.press('f'); await c.sleep(1200);
  await g.shot('aim-after-pickup');
  log.weapon = { want, at: target, selfAfter: g.self };
  // 2. a hostile target: the nearest mob (or other player) that is not the local player, approached to ~300 u over the known map;
  //    with none in view, tour grid cells as above until one appears
  let victim = null;
  const visited2 = new Set(); const t2 = Date.now() + 360000;
  while (!victim && Date.now() < t2) {
    const others = latestHb(g).actors.filter(a => a.arch !== 0 && a.kind !== 4 && Math.hypot(a.x - g.self.x, a.y - g.self.y) > 30)
      .sort((a, b) => Math.hypot(a.x - g.self.x, a.y - g.self.y) - Math.hypot(b.x - g.self.x, b.y - g.self.y));
    if (!others.length) {
      const cells = [];
      for (let ty = 8; ty < c.map.h - 8; ty += 16) for (let tx = 8; tx < c.map.w - 8; tx += 16) {
        const k = `${tx},${ty}`; if (visited2.has(k)) continue;
        let ok = true; for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) if (c.tileAt(tx + xx, ty + yy) !== 0) ok = false;
        if (ok) cells.push({ k, x: tx * 32 + 16, y: ty * 32 + 16 });
      }
      cells.sort((a, b) => Math.hypot(a.x - g.self.x, a.y - g.self.y) - Math.hypot(b.x - g.self.x, b.y - g.self.y));
      if (!cells.length) break;
      visited2.add(cells[0].k);
      try { await goTo(g, c, cells[0].x, cells[0].y, 24); } catch (e) { console.log('search hop failed:', e.message); }
      continue;
    }
    const o = others[0], d = Math.hypot(o.x - g.self.x, o.y - g.self.y);
    if (d > 330) {
      const k = (d - 280) / d;   // stop ~280 u short of it
      try { await goTo(g, c, g.self.x + (o.x - g.self.x) * k, g.self.y + (o.y - g.self.y) * k, 20); } catch (e) { console.log('approach failed:', e.message); await c.sleep(800); }
      await c.sleep(500);
    } else victim = o;
  }
  if (!victim) { process.exitCode = 3; throw new Error('retry: no target actor found'); }
  const row = T.find(t => t.id === victim.arch);
  log.victim = { ...victim, row: row && row.hull };
  console.log('victim', JSON.stringify(log.victim));
  // 3. fire a burst with the cursor on the torso (feet + body offset), following the target
  const hits0 = Number((g.recon.at(-1) || { line: '' }).line.match(/hits=(\d+)/)?.[1] || 0);
  const burst = Number(c.opt('burst', 12));
  let clicks = 0; const frames = [];
  for (let i = 0; i < burst; i++) {
    const hb = latestHb(g); const v = hb.actors.find(a => a.id === victim.id) || victim;
    const oy = row && row.hull.bodyOffset ? row.hull.bodyOffset[1] : 0;
    const [px, py] = g.css(v.x, v.y + oy);   // torso = the body box centre
    await g.page.mouse.move(px, py); await c.sleep(150);
    const t0 = Date.now();
    await g.page.mouse.click(px, py, { delay: 70 }); clicks++;
    for (let k = 0; k < 7; k++) { const name = `aim-shot${String(i).padStart(2, '0')}-f${k}`; await g.shot(name); frames.push({ name, ms: Date.now() - t0 }); }
    await c.sleep(300);
  }
  await c.sleep(1500);
  const lastRecon = (g.recon.at(-1) || { line: '' }).line;
  const hits1 = Number(lastRecon.match(/hits=(\d+)/)?.[1] || 0);
  // geometry from the client's own [aim] and [shot] lines: for every click, the raised track must pass within a few units of the cursor
  const aims = g.logs.filter(l => l.includes('[aim]')).map(l => { const m = l.match(/t=([\d.]+) from=([-\d.]+),([-\d.]+) cursor=([-\d.]+),([-\d.]+) chest=(\d+) angle=([-\d.]+)/); return m && { t: +m[1], fx: +m[2], fy: +m[3], cx: +m[4], cy: +m[5], chest: +m[6], angle: +m[7] }; }).filter(Boolean);
  const shotsLog = g.logs.filter(l => l.includes('[shot]')).map(l => { const m = l.match(/\[shot\] t=([\d.]+)(.*)$/); return m && { t: +m[1], pts: m[2].trim().split(' ').filter(Boolean).map(s => s.split(',').map(Number)) }; }).filter(Boolean);
  const rows = [];
  for (const a of aims) {
    let best = Infinity, bestAt = null, first = null, n = 0;
    for (const f of shotsLog) {
      if (f.t < a.t || f.t > a.t + 2500) continue;
      for (const p of f.pts) {
        const dx = p[0] - a.fx, dy = p[1] - a.fy, along = dx * Math.cos(a.angle) + dy * Math.sin(a.angle), perp = Math.abs(-dx * Math.sin(a.angle) + dy * Math.cos(a.angle));
        if (along < 0 || perp > 6 || p[2] !== a.chest) continue;
        n++; if (!first) first = { afterMs: +(f.t - a.t).toFixed(0), groundX: p[0], groundY: p[1], height: p[2], raisedY: p[1] - p[2] };
        const d = Math.hypot(p[0] - a.cx, (p[1] - p[2]) - a.cy);
        if (d < best) { best = d; bestAt = { x: p[0], raisedY: +(p[1] - p[2]).toFixed(1) }; }
      }
    }
    rows.push({ from: [a.fx, a.fy], cursor: [a.cx, a.cy], chest: a.chest, trackSamples: n, firstSample: first, minRaisedDistanceToCursor: best === Infinity ? null : +best.toFixed(2), nearest: bestAt });
  }
  log.clicks = clicks; log.aimLines = aims.length; log.launched = rows.filter(r => r.trackSamples > 0).length; log.hits = hits1 - hits0;
  log.worstMinDistance = Math.max(...rows.filter(r => r.minRaisedDistanceToCursor !== null).map(r => r.minRaisedDistanceToCursor));
  log.rows = rows; log.frames = frames;
  console.log(JSON.stringify({ ...log, frames: undefined }, null, 1));
  c.fs.writeFileSync(c.path.join(c.out, `${c.tag}-aim.json`), JSON.stringify(log, null, 1));
};

// Overlay crops: the own look (this session's faction) and every distinct archetype key seen near the player.
exports.looks = async (g, c) => {
  const T = table(c);
  const done = new Set();
  const { execFileSync } = require('node:child_process');
  const grab = async (label, x, y, w = 140, h = 190) => {
    await g.drain();   // newest per-frame positions
    const [px, py] = g.css(x, y);
    const clip = { x: Math.max(0, Math.round(px - w / 2)), y: Math.max(0, Math.round(py - h * 0.72)), width: w, height: h };
    if (clip.x + w > c.W || clip.y + h > c.H) return false;
    await g.shot(`look-${label}`, clip); return true;
  };
  // own look
  const me = g.self; await grab(`player-f${c.opt('faction', 0)}`, me.x, me.y); done.add('self');
  const deadline = Date.now() + Number(c.opt('seconds', 40)) * 1000;
  while (Date.now() < deadline) {
    const hb = latestHb(g);
    // every distinct archetype key in view (other players and mobs), not the quest giver (it keeps the neutral silhouette)
    const pending = hb.actors.filter(a => a.arch !== 0 && a.kind !== 4 && Math.hypot(a.x - g.self.x, a.y - g.self.y) > 30 && !done.has(`${a.kind === 0 ? 'player' : 'mob'}-${a.key}`))
      .sort((a, b) => Math.hypot(a.x - g.self.x, a.y - g.self.y) - Math.hypot(b.x - g.self.x, b.y - g.self.y));
    if (!pending.length) { const s = g.self, k = Date.now() % 7; await g.rightClickSim(s.x + 260 * Math.cos(k * 1.9), s.y + 190 * Math.sin(k * 1.9)); await c.sleep(2000); continue; }
    const a0 = pending[0], tag = `${a0.kind === 0 ? 'player' : 'mob'}-${a0.key}`;
    let live = g.actors.get(a0.id) || a0;
    if (Math.hypot(live.x - g.self.x, live.y - g.self.y) > 300) {   // walk until it is on screen (mobs wait at their camps)
      const d = Math.hypot(live.x - g.self.x, live.y - g.self.y), k = (d - 230) / d;
      try { await goTo(g, c, g.self.x + (live.x - g.self.x) * k, g.self.y + (live.y - g.self.y) * k, 24); } catch (e) { done.add(tag); console.log('approach failed for', tag, e.message); continue; }
      await c.sleep(500); await g.drain(); live = g.actors.get(a0.id) || live;
    }
    const [px, py] = g.css(live.x, live.y);
    if (px < 90 || px > c.W - 90 || py < 140 || py > c.H - 60) { done.add(tag); continue; }
    if (await grab(tag, live.x, live.y)) { done.add(tag); console.log('captured', tag, JSON.stringify({ ...a0, x: live.x, y: live.y })); }
  }
  console.log('captured looks:', [...done].join(', '));
};
