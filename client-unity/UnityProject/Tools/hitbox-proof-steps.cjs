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
    // stage 6 tiles south of the face
    for (let hop = 0; hop < 6; hop++) {
      const s0 = g.self;
      const dx = cand.sx - s0.x, dy = cand.sy - s0.y, dist = Math.hypot(dx, dy);
      if (dist < 6) break;
      // hop at most ~7 tiles per click so the click stays on screen
      const k = Math.min(1, 224 / dist);
      await g.rightClickSim(s0.x + dx * k, s0.y + dy * k);
      await g.settle(700, 12000);
      await c.recalibrate(g);
    }
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
