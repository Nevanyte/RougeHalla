#!/usr/bin/env node
// Reproducible palette report. No dependencies.
//
// Part 1 (legacy, unchanged): grayscale and CVD previews of the five faction Color32 tokens in ShowcasePalette.cs.
// Part 2 (new): reads docs/art/palette.json (colours authored in OKLCH) and checks gamut, WCAG 2.x contrast for every
//   text/surface pair, region separation, the Sentenced "muted but readable" claim, faction-accent distance under
//   colour-vision-deficiency simulation, and faction-accent-on-ground readability for every region.
//
// Usage: node tools/art/palette-check.cjs [--legacy-only | --palette-only]
// Exit code: 0 unless a Part 2 check fails and is not listed under "accepted" in palette.json.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const argv = process.argv.slice(2);
const legacyOnly = argv.includes('--legacy-only');
const paletteOnly = argv.includes('--palette-only');

// Machado et al. (2009), severity 1.0 dichromacy matrices, applied in linear RGB.
const matrices = {
  protanopia: [[.152286,1.052583,-.204868],[.114503,.786281,.099216],[-.003882,-.048116,1.051998]],
  deuteranopia: [[.367322,.860646,-.227968],[.280085,.672501,.047413],[-.011820,.042940,.968881]],
  tritanopia: [[1.255528,-.076749,-.178779],[-.078411,.930809,.147602],[.004733,.691367,.303900]],
};
const linear = c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
const srgb = c => Math.round(255 * (c <= .0031308 ? 12.92 * c : 1.055 * c ** (1/2.4) - .055));
const clamp = x => Math.max(0, Math.min(1, x));
function cvd(rgb, matrix) {
  const v = rgb.map(linear);
  return matrix.map(row => srgb(clamp(row.reduce((sum, x, i) => sum + x * v[i], 0))));
}
function lab(rgb) {
  const [r,g,b] = rgb.map(linear);
  const x=(.4124564*r+.3575761*g+.1804375*b)/.95047;
  const y=.2126729*r+.7151522*g+.0721750*b;
  const z=(.0193339*r+.1191920*g+.9503041*b)/1.08883;
  const f=t=>t>.008856 ? Math.cbrt(t) : 7.787037*t+16/116;
  const [fx,fy,fz]=[f(x),f(y),f(z)];
  return [116*fy-16,500*(fx-fy),200*(fy-fz)];
}
const rgbText = rgb => `#${rgb.map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase()}`;

// ---------------------------------------------------------------------------------------------------------------
// Part 1: legacy ShowcasePalette.cs report (behaviour unchanged).
// ---------------------------------------------------------------------------------------------------------------
function legacyReport() {
  const source = fs.readFileSync(path.join(root, 'client-unity/UnityProject/Assets/Scripts/Presentation/ShowcasePalette.cs'), 'utf8');
  const factions = [...source.matchAll(/new Color32\((\d+),\s*(\d+),\s*(\d+),\s*\d+\),\s*\/\/\s*(\w+)/g)]
    .map(m => ({ name: m[4], rgb: m.slice(1, 4).map(Number) }));
  if (factions.length !== 5) throw new Error(`Expected 5 faction Color32 entries, found ${factions.length}`);
  function report(label, transform) {
    const records = factions.map(({name,rgb}) => {
      const shown = transform(rgb), [L,a,b] = lab(shown);
      return {name, rgb:rgbText(shown), L:+L.toFixed(1), C:Math.hypot(a,b).toFixed(1)};
    });
    console.log(`\n${label} (approximate CIELAB D65 lightness L* and chroma C*ab)`);
    console.log('Faction       Preview    L*    C*ab');
    for (const r of records) console.log(`${r.name.padEnd(13)} ${r.rgb.padEnd(10)} ${String(r.L).padStart(4)}  ${r.C}`);
    console.log('Pair ΔL* < 10: ' + (records.flatMap((a,i)=>records.slice(i+1).filter(b=>Math.abs(a.L-b.L)<10).map(b=>`${a.name}/${b.name} (${Math.abs(a.L-b.L).toFixed(1)})`)).join(', ') || 'none'));
  }
  console.log('Palette input: ShowcasePalette.cs faction Color32 tokens');
  report('Grayscale (linear relative luminance)', rgb => { const y=.2126*linear(rgb[0])+.7152*linear(rgb[1])+.0722*linear(rgb[2]); const g=srgb(y); return [g,g,g]; });
  for (const [name,matrix] of Object.entries(matrices)) report(name, rgb => cvd(rgb,matrix));
  console.log('\nHue is only a supplemental cue: retain faction labels/marks and distinct silhouettes or insignia.');
}

