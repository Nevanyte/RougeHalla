#!/usr/bin/env node
// Offline analysis of a hitbox-proof aim run: node hitbox-aim-analyze.cjs <console.log> [out.json]
// For every [aim] line (the client's aim at a click: feet, cursor ground point, chest height, angle) it follows the [shot] samples (ground
// x, y and height per frame) that lie on that ground line from the feet, and reports how close the RAISED track (y - height) came to the
// cursor and where it first appeared (it must start at the chest: the feet position raised by the chest height).
const fs = require('node:fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const aims = lines.filter(l => l.includes('[aim]')).map(l => { const m = l.match(/t=([\d.]+) from=([-\d.]+),([-\d.]+) cursor=([-\d.]+),([-\d.]+) chest=(\d+) angle=([-\d.]+)/); return m && { t: +m[1], fx: +m[2], fy: +m[3], cx: +m[4], cy: +m[5], chest: +m[6], angle: +m[7] }; }).filter(Boolean);
const shots = lines.filter(l => l.includes('[shot]')).map(l => { const m = l.match(/\[shot\] t=([\d.]+)(.*)$/); return m && { t: +m[1], pts: m[2].trim().split(' ').filter(Boolean).map(s => s.split(',').map(Number)) }; }).filter(Boolean);
const last = [...lines].reverse().find(l => l.includes('[recon]')) || '';
const rows = [];
for (const a of aims) {
  let best = Infinity, bestAt = null, first = null, n = 0, perpMax = 0;
  for (const f of shots) {
    if (f.t < a.t || f.t > a.t + 2500) continue;
    for (const p of f.pts) {
      const dx = p[0] - a.fx, dy = p[1] - a.fy, along = dx * Math.cos(a.angle) + dy * Math.sin(a.angle), perp = Math.abs(-dx * Math.sin(a.angle) + dy * Math.cos(a.angle));
      if (along < 0 || perp > 6 || p[2] !== a.chest) continue;
      n++; if (!first) first = { afterMs: +(f.t - a.t).toFixed(0), groundX: p[0], groundY: p[1], height: p[2], raisedY: p[1] - p[2], awayFromFeetU: +Math.hypot(dx, dy).toFixed(2) };
      // distance from the cursor to the infinite RAISED line through this sample along the aim direction (the geometric claim)
      const ex = a.cx - p[0], ey = a.cy - (p[1] - p[2]); perpMax = Math.max(perpMax, Math.abs(-ex * Math.sin(a.angle) + ey * Math.cos(a.angle)));
      const d = Math.hypot(p[0] - a.cx, (p[1] - p[2]) - a.cy);
      if (d < best) { best = d; bestAt = { groundX: p[0], raisedY: +(p[1] - p[2]).toFixed(1) }; }
    }
  }
  rows.push({ from: [a.fx, a.fy], cursor: [a.cx, a.cy], chest: a.chest, trackSamples: n, firstSample: first, minRaisedDistanceToCursor: best === Infinity ? null : +best.toFixed(2), cursorToRaisedLineMaxU: n ? +perpMax.toFixed(3) : null, nearest: bestAt });
}
const launched = rows.filter(r => r.trackSamples > 0), d = launched.map(r => r.minRaisedDistanceToCursor).filter(v => v !== null);
const lineD = launched.map(r => r.cursorToRaisedLineMaxU);
const out = { aimLines: aims.length, worstCursorToRaisedLineU: lineD.length ? Math.max(...lineD) : null, launched: launched.length, hits: +(last.match(/hits=(\d+)/) || [0, 0])[1], worstMinDistanceU: d.length ? Math.max(...d) : null, bestMinDistanceU: d.length ? Math.min(...d) : null, medianMinDistanceU: d.length ? d.sort((p, q) => p - q)[Math.floor(d.length / 2)] : null, rows };
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, rows: undefined }, null, 1));
for (const r of rows) console.log(`chest ${r.chest} cursor (${r.cursor.map(v => v.toFixed(1))}) samples ${r.trackSamples} first ${JSON.stringify(r.firstSample)} raised line passes the cursor within ${r.cursorToRaisedLineMaxU} u; track ended ${r.minRaisedDistanceToCursor} u from it`);
