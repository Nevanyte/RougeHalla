// Actual original hazards module; declared public-map/owner/goal/memory contexts, not whole-brain outcome evidence.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {hazardsModule,burns,bad,HAZARD_RULES} from '../../packages/server/src/bots/brain/modules/hazards.ts';
import {PERSONAS} from '../../packages/server/src/bots/brain/types.ts';
import {segmentClear,PLAYER_RADIUS} from '../../packages/shared/src/index.ts';
const sha=(b: string|Buffer)=>createHash('sha256').update(b).digest('hex');
assert.equal(process.version,'v22.23.4'); assert.equal(process.platform,'linux'); assert.equal(process.arch,'x64');
const [mode,out]=process.argv.slice(2); assert(['--write','--check'].includes(mode) && out);
const base=JSON.parse(readFileSync('crates/rh-sim/src/mapdata/fixtures/seed1.map.json','utf8'));
const b=base.map;
let anchor: {x:number,y:number}|undefined;
for(let y=11;y<b.h-11&&!anchor;y++) for(let x=11;x<b.w-11&&!anchor;x++) {
  let clear=true; for(let dy=-9;dy<=9;dy++) for(let dx=-9;dx<=9;dx++) if(b.tiles[(y+dy)*b.w+x+dx]!==0)clear=false;
  if(clear)anchor={x,y};
}
assert(anchor,'existing public fixture has a 19x19 floor area');
const at=(dx=0,dy=0)=>({x:(anchor!.x+dx+.5)*32,y:(anchor!.y+dy+.5)*32});
const maps:Record<string,any>={};
for(const [name,kind] of [['ember',4],['bog',5],['ice',6],['light',7],['plain',0]] as const){
 const data=structuredClone(base); data.legacyMapHashU32=0; data.map.terrain.fill(0);
 if(name==='light')data.map.terrain[(anchor.y)*b.w+anchor.x+3]=kind;
 else for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)data.map.terrain[(anchor.y+dy)*b.w+anchor.x+dx]=kind;
 maps[name]=data;
}
const liveMap=(name:string)=>{const m=structuredClone(maps[name].map); for(const k of ['tiles','terrain','regionGrid','territoryGrid','featureGrid'])m[k]=Uint8Array.from(m[k]);return m};
const context=(cfg:any,map:any,s:any)=>({cfg,p:{now:s.now??100000,self:{...at(),faction:'sentenced',status:'alive',hp:100,maxHp:100,attackTarget:null,...s.me},hud:{phase:'active',inColiseum:false,...s.hud}},mem:{self:{stillSince:(s.now??100000)-(s.still??1000)}},engaged:s.engaged??false,svc:{paths:{collisionMap:()=>map,clear:(a:any,b:any)=>segmentClear(map,a,b,PLAYER_RADIUS)}}});
const steps:any[]=[];
const scenario=(name:string,mapName:string,specs:any[])=>{const cfg={persona:PERSONAS.hunter},map=liveMap(mapName);for(const spec of specs){const ctx=context(cfg,map,spec);const goal=spec.goal==='holdWait'?{kind:'hold',why:'wait'}:spec.goal==='holdAmbush'?{kind:'hold',why:'ambush'}:{kind:spec.goal??'idle'};const result=hazardsModule.intents!(ctx as any,goal as any);steps.push({scenario:name,map:mapName,spec,result});}};
scenario('stationary-boundary','ember',[{still:249},{still:250},{now:100050},{now:101500,goal:'loot'},{now:101501},{now:101550,me:at(0,-4)}]);
scenario('home','ember',[{me:{faction:'fire'}}]);
scenario('locked','ember',[{me:{attackTarget:'already-delivered-lock'}}]);
scenario('loot','ember',[{goal:'loot'}]);
scenario('coliseum','ember',[{hud:{inColiseum:true}}]);
scenario('not-active','ember',[{hud:{phase:'planning'}},{me:{status:'dead'}}]);
scenario('light-hold','light',[{goal:'holdWait',me:{hp:49}},{goal:'holdWait',now:100050,engaged:true},{goal:'holdWait',now:101501,engaged:true}]);
scenario('light-threshold','light',[{goal:'holdWait',me:{hp:50}},{goal:'holdAmbush',me:{hp:49}},{goal:'idle',now:101501,me:{hp:49}}]);
scenario('light-engaged','light',[{goal:'holdWait',me:{hp:49},engaged:true}]);
scenario('light-already','light',[{goal:'holdWait',me:{hp:10,...at(3)}}]);
scenario('zero-max','light',[{goal:'holdWait',me:{hp:0,maxHp:0}}]);
scenario('hold-arrival','ember',[{}, {now:100300,me:at(0,-4)}, {now:100599}, {now:100600}]);
scenario('hold-boundary','ember',[{}, {now:101500,goal:'loot'}, {now:101501}]);
const adjusts:any[]=[];
for(const name of ['ember','bog','ice','plain'])for(const faction of ['fire','sentenced','plague','frost','holy']) {
 const map=liveMap(name);const spec={me:{faction,...at(-8)}};const ctx=context({persona:PERSONAS.hunter},map,spec);
 const intents=[{kind:'move',to:at(),priority:2,timing:{kind:'step'},why:'walk'}, {kind:'move',to:at(-7),priority:0,timing:{kind:'timed',due:100050},why:'dodge'}, {kind:'stop',priority:3,timing:{kind:'step'},why:'stop'}];
 adjusts.push({map:name,spec,intents,result:hazardsModule.adjust!(ctx as any,{kind:'idle'},intents as any)});
}
const classifications:any[]=[];
for(const name of Object.keys(maps))for(const faction of ['fire','sentenced','plague','frost','holy'])for(const p of [at(),at(3),{x:-1,y:-1}]){const map=liveMap(name);classifications.push({map:name,faction,at:p,burns:burns(map,faction,p.x,p.y),bad:bad(map,faction,p.x,p.y)});}
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?files(join(dir,d.name)):[join(dir,d.name)]).filter(p=>p.endsWith('.ts'));}
const inputs=[...files('packages/shared/src'),...files('packages/server/src/bots/brain'),'package-lock.json','package.json','tsconfig.base.json','packages/shared/package.json','packages/shared/tsconfig.json','packages/server/package.json','packages/server/tsconfig.json','crates/rh-sim/src/mapdata/fixtures/seed1.map.json'];
const tools=['capture.mts','capture.sh','compare.mjs','run-mutants.sh'];
const corpus:any={format:'rh-bot-hazards/1',profile:{base:'198902f42970bd3d71d431931020819b0e36f008',node:process.version,platform:process.platform,arch:process.arch,image:'node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292',sourceSha256:Object.fromEntries(inputs.sort().map(p=>[p,sha(readFileSync(p))])),toolSha256:Object.fromEntries(tools.map(p=>[p,sha(readFileSync(join('tools/bot-hazards-fixtures',p)))])),scope:'Actual original helper/FSM invocation with declared lawful public map, owner and policy memory/goal inputs; not full brain/headless/gameplay parity.'},anchor,maps,persona:'hunter',reengageHp:PERSONAS.hunter.reengageHp,rules:HAZARD_RULES,classifications,steps,adjusts};
corpus.captureSha256=sha(JSON.stringify(corpus));const text=JSON.stringify(corpus)+'\n';
if(mode==='--write')writeFileSync(out,text);else assert.equal(readFileSync(out,'utf8'),text,'canonical hazard bytes differ');
console.log(JSON.stringify({steps:steps.length,adjusts:adjusts.length,classifications:classifications.length,bytes:Buffer.byteLength(text),sha256:sha(text)}));
