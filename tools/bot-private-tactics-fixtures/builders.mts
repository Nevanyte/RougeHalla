import {shared,mapgen} from './runtime.mts';
export const NOW=100000, ME={x:1000,y:760};
export const at=(x=0,y=0)=>({x:ME.x+x,y:ME.y+y});
export function arena(kind='open') {
 const w=96,h=80,tiles=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(!x||!y||x===w-1||y===h-1||((kind==='wall'||kind==='detour'&&y>=5&&y<=65)&&x===40)||(kind==='fence'&&x===32))tiles[y*w+x]=kind==='fence'&&x===32?shared.TILE_LOW:1;
 return shared.mapFromTiles(w,h,tiles);
}
export const MAPS:any={open:arena(),wall:arena('wall'),fence:arena('fence'),detour:arena('detour'),generated7:mapgen.generateMap(7,undefined,{decor:false})};
export const self=(o:any={})=>({id:'me',name:'Me',...ME,facing:0,status:'alive',hp:100,maxHp:100,barrier:0,faction:'fire',weapons:['sword',null],slot:0,attackTarget:null,drawStartedAt:0,readyAt:0,immuneUntil:0,sig:0,brand:0,power:0,asMult:1,windupMult:1,speedMult:1,kills:0,mobKills:0,gv:0,bounty:0,moveSeq:0,...o});
export const fighter=(id='foe',dx=100,o:any={})=>({id,name:id,bot:false,...at(dx),facing:Math.PI,status:'alive',hpFrac:1,barrierFrac:0,faction:'frost',inHand:'sword',drawStartedAt:0,bounty:0,immune:false,sig:0,brand:0,targetable:true,vx:0,vy:0,dist:Math.abs(dx),los:true,tint:0,central:true,...o});
export const mob=(id='mob1',dx=100,o:any={})=>({id,kind:'mob',name:'Pardoner',type:'pardoner',faction:'sentenced',...at(dx),facing:Math.PI,status:'alive',hpFrac:1,inHand:'shield',drawStartedAt:0,sig:0,brand:0,vx:0,vy:0,dist:Math.abs(dx),los:true,central:true,...o});
export const container=(id='box',dx=20,o:any={})=>({id,kind:'ground',...at(dx),label:'',closed:true,weapon:'bow',interactable:true,dist:Math.abs(dx),...o});
export const projectile=(o:any={})=>({id:'ball',kind:'ball',...at(270),vx:-300,vy:0,x0:ME.x+300,y0:ME.y,t0:NOW,range:600,from:'foe',...o});
export const event=(kind:string,t=NOW,o:any={})=>({kind,t,at:null,...o});
export const features=()=>({messageTypes:['move','stop','target','attack','release','swap','pickup','cast','plan','choose','useConsumable'],wishes:true,statusEffects:true,fields:true,planning:true,chests:true,skills:true,relics:false,camps:true,hazards:true});
export const percept=(now=NOW,o:any={})=>({now,viewT:o.viewT??now-30,self:self(o.self),hud:{phase:'active',training:false,lobbyEndsAt:0,raidStartedAt:0,patienceEndsAt:900000,suddenDeathAt:0,inColiseum:false,gatesLocked:false,startedWith:6,alive:6,playerCount:6,minPlayers:2,winner:'',...o.hud},fighters:o.fighters??[],mobs:o.mobs??[],containers:o.containers??[],projectiles:o.projectiles??[],minimap:{t:now,mobs:[],gatesLocked:false,...o.minimap},events:o.events??[],extras:o.extras??{},features:features()});
export const observe=(now=NOW,o:any={})=>({method:'observe',input:percept(now,o)});
export const act=(goal:any,extra:any={})=>({method:'act',goal,...extra});
export const tick=(now:number,scene:any,goal:any,extra:any={})=>[observe(now,scene),act(goal,extra)];
export const fightGoal={kind:'fight',target:'foe'}, farm={kind:'farm',mob:'mob1',camp:null}, hunt={kind:'hunt',target:'foe'}, loot={kind:'loot',container:'box'};
export const sent=(at:number,type:string,msg:any={})=>({method:'noteSent',input:{at,cmd:{type,msg},intent:type==='target'?'lock':type,priority:2,stimulus:null}});
