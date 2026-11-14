// SYNTHETIC OFFLINE TESTS ONLY. No real socket, browser, Unity, World, storage or account is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parseClientHello, parseServerWelcome, parseWireMetadata} from './wire-metadata.js';
import {proposeWireTap} from './wire-tap-proposal.js';
import {makePreloadProposal} from './make-preload-proposal.mjs';
import {template, evaluate, CONTENT, NATIVE_REFERENCE, BROWSER_ORIGIN} from './check.mjs';

const match = '00112233445566778899aabbccddeeff';
// Only public/control bytes exist in this reader. A payload read throws BEFORE any value exists.
function guarded(length, fields, forbidden) {
  let at = 0, denied = 0;
  const reads = [];
  const need = n => { assert(n >= 0 && n <= length - at); const p = at; at += n; return p; };
  const read = n => {
    const p = need(n);
    if (forbidden.some(([a, b]) => p < b && p + n > a)) { denied++; throw new Error('forbidden read'); }
    reads.push([p, n]); assert(fields.has(p), 'synthetic control field exists'); return fields.get(p);
  };
  return {get length(){return length;},get offset(){return at;},get remaining(){return length-at;},
    u8:()=>read(1),u16:()=>read(2),u32:()=>read(4),u64:()=>read(8),
    publicHex:n=>{assert.equal(n,16);return read(n);},skip:n=>{need(n);},end:()=>assert.equal(at,length),
    reads,get denied(){return denied;}};
}
function helloReader(resume = true, length = resume ? 46 : 30, protocol = 18) {
  return guarded(length, new Map([[0,1],[1,protocol],[11,3],[15,5],[21,4],[27,1],[29,resume?1:0]]),
    [[3,11],[12,15],[16,21],[23,27],[28,29],[30,46]]);
}
// Protocol 16 Welcome: 60-byte header (encode.rs WELCOME_HEADER_LEN), archetype table 60..78 (count u8 + row0 6 bytes
// [id,keylen=1,key,hull=0,r,chest] + row1 11 bytes [id,keylen=1,key,hull=1,fx,fy,bx,by,ox,oy,chest]), vision 78..113
// (34 bytes + coliseum flag 0 at 112; vision.rs VISION_BLOCK_LEN = 35), weapon table 113..148 (count 1 + one 34-byte
// row; weapon.rs WEAPON_ROW_LEN), an empty HUD content block 148..150 (scaling count 0, term count 0; hud_content.rs),
// then the old map block shifted by 90: width/height 150/152, collision hash 154..158, runs 158, pair 162..165, extension
// length 165, version 169, flags 170, semantic hash 171..175, mode 175, context 176..180.
const WELCOME_LEN = 180;
function welcomeReader(length = WELCOME_LEN, protocol = 18) {
  return guarded(length,new Map([[0,0x81],[1,protocol],[3,BigInt('0x'+CONTENT)],[11,match],[27,7],
    [60,2],[62,1],[64,0],[68,1],[70,1],[112,0],[113,1],[148,0],[149,0],
    [150,2],[152,2],[158,1],[165,11],[169,2],[170,0],[175,0]]),
    [[31,60],[61,62],[63,64],[65,68],[69,70],[71,78],[78,112],[114,148],[154,158],[162,165],[171,175],[176,180]]);
}
function syntheticHello() {
  // Private ranges remain zero-filled, have no real capability/credential, and are never inspected.
  const bytes = new Uint8Array(46), view = new DataView(bytes.buffer);
  bytes[0]=1;view.setUint16(1,18,true);bytes[11]=3;bytes[15]=5;
  view.setUint16(21,4,true);bytes[27]=1;bytes[29]=1;return bytes;
}
function syntheticWelcome() {
  const bytes=new Uint8Array(WELCOME_LEN),view=new DataView(bytes.buffer);
  bytes[0]=0x81;view.setUint16(1,18,true);view.setBigUint64(3,BigInt('0x'+CONTENT),true);
  for(let i=0;i<16;i++)bytes[11+i]=parseInt(match.slice(i*2,i*2+2),16);
  view.setUint32(27,7,true);bytes[60]=2;bytes[62]=1;bytes[64]=0;bytes[68]=1;bytes[70]=1;bytes[113]=1;
  // bytes[148] and bytes[149] stay 0: the empty HUD content block.
  view.setUint16(150,2,true);view.setUint16(152,2,true);
  view.setUint32(158,1,true);view.setUint32(165,11,true);bytes[169]=2;
  return bytes; // RLE payload intentionally unvalidated: a prefix is not an accepted map.
}

