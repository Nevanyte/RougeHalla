'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { evaluate } = require('./report.cjs');
const folder = path.resolve(__dirname, '../../docs/evidence/input-latency');
for (const name of ['linux-rtt-sweep-final.json', 'linux-caddy-wss-final.json', 'linux-ordered-stalls-final.json', 'linux-ordered-stalls-repeat.json']) {
  const report = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
  const verdict = evaluate(report);
  console.log(`${name}: ${verdict.status} (${report.trials.length} recorded trials; no new measurement)`);
  if (verdict.exitCode !== 0) {
    console.error(JSON.stringify(verdict));
    process.exitCode = verdict.exitCode;
  }
}
const rejected = JSON.parse(fs.readFileSync(path.join(folder, 'linux-ordered-stalls-missing-presentation.json'), 'utf8'));
const rejectedVerdict = evaluate(rejected);
console.log(`linux-ordered-stalls-missing-presentation.json: ${rejectedVerdict.status} (expected rejected measurement)`);
if (rejectedVerdict.status !== 'FAIL') {
  console.error('The saved incomplete stall measurement must remain rejected.');
  process.exitCode = 1;
}
