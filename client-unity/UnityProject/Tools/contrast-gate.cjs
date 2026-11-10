#!/usr/bin/env node
'use strict';
// Character-contrast gate: drives the serverless contrast lab (?contrastlab=1) of the real WebGL build in headed Chromium (real GPU),
// measures every cell and fails when a gated number is below its threshold. Definition: docs/rework/CONTRAST_GATE.md.
//
//   node client-unity/UnityProject/Tools/contrast-gate.cjs --url http://127.0.0.1:8187/ --out /tmp/contrast
//        [--zones fire,holy] [--sizes 1920x1080,2560x1440] [--quality high,ultra] [--edge 3.0] [--marker 4.5]
//        [--query "facings=4&props=3"] [--only Ember:1,Bog] [--frames 4] [--ground-frames 3] [--max-pages 2] [--allow-software]
//   node client-unity/UnityProject/Tools/contrast-gate.cjs --compare runA/contrast.json runB/contrast.json     (run-to-run difference)
//
// Writes <out>/contrast.json (every cell), <out>/CONTRAST.md (tables), <out>/worst.jpg (24 lowest-EDGE cells, annotated); prints a summary;
// exit code 1 when any gated number (EDGE p10 or a marker ratio) is below threshold or a cell could not be measured, else 0.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lib = require('./contrast-lib.cjs');

const OUT_COLUMNS = ['cfg', 'zone', 'surface', 'appearance', 'pose', 'facing', 'prop', 'propMode', 'clip', 'frame', 'purity', 'valid', 'edgeP10', 'edgeMin', 'edgeMedian', 'edgeGroundP10', 'edgeCoreP10', 'rimShare', 'ringLum', 'contourLum', 'body', 'bodyGround', 'hp', 'foot', 'insignia', 'plates', 'edgePass', 'markerPass', 'overlap', 'reason'];
const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

function usage() {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 12).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}

// ---- measurement ----------------------------------------------------------------------------------------------------------------

async function waitReady(page, timeout = 180000) {
  await page.waitForFunction(() => { const L = window.__rhContrastLab; return !!(L && L.ready); }, null, { timeout, polling: 100 });
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__rhContrastLab.state)));
}

async function shot(page) { const png = await page.screenshot({ type: 'png' }); const img = lib.decodePng(png); img.png = png; return img; }

function addInto(acc, plane) { for (let i = 0; i < acc.length; i++) acc[i] += plane[i]; }
function meanOf(acc, n) { const out = new Float32Array(acc.length); for (let i = 0; i < out.length; i++) out[i] = acc[i] / n; return out; }

