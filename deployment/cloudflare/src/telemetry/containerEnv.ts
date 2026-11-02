import { TELEMETRY_INGEST_PATH, TELEMETRY_SECRET_MIN_CHARS } from "@raid/shared/telemetry";

export interface TelemetrySecrets {
  TELEMETRY_TOKEN?: string;
  TELEMETRY_SALT?: string;
}

export function telemetryOn(env: TelemetrySecrets): boolean {
  return typeof env.TELEMETRY_TOKEN === "string" && env.TELEMETRY_TOKEN.length >= TELEMETRY_SECRET_MIN_CHARS;
}

/** The game container's telemetry env: only with a valid TELEMETRY_TOKEN, and it never throws on its absence. */
export function telemetryContainerEnv(env: TelemetrySecrets, requestUrl: string, commit: string | null): Record<string, string> {
  if (!telemetryOn(env)) return {};
  const out: Record<string, string> = {
    TELEMETRY_URL: new URL(TELEMETRY_INGEST_PATH, requestUrl).href,
    TELEMETRY_TOKEN: env.TELEMETRY_TOKEN!,
    TELEMETRY_SOURCE: "live",
  };
  if (typeof env.TELEMETRY_SALT === "string" && env.TELEMETRY_SALT.length >= TELEMETRY_SECRET_MIN_CHARS) out.TELEMETRY_SALT = env.TELEMETRY_SALT;
  if (commit) out.GAME_SOURCE_COMMIT = commit;
  return out;
}
