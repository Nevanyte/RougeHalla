/** Read-only original lexical WeakMap.get access, debugger disconnected before every ordinary trace. */
import{inspectClosure}from'./private-inspection.mts';import{createWorld}from'../../packages/server/src/sim/world.ts';import*as S from'@raid/shared';
const getters:Record<string,Function>={};let prepared=false;
export async function prepareInspection(){if(prepared)return;for(const[name,expression]of Object.entries({
 cardHooks:'(world)=>({pending:pending.get(world),bleeds:bleeds.get(world)})',
 mods:'(world)=>({actors:[...world.state.players,...world.state.mobs].map(([id,s])=>({id,cache:caches.get(s),flatMaxHp:flatMaxHp.get(s),extraRows:extraRows.get(s)})),withSources:withSources.get(world),conditional:conditional.get(world),campUsers:campUsers.get(world),fightWatch:fightWatch.get(world),fightClocks:fightClocks.get(world)})',
 chests:'(world)=>({elitePickers:elitePickers.get(world)})',loot:'(world)=>({bornAt:bornAt.get(world),statCrates:statCrates.get(world)})'})){
 const{install}=await import('../../packages/server/src/sim/'+name+'.ts');const inspect=await inspectClosure(install,name,expression);const w=createWorld({map:S.mapFromTiles(8,8,new Uint8Array(64)),config:{minPlayers:2,lobbySeconds:30,fillSeconds:0,patienceSeconds:3600,patienceMinSeconds:3600,suddenDeathSeconds:60},random:S.mulberry32(0),rewardSalt:[1,2,3,4],questSalt:[5,6,7,8],newItemUid:()=> 'inspection-only'});install(w);getters[name]=inspect.capture();await inspect.close();}prepared=true;}
export function oracle(w:any){return Object.fromEntries(Object.entries(getters).map(([name,get])=>[name,get(w)]));}
