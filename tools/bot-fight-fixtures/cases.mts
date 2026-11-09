// Declared public component inputs, never installed World outcomes or private tactic state.
export const features = {
  wishes:false,statusEffects:true,fields:false,planning:false,chests:false,skills:false,relics:false,camps:false,hazards:false,messageTypes:[],
};
export function maps() {
  const w=32,h=24;
  const base=()=>Array.from({length:w*h},(_,i)=>i%w===0||i%w===w-1||i<w||i>=w*(h-1)?1:0);
  const open=base(), wall=base(), closed=base(), fence=base(), corner=Array(w*h).fill(1);
  for(let y=1;y<h-1;y++){closed[y*w+16]=1;if(y!==17&&y!==18)wall[y*w+16]=1;fence[y*w+16]=2;}
  corner[12*w+12]=0;
  return {open:{w,h,tiles:open},wall:{w,h,tiles:wall},closed:{w,h,tiles:closed},fence:{w,h,tiles:fence},corner:{w,h,tiles:corner}};
}
export const frame=(now:number,fields:any={})=>({now,viewT:now,
  self:{id:'p0',name:'declared owner',x:400,y:360,facing:0,status:'alive',hp:950,maxHp:950,barrier:0,faction:'fire',
    weapons:['sword',null],slot:0,attackTarget:null,drawStartedAt:0,readyAt:0,immuneUntil:0,sig:0,brand:0,power:0,
    asMult:1,windupMult:1,speedMult:1,kills:0,mobKills:0,gv:0,bounty:0,moveSeq:0,...fields.self},
  hud:{phase:'active',training:false,lobbyEndsAt:0,raidStartedAt:0,patienceEndsAt:0,suddenDeathAt:0,inColiseum:false,
    gatesLocked:false,startedWith:2,alive:2,playerCount:2,minPlayers:2,winner:'',...fields.hud},
  fighters:fields.fighters??[],mobs:[],containers:[],projectiles:[],minimap:{t:0,mobs:[],gatesLocked:false},events:[],extras:{},features});
export const fighter=(v:any={})=>({id:'p1',name:'declared foe',bot:false,x:440,y:360,facing:Math.PI,status:'alive',hpFrac:1,
  barrierFrac:0,faction:'holy',inHand:'sword',drawStartedAt:0,bounty:0,immune:false,sig:0,brand:0,targetable:true,
  vx:0,vy:0,dist:40,los:true,tint:0,central:true,...v});
