// Declared method views/cues, not World launches, achieved dodges or FrameRing/delivery proof.
import {frame,fighter,maps as normalMaps} from '../bot-fight-fixtures/cases.mts';
export function maps(){const open=normalMaps().open;const mk=(rows:number[])=>{const tiles=[...open.tiles];for(const y of rows)for(let x=17;x<=19;x++)tiles[y*open.w+x]=1;return {...open,tiles};};return {open,plus:mk([12]),minus:mk([10]),both:mk([10,12])};}
export const actor=(id='p1',extra:any={})=>fighter({id,x:800,y:368,dist:200,faction:'fire',inHand:'sword',...extra});
const cue=(by='p1',t=900,ms=450,a=Math.PI)=>({kind:'windup',by,weapon:'wand',t,ms,a,at:{x:800,y:368}});
const bow=(extra:any={})=>actor('p1',{inHand:'bow',drawStartedAt:900,...extra});
const shot=(id='ball-a',extra:any={})=>({id,kind:'ball',x:300,y:368,vx:380,vy:0,x0:100,y0:368,t0:0,range:640,from:null,...extra});
const step=(time:any,recipe:any={})=>({time,recipe});
const seq=(name:string,steps:any[],extra:any={})=>({name,map:'open',tier:'hard',seed:0,steps,...extra});
export function percept(now:number,r:any){
 const own={x:600,y:368,...r.self};
 const fighters=(r.fighters??[]).map((f:any)=>({...f,dist:Math.hypot(f.x-own.x,f.y-own.y)}));
 const p=frame(now,{self:{...own,hp:950,maxHp:950,speedMult:r.speed??1},fighters});
 p.viewT=now-(r.lag??0);p.events=(r.events??[]).map((e:any)=>{const f=[...fighters,...(r.mobs??[])].find((f:any)=>f.id===(e.by??e.id));return f&&e.at?{...e,at:{x:f.x,y:f.y}}:e;});
 p.mobs=(r.mobs??[]).map((f:any)=>({...f,dist:Math.hypot(f.x-own.x,f.y-own.y)}));
 p.projectiles=(r.projectiles??[]).map((pr:any)=>({...pr,t0:pr.t0Explicit??p.viewT-(pr.x-pr.x0)/pr.vx*1000}));
 return p;
}
export function cases(){
 const long=shot();const near=shot('near',{x:590});
 const mixed={fighters:[bow()],projectiles:[long]};
 const feint=[cue(),{kind:'cancel',id:'p1',t:950,at:{x:800,y:368}}];
 const cases=[
  seq('ball-positive-and-decision-duplicate',[step(1000,{projectiles:[long]}),step(1050,{projectiles:[{...long,x:319}]}),step(1600,{projectiles:[{...long,x:528}]})]),
  seq('ball-false-dice-is-remembered',[step(1000,{projectiles:[long]}),step(1050,{projectiles:[{...long,x:319}]})],{seed:7}),
  seq('real-observe-only-produces-step-not-new-incoming',[step(1000,{self:{x:600},projectiles:[shot('step-ball',{x:448})],observeOnly:true}),step(1050,{self:{x:600},projectiles:[shot('step-ball',{x:467})]})]),
  seq('new-incoming-uses-reaction-lead-and-is-too-late',[step(1000,{projectiles:[shot('reaction-ball',{x:467})]})]),
  seq('lag-reduces-effective-course-time',[step(1000,{lag:400,projectiles:[long]})]),
  seq('negative-lag-clamps-to-zero',[step(1000,{lag:-100,projectiles:[long]})]),
  seq('negative-lag-clamp-at-lead-boundary',[step(1000,{lag:-100,projectiles:[shot('negative-lag',{x:467})]})]),
  seq('speed-below-floor',[step(1000,{speed:.1,projectiles:[long]})]),
  seq('speed-at-floor',[step(1000,{speed:.3,projectiles:[long]})]),
  seq('positive-arrow-dodge',[step(1000,{projectiles:[shot('arrow',{kind:'arrow',x:100,vx:900,x0:60,range:900})]})]),
  seq('positive-offset-first-side-blocked',[step(1000,{projectiles:[shot('offset-plus',{y:358,y0:358})]})],{map:'plus'}),
  seq('negative-offset-first-side-blocked',[step(1000,{projectiles:[shot('offset-minus',{y:378,y0:378})]})],{map:'minus'}),
  seq('both-dodge-sides-blocked-remembers-yes',[step(1000,{projectiles:[long]}),step(1050,{projectiles:[{...long,x:319}]})],{map:'both'}),
  seq('public-hold-derived-lead-below-exact-above',[
   step(1000,{projectiles:[long]}),
   step(2000,{publicLeadBoundary:{epsilon:-0.000001},projectiles:[shot('lead-below',{vx:1000,x0:0,range:1000})]}),
   step(2050,{publicLeadBoundary:{epsilon:0},projectiles:[shot('lead-exact',{vx:1000,x0:0,range:1000})]}),
   step(2100,{publicLeadBoundary:{epsilon:0.000001},projectiles:[shot('lead-above',{vx:1000,x0:0,range:1000})]})]),
  seq('player-bow-positive',[step(1000,{fighters:[bow()]})]),
  seq('wand-cue-positive-while-current-hand-is-sword',[step(1000,{fighters:[actor()],events:[cue()]})]),
  seq('known-null-faction-bow-source-fallback',[step(1000,{fighters:[bow({faction:null})]})]),
  seq('mob-bow-positive',[step(1000,{mobs:[{...bow({id:'mob-a'}),kind:'mob',name:'declared mob'}]})]),
  seq('juke-first-side-blocked-uses-opposite',[step(1000,{fighters:[bow()]})],{map:'plus'}),
  seq('juke-both-sides-blocked-remembers-yes',[step(1000,{fighters:[bow()]}),step(1050,{fighters:[bow()]})],{map:'both'}),
  seq('normal-tier-positive-ball',[step(1000,{projectiles:[long]})],{tier:'normal'}),
  seq('normal-tier-positive-bow',[step(1000,{fighters:[bow()]})],{tier:'normal'}),
  seq('easy-tier-real-dodge-dice',[step(1000,{projectiles:[long]})],{tier:'easy'}),
  seq('easy-tier-has-no-juke-draw',[step(1000,{fighters:[bow()]})],{tier:'easy'}),
  seq('juke-false-dice-remembers-shot',[step(1000,{fighters:[bow()]}),step(1050,{fighters:[bow()]})],{seed:7}),
  seq('dodge-precedes-hold-and-juke-exact-public-hold-boundary',[
   step(1000,mixed),step(1050,{...mixed,projectiles:[shot('second-ball')]}),step(1100,{...mixed,projectiles:[shot('third-ball')]}),
   step({actualPublicHold:true,offset:-1},{fighters:[bow({drawStartedAt:1500})]}),step({actualPublicHold:true,offset:0},{fighters:[bow({drawStartedAt:1500})]})]),
  seq('players-then-mobs-then-wand-cue-order',[step(1000,{fighters:[bow(),actor('p2',{x:400,dist:200,facing:0})],mobs:[{...bow({id:'mob-a',x:600,y:568,facing:-Math.PI/2}),kind:'mob',name:'declared mob'}],events:[cue('p2',900,450,0)]})]),
  seq('projectile-reentry-new-memory-stimulus-retains-reflex-decision',[step(1000,{projectiles:[long]}),step(1600,{}),step(1700,{projectiles:[long]})]),
  seq('shot-collection-skips-dead-empty-undrawn-own-and-unseen',[step(1000,{fighters:[bow({id:'dead',status:'dead'}),bow({id:'empty',inHand:null}),bow({id:'undrawn',drawStartedAt:0}),actor()],events:[cue('p0'),cue('unseen'),{...cue(),weapon:'bow'},cue()]})]),
  seq('single48-order-includes-negative-projectile-and-shot-decisions',[
   step(1000,{fighters:[actor()],projectiles:Array.from({length:47},(_,i)=>({...near,id:'bulk-'+i})),events:[cue('p1',520,450)]}),
   step(1050,{projectiles:[{...long,id:'bulk-0'}]}),
   step(1100,{fighters:[actor('p2')],events:[cue('p2',620,450)]}),step(1150,{projectiles:[{...long,id:'bulk-0'}]})]),
  seq('window-1500-exact',[step(1000,{fighters:[actor()],events:[cue('p1',1000,1470)]})]),
  seq('window-1501-is-refused',[step(1000,{fighters:[actor()],events:[cue('p1',1000,1471)]})]),
  seq('due-equals-now-refused',[step(1000,{fighters:[actor()],events:[cue('p1',520,450)]})]),
  seq('due-one-ms-future-accepted',[step(1000,{fighters:[actor()],events:[cue('p1',521,450)]})]),
  seq('aim-range300-exact',[step(1000,{fighters:[actor('p1',{x:300,facing:0})],events:[cue('p1',900,450,0)]})]),
  seq('aim-range-over300',[step(1000,{fighters:[actor('p1',{x:299.999969482421875,facing:0})],events:[cue('p1',900,450,0)]})]),
  seq('aim-right-angle-excluded',[step(1000,{fighters:[actor()],events:[cue('p1',900,450,Math.PI/2)]})]),
  seq('aim-right-angle-near-excluded',[step(1000,{fighters:[actor('p1',{x:600,y:328,facing:0})],events:[cue('p1',900,450,0)]})]),
  seq('aim-lateral60-nominal-binary64-outside',[step(1000,{fighters:[actor('p1',{x:400,y:308,facing:0})],events:[cue('p1',900,450,0)]})]),
  seq('aim-lateral60-exact-3-4-5',[step(1000,{fighters:[actor('p1',{x:520,y:308,facing:0})],events:[cue('p1',900,450,0)]})]),
  seq('aim-lateral-below60',[step(1000,{fighters:[actor('p1',{x:400,y:308.000030517578125,facing:0})],events:[cue('p1',900,450,0)]})]),
  seq('aim-lateral-over60',[step(1000,{fighters:[actor('p1',{x:400,y:307.999969482421875,facing:0})],events:[cue('p1',900,450,0)]})]),
  seq('aim-under1-bypasses-facing',[step(1000,{fighters:[actor('p1',{x:600.5,facing:0})],events:[cue('p1',900,450,0)]})]),
 ];
 for(const seed of [0,1,2,3,7,42])cases.push(seq('real-feint-memory-seed-'+seed,[step(1000,{fighters:[actor()],events:feint})],{seed}));
 return cases;
}
