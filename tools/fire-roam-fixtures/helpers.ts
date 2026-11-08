/** Direct actual-export probes of Fire's roaming charge/speed/burst helpers, NOT ordinary gameplay intake. */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {
  FIRE_ROAM_BURST_AD_SHARE, FIRE_ROAM_BURST_BASE, FIRE_ROAM_CHARGE_MAX, FIRE_ROAM_MAX_SPEED_MULT, FIRE_ROAM_RAMP_MS,
  fireRoamBurstDamage, fireRoamCharge, fireRoamSpeedMult,
} from '@raid/shared';

if (process.version !== 'v22.23.4' || process.platform !== 'linux' || process.arch !== 'x64') {
  throw Error('requires Linux x64 Node22.23.4');
}

const out = {
  format: 'rh-fire-roam-actual-export-probes/1',
  kind: 'direct actual exported shared/fireRoam.ts helpers; no ordinary gameplay intake',
  provenance: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    nodeSha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),
    exports: [
      'packages/shared/src/fireRoam.ts::fireRoamCharge',
      'packages/shared/src/fireRoam.ts::fireRoamSpeedMult',
      'packages/shared/src/fireRoam.ts::fireRoamBurstDamage',
      'packages/shared/src/fireRoam.ts::FIRE_ROAM_RAMP_MS',
      'packages/shared/src/fireRoam.ts::FIRE_ROAM_CHARGE_MAX',
      'packages/shared/src/fireRoam.ts::FIRE_ROAM_MAX_SPEED_MULT',
      'packages/shared/src/fireRoam.ts::FIRE_ROAM_BURST_BASE',
      'packages/shared/src/fireRoam.ts::FIRE_ROAM_BURST_AD_SHARE',
    ],
  },
  constants: {
    rampMs: FIRE_ROAM_RAMP_MS,
    chargeMax: FIRE_ROAM_CHARGE_MAX,
    maxSpeedMult: FIRE_ROAM_MAX_SPEED_MULT,
    burstBase: FIRE_ROAM_BURST_BASE,
    burstAdShare: FIRE_ROAM_BURST_AD_SHARE,
  },
  charge: [0, 1, 19, 20, 21, 999, 1000, 10_000, 19_999, 20_000, 20_001, 100_000, 0.5, 19_999.9, -1, -20_000]
    .map((elapsedMs) => ({elapsedMs, value: fireRoamCharge(elapsedMs)})),
  speed: [0, 1, 2, 500, 750, 999, 1000, 1001, -5, 0.5]
    .map((charge) => ({charge, value: fireRoamSpeedMult(charge)})),
  burst: [0, 1, 10, 12.5, 100, 1_000, -5, 0.5]
    .map((offense) => ({offense, value: fireRoamBurstDamage(offense)})),
};
writeFileSync(process.argv[2] ?? 'parity/fire-roam/helpers.json', JSON.stringify(out, null, 2) + '\n');
console.log(`captured ${out.charge.length + out.speed.length + out.burst.length} actual Fire roam helper cases`);
