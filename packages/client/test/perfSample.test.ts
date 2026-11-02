import { describe, expect, it } from "vitest";
import { sanitizeClientPerf } from "@raid/shared";
import { PerfSampler, uaBucket } from "../src/net/perfSample";

describe("perfSample", () => {
  it("histograms frame times, skips hidden gaps and pings every 2 s", () => {
    const s = new PerfSampler();
    const pings: Array<(ms: number) => void> = [];
    const room = { ping: (cb: (ms: number) => void) => { pings.push(cb); }, connection: { isOpen: true } };
    let t = 0;
    for (let i = 0; i < 100; i++) { s.frame(t, room, 85); t += 7; }
    s.frame(t + 60, room, 85); // one long frame
    t += 60 + 5000; // a hidden tab
    s.frame(t, room, 85);
    for (let i = 0; i < 20; i++) { t += 7; s.frame(t, room, 85); }
    pings.forEach((cb, i) => cb(40 + i));
    const out = s.toSample({ dpr: 2, canvasW: 1920, canvasH: 1080, ua: "Mozilla/5.0 Chrome/140.0 Safari/537.36" });
    expect(out.frameMsP95).toBe(7.5);
    expect(out.fpsP50).toBe(133.3);
    expect(out.longFrames).toBe(1);
    expect(out.hiddenSec).toBe(5);
    expect(out.rttSamples).toBe(1); // the first ping timed out across the hidden gap: its late reply is dropped
    expect(out.rttP50).toBeGreaterThan(0);
    expect(out.interpDelayMs).toBe(85);
    expect(out.ua).toBe("chrome");
    expect(sanitizeClientPerf(out)).toEqual(out);
  });

  it("reset starts a new run's sample; the UA bucket never carries the string", () => {
    const s = new PerfSampler();
    s.frame(0, null);
    s.frame(10, null);
    s.reset();
    expect(s.toSample().frameMsP95).toBeUndefined();
    expect(uaBucket("Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/18 Safari/605.1.15")).toBe("safari");
    expect(uaBucket("Mozilla/5.0 Gecko/20100101 Firefox/140.0")).toBe("firefox");
    expect(uaBucket("curl/8")).toBe("other");
  });
});