export function fightCases(timing:any) {
  const goal={kind:'fight',target:'p1'};
  const normal=(name:string,rows:any[],extra:any={})=>({name,kind:'tactics',map:'open',seed:7,tier:'normal',persona:'cautious',rows:rows.map(p=>({percept:p,goal})),...extra});
  const far=(now:number,x=700)=>frame(now,{fighters:[fighter({x,dist:x-400})]});
  const bow=timing(frame(0).self,'bow'), wand=timing(frame(0).self,'wand');
  const start=100;
  return [
    normal('arm-other-slot',[frame(100,{self:{weapons:[null,'wand']},fighters:[fighter()]}),frame(150,{self:{weapons:[null,'wand'],slot:1},fighters:[fighter()]})]),
    normal('both-slots-empty-is-source-fists',[frame(100,{self:{weapons:[null,null]},fighters:[fighter()]})]),
    normal('no-faction-is-not-empty-kit',[frame(100,{self:{faction:null,weapons:[null,null]},fighters:[fighter()]})]),
    normal('wand-locked-no-reclick',[frame(100,{self:{weapons:['wand',null],attackTarget:'p1'},fighters:[fighter()]}),frame(150,{self:{weapons:['wand',null],attackTarget:'p1'},fighters:[fighter()]})]),
    normal('bow-and-melee-aimed-intents',[frame(100,{self:{weapons:['bow',null]},fighters:[fighter()]}),frame(150,{fighters:[fighter()]})]),
    normal('approach-resend-and-progress-timeout',[100,500,801,1700,3500,6500,9500,10100,10101].map(t=>far(t))),
    normal('path-replan-gap-and-waypoint',[frame(100,{fighters:[fighter({x:700,dist:300,los:false})]}),frame(200,{fighters:[fighter({x:700,dist:300,los:false})]}),frame(501,{fighters:[fighter({x:700,dist:300,los:false})]})],{map:'wall'}),
    normal('no-path-third-plan-fails',[100,501,902].map(t=>frame(t,{fighters:[fighter({x:700,dist:300,los:false})]})),{map:'closed'}),
    normal('melee-reach-is-not-sight',[frame(100,{self:{x:500},fighters:[fighter({x:524,dist:24,los:true})]}),frame(150,{self:{x:500,weapons:['bow',null]},fighters:[fighter({x:524,dist:24,los:true})]})],{map:'fence'}),
    normal('swap-cooldown-and-draw-guard',[frame(100,{self:{weapons:['bow','wand'],drawStartedAt:20},fighters:[fighter({inHand:'shield'})]}),frame(150,{self:{weapons:['bow','wand']},fighters:[fighter({inHand:'shield'})]}),frame(500,{self:{weapons:['bow','wand']},fighters:[fighter({inHand:'shield'})]}),frame(5000,{self:{weapons:['bow','wand']},fighters:[fighter({inHand:'shield'})]})],{tier:'hard',seed:0}),
    normal('target-down-and-unknown',[frame(100,{fighters:[fighter()]}),frame(150,{fighters:[fighter({status:'dead',hpFrac:0})]})]),
    normal('unknown-target-is-source-done',[frame(100)],{rows:[{percept:frame(100),goal:{kind:'fight',target:'never-seen'}}]}),
    normal('world-to-fight-one-time-knowledge',[frame(100),frame(150,{fighters:[fighter()]}),frame(200,{fighters:[fighter()]})],{rows:[{percept:frame(100),goal:{kind:'idle'}},{percept:frame(150,{fighters:[fighter()]}),goal},{percept:frame(200,{fighters:[fighter()]}),goal}]}),
    normal('fight-orb-engagement-chance-jitter-and-gap',[
      frame(start,{self:{weapons:['bow',null],attackTarget:'p1'},fighters:[fighter()]}),
      frame(start+bow.windupMs-1,{self:{weapons:['bow',null],attackTarget:'p1',readyAt:start+bow.intervalMs},fighters:[fighter()]}),
      frame(start+bow.windupMs,{self:{weapons:['bow',null],attackTarget:'p1',readyAt:start+bow.intervalMs,drawStartedAt:start},fighters:[fighter()]}),
      frame(start+bow.windupMs+1,{self:{weapons:['bow',null],attackTarget:'p1',readyAt:start+bow.intervalMs},fighters:[fighter()]}),
      frame(start+bow.windupMs+51,{self:{weapons:['bow',null],attackTarget:null,readyAt:start+bow.intervalMs},fighters:[fighter()]}),
      frame(start+bow.intervalMs,{self:{weapons:['bow',null],attackTarget:'p1',readyAt:start+bow.intervalMs},fighters:[fighter()]}),
      frame(start+bow.intervalMs+4101,{self:{weapons:['bow',null],attackTarget:'p1',readyAt:start+bow.intervalMs},fighters:[fighter()]})
    ],{tier:'hard',seed:0}),
    normal('wand-windup-swap-guard',[frame(100,{self:{weapons:['wand','axe'],attackTarget:'p1',readyAt:100+wand.intervalMs},fighters:[fighter({inHand:'wand'})]}),frame(100+wand.windupMs+1,{self:{weapons:['wand','axe'],attackTarget:'p1',readyAt:100+wand.intervalMs},fighters:[fighter({inHand:'wand'})]})],{tier:'hard',seed:0})
  ];
}
export function orbCases(timing:any) {
  const me=frame(0,{self:{weapons:['bow',null]}}).self,t=timing(me,'bow'),r=t.intervalMs,w=t.windupMs;
  const row=(now:number,readyAt:number,locked=true,drawStartedAt=0)=>({percept:frame(now,{self:{...me,readyAt,drawStartedAt,attackTarget:locked?'p1':null},fighters:[fighter()]}),locked,weapon:'bow',foe:{id:'p1',x:440,y:360}});
  return [
    {name:'launch-draw-away-wait-relock',map:'open',reset:0,rows:[row(1,0),row(w-1,r),row(w,r,true,100),row(w+1,r),row(w+51,r),row(w+101,r,false),row(r-80,r,false),row(r,r)]},
    {name:'small-ready-jump-is-not-shot',map:'open',reset:0,rows:[row(1,r*.5),row(w+1,r*.5),row(r*.5+w+1,r*1.5)]},
    {name:'no-cooldown-left',map:'open',reset:0,rows:[row(r-100,r)]},
    {name:'lost-move-900-boundary',map:'open',reset:0,rows:[row(w+1,r),row(w+901,r),row(w+902,r)]},
    {name:'away-abandoned-3000-boundary',map:'open',reset:0,rows:[row(w+1,r),row(w+51,r,false),row(w+3001,r,false),row(w+3002,r,false)]},
    {name:'cornered-no-away-point',map:'corner',reset:0,rows:[{...row(w+1,r),percept:frame(w+1,{self:{...me,x:400,y:400,readyAt:r,attackTarget:'p1'},fighters:[fighter({x:440,y:400})]})}]}
  ].map(c=>({...c,seed:7,tier:'hard',persona:'cautious'}));
}
