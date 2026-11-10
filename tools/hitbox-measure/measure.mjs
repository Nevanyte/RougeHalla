#!/usr/bin/env node
// ADR0024 P-HB-0: measures the hitbox archetype table from the Unity art, reproducibly.
//
// Inputs (read only): the ShowcaseLive bake receipt (trimmed opaque frame rectangles and foot pivots of every Idle frame)
// and the Showcase catalog (`WorldHeight` per appearance key). Output: the Decision 2 table. `--check` also parses
// `crates/rh-sim/src/archetype.rs` and fails (exit 1) when any boxed row differs from the measurement.
//
// The rule (ADR0024 Decision 2):
//   scale  = WorldHeight * 1.2 / 128 Unity units per pixel (the presenter scales whole 128-PPU cells by WorldHeight, and
//            the actor root by 1.2)
//   top    = (median over Idle frames of the opaque top above the pivot, px) * scale + 0.096 (the presenter's body lift),
//            times 41.03 sim units per vertical Unity unit (32 / GroundSquash 0.78)
//   below  = (median opaque bottom below the pivot, px) * scale - 0.096, times 41.03
//   bx     = half the median Idle width of the N and S facings (Flare directions 3 and 7), px * scale * 32
//   rounding: each value to the nearest whole unit; when top + below is odd, below goes down by one so the box centre
//            (the chest) is a whole unit
//   exception: the skeleton's Idle frames hold a two-handed weapon (all-facing median half-width 36), so its bx is the
//            knight's
//   body half-height by = (top + below) / 2, chest = (top - below) / 2, body offset oy = -chest
//
// Usage: node tools/hitbox-measure/measure.mjs [--check] [--json]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = join(root, 'client-unity', 'UnityProject', 'Assets');
const RECEIPT = join(ASSETS, 'Art', 'Derived', 'ShowcaseLive', 'receipt.json');
const CATALOG = join(ASSETS, 'Resources', 'Showcase', 'Catalog.asset');
const TABLE = join(root, 'crates', 'rh-sim', 'src', 'archetype.rs');

const PPU = 128;
const ROOT_SCALE = 1.2;
const BODY_LIFT = 0.096;
const SIM_PER_UNIT_X = 32;
const GROUND_SQUASH = 0.78;
const SIM_PER_UNIT_Y = SIM_PER_UNIT_X / GROUND_SQUASH;
// Flare direction order in the catalog: SW, W, NW, N, NE, E, SE, S.
const NORTH = 3;
const SOUTH = 7;
const WIDTH_FROM = { skeleton: 'knight' };

function median(values) {
  const a = [...values].sort((x, y) => x - y);
  const n = a.length;
  if (n === 0) throw new Error('median of nothing');
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

function worldHeights() {
  const out = new Map();
  let key = null;
  for (const line of readFileSync(CATALOG, 'utf8').split('\n')) {
    const k = line.match(/^ {2}- Key: (.+)$/);
    if (k) key = k[1].trim();
    const h = line.match(/^ {4}WorldHeight: (.+)$/);
    if (h && key) out.set(key, Number.parseFloat(h[1]));
  }
  return out;
}

export function measure() {
  const receipt = JSON.parse(readFileSync(RECEIPT, 'utf8'));
  const heights = worldHeights();
  const raw = new Map();
  for (const ap of receipt.appearances) {
    const idle = ap.frames.filter((f) => f.clip === 'Idle');
    if (idle.length === 0 || idle.length % 8 !== 0) throw new Error(`${ap.key}: ${idle.length} Idle frames`);
    const perDir = idle.length / 8;
    const wh = heights.get(ap.key);
    if (!(wh > 0)) throw new Error(`${ap.key}: no WorldHeight in the catalog`);
    const scale = (wh * ROOT_SCALE) / PPU;
    const tops = [];
    const bottoms = [];
    const nsWidths = [];
    idle.forEach((f, i) => {
      const pivotY = f.sourcePivotPixels[1];
      tops.push(f.trimOffset[1] + f.trimSize[1] - pivotY);
      bottoms.push(pivotY - f.trimOffset[1]);
      const dir = Math.floor(i / perDir);
      if (dir === NORTH || dir === SOUTH) nsWidths.push(f.trimSize[0]);
    });
    raw.set(ap.key, {
      top: (median(tops) * scale + BODY_LIFT) * SIM_PER_UNIT_Y,
      below: (median(bottoms) * scale - BODY_LIFT) * SIM_PER_UNIT_Y,
      bx: (median(nsWidths) * scale * SIM_PER_UNIT_X) / 2,
    });
  }
  const rows = [];
  for (const [key, r] of raw) {
    const top = Math.round(r.top);
    let below = Math.round(r.below);
    if ((top + below) % 2 !== 0) below -= 1;
    const bx = Math.round(raw.get(WIDTH_FROM[key] ?? key).bx);
    rows.push({ key, top, below, bx, by: (top + below) / 2, chest: (top - below) / 2, raw: r });
  }
  return rows;
}

function tableRows() {
  const text = readFileSync(TABLE, 'utf8');
  const rows = new Map();
  const re = /boxes\(\s*(\d+),\s*"([^"]+)",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s*\)/g;
  for (const m of text.matchAll(re)) {
    rows.set(m[2], { id: Number(m[1]), bx: Number(m[3]), by: Number(m[4]), chest: Number(m[5]) });
  }
  return rows;
}

const args = new Set(process.argv.slice(2));
const rows = measure();
if (args.has('--json')) {
  console.log(JSON.stringify(rows.map(({ raw, ...r }) => r), null, 2));
} else {
  console.log('key                  bx  by  oy  chest  top/below   (raw top, below, bx)');
  for (const r of rows) {
    console.log(
      `${r.key.padEnd(20)} ${String(r.bx).padStart(3)} ${String(r.by).padStart(3)} ${String(-r.chest).padStart(3)} ` +
        `${String(r.chest).padStart(6)}  ${`${r.top}/${r.below}`.padEnd(9)}   ` +
        `(${r.raw.top.toFixed(2)}, ${r.raw.below.toFixed(2)}, ${r.raw.bx.toFixed(2)})`,
    );
  }
}
if (args.has('--check')) {
  const table = tableRows();
  const problems = [];
  for (const r of rows) {
    const t = table.get(r.key);
    if (!t) {
      problems.push(`${r.key}: measured but missing from archetype.rs`);
      continue;
    }
    for (const f of ['bx', 'by', 'chest']) {
      if (t[f] !== r[f]) problems.push(`${r.key}: ${f} is ${t[f]} in archetype.rs, measured ${r[f]}`);
    }
  }
  for (const key of table.keys()) {
    if (!rows.some((r) => r.key === key)) problems.push(`${key}: in archetype.rs but has no art in the receipt`);
  }
  if (problems.length) {
    console.error(`hitbox-measure --check FAILED:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`hitbox-measure --check: ${rows.length} boxed archetypes match crates/rh-sim/src/archetype.rs`);
}