function cropRgba(img, x0, y0, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) img.data.copy(out, y * w * 4, ((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4);
  return out;
}

async function capturePage(page, size, opts, tag) {
  const n = size.width * size.height;
  // normal: several frames, luminance averaged (ambient dust, haze, snow and lights keep moving; the actors are frozen)
  const accN = new Float32Array(n); let lastShot = null;
  for (let i = 0; i < opts.frames; i++) {
    lastShot = await shot(page);
    if (lastShot.width !== size.width || lastShot.height !== size.height) throw new Error(`screenshot is ${lastShot.width}x${lastShot.height}, wanted ${size.width}x${size.height}`);
    addInto(accN, lib.luminancePlane(lastShot.data, size.width, size.height));
    if (i + 1 < opts.frames) await page.waitForTimeout(200);
  }
  const state = await waitReadyAfter(page, 'no-actors');
  const accG = new Float32Array(n);
  for (let i = 0; i < opts.groundFrames; i++) { const s = await shot(page); addInto(accG, lib.luminancePlane(s.data, size.width, size.height)); if (i + 1 < opts.groundFrames) await page.waitForTimeout(200); }
  await waitReadyAfter(page, 'mask');
  const m = await shot(page);
  if (opts.raw) {
    fs.mkdirSync(opts.raw, { recursive: true });
    fs.writeFileSync(path.join(opts.raw, `${tag}-normal.png`), lastShot.png); fs.writeFileSync(path.join(opts.raw, `${tag}-mask.png`), m.png);
    fs.writeFileSync(path.join(opts.raw, `${tag}-state.json`), JSON.stringify(state));
  }
  return { state, lumNormal: meanOf(accN, opts.frames), lumGround: meanOf(accG, opts.groundFrames), mask: lib.decodeMask(m.data, size.width, size.height), shot: lastShot };
}

async function waitReadyAfter(page, mode) {
  await page.evaluate(m => window.__rhContrastLab.setMode(m), mode);
  return waitReady(page);
}

async function runConfig(chromium, size, quality, opts, log) {
  const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    const url = `${opts.url.replace(/\/?$/, '/')}?contrastlab=1&quality=${quality}${opts.query}`;
    log(`  open ${url}`);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 60000 });
    let state = await waitReady(page);
    const gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return 'no webgl2'; const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
    if (/swiftshader|llvmpipe|software/i.test(gpu) && !opts.allowSoftware) throw new Error(`browser is using a software renderer (${gpu}); the gate needs a real GPU (or pass --allow-software)`);
    if (state.screenW !== size.width || state.screenH !== size.height) throw new Error(`Unity renders ${state.screenW}x${state.screenH}, wanted ${size.width}x${size.height}`);
    if (String(state.quality).toLowerCase() !== quality) throw new Error(`quality is ${state.quality}, wanted ${quality}`);
    if (state.reducedMotion) throw new Error('reduced motion is on: the walking pose would not play');
    if (state.unreachable && state.unreachable.length) throw new Error('catalog keys the presenter cannot pick: ' + state.unreachable.join(','));
    const cfg = { name: `${size.width}x${size.height}/${quality}`, width: size.width, height: size.height, quality, gpu, row: state.row, orthoSize: state.orthoSize, notes: state.notes, unplaced: state.unplaced, pages: {}, cells: [] };
    const seen = {};
    for (const zone of opts.zones) {
      const zi = state.zones.indexOf(zone);
      let pageCount = state.zonePageCounts[zi];
      if (opts.maxPages > 0) pageCount = Math.min(pageCount, opts.maxPages);
      cfg.pages[zone] = pageCount;
      for (let p = 0; p < pageCount; p++) {
        await page.evaluate(([z, n]) => window.__rhContrastLab.setZone(z, n), [zone, p]);
        state = await waitReady(page);
        if (opts.only) {
          const key = [String(state.surface || '').toLowerCase(), String(state.kind || '').toLowerCase()].find(k => opts.only.has(k));
          if (key === undefined) { log(`  ${zone} page ${p + 1}/${pageCount} skipped (--only)`); continue; }
          const cap1 = opts.only.get(key); seen[key] = (seen[key] || 0) + 1;
          if (cap1 > 0 && seen[key] > cap1) { log(`  ${zone} page ${p + 1}/${pageCount} skipped (--only ${key}:${cap1})`); continue; }
        }
        let cap, cons, attempt = 0;
        for (;;) {
          cap = await capturePage(page, size, opts, `${cfg.name.replace('/', '-')}-${zone}-${p}`);
          cons = lib.frameConsistency(cap.lumNormal, cap.lumGround, cap.mask, size.width, size.height);
          if (cons.far <= opts.maxFar && cons.inside >= opts.minInside) break;
          if (++attempt > 2) break;
          log(`  frames disagree (far ${cons.far.toFixed(3)}, inside ${cons.inside.toFixed(3)}); retrying`);
          await page.evaluate(([z, n]) => window.__rhContrastLab.setZone(z, n), [zone, p]); state = await waitReady(page);
        }
        const consistent = cons.far <= opts.maxFar && cons.inside >= opts.minInside;
        cfg.consistency = cfg.consistency || { maxFar: 0, minInside: 1e9 };
        cfg.consistency.maxFar = Math.max(cfg.consistency.maxFar, cons.far); cfg.consistency.minInside = Math.min(cfg.consistency.minInside, cons.inside);
        const scale = cap.shot.width / (cap.state.screenW || size.width);
        for (const c of cap.state.cells) {
          const rect = { x: c.x * scale, y: c.y * scale, w: c.w * scale, h: c.h * scale };
          const res = !consistent ? { valid: false, reason: `frames disagree (far ${cons.far.toFixed(3)}, inside ${cons.inside.toFixed(3)})`, markers: {} } : c.found && c.w > 0 ? lib.analyzeCell({ width: size.width, height: size.height, lumNormal: cap.lumNormal, lumGround: cap.lumGround, mask: cap.mask, rect }, { debug: true }) : { valid: false, reason: 'actor not found or has no drawn pixels', markers: {} };
          const cell = toCell(cfg.name, c, res, opts);
          cfg.cells.push(cell);
          considerWorst(opts, cell, res, cap.shot, size);
        }
        log(`  ${zone} page ${p + 1}/${pageCount} (${cap.state.kind} ${cap.state.surface || cap.state.prop}): ${cap.state.cells.length} cells, frames far ${cons.far.toFixed(3)} inside ${cons.inside.toFixed(2)}`);
      }
    }
    cfg.consoleErrors = errors.slice(0, 20);
    return cfg;
  } finally { await browser.close(); }
}

