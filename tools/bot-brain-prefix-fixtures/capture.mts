// Unmodified source APIs; declared component inputs/services, NOT a gameplay/Room capture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {mulberry32} from '/repo/packages/shared/src/index.ts';
import {mapFromTiles} from '/repo/packages/shared/src/map.ts';
import {TIERS, PERSONAS} from '/repo/packages/server/src/bots/brain/types.ts';
import {createMemory} from '/repo/packages/server/src/bots/brain/memory.ts';
import {createWorldTactics} from '/repo/packages/server/src/bots/brain/tactics/world.ts';
import {createBrain} from '/repo/packages/server/src/bots/brain/brain.ts';
const [mode,path] = process.argv.slice(2);
assert(process.argv.slice(2).length===2 && ['--write','--check'].includes(mode) && path);
assert.equal(process.version,'v22.23.4'); assert.equal(process.platform,'linux'); assert.equal(process.arch,'x64');
const width=24, tiles=Array.from({length:width*width},(_,i)=>i%width===0||i%width===23||i<width||i>=width*23?1:0);
const map=mapFromTiles(width,width,Uint8Array.from(tiles),1);
const features={wishes:false,statusEffects:true,fields:false,planning:false,chests:false,skills:false,relics:false,camps:false,hazards:false,messageTypes:[]};
const percept=(now,fields={})=>({now,viewT:now,self:{id:'p1',name:'owner',x:300,y:300,facing:0,status:'alive',hp:100,maxHp:100,barrier:0,faction:'fire',weapons:['sword',null],slot:0,attackTarget:null,drawStartedAt:0,readyAt:0,immuneUntil:0,sig:0,brand:0,power:0,asMult:1,windupMult:1,speedMult:1,kills:0,mobKills:0,gv:0,bounty:0,moveSeq:0,...fields.self},hud:{phase:'active',training:false,lobbyEndsAt:0,raidStartedAt:0,patienceEndsAt:0,suddenDeathAt:0,inColiseum:false,gatesLocked:false,startedWith:2,alive:2,playerCount:2,minPlayers:2,winner:'',...fields.hud},fighters:fields.fighters??[],mobs:[],containers:[],projectiles:[],minimap:{t:0,mobs:[],gatesLocked:false},events:fields.events??[],extras:fields.extras??{},features});
const fighter=(v={})=>({id:'p2',name:'seen label',bot:false,x:380,y:300,facing:0,status:'alive',hpFrac:1,barrierFrac:0,faction:'frost',inHand:'sword',drawStartedAt:0,bounty:0,immune:false,sig:0,brand:0,targetable:true,vx:0,vy:0,dist:80,los:true,tint:0,central:true,...v});
const memoryCases=[];
const scenes=[
 ['reentry-and-swap',[[100,[{}]],[150,[{inHand:'bow'}]],[200,[{inHand:null}]],[250,[{inHand:'axe'}]],[300,[]],[350,[{inHand:'axe'}]],[400,[{x:1090}]],[450,[]],[3400,[{x:1090}]],[3450,[]],[6451,[{x:1090}]]]],
 ['permanent-death-hp-expiry',[[100,[{hpFrac:.4,bounty:10}]],[200,[{status:'dead',hpFrac:0}]],[250,[{status:'alive'}]],[20251,[]],[45300,[]]]],
 ['owner-anchor',[[100,[],{x:300}],[150,[],{x:300.75}],[200,[],{x:301}],[250,[],{x:301.125}],[300,[],{x:301.75}]]],
];
for(const tier of ['easy','normal','hard']) for(const [name,rows] of scenes){
 const memory=createMemory({tier:TIERS[tier],map,selfId:'p1',features}); const frames=[];
 for(const [now,players,self] of rows){
  const p=percept(now,{fighters:players.map(v=>fighter(v)),self});
  const events=memory.observe(p);
  frames.push({input:{now,owner:{x:p.self.x,y:p.self.y,status:p.self.status},players:p.fighters.map(f=>({id:f.id,x:f.x,y:f.y,status:f.status,hpFrac:f.hpFrac,faction:f.faction,inHand:f.inHand,bounty:f.bounty}))},result:{stillSince:memory.view.self.stillSince,stimuli:events.filter(s=>s.kind==='newThreat'||s.kind==='foeSwapped'),records:[...memory.view.fighters.values()].map(r=>({id:r.id,seenAt:r.seenAt,faction:r.faction,inHand:r.inHand,otherSlot:r.otherSlot,weaponsSeen:[...r.weaponsSeen],hpFrac:r.hpFrac,bounty:r.bounty,alive:r.alive,diedAt:r.diedAt,whereabouts:memory.view.whereabouts(r.id,now)}))}});
 }
 memoryCases.push({name,tier,frames});
}
const sentCases=[];
const sentMemory=createMemory({tier:TIERS.normal,map,selfId:'p1',features});
sentMemory.observe(percept(100));
for(const [at,cmd,intent] of [[125,{type:'move',msg:{x:340,y:300}},'move'],[150,{type:'stop',msg:{}},'stop'],[175,{type:'target',msg:{id:'p2'}},'lock'],[200,{type:'cast',msg:{slot:'wish',x:350,y:300}},'cast'],[225,{type:'swap',msg:{slot:1}},'swap']]){
 const tc={at,cmd,intent,priority:2};sentMemory.noteSent(tc);
 sentCases.push(structuredClone({input:tc,lastOrder:sentMemory.view.self.lastOrder,lastCast:sentMemory.view.self.lastCast}));
}
const worldCases=[];
const world=createWorldTactics();
const worldRows=[
 [100,{kind:'roam',to:{x:600,y:300},why:'centre'},100,true],
 [150,{kind:'roam',to:{x:348,y:300},why:'centre'},100,false],
 [1300,{kind:'roam',to:{x:450,y:300},why:'centre'},100,false],
 [1350,{kind:'roam',to:{x:600,y:300},why:'centre'},1300,false],
 [1400,{kind:'idle'},1400,true],[1450,{kind:'idle'},1450,true],[2200,{kind:'idle'},2200,true],
 [2250,{kind:'hold',at:{x:300,y:300},why:'wait'},2250,true],[2300,{kind:'hold',at:{x:301,y:300},why:'wait'},2250,true],
 [3050,{kind:'hold',at:{x:301,y:300},why:'wait'},3050,true],[3100,{kind:'hold',at:{x:301,y:300},why:'wait'},100,true],
 [6201,{kind:'idle'},6201,true],[6250,{kind:'hold',at:{x:300,y:300},why:'ambush'},6250,true],
];
for(const [now,goal,stillSince,walkable] of worldRows){
 let walks=0;
 const p=percept(now); const result=world.act({p,mem:{self:{stillSince}},svc:{paths:{walk:()=>{walks++;return walkable?{dist:1,exact:true}:null;}}}},goal);
 worldCases.push({input:{now,goal,stillSince,walkable,at:{x:300,y:300}},result,walks});
}
// Observe the real brain's scheduling through its supported FeatureModule callbacks. The
// wrapper forwards every original RNG return unchanged and adds NO draws. Candidate scoring
// remains source-owned/opaque; Rust tests replay only those recorded opaque draw counts.
const schedulerCases=[];
for(const tier of ['easy','normal','hard']){
 let current,phase='observe',events,draws,stimuli,wrapped=false;
 const module={id:'prefix-witness',enabled:()=>true,observe(ctx){
  events.push('observe');phase='observe';stimuli=ctx.mem.stimuli.map(s=>s.kind);
  if(!wrapped){wrapped=true;for(const name of ['decide','motor','lapse']){const original=ctx.rng[name];ctx.rng[name]=()=>{const value=original();draws.push({stream:name,phase,value});return value;};}}
 },goals(){events.push('strategy');phase='strategy';return [{goal:{kind:'module',module:'prefix-witness',data:{slot:current.slot}},utility:100,why:'declared scheduler witness'}];},act(){events.push('act');phase='act';return {intents:[],status:{state:current.status,why:'declared tactic status'},attacking:false};}};
 const seed=7;
 const brain=createBrain({id:'p1',name:'owner',tier:{...TIERS[tier],lapseP:0},persona:PERSONAS.farmer,seed,map,features,learned:{enabled:false,bias:()=>0},services:{paths:{walk:()=>null,clear:()=>false,los:()=>false,collisionMap:()=>map,setFrame(){}},log(){}},modules:[module]});
 const frames=[];
 for(let now=100;now<=4100;now+=25){
  current={now,slot:now<1625?0:now<2625?1:now<3200?2:3,status:now===1100?'blocked':now===1600?'done':now===2600?'failed':'running'};
  events=[];draws=[];
  const fields=now===600?{fighters:[fighter({})]}:now===700?{self:{hp:40}}:now===3000?{events:[{kind:'toast',t:now,text:'declared toast'}]}:{};
  if(now===1100||now===1600||now===2600) fields.events=[{kind:'toast',t:now,text:'declared status step'}];
  const commands=brain.tick(percept(now,fields));
  assert.equal(brain.goal.kind,'module','declared module must dominate the real strategy');
  assert.equal(commands.length,0,'scheduler witness deliberately owns no command intents');
  frames.push({...current,toast:!!fields.events?.some(e=>e.kind==='toast'),stimuli,events,draws});
 }
 schedulerCases.push({tier,seed,declaredTierOverride:{lapseP:0},frames});
}
// The actual private mergeIntents is exercised through non-module goal execution and the
// supported adjust callback. No copied arbitration formula is used as the expected result.
const arbitrationCases=[];
const move=(priority,x)=>({kind:'move',to:{x,y:300},priority,timing:{kind:'step'},why:'declared move'});
const stop=priority=>({kind:'stop',priority,timing:{kind:'step'},why:'declared stop'});
for(const extra of [[move(2,340),stop(0)],[stop(3),move(2,340)],[stop(3),stop(3)],[{kind:'cast',slot:'wish',x:350,y:300,priority:3,timing:{kind:'step'},why:'first cast'},{kind:'cast',slot:'wish',x:360,y:300,priority:0,timing:{kind:'step'},why:'second cast'}]]){
 let result;
 const module={id:'arbitration-witness',enabled:()=>true,goals:()=>[{goal:{kind:'idle'},utility:100,why:'declared idle'}],intents:()=>extra,adjust(_ctx,_goal,intents){result=structuredClone(intents);return intents;}};
 const brain=createBrain({id:'p1',name:'owner',tier:{...TIERS.normal,lapseP:0},persona:PERSONAS.farmer,seed:7,map,features,learned:{enabled:false,bias:()=>0},services:{paths:{walk:()=>null,clear:()=>false,los:()=>false,collisionMap:()=>map,setFrame(){}},log(){}},modules:[module]});
 brain.tick(percept(100));assert(result);
 arbitrationCases.push({base:[{kind:'stop',priority:3,timing:{kind:'step'},why:'idle'}],extra,result});
}
const sha=p=>createHash('sha256').update(readFileSync('/repo/'+p)).digest('hex');
const source={};
for(const dir of ['packages/shared/src','packages/server/src/bots']){
 const walk=rel=>{for(const e of readdirSync('/repo/'+rel,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=rel+'/'+e.name;if(e.isDirectory())walk(p);else if(p.endsWith('.ts'))source[p]=sha(p);}};walk(dir);
}
for(const p of ['package.json','packages/shared/package.json','packages/server/package.json','packages/client/package.json','tsconfig.base.json','packages/shared/tsconfig.json','packages/server/tsconfig.json','tools/bot-brain-prefix-fixtures/capture.sh']) source[p]=sha(p);
const result={format:'rh-bot-brain-prefix/1' ,profile:{boundary:'Declared component percepts/services; memory projection, non-loot world tactics and actual createBrain coordinator only. NOT full strategy/fight/FrameRing or gameplay parity.',node:process.version,platform:process.platform,arch:process.arch,image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',sourceSha256:source,toolSha256:sha('tools/bot-brain-prefix-fixtures/capture.mts'),lockSha256:sha('package-lock.json'),map:{w:width,h:width,seed:1,tiles}},memoryCases,sentCases,worldCases,schedulerCases,arbitrationCases};
const out=JSON.stringify(result,null,1)+'\n';
if(mode==='--write'){writeFileSync(path,out);console.log(`captured ${memoryCases.length} memory sequences, ${worldCases.length} world steps, ${schedulerCases.length} coordinator sequences`);}else{assert.equal(readFileSync(path,'utf8'),out);console.log('source bytecheck PASS');}
