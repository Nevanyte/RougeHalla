// Who a record names (docs/TELEMETRY.md 5): a salted, truncated HMAC of the callsign, never the callsign, an address or a token.
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** HMAC-SHA256(salt, "callsign:" + lowercased callsign), the first 16 hex characters; null without a salt. */
export function pidOf(salt: string | null, callsign: string): string | null {
  if (!salt) return null;
  return createHmac("sha256", salt).update(`callsign:${callsign.toLowerCase()}`).digest("hex").slice(0, 16);
}

const COMMIT_RE = /^[0-9a-zA-Z._-]{1,80}$/;

/** The commit a build was made from: GAME_SOURCE_COMMIT, else `${clientDir}/build-info.json` (`sourceCommit` or `commit`), else null. */
export function readBuildInfo(commitEnv: string | null, clientDir: string | undefined): string | null {
  if (commitEnv) return commitEnv;
  if (!clientDir) return null;
  try {
    const info = JSON.parse(fs.readFileSync(path.join(clientDir, "build-info.json"), "utf8")) as { sourceCommit?: unknown; commit?: unknown };
    const c = typeof info.sourceCommit === "string" ? info.sourceCommit : typeof info.commit === "string" ? info.commit : null;
    return c && COMMIT_RE.test(c) ? c : null;
  } catch {
    return null;
  }
}
