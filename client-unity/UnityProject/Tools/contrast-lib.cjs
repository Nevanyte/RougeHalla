'use strict';
// Pure functions of the character-contrast gate (no browser, no file system): WCAG luminance and ratio, PNG decode, the mask classes the
// contrast lab draws, Euclidean distance transforms, contour/ring/interior extraction, per-sector statistics and argument parsing.
// Tools/contrast-gate.cjs drives the browser and calls these; Tools/contrast-lib.test.cjs checks them on synthetic images with known answers.
// Definition: docs/rework/CONTRAST_GATE.md.
const zlib = require('node:zlib');

// ---- WCAG 2.x ------------------------------------------------------------------------------------------------------------

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }

/** sRGB channel code (0..255) to linear light (0..1). */
function linearise(code) { return LIN[code]; }
/** Relative luminance of an sRGB pixel (codes 0..255): 0.2126 R + 0.7152 G + 0.0722 B on the linearised channels. */
function relativeLuminance(r, g, b) { return 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b]; }
/** sRGB code for a linear value (inverse of linearise), for building test images. */
function encodeSrgb(lin) { const v = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(v * 255))); }
/** WCAG contrast ratio of two relative luminances, order-independent: (Lhi + 0.05) / (Llo + 0.05). */
function contrastRatio(a, b) { const hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); }

/** Luminance plane (Float32Array, one value per pixel) of an RGBA/RGB byte buffer. */
function luminancePlane(data, w, h, channels = 4) {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += channels) out[i] = 0.2126 * LIN[data[p]] + 0.7152 * LIN[data[p + 1]] + 0.0722 * LIN[data[p + 2]];
  return out;
}

// ---- Statistics ----------------------------------------------------------------------------------------------------------

function median(values) { return percentile(values, 0.5); }
/** Percentile with linear interpolation between order statistics (index p * (n - 1)); NaN for an empty input. */
function percentile(values, p) {
  const n = values.length; if (!n) return NaN;
  const s = Float64Array.from(values).sort();
  const k = Math.max(0, Math.min(1, p)) * (n - 1), lo = Math.floor(k), hi = Math.ceil(k);
  return s[lo] + (s[hi] - s[lo]) * (k - lo);
}

// ---- PNG decode (8-bit, non-interlaced, grey/RGB/RGBA) -------------------------------------------------------------------------

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; ctype = body[9]; interlace = body[12]; }
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || ![0, 2, 4, 6].includes(ctype)) throw new Error(`unsupported PNG (depth ${depth}, type ${ctype}, interlace ${interlace})`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype], stride = w * ch, raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch] : 0, b = y > 0 ? px[up + x] : 0, c = x >= ch && y > 0 ? px[up + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  // Normalise to RGBA.
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (ch === 4) { rgba[4 * i] = px[4 * i]; rgba[4 * i + 1] = px[4 * i + 1]; rgba[4 * i + 2] = px[4 * i + 2]; rgba[4 * i + 3] = px[4 * i + 3]; }
    else if (ch === 3) { rgba[4 * i] = px[3 * i]; rgba[4 * i + 1] = px[3 * i + 1]; rgba[4 * i + 2] = px[3 * i + 2]; rgba[4 * i + 3] = 255; }
    else { const g = px[ch * i]; rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = g; rgba[4 * i + 3] = ch === 2 ? px[2 * i + 1] : 255; }
  }
  return { width: w, height: h, data: rgba };
}

