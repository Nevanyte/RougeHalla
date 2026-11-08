// Actual source memory subset on declared no-event/current-codec-compatible contexts; not full perceive/FrameRing parity.
import assert from 'node:assert/strict';import {readFileSync,writeFileSync,readdirSync} from 'node:fs';import {createHash} from 'node:crypto';import {join} from 'node:path';
import {createMemory} from '../../packages/server/src/bots/brain/memory.ts';
import {TIERS} from '../../packages/server/src/bots/brain/types.ts';
import {mapFromTiles} from '../../packages/shared/src/map.ts';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
assert.equal(process.version,'v22.23.4');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
const [mode,out]=process.argv.slice(2);assert(['--write','--check'].includes(mode)&&out);
const html=readFileSync('crates/rh-server/web/probe.html','utf8'),a=html.search(/\/\/ ---- protocol v\d+/),b=html.indexOf('// ---- probe state');assert(a>=0&&b>a);
const {decode,Tracker}=new Function(`"use strict";${html.slice(a,b)};return {decode,Tracker};`)();
const vectors=JSON.parse(readFileSync('protocol/fixtures/v13.json','utf8'));assert.equal(vectors.protocol,13);
const bytes=(hex:string)=>Uint8Array.from(hex.match(/../g)??[],h=>parseInt(h,16)).buffer;
const bits=(v:number)=>{const buf=new ArrayBuffer(4);const d=new DataView(buf);d.setFloat32(0,v,true);return d.getUint32(0,true);};
const owner=(m:any)=>m===null?null:{...m,xBits:bits(m.x),yBits:bits(m.y),facingBits:bits(m.facing),hpBits:bits(m.hp),maxHpBits:bits(m.maxHp),barrierBits:bits(m.barrierBits)};
const actor=(m:any)=>({...m,xBits:bits(m.x),yBits:bits(m.y),facingBits:bits(m.facing)});
const actorCodes=(m:any)=>({...m,x:Math.round(m.x*8),y:Math.round(m.y*8),facing:(Math.round(m.facing/Math.fround(Math.PI*2/65536))&65535)});
const codecCases:any[]=[];
for(const name of ['snapshot','snapshot_training','snapshot_defaults','snapshot_spectator','snapshot_full']){
 const v=vectors.server.find((x:any)=>x.name===name);assert(v?.decoded);const d=decode(bytes(v.hex));
 assert.equal(d.t,'snapshot');assert.equal(d.serverMs,v.decoded.serverMs);assert.equal(d.me===null,v.decoded.me===null);
 if(d.me)for(const k of ['x','y','facing','hp','maxHp'])assert.equal(bits(d.me[k]),v.decoded.me[k+'Bits']);
 for(let i=0;i<d.actors.length;i++)for(const k of ['x','y','facing'])assert.equal(bits(d.actors[i][k]),v.decoded.actors[i][k+'Bits']);
 codecCases.push({name,hex:v.hex,input:{sourceTime:d.serverMs,owner:owner(d.me),actors:d.actors.map(actorCodes)},expected:{sourceTime:d.serverMs,owner:owner(d.me),actors:d.actors.map(actor)},admissible:!['snapshot_full','snapshot_training'].includes(name)});
}
const clockChain=vectors.chains.find((c:any)=>c.name==='wish_source_time_per_frame');assert(clockChain);const tracker=new Tracker();
const clockFrames:any[]=[];
for(const f of clockChain.steps){const d=tracker.decode(bytes(f.hex));if(d.t==='snapshot'){assert.equal(d.serverMs,f.decoded.serverMs);clockFrames.push({tick:d.tick,sourceTime:d.serverMs});}}
assert(clockFrames.some(f=>f.sourceTime!==f.tick*50),'source override positive control');
const features={messageTypes:[],wishes:false,statusEffects:false,fields:false,planning:false,chests:false,skills:false,relics:false,camps:false,hazards:false};
const map=mapFromTiles(4,4,new Uint8Array(16));
const self=(spec:any)=>({id:'p1',name:'',x:Math.fround(spec?.x??32),y:Math.fround(spec?.y??32),facing:0,status:'alive',hp:100,maxHp:100,barrier:0,faction:'fire',weapons:['sword',null],slot:0,attackTarget:null,drawStartedAt:0,readyAt:0,immuneUntil:0,sig:0,brand:0,power:0,asMult:1,speedMult:1,kills:0,mobKills:0,mobStats:{},gv:0,bounty:0,moveSeq:0});
const fighter=(s:any)=>({id:`p${s.id}`,name:'',bot:false,x:s.x/8,y:s.y/8,facing:0,status:s.status??'alive',hpFrac:(s.hpPct??100)/100,barrierFrac:0,faction:s.faction??'frost',inHand:s.weapon==='fists'?null:(s.weapon??'sword'),drawStartedAt:0,bounty:s.bounty??0,immune:false,sig:0,brand:0,targetable:true,vx:0,vy:0,dist:0,los:true,tint:0,central:true});
const scripts=[{name:'seen-weapons-stillness-expiry',frames:[
 {now:100000.25,players:[{id:2,x:800,y:1600,hpPct:65,bounty:4}]},
 {now:100050.25,owner:{x:32.75},players:[{id:2,x:801,y:1600,hpPct:60,weapon:'bow'}]},
 {now:100100.25,owner:{x:33},players:[{id:2,x:802,y:1600,hpPct:60,weapon:'fists'}]},
 {now:100150.25,owner:{x:33.125},players:[{id:2,x:803,y:1601,hpPct:60,weapon:'axe'}]},
 {now:100200.25,players:[]},{now:120150.25,players:[]},{now:120150.5,players:[]},
 {now:125150.25,players:[]},{now:135150.25,players:[]},{now:145150.25,players:[]},{now:145150.5,players:[]},
 {now:145200.25,players:[{id:2,x:880,y:1700,hpPct:20,weapon:'bow'}]},
 ]},{name:'observed-death-no-resurrection',frames:[
 {now:7.5,players:[{id:2,x:800,y:800},{id:3,x:880,y:800,weapon:'wand'}]},
 {now:57.5,players:[{id:2,x:808,y:808,status:'dead',hpPct:0}]},
 {now:107.5,players:[{id:2,x:816,y:816,status:'alive',hpPct:100}]},
 {now:157.5,players:[{id:3,x:888,y:800,status:'mia',hpPct:0}]},
 ]}];
