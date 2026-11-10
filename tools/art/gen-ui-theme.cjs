#!/usr/bin/env node
// Generates the UiTheme colour values from docs/art/palette.json (the palette source of truth), so no hex is hand-copied.
//
//   node tools/art/gen-ui-theme.cjs           write client-unity/UnityProject/Assets/Scripts/UI/UiPaletteTokens.cs
//   node tools/art/gen-ui-theme.cjs --check   fail (exit 1) if the committed file differs from palette.json, or if a text
//                                             role would drop below WCAG 4.5:1 on its surface
//
// Tokens named in palette.json "ui.tokens" and "factions" are converted as authored (OKLCH -> sRGB, Ottosson 2020).
// The remaining UiTheme tokens (sunken/hover/selected/disabled surfaces, strong border, accent-dim, info, the eight build-stat
// tints, scrim) are derived here by fixed OKLCH rules from those authored tokens; the rules are the only numbers in this file.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const palette = JSON.parse(fs.readFileSync(path.join(root, 'docs/art/palette.json'), 'utf8'));
const outFile = path.join(root, 'client-unity/UnityProject/Assets/Scripts/UI/UiPaletteTokens.cs');

const clamp = x => Math.max(0, Math.min(1, x));
const toSrgb8 = c => Math.round(255 * clamp(c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055));
const toLinear = c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
function oklch([L, C, h]) {
  const hr = h * Math.PI / 180, a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (L - .0894841775 * a - 1.2914855480 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.7076147010 * s];
  if (lin.some(v => v < -1e-3 || v > 1 + 1e-3)) throw new Error('out of sRGB gamut: ' + JSON.stringify([L, C, h]));
  return lin.map(toSrgb8);
}
const luminance = rgb => { const [r, g, b] = rgb.map(toLinear); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
// Derived colours may ask for more chroma than sRGB holds at that lightness and hue: take the most that fits.
function fit([L, C, h]) {
  for (let c = C; c >= 0; c -= .002) { try { oklch([L, c, h]); return [L, c, h]; } catch (e) { /* reduce chroma */ } }
  return [L, 0, h];
}
const tweak = ([L, C, h], dL = 0, dC = 0, hue = h) => [L + dL, Math.max(0, C + dC), hue];

const T = palette.ui.tokens;
const alpha = Math.round(255 * palette.ui.panelAlpha);
const factions = ['fire', 'sentenced', 'plague', 'frost', 'holy'];
// Derived stat tints (Offense, Soul, Defense, Soul defense, Health, Attack speed, Move speed, Life steal).
const statHues = [35, 305, 245, 190, 150, 85, 215, 350];

const tokens = {
  Surface: { rgb: oklch(T.surface), a: alpha },
  SurfaceRaised: { rgb: oklch(T.raised), a: 255 },
  SurfaceSunken: { rgb: oklch(tweak(T.surface, -.06)), a: 255 },
  SurfaceHover: { rgb: oklch(tweak(T.raised, .06)), a: 255 },
  SurfaceSelected: { rgb: oklch(tweak(T.raised, .07, .02, T.accent[2])), a: 255 },
  SurfaceDisabled: { rgb: oklch(tweak(T.surface, .03, -.01)), a: 255 },
  Border: { rgb: oklch(T.border), a: 255 },
  BorderStrong: { rgb: oklch(T.accent), a: 255 },
  Scrim: { rgb: oklch(palette.inks.dark), a: 150 },
  TextPrimary: { rgb: oklch(T.textPrimary), a: 255 },
  TextSecondary: { rgb: oklch(T.textSecondary), a: 255 },
  Accent: { rgb: oklch(T.accent), a: 255 },
  AccentDim: { rgb: oklch(tweak(T.accent, -.22, -.02)), a: 255 },
  Danger: { rgb: oklch(T.danger), a: 255 },
  Success: { rgb: oklch(T.success), a: 255 },
  Warning: { rgb: oklch(T.warning), a: 255 },
  Info: { rgb: oklch(fit([.82, .09, 235])), a: 255 },
  OutlineDark: { rgb: oklch(palette.inks.dark), a: 255 },
  OutlineLight: { rgb: oklch(palette.inks.light), a: 255 },
};
const factionColours = factions.map(f => oklch(palette.factions[f].oklch));
const statColours = statHues.map(h => oklch(fit([.80, .11, h])));

function failures() {
  const out = [];
  for (const surface of ['Surface', 'SurfaceRaised', 'SurfaceHover', 'SurfaceSelected', 'SurfaceSunken'])
    for (const role of ['TextPrimary', 'TextSecondary', 'Accent', 'Danger', 'Success', 'Warning', 'Info']) {
      const c = contrast(tokens[role].rgb, tokens[surface].rgb);
      if (c < 4.5) out.push(`${role} on ${surface}: ${c.toFixed(2)}:1 < 4.5`);
    }
  factionColours.forEach((rgb, i) => {
    for (const surface of ['Surface', 'SurfaceRaised']) {
      const c = contrast(rgb, tokens[surface].rgb);
      if (c < 4.5) out.push(`faction ${factions[i]} on ${surface}: ${c.toFixed(2)}:1 < 4.5`);
    }
  });
  statColours.forEach((rgb, i) => { const c = contrast(rgb, tokens.Surface.rgb); if (c < 3) out.push(`stat ${i} on Surface: ${c.toFixed(2)}:1 < 3`); });
  // Dark ink on the accent fill (primary buttons), and the border against the surface (UI component 3:1).
  if (contrast(tokens.OutlineDark.rgb, tokens.Accent.rgb) < 4.5) out.push('OutlineDark on Accent < 4.5');
  if (contrast(tokens.Border.rgb, tokens.Surface.rgb) < 3) out.push('Border on Surface < 3');
  return out;
}

const c32 = ({ rgb, a }) => `new Color32(${rgb.join(', ')}, ${a})`;
const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
function render() {
  const lines = [];
  lines.push('// <auto-generated>');
  lines.push('// Generated by tools/art/gen-ui-theme.cjs from docs/art/palette.json. Do not edit by hand:');
  lines.push('// change palette.json (or the derivation rules in the script) and run `node tools/art/gen-ui-theme.cjs`.');
  lines.push('// `node tools/art/gen-ui-theme.cjs --check` fails when this file is out of date.');
  lines.push('// </auto-generated>');
  lines.push('using UnityEngine;');
  lines.push('');
  lines.push('namespace Roguehalla.Client');
  lines.push('{');
  lines.push('    /// <summary>The UI colour tokens of docs/art/palette.json as 8-bit sRGB, consumed by <see cref="UiTheme"/>.</summary>');
  lines.push('    internal static class UiPaletteTokens');
  lines.push('    {');
  for (const [name, v] of Object.entries(tokens)) lines.push(`        public static readonly Color32 ${name} = ${c32(v)}; // ${hex(v.rgb)}`);
  lines.push('        public static readonly Color32[] Faction =');
  lines.push('        {');
  factionColours.forEach((rgb, i) => lines.push(`            new Color32(${rgb.join(', ')}, 255), // ${factions[i]} ${hex(rgb)}`));
  lines.push('        };');
  lines.push('        public static readonly Color32[] Stat =');
  lines.push('        {');
  statColours.forEach((rgb, i) => lines.push(`            new Color32(${rgb.join(', ')}, 255), // stat ${i} ${hex(rgb)}`));
  lines.push('        };');
  lines.push('    }');
  lines.push('}');
  return lines.join('\n') + '\n';
}

const bad = failures();
const text = render();
if (process.argv.includes('--check')) {
  let code = 0;
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (current !== text) { console.error('UiPaletteTokens.cs is out of date with docs/art/palette.json: run node tools/art/gen-ui-theme.cjs'); code = 1; }
  for (const f of bad) { console.error('contrast: ' + f); code = 1; }
  if (code === 0) console.log('UiPaletteTokens.cs matches palette.json; text contrast checks pass');
  process.exit(code);
}
for (const f of bad) console.error('warning, contrast: ' + f);
fs.writeFileSync(outFile, text);
console.log('wrote ' + path.relative(root, outFile) + (bad.length ? ` (${bad.length} contrast failures)` : ''));
if (bad.length) process.exit(1);