function toCell(cfgName, c, res, opts) {
  const m = res.markers || {};
  const markerRatios = ['hp', 'foot', 'insignia'].map(k => (m[k] ? m[k].ratio : null));
  const markersMeasured = markerRatios.every(v => v !== null && Number.isFinite(v));
  const cell = {
    cfg: cfgName, zone: c.zone, surface: c.surface, appearance: c.appearance, pose: c.pose, facing: c.facing, prop: c.prop || '', propMode: c.propMode || '', clip: c.clip, frame: c.frame, purity: r2(c.purity),
    valid: !!res.valid, reason: res.reason || (res.valid && !markersMeasured ? 'a marker could not be measured' : ''),
    edgeP10: res.valid ? r2(res.edge.p10) : null, edgeMin: res.valid ? r2(res.edge.min) : null, edgeMedian: res.valid ? r2(res.edge.median) : null, edgeGroundP10: res.valid ? r2(res.edge.ground.p10) : null, edgeCoreP10: res.valid ? r2(res.edge.core.p10) : null, rimShare: res.valid ? r2(res.edge.rimShare) : null, ringLum: res.valid ? Math.round(res.edge.ringMedian * 1000) / 1000 : null, contourLum: res.valid ? Math.round(res.edge.contourMedian * 1000) / 1000 : null,
    body: res.valid ? r2(res.body.ratio) : null, bodyGround: res.valid ? r2(res.body.ratioGround) : null,
    hp: r2(markerRatios[0]), foot: r2(markerRatios[1]), insignia: r2(markerRatios[2]), plates: m.plates && Number.isFinite(m.plates.ratio) ? r2(m.plates.ratio) : null, overlap: !!c.overlap,
  };
  cell.edgePass = cell.valid && cell.edgeP10 >= opts.edge;
  cell.markerPass = cell.valid && markersMeasured && markerRatios.every(v => v >= opts.marker) && (cell.plates === null || cell.plates >= opts.marker);   // the overhead plates and rings (mask class OTHER) are gated wherever the cell has any
  return cell;
}

// The 24 lowest-EDGE cells, kept with their pixels (a bounded pool, so memory stays small).
const pool = [];
function considerWorst(opts, cell, res, shotImg, size) {
  const score = cell.valid ? cell.edgeP10 : -1;
  if (pool.length >= 40 && score >= pool[pool.length - 1].score) return;
  const rg = res.rect; if (!rg) return;
  const entry = { score, cell, w: rg.w, h: rg.h, rgba: cropRgba(shotImg, rg.x0, rg.y0, rg.w, rg.h), debug: res.debug || null };
  pool.push(entry); pool.sort((a, b) => a.score - b.score); if (pool.length > 40) pool.length = 40;
}

// ---- reports ----------------------------------------------------------------------------------------------------------------------

