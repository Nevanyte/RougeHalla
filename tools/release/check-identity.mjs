#!/usr/bin/env node
// Same-tree release check: the Unity client must have been built against the exact server it ships with.
//
//   node tools/release/check-identity.mjs --info <info.json | http://host:port/info> [--unity client-unity/UnityProject]
//                                         [--web client-unity/UnityProject/Build/Web]
//
// --info   the server's /info JSON (a saved file, or a URL of a running server of the SAME binary). Needs `protocol`
//          and `contentHash` (16 hex digits; `content_hash` is accepted too).
// --unity  Unity project root (default client-unity/UnityProject). Checks:
//            Assets/Scripts/BakedContent.cs  Hash            == server contentHash
//            RoguehallaNet/Protocol/Codec.cs and Assets/RoguehallaNet/Protocol/Codec.cs ProtocolVersion == server protocol
// --web    optional built Web output: it must exist, contain a *.wasm and a *.loader.js/index.html, and be NOT OLDER than
//          BakedContent.cs (a build older than the bake was compiled against a stale hash).
// Exit 0 only when every check passes; any mismatch prints "IDENTITY CHECK FAILED" and exits 1.
import {readFileSync, existsSync, statSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function parseInfo(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error(`/info is not valid JSON: ${e.message}`); }
  const raw = j.contentHash ?? j.content_hash;
  if (!Number.isInteger(j.protocol) || j.protocol <= 0) throw new Error('/info.protocol must be a positive integer');
  if (typeof raw !== 'string' || !/^[0-9a-f]{16}$/i.test(raw)) throw new Error('/info.contentHash must be 16 hex digits');
  return {protocol: j.protocol, content: raw.toLowerCase()};
}

export function bakedHash(source) {
  const m = /public\s+const\s+ulong\s+Hash\s*=\s*0x([0-9a-fA-F]+)UL\s*;/.exec(source);
  if (!m) throw new Error('BakedContent.cs has no `public const ulong Hash = 0x...UL;`');
  return m[1].toLowerCase().padStart(16, '0');
}

export function codecProtocol(source) {
  const m = /public\s+const\s+ushort\s+ProtocolVersion\s*=\s*(\d+)\s*;/.exec(source);
  if (!m) throw new Error('Codec.cs has no `public const ushort ProtocolVersion = N;`');
  return Number(m[1]);
}

// Returns a list of problems (empty = pass). `fs` is injectable for tests.
export function check({info, unity, web}) {
  const bad = [];
  const baked = path.join(unity, 'Assets/Scripts/BakedContent.cs');
  let bakedMtime = 0;
  if (!existsSync(baked)) bad.push(`missing ${baked}`);
  else {
    bakedMtime = statSync(baked).mtimeMs;
    try {
      const h = bakedHash(readFileSync(baked, 'utf8'));
      if (h === '0000000000000000') bad.push('BakedContent.cs hash is zero (never baked)');
      else if (h !== info.content) bad.push(`client baked content hash ${h} != server contentHash ${info.content}`);
    } catch (e) { bad.push(e.message); }
  }
  const codecs = [path.join(unity, '../RoguehallaNet/Protocol/Codec.cs'), path.join(unity, 'Assets/RoguehallaNet/Protocol/Codec.cs')];
  for (const c of codecs) {
    if (!existsSync(c)) { bad.push(`missing ${c}`); continue; }
    try {
      const p = codecProtocol(readFileSync(c, 'utf8'));
      if (p !== info.protocol) bad.push(`${path.relative(repoRoot, c)}: client protocol ${p} != server protocol ${info.protocol}`);
    } catch (e) { bad.push(`${c}: ${e.message}`); }
  }
  if (web) {
    if (!existsSync(web) || !statSync(web).isDirectory()) bad.push(`Web build output ${web} does not exist`);
    else {
      const files = [];
      const walk = (d) => { for (const e of readdirSync(d, {withFileTypes: true})) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } };
      walk(web);
      const wasm = files.filter((f) => /\.wasm(\.(gz|br))?$/.test(f));
      if (!wasm.length) bad.push(`no .wasm in ${web}: not a Unity Web build`);
      if (!files.some((f) => path.basename(f) === 'index.html')) bad.push(`no index.html in ${web}`);
      for (const f of wasm) if (bakedMtime && statSync(f).mtimeMs < bakedMtime) bad.push(`${path.relative(repoRoot, f)} is older than BakedContent.cs: rebuild the Web player after baking`);
    }
  }
  return bad;
}

async function loadInfo(src) {
  if (/^https?:\/\//.test(src)) {
    const r = await fetch(src, {signal: AbortSignal.timeout(10000)});
    if (!r.ok) throw new Error(`GET ${src} -> ${r.status}`);
    return parseInfo(await r.text());
  }
  return parseInfo(readFileSync(src, 'utf8'));
}

async function main(argv) {
  const a = {unity: path.join(repoRoot, 'client-unity/UnityProject')};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--info') a.info = argv[++i];
    else if (argv[i] === '--unity') a.unity = path.resolve(argv[++i]);
    else if (argv[i] === '--web') a.web = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!a.info) throw new Error('usage: check-identity.mjs --info <info.json|URL> [--unity DIR] [--web DIR]');
  const info = await loadInfo(a.info);
  const bad = check({info, unity: a.unity, web: a.web});
  if (bad.length) {
    console.error(`IDENTITY CHECK FAILED (server protocol ${info.protocol}, contentHash ${info.content}):`);
    for (const b of bad) console.error(`  - ${b}`);
    process.exit(1);
  }
  console.log(`identity ok: protocol ${info.protocol}, contentHash ${info.content} (client bake${a.web ? ' and Web build' : ''} match the server)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(`IDENTITY CHECK FAILED: ${e.message}`); process.exit(1); });
}