/** Minimal PNG encoder (RGBA, 8-bit) used by the unit tests to round-trip the decoder. */
function encodePng(width, height, rgba) {
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = b => { let c = -1; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, body) => { const t = Buffer.from(type, 'latin1'), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(body.length); c.writeUInt32BE(crc(Buffer.concat([t, body]))); return Buffer.concat([l, t, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- Mask classes (RhContrastMask.shader / ContrastLabStage.ClassColors) -----------------------------------------------------

const CLASS = { SIL: 0, HP: 1, FOOT: 2, INSIGNIA: 3, OTHER: 4, RIM: 5, NONE: 255 };
const CLASS_NAMES = ['silhouette', 'hp', 'foot', 'insignia', 'other', 'rim'];
/** Class of a mask pixel by thresholding each channel at 128: red = silhouette core (sprite + dark outline + mantle + weapon), cyan = light rim, green = hp bar, blue = footprint, yellow = insignia, magenta = other. */
function classifyMaskPixel(r, g, b) {
  const R = r > 127, G = g > 127, B = b > 127;
  if (R && !G && !B) return CLASS.SIL;
  if (!R && G && !B) return CLASS.HP;
  if (!R && !G && B) return CLASS.FOOT;
  if (R && G && !B) return CLASS.INSIGNIA;
  if (R && !G && B) return CLASS.OTHER;
  if (!R && G && B) return CLASS.RIM;
  return CLASS.NONE;
}
function decodeMask(data, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = classifyMaskPixel(data[4 * i], data[4 * i + 1], data[4 * i + 2]);
  return out;
}

// ---- Euclidean distance transform (Felzenszwalb & Huttenlocher) ---------------------------------------------------------------

const INF = 1e20;
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
}
/** Distance (in pixels, Euclidean) from every pixel to the nearest pixel where feature[i] != 0; 0 on features, huge when there are none. */
function distanceTo(feature, w, h) {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = feature[i] ? 0 : INF;
  const m = Math.max(w, h), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = grid[y * w + x]; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) grid[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = grid[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) grid[y * w + x] = d[x]; }
  const out = new Float32Array(w * h); for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(grid[i]);
  return out;
}

/** Binary erosion by an r-pixel disc: a pixel survives when every pixel within r of it is set. */
function erode(mask, w, h, r) {
  const outside = new Uint8Array(w * h); for (let i = 0; i < outside.length; i++) outside[i] = mask[i] ? 0 : 1;
  const d = distanceTo(outside, w, h), out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] && d[i] > r ? 1 : 0;
  return out;
}
/** Binary dilation by an r-pixel disc. */
function dilate(mask, w, h, r) {
  const d = distanceTo(mask, w, h), out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i] <= r ? 1 : 0;
  return out;
}

// ---- Contour / ring / interior ----------------------------------------------------------------------------------------------

const DEFAULTS = { contourWidth: 2, ringNear: 3, ringFar: 12, sectors: 16, minSectorPixels: 6, markerSectors: 8, minMaskPixels: 150, minMarkerPixels: 12 };

/**
 * Regions of one mask inside a window. `shape` and `occupied` are Uint8Array(w*h): shape = the object's pixels; occupied = every pixel any
 * actor mask covers (so neighbours, markers and the object never count as ground).
 * contour = shape pixels within `contourWidth` px of outside the shape (the outer 2 px); interior = shape eroded by `contourWidth`;
 * ring = free (not occupied) pixels whose distance to the shape is between ringNear and ringFar.
 */
function regions(shape, occupied, w, h, o = DEFAULTS) {
  const notShape = new Uint8Array(w * h); for (let i = 0; i < notShape.length; i++) notShape[i] = shape[i] ? 0 : 1;
  const distIn = distanceTo(notShape, w, h), distOut = distanceTo(shape, w, h);
  const contour = new Uint8Array(w * h), interior = new Uint8Array(w * h), ring = new Uint8Array(w * h);
  for (let i = 0; i < contour.length; i++) {
    if (shape[i]) { if (distIn[i] <= o.contourWidth) contour[i] = 1; else interior[i] = 1; }
    else if (!occupied[i] && distOut[i] >= o.ringNear && distOut[i] <= o.ringFar) ring[i] = 1;
  }
  return { contour, interior, ring };
}

function centroid(mask, w, h) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) if (mask[i]) { sx += x; sy += y; n++; }
  return n ? { x: sx / n, y: sy / n, n } : { x: 0, y: 0, n: 0 };
}
function sectorOf(x, y, c, sectors) {
  const a = Math.atan2(y - c.y, x - c.x) + Math.PI; // 0..2pi
  return Math.min(sectors - 1, Math.floor((a / (2 * Math.PI)) * sectors));
}

/**
 * Per-sector contrast: for each angular sector around the centroid, the contour's median luminance against the sector's ring median.
 * Returns { ratios (NaN for sectors without enough pixels), valid count, min, p10, median } over the valid sectors.
 */