test('Hello skips every private/string/content byte and reports presence only',()=>{
  for(const present of [false,true]){
    const r=helloReader(present),got=parseClientHello(r);
    assert.equal(got.status,'metadata');assert.equal(got.resumePresent,present);assert.equal(got.wholeFrameValidated,false);
    assert.equal(r.denied,0);assert.deepEqual(r.reads,[[0,1],[1,2],[11,1],[15,1],[21,2],[27,1],[29,1]]);
    assert(!('contentHash' in got));
  }
});
test('Welcome reads exact public identity/structural headers and skips session plus map payload',()=>{
  const r=welcomeReader(),got=parseServerWelcome(r);
  assert.equal(got.status,'public-prefix');assert.equal(got.matchId,match);assert.equal(got.playerId,7);
  assert.equal(got.contentHash,CONTENT);assert.equal(got.mapPayloadValidated,false);assert.equal(got.wholeFrameValidated,false);
  assert.equal(r.denied,0);assert.equal(r.offset,WELCOME_LEN);
  assert.deepEqual(r.reads,[[0,1],[1,2],[3,8],[11,16],[27,4],[60,1],[62,1],[64,1],[68,1],[70,1],[112,1],[113,1],[148,1],[149,1],[150,2],[152,2],[158,4],[165,4],[169,1],[170,1],[175,1]]);
});
test('All structural prefixes refuse; unknown versions do not inspect later fields',()=>{
  for(let n=0;n<46;n++)assert.equal(parseClientHello(helloReader(true,n)).status,'unavailable');
  for(let n=0;n<WELCOME_LEN;n++)assert.equal(parseServerWelcome(welcomeReader(n)).status,'unavailable');
  for(const [r,parse] of [[helloReader(true,46,15),parseClientHello],[welcomeReader(WELCOME_LEN,15),parseServerWelcome]]){
    assert.equal(parse(r).status,'unavailable');assert.deepEqual(r.reads,[[0,1],[1,2]]);
  }
  assert.equal(parseClientHello(helloReader(true,47)).status,'unavailable');
  assert.equal(parseServerWelcome(welcomeReader(WELCOME_LEN+1)).status,'unavailable');
  assert.equal(parseClientHello(helloReader(true,1025)).status,'unavailable');
  assert.equal(parseServerWelcome(welcomeReader(262145)).status,'unavailable');
});
test('Original-buffer adapter parser neither converts text/Blob nor confuses ignored tags',()=>{
  assert.equal(parseWireMetadata('client',syntheticHello()).resumePresent,true);
  assert.equal(parseWireMetadata('server',syntheticWelcome()).matchId,match);
  assert.equal(parseWireMetadata('client',new Uint8Array([2])).status,'ignored');
  assert.equal(parseWireMetadata('server',new Uint8Array([0x83])).status,'ignored');
  assert.equal(parseWireMetadata('server',new Uint8Array([0xff])).status,'unavailable');
  assert.equal(parseWireMetadata('client','not a binary frame').status,'unavailable');
  assert.equal(parseWireMetadata('server',{arrayBuffer(){throw new Error('must never convert');}}).status,'unavailable');
});

