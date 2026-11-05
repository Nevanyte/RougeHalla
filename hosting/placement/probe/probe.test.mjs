import test from "node:test";
import assert from "node:assert/strict";
import { measureRegion, probeRegions, median, bestLocal, calibrate, timeOnce } from "./probe.mjs";

// A fake clock-driven fetch: each call advances the fake clock by the scripted latency.
function harness(script) {
  let t = 0;
  let i = 0;
  const calls = [];
  const fetchImpl = async (url, init) => {
    const step = script[Math.min(i++, script.length - 1)];
    calls.push({ url, init });
    if (step === "fail") throw new Error("network");
    if (step === "html") return { ok: true, status: 200, text: async () => "<html>captive</html>" };
    t += step;
    return { ok: true, status: 200, text: async () => "pong" };
  };
  return { calls, opts: { fetchImpl, now: () => t, sleep: async () => {}, gapMs: 0 } };
}

test("median", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("warm-up is discarded and the median of 5 timed samples is reported (rounded up)", async () => {
  const h = harness([300, 40, 41, 90, 42, 43]); // first is the cold connection
  const r = await measureRegion("https://probe.example", h.opts);
  assert.equal(r.ok, true);
  assert.deepEqual(r.samplesMs, [40, 41, 90, 42, 43]);
  assert.equal(r.medianMs, 42);
  assert.equal(r.reportedMs, 42);
  assert.equal(r.spreadMs, 50);
  assert.equal(h.calls.length, 6);
});

test("every request is uncached and cross-origin safe: no-store, cors, no credentials, unique nonce, /ping path", async () => {
  const h = harness([10]);
  await measureRegion("https://probe.example/", h.opts);
  const urls = h.calls.map((c) => c.url);
  assert.ok(urls.every((u) => u.startsWith("https://probe.example/ping?n=")));
  assert.equal(new Set(urls).size, urls.length);
  for (const c of h.calls) assert.deepEqual([c.init.cache, c.init.mode, c.init.credentials], ["no-store", "cors", "omit"]);
});

test("two failures drop the region; one failure is tolerated", async () => {
  assert.equal((await measureRegion("https://p", harness([10, "fail", 20, 20, 20, 20]).opts)).ok, true);
  const dropped = await measureRegion("https://p", harness([10, "fail", "fail", 20, 20, 20]).opts);
  assert.equal(dropped.ok, false);
  assert.equal(dropped.reportedMs, null);
});

test("a wrong body (captive portal) is a failure, not a latency", async () => {
  const r = await measureRegion("https://p", harness(["html", "html", "html"]).opts);
  assert.equal(r.ok, false);
  await assert.rejects(timeOnce("https://p", harness(["html"]).opts));
});

test("a timeout aborts the request and counts as a failure", async () => {
  const fetchImpl = (url, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
  const r = await measureRegion("https://p", { fetchImpl, now: () => 0, sleep: async () => {}, timeoutMs: 5, gapMs: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.failures, 2);
});

test("regions are probed independently and reported as placement expects (ms or null)", async () => {
  const fast = harness([5]);
  const dead = harness(["fail"]);
  const regions = [{ id: "us-west-2", probeUrl: "https://a" }, { id: "ca-central-1", probeUrl: "https://b" }];
  const byUrl = { "https://a": fast.opts, "https://b": dead.opts };
  // probeRegions shares one opts object, so route by URL inside the fetch.
  const fetchImpl = (url, init) => (url.startsWith("https://a") ? fast.opts.fetchImpl(url, init) : dead.opts.fetchImpl(url, init));
  const out = await probeRegions(regions, { fetchImpl, now: () => 0, sleep: async () => {}, gapMs: 0 });
  assert.equal(out.rtt_ms["ca-central-1"], null);
  assert.equal(typeof out.rtt_ms["us-west-2"], "number");
  assert.deepEqual(bestLocal({ a: null, b: 30, c: 20 }), { id: "c", ms: 20 });
  assert.equal(bestLocal({ a: null }), null);
  void byUrl;
});

test("calibration agrees within tolerance and flags an edge-like discrepancy", () => {
  assert.equal(calibrate(62, 60).agrees, true);
  assert.equal(calibrate(14, 80).agrees, false, "a probe far faster than the game path means the probe hit a nearer cache");
  assert.equal(calibrate(2, 4).agrees, true, "tiny absolute differences are within the 5 ms floor");
});
