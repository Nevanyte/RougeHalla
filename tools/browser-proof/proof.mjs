// Browser-to-Rust proof (Stage 1): real Chromium pages speak protocol v1 over WSS to rh-server through the browser's own
// WebSocket API (the transport a Unity Web build's jslib bridge uses). Two players join, the match starts, a movement order
// is acknowledged, one player drops and resumes its seat, they fight, and both receive authoritative results.
//
//   cargo build -p rh-server && node tools/browser-proof/proof.mjs [--port 7443]
//
// TLS here is a SELF-SIGNED localhost certificate (the browser is told to accept it). A publicly valid certificate and DNS
// name are an external gate (docs/hosting/STAGING_EXPERIMENT.md). Prints one JSON report; exits non-zero on a failure.
import { spawn } from "node:child_process";
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

  const pa = await a.evaluate(() => ({ snapshots: window.__probe.snapshots, fx: window.__probe.fx, rtts: window.__probe.rtts, errors: window.__probe.errors, rejects: window.__probe.rejects }));
  const sorted = [...pa.rtts].sort((x, y) => x - y);
  report.measured = { snapshots: pa.snapshots, fxFrames: pa.fx, rttMsP50: sorted[sorted.length >> 1], rttMsMax: sorted[sorted.length - 1], pageErrors: pa.errors, rejects: pa.rejects };
  const info = await (await fetch(`https://localhost:${port}/info`).catch(() => null))?.json?.().catch(() => null);
  report.serverInfo = info;
  consoleErrors.length === 0 && pa.errors.length === 0 ? pass("no_page_errors") : fail("no_page_errors", JSON.stringify([consoleErrors, pa.errors]));
} catch (e) {
  fail("exception", String(e));
} finally {
  await browser.close();
  server.kill("SIGINT");
}
const failed = Object.values(report.checks).some((v) => typeof v === "string" && v.startsWith("FAIL"));
report.verdict = failed ? "FAIL" : "PASS";
console.log(JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
