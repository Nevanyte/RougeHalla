import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("recapture ignores provenance alone and names rule changes, additions and deletions", () => {
  const dir = mkdtempSync(join(tmpdir(), "rh-recapture-test-"));
  try {
    mkdirSync(join(dir, "parity/legacy-capture"), { recursive: true });
    mkdirSync(join(dir, "parity/fixtures"));
    mkdirSync(join(dir, "parity/maps"));
    copyFileSync(fileURLToPath(new URL("./check-recapture.mjs", import.meta.url)), join(dir, "parity/legacy-capture/check-recapture.mjs"));
    const scenario = join(dir, "parity/fixtures/duel.json");
    const map = join(dir, "parity/maps/seed1.map.json");
    writeFileSync(scenario, JSON.stringify({ legacyRevision: "old", ticks: [{ hp: 10 }] }));
    writeFileSync(map, JSON.stringify({ legacyRevision: "old", rows: ["..."] }));
    writeFileSync(join(dir, "parity/maps/duel.map.json"), JSON.stringify({ handmade: true }));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    git("init");
    git("add", ".");
    git("-c", "user.name=Parity Test", "-c", "user.email=parity@example.invalid", "commit", "-m", "fixture baseline");
    const check = (generated?: string) => spawnSync(process.execPath, ["parity/legacy-capture/check-recapture.mjs", ...(generated ? ["--generated", generated] : [])], { cwd: dir, encoding: "utf8" });
    const fresh = join(dir, "fresh");
    mkdirSync(join(fresh, "maps"), { recursive: true });
    copyFileSync(scenario, join(fresh, "duel.json"));
    copyFileSync(map, join(fresh, "maps/seed1.map.json"));
    assert.equal(check(fresh).status, 0, "independently authored duel.map.json is not generated");
    unlinkSync(join(fresh, "duel.json"));
    const vanished = check(fresh);
    assert.equal(vanished.status, 1, "stale committed fixture must not hide a vanished scenario");
    assert.match(vanished.stderr, /duel.json/);
    writeFileSync(scenario, JSON.stringify({ legacyRevision: "new", ticks: [{ hp: 10 }] }));
    assert.equal(check().status, 0);
    writeFileSync(scenario, JSON.stringify({ legacyRevision: "new", ticks: [{ hp: 11 }] }));
    const changed = check();
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /duel.json/);
    assert.match(changed.stderr, /a legacy rule changed: update Rust or re-record on purpose/);
    writeFileSync(join(dir, "parity/fixtures/new.json"), "{}");
    unlinkSync(map);
    const addedDeleted = check();
    assert.equal(addedDeleted.status, 1);
    assert.match(addedDeleted.stderr, /new.json/);
    assert.match(addedDeleted.stderr, /seed1.map.json/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
