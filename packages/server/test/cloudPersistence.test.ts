import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { createServer } from "../src/index";
import { computeServerBuildId } from "../src/buildId";
import { clientAddress } from "../src/guards/clientIp";

it("waits for durable claims, retains ownership on failure, and reports storage health", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-cloud-"));
  const port = await new Promise<number>((resolve) => {
    const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  });
  let fail = false;
  const snapshots: string[] = [];
  const server = createServer({ ...loadConfig({ BOTS_FILL_TO: "0", MAP_POOL: "0" }), port, stashFile: path.join(dir, "profiles.json") }, {
    onSnapshot: async (json) => { if (fail) throw new Error("snapshot unavailable"); snapshots.push(json); },
  });
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await server.listen(port); server.readiness.ready = true;
    const origin = `http://127.0.0.1:${port}`;
    const claim = await fetch(`${origin}/api/profile/cloud_ok`);
    expect(claim.status).toBe(200);
    const body = await claim.json() as { token: string };
    expect(JSON.parse(snapshots.at(-1)!).profiles.cloud_ok.token).toBe(body.token);
    const ready = await fetch(`${origin}/readyz`);
    expect(ready.status).toBe(200);
    expect(ready.headers.get("X-Rougehalla-Server-Build")).toBe(computeServerBuildId());
    fail = true;
    const failed = await fetch(`${origin}/api/profile/cloud_retry`);
    expect(failed.status).toBe(503);
    const pending = await failed.json() as { token: string };
    expect(server.store.verifyToken("cloud_retry", pending.token)).toBe(true);
    expect((await fetch(`${origin}/readyz`)).status).toBe(503);
    fail = false;
    const retry = await fetch(`${origin}/api/profile/cloud_retry`, { headers: { "x-profile-token": pending.token } });
    expect(retry.status).toBe(200);
    expect((await fetch(`${origin}/readyz`)).status).toBe(200);
    expect(JSON.parse(snapshots.at(-1)!).profiles.cloud_retry.token).toBe(pending.token);
  } finally {
    fail = false;
    await server.stop(); quiet.mockRestore(); fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("trusts the isolated Worker proxy only when explicitly enabled", () => {
  expect(clientAddress("10.0.0.2", "203.0.113.7")).toBe("10.0.0.2");
  expect(clientAddress("10.0.0.2", "203.0.113.7", true)).toBe("203.0.113.7");
  expect(clientAddress("10.0.0.2", "spoofed, 203.0.113.7", true)).toBe("10.0.0.2");
});
