import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireLock, productionEnvironment, validateConfig } from "../../../scripts/deploy-lib.mjs";
import { run } from "../../../scripts/deploy.mjs";

const tempDirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rougehalla-deploy-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function config(stateDir: string) {
  return validateConfig({ repository: "file:///tmp/fixture.git", stateDir });
}

async function deployFixture(command: "deploy" | "rollback" = "deploy") {
  const root = await tempDir();
  const stateDir = path.join(root, "state");
  const releasesDir = path.join(stateDir, "releases");
  await fs.mkdir(releasesDir, { recursive: true });
  const stashFile = path.join(stateDir, "profiles.json");
  const stashBytes = '{"profiles":{"p1":{"token":"stable-token","name":"A"}}}\n';
  await fs.writeFile(stashFile, stashBytes, { mode: 0o600 });
  const configFile = path.join(root, "deploy-config.json");
  await fs.writeFile(configFile, JSON.stringify({ repository: "file:///tmp/fixture.git", stateDir, releasesDir, stashFile }), { mode: 0o600 });
  return { root, stateDir, releasesDir, stashFile, stashBytes, configFile, options: { command, config: configFile, json: true, retry: false } };
}

describe("deployment configuration", () => {
  it("rejects unsafe refs, paths, and public URLs before deployment can start", async () => {
    const stateDir = await tempDir();
    expect(() => validateConfig({ repository: "file:///tmp/fixture.git", stateDir, branch: "../main" })).toThrow();
    expect(() => validateConfig({ repository: "file:///tmp/fixture.git", stateDir, repositoryDir: "/" })).toThrow();
    expect(() => validateConfig({ repository: "file:///tmp/fixture.git", stateDir, publicUrl: "https://user:secret@example.com" })).toThrow();
  });

  it("keeps production profile location and port fixed while stripping development network simulation", async () => {
    const stateDir = await tempDir();
    const cfg = config(stateDir);
    const env = productionEnvironment(
      { KEEP_ME: "yes", RAID_PORT: "1", STASH_FILE: "/wrong", NET_SEED: "7", NODE_OPTIONS: "--inspect" },
      { RAID_PORT: "2", STASH_FILE: "/also-wrong", NET_LOSS_PCT: "99", FEATURE_FLAG: "enabled" },
      cfg,
      path.join(stateDir, "releases", "build-a"),
    );
    expect(env).toMatchObject({ KEEP_ME: "yes", FEATURE_FLAG: "enabled", NODE_ENV: "production", RAID_PORT: String(cfg.port), STASH_FILE: cfg.stashFile });
    expect(env.CLIENT_DIR).toBe(path.join(stateDir, "releases", "build-a", "packages/client/dist"));
    for (const key of ["NET_SEED", "NET_LOSS_PCT", "NODE_OPTIONS", "COLYSEUS_LATENCY", "RAID_EXIT_ON_STDIN_END"]) expect(env).not.toHaveProperty(key);
  });
});

describe("deployment lock", () => {
  it("serializes deploys and releases only its own lock", async () => {
    const stateDir = await tempDir();
    const release = await acquireLock(stateDir);
    const lockDir = path.join(stateDir, "deploy.lock");
    const ownerBefore = JSON.parse(await fs.readFile(path.join(lockDir, "owner.json"), "utf8"));
    await expect(acquireLock(stateDir)).rejects.toThrow(/Another deployment is running/);
    await release();
    await expect(fs.access(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
    // A replacement owner is never deleted by an old release callback.
    await fs.mkdir(lockDir);
    await fs.writeFile(path.join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, token: "replacement" }));
    expect(ownerBefore.token).not.toBe("replacement");
    await release();
    expect(JSON.parse(await fs.readFile(path.join(lockDir, "owner.json"), "utf8")).token).toBe("replacement");
  });

  it("reclaims a dead owner without touching a similarly named decoy directory", async () => {
    const stateDir = await tempDir();
    const lockDir = path.join(stateDir, "deploy.lock");
    const decoy = path.join(stateDir, "deploy.lock.stale-decoy");
    await fs.mkdir(lockDir);
    await fs.writeFile(path.join(lockDir, "owner.json"), JSON.stringify({ pid: 2_000_000_000, token: "dead" }));
    await fs.mkdir(decoy);
    await fs.writeFile(path.join(decoy, "sentinel"), "preserve");
    const release = await acquireLock(stateDir);
    expect(await fs.readFile(path.join(decoy, "sentinel"), "utf8")).toBe("preserve");
    await release();
  });

  it("refuses a malformed lock rather than guessing that it is stale", async () => {
    const stateDir = await tempDir();
    const lockDir = path.join(stateDir, "deploy.lock");
    await fs.mkdir(lockDir);
    await fs.writeFile(path.join(lockDir, "owner.json"), "not json");
    await expect(acquireLock(stateDir)).rejects.toThrow();
    await expect(fs.access(path.join(lockDir, "owner.json"))).resolves.toBeUndefined();
  });
});

