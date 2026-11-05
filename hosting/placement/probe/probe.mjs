// Regional latency probe. Browser-compatible ES module (no Node-only imports): `fetch`, `performance.now`, `AbortController`.
//
// What it measures: the HTTPS round trip to `GET <probeUrl>/ping` on OUR game process (crates/rh-server/src/lib.rs: body "pong",
// `Cache-Control: no-store`, CORS `*`) over the same path class the game's WebSocket uses. It never targets a CDN or edge cache:
// the probe hostnames are DNS-only A records pointing at game hosts, so the TLS endpoint is the origin's own certificate
// (docs/hosting/TLS_DNS.md). Procedure per docs/hosting/LATENCY_PROBES.md: one warm-up (DNS + TCP + TLS), then N timed requests on
// the then-warm connection, median reported, a region with 2+ failures reported as unreachable (null).
//
// The result feeds `MemberReport.rtt_ms` of crates/rh-placement (integer ms, null = unreachable).

export const DEFAULTS = Object.freeze({ warmups: 1, samples: 5, gapMs: 150, timeoutMs: 3000, maxFailures: 1, minGoodSamples: 3 });

export function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One timed request. Resolves to ms, or throws. The body is read so the time includes the full response. */
export async function timeOnce(url, { fetchImpl = globalThis.fetch, now = () => performance.now(), timeoutMs = DEFAULTS.timeoutMs, nonce } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const u = `${url.replace(/\/+$/, "")}/ping?n=${nonce}`;
    const t0 = now();
    const res = await fetchImpl(u, { cache: "no-store", mode: "cors", credentials: "omit", signal: ctl.signal });
    const body = await res.text();
    const ms = now() - t0;
    // A captive portal or an unrelated server answers something else: that is a failure, not a latency.
    if (!res.ok || body !== "pong") throw new Error(`unexpected response ${res.status}`);
    return ms;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Measure one region. Never throws: failures are data.
 * @returns {{ok:boolean, medianMs:number|null, spreadMs:number|null, samplesMs:number[], failures:number, reportedMs:number|null}}
 */
export async function measureRegion(probeUrl, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const timed = [];
  let failures = 0;
  let seq = 0;
  const nonce = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  for (let i = 0; i < o.warmups + o.samples; i++) {
    const warm = i < o.warmups;
    try {
      const ms = await timeOnce(probeUrl, { ...o, nonce: nonce() });
      if (!warm) timed.push(ms);
    } catch {
      failures++;
      if (failures > o.maxFailures) break;
    }
    if (i < o.warmups + o.samples - 1) await (o.sleep ?? sleep)(o.gapMs);
  }
  const ok = failures <= o.maxFailures && timed.length >= o.minGoodSamples;
  const med = ok ? median(timed) : null;
  return {
    ok,
    medianMs: med,
    spreadMs: ok ? Math.max(...timed) - Math.min(...timed) : null,
    samplesMs: timed,
    failures,
    // What placement receives: whole ms, rounded up (never under-report a region's latency).
    reportedMs: med === null ? null : Math.ceil(med),
  };
}

/**
 * Probe every region in parallel (regions are independent paths; each region's own samples stay sequential).
 * @param {{id:string, probeUrl:string}[]} regions
 * @returns {Promise<{rtt_ms: Record<string, number|null>, detail: Record<string, object>, measuredAt: number}>}
 */
export async function probeRegions(regions, opts = {}) {
  const results = await Promise.all(regions.map(async (r) => [r.id, await measureRegion(r.probeUrl, opts)]));
  return {
    rtt_ms: Object.fromEntries(results.map(([id, m]) => [id, m.reportedMs])),
    detail: Object.fromEntries(results),
    measuredAt: Date.now(),
  };
}

/** Which region the client would pick on its own (the lowest reported RTT), for the "Auto" label. Placement does the real choice. */
export function bestLocal(rtt) {
  let best = null;
  for (const [id, ms] of Object.entries(rtt)) if (ms !== null && (best === null || ms < best.ms)) best = { id, ms };
  return best;
}

/**
 * Calibration check: compare the probe's median with the in-game WSS ping-pong median for the same client and region.
 * Agreement within `toleranceMs` (default max(5 ms, 15%)) means the probe measures the game path.
 */
export function calibrate(probeMedianMs, wssMedianMs, { toleranceMs } = {}) {
  const tol = toleranceMs ?? Math.max(5, 0.15 * Math.max(probeMedianMs, wssMedianMs));
  const diff = probeMedianMs - wssMedianMs;
  return { probeMedianMs, wssMedianMs, diffMs: diff, toleranceMs: tol, agrees: Math.abs(diff) <= tol };
}