function groupBy(arr, f) { const m = new Map(); for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
const fmt = v => (v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : v.toFixed(2));
function stat(vals) {
  const v = vals.filter(Number.isFinite); if (!v.length) return null;
  return { n: v.length, min: Math.min(...v), p25: lib.percentile(v, 0.25), median: lib.percentile(v, 0.5), p75: lib.percentile(v, 0.75), max: Math.max(...v) };
}

function buildMarkdown(result, opts) {
  const cells = result.configs.flatMap(c => c.cells), L = [];
  const zones = [...new Set(cells.map(c => c.zone))];
  L.push('# Character contrast gate', '', `Generated ${result.generated}. Gate: EDGE p10 over 16 contour sectors >= ${opts.edge}; markers (hp bar, faction footprint, faction insignia) >= ${opts.marker}. Definition and caveats: docs/rework/CONTRAST_GATE.md.`, '');
  L.push(`GPU: ${[...new Set(result.configs.map(c => c.gpu))].join('; ')}. Frames: ${opts.frames} normal + ${opts.groundFrames} ground averaged per page.`, '');
  L.push('## Pass counts', '', '| config | zone | cells | EDGE p10 >= ' + opts.edge + ' | EDGE min >= ' + opts.edge + ' | core p10 >= ' + opts.edge + ' | markers >= ' + opts.marker + ' | unmeasured |', '|---|---|---:|---:|---:|---:|---:|---:|');
  for (const cfg of result.configs) for (const zone of zones) {
    const cs = cfg.cells.filter(c => c.zone === zone); if (!cs.length) continue;
    L.push(`| ${cfg.name} | ${zone} | ${cs.length} | ${cs.filter(c => c.edgePass).length} | ${cs.filter(c => c.valid && c.edgeMin >= opts.edge).length} | ${cs.filter(c => c.valid && c.edgeCoreP10 >= opts.edge).length} | ${cs.filter(c => c.markerPass).length} | ${cs.filter(c => !c.valid).length} |`);
  }
  L.push('', '## EDGE by zone', '', 'Cell = worst case over every pose, facing, size and quality of: EDGE p10 / EDGE min / BODY, then [core p10] (the edge of the sprite and its dark outline alone, ignoring the light rim). A mark means EDGE p10 below the gate in at least one run. Plain-ground cells only; props are below.', '');
  for (const zone of zones) {
    const zc = cells.filter(c => c.zone === zone && !c.prop);
    const surfaces = [...new Set(zc.map(c => c.surface))];
    L.push(`### ${zone}`, '', '| appearance | ' + surfaces.join(' | ') + ' |', '|---|' + surfaces.map(() => '---:').join('|') + '|');
    for (const app of [...new Set(zc.map(c => c.appearance))]) {
      const row = surfaces.map(s => {
        const cs = zc.filter(c => c.appearance === app && c.surface === s); if (!cs.length) return '';
        const bad = cs.some(c => !c.edgePass), v = k => Math.min(...cs.map(c => (c[k] === null ? Infinity : c[k])));
        return `${fmt(v('edgeP10'))} / ${fmt(v('edgeMin'))} / ${fmt(v('body'))} [${fmt(v('edgeCoreP10'))}]${bad ? ' ✗' : ''}`;
      });
      L.push(`| ${app} | ${row.join(' | ')} |`);
    }
    L.push('');
  }
  L.push('## Props, boundaries and seams (in front of / beside the zone\'s most common props; straddling a surface change `edge:A|B` or a zone seam `seam:a|b`)', '', '| zone | prop | mode | cells | EDGE p10 pass | worst EDGE p10 | worst appearance | markers pass |', '|---|---|---|---:|---:|---:|---|---:|');
  for (const zone of zones) for (const [key, cs] of groupBy(cells.filter(c => c.zone === zone && c.prop), c => c.prop + '|' + c.propMode)) {
    const [prop, mode] = key.split('|'), worst = cs.filter(c => c.valid).sort((a, b) => a.edgeP10 - b.edgeP10)[0];
    L.push(`| ${zone} | ${prop} | ${mode} | ${cs.length} | ${cs.filter(c => c.edgePass).length} | ${worst ? fmt(worst.edgeP10) : 'n/a'} | ${worst ? worst.appearance : ''} | ${cs.filter(c => c.markerPass).length} |`);
  }
  L.push('', '## Markers (worst over every pose, facing, size and quality)', '', '| zone | hp bar min | footprint min | insignia min | cells with all markers >= ' + opts.marker + ' |', '|---|---:|---:|---:|---:|');
  for (const zone of zones) {
    const zc = cells.filter(c => c.zone === zone), mn = k => Math.min(...zc.map(c => (c[k] === null ? Infinity : c[k])));
    L.push(`| ${zone} | ${fmt(mn('hp'))} | ${fmt(mn('foot'))} | ${fmt(mn('insignia'))} | ${zc.filter(c => c.markerPass).length} / ${zc.length} |`);
  }
  L.push('', '## BODY distribution (median interior luminance vs the whole ring; reported, not gated)', '', '| zone | n | min | p25 | median | p75 | max |', '|---|---:|---:|---:|---:|---:|---:|');
  for (const zone of zones) { const s = stat(cells.filter(c => c.zone === zone && !c.prop).map(c => c.body)); if (s) L.push(`| ${zone} | ${s.n} | ${fmt(s.min)} | ${fmt(s.p25)} | ${fmt(s.median)} | ${fmt(s.p75)} | ${fmt(s.max)} |`); }
  const notes = [...new Set(result.configs.flatMap(c => c.notes || []))];
  if (notes.length) L.push('', '## Plan notes', '', ...notes.map(n => '- ' + n));
  const errs = result.configs.flatMap(c => (c.consoleErrors || []).map(e => `${c.name}: ${e}`));
  L.push('', '## Browser console errors', '', errs.length ? errs.map(e => '- ' + e).join('\n') : 'none');
  return L.join('\n') + '\n';
}

function buildJson(result, opts) {
  const strings = []; const idx = new Map(); const S = s => { if (s === '' || s === null || s === undefined) return -1; if (!idx.has(s)) { idx.set(s, strings.length); strings.push(s); } return idx.get(s); };
  const strCols = new Set(['cfg', 'zone', 'surface', 'appearance', 'pose', 'facing', 'prop', 'propMode', 'clip', 'reason']);
  const rows = result.configs.flatMap(c => c.cells).map(c => OUT_COLUMNS.map(k => (strCols.has(k) ? S(c[k]) : typeof c[k] === 'boolean' ? (c[k] ? 1 : 0) : c[k])));
  return {
    tool: 'contrast-gate', version: 1, generated: result.generated, url: opts.url,
    thresholds: { edge: opts.edge, marker: opts.marker, edgeStatistic: 'p10 of 16 angular contour-sector contrast ratios (absolute min and median also reported)', contourPx: 2, ringPx: [3, 12], sectors: 16 },
    frames: { normal: opts.frames, ground: opts.groundFrames },
    configs: result.configs.map(c => ({ name: c.name, width: c.width, height: c.height, quality: c.quality, gpu: c.gpu, qualityRow: c.row, orthoSize: c.orthoSize, consistency: c.consistency, pages: c.pages, cells: c.cells.length, unplaced: c.unplaced, consoleErrors: c.consoleErrors })),
    summary: result.summary,
    columns: OUT_COLUMNS, strings, note: 'string columns hold indexes into "strings" (-1 = empty); booleans are 0/1; ratios are WCAG contrast ratios',
    cells: rows,
  };
}

// ---- contact sheet (drawn in the browser: no image dependencies) -------------------------------------------------------------------------

async function writeWorstSheet(chromium, opts, file) {
  const top = pool.slice(0, 24); if (!top.length) return;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const tiles = top.map(e => {
      const d = e.debug, c = e.cell;
      let viz = null;
      if (d) viz = Buffer.from(d.viz).toString('base64');
      return { w: e.w, h: e.h, rgba: e.rgba.toString('base64'), viz,
        lines: [`${c.zone} / ${c.surface}${c.prop ? ' / ' + c.prop + ' ' + c.propMode : ''}`, `${c.appearance}  ${c.pose} ${c.facing}  ${c.cfg}`, `EDGE p10 ${fmt(c.edgeP10)}  min ${fmt(c.edgeMin)}  med ${fmt(c.edgeMedian)}  core ${fmt(c.edgeCoreP10)}`, `BODY ${fmt(c.body)}  hp ${fmt(c.hp)} foot ${fmt(c.foot)} ins ${fmt(c.insignia)}${c.valid ? '' : '  UNMEASURED'}`] };
    });
    const jpeg = await page.evaluate(async ({ tiles, edge }) => {
      const cols = 6, tw = 330, imgH = 280, th = imgH + 66, rows = Math.ceil(tiles.length / cols);
      const cv = document.createElement('canvas'); cv.width = cols * tw; cv.height = rows * th + 28; const g = cv.getContext('2d');
      g.fillStyle = '#101216'; g.fillRect(0, 0, cv.width, cv.height); g.font = '12px sans-serif';
      g.fillStyle = '#ddd'; g.fillText(`Lowest EDGE cells (EDGE gate ${edge}). Left half: the cell as rendered. Right half: contour sectors (red below the gate, green at or above) and the ground ring (blue).`, 6, 18);
      const bytes = b64 => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
      tiles.forEach((t, i) => {
        const x0 = (i % cols) * tw, y0 = 28 + Math.floor(i / cols) * th;
        const draw = (data, dx) => {
          const c = document.createElement('canvas'); c.width = t.w; c.height = t.h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), t.w, t.h), 0, 0);
          const s = Math.min((tw / 2 - 4) / t.w, imgH / t.h, 2); g.imageSmoothingEnabled = false; g.drawImage(c, x0 + dx + 2, y0 + 2, t.w * s, t.h * s);
        };
        g.fillStyle = '#000'; g.fillRect(x0 + 1, y0 + 1, tw - 2, imgH);
        draw(bytes(t.rgba), 0); if (t.viz) draw(bytes(t.viz), tw / 2);
        g.fillStyle = '#e8e8e8'; t.lines.forEach((l, k) => g.fillText(l, x0 + 4, y0 + imgH + 14 + k * 15));
      });
      return cv.toDataURL('image/jpeg', 0.82);
    }, { tiles, edge: opts.edge });
    fs.writeFileSync(file, Buffer.from(jpeg.split(',')[1], 'base64'));
  } finally { await browser.close(); }
}