// ---------------------------------------------------------------------------------------------------------------
// Part 2: OKLCH palette checks.
// ---------------------------------------------------------------------------------------------------------------

// OKLab (Ottosson 2020, https://bottosson.github.io/posts/oklab/), linear-light sRGB <-> OKLab.
function oklchToLinearRaw([L, C, h]) {
  const hr = h * Math.PI / 180, a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (L - .0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.7076147010 * s,
  ];
}
function linearToOklab([r, g, b]) {
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [
    .2104542553 * l + .7936177850 * m - .0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .8086757660 * s,
  ];
}
const oklabOfRgb8 = rgb => linearToOklab(rgb.map(linear));
function oklchOfRgb8(rgb) {
  const [L, a, b] = oklabOfRgb8(rgb);
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180 / Math.PI) + 360) % 360];
}
const GAMUT_EPS = 1e-3;
const inGamut = lin => lin.every(v => v >= -GAMUT_EPS && v <= 1 + GAMUT_EPS);
// Largest chroma that stays inside sRGB at this lightness and hue (bisection).
function maxChroma(L, h) {
  let lo = 0, hi = .5;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; (inGamut(oklchToLinearRaw([L, mid, h])) ? lo = mid : hi = mid); }
  return lo;
}
const hexToRgb8 = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function makeColor(spec, id) {
  if (typeof spec === 'string') { const rgb = hexToRgb8(spec); return { id, rgb, hex: spec.toUpperCase(), oklch: oklchOfRgb8(rgb), inGamut: true }; }
  const lin = oklchToLinearRaw(spec);
  const rgb = lin.map(v => srgb(clamp(v)));
  return { id, rgb, hex: rgbText(rgb), oklch: spec, inGamut: inGamut(lin), maxC: maxChroma(spec[0], spec[2]) };
}
const relLum = rgb => .2126 * linear(rgb[0]) + .7152 * linear(rgb[1]) + .0722 * linear(rgb[2]);
function contrast(a, b) { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
const dE = (a, b) => { const p = oklabOfRgb8(a), q = oklabOfRgb8(b); return Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]); };
const over = (fg, bg, alpha) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));
const fx = (n, d = 2) => n.toFixed(d);
const hueDelta = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const fmtOk = ([L, C, h]) => `${fx(L, 2)} ${fx(C, 3)} ${fx(h, 0)}`;
const modes = { normal: rgb => rgb, ...Object.fromEntries(Object.entries(matrices).map(([k, m]) => [k, rgb => cvd(rgb, m)])) };
// Achromatopsia / grayscale printout: linear relative luminance re-encoded as neutral sRGB (same as Part 1).
const grayscale = rgb => { const g = srgb(relLum(rgb)); return [g, g, g]; };

