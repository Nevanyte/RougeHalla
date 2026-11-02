// Local preview of the balance dashboard (docs/TELEMETRY.md 11 C), with no Worker and no data store:
//   npx tsx deployment/cloudflare/scripts/dashboardDev.ts [--port 8788] [--open]
// serves the page's three exports at /stats, /stats/app.js and /stats/app.css with the Worker's headers, answers
// /api/stats/* from DASHBOARD_FIXTURE, and runs the same login flow (form POST, HMAC session cookie). The token is
// DASHBOARD_TOKEN or the dev default printed at start; --open skips the login. Not for anything but local preview.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dashboardHtml, dashboardScript, dashboardStyles } from "../src/dashboard/page";
import { DASHBOARD_FIXTURE } from "../src/dashboard/fixture";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) > 0 && args.includes("--port") ? Number(args[args.indexOf("--port") + 1]) : 8788;
const open = args.includes("--open");
const TOKEN = process.env.DASHBOARD_TOKEN ?? "dev-dashboard-token-0123456789abcdef0123";
const COOKIE = "rh_stats";

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

function mac(exp: number): string {
  return createHmac("sha256", TOKEN).update("rh-stats-session:v1:" + exp).digest("base64url");
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function authed(req: IncomingMessage): boolean {
  if (open) return true;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ") && sameText(auth.slice(7), TOKEN)) return true;
  const cookie = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!cookie) return false;
  const [exp, m] = cookie.slice(COOKIE.length + 1).split(".");
  return Number(exp) > Date.now() && typeof m === "string" && sameText(m, mac(Number(exp)));
}

function send(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type, ...extra });
  res.end(body);
}

// A fixture key with a query is the variant for those params (the first that matches), else the bare path.
const VARIANT_PARAMS = ["clean", "outcomes", "kind", "by"];
function fixtureFor(path: string, q: URLSearchParams): unknown {
  if (path.startsWith("/api/stats/run/")) return DASHBOARD_FIXTURE["/api/stats/run/:runId"];
  for (const k of VARIANT_PARAMS) {
    const v = q.get(k);
    if (v !== null) {
      const key = `${path}?${k}=${v}`;
      if (key in DASHBOARD_FIXTURE) return DASHBOARD_FIXTURE[key];
    }
  }
  return DASHBOARD_FIXTURE[path];
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c: Buffer) => {
      s += c.toString("utf8");
      if (s.length > 4096) req.destroy();
    });
    req.on("end", () => resolve(s));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  if (req.method === "GET" && (path === "/stats" || path === "/stats/")) return send(res, 200, "text/html; charset=utf-8", dashboardHtml());
  if (req.method === "GET" && path === "/stats/app.js") return send(res, 200, "text/javascript; charset=utf-8", dashboardScript());
  if (req.method === "GET" && path === "/stats/app.css") return send(res, 200, "text/css; charset=utf-8", dashboardStyles());
  if (req.method === "POST" && path === "/stats/login") {
    const token = new URLSearchParams(await readBody(req)).get("token") ?? "";
    if (!sameText(token, TOKEN)) return send(res, 303, "text/plain", "", { Location: "/stats?login=failed" });
    const exp = Date.now() + 7 * 86_400_000;
    // No Secure flag here: the preview is plain http on localhost.
    return send(res, 303, "text/plain", "", { Location: "/stats", "Set-Cookie": `${COOKIE}=${exp}.${mac(exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800` });
  }
  if (req.method === "POST" && path === "/stats/logout") {
    return send(res, 303, "text/plain", "", { Location: "/stats", "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
  }
  if (path.startsWith("/api/stats/")) {
    if (!authed(req)) return send(res, 401, "application/json", JSON.stringify({ error: "unauthorized" }));
    const data = fixtureFor(path, url.searchParams);
    if (data === undefined) return send(res, 404, "application/json", JSON.stringify({ error: "not found" }));
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify(data));
  }
  return send(res, 404, "text/plain", "not found");
});

server.listen(port, () => {
  console.log(`dashboard preview on http://localhost:${port}/stats` + (open ? " (no login)" : ` (token: ${TOKEN})`));
});
