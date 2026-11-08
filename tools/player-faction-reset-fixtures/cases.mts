/** All inputs are actual actor proposals, declared existing-player setup or named source helper probes. */
const I=(actor:string,type:string,payload:any={})=>({actor,type,payload});
const step=(...inputs:any[])=>({kind:'step',inputs});const span=(count:number)=>({kind:'span',count,snapshots:[1,count]});
export const cases=['holy','fire','plague','frost','sentenced'].map(faction=>{
 const players:any[]=[{faction,at:{x:300,y:320},hp:500,weapon:faction==='frost'?'bow':'sword'},{faction:'holy',at:{x:faction==='frost'?500:332,y:320},hp:10000},{faction:'fire',at:{x:1100,y:600}}];
 if(faction==='sentenced')players.push({faction:'plague',at:{x:332,y:322},hp:1});
 return{name:'base-player-'+faction+'-real-reset-and-continuation',map:'room',profile:'signatures',lifecycleWitness:true,mainSeed:12,rewardSalt:[1,2,3,4],config:{firstPatienceSeconds:5.1,patienceSeconds:5.1,patienceMinSeconds:5.1},players,actions:[step(I('p0','attack',{a:0})),{kind:'untilTeleport',maxSteps:200},{kind:'healProbe',actor:'p0',amount:100},span(61),{kind:'healProbe',actor:'p0',amount:100},{kind:'place',actor:'p0',at:{x:300,y:320}},{kind:'place',actor:'p1',at:{x:332,y:320}},step(I('p0','attack',{a:0})),span(62),step(I('p0','release',{a:0})),{kind:'remove',actor:'p1'},{kind:'remove',actor:'p2'},...(faction==='sentenced'?[{kind:'remove',actor:'p3'}]:[]),step()]};
});