function paletteReport() {
  const file = path.join(root, 'docs/art/palette.json');
  if (!fs.existsSync(file)) { console.log('\n(no docs/art/palette.json: OKLCH checks skipped)'); return 0; }
  const P = JSON.parse(fs.readFileSync(file, 'utf8'));
  const T = P.thresholds;
  const accepted = new Map((P.accepted || []).map(a => [a.id, a.reason]));
  const results = []; // {id, ok, accepted}
  const record = (id, ok) => { results.push({ id, ok, accepted: !ok && accepted.has(id) }); return ok; };
  const flag = (id, ok) => { record(id, ok); return ok ? 'pass' : accepted.has(id) ? 'ACCEPTED' : 'FAIL'; };

  const factionIds = Object.keys(P.factions);
  const regionIds = Object.keys(P.regions);
  const C = {}; // resolved colours by key
  const put = (key, spec) => (C[key] = makeColor(spec, key));
  for (const r of regionIds) {
    const R = P.regions[r];
    for (const s of ['base', 'secondary', 'accent']) put(`${r}.${s}`, R.swatches[s].oklch);
    for (const s of ['key', 'ambient', 'shadow', 'fog']) put(`${r}.${s}`, R.light[s]);
  }
  for (const [k, v] of Object.entries(P.ui.tokens)) put(`ui.${k}`, v);
  for (const f of factionIds) put(`faction.${f}`, P.factions[f].oklch);
  put('ink.dark', P.inks.dark); put('ink.light', P.inks.light);

  console.log('\n# OKLCH palette checks (docs/art/palette.json)');
  console.log('Colours are authored as OKLCH [L, C, h]; hex is the 8-bit sRGB the client uses. Contrast uses WCAG 2.x relative luminance.');

  // --- 1. Gamut ---------------------------------------------------------------------------------------------
  console.log('\n## 1. Gamut (every authored colour must be inside sRGB without clipping)');
  console.log('| Colour | OKLCH (L C h) | Hex | In gamut | Max C at this L,h |');
  console.log('|---|---|---|---|---|');
  let gamutFails = 0;
  for (const [k, c] of Object.entries(C)) {
    const ok = c.inGamut; if (!ok) gamutFails++;
    record(`gamut:${k}`, ok);
    console.log(`| ${k} | ${fmtOk(c.oklch)} | ${c.hex} | ${ok ? 'yes' : 'NO'} | ${fx(c.maxC, 3)} |`);
  }
  console.log(`\nGamut: ${Object.keys(C).length - gamutFails} of ${Object.keys(C).length} in gamut.`);

  // --- 2. Descent from legacy ------------------------------------------------------------------------------
  console.log('\n## 2. Descent from the legacy theme (hue shift of chromatic references must stay within the limit)');
  console.log(`Limit: hue shift <= ${T.legacyHueShiftDeg} deg where the legacy colour has OKLCH chroma >= ${T.legacyMinChroma}.`);
  console.log('| New colour | New OKLCH | Legacy | Legacy OKLCH | dh (deg) | dL | dC | Result |');
  console.log('|---|---|---|---|---|---|---|---|');
  const descent = [];
  for (const r of regionIds) for (const s of ['base', 'secondary', 'accent']) { const sw = P.regions[r].swatches[s]; if (sw.legacy) descent.push([`${r}.${s}`, sw.legacy]); }
  for (const f of factionIds) descent.push([`faction.${f}`, P.factions[f].legacy]);
  for (const [k, v] of Object.entries(P.ui.legacy || {})) descent.push([`ui.${k}`, v]);
  let descentFails = 0;
  for (const [k, hex] of descent) {
    const n = C[k], l = makeColor(hex, 'legacy');
    const dh = hueDelta(n.oklch[2], l.oklch[2]);
    const chromatic = l.oklch[1] >= T.legacyMinChroma && n.oklch[1] >= T.legacyMinChroma;
    const ok = !chromatic || dh <= T.legacyHueShiftDeg;
    const res = flag(`descent:${k}`, ok); if (res === 'FAIL') descentFails++;
    console.log(`| ${k} | ${fmtOk(n.oklch)} | ${hex} | ${fmtOk(l.oklch)} | ${chromatic ? fx(dh, 0) : 'n/a (near neutral)'} | ${fx(n.oklch[0] - l.oklch[0], 2)} | ${fx(n.oklch[1] - l.oklch[1], 3)} | ${res} |`);
  }

  // --- 3. Region 60/30/10 and lighting --------------------------------------------------------------------------
  console.log('\n## 3. Region palettes (60 base / 30 secondary / 10 accent) and lighting');
  console.log('| Region | Base 60% | Secondary 30% | Accent 10% | Key light | Ambient | Shadow tint | Fog/haze |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of regionIds) {
    const cell = k => `${C[`${r}.${k}`].hex} (${fmtOk(C[`${r}.${k}`].oklch)})`;
    console.log(`| ${r} | ${cell('base')} | ${cell('secondary')} | ${cell('accent')} | ${cell('key')} | ${cell('ambient')} | ${cell('shadow')} | ${cell('fog')} |`);
  }
  console.log('\nRole separation and lighting order (L = OKLab lightness, contrast = WCAG ratio):');
  console.log(`| Region | contrast base/secondary (>= ${T.baseSecondaryContrast}) | contrast accent/base (>= ${T.accentBaseContrast}) | key L > ambient L > shadow L | Result |`);
  console.log('|---|---|---|---|---|');
  for (const r of regionIds) {
    const g = k => C[`${r}.${k}`];
    const c1 = contrast(g('base').rgb, g('secondary').rgb), c2 = contrast(g('accent').rgb, g('base').rgb);
    const order = g('key').oklch[0] > g('ambient').oklch[0] && g('ambient').oklch[0] > g('shadow').oklch[0];
    const res = flag(`roles:${r}`, c1 >= T.baseSecondaryContrast && c2 >= T.accentBaseContrast && order);
    console.log(`| ${r} | ${fx(c1)} | ${fx(c2)} | ${order ? 'yes' : 'NO'} (${fx(g('key').oklch[0])} > ${fx(g('ambient').oklch[0])} > ${fx(g('shadow').oklch[0])}) | ${res} |`);
  }

  // --- 4. Region separation ----------------------------------------------------------------------------------
  console.log('\n## 4. Regions are distinguishable by lightness or chroma, not only hue');
  console.log(`A pair of region base colours fails if dL < ${T.regionMinDL} AND dC < ${T.regionMinDC} (i.e. they would differ by hue alone). The Contrast column is the WCAG ratio of the two bases (what a grayscale view would show).`);
  console.log('| Pair | dL | dC | dh (deg) | OKLab dE | Contrast | Result |');
  console.log('|---|---|---|---|---|---|---|');
  for (let i = 0; i < regionIds.length; i++) for (let j = i + 1; j < regionIds.length; j++) {
    const a = C[`${regionIds[i]}.base`], b = C[`${regionIds[j]}.base`];
    const dl = Math.abs(a.oklch[0] - b.oklch[0]), dc = Math.abs(a.oklch[1] - b.oklch[1]);
    const res = flag(`regionsep:${regionIds[i]}/${regionIds[j]}`, dl >= T.regionMinDL || dc >= T.regionMinDC);
    console.log(`| ${regionIds[i]} / ${regionIds[j]} | ${fx(dl)} | ${fx(dc, 3)} | ${fx(hueDelta(a.oklch[2], b.oklch[2]), 0)} | ${fx(dE(a.rgb, b.rgb), 3)} | ${fx(contrast(a.rgb, b.rgb))} | ${res} |`);
  }

  // --- 5. Muted Sentenced -----------------------------------------------------------------------------------
  console.log('\n## 5. Sentenced is deliberately muted: lower chroma, preserved lightness contrast');
  console.log('Chroma = 0.6 base + 0.3 secondary + 0.1 accent (the 60/30/10 weighted mean OKLCH chroma). Lightness contrast = WCAG ratio base/secondary and accent/base.');
  console.log('| Region | Weighted chroma | Base/secondary | Accent/base | Faction accent on base |');
  console.log('|---|---|---|---|---|');
  const stat = {};
  for (const r of regionIds) {
    const g = k => C[`${r}.${k}`];
    const wc = .6 * g('base').oklch[1] + .3 * g('secondary').oklch[1] + .1 * g('accent').oklch[1];
    const fa = P.regions[r].faction ? C[`faction.${P.regions[r].faction}`] : null;
    stat[r] = { wc, bs: contrast(g('base').rgb, g('secondary').rgb), ab: contrast(g('accent').rgb, g('base').rgb) };
    console.log(`| ${r} | ${fx(wc, 3)} | ${fx(stat[r].bs)} | ${fx(stat[r].ab)} | ${fa ? fx(contrast(fa.rgb, g('base').rgb)) : 'n/a'} |`);
  }
  const mutedId = P.mutedRegion;
  const others = regionIds.filter(r => r !== mutedId && r !== 'coliseum');
  const minOtherWc = Math.min(...others.map(r => stat[r].wc));
  const chromaOk = stat[mutedId].wc <= minOtherWc * T.mutedChromaRatio;
  const contrastOk = stat[mutedId].bs >= Math.min(...others.map(r => stat[r].bs)) * T.mutedContrastKeep && stat[mutedId].ab >= Math.min(...others.map(r => stat[r].ab)) * T.mutedContrastKeep;
  console.log(`\nMuted-zone claim (${mutedId}): weighted chroma ${fx(stat[mutedId].wc, 3)} vs lowest other ${fx(minOtherWc, 3)} (must be <= ${T.mutedChromaRatio} x that): ${flag('muted:chroma', chromaOk)}.`);
  console.log(`Lightness contrast kept (>= ${T.mutedContrastKeep} x the weakest other region on both ratios): ${flag('muted:contrast', contrastOk)}.`);

  // --- 6. UI text contrast -----------------------------------------------------------------------------------
  console.log('\n## 6. UI text and component contrast (WCAG 2.x)');
  console.log(`Required: body text ${T.bodyText}:1, large text ${T.largeText}:1, UI component / graphical object ${T.uiComponent}:1.`);
  console.log('| Foreground | Background | Kind | Ratio | Required | Result |');
  console.log('|---|---|---|---|---|---|');
  const req = { body: T.bodyText, large: T.largeText, ui: T.uiComponent };
  let textFails = 0, textPairs = 0;
  for (const p of P.ui.pairs) {
    const fg = C[p.fg], bg = C[p.bg]; textPairs++;
    const ratio = contrast(fg.rgb, bg.rgb), need = req[p.kind];
    const res = flag(`text:${p.fg}|${p.bg}`, ratio >= need); if (res === 'FAIL') textFails++;
    console.log(`| ${p.fg} (${fg.hex}) | ${p.bg} (${bg.hex}) | ${p.kind} | ${fx(ratio)} | ${need} | ${res} |`);
  }
  console.log(`\nPanel text over the world: the HUD panel is drawn at alpha ${P.ui.panelAlpha}, so the world shows through. Worst case is the brightest ground under the panel; text is checked on the composite (sRGB-space blend, as the GPU does).`);
  console.log('| Ground | Panel composite | Primary text | Secondary text | Faction labels (min) | Result |');
  console.log('|---|---|---|---|---|---|');
  for (const r of regionIds) {
    const comp = over(C['ui.surface'].rgb, C[`${r}.base`].rgb, P.ui.panelAlpha);
    const t1 = contrast(C['ui.textPrimary'].rgb, comp), t2 = contrast(C['ui.textSecondary'].rgb, comp);
    const tf = Math.min(...factionIds.map(f => contrast(C[`faction.${f}`].rgb, comp)));
    const res = flag(`panelover:${r}`, t1 >= T.bodyText && t2 >= T.bodyText && tf >= T.bodyText);
    console.log(`| ${r} | ${rgbText(comp)} | ${fx(t1)} | ${fx(t2)} | ${fx(tf)} | ${res} |`);
  }

  // --- 7. Faction accent distance under CVD ------------------------------------------------------------------
  console.log('\n## 7. Faction accents: pairwise distance under colour-vision-deficiency simulation');
  console.log(`Distance is Euclidean in OKLab (about 0.02 is a just-noticeable difference). Each pair must reach dE >= ${T.cvdMinDE} in every simulated mode. Identity is carried by shape and icon first, hue second.`);
  console.log('| Faction | Hex | Shape / silhouette cue | Icon / weapon | Text mark |');
  console.log('|---|---|---|---|---|');
  for (const f of factionIds) console.log(`| ${f} | ${C[`faction.${f}`].hex} | ${P.factions[f].shape} | ${P.factions[f].icon} | ${P.factions[f].mark} |`);
  const pairs = [];
  for (let i = 0; i < factionIds.length; i++) for (let j = i + 1; j < factionIds.length; j++) pairs.push([factionIds[i], factionIds[j]]);
  console.log(`\nThe grayscale column (achromatopsia, lightness only) is held to the lower bar dE >= ${T.grayMinDE}.`);
  console.log('| Pair | normal | protanopia | deuteranopia | tritanopia | grayscale | Min over CVD | Result |');
  console.log('|---|---|---|---|---|---|---|---|');
  let cvdFails = 0;
  for (const [a, b] of pairs) {
    const ds = Object.values(modes).map(m => dE(m(C[`faction.${a}`].rgb), m(C[`faction.${b}`].rgb)));
    const gd = dE(grayscale(C[`faction.${a}`].rgb), grayscale(C[`faction.${b}`].rgb));
    const mn = Math.min(...ds);
    const res = flag(`cvdpair:${a}/${b}`, mn >= T.cvdMinDE && gd >= T.grayMinDE); if (res === 'FAIL') cvdFails++;
    console.log(`| ${a} / ${b} | ${ds.map(d => fx(d, 3)).join(' | ')} | ${fx(gd, 3)} | ${fx(mn, 3)} | ${res} |`);
  }
  console.log('\nSimulated accent colours (hex) and OKLab lightness, per mode:');
  console.log('| Faction | normal | protanopia | deuteranopia | tritanopia |');
  console.log('|---|---|---|---|---|');
  for (const f of factionIds) console.log(`| ${f} | ${Object.values(modes).map(m => { const s = m(C[`faction.${f}`].rgb); return `${rgbText(s)} L${fx(oklabOfRgb8(s)[0])}`; }).join(' | ')} |`);

  // --- 8. Faction accent on ground ---------------------------------------------------------------------------
  console.log('\n## 8. A faction-accented character must stay readable on every region ground');
  console.log(`A marker (ring/mantle/pip) is readable on a ground if EITHER its fill reaches ${T.actorContrast}:1 against the ground directly (route "D"), OR it is drawn with the 2 px outline ink (dark ${C['ink.dark'].hex} or light ${C['ink.light'].hex}) and both ink/ground and ink/accent reach ${T.actorContrast}:1 (route "H", halo). The table shows the best achievable ratio; the route in brackets. Evaluated on the normal and the three simulated views, for the 60% base and the 30% secondary of each ground.`);
  const grounds = [];
  for (const r of regionIds) { grounds.push([`${r}.base`, r + ' base']); grounds.push([`${r}.secondary`, r + ' secondary']); }
  function best(accRgb, grdRgb) {
    const d = contrast(accRgb, grdRgb);
    const opts = [['D', d]];
    for (const [nm, ink] of [['H dark', C['ink.dark'].rgb], ['H light', C['ink.light'].rgb]]) {
      opts.push([nm, Math.min(contrast(ink, grdRgb), contrast(ink, accRgb))]);
    }
    opts.sort((x, y) => y[1] - x[1]);
    return { ratio: opts[0][1], route: opts[0][0], direct: d };
  }
  let actorFails = 0, actorTotal = 0, actorPass = 0;
  for (const [modeName, m] of Object.entries(modes)) {
    console.log(`\n${modeName}:`);
    console.log(`| Faction | ${grounds.map(g => g[1]).join(' | ')} |`);
    console.log(`|---|${grounds.map(() => '---').join('|')}|`);
    for (const f of factionIds) {
      const cells = grounds.map(([gk]) => {
        const b = best(m(C[`faction.${f}`].rgb), m(C[gk].rgb));
        actorTotal++;
        const ok = b.ratio >= T.actorContrast;
        const res = flag(`actor:${modeName}:${f}@${gk}`, ok);
        if (res === 'pass') actorPass++; if (res === 'FAIL') actorFails++;
        return `${fx(b.ratio, 1)} [${b.route[0]}]${res === 'pass' ? '' : ' ' + res}`;
      });
      console.log(`| ${f} | ${cells.join(' | ')} |`);
    }
  }
  console.log(`\nActor-on-ground: ${actorPass} of ${actorTotal} combinations pass.`);
  console.log('Direct (no halo) readability, normal vision, minimum over all faction/ground pairs: ' + (() => {
    let mn = 99, at = '';
    for (const f of factionIds) for (const [gk] of grounds) { const c = contrast(C[`faction.${f}`].rgb, C[gk].rgb); if (c < mn) { mn = c; at = `${f}@${gk}`; } }
    return `${fx(mn)}:1 (${at}); this is why the outline halo is mandatory, not optional.`;
  })());

  // --- Summary -----------------------------------------------------------------------------------------------
  const failed = results.filter(r => !r.ok && !r.accepted);
  const acc = results.filter(r => !r.ok && r.accepted);
  console.log('\n## Summary');
  console.log(`Checks: ${results.length} total, ${results.filter(r => r.ok).length} pass, ${acc.length} accepted, ${failed.length} fail.`);
  if (acc.length) { console.log('\nAccepted exceptions:'); for (const r of acc) console.log(`- ${r.id}: ${accepted.get(r.id)}`); }
  if (failed.length) { console.log('\nFAILURES:'); for (const r of failed) console.log(`- ${r.id}`); }
  return failed.length;
}

if (!paletteOnly) legacyReport();
let failures = 0;
if (!legacyOnly) failures = paletteReport();
process.exit(failures ? 1 : 0);