// ---- compare two runs ---------------------------------------------------------------------------------------------------------------------

function readCells(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8')); const ix = k => j.columns.indexOf(k);
  const key = r => [r[ix('cfg')], r[ix('zone')], r[ix('surface')], r[ix('appearance')], r[ix('pose')], r[ix('facing')], r[ix('prop')], r[ix('propMode')]].join('|');
  const m = new Map(); for (const r of j.cells) m.set(key(r), { p10: r[ix('edgeP10')], min: r[ix('edgeMin')], body: r[ix('body')], pass: r[ix('edgePass')], frame: r[ix('frame')] });
  return { j, m };
}
function compare(fa, fb, edge) {
  const A = readCells(fa), B = readCells(fb);
  const keys = [...A.m.keys()].filter(k => B.m.has(k));
  const mean = v => v.reduce((s, x) => s + x, 0) / (v.length || 1);
  const bucket = () => ({ n: 0, p10: [], min: [], body: [] });
  const same = bucket(), diff = bucket(), all = bucket();
  let flips = 0, unmeasurable = 0;
  for (const k of keys) {
    const a = A.m.get(k), b = B.m.get(k);
    if (a.p10 === null || b.p10 === null) { unmeasurable++; continue; }
    for (const bk of [all, a.frame === b.frame ? same : diff]) { bk.n++; bk.p10.push(Math.abs(a.p10 - b.p10)); bk.min.push(Math.abs(a.min - b.min)); bk.body.push(Math.abs(a.body - b.body)); }
    if ((a.p10 >= edge) !== (b.p10 >= edge)) flips++;
  }
  const sum = bk => ({ cells: bk.n, edgeP10: { meanAbs: mean(bk.p10), p95: lib.percentile(bk.p10, .95), max: Math.max(0, ...bk.p10) }, edgeMin: { meanAbs: mean(bk.min), max: Math.max(0, ...bk.min) }, body: { meanAbs: mean(bk.body), max: Math.max(0, ...bk.body) } });
  const out = { cellsCompared: keys.length, unmeasurable, passFlips: flips, all: sum(all), sameAnimationFrame: sum(same), differentAnimationFrame: sum(diff) };
  console.log(JSON.stringify(out, null, 2));
  return out;
}

