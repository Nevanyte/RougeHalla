"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { REQUIRED_CHECKS, evaluateReport } = require("./contract.cjs");

// These are synthetic schema fixtures only. They are never browser or gameplay evidence.
function syntheticMetadataFixture() {
  const checks = Object.fromEntries(REQUIRED_CHECKS.map(name => [name, { status: "PASS", evidence: `synthetic:${name}` }]));
  return {
    schema: "roguehalla-unity-web14-ui-proof/1",
    identities: {
      source: "a3d4b3ce575442c9a06916888035ca849a6cd05a",
      protocol: 14,
      contentHash: "643d294869db55a4",
      server: {
        sha256: "0b08727ba9cc7a5850e10f09e0737042937b865ee47dd29f1afc67abbbc242eb",
        info: { protocol: 14, contentHash: "643d294869db55a4" },
      },
      artifact: {
        manifestSha256: "c5a10239a43d339f033de943f28df987401c40226d259290f221f6213acd0434",
        verifiedFiles: 14,
        fileCount: 14,
        bytes: 106765469,
        unchangedAfter: true,
      },
      browser: { version: "synthetic Chrome identity", renderer: "synthetic renderer identity" },
      resolution: { width: 1920, height: 1080, canvasWidth: 1920, canvasHeight: 1080 },
    },
    policy: {
      ordinary: true,
      diagnostic: false,
      syntheticProfilesOnly: true,
      noWorldInjection: true,
      privateWorldHooks: false,
    },
    checks,
    screenshots: [{
      path: "screenshots/synthetic-placeholder.png",
      sha256: "a".repeat(64),
      width: 1920,
      height: 1080,
      bytes: 1234,
    }],
    errors: { pageErrors: [], unityErrors: [], observerErrors: [] },
    cleanup: { browserClosed: true, serverStopped: true, postgresStopped: true, noOwnedListeners: true },
    limits: { planningJ: false, engine25: false, performance: false, completeMatchBanking: false },
  };
}

test("accepts a fully pinned, clean report when every required check passes", () => {
  assert.deepEqual(evaluateReport(syntheticMetadataFixture()), { status: "PASS", failures: [], open: [] });
});

test("reports explicitly open checks as partial rather than passing", () => {
  const report = syntheticMetadataFixture();
  report.checks.planning.status = "OPEN";
  const result = evaluateReport(report);
  assert.equal(result.status, "PARTIAL");
  assert.deepEqual(result.open, ["planning"]);
  assert.deepEqual(result.failures, []);
});

test("a declared failed check fails the report", () => {
  const report = syntheticMetadataFixture();
  report.checks.reconnect.status = "FAIL";
  const result = evaluateReport(report);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.includes("check reconnect failed"));
});

test("rejects protocol 13, wrong source/server, and wrong artifact pins", () => {
  const mutations = [
    report => { report.identities.protocol = 13; },
    report => { report.identities.source = "0".repeat(40); },
    report => { report.identities.server.sha256 = "0".repeat(64); },
    report => { report.identities.server.info.protocol = 13; },
    report => { report.identities.artifact.manifestSha256 = "0".repeat(64); },
    report => { report.identities.artifact.verifiedFiles = 13; },
    report => { report.identities.artifact.bytes++; },
  ];
  for (const mutate of mutations) {
    const report = syntheticMetadataFixture(); mutate(report);
    assert.equal(evaluateReport(report).status, "FAIL");
  }
});

test("rejects diagnostic, injected-action, and private-hook policy", () => {
  for (const [key, value] of [["ordinary", false], ["diagnostic", true], ["syntheticProfilesOnly", false],
    ["noWorldInjection", false], ["privateWorldHooks", true]]) {
    const report = syntheticMetadataFixture(); report.policy[key] = value;
    assert.equal(evaluateReport(report).status, "FAIL", `policy.${key}`);
  }
});

test("rejects missing checks and invalid check status", () => {
  const missing = syntheticMetadataFixture(); delete missing.checks.drawer;
  assert.equal(evaluateReport(missing).status, "FAIL");
  const invalid = syntheticMetadataFixture(); invalid.checks.planning.status = "SKIPPED";
  assert.equal(evaluateReport(invalid).status, "FAIL");
});

test("rejects missing or mismatched screenshot evidence metadata", () => {
  const noShots = syntheticMetadataFixture(); noShots.screenshots = [];
  assert.equal(evaluateReport(noShots).status, "FAIL");
  const wrongDimensions = syntheticMetadataFixture(); wrongDimensions.screenshots[0].width = 1280;
  assert.equal(evaluateReport(wrongDimensions).status, "FAIL");
  const badHash = syntheticMetadataFixture(); badHash.screenshots[0].sha256 = "not-a-hash";
  assert.equal(evaluateReport(badHash).status, "FAIL");
  const unsafePath = syntheticMetadataFixture(); unsafePath.screenshots[0].path = "../outside.png";
  assert.equal(evaluateReport(unsafePath).status, "FAIL");
});

test("rejects a native canvas whose dimensions differ from the pinned viewport", () => {
  const report = syntheticMetadataFixture();
  report.identities.resolution.canvasWidth = 2560;
  report.identities.resolution.canvasHeight = 1440;
  assert.equal(evaluateReport(report).status, "FAIL");
});

test("rejects runtime errors and incomplete cleanup", () => {
  const withError = syntheticMetadataFixture(); withError.errors.unityErrors.push("synthetic failure");
  assert.equal(evaluateReport(withError).status, "FAIL");
  const cleanup = syntheticMetadataFixture(); cleanup.cleanup.serverStopped = false;
  assert.equal(evaluateReport(cleanup).status, "FAIL");
  const missingCleanup = syntheticMetadataFixture(); delete missingCleanup.cleanup.postgresStopped;
  assert.equal(evaluateReport(missingCleanup).status, "FAIL");
});

test("rejects absent or non-object reports", () => {
  assert.equal(evaluateReport(null).status, "FAIL");
  assert.equal(evaluateReport({}).status, "FAIL");
});
