// Dashboard auth (docs/TELEMETRY.md 8.1): a stateless HMAC session cookie or a bearer DASHBOARD_TOKEN, the login form
// handler and the headers every dashboard response carries. Rotating DASHBOARD_TOKEN logs everyone out.
import { TELEMETRY_SECRET_MIN_CHARS } from "@raid/shared/telemetry";

export const SESSION_COOKIE = "rh_stats";
export const SESSION_SECONDS = 7 * 24 * 3600;
const SESSION_CONTEXT = "rh-stats-session:v1:";

export const DASHBOARD_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** Headers on every /stats* and /api/stats/* response. */
export function dashboardHeaders(contentType?: string): Headers {
  const h = new Headers({
    "Content-Security-Policy": DASHBOARD_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
  });
  if (contentType) h.set("Content-Type", contentType);
  return h;
}

export function dashboardEnabled(token: string | undefined): token is string {
  return typeof token === "string" && token.length >= TELEMETRY_SECRET_MIN_CHARS;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function base64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mac(token: string, exp: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${SESSION_CONTEXT}${exp}`)));
}

/** `<exp>.<mac>`, exp in epoch seconds. */
export async function sessionValue(token: string, nowMs: number): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + SESSION_SECONDS;
  return `${exp}.${await mac(token, exp)}`;
}

export async function verifySession(token: string, value: string, nowMs: number): Promise<boolean> {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m) return false;
  const exp = Number(m[1]);
  const now = Math.floor(nowMs / 1000);
  // A cookie cannot outlive its own Max-Age, whatever exp it names.
  if (!(exp > now) || exp > now + SESSION_SECONDS + 60) return false;
  return constantTimeEqual(m[2], await mac(token, exp));
}

export function cookieOf(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** A bearer DASHBOARD_TOKEN or a valid session cookie. */
export async function authorized(request: Request, token: string, nowMs: number): Promise<boolean> {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return constantTimeEqual(auth.slice(7), token);
  const cookie = cookieOf(request, SESSION_COOKIE);
  return cookie !== null && verifySession(token, cookie, nowMs);
}

/** A browser's state-changing request must come from this origin (a missing Origin is refused too). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function redirect(location: string, cookie?: string): Response {
  const h = dashboardHeaders();
  h.set("Location", location);
  if (cookie) h.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers: h });
}

export interface LoginEnv {
  DASHBOARD_TOKEN: string;
  MATCHMAKE_LIMITER?: Pick<RateLimit, "limit">;
}

/** The filters the sign-in form carries back (the page's own query string): a plain query only, never a path or URL. */
export function loginNext(v: unknown): string {
  if (typeof v !== "string" || v.length > 512 || !/^[A-Za-z0-9_.,:%=&+-]*$/.test(v)) return "";
  const sp = new URLSearchParams(v);
  sp.delete("login");
  return sp.toString();
}

export async function handleLogin(request: Request, env: LoginEnv, nowMs: number): Promise<Response> {
  if (request.method !== "POST") {
    const h = dashboardHeaders("text/plain; charset=utf-8");
    h.set("Allow", "POST");
    return new Response("method not allowed", { status: 405, headers: h });
  }
  if (!sameOrigin(request)) return new Response("forbidden", { status: 403, headers: dashboardHeaders("text/plain; charset=utf-8") });
  if (env.MATCHMAKE_LIMITER) {
    const { success } = await env.MATCHMAKE_LIMITER.limit({ key: `dashlogin:${request.headers.get("CF-Connecting-IP") ?? "unknown"}` });
    if (!success) {
      const h = dashboardHeaders("text/plain; charset=utf-8");
      h.set("Retry-After", "10");
      return new Response("too many attempts", { status: 429, headers: h });
    }
  }
  let token = "";
  let next = "";
  try {
    const length = Number(request.headers.get("Content-Length") ?? "0");
    if (length > 4096) return redirect("/stats?login=failed");
    const form = await request.formData();
    const v = form.get("token");
    token = typeof v === "string" ? v.trim() : "";
    next = loginNext(form.get("next"));
  } catch {
    return redirect("/stats?login=failed");
  }
  if (!constantTimeEqual(token, env.DASHBOARD_TOKEN)) return redirect(`/stats?login=failed${next ? `&${next}` : ""}`);
  const value = await sessionValue(env.DASHBOARD_TOKEN, nowMs);
  return redirect(next ? `/stats?${next}` : "/stats", `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
}

export function handleLogout(request: Request): Response {
  if (request.method !== "POST") {
    const h = dashboardHeaders("text/plain; charset=utf-8");
    h.set("Allow", "POST");
    return new Response("method not allowed", { status: 405, headers: h });
  }
  if (!sameOrigin(request)) return new Response("forbidden", { status: 403, headers: dashboardHeaders("text/plain; charset=utf-8") });
  return redirect("/stats", `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
