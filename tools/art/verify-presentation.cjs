#!/usr/bin/env node
// Static presentation checks that do not require Unity or an Editor session.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const unity = path.join(root, 'client-unity/UnityProject');
const paletteFile = path.join(unity, 'Assets/Scripts/Presentation/ShowcasePalette.cs');
const paletteSource = fs.readFileSync(paletteFile, 'utf8');
const failures = [];
const warnings = [];
const pass = [];

function requireFile(relative) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) failures.push(`missing required file: ${relative}`);
  else pass.push(`file present: ${relative}`);
}

function readColor(name) {
  const match = paletteSource.match(new RegExp(`\\b${name}\\s*=\\s*new Color32\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\)`));
  if (!match) return null;
  return match.slice(1).map(Number).slice(0, 3);
}

function relativeLuminance([r, g, b]) {
  const linear = v => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a, b) {
  const l1 = relativeLuminance(a), l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

for (const file of [
  'client-unity/THIRD_PARTY_ASSETS.md',
  'client-unity/UnityProject/Assets/Art/ThirdParty/Flare/Raw/LICENSE.txt',
  'client-unity/UnityProject/Assets/Art/ThirdParty/Flare/Raw/CREDITS.txt',
  'client-unity/UnityProject/Assets/Art/ThirdParty/Flare/sprite-frame-metadata.json',
  'client-unity/UnityProject/Assets/TextMesh Pro/License.Unity.md',
  'client-unity/UnityProject/Assets/TextMesh Pro/Fonts/LiberationSans - OFL.txt',
  'client-unity/UnityProject/Assets/TextMesh Pro/Sprites/EmojiOne Attribution.txt',
]) requireFile(file);

let metadata;
try {
  metadata = JSON.parse(fs.readFileSync(path.join(unity, 'Assets/Art/ThirdParty/Flare/sprite-frame-metadata.json'), 'utf8'));
  if (!metadata.source?.license || !metadata.source?.repository || !metadata.source?.commit) {
    failures.push('Flare metadata lacks source license, repository, or commit');
  }
  const refs = new Set();
  let animationCount = 0;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.frames) && value.properties && typeof value.name === 'string') {
      animationCount++;
      const declared = Number.parseInt(value.properties.frames, 10);
      const frames = value.frames;
      const seen = new Set();
      if (!Number.isInteger(declared) || declared < 1) failures.push(`invalid declared frame count for ${value.name}`);
      if (frames.length !== declared * 8) failures.push(`${value.name}: expected ${declared * 8} direction/frame records, found ${frames.length}`);
      for (const frame of frames) {
        const { direction, frameIndex } = frame;
        if (!Number.isInteger(direction) || direction < 0 || direction > 7) {
          failures.push(`${value.name}: direction ${direction} is outside 0..7`);
        }
        if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= declared) {
          failures.push(`${value.name}: frameIndex ${frameIndex} is outside 0..${declared - 1}`);
        }
        const key = `${direction}/${frameIndex}`;
        if (seen.has(key)) failures.push(`${value.name}: duplicate direction/frameIndex ${key}`);
        seen.add(key);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'image' || key === 'animationDefinition') && typeof child === 'string') refs.add(child);
      else visit(child);
    }
  }
  visit(metadata);
  for (const rel of refs) {
    const full = path.join(unity, 'Assets', rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) failures.push(`missing metadata resource: Assets/${rel}`);
  }
  if (refs.size) pass.push(`Flare metadata resources present: ${refs.size}`);
  if (animationCount) pass.push(`Flare animation tuple coverage valid: ${animationCount} clips`);
  const originalFiles=metadata.sourceFiles || [];
  for(const file of originalFiles) verifyHash(path.join(unity,'Assets',file.path),file);
  pass.push(`original Flare source bytes verified: ${originalFiles.length}`);
} catch (error) {
  failures.push(`invalid Flare metadata: ${error.message}`);
}

function verifyHash(filename, record) {
  try {
    const data=fs.readFileSync(filename);
    if(crypto.createHash('sha256').update(data).digest('hex')!==record.sha256 || record.bytes!==undefined && data.length!==record.bytes)
      failures.push(`source hash/size mismatch: ${path.relative(root,filename)}`);
  } catch(error) { failures.push(`source unavailable: ${path.relative(root,filename)} (${error.message})`); }
}
for(const [manifest,base] of [
  ['Art/ThirdParty/Flare/Audio/manifest.json','Art/ThirdParty/Flare/Audio'],
  ['Art/ThirdParty/Flare/armor-manifest.json','Art/ThirdParty/Flare/Raw']
]) {
  try {
    const data=JSON.parse(fs.readFileSync(path.join(unity,'Assets',manifest),'utf8'));
    for(const file of data.assets) verifyHash(path.join(unity,'Assets',base,file.file),file);
    pass.push(`pinned audio/armor source bytes verified: ${data.assets.length} (${manifest})`);
  } catch(error) { failures.push(`invalid source manifest: ${manifest}: ${error.message}`); }
}
verifyHash(path.join(unity,'Assets/Art/ThirdParty/Fonts/CinzelDecorative-Regular.ttf'),{sha256:'5b862be329103ad287a10f0a53e27a40e8cc519999253f1a0223e2dc330b10b8'});

const background = readColor('Background');
if (!background) failures.push('could not parse Background Color32 from ShowcasePalette.cs');
else {
  const textPairs = [
    ['Text', ['Background', 'Panel', 'PanelRaised']],
    ['MutedText', ['Background', 'Panel', 'PanelRaised']],
  ];
  for (const [foregroundName, backgrounds] of textPairs) {
    const foreground = readColor(foregroundName);
    if (!foreground) { failures.push(`could not parse ${foregroundName} Color32 from ShowcasePalette.cs`); continue; }
    for (const backgroundName of backgrounds) {
      const bg = readColor(backgroundName);
      if (!bg) { failures.push(`could not parse ${backgroundName} Color32 from ShowcasePalette.cs`); continue; }
      const ratio = contrast(foreground, bg);
      const line = `${foregroundName} on ${backgroundName}: ${ratio.toFixed(2)}:1 (WCAG AA normal text 4.5:1)`;
      if (ratio < 4.5) failures.push(`contrast below AA: ${line}`);
      else pass.push(line);
    }
  }
  // Accent colors are reported for design review; semantic accents aren't all text.
  for (const name of ['Gold', 'GoldDim', 'Success', 'Warning']) {
    const color = readColor(name);
    if (color) {
      const ratio = contrast(color, background);
      const line = `${name} on Background: ${ratio.toFixed(2)}:1 (informational accent contrast)`;
      (ratio < 4.5 ? warnings : pass).push(line);
    }
  }
}

for (const line of pass) console.log(`PASS ${line}`);
for (const line of warnings) console.log(`INFO ${line}`);
for (const line of failures) console.error(`FAIL ${line}`);
console.log(`Presentation verification: ${failures.length} failure(s), ${warnings.length} informational warning(s).`);
process.exitCode = failures.length ? 1 : 0;
