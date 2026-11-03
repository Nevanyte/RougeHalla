// The join-time check that a page was built against the contract this server speaks (JoinOptions.build): the hash, the guard, the
// config defaults, what the client build bakes in, and the real thing over sockets (RaidRoom.onAuth). The check only ever lets a
// join through or refuses it; a join that names no build is let in.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@colyseus/sdk";
import { CLIENT_OUT_OF_DATE_CODE, CLIENT_OUT_OF_DATE_MESSAGE, ROOM_NAME, TRAINING_ROOM_NAME, type JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import viteConfig from "../../client/vite.config";
import { computeWireBuildId, wireBuildId } from "../src/buildId";
import { loadConfig } from "../src/config";
import { clientBuildAllowed } from "../src/guards/clientBuild";
import { startServer, type RaidServer } from "../src/index";

describe("clientBuildAllowed", () => {
  it("lets in a server that requires nothing, and a join that names nothing", () => {
    for (const given of [undefined, null, "anything", "", 7, {}]) expect(clientBuildAllowed(undefined, given), String(given)).toBe(true);
    expect(clientBuildAllowed("wire-A", undefined)).toBe(true);
    expect(clientBuildAllowed("wire-A", null)).toBe(true);
  });

  it("refuses anything else that is not exactly the required build, of any type", () => {
    expect(clientBuildAllowed("wire-A", "wire-A")).toBe(true);
    for (const given of ["wire-B", "", " wire-A", "wire-A ", "WIRE-A", "wire-", 0, 7, false, {}, ["wire-A"], { toString: () => "wire-A" }]) {
      expect(clientBuildAllowed("wire-A", given), String(given)).toBe(false);
    }
  });
});

describe("computeWireBuildId", () => {
  let dir = "";
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const tree = (root: string) => {
    dir = root;
    write("packages/shared/src/a.ts", "export const A = 1;\n");
    write("packages/shared/src/sub/b.ts", "export const B = 2;\n");
    write("packages/server/src/s.ts", "export const S = 1;\n");
    write("packages/client/src/c.ts", "export const C = 1;\n");
  };

  it("hashes the shared TypeScript only: a server or client edit, a note or a stray .DS_Store changes nothing, a shared edit does", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "raid-wire-a-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "raid-wire-b-"));
    try {
      tree(a);
      const base = computeWireBuildId(a);
      expect(base).toMatch(/^[0-9a-f]{64}$/);
      expect(computeWireBuildId(a)).toBe(base);
      // The same sources somewhere else are the same build (the Vite build and the server run in different places).
      tree(b);
      expect(computeWireBuildId(b)).toBe(base);
      dir = a;
      write("packages/server/src/s.ts", "export const S = 2;\n");
      write("packages/client/src/c.ts", "export const C = 2;\n");
      write("packages/shared/src/NOTES.md", "not code\n");
      write("packages/shared/src/.DS_Store", "finder\n");
      write("packages/shared/src/sub/data.json", "{}\n");
      expect(computeWireBuildId(a)).toBe(base);
      write("packages/shared/src/sub/b.ts", "export const B = 3;\n");
      const edited = computeWireBuildId(a);
      expect(edited).not.toBe(base);
      // Moving a file is a change too: the path is part of the hash.
      fs.renameSync(path.join(a, "packages/shared/src/a.ts"), path.join(a, "packages/shared/src/a2.ts"));
      expect(computeWireBuildId(a)).not.toBe(edited);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  it("is the real shared sources' hash for the process, and the client build bakes in that same value", () => {
    const own = wireBuildId();
    expect(own).toMatch(/^[0-9a-f]{64}$/);
    expect(own).toBe(computeWireBuildId());
    const resolve = viteConfig as unknown as (env: { command: "build" | "serve"; mode: string }) => { define?: Record<string, string> };
    expect(resolve({ command: "build", mode: "production" }).define).toEqual({ "import.meta.env.VITE_WIRE_BUILD": JSON.stringify(own) });
    // Dev and tests carry none (hot reload keeps a page across edits of shared code).
    expect(resolve({ command: "serve", mode: "development" }).define ?? {}).toEqual({});
  });
});

describe("the config's clientBuild", () => {
  it("is the server's own wire build when hosting, nothing in dev, and CLIENT_BUILD_CHECK=0 or CLIENT_BUILD move it", () => {
    const own = wireBuildId();
    expect(loadConfig({}).clientBuild).toBeUndefined();
    expect(loadConfig({ NODE_ENV: "production" }).clientBuild).toBe(own);
    expect(loadConfig({ CLIENT_DIR: "/srv/client" }).clientBuild).toBe(own);
    expect(loadConfig({ NODE_ENV: "production", CLIENT_BUILD_CHECK: "0" }).clientBuild).toBeUndefined();
    expect(loadConfig({ NODE_ENV: "production", CLIENT_BUILD_CHECK: "false" }).clientBuild).toBeUndefined();
    expect(loadConfig({ NODE_ENV: "production", CLIENT_BUILD: "pinned" }).clientBuild).toBe("pinned");
    expect(loadConfig({ CLIENT_BUILD: "pinned-in-dev" }).clientBuild).toBe("pinned-in-dev");
    expect(loadConfig({ CLIENT_BUILD: "pinned", CLIENT_BUILD_CHECK: "0" }).clientBuild).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------------------- the room, over sockets

const WIRE = "wire-A";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

describe("a join that names a build", () => {
  let server: RaidServer;
  let port = 0;
  let dir = "";
  let client: Client;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-clientbuild-"));
    port = await freePort();
    server = await startServer({
      ...loadConfig({}), port, latencyMs: 0, stashFile: path.join(dir, "data", "stash.json"), lobbySeconds: 120, minPlayers: 99, clientBuild: WIRE,
    });
    client = new Client(`http://127.0.0.1:${port}`);
  });

  afterAll(async () => {
    try {
      await server?.stop();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function friend(name: string): Promise<{ name: string; token: string }> {
    const res = await fetch(`http://127.0.0.1:${port}/api/profile/${name}`);
    expect(res.status).toBe(200);
    return { name, token: ((await res.json()) as { token: string }).token };
  }
  const options = (a: { name: string; token: string }, build?: unknown): JoinOptions => ({ profile: a.name, token: a.token, ...(build === undefined ? {} : { build: build as string }) });

  it("is refused when it is not the server's, for a run and for training, with the reload sentence and status, before anything is opened", async () => {
    const a = await friend("stale1");
    for (const build of ["wire-B", "", "WIRE-A", 123, {}, ["wire-A"]]) {
      for (const [label, join] of [
        ["arena", () => client.joinOrCreate<RaidState>(ROOM_NAME, options(a, build))],
        ["training", () => client.create<RaidState>(TRAINING_ROOM_NAME, options(a, build))],
      ] as const) {
        const err = await join().then(() => null, (e: unknown) => e as { code?: number; message?: string });
        expect(err, `${label} ${JSON.stringify(build)}`).not.toBeNull();
        expect(err!.code).toBe(CLIENT_OUT_OF_DATE_CODE);
        expect(err!.message).toContain(CLIENT_OUT_OF_DATE_MESSAGE);
        // The sentence says nothing of the server's own build.
        expect(err!.message).not.toContain(WIRE);
      }
    }
    expect([server.rooms.count("arena"), server.rooms.count("training")]).toEqual([0, 0]);
    // The refusals held no seat and no profile: the same callsign joins with the right build at once.
    const arena = await client.joinOrCreate<RaidState>(ROOM_NAME, options(a, WIRE));
    expect(arena.sessionId).toBeTruthy();
    await arena.leave(true);
  });

  it("is let in when it is the server's, for a run and for training", async () => {
    const a = await friend("current1");
    const arena = await client.joinOrCreate<RaidState>(ROOM_NAME, options(a, WIRE));
    expect(arena.sessionId).toBeTruthy();
    await arena.leave(true);
    const b = await friend("current2");
    const training = await client.create<RaidState>(TRAINING_ROOM_NAME, options(b, WIRE));
    expect(training.sessionId).toBeTruthy();
    await training.leave(true);
  });

  it("is let in when it names no build at all (a bot, the harness, a dev build, a page older than the field)", async () => {
    const a = await friend("nobuild1");
    const arena = await client.joinOrCreate<RaidState>(ROOM_NAME, options(a));
    expect(arena.sessionId).toBeTruthy();
    await arena.leave(true);
  });

  it("the build is dropped after the comparison: nothing of it reaches the room's state or the profile", async () => {
    const a = await friend("nothing1");
    const arena = await client.joinOrCreate<RaidState>(ROOM_NAME, options(a, WIRE));
    expect(JSON.stringify(arena.state.toJSON())).not.toContain(WIRE);
    expect(JSON.stringify(server.store.get("nothing1"))).not.toContain(WIRE);
    await arena.leave(true);
  });
});
