// Browser-to-Rust proof (Stage 1): real Chromium pages speak protocol v7 (Full and delta snapshots) over WSS to rh-server through the browser's own
// WebSocket API (the transport a Unity Web build's jslib bridge uses). Two players join, the match starts, a movement order
// is acknowledged, one player drops and resumes its seat, they fight, and both receive authoritative results.
//
//   cargo build -p rh-server && node tools/browser-proof/proof.mjs [--port 7443]
//
// TLS here is a SELF-SIGNED localhost certificate (the browser is told to accept it). A publicly valid certificate and DNS
// name are an external gate (docs/hosting/STAGING_EXPERIMENT.md). Prints one JSON report; exits non-zero on a failure.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 7443;
const bin = resolve(repo, process.env.RH_SERVER_BIN || "target/debug/rh-server");
const report = { server: bin, url: `https://localhost:${port}/probe`, tls: "self-signed (ignoreHTTPSErrors)", checks: {}, measured: {} };
const fail = (k, why) => { report.checks[k] = `FAIL: ${why}`; };
const pass = (k, detail = true) => { report.checks[k] = detail; };

const server = spawn(bin, ["--bind", `127.0.0.1:${port}`, "--self-signed", "--map", resolve(repo, "parity/maps/duel.map.json"),
  "--min-players", "2", "--fill-seconds", "0", "--lobby-seconds", "30"], { stdio: ["ignore", "ignore", "pipe"] });