const memoryCases:any[]=[];
for(const tier of ['easy','normal','hard'])for(const script of scripts){
 const m=createMemory({tier:TIERS[tier],map,selfId:'p1',features});const frames=[];
 for(const input of script.frames){const now=input.now;const p:any={now,viewT:now,self:self(input.owner),hud:{inColiseum:false},fighters:input.players.map(fighter),mobs:[],containers:[],projectiles:[],minimap:{t:now,mobs:[],gatesLocked:false},events:[],extras:{},features};m.observe(p);
  const records=[...m.view.fighters].map(([id,r]:any)=>({id:Number(id.slice(1)),x:r.pos.x,y:r.pos.y,seenAt:r.seenAt,faction:r.faction,inHand:r.inHand,otherSlot:r.otherSlot,weaponsSeen:[...r.weaponsSeen],alive:r.alive,diedAt:r.diedAt,bounty:r.bounty,hpEstimate:r.hpFrac,whereabouts:m.view.whereabouts(id,now)}));
  frames.push({input,result:{stillSince:m.view.self.stillSince,records}});
 }memoryCases.push({tier,scenario:script.name,frames});
}
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?files(join(dir,d.name)):[join(dir,d.name)]).filter(p=>p.endsWith('.ts'));}
const pins=[...files('packages/shared/src'),...files('packages/server/src/bots/brain'),'package-lock.json','package.json','tsconfig.base.json','packages/shared/package.json','packages/shared/tsconfig.json','packages/server/package.json','packages/server/tsconfig.json','crates/rh-server/web/probe.html','protocol/fixtures/v13.json','crates/rh-server/src/wire.rs','crates/rh-sim/src/actor_refs.rs','crates/rh-protocol/src/lib.rs','crates/rh-protocol/src/quant.rs','crates/rh-protocol/src/delta.rs','client-unity/RoguehallaNet/Net/Views.cs','client-unity/RoguehallaNet/Net/SnapshotBuffer.cs','client-unity/RoguehallaNet/Protocol/Codec.cs','client-unity/RoguehallaNet/Protocol/Messages.cs','client-unity/RoguehallaNet/Protocol/SnapshotTracker.cs'];
const toolNames=['capture.mts','capture.sh','compare.mjs','run-mutants.sh'];
const corpus:any={format:'rh-bot-memory-subset/1',profile:{base:'198902f42970bd3d71d431931020819b0e36f008',node:process.version,platform:process.platform,arch:process.arch,image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',sourceSha256:Object.fromEntries(pins.sort().map(p=>[p,sha(readFileSync(p))])),toolSha256:Object.fromEntries(toolNames.map(p=>[p,sha(readFileSync(join('tools/bot-memory-fixtures',p)))])),scope:'Actual source memory field-fold subset, declared no-event contexts only. JS decodes existing Rust-generated protocol13 vectors; C# codec code pinned/inspected, not executed here. No full FrameRing/source-world outcome/native-publication proof.'},codecCases,clockFrames,memoryCases};
corpus.captureSha256=sha(JSON.stringify(corpus));const text=JSON.stringify(corpus)+'\n';if(mode==='--write')writeFileSync(out,text);else assert.equal(readFileSync(out,'utf8'),text,'canonical memory subset differs');console.log(JSON.stringify({memoryCases:memoryCases.length,memoryFrames:memoryCases.reduce((n,c)=>n+c.frames.length,0),codecCases:codecCases.length,clockFrames:clockFrames.length,bytes:Buffer.byteLength(text),sha256:sha(text)}));