function sectorContrast(lumContour, lumRing, contour, ring, w, h, c, o = DEFAULTS, sectors = o.sectors) {
  const cs = Array.from({ length: sectors }, () => []), rs = Array.from({ length: sectors }, () => []);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    if (contour[i]) cs[sectorOf(x, y, c, sectors)].push(lumContour[i]);
    else if (ring[i]) rs[sectorOf(x, y, c, sectors)].push(lumRing[i]);
  }
  const ratios = [], contourMed = [], ringMed = [];
  for (let s = 0; s < sectors; s++) {
    if (cs[s].length >= o.minSectorPixels && rs[s].length >= o.minSectorPixels) {
      const a = median(cs[s]), b = median(rs[s]); contourMed.push(a); ringMed.push(b); ratios.push(contrastRatio(a, b));
    } else { contourMed.push(NaN); ringMed.push(NaN); ratios.push(NaN); }
  }
  const ok = ratios.filter(Number.isFinite);
  return { ratios, contourMed, ringMed, valid: ok.length, min: ok.length ? Math.min(...ok) : NaN, p10: percentile(ok, 0.1), median: percentile(ok, 0.5) };
}

/**
 * Analyse one cell. All arrays are full-frame, `width` x `height`.
 *   lumNormal   luminance plane of the normal frame (averaged over several frames)
 *   lumGround   luminance plane of the no-actors frame
 *   mask        class plane from the mask frame (CLASS.*), NONE where nothing is drawn
 *   rect        {x,y,w,h} of the cell in pixels (the renderers' bounds, shadow excluded)
 * EDGE   silhouette contour vs the ring, per sector (p10 gated, min and median reported); `ground` repeats it against the no-actors ring.
 * BODY   median luminance of the interior vs the median of the whole ring.
 * MARKERS hp bar, faction footprint, faction insignia: marker contour median vs marker ring median (8 sectors reported for the minimum).
 */
