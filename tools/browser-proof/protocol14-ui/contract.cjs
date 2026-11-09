"use strict";

const path = require("node:path");

const PIN = Object.freeze({
  schema: "roguehalla-unity-web14-ui-proof/1",
  source: "a3d4b3ce575442c9a06916888035ca849a6cd05a",
  protocol: 14,
  contentHash: "643d294869db55a4",
  serverSha256: "0b08727ba9cc7a5850e10f09e0737042937b865ee47dd29f1afc67abbbc242eb",
  artifactManifestSha256: "c5a10239a43d339f033de943f28df987401c40226d259290f221f6213acd0434",
  artifactFiles: 14,
  artifactBytes: 106765469,
});

const REQUIRED_CHECKS = Object.freeze([
  "menu",
  "profile",
  "ordinaryJoin",
  "authoritativeSnapshots",
  "authoritativeInput",
  "reconnect",
  "hud",
  "help",
  "journalActive",
  "drawer",
  "planning",
  "renderHeartbeat",
]);

const REQUIRED_CLEANUP = Object.freeze([
  "browserClosed",
  "serverStopped",
  "postgresStopped",
  "noOwnedListeners",
]);

const REQUIRED_LIMITS = Object.freeze([
  "planningJ",
  "engine25",
  "performance",
  "completeMatchBanking",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function addFailure(failures, message) {
  failures.push(message);
}

function evaluateReport(report) {
  const failures = [];
  const open = [];

  if (!isRecord(report)) {
    return { status: "FAIL", failures: ["report must be an object"], open };
  }

  if (report.schema !== PIN.schema) addFailure(failures, "schema does not match the protocol-14 UI proof contract");

  const identities = report.identities;
  if (!isRecord(identities)) {
    addFailure(failures, "identities must be an object");
  } else {
    if (identities.source !== PIN.source) addFailure(failures, "source pin mismatch");
    if (identities.protocol !== PIN.protocol) addFailure(failures, "client protocol pin mismatch");
    if (identities.contentHash !== PIN.contentHash) addFailure(failures, "client content hash mismatch");

    const server = identities.server;
    if (!isRecord(server)) addFailure(failures, "server identity is missing");
    else {
      if (server.sha256 !== PIN.serverSha256) addFailure(failures, "server binary hash mismatch");
      if (!isRecord(server.info)) addFailure(failures, "server /info identity is missing");
      else {
        if (server.info.protocol !== PIN.protocol) addFailure(failures, "server /info protocol mismatch");
        if (server.info.contentHash !== PIN.contentHash) addFailure(failures, "server /info content hash mismatch");
      }
    }

    const artifact = identities.artifact;
    if (!isRecord(artifact)) addFailure(failures, "artifact identity is missing");
    else {
      if (artifact.manifestSha256 !== PIN.artifactManifestSha256) addFailure(failures, "artifact manifest hash mismatch");
      if (artifact.verifiedFiles !== PIN.artifactFiles) addFailure(failures, "verified artifact file count mismatch");
      if (artifact.fileCount !== PIN.artifactFiles) addFailure(failures, "artifact file count mismatch");
      if (artifact.bytes !== PIN.artifactBytes) addFailure(failures, "artifact byte count mismatch");
      if (artifact.unchangedAfter !== true) addFailure(failures, "artifact was not verified unchanged after the run");
    }

    const browser = identities.browser;
    if (!isRecord(browser)) addFailure(failures, "browser identity is missing");
    else {
      if (!nonemptyString(browser.version)) addFailure(failures, "browser version is missing");
      if (!nonemptyString(browser.renderer)) addFailure(failures, "browser renderer is missing");
    }

    const resolution = identities.resolution;
    if (!isRecord(resolution)) addFailure(failures, "resolution identity is missing");
    else {
      for (const key of ["width", "height", "canvasWidth", "canvasHeight"]) {
        if (!positiveInteger(resolution[key])) addFailure(failures, `resolution.${key} must be a positive integer`);
      }
      if (resolution.canvasWidth !== resolution.width || resolution.canvasHeight !== resolution.height)
        addFailure(failures, "native canvas dimensions must match the 2560x1440-proof viewport dimensions");
    }
  }

  const policy = report.policy;
  const expectedPolicy = {
    ordinary: true,
    diagnostic: false,
    syntheticProfilesOnly: true,
    noWorldInjection: true,
    privateWorldHooks: false,
  };
  if (!isRecord(policy)) addFailure(failures, "policy must be an object");
  else {
    for (const [key, expected] of Object.entries(expectedPolicy)) {
      if (policy[key] !== expected) addFailure(failures, `policy.${key} must be ${expected}`);
    }
  }

  if (!isRecord(report.checks)) {
    addFailure(failures, "checks must be an object");
  } else {
    for (const name of REQUIRED_CHECKS) {
      const check = report.checks[name];
      if (!isRecord(check)) {
        addFailure(failures, `required check ${name} is missing`);
      } else if (check.status === "FAIL") {
        addFailure(failures, `check ${name} failed`);
      } else if (check.status === "OPEN") {
        open.push(name);
      } else if (check.status !== "PASS") {
        addFailure(failures, `check ${name} has an invalid status`);
      }
    }
  }

  const screenshots = report.screenshots;
  if (!Array.isArray(screenshots) || screenshots.length === 0) {
    addFailure(failures, "at least one screenshot is required");
  } else {
    const paths = new Set();
    let validScreenshot = false;
    const resolution = identities && identities.resolution;
    for (let i = 0; i < screenshots.length; i++) {
      const screenshot = screenshots[i];
      if (!isRecord(screenshot)) {
        addFailure(failures, `screenshot ${i} must be an object`);
        continue;
      }
      const relative = nonemptyString(screenshot.path) && !path.isAbsolute(screenshot.path) &&
        !screenshot.path.split(/[\\/]+/).includes("..") && /\.png$/i.test(screenshot.path);
      if (!relative) addFailure(failures, `screenshot ${i} path must be a relative PNG path`);
      else if (paths.has(screenshot.path)) addFailure(failures, `screenshot ${i} path is duplicated`);
      else paths.add(screenshot.path);
      if (typeof screenshot.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(screenshot.sha256))
        addFailure(failures, `screenshot ${i} SHA-256 is invalid`);
      if (!positiveInteger(screenshot.bytes)) addFailure(failures, `screenshot ${i} byte count is invalid`);
      if (!positiveInteger(screenshot.width) || !positiveInteger(screenshot.height))
        addFailure(failures, `screenshot ${i} dimensions are invalid`);
      const dimensionsMatch = isRecord(resolution) && screenshot.width === resolution.width && screenshot.height === resolution.height;
      if (!dimensionsMatch) addFailure(failures, `screenshot ${i} dimensions do not match the reported viewport`);
      if (relative && /^[a-f0-9]{64}$/.test(screenshot.sha256 || "") && positiveInteger(screenshot.bytes) &&
          positiveInteger(screenshot.width) && positiveInteger(screenshot.height) && dimensionsMatch) validScreenshot = true;
    }
    if (!validScreenshot) addFailure(failures, "no screenshot has complete hash, size, and viewport metadata");
  }

  const errors = report.errors;
  if (!isRecord(errors)) addFailure(failures, "errors must be an object");
  else {
    for (const key of ["pageErrors", "unityErrors", "observerErrors"]) {
      if (!Array.isArray(errors[key])) addFailure(failures, `errors.${key} must be an array`);
      else if (errors[key].length > 0) addFailure(failures, `errors.${key} must be empty`);
    }
  }

  const cleanup = report.cleanup;
  if (!isRecord(cleanup)) addFailure(failures, "cleanup must be an object");
  else {
    for (const key of REQUIRED_CLEANUP) {
      if (cleanup[key] !== true) addFailure(failures, `cleanup.${key} must be true`);
    }
  }

  const limits = report.limits;
  if (!isRecord(limits)) addFailure(failures, "limits must be an object");
  else {
    for (const key of REQUIRED_LIMITS) {
      if (limits[key] !== false) addFailure(failures, `limits.${key} must remain false for this proof`);
    }
  }

  const status = failures.length > 0 ? "FAIL" : open.length > 0 ? "PARTIAL" : "PASS";
  return { status, failures, open };
}

module.exports = { PIN, REQUIRED_CHECKS, evaluateReport };
