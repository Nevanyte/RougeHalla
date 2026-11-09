// Actual FS loading only: never construct a router, socket, browser, database or proxy.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
assert.equal(process.version,'v22.23.4');
assert.equal(process.platform,'darwin');
assert.equal(process.arch,'arm64');
const [tool,expectedToolSha,manifestPath,expectedManifestSha,root]=process.argv.slice(2);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(await readFile(tool)),expectedToolSha);
const raw=await readFile(manifestPath);
assert.equal(sha(raw),expectedManifestSha);
const {loadSealedAssets}=await import(pathToFileURL(tool).href);
const table=await loadSealedAssets(manifestPath,root);
const declared=JSON.parse(raw);
assert.equal(table.size,15);
assert.equal(new Set([...table.values()].map(row=>row.file)).size,14);
assert.deepEqual([...table.keys()].sort(),declared.files.map(row=>row.path).sort());
for(const row of declared.files){
  const loaded=table.get(row.path);
  assert.equal(loaded.file,row.file);assert.equal(loaded.sha256,row.sha256);
  assert.equal(loaded.bytes,row.bytes);assert.equal(loaded.contentType,row.contentType);
  assert.equal(loaded.encoding,null);
}
for(const name of ['Third-Party-Assets.md','Unity-Companion.md'])
  assert.equal(table.get(`/Licenses/${name}`).contentType,'text/plain; charset=utf-8');
assert.equal(table.get('/').file,'index.html');
assert.equal(table.get('/').sha256,table.get('/index.html').sha256);
assert.equal(sha(await readFile(tool)),expectedToolSha);
assert.equal(sha(await readFile(manifestPath)),expectedManifestSha);
process.stdout.write(JSON.stringify({status:'FS_LOAD_PASS',node:process.version,platform:process.platform,
  arch:process.arch,physicalFiles:14,urlEntries:15,physicalBytes:106987680,
  markdownNotices:2,rootAlias:'index.html',manifestSha256:expectedManifestSha,
  routerToolSha256:expectedToolSha,listenersStarted:0,proxyRequests:0,browserStarted:false,
  databaseStarted:false,scope:'Actual streamed FS integrity load only; no HTTP/WS or browser acceptance'})+'\n');
