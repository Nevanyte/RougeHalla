// Source hashing only. No source-world capture, compiler, runtime, credential or network access.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const base = 'e56b17692c12386aa138f9ae9a42f7fd0132c58d';
const client = '6d5d9340a6b9f425a17d7ea4488b49291fff3dc1';
const ui = '8b48053bd591c3d94c65f21b201bf519d359fc49';
const uiSource = '1bf48a8109249ec36497eab5b1ffc5548a384dd5';
const native = '7a13b88aaa104cf2fd18dc2de7eada6c02060485';
const repo = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const clientFiles = [
  'client-unity/UnityProject/Assets/Scripts/Net/MatchClient.Resume.cs',
  'client-unity/UnityProject/Assets/Scripts/Net/MatchClient.cs',
  'client-unity/UnityProject/Assets/Scripts/Net/MatchClient.Accounts.cs',
  'client-unity/UnityProject/Assets/Scripts/Net/MatchClient.Settlement.cs',
  'client-unity/UnityProject/Assets/Scripts/Net/MatchLaunchConfig.cs',
  'client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Resume.cs',
  'client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Accounts.cs',
  'client-unity/UnityProject/Assets/Scripts/Bootstrap.cs',
  'client-unity/UnityProject/Assets/Scripts/BakedContent.cs',
  'client-unity/UnityProject/Assets/Plugins/WebGL/RhSeatCheckpoint.jslib',
  'client-unity/UnityProject/Assets/Plugins/WebGL/RhWebSocket.jslib',
  'client-unity/RoguehallaNet/Net/OwnedSeatCheckpoint.cs',
  'client-unity/RoguehallaNet/Net/OwnedSeatCheckpointCodec.cs',
  'client-unity/RoguehallaNet/Net/WebGlSeatCheckpointStorage.cs',
  'client-unity/RoguehallaNet/Net/Session.cs',
  'client-unity/RoguehallaNet/Protocol/Messages.cs',
  'client-unity/RoguehallaNet/Protocol/Codec.cs',
];
const nativeFiles = [
  'crates/rh-protocol/src/lib.rs', 'crates/rh-protocol/src/map.rs',
  'crates/rh-server/src/main.rs', 'crates/rh-server/src/room.rs',
  'crates/rh-server/src/director.rs', 'crates/rh-server/src/control.rs',
  'crates/rh-server/src/api.rs', 'crates/rh-server/src/api/profile.rs',
  'crates/rh-server/src/persist.rs', 'crates/rh-server/tests/full_runtime_account_flow.rs',
  'crates/rh-sim/src/checkpoint.rs', 'crates/rh-sim/src/replay.rs',
  'crates/rh-sim/src/observe.rs', 'crates/rh-policy/src/lib.rs',
  'tools/staging-full-runtime/run-runtime.py', 'tools/staging-full-runtime/Caddyfile',
  'tools/staging-full-runtime/postgresql.conf',
];
const sha = value => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', ['-C', repo, ...args]);
const pins = {};
for (const [revision, paths] of [[client, clientFiles], [native, nativeFiles]]) {
  for (const path of paths) {
    const bytes = git('show', `${revision}:${path}`);
    pins[`${revision}:${path}`] = {sha256:sha(bytes), bytes:bytes.length};
  }
}
// The source-only UI revisions must refer to identical runtime resume/store code.
const sameUi = {};
for (const path of clientFiles.filter(p => /MatchClient.Resume|MatchHud.Resume|OwnedSeatCheckpoint|WebGlSeatCheckpoint/.test(p))) {
  const a = sha(git('show', `${uiSource}:${path}`));
  const b = sha(git('show', `${ui}:${path}`));
  const c = sha(git('show', `${client}:${path}`));
  if (a !== b || b !== c) throw new Error('reviewed UI source identity changed');
  sameUi[path] = a;
}
const output = process.argv[2];
if (!output) throw new Error('Usage: node pin-sources.mjs NEW-source-pins.json');
const record = {schema:'unity-browser-reload-readiness-source/1', state:'SOURCE_ONLY_NO_RUNTIME_EXECUTION',
  worktreeBase:base, clientReference:client, uiReference:ui, uiSourceReference:uiSource,
  nativeReference:native, expectedIdentity:{protocol:14, checkpoint:29, replay:23, observation:21,
    policy:15, content:'7c6a633f68c2cc72', tickHz:20, reconnectGraceMs:10000},
  pins, sameUi, command:['node', 'tools/unity-browser-reload-proof/pin-sources.mjs', output],
  pending:['native98/layout/build actual receipts', 'coherent Web and native artifacts',
    'Root-approved observer installation and real browser execution', 'durable PG/spool and real Result/receipt flow'],
  limits:'Git source blobs hashed only; no runtime secrets, browser storage, worlds, databases or network read'};
writeFileSync(output, JSON.stringify(record, null, 2) + '\n', {flag:'wx'});
process.stdout.write(JSON.stringify({result:'SOURCE_PINS_ONLY', count:Object.keys(pins).length,
  sameUi:Object.keys(sameUi).length, manifestSha256:sha(JSON.stringify(record, null, 2) + '\n')}) + '\n');
