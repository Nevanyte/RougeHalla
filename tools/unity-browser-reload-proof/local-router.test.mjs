// Synthetic offline controls only. No listener, socket, network, artifact tree, or Unity build.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {classifyRoute, validateAssetManifest, ROUTER_MANIFEST_SCHEMA, acceptsLocalHost,
  forwardedHeaders, isWebSocketRoute} from './local-router.mjs';

test('Fixed source and training routes preserve query and never cross upstreams',()=>{
  for(const suffix of ['/ws','/info','/ping','/healthz']){
    const route=classifyRoute('GET',`/training${suffix}?probe=1`);
    assert.deepEqual(route,{kind:'proxy',upstream:7779,path:`${suffix}?probe=1`});
  }
  assert.deepEqual(classifyRoute('GET','/training/ws?mode=resume'),{kind:'proxy',upstream:7779,path:'/ws?mode=resume'});
  for(const path of ['/ws','/info','/ping','/healthz','/readyz','/api','/api/state','/api/state?x=1'])
    assert.deepEqual(classifyRoute('GET',path).upstream,7777);
  assert.equal(isWebSocketRoute(classifyRoute('GET','/ws?join=1')),true);
  assert.equal(isWebSocketRoute(classifyRoute('GET','/training/ws?join=1')),true);
  assert.equal(isWebSocketRoute(classifyRoute('GET','/info')),false);
  assert.equal(isWebSocketRoute(classifyRoute('GET','/api/state')),false);
});

test('Only the fixed local Host is admitted and forwarded peer replaces incoming XFF',()=>{
  assert.equal(acceptsLocalHost('localhost:8888'),true);
  for(const host of ['127.0.0.1:8888','[::1]:8888','localhost:8889',undefined]) assert.equal(acceptsLocalHost(host),false);
  const headers=forwardedHeaders({host:'localhost:8888','x-forwarded-for':'spoofed','x-original':'opaque',origin:'http://localhost:8888'},7779,'::1');
  assert.equal(headers.host,'127.0.0.1:7779');assert.equal(headers['x-forwarded-for'],'::1');
  assert.equal(headers['x-original'],'opaque');assert.equal(headers.origin,'http://localhost:8888');
  const noPeer=forwardedHeaders({'x-forwarded-for':'spoofed'},7777,null);
  assert.equal(Object.hasOwn(noPeer,'x-forwarded-for'),false);
});

test('Control and unsupported training paths are rejected, not sent to a fallback upstream',()=>{
  for(const path of ['/control','/control/run','/controlplane','/probe','/probe/x','/probeX','/training/api','/training/api/x',
    '/training/readyz','/training/control','/training/control/x','/training/probe','/training/other'])
    assert.equal(classifyRoute('GET',path).kind,'reject',path);
  assert.equal(classifyRoute('POST','/Build/game.data').status,405);
});

test('Static fallback is only an exact canonical path for GET or HEAD',()=>{
  assert.deepEqual(classifyRoute('GET','/'),{kind:'static',path:'/'});
  assert.deepEqual(classifyRoute('GET','/Build/game.wasm'),{kind:'static',path:'/Build/game.wasm'});
  for(const path of ['//localhost/ws','/Build/../secret','/Build/%2e%2e/secret','/Build/game.wasm?x=1#z',
    '/Build\\secret','/Build/%2fsecret'])
    assert.equal(classifyRoute('GET',path).kind,'reject',path);
});

test('Manifest validation copies and pins only declared asset bytes and compressed MIME',async()=>{
  const data=Uint8Array.from([1,2,3,4]),hash=createHash('sha256').update(data).digest('hex');
  const manifest={schema:ROUTER_MANIFEST_SCHEMA,files:[
    {path:'/Build/game.wasm.br',file:'Build/game.wasm.br',sha256:hash,bytes:4,contentType:'application/wasm',encoding:'br'},
    {path:'/',file:'index.html',sha256:hash,bytes:4,contentType:'text/html; charset=utf-8'},
  ]};
  const table=await validateAssetManifest(manifest,async file=>{assert(['Build/game.wasm.br','index.html'].includes(file));return data;});
  data[0]=99;
  assert.deepEqual([...table.get('/Build/game.wasm.br').bytes],[1,2,3,4]);
  assert.equal(table.get('/Build/game.wasm.br').encoding,'br');
  assert.equal(table.get('/Build/game.wasm.br').contentType,'application/wasm');
  assert.equal(table.get('/').contentType,'text/html; charset=utf-8');
});

test('Manifest rejects traversal, undeclared MIME, bad hashes, duplicates, and asset size mismatches',async()=>{
  const bytes=Uint8Array.from([7]),hash=createHash('sha256').update(bytes).digest('hex');
  const row={path:'/Build/game.js',file:'Build/game.js',sha256:hash,bytes:1,contentType:'application/javascript; charset=utf-8'};
  const load=async()=>bytes;
  for(const mutate of [
    m=>m.files[0].file='../secret',
    m=>m.files[0].path='/Build/../game.js',
    m=>m.files[0].path='/Build/game.js?x=1',
    m=>m.files[0].contentType='text/html',
    m=>m.files[0].sha256='0'.repeat(64),
    m=>m.files.push({...row}),
    m=>m.files[0].bytes=2,
    m=>m.extra=true,
  ]){
    const manifest={schema:ROUTER_MANIFEST_SCHEMA,files:[{...row}]};mutate(manifest);
    await assert.rejects(validateAssetManifest(manifest,load));
  }
});
