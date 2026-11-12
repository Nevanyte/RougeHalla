// Focused transport checks; golden vectors remain generated exclusively by Rust.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../../crates/rh-server/web/probe.html',import.meta.url),'utf8');
const a=html.search(/\/\/ ---- protocol v\d+/),b=html.indexOf('// ---- probe state');
const {W,input,decodeClient,decode,Tracker}=new Function(`"use strict";${html.slice(a,b)};return {W,input,decodeClient,decode,Tracker};`)();
let checks=0;const ok=(fn)=>{fn();checks++};
const buf=(w)=>w.out().buffer;
const v=(w,n)=>{do{let b=n&127;n=Math.floor(n/128);w.u8(b|(n?128:0));}while(n);};
const commands=[{k:'useConsumable'},{k:'target',actorRef:0xffffffff},{k:'attackMove',x:12.5,y:-2,seq:255}];
ok(()=>assert.deepEqual(decodeClient(input(7,commands).buffer).cmds,commands));
for(const actorRef of [0,-1,1.5,0x100000000,NaN])ok(()=>assert.throws(()=>input(1,[{k:'target',actorRef}])));
ok(()=>assert.throws(()=>decodeClient(Uint8Array.from([2,0,0,0,0,1,0,10,0,0,0,0]).buffer)));
const camp=(patch={})=>Object.assign({mobType:0,elite:30,alive:0,state:2,clearedAt:1000,respawnAt:181000,reward:null,ward:null},patch);
// P-WIRE17-HUD-1: the camp row's reward and ward tail.
function hudTail(w,c){if(c.reward){w.u8(1+c.reward.stat);w.u16(c.reward.amount);}else w.u8(0);if(c.ward){w.u8(c.ward.verdict);w.f64(c.ward.expiresAt);}else w.u8(0);}
function state(c,key=6){const w=new W();w.u8(0x88);v(w,1);v(w,1);v(w,key);v(w,1);w.u8(c.mobType);w.u8(c.elite);v(w,c.alive);w.u8(c.state);w.f64(c.clearedAt);w.f64(c.respawnAt);hudTail(w,c);return buf(w);}
ok(()=>assert.deepEqual(decode(state(camp())).items,[{key:6,value:[camp()]}]));
for(const patch of [{mobType:30},{elite:31},{alive:513},{state:3},{clearedAt:-1},{respawnAt:999},{respawnAt:NaN},{clearedAt:Infinity}])ok(()=>assert.throws(()=>decode(state(camp(patch)))));
const hud=camp({reward:{stat:6,amount:12500,value:12500*1e-4},ward:{verdict:2,yours:false,expiresAt:61000}});
ok(()=>assert.deepEqual(decode(state(hud)).items,[{key:6,value:[hud]}]));
for(const patch of [{reward:{stat:9,amount:1}},{reward:{stat:0,amount:0}},{ward:{verdict:3,expiresAt:0}},{ward:{verdict:1,expiresAt:-1}},{ward:{verdict:2,expiresAt:NaN}}])ok(()=>assert.throws(()=>decode(state(camp(patch)))));
{const b=new Uint8Array(state(hud));for(let i=0;i<b.length;i++)ok(()=>assert.throws(()=>decode(b.slice(0,i).buffer)));}
const bytes=new Uint8Array(state(camp()));for(let i=0;i<bytes.length;i++)ok(()=>assert.throws(()=>decode(bytes.slice(0,i).buffer)));
ok(()=>assert.throws(()=>decode(state(camp(),8))));ok(()=>assert.throws(()=>decode(Uint8Array.from([0x88,0,8]).buffer)));
const tracker=new Tracker();tracker.decode(state(camp()));tracker.decode(Uint8Array.from([0x88,1,1,1,0]).buffer);
ok(()=>assert.deepEqual(tracker.collections.get(6),[camp()]));
tracker.reset();ok(()=>assert.equal(tracker.collections.size,0));
function notice(n){const w=new W();w.u8(0x84);w.u32(1);w.u16(1);w.u8(7);w.u8(n);return buf(w);}
for(let n=1;n<=10;n++)ok(()=>assert.deepEqual(decode(notice(n)).events,[{k:'potionNotice',notice:n}]));
for(const n of [0,11])ok(()=>assert.throws(()=>decode(notice(n))));
// New fields default, replace, and explicitly clear in a binary delta without mutating held inputs.
const base={t:'snapshot',tick:1,phase:1,me:null,actors:[{id:2,x:1,y:2,facing:0,hpPct:100,status:1,mobTypeCode:30,sig:255}]};tracker.apply(base);
const delta=new W();delta.u8(0x87);v(delta,2);v(delta,1);v(delta,0);v(delta,0);v(delta,1);v(delta,2);v(delta,0xc00);delta.u8(0);delta.u8(0);
const next=tracker.decode(buf(delta));ok(()=>assert.equal(next.actors[0].mobTypeCode,0));ok(()=>assert.equal(next.actors[0].sig,0));ok(()=>assert.equal(base.actors[0].sig,255));
console.log(`first-playable focused JS checks passed: ${checks}`);

const projectileFrame=new W();projectileFrame.u8(0x88);v(projectileFrame,1);v(projectileFrame,1);v(projectileFrame,7);v(projectileFrame,2);
for(let i=0;i<2;i++){projectileFrame.u8(0);projectileFrame.u16(800);projectileFrame.u16(900);projectileFrame.u16(12345);projectileFrame.u8(1);v(projectileFrame,1);projectileFrame.u8(3);}
const projectiles=decode(buf(projectileFrame)).items[0].value;ok(()=>assert.equal(projectiles.length,2));ok(()=>assert.deepEqual(projectiles[0],projectiles[1]));ok(()=>assert.equal(projectiles[0].height,3));ok(()=>assert.throws(()=>decode(buf(projectileFrame).slice(0,-1))));
for(const offset of [5,12]){const malformed=projectileFrame.out();malformed[offset]=2;ok(()=>assert.throws(()=>decode(malformed.buffer)));}
console.log(`with projectiles: ${checks}`);
