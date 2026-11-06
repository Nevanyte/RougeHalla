/** Focused ordinary double-charge regression. Expected states never construct inputs. */
const cast=(x:number,y:number)=>({kind:'step',inputs:[{actor:'p0',type:'cast',payload:{slot:'wish',x,y}}]});
const span=(count:number)=>({kind:'span',count,snapshots:Array.from({length:count},(_,i)=>i+1)});
const common={profile:'core',map:'room',mainSeed:12,rewardSalt:[1,2,3,4]};
export const cases=[
 {...common,name:'overlapping-blaze-player-refresh-past-single-trail-bound',players:[{faction:'fire',at:{x:300,y:320}},{faction:'holy',at:{x:450,y:320},hp:100},{faction:'frost',at:{x:1100,y:600}}],actions:[cast(600,320),span(17),cast(300,320),span(33)]},
 {...common,name:'overlapping-blaze-source-born-npc-refresh-past-single-trail-bound',profile:'roster',map:'born',zone:'holy',config:{mobs:true},players:[{faction:'fire',at:{x:64,y:144}},{faction:'holy',at:{x:624,y:624}},{faction:'frost',at:{x:624,y:112}}],actions:[{kind:'place',actor:'@m1',hp:500},cast(364,144),span(17),cast(64,144),span(33)]}
];