class FakeSocket {
  static OPEN=1;static created=0;
  constructor(...args){FakeSocket.created++;this.args=args;this.listeners=new Map();this.sent=[];}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
  removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
  send(...args){this.sent.push({receiver:this,args});if(this.error)throw this.error;return this.result;}
  emit(name,event){for(const fn of this.listeners.get(name)??[])fn(event);}
}
const now=()=>({wallTimeMs:1100,timeOriginMs:1000,performanceNowMs:100});
test('Inert proposal forwards genuine constructor/send args and original received buffer exactly once',()=>{
  const globalBefore=globalThis.WebSocket,count=FakeSocket.created;
  const tap=proposeWireTap(FakeSocket,'synthetic-document',now);
  assert.equal(FakeSocket.created,count);assert.equal(globalThis.WebSocket,globalBefore);
  const opaqueUrl={toString(){throw new Error('observer may not inspect URL');}};
  const ws=new tap.ProposedConstructor(opaqueUrl,['opaque-protocol']);
  assert.equal(ws.args[0],opaqueUrl);assert(ws instanceof FakeSocket);assert.equal(tap.ProposedConstructor.OPEN,1);
  const outgoing=syntheticHello(),incoming=syntheticWelcome();ws.result=Symbol('native result');
  assert.equal(ws.send(outgoing),ws.result);assert.equal(ws.sent.length,1);assert.equal(ws.sent[0].args[0],outgoing);
  let gameBuffer;ws.addEventListener('message',e=>{gameBuffer=e.data;});ws.emit('message',{data:incoming});
  assert.equal(gameBuffer,incoming);
  const rows=tap.export().records;
  assert.deepEqual(rows.map(x=>x.event),['game-socket-created','hello-send-returned','welcome-public-prefix']);
  assert.equal(rows[2].matchId,match);assert.equal(rows[2].wholeFrameValidated,false);
  assert(!JSON.stringify(rows).includes('opaque-protocol'));
  tap.stop();assert.equal(ws.send,FakeSocket.prototype.send);
  assert.equal(globalThis.WebSocket,globalBefore);
});
test('Native throws remain native; diagnostic failure and stop never send/close or change game buffers',()=>{
  const tap=proposeWireTap(FakeSocket,'synthetic-document',()=>{throw new Error('diagnostic clock');});
  const ws=new tap.ProposedConstructor('opaque');const error=new Error('native sentinel');ws.error=error;
  assert.throws(()=>ws.send(syntheticHello()),e=>e===error);assert.equal(ws.sent.length,1);
  ws.error=null;ws.send(syntheticHello());assert.equal(ws.sent.length,2);assert.equal(tap.export().overflow,true);
  tap.stop();const later=new tap.ProposedConstructor('opaque');assert.equal(later.send,FakeSocket.prototype.send);
});
test('Unknown wire shapes disable only metadata and cannot replace native delivery',()=>{
  const tap=proposeWireTap(FakeSocket,'synthetic-document',now),ws=new tap.ProposedConstructor('opaque');
  const original=new Uint8Array([255]);ws.send(original);assert.equal(ws.sent[0].args[0],original);
  ws.send(syntheticHello());assert.equal(ws.sent.length,2);
  assert.deepEqual(tap.export().records.map(x=>x.event),['game-socket-created','metadata-unavailable']);tap.stop();
});

