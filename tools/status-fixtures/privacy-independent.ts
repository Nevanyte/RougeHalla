import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {rig} from '../../parity/legacy-capture/status-probes-privacy-observer.ts';
import {perceive} from '../../packages/server/src/bots/brain/perception.ts';
import {canPlayerSee} from '../../packages/server/src/sim/vision.ts';
assert.deepEqual([process.version,process.platform,process.arch],['v22.23.4','linux','x64']);
const field=(kind='cloud',extra:any={})=>({kind,ability:kind==='trail'?'blaze':'swarm',owner:{id:'bob',name:'BOB'},subject:null,x:240,y:320,x2:280,y2:320,r:20,vx:0,vy:0,startedAt:1000,endsAt:5000,...extra});
const defs:any[]=[['visible-owner',{},'cloud',{}],['unseen-owner',{x:1100,y:320},'cloud',{}],['hidden-owner',{hidden:true},'cloud',{}],['unseen-origin',{},'cloud',{x:1100,x2:1120}],['trail-unseen-end',{},'trail',{x2:1100}],['trail-unseen-start',{},'trail',{x:1100}],['trail-visible',{},'trail',{}],['departed-owner',{departed:true},'trail',{}],['duplicate-public-facts',{duplicate:true},'cloud',{}],['hidden-allocation-before',{duplicate:true,hiddenAllocation:true},'cloud',{}],['reveal-next-tick',{hidden:true,reveal:1049},'cloud',{}],['reveal-open-boundary',{hidden:true,reveal:1050},'cloud',{}],['expiry-before-refresh',{hidden:true,expire:true},'cloud',{}],['expiry-after-refresh',{hidden:true,expire:true,refresh:true},'cloud',{}]];
const cases:any[]=[];
for(const [name,setup,kind,patch] of defs){
 const operations:any[]=[];
 if(setup.x)operations.push({kind:'actorPatch',id:'bob',patch:{x:setup.x,y:setup.y}});
 if(setup.hidden)operations.push({kind:'apply',id:'bob',apply:{kind:'hidden',source:{id:'bob',name:'BOB'},ms:1000,ability:'swarm'}});
 if(setup.hiddenAllocation)operations.push({kind:'fieldAdd',field:field('trail',{x:1100,x2:1120})});
 operations.push({kind:'fieldAdd',field:field(kind,patch)});
 if(setup.duplicate)operations.push({kind:'fieldAdd',field:field(kind,patch)});
 if(setup.departed)operations.push({kind:'removePlayer',id:'bob'});
 if(setup.expire){operations.push({kind:'clock',at:2000});if(setup.refresh)operations.push({kind:'updateAbilities'});}
 if(setup.reveal)operations.push({kind:'reveal',id:'bob',until:1500},{kind:'clock',at:setup.reveal},{kind:'updateAbilities'});
 const c:any={name,setup:{splitMap:true},classification:'trusted-helper',boundary:'Actual source perception/vision; trusted field/status inputs; no ability producer claim',operations};
 const a:any=rig(c,false),b:any=rig(c,false);for(const op of operations){a.execute(op);b.execute(op);}
 const before=a.snapshot();const ctx:any={selfId:'alice',map:a.world.map,features:{messageTypes:[],wishes:false,statusEffects:true,fields:true,planning:false,chests:false,skills:false,relics:false,camps:false,hazards:false},lastMinimap:null,canSee:(p:any)=>canPlayerSee(a.world,'alice',p)};
 const frame:any=perceive({state:a.world.state},ctx);assert.deepEqual(perceive({state:a.world.state},ctx),frame);assert.deepEqual(a.snapshot(),before,'observer state '+name);
 const publicFacts={actors:frame.fighters.map((f:any)=>f.id),fields:frame.extras.fields.map(({id,...f}:any)=>f).sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),effects:frame.extras.effects};
 for(let n=0;n<5;n++){a.execute({kind:'step'});b.execute({kind:'step'});}assert.deepEqual(a.snapshot(),b.snapshot(),'ordinary continuation '+name);a.verifyRandom();b.verifyRandom();
 cases.push({name,setup,kind,patch,operations,publicFacts,sourceFrame:frame,visibilityProbes:{near:ctx.canSee({x:240,y:320}),far:ctx.canSee({x:1100,y:320})},observerNoninterference:true,continuationSteps:5});
}
assert.deepEqual(cases.find(c=>c.name==='duplicate-public-facts').publicFacts,cases.find(c=>c.name==='hidden-allocation-before').publicFacts);
for(const c of cases){assert.equal(c.visibilityProbes.near,true);assert.equal(c.visibilityProbes.far,false);}
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const sourcePaths=JSON.parse(readFileSync('tools/status-fixtures/source-inventory.json','utf8'));
for(const name of ['packages/server/src/bots/brain/perception.ts','packages/server/src/bots/brain/types.ts'])if(!sourcePaths.includes(name))sourcePaths.push(name);
const sources=Object.fromEntries(sourcePaths.map((p:string)=>[p,hash(p)]));
writeFileSync('/out/privacy-source.json',JSON.stringify({runtime:[process.version,process.platform,process.arch],sourceSha256:sources,scriptSha256:hash('tools/status-fixtures/privacy-independent.ts'),cases},null,2)+'\n');console.log(JSON.stringify({cases:cases.length,sourceFiles:sourcePaths.length,fields:cases.map(c=>[c.name,c.publicFacts.fields.length])}));
