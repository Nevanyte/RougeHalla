#!/usr/bin/env node
// Reproducible palette-only grayscale and CVD preview report. No dependencies.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'client-unity/UnityProject/Assets/Scripts/Presentation/ShowcasePalette.cs'), 'utf8');
const factions = [...source.matchAll(/new Color32\((\d+),\s*(\d+),\s*(\d+),\s*\d+\),\s*\/\/\s*(\w+)/g)]
  .map(m => ({ name: m[4], rgb: m.slice(1, 4).map(Number) }));
if (factions.length !== 5) throw new Error(`Expected 5 faction Color32 entries, found ${factions.length}`);

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