// ---- main ---------------------------------------------------------------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const ci = argv.indexOf('--compare');
  if (ci >= 0) { compare(argv[ci + 1], argv[ci + 2], Number(argv[ci + 3] || 3)); return; }
  const opts = lib.parseArgs(argv);
  if (opts.help) { usage(); return; }
  const url = new URL(opts.url);
  if (url.hostname !== '127.0.0.1') throw new Error(`the page host must be the literal 127.0.0.1 (got ${url.hostname})`);
  const prefix = process.env.RH_STAGE2_PREFIX || path.join(os.homedir(), '.codex/tools/rougehalla-stage2');
  const { chromium } = require(process.env.RH_PLAYWRIGHT_MODULE || path.join(prefix, 'browser/node_modules/playwright'));
  const outDir = path.resolve(opts.out); fs.mkdirSync(outDir, { recursive: true });
  const log = m => console.log(m);
  const result = { generated: new Date().toISOString(), configs: [] };
  for (const size of opts.sizes) for (const quality of opts.quality) {
    log(`config ${size.width}x${size.height} ${quality}`);
    result.configs.push(await runConfig(chromium, size, quality, opts, log));
  }
  const all = result.configs.flatMap(c => c.cells);
  result.summary = { cells: all.length, edgePass: all.filter(c => c.edgePass).length, markerPass: all.filter(c => c.markerPass).length, unmeasured: all.filter(c => !c.valid).length };
  // Visualisation arrays for the worst-cell sheet need the regions again: build them from the pool entries (bounded to 40 cells).
  for (const e of pool) if (e.debug) e.debug.viz = vizOf(e, opts);
  fs.writeFileSync(path.join(outDir, 'contrast.json'), JSON.stringify(buildJson(result, opts)));
  fs.writeFileSync(path.join(outDir, 'CONTRAST.md'), buildMarkdown(result, opts));
  await writeWorstSheet(chromium, opts, path.join(outDir, 'worst.jpg'));
  printSummary(result, opts);
  const failing = all.filter(c => !c.edgePass || !c.markerPass);
  process.exitCode = failing.length ? 1 : 0;
}

