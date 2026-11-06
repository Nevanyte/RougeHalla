/** Existing ordinary player placement bootstrap is declared input, never expected cast state. */
export const cases = ['p2', 'p1'].map(actor => ({
 name: actor === 'p2' ? 'pending-freeze-abandon-unrelated-past-due' : 'pending-freeze-abandon-target-past-due',
 map: 'room', profile: 'core', mainSeed: 12, rewardSalt: [1,2,3,4],
 domain: 'existing declared player placement bootstrap; real queued Cast, real admin abandon, ordinary clock only',
 players: [{faction:'frost',at:{x:300,y:320}},{faction:'fire',at:{x:450,y:320}},{faction:'holy',at:{x:1000,y:500}}],
 actions: [
  {kind:'queue',inputs:[{actor:'p0',type:'cast',payload:{slot:'wish',point:{x:450,y:320},id:'p1',seq:1}}]},
  {kind:'step'}, {kind:'abandon',actor},
  {kind:'span',count:10,snapshots:[1,2,3,4,5,6,7,8,9,10]},
 ],
}));
