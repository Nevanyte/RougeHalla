/** Direct actual-export helper probes, separate from ordinary validated-input gameplay. */
import {writeFileSync} from 'node:fs';
import {stretchUntil} from '../../packages/server/src/sim/factions';
import {frostMoveMultiplier,CHILL_MOVE_RESET_MS} from '@raid/shared';
import {HOLY_MODULES} from '../../parity/legacy-capture/scenarios/holy';
if(process.version!=='v22.23.4'||process.platform!=='linux'||process.arch!=='x64')throw Error('requires Linux x64 Node22.23.4');
const stretch=[];for(const now of [0,50,199.125])for(const left of [-1,0,1e-9,16.999999,17,33.999999999,34,34.000000001,50,100.125])for(const m of [-1,0,1-.32,1,2]){const until=now+left;stretch.push({until,now,dt:50,m,result:stretchUntil(until,now,50,m)});}
const thaw=[-1,0,999.999999,1000,1000.000001,1005,1015,1500,2000,3999.999999,4000,4000.000001,8000].map(exposure=>({exposure,result:frostMoveMultiplier(exposure)}));
writeFileSync(process.argv[2]??'parity/frost/helpers.json',JSON.stringify({format:'rh-frost-actual-export-probes/1',provenance:{node:process.version,platform:process.platform,arch:process.arch,kind:'direct actual exported helpers; no ordinary gameplay intake',exports:['packages/server/src/sim/factions.ts::stretchUntil','packages/shared/src/signatures.ts::frostMoveMultiplier'],modules:HOLY_MODULES},reset:CHILL_MOVE_RESET_MS,stretch,thaw},null,2)+'\n');
console.log(`${stretch.length} stretch and ${thaw.length} thaw exact actual-export probes`);