function browserMock(id='synthetic-doc-1',origin=1000){
  const handlers=new Map(),context={console,JSON,Math,Object,Array,Set,Date:{now:()=>origin+100},
    crypto:{randomUUID:()=>id},performance:{timeOrigin:origin,now:()=>100,getEntriesByType:()=>[{type:'reload',get name(){throw new Error('no URL read');}}]},
    location:{origin:BROWSER_ORIGIN},navigator:{onLine:true,userAgent:'synthetic-offline'},
    innerWidth:1280,innerHeight:720,devicePixelRatio:1};
  const events={addEventListener(k,f){if(!handlers.has(k))handlers.set(k,new Set());handlers.get(k).add(f);},removeEventListener(k,f){handlers.get(k)?.delete(f);}};
  context.window=context;context.top=context;Object.assign(context,events);context.document={...events,visibilityState:'visible'};
  for(const k of ['localStorage','sessionStorage'])Object.defineProperty(context,k,{get(){throw new Error('storage must not be read');}});
  Object.defineProperty(context.document,'cookie',{get(){throw new Error('cookie must not be read');}});
  return {context:vm.createContext(context),handlers};
}
test('Document observer is idempotent, ignores text keys, and touches no storage/URL values',()=>{
  const source=readFileSync(new URL('observer.js',import.meta.url),'utf8'),m=browserMock();
  vm.runInContext(source,m.context);const api=m.context.__unityReloadReadinessObserver,first=api.export();
  vm.runInContext(source,m.context);assert.equal(m.context.__unityReloadReadinessObserver,api);
  for(const handler of m.handlers.get('keydown'))handler({code:'KeyA',isTrusted:true});
  assert.equal(api.export().events.length,first.events.length);assert.equal(first.page.navigationType,'reload');
  const other=browserMock('synthetic-doc-2',2000);vm.runInContext(source,other.context);
  assert.notEqual(other.context.__unityReloadReadinessObserver.export().documentId,first.documentId);
  assert.notEqual(other.context.__unityReloadReadinessObserver.export().page.timeOriginMs,first.page.timeOriginMs);api.stop();
});
test('Generated preload proposal is classic-script syntax only; it is NOT installed by this test',()=>{
  const before=globalThis.WebSocket;new vm.Script(makePreloadProposal());assert.equal(globalThis.WebSocket,before);
});
test('Proposal installation is idempotent and reversible in a synthetic VM, with zero socket construction',()=>{
  const before=globalThis.WebSocket,m=browserMock();m.context.WebSocket=FakeSocket;
  const count=FakeSocket.created,source=makePreloadProposal();vm.runInContext(source,m.context);
  const proposed=m.context.WebSocket,evidence=m.context.__unityReloadWireEvidence;
  vm.runInContext(source,m.context);assert.equal(m.context.WebSocket,proposed);
  assert.equal(m.context.__unityReloadWireEvidence,evidence);assert.equal(FakeSocket.created,count);
  evidence.stopAndRestore();assert.equal(m.context.WebSocket,FakeSocket);assert.equal(globalThis.WebSocket,before);
});

