// Telemetry's configuration, parsed once at boot from the environment (docs/TELEMETRY.md 6.1). A bad value logs one line and
// turns that sink off; it never throws at startup.
import { TELEMETRY_SECRET_MIN_CHARS, type RecordSource } from "@raid/shared";

export interface TelemetryConfig {
  /** The Worker's ingest endpoint and its bearer token: both or neither. */
  url: string | null;
  token: string | null;
  /** A local NDJSON sink's directory. */
  dir: string | null;
  /** The callsign salt (pid); null = no pid for anyone. */
  salt: string | null;
  source: RecordSource;
  /** 1 Hz tile samples (TELEMETRY_POSITIONS, default on). */
  positions: boolean;
  /** GAME_SOURCE_COMMIT, when set. */
  commit: string | null;
}

const SOURCES: readonly RecordSource[] = ["live", "dev", "tournament", "bench", "test"];

function localHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

/** The URL rules of RemoteSnapshot.ts: https (or http on localhost when allowed), no credentials, no fragment. */
export function telemetryUrlProblem(raw: string, allowHttpLocalhost = false): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return "TELEMETRY_URL is not a URL"; }
  if (url.username || url.password) return "TELEMETRY_URL must not hold credentials";
  if (url.hash || raw.includes("#")) return "TELEMETRY_URL must not hold a fragment";
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && allowHttpLocalhost && localHost(url.hostname)) return null;
  return "TELEMETRY_URL must be https";
}

export function telemetryConfigFromEnv(
  env: Record<string, string | undefined>, opts: { allowHttpLocalhost?: boolean; log?: (line: string) => void } = {},
): TelemetryConfig {
  const log = opts.log ?? ((line: string) => console.warn(line));
  let url = env.TELEMETRY_URL?.trim() || null;
  let token = env.TELEMETRY_TOKEN?.trim() || null;
  if ((url === null) !== (token === null)) {
    log("[telemetry] TELEMETRY_URL and TELEMETRY_TOKEN must be set together: the remote sink is off");
    url = token = null;
  } else if (url !== null && token !== null) {
    const problem = telemetryUrlProblem(url, opts.allowHttpLocalhost);
    if (problem) {
      log(`[telemetry] ${problem}: the remote sink is off`);
      url = token = null;
    } else if (token.length < TELEMETRY_SECRET_MIN_CHARS) {
      log(`[telemetry] TELEMETRY_TOKEN is shorter than ${TELEMETRY_SECRET_MIN_CHARS} characters: the remote sink is off`);
      url = token = null;
    }
  }
  let salt = env.TELEMETRY_SALT?.trim() || null;
  if (salt !== null && salt.length < TELEMETRY_SECRET_MIN_CHARS) {
    log(`[telemetry] TELEMETRY_SALT is shorter than ${TELEMETRY_SECRET_MIN_CHARS} characters: no player ids are recorded`);
    salt = null;
  }
  const rawSource = env.TELEMETRY_SOURCE?.trim();
  let source: RecordSource = "dev";
  if (rawSource) {
    if ((SOURCES as readonly string[]).includes(rawSource)) source = rawSource as RecordSource;
    else log(`[telemetry] TELEMETRY_SOURCE is not one of ${SOURCES.join(", ")}: using dev`);
  }
  const commit = env.GAME_SOURCE_COMMIT?.trim();
  return {
    url, token, dir: env.TELEMETRY_DIR?.trim() || null, salt, source,
    positions: env.TELEMETRY_POSITIONS?.trim() !== "0",
    commit: commit && /^[0-9a-zA-Z._-]{1,80}$/.test(commit) ? commit : null,
  };
}

/** Any sink at all: without one the Room installs no recorder (entirely off). */
export function telemetryEnabled(c: TelemetryConfig): boolean {
  return (c.url !== null && c.token !== null) || c.dir !== null;
}