let log = "";
server.stderr.on("data", (d) => { log += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !log.includes("wss/https"); i++) await sleep(100);
// Listening is not ready: until the server marks itself ready it answers a Hello with "server draining". Poll /info for it.
const { get } = await import("node:https");
const info = () => new Promise((res) => get({ host: "127.0.0.1", port, path: "/info", rejectUnauthorized: false }, (r) => { let b = ""; r.on("data", (d) => { b += d; }); r.on("end", () => { try { res(JSON.parse(b)); } catch { res(null); } }); }).on("error", () => res(null)));
for (let i = 0; i < 100 && (await info())?.state !== "ready"; i++) await sleep(100);

const browser = await chromium.launch();
const ctxA = await browser.newContext({ ignoreHTTPSErrors: true });
const ctxB = await browser.newContext({ ignoreHTTPSErrors: true });
const a = await ctxA.newPage();
const b = await ctxB.newPage();
const consoleErrors = [];
for (const p of [a, b]) p.on("pageerror", (e) => consoleErrors.push(String(e)));
try {
  const ver = await a.evaluate(async () => navigator.userAgent);
  report.browser = ver;
  await a.goto(`https://localhost:${port}/probe?profile=webAlpha&faction=0`);
  await b.goto(`https://localhost:${port}/probe?profile=webBravo&faction=4`);
  const wait = (page, fn, ms = 15000) => page.waitForFunction(fn, null, { timeout: ms });

  // Admission and the canonical map over WSS.
  await wait(a, () => window.__probe.welcome && window.__probe.snapshots > 3);
  await wait(b, () => window.__probe.welcome && window.__probe.snapshots > 3);
  const wa = await a.evaluate(() => window.__probe.welcome);
  const wb = await b.evaluate(() => window.__probe.welcome);
  wa.player !== wb.player && wa.mapHash === wb.mapHash ? pass("admission_and_map", { a: wa, b: wb }) : fail("admission_and_map", JSON.stringify([wa, wb]));

  // The run starts (both humans in: min-players 2).
  await wait(a, () => window.__probe.phase === 1);
  pass("run_started");
  await wait(a, () => window.__probe.firstStateAfterWelcome.length === 1);
  const state0 = await a.evaluate(() => ({frames:window.__probe.stateFrames,first:window.__probe.firstStateAfterWelcome,keys:Object.keys(window.__probe.collections)}));
  state0.first[0].join() === "1,2,3,4,5,6,7" && state0.keys.join() === "1,2,3,4,5,6,7" ? pass("join_receives_complete_reliable_state",state0) : fail("join_receives_complete_reliable_state",JSON.stringify(state0));

  // Protocol 6: the first snapshot of a connection is Full, and the stream that follows is deltas the page's own decoder applies.
  await wait(a, () => window.__probe.deltaSnapshots > 20);
  const kinds = await a.evaluate(() => ({ first: window.__probe.firstSnapshotAfterWelcome, full: window.__probe.fullSnapshots, delta: window.__probe.deltaSnapshots, refused: window.__probe.refused, resyncs: window.__probe.resyncs }));
  const info0 = await a.evaluate(() => fetch("/info", { cache: "no-store" }).then((r) => r.json()));
  info0.protocol === 7 && kinds.first[0] === "full" && kinds.delta > kinds.full && kinds.refused.length === 0 && kinds.resyncs === 0
    ? pass("protocol_7_full_first_then_deltas", { protocol: info0.protocol, ...kinds }) : fail("protocol_7_full_first_then_deltas", JSON.stringify([info0.protocol, kinds]));

  // A resync request is answered with a Full snapshot, and deltas continue from it.
  const f0 = await a.evaluate(() => window.__probe.fullSnapshots);
  await a.evaluate(() => window.__probe.requestResync());
  await a.waitForFunction((n) => window.__probe.fullSnapshots > n, f0, { timeout: 5000 });
  await a.waitForFunction((n) => window.__probe.stateFrames > n, state0.frames, {timeout:5000});
  pass("resync_refreshes_reliable_state");
  const d0 = await a.evaluate(() => window.__probe.deltaSnapshots);
  await a.waitForFunction((n) => window.__probe.deltaSnapshots > n + 5, d0, { timeout: 5000 });
  const rs = await a.evaluate(() => ({ full: window.__probe.fullSnapshots, refused: window.__probe.refused }));
  rs.full === f0 + 1 && rs.refused.length === 0 ? pass("resync_answered_with_one_full_snapshot", rs) : fail("resync_answered_with_one_full_snapshot", JSON.stringify([f0, rs]));

  // The review's failing sequence: right after that forced Full the page loses its snapshot, so the next delta is refused and it
  // asks again inside the server's 20-tick interval. The request is deferred, never dropped: one more Full frame arrives, from
  // the one Resync (no client retry needed), and deltas apply again.
  const r0 = await a.evaluate(() => ({ full: window.__probe.fullSnapshots, resyncs: window.__probe.resyncs, refused: window.__probe.refused.length }));
  await a.evaluate(() => window.__probe.loseSnapshot());
  await a.waitForFunction((n) => window.__probe.fullSnapshots > n, r0.full, { timeout: 5000 });
  const d1 = await a.evaluate(() => window.__probe.deltaSnapshots);
  await a.waitForFunction((n) => window.__probe.deltaSnapshots > n + 5, d1, { timeout: 5000 });
  const r1 = await a.evaluate(() => ({ full: window.__probe.fullSnapshots, resyncs: window.__probe.resyncs, refused: window.__probe.refused.length, errors: window.__probe.errors.length }));
  r1.full === r0.full + 1 && r1.resyncs === r0.resyncs + 1 && r1.refused > r0.refused && r1.errors === 0
    ? pass("refusal_inside_the_interval_still_gets_a_full_snapshot", { before: r0, after: r1 }) : fail("refusal_inside_the_interval_still_gets_a_full_snapshot", JSON.stringify([r0, r1]));

  // A movement order is applied by the server and acknowledged (move_seq echo), and the server position changes.
  const before = await a.evaluate(() => window.__probe.me);
  const seq = await a.evaluate(() => window.__probe.move(window.__probe.me.x, window.__probe.me.y + 64));
  await wait(a, (s) => window.__probe.me && window.__probe.me.moveSeq === s && window.__probe.me.y > 150, 5000).catch(() => {});
  const after = await a.evaluate(() => window.__probe.me);
  after.moveSeq === seq && after.y > before.y ? pass("input_applied_and_acked", { seq, y0: before.y, y1: after.y }) : fail("input_applied_and_acked", JSON.stringify({ seq, before, after }));

  // Reconnect: bravo drops its socket and resumes the same seat with its session token.
  await b.evaluate(() => window.__probe.dropAndResume());
  await wait(b, () => window.__probe.resumes === 1 && window.__probe.open);
  const wb2 = await b.evaluate(() => window.__probe.welcome);
  wb2.player === wb.player ? pass("reconnect_same_seat", { player: wb2.player }) : fail("reconnect_same_seat", JSON.stringify(wb2));
  // A resumed connection always starts with a Full snapshot (its decoder holds nothing, whatever the old connection had).
  await wait(b, () => window.__probe.firstSnapshotAfterWelcome.length === 2 && window.__probe.deltaSnapshots > 0);
  const bk = await b.evaluate(() => ({ first: window.__probe.firstSnapshotAfterWelcome, refused: window.__probe.refused, resyncs: window.__probe.resyncs }));
  bk.first.join() === "full,full" && bk.refused.length === 0 && bk.resyncs === 0 ? pass("resume_starts_with_a_full_snapshot", bk) : fail("resume_starts_with_a_full_snapshot", JSON.stringify(bk));

  await wait(b, () => window.__probe.firstStateAfterWelcome.length === 2);
  const resumedState = await b.evaluate(() => window.__probe.firstStateAfterWelcome);
  resumedState.every(keys => keys.join() === "1,2,3,4,5,6,7") ? pass("resume_refreshes_all_state_keys",resumedState) : fail("resume_refreshes_all_state_keys",JSON.stringify(resumedState));

  // Fight to the end: both hold attack toward each other; the server decides the outcome.
  for (const [page, other] of [[a, wb.player], [b, wa.player]]) {
    await page.evaluate((otherId) => {
      setInterval(() => {
        const P = window.__probe; const o = P.actors.find((x) => x.id === otherId);
        if (P.me && o) P.attack(Math.atan2(o.y - P.me.y, o.x - P.me.x));
      }, 100);
    }, other);
  }
  await wait(a, () => window.__probe.results.length > 0, 60000);
  await wait(b, () => window.__probe.results.length > 0, 60000);
  const ra = await a.evaluate(() => window.__probe.results[0]);
  const rb = await b.evaluate(() => window.__probe.results[0]);
  const ok = ra.outcome === 2 && rb.outcome === 0 && ra.place === 2 && rb.place === 1;
  ok ? pass("authoritative_results", { alpha: ra, bravo: rb }) : fail("authoritative_results", JSON.stringify({ ra, rb }));

  // Protocol 6: the player's own Result is kept on its seat. Alpha resumes after its run resolved and receives that Result again
  // (identical), instead of never.
  await a.evaluate(() => window.__probe.dropAndResume());
  await wait(a, () => window.__probe.resumes === 1 && window.__probe.open);
  await wait(a, () => window.__probe.results.length >= 2, 10000).catch(() => {});
  const resent = await a.evaluate(() => window.__probe.results);
  resent.length >= 2 && JSON.stringify(resent[1]) === JSON.stringify(resent[0])
    ? pass("resume_after_the_run_resolved_resends_the_result", { result: resent[1] }) : fail("resume_after_the_run_resolved_resends_the_result", JSON.stringify(resent));

  const pa = await a.evaluate(() => ({ joinMs: window.__probe.joinMs, snapshots: window.__probe.snapshots, fullSnapshots: window.__probe.fullSnapshots, deltaSnapshots: window.__probe.deltaSnapshots, resyncs: window.__probe.resyncs, refusedDeltas: window.__probe.refused, fx: window.__probe.fx, rtts: window.__probe.rtts, errors: window.__probe.errors, rejects: window.__probe.rejects }));
  const sorted = [...pa.rtts].sort((x, y) => x - y);
  const resumeMs = await b.evaluate(() => window.__probe.resumeMs);
  report.measured = { joinMs: pa.joinMs, resumeHelloToWelcomeMs: resumeMs, snapshots: pa.snapshots, fullSnapshots: pa.fullSnapshots, deltaSnapshots: pa.deltaSnapshots, resyncs: pa.resyncs, refusedDeltas: pa.refusedDeltas, fxFrames: pa.fx, rttMsP50: sorted[sorted.length >> 1], rttMsMax: sorted[sorted.length - 1], pageErrors: pa.errors, rejects: pa.rejects };
  report.serverInfo = await a.evaluate(() => fetch("/info", { cache: "no-store" }).then((r) => r.json()));
  consoleErrors.length === 0 && pa.errors.length === 0 ? pass("no_page_errors") : fail("no_page_errors", JSON.stringify([consoleErrors, pa.errors]));
  const vectors = JSON.parse(readFileSync(resolve(repo, "protocol/fixtures/v7.json"), "utf8"));
  const mismatch = await a.evaluate((hex) => {
    const bytes = Uint8Array.from(hex.match(/../g), h => parseInt(h, 16)); bytes[1] = 4;
    const before = JSON.stringify({ welcome: window.__probe.welcome, snapshots: window.__probe.snapshots, base: tracker.base });
    ws.onmessage({ data: bytes.buffer });
    // Even a subsequently queued valid Welcome cannot revive this rejected connection.
    bytes[1] = 6; ws.onmessage({ data: bytes.buffer });
    return { preserved: before === JSON.stringify({ welcome: window.__probe.welcome, snapshots: window.__probe.snapshots, base: tracker.base }), reject: window.__probe.rejects.at(-1), closing: ws.readyState >= 2 };
  }, vectors.server.find(v => v.name === "welcome").hex);
  mismatch.preserved && mismatch.reject?.code === 1 && mismatch.closing ? pass("wrong_protocol_welcome_refused_before_state", mismatch) : fail("wrong_protocol_welcome_refused_before_state", JSON.stringify(mismatch));

} catch (e) {
  fail("exception", String(e));
  // What each page saw, to tell a refused connection from a stalled one.
  report.pageState = await Promise.all([a, b].map((p) => p.evaluate(() => { const P = window.__probe || {}; return { welcome: P.welcome, snapshots: P.snapshots, errors: P.errors, rejects: P.rejects, refused: P.refused, open: P.open }; }).catch(() => null)));
} finally {
  await browser.close();
  server.kill("SIGINT");
  // SIGINT starts a graceful drain: wait for the exit so a run right after this one finds its port free.
  await Promise.race([new Promise((res) => server.once("exit", res)), sleep(20000)]);
}
const failed = Object.values(report.checks).some((v) => typeof v === "string" && v.startsWith("FAIL"));
report.verdict = failed ? "FAIL" : "PASS";
console.log(JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
