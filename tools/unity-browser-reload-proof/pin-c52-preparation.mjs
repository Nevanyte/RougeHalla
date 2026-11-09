// Read-only local preparation receipt. Never starts a service, browser or database.
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CLIENT_SOURCE, NATIVE_REFERENCE, BROWSER_ORIGIN} from './check.mjs';

const repo = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const taskRoot = '/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08';
const binary = `${taskRoot}/native-browser-c52-build/rh-server`;
const receiptPath = `${taskRoot}/native-browser-c52-build/receipt.json`;
const binarySha256 = '2533c89b6581610a33a79ff95492989711a33d52999efdd2fc045cb771a62a65';
const compositionSource = '5e19ef1b801ef363a83217ddecd768c5aba71cac';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', ['-C', repo, ...args]);
const paths = [
  'client-unity/UnityProject/Assets/Scripts/Net/MatchClient.Resume.cs',
  'client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Resume.cs',
  'client-unity/RoguehallaNet/Net/OwnedSeatCheckpoint.cs',
  'client-unity/RoguehallaNet/Net/OwnedSeatCheckpointCodec.cs',
  'client-unity/RoguehallaNet/Net/WebGlSeatCheckpointStorage.cs',
];
const nativePaths = [
  'crates/rh-protocol/src/lib.rs', 'crates/rh-protocol/src/map.rs',
  'crates/rh-server/src/main.rs', 'crates/rh-server/src/runtime.rs',
  'crates/rh-server/src/room.rs', 'crates/rh-server/src/director.rs',
  'crates/rh-server/src/api.rs', 'crates/rh-server/src/api/profile.rs',
  'crates/rh-server/src/persist.rs', 'maps/first-playable.json',
];
const assert = (condition, label) => { if (!condition) throw new Error(label); };
const output = process.argv[2];
assert(output, 'Use: node pin-c52-preparation.mjs NEW-output.json');
const sourceTrees = {};
for (const path of ['client-unity', 'protocol']) {
  const client = git('rev-parse', `${CLIENT_SOURCE}:${path}`).toString().trim();
  const composed = git('rev-parse', `${compositionSource}:${path}`).toString().trim();
  assert(client === composed, 'Client/protocol tree equality failed');
  sourceTrees[path] = {clientTree:client, composedTree:composed, equal:true};
}
const sharedUi = {};
for (const path of paths) {
  const client = git('show', `${CLIENT_SOURCE}:${path}`);
  const native = git('show', `${NATIVE_REFERENCE}:${path}`);
  assert(client.equals(native), 'Shared UI/store source equality failed');
  sharedUi[path] = {bytes:client.length, sha256:sha(client), equal:true};
}
const nativePins = {};
for (const path of nativePaths) {
  const bytes = git('show', `${NATIVE_REFERENCE}:${path}`);
  nativePins[path] = {bytes:bytes.length, sha256:sha(bytes)};
}
const rawReceipt = readFileSync(receiptPath), receipt = JSON.parse(rawReceipt);
const binaryBytes = readFileSync(binary);
assert(receipt.sourceCommit === NATIVE_REFERENCE, 'Native receipt source mismatch');
assert(receipt.exitCode === 0 && receipt.serverStarted === false && receipt.postgresStarted === false,
  'Native receipt does not describe the supplied unstarted artifact');
assert(receipt.argv.join(' ') === 'cargo build -p rh-server --features postgres --locked --offline',
  'Native receipt build profile mismatch');
assert(sha(binaryBytes) === binarySha256 && binaryBytes.length === 42479296,
  'Native artifact bytes mismatch');
const ports = {};
for (const port of [65439, 7777, 7779, 8888]) {
  const snapshot = spawnSync('/usr/sbin/lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
  assert([0, 1].includes(snapshot.status) && snapshot.stderr.length === 0,
    'Listener inventory failed; no availability inference');
  ports[port] = {listenerPresent:snapshot.stdout.length > 0, exitCode:snapshot.status};
}
const pgVersion = execFileSync('/opt/homebrew/opt/postgresql@16/bin/postgres', ['--version']).toString().trim();
const stateRoot = `${taskRoot}/browser-c52-actual`;
const record = {
  format:'rh-c52-browser-preparation-precheck/2', recordedUtc:new Date().toISOString(),
  classification:'READ_ONLY_PREPARATION_NOT_RUNTIME_ACCEPTANCE',
  nativeSource:NATIVE_REFERENCE, clientSource:CLIENT_SOURCE, compositionSource, browserOrigin:BROWSER_ORIGIN,
  sourceTrees, sharedUi, nativePins,
  nativeArtifact:{path:binary, bytes:statSync(binary).size, sha256:binarySha256,
    buildReceiptSha256:sha(rawReceipt), profile:receipt.buildProfile,
    serverStartedByThisCheck:false, postgresStartedByThisCheck:false},
  versions:{node:process.version, platform:process.platform, arch:process.arch, postgres:pgVersion},
  portSnapshot:{ports, reservation:false, recheckBeforeReleasedStartup:true},
  privateState:{path:stateRoot, exists:existsSync(stateRoot), createdByThisCheck:false},
  webArtifact:{path:`${taskRoot}/unity-resume98-isolated/web-build-57e166-2026-11-09/Web`,
    status:'PENDING_IMMUTABLE_ART_RECEIPT', resourcesReadOrHashed:false},
  pending:['Root review and explicit runtime release', 'sealed Web source/resource receipt',
    'router source and manifest review', 'fresh durable PostgreSQL and Source spool',
    'actual ordinary UI browser campaign and separate genuine Source settlement'],
};
writeFileSync(output, JSON.stringify(record, null, 2) + '\n', {flag:'wx'});
process.stdout.write(JSON.stringify({status:'PREPARATION_ONLY', outputSha256:sha(readFileSync(output)),
  equalTrees:2, equalSharedUi:paths.length, nativePins:nativePaths.length,
  binarySha256, portsIdleAtSnapshot:Object.values(ports).every(x => !x.listenerPresent),
  freshStateRootAbsent:!record.privateState.exists, web:'PENDING'}) + '\n');
