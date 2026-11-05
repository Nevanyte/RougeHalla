#!/usr/bin/env node
// Worst-case cost of the staging experiment in docs/hosting/COST.md, from the price rows read on 2026-11-05 (AWS price-list bulk
// JSON, docs/hosting/COST.md section 2). Pure arithmetic, no network: `node hosting/scripts/worst-case-cost.mjs [--json]`.
// Change a constant here and the table in COST.md must be regenerated from this output.
const P = {
  // USD per instance-hour, GameLift ConsumeLinuxGameLiftInstance, on-demand, the MOST EXPENSIVE type the template allows
  // (AllowedValues of InstanceType in hosting/infra/fleet/fleet.cfn.yaml: c6g c7g c5 c5a c6i .large).
  rate: { 'us-west-2': 0.109, 'ca-central-1': 0.119 },
  plannedHours: 4, // hard time limit from CreateStack to the end of teardown
  undetectedHours: 24, // teardown delay: nobody noticed (a budget e-mail lags by hours; Budgets refreshes up to 3x a day)
  instancesPerLocation: 1, // MaxInstances is capped at 1 in the template
  ecrGb: 1, ecrUsdPerGbMonth: 0.1, // a full month of 1 GB (lifecycle keeps 6 images of about 50 MB each)
  alarmMetrics: 9, alarmUsdPerMetricMonth: 0.1, // 8 alarms, one of them with 2 metrics, a full month, no free tier assumed
  logGb: 0.5, logUsdPerGb: 0.55, logStorageGbMonth: 0.5, logStorageUsd: 0.033, // ca-central-1 (higher) rates
  transferAllowanceUsd: 1.0, // image pulls and any data transfer not named as free (1 GB cross-Region is 0.09; generous)
  ipv4Usd: 0.005, // per public IPv4 per hour, if billed separately for fleet instances (UNVERIFIED), per instance
  unknownBuffer: 0.25, // on top of everything above: line items nobody listed
  fx: { bankOfCanada: 1.3961, card: 0.025, bufferRate: 1.5 }, // 2026-11-04 rate; 2.5 percent card fee; the number used for the cap
  capCad: 20,
};
function scenario(name, locations) {
  const hours = P.plannedHours + P.undetectedHours;
  const inst = locations.reduce((s, l) => s + P.rate[l] * hours * P.instancesPerLocation, 0);
  const ecr = P.ecrGb * P.ecrUsdPerGbMonth;
  const cw = P.alarmMetrics * P.alarmUsdPerMetricMonth + P.logGb * P.logUsdPerGb + P.logStorageGbMonth * P.logStorageUsd;
  const ipv4 = P.ipv4Usd * hours * locations.length * P.instancesPerLocation;
  const sub = inst + ecr + cw + P.transferAllowanceUsd + ipv4;
  const total = sub * (1 + P.unknownBuffer);
  return {
    name, locations, hours, instancesUsd: inst, ecrUsd: ecr, cloudwatchUsd: cw, transferUsd: P.transferAllowanceUsd, ipv4Usd: ipv4,
    subtotalUsd: sub, bufferUsd: sub * P.unknownBuffer, totalUsd: total,
    totalCad_bankRate: total * P.fx.bankOfCanada, totalCad_withCardFee: total * P.fx.bankOfCanada * (1 + P.fx.card), totalCad_bufferRate: total * P.fx.bufferRate,
    capMarginCad: P.capCad - total * P.fx.bufferRate,
  };
}
const out = [scenario('stage 1: us-west-2 only', ['us-west-2']), scenario('stages 1+2: us-west-2 + ca-central-1 remote location', ['us-west-2', 'ca-central-1'])];
const planned = (() => { // expected cost if everything goes to plan: 3 h of the cheaper c6g instance, no delay
  const usd = 3 * 0.088 + 0.02 + 0.3 + 0.1;
  return { usd, cadBufferRate: usd * P.fx.bufferRate };
})();
if (process.argv.includes('--json')) { console.log(JSON.stringify({ assumptions: P, out, planned }, null, 2)); process.exit(0); }
const f = (n) => n.toFixed(2).padStart(7);
console.log(`worst case = ${P.plannedHours} h planned + ${P.undetectedHours} h undetected = ${P.plannedHours + P.undetectedHours} h of every instance at the dearest allowed type; USD->CAD at ${P.fx.bufferRate} (Bank of Canada ${P.fx.bankOfCanada} on 2026-11-04, +${P.fx.card * 100}% card fee = ${(P.fx.bankOfCanada * (1 + P.fx.card)).toFixed(4)}, rest is buffer)\n`);
console.log('scenario'.padEnd(58), 'instances   ECR     CW  transfer  IPv4  +25%   TOTAL USD  TOTAL CAD  margin to CAD ' + P.capCad);
for (const s of out) console.log(s.name.padEnd(58), f(s.instancesUsd), f(s.ecrUsd), f(s.cloudwatchUsd), f(s.transferUsd), f(s.ipv4Usd), f(s.bufferUsd), '  ', f(s.totalUsd), '  ', f(s.totalCad_bufferRate), '  ', f(s.capMarginCad));
console.log(`\nexpected if all goes to plan (3 h of c6g.large in us-west-2, small extras): USD ${planned.usd.toFixed(2)} = CAD ${planned.cadBufferRate.toFixed(2)} at the buffer rate`);
