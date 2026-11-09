// Uses the unchanged actual browser v14 decoder. No browser, World or source recapture.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createSceneCodec} from './scene-candidate.mjs';
const root=new URL('../../',import.meta.url), html=readFileSync(new URL('crates/rh-server/web/probe.html',root),'utf8');
const a=html.search(/\/\/ ---- protocol v\d+/), b=html.indexOf('// ---- probe state');
assert(a>=0&&b>a);const {decode}=new Function(`"use strict";${html.slice(a,b)};return {decode};`)();
const {prepare,Receiver}=createSceneCodec(decode,14), f=JSON.parse(readFileSync(new URL('protocol/fixtures/scene-candidate/full14.json',root),'utf8'));
const bytes=h=>Uint8Array.from(Buffer.from(h,'hex')),hex=b=>Buffer.from(b).toString('hex');
const meta=c=>({...c.meta,epoch:BigInt(c.meta.epoch),scene:BigInt(c.meta.scene),cueFrom:BigInt(c.meta.cueFrom),cueThrough:BigInt(c.meta.cueThrough)});
const frames=c=>c.inner14Hex.map(bytes);let checks=0,prefixes=0;
function prime(p){const r=new Receiver(p.metadata.epoch,f.limits);for(let i=0;i<p.recordCount;i++)r.push(p.record(i));return r;}
for(const c of f.cases){
 const m=meta(c),p=prepare(m,frames(c),f.limits);assert.equal(p.recordCount,c.recordsHex.length);assert.equal(p.framedBytes,c.framedBytes);assert.equal(hex(p.bodyCopy()),c.bodyHex);const r=new Receiver(m.epoch,f.limits);
 for(let i=0;i<p.recordCount;i++){const part=p.record(i);assert.equal(hex(part),c.recordsHex[i]);assert.throws(()=>decode(part.buffer));assert.equal(r.push(part),i===p.recordCount-1);part.fill(0);if(i<p.recordCount-1)assert.equal(r.current,null);checks++;}
 assert.equal(hex(r.current.bodyCopy()),c.bodyHex);let dto=r.current.messages();assert.equal(dto[1].items.length,11);const originalHp=dto[0].me?.hp;if(dto[0].me)dto[0].me.hp=-999;assert.equal(r.current.messages()[0].me?.hp,originalHp);const copied=r.current.bodyCopy();copied.fill(0);assert.equal(hex(r.current.bodyCopy()),c.bodyHex);
 if(c.name==='synthetic-available-empty'){assert.notEqual(r.current.messages()[1].items[9].value,null);assert.notEqual(r.current.messages()[1].items[10].value,null);}
 if(c.name==='synthetic-clear-mirror-range'){assert.deepEqual(r.current.messages()[0].ownerCombat.lock,{clear:true});assert.equal(r.current.messages()[0].ownerCombat.asMilli,Number.MAX_VALUE);}
 if(c.name==='synthetic-redacted-owner-lock')assert.deepEqual(r.current.messages()[0].ownerCombat.lock,{held:true,target:null});
 const next=prepare({...m,scene:2n,cueFrom:m.cueThrough,cueThrough:m.cueThrough+(m.cueThrough-m.cueFrom)},frames(c),f.limits);
 for(let index=0;index<next.recordCount;index++){const full=next.record(index);for(let end=0;end<full.length;end++){const recv=prime(p),held=recv.current;for(let i=0;i<index;i++)recv.push(next.record(i));assert.throws(()=>recv.push(full.subarray(0,end)));assert.equal(recv.current,held);assert.equal(recv.closed,true);prefixes++;}}
 for(const seq of [[0,0],[0,2],[0,next.recordCount-1],[1]]){const recv=prime(p),held=recv.current;assert.throws(()=>{for(const i of seq)recv.push(next.record(i));});assert.equal(recv.current,held);checks++;}
 for(const offset of [10,18,38,65]){const recv=prime(p),held=recv.current;const begin=next.record(0);begin[offset]^=1;assert.throws(()=>{recv.push(begin);for(let i=1;i<next.recordCount;i++)recv.push(next.record(i));});assert.equal(recv.current,held);checks++;}
 const quota={...f.limits,bodyBytes:p.bodyCopy().length,retainedBodyBytes:p.bodyCopy().length};const quotaReceiver=new Receiver(m.epoch,quota);for(let i=0;i<p.recordCount;i++)quotaReceiver.push(p.record(i));const quotaHeld=quotaReceiver.current;assert.throws(()=>quotaReceiver.push(next.record(0)));assert.equal(quotaReceiver.current,quotaHeld);assert.equal(quotaReceiver.ownedBodyBytes,p.bodyCopy().length);
 const exact={...f.limits,bodyBytes:p.bodyCopy().length};prepare(m,frames(c),exact);assert.throws(()=>prepare(m,frames(c),{...exact,bodyBytes:exact.bodyBytes-1}));
 for(const key of ['badQuestRecordsHex','badArenaRecordsHex','badTimeRecordsHex'])if(c[key]){
   const recv=new Receiver(m.epoch,f.limits);assert.throws(()=>{for(const part of c[key])recv.push(bytes(part));});assert.equal(recv.current,null);
   const prior=prime(p),held=prior.current,newThrough=m.cueThrough+(m.cueThrough-m.cueFrom);
   const malformed=c[key].map(h=>{const b=bytes(h),v=new DataView(b.buffer,b.byteOffset,b.byteLength);v.setBigUint64(18,2n,true);if(b[9]===1){v.setBigUint64(47,m.cueThrough,true);v.setBigUint64(55,newThrough,true);}if(b[9]===3)v.setBigUint64(32,newThrough,true);return b;});
   for(let i=0;i<malformed.length-1;i++)assert.equal(prior.push(malformed[i]),false);
   assert.throws(()=>prior.push(malformed.at(-1)));assert.equal(prior.current,held);assert.equal(hex(prior.current.bodyCopy()),c.bodyHex);checks+=2;
 }
 checks+=8;
}
assert.throws(()=>new Receiver(0n,f.limits));assert.throws(()=>new Receiver(1n,{...f.limits,partBytes:0}));
assert.throws(()=>prepare({...meta(f.cases[0]),scene:(1n<<64n)-1n},frames(f.cases[0]),f.limits));
console.log(JSON.stringify({result:'PASS',cases:f.cases.length,controlGroups:checks,prefixes,protocol:14,profile:f.profile,boundary:'isolated Full current14 data; no live WS/producer-capacity/AcceptedFrame or history parity proof'}));
