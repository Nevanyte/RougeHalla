#!/usr/bin/env node
// Run against a prepared release, with a temporary profile store and no public tunnel.
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { startServer } = await import(pathToFileURL(path.join(root, "packages/server/src/index.ts")));
const { loadConfig } = await import(pathToFileURL(path.join(root, "packages/server/src/config.ts")));
const { Client } = await import(pathToFileURL(path.join(root, "node_modules/@colyseus/sdk/build/index.mjs")));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rougehalla-deploy-smoke-"));
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const selected = probe.address().port;
    probe.close((error) => error ? reject(error) : resolve(selected));
  });
});
const config = loadConfig({ NODE_ENV: "production", CLIENT_DIR: path.join(root, "packages/client/dist"),
  STASH_FILE: path.join(dir, "profiles.json"), RAID_PORT: String(port), BOTS_FILL_TO: "0", BOT_STATS_FILE: "off",
  PLAN_SECONDS: "0", MIN_PLAYERS: "2", FILL_SECONDS: "0", LOBBY_SECONDS: "60",
  PATIENCE_SECONDS: "3600", FIRST_PATIENCE_SECONDS: "3600" });
const rooms = [];
let server;
async function until(fn, label) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    try { if (fn()) return; } catch { /* first schema patch has not arrived yet */ }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Smoke test timed out: ${label}`);
}
try {
  server = await startServer(config);
  const origin = `http://127.0.0.1:${port}`;
  const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200, "health endpoint");
  assert.equal((await health.json()).ok, true);
  const page = await fetch(origin, { signal: AbortSignal.timeout(5000) });
  assert.equal(page.status, 200, "production page");
  const html = await page.text();
  const assets = [html.match(/<script[^>]*src="([^"]+)"/)?.[1], html.match(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/)?.[1]];
  for (const asset of assets) {
    assert.ok(asset?.startsWith("/assets/"), "built JavaScript and CSS references");
    assert.equal((await fetch(origin + asset, { signal: AbortSignal.timeout(5000) })).status, 200, `production asset ${asset}`);
  }
  const client = new Client(origin);
  for (const name of ["deploySmokeA", "deploySmokeB"]) {
    const response = await fetch(`${origin}/api/profile/${name}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, "temporary profile creation");
    const { token } = await response.json();
    const room = rooms.length === 0
      ? await client.create("raid", { profile: name, token })
      : await client.joinById(rooms[0].roomId, { profile: name, token });
    for (const type of ["fxs", "toast", "plan", "vision", "result", "questReveal"]) room.onMessage(type, () => {});
    rooms.push(room);
  }
  await until(() => rooms.every((room) => room.state?.phase === "active"), "two-player WebSocket raid");
  for (const room of rooms) {
    assert.equal(room.state.players.size, 2);
    assert.ok(room.state.camps.length > 0, "regional camps");
    const camp = room.state.camps[0];
    for (const key of ["clearedAt", "respawnAt", "wardExpiresAt", "alive"]) assert.equal(typeof camp[key], "number", `public camp ${key}`);
    assert.equal(typeof camp.wardOwner, "string");
  }
  assert.equal(rooms[0].state.camps[0].respawnAt, rooms[1].state.camps[0].respawnAt);
  console.log("[deploy] Smoke passed: production page/assets, health, two-player WebSockets and public camp clocks.");
} finally {
  for (const room of rooms) await room.leave(true).catch(() => {});
  if (server) await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
