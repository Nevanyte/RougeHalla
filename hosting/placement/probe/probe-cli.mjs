#!/usr/bin/env node
// Run the regional probe from a terminal (for example from a machine inside a region, or a laptop in Calgary), not a browser.
//   node probe-cli.mjs us-west-2=https://probe-us-west-2.g.rougehalla.com ca-central-1=https://probe-ca-central-1.g.rougehalla.com [--samples 9]
// Prints the JSON that feeds `MemberReport.rtt_ms`. Needs the probe hosts to exist (NOT RUN in this repository: no regional hosts).
import { probeRegions } from "./probe.mjs";

const args = process.argv.slice(2);
const si = args.indexOf("--samples");
const samples = si >= 0 ? Number(args[si + 1]) : undefined;
const regions = args.filter((a, i) => a.includes("=") && args[i - 1] !== "--samples").map((a) => {
  const [id, probeUrl] = a.split(/=(.*)/s);
  return { id, probeUrl };
});
if (!regions.length) {
  console.error("usage: probe-cli.mjs <region>=<https url> ... [--samples N]");
  process.exit(2);
}
const out = await probeRegions(regions, samples ? { samples } : {});
console.log(JSON.stringify(out, null, 2));