/** RGBA picture of the contour sectors (red below the edge gate, green at or above) and the ring (blue) for one pooled cell. */
function vizOf(e, opts) {
  const d = e.debug, out = Buffer.alloc(e.w * e.h * 4);
  for (let i = 0; i < e.w * e.h; i++) { out[4 * i] = 12; out[4 * i + 1] = 14; out[4 * i + 2] = 18; out[4 * i + 3] = 255; }
  if (!d) return out;
  for (let y = 0, i = 0; y < e.h; y++) for (let x = 0; x < e.w; x++, i++) {
    if (d.ring[i]) { out[4 * i] = 40; out[4 * i + 1] = 80; out[4 * i + 2] = 170; }
    else if (d.contour[i]) {
      const ratio = d.sectorRatios[lib.sectorOf(x, y, d.centroid, d.sectors)];
      const bad = !(ratio >= opts.edge);
      out[4 * i] = bad ? 235 : 40; out[4 * i + 1] = bad ? 50 : 200; out[4 * i + 2] = 50;
    } else if (d.interior[i]) { out[4 * i] = 70; out[4 * i + 1] = 70; out[4 * i + 2] = 78; }
  }
  return out;
}

function printSummary(result, opts) {
  const all = result.configs.flatMap(c => c.cells);
  console.log('\n=== Character contrast gate ===');
  console.log(`EDGE p10 >= ${opts.edge}: ${all.filter(c => c.edgePass).length}/${all.length} cells   markers >= ${opts.marker}: ${all.filter(c => c.markerPass).length}/${all.length}   unmeasured: ${all.filter(c => !c.valid).length}`);
  for (const cfg of result.configs) {
    console.log(`\n${cfg.name} (${cfg.gpu})`);
    for (const zone of [...new Set(cfg.cells.map(c => c.zone))]) {
      const kind = k => cfg.cells.filter(c => c.zone === zone && lib.cellKind(c.prop) === k), cs = kind('ground'), ps = kind('props'), es = kind('edge').concat(kind('seam'));
      const bodies = stat(cs.map(c => c.body)), all = cs.length + ps.length + es.length;
      console.log(`  ${zone.padEnd(10)} ground ${String(cs.filter(c => c.edgePass).length).padStart(3)}/${String(cs.length).padEnd(3)} props ${String(ps.filter(c => c.edgePass).length).padStart(3)}/${String(ps.length).padEnd(3)} edges ${String(es.filter(c => c.edgePass).length).padStart(3)}/${String(es.length).padEnd(3)} markers ${String(cfg.cells.filter(c => c.zone === zone && c.markerPass).length).padStart(3)}/${all}  body med ${fmt(bodies && bodies.median)}`);
    }
    if (cfg.consoleErrors && cfg.consoleErrors.length) console.log(`  console errors: ${cfg.consoleErrors.length}`);
  }
  const worst = all.filter(c => c.valid).sort((a, b) => a.edgeP10 - b.edgeP10).slice(0, 8);
  console.log('\nlowest EDGE p10:'); for (const c of worst) console.log(`  ${fmt(c.edgeP10)} (min ${fmt(c.edgeMin)}, body ${fmt(c.body)})  ${c.zone}/${c.surface} ${c.appearance} ${c.pose} ${c.facing} ${c.cfg}`);
  console.log(`\nresult: ${all.some(c => !c.edgePass || !c.markerPass) ? 'FAIL' : 'PASS'}`);
}

main().catch(e => { console.error(e && e.stack || e); process.exitCode = 2; });
