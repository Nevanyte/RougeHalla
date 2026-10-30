import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { mirrorSnapshotFile } from "../src/persistence/FileSnapshotMirror";

it("serializes snapshots and flushes the latest file before closing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-mirror-"));
  const file = path.join(dir, "bots.json");
  fs.writeFileSync(file, "initial");
  const writes: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const firstEntered = new Promise<void>((resolve) => { entered = resolve; });
  const mirror = mirrorSnapshotFile(file, { save: async (json) => { writes.push(json); if (writes.length === 1) { entered(); await blocked; } } });
  try {
    fs.writeFileSync(file, "first");
    const first = mirror.flush(); await firstEntered;
    fs.writeFileSync(file, "latest");
    const second = mirror.flush();
    release(); await Promise.all([first, second]);
    await mirror.close();
    expect(writes).toEqual(["first", "latest"]);
  } finally { release(); await mirror.close(); fs.rmSync(dir, { recursive: true }); }
});

it("retries a failed snapshot with the newest learning data on close", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-mirror-retry-"));
  const file = path.join(dir, "bots.json");
  let fail = true;
  const writes: string[] = [];
  const mirror = mirrorSnapshotFile(file, { save: async (json) => { if (fail) throw new Error("offline"); writes.push(json); } });
  try {
    fs.writeFileSync(file, "first");
    await expect(mirror.flush()).rejects.toThrow("offline");
    fs.writeFileSync(file, "latest"); fail = false;
    const closed = mirror.close(); expect(mirror.close()).toBe(closed); await closed;
    expect(writes).toEqual(["latest"]);
  } finally { await mirror.close(); fs.rmSync(dir, { recursive: true }); }
});
