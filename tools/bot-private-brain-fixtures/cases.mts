import {shared} from './runtime.mts';
import {N,ME,at,percept,fighter,mob,event,hit,wish,chest,planEvent,container,dot,MAPS,campView} from './builders.mts';
const frame=(budget='a')=>({method:'frame',budget});
const tick=(now=N,scene:any={},brain='a',env:any={})=>({method:'tick',brain,input:percept(now,scene),env});
const step=(kind:string,extra:any={})=>({kind,priority:0,timing:{kind:'current'},why:'extension '+kind,...extra});
const offered=(goal:any,choice?:string)=>({goal,utility:10,why:'declared caller candidate',...(choice?{choice}:{})});
const idleOffer=[offered({kind:'idle'})];
const extension=(extra:any={})=>({id:'extension',enabled:true,hooks:['enabled','observe','goals','intents','adjust'],goals:idleOffer,...extra});
export function cases() {
 const out:any[]=[];
 const add=(id:string,family:string,covers:string[],operations:any[],configs:any={a:{}},modules:any={},brains?:any)=>out.push({id,family,covers,configs,modules,operations,...(brains?{brains}:{})});
 const ticks=(scenes:any[])=>scenes.flatMap(([t,s={},env={}])=>[frame(),tick(t,s,'a',env)]);
 const noFeatures={wishes:false,planning:false,chests:false,hazards:false,camps:false};
 add('core-registry-cadence','core',['actual registry order/cadence/salient/toast/dead/nonactive/end'],ticks([
 [N,{}],[N+1,{}],[N+150,{}],[N+1200,{}],[N+1500,{events:[event('heal',N+1500,{id:'me',amount:1})]}],
 [N+1550,{events:[event('toast',N+1550,{text:'Too far away'})]}],[N+1600,{events:[event('teleport',N+1590)]}],
 [N+1700,{self:{status:'dead',hp:0}}],[N+1800,{hud:{phase:'ended'}}],[N+1900,{hud:{phase:'lobby'},self:{status:'lobby'}}],
 [N+2000,{}],
 ]).concat([{method:'goal'},{method:'stats'},{method:'end',input:null}]),{a:{modules:'registry'}});
 add('core-nonempty-no-features','core',['observer plus actual disabled built-ins not empty cfg.modules'],ticks([[N,{}],[N+3000,{}]]),{a:{features:noFeatures}});
 add('core-empty-modules','core',['truly empty module list bcfg===cfg; no context/RNG/Memory exposure'],ticks([[N,{}],[N+3000,{}],[N+6000,{self:{faction:null}}]]).concat([{method:'end',input:null}]),{a:{modules:[],features:noFeatures}});
 add('path-clock-trade-boundary','memory',['retained live lastHitAt before later Memory.observe','trade inclusive boundary','lock alone not engaged'],ticks([
 [N,{}],[N+1,{self:{attackTarget:'foe'},fighters:[fighter('foe',600)]}],
 [N+2,{events:[hit(N+2)]}],[N+2002,{}],[N+3002,{}],[N+3002.001,{}],[N+7000,{self:{attackTarget:'foe'}}],
 ]));
 add('core-fight-hunt-flee','combat',['natural hunt→fight/trade→flee/remembered continuation and exported stats'],ticks([
 [N,{fighters:[fighter('foe',600,{hpFrac:.1})],hud:{patienceEndsAt:N+10000}}],
 [N+1500,{self:{attackTarget:null},fighters:[fighter('foe',20,{hpFrac:.1})],events:[hit(N+1500)]}],
 [N+1800,{self:{attackTarget:'foe'},fighters:[fighter('foe',20,{hpFrac:.1})]}],
 [N+1900,{self:{attackTarget:'foe'},fighters:[fighter('foe',20,{hpFrac:.1})]}],
 [N+5001,{self:{attackTarget:'foe'},fighters:[fighter('foe',20,{hpFrac:.1})]}],
 [N+6000,{self:{hp:10,attackTarget:'foe'},fighters:[fighter('foe',120)],events:[hit(N+6000)]}],
 [N+8000,{self:{hp:30},fighters:[fighter('foe',250)]}],[N+10000,{}],[N+13000,{fighters:[fighter('foe',500,{status:'dead'})],events:[event('death',N+12990,{id:'foe',name:'Foe',by:'me',mob:false})]}],
 ]),{a:{persona:'hunter',modules:'registry',seed:42}});
 add('core-farm-route','farm',['real generated map/route/camp ownership/farm/drop/retreat counters'],ticks([
 [N,{mobs:[mob('meal',100)],minimap:{mobs:[dot('meal')]},extras:{camps:MAPS.generated7.camps.map((c:any,i:number)=>campView(c,i))}}],
 [N+1000,{mobs:[mob('meal',80,{hpFrac:.8})],minimap:{mobs:[dot('meal',80)]},self:{attackTarget:'meal'}}],
 [N+1500,{mobs:[mob('meal',80,{hpFrac:.5})],minimap:{mobs:[dot('meal',80)]},events:[hit(N+1490,'me',{id:'meal'})]}],
 [N+2000,{mobs:[mob('meal',80,{status:'dead',hpFrac:0})],self:{mobKills:1},events:[event('death',N+2000,{id:'meal',name:'Meal',by:'me',mob:true})]}],
 [N+3000,{self:{hp:20},mobs:[mob('other',100)],events:[hit(N+2990,'other')]}],
 [N+7000,{self:{power:6,mobKills:12},extras:{camps:MAPS.generated7.camps.map((c:any,i:number)=>campView(c,i,{state:2,alive:0,respawnAt:N+90000}))}}],
 ]),{a:{map:'generated7',persona:'farmer',seed:1,tierOverrides:{softmaxT:0,lapseP:0}}});
 add('core-hunt-drop-retreat','farm',['real hunt retained engagement/awake retreat/exported drops, retreats and focus'],ticks([
 [N,{mobs:[mob('meal',160)],minimap:{mobs:[dot('meal',160)]}}],
 [N+1500,{self:{hp:20,attackTarget:'meal'},mobs:[mob('meal',20,{hpFrac:.8})],minimap:{mobs:[dot('meal',20)]},events:[hit(N+1490,'meal')]}],
 [N+3000,{self:{hp:20},mobs:[mob('meal',20,{hpFrac:.8})],minimap:{mobs:[dot('meal',20)]}}],
 ...[45000,48000,51000,54000,57000,60000].map(dt=>[N+dt,{mobs:[mob('fresh',20)],minimap:{mobs:[dot('fresh',20)]}}]),
 ]),{a:{persona:'farmer',tierOverrides:{softmaxT:0,lapseP:0}}});
 add('core-loot-grab-window','loot',['actual Loot, later inventory feedback at inclusive2000 and beyond'],ticks([
 [N,{containers:[container('bow',100)]}],[N+100,{containers:[container('bow',20)]}],
 [N+300,{containers:[container('bow',20)]}],[N+600,{containers:[container('bow',20)]}],
 [N+700,{containers:[],events:[event('toast',N+700,{text:'Nothing there'})]}],[N+701,{containers:[]}],[N+702,{containers:[]}],
 [N+2701,{self:{weapons:['sword','bow']},containers:[]}],[N+2800,{self:{weapons:['sword',null]}}],
 [N+4801,{self:{weapons:['sword','axe']}}],[N+5000,{events:[event('toast',N+5000,{text:'Nothing there'})]}],
 ]),{a:{persona:'opportunist',tierOverrides:{softmaxT:0,lapseP:0}}});
 add('core-planning','planning',['actual event clock/read/plan menu/release on nonalive planning/learned callbacks'],ticks([
 [N,{hud:{phase:'planning'},self:{status:'lobby'},events:[planEvent(N-500,{pick:0})]}],
 [N+3000,{hud:{phase:'planning'},self:{status:'lobby'}}],[N+5000,{hud:{phase:'planning'},self:{status:'dead'}}],
 [N+6000,{hud:{phase:'planning'},self:{status:'lobby'},events:[planEvent(N+5500,{pick:0,boon:1})]}],
 [N+9000,{hud:{phase:'planning'},self:{status:'lobby'}}],[N+11000,{hud:{phase:'planning'},self:{status:'lobby'}}],[N+12000,{}],
 ]),{a:{modules:'registry',learned:{enabled:true,entries:[['boon|fire|vigor',-.5],['boon|fire|haste',.5]]}}});
 add('core-chest','chests',['actual chest Module goal/act/panel/choice/owner-readable continuation'],ticks([
 [N,{extras:{chests:[chest('box',500)]}}],[N+400,{extras:{chests:[chest('box',400)]}}],
 [N+1200,{extras:{chests:[chest('box',40,{options:['ad1','ap1'],takenBy:['','']})]}}],
 [N+1800,{extras:{chests:[chest('box',40,{options:['ad1','ap1'],takenBy:['','']})]}}],
 [N+2500,{extras:{chests:[chest('box',40,{options:['ad1','ap1'],takenBy:['me',''],picked:true})]}}],
 [N+4000,{self:{build:{ad1:1}},extras:{chests:[]}}],
 ]),{a:{modules:'registry',tierOverrides:{softmaxT:0,lapseP:0}}});
 add('core-wish-slip','wishes',['real Wish cast release earns Memory.lastCast then slip Module continuation'],ticks([
 [N,{self:{hp:25},fighters:[fighter('foe',100)],extras:{wish:wish()}}],
 [N+300,{self:{hp:25},fighters:[fighter('foe',100)],extras:{wish:wish()}}],
 [N+600,{self:{hp:25},fighters:[fighter('foe',100)],extras:{wish:wish('swarm',{casting:true})}}],
 [N+1200,{self:{hp:25},fighters:[fighter('foe',-100)],extras:{wish:wish('swarm',{casting:true}),effects:{me:shared.EFFECT_HIDDEN}}}],
 [N+2400,{self:{hp:25},fighters:[fighter('foe',-100)],extras:{wish:wish('swarm',{casting:true}),effects:{me:shared.EFFECT_HIDDEN}}}],
 [N+6000,{extras:{wish:wish('swarm',{readyAt:N+10000})}}],
 ]),{a:{modules:'registry'}});
 add('core-hazards','hazards',['real hazard extras+adjust over ordinary tactics/gates/light'],ticks([
 [N,{self:{faction:'holy'}}],[N+250,{self:{faction:'holy'}}],[N+600,{self:{faction:'holy'}}],
 [N+1600,{self:{faction:'holy',...at(-100)},hud:{gatesLocked:true}}],[N+2000,{self:{faction:'holy'}}],
 ]),{a:{map:'ember',modules:'registry'}});
 add('core-coliseum','core',['genuine Hold/roam/sudden death paths'],ticks([
 [N,{hud:{inColiseum:true},events:[event('teleport',N)]}],
 [N+3000,{hud:{inColiseum:true},fighters:[fighter('foe',500)]}],
 [N+50000,{hud:{inColiseum:true,suddenDeathAt:N+50000},fighters:[fighter('foe',500,{hpFrac:.1})]}],
 [N+55000,{hud:{patienceEndsAt:N+55000}}],
 ]),{a:{map:'generated7'}});
 add('core-empty-route-test','error-boundary',['labelled exact admitted argument-sensitive radius0 empty-route test service; actual JS throw and pre-error effects, not normal real paths'],ticks([
 [N,{self:{x:1000,y:760},containers:[container('box',600,{x:1600,y:760,dist:600})]}],
 [N+1,{self:{x:1000,y:760},containers:[container('box',600,{x:1600,y:760,dist:600})]}],
 ]),{a:{modules:['observer','x'],path:{kind:'tactics-empty-route-test',radius:0},tierOverrides:{softmaxT:0,lapseP:0}}},{x:extension({goals:[offered({kind:'loot',container:'box'})]})});
 const extCfg={modules:['observer','x'],features:noFeatures,tierOverrides:{softmaxT:0,lapseP:0}};
 add('caller-idle-first-act','caller-only',['ordinary Idle candidate real Strategy first-act despite unchanged key; no adopt log'],ticks([[N,{}],[N+1,{}],[N+3000,{}]]),{a:extCfg},{x:extension()});
 const mg=(data:any,module='extension')=>({kind:'module',module,data});
 add('caller-module-keys','caller-only',['ordered JSON Module data/number semantics/choice gate/bypass/missing-act/nonrunning retry'],ticks([
 [N,{mobs:[mob('caller-meal',100)],minimap:{mobs:[dot('caller-meal',100)]}}, {modules:{x:{goals:[offered(mg({a:1,b:2}),'second|fire|bow')]}}}],
 [N+1500,{}, {modules:{x:{goals:[offered(mg({a:1,b:2}),'ignored|same')]}}}],
 [N+3000,{}, {modules:{x:{goals:[offered(mg({b:2,a:1}),'opener|fire|holy')],output:{intents:[],status:{state:'done',why:'declared done'},attacking:true}}}}],
 [N+3100,{}, {modules:{x:{goals:[offered(mg({n:-0,u:undefined,z:null,v:1e21}))]}}}],
 [N+5000,{}, {modules:{x:{goals:[offered(mg({n:0,u:undefined,z:null,v:1e21}))]}}}],
 [N+7000,{}, {modules:{x:{goals:[offered(mg({x:1},'absent'))]}}}],
 [N+7100,{}, {modules:{x:{goals:[offered(mg({x:2},'absent'))]}}}],
 ]).concat([{method:'end',input:null}]),{a:extCfg},{x:extension({hooks:['enabled','observe','goals','intents','adjust','act']})});
 add('caller-ordinary-keys','caller-only',['real Strategy coarse Roam/hold reason/Flee renewal adopted values without duplicate key counts'],ticks([
 [N,{}, {modules:{x:{goals:[offered({kind:'roam',to:at(100),why:'explore'},'roam|one')]}}}],
 [N+1500,{}, {modules:{x:{goals:[offered({kind:'roam',to:at(110),why:'explore'},'roam|two')]}}}],
 [N+3000,{}, {modules:{x:{goals:[offered({kind:'hold',at:at(40),why:'ambush'},'hold|one')]}}}],
 [N+4500,{}, {modules:{x:{goals:[offered({kind:'hold',at:at(80),why:'ambush'},'hold|two')]}}}],
 [N+6000,{}, {modules:{x:{goals:[offered({kind:'flee',from:[at(100)],until:N+8000},'flee|one')]}}}],
 [N+7500,{}, {modules:{x:{goals:[offered({kind:'flee',from:[at(110)],until:N+9500},'flee|two')]}}}],
 ]),{a:extCfg},{x:extension()});
 add('caller-merge-adjust','caller-only',['reject low extra then accept better/first accepted order claim/menu cast insert/adjust evolving identities'],ticks([
 [N,{}],[N+3000,{}],
 ]),{a:{...extCfg,modules:['observer','x','y','z']}},{
 x:extension({intents:[step('move',{priority:3,to:at(200),why:'low rejected'}),step('move',{priority:0,to:at(300),why:'winner'}),step('move',{priority:-1,to:at(400),why:'claimed ignored'}),step('cast',{slot:'wish',...at(80)}),step('plan',{msg:{ready:true}})]}),
 y:{id:'second',enabled:true,hooks:['enabled','intents','adjust'],intents:[step('stop',{priority:-2})],adjust:{kind:'append-if-why',why:'winner',intents:[step('swap',{slot:1,timing:{kind:'timed',due:N}})]}},
 z:{id:'third',enabled:true,hooks:['enabled','adjust'],adjust:{kind:'append-if-why',why:'extension swap',intents:[step('pickup',{container:'missing',timing:{kind:'timed',due:N}})]}},
 });
 for(const hook of ['enabled','observe','goals','intents','adjust','act']) {
  const isAct=hook==='act';
  const mod=extension({hooks:['enabled','observe','goals','intents','adjust',...(isAct?['act']:[])],throws:[{hook,index:0},...(hook==='observe'?[{hook:'intents',index:0}]:[])],...(isAct?{goals:[offered(mg({n:1}))]}:{}),intents:[step('stop')]});
  // An observe fault leaves this tick's selected wrapper callable in intents/adjust, despite Strategy's repeated enabled rejecting it.
  add('guard-'+hook,'guard',['actual '+hook+' throw/fallback/later tick disable/same-tick selected wrapper'],ticks([[N,{}],[N+3000,{}],[N+6000,{}]]),{a:extCfg},{x:mod});
 }
 add('guard-equal-id','guard',['distinct objects equal id share per-Brain fault marker; same tick later selected hook'],ticks([[N,{}],[N+3000,{}]]),{a:{...extCfg,modules:['observer','x','y']}},{x:extension({throws:[{hook:'observe',index:0}]}),y:extension({intents:[step('stop')]})});
 add('caller-wand-miss-alive-dead','memory',['actual hand wand miss/alive append after observed stimuli/dead drain discarded'],ticks([
 [N,{self:{weapons:['wand',null]}}],
 [N+500,{self:{weapons:['wand',null]},events:[hit(N+500)]}],
 [N+1000,{self:{weapons:['wand',null],status:'dead',hp:0}}],
 [N+1500,{self:{weapons:['wand',null]}}],[N+2000,{self:{weapons:['wand',null]}}],
 ]),{a:extCfg},{x:extension({intents:[step('lock',{target:'not-on-screen',at:at(200)})]})});
 add('caller-feature-empty','hand',['full Brain actual empty messageTypes rejects before motor/lapse draws and retains no pending commands'],ticks([[N,{}],[N+3000,{}],[N+6000,{}]]),{a:{...extCfg,features:{...noFeatures,messageTypes:[]}}},{x:extension({intents:[step('move',{to:at(200)}),step('cast',{slot:'wish',...at(80)}),step('plan',{msg:{ready:true}})]})});
 add('caller-nonactive-release','hand',['real pending submit active then release alive lobby/planning; dead flush clear'],ticks([
 [N,{}],[N+500,{hud:{phase:'lobby'}}],[N+600,{hud:{phase:'planning'},self:{status:'dead'}}],
 [N+1200,{}],[N+1300,{self:{status:'dead'}}],[N+2000,{hud:{phase:'ended'}}],[N+3000,{}],
 ]),{a:extCfg},{x:extension({intents:[{kind:'move',to:at(250),priority:0,timing:{kind:'step'},why:'delayed real hand'}]})});
 add('caller-stall-grab-end','lifetime',['stall600/movement below1 and at1/busy old Module attacking/reset/dead','end null/provided/fresh choices/no termination'],ticks([
 [N,{}],[N+600,{}],[N+601,{}],[N+1000,{self:at(.999)}],[N+1400,{self:at(1.999)}],
 [N+2001,{}],[N+2500,{self:{drawStartedAt:1}}],[N+3101,{}],[N+4000,{hud:{suddenDeathAt:N+4000}}],[N+5000,{self:{status:'dead'}}],[N+6000,{}],
 ]).concat([{method:'end',input:null,save:'before'},{method:'end',input:{outcome:'won',place:1,players:6},save:'provided'},frame(),tick(N+9000,{self:{faction:'holy'}},'a',{modules:{x:{goals:[offered({kind:'hold',at:ME,why:'ambush'},'new|choice')]}}}),{method:'end',input:null},{method:'savedSummary',key:'before'}]),{a:extCfg},{x:extension()});
 const seqOps:any[]=[];
 for(let i=0;i<260;i++)seqOps.push(frame(),tick(N+i*2000,{self:{moveSeq:i%255}},'a',{modules:{x:{goals:idleOffer,intents:[step(i%2?'stop':'move',i%2?{}:{to:at(200+i)}) ,...(i%40===0?[step('swap',{slot:1})]:[])]}}}));
 seqOps.push({method:'end',input:null},frame(),tick(N+522000,{},'a',{modules:{x:{goals:idleOffer,intents:[]}}}),{method:'end',input:null});
 add('caller-sequence255','sequence',['260 actual alternating hand Move/Stop releases stamp1..255→1; nonorder interleaved/noteSent later real Memory'],seqOps,{a:{...extCfg,tierOverrides:{softmaxT:0,lapseP:0,timingSigmaMs:0}}},{x:extension()});
 const inter:any[]=[];
 for(const t of [N,N+500,N+1500])inter.push(frame('room'),tick(t,{extras:{chests:[chest('box',300)]}},'a'),tick(t,{extras:{chests:[chest('box',300)]}},'b'),tick(t,{extras:{chests:[chest('box',300)]}},'c'));
 inter.push({method:'recreate',cfg:'same',brain:'b'},frame('room'),tick(N+2000,{extras:{chests:[chest('box',40,{options:['ad1'],takenBy:['']})]}},'a'),tick(N+2000,{extras:{chests:[chest('box',40,{options:['ad1'],takenBy:['']})]}},'b'));
 add('identity-shared-budget','identity',['same original cfg two Brains fresh bcfg/WeakMap isolation; equal configs separate services/cache; one shared allowance per frame/recreation'],inter,{same:{budget:'room',pathBudget:1,modules:'registry'},equal:{budget:'room',pathBudget:1,modules:'registry'}},{},{a:'same',b:'same',c:'equal'});
 return out;
}
