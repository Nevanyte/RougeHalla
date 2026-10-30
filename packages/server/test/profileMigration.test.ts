import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("preserves complete records and ownership, refuses collisions, and creates a private snapshot", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-migration-"));
  const script = fileURLToPath(new URL("../../../scripts/merge-profile-snapshots.mjs", import.meta.url));
  const local = { name: "local", token: "local-owner", gv: 42, futureField: { keep: true } };
  const cloud = { name: "cloud", token: "cloud-owner", gv: 7 };
  const write = (name: string, profiles: object) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify({ version: 2, profiles })); return file; };
  try {
    const a = write("local.json", { local }); const b = write("cloud.json", { cloud }); const out = path.join(dir, "merged.json");
    const run = spawnSync(process.execPath, [script, a, b, out], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain("owner");
    expect(JSON.parse(fs.readFileSync(out, "utf8")).profiles).toEqual({ local, cloud });
    expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    const conflict = write("conflict.json", { local: { ...local, token: "another-owner" } });
    const refused = spawnSync(process.execPath, [script, a, conflict, path.join(dir, "refused.json")], { encoding: "utf8" });
    expect(refused.status).not.toBe(0);
    expect(fs.existsSync(path.join(dir, "refused.json"))).toBe(false);
    expect(spawnSync(process.execPath, [script, a, b, out]).status).not.toBe(0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