function analyzeCell({ width, height, lumNormal, lumGround, mask, rect }, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, pad = 24, own = 4;
  const x0 = Math.max(0, Math.floor(rect.x) - pad), y0 = Math.max(0, Math.floor(rect.y) - pad);
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w) + pad), y1 = Math.min(height, Math.ceil(rect.y + rect.h) + pad);
  const w = x1 - x0, h = y1 - y0;
  const cls = new Uint8Array(w * h), ln = new Float32Array(w * h), lg = new Float32Array(w * h), occupied = new Uint8Array(w * h), mine = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y0 + y) * width + x0 + x, d = y * w + x;
    cls[d] = mask[s]; ln[d] = lumNormal[s]; lg[d] = lumGround ? lumGround[s] : lumNormal[s]; occupied[d] = mask[s] !== CLASS.NONE ? 1 : 0;
    const px = x0 + x, py = y0 + y;
    mine[d] = px >= rect.x - own && px <= rect.x + rect.w + own && py >= rect.y - own && py <= rect.y + rect.h + own ? 1 : 0;
  }
  const shapeOf = (...ks) => { const m = new Uint8Array(w * h); let n = 0; for (let i = 0; i < m.length; i++) if (ks.includes(cls[i]) && mine[i]) { m[i] = 1; n++; } return { m, n }; };
  const result = { valid: false, reason: '', edge: null, body: null, markers: {}, rect: { x0, y0, w, h } };
  // The silhouette as drawn: the core (sprite, dark outline, mantle, weapon cue) plus the light rim.
  const sil = shapeOf(CLASS.SIL, CLASS.RIM), core = shapeOf(CLASS.SIL);
  if (sil.n < o.minMaskPixels || core.n < o.minMaskPixels) { result.reason = `silhouette mask has only ${sil.n} px`; return result; }
  const r = regions(sil.m, occupied, w, h, o), c = centroid(sil.m, w, h);
  const edge = sectorContrast(ln, ln, r.contour, r.ring, w, h, c, o);
  const ground = sectorContrast(ln, lg, r.contour, r.ring, w, h, c, o);
  // The core alone (what the edge would be without the rim): its contour against the ring beyond the rim.
  const rc = regions(core.m, occupied, w, h, o), cc = centroid(core.m, w, h);
  const coreEdge = sectorContrast(ln, ln, rc.contour, rc.ring, w, h, cc, o);
  const ringVals = [], ringGround = [], interiorVals = [];
  for (let i = 0; i < r.ring.length; i++) { if (r.ring[i]) { ringVals.push(ln[i]); ringGround.push(lg[i]); } if (rc.interior[i]) interiorVals.push(ln[i]); }
  if (!edge.valid || ringVals.length < 30) { result.reason = `no measurable sectors (${edge.valid} valid, ${ringVals.length} ring px)`; return result; }
  result.valid = true;
  if (opts.debug) result.debug = { contour: r.contour, ring: r.ring, interior: r.interior, centroid: c, sectors: o.sectors, sectorRatios: edge.ratios, sectorContour: edge.contourMed, sectorRing: edge.ringMed };
  const rimPx = sil.n - core.n;
  result.edge = { p10: edge.p10, min: edge.min, median: edge.median, sectors: edge.valid, ratios: edge.ratios,
    ground: { p10: ground.p10, min: ground.min, median: ground.median }, contourMedian: median(Float64Array.from(edge.contourMed.filter(Number.isFinite))), ringMedian: median(ringVals),
    core: { p10: coreEdge.p10, min: coreEdge.min, median: coreEdge.median, sectors: coreEdge.valid }, rimShare: rimPx / sil.n };
  const bodyL = interiorVals.length ? median(interiorVals) : NaN;
  result.body = { ratio: Number.isFinite(bodyL) ? contrastRatio(bodyL, median(ringVals)) : NaN, ratioGround: Number.isFinite(bodyL) ? contrastRatio(bodyL, median(ringGround)) : NaN, interiorPx: interiorVals.length, luminance: bodyL, ringLuminance: median(ringVals) };
  for (const [name, k] of [['hp', CLASS.HP], ['foot', CLASS.FOOT], ['insignia', CLASS.INSIGNIA], ['plates', CLASS.OTHER]]) {
    const mk = shapeOf(k);
    if (mk.n < o.minMarkerPixels) { result.markers[name] = null; continue; }
    const mr = regions(mk.m, occupied, w, h, o), mc = centroid(mk.m, w, h);
    const cv = [], rv = [];
    for (let i = 0; i < mr.ring.length; i++) { if (mr.contour[i]) cv.push(ln[i]); else if (mr.ring[i]) rv.push(ln[i]); }
    if (cv.length < o.minSectorPixels || rv.length < o.minSectorPixels) { result.markers[name] = { ratio: NaN, min: NaN, px: mk.n, note: 'no ground ring' }; continue; }
    const sc = sectorContrast(ln, ln, mr.contour, mr.ring, w, h, mc, o, o.markerSectors);
    result.markers[name] = { ratio: contrastRatio(median(cv), median(rv)), min: sc.min, px: mk.n, contourLuminance: median(cv), ringLuminance: median(rv) };
  }
  return result;
}

// ---- Frame consistency ------------------------------------------------------------------------------------------------------------

/**
 * Guard against stale or mismatched captures. The normal and no-actors frames must agree away from the actors (only ambient motion differs),
 * and the normal frame must differ from the ground frame where the mask says a silhouette is. Returns mean relative differences:
 * far = |normal - ground| / (ground + 0.05) over pixels more than `margin` px from any mask pixel; inside = the same over silhouette pixels.
 */
function frameConsistency(lumNormal, lumGround, mask, w, h, margin = 30) {
  const any = new Uint8Array(w * h); for (let i = 0; i < any.length; i++) any[i] = mask[i] !== CLASS.NONE ? 1 : 0;
  const d = distanceTo(any, w, h), far = [];
  let inSum = 0, inN = 0;
  for (let i = 0; i < any.length; i++) {
    const rel = Math.abs(lumNormal[i] - lumGround[i]) / (lumGround[i] + 0.05);
    if (d[i] > margin) { if (i % 5 === 0) far.push(rel); } else if (mask[i] === CLASS.SIL) { inSum += rel; inN++; }
  }
  // The median, not the mean: lava, bog and ice animate, so a few pixels always differ a lot; a stale or mismatched frame differs nearly everywhere.
  return { far: far.length ? median(far) : 0, inside: inN ? inSum / inN : 0, farPx: far.length * 5, insidePx: inN };
}

