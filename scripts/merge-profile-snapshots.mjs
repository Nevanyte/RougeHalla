// Read-only inputs; writes a new private migration snapshot and never prints ownership tokens.
import fs from "node:fs";

const args = process.argv.slice(2);
if (args.length !== 3) throw new Error("Usage: node scripts/merge-profile-snapshots.mjs LOCAL CLOUD NEW_OUTPUT");
function read(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data?.version !== 2 || !data.profiles || typeof data.profiles !== "object" || Array.isArray(data.profiles)) {
    throw new Error("Expected a version 2 profile snapshot");
  }
  for (const [name, record] of Object.entries(data.profiles)) {
    if (record?.name !== name || typeof record.token !== "string" || !record.token) throw new Error("Malformed profile record");
  }
  return data;
}
const local = read(args[0]);
const cloud = read(args[1]);
const merged = { ...cloud.profiles };
for (const [name, record] of Object.entries(local.profiles)) {
  if (Object.hasOwn(merged, name) && JSON.stringify(merged[name]) !== JSON.stringify(record)) {
    throw new Error(`Conflicting callsign ${name}; resolve it before importing`);
  }
  merged[name] = record;
}
fs.writeFileSync(args[2], `${JSON.stringify({ version: 2, profiles: merged })}\n`, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ localProfiles: Object.keys(local.profiles).length, cloudProfiles: Object.keys(cloud.profiles).length, mergedProfiles: Object.keys(merged).length }));
