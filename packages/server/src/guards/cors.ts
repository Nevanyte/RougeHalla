/**
 * The origin to put in `Access-Control-Allow-Origin` for a request, or null for none.
 * Open mode (dev: Vite on :5173 calls the server on :2567) answers `*` to /api and echoes the requester to matchmaking, as
 * Colyseus does. Same-origin mode (a public link) lets the page the server itself serves in without any header, and
 * names only the `allowlist` origins (lower case, no trailing slash) for anyone else.
 */
export function corsOrigin(origin: string | null | undefined, sameOriginOnly: boolean, allowlist: readonly string[]): string | null {
  if (!sameOriginOnly) return origin || "*";
  if (!origin) return null;
  return allowlist.includes(origin.toLowerCase()) ? origin : null;
}
