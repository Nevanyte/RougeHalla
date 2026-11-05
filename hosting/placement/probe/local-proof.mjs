// Local proof of the browser-facing path, no cloud, no DNS writes, no spend (docs/hosting/TLS_DNS.md section 7, LATENCY_PROBES.md).
//
//   cargo build -p rh-server && node hosting/placement/probe/local-proof.mjs [--bin target/debug/rh-server]
//
// Prerequisites: a built rh-server, OpenSSL 3+ (Homebrew `openssl`; macOS' LibreSSL is not used), and for the Chromium part the
// npm package `playwright` resolvable from this script (it is not in this repository's package.json: install it anywhere and
// point NODE_PATH at its node_modules; the Chromium build must match, see tools/browser-proof/proof.mjs). Without it the Chromium
// checks are reported SKIPPED, never PASS.
//
// What it proves, and what it does NOT:
//  * rh-server serves WSS/HTTPS from `--tls-cert/--tls-key` PEM files (the production flag path) with a certificate for the
//    wildcard `*.g.rougehalla.test` plus localhost. Node verifies the real chain AND the hostname (SNI) against the CA:
//    a placement-style single-label name passes; a sibling name and a two-label name fail (why the design uses one label).
//  * A WSS upgrade over that verified connection returns 101. The probe module measures `/ping` over verified TLS.
//  * Chromium (certificate errors ignored: macOS offers no custom trust store without changing system settings, which this
//    script will not do) completes the page's WSS Hello/Welcome and ping-pong to a placement-style hostname on a non-443 port,
//    and the probe module times a CROSS-ORIGIN `/ping` (CORS) from that page; its median is compared with the page's own
//    WSS ping-pong median (calibration mechanism).
//  * NOT proven: a publicly trusted certificate in a real browser, real DNS, any real region, real Internet RTT. Loopback RTT is
//    well under 1 ms, so the calibration numbers here prove the mechanism only.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpsRequest } from "node:https";
import { randomBytes } from "node:crypto";
import { measureRegion, calibrate, median } from "./probe.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const flag = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const bin = resolve(repo, flag("bin", process.env.RH_SERVER_BIN || "target/debug/rh-server"));
const OPENSSL = existsSync("/opt/homebrew/bin/openssl") ? "/opt/homebrew/bin/openssl" : "openssl";
const dir = mkdtempSync(join(tmpdir(), "rh-edge-"));
const report = { server: bin, openssl: execFileSync(OPENSSL, ["version"]).toString().trim(), checks: {}, measured: {} };
const pass = (k, v = true) => { report.checks[k] = v; };
const fail = (k, why) => { report.checks[k] = `FAIL: ${why}`; };
const skip = (k, why) => { report.checks[k] = `SKIPPED: ${why}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ssl = (...a) => execFileSync(OPENSSL, a, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });

// ---- a local CA and a wildcard leaf (EC P-256, like the planned Let's Encrypt key type) ----
ssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "ca.key");
ssl("req", "-x509", "-new", "-key", "ca.key", "-sha256", "-days", "3", "-subj", "/CN=RH local test CA", "-out", "ca.pem",
  "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
ssl("genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-out", "leaf.key");
ssl("req", "-new", "-key", "leaf.key", "-subj", "/CN=wildcard.g.rougehalla.test", "-out", "leaf.csr");
writeFileSync(join(dir, "ext.cnf"), "subjectAltName=DNS:*.g.rougehalla.test,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature\n");
ssl("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-days", "2", "-sha256", "-extfile", "ext.cnf", "-out", "leaf.pem");
writeFileSync(join(dir, "chain.pem"), readFileSync(join(dir, "leaf.pem")) + readFileSync(join(dir, "ca.pem")).toString());
const ca = readFileSync(join(dir, "ca.pem"));
report.certificate = ssl("x509", "-in", "leaf.pem", "-noout", "-subject", "-ext", "subjectAltName", "-dates").toString().trim().split("\n");

// ---- servers: A and B stand for two regions; C uses the built-in self-signed flag ----
const procs = [];
async function start(port, tlsArgs) {
  const p = spawn(bin, ["--bind", `127.0.0.1:${port}`, ...tlsArgs, "--map", resolve(repo, "parity/maps/duel.map.json"), "--min-players", "2", "--fill-seconds", "0", "--lobby-seconds", "60"], { stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  p.stderr.on("data", (d) => { log += d; });
  procs.push(p);
  for (let i = 0; i < 100 && !log.includes("wss/https"); i++) await sleep(100);
  if (!log.includes("wss/https")) throw new Error(`server on ${port} did not start: ${log}`);
  // Listening is not ready; wait for /info state=ready (a Hello before it is refused).
  for (let i = 0; i < 100; i++) {
    const info = await new Promise((res) => httpsRequest({ host: "127.0.0.1", port, path: "/info", ca, servername: "localhost" }, (r) => { let b = ""; r.on("data", (d) => { b += d; }); r.on("end", () => { try { res(JSON.parse(b)); } catch { res(null); } }); }).on("error", () => res(null)).end());
    if (info?.state === "ready" || tlsArgs[0] === "--self-signed") return;
    await sleep(100);
  }
}
const base = 20000 + Math.floor(Math.random() * 20000);
const [pA, pB, pC] = [base, base + 1, base + 2];
const certArgs = ["--tls-cert", join(dir, "chain.pem"), "--tls-key", join(dir, "leaf.key")];

// Real verification: chain against our CA, hostname against the SNI name (connect to loopback, present `name`).
function verifiedGet(port, name, path = "/ping") {
  return new Promise((res) => {
    const req = httpsRequest({ host: "127.0.0.1", port, path, ca, servername: name, headers: { host: `${name}:${port}` } }, (r) => {
      let b = ""; r.on("data", (d) => { b += d; }); r.on("end", () => res({ ok: true, status: r.statusCode, body: b, headers: r.headers }));
    });
    req.on("error", (e) => res({ ok: false, error: e.code || String(e.message) }));
    req.end();
  });
}
function verifiedWsUpgrade(port, name) {
  return new Promise((res) => {
    const req = httpsRequest({ host: "127.0.0.1", port, path: "/ws", ca, servername: name, headers: { host: `${name}:${port}`, connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": randomBytes(16).toString("base64") } });
    req.on("upgrade", (r, sock) => { sock.destroy(); res({ ok: true, status: r.statusCode }); });
    req.on("response", (r) => res({ ok: false, status: r.statusCode }));
    req.on("error", (e) => res({ ok: false, error: e.code || String(e.message) }));
    req.end();
  });
}

try {
  await start(pA, certArgs);
  await start(pB, certArgs);
  await start(pC, ["--self-signed"]);

  const hostA = "us-west-2-me6lguklsmky.g.rougehalla.test"; // the shape hostname.mjs produces
  const hostB = "ca-central-1-ur6iblost56t.g.rougehalla.test";
  const good = await verifiedGet(pA, hostA);
  good.ok && good.status === 200 && good.body === "pong" && good.headers["cache-control"] === "no-store" && good.headers["access-control-allow-origin"] === "*"
    ? pass("wildcard_cert_verifies_for_a_placement_hostname_on_a_non_443_port", { host: hostA, port: pA, cacheControl: good.headers["cache-control"], cors: good.headers["access-control-allow-origin"] })
    : fail("wildcard_cert_verifies_for_a_placement_hostname_on_a_non_443_port", JSON.stringify(good));
  const sibling = await verifiedGet(pA, "www.rougehalla.test");
  const twoLabel = await verifiedGet(pA, `x.${hostA}`);
  !sibling.ok && !twoLabel.ok ? pass("hostnames_outside_the_single_label_wildcard_are_refused", { sibling: sibling.error, twoLabel: twoLabel.error }) : fail("hostnames_outside_the_single_label_wildcard_are_refused", JSON.stringify({ sibling, twoLabel }));
  const wrongCa = await new Promise((res) => httpsRequest({ host: "127.0.0.1", port: pA, path: "/ping", servername: hostA }, () => res({ ok: true })).on("error", (e) => res({ ok: false, error: e.code })).end());
  !wrongCa.ok ? pass("untrusted_chain_is_refused_without_our_ca", wrongCa.error) : fail("untrusted_chain_is_refused_without_our_ca", "connected without trusting the CA");
  const up = await verifiedWsUpgrade(pA, hostA);
  up.ok && up.status === 101 ? pass("wss_upgrade_101_over_verified_tls", up) : fail("wss_upgrade_101_over_verified_tls", JSON.stringify(up));

  // The probe module in a Node child so NODE_EXTRA_CA_CERTS / REJECT_UNAUTHORIZED apply to its fetch.
  const probeChild = (url, env) => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { measureRegion } from ${JSON.stringify(new URL("./probe.mjs", import.meta.url).href)};
    const r = await measureRegion(${JSON.stringify(url)}, { gapMs: 20 });
    console.log(JSON.stringify(r));`], { env: { ...process.env, ...env } }).toString());
  const viaCa = probeChild(`https://localhost:${pA}`, { NODE_EXTRA_CA_CERTS: join(dir, "ca.pem") });
  viaCa.ok && viaCa.samplesMs.length === 5 ? pass("probe_over_verified_tls_to_the_game_process", { medianMs: viaCa.medianMs, spreadMs: viaCa.spreadMs }) : fail("probe_over_verified_tls_to_the_game_process", JSON.stringify(viaCa));
  const viaSelf = probeChild(`https://localhost:${pC}`, { NODE_TLS_REJECT_UNAUTHORIZED: "0" });
  viaSelf.ok ? pass("probe_over_the_built_in_self_signed_listener", { medianMs: viaSelf.medianMs, trust: "NODE_TLS_REJECT_UNAUTHORIZED=0 in the probe child only" }) : fail("probe_over_the_built_in_self_signed_listener", JSON.stringify(viaSelf));
  const refused = probeChild(`https://localhost:${pC}`, {});
  !refused.ok && refused.reportedMs === null ? pass("self_signed_is_refused_without_the_trust_override_so_probes_cannot_silently_measure_a_wrong_endpoint") : fail("self_signed_is_refused_without_the_trust_override_so_probes_cannot_silently_measure_a_wrong_endpoint", JSON.stringify(refused));

  // Chromium.
  let chromium = null;
  try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* reported below */ }
  if (!chromium) {
    skip("chromium_wss_to_placement_hostname", "npm package `playwright` is not resolvable (set NODE_PATH); see the header of this file");
  } else {
    const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP *.g.rougehalla.test 127.0.0.1`] });
    try {
      report.browser = (await browser.newContext()).browser().version();
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`https://${hostA}:${pA}/probe?profile=calibA&faction=0`);
      await page.waitForFunction(() => window.__probe.welcome && window.__probe.rtts.length >= 12, null, { timeout: 15000 });
      const welcome = await page.evaluate(() => window.__probe.welcome);
      pass("chromium_wss_hello_welcome_to_a_placement_hostname_on_a_non_443_port", { url: `wss://${hostA}:${pA}/ws`, player: welcome.player, tick: welcome.tick });
      const src = readFileSync(new URL("./probe.mjs", import.meta.url), "utf8").replace(/^export /gm, "");
      const fromPage = await page.evaluate(async ({ src, own, other }) => {
        const m = new Function(`${src}; return { measureRegion };`)();
        return { own: await m.measureRegion(own, { gapMs: 20 }), cross: await m.measureRegion(other, { gapMs: 20 }) };
      }, { src, own: `https://${hostA}:${pA}`, other: `https://${hostB}:${pB}` });
      fromPage.own.ok && fromPage.cross.ok ? pass("browser_probe_same_origin_and_cross_origin_cors", { ownMs: fromPage.own.medianMs, crossOriginMs: fromPage.cross.medianMs }) : fail("browser_probe_same_origin_and_cross_origin_cors", JSON.stringify(fromPage));
      const rtts = await page.evaluate(() => window.__probe.rtts.slice(2));
      const wssMed = median(rtts);
      const cal = calibrate(fromPage.own.medianMs, wssMed);
      cal.agrees ? pass("calibration_probe_vs_wss_pingpong_loopback_mechanism_only", { ...cal, wssSamples: rtts.length }) : fail("calibration_probe_vs_wss_pingpong_loopback_mechanism_only", JSON.stringify(cal));
      report.measured.browser = { probeOwnMedianMs: fromPage.own.medianMs, probeCrossOriginMedianMs: fromPage.cross.medianMs, wssPingPongMedianMs: wssMed, pageErrors: errors };
      errors.length === 0 ? pass("no_page_errors") : fail("no_page_errors", JSON.stringify(errors));
    } finally {
      await browser.close();
    }
  }
} catch (e) {
  fail("exception", String(e.stack || e));
} finally {
  for (const p of procs) p.kill("SIGINT");
  await Promise.race([Promise.all(procs.map((p) => new Promise((r) => p.once("exit", r)))), sleep(20000)]);
}
const failed = Object.values(report.checks).some((v) => typeof v === "string" && v.startsWith("FAIL"));
report.verdict = failed ? "FAIL" : "PASS";
console.log(JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