describe("deployment orchestration", () => {
  it.each(["deploy", "rollback"] as const)("refuses a public cloud target before %s can touch local releases or profiles", async (command) => {
    const fixture = await deployFixture(command);
    const saved = JSON.parse(await fs.readFile(fixture.configFile, "utf8"));
    saved.publicUrl = "https://PLAY.roguehalla.com./";
    await fs.writeFile(fixture.configFile, JSON.stringify(saved), { mode: 0o600 });
    let operations = 0;
    await expect(run(fixture.options, {
      prepareRelease: async () => { operations++; throw new Error("must not prepare"); },
      switchRelease: async () => { operations++; throw new Error("must not switch"); },
    })).rejects.toThrow(/hosted by Cloudflare/);
    expect(operations).toBe(0);
    expect(await fs.readFile(fixture.stashFile, "utf8")).toBe(fixture.stashBytes);
    await expect(fs.access(path.join(fixture.stateDir, "deploy.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves live release and exact profile bytes untouched when preflight build fails", async () => {
    const fixture = await deployFixture();
    const live = { commit: "a".repeat(40), releaseDir: path.join(fixture.releasesDir, "live"), pid: 1234 };
    await fs.mkdir(live.releaseDir);
    await fs.writeFile(path.join(fixture.stateDir, "deployment.json"), JSON.stringify(live));
    let switches = 0;
    await expect(run(fixture.options, {
      prepareRelease: async () => ({ commit: "b".repeat(40), build: async () => { throw new Error("fixture build failed"); } }),
      switchRelease: async () => { switches++; throw new Error("must not switch"); },
    })).rejects.toThrow("fixture build failed");
    expect(switches).toBe(0);
    expect(await fs.readFile(fixture.stashFile, "utf8")).toBe(fixture.stashBytes);
    expect(JSON.parse(await fs.readFile(path.join(fixture.stateDir, "deployment.json"), "utf8"))).toEqual(live);
    expect(JSON.parse(await fs.readFile(path.join(fixture.stateDir, "deploy-failure.json"), "utf8")).commit).toBe("b".repeat(40));
  });

  it("skips build and switch when the active commit is already healthy", async () => {
    const fixture = await deployFixture();
    const live = { commit: "c".repeat(40), releaseDir: path.join(fixture.releasesDir, "live"), pid: 1234 };
    await fs.mkdir(live.releaseDir);
    await fs.writeFile(path.join(fixture.stateDir, "deployment.json"), JSON.stringify(live));
    let builds = 0;
    let switches = 0;
    const result = await run(fixture.options, {
      prepareRelease: async () => ({ commit: live.commit, build: async () => { builds++; return {}; } }),
      status: async () => ({ status: "healthy" }),
      switchRelease: async () => { switches++; return {}; },
    });
    expect(result.status).toBe("unchanged");
    expect({ builds, switches }).toEqual({ builds: 0, switches: 0 });
    expect(await fs.readFile(fixture.stashFile, "utf8")).toBe(fixture.stashBytes);
  });

  it("blacklists a failed commit, then allows that same commit only with --retry", async () => {
    const fixture = await deployFixture();
    const commit = "d".repeat(40);
    let builds = 0;
    let switches = 0;
    const operations = {
      prepareRelease: async () => ({ commit, build: async () => { builds++; if (builds === 1) throw new Error("failed checks"); return { commit, releaseDir: path.join(fixture.releasesDir, "candidate") }; } }),
      switchRelease: async (_config: unknown, _current: unknown, target: { commit: string }) => { switches++; return target; },
      prune: async () => {},
    };
    await expect(run(fixture.options, operations)).rejects.toThrow("failed checks");
    const skipped = await run(fixture.options, operations);
    expect(skipped.status).toBe("failed-previously");
    expect(builds).toBe(1);
    expect(switches).toBe(0);
    const retried = await run({ ...fixture.options, retry: true }, operations);
    expect(retried.status).toBe("deployed");
    expect({ builds, switches }).toEqual({ builds: 2, switches: 1 });
  });

  it("rolls back to the recorded previous release, keeps profiles byte-for-byte, and blocks automatic redeploy of the operator-rejected commit", async () => {
    const fixture = await deployFixture("rollback");
    const current = { commit: "e".repeat(40), releaseDir: path.join(fixture.releasesDir, "new"), previous: { commit: "f".repeat(40), releaseDir: path.join(fixture.releasesDir, "old") } };
    await fs.mkdir(current.releaseDir);
    await fs.mkdir(current.previous.releaseDir);
    await fs.writeFile(path.join(fixture.stateDir, "deployment.json"), JSON.stringify(current));
    let target: unknown;
    let builds = 0;
    const rolledBack = await run(fixture.options, {
      prepareRelease: async () => { builds++; throw new Error("rollback must use existing release"); },
      switchRelease: async (_config: unknown, _active: unknown, destination: { commit: string; releaseDir: string }) => {
        target = destination;
        const newRecord = { ...destination, previous: current };
        await fs.writeFile(path.join(fixture.stateDir, "deployment.json"), JSON.stringify(newRecord));
        return newRecord;
      },
    });
    expect(rolledBack.status).toBe("rolled-back");
    expect(target).toEqual(current.previous);
    expect(builds).toBe(0);
    expect(await fs.readFile(fixture.stashFile, "utf8")).toBe(fixture.stashBytes);
    expect(JSON.parse(await fs.readFile(path.join(fixture.stateDir, "deploy-failure.json"), "utf8"))).toMatchObject({ commit: current.commit, reason: "operator-rollback" });

    const automatic = await run({ ...fixture.options, command: "deploy" }, {
      prepareRelease: async () => ({ commit: current.commit, build: async () => { builds++; return {}; } }),
      status: async () => ({ status: "unhealthy" }),
      switchRelease: async () => { throw new Error("automatic deploy must respect operator rollback"); },
    });
    expect(automatic.status).toBe("failed-previously");
    expect(builds).toBe(0);
  });
});