// ---- Cell kinds -------------------------------------------------------------------------------------------------------------------

/** 'ground' (plain surface), 'props' (in front of / beside a prop), 'edge' (straddling a surface change) or 'seam' (straddling two zones). */
function cellKind(prop) {
  if (!prop) return 'ground';
  if (String(prop).startsWith('edge:')) return 'edge';
  if (String(prop).startsWith('seam:')) return 'seam';
  return 'props';
}

// ---- Arguments -------------------------------------------------------------------------------------------------------------------

const ZONES = ['fire', 'sentenced', 'plague', 'frost', 'holy', 'coliseum'];
function parseSizes(text) {
  return text.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const m = /^(\d{3,5})x(\d{3,5})$/.exec(s); if (!m) throw new Error(`bad size "${s}" (want 1920x1080)`);
    return { width: +m[1], height: +m[2] };
  });
}
/** `Ember:1,Bog` -> Map(surface or page kind -> max pages (0 = all)): the gate then visits only those pages (quick tuning runs). */
function parseOnly(text) {
  const m = new Map();
  for (const part of text.split(',').map(s => s.trim()).filter(Boolean)) { const [k, n] = part.split(':'); m.set(k.toLowerCase(), n === undefined ? 0 : Number(n)); }
  return m;
}
function parseArgs(argv) {
  const o = { url: 'http://127.0.0.1:8187/', out: 'contrast-gate-out', zones: ZONES.slice(), sizes: parseSizes('1920x1080,2560x1440'), quality: ['high', 'ultra'], edge: 3.0, marker: 4.5, query: '',
    frames: 4, groundFrames: 3, maxFar: 0.30, minInside: 0.15, maxPages: 0, only: null, allowSoftware: false, help: false, raw: '' };
  const need = (i, name) => { if (i + 1 >= argv.length) throw new Error(`--${name} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--url': o.url = need(i++, 'url'); break;
      case '--out': o.out = need(i++, 'out'); break;
      case '--zones': o.zones = need(i++, 'zones').split(',').map(s => s.trim().toLowerCase()).filter(Boolean); break;
      case '--sizes': o.sizes = parseSizes(need(i++, 'sizes')); break;
      case '--quality': o.quality = need(i++, 'quality').split(',').map(s => s.trim().toLowerCase()).filter(Boolean); break;
      case '--edge': o.edge = Number(need(i++, 'edge')); break;
      case '--marker': o.marker = Number(need(i++, 'marker')); break;
      case '--query': o.query = need(i++, 'query'); break;
      case '--frames': o.frames = Number(need(i++, 'frames')); break;
      case '--ground-frames': o.groundFrames = Number(need(i++, 'ground-frames')); break;
      case '--max-pages': o.maxPages = Number(need(i++, 'max-pages')); break;
      case '--only': o.only = parseOnly(need(i++, 'only')); break;
      case '--raw': o.raw = require('node:path').resolve(need(i++, 'raw')); break;
      case '--allow-software': o.allowSoftware = true; break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Error(`unknown option ${a}`);
    }
  }
  for (const z of o.zones) if (!ZONES.includes(z)) throw new Error(`unknown zone "${z}" (${ZONES.join(', ')})`);
  for (const q of o.quality) if (!['low', 'medium', 'high', 'ultra'].includes(q)) throw new Error(`unknown quality "${q}"`);
  if (!(o.edge > 0) || !(o.marker > 0)) throw new Error('--edge and --marker must be positive numbers');
  if (!(o.frames >= 1) || !(o.groundFrames >= 1)) throw new Error('--frames must be at least 1');
  if (o.query && !o.query.startsWith('&')) o.query = '&' + o.query.replace(/^\?/, '');
  return o;
}

module.exports = {
  linearise, relativeLuminance, encodeSrgb, contrastRatio, luminancePlane, median, percentile, decodePng, encodePng, CLASS, CLASS_NAMES, classifyMaskPixel, decodeMask,
  distanceTo, erode, dilate, regions, centroid, sectorOf, sectorContrast, analyzeCell, frameConsistency, cellKind, parseOnly, parseArgs, parseSizes, ZONES, DEFAULTS,
};
