// Direct feature-aware overlap, separate from createBrain histories. Real hand + real Memory; no installed pending state.
import {shared,types,hand,knowledge,ROOT} from './runtime.mts';
import {MAPS,features,percept,at,fighter} from './builders.mts';
import {encode,memorySnapshot} from './codec.mts';
import {pathToFileURL} from 'node:url';
const {createMemory}=await import(pathToFileURL(ROOT+'/packages/server/src/bots/brain/memory.ts').href);
export function handSupplement() {
 const out:any[]=[];
 for(const profile of ['absent','empty','attack-only','target-only','partial','all']) {
  const tier=types.TIERS.hard,map=MAPS.open;
  const f=features({messageTypes:{absent:[],empty:[],'attack-only':['attack','release'],'target-only':['target'],partial:['move','plan'],all:features().messageTypes}[profile]});
  const h=hand.createHumanizer({tier,map,...(profile==='absent'?{}:{features:f})});
  const mem=createMemory({tier,map,selfId:'me',features:f});let trace:any[]=[];const counts:any={decide:0,motor:0,lapse:0};const rng:any={};
  for(const [i,lane]of ['decide','motor','lapse'].entries()){const r=shared.mulberry32(123+i);rng[lane]=()=>{const value=r();trace.push({kind:'rng',lane,index:counts[lane]++,value});return value;};}
  const know=knowledge.createKnowledge(tier,shared.mulberry32(126));
  const ops:any[]=[];
  for(const [i,weapon]of ['sword','wand'].entries()){
   const p=percept(100000+i*2000,{self:{weapons:[weapon,null]},fighters:[fighter('foe',100)]});mem.observe(p);
   const ctx:any={p,mem:mem.view,rng,know,cfg:{tier,map,features:f},svc:{},engaged:false};
   const intents:any[]=[{kind:'lock',target:'foe',at:at(100),priority:1,timing:{kind:'step'},why:'direct feature lock'}, {kind:'move',to:at(200),priority:2,timing:{kind:'step'},why:'direct move'}, {kind:'plan',msg:{ready:true},priority:2,timing:{kind:'step'},why:'direct plan'}];
   trace=[];h.submit(intents,ctx);const submitTrace=trace;trace=[];
   const q={...p,now:p.now+1000};mem.observe(q);ctx.p=q;
   const result=h.release(ctx);for(const tc of result)mem.noteSent(tc);
   ops.push({percept:encode(p),intents:encode(intents),submitTrace:encode(submitTrace),releasePercept:encode(q),result:encode(result),releaseTrace:encode(trace),misses:encode(h.drainMisses()),stats:encode(h.stats),counts:{...counts},memory:memorySnapshot(mem)});
  }
  out.push({profile,features:profile==='absent'?encode(undefined):encode(f),tier:encode(tier),seeds:{decide:123,motor:124,lapse:125,knowledge:126},operations:ops});
 }
 return out;
}