const hash='a'.repeat(64);
function safeDoc(id,timeOrigin,execution,resume){
  const clocks=t=>({wallTimeMs:timeOrigin+t,timeOriginMs:timeOrigin,performanceNowMs:t});
  const row=(event,t,extra={})=>({schema:'unity-browser-reload-wire/1',documentId:id,connection:1,event,...clocks(t),...extra});
  return {browserContextWitness:'synthetic-context',tabWitness:'synthetic-tab',executionContextWitness:execution,
    observer:{schema:'unity-browser-reload-observer/1',documentId:id,page:{...clocks(10),origin:BROWSER_ORIGIN,
      userAgent:'synthetic-offline',viewport:{width:1280,height:720,devicePixelRatio:1},topLevel:true,navigationType:'reload'},
      capturedAt:clocks(1000),events:[{kind:'pointerup',trusted:true,...clocks(200)}],overflow:false,stopped:false},
    wire:{schema:'unity-browser-reload-wire/1',documentId:id,records:[row('game-socket-created',201),
      row('hello-send-returned',205,{protocol:18,resumePresent:resume,wholeFrameValidated:false}),
      row('welcome-public-prefix',300,{protocol:18,contentHash:CONTENT,matchId:match,playerId:7,wholeFrameValidated:false})],overflow:false}};
}
function syntheticCase(){
  const before=safeDoc('synthetic-before',1000000,'exec-1',false),after=safeDoc('synthetic-after',1002000,'exec-2',true);
  const s=(kind,doc,t)=>({kind,documentId:doc.observer.documentId,wallTimeMs:doc.observer.page.timeOriginMs+t,screenshotSha256:hash,trustedEventIndex:0});
  return {id:'arena-reload',documents:[before,after],steps:[s('mode-verified',before,400),s('reload-request',before,1000),
    s('load-current-owner',after,100),s('resume-arena',after,200),s('mode-verified',after,400),s('rendered-gameplay',after,500)],serverGrace:null};
}
function bundle(){const b=template();b.classification='synthetic-selftest';b.cases=[syntheticCase()];return b;}
test('Readiness template and synthetic consistency never grant browser acceptance',()=>{
  assert.equal(evaluate(template()).status,'OPEN');const r=evaluate(bundle());assert.equal(r.status,'OPEN');
  assert.equal(r.cases[0].status,'CONSISTENT_FOR_REVIEW');assert.equal(r.browserAcceptance,'NOT_GRANTED_BY_COLLECTOR');
});
test('Checker requires the exact reviewed native source',()=>{
  const b=bundle();b.nativeSource='7a13b88aaa104cf2fd18dc2de7eada6c02060485';const r=evaluate(b);
  assert.equal(r.status,'FAIL');
  assert(r.failures.includes('native source differs from the reviewed reference'));
  assert.equal(b.nativeSource !== NATIVE_REFERENCE, true);
  assert.equal(r.browserAcceptance,'NOT_GRANTED_BY_COLLECTOR');
});
test('Checker rejects the superseded 6d client reference',()=>{
  const b=bundle();b.clientSource='6d5d9340a6b9f425a17d7ea4488b49291fff3dc1';const r=evaluate(b);
  assert.equal(r.status,'FAIL');
  assert(r.failures.includes('client source differs from the reviewed composition'));
  assert.equal(r.browserAcceptance,'NOT_GRANTED_BY_COLLECTOR');
});
test('Case documents must use the exact reviewed local Unity origin',()=>{
  const b=bundle();b.cases[0].documents[1].observer.page.origin='http://127.0.0.1:8888';
  const r=evaluate(b);
  assert.equal(r.status,'FAIL');
  assert(r.cases[0].failures.includes('browser origin differs from the expected local Unity origin'));
  assert.notEqual(BROWSER_ORIGIN,'http://127.0.0.1:8888');
});
test('Checker rejects same-document, replacement tab, changed identity, fresh fallback and late reload',()=>{
  const edits=[b=>b.cases[0].documents[1].executionContextWitness='exec-1',
    b=>b.cases[0].documents[1].tabWitness='different-tab',
    b=>b.cases[0].documents[1].wire.records[2].playerId=8,
    b=>b.cases[0].documents[1].wire.records[1].resumePresent=false,
    b=>b.cases[0].steps[1].wallTimeMs-=10000];
  for(const edit of edits){const b=bundle();edit(b);assert.equal(evaluate(b).status,'FAIL');}
});
test('Unknown credential/raw payload fields are refused without echoing rejected values',()=>{
  for(const value of ['profileToken','sessionStorage','wireBase64','rawFrame']){
    const b=bundle();b.cases[0][value]='synthetic-sensitive-sentinel';const r=evaluate(b);
    assert.equal(r.status,'REFUSED');assert(!JSON.stringify(r).includes('synthetic-sensitive-sentinel'));
  }
});
test('Automatic connection or Hello shortly before the real trusted Resume click is refused',()=>{
  const b=bundle(),after=b.cases[0].documents[1];
  for(const row of after.wire.records.slice(0,2)) {row.performanceNowMs=150;row.wallTimeMs=row.timeOriginMs+150;}
  assert.equal(evaluate(b).status,'FAIL');
});
test('A resumed mode label before Welcome cannot be reused as accepted gameplay evidence',()=>{
  const b=bundle(),c=b.cases[0],after=c.documents[1];
  c.steps.find(s=>s.kind==='mode-verified'&&s.documentId===after.observer.documentId).wallTimeMs=1002250;
  assert.equal(evaluate(b).status,'FAIL');
});

test('Real protocol 18 golden Hello and Welcome frames parse with the same metadata parsers',()=>{
  const vectors=JSON.parse(readFileSync(new URL('../../protocol/fixtures/v18.json',import.meta.url),'utf8'));
  const bytes=hex=>Uint8Array.from(hex.match(/../g),b=>Number.parseInt(b,16));
  const server=vectors.server.filter(v=>v.name==='welcome'||v.name.startsWith('welcome_ground_'));
  assert(server.length>=6);
  for(const v of server)assert.equal(parseWireMetadata('server',bytes(v.hex)).status,'public-prefix',v.name);
  for(const [name,present] of [['hello',false],['hello_resume',true],['hello_ticket_max',true]]){
    const got=parseWireMetadata('client',bytes(vectors.client.find(v=>v.name===name).hex));
    assert.equal(got.status,'metadata',name);assert.equal(got.resumePresent,present,name);
  }
});
