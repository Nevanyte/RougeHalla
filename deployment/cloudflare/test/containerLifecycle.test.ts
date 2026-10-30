import { describe, expect, it } from "vitest";
import { containerReleaseLabel, ensureContainerImage, isReadyServerBuild, type ImageManagedContainer } from "../src/containerLifecycle";

it("keeps release labels within the runtime limit and changes them for profile imports", async () => {
  const build = "a".repeat(64);
  expect(await containerReleaseLabel(build)).toBe(build);
  const first = await containerReleaseLabel(build, "import-1");
  expect(first).toHaveLength(64);
  expect(first).not.toBe(await containerReleaseLabel(build, "import-2"));
  expect(first).toBe(await containerReleaseLabel(build, "import-1"));
});

function fakeContainer(initiallyRunning: boolean, image: string, labels?: Record<string, string>) {
  const order: string[] = [];
  let running = initiallyRunning;
  let inspected = 0;
  let monitored = 0;
  const container: ImageManagedContainer = {
    get running() { return running; },
    async inspect() { inspected++; order.push("inspect"); return running ? { image, labels } : null; },
    signal(signal) { order.push(`signal:${signal}`); },
    monitor() { monitored++; order.push("monitor"); return Promise.resolve(); },
  };
  return {
    container,
    order,
    inspected: () => inspected,
    monitored: () => monitored,
    isRunning: () => running,
    setRunning: (value: boolean) => { running = value; },
  };
}

describe("Cloudflare container image lifecycle", () => {
  it("does not treat a healthy old server or unhealthy current server as a ready release", () => {
    expect(isReadyServerBuild(new Response("ok"), "new")).toBe(false);
    expect(isReadyServerBuild(new Response("ok", { headers: { "X-Rougehalla-Server-Build": "old" } }), "new")).toBe(false);
    expect(isReadyServerBuild(new Response("ok", { status: 503, headers: { "X-Rougehalla-Server-Build": "new" } }), "new")).toBe(false);
    expect(isReadyServerBuild(new Response("ok", { headers: { "X-Rougehalla-Server-Build": "new" } }), "new")).toBe(true);
  });

  it("keeps a running process only when both its image and release fingerprint match", async () => {
    const f = fakeContainer(true, "current", { serverBuild: "build-new" });
    let starts = 0;
    await ensureContainerImage(f.container, "current", () => { starts++; }, () => f.container.monitor(), 10, undefined, "build-new");
    expect(f.order).toEqual(["inspect"]);
    expect(starts).toBe(0);
  });

  it.each([undefined, { serverBuild: "build-old" }])("drains a stale release even when its image alias appears unchanged (%j)", async (labels) => {
    const f = fakeContainer(true, "current", labels);
    let starts = 0;
    await ensureContainerImage(
      f.container, "current",
      () => { expect(f.isRunning()).toBe(false); starts++; f.setRunning(true); },
      () => f.container.monitor(), 10,
      () => { f.container.signal(15); f.setRunning(false); },
      "build-new",
    );
    expect(f.order).toEqual(["inspect", "monitor", "signal:15"]);
    expect(starts).toBe(1);
  });

  it("keeps a running container whose inspected image matches the current Worker image", async () => {
    const f = fakeContainer(true, "registry/game@sha256:current");
    let starts = 0;
    await ensureContainerImage(f.container, "registry/game@sha256:current", () => { starts++; }, () => f.container.monitor(), 10);
    expect(f.order).toEqual(["inspect"]);
    expect(f.inspected()).toBe(1);
    expect(f.monitored()).toBe(0);
    expect(starts).toBe(0);
  });

  it("starts a stopped container directly with the current image", async () => {
    const f = fakeContainer(false, "old");
    let starts = 0;
    await ensureContainerImage(f.container, "current", () => { starts++; f.setRunning(true); }, () => f.container.monitor(), 10);
    expect(starts).toBe(1);
    expect(f.inspected()).toBe(0);
    expect(f.monitored()).toBe(0);
    expect(f.isRunning()).toBe(true);
  });

  it("sends SIGTERM and waits for the old process to exit before starting the new image", async () => {
    const f = fakeContainer(true, "registry/game@sha256:old");
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => { resolveExit = resolve; });
    const startedImages: string[] = [];
    const operation = ensureContainerImage(
      f.container,
      "registry/game@sha256:new",
      () => {
        expect(f.isRunning()).toBe(false);
        startedImages.push("registry/game@sha256:new");
        f.order.push("start:new");
        f.setRunning(true);
      },
      () => exited,
      100,
    );
    await Promise.resolve(); // inspect and enter the shutdown wait
    await Promise.resolve();
    expect(f.order).toEqual(["inspect", "signal:15"]);
    f.setRunning(false);
    resolveExit();
    await operation;
    expect(f.order).toEqual(["inspect", "signal:15", "start:new"]);
    expect(startedImages).toEqual(["registry/game@sha256:new"]);
  });

  it("fails closed on shutdown timeout and never starts an overlapping container", async () => {
    const f = fakeContainer(true, "registry/game@sha256:old");
    let starts = 0;
    await expect(ensureContainerImage(
      f.container,
      "registry/game@sha256:new",
      () => { starts++; },
      () => new Promise<void>(() => {}),
      5,
    )).rejects.toThrow(/did not stop cleanly/);
    expect(f.order).toEqual(["inspect", "signal:15"]);
    expect(f.isRunning()).toBe(true);
    expect(starts).toBe(0);
  });

  it("refuses to replace a running process when Cloudflare cannot report its image", async () => {
    const f = fakeContainer(true, "");
    let starts = 0;
    await expect(ensureContainerImage(f.container, "current", () => { starts++; }, () => f.container.monitor(), 10))
      .rejects.toThrow(/Cannot verify/);
    expect(f.order).toEqual(["inspect"]);
    expect(starts).toBe(0);
  });
});
